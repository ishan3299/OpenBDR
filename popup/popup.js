/**
 * OpenBDR - Popup Script
 * Handles popup UI interactions for telemetry management.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const contentDiv = document.getElementById('content');

    try {
        // Get stats from background script
        const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

        // Render stats UI
        renderStats(stats);
    } catch (e) {
        contentDiv.innerHTML = `
      <div class="stat-card full">
        <div class="stat-value" style="color: #ff4444;">Error</div>
        <div class="stat-label">Failed to load telemetry data</div>
      </div>
    `;
        console.error('[OpenBDR] Failed to get stats:', e);
    }
});

/**
 * Render statistics UI
 */
function renderStats(stats) {
    const contentDiv = document.getElementById('content');

    // Format storage size
    const storageSize = formatBytes(stats.storageBytes || 0);

    // Format time range
    const timeRange = formatTimeRange(stats.oldestEvent, stats.newestEvent);

    // Build event types list
    const eventTypesHtml = Object.entries(stats.eventTypes || {})
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `
      <div class="event-type-row">
        <span class="event-type-name">${type}</span>
        <span class="event-type-count">${count.toLocaleString()}</span>
      </div>
    `).join('');

    contentDiv.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${(stats.eventCount || 0).toLocaleString()}</div>
        <div class="stat-label">Total Events</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${storageSize}</div>
        <div class="stat-label">Storage Used</div>
      </div>
      <div class="stat-card full">
        <div class="stat-value" style="font-size: 14px;">${timeRange}</div>
        <div class="stat-label">Collection Period</div>
      </div>
    </div>
    
    <div class="event-types">
      <h3>Events by Category</h3>
      ${eventTypesHtml || '<div class="event-type-row"><span class="event-type-name">No events yet</span></div>'}
    </div>
    
    <div class="actions">
      <button class="btn-primary" id="exportBtn">Export Logs</button>
      <button class="btn-danger" id="clearBtn">Clear</button>
    </div>
  `;

    // Attach event listeners
    document.getElementById('exportBtn').addEventListener('click', handleExport);
    document.getElementById('clearBtn').addEventListener('click', handleClear);
}

/**
 * Handle export button click
 */
async function handleExport() {
    const btn = document.getElementById('exportBtn');
    const originalText = btn.textContent;

    try {
        btn.textContent = 'Exporting...';
        btn.disabled = true;

        const response = await chrome.runtime.sendMessage({ type: 'EXPORT_LOGS' });

        if (response.success) {
            btn.textContent = 'Exported!';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 2000);
        } else {
            throw new Error(response.error);
        }
    } catch (e) {
        btn.textContent = 'Failed';
        btn.disabled = false;
        console.error('[OpenBDR] Export failed:', e);
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    }
}

/**
 * Handle clear button click
 */
async function handleClear() {
    const btn = document.getElementById('clearBtn');

    if (!confirm('Are you sure you want to clear all telemetry logs? This cannot be undone.')) {
        return;
    }

    try {
        btn.textContent = 'Clearing...';
        btn.disabled = true;

        const response = await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });

        if (response.success) {
            // Refresh stats
            const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
            renderStats(stats);
        } else {
            throw new Error(response.error);
        }
    } catch (e) {
        btn.textContent = 'Failed';
        console.error('[OpenBDR] Clear failed:', e);
    }
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format time range
 */
function formatTimeRange(oldest, newest) {
    if (!oldest || !newest) return 'No data';

    try {
        const start = new Date(oldest);
        const end = new Date(newest);
        const diffMs = end - start;

        if (diffMs < 60000) {
            return 'Just started';
        } else if (diffMs < 3600000) {
            const mins = Math.round(diffMs / 60000);
            return `${mins} min${mins > 1 ? 's' : ''}`;
        } else if (diffMs < 86400000) {
            const hours = Math.round(diffMs / 3600000);
            return `${hours} hour${hours > 1 ? 's' : ''}`;
        } else {
            const days = Math.round(diffMs / 86400000);
            return `${days} day${days > 1 ? 's' : ''}`;
        }
    } catch (e) {
        return 'Unknown';
    }
}
