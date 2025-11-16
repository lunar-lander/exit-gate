# Exit Gate

**Linux Application Firewall with eBPF**

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
- **AppImage**: `electron/dist/Exit Gate-0.1.0.AppImage` (429 MB)
- **Debian package**: `electron/dist/exit-gate_0.1.0_amd64.deb` (357 MB)

## Installation

### Daemon Installation
```bash
sudo ./install.sh
```

This installs:
- `/usr/local/bin/exit-gate-daemon` - Main daemon
- `/usr/local/lib/exit-gate/bpf/*.o` - eBPF programs
- `/etc/exit-gate/config.toml` - Configuration
- `/etc/systemd/system/exit-gate.service` - Systemd service

### GUI Installation

**Option 1: AppImage (recommended)**
```bash
# Make executable and run
chmod +x electron/dist/Exit\ Gate-0.1.0.AppImage
./electron/dist/Exit\ Gate-0.1.0.AppImage
```

**Option 2: Debian package**
```bash
sudo dpkg -i electron/dist/exit-gate_0.1.0_amd64.deb
```

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
```bash
# If using AppImage
./electron/dist/Exit\ Gate-0.1.0.AppImage

# If installed via .deb
exit-gate
```

### Configuration

Edit `/etc/exit-gate/config.toml`:
```toml
[daemon]
socket_path = "/var/run/exit-gate/daemon.sock"
log_level = "info"
enable_ebpf = true

[database]
path = "/var/lib/exit-gate/exit-gate.db"

[ui]
prompt_timeout = 60
```

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
