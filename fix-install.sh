#!/bin/bash
set -e

echo "==================================="
echo "Exit Gate Installation Fix"
echo "==================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run as root"
    echo "Usage: sudo ./fix-install.sh"
    exit 1
fi

echo "Creating missing directories..."
mkdir -p /var/lib/exit-gate
mkdir -p /var/run/exit-gate
mkdir -p /etc/exit-gate
chmod 755 /var/lib/exit-gate /var/run/exit-gate /etc/exit-gate

echo "Creating default configuration..."
cat > /etc/exit-gate/config.toml <<'EOF'
[daemon]
socket_path = "/var/run/exit-gate/exit-gate.sock"
log_level = "info"
enable_ebpf = false

[database]
path = "/var/lib/exit-gate/exit-gate.db"

[ui]
prompt_timeout = 60
default_action = "deny"
EOF

chmod 644 /etc/exit-gate/config.toml

echo ""
echo "==================================="
echo "Fix Complete!"
echo "==================================="
echo ""
echo "Created:"
echo "  - /var/lib/exit-gate/         (database directory)"
echo "  - /var/run/exit-gate/         (socket directory)"
echo "  - /etc/exit-gate/config.toml  (configuration)"
echo ""
echo "Now restart the daemon:"
echo "  sudo systemctl restart exit-gate"
echo "  sudo systemctl status exit-gate"
echo ""
