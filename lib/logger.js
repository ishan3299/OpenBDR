/**
 * OpenBDR - Partitioned Logging Module
 * Implements Hive-style partitioned file logging with hourly partitions and size-based rotation.
 * Security Relevance: Provides SIEM-compatible telemetry output for security analysis.
 * 
 * Partition structure: openbdr_logs/year=YYYY/month=MM/day=DD/hour=HH/events_NNN.jsonl
 */

// Configuration
const CONFIG_KEY = 'openbdr_config';
const EVENTS_KEY = 'openbdr_events';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const FLUSH_THRESHOLD_BYTES = 45 * 1024 * 1024; // Flush at 45MB to be safe
const DEFAULT_OUTPUT_DIR = 'openbdr_logs';

/**
 * Logger class for managing partitioned telemetry events
 */
class OpenBDRLogger {
    constructor() {
        this.eventBuffer = [];
        this.currentBufferSize = 0;
        this.initialized = false;
        this.config = {
            outputDir: DEFAULT_OUTPUT_DIR,
            autoFlush: true,
            currentPartition: null,
            fileSequence: 1,
        };
        this.lastFlushHour = null;
    }

    /**
     * Initialize the logger
     */
    async init() {
        if (this.initialized) return;

        try {
            // Load config
            const configResult = await chrome.storage.local.get([CONFIG_KEY]);
            if (configResult[CONFIG_KEY]) {
                this.config = { ...this.config, ...configResult[CONFIG_KEY] };
            }

            // Load any pending events from storage
            const eventsResult = await chrome.storage.local.get([EVENTS_KEY]);
            if (eventsResult[EVENTS_KEY]) {
                this.eventBuffer = eventsResult[EVENTS_KEY];
                this.currentBufferSize = JSON.stringify(this.eventBuffer).length;
            }
        } catch (e) {
            console.error('[OpenBDR] Failed to load state:', e);
        }

        // Set up hourly alarm for auto-flush
        this.setupAutoFlush();

        this.initialized = true;
        console.log('[OpenBDR] Partitioned logger initialized');
    }

    /**
     * Set up hourly auto-flush alarm
     */
    setupAutoFlush() {
        try {
            // Create alarm for hourly flush
            chrome.alarms.create('openbdr_hourly_flush', {
                periodInMinutes: 60,
                delayInMinutes: 1, // First alarm in 1 minute for testing
            });
        } catch (e) {
            console.warn('[OpenBDR] Could not set up alarms:', e);
        }
    }

    /**
     * Generate Hive-style partition path
     * Format: year=YYYY/month=MM/day=DD/hour=HH
     */
    getPartitionPath(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');

        return `year=${year}/month=${month}/day=${day}/hour=${hour}`;
    }

    /**
     * Get current partition key for comparing partitions
     */
    getPartitionKey(date = new Date()) {
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    }

    /**
     * Check if we need to start a new partition
     */
    checkPartitionChange() {
        const currentKey = this.getPartitionKey();

        if (this.config.currentPartition !== currentKey) {
            // New partition - reset sequence
            this.config.fileSequence = 1;
            this.config.currentPartition = currentKey;
            this.saveConfig();
        }
    }

    /**
     * Generate full filename for download
     */
    getFilename() {
        const partition = this.getPartitionPath();
        const sequence = String(this.config.fileSequence).padStart(3, '0');
        return `${this.config.outputDir}/${partition}/events_${sequence}.jsonl`;
    }

    /**
     * Log a telemetry event
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

        const eventJson = JSON.stringify(event);
        const eventSize = eventJson.length + 1; // +1 for newline

        this.eventBuffer.push(event);
        this.currentBufferSize += eventSize;

        // Check if we need to flush due to size
        if (this.currentBufferSize >= FLUSH_THRESHOLD_BYTES) {
            await this.flushToFile('size_limit');
        } else {
            // Just save to local storage as backup
            await this.saveToStorage();
        }

        return event;
    }

    /**
     * Generate unique event ID
     */
    generateEventId() {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Save events to local storage (backup)
     */
    async saveToStorage() {
        try {
            // Only keep last 500 events in storage as backup
            const eventsToSave = this.eventBuffer.slice(-500);
            await chrome.storage.local.set({ [EVENTS_KEY]: eventsToSave });
        } catch (e) {
            // Ignore quota errors for backup storage
            if (!e.message?.includes('quota')) {
                console.warn('[OpenBDR] Storage warning:', e);
            }
        }
    }

    /**
     * Save config to storage
     */
    async saveConfig() {
        try {
            await chrome.storage.local.set({ [CONFIG_KEY]: this.config });
        } catch (e) {
            console.error('[OpenBDR] Failed to save config:', e);
        }
    }

    /**
     * Flush events to file via download
     */
    async flushToFile(reason = 'manual') {
        if (this.eventBuffer.length === 0) {
            console.log('[OpenBDR] No events to flush');
            return null;
        }

        this.checkPartitionChange();

        const filename = this.getFilename();
        const jsonl = this.eventBuffer.map(e => JSON.stringify(e)).join('\n');

        console.log(`[OpenBDR] Flushing ${this.eventBuffer.length} events (${(this.currentBufferSize / 1024 / 1024).toFixed(2)}MB) - reason: ${reason}`);

        try {
            // Use data URL for download
            const base64 = btoa(unescape(encodeURIComponent(jsonl)));
            const dataUrl = `data:application/x-jsonlines;base64,${base64}`;

            await chrome.downloads.download({
                url: dataUrl,
                filename: filename,
                conflictAction: 'uniquify', // Auto-rename if file exists
            });

            console.log(`[OpenBDR] Downloaded: ${filename}`);

            // Increment file sequence for next flush in same partition
            this.config.fileSequence++;
            await this.saveConfig();

            // Clear buffer
            this.eventBuffer = [];
            this.currentBufferSize = 0;
            await chrome.storage.local.remove([EVENTS_KEY]);

            return filename;
        } catch (e) {
            console.error('[OpenBDR] Failed to flush to file:', e);
            return null;
        }
    }

    /**
     * Update output directory config
     */
    async setOutputDir(dir) {
        this.config.outputDir = dir || DEFAULT_OUTPUT_DIR;
        await this.saveConfig();
    }

    /**
     * Toggle auto-flush
     */
    async setAutoFlush(enabled) {
        this.config.autoFlush = enabled;
        await this.saveConfig();
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
     * Export events as JSON Lines string
     */
    exportAsJsonl() {
        return this.eventBuffer.map(e => JSON.stringify(e)).join('\n');
    }

    /**
     * Clear all events (without downloading)
     */
    async clear() {
        this.eventBuffer = [];
        this.currentBufferSize = 0;
        await chrome.storage.local.remove([EVENTS_KEY]);
        console.log('[OpenBDR] All events cleared');
    }

    /**
     * Get storage statistics
     */
    async getStats() {
        return {
            eventCount: this.eventBuffer.length,
            bufferSizeBytes: this.currentBufferSize,
            bufferSizeMB: (this.currentBufferSize / 1024 / 1024).toFixed(2),
            currentPartition: this.getPartitionPath(),
            outputDir: this.config.outputDir,
            fileSequence: this.config.fileSequence,
            autoFlush: this.config.autoFlush,
            flushThresholdMB: (FLUSH_THRESHOLD_BYTES / 1024 / 1024).toFixed(0),
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

    /**
     * Get config
     */
    getConfig() {
        return { ...this.config };
    }
}

// Singleton instance
const logger = new OpenBDRLogger();
