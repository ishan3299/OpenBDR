#
# OpenBDR - Full System Setup & Connection Script
# Bridges the Browser and the SQLite Database
#

$ErrorActionPreference = "Stop"
$ProjectRoot = Get-Location
$HostName = "com.openbdr.host"
$ManifestFileName = "com.openbdr.host.json"
$ConfigDir = Join-Path $Home ".openbdr"
$DbFile = Join-Path $ConfigDir "openbdr.db"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   OpenBDR: Browser -> SQLite Connector Setup   " -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host

# 1. Environment Verification
try {
    $PythonVersion = python --version 2>&1
    Write-Host "[+] Environment: Python found ($PythonVersion)" -ForegroundColor Green
} catch {
    Write-Host "[!] Error: Python 3 must be installed and in your PATH." -ForegroundColor Red
    exit 1
}

# 2. Get Extension ID
Write-Host "To connect the bridge, we need your Extension ID." -ForegroundColor Gray
Write-Host "1. Open chrome://extensions/"
Write-Host "2. Enable 'Developer mode' (top right)"
Write-Host "3. Click 'Load unpacked' and select this folder: $ProjectRoot"
Write-Host "4. Copy the 'ID' string (e.g. abcdefghijklmnopqrstuvwxyz)"
Write-Host
$ExtensionId = Read-Host "Paste your Extension ID here"

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    Write-Host "[!] Error: Extension ID is required to establish the secure pipe." -ForegroundColor Red
    exit 1
}

# 3. Create Persistent Storage
if (!(Test-Path $ConfigDir)) { 
    New-Item -ItemType Directory -Path $ConfigDir | Out-Null 
    Write-Host "[+] Storage: Created $ConfigDir" -ForegroundColor Green
}

# 4. Generate the Secure Native Manifest
$BatchPath = Join-Path $ProjectRoot "native_host\openbdr_host.bat"
$EscapedPath = $BatchPath.Replace('\', '\\')

$ManifestContent = @"
{
  "name": "$HostName",
  "description": "OpenBDR Native SQLite Engine",
  "path": "$EscapedPath",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$ExtensionId/"
  ]
}
"@

$ManifestDest = Join-Path $ProjectRoot "native_host\$ManifestFileName"
$ManifestContent | Out-File -FilePath $ManifestDest -Encoding utf8
Write-Host "[+] Bridge: Generated manifest at $ManifestDest" -ForegroundColor Green

# 5. Register with Browsers (Windows Registry)
$RegistryPaths = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName"
)

foreach ($RegPath in $RegistryPaths) {
    try {
        if (!(Test-Path $RegPath)) { New-Item -Path $RegPath -Force | Out-Null }
        Set-ItemProperty -Path $RegPath -Name "(Default)" -Value $ManifestDest
        Write-Host "[+] Registry: Successfully registered in $(Split-Path $RegPath -Parent)" -ForegroundColor Green
    } catch {
        Write-Host "[-] Registry: Skipping $RegPath (Browser not found)" -ForegroundColor Gray
    }
}

# 6. Final Instructions
Write-Host
Write-Host "================================================" -ForegroundColor Green
Write-Host "   CONNECTION ESTABLISHED!                      " -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host "SQLite Database: $DbFile"
Write-Host "Extension ID:    $ExtensionId"
Write-Host
Write-Host "FINAL STEPS:"
Write-Host "1. Return to chrome://extensions/"
Write-Host "2. Click the 'Reload' icon on the OpenBDR card."
Write-Host "3. Click the extension icon in your toolbar."
Write-Host "4. Status should now show: ● SQLite (Connected)"
Write-Host
