/**
 * OpenBDR - Browser-Only Logger with IndexedDB + Downloads API
 * 
 * Features:
 * - IndexedDB for unlimited event storage (no 10MB chrome.storage limit)
 * - chrome.downloads API for Hive-style partitioned exports
 * - Automatic hourly flush via chrome.alarms
 * - Size-based rotation (50MB threshold)
 * - Works entirely within the browser - no external dependencies
 */

const DB_NAME = 'openbdr_logs';
const DB_VERSION = 1;
const STORE_NAME = 'events';
const CONFIG_STORE = 'config';
const FLUSH_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50MB
const DEFAULT_OUTPUT_DIR = 'openbdr_logs';

/**
 * OpenBDR Logger using IndexedDB
 */
class OpenBDRLogger {
    constructor() {
        this.db = null;
        this.config = {
            outputDir: DEFAULT_OUTPUT_DIR,
            autoFlush: true,
            fileSequence: 1,
            currentPartition: null
        };
        this.currentBufferSize = 0;
        this.eventTypeCounts = {};
        this.initialized = false;
    }

    /**
     * Initialize the logger - open IndexedDB
     */
    async init() {
        if (this.initialized) return;

        try {
            this.db = await this.openDatabase();
            await this.loadConfig();
            await this.calculateBufferSize();
            this.setupAutoFlush();
            this.initialized = true;
            console.log('[OpenBDR] Logger initialized with IndexedDB');
        } catch (e) {
            console.error('[OpenBDR] Failed to initialize logger:', e);
            throw e;
        }
    }

    /**
     * Open IndexedDB database
     */
    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Events store with timestamp index
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'eventId' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('eventType', 'eventType', { unique: false });
                }

                // Config store
                if (!db.objectStoreNames.contains(CONFIG_STORE)) {
                    db.createObjectStore(CONFIG_STORE, { keyPath: 'key' });
                }
            };
        });
    }

    /**
     * Load configuration from IndexedDB
     */
    async loadConfig() {
        try {
            const tx = this.db.transaction(CONFIG_STORE, 'readonly');
            const store = tx.objectStore(CONFIG_STORE);
            const request = store.get('config');

            return new Promise((resolve) => {
                request.onsuccess = () => {
                    if (request.result) {
                        this.config = { ...this.config, ...request.result.value };
                    }
                    resolve();
                };
                request.onerror = () => resolve();
            });
        } catch (e) {
            console.warn('[OpenBDR] Could not load config:', e);
        }
    }

    /**
     * Save configuration to IndexedDB
     */
    async saveConfig() {
        try {
            const tx = this.db.transaction(CONFIG_STORE, 'readwrite');
            const store = tx.objectStore(CONFIG_STORE);
            store.put({ key: 'config', value: this.config });
            return new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error('[OpenBDR] Failed to save config:', e);
        }
    }

    /**
     * Calculate current buffer size from IndexedDB
     */
    async calculateBufferSize() {
        const events = await this.getAllEvents();
        this.currentBufferSize = 0;
        this.eventTypeCounts = {};

        for (const event of events) {
            const size = JSON.stringify(event).length;
            this.currentBufferSize += size;

            const type = event.eventType || 'unknown';
            this.eventTypeCounts[type] = (this.eventTypeCounts[type] || 0) + 1;
        }
    }

    /**
     * Setup auto-flush alarm
     */
    setupAutoFlush() {
        if (!this.config.autoFlush) return;

        try {
            chrome.alarms.create('openbdr_hourly_flush', {
                periodInMinutes: 60,
                delayInMinutes: 1 // First alarm in 1 minute for testing
            });
            console.log('[OpenBDR] Auto-flush alarm set (hourly)');
        } catch (e) {
            console.warn('[OpenBDR] Could not create alarm:', e);
        }
    }

    /**
     * Generate unique event ID
     */
    generateEventId() {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Get Hive-style partition path
     */
    getPartitionPath(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');

        return `year=${year}/month=${month}/day=${day}/hour=${hour}`;
    }

    /**
     * Get partition key for comparison
     */
    getPartitionKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}`;
    }

    /**
     * Check if partition has changed (new hour)
     */
    checkPartitionChange() {
        const currentKey = this.getPartitionKey();
        if (this.config.currentPartition && this.config.currentPartition !== currentKey) {
            // New partition - reset sequence
            this.config.fileSequence = 1;
            this.config.currentPartition = currentKey;
            this.saveConfig();
            return true;
        }
        if (!this.config.currentPartition) {
            this.config.currentPartition = currentKey;
            this.saveConfig();
        }
        return false;
    }

    /**
     * Get full filename for export
     */
    getFilename() {
        const partition = this.getPartitionPath();
        const sequence = String(this.config.fileSequence).padStart(3, '0');
        return `${this.config.outputDir}/${partition}/events_${sequence}.jsonl`;
    }

    /**
     * Log an event
     */
    async log(eventType, payload, metadata = {}) {
        if (!this.db) {
            await this.init();
        }

        const event = {
            timestamp: new Date().toISOString(),
            eventId: this.generateEventId(),
            eventType: eventType,
            payload: payload,
            metadata: {
                extensionVersion: chrome.runtime.getManifest().version,
                ...metadata
            }
        };

        // Store in IndexedDB
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.add(event);

        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

        // Update tracking
        const eventSize = JSON.stringify(event).length;
        this.currentBufferSize += eventSize;
        this.eventTypeCounts[eventType] = (this.eventTypeCounts[eventType] || 0) + 1;

        // Check if we need to flush
        if (this.currentBufferSize >= FLUSH_THRESHOLD_BYTES) {
            await this.flushToFile('size_limit');
        }

        return event;
    }

    /**
     * Get all events from IndexedDB
     */
    async getAllEvents() {
        const tx = this.db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get event count
     */
    async getEventCount() {
        const tx = this.db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.count();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Flush events to a downloadable file
     */
    async flushToFile(reason = 'manual') {
        this.checkPartitionChange();

        const events = await this.getAllEvents();
        if (events.length === 0) {
            console.log('[OpenBDR] No events to flush');
            return null;
        }

        // Convert to JSONL
        const jsonl = events.map(e => JSON.stringify(e)).join('\n');
        const filename = this.getFilename();

        try {
            // Create data URL for download
            const base64 = btoa(unescape(encodeURIComponent(jsonl)));
            const dataUrl = `data:application/x-jsonlines;base64,${base64}`;

            // Download the file
            await chrome.downloads.download({
                url: dataUrl,
                filename: filename,
                conflictAction: 'uniquify'
            });

            console.log(`[OpenBDR] Flushed ${events.length} events to: ${filename} (${reason})`);

            // Clear events from IndexedDB
            await this.clearEvents();

            // Update sequence for next file
            this.config.fileSequence++;
            await this.saveConfig();

            return filename;
        } catch (e) {
            console.error('[OpenBDR] Failed to flush:', e);
            throw e;
        }
    }

    /**
     * Clear all events from IndexedDB
     */
    async clearEvents() {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();

        await new Promise((resolve, reject) => {
            tx.oncomplete = () => {
                this.currentBufferSize = 0;
                this.eventTypeCounts = {};
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Clear all logs (alias for popup)
     */
    async clear() {
        await this.clearEvents();
        console.log('[OpenBDR] All events cleared');
    }

    /**
     * Set output directory
     */
    async setOutputDir(dir) {
        this.config.outputDir = dir || DEFAULT_OUTPUT_DIR;
        await this.saveConfig();
    }

    /**
     * Set auto-flush enabled
     */
    async setAutoFlush(enabled) {
        this.config.autoFlush = enabled;
        await this.saveConfig();

        if (enabled) {
            this.setupAutoFlush();
        } else {
            try {
                chrome.alarms.clear('openbdr_hourly_flush');
            } catch (e) { }
        }
    }

    /**
     * Get statistics
     */
    async getStats() {
        const eventCount = await this.getEventCount();

        return {
            eventCount: eventCount,
            bufferSizeBytes: this.currentBufferSize,
            bufferSizeMB: (this.currentBufferSize / 1024 / 1024).toFixed(2),
            currentPartition: this.getPartitionPath(),
            outputDir: this.config.outputDir,
            fileSequence: this.config.fileSequence,
            autoFlush: this.config.autoFlush,
            flushThresholdMB: (FLUSH_THRESHOLD_BYTES / 1024 / 1024).toFixed(0),
            eventTypes: this.eventTypeCounts,
            storageType: 'IndexedDB'
        };
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
