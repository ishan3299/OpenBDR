/**
 * OpenBDR - Background Service Worker
 * Central event listener hub for browser telemetry collection.
 * Security Relevance: Captures all major browser events for security monitoring.
 */

// Import other scripts (paths relative to extension root)
try {
    importScripts('/lib/logger.js', '/lib/telemetry.js');
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

    // Initialize logger
    await logger.init();

    // Collect and log browser environment info
    const browserInfo = await collectBrowserInfo();
    await logger.log('browser.info', browserInfo);

    // Log installed extensions
    const extensions = await getInstalledExtensions();
    await logger.log('browser.extensions', {
        count: extensions.length,
        extensions: extensions
    });

    // Log own permissions
    const permissions = await getOwnPermissions();
    await logger.log('browser.permissions', permissions);

    console.log('[OpenBDR] Initialization complete. Telemetry collection active.');
}

// Run initialization
initialize().catch(e => console.error('[OpenBDR] Init failed:', e));

// ============================================================================
// TAB EVENT LISTENERS
// Security Relevance: Track user navigation patterns, detect suspicious tab behaviors
// ============================================================================

/**
 * Tab created event
 * Security Relevance: New tabs may be spawned by malicious scripts
 */
chrome.tabs.onCreated.addListener(async (tab) => {
    await logger.log('tab.created', {
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
        await logger.log('tab.updated', {
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
    await logger.log('tab.removed', {
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
    await logger.log('tab.activated', {
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
    });
});

/**
 * Tab replaced event (prerender/instant navigation)
 * Security Relevance: Detect prerendering which could be used for tracking
 */
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
    await logger.log('tab.replaced', {
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
    await logger.log('window.created', {
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
    await logger.log('window.removed', {
        windowId: windowId,
    });
});

/**
 * Window focus changed event
 * Security Relevance: Focus hijacking detection
 */
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    await logger.log('window.focusChanged', {
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

    await logger.log('navigation.committed', {
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

    await logger.log('navigation.completed', {
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
    await logger.log('navigation.error', {
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

    await logger.log('navigation.beforeNavigate', {
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

    await logger.log('navigation.domContentLoaded', {
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
    await logger.log('navigation.historyStateUpdated', {
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
    await logger.log('navigation.referenceFragmentUpdated', {
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

    await logger.log('download.created', {
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
    await logger.log('download.changed', {
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
// Security Relevance: Network-level visibility for request analysis
// ============================================================================

/**
 * Before request event
 * Security Relevance: Capture all outgoing requests with method and type
 */
chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
        // Skip extension requests and high-volume internal requests
        if (details.url.startsWith('chrome-extension://') ||
            details.url.startsWith('chrome://')) {
            return;
        }

        await logger.log('webRequest.beforeRequest', {
            requestId: details.requestId,
            url: details.url,
            method: details.method,
            type: details.type,
            tabId: details.tabId,
            frameId: details.frameId,
            initiator: details.initiator,
        });
    },
    { urls: ['<all_urls>'] }
);

/**
 * Response headers received event
 * Security Relevance: Track response status, detect suspicious responses
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

        await logger.log('webRequest.headersReceived', {
            requestId: details.requestId,
            url: details.url,
            statusCode: details.statusCode,
            statusLine: details.statusLine,
            type: details.type,
            tabId: details.tabId,
            securityHeaders: securityHeaders,
        });
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
);

/**
 * Request completed event
 * Security Relevance: Track successful request completions
 */
chrome.webRequest.onCompleted.addListener(
    async (details) => {
        if (details.url.startsWith('chrome-extension://') ||
            details.url.startsWith('chrome://')) {
            return;
        }

        await logger.log('webRequest.completed', {
            requestId: details.requestId,
            url: details.url,
            statusCode: details.statusCode,
            type: details.type,
            tabId: details.tabId,
            fromCache: details.fromCache,
        });
    },
    { urls: ['<all_urls>'] }
);

/**
 * Request error event
 * Security Relevance: Track failed requests, detect blocked connections
 */
chrome.webRequest.onErrorOccurred.addListener(
    async (details) => {
        await logger.log('webRequest.error', {
            requestId: details.requestId,
            url: details.url,
            error: details.error,
            type: details.type,
            tabId: details.tabId,
            initiator: details.initiator,
        });
    },
    { urls: ['<all_urls>'] }
);

/**
 * Before redirect event
 * Security Relevance: Track redirect chains, detect suspicious redirects
 */
chrome.webRequest.onBeforeRedirect.addListener(
    async (details) => {
        await logger.log('webRequest.redirect', {
            requestId: details.requestId,
            url: details.url,
            redirectUrl: details.redirectUrl,
            statusCode: details.statusCode,
            type: details.type,
            tabId: details.tabId,
        });
    },
    { urls: ['<all_urls>'] }
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
    await logger.log('extension.installed', {
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
    await logger.log('extension.enabled', {
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
    await logger.log('extension.disabled', {
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
    await logger.log('extension.uninstalled', {
        id: id,
    });
});

// ============================================================================
// ALARM LISTENER FOR AUTO-FLUSH
// Security Relevance: Periodic telemetry export ensures data persistence
// ============================================================================

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'openbdr_hourly_flush') {
        logger.flushToFile('hourly').then(filename => {
            if (filename) {
                console.log(`[OpenBDR] Hourly flush completed: ${filename}`);
            }
        }).catch(e => {
            console.error('[OpenBDR] Hourly flush failed:', e);
        });
    }
});

// ============================================================================
// MESSAGE HANDLER FOR CONTENT SCRIPT COMMUNICATION
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOG_EVENT') {
        logger.log(message.eventType, message.payload, {
            tabId: sender.tab?.id,
            url: sender.tab?.url,
            frameId: sender.frameId,
        }).then(() => {
            sendResponse({ success: true });
        }).catch(e => {
            sendResponse({ success: false, error: e.message });
        });
        return true; // Keep channel open for async response
    }

    if (message.type === 'GET_STATS') {
        logger.getStats().then(stats => {
            sendResponse(stats);
        });
        return true;
    }

    if (message.type === 'FLUSH_NOW') {
        logger.flushToFile('manual').then(filename => {
            if (filename) {
                sendResponse({ success: true, filename });
            } else {
                sendResponse({ success: false, message: 'No events to flush' });
            }
        }).catch(e => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'UPDATE_CONFIG') {
        (async () => {
            try {
                if (message.config.outputDir !== undefined) {
                    await logger.setOutputDir(message.config.outputDir);
                }
                if (message.config.autoFlush !== undefined) {
                    await logger.setAutoFlush(message.config.autoFlush);
                }
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.type === 'CLEAR_LOGS') {
        logger.clear().then(() => {
            sendResponse({ success: true });
        }).catch(e => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'GET_EVENT_COUNT') {
        sendResponse({ count: logger.getEventCount() });
        return false;
    }
});

// Log service worker activation
console.log('[OpenBDR] Background service worker loaded');

