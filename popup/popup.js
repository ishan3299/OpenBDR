/**
 * OpenBDR - Popup Script
 * Handles popup UI for telemetry statistics and settings.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const contentEl = document.getElementById('content');

    try {
        // Get stats from background
        const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

        if (!stats) {
            throw new Error('Could not retrieve stats');
        }

        // Render the stats UI
        renderStats(stats);
    } catch (error) {
        contentEl.innerHTML = `
      <div class="error">
        <strong>Error</strong><br>
        Failed to load telemetry data
      </div>
    `;
        console.error('[OpenBDR Popup] Error:', error);
    }
});

/**
 * Render stats UI
 */
function renderStats(stats) {
    const contentEl = document.getElementById('content');

    // Format event types
    const eventTypesHtml = Object.entries(stats.eventTypes || {})
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `
      <div class="event-type-row">
        <span class="event-type-name">${type}</span>
        <span class="event-type-count">${count}</span>
      </div>
    `)
        .join('') || '<div class="event-type-row"><span class="event-type-name">No events yet</span></div>';

    contentEl.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.eventCount || 0}</div>
        <div class="stat-label">Events</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.bufferSizeMB || '0.00'} MB</div>
        <div class="stat-label">Buffer Size</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.fileSequence || 1}</div>
        <div class="stat-label">File #</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.flushThresholdMB || 45} MB</div>
        <div class="stat-label">Auto-Flush At</div>
      </div>
    </div>
    
    <div class="partition-info">
      <div class="label">Current Partition</div>
      <div class="path">${stats.outputDir || 'openbdr_logs'}/${stats.currentPartition || 'year=.../...'}</div>
    </div>
    
    <div class="settings-section">
      <h3>Settings</h3>
      <div class="setting-row">
        <span class="setting-label">Output Directory</span>
        <input type="text" id="outputDir" class="setting-input" 
               value="${stats.outputDir || 'openbdr_logs'}" 
               placeholder="openbdr_logs">
      </div>
      <div class="setting-row">
        <span class="setting-label">Auto-Flush (Hourly)</span>
        <div id="autoFlushToggle" class="toggle ${stats.autoFlush !== false ? 'active' : ''}"></div>
      </div>
    </div>
    
    <div class="event-types">
      <h3>Event Types</h3>
      ${eventTypesHtml}
    </div>
    
    <div class="actions">
      <button id="flushBtn" class="btn-primary">Flush Now</button>
      <button id="saveBtn" class="btn-secondary">Save Settings</button>
      <button id="clearBtn" class="btn-danger">Clear</button>
    </div>
  `;

    // Setup event listeners
    setupEventListeners();
}

/**
 * Setup button event listeners
 */
function setupEventListeners() {
    // Flush Now button
    document.getElementById('flushBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('flushBtn');
        btn.textContent = 'Flushing...';
        btn.disabled = true;

        try {
            const result = await chrome.runtime.sendMessage({ type: 'FLUSH_NOW' });
            if (result?.success) {
                btn.textContent = 'Flushed!';
                setTimeout(() => location.reload(), 1000);
            } else {
                btn.textContent = result?.message || 'No events';
                setTimeout(() => { btn.textContent = 'Flush Now'; btn.disabled = false; }, 2000);
            }
        } catch (e) {
            btn.textContent = 'Error';
            setTimeout(() => { btn.textContent = 'Flush Now'; btn.disabled = false; }, 2000);
        }
    });

    // Save Settings button
    document.getElementById('saveBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('saveBtn');
        const outputDir = document.getElementById('outputDir')?.value || 'openbdr_logs';
        const autoFlush = document.getElementById('autoFlushToggle')?.classList.contains('active');

        btn.textContent = 'Saving...';

        try {
            await chrome.runtime.sendMessage({
                type: 'UPDATE_CONFIG',
                config: { outputDir, autoFlush }
            });
            btn.textContent = 'Saved!';
            setTimeout(() => { btn.textContent = 'Save Settings'; }, 1500);
        } catch (e) {
            btn.textContent = 'Error';
            setTimeout(() => { btn.textContent = 'Save Settings'; }, 1500);
        }
    });

    // Clear button
    document.getElementById('clearBtn')?.addEventListener('click', async () => {
        if (!confirm('Clear all pending events? This cannot be undone.')) return;

        const btn = document.getElementById('clearBtn');
        btn.textContent = 'Clearing...';

        try {
            await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
            btn.textContent = 'Cleared!';
            setTimeout(() => location.reload(), 1000);
        } catch (e) {
            btn.textContent = 'Error';
            setTimeout(() => { btn.textContent = 'Clear'; }, 1500);
        }
    });

    // Auto-flush toggle
    document.getElementById('autoFlushToggle')?.addEventListener('click', function () {
        this.classList.toggle('active');
    });
}
