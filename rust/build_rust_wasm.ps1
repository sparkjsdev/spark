# Exit on any error
$ErrorActionPreference = "Stop"

# Resolve the script's directory and change to it
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Check if rustup is installed
if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
    Write-Host "Rust tool 'rustup' not found! Please install Rust to build."
    Write-Host "Visit: https://www.rust-lang.org/tools/install"
    exit 1
}

# Ensure wasm32-unknown-unknown target is installed
rustup target add wasm32-unknown-unknown

# Check if wasm-pack is installed, and install if not
if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
    cargo install wasm-pack
}

# Change directory and build using wasm-pack
Set-Location -Path "./spark-internal-rs"
wasm-pack build --target web
