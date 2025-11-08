#!/usr/bin/env python3
"""
Helper script to encrypt votes for testing private-dao-ark.

This simulates client-side encryption that would happen in the browser.
In production, use the JavaScript encryption library with the user's public key.
"""

import hashlib
import json
import sys
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def derive_user_key(master_secret: bytes, dao_account: str, user_account: str) -> bytes:
    """
    Derive user's encryption key using HKDF-SHA256.
    This matches the Rust implementation in crypto.rs.
    """
    from hashlib import sha256
    import hmac

    # HKDF-Extract (with salt=None, use zeros)
    salt = b'\x00' * 32
    prk = hmac.new(salt, master_secret, sha256).digest()

    # HKDF-Expand
    info = f"user:{dao_account}:{user_account}".encode('utf-8')
    okm = b""
    previous = b""

    for i in range(1, 2):  # We need 32 bytes, so just 1 iteration
        previous = hmac.new(prk, previous + info + bytes([i]), sha256).digest()
        okm += previous

    return okm[:32]


def encrypt_vote(master_secret: bytes, dao_account: str, user_account: str, vote: str) -> tuple:
    """
    Encrypt a vote using AES-256-GCM.
    Returns (ciphertext_hex, nonce_hex).
    """
    # Derive user's key
    key = derive_user_key(master_secret, dao_account, user_account)

    # Generate random nonce (12 bytes for AES-GCM)
    nonce = os.urandom(12)

    # Create cipher and encrypt (AESGCM automatically handles tag)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, vote.encode('utf-8'), None)

    return ciphertext.hex(), nonce.hex()


def main():
    if len(sys.argv) != 5:
        print("Usage: encrypt_test_vote.py <master_secret_hex> <dao_account> <user_account> <vote>")
        print()
        print("Example:")
        print("  python3 encrypt_test_vote.py \\")
        print("    0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \\")
        print("    dao.testnet \\")
        print("    alice.testnet \\")
        print("    yes")
        sys.exit(1)

    master_secret_hex = sys.argv[1]
    dao_account = sys.argv[2]
    user_account = sys.argv[3]
    vote = sys.argv[4]

    # Validate vote
    if vote not in ["yes", "no"]:
        print(f"Warning: vote '{vote}' is not 'yes' or 'no' - it will be treated as dummy/noise")

    # Convert master secret from hex
    master_secret = bytes.fromhex(master_secret_hex)

    # Encrypt
    encrypted_hex, nonce_hex = encrypt_vote(master_secret, dao_account, user_account, vote)

    # Output JSON for easy copy-paste into test script
    result = {
        "user": user_account,
        "encrypted_vote": encrypted_hex,
        "nonce": nonce_hex,
        "timestamp": 1700000000  # Placeholder timestamp
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
