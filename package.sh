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
if [ ! -f "electron/dist/main.js" ]; then
    echo "Error: Electron app not built yet!"
    echo "Please run: ./build.sh"
    exit 1
fi

# Package Electron app
echo "Packaging Electron application..."
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
echo "  - AppImage: electron/dist/Exit Gate-0.1.0.AppImage"
echo "  - Debian:   electron/dist/exit-gate_0.1.0_amd64.deb"
echo ""
echo "To install the daemon:"
echo "  sudo ./install.sh"
echo ""
echo "To run the GUI (AppImage):"
echo "  ./electron/dist/Exit\ Gate-0.1.0.AppImage"
echo ""
echo "Or install the .deb package:"
echo "  sudo dpkg -i electron/dist/exit-gate_0.1.0_amd64.deb"
echo ""
