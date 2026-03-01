# Venue Carousel Tracker

A web dashboard that monitors homepage carousel tiles across all O2 Academy venues and Edinburgh Corn Exchange, alerting the team when tiles are outdated and need replacing.

## What It Does

- Scrapes the homepage of all 20 venues every hour
- Detects carousel tiles where the event date has **already passed** (outdated) or is **within 7 days** (expiring soon)
- Displays a live dashboard with colour-coded status for each venue and tile
- Sends alerts via **email**, **Slack**, and/or a **generic webhook** when new outdated tiles are found
- Shows **browser desktop notifications** when the dashboard is open

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure notifications (optional)

```bash
cp .env.example .env
```

Edit `.env` with your SMTP / Slack / webhook details. All notification channels are optional — leave them blank to disable.

### 3. Start the server

```bash
npm start
```

Open **http://localhost:3000** in your browser.

## Venues Tracked

| Venue | URL |
|---|---|
| O2 Academy Birmingham | academymusicgroup.com/o2academybirmingham |
| O2 Academy Bournemouth | academymusicgroup.com/o2academybournemouth |
| O2 Academy Bristol | academymusicgroup.com/o2academybristol |
| O2 Academy Brixton | academymusicgroup.com/o2academybrixton |
| O2 Academy Glasgow | academymusicgroup.com/o2academyglasgow |
| O2 Academy Islington | academymusicgroup.com/o2academyislington |
| O2 Academy Leeds | academymusicgroup.com/o2academyleeds |
| O2 Academy Leicester | academymusicgroup.com/o2academyleicester |
| O2 Academy Liverpool | academymusicgroup.com/o2academyliverpool |
| O2 Academy Oxford | academymusicgroup.com/o2academyoxford |
| O2 Academy Sheffield | academymusicgroup.com/o2academysheffield |
| O2 Apollo Manchester | academymusicgroup.com/o2apollomanchester |
| O2 City Hall Newcastle | academymusicgroup.com/o2cityhallnewcastle |
| O2 Forum Kentish Town | academymusicgroup.com/o2forumkentishtown |
| O2 Guildhall Southampton | academymusicgroup.com/o2guildhallsouthampton |
| O2 Institute Birmingham | academymusicgroup.com/o2institutebirmingham |
| O2 Ritz Manchester | academymusicgroup.com/o2ritzmanchester |
| O2 Shepherd's Bush Empire | academymusicgroup.com/o2shepherdsbushempire |
| O2 Victoria Warehouse Manchester | academymusicgroup.com/o2victoriawarehousemanchester |
| Edinburgh Corn Exchange | edinburghcornexchange.co.uk |

## Status Indicators

| Colour | Meaning |
|---|---|
| 🔴 Red | Event date has passed — tile needs replacing immediately |
| 🟠 Orange | Event is within 7 days — tile will need replacing soon |
| 🟢 Green | Event is more than 7 days away — tile is fine |

## API

| Endpoint | Description |
|---|---|
| `GET /api/status` | Returns current venue data and last checked time |
| `POST /api/refresh` | Triggers an immediate scrape of all venues |
| `GET /api/events` | Server-Sent Events stream for real-time dashboard updates |

## Notifications

When a venue's carousel tiles become outdated, the server automatically sends alerts via any configured channel:

- **Email** — uses nodemailer with any SMTP provider (Gmail, SendGrid, etc.)
- **Slack** — via Incoming Webhook
- **Generic Webhook** — HTTP POST with JSON payload

Alerts are only sent when a venue *newly* becomes outdated (not on every hourly check).
