/**
 * OpenBDR - Telemetry Collection Module
 * Collects browser environment and system information.
 * Security Relevance: Provides context for threat analysis and incident response.
 */

/**
 * Collect comprehensive browser environment information
 * Security Relevance: Environment fingerprinting helps correlate events and detect anomalies
 */
async function collectBrowserInfo() {
    const ua = navigator.userAgent;

    return {
        // Browser identification
        browser: {
            name: detectBrowserName(ua),
            version: detectBrowserVersion(ua),
            engine: detectRenderingEngine(ua),
            userAgent: ua,
            vendor: navigator.vendor || 'unknown',
            language: navigator.language,
            languages: [...(navigator.languages || [])],
            cookiesEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack,
            online: navigator.onLine,
        },

        // Platform/OS information
        platform: {
            os: detectOS(ua),
            platform: navigator.platform || 'unknown',
            architecture: detectArchitecture(ua),
            mobile: /Mobile|Android|iPhone|iPad/i.test(ua),
            touchSupported: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
        },

        // Display information
        display: {
            screenWidth: screen.width,
            screenHeight: screen.height,
            availWidth: screen.availWidth,
            availHeight: screen.availHeight,
            colorDepth: screen.colorDepth,
            pixelDepth: screen.pixelDepth,
            devicePixelRatio: window.devicePixelRatio || 1,
        },

        // Time/locale information
        locale: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezoneOffset: new Date().getTimezoneOffset(),
            locale: Intl.DateTimeFormat().resolvedOptions().locale,
        },

        // Connection information (if available)
        connection: getConnectionInfo(),

        // Memory info (Chrome-specific)
        memory: getMemoryInfo(),

        // Collection timestamp
        collectedAt: new Date().toISOString(),
    };
}

/**
 * Detect browser name from user agent
 */
function detectBrowserName(ua) {
    if (ua.includes('Edg/')) return 'Microsoft Edge';
    if (ua.includes('Chrome/')) return 'Google Chrome';
    if (ua.includes('Firefox/')) return 'Mozilla Firefox';
    if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('Opera') || ua.includes('OPR/')) return 'Opera';
    if (ua.includes('MSIE') || ua.includes('Trident/')) return 'Internet Explorer';
    return 'Unknown';
}

/**
 * Detect browser version from user agent
 */
function detectBrowserVersion(ua) {
    const patterns = [
        /Edg\/(\d+[\.\d]*)/,
        /Chrome\/(\d+[\.\d]*)/,
        /Firefox\/(\d+[\.\d]*)/,
        /Version\/(\d+[\.\d]*).*Safari/,
        /OPR\/(\d+[\.\d]*)/,
        /MSIE (\d+[\.\d]*)/,
        /rv:(\d+[\.\d]*)/,
    ];

    for (const pattern of patterns) {
        const match = ua.match(pattern);
        if (match) return match[1];
    }
    return 'unknown';
}

/**
 * Detect rendering engine
 */
function detectRenderingEngine(ua) {
    if (ua.includes('AppleWebKit')) return 'WebKit/Blink';
    if (ua.includes('Gecko/')) return 'Gecko';
    if (ua.includes('Trident')) return 'Trident';
    if (ua.includes('Presto')) return 'Presto';
    return 'unknown';
}

/**
 * Detect operating system
 */
function detectOS(ua) {
    if (ua.includes('Windows NT 10.0')) return 'Windows 10/11';
    if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
    if (ua.includes('Windows NT 6.2')) return 'Windows 8';
    if (ua.includes('Windows NT 6.1')) return 'Windows 7';
    if (ua.includes('Mac OS X')) return 'macOS';
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    if (ua.includes('CrOS')) return 'Chrome OS';
    return 'unknown';
}

/**
 * Detect architecture (limited detection)
 */
function detectArchitecture(ua) {
    if (ua.includes('x64') || ua.includes('x86_64') || ua.includes('Win64') || ua.includes('WOW64')) {
        return 'x86_64';
    }
    if (ua.includes('arm64') || ua.includes('aarch64')) {
        return 'arm64';
    }
    if (ua.includes('arm')) {
        return 'arm';
    }
    return 'unknown';
}

/**
 * Get network connection information
 * Security Relevance: Network characteristics can indicate VPN/proxy usage
 */
function getConnectionInfo() {
    if (!navigator.connection) {
        return { available: false };
    }

    const conn = navigator.connection;
    return {
        available: true,
        effectiveType: conn.effectiveType || 'unknown',
        downlink: conn.downlink,
        rtt: conn.rtt,
        saveData: conn.saveData || false,
        type: conn.type || 'unknown',
    };
}

/**
 * Get memory information (Chrome-specific)
 * Security Relevance: Memory constraints might indicate sandboxed/restricted environment
 */
function getMemoryInfo() {
    if (!performance.memory) {
        return { available: false };
    }

    return {
        available: true,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        usedJSHeapSize: performance.memory.usedJSHeapSize,
    };
}

/**
 * Get list of installed extensions (requires management permission)
 * Security Relevance: Known malicious extensions, extensions that could interfere
 */
async function getInstalledExtensions() {
    try {
        const extensions = await chrome.management.getAll();
        return extensions.map(ext => ({
            id: ext.id,
            name: ext.name,
            version: ext.version,
            enabled: ext.enabled,
            type: ext.type,
            installType: ext.installType,
            mayDisable: ext.mayDisable,
            permissions: ext.permissions || [],
            hostPermissions: ext.hostPermissions || [],
        }));
    } catch (e) {
        console.warn('[OpenBDR] Cannot enumerate extensions:', e);
        return [];
    }
}

/**
 * Get extension's own permissions
 * Security Relevance: Document what telemetry collection is authorized
 */
async function getOwnPermissions() {
    try {
        const permissions = await chrome.permissions.getAll();
        return {
            permissions: permissions.permissions || [],
            origins: permissions.origins || [],
        };
    } catch (e) {
        return { error: e.message };
    }
}

// Export for ES modules
export {
    collectBrowserInfo,
    getInstalledExtensions,
    getOwnPermissions,
    detectBrowserName,
    detectBrowserVersion,
    detectOS,
};
