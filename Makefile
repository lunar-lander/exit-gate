.PHONY: all build package clean install uninstall daemon ebpf electron

all:
	make build && sudo make install && make package

build:
	@./build.sh

package:
	@./package.sh

ebpf:
	@echo "Building eBPF programs..."
	cd ebpf && $(MAKE)

daemon:
	@echo "Building daemon..."
	cd daemon && cargo build --release

electron:
	@echo "Building Electron app..."
	cd electron && npm install && npm run build

install:
	@sudo ./install.sh

uninstall:
	@sudo ./uninstall.sh

clean:
	@echo "Cleaning build artifacts..."
	cd ebpf && $(MAKE) clean
	cd daemon && cargo clean
	cd electron && rm -rf dist node_modules
	@echo "Clean complete"

dev-daemon:
	@echo "Running daemon in development mode..."
	cd daemon && sudo RUST_LOG=debug cargo run

dev-electron:
	@echo "Running Electron app in development mode..."
	cd electron && npm run dev

help:
	@echo "Exit Gate - Linux Application Firewall"
	@echo ""
	@echo "Available targets:"
	@echo "  make build       - Build all components (run as regular user)"
	@echo "  make package     - Package Electron app (run as regular user)"
	@echo "  make ebpf        - Build eBPF programs only"
	@echo "  make daemon      - Build daemon only"
	@echo "  make electron    - Build Electron app only"
	@echo "  make install     - Install daemon (requires root)"
	@echo "  make uninstall   - Uninstall daemon (requires root)"
	@echo "  make clean       - Remove build artifacts"
	@echo "  make dev-daemon  - Run daemon in debug mode (requires root)"
	@echo "  make dev-electron - Run Electron app in dev mode"
	@echo "  make help        - Show this help message"
	@echo ""
	@echo "Typical workflow:"
	@echo "  1. make build    (as regular user)"
	@echo "  2. make package  (as regular user)"
	@echo "  3. make install  (as root/sudo)"
