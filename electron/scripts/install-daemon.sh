#!/bin/bash
# Exit Gate daemon bootstrap.
#
# Installs (or refreshes) the daemon binary, eBPF monitor objects, default
# configuration and the systemd service, then (re)starts the service.
# Idempotent: safe to run repeatedly, and never overwrites an existing
# user-modified /etc/exit-gate/config.toml.
#
# Run as root (directly, via pkexec from the GUI, or from the .deb postinst).
set -euo pipefail

RES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
    echo "This script must run as root (try: pkexec bash $0)" >&2
    exit 1
fi

DAEMON="$RES_DIR/exit-gate-daemon"
if [ ! -x "$DAEMON" ]; then
    echo "Daemon binary not found at $DAEMON" >&2
    exit 1
fi

echo "Installing Exit Gate daemon from $RES_DIR ..."

install -d /usr/local/bin
install -d /usr/local/lib/exit-gate/bpf
install -d /etc/exit-gate
install -d /var/lib/exit-gate
install -d /run/exit-gate

# Daemon binary
install -m 755 "$DAEMON" /usr/local/bin/exit-gate-daemon

# eBPF monitor objects
if compgen -G "$RES_DIR/bpf/*.o" > /dev/null; then
    install -m 644 "$RES_DIR"/bpf/*.o /usr/local/lib/exit-gate/bpf/
else
    echo "Warning: no eBPF objects found in $RES_DIR/bpf/" >&2
fi

# Default configuration (preserves any existing user edits)
if [ ! -f /etc/exit-gate/config.toml ] && [ -f "$RES_DIR/config.toml" ]; then
    install -m 644 "$RES_DIR/config.toml" /etc/exit-gate/config.toml
    echo "Installed default configuration to /etc/exit-gate/config.toml"
fi

# systemd unit (always refreshed so upgrades carry fixes)
if [ -f "$RES_DIR/exit-gate.service" ]; then
    install -m 644 "$RES_DIR/exit-gate.service" /etc/systemd/system/exit-gate.service
fi

systemctl daemon-reload
systemctl enable exit-gate.service > /dev/null 2>&1 || true
systemctl restart exit-gate.service

# Give the service a moment, then surface obvious failures early
sleep 1
if ! systemctl is-active --quiet exit-gate.service; then
    echo "Warning: exit-gate.service did not reach active state." >&2
    systemctl --no-pager status exit-gate.service || true
else
    echo "Exit Gate daemon installed and running."
fi
