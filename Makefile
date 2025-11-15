.PHONY: all build clean install uninstall daemon ebpf electron

all: build

build:
	@./build.sh

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
	@echo "  make build       - Build all components"
	@echo "  make ebpf        - Build eBPF programs only"
	@echo "  make daemon      - Build daemon only"
	@echo "  make electron    - Build Electron app only"
	@echo "  make install     - Install Exit Gate (requires root)"
	@echo "  make uninstall   - Uninstall Exit Gate (requires root)"
	@echo "  make clean       - Remove build artifacts"
	@echo "  make dev-daemon  - Run daemon in debug mode"
	@echo "  make dev-electron - Run Electron app in dev mode"
	@echo "  make help        - Show this help message"
