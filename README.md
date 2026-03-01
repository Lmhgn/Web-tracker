# Venue Carousel Tracker

A single HTML file that monitors homepage carousel tiles across all 20 O2 Academy venues and Edinburgh Corn Exchange, alerting the team when tiles are outdated and need replacing.

## Usage

**Just open `index.html` in any browser.** No server, no install, no dependencies.

The page will immediately start scanning all 20 venues and update in real time as results come in. It re-checks automatically every hour.

## What It Does

- Fetches each venue homepage via a public CORS proxy (allorigins.win)
- Detects carousel tiles where the event date has **already passed** (outdated) or is within the warning threshold (default: **7 days**)
- Displays a colour-coded dashboard for all venues and their tiles
- Sends **browser desktop notifications** when tiles go outdated (click Enable Alerts)
- Posts to **Slack** and/or a **generic webhook** (configurable in Settings)

## Status Indicators

| Colour | Meaning |
|---|---|
| 🔴 Red — Outdated | Event date has passed — tile needs replacing immediately |
| 🟠 Orange — Expiring Soon | Event is within the warning threshold (default 7 days) |
| 🟢 Green — OK | Event date is comfortably in the future |

## Notifications

Click **Settings** (top-right) to configure:

| Channel | What you need |
|---|---|
| Browser alerts | Click "Enable Alerts" — shows desktop notifications |
| Slack | An Incoming Webhook URL from api.slack.com/messaging/webhooks |
| Generic webhook | Any HTTPS endpoint that accepts a JSON POST |

Settings are saved in your browser's localStorage.

## Venues Tracked

| Venue | Site |
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

## Notes

- Pages are fetched via [allorigins.win](https://allorigins.win), a free public CORS proxy. Occasional fetch errors are normal — use Refresh to retry.
- Browser notifications and webhook alerts only fire when a venue *newly* becomes outdated, not on every hourly check.
- The warning threshold (default 7 days) can be changed in Settings.
