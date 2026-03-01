/* ── Venue Carousel Tracker — Frontend ── */

let allVenueData = {};
let currentFilter = 'all';
let notifyPermission = Notification.permission;
let alertedOutdated = new Set(); // track which have already triggered a notification this session

// ── Utilities ──────────────────────────────────────────────────────────────

function daysRelative(isoDate) {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(isoDate);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d - today) / 86400000);
}

function formatRelative(isoDate) {
  const days = daysRelative(isoDate);
  if (days === null) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return '1 day ago';
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days <= 7) return `${days}d away`;
  return '';
}

function formatLastChecked(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status) {
  return { outdated: 'Outdated', expiring_soon: 'Expiring Soon', ok: 'Up to Date', error: 'Error', unknown: 'Unknown' }[status] || status;
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderSummary(venues) {
  const arr = Object.values(venues);
  const outdated  = arr.filter(v => v.overallStatus === 'outdated').length;
  const expiring  = arr.filter(v => v.overallStatus === 'expiring_soon').length;
  const ok        = arr.filter(v => v.overallStatus === 'ok').length;
  document.getElementById('count-outdated').textContent = outdated;
  document.getElementById('count-expiring').textContent = expiring;
  document.getElementById('count-ok').textContent       = ok;
  document.getElementById('count-total').textContent    = arr.length;
}

function buildTileHTML(tile) {
  const rel = formatRelative(tile.date);
  return `
    <div class="tile-item tile-${tile.status}">
      <div class="tile-dot"></div>
      <div class="tile-info">
        <div class="tile-artist" title="${esc(tile.artist)}">${esc(tile.artist)}</div>
        <div class="tile-date">${esc(tile.dateStr)}</div>
      </div>
      ${rel ? `<span class="tile-days-ago">${rel}</span>` : ''}
    </div>`;
}

function buildCardHTML(venue) {
  const tilesHTML = venue.tiles.length
    ? venue.tiles.map(buildTileHTML).join('')
    : '<div class="venue-error">No carousel tiles found.</div>';

  const errorHTML = venue.error
    ? `<div class="venue-error">
         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
         ${esc(venue.error)}
       </div>` : '';

  return `
    <article class="venue-card status-${venue.overallStatus}">
      <div class="venue-card-header">
        <a href="${venue.url}" target="_blank" rel="noopener" class="venue-name">${esc(venue.name)}</a>
        <span class="venue-badge badge-${venue.overallStatus}">${statusLabel(venue.overallStatus)}</span>
      </div>
      <div class="tile-list">
        ${errorHTML || tilesHTML}
      </div>
      <div class="venue-card-footer">
        ${venue.tiles.length} tile${venue.tiles.length !== 1 ? 's' : ''} ·
        ${venue.outdatedCount > 0 ? `<strong style="color:var(--red)">${venue.outdatedCount} outdated</strong>` : ''}
        ${venue.expiringCount > 0 ? `<strong style="color:var(--orange)">${venue.expiringCount} expiring soon</strong>` : ''}
        ${venue.outdatedCount === 0 && venue.expiringCount === 0 ? 'All clear' : ''}
      </div>
    </article>`;
}

function renderVenues(venues) {
  const grid = document.getElementById('venue-grid');
  const arr = Object.values(venues);

  const filtered = currentFilter === 'all'
    ? arr
    : arr.filter(v => v.overallStatus === currentFilter);

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="loading-placeholder"><p>No venues match this filter.</p></div>`;
    return;
  }

  // Sort: outdated first, then expiring, then ok, then error
  const order = { outdated: 0, expiring_soon: 1, ok: 2, unknown: 3, error: 4 };
  filtered.sort((a, b) => (order[a.overallStatus] ?? 9) - (order[b.overallStatus] ?? 9));

  grid.innerHTML = filtered.map(buildCardHTML).join('');
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Browser Notifications ──────────────────────────────────────────────────

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    notifyPermission = 'granted';
    updateNotifyBtn();
    return;
  }
  const perm = await Notification.requestPermission();
  notifyPermission = perm;
  updateNotifyBtn();
}

function updateNotifyBtn() {
  const btn = document.getElementById('notify-btn');
  if (notifyPermission === 'granted') {
    btn.textContent = 'Alerts On';
    btn.style.background = 'rgba(22,163,74,.3)';
  }
}

function triggerBrowserNotifications(venues) {
  if (notifyPermission !== 'granted') return;
  const outdated = Object.values(venues).filter(v => v.overallStatus === 'outdated' && !alertedOutdated.has(v.name));
  outdated.forEach(v => {
    alertedOutdated.add(v.name);
    const outdatedTiles = v.tiles.filter(t => t.status === 'outdated');
    new Notification(`Outdated tiles: ${v.name}`, {
      body: outdatedTiles.map(t => `${t.artist} — ${t.dateStr}`).join('\n'),
      icon: '/favicon.ico',
      tag: v.name,
    });
  });
}

// ── SSE Connection ─────────────────────────────────────────────────────────

function connectSSE() {
  const evtSource = new EventSource('/api/events');

  evtSource.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'scraping_started') {
      document.getElementById('scraping-banner').classList.remove('hidden');
      document.getElementById('refresh-btn').disabled = true;
    } else if (msg.type === 'update') {
      document.getElementById('scraping-banner').classList.add('hidden');
      document.getElementById('refresh-btn').disabled = false;
      document.getElementById('last-checked').textContent = formatLastChecked(msg.lastChecked);
      allVenueData = msg.data || {};
      renderSummary(allVenueData);
      renderVenues(allVenueData);
      triggerBrowserNotifications(allVenueData);
    }
  };

  evtSource.onerror = () => {
    // Reconnect after 5 seconds
    evtSource.close();
    setTimeout(connectSSE, 5000);
  };
}

// ── Filter Buttons ─────────────────────────────────────────────────────────

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderVenues(allVenueData);
  });
});

// ── Refresh Button ─────────────────────────────────────────────────────────

document.getElementById('refresh-btn').addEventListener('click', async () => {
  document.getElementById('refresh-btn').disabled = true;
  document.getElementById('scraping-banner').classList.remove('hidden');
  try {
    await fetch('/api/refresh', { method: 'POST' });
  } catch (err) {
    document.getElementById('scraping-banner').classList.add('hidden');
    document.getElementById('refresh-btn').disabled = false;
  }
});

// ── Notification Button ────────────────────────────────────────────────────

document.getElementById('notify-btn').addEventListener('click', requestNotificationPermission);

// ── Settings Panel ─────────────────────────────────────────────────────────

document.getElementById('open-settings').addEventListener('click', () => {
  document.getElementById('settings-panel').classList.remove('hidden');
});

document.getElementById('close-settings').addEventListener('click', () => {
  document.getElementById('settings-panel').classList.add('hidden');
});

document.getElementById('settings-panel').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settings-panel')) {
    document.getElementById('settings-panel').classList.add('hidden');
  }
});

// ── Init ───────────────────────────────────────────────────────────────────

updateNotifyBtn();
connectSSE();
