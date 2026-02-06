# OpenBDR - Browser Detection & Response

A comprehensive browser extension for security telemetry collection, designed for enterprise-grade detection, investigation, and response use cases.

## Overview

OpenBDR collects exhaustive browser-side telemetry including:

- **Browser & Environment**: Browser details, OS, User-Agent, locale, timezone, installed extensions
- **Navigation & Web Activity**: URLs, referrers, tab events, window focus, downloads
- **DOM & Script Signals**: Dynamic DOM modifications, script injections, CSP violations
- **Network Metadata**: Request/response metadata, redirect chains, security headers
- **Security Signals**: Suspicious URLs, clipboard access, file uploads, form submissions

All telemetry is stored locally in JSONL format, ready for SIEM ingestion (KQL, Splunk, etc.).

## Installation

### Chrome / Edge (Chromium-based browsers)

1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `OpenBDR` directory
5. The extension icon should appear in your toolbar

## Usage

### Viewing Telemetry

Click the OpenBDR icon in your browser toolbar to see:
- Total event count
- Storage usage
- Events by category breakdown

### Exporting Logs

1. Click the **Export Logs** button in the popup
2. Choose a save location
3. Logs are exported as `openbdr_logs_[timestamp].jsonl`

### Log Format

Each line is a JSON object with:
```json
{
  "timestamp": "2024-01-15T12:30:45.123Z",
  "eventId": "1705321845123-abc123def",
  "eventType": "navigation.completed",
  "payload": { ... },
  "metadata": { "extensionVersion": "1.0.0" }
}
```

## Event Types

| Category | Events |
|----------|--------|
| `browser` | `info`, `extensions`, `permissions` |
| `tab` | `created`, `updated`, `removed`, `activated`, `replaced` |
| `window` | `created`, `removed`, `focusChanged` |
| `navigation` | `beforeNavigate`, `committed`, `completed`, `error`, `domContentLoaded`, `historyStateUpdated` |
| `download` | `created`, `changed` |
| `webRequest` | `beforeRequest`, `headersReceived`, `completed`, `error`, `redirect` |
| `dom` | `scriptInjected`, `iframeInjected`, `formInjected`, `attributeChanged` |
| `security` | `formSubmit`, `clipboardCopy`, `clipboardPaste`, `fileUpload`, `cspViolation`, `mixedContent`, `jsError` |
| `page` | `load` |

## Project Structure

```
OpenBDR/
├── manifest.json           # Extension manifest (MV3)
├── background/
│   └── service-worker.js   # Background event listeners
├── content/
│   └── content-script.js   # Page-level monitoring
├── lib/
│   ├── logger.js           # JSONL logging module
│   ├── telemetry.js        # Browser info collection
│   └── utils.js            # Utility functions
├── popup/
│   ├── popup.html          # Popup UI
│   └── popup.js            # Popup logic
└── icons/
    └── *.png               # Extension icons
```

## Development

### Testing

1. Load the extension in Chrome Developer mode
2. Browse various websites
3. Trigger actions: downloads, form submissions, tab switching
4. Export logs and verify JSON validity:
   ```bash
   cat openbdr_logs.jsonl | jq .
   ```

### Debugging

- Background script: `chrome://extensions/` → OpenBDR → "service worker" link
- Content script: Open DevTools on any page, check Console for `[OpenBDR]` messages
- Storage: `chrome://extensions/` → OpenBDR → "Inspect views" → Console → `chrome.storage.local.get(console.log)`

## Security Considerations

- All data is stored **locally only** - no external transmission
- Sensitive values (passwords, tokens) are automatically redacted
- Extension requests itself are excluded from logging

## Author

**Ishan Patel**  
Email: ishan.patel1998@gmail.com  
GitHub: ishan3299

## License

This project is developed for research and enterprise security use cases.
