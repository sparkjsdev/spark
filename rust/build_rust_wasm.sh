#!/usr/bin/env bash

WASM_TARGET="$(rustc --print sysroot 2>/dev/null)/lib/rustlib/wasm32-unknown-unknown"
# Check if "rustup" tool is installed, or the wasm32-unknown-unknown target aleady exists,
# in which case it's very likely that the required toolchain exists
if ! [ -d "$WASM_TARGET" ] && (! command -v rustup &> /dev/null); then
    echo "Rust tool 'rustup' not found! Please install Rust to build."
    echo "Visit Rust installation page: https://www.rust-lang.org/tools/install"
    echo "- Likely install one-liner: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo "If you're using rust without rustup, make sure that the target 'wasm32-unknown-unknown' is installed"
    exit 1
fi

cd "$(dirname "$0")"

if ! [ -d "$WASM_TARGET" ]; then
    # Make sure Rust wasm target is installed
    rustup target add wasm32-unknown-unknown
fi

# Make sure wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    cargo install wasm-pack
fi

cd spark-internal-rs

# Build the project
wasm-pack build --target web
