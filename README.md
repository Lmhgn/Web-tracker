# Venue Carousel Tracker

Monitors homepage carousel tiles across all O2 Academy venues and alerts the team when tiles are outdated or expiring soon.

---

## Requirements

- [Node.js](https://nodejs.org) v18 or higher
- npm (included with Node.js)

---

## Option 1 — Run Locally

**1. Clone the repo**
```bash
git clone https://github.com/Lmhgn/Web-tracker.git
cd Web-tracker
```

**2. Install dependencies**
```bash
npm install
```

**3. Start the server**
```bash
npm start
```

**4. Open your browser**
```
http://localhost:3000
```

On first run the server automatically creates the database and a default admin account:
- **Username:** `admin`
- **Password:** `admin`

> Change your password after first login via the account menu.

---

## Option 2 — Deploy to Railway (free, no terminal needed)

[Railway](https://railway.app) connects directly to your GitHub repo and hosts the server for you.

**1.** Go to [railway.app](https://railway.app) and sign in with GitHub

**2.** Click **New Project → Deploy from GitHub repo**

**3.** Select **Lmhgn/Web-tracker** from the list

**4.** Railway detects it as a Node.js app and deploys automatically

**5.** Click the generated URL (e.g. `https://web-tracker-xxxx.up.railway.app`) to open the app

Default login is the same: `admin` / `admin`

> Railway gives 500 free hours/month — enough to run this continuously.

---

## Environment Variables (optional)

Create a `.env` file in the project root to configure email alerts:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=yourpassword
ALERT_TO=team@example.com
SESSION_SECRET=change-this-to-a-random-string
```

On Railway, set these under **Project → Variables** instead of a `.env` file.

---

## Status Indicators

| Colour | Meaning |
|---|---|
| Red — Outdated | Event date has passed — tile needs replacing immediately |
| Orange — Expiring Soon | Event is within the warning threshold (default 7 days) |
| Green — OK | Event date is comfortably in the future |

---

## Venues Tracked

All 20 O2 Academy venues plus Edinburgh Corn Exchange.
