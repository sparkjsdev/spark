#!/bin/bash

# Check if "rustup" tool is installed
if ! command -v rustup &> /dev/null; then
    echo "Rust tool 'rustup' not found! Please install Rust to build."
    echo "Visit Rust installation page: https://www.rust-lang.org/tools/install"
    echo "- Likely install one-liner: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

cd $(dirname "$0")

# Make sure Rust wasm target is installed
rustup target add wasm32-unknown-unknown

# Make sure wasm-pack is installed
cargo install wasm-pack

cd spark-internal-rs

# Build the project
wasm-pack build --target web
