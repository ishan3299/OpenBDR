/**
 * OpenBDR - Logging Module
 * Handles structured JSON Lines logging with local storage persistence.
 * Security Relevance: Provides SIEM-compatible telemetry output for security analysis.
 */

// Maximum number of events to keep in storage (prevent unbounded growth)
const MAX_EVENTS = 10000;

// Storage key for events
const STORAGE_KEY = 'openbdr_events';

/**
 * Logger class for managing telemetry events
 */
class OpenBDRLogger {
    constructor() {
        this.eventBuffer = [];
        this.initialized = false;
    }

    /**
     * Initialize the logger
     */
    async init() {
        if (this.initialized) return;

        // Load existing events from storage
        try {
            const result = await chrome.storage.local.get([STORAGE_KEY]);
            this.eventBuffer = result[STORAGE_KEY] || [];
        } catch (e) {
            console.error('[OpenBDR] Failed to load events from storage:', e);
            this.eventBuffer = [];
        }

        this.initialized = true;
        console.log('[OpenBDR] Logger initialized with', this.eventBuffer.length, 'existing events');
    }

    /**
     * Log a telemetry event
     * @param {string} eventType - Category.action format (e.g., 'navigation.completed')
     * @param {object} payload - Event-specific data
     * @param {object} metadata - Additional context
     */
    async log(eventType, payload, metadata = {}) {
        const event = {
            timestamp: new Date().toISOString(),
            eventId: this.generateEventId(),
            eventType: eventType,
            payload: payload,
            metadata: {
                extensionVersion: chrome.runtime.getManifest().version,
                ...metadata,
            },
        };

        this.eventBuffer.push(event);

        // Trim buffer if too large
        if (this.eventBuffer.length > MAX_EVENTS) {
            this.eventBuffer = this.eventBuffer.slice(-MAX_EVENTS);
        }

        // Flush to storage
        await this.flush();

        return event;
    }

    /**
     * Generate unique event ID
     */
    generateEventId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Flush events to chrome.storage.local
     */
    async flush() {
        try {
            await chrome.storage.local.set({ [STORAGE_KEY]: this.eventBuffer });
        } catch (e) {
            console.error('[OpenBDR] Failed to flush events:', e);
        }
    }

    /**
     * Get current event count
     */
    getEventCount() {
        return this.eventBuffer.length;
    }

    /**
     * Get all events
     */
    getEvents() {
        return [...this.eventBuffer];
    }

    /**
     * Get events by type
     * @param {string} typePrefix - Event type prefix to filter by
     */
    getEventsByType(typePrefix) {
        return this.eventBuffer.filter(e => e.eventType.startsWith(typePrefix));
    }

    /**
     * Export events as JSON Lines string
     */
    exportAsJsonl() {
        return this.eventBuffer.map(e => JSON.stringify(e)).join('\n');
    }

    /**
     * Export events and trigger download
     */
    async exportToFile() {
        const jsonl = this.exportAsJsonl();
        const blob = new Blob([jsonl], { type: 'application/x-jsonlines' });
        const url = URL.createObjectURL(blob);

        const filename = `openbdr_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

        await chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true,
        });

        return filename;
    }

    /**
     * Clear all events
     */
    async clear() {
        this.eventBuffer = [];
        await chrome.storage.local.remove([STORAGE_KEY]);
        console.log('[OpenBDR] All events cleared');
    }

    /**
     * Get storage statistics
     */
    async getStats() {
        const jsonl = this.exportAsJsonl();
        return {
            eventCount: this.eventBuffer.length,
            storageBytes: new Blob([jsonl]).size,
            oldestEvent: this.eventBuffer.length > 0 ? this.eventBuffer[0].timestamp : null,
            newestEvent: this.eventBuffer.length > 0 ? this.eventBuffer[this.eventBuffer.length - 1].timestamp : null,
            eventTypes: this.getEventTypeCounts(),
        };
    }

    /**
     * Get counts by event type
     */
    getEventTypeCounts() {
        const counts = {};
        this.eventBuffer.forEach(e => {
            const type = e.eventType.split('.')[0];
            counts[type] = (counts[type] || 0) + 1;
        });
        return counts;
    }
}

// Singleton instance
const logger = new OpenBDRLogger();
