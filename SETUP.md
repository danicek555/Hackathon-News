# Hackathon & Challenges Digest – Setup

Weekly digest of hackathons (Denver, Czech Republic, near you) and programming challenges (Swift, React, web) you can sign up for.

## Schedule

- **Runs once a week:** every **Monday at 8:00 AM Denver time** (same as Tech News time).
- Tech News runs **every 2 days**; this digest runs **weekly**.

## GitHub Secrets

### Required

- `OPENAI_API_KEY` – Your OpenAI API key
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` – Email (same as Tech News)
- `RECIPIENT_EMAIL` – Where to send the digest (comma-separated for multiple addresses, e.g. `you@mail.com,other@mail.com`)

### Optional (defaults are tuned for Denver + Czech Republic + challenges)

- `LANGUAGE` – `en` or `cs` (default: `en`)
- `LOCATIONS` – Comma-separated locations to search. Default: Denver/Colorado, Czech Republic (whole country), “near me”
- `CHALLENGE_TOPICS` – Comma-separated focus for programming challenges. Default: Apple Swift Student Challenge, Swift challenges, React/JS challenges, web dev competitions
- `RECENCY_HOURS` – How many hours back to search (default: **168** = 7 days for weekly digest)
- `MAX_ITEMS` – Max items in the digest (default: `36`)

## Local run

```bash
cd hackathonNews
cp .env.example .env   # if you have one
# Set OPENAI_API_KEY (and optionally RECIPIENT_EMAIL, SMTP_*)
npm start
```

Manual trigger: in the repo on GitHub, **Actions** → **Hackathon & Challenges Digest** → **Run workflow**.
