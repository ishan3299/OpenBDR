/**
 * OpenBDR - Utility Functions
 * Shared utilities for URL parsing, pattern detection, and event normalization.
 * Security Relevance: Provides foundation for threat indicators and data normalization.
 */

// Suspicious URL patterns commonly associated with phishing/malware
const SUSPICIOUS_PATTERNS = [
    /data:text\/html/i,                    // Data URL HTML (potential XSS)
    /javascript:/i,                         // JavaScript protocol (XSS vector)
    /vbscript:/i,                           // VBScript protocol (legacy XSS)
    /\.exe(\?|$)/i,                         // Executable downloads
    /\.scr(\?|$)/i,                         // Screensaver files (malware)
    /\.bat(\?|$)/i,                         // Batch files
    /\.cmd(\?|$)/i,                         // Command files
    /\.ps1(\?|$)/i,                         // PowerShell scripts
    /\.vbs(\?|$)/i,                         // VBScript files
    /\.hta(\?|$)/i,                         // HTML Applications
    /\.msi(\?|$)/i,                         // Installer packages
    /login.*\.(php|asp|aspx|jsp)/i,         // Fake login pages
    /verify.*account/i,                     // Account verification phishing
    /secure.*update/i,                      // Fake security updates
    /base64[,;]/i,                          // Base64 encoded content
    /@.*@/,                                 // URL with multiple @ signs (obfuscation)
    /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/, // IP-based URLs
    /xn--/i,                                // Punycode/IDN homograph attacks
    /%[0-9a-f]{2}.*%[0-9a-f]{2}/i,          // Heavy URL encoding
];

// High-risk TLDs often used in attacks
const SUSPICIOUS_TLDS = [
    '.tk', '.ml', '.ga', '.cf', '.gq',      // Free domains
    '.xyz', '.top', '.work', '.click',      // Commonly abused
    '.zip', '.mov',                         // File extension TLDs (confusion attacks)
];

/**
 * Parse a URL into its components
 * Security Relevance: Enables analysis of URL structure for threat detection
 */
function parseUrl(urlString) {
    try {
        const url = new URL(urlString);
        return {
            full: urlString,
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || getDefaultPort(url.protocol),
            pathname: url.pathname,
            search: url.search,
            hash: url.hash,
            origin: url.origin,
            domain: extractDomain(url.hostname),
            tld: extractTld(url.hostname),
            queryParams: Object.fromEntries(url.searchParams),
        };
    } catch (e) {
        return {
            full: urlString,
            error: 'Invalid URL',
            raw: urlString,
        };
    }
}

/**
 * Get default port for protocol
 */
function getDefaultPort(protocol) {
    const ports = {
        'http:': '80',
        'https:': '443',
        'ftp:': '21',
        'ws:': '80',
        'wss:': '443',
    };
    return ports[protocol] || '';
}

/**
 * Extract registrable domain from hostname
 */
function extractDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    // Simple extraction - last two parts (doesn't handle co.uk etc.)
    return parts.slice(-2).join('.');
}

/**
 * Extract TLD from hostname
 */
function extractTld(hostname) {
    const parts = hostname.split('.');
    return parts.length > 0 ? '.' + parts[parts.length - 1] : '';
}

/**
 * Detect suspicious patterns in a URL
 * Security Relevance: Identifies potential threats like phishing, malware downloads
 */
function detectSuspiciousUrl(urlString) {
    const findings = [];

    // Check against regex patterns
    SUSPICIOUS_PATTERNS.forEach((pattern, index) => {
        if (pattern.test(urlString)) {
            findings.push({
                type: 'pattern_match',
                pattern: pattern.toString(),
                severity: 'medium',
            });
        }
    });

    // Check for suspicious TLDs
    try {
        const url = new URL(urlString);
        const tld = extractTld(url.hostname);
        if (SUSPICIOUS_TLDS.includes(tld.toLowerCase())) {
            findings.push({
                type: 'suspicious_tld',
                tld: tld,
                severity: 'low',
            });
        }

        // Check for excessively long URLs (potential buffer overflow/obfuscation)
        if (urlString.length > 2000) {
            findings.push({
                type: 'excessive_length',
                length: urlString.length,
                severity: 'low',
            });
        }

        // Check for many subdomains (potential evasion)
        const subdomainCount = url.hostname.split('.').length - 2;
        if (subdomainCount > 3) {
            findings.push({
                type: 'excessive_subdomains',
                count: subdomainCount,
                severity: 'low',
            });
        }
    } catch (e) {
        findings.push({
            type: 'invalid_url',
            severity: 'high',
        });
    }

    return {
        isSuspicious: findings.length > 0,
        findings: findings,
    };
}

/**
 * Generate ISO 8601 UTC timestamp
 * Security Relevance: Consistent timestamps for log correlation across systems
 */
function getTimestamp() {
    return new Date().toISOString();
}

/**
 * Generate a unique event ID
 * Security Relevance: Enables event deduplication and correlation
 */
function generateEventId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sanitize sensitive data from objects
 * Security Relevance: Prevents logging of passwords/tokens
 */
function sanitizePayload(obj, sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credential']) {
    if (typeof obj !== 'object' || obj === null) return obj;

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const lowerKey = key.toLowerCase();
            const isSensitive = sensitiveKeys.some(sk => lowerKey.includes(sk));

            if (isSensitive) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof obj[key] === 'object') {
                sanitized[key] = sanitizePayload(obj[key], sensitiveKeys);
            } else {
                sanitized[key] = obj[key];
            }
        }
    }

    return sanitized;
}

/**
 * Check if URL is internal/extension URL
 * Security Relevance: Filter out non-relevant internal browser pages
 */
function isInternalUrl(urlString) {
    if (!urlString) return true;
    const internalPrefixes = [
        'chrome://',
        'chrome-extension://',
        'edge://',
        'about:',
        'moz-extension://',
        'file://',
    ];
    return internalPrefixes.some(prefix => urlString.startsWith(prefix));
}

/**
 * Normalize headers object
 * Security Relevance: Standardize header format for analysis
 */
function normalizeHeaders(headers) {
    if (!headers) return {};
    if (Array.isArray(headers)) {
        const normalized = {};
        headers.forEach(h => {
            if (h.name && h.value) {
                normalized[h.name.toLowerCase()] = h.value;
            }
        });
        return normalized;
    }
    return headers;
}

// Export for use in content scripts (if not in module context)
if (typeof window !== 'undefined') {
    window.OpenBDRUtils = {
        parseUrl,
        detectSuspiciousUrl,
        getTimestamp,
        generateEventId,
        sanitizePayload,
        isInternalUrl,
        normalizeHeaders,
    };
}

// Export for ES modules (background service worker)
if (typeof globalThis !== 'undefined') {
    globalThis.OpenBDRUtils = {
        parseUrl,
        detectSuspiciousUrl,
        getTimestamp,
        generateEventId,
        sanitizePayload,
        isInternalUrl,
        normalizeHeaders,
    };
}
