use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::AccountId;
use schemars::JsonSchema;

/// Membership mode for the DAO
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, JsonSchema, Clone, PartialEq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum MembershipMode {
    /// Anyone can join
    Public,
    /// Only invited members can join
    Private,
}

/// Quorum requirements for proposal passing
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, JsonSchema, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum QuorumType {
    /// Minimum absolute number of votes required
    Absolute { min_votes: u64 },
}

/// Proposal status
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, JsonSchema, Clone, PartialEq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ProposalStatus {
    Active,
    Passed,
    Rejected,
}

/// A proposal in the DAO
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, JsonSchema, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Proposal {
    pub id: u64,
    pub title: String,
    pub description: String,
    #[schemars(with = "String")]
    pub creator: AccountId,
    pub created_at: u64,
    /// Optional deadline (nanoseconds since epoch). If None, proposal has no time limit.
    pub deadline: Option<u64>,
    pub quorum: QuorumType,
    pub status: ProposalStatus,
    pub tally_result: Option<TallyResult>,
}

/// An encrypted vote
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, JsonSchema, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Vote {
    #[schemars(with = "String")]
    pub user: AccountId,
    pub encrypted_vote: String,
    pub timestamp: u64,
}

/// Merkle proof for vote verification
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, JsonSchema, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct MerkleProof {
    pub voter: String,
    pub vote_index: u64,
    pub vote_hash: String,
    pub proof_path: Vec<String>,
    pub timestamp: u64,
}

/// Tally result from OutLayer
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, JsonSchema, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct TallyResult {
    pub quorum_met: bool,
    /// Only present if quorum was met (privacy protection)
    pub yes_count: Option<u64>,
    /// Only present if quorum was met (privacy protection)
    pub no_count: Option<u64>,
    pub total_votes: u64,
    pub tee_attestation: String,
    pub votes_merkle_root: String,
    /// Merkle proofs for vote verification
    pub merkle_proofs: Vec<MerkleProof>,
}

/// Member information
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, JsonSchema, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct MemberInfo {
    /// Timestamp when member joined (nanoseconds)
    pub joined_at: u64,
}

/// DAO information
#[derive(Serialize, Deserialize, JsonSchema, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DAOInfo {
    pub name: String,
    #[schemars(with = "String")]
    pub owner: AccountId,
    pub membership_mode: MembershipMode,
    pub member_count: u64,
}

/// OutLayer execution response wrapper
#[derive(Serialize, Deserialize, JsonSchema, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct OutLayerResponse {
    pub success: bool,
    pub result: serde_json::Value,
    pub error: Option<String>,
}

/// Response from OutLayer key derivation (inside result field)
#[derive(Serialize, Deserialize, JsonSchema, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DeriveKeyResponse {
    pub pubkey: String,
}

/// Response from OutLayer vote tallying
#[derive(Serialize, Deserialize, JsonSchema, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct TallyResponse {
    pub proposal_id: u64,
    /// Only present if quorum met (privacy protection)
    pub yes_count: Option<u64>,
    /// Only present if quorum met (privacy protection)
    pub no_count: Option<u64>,
    pub total_votes: u64,
    pub tee_attestation: String,
    pub votes_merkle_root: String,
    /// Merkle proofs for vote verification
    pub merkle_proofs: Vec<MerkleProof>,
}
