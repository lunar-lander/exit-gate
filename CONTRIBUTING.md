# Contributing to Exit Gate

Thank you for your interest in contributing to Exit Gate! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Linux kernel 5.8+ with eBPF support
- Rust 1.70+
- Node.js 18+
- Clang/LLVM 11+
- libbpf development files

### Setting up the Development Environment

1. Clone the repository:
   ```bash
   git clone https://github.com/exit-gate/exit-gate.git
   cd exit-gate
   ```

2. Install dependencies:

   **Ubuntu/Debian:**
   ```bash
   sudo apt install -y clang llvm libelf-dev libbpf-dev \
     linux-headers-$(uname -r) build-essential pkg-config
   ```

   **Fedora/RHEL:**
   ```bash
   sudo dnf install -y clang llvm elfutils-libelf-devel \
     libbpf-devel kernel-devel
   ```

3. Build the project:
   ```bash
   make build
   ```

## Project Structure

```
exit-gate/
├── ebpf/              # eBPF programs (C)
│   ├── network_monitor.bpf.c
│   └── Makefile
├── daemon/            # Rust daemon
│   ├── src/
│   │   ├── main.rs
│   │   ├── bpf.rs
│   │   ├── rule.rs
│   │   ├── db.rs
│   │   ├── ipc.rs
│   │   └── process.rs
│   └── Cargo.toml
├── electron/          # Electron GUI
│   ├── src/
│   │   ├── main.ts
│   │   ├── preload.ts
│   │   ├── App.tsx
│   │   └── components/
│   └── package.json
├── systemd/           # Systemd service files
└── config/            # Configuration templates
```

## Development Workflow

### Running in Development Mode

**Daemon:**
```bash
make dev-daemon
# or
cd daemon && sudo RUST_LOG=debug cargo run
```

**Electron App:**
```bash
make dev-electron
# or
cd electron && npm run dev
```

### Building Components

```bash
make ebpf      # Build eBPF programs only
make daemon    # Build daemon only
make electron  # Build Electron app only
make build     # Build everything
```

### Testing

**Daemon Tests:**
```bash
cd daemon
cargo test
```

**Electron Tests:**
```bash
cd electron
npm test
```

## Code Style

### Rust
- Follow the official [Rust Style Guide](https://doc.rust-lang.org/1.0.0/style/)
- Run `cargo fmt` before committing
- Run `cargo clippy` and fix warnings

### TypeScript/React
- Follow the [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- Use functional components with hooks
- Run `npm run lint` before committing

### eBPF/C
- Follow the Linux kernel coding style
- Keep programs small and focused
- Add comments explaining complex logic

## Commit Guidelines

- Use clear, descriptive commit messages
- Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification
- Examples:
  - `feat: add IPv6 support to eBPF program`
  - `fix: resolve memory leak in rule engine`
  - `docs: update installation instructions`
  - `refactor: simplify IPC message handling`

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit your changes (`git commit -m 'feat: add amazing feature'`)
6. Push to your fork (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### PR Checklist

- [ ] Code builds without errors
- [ ] Tests pass
- [ ] Code follows style guidelines
- [ ] Documentation updated if needed
- [ ] Commit messages are clear
- [ ] No merge conflicts

## Security Considerations

Since Exit Gate operates at a low level with kernel access:

- Never disable security checks without good reason
- Always validate user input
- Be careful with process/kernel memory access
- Test eBPF programs thoroughly to avoid kernel panics
- Report security issues privately (see SECURITY.md)

## Areas for Contribution

### High Priority

- [ ] Complete eBPF program loading in daemon
- [ ] Add IPv6 support
- [ ] Implement DNS resolution for hostnames
- [ ] Add export/import for rules
- [ ] Write comprehensive tests

### Features

- [ ] GeoIP-based filtering
- [ ] Application groups
- [ ] Notification customization
- [ ] Rule templates
- [ ] Statistics graphs
- [ ] Network activity timeline

### Documentation

- [ ] Architecture deep-dive
- [ ] eBPF programming guide
- [ ] Rule creation examples
- [ ] Troubleshooting guide
- [ ] Video tutorials

## Getting Help

- Open an issue for bugs or feature requests
- Join discussions in GitHub Discussions
- Read the documentation in the `docs/` directory

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be recognized in:
- The README.md file
- Release notes
- The project website (when available)

Thank you for contributing to Exit Gate!
