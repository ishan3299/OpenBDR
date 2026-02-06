/**
 * OpenBDR - Content Script
 * Injected into web pages to monitor DOM, scripts, and security-relevant events.
 * Security Relevance: Provides deep page-level visibility for threat detection.
 */

// Ensure we don't run multiple times
if (!window.__OPENBDR_INITIALIZED__) {
    window.__OPENBDR_INITIALIZED__ = true;

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    /**
     * Send event to background script for logging
     * Checks if extension context is still valid before sending
     */
    function logEvent(eventType, payload) {
        // Check if extension context is still valid
        if (!chrome.runtime || !chrome.runtime.id) {
            // Extension was reloaded, stop trying to send messages
            return;
        }

        try {
            chrome.runtime.sendMessage({
                type: 'LOG_EVENT',
                eventType: eventType,
                payload: payload,
            });
        } catch (e) {
            // Extension context may be invalidated - this is normal after extension reload
            if (e.message && e.message.includes('Extension context invalidated')) {
                console.log('[OpenBDR] Extension reloaded, content script will stop logging');
                // Set flag to prevent future logging attempts
                window.__OPENBDR_INITIALIZED__ = false;
            } else {
                console.warn('[OpenBDR] Failed to log event:', e);
            }
        }
    }

    /**
     * Get current page context
     */
    function getPageContext() {
        return {
            url: window.location.href,
            hostname: window.location.hostname,
            pathname: window.location.pathname,
            protocol: window.location.protocol,
            referrer: document.referrer,
            title: document.title,
            isTop: window.self === window.top,
        };
    }

    // ============================================================================
    // DOM MUTATION OBSERVER
    // Security Relevance: Detect dynamic content injection, script additions
    // ============================================================================

    const mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            // Track added nodes
            mutation.addedNodes.forEach((node) => {
                // Script injection detection
                if (node.nodeName === 'SCRIPT') {
                    logEvent('dom.scriptInjected', {
                        src: node.src || null,
                        type: node.type || 'text/javascript',
                        async: node.async,
                        defer: node.defer,
                        hasInlineCode: !node.src && node.textContent?.length > 0,
                        inlineCodeLength: node.textContent?.length || 0,
                        ...getPageContext(),
                    });
                }

                // Iframe injection detection
                if (node.nodeName === 'IFRAME') {
                    logEvent('dom.iframeInjected', {
                        src: node.src || null,
                        sandbox: node.sandbox?.value || null,
                        allow: node.allow || null,
                        hidden: node.hidden || (node.style && node.style.display === 'none'),
                        ...getPageContext(),
                    });
                }

                // Object/Embed injection (plugin content)
                if (node.nodeName === 'OBJECT' || node.nodeName === 'EMBED') {
                    logEvent('dom.pluginInjected', {
                        type: node.nodeName.toLowerCase(),
                        data: node.data || node.src || null,
                        mimeType: node.type || null,
                        ...getPageContext(),
                    });
                }

                // Form injection
                if (node.nodeName === 'FORM') {
                    logEvent('dom.formInjected', {
                        action: node.action || null,
                        method: node.method || 'get',
                        enctype: node.enctype || null,
                        ...getPageContext(),
                    });
                }

                // Link injection (for external resources)
                if (node.nodeName === 'LINK') {
                    logEvent('dom.linkInjected', {
                        href: node.href || null,
                        rel: node.rel || null,
                        type: node.type || null,
                        ...getPageContext(),
                    });
                }
            });

            // Track attribute changes on sensitive elements
            if (mutation.type === 'attributes') {
                const target = mutation.target;
                if (target.nodeName === 'SCRIPT' ||
                    target.nodeName === 'IFRAME' ||
                    target.nodeName === 'FORM') {
                    logEvent('dom.attributeChanged', {
                        element: target.nodeName.toLowerCase(),
                        attribute: mutation.attributeName,
                        oldValue: mutation.oldValue,
                        newValue: target.getAttribute(mutation.attributeName),
                        ...getPageContext(),
                    });
                }
            }
        });
    });

    // Start observing when DOM is ready
    function startMutationObserver() {
        mutationObserver.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['src', 'href', 'action', 'data'],
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMutationObserver);
    } else {
        startMutationObserver();
    }

    // ============================================================================
    // FORM SUBMISSION MONITORING
    // Security Relevance: Detect credential harvesting, form-based attacks
    // ============================================================================

    document.addEventListener('submit', (event) => {
        const form = event.target;
        if (form.tagName !== 'FORM') return;

        // Collect form field types (not values - privacy)
        const fields = Array.from(form.elements).map(el => ({
            name: el.name || null,
            type: el.type || el.tagName.toLowerCase(),
            id: el.id || null,
        }));

        // Check for sensitive fields
        const hasPasswordField = fields.some(f => f.type === 'password');
        const hasEmailField = fields.some(f =>
            f.type === 'email' ||
            (f.name && f.name.toLowerCase().includes('email'))
        );

        logEvent('security.formSubmit', {
            action: form.action || window.location.href,
            method: form.method || 'get',
            fieldCount: fields.length,
            fieldTypes: fields,
            hasPasswordField: hasPasswordField,
            hasEmailField: hasEmailField,
            isCrossSite: form.action && !form.action.startsWith(window.location.origin),
            ...getPageContext(),
        });
    }, true);

    // ============================================================================
    // CLIPBOARD MONITORING
    // Security Relevance: Detect clipboard hijacking, data exfiltration
    // ============================================================================

    document.addEventListener('copy', () => {
        logEvent('security.clipboardCopy', {
            ...getPageContext(),
        });
    }, true);

    document.addEventListener('cut', () => {
        logEvent('security.clipboardCut', {
            ...getPageContext(),
        });
    }, true);

    document.addEventListener('paste', () => {
        logEvent('security.clipboardPaste', {
            ...getPageContext(),
        });
    }, true);

    // ============================================================================
    // FILE UPLOAD MONITORING
    // Security Relevance: Track file uploads for data exfiltration detection
    // ============================================================================

    document.addEventListener('change', (event) => {
        const target = event.target;
        if (target.type === 'file' && target.files) {
            const files = Array.from(target.files).map(f => ({
                name: f.name,
                size: f.size,
                type: f.type || 'unknown',
                lastModified: f.lastModified,
            }));

            logEvent('security.fileUpload', {
                fileCount: files.length,
                files: files,
                inputName: target.name || null,
                inputId: target.id || null,
                formAction: target.form?.action || null,
                ...getPageContext(),
            });
        }
    }, true);

    // ============================================================================
    // LINK CLICK MONITORING
    // Security Relevance: Track navigation patterns, detect suspicious links
    // ============================================================================

    document.addEventListener('click', (event) => {
        // Find closest anchor element
        let target = event.target;
        while (target && target.tagName !== 'A') {
            target = target.parentElement;
        }

        if (target && target.tagName === 'A' && target.href) {
            const href = target.href;

            // Check for suspicious patterns
            const isSuspicious =
                href.startsWith('javascript:') ||
                href.startsWith('data:') ||
                href.includes('base64');

            logEvent('navigation.linkClick', {
                href: href,
                text: target.textContent?.substring(0, 100) || null,
                target: target.target || null,
                rel: target.rel || null,
                isSuspicious: isSuspicious,
                isExternal: !href.startsWith(window.location.origin),
                ...getPageContext(),
            });
        }
    }, true);

    // ============================================================================
    // KEYBOARD EVENT MONITORING (LIMITED)
    // Security Relevance: Detect keylogger-like behavior (we just count, not log keys)
    // ============================================================================

    let keyPressCount = 0;
    let lastKeyLogTime = 0;

    document.addEventListener('keydown', () => {
        keyPressCount++;

        // Log aggregate every 30 seconds if there's activity
        const now = Date.now();
        if (now - lastKeyLogTime > 30000 && keyPressCount > 0) {
            logEvent('activity.keyboardActivity', {
                keyPressCount: keyPressCount,
                intervalMs: now - lastKeyLogTime,
                ...getPageContext(),
            });
            keyPressCount = 0;
            lastKeyLogTime = now;
        }
    }, true);

    // ============================================================================
    // FOCUS/BLUR MONITORING
    // Security Relevance: Detect focus hijacking, tab-napping
    // ============================================================================

    window.addEventListener('focus', () => {
        logEvent('window.focus', {
            ...getPageContext(),
        });
    });

    window.addEventListener('blur', () => {
        logEvent('window.blur', {
            ...getPageContext(),
        });
    });

    // ============================================================================
    // VISIBILITY CHANGE MONITORING
    // Security Relevance: Detect background tab activity
    // ============================================================================

    document.addEventListener('visibilitychange', () => {
        logEvent('document.visibilityChange', {
            visibilityState: document.visibilityState,
            hidden: document.hidden,
            ...getPageContext(),
        });
    });

    // ============================================================================
    // ERROR MONITORING
    // Security Relevance: JavaScript errors may indicate injection attempts
    // ============================================================================

    window.addEventListener('error', (event) => {
        logEvent('security.jsError', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            ...getPageContext(),
        });
    });

    // ============================================================================
    // CSP VIOLATION MONITORING
    // Security Relevance: CSP violations indicate potential XSS or policy issues
    // ============================================================================

    document.addEventListener('securitypolicyviolation', (event) => {
        logEvent('security.cspViolation', {
            blockedURI: event.blockedURI,
            violatedDirective: event.violatedDirective,
            effectiveDirective: event.effectiveDirective,
            originalPolicy: event.originalPolicy,
            disposition: event.disposition,
            statusCode: event.statusCode,
            ...getPageContext(),
        });
    });

    // ============================================================================
    // MIXED CONTENT DETECTION
    // Security Relevance: Mixed content weakens HTTPS security
    // ============================================================================

    if (window.location.protocol === 'https:') {
        // Check for HTTP resources loaded over HTTPS
        const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                if (entry.name.startsWith('http://')) {
                    logEvent('security.mixedContent', {
                        resourceUrl: entry.name,
                        initiatorType: entry.initiatorType,
                        ...getPageContext(),
                    });
                }
            });
        });

        try {
            observer.observe({ entryTypes: ['resource'] });
        } catch (e) {
            // PerformanceObserver may not support 'resource' type
        }
    }

    // ============================================================================
    // DANGEROUS API USAGE DETECTION
    // Security Relevance: Detect potential XSS vectors
    // ============================================================================

    // Monitor document.write usage (often used in attacks)
    const originalDocWrite = document.write.bind(document);
    document.write = function (...args) {
        logEvent('security.documentWrite', {
            contentLength: args.join('').length,
            ...getPageContext(),
        });
        return originalDocWrite(...args);
    };

    const originalDocWriteln = document.writeln.bind(document);
    document.writeln = function (...args) {
        logEvent('security.documentWriteln', {
            contentLength: args.join('').length,
            ...getPageContext(),
        });
        return originalDocWriteln(...args);
    };

    // ============================================================================
    // INITIAL PAGE LOAD LOG
    // Security Relevance: Baseline context for all subsequent events
    // ============================================================================

    logEvent('page.load', {
        ...getPageContext(),
        documentReadyState: document.readyState,
        documentMode: document.documentMode || null,
        characterSet: document.characterSet,
        contentType: document.contentType,
        lastModified: document.lastModified,
        scripts: document.scripts.length,
        forms: document.forms.length,
        images: document.images.length,
        links: document.links.length,
        frames: window.frames.length,
    });

    console.log('[OpenBDR] Content script initialized');
}
