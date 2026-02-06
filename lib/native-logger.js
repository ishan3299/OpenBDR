/**
 * OpenBDR - Native Messaging Logger Client
 * Communicates with the native host for direct file system access.
 * Falls back to chrome.downloads API if native host is unavailable.
 */

const NATIVE_HOST_NAME = 'com.openbdr.host';

/**
 * Native Logger class that communicates with the Python host
 */
class NativeLogger {
    constructor() {
        this.port = null;
        this.connected = false;
        this.pendingMessages = [];
        this.eventBuffer = [];
        this.messageId = 0;
        this.callbacks = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.status = {
            connected: false,
            logDir: null,
            currentFile: null,
            currentSize: 0,
            currentPartition: null
        };
    }

    /**
     * Initialize connection to native host
     */
    async init() {
        return this.connect();
    }

    /**
     * Connect to native host
     */
    connect() {
        return new Promise((resolve) => {
            try {
                this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

                this.port.onMessage.addListener((message) => {
                    this.handleMessage(message);
                });

                this.port.onDisconnect.addListener(() => {
                    this.handleDisconnect();
                });

                // Send ping to verify connection
                this.sendMessage({ type: 'PING' })
                    .then((response) => {
                        if (response && response.pong) {
                            this.connected = true;
                            this.reconnectAttempts = 0;
                            console.log('[OpenBDR] Native host connected');

                            // Send session start
                            this.sendSessionStart();
                            resolve(true);
                        } else {
                            this.connected = false;
                            resolve(false);
                        }
                    })
                    .catch(() => {
                        this.connected = false;
                        resolve(false);
                    });

            } catch (e) {
                console.warn('[OpenBDR] Native host connection failed:', e);
                this.connected = false;
                resolve(false);
            }
        });
    }

    /**
     * Handle incoming message from native host
     */
    handleMessage(message) {
        // Check if this is a response to a pending request
        if (message._id && this.callbacks.has(message._id)) {
            const callback = this.callbacks.get(message._id);
            this.callbacks.delete(message._id);
            callback(message);
        }

        // Update status if returned
        if (message.currentFile !== undefined) {
            this.status.currentFile = message.currentFile;
        }
        if (message.currentSize !== undefined) {
            this.status.currentSize = message.currentSize;
        }
        if (message.logDir !== undefined) {
            this.status.logDir = message.logDir;
        }
        if (message.currentPartition !== undefined) {
            this.status.currentPartition = message.currentPartition;
        }
    }

    /**
     * Handle disconnect from native host
     */
    handleDisconnect() {
        const error = chrome.runtime.lastError;
        console.warn('[OpenBDR] Native host disconnected:', error?.message || 'Unknown error');

        this.connected = false;
        this.port = null;
        this.status.connected = false;

        // Try to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[OpenBDR] Attempting reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
        } else {
            console.warn('[OpenBDR] Max reconnect attempts reached, falling back to downloads API');
        }
    }

    /**
     * Send message to native host with callback
     */
    sendMessage(message) {
        return new Promise((resolve, reject) => {
            if (!this.port) {
                reject(new Error('Not connected to native host'));
                return;
            }

            const id = ++this.messageId;
            message._id = id;

            // Set timeout for response
            const timeout = setTimeout(() => {
                this.callbacks.delete(id);
                reject(new Error('Timeout waiting for native host response'));
            }, 5000);

            this.callbacks.set(id, (response) => {
                clearTimeout(timeout);
                resolve(response);
            });

            try {
                this.port.postMessage(message);
            } catch (e) {
                clearTimeout(timeout);
                this.callbacks.delete(id);
                reject(e);
            }
        });
    }

    /**
     * Send session start event
     */
    async sendSessionStart() {
        try {
            const response = await this.sendMessage({
                type: 'SESSION_START',
                payload: {
                    extensionVersion: chrome.runtime.getManifest().version,
                    browserInfo: navigator.userAgent,
                    startTime: new Date().toISOString()
                }
            });
            console.log('[OpenBDR] Session started, logging to:', response.file);
            return response;
        } catch (e) {
            console.error('[OpenBDR] Failed to send session start:', e);
            return null;
        }
    }

    /**
     * Send session end event
     */
    async sendSessionEnd() {
        if (!this.connected) return;

        try {
            // Flush any buffered events first
            if (this.eventBuffer.length > 0) {
                await this.flushBuffer();
            }

            await this.sendMessage({
                type: 'SESSION_END',
                payload: {
                    endTime: new Date().toISOString()
                }
            });
            console.log('[OpenBDR] Session ended');
        } catch (e) {
            console.error('[OpenBDR] Failed to send session end:', e);
        }
    }

    /**
     * Log an event
     */
    async log(eventType, payload, metadata = {}) {
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

        if (this.connected) {
            // Send directly to native host
            try {
                await this.sendMessage({
                    type: 'LOG_EVENT',
                    event: event
                });
            } catch (e) {
                // Buffer for later
                this.eventBuffer.push(event);
            }
        } else {
            // Buffer events when not connected
            this.eventBuffer.push(event);

            // Limit buffer size
            if (this.eventBuffer.length > 1000) {
                this.eventBuffer = this.eventBuffer.slice(-500);
            }
        }

        return event;
    }

    /**
     * Flush buffered events to native host
     */
    async flushBuffer() {
        if (!this.connected || this.eventBuffer.length === 0) return;

        try {
            const events = [...this.eventBuffer];
            await this.sendMessage({
                type: 'LOG_BATCH',
                events: events
            });
            this.eventBuffer = [];
            console.log(`[OpenBDR] Flushed ${events.length} buffered events`);
        } catch (e) {
            console.error('[OpenBDR] Failed to flush buffer:', e);
        }
    }

    /**
     * Generate unique event ID
     */
    generateEventId() {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Get current event count in buffer
     */
    getEventCount() {
        return this.eventBuffer.length;
    }

    /**
     * Get stats from native host
     */
    async getStats() {
        let stats = {
            connected: this.connected,
            eventCount: this.eventBuffer.length,
            bufferedEvents: this.eventBuffer.length,
            ...this.status
        };

        if (this.connected) {
            try {
                const response = await this.sendMessage({ type: 'GET_STATUS' });
                this.status = { ...this.status, ...response };
                stats = { ...stats, ...response };
            } catch (e) {
                console.error('[OpenBDR] Failed to get stats:', e);
            }
        }

        return stats;
    }

    /**
     * Update configuration
     */
    async setConfig(config) {
        if (!this.connected) {
            throw new Error('Not connected to native host');
        }

        return this.sendMessage({
            type: 'SET_CONFIG',
            config: config
        });
    }

    /**
     * Check if connected to native host
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Clear buffered events
     */
    async clear() {
        this.eventBuffer = [];
        return Promise.resolve();
    }
}

// Singleton instance
const nativeLogger = new NativeLogger();
