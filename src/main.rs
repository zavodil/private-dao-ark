// Private DAO Voting - OutLayer WASI Module
//
// This module demonstrates anonymous voting using NEAR OutLayer platform.
// It handles cryptographic operations (key derivation, encryption/decryption)
// and vote tallying in a TEE (Trusted Execution Environment).
//
// Key Features:
// - Per-user encryption keys (derived from master secret)
// - ECIES encryption for vote privacy
// - Dummy message support (noise injection)
// - TEE-based tallying (OutLayer worker)
//
// IMPORTANT: This is a WASI binary (not library). It reads input from stdin
// and writes output to stdout as JSON, following OutLayer's execution model.

use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

mod crypto;
mod tally;

// Input structure for WASI execution
// OutLayer passes this via stdin as JSON
#[derive(Deserialize, Debug)]
struct Input {
    /// Action to perform: "derive_pubkey" or "tally_votes"
    action: String,

    /// DAO account ID (e.g., "dao.near")
    dao_account: String,

    /// User account ID (for derive_pubkey)
    user_account: Option<String>,

    /// Proposal ID (for tally_votes)
    proposal_id: Option<u64>,

    /// Encrypted votes data (for tally_votes)
    votes: Option<Vec<VoteData>>,

    /// Quorum requirements (for tally_votes)
    quorum: Option<serde_json::Value>,

    /// Total members at proposal creation (for tally_votes)
    total_members_at_creation: Option<u64>,
}

// Single encrypted vote from contract storage
#[derive(Deserialize, Debug)]
struct VoteData {
    /// Voter's NEAR account ID
    user: String,

    /// ECIES encrypted vote (hex-encoded)
    /// ECIES includes ephemeral key + nonce inside ciphertext
    encrypted_vote: String,

    /// Block timestamp when vote was cast
    timestamp: u64,
}

// Output structure returned via stdout
// Contract receives this after OutLayer execution
#[derive(Serialize)]
struct Output {
    /// Success/error indicator
    success: bool,

    /// Result data (varies by action)
    result: serde_json::Value,

    /// Error message (if success=false)
    error: Option<String>,
}

fn main() {
    // Read input from stdin (OutLayer provides this)
    let mut input_str = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input_str) {
        output_error(&format!("Failed to read input: {}", e));
        return;
    }

    // Parse JSON input
    let input: Input = match serde_json::from_str(&input_str) {
        Ok(i) => i,
        Err(e) => {
            output_error(&format!("Invalid JSON input: {}", e));
            return;
        }
    };

    // Get master_secret from environment (injected by OutLayer from Keymaster)
    // This secret never leaves TEE and is used to derive all user keys
    let master_secret = match std::env::var("DAO_MASTER_SECRET") {
        Ok(s) => match hex::decode(&s) {
            Ok(bytes) => bytes,
            Err(e) => {
                output_error(&format!("Invalid DAO_MASTER_SECRET hex: {}", e));
                return;
            }
        },
        Err(_) => {
            output_error("Missing DAO_MASTER_SECRET environment variable");
            return;
        }
    };

    // Dispatch based on action
    let result = match input.action.as_str() {
        "derive_pubkey" => handle_derive_pubkey(&master_secret, &input),
        "tally_votes" => handle_tally_votes(&master_secret, &input),
        _ => Err(format!("Unknown action: {}", input.action)),
    };

    // Output result
    match result {
        Ok(data) => output_success(data),
        Err(e) => output_error(&e),
    }
}

// Action: Derive user's public encryption key
// Called once per user when joining DAO
fn handle_derive_pubkey(
    master_secret: &[u8],
    input: &Input,
) -> Result<serde_json::Value, String> {
    let user_account = input
        .user_account
        .as_ref()
        .ok_or("Missing user_account")?;

    // Derive user's keypair from master secret
    // This is deterministic: same inputs always produce same key
    let pubkey = crypto::derive_user_pubkey(master_secret, &input.dao_account, user_account)?;

    // Return hex-encoded public key (33 bytes compressed)
    Ok(serde_json::json!({
        "pubkey": hex::encode(&pubkey)
    }))
}

// Action: Decrypt and tally all votes for a proposal
// Called after voting deadline to compute result
fn handle_tally_votes(
    master_secret: &[u8],
    input: &Input,
) -> Result<serde_json::Value, String> {
    let proposal_id = input.proposal_id.ok_or("Missing proposal_id")?;
    let votes_data = input.votes.as_ref().ok_or("Missing votes")?;
    let quorum = input.quorum.as_ref().ok_or("Missing quorum")?;
    let total_members = input.total_members_at_creation.ok_or("Missing total_members_at_creation")?;

    // Tally votes: decrypt all, filter real votes, count yes/no, check quorum
    let result = tally::tally_votes(
        master_secret,
        &input.dao_account,
        proposal_id,
        votes_data,
        quorum,
        total_members,
    )?;

    // Return result as JSON
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

// Output success result to stdout
fn output_success(result: serde_json::Value) {
    let output = Output {
        success: true,
        result,
        error: None,
    };

    print!("{}", serde_json::to_string(&output).unwrap());
    io::stdout().flush().unwrap();
}

// Output error to stdout (not stderr - OutLayer captures stdout)
fn output_error(message: &str) {
    let output = Output {
        success: false,
        result: serde_json::Value::Null,
        error: Some(message.to_string()),
    };

    print!("{}", serde_json::to_string(&output).unwrap());
    io::stdout().flush().unwrap();
}
