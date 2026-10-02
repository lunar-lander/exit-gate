# Exit Gate - eBPF Application Firewall

An OpenSnitch-like Linux application firewall: eBPF kernel monitoring, Rust daemon, Electron GUI.

## Development Commands

Run from the repository root unless noted:

```bash
# Build everything (eBPF objects, Rust daemon, Electron app)
make build            # or ./build.sh

# Package the GUI (AppImage + .deb with bundled daemon)
make package          # or ./package.sh

# Install the daemon system-wide (root)
sudo make install     # or sudo ./install.sh
```

Frontend/Electron commands (run from `electron/`):

```bash
npm install           # Install dependencies
npm run dev           # Dev mode (vite + electron)
npm run build         # Production build
npm run typecheck     # TypeScript check (renderer + main)
```

There is no ESLint setup; `npm run typecheck` is the static check.

## Architecture

- **eBPF** (`ebpf/`): C programs compiled with clang, loaded by the daemon
- **Daemon** (`daemon/`): Rust (Tokio + libbpf-rs + SQLite via sqlx), IPC over Unix socket
- **GUI** (`electron/`): Electron + React + TypeScript + Material-UI (not Tailwind)
- IPC: newline-delimited JSON over `/var/run/exit-gate/exit-gate.sock`

## Key Features

- Real-time network connection monitoring (kprobes: tcp_connect, udp_sendmsg, inet_csk_accept)
- Rule engine (process, port, host, user criteria; priority-ordered)
- Dashboard: activity timeline, top apps/destinations, allow/deny stats
- Default-action modes: Allow All (monitor) / Prompt / Deny All — default is **Allow** (monitor-only)
- Deb/AppImage bundle the daemon; deb postinst installs + starts the systemd service

## Notes

- The daemon must run as root (eBPF); the GUI must NOT run as root
- If eBPF objects are missing, the daemon stays up and logs an error instead of crash-looping
- `daemon/Cargo.lock` is deliberately gitignored (matches historical repo choice)
