#!/bin/bash
set -e

echo "==================================="
echo "Exit Gate Uninstallation Script"
echo "==================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

# Stop and disable service
if systemctl is-active --quiet exit-gate; then
    echo "Stopping Exit Gate daemon..."
    systemctl stop exit-gate
fi

if systemctl is-enabled --quiet exit-gate; then
    echo "Disabling Exit Gate service..."
    systemctl disable exit-gate
fi

# Remove files
echo "Removing installed files..."

rm -f /usr/local/bin/exit-gate-daemon
rm -rf /usr/local/lib/exit-gate
rm -f /etc/systemd/system/exit-gate.service
rm -f /var/run/exit-gate/exit-gate.sock
rmdir /var/run/exit-gate 2>/dev/null || true

systemctl daemon-reload

echo ""
echo "The following directories were preserved:"
echo "  /etc/exit-gate (configuration)"
echo "  /var/lib/exit-gate (database)"
echo ""
echo "To completely remove Exit Gate including configuration and data:"
echo "  sudo rm -rf /etc/exit-gate /var/lib/exit-gate"
echo ""
echo "==================================="
echo "Uninstallation Complete!"
echo "==================================="
