/*!
 * Private DAO Smart Contract
 *
 * Features:
 * - Public or Private membership modes
 * - Anonymous voting with encrypted ballots
 * - OutLayer integration for key derivation and vote tallying
 * - User pays for OutLayer execution
 * - Proposal creation and voting
 * - TEE-based vote verification
 */

mod types;

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap, Vector};
use near_sdk::{
    env, ext_contract, log, near_bindgen, AccountId, Gas, NearToken, Promise,
    PromiseError, PanicOnDefault,
};

type Balance = u128;

use types::*;

/// Minimum deposit for OutLayer execution (0.01 NEAR)
const MIN_OUTLAYER_DEPOSIT: Balance = 10_000_000_000_000_000_000_000;

/// Storage deposit per member (for public key storage)
const STORAGE_DEPOSIT_PER_MEMBER: Balance = 2_000_000_000_000_000_000_000; // 0.002 NEAR

/// Storage deposit per vote
const STORAGE_DEPOSIT_PER_VOTE: Balance = 2_000_000_000_000_000_000_000; // 0.002 NEAR

/// Gas for callback
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

/// OutLayer contract ID
const OUTLAYER_CONTRACT_ID: &str = "outlayer.testnet";

/// External contract interface for OutLayer
#[ext_contract(ext_outlayer)]
#[allow(dead_code)]
trait OutLayer {
    fn request_execution(
        &mut self,
        code_source: serde_json::Value,
        resource_limits: serde_json::Value,
        input_data: String,
        secrets_ref: Option<serde_json::Value>,
        response_format: String,
        payer_account_id: Option<AccountId>,
    );
}

/// External contract interface for self callbacks
#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtSelf {
    fn on_key_derived(
        &mut self,
        user: AccountId,
        #[callback_result] result: Result<Option<DeriveKeyResponse>, PromiseError>,
    );

    fn on_votes_tallied(
        &mut self,
        proposal_id: u64,
        #[callback_result] result: Result<Option<TallyResponse>, PromiseError>,
    );
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
#[borsh(crate = "near_sdk::borsh")]
pub struct PrivateDAO {
    /// DAO owner (admin)
    pub owner: AccountId,

    /// DAO name
    pub name: String,

    /// Membership mode: Public or Private
    pub membership_mode: MembershipMode,

    /// Members list (account_id → is_member)
    pub members: LookupMap<AccountId, bool>,

    /// Member count (for public display)
    pub member_count: u64,

    /// User public keys (account_id → public_key_hex)
    /// Public keys are used for client-side encryption
    pub user_pubkeys: LookupMap<AccountId, String>,

    /// Proposals (proposal_id → Proposal)
    pub proposals: UnorderedMap<u64, Proposal>,

    /// Next proposal ID
    pub next_proposal_id: u64,

    /// Votes (proposal_id → Vector<Vote>)
    pub votes: LookupMap<u64, Vector<Vote>>,
}

#[near_bindgen]
impl PrivateDAO {
    /// Initialize a new DAO
    ///
    /// # Arguments
    /// * `name` - DAO name
    /// * `membership_mode` - Public or Private membership
    /// * `owner` - DAO owner/admin account
    #[init]
    pub fn new(name: String, membership_mode: MembershipMode, owner: AccountId) -> Self {
        assert!(!env::state_exists(), "Already initialized");

        let mut dao = Self {
            owner: owner.clone(),
            name,
            membership_mode,
            members: LookupMap::new(b"m"),
            member_count: 0,
            user_pubkeys: LookupMap::new(b"p"),
            proposals: UnorderedMap::new(b"r"),
            next_proposal_id: 1,
            votes: LookupMap::new(b"v"),
        };

        // Add owner as first member
        dao.members.insert(&owner, &true);
        dao.member_count = 1;

        dao
    }

    /// Join the DAO and derive encryption public key
    ///
    /// In Public mode: anyone can join
    /// In Private mode: only invited members can join
    ///
    /// # Payment
    /// Requires:
    /// - 0.002 NEAR for storage deposit (member record)
    /// - 0.01 NEAR for OutLayer execution (key derivation)
    /// Total: ~0.012 NEAR
    ///
    /// # Process
    /// 1. User pays and joins DAO
    /// 2. Contract calls OutLayer to derive user's public key
    /// 3. OutLayer callback stores public key on contract
    /// 4. User can now vote with encrypted ballots
    #[payable]
    pub fn join_dao(&mut self) -> Promise {
        let user = env::predecessor_account_id();
        let attached = env::attached_deposit();

        // Check if already a member
        if self.members.get(&user).unwrap_or(false) {
            env::panic_str("Already a member");
        }

        // In Private mode, user must be pre-approved (added by owner)
        if self.membership_mode == MembershipMode::Private {
            env::panic_str("Private DAO: join by invitation only");
        }

        // Check deposit covers storage + OutLayer execution
        let required_deposit = STORAGE_DEPOSIT_PER_MEMBER + MIN_OUTLAYER_DEPOSIT;
        assert!(
            attached.as_yoctonear() >= required_deposit,
            "Minimum deposit is {} yoctoNEAR (storage + OutLayer execution)",
            required_deposit
        );

        // Add as member
        self.members.insert(&user, &true);
        self.member_count += 1;

        log!("User {} joined DAO. Deriving encryption public key via OutLayer", user);

        // Call OutLayer to derive user's public key
        self.request_key_derivation(user.clone(), attached.as_yoctonear())
    }

    /// Add member (Private DAO only, owner-only)
    ///
    /// In Private mode, owner pre-approves members before they can join
    pub fn add_member(&mut self, account_id: AccountId) {
        self.assert_owner();

        if self.membership_mode == MembershipMode::Public {
            env::panic_str("Public DAO: users join directly");
        }

        if self.members.get(&account_id).is_some() {
            env::panic_str("Already a member");
        }

        self.members.insert(&account_id, &true);
        self.member_count += 1;

        log!("Added {} to private DAO (pre-approved)", account_id);
    }

    /// Complete join after pre-approval (Private DAO)
    ///
    /// After owner adds member, user must call this to derive their key
    #[payable]
    pub fn complete_join(&mut self) -> Promise {
        let user = env::predecessor_account_id();
        let attached = env::attached_deposit();

        // Check if pre-approved
        if !self.members.get(&user).unwrap_or(false) {
            env::panic_str("Not pre-approved. Contact DAO owner.");
        }

        // Check if already has pubkey (already completed join)
        if self.user_pubkeys.get(&user).is_some() {
            env::panic_str("Already completed join");
        }

        // Check deposit for OutLayer execution
        assert!(
            attached.as_yoctonear() >= MIN_OUTLAYER_DEPOSIT,
            "Minimum deposit is {} yoctoNEAR for OutLayer execution",
            MIN_OUTLAYER_DEPOSIT
        );

        log!("User {} completing join. Deriving encryption public key", user);

        // Call OutLayer to derive user's public key
        self.request_key_derivation(user.clone(), attached.as_yoctonear())
    }

    /// Create a new proposal
    ///
    /// # Arguments
    /// * `title` - Proposal title
    /// * `description` - Proposal description
    /// * `quorum` - Quorum requirements for passing
    /// * `deadline` - Voting deadline (nanoseconds since epoch)
    ///
    /// # Payment
    /// Requires 0.001 NEAR for storage
    #[payable]
    pub fn create_proposal(
        &mut self,
        title: String,
        description: String,
        quorum: QuorumType,
        deadline: u64,
    ) -> u64 {
        let creator = env::predecessor_account_id();

        // Only members can create proposals
        assert!(
            self.members.get(&creator).unwrap_or(false),
            "Only members can create proposals"
        );

        // Check storage deposit
        let attached = env::attached_deposit();
        assert!(
            attached.as_yoctonear() >= 1_000_000_000_000_000_000_000, // 0.001 NEAR
            "Minimum deposit is 0.001 NEAR for storage"
        );

        // Validate deadline is in the future
        assert!(
            deadline > env::block_timestamp(),
            "Deadline must be in the future"
        );

        let proposal_id = self.next_proposal_id;
        self.next_proposal_id += 1;

        let proposal = Proposal {
            id: proposal_id,
            title,
            description,
            creator: creator.clone(),
            created_at: env::block_timestamp(),
            deadline,
            quorum,
            status: ProposalStatus::Active,
            total_members_at_creation: self.member_count,
            tally_result: None,
        };

        self.proposals.insert(&proposal_id, &proposal);
        self.votes.insert(&proposal_id, &Vector::new(format!("v{}", proposal_id).as_bytes()));

        log!(
            "Proposal {} created by {}: '{}'",
            proposal_id,
            creator,
            proposal.title
        );

        proposal_id
    }

    /// Cast a vote on a proposal
    ///
    /// # Arguments
    /// * `proposal_id` - Proposal ID
    /// * `encrypted_vote` - Encrypted vote ("yes" or "no", encrypted with user's pubkey)
    /// * `nonce` - Random nonce used for encryption (hex string)
    ///
    /// # Payment
    /// Requires 0.002 NEAR for storage
    ///
    /// # Notes
    /// - Vote is encrypted client-side using user's public key
    /// - Multiple votes allowed (last vote counts)
    /// - User can also send dummy votes for privacy (any ciphertext that doesn't decrypt to "yes"/"no")
    #[payable]
    pub fn cast_vote(
        &mut self,
        proposal_id: u64,
        encrypted_vote: String,
        nonce: String,
    ) {
        let voter = env::predecessor_account_id();
        let attached = env::attached_deposit();

        // Only members can vote
        assert!(
            self.members.get(&voter).unwrap_or(false),
            "Only members can vote"
        );

        // Check if user has pubkey (completed join)
        assert!(
            self.user_pubkeys.get(&voter).is_some(),
            "Complete join first to derive encryption key"
        );

        // Check storage deposit
        assert!(
            attached.as_yoctonear() >= STORAGE_DEPOSIT_PER_VOTE,
            "Minimum deposit is {} yoctoNEAR for vote storage",
            STORAGE_DEPOSIT_PER_VOTE
        );

        // Get proposal
        let proposal = self.proposals.get(&proposal_id)
            .expect("Proposal not found");

        // Check proposal is active
        assert!(
            proposal.status == ProposalStatus::Active,
            "Proposal is not active"
        );

        // Check deadline not passed
        assert!(
            env::block_timestamp() < proposal.deadline,
            "Voting deadline has passed"
        );

        // Create vote
        let vote = Vote {
            user: voter.clone(),
            encrypted_vote,
            nonce,
            timestamp: env::block_timestamp(),
        };

        // Add vote to list
        let mut votes = self.votes.get(&proposal_id).unwrap();
        votes.push(&vote);
        self.votes.insert(&proposal_id, &votes);

        log!("Vote cast by {} on proposal {}", voter, proposal_id);
    }

    /// Finalize a proposal and tally votes in TEE
    ///
    /// # Arguments
    /// * `proposal_id` - Proposal ID
    ///
    /// # Payment
    /// Requires 0.01 NEAR for OutLayer execution
    ///
    /// # Process
    /// 1. User pays for OutLayer execution
    /// 2. Contract sends all encrypted votes to OutLayer
    /// 3. OutLayer WASM decrypts votes in TEE
    /// 4. OutLayer returns tally (yes_count, no_count, total)
    /// 5. Callback updates proposal status (Passed/Rejected)
    #[payable]
    pub fn finalize_proposal(&mut self, proposal_id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let attached = env::attached_deposit();

        // Check deposit for OutLayer execution
        assert!(
            attached.as_yoctonear() >= MIN_OUTLAYER_DEPOSIT,
            "Minimum deposit is {} yoctoNEAR for OutLayer execution",
            MIN_OUTLAYER_DEPOSIT
        );

        // Get proposal
        let proposal = self.proposals.get(&proposal_id)
            .expect("Proposal not found");

        // Check proposal is active
        assert!(
            proposal.status == ProposalStatus::Active,
            "Proposal is not active"
        );

        // Check deadline passed
        assert!(
            env::block_timestamp() >= proposal.deadline,
            "Voting deadline has not passed yet"
        );

        log!("Finalizing proposal {}. Tallying votes via OutLayer TEE", proposal_id);

        // Get all votes
        let votes = self.votes.get(&proposal_id).unwrap();
        let votes_vec: Vec<Vote> = votes.iter().collect();

        // Call OutLayer to tally votes in TEE
        self.request_vote_tallying(proposal_id, votes_vec, attached.as_yoctonear(), caller)
    }

    // ========== Internal methods ==========

    /// Request key derivation from OutLayer
    fn request_key_derivation(&self, user: AccountId, attached_deposit: Balance) -> Promise {
        let code_source = serde_json::json!({
            "repo": "https://github.com/zavodil/private-dao-ark",
            "commit": "main",
            "build_target": "wasm32-wasip1"
        });

        let resource_limits = serde_json::json!({
            "max_instructions": 1000000000u64,
            "max_memory_mb": 128u32,
            "max_execution_seconds": 30u64
        });

        let input_data = serde_json::json!({
            "action": "derive_pubkey",
            "dao_account": env::current_account_id(),
            "user_account": user
        });

        // Call OutLayer
        ext_outlayer::ext(OUTLAYER_CONTRACT_ID.parse().unwrap())
            .with_attached_deposit(NearToken::from_yoctonear(attached_deposit))
            .with_unused_gas_weight(1)
            .request_execution(
                code_source,
                resource_limits,
                serde_json::to_string(&input_data).unwrap(),
                None, // No secrets needed for public key derivation
                "Json".to_string(),
                Some(user.clone()), // Refund to user
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_key_derived(user),
            )
    }

    /// Request vote tallying from OutLayer
    fn request_vote_tallying(
        &self,
        proposal_id: u64,
        votes: Vec<Vote>,
        attached_deposit: Balance,
        payer: AccountId,
    ) -> Promise {
        let code_source = serde_json::json!({
            "repo": "https://github.com/zavodil/private-dao-ark",
            "commit": "main",
            "build_target": "wasm32-wasip1"
        });

        let resource_limits = serde_json::json!({
            "max_instructions": 10000000000u64,
            "max_memory_mb": 128u32,
            "max_execution_seconds": 60u64
        });

        let input_data = serde_json::json!({
            "action": "tally_votes",
            "dao_account": env::current_account_id(),
            "proposal_id": proposal_id,
            "votes": votes
        });

        // Call OutLayer with secrets_ref (master secret from keymaster)
        let secrets_ref = serde_json::json!({
            "profile": "default",
            "account_id": "zavodil2.testnet"
        });

        ext_outlayer::ext(OUTLAYER_CONTRACT_ID.parse().unwrap())
            .with_attached_deposit(NearToken::from_yoctonear(attached_deposit))
            .with_unused_gas_weight(1)
            .request_execution(
                code_source,
                resource_limits,
                serde_json::to_string(&input_data).unwrap(),
                Some(secrets_ref), // Master secret from keymaster
                "Json".to_string(),
                Some(payer), // Refund to payer
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_votes_tallied(proposal_id),
            )
    }

    /// Callback after key derivation
    #[private]
    pub fn on_key_derived(
        &mut self,
        user: AccountId,
        #[callback_result] result: Result<Option<DeriveKeyResponse>, PromiseError>,
    ) {
        match result {
            Ok(Some(response)) => {
                log!("Public key derived for {}: {}", user, response.pubkey);

                // Store pubkey
                self.user_pubkeys.insert(&user, &response.pubkey);

                log!("User {} can now vote with encrypted ballots", user);
            }
            Ok(None) => {
                log!("OutLayer execution failed for user {}", user);

                // Remove member (failed to derive key)
                self.members.remove(&user);
                self.member_count -= 1;

                env::panic_str("Failed to derive encryption key");
            }
            Err(e) => {
                log!("Promise error for user {}: {:?}", user, e);

                // Remove member (failed to derive key)
                self.members.remove(&user);
                self.member_count -= 1;

                env::panic_str(&format!("Promise error: {:?}", e));
            }
        }
    }

    /// Callback after vote tallying
    #[private]
    pub fn on_votes_tallied(
        &mut self,
        proposal_id: u64,
        #[callback_result] result: Result<Option<TallyResponse>, PromiseError>,
    ) {
        match result {
            Ok(Some(response)) => {
                log!(
                    "Votes tallied for proposal {}: YES={}, NO={}, TOTAL={}",
                    proposal_id,
                    response.yes_count,
                    response.no_count,
                    response.total_votes
                );

                // Get proposal
                let mut proposal = self.proposals.get(&proposal_id).unwrap();

                // Check if quorum met
                let quorum_met = match &proposal.quorum {
                    QuorumType::Absolute { min_votes } => {
                        response.total_votes >= *min_votes
                    }
                    QuorumType::Percentage { min_percentage } => {
                        let required = (proposal.total_members_at_creation * *min_percentage) / 100;
                        response.total_votes >= required
                    }
                    QuorumType::PercentageOfVoters { min_yes_percentage } => {
                        if response.total_votes == 0 {
                            false
                        } else {
                            let yes_percentage = (response.yes_count * 100) / response.total_votes;
                            yes_percentage >= *min_yes_percentage
                        }
                    }
                };

                // Determine if passed
                let passed = quorum_met && response.yes_count > response.no_count;

                proposal.status = if passed {
                    ProposalStatus::Passed
                } else {
                    ProposalStatus::Rejected
                };

                proposal.tally_result = Some(TallyResult {
                    yes_count: response.yes_count,
                    no_count: response.no_count,
                    total_votes: response.total_votes,
                    tee_attestation: response.tee_attestation,
                    votes_merkle_root: response.votes_merkle_root,
                });

                self.proposals.insert(&proposal_id, &proposal);

                log!(
                    "Proposal {} finalized: {}",
                    proposal_id,
                    if passed { "PASSED" } else { "REJECTED" }
                );
            }
            Ok(None) => {
                log!("OutLayer execution failed for proposal {}", proposal_id);
                env::panic_str("Failed to tally votes");
            }
            Err(e) => {
                log!("Promise error for proposal {}: {:?}", proposal_id, e);
                env::panic_str(&format!("Promise error: {:?}", e));
            }
        }
    }

    /// Assert caller is owner
    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "Only owner can call this method"
        );
    }

    // ========== View methods ==========

    /// Get DAO info
    pub fn get_dao_info(&self) -> DAOInfo {
        DAOInfo {
            name: self.name.clone(),
            owner: self.owner.clone(),
            membership_mode: self.membership_mode.clone(),
            member_count: self.member_count,
        }
    }

    /// Check if account is a member
    pub fn is_member(&self, account_id: AccountId) -> bool {
        self.members.get(&account_id).unwrap_or(false)
    }

    /// Get user's public key
    pub fn get_user_pubkey(&self, account_id: AccountId) -> Option<String> {
        self.user_pubkeys.get(&account_id)
    }

    /// Get proposal
    pub fn get_proposal(&self, proposal_id: u64) -> Option<Proposal> {
        self.proposals.get(&proposal_id)
    }

    /// Get all proposals
    pub fn get_proposals(&self, from_index: u64, limit: u64) -> Vec<Proposal> {
        self.proposals
            .values()
            .skip(from_index as usize)
            .take(limit as usize)
            .collect()
    }

    /// Get votes for a proposal (encrypted)
    pub fn get_votes(&self, proposal_id: u64) -> Vec<Vote> {
        self.votes
            .get(&proposal_id)
            .map(|v| v.iter().collect())
            .unwrap_or_default()
    }

    /// Get vote count for a proposal
    pub fn get_vote_count(&self, proposal_id: u64) -> u64 {
        self.votes
            .get(&proposal_id)
            .map(|v| v.len())
            .unwrap_or(0)
    }
}
