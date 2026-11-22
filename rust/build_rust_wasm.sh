#!/usr/bin/env bash
set -euo pipefail

if ! command -v rustc >/dev/null 2>&1; then
    echo "Rust compiler 'rustc' not found in PATH. Please install Rust to build."
    exit 1
fi

if ! RUST_SYSROOT="$(rustc --print sysroot 2>/dev/null)" || [[ -z "$RUST_SYSROOT" ]]; then
    echo "Unable to determine the Rust sysroot. Check your Rust toolchain installation."
    exit 1
fi

WASM_TARGET="$RUST_SYSROOT/lib/rustlib/wasm32-unknown-unknown"

# Check if rustup is installed, or the wasm32-unknown-unknown target already exists.
if [[ ! -d "$WASM_TARGET" ]] && ! command -v rustup >/dev/null 2>&1; then
    echo "Rust tool 'rustup' not found! Please install Rust to build."
    echo "Visit Rust installation page: https://www.rust-lang.org/tools/install"
    echo "- Likely install one-liner: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo "If you're using Rust without rustup, make sure that the target 'wasm32-unknown-unknown' is installed"
    exit 1
fi

cd "$(dirname "$0")"

if [[ ! -d "$WASM_TARGET" ]]; then
    # Make sure the Rust wasm target is installed.
    rustup target add wasm32-unknown-unknown
fi

# Make sure wasm-pack is installed.
if ! command -v wasm-pack >/dev/null 2>&1; then
    cargo install wasm-pack
fi

cd spark-rs

# Build the project with SIMD enabled.
RUSTFLAGS="-C target-feature=+simd128,+bulk-memory" wasm-pack build --target web --release
