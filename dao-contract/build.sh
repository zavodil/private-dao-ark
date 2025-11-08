#!/bin/bash
set -e

echo "Building Private DAO contract..."

# Build NEAR smart contract (on-chain)
# ✅ CORRECT: cargo near build
# ❌ WRONG: cargo build --target wasm32-unknown-unknown (DO NOT USE!)
# This is a NEAR CONTRACT, not a WASI module!
cargo near build non-reproducible-wasm

# Create res directory if it doesn't exist
mkdir -p res

# Copy WASM binary
cp target/wasm32-unknown-unknown/release/private_dao_contract.wasm res/

# Get file size
SIZE=$(ls -lh res/private_dao_contract.wasm | awk '{print $5}')

echo "✅ Build complete!"
echo "📦 WASM: res/private_dao_contract.wasm"
echo "📏 Size: $SIZE"
