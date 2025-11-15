#!/bin/bash
set -e

echo "==================================="
echo "Exit Gate Installation Script"
echo "==================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

# Check for required dependencies
echo "Checking dependencies..."

command -v cargo >/dev/null 2>&1 || {
    echo "Error: Rust/Cargo is not installed. Please install Rust first:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
}

command -v node >/dev/null 2>&1 || {
    echo "Error: Node.js is not installed. Please install Node.js 18+ first."
    exit 1
}

command -v clang >/dev/null 2>&1 || {
    echo "Error: Clang is not installed. Please install it:"
    echo "  Ubuntu/Debian: apt install clang llvm libelf-dev libbpf-dev"
    echo "  Fedora: dnf install clang llvm elfutils-libelf-devel libbpf-devel"
    exit 1
}

echo "✓ All dependencies found"
echo ""

# Build eBPF programs
echo "Building eBPF programs..."
cd ebpf
make clean
make
cd ..
echo "✓ eBPF programs built"
echo ""

# Build Rust daemon
echo "Building daemon..."
cd daemon
cargo build --release
cd ..
echo "✓ Daemon built"
echo ""

# Build Electron app
echo "Building Electron application..."
cd electron
npm install
npm run build
npm run package:linux
cd ..
echo "✓ Electron app built"
echo ""

# Install files
echo "Installing files..."

# Create directories
mkdir -p /usr/local/bin
mkdir -p /usr/local/lib/exit-gate/bpf
mkdir -p /etc/exit-gate
mkdir -p /var/lib/exit-gate
mkdir -p /var/run/exit-gate

# Install daemon
cp daemon/target/release/exit-gate-daemon /usr/local/bin/
chmod 755 /usr/local/bin/exit-gate-daemon

# Install eBPF programs
cp ebpf/*.o /usr/local/lib/exit-gate/bpf/
chmod 644 /usr/local/lib/exit-gate/bpf/*.o

# Install configuration
if [ ! -f /etc/exit-gate/config.toml ]; then
    cp config/config.toml /etc/exit-gate/
    chmod 644 /etc/exit-gate/config.toml
    echo "✓ Configuration file installed"
else
    echo "⚠ Configuration file already exists, skipping"
fi

# Install systemd service
cp systemd/exit-gate.service /etc/systemd/system/
chmod 644 /etc/systemd/system/exit-gate.service
systemctl daemon-reload

echo "✓ Files installed"
echo ""

# Set permissions
chown -R root:root /usr/local/lib/exit-gate
chown -R root:root /etc/exit-gate
chown -R root:root /var/lib/exit-gate
chown -R root:root /var/run/exit-gate

echo "==================================="
echo "Installation Complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Review and edit the configuration:"
echo "   sudo nano /etc/exit-gate/config.toml"
echo ""
echo "2. Start the daemon:"
echo "   sudo systemctl start exit-gate"
echo ""
echo "3. Enable automatic startup:"
echo "   sudo systemctl enable exit-gate"
echo ""
echo "4. Check daemon status:"
echo "   sudo systemctl status exit-gate"
echo ""
echo "5. View logs:"
echo "   sudo journalctl -u exit-gate -f"
echo ""
echo "6. Install the Electron app from:"
echo "   electron/dist/Exit-Gate-*.AppImage"
echo ""
echo "==================================="
