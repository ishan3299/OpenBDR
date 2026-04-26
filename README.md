# OpenBDR - Browser Detection & Response

OpenBDR is a comprehensive browser-side security telemetry platform designed for enterprise-grade detection, investigation, and response. It monitors granular browser activity and employs advanced heuristics to detect threats like typosquatting and obfuscated scripts.

## Core Features

*   **Advanced Heuristics Engine**:
    *   **Typosquatting Detection**: Uses Levenshtein distance to detect look-alike domains (e.g., `paypaI.com` vs `paypal.com`) and can actively block navigation.
    *   **Entropy Analysis**: Calculates Shannon Entropy of injected scripts to identify highly obfuscated or packed malicious code.
*   **Deep Visibility**: 
    *   **Shadow DOM Monitoring**: Hooks into `attachShadow` to track activity hidden within encapsulated web components.
    *   **Network Metadata**: Captures request/response metadata, security headers, and initiator chains.
    *   **DOM Mutation Tracking**: Monitors script, iframe, and form injections in real-time.
*   **Service-Oriented Architecture**:
    *   **Background Daemon**: A dedicated `systemd` service manages persistence and log forwarding independently of the browser lifecycle.
    *   **Two-Way Communication**: Low-latency bridge between the browser extension and the local system daemon.
*   **Reliable Forwarding**: Automatically batches and transmits logs to a remote SIEM or centralized server with local SQLite buffering.

## System Architecture

1.  **Browser Extension (MV3)**: Collects telemetry and applies real-time heuristics.
2.  **Native Messaging Bridge**: A lightweight proxy that forwards data from the browser to the daemon.
3.  **OpenBDR Daemon (systemd)**: The core engine that stores data in SQLite and manages remote forwarding.

## Quick Start (from Bundle)

If you have the distribution bundle (`openbdr_v1.0.0.tar.gz`):

1.  **Extract the bundle**:
    ```bash
    tar -xzvf openbdr_v1.0.0.tar.gz
    cd openbdr_v1.0.0
    ```
2.  **Run the master installer**:
    ```bash
    ./install.sh
    ```
3.  **Load the Extension**:
    *   Open `chrome://extensions/`
    *   Enable **Developer mode**
    *   Click **Load unpacked** and select the `extension/` folder.
4.  **Configuration**:
    Edit `~/.openbdr/config.json` to set your `forwardingUrl` for remote logging.

## Development & Control

*   **Restart Daemon**: `sudo systemctl restart openbdr`
*   **Check Stats**: `sudo systemctl status openbdr`
*   **View Logs**: `journalctl -u openbdr -f`
*   **Local DB**: `sqlite3 ~/.openbdr/logs/openbdr.db`

## Event Types

| Category | Events |
|----------|--------|
| `detection` | `page.load` (Typosquatting), `dom.scriptInjected` (Entropy) |
| `response` | `response.action` (Active Blocking) |
| `dom` | `scriptInjected`, `iframeInjected`, `shadowRootCreated`, `formInjected` |
| `network` | `webRequest.beforeRequest`, `webRequest.headersReceived`, `navigation.committed` |
| `security` | `formSubmit`, `clipboardCopy`, `jsError`, `cspViolation` |

---
Developed by **Ishan Patel**
