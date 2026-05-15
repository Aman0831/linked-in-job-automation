# LinkedIn Job Automation 🤖

> **Internship Assignment** — Automated LinkedIn job post search + Gmail application sender  
> Stack: Node.js · Puppeteer · Nodemailer · dotenv

---

## What This Does

| Step | Action |
|------|--------|
| **1** | Launches a headless browser and logs into LinkedIn automatically |
| **2** | Searches the **Posts** section for jobs matching `"JAVA DEVELOPER"` AND `"CONTRACT"` posted in the **last 24 hours** |
| **3** | Extracts recruiter email addresses from post text |
| **4** | Logs into Gmail and sends a formal application email with your **resume attached** to each recruiter |

---

## Project Structure

```
linkedin-job-automation/
├── index.js                  ← Main entry point (orchestrates all steps)
├── package.json
├── config/
│   └── .env.example          ← Copy → .env and fill in credentials
├── src/
│   ├── linkedinLogin.js      ← Step 1: Puppeteer login to LinkedIn
│   ├── jobSearcher.js        ← Step 2: Search posts + extract emails
│   ├── gmailSender.js        ← Steps 3 & 4: Compose + send via Gmail
│   └── logger.js             ← Timestamped coloured console logger
└── assets/
    └── resume.pdf            ← ⚠️ Place your resume here!
```

---

## Prerequisites

- **Node.js** v18 or later
- A **LinkedIn account**
- A **Gmail account** with an [App Password](https://myaccount.google.com/apppasswords) generated
  *(requires 2-Factor Authentication enabled on your Google account)*
- Your **resume** as a PDF file

---

## Setup & Installation

### 1. Install dependencies

```bash
npm install
```

> This installs: `puppeteer` (browser automation), `nodemailer` (email), `dotenv` (env vars)

### 2. Configure credentials

```bash
cp config/.env.example config/.env
```

Edit `config/.env`:

```env
LINKEDIN_EMAIL=your.linkedin@email.com
LINKEDIN_PASSWORD=YourLinkedInPassword

SEARCH_KEYWORD_1=JAVA DEVELOPER
SEARCH_KEYWORD_2=CONTRACT
MAX_RESULTS=20

GMAIL_EMAIL=your.gmail@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

CANDIDATE_NAME=John Doe
CANDIDATE_PHONE=+1-555-123-4567
```

### 3. Add your resume

```bash
mkdir -p assets
cp /path/to/your/resume.pdf assets/resume.pdf
```

### 4. Run

```bash
# Normal run (headless browser)
npm start

# Debug run (watch the browser)
npm run dev
```

---

## How It Works (Technical Deep Dive)

### Step 1 — LinkedIn Login (`linkedinLogin.js`)

Uses **Puppeteer** to:
- Launch a Chromium browser (headless by default)
- Set a real Chrome User-Agent string to reduce bot detection
- Navigate to `https://www.linkedin.com/login`
- Type credentials with randomised keystroke delays (mimics human behaviour)
- Detect security checkpoints / CAPTCHAs and surface them clearly

### Step 2 — Job Post Search (`jobSearcher.js`)

Builds a LinkedIn search URL targeting the **Posts section** with filters:
```
https://www.linkedin.com/search/results/content/
  ?keywords="JAVA DEVELOPER" "CONTRACT"
  &datePosted=past-24h
  &sortBy=date_posted
```

Then:
- Auto-scrolls the page to load lazy-rendered posts
- Scrapes each post card using DOM selectors
- Extracts email addresses from post text using a **regex pattern**: `/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g`

### Steps 3 & 4 — Gmail Send (`gmailSender.js`)

Uses **Nodemailer** with Gmail SMTP:
- Supports both **App Password** (simple) and **OAuth2** (production-grade)
- Verifies SMTP connection before sending
- Composes a professional HTML email with inline styling
- Attaches `assets/resume.pdf` automatically
- Adds a polite 2–3 second delay between sends to avoid spam filters

---

## Configuration Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `LINKEDIN_EMAIL` | ✅ | Your LinkedIn login email |
| `LINKEDIN_PASSWORD` | ✅ | Your LinkedIn password |
| `SEARCH_KEYWORD_1` | ✅ | First keyword (default: `JAVA DEVELOPER`) |
| `SEARCH_KEYWORD_2` | ✅ | Second keyword (default: `CONTRACT`) |
| `MAX_RESULTS` | ❌ | Max posts to scrape (default: `20`) |
| `GMAIL_EMAIL` | ✅ | Your Gmail address |
| `GMAIL_APP_PASSWORD` | ✅* | Gmail App Password (*or use OAuth2) |
| `GMAIL_CLIENT_ID` | ✅* | OAuth2 Client ID (*alternative to App Password) |
| `GMAIL_CLIENT_SECRET` | ✅* | OAuth2 Client Secret |
| `GMAIL_REFRESH_TOKEN` | ✅* | OAuth2 Refresh Token |
| `CANDIDATE_NAME` | ✅ | Your name (used in email signature) |
| `CANDIDATE_PHONE` | ❌ | Your phone number |
| `HEADLESS` | ❌ | `false` = show browser window (debug mode) |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| LinkedIn security checkpoint | Run `npm run dev` (headless=false) and complete CAPTCHA manually |
| `Gmail authentication failed` | Ensure App Password is correct and 2FA is enabled |
| No posts found | LinkedIn may have changed DOM selectors — inspect page and update `jobSearcher.js` |
| Resume not attached | Place PDF at `assets/resume.pdf` |

---

## ⚠️ Important Notes

1. **LinkedIn Terms of Service**: Automated scraping may violate LinkedIn's ToS. This project is built for educational/internship purposes only. Use responsibly.
2. **Rate limiting**: LinkedIn may temporarily restrict your account if too many requests are made. The auto-scroll delays and send delays help mitigate this.
3. **CAPTCHA**: If LinkedIn detects automation, it will show a CAPTCHA. Run with `HEADLESS=false` to solve it manually.
4. **Credential safety**: Never commit your `config/.env` file. It is already in `.gitignore`.

---

## Tech Stack

| Library | Purpose |
|---------|---------|
| [Puppeteer](https://pptr.dev/) | Headless Chrome browser automation |
| [Nodemailer](https://nodemailer.com/) | Email sending via Gmail SMTP |
| [dotenv](https://github.com/motdotla/dotenv) | Environment variable management |

---

*Built for internship assignment evaluation — demonstrates end-to-end browser automation and email integration in Node.js.*
