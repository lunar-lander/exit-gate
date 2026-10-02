#!/bin/bash
set -e

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "⚠ ERROR: Do not run packaging as root!"
    echo "⚠ This will cause permission issues with Electron cache."
    echo "⚠ Please run as a regular user:"
    echo ""
    echo "  ./package.sh"
    echo ""
    exit 1
fi

echo "==================================="
echo "Exit Gate Packaging Script"
echo "==================================="
echo ""

# Check if build artifacts exist
if [ ! -d "electron" ]; then
    echo "Error: electron/ directory not found!"
    echo "Are you running this from the project root?"
    echo "Current directory: $(pwd)"
    exit 1
fi

if [ ! -d "electron/dist" ]; then
    echo "Error: Electron dist directory not found!"
    echo "Please run: ./build.sh first"
    echo ""
    echo "Debug info:"
    echo "  Current dir: $(pwd)"
    echo "  electron/ exists: yes"
    echo "  electron/dist/ exists: no"
    exit 1
fi

if [ ! -f "electron/dist/index.html" ] && [ ! -f "electron/dist/main.js" ]; then
    echo "Error: Electron app not built yet!"
    echo "The electron/dist directory exists but appears empty."
    echo ""
    echo "Debug info:"
    echo "  Contents of electron/dist/:"
    ls -la electron/dist/ 2>&1 | head -10
    exit 1
fi

echo "✓ Build artifacts found"
echo ""

# Package Electron app
echo "Packaging Electron application..."

# Clean ALL packaging artifacts to prevent recursive packaging
echo "Cleaning old packaging artifacts..."
rm -f electron/dist/*.AppImage electron/dist/*.deb electron/dist/*.yml 2>/dev/null || true
rm -rf electron/dist/linux-unpacked electron/dist/win-unpacked electron/dist/mac electron/dist/*-unpacked 2>/dev/null || true

# Verify clean
if [ -d "electron/dist/linux-unpacked" ]; then
    echo "⚠ Warning: Could not remove linux-unpacked directory"
    echo "  This may cause packaging issues. Try removing manually:"
    echo "  rm -rf electron/dist/linux-unpacked"
fi

# Check if Electron is already cached
ELECTRON_CACHE="${ELECTRON_CACHE:-$HOME/.cache/electron}"
if [ -f "$ELECTRON_CACHE/electron-v28.3.3-linux-x64.zip" ]; then
    echo "✓ Found cached Electron binary at $ELECTRON_CACHE"
fi

cd electron
npm run package:linux
cd ..

echo "✓ Electron app packaged successfully"
echo ""

echo "==================================="
echo "Packaging Complete!"
echo "==================================="
echo ""
echo "Installation packages:"
echo "  - AppImage: $(ls electron/dist/exit-gate-*.AppImage 2>/dev/null || echo 'not found')"
echo "  - Debian:   $(ls electron/dist/exit-gate-*.deb 2>/dev/null || echo 'not found')"
echo ""
echo "The .deb is self-contained: installing it also installs the daemon,"
echo "eBPF monitors and systemd service, and starts everything."
echo "  sudo dpkg -i electron/dist/exit-gate-*-amd64.deb"
echo ""
echo "The AppImage is portable: on first run it offers to install and start"
echo "the bundled daemon (asks for your password via pkexec)."
echo "  ./electron/dist/exit-gate-*.AppImage"
echo ""
echo "Alternative (source tree) daemon install:"
echo "  sudo ./install.sh"
echo ""
