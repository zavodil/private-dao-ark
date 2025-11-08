// Cryptographic operations for anonymous voting
//
// This module implements:
// 1. Deterministic key derivation (HKDF-SHA256)
// 2. ECIES encryption/decryption (secp256k1 + AES-256-GCM)
//
// PRODUCTION READY: Full ECIES implementation with pure Rust secp256k1
// Compatible with wasm32-wasip1 target (no C dependencies)

use hkdf::Hkdf;
use sha2::Sha256;

/// Generate secp256k1 keypair from seed
///
/// Uses deterministic key derivation from master secret.
/// Returns (private_key_bytes, public_key_bytes)
///
/// # Arguments
/// * `master_secret` - Master secret from keymaster
/// * `dao_account` - DAO account ID
/// * `user_account` - User account ID
///
/// # Returns
/// * `(Vec<u8>, Vec<u8>)` - (32-byte private key, 33-byte compressed public key)
pub fn derive_keypair(
    master_secret: &[u8],
    dao_account: &str,
    user_account: &str,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    // Derive deterministic seed using HKDF
    let info = format!("ecies:{}:{}", dao_account, user_account);
    let hkdf = Hkdf::<Sha256>::new(None, master_secret);

    let mut seed = [0u8; 32];
    hkdf.expand(info.as_bytes(), &mut seed)
        .map_err(|e| format!("HKDF failed: {}", e))?;

    // Create SecretKey from deterministic seed
    // The seed IS the private key (32 bytes)
    let secret_key = libsecp256k1::SecretKey::parse_slice(&seed)
        .map_err(|e| format!("Invalid secret key: {:?}", e))?;

    // Derive public key from private key
    let public_key = libsecp256k1::PublicKey::from_secret_key(&secret_key);

    // Return serialized keys
    // NOTE: Using compressed public keys (33 bytes: 0x02/0x03 + X coordinate)
    Ok((seed.to_vec(), public_key.serialize_compressed().to_vec()))
}

/// Derive user's public key (for client-side encryption)
///
/// Returns secp256k1 public key in compressed form (33 bytes)
/// Format: 0x02/0x03 + 32-byte X coordinate
///
/// # Arguments
/// * `master_secret` - Master secret
/// * `dao_account` - DAO account ID
/// * `user_account` - User account ID
///
/// # Returns
/// * Public key (33 bytes compressed)
pub fn derive_user_pubkey(
    master_secret: &[u8],
    dao_account: &str,
    user_account: &str,
) -> Result<Vec<u8>, String> {
    let (_privkey, pubkey) = derive_keypair(master_secret, dao_account, user_account)?;
    Ok(pubkey)
}

/// Encrypt vote using ECIES
///
/// This function is for testing/demonstration only.
/// In production, encryption happens on the CLIENT SIDE with public key.
/// The TEE (this code) only does DECRYPTION.
///
/// # Arguments
/// * `pubkey` - Recipient's public key (33 bytes compressed)
/// * `plaintext` - Vote data ("yes", "no", or dummy message)
///
/// # Returns
/// * Encrypted ciphertext (variable length)
#[cfg_attr(not(test), allow(dead_code))]
pub fn encrypt_vote(pubkey: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    ecies::encrypt(pubkey, plaintext)
        .map_err(|e| format!("ECIES encryption failed: {}", e))
}

/// Decrypt vote using ECIES
///
/// This is the MAIN function used by TEE worker to decrypt votes.
/// Takes encrypted vote from blockchain and decrypts with user's private key.
///
/// # Arguments
/// * `master_secret` - Master secret from keymaster
/// * `dao_account` - DAO account ID
/// * `user_account` - User account ID (voter)
/// * `ciphertext` - Encrypted vote from blockchain
///
/// # Returns
/// * Decrypted plaintext ("yes", "no", or dummy message)
pub fn decrypt_vote(
    master_secret: &[u8],
    dao_account: &str,
    user_account: &str,
    ciphertext: &[u8],
) -> Result<String, String> {
    // Derive user's private key
    let (privkey, _pubkey) = derive_keypair(master_secret, dao_account, user_account)?;

    // Decrypt using ECIES
    let plaintext_bytes = ecies::decrypt(&privkey, ciphertext)
        .map_err(|e| format!("ECIES decryption failed: {}", e))?;

    // Convert to UTF-8 string
    String::from_utf8(plaintext_bytes)
        .map_err(|e| format!("Invalid UTF-8: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keypair_derivation() {
        let master_secret = b"test_secret_32_bytes_long_xxxx!!";
        let dao = "dao.testnet";

        // Derive keys for alice
        let (priv1, pub1) = derive_keypair(master_secret, dao, "alice.testnet").unwrap();

        // Derive keys for bob
        let (priv2, pub2) = derive_keypair(master_secret, dao, "bob.testnet").unwrap();

        // Different users should have different keys
        assert_ne!(priv1, priv2);
        assert_ne!(pub1, pub2);

        // Keys should be correct length
        assert_eq!(priv1.len(), 32); // secp256k1 private key
        assert_eq!(pub1.len(), 33);  // compressed public key (0x02/0x03 + X)
    }

    #[test]
    fn test_deterministic_keys() {
        let master_secret = b"test_secret_32_bytes_long_xxxx!!";
        let dao = "dao.testnet";
        let user = "alice.testnet";

        // Derive keys twice
        let (priv1, pub1) = derive_keypair(master_secret, dao, user).unwrap();
        let (priv2, pub2) = derive_keypair(master_secret, dao, user).unwrap();

        // Should be identical (deterministic)
        assert_eq!(priv1, priv2);
        assert_eq!(pub1, pub2);
    }

    #[test]
    fn test_encrypt_decrypt() {
        let master_secret = b"test_secret_32_bytes_long_xxxx!!";
        let dao = "dao.testnet";
        let user = "alice.testnet";

        // Derive keypair
        let (_privkey, pubkey) = derive_keypair(master_secret, dao, user).unwrap();

        // Encrypt vote
        let plaintext = "yes";
        let ciphertext = encrypt_vote(&pubkey, plaintext.as_bytes()).unwrap();

        // Decrypt vote
        let decrypted = decrypt_vote(master_secret, dao, user, &ciphertext).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_wrong_user_fails() {
        let master_secret = b"test_secret_32_bytes_long_xxxx!!";
        let dao = "dao.testnet";

        // Alice encrypts
        let (_priv_alice, pub_alice) = derive_keypair(master_secret, dao, "alice.testnet").unwrap();
        let ciphertext = encrypt_vote(&pub_alice, b"yes").unwrap();

        // Bob tries to decrypt (should fail)
        let result = decrypt_vote(master_secret, dao, "bob.testnet", &ciphertext);

        assert!(result.is_err());
    }

    #[test]
    fn test_pubkey_derivation() {
        let master_secret = b"test_secret_32_bytes_long_xxxx!!";
        let dao = "dao.testnet";
        let user = "alice.testnet";

        let pubkey = derive_user_pubkey(master_secret, dao, user).unwrap();

        // Should be 33 bytes (compressed secp256k1 public key)
        assert_eq!(pubkey.len(), 33);

        // First byte should be 0x02 or 0x03 (compressed format marker)
        assert!(pubkey[0] == 0x02 || pubkey[0] == 0x03);
    }
}
