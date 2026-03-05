#
# OpenBDR Native Host Installation Script for Windows
# Registers the native messaging host with Chrome, Edge, and Brave
#

$ErrorActionPreference = "Stop"

$HostName = "com.openbdr.host"
$ManifestFileName = "com.openbdr.host.json"
$DefaultLogDir = Join-Path $Home ".openbdr\logs"
$ConfigDir = Join-Path $Home ".openbdr"
$ConfigFile = Join-Path $ConfigDir "config.json"

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "OpenBDR Native Host Windows Installer" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host

# 1. Check Python3
try {
    $PythonVersion = python --version 2>&1
    Write-Host "✓ Python found: $PythonVersion" -ForegroundColor Green
} catch {
    Write-Host "X Error: Python is required but not found in PATH." -ForegroundColor Red
    exit 1
}

# 2. Get extension ID
$ExtensionId = Read-Host "Enter your extension ID (from chrome://extensions/)"
if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    Write-Host "X Error: Extension ID is required." -ForegroundColor Red
    exit 1
}

# 3. Get log directory
$LogDirInput = Read-Host "Enter log directory [default: $DefaultLogDir]"
$LogDir = if ([string]::IsNullOrWhiteSpace($LogDirInput)) { $DefaultLogDir } else { $LogDirInput }

# 4. Create directories
if (!(Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir | Out-Null }
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# 5. Create config file
$ConfigObj = @{
    logDir = $LogDir
    useSqlite = $true
}
$ConfigObj | ConvertTo-Json | Out-File -FilePath $ConfigFile -Encoding utf8
Write-Host "✓ Created config: $ConfigFile (SQLite enabled by default)" -ForegroundColor Green

# 6. Create Manifest File
$ScriptPath = Join-Path $PSScriptRoot "openbdr_host.py"
# Escape backslashes for JSON
$EscapedScriptPath = $ScriptPath.Replace('\', '\\')

$ManifestContent = @"
{
  "name": "$HostName",
  "description": "OpenBDR Native Logging Host - Direct file system access for browser telemetry",
  "path": "$EscapedScriptPath",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$ExtensionId/"
  ]
}
"@

$ManifestPath = Join-Path $PSScriptRoot $ManifestFileName
$ManifestContent | Out-File -FilePath $ManifestPath -Encoding utf8
Write-Host "✓ Created manifest: $ManifestPath" -ForegroundColor Green

# 7. Register in Registry
$RegistryPaths = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName"
)

foreach ($RegPath in $RegistryPaths) {
    try {
        if (!(Test-Path $RegPath)) {
            New-Item -Path $RegPath -Force | Out-Null
        }
        Set-ItemProperty -Path $RegPath -Name "(Default)" -Value $ManifestPath
        Write-Host "✓ Registered in: $RegPath" -ForegroundColor Green
    } catch {
        Write-Host "! Warning: Could not register in $RegPath (Browser might not be installed)" -ForegroundColor Yellow
    }
}

Write-Host
Write-Host "==================================" -ForegroundColor Green
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Green
Write-Host
Write-Host "Log directory: $LogDir"
Write-Host "Extension ID:  $ExtensionId"
Write-Host
Write-Host "Next steps:"
Write-Host "1. Reload the extension in chrome://extensions/"
Write-Host "2. Check the popup for 'Native Host: Connected'"
Write-Host "3. Check $LogDir for .jsonl and .db files"
Write-Host
