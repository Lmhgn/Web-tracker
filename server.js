require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Venue List ──────────────────────────────────────────────────────────────

const VENUES = [
  { name: 'O2 Academy Birmingham',           url: 'https://www.academymusicgroup.com/o2academybirmingham',          type: 'amg' },
  { name: 'O2 Academy Bournemouth',          url: 'https://www.academymusicgroup.com/o2academybournemouth',         type: 'amg' },
  { name: 'O2 Academy Bristol',              url: 'https://www.academymusicgroup.com/o2academybristol',             type: 'amg' },
  { name: 'O2 Academy Brixton',              url: 'https://www.academymusicgroup.com/o2academybrixton',             type: 'amg' },
  { name: 'O2 Academy Glasgow',              url: 'https://www.academymusicgroup.com/o2academyglasgow',             type: 'amg' },
  { name: 'O2 Academy Islington',            url: 'https://www.academymusicgroup.com/o2academyislington',           type: 'amg' },
  { name: 'O2 Academy Leeds',                url: 'https://www.academymusicgroup.com/o2academyleeds',               type: 'amg' },
  { name: 'O2 Academy Leicester',            url: 'https://www.academymusicgroup.com/o2academyleicester',           type: 'amg' },
  { name: 'O2 Academy Liverpool',            url: 'https://www.academymusicgroup.com/o2academyliverpool',           type: 'amg' },
  { name: 'O2 Academy Oxford',               url: 'https://www.academymusicgroup.com/o2academyoxford',              type: 'amg' },
  { name: 'O2 Academy Sheffield',            url: 'https://www.academymusicgroup.com/o2academysheffield',           type: 'amg' },
  { name: 'O2 Apollo Manchester',            url: 'https://www.academymusicgroup.com/o2apollomanchester',           type: 'amg' },
  { name: 'O2 City Hall Newcastle',          url: 'https://www.academymusicgroup.com/o2cityhallnewcastle',          type: 'amg' },
  { name: 'O2 Forum Kentish Town',           url: 'https://www.academymusicgroup.com/o2forumkentishtown',           type: 'amg' },
  { name: 'O2 Guildhall Southampton',        url: 'https://www.academymusicgroup.com/o2guildhallsouthampton',       type: 'amg' },
  { name: 'O2 Institute Birmingham',         url: 'https://www.academymusicgroup.com/o2institutebirmingham',        type: 'amg' },
  { name: 'O2 Ritz Manchester',              url: 'https://www.academymusicgroup.com/o2ritzmanchester',             type: 'amg' },
  { name: "O2 Shepherd's Bush Empire",       url: 'https://www.academymusicgroup.com/o2shepherdsbushempire',        type: 'amg' },
  { name: 'O2 Victoria Warehouse Manchester',url: 'https://www.academymusicgroup.com/o2victoriawarehousemanchester',type: 'amg' },
  { name: 'Edinburgh Corn Exchange',         url: 'https://www.edinburghcornexchange.co.uk',                        type: 'ece' },
];

// ─── Catalogue Database ───────────────────────────────────────────────────────

const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'catalogue.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS tile_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_name  TEXT NOT NULL,
    venue_url   TEXT NOT NULL,
    artist      TEXT NOT NULL,
    date_str    TEXT,
    event_date  TEXT,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    removed_at  TEXT,
    entry_index INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_artist ON tile_history (artist);
  CREATE INDEX IF NOT EXISTS idx_venue  ON tile_history (venue_name);
`);

// ─── State ───────────────────────────────────────────────────────────────────

let venueData = {};
let lastChecked = null;
let isScraping = false;
const previouslyOutdated = new Set();
const sseClients = [];

// ─── Date Helpers ─────────────────────────────────────────────────────────────

const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseEventDate(dateStr) {
  if (!dateStr) return null;
  // "Friday 9 October 2026" or "9 October 2026"
  let m = dateStr.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (m) return new Date(+m[3], MONTH_MAP[m[2].toLowerCase()], +m[1]);
  // "28 JUL 2026"
  m = dateStr.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/i);
  if (m) return new Date(+m[3], MONTH_MAP[m[2].toLowerCase()], +m[1]);
  return null;
}

function getTileStatus(date) {
  if (!date) return 'unknown';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.floor((date - today) / 86400000);
  if (daysUntil < 0) return 'outdated';
  if (daysUntil <= 7) return 'expiring_soon';
  return 'ok';
}

// ─── Scrapers ─────────────────────────────────────────────────────────────────

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

async function scrapeAMG(url) {
  const { data } = await axios.get(url, { headers: HTTP_HEADERS, timeout: 20000 });
  const $ = cheerio.load(data);
  const tiles = [];
  const seen = new Set();

  $('[data-testid="carousel-slide"]').each((_, el) => {
    const artist = $('h2, h3', el).first().text().trim();
    const dateStr = $('p', el).first().text().trim();
    if (!artist) return;
    const key = `${artist}|${dateStr}`;
    if (seen.has(key)) return;
    seen.add(key);
    const date = parseEventDate(dateStr);
    tiles.push({ artist, dateStr, date: date ? date.toISOString() : null, status: getTileStatus(date) });
  });

  return tiles;
}

async function scrapeECE(url) {
  const { data } = await axios.get(url, { headers: HTTP_HEADERS, timeout: 20000 });
  const $ = cheerio.load(data);
  const tiles = [];
  const seen = new Set();

  // Edinburgh's "What's new" carousel is the first module-content-list-medium section
  $('[data-testid="module-content-list-medium"]').first()
    .find('[data-testid="module-content-list-item"]').each((_, el) => {
      const artist = $('[data-testid="module-content-list-item-title"]', el).text().trim();
      const dateStr = $('[data-testid="module-content-list-item-subtitle"]', el).text().trim();
      if (!artist) return;
      const key = `${artist}|${dateStr}`;
      if (seen.has(key)) return;
      seen.add(key);
      const date = parseEventDate(dateStr);
      tiles.push({ artist, dateStr, date: date ? date.toISOString() : null, status: getTileStatus(date) });
    });

  return tiles;
}

async function scrapeVenue(venue) {
  try {
    const tiles = venue.type === 'amg' ? await scrapeAMG(venue.url) : await scrapeECE(venue.url);
    const outdatedCount  = tiles.filter(t => t.status === 'outdated').length;
    const expiringCount  = tiles.filter(t => t.status === 'expiring_soon').length;
    const overallStatus  = outdatedCount  > 0 ? 'outdated'
                         : expiringCount  > 0 ? 'expiring_soon'
                         : tiles.length   > 0 ? 'ok'
                         : 'unknown';
    return { name: venue.name, url: venue.url, tiles, outdatedCount, expiringCount, overallStatus, error: null, checkedAt: new Date().toISOString() };
  } catch (err) {
    console.error(`Error scraping ${venue.name}:`, err.message);
    return { name: venue.name, url: venue.url, tiles: [], outdatedCount: 0, expiringCount: 0, overallStatus: 'error', error: err.message, checkedAt: new Date().toISOString() };
  }
}

// ─── Main Scrape ──────────────────────────────────────────────────────────────

async function scrapeAll() {
  if (isScraping) return;
  isScraping = true;
  console.log(`[${new Date().toISOString()}] Scraping all venues...`);

  broadcastSSE({ type: 'scraping_started' });

  // Scrape all venues with a concurrency cap of 5
  const results = [];
  for (let i = 0; i < VENUES.length; i += 5) {
    const batch = VENUES.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(scrapeVenue));
    results.push(...batchResults);
  }

  const newlyOutdated = [];
  const newData = {};

  results.forEach(result => {
    newData[result.name] = result;
    const isNowOutdated = result.overallStatus === 'outdated';
    if (isNowOutdated && !previouslyOutdated.has(result.name)) {
      newlyOutdated.push(result);
    }
    if (isNowOutdated) {
      previouslyOutdated.add(result.name);
    } else {
      previouslyOutdated.delete(result.name);
    }
  });

  venueData = newData;
  lastChecked = new Date().toISOString();
  isScraping = false;

  // Update catalogue history for all successfully scraped venues
  results.forEach(result => {
    if (result.tiles && result.overallStatus !== 'error') {
      updateCatalogue(result.name, result.url, result.tiles);
    }
  });

  broadcastSSE({ type: 'update', data: venueData, lastChecked });

  if (newlyOutdated.length > 0) {
    console.log(`Newly outdated venues: ${newlyOutdated.map(v => v.name).join(', ')}`);
    await sendEmailNotification(newlyOutdated);
    await sendSlackNotification(newlyOutdated);
    await sendWebhookNotification(newlyOutdated);
  }

  console.log(`[${new Date().toISOString()}] Scrape complete. ${results.length} venues checked.`);
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function sendEmailNotification(outdatedVenues) {
  if (!process.env.SMTP_HOST || !process.env.NOTIFY_EMAIL) return;
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const venueRows = outdatedVenues.map(v => {
      const outdatedTiles = v.tiles.filter(t => t.status === 'outdated');
      const rows = outdatedTiles.map(t =>
        `<tr><td style="padding:4px 12px">${t.artist}</td><td style="padding:4px 12px;color:#dc2626">${t.dateStr}</td></tr>`
      ).join('');
      return `
        <tr><td colspan="2" style="padding:8px 12px;background:#f3f4f6;font-weight:bold">
          <a href="${v.url}">${v.name}</a>
        </td></tr>${rows}`;
    }).join('');

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.NOTIFY_EMAIL,
      subject: `[Venue Tracker] ${outdatedVenues.length} venue(s) have outdated homepage tiles`,
      html: `
        <h2 style="color:#dc2626">Outdated Homepage Carousel Tiles</h2>
        <p>The following venues have carousel tiles showing events that have already passed. Please replace them.</p>
        <table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:600px">
          <thead><tr>
            <th style="padding:8px 12px;text-align:left;background:#1f2937;color:#fff">Show</th>
            <th style="padding:8px 12px;text-align:left;background:#1f2937;color:#fff">Date on Tile</th>
          </tr></thead>
          <tbody>${venueRows}</tbody>
        </table>
        <p style="color:#6b7280;font-size:0.85em">Sent by Venue Carousel Tracker at ${new Date().toUTCString()}</p>
      `,
    });
    console.log('Email notification sent to', process.env.NOTIFY_EMAIL);
  } catch (err) {
    console.error('Email notification failed:', err.message);
  }
}

async function sendSlackNotification(outdatedVenues) {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  try {
    const blocks = outdatedVenues.flatMap(v => {
      const outdatedTiles = v.tiles.filter(t => t.status === 'outdated');
      return [
        { type: 'section', text: { type: 'mrkdwn', text: `*<${v.url}|${v.name}>* — ${outdatedTiles.length} outdated tile(s)` } },
        { type: 'section', text: { type: 'mrkdwn', text: outdatedTiles.map(t => `• ${t.artist} — ~${t.dateStr}~`).join('\n') } },
      ];
    });

    await axios.post(process.env.SLACK_WEBHOOK_URL, {
      text: `:rotating_light: ${outdatedVenues.length} venue(s) have outdated homepage tiles`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Outdated Homepage Carousel Tiles' } },
        ...blocks,
      ],
    });
    console.log('Slack notification sent.');
  } catch (err) {
    console.error('Slack notification failed:', err.message);
  }
}

async function sendWebhookNotification(outdatedVenues) {
  if (!process.env.WEBHOOK_URL) return;
  try {
    await axios.post(process.env.WEBHOOK_URL, {
      event: 'outdated_tiles_detected',
      timestamp: new Date().toISOString(),
      venues: outdatedVenues.map(v => ({
        name: v.name,
        url: v.url,
        outdatedTiles: v.tiles.filter(t => t.status === 'outdated'),
      })),
    });
    console.log('Webhook notification sent.');
  } catch (err) {
    console.error('Webhook notification failed:', err.message);
  }
}

// ─── SSE Broadcast ────────────────────────────────────────────────────────────

function broadcastSSE(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(client => {
    try { client.res.write(msg); } catch (_) {}
  });
}

// ─── Catalogue Tracking ───────────────────────────────────────────────────────

function updateCatalogue(venueName, venueUrl, currentTiles) {
  const now = new Date().toISOString();

  // Prune removed entries older than 18 months
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 18);
  db.prepare(`DELETE FROM tile_history WHERE removed_at IS NOT NULL AND removed_at < ?`).run(cutoff.toISOString());

  const activeEntries = db.prepare(
    `SELECT * FROM tile_history WHERE venue_name = ? AND removed_at IS NULL`
  ).all(venueName);

  const currentKeys = new Set(currentTiles.map(t => `${t.artist}||${t.dateStr || ''}`));
  const activeKeys  = new Set(activeEntries.map(e => `${e.artist}||${e.date_str || ''}`));

  const updateLastSeen = db.prepare(`UPDATE tile_history SET last_seen = ? WHERE id = ?`);
  const markRemoved    = db.prepare(`UPDATE tile_history SET removed_at = ?, last_seen = ? WHERE id = ?`);
  const countArtist    = db.prepare(`SELECT COUNT(*) AS cnt FROM tile_history WHERE venue_name = ? AND artist = ?`);
  const insertEntry    = db.prepare(`
    INSERT INTO tile_history (venue_name, venue_url, artist, date_str, event_date, first_seen, last_seen, entry_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const entry of activeEntries) {
      const key = `${entry.artist}||${entry.date_str || ''}`;
      if (currentKeys.has(key)) {
        updateLastSeen.run(now, entry.id);
      } else {
        markRemoved.run(now, now, entry.id);
      }
    }
    for (const tile of currentTiles) {
      const key = `${tile.artist}||${tile.dateStr || ''}`;
      if (!activeKeys.has(key)) {
        const idx = countArtist.get(venueName, tile.artist).cnt;
        insertEntry.run(venueName, venueUrl, tile.artist, tile.dateStr || null, tile.date || null, now, now, idx);
      }
    }
  })();
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({ venues: venueData, lastChecked, isScraping });
});

app.post('/api/refresh', async (req, res) => {
  res.json({ message: 'Scrape started' });
  scrapeAll();
});

app.get('/api/catalogue', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [], query: q });
  const safe = q.replace(/[%_\\]/g, c => '\\' + c);
  const entries = db.prepare(`
    SELECT * FROM tile_history
    WHERE artist LIKE ? ESCAPE '\\'
    ORDER BY artist COLLATE NOCASE, venue_name, first_seen DESC
  `).all(`%${safe}%`);
  res.json({ results: entries, query: q });
});

// Server-Sent Events for real-time dashboard updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.push(client);

  // Send current state immediately on connect
  res.write(`data: ${JSON.stringify({ type: 'update', data: venueData, lastChecked, isScraping })}\n\n`);

  // Keep-alive ping every 30 seconds
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
  }, 30000);

  req.on('close', () => {
    clearInterval(ping);
    const idx = sseClients.indexOf(client);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Venue Carousel Tracker running at http://localhost:${PORT}`);
  scrapeAll();
});

// Run every hour at :00
cron.schedule('0 * * * *', () => {
  console.log('Scheduled hourly scrape triggered.');
  scrapeAll();
});
