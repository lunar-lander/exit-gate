#!/bin/bash
set -e

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
echo "To install, run:"
echo "  sudo ./install.sh"
echo ""
