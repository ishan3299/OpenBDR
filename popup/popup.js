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

    const connectedClass = stats.connected ? 'status-connected' : 'status-fallback';
    const statusText = stats.connected ? '● SQLite (Connected)' : '● Offline (Buffering)';

    contentEl.innerHTML = `
    <div class="connection-status">
      <span class="${connectedClass}">${statusText}</span>
      <span class="status-size">${stats.bufferedEvents || 0} buffered</span>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card full">
        <div class="stat-value">${stats.totalEvents || 0}</div>
        <div class="stat-label">Total Events in SQLite</div>
      </div>
    </div>
    
    <div class="partition-info">
      <div class="label">Database Location</div>
      <div class="path">${stats.dbFile || '~/.openbdr/openbdr.db'}</div>
    </div>
    
    <div class="settings-section">
      <h3>Settings</h3>
      <div class="setting-row">
        <span class="setting-label">Database Path</span>
        <input type="text" id="dbFile" class="setting-input" 
               value="${stats.dbFile || ''}" 
               placeholder="~/.openbdr/openbdr.db">
      </div>
    </div>
    
    <div class="event-types">
      <h3>Session Breakdown</h3>
      ${eventTypesHtml}
    </div>
    
    <div class="actions">
      <button id="reconnectBtn" class="btn-primary">Reconnect Host</button>
      <button id="saveBtn" class="btn-secondary">Update Path</button>
    </div>
  `;

    // Setup event listeners
    setupEventListeners();
}

/**
 * Setup button event listeners
 */
function setupEventListeners() {
    // Reconnect button
    document.getElementById('reconnectBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('reconnectBtn');
        btn.textContent = 'Connecting...';
        btn.disabled = true;

        try {
            const result = await chrome.runtime.sendMessage({ type: 'RECONNECT_HOST' });
            if (result?.success) {
                btn.textContent = 'Connected!';
                setTimeout(() => location.reload(), 1000);
            } else {
                btn.textContent = 'Failed to Connect';
                setTimeout(() => { btn.textContent = 'Reconnect Host'; btn.disabled = false; }, 2000);
            }
        } catch (e) {
            btn.textContent = 'Error';
            setTimeout(() => { btn.textContent = 'Reconnect Host'; btn.disabled = false; }, 2000);
        }
    });

    // Save Settings button
    document.getElementById('saveBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('saveBtn');
        const dbFile = document.getElementById('dbFile')?.value;

        btn.textContent = 'Updating...';

        try {
            await chrome.runtime.sendMessage({
                type: 'UPDATE_CONFIG',
                config: { dbFile }
            });
            btn.textContent = 'Updated!';
            setTimeout(() => location.reload(), 1500);
        } catch (e) {
            btn.textContent = 'Error';
            setTimeout(() => { btn.textContent = 'Update Path'; }, 1500);
        }
    });
}
