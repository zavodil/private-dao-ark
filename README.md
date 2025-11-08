# Private DAO Voting with NEAR OutLayer

**Anonymous, verifiable voting for NEAR DAOs using zero-knowledge proofs and trusted execution environments.**

This example demonstrates how to build a cryptographically secure anonymous voting system that showcases NEAR OutLayer's capability to execute heavy cryptographic operations off-chain while maintaining on-chain verifiability.

---

## 🎯 What This Demonstrates

### OutLayer Capabilities

1. **Heavy Cryptographic Operations**
   - Key derivation (HKDF-SHA256)
   - ECIES encryption/decryption
   - Vote tallying with privacy guarantees

2. **TEE Integration**
   - Master secret accessed only in trusted environment
   - Private keys derived on-demand (never stored)
   - Individual votes never leave TEE

3. **Secrets Management**
   - Master secret stored in Keymaster (encrypted)
   - Automatic injection into WASI environment
   - Single secret enables unlimited user keys

### Cryptographic Security

- **Vote Privacy:** ECIES encryption with per-user keys
- **No Double Voting:** Last vote counts (MVP) / Nullifier uniqueness (Phase 2)
- **Verifiable Results:** TEE attestation (MVP) / ZK proofs (Phase 2)
- **Dummy Messages:** Users can inject noise for plausible deniability

---

## 📋 Architecture Overview

```
Client (Browser)           NEAR Blockchain          OutLayer Worker (TEE)
     │                            │                          │
     │  1. Encrypt vote          │                          │
     │  ─────────────────────────>│                          │
     │     with user_pubkey      │                          │
     │                            │                          │
     │                            │  2. Request tallying    │
     │                            │  ─────────────────────> │
     │                            │     (after deadline)    │
     │                            │                          │
     │                            │  3. Decrypt all votes   │
     │                            │  <─────────────────────  │
     │                            │     master_secret        │
     │                            │     (from Keymaster)     │
     │                            │                          │
     │                            │  4. Count yes/no        │
     │                            │     filter dummy        │
     │                            │                          │
     │                            │  5. Return result       │
     │                            │  <─────────────────────  │
     │                            │     {passed, count}      │
     │  6. Query result          │                          │
     │  <─────────────────────────│                          │
     │     via contract view      │                          │
```

---

## 🔐 Cryptographic Primitives

### Key Derivation (HKDF-SHA256)

Each user gets a unique encryption keypair derived deterministically:

```
user_privkey = HKDF-SHA256(
    ikm: master_secret,
    info: "user:" || dao_account || ":" || user_account
)

user_pubkey = secp256k1_derive_pubkey(user_privkey)
```

**Properties:**
- ✅ Deterministic: Same inputs → same key
- ✅ Isolated: Different users get different keys
- ✅ One-way: Cannot reverse pubkey → privkey
- ✅ Efficient: O(1) to derive any key on-demand

### ECIES Encryption

Votes are encrypted using ECIES (Elliptic Curve Integrated Encryption Scheme):

```
Encryption (client-side):
1. Generate ephemeral keypair (eph_priv, eph_pub)
2. Shared secret = ECDH(eph_priv, user_pubkey)
3. Derive (aes_key, mac_key) = HKDF(shared_secret, nonce)
4. Ciphertext = AES-256-GCM(vote, aes_key)
5. Tag = HMAC-SHA256(ciphertext, mac_key)
6. Output: eph_pub || tag || ciphertext

Decryption (TEE worker):
1. Derive user_privkey from master_secret
2. Shared secret = ECDH(user_privkey, eph_pub)
3. Derive (aes_key, mac_key) = HKDF(shared_secret, nonce)
4. Verify tag == HMAC-SHA256(ciphertext, mac_key)
5. Plaintext = AES-256-GCM-decrypt(ciphertext, aes_key)
```

**Properties:**
- ✅ IND-CCA2 secure (semantic security + authentication)
- ✅ Forward secrecy (ephemeral keys)
- ✅ Authenticated encryption (cannot tamper)
- ✅ Random nonce prevents ciphertext correlation

---

## 🚀 Quick Start

### Prerequisites

```bash
# Install Rust toolchain
rustup target add wasm32-wasip1

# Install NEAR CLI
cargo install near-cli-rs

# Install cargo-near (for contract builds if needed)
cargo install cargo-near
```

### Build WASI Module

```bash
cd wasi-examples/private-dao-ark

# Build for WASI Preview 1 (smaller binary, ~200KB)
cargo build --target wasm32-wasip1 --release

# Output: target/wasm32-wasip1/release/private-dao-ark.wasm
```

### Test Locally

```bash
# Test key derivation
echo '{
  "action": "derive_pubkey",
  "dao_account": "dao.testnet",
  "user_account": "alice.testnet"
}' | wasmtime target/wasm32-wasip1/release/private-dao-ark.wasm \
  --env DAO_MASTER_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Expected output:
# {"success":true,"result":{"pubkey":"02abc..."},"error":null}
```

---

## 📖 Usage Examples

### 1. Setup: Store Master Secret in OutLayer

**CRITICAL:** The secret MUST be named `DAO_MASTER_SECRET` (uppercase).

```bash
# 1. Generate 32-byte hex secret
python3 -c "import secrets; print(secrets.token_hex(32))"
# Example output: a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456

# 2. Store in OutLayer contract via dashboard:
# Open http://localhost:3000/secrets
# Connect wallet: privatedao.testnet
# Create secret:
#   - Repo: github.com/zavodil/private-dao-ark
#   - Branch: main
#   - Profile: production
#   - JSON: {"DAO_MASTER_SECRET":"your_hex_from_step1"}
#   - Access: AllowAll

# Or via CLI:
near call outlayer.testnet store_secrets \
  '{
    "repo": "github.com/zavodil/private-dao-ark",
    "branch": "main",
    "profile": "production",
    "encrypted_data": [/* encrypted array */],
    "access_condition": {"AllowAll": {}}
  }' \
  --accountId privatedao.testnet \
  --deposit 0.01
```

**Note:** The WASI module reads `std::env::var("DAO_MASTER_SECRET")` - exact name required!

### 2. Derive User Public Key

When a user joins the DAO, OutLayer derives their encryption public key:

**Input:**
```json
{
  "action": "derive_pubkey",
  "dao_account": "dao.testnet",
  "user_account": "alice.testnet"
}
```

**OutLayer Execution:**
```bash
near call outlayer.testnet request_execution '{
  "code_source": {
    "repo": "https://github.com/zavodil/private-dao-ark",
    "commit": "main",
    "build_target": "wasm32-wasip1"
  },
  "input_data": "{\"action\":\"derive_pubkey\",\"dao_account\":\"privatedao.testnet\",\"user_account\":\"alice.testnet\"}",
  "secrets_ref": {
    "profile": "production",
    "account_id": "privatedao.testnet"
  },
  "resource_limits": {
    "max_instructions": 1000000000,
    "max_memory_mb": 64,
    "max_execution_seconds": 10
  }
}' --accountId dao.testnet --deposit 0.01
```

**Output:**
```json
{
  "success": true,
  "result": {
    "pubkey": "02f1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890"
  },
  "error": null
}
```

The DAO contract stores this pubkey for Alice:
```rust
self.user_pubkeys.insert("alice.testnet", pubkey);
```

### 3. Client-Side: Encrypt Vote

User encrypts their vote using their public key (client-side JavaScript):

```javascript
import { encrypt } from 'eciesjs';

// Get user's pubkey from contract
const pubkey = await daoContract.get_user_pubkey({ user: "alice.testnet" });

// Vote ("yes", "no", or dummy)
const vote = "yes";

// Generate random nonce (16 bytes)
const nonce = crypto.getRandomValues(new Uint8Array(16));

// Encrypt using ECIES
const encrypted = encrypt(
  Buffer.from(pubkey, 'hex'),
  Buffer.from(vote)
);

// Submit to contract
await daoContract.cast_vote({
  proposal_id: 1,
  encrypted_vote: encrypted.toString('hex'),
  nonce: Buffer.from(nonce).toString('hex')
}, {
  attachedDeposit: "2000000000000000000000" // 0.002 NEAR for storage
});
```

### 4. Tally Votes

After voting deadline, anyone can trigger finalization:

**Input:**
```json
{
  "action": "tally_votes",
  "dao_account": "dao.testnet",
  "proposal_id": 1,
  "votes": [
    {
      "user": "alice.testnet",
      "encrypted_vote": "02abc...def",
      "nonce": "0123456789abcdef0123456789abcdef",
      "timestamp": 1699300000000000000
    },
    {
      "user": "bob.testnet",
      "encrypted_vote": "02fed...cba",
      "nonce": "fedcba9876543210fedcba9876543210",
      "timestamp": 1699300100000000000
    }
  ]
}
```

**OutLayer Execution:**
```bash
near call dao.testnet finalize '{
  "proposal_id": 1
}' --accountId anyone.testnet --deposit 0.01
```

**Output:**
```json
{
  "success": true,
  "result": {
    "proposal_id": 1,
    "yes_count": 7,
    "no_count": 3,
    "total_votes": 10,
    "tee_attestation": "mvp-attestation:a1b2c3d4...",
    "votes_merkle_root": "e5f6g7h8..."
  },
  "error": null
}
```

The contract verifies TEE attestation and publishes result:
```rust
{
  "passed": true,        // yes > no
  "vote_count": 10,      // total participation
  // yes_count/no_count NOT published (privacy)
}
```

---

## 🔍 Privacy Features

### Dummy Messages

Users can send multiple messages to hide their voting pattern:

```javascript
// Real vote
await castVote(proposal_id, "yes");

// Dummy messages (noise)
await castVote(proposal_id, "DUMMY_1");
await castVote(proposal_id, "");
await castVote(proposal_id, "random_text");

// Result: 4 transactions visible, only "yes" counted
```

**Benefits:**
- Observer can't tell which message is real vote
- Adds plausible deniability
- User controls privacy/cost trade-off

**Cost:** Each message costs ~0.002 NEAR for storage

### Vote Revoting

Users can change their vote before deadline:

```javascript
// Initial vote
await castVote(proposal_id, "yes");  // timestamp: 1000

// Change mind (later)
await castVote(proposal_id, "no");   // timestamp: 2000

// Result: Last vote ("no") is counted
```

Worker tracks timestamps and only counts the most recent real vote.

---

## 🧪 Testing

### Prerequisites

1. Build the WASM module:
```bash
./build.sh
```

2. Ensure wasi-test-runner is built:
```bash
cd ../wasi-test-runner
cargo build --release
cd ../private-dao-ark
```

### Unit Tests

Run Rust unit tests (tests key derivation and encryption):

```bash
cargo test
```

**All tests passing** (6 tests total):
- ✅ `test_derive_key_deterministic` - Same inputs produce same keys
- ✅ `test_derive_key_different_users` - Different users get different keys
- ✅ `test_encrypt_decrypt` - Round-trip encryption works
- ✅ `test_decrypt_wrong_user_fails` - Wrong user can't decrypt
- ✅ `test_votes_hash_deterministic` - Vote hashing is deterministic
- ✅ `test_votes_hash_order_independent` - Hash is independent of vote order

### Integration Tests

#### Test 1: Key Derivation

Test that different users get unique public keys:

```bash
./test_example.sh
```

**Expected Output**:
```
✅ alice.testnet pubkey: 43e149769ce717d290bc4c1fd41593c0f8312d8b50d75c285615f8bff38b4a5a
✅ bob.testnet pubkey:   1eda8be37b600856aee6281c0f46d5e44141193787955588501365857374a36b
```

#### Test 2: Full Voting Cycle

End-to-end test with encryption, tallying, and dummy messages:

```bash
./test_full_cycle.sh
```

**Expected Output**:
```
📊 Results:
   YES votes: 2
   NO votes:  1
   Total:     3

✅ All tests passed!
   - 3 real votes counted (alice, bob, carol)
   - 1 dummy message ignored (dave)
```

### Helper Tools

#### encrypt_test_vote.py

Generate properly encrypted votes for testing:

```bash
# Install dependencies (if needed)
pip3 install cryptography

# Generate encrypted vote
python3 encrypt_test_vote.py \
  0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  dao.testnet \
  alice.testnet \
  yes

# Output (JSON):
{
  "user": "alice.testnet",
  "encrypted_vote": "f19e9464f5c68ab4a01b2d3788973df1325f26",
  "nonce": "653735f7fd736c3b28cd828f",
  "timestamp": 1700000000
}
```

### Test Results

See [TEST_RESULTS.md](./TEST_RESULTS.md) for detailed test report including:
- Build information
- Performance metrics (fuel consumption)
- Privacy guarantees verification
- Security model analysis

### Manual Testing with wasi-test

Test individual functions directly:

```bash
# Derive public key
../wasi-test-runner/target/release/wasi-test \
  --wasm target/wasm32-wasip1/release/private-dao-ark.wasm \
  --input '{"action":"derive_pubkey","dao_account":"dao.testnet","user_account":"alice.testnet"}' \
  --env DAO_MASTER_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Tally votes (with encrypted vote data)
../wasi-test-runner/target/release/wasi-test \
  --wasm target/wasm32-wasip1/release/private-dao-ark.wasm \
  --input '{"action":"tally_votes","dao_account":"dao.testnet","proposal_id":1,"votes":[...]}' \
  --env DAO_MASTER_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### Production Integration

For production deployment with OutLayer:
```bash
./tests/e2e_test.sh
```

---

## 📊 Performance

**Key Derivation:**
- Time: ~1ms per user
- Memory: ~1KB
- Gas: ~1 TGas

**Vote Encryption (client):**
- Time: ~10ms
- Library: eciesjs (browser) or ecies crate (Rust)

**Vote Decryption:**
- Time: ~2ms per vote
- 100 votes: ~200ms

**Tallying:**
- Time: O(N) where N = number of votes
- 100 votes: ~500ms total (decrypt + count)
- Memory: O(N) for tracking last votes

**Storage Costs:**
- Pubkey: 33 bytes = 0.0003 NEAR
- Encrypted vote: ~200 bytes = 0.002 NEAR
- Total for 100 members, 50 votes: ~0.13 NEAR

---

## 🔮 Future Enhancements (Phase 2)

### Zero-Knowledge Proofs

**Membership Proof (Client-side):**
```
Circuit: Semaphore
Proves: "I'm a DAO member" without revealing identity
Output: ZK proof + nullifier (prevents double voting)
Size: ~200 bytes
Verification: ~5ms on-chain
```

**Tallying Proof (OutLayer):**
```
Circuit: Custom
Proves: "I decrypted correctly and counted fairly"
Public: votes_merkle_root, result_commitment
Private: master_secret, decrypted_votes
Size: ~200 bytes
Verification: ~10ms on-chain
```

### Advanced Features

- **Weighted Voting:** Token-based voting power
- **Quadratic Voting:** QV mechanism for public goods
- **Delegation:** Vote by proxy
- **Encrypted Proposals:** Vote without knowing proposal details

---

## 📚 References

**Cryptography:**
- [ECIES Standard (SEC 1)](https://www.secg.org/sec1-v2.pdf)
- [HKDF (RFC 5869)](https://tools.ietf.org/html/rfc5869)
- [secp256k1 Curve](https://en.bitcoin.it/wiki/Secp256k1)

**Zero-Knowledge:**
- [Semaphore Protocol](https://semaphore.pse.dev)
- [Groth16 Paper](https://eprint.iacr.org/2016/260)

**OutLayer:**
- [Platform Documentation](../../README.md)
- [WASI Tutorial](../WASI_TUTORIAL.md)

---

## 🤝 Contributing

This is an example project showcasing OutLayer capabilities. Contributions welcome:

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Submit pull request

**Areas for improvement:**
- Client-side encryption library (JavaScript)
- DAO contract implementation (NEAR Rust)
- ZK circuits (circom)
- Frontend UI (React/Next.js)

---

## 📄 License

MIT License - see [LICENSE](../../LICENSE) for details

---

## 🙏 Acknowledgments

- **Semaphore Protocol** - ZK membership proof inspiration
- **NEAR Protocol** - Blockchain platform
- **Privacy & Scaling Explorations** - ZK research

---

**Built with ❤️ for NEAR OutLayer**

This example demonstrates the power of combining:
- Trusted Execution Environments (TEE)
- Zero-Knowledge Proofs (ZK)
- Off-chain Computation (OutLayer)

...to build privacy-preserving decentralized applications at scale.
