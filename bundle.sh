#!/bin/bash
# OpenBDR Distribution Bundler

VERSION="1.0.0"
DIST_DIR="dist/openbdr_v$VERSION"
mkdir -p "$DIST_DIR/extension"
mkdir -p "$DIST_DIR/host"

echo "[1/4] Bundling Extension..."
# Copy extension files
cp -r background content icons lib popup manifest.json "$DIST_DIR/extension/"

echo "[2/4] Bundling Native Host & Service..."
# Copy host scripts and service unit
cp native_host/openbdr_daemon.py "$DIST_DIR/host/"
cp native_host/openbdr_bridge.py "$DIST_DIR/host/"
cp openbdr.service "$DIST_DIR/host/"

echo "[3/4] Creating Master Installer..."
cat > "$DIST_DIR/install.sh" << 'INST'
#!/bin/bash
# OpenBDR Master Installer
set -e

echo "--- OpenBDR Installation ---"
# 1. Setup directories
mkdir -p ~/.openbdr/logs

# 2. Install Systemd Service
echo "Installing OpenBDR Service..."
read -sp "Enter sudo password: " PASS
echo
echo "$PASS" | sudo -S cp host/openbdr.service /etc/systemd/system/
echo "$PASS" | sudo -S systemctl daemon-reload
echo "$PASS" | sudo -S systemctl enable openbdr
echo "$PASS" | sudo -S systemctl start openbdr

# 3. Setup Native Messaging
echo "Registering Native Messaging Bridge..."
EXT_ID_FILE="~/.config/google-chrome/NativeMessagingHosts/com.openbdr.host.json"
mkdir -p $(dirname $EXT_ID_FILE)

echo "Enter your Browser Extension ID: "
read EXT_ID

cat > com.openbdr.host.json << JSON
{
  "name": "com.openbdr.host",
  "description": "OpenBDR Native Messaging Bridge",
  "path": "$PWD/host/openbdr_bridge.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://\$EXT_ID/"]
}
JSON

echo "$PASS" | sudo -S mv com.openbdr.host.json /etc/opt/chrome/native-messaging-hosts/ || \
cp com.openbdr.host.json ~/.config/google-chrome/NativeMessagingHosts/

echo "SUCCESS: OpenBDR is installed and running."
INST
chmod +x "$DIST_DIR/install.sh"

echo "[4/4] Creating Archive..."
tar -czf openbdr_v$VERSION.tar.gz -C dist openbdr_v$VERSION
echo "Done! Final bundle: openbdr_v$VERSION.tar.gz"
