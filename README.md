# Exit Gate

**Linux Application Firewall with eBPF**

![exit-gate](./exit-gate.gif)

Exit Gate is an elaborate OpenSnitch-like application firewall for Linux that uses eBPF for kernel-level network monitoring, Rust for the daemon backend, and Electron for the desktop GUI.

## Features

- **eBPF-based monitoring**: Kernel-level network connection tracking
- **Interactive prompts**: Allow/deny connection requests in real-time
- **Rule engine**: Priority-based rules with multiple criteria (process, port, domain, user)
- **Modern GUI**: React + Material-UI desktop application
- **SQLite database**: Persistent rules and connection history
- **Process tracking**: Identify applications making network connections

## Architecture

```
┌─────────────────┐
│  Electron GUI   │  (React + TypeScript + Material-UI)
└────────┬────────┘
         │ Unix Socket (JSON IPC)
┌────────┴────────┐
│  Rust Daemon    │  (Tokio + SQLite + Rule Engine)
└────────┬────────┘
         │ Ring Buffer
┌────────┴────────┐
│  eBPF Programs  │  (Kernel probes on tcp_connect/accept)
└─────────────────┘
```

## Prerequisites

### Build Dependencies
- **Rust** 1.70+ with Cargo
- **Node.js** 18+ with npm
- **Clang/LLVM** for eBPF compilation
- **Linux headers** for eBPF

#### Ubuntu/Debian
```bash
sudo apt install clang llvm linux-headers-$(uname -r)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs
```

#### Fedora/RHEL
```bash
sudo dnf install clang llvm kernel-devel
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo dnf install nodejs
```

### Runtime Dependencies
- **Linux kernel** 5.8+ (for eBPF support)
- **CAP_BPF** or root privileges (daemon only)

## Building

**⚠️ IMPORTANT: Build as regular user, NOT as root!**

```bash
# 1. Build all components (eBPF, Rust daemon, Electron app)
make build

# 2. Package the Electron GUI (creates AppImage and .deb)
make package

# 3. Install the daemon (requires root)
sudo make install
```

Or use individual scripts:
```bash
./build.sh      # Build (as regular user)
./package.sh    # Package GUI (as regular user)
sudo ./install.sh   # Install daemon (as root)
```

### Build Artifacts

After building:
- **eBPF programs**: `ebpf/network_monitor.bpf.o` (13 KB)
- **Daemon**: `daemon/target/release/exit-gate-daemon` (6 MB)
- **Electron web**: `electron/dist/` (800 KB)

After packaging:
- **AppImage**: `electron/dist/exit-gate-0.2.0-x86_64.AppImage`
- **Debian package**: `electron/dist/exit-gate-0.2.0-amd64.deb`

## Installation

### Option 1: Debian package (recommended, all-in-one)
```bash
sudo dpkg -i electron/dist/exit-gate-0.2.0-amd64.deb
```
This installs the GUI **and** the daemon, eBPF monitors, configuration and
systemd service, then enables and starts the service automatically. No extra
steps needed — launch `exit-gate` from your application menu.

### Option 2: AppImage (portable)
```bash
chmod +x electron/dist/exit-gate-0.2.0-x86_64.AppImage
./electron/dist/exit-gate-0.2.0-x86_64.AppImage
```
On first run the app detects the missing daemon and offers to install and
start it (your password is requested via `pkexec`). The GUI connects
automatically once the service is up.

### Option 3: From source (daemon only)
```bash
sudo ./install.sh
```

This installs:
- `/usr/local/bin/exit-gate-daemon` - Main daemon
- `/usr/local/lib/exit-gate/bpf/*.o` - eBPF programs
- `/etc/exit-gate/config.toml` - Configuration
- `/etc/systemd/system/exit-gate.service` - Systemd service

## Usage

### Start the Daemon
```bash
# Start the service
sudo systemctl start exit-gate

# Enable auto-start on boot
sudo systemctl enable exit-gate

# Check status
sudo systemctl status exit-gate

# View logs
sudo journalctl -u exit-gate -f
```

### Launch the GUI

**⚠️ IMPORTANT: Run as regular user, NOT with sudo!**

```bash
# If using AppImage (run as regular user)
./electron/dist/Exit\ Gate-0.1.0.AppImage

# If installed via .deb
exit-gate
```

**Note**: If you get permission errors, DON'T use sudo. Electron apps should not run as root for security reasons.

### Configuration

Edit `/etc/exit-gate/config.toml`:
```toml
[daemon]
socket_path = "/var/run/exit-gate/exit-gate.sock"
log_level = "info"
bpf_path = "/usr/local/lib/exit-gate/bpf"

[notifications]
timeout_seconds = 30
# Default action for connections that match no rule:
# "allow" (monitor mode, recommended), "deny", or "prompt"
default_action = "allow"

[database]
db_path = "/var/lib/exit-gate/rules.db"
```

The default action can also be switched live from the dashboard
(**Allow All / Prompt / Deny All**); the file only provides the startup value.

## Development

### Run in Development Mode

**Terminal 1: Daemon**
```bash
make dev-daemon
# or
cd daemon && sudo RUST_LOG=debug cargo run
```

**Terminal 2: Electron GUI**
```bash
make dev-electron
# or
cd electron && npm run dev
```

### Project Structure
```
exit-gate/
├── ebpf/               # eBPF programs (C)
│   ├── network_monitor.bpf.c
│   └── Makefile
├── daemon/             # Rust daemon
│   ├── src/
│   │   ├── main.rs
│   │   ├── ebpf.rs
│   │   ├── rule.rs
│   │   ├── db.rs
│   │   └── ipc.rs
│   └── Cargo.toml
├── electron/           # Electron GUI
│   ├── src/
│   │   ├── main.ts         # Electron main process
│   │   ├── preload.ts      # Preload script
│   │   ├── App.tsx         # React app
│   │   └── components/     # UI components
│   ├── package.json
│   └── tsconfig.*.json
├── config/             # Default configuration
├── systemd/            # Systemd service files
├── build.sh            # Build script
├── package.sh          # Packaging script
├── install.sh          # Installation script
└── Makefile
```

## Troubleshooting

### Permission Errors During Build
**Error**: `stat /root/.cache/electron/...: permission denied`

**Solution**: Don't build as root! Always build as regular user:
```bash
exit  # Exit from sudo -s
make build
make package
```

### eBPF Loading Fails
**Error**: `Failed to load eBPF program`

**Solution**: Ensure kernel supports eBPF (5.8+) and daemon runs as root:
```bash
uname -r  # Check kernel version
sudo systemctl status exit-gate
```

### Daemon Won't Start
**Error**: `Failed to bind to socket`

**Solution**: Check if socket path is writable:
```bash
sudo mkdir -p /var/run/exit-gate
sudo chown root:root /var/run/exit-gate
sudo systemctl restart exit-gate
```

## Uninstallation

```bash
# Stop and disable service
sudo systemctl stop exit-gate
sudo systemctl disable exit-gate

# Remove files
sudo ./uninstall.sh

# If using .deb package for GUI
sudo dpkg -r exit-gate
```

## License

MIT License - see LICENSE file

## Contributing

Contributions welcome! Please read CONTRIBUTING.md for guidelines.

## Acknowledgments

Inspired by [OpenSnitch](https://github.com/evilsocket/opensnitch) by @evilsocket
