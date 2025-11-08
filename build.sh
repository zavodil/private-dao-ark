#!/bin/bash
set -e

echo "🔨 Building private-dao-ark WASI module..."

# Check if wasm32-wasip1 target is installed
if ! rustup target list | grep -q "wasm32-wasip1 (installed)"; then
    echo "📦 Installing wasm32-wasip1 target..."
    rustup target add wasm32-wasip1
fi

# Build for WASI Preview 1
# - Smaller binary size (~200KB)
# - Compatible with wasmtime
# - No HTTP support needed for this example
cargo build --target wasm32-wasip1 --release

# Output location
WASM_FILE="target/wasm32-wasip1/release/private-dao-ark.wasm"

if [ -f "$WASM_FILE" ]; then
    SIZE=$(ls -lh "$WASM_FILE" | awk '{print $5}')
    echo "✅ Build complete!"
    echo "📦 WASM: $WASM_FILE"
    echo "📏 Size: $SIZE"
else
    echo "❌ Build failed - WASM file not found"
    exit 1
fi
