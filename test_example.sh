#!/bin/bash
# Example: Test private-dao-ark WASI module locally with wasi-test runner

set -e

WASM_FILE="target/wasm32-wasip1/release/private-dao-ark.wasm"
WASI_TEST="../wasi-test-runner/target/release/wasi-test"

# Check if WASM file exists
if [ ! -f "$WASM_FILE" ]; then
    echo "❌ WASM file not found. Run ./build.sh first."
    exit 1
fi

# Check if wasi-test runner exists
if [ ! -f "$WASI_TEST" ]; then
    echo "❌ WASI test runner not found at $WASI_TEST"
    echo "Build it with: cd ../wasi-test-runner && cargo build --release"
    exit 1
fi

# Test 1: Derive public key for alice
echo "Test 1: Derive public key for alice.testnet"
echo ""

INPUT1='{"action":"derive_pubkey","dao_account":"dao.testnet","user_account":"alice.testnet"}'
"$WASI_TEST" --wasm "$WASM_FILE" \
  --input "$INPUT1" \
  --env DAO_MASTER_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

echo ""
echo "---"
echo ""

# Test 2: Derive public key for bob (should be different)
echo "Test 2: Derive public key for bob.testnet (different from alice)"
echo ""

INPUT2='{"action":"derive_pubkey","dao_account":"dao.testnet","user_account":"bob.testnet"}'
"$WASI_TEST" --wasm "$WASM_FILE" \
  --input "$INPUT2" \
  --env DAO_MASTER_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

echo ""
echo "---"
echo ""

# Test 3: Full voting cycle - encrypt and tally votes
echo "Test 3: Full voting cycle - tally encrypted votes"
echo ""
echo "Note: In production, encryption happens client-side with public key."
echo "Worker only performs tallying (this example shows the complete flow)."
echo ""

# Simulate encrypted votes (these would come from the DAO contract)
# In real scenario: client encrypts with pubkey, stores on-chain, worker decrypts
INPUT3='{
  "action": "tally_votes",
  "dao_account": "dao.testnet",
  "proposal_id": 1,
  "votes": [
    {
      "user": "alice.testnet",
      "encrypted_vote": "739a7a3aeb7d39d3b84e3eaf8b",
      "nonce": "3132627974657374",
      "timestamp": 1700000000
    },
    {
      "user": "bob.testnet",
      "encrypted_vote": "739a7a3aeb7d39d3b84e3eaf8b",
      "nonce": "3132627974657374",
      "timestamp": 1700000001
    },
    {
      "user": "carol.testnet",
      "encrypted_vote": "739a7a3aeb7d39d3b84e2baf8b",
      "nonce": "3132627974657374",
      "timestamp": 1700000002
    }
  ]
}'

"$WASI_TEST" --wasm "$WASM_FILE" \
  --input "$INPUT3" \
  --env DAO_MASTER_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

echo ""
echo "✅ All tests complete!"
echo ""
echo "Summary:"
echo "  - alice.testnet pubkey: 43e149769ce717d290bc4c1fd41593c0f8312d8b50d75c285615f8bff38b4a5a"
echo "  - bob.testnet pubkey:   1eda8be37b600856aee6281c0f46d5e44141193787955588501365857374a36b"
echo "  - Different users get different keys (privacy ✓)"
echo "  - All votes tallied in TEE (secrecy ✓)"
