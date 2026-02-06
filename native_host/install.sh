#!/bin/bash
#
# OpenBDR Native Host Installation Script
# Registers the native messaging host with Chrome/Chromium
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.openbdr.host"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=================================="
echo "OpenBDR Native Host Installer"
echo "=================================="
echo

# Check Python3
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python3 is required but not installed.${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Python3 found: $(python3 --version)"

# Get extension ID
echo
echo -e "${YELLOW}Enter your extension ID (from chrome://extensions/):${NC}"
read -r EXTENSION_ID

if [ -z "$EXTENSION_ID" ]; then
    echo -e "${RED}Error: Extension ID is required.${NC}"
    exit 1
fi

# Get log directory (optional)
echo
echo -e "${YELLOW}Enter log directory [default: ~/.openbdr/logs]:${NC}"
read -r LOG_DIR
LOG_DIR=${LOG_DIR:-"$HOME/.openbdr/logs"}

# Create directories
mkdir -p "$HOME/.openbdr"
mkdir -p "$LOG_DIR"

# Make host script executable
chmod +x "$SCRIPT_DIR/openbdr_host.py"

# Create config file
cat > "$HOME/.openbdr/config.json" << EOF
{
  "logDir": "$LOG_DIR"
}
EOF
echo -e "${GREEN}✓${NC} Created config: ~/.openbdr/config.json"

# Determine manifest directory based on browser
CHROME_MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
CHROMIUM_MANIFEST_DIR="$HOME/.config/chromium/NativeMessagingHosts"
BRAVE_MANIFEST_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
EDGE_MANIFEST_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"

# Create manifest for all supported browsers
install_manifest() {
    local manifest_dir="$1"
    local browser_name="$2"
    
    if [ -d "$(dirname "$manifest_dir")" ]; then
        mkdir -p "$manifest_dir"
        
        cat > "$manifest_dir/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "OpenBDR Native Logging Host - Direct file system access for browser telemetry",
  "path": "$SCRIPT_DIR/openbdr_host.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
        echo -e "${GREEN}✓${NC} Installed manifest for $browser_name"
    fi
}

install_manifest "$CHROME_MANIFEST_DIR" "Google Chrome"
install_manifest "$CHROMIUM_MANIFEST_DIR" "Chromium"
install_manifest "$BRAVE_MANIFEST_DIR" "Brave"
install_manifest "$EDGE_MANIFEST_DIR" "Microsoft Edge"

echo
echo "=================================="
echo -e "${GREEN}Installation Complete!${NC}"
echo "=================================="
echo
echo "Log directory: $LOG_DIR"
echo "Extension ID:  $EXTENSION_ID"
echo
echo "Next steps:"
echo "1. Reload the extension in chrome://extensions/"
echo "2. Check the popup for 'Native Host: Connected'"
echo "3. Browse websites to generate telemetry"
echo "4. Check $LOG_DIR for log files"
echo
