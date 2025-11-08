// Vote tallying module
//
// This module handles the core voting logic:
// 1. Decrypt all encrypted votes
// 2. Filter real votes from dummy messages
// 3. Track last vote per user (allow re-voting)
// 4. Count yes/no votes
// 5. Generate result with TEE attestation
//
// Privacy guarantee:
// - Individual votes never leave TEE
// - Only aggregate result (yes/no counts) returned
// - Optionally: only return passed/failed (hide exact counts)

use crate::crypto;
use crate::VoteData;
use serde::Serialize;
use std::collections::HashMap;

/// Result of vote tallying
#[derive(Serialize, Debug)]
pub struct TallyResult {
    /// Proposal ID that was tallied
    pub proposal_id: u64,

    /// Number of "yes" votes
    pub yes_count: u32,

    /// Number of "no" votes
    pub no_count: u32,

    /// Total valid votes (yes + no)
    pub total_votes: u32,

    /// TEE attestation (proof of execution in trusted environment)
    /// In MVP: placeholder, Phase 2: real SGX/SEV attestation
    pub tee_attestation: String,

    /// Merkle root of all encrypted votes (for verification)
    pub votes_merkle_root: String,
}

/// Tally all votes for a proposal
///
/// This function is the core of the anonymous voting system. It:
/// 1. Decrypts each vote using the voter's derived private key
/// 2. Filters real votes ("yes"/"no") from dummy messages (noise)
/// 3. Handles multiple votes per user (last vote wins)
/// 4. Computes final tally
///
/// # Arguments
/// * `master_secret` - Master secret for deriving decryption keys
/// * `dao_account` - DAO contract account ID
/// * `proposal_id` - Proposal being tallied
/// * `votes_data` - All encrypted votes from contract storage
///
/// # Returns
/// * `Ok(TallyResult)` - Tallying result with counts and attestation
/// * `Err(String)` - Error message if tallying fails
///
/// # Privacy
/// - Decrypted votes exist only in memory (never logged)
/// - Only aggregate counts returned (individual votes hidden)
/// - TEE ensures no side-channel leakage
///
/// # Vote Filtering Rules
/// - "yes" → counted as yes vote
/// - "no" → counted as no vote
/// - Anything else → ignored as dummy/noise
/// - Empty string → ignored
/// - Random text → ignored
///
/// # Multiple Votes
/// If a user submits multiple messages:
/// - All messages are stored on-chain (with timestamps)
/// - Only the LAST real vote ("yes" or "no") is counted
/// - Dummy messages don't affect the tally
/// - This allows users to change their vote before deadline
///
/// # Example
/// ```
/// let votes = vec![
///     VoteData { user: "alice.near", encrypted_vote: "abcd...", nonce: "", timestamp: 1000 },
///     VoteData { user: "alice.near", encrypted_vote: "ef01...", nonce: "", timestamp: 2000 },
///     VoteData { user: "bob.near", encrypted_vote: "2345...", nonce: "", timestamp: 1500 },
/// ];
///
/// let result = tally_votes(&master_secret, "dao.near", 42, &votes)?;
/// assert_eq!(result.total_votes, 2); // Alice and Bob
/// ```
pub fn tally_votes(
    master_secret: &[u8],
    dao_account: &str,
    proposal_id: u64,
    votes_data: &[VoteData],
) -> Result<TallyResult, String> {
    // Map to track last vote per user
    // Key: user account ID
    // Value: (decrypted_vote, timestamp)
    let mut user_votes: HashMap<String, (String, u64)> = HashMap::new();

    // Decrypt all votes
    for vote_data in votes_data {
        // Decode hex-encoded ciphertext to bytes
        let ciphertext_bytes = match hex::decode(&vote_data.encrypted_vote) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!(
                    "Warning: Failed to decode hex for vote from {}: {}",
                    vote_data.user, e
                );
                continue;
            }
        };

        // Decrypt using ECIES (no nonce needed - included in ciphertext)
        let decrypted = match crypto::decrypt_vote(
            master_secret,
            dao_account,
            &vote_data.user,
            &ciphertext_bytes,
        ) {
            Ok(v) => v,
            Err(e) => {
                // Log error but continue (don't fail entire tallying for one bad vote)
                eprintln!(
                    "Warning: Failed to decrypt vote from {}: {}",
                    vote_data.user, e
                );
                continue;
            }
        };

        // Check if this is a real vote (not dummy)
        let is_real_vote = decrypted == "yes" || decrypted == "no";

        if is_real_vote {
            // Update user's vote (last one wins)
            // If user already has a vote, compare timestamps
            if let Some((_, existing_timestamp)) = user_votes.get(&vote_data.user) {
                // Only update if this vote is newer
                if vote_data.timestamp > *existing_timestamp {
                    user_votes.insert(vote_data.user.clone(), (decrypted, vote_data.timestamp));
                }
            } else {
                // First vote from this user
                user_votes.insert(vote_data.user.clone(), (decrypted, vote_data.timestamp));
            }
        } else {
            // This is a dummy message (noise)
            // Do not update user_votes - just skip
            // This allows users to send dummy messages without affecting their real vote
            continue;
        }
    }

    // Count yes and no votes
    let mut yes_count = 0u32;
    let mut no_count = 0u32;

    for (vote, _timestamp) in user_votes.values() {
        match vote.as_str() {
            "yes" => yes_count += 1,
            "no" => no_count += 1,
            _ => {
                // This shouldn't happen (filtered above), but be safe
                eprintln!("Warning: Unexpected vote value: {}", vote);
            }
        }
    }

    let total_votes = yes_count + no_count;

    // Compute merkle root of votes (for verification)
    // In production: actual Merkle tree
    // For MVP: simple hash of all vote data
    let votes_merkle_root = compute_votes_hash(votes_data);

    // Generate TEE attestation
    // In MVP: placeholder
    // In Phase 2: real SGX/SEV attestation proving:
    //   - Code hash matches expected binary
    //   - Execution happened in TEE
    //   - No tampering occurred
    let tee_attestation = generate_tee_attestation(
        proposal_id,
        &votes_merkle_root,
        yes_count,
        no_count,
    );

    Ok(TallyResult {
        proposal_id,
        yes_count,
        no_count,
        total_votes,
        tee_attestation,
        votes_merkle_root,
    })
}

/// Compute hash of all votes (for verification)
///
/// This creates a commitment to the input votes, allowing anyone to verify
/// that the tallying was done on the correct data.
///
/// # Implementation
/// - Sort votes by (user, timestamp) for deterministic ordering
/// - Hash each vote: SHA256(user || nonce || encrypted_vote)
/// - Compute root: SHA256(hash1 || hash2 || ... || hashN)
///
/// # Returns
/// - Hex-encoded SHA256 hash (64 characters)
fn compute_votes_hash(votes_data: &[VoteData]) -> String {
    use sha2::{Digest, Sha256};

    // Create deterministic ordering
    let mut sorted_votes: Vec<_> = votes_data.iter().collect();
    sorted_votes.sort_by_key(|v| (&v.user, v.timestamp));

    let mut hasher = Sha256::new();

    for vote in sorted_votes {
        // Hash each vote component
        hasher.update(vote.user.as_bytes());
        hasher.update(&vote.timestamp.to_le_bytes());
        hasher.update(vote.nonce.as_bytes());
        hasher.update(vote.encrypted_vote.as_bytes());
    }

    let result = hasher.finalize();
    hex::encode(result)
}

/// Generate TEE attestation (proof of trusted execution)
///
/// In MVP: Returns placeholder attestation
/// In Phase 2: Generates real SGX/SEV attestation
///
/// # Attestation Contents
/// - Proposal ID (which vote was tallied)
/// - Votes merkle root (what data was used)
/// - Result commitment: hash(yes_count, no_count)
/// - Code hash (which binary executed)
/// - Timestamp (when execution occurred)
/// - TEE hardware signature (proves execution in enclave)
///
/// # Security
/// - Attestation is cryptographically signed by TEE hardware
/// - Cannot be forged without compromising TEE
/// - Contract can verify signature on-chain
fn generate_tee_attestation(
    proposal_id: u64,
    votes_merkle_root: &str,
    yes_count: u32,
    no_count: u32,
) -> String {
    use sha2::{Digest, Sha256};

    // In MVP: Create a simple hash as placeholder
    // Format: "mvp-attestation:" || hash(proposal_id || votes_root || counts)
    let mut hasher = Sha256::new();
    hasher.update(&proposal_id.to_le_bytes());
    hasher.update(votes_merkle_root.as_bytes());
    hasher.update(&yes_count.to_le_bytes());
    hasher.update(&no_count.to_le_bytes());

    let hash = hasher.finalize();

    // In Phase 2: Replace with real TEE attestation
    // Example SGX format:
    // {
    //   "quote": "base64_encoded_sgx_quote",
    //   "report_data": "sha256(proposal_id || merkle_root || result)",
    //   "timestamp": unix_timestamp,
    //   "measurement": "mrenclave_hash"
    // }

    format!("mvp-attestation:{}", hex::encode(hash))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_vote(user: &str, encrypted: &str, nonce: &str, ts: u64) -> VoteData {
        VoteData {
            user: user.to_string(),
            encrypted_vote: encrypted.to_string(),
            nonce: nonce.to_string(),
            timestamp: ts,
        }
    }

    #[test]
    fn test_votes_hash_deterministic() {
        let votes = vec![
            create_test_vote("alice", "abc", "123", 1000),
            create_test_vote("bob", "def", "456", 2000),
        ];

        let hash1 = compute_votes_hash(&votes);
        let hash2 = compute_votes_hash(&votes);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_votes_hash_order_independent() {
        let votes1 = vec![
            create_test_vote("alice", "abc", "123", 1000),
            create_test_vote("bob", "def", "456", 2000),
        ];

        let votes2 = vec![
            create_test_vote("bob", "def", "456", 2000),
            create_test_vote("alice", "abc", "123", 1000),
        ];

        let hash1 = compute_votes_hash(&votes1);
        let hash2 = compute_votes_hash(&votes2);

        // Should be equal because sorted internally
        assert_eq!(hash1, hash2);
    }
}
