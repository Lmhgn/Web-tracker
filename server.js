'use strict';

require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const Database   = require('better-sqlite3');
const axios      = require('axios');
const cheerio    = require('cheerio');
const cron       = require('node-cron');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

// ── Database ─────────────────────────────────────────────────────────────────

const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'tracker.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login    TEXT
  );

  CREATE TABLE IF NOT EXISTS appearances (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    artist        TEXT    NOT NULL,
    venue_name    TEXT    NOT NULL,
    venue_url     TEXT    NOT NULL,
    event_date    TEXT,
    date_str      TEXT    NOT NULL DEFAULT '',
    first_seen_at TEXT    NOT NULL,
    last_seen_at  TEXT    NOT NULL,
    scan_count    INTEGER NOT NULL DEFAULT 1
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_appearances_unique
    ON appearances(artist, venue_name, COALESCE(event_date, ''));
`);

// Seed default admin when the table is empty
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')")
    .run(bcrypt.hashSync('admin', 10));
  console.log('\x1b[33m[SETUP] Default admin created — username: admin / password: admin\x1b[0m');
  console.log('\x1b[33m[SETUP] Please change this password after your first login.\x1b[0m');
}

// ── Express + session ────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'venue-tracker-change-me-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax' },
}));

// Serve the single-page app from the project root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Admin only' });
}

// ── Auth routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  req.session.userId   = user.id;
  req.session.username = user.username;
  req.session.role     = user.role;
  res.json({ username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, role: req.session.role });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), user.id);
  res.json({ ok: true });
});

// ── User management (admin only) ─────────────────────────────────────────────

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare(
    'SELECT id, username, role, created_at, last_login FROM users ORDER BY id'
  ).all());
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role = 'user' } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['admin', 'user'].includes(role))
    return res.status(400).json({ error: 'Role must be admin or user' });
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username.trim(), bcrypt.hashSync(password, 10), role);
    res.json({ id: r.lastInsertRowid, username: username.trim(), role });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    throw e;
  }
});

app.patch('/api/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), parseInt(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Catalogue routes ─────────────────────────────────────────────────────────

// Summary — all artists with aggregate stats, optionally filtered
app.get('/api/catalogue', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  res.json(db.prepare(`
    SELECT
      artist,
      COUNT(DISTINCT venue_name)  AS venue_count,
      COUNT(*)                    AS appearance_count,
      MIN(first_seen_at)          AS first_seen_at,
      MAX(last_seen_at)           AS last_seen_at,
      SUM(scan_count)             AS total_scans
    FROM appearances
    WHERE (@q = '' OR LOWER(artist) LIKE @pattern)
    GROUP BY artist
    ORDER BY MAX(last_seen_at) DESC
  `).all({ q, pattern: q ? `%${q}%` : '%' }));
});

// Full appearance history for one artist
app.get('/api/catalogue/artist/:artist', requireAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT * FROM appearances
    WHERE artist = ?
    ORDER BY COALESCE(event_date, last_seen_at) ASC, venue_name ASC
  `).all(decodeURIComponent(req.params.artist)));
});

// Upsert tile appearances after each scrape
function logAppearances(venues) {
  const now    = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO appearances
      (artist, venue_name, venue_url, event_date, date_str, first_seen_at, last_seen_at, scan_count)
    VALUES (@artist, @venue_name, @venue_url, @event_date, @date_str, @now, @now, 1)
    ON CONFLICT(artist, venue_name, COALESCE(event_date, ''))
    DO UPDATE SET last_seen_at = @now, scan_count = scan_count + 1, date_str = @date_str
  `);
  db.transaction(() => {
    for (const v of venues) {
      for (const t of (v.tiles || [])) {
        if (!t.artist) continue;
        upsert.run({ artist: t.artist, venue_name: v.name, venue_url: v.url,
          event_date: t.date || null, date_str: t.dateStr || '', now });
      }
    }
  })();
}

// ── Venue list ────────────────────────────────────────────────────────────────

const VENUES = [
  { name: 'O2 Academy Birmingham',            url: 'https://www.academymusicgroup.com/o2academybirmingham',           type: 'amg' },
  { name: 'O2 Academy Bournemouth',           url: 'https://www.academymusicgroup.com/o2academybournemouth',          type: 'amg' },
  { name: 'O2 Academy Bristol',               url: 'https://www.academymusicgroup.com/o2academybristol',              type: 'amg' },
  { name: 'O2 Academy Brixton',               url: 'https://www.academymusicgroup.com/o2academybrixton',              type: 'amg' },
  { name: 'O2 Academy Glasgow',               url: 'https://www.academymusicgroup.com/o2academyglasgow',              type: 'amg' },
  { name: 'O2 Academy Islington',             url: 'https://www.academymusicgroup.com/o2academyislington',            type: 'amg' },
  { name: 'O2 Academy Leeds',                 url: 'https://www.academymusicgroup.com/o2academyleeds',                type: 'amg' },
  { name: 'O2 Academy Leicester',             url: 'https://www.academymusicgroup.com/o2academyleicester',            type: 'amg' },
  { name: 'O2 Academy Liverpool',             url: 'https://www.academymusicgroup.com/o2academyliverpool',            type: 'amg' },
  { name: 'O2 Academy Oxford',                url: 'https://www.academymusicgroup.com/o2academyoxford',               type: 'amg' },
  { name: 'O2 Academy Sheffield',             url: 'https://www.academymusicgroup.com/o2academysheffield',            type: 'amg' },
  { name: 'O2 Apollo Manchester',             url: 'https://www.academymusicgroup.com/o2apollomanchester',            type: 'amg' },
  { name: 'O2 City Hall Newcastle',           url: 'https://www.academymusicgroup.com/o2cityhallnewcastle',           type: 'amg' },
  { name: 'O2 Forum Kentish Town',            url: 'https://www.academymusicgroup.com/o2forumkentishtown',            type: 'amg' },
  { name: 'O2 Guildhall Southampton',         url: 'https://www.academymusicgroup.com/o2guildhallsouthampton',        type: 'amg' },
  { name: 'O2 Institute Birmingham',          url: 'https://www.academymusicgroup.com/o2institutebirmingham',         type: 'amg' },
  { name: 'O2 Ritz Manchester',               url: 'https://www.academymusicgroup.com/o2ritzmanchester',              type: 'amg' },
  { name: "O2 Shepherd's Bush Empire",        url: 'https://www.academymusicgroup.com/o2shepherdsbushempire',         type: 'amg' },
  { name: 'O2 Victoria Warehouse Manchester', url: 'https://www.academymusicgroup.com/o2victoriawarehousemanchester', type: 'amg' },
  { name: 'Edinburgh Corn Exchange',          url: 'https://www.edinburghcornexchange.co.uk',                         type: 'ece' },
];

// ── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_MAP = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
  jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function parseEventDate(s) {
  if (!s) return null;
  let m = s.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (m) return new Date(+m[3], MONTH_MAP[m[2].toLowerCase()], +m[1]);
  m = s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/i);
  if (m) return new Date(+m[3], MONTH_MAP[m[2].toLowerCase()], +m[1]);
  return null;
}

function getTileStatus(date, warnDays = parseInt(process.env.WARN_DAYS || '7')) {
  if (!date) return 'unknown';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.floor((date - today) / 86400000);
  if (diff < 0)         return 'outdated';
  if (diff <= warnDays) return 'expiring_soon';
  return 'ok';
}

// ── Scrapers (server-side — no CORS proxies needed) ───────────────────────────

const EXCLUDED_RE = /what[\u2018\u2019\u0027]s\s+new|coming\s+up/i;

const HTTP_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

function buildExcludedSet($) {
  const excluded = new Set();
  $('h1,h2,h3,h4').each((_, h) => {
    if (!EXCLUDED_RE.test($(h).text())) return;
    let el = $(h).parent();
    for (let d = 0; d < 6; d++) {
      const items = el.find('[data-testid="module-content-list-item"]');
      if (items.length) { items.each((_, i) => excluded.add(i)); break; }
      el = el.parent();
      if (!el.length) break;
    }
  });
  return excluded;
}

function sortByDate(tiles) {
  return tiles.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });
}

async function scrapeAMG(venue) {
  const { data } = await axios.get(venue.url, { headers: HTTP_HEADERS, timeout: 20000 });
  const $        = cheerio.load(data);
  const excluded = buildExcludedSet($);
  const tiles    = [];
  const seen     = new Set();

  function addTile(artist, dateStr) {
    if (!artist) return;
    const key = artist + '|' + dateStr;
    if (seen.has(key)) return;
    seen.add(key);
    const date = parseEventDate(dateStr);
    tiles.push({ artist, dateStr, date: date?.toISOString() || null, status: getTileStatus(date) });
  }

  $('[data-testid="carousel-slide"]').each((_, slide) => {
    addTile(
      $('h2,h3', slide).first().text().trim(),
      $('p',     slide).first().text().trim(),
    );
  });

  $('[data-testid="module-content-list-item"]').each((_, item) => {
    if (excluded.has(item)) return;
    const artist  = $('[data-testid="module-content-list-item-title"]',    item).text().trim();
    const dateStr = $('[data-testid="module-content-list-item-subtitle"]', item).text().trim();
    if (!parseEventDate(dateStr)) return;
    addTile(artist, dateStr);
  });

  return sortByDate(tiles);
}

async function scrapeECE(venue) {
  const { data } = await axios.get(venue.url, { headers: HTTP_HEADERS, timeout: 20000 });
  const $        = cheerio.load(data);
  const excluded = buildExcludedSet($);
  const tiles    = [];
  const seen     = new Set();

  $('[data-testid="module-content-list-medium"]').first()
    .find('[data-testid="module-content-list-item"]').each((_, item) => {
      if (excluded.has(item)) return;
      const artist  = $('[data-testid="module-content-list-item-title"]',    item).text().trim();
      const dateStr = $('[data-testid="module-content-list-item-subtitle"]', item).text().trim();
      if (!artist) return;
      const key = artist + '|' + dateStr;
      if (seen.has(key)) return; seen.add(key);
      const date = parseEventDate(dateStr);
      tiles.push({ artist, dateStr, date: date?.toISOString() || null, status: getTileStatus(date) });
    });

  return sortByDate(tiles);
}

async function scrapeVenue(venue) {
  try {
    const tiles   = venue.type === 'amg' ? await scrapeAMG(venue) : await scrapeECE(venue);
    const outdN   = tiles.filter(t => t.status === 'outdated').length;
    const expN    = tiles.filter(t => t.status === 'expiring_soon').length;
    const overall = outdN > 0 ? 'outdated' : expN > 0 ? 'expiring_soon' : tiles.length ? 'ok' : 'unknown';
    return { name: venue.name, url: venue.url, tiles, outdN, expN, overall,
      error: null, checkedAt: new Date().toISOString(), removed: [], hasChanges: false };
  } catch (err) {
    console.error(`[scrape] ${venue.name}: ${err.message}`);
    return { name: venue.name, url: venue.url, tiles: [], outdN: 0, expN: 0, overall: 'error',
      error: err.message, checkedAt: new Date().toISOString(), removed: [], hasChanges: false };
  }
}

// ── Scrape orchestration ─────────────────────────────────────────────────────

let venueData   = {};
let lastChecked = null;
let isScraping  = false;
const previouslyOutdated = new Set();
const sseClients = [];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrapeAll() {
  if (isScraping) return;
  isScraping = true;
  console.log(`[${new Date().toISOString()}] Starting full scrape…`);
  broadcastSSE({ type: 'scraping_started', total: VENUES.length });

  let done = 0;
  const newData = {};

  for (let i = 0; i < VENUES.length; i += 4) {
    const batch   = VENUES.slice(i, i + 4);
    const results = await Promise.all(batch.map(scrapeVenue));
    results.forEach(r => {
      newData[r.name] = r;
      done++;
      broadcastSSE({ type: 'venue_done', venue: r, done, total: VENUES.length });
    });
    if (i + 4 < VENUES.length) await sleep(300);
  }

  try { logAppearances(Object.values(newData)); } catch (e) { console.error('[catalogue]', e.message); }

  const newlyOutdated = [];
  Object.values(newData).forEach(v => {
    if (v.overall === 'outdated' && !previouslyOutdated.has(v.name)) newlyOutdated.push(v);
    v.overall === 'outdated' ? previouslyOutdated.add(v.name) : previouslyOutdated.delete(v.name);
  });

  venueData   = newData;
  lastChecked = new Date().toISOString();
  isScraping  = false;

  broadcastSSE({ type: 'scrape_complete', data: venueData, lastChecked });
  console.log(`[${new Date().toISOString()}] Scrape complete.`);

  if (newlyOutdated.length) {
    await sendEmailNotification(newlyOutdated);
    await sendSlackNotification(newlyOutdated);
    await sendWebhookNotification(newlyOutdated);
  }
}

async function scrapeOne(venueName) {
  const venue = VENUES.find(v => v.name === venueName);
  if (!venue) return;
  broadcastSSE({ type: 'venue_loading', name: venueName });
  const result = await scrapeVenue(venue);
  venueData[venueName] = result;
  try { logAppearances([result]); } catch (e) { console.error('[catalogue]', e.message); }
  broadcastSSE({ type: 'venue_done', venue: result, done: null, total: null });
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function broadcastSSE(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(msg); } catch {}
  }
}

// ── Notifications ────────────────────────────────────────────────────────────

async function sendEmailNotification(venues) {
  if (!process.env.SMTP_HOST || !process.env.NOTIFY_EMAIL) return;
  try {
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const rows = venues.map(v => {
      const tiles = v.tiles.filter(t => t.status === 'outdated');
      return `<tr><td colspan="2" style="padding:8px 12px;background:#f3f4f6;font-weight:bold">
          <a href="${v.url}">${v.name}</a></td></tr>` +
        tiles.map(t => `<tr><td style="padding:4px 12px">${t.artist}</td>
          <td style="padding:4px 12px;color:#dc2626">${t.dateStr}</td></tr>`).join('');
    }).join('');
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || process.env.SMTP_USER,
      to:      process.env.NOTIFY_EMAIL,
      subject: `[Venue Tracker] ${venues.length} venue(s) have outdated homepage tiles`,
      html:    `<h2 style="color:#dc2626">Outdated Homepage Carousel Tiles</h2>
        <table>${rows}</table><p style="color:#6b7280;font-size:.85em">Sent at ${new Date().toUTCString()}</p>`,
    });
  } catch (err) { console.error('[email]', err.message); }
}

async function sendSlackNotification(venues) {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  try {
    const blocks = venues.flatMap(v => {
      const tiles = v.tiles.filter(t => t.status === 'outdated');
      return [
        { type: 'section', text: { type: 'mrkdwn', text: `*<${v.url}|${v.name}>* — ${tiles.length} outdated tile(s)` } },
        { type: 'section', text: { type: 'mrkdwn', text: tiles.map(t => `• ${t.artist} — ~${t.dateStr}~`).join('\n') } },
      ];
    });
    await axios.post(process.env.SLACK_WEBHOOK_URL, {
      text:   `:rotating_light: ${venues.length} venue(s) have outdated homepage tiles`,
      blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Outdated Homepage Carousel Tiles' } }, ...blocks],
    });
  } catch (err) { console.error('[slack]', err.message); }
}

async function sendWebhookNotification(venues) {
  if (!process.env.WEBHOOK_URL) return;
  try {
    await axios.post(process.env.WEBHOOK_URL, {
      event:     'outdated_tiles_detected',
      timestamp: new Date().toISOString(),
      venues:    venues.map(v => ({ name: v.name, url: v.url,
        outdatedTiles: v.tiles.filter(t => t.status === 'outdated') })),
    });
  } catch (err) { console.error('[webhook]', err.message); }
}

// ── API routes ────────────────────────────────────────────────────────────────

app.get('/api/status', requireAuth, (req, res) => {
  res.json({ venues: venueData, lastChecked, isScraping });
});

app.post('/api/refresh', requireAuth, (req, res) => {
  res.json({ ok: true });
  scrapeAll();
});

app.post('/api/refresh/:venue', requireAuth, (req, res) => {
  res.json({ ok: true });
  scrapeOne(decodeURIComponent(req.params.venue));
});

app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.push(client);

  // Send current state immediately so the page is never blank
  res.write(`data: ${JSON.stringify({
    type: 'scrape_complete', data: venueData, lastChecked,
  })}\n\n`);
  if (isScraping) {
    res.write(`data: ${JSON.stringify({ type: 'scraping_started', total: VENUES.length })}\n\n`);
  }

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    const idx = sseClients.indexOf(client);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\x1b[32m✓ Venue Carousel Tracker → http://localhost:${PORT}\x1b[0m`);
  scrapeAll();
});

cron.schedule('0 * * * *', () => {
  console.log('[cron] Hourly scrape triggered.');
  scrapeAll();
});
