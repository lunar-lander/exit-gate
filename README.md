# Exit Gate - Linux Application Firewall

An elaborate OpenSnitch-like application firewall for Linux with eBPF-based network monitoring.

## Features

- **Real-time Network Monitoring**: Uses eBPF to monitor all network connections at the kernel level
- **Interactive Connection Prompts**: Pop-up dialogs for allowing/denying connections
- **Rule Engine**: Create persistent rules to automatically allow/deny connections
- **Process Detection**: Identifies which process is making each connection
- **Connection History**: View and analyze past connection attempts
- **Statistics Dashboard**: Real-time network activity visualization
- **Low Overhead**: eBPF provides high performance with minimal system impact

## Architecture

```
┌─────────────────────────────────────┐
│     Electron GUI (React)            │
│  - Connection Prompts               │
│  - Rule Management                  │
│  - Statistics Dashboard             │
└──────────────┬──────────────────────┘
               │ Unix Socket IPC
┌──────────────┴──────────────────────┐
│     Rust Daemon                     │
│  - Rule Engine                      │
│  - SQLite Storage                   │
│  - Process Information              │
└──────────────┬──────────────────────┘
               │ libbpf-rs
┌──────────────┴──────────────────────┐
│     eBPF Programs (C)               │
│  - TCP Connect Hook                 │
│  - UDP Send Hook                    │
│  - Connection Tracking              │
└─────────────────────────────────────┘
```

## Components

### 1. eBPF Programs (`/ebpf`)
- Written in C, compiled to eBPF bytecode
- Hooks into kernel network functions
- Collects connection metadata (PID, dest IP, port, etc.)

### 2. Rust Daemon (`/daemon`)
- Loads and manages eBPF programs
- Enforces firewall rules
- Communicates with Electron GUI via Unix sockets
- Stores rules and history in SQLite

### 3. Electron Application (`/electron`)
- Modern React-based UI
- Real-time connection notifications
- Rule management interface
- Statistics and monitoring dashboard

## Requirements

- Linux kernel 5.8+ (for eBPF features)
- Rust 1.70+
- Node.js 18+
- Clang/LLVM (for eBPF compilation)
- libbpf development files

## Installation

### Install Dependencies

**Ubuntu/Debian:**
```bash
sudo apt install -y clang llvm libelf-dev libbpf-dev linux-headers-$(uname -r) build-essential pkg-config
```

**Fedora/RHEL:**
```bash
sudo dnf install -y clang llvm elfutils-libelf-devel libbpf-devel kernel-devel
```

### Build the Daemon

```bash
cd daemon
cargo build --release
```

### Build the Electron App

```bash
cd electron
npm install
npm run build
```

### Install as System Service

```bash
sudo cp daemon/target/release/exit-gate-daemon /usr/local/bin/
sudo cp systemd/exit-gate.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable exit-gate
sudo systemctl start exit-gate
```

## Usage

### Start the GUI

```bash
cd electron
npm start
```

Or install the packaged application and run from your application menu.

### Command Line

```bash
# Start the daemon manually
sudo exit-gate-daemon

# View logs
sudo journalctl -u exit-gate -f

# Check status
sudo systemctl status exit-gate
```

## Development

### Build eBPF Programs

```bash
cd ebpf
make
```

### Run Daemon in Debug Mode

```bash
cd daemon
sudo RUST_LOG=debug cargo run
```

### Run Electron in Dev Mode

```bash
cd electron
npm run dev
```

## Configuration

Configuration file: `/etc/exit-gate/config.toml`

```toml
[daemon]
socket_path = "/var/run/exit-gate/exit-gate.sock"
db_path = "/var/lib/exit-gate/rules.db"
log_level = "info"

[notifications]
timeout_seconds = 30
default_action = "deny"  # deny or allow
```

## Rule Types

1. **Process-based**: Allow/deny by executable path
2. **Domain-based**: Allow/deny by destination domain
3. **IP-based**: Allow/deny by destination IP/CIDR
4. **Port-based**: Allow/deny by destination port
5. **Combined**: Multiple criteria (process + domain + port)

## Security Considerations

- Daemon must run as root to load eBPF programs
- Unix socket uses file permissions for access control
- Rules are stored with secure file permissions
- eBPF programs are verified by the kernel for safety

## License

MIT

## Credits

Inspired by OpenSnitch - Application Firewall for Linux
