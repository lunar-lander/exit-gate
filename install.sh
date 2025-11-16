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

# Check for pre-built artifacts
echo "Checking for build artifacts..."

if [ ! -f "ebpf/network_monitor.bpf.o" ]; then
    echo "Error: eBPF programs not built!"
    echo "Please run: ./build.sh"
    exit 1
fi

if [ ! -f "daemon/target/release/exit-gate-daemon" ]; then
    echo "Error: Daemon not built!"
    echo "Please run: ./build.sh"
    exit 1
fi

echo "✓ Build artifacts found"
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
echo "6. Run the Electron GUI:"
echo "   AppImage: ./electron/dist/Exit Gate-0.1.0.AppImage"
echo "   Or install .deb: sudo dpkg -i electron/dist/exit-gate_0.1.0_amd64.deb"
echo ""
echo "Note: If you haven't packaged the GUI yet, run: ./package.sh"
echo ""
echo "==================================="
