#!/bin/bash
set -e

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "⚠ WARNING: Running build as root is not recommended!"
    echo "⚠ Please run this script as a regular user."
    echo "⚠ Only installation requires sudo (./install.sh)"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "==================================="
echo "Exit Gate Build Script"
echo "==================================="
echo ""

# Build eBPF programs
echo "[1/3] Building eBPF programs..."
cd ebpf
make clean
make
cd ..
echo "✓ eBPF programs built successfully"
echo ""

# Build Rust daemon
echo "[2/3] Building daemon..."
cd daemon
# Clean any stale build artifacts
if [ -f Cargo.lock ]; then
    rm -f Cargo.lock
fi
cargo build --release
cd ..
echo "✓ Daemon built successfully"
echo ""

# Build Electron app
echo "[3/3] Building Electron application..."
cd electron
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi
npm run build
cd ..
echo "✓ Electron app built successfully"
echo ""

echo "==================================="
echo "Build Complete!"
echo "==================================="
echo ""
echo "Build artifacts:"
echo "  - eBPF programs: ebpf/*.o"
echo "  - Daemon: daemon/target/release/exit-gate-daemon"
echo "  - Electron app: electron/dist/"
echo ""
echo "Next steps:"
echo "  1. Package Electron app: ./package.sh"
echo "  2. Install daemon:       sudo ./install.sh"
echo ""
