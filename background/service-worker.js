/**
 * OpenBDR - Background Service Worker
 * Central event listener hub for browser telemetry collection.
 * Security Relevance: Captures all major browser events for security monitoring.
 */

// Import other scripts (paths relative to extension root)
try {
    importScripts('/lib/native-logger.js', '/lib/utils.js', '/lib/telemetry.js');
} catch (e) {
    console.error('[OpenBDR] Failed to import scripts:', e);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the extension on startup
 */
async function initialize() {
    console.log('[OpenBDR] Initializing background service worker...');

    // Initialize Native Logger (Mandatory SQLite Sink)
    try {
        await nativeLogger.init();
    } catch (e) {
        console.error('[OpenBDR] Native host initialization failed. Telemetry will buffer in memory.');
    }

    // Smart Throttling: Only log full environment info once every 24 hours
    const now = Date.now();
    const storage = await chrome.storage.local.get('lastEnvLog');
    const lastEnvLog = storage.lastEnvLog || 0;
    const dayInMs = 24 * 60 * 60 * 1000;

    if (now - lastEnvLog > dayInMs) {
        // Collect and log browser environment info
        const browserInfo = await collectBrowserInfo();
        await dispatchLog('browser.info', browserInfo);

        // Log installed extensions
        const extensions = await getInstalledExtensions();
        await dispatchLog('browser.extensions', {
            count: extensions.length,
            extensions: extensions
        });

        // Log own permissions
        const permissions = await getOwnPermissions();
        await dispatchLog('browser.permissions', permissions);

        await chrome.storage.local.set({ lastEnvLog: now });
        console.log('[OpenBDR] Environment telemetry collected and logged to SQLite.');
    }

    console.log('[OpenBDR] Initialization complete. Native SQLite logging active.');
}

// Run initialization
initialize().catch(e => console.error('[OpenBDR] Init failed:', e));

/**
 * Unified log dispatcher that handles sanitization and mandatory native logging
 * @param {string} eventType - The type of event to log
 * @param {object} payload - The event payload
 * @param {object} metadata - Optional metadata
 */
async function dispatchLog(eventType, payload, metadata = {}) {
    // 1. Sanitize payload
    const sanitizedPayload = OpenBDRUtils.sanitizePayload(payload);

    // DEBUG: Log all page loads to see what is coming through
    if (eventType === 'page.load') {
        console.log('[OpenBDR] Processing page load:', sanitizedPayload.hostname, 'Suspicious:', sanitizedPayload.isSuspiciousTyposquat);
    }

    // 2. Active Response: Block suspicious domains (typosquatting or static patterns)
    if (eventType === 'page.load' && sanitizedPayload.isSuspiciousTyposquat) {
        console.warn('[OpenBDR] Typosquatting detected for:', sanitizedPayload.hostname);
        await activateResponseBlocking(sanitizedPayload.hostname);
    }

    // 3. Direct to Native Host (SQLite)
    // The nativeLogger class handles internal in-memory buffering if disconnected
    try {
        return await nativeLogger.log(eventType, sanitizedPayload, metadata);
    } catch (e) {
        console.warn('[OpenBDR] Logging to native host failed:', e);
    }
}

/**
 * Activate active response blocking for a specific domain
 * Uses declarativeNetRequest to block navigation
 */
async function activateResponseBlocking(hostname) {
    console.warn(`[OpenBDR] Activating active response blocking for suspicious domain: ${hostname}`);
    
    const ruleId = Math.floor(Math.random() * 1000000) + 1;
    
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                id: ruleId,
                priority: 1,
                action: { type: 'block' },
                condition: {
                    urlFilter: hostname,
                    resourceTypes: ['main_frame', 'sub_frame']
                }
            }],
            removeRuleIds: [] // Cleanup could be implemented with a TTL
        });
        
        await dispatchLog('response.action', {
            action: 'block_domain',
            hostname: hostname,
            ruleId: ruleId,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('[OpenBDR] Failed to apply blocking rule:', e);
    }
}

// ============================================================================
// BROWSER LIFECYCLE HANDLING
// ============================================================================

/**
 * Handle browser startup
 */
chrome.runtime.onStartup.addListener(() => {
    console.log('[OpenBDR] Browser startup detected');
    initialize().catch(e => console.error('[OpenBDR] Startup init failed:', e));
});

/**
 * Handle extension install/update
 */
chrome.runtime.onInstalled.addListener((details) => {
    console.log(`[OpenBDR] Extension ${details.reason}`);
    dispatchLog('extension.lifecycle', {
        event: details.reason,
        previousVersion: details.previousVersion || null
    });
});

/**
 * Handle browser shutdown - auto-flush events
 */
chrome.runtime.onSuspend.addListener(() => {
    console.log('[OpenBDR] Browser shutdown/suspend detected');
    // Events are already persisted in IndexedDB or handled by native host
});

// ============================================================================
// TAB EVENT LISTENERS
// Security Relevance: Track user navigation patterns, detect suspicious tab behaviors
// ============================================================================

/**
 * Tab created event
 * Security Relevance: New tabs may be spawned by malicious scripts
 */
chrome.tabs.onCreated.addListener(async (tab) => {
    await dispatchLog('tab.created', {
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        url: tab.url || tab.pendingUrl || 'unknown',
        openerTabId: tab.openerTabId,
        pinned: tab.pinned,
        incognito: tab.incognito,
    });
});

/**
 * Tab updated event
 * Security Relevance: Track URL changes, detect redirects and suspicious navigation
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only log meaningful changes
    if (changeInfo.url || changeInfo.status === 'complete' || changeInfo.title) {
        await dispatchLog('tab.updated', {
            tabId: tabId,
            windowId: tab.windowId,
            changeInfo: changeInfo,
            url: tab.url,
            title: tab.title,
            favIconUrl: tab.favIconUrl,
        });
    }
});

/**
 * Tab removed event
 * Security Relevance: Rapid tab creation/removal may indicate malicious activity
 */
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    await dispatchLog('tab.removed', {
        tabId: tabId,
        windowId: removeInfo.windowId,
        isWindowClosing: removeInfo.isWindowClosing,
    });
});

/**
 * Tab activated event
 * Security Relevance: Track user focus, detect tab-napping attacks
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await dispatchLog('tab.activated', {
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
    });
});

/**
 * Tab replaced event (prerender/instant navigation)
 * Security Relevance: Detect prerendering which could be used for tracking
 */
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
    await dispatchLog('tab.replaced', {
        addedTabId: addedTabId,
        removedTabId: removedTabId,
    });
});

// ============================================================================
// WINDOW EVENT LISTENERS
// Security Relevance: Track window management, detect popup abuse
// ============================================================================

/**
 * Window created event
 * Security Relevance: Popup windows often used for phishing, ad fraud
 */
chrome.windows.onCreated.addListener(async (window) => {
    await dispatchLog('window.created', {
        windowId: window.id,
        type: window.type,
        state: window.state,
        incognito: window.incognito,
        focused: window.focused,
        width: window.width,
        height: window.height,
    });
});

/**
 * Window removed event
 */
chrome.windows.onRemoved.addListener(async (windowId) => {
    await dispatchLog('window.removed', {
        windowId: windowId,
    });
});

/**
 * Window focus changed event
 * Security Relevance: Focus hijacking detection
 */
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    await dispatchLog('window.focusChanged', {
        windowId: windowId,
        noFocus: windowId === chrome.windows.WINDOW_ID_NONE,
    });
});

// ============================================================================
// NAVIGATION EVENT LISTENERS
// Security Relevance: Core navigation tracking for threat detection
// ============================================================================

/**
 * Navigation committed event
 * Security Relevance: Track actual URL navigations with referrer chain
 */
chrome.webNavigation.onCommitted.addListener(async (details) => {
    // Skip internal URLs
    if (details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) {
        return;
    }

    await dispatchLog('navigation.committed', {
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        parentFrameId: details.parentFrameId,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
        processId: details.processId,
    });
});

/**
 * Navigation completed event
 * Security Relevance: Confirm successful page loads
 */
chrome.webNavigation.onCompleted.addListener(async (details) => {
    if (details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) {
        return;
    }

    await dispatchLog('navigation.completed', {
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        processId: details.processId,
    });
});

/**
 * Navigation error event
 * Security Relevance: Failed navigations may indicate blocked malware domains
 */
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
    await dispatchLog('navigation.error', {
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        error: details.error,
    });
});

/**
 * Before navigate event (earliest navigation signal)
 * Security Relevance: Capture navigation intent before redirects
 */
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) {
        return;
    }

    await dispatchLog('navigation.beforeNavigate', {
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        parentFrameId: details.parentFrameId,
    });
});

/**
 * DOM content loaded event
 * Security Relevance: Track when page DOM is ready (before all resources)
 */
chrome.webNavigation.onDOMContentLoaded.addListener(async (details) => {
    if (details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) {
        return;
    }

    await dispatchLog('navigation.domContentLoaded', {
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
    });
});

/**
 * History state updated event
 * Security Relevance: Detect SPA navigation, potential URL spoofing
 */
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
    await dispatchLog('navigation.historyStateUpdated', {
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        transitionType: details.transitionType,
    });
});

/**
 * Reference fragment updated event
 * Security Relevance: Track in-page navigation, anchor-based routing
 */
chrome.webNavigation.onReferenceFragmentUpdated.addListener(async (details) => {
    await dispatchLog('navigation.referenceFragmentUpdated', {
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        transitionType: details.transitionType,
    });
});

// ============================================================================
// DOWNLOAD EVENT LISTENERS
// Security Relevance: Critical for detecting malware downloads
// ============================================================================

/**
 * Download created event
 * Security Relevance: Track all file downloads, detect malicious file types
 */
chrome.downloads.onCreated.addListener(async (downloadItem) => {
    const suspiciousExtensions = [
        '.exe', '.scr', '.bat', '.cmd', '.ps1', '.vbs', '.hta',
        '.msi', '.dll', '.jar', '.js', '.jse', '.wsf', '.wsh'
    ];

    const filename = downloadItem.filename || downloadItem.finalUrl || '';
    const isSuspicious = suspiciousExtensions.some(ext =>
        filename.toLowerCase().endsWith(ext)
    );

    await dispatchLog('download.created', {
        id: downloadItem.id,
        url: downloadItem.url,
        finalUrl: downloadItem.finalUrl,
        referrer: downloadItem.referrer,
        filename: downloadItem.filename,
        mime: downloadItem.mime,
        fileSize: downloadItem.fileSize,
        state: downloadItem.state,
        danger: downloadItem.danger,
        incognito: downloadItem.incognito,
        isSuspicious: isSuspicious,
    });
});

/**
 * Download state changed event
 * Security Relevance: Track download completion, detect interrupted downloads
 */
chrome.downloads.onChanged.addListener(async (delta) => {
    await dispatchLog('download.changed', {
        id: delta.id,
        state: delta.state,
        filename: delta.filename,
        danger: delta.danger,
        error: delta.error,
        endTime: delta.endTime,
        fileSize: delta.fileSize,
    });
});

// ============================================================================
// WEB REQUEST LISTENERS
// Security Relevance: Network-level visibility for request analysis.
// Optimization: Exclude high-volume, low-risk resource types to reduce load.
// ============================================================================

const WEB_REQUEST_FILTER = {
    urls: ['<all_urls>'],
    types: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'ping', 'websocket', 'other']
};

/**
 * Before request event
 */
chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
        // Skip extension requests and high-volume internal requests
        if (details.url.startsWith('chrome-extension://') ||
            details.url.startsWith('chrome://')) {
            return;
        }

        await dispatchLog('webRequest.beforeRequest', {
            requestId: details.requestId,
            url: details.url,
            method: details.method,
            type: details.type,
            tabId: details.tabId,
            frameId: details.frameId,
            initiator: details.initiator,
        });
    },
    WEB_REQUEST_FILTER
);

/**
 * Response headers received event
 */
chrome.webRequest.onHeadersReceived.addListener(
    async (details) => {
        if (details.url.startsWith('chrome-extension://') ||
            details.url.startsWith('chrome://')) {
            return;
        }

        // Extract security-relevant headers
        const securityHeaders = {};
        const headerNames = [
            'content-security-policy',
            'x-content-type-options',
            'x-frame-options',
            'x-xss-protection',
            'strict-transport-security',
            'content-type',
            'location',
        ];

        if (details.responseHeaders) {
            details.responseHeaders.forEach(h => {
                if (headerNames.includes(h.name.toLowerCase())) {
                    securityHeaders[h.name.toLowerCase()] = h.value;
                }
            });
        }

        await dispatchLog('webRequest.headersReceived', {
            requestId: details.requestId,
            url: details.url,
            statusCode: details.statusCode,
            statusLine: details.statusLine,
            type: details.type,
            tabId: details.tabId,
            securityHeaders: securityHeaders,
        });
    },
    WEB_REQUEST_FILTER,
    ['responseHeaders']
);

/**
 * Request completed event
 */
chrome.webRequest.onCompleted.addListener(
    async (details) => {
        if (details.url.startsWith('chrome-extension://') ||
            details.url.startsWith('chrome://')) {
            return;
        }

        await dispatchLog('webRequest.completed', {
            requestId: details.requestId,
            url: details.url,
            statusCode: details.statusCode,
            type: details.type,
            tabId: details.tabId,
            fromCache: details.fromCache,
        });
    },
    WEB_REQUEST_FILTER
);

/**
 * Request error event
 */
chrome.webRequest.onErrorOccurred.addListener(
    async (details) => {
        await dispatchLog('webRequest.error', {
            requestId: details.requestId,
            url: details.url,
            error: details.error,
            type: details.type,
            tabId: details.tabId,
            initiator: details.initiator,
        });
    },
    WEB_REQUEST_FILTER
);

/**
 * Before redirect event
 */
chrome.webRequest.onBeforeRedirect.addListener(
    async (details) => {
        await dispatchLog('webRequest.redirect', {
            requestId: details.requestId,
            url: details.url,
            redirectUrl: details.redirectUrl,
            statusCode: details.statusCode,
            type: details.type,
            tabId: details.tabId,
        });
    },
    WEB_REQUEST_FILTER
);

// ============================================================================
// EXTENSION MANAGEMENT LISTENERS
// Security Relevance: Track extension changes that could affect security
// ============================================================================

/**
 * Extension installed event
 * Security Relevance: New extensions could be malicious
 */
chrome.management.onInstalled.addListener(async (info) => {
    await dispatchLog('extension.installed', {
        id: info.id,
        name: info.name,
        version: info.version,
        type: info.type,
        installType: info.installType,
        permissions: info.permissions,
    });
});

/**
 * Extension enabled event
 * Security Relevance: Previously disabled malicious extension re-enabled
 */
chrome.management.onEnabled.addListener(async (info) => {
    await dispatchLog('extension.enabled', {
        id: info.id,
        name: info.name,
        version: info.version,
    });
});

/**
 * Extension disabled event
 * Security Relevance: Security extension disabled could indicate compromise
 */
chrome.management.onDisabled.addListener(async (info) => {
    await dispatchLog('extension.disabled', {
        id: info.id,
        name: info.name,
        version: info.version,
    });
});

/**
 * Extension uninstalled event
 * Security Relevance: Track extension removal
 */
chrome.management.onUninstalled.addListener(async (id) => {
    await dispatchLog('extension.uninstalled', {
        id: id,
    });
});

// ============================================================================
// MESSAGE HANDLER FOR CONTENT SCRIPT COMMUNICATION
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOG_EVENT') {
        dispatchLog(message.eventType, message.payload, {
            tabId: sender.tab?.id,
            url: sender.tab?.url,
            frameId: sender.frameId,
        }).then(() => {
            sendResponse({ success: true });
        }).catch(e => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'LOG_BATCH') {
        (async () => {
            try {
                const results = [];
                for (const event of (message.events || [])) {
                    const result = await dispatchLog(event.eventType, event.payload, {
                        ...event.metadata,
                        tabId: sender.tab?.id,
                        url: sender.tab?.url,
                        frameId: sender.frameId,
                    });
                    results.push(result);
                }
                sendResponse({ success: true, count: results.length });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.type === 'GET_STATS') {
        // Fetch stats directly from the SQLite-backed Native Host
        nativeLogger.getStats().then(stats => {
            sendResponse(stats);
        });
        return true;
    }

    if (message.type === 'RECONNECT_HOST') {
        nativeLogger.init().then(connected => {
            sendResponse({ success: connected });
        });
        return true;
    }

    if (message.type === 'UPDATE_CONFIG') {
        (async () => {
            try {
                if (message.config.dbFile !== undefined) {
                    await nativeLogger.setConfig({ dbFile: message.config.dbFile });
                }
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }
});

// Log service worker activation
console.log('[OpenBDR] Background service worker loaded');
