# YourSpotRented — Monthly Reporting Tool (Render deploy)

A year-over-year monthly operations report, live from Airtable — the same layout as the
July 2026 report (Towing, Tow Incidents, Listing Issues, Customers, Reservations, Refunds,
Expenses), with charts, exports, and a monthly data-entry form.

Unlike the single-file version, **the Airtable token lives on the server as an environment
variable** — it is never sent to the browser and never stored in the code. This is the same
pattern as your weekly tool.

## How it works

- `server.js` — a tiny Express server. Holds the token, exposes two routes:
  - `GET /api/data` — returns the `Monthly Report` snapshot + the live towing log.
  - `PATCH /api/entry` — upserts one month's row (used by the in-app **Monthly Entry** form).
- `public/index.html` — the report UI. Calls `/api/*`; contains no token.

Data sources in Airtable (base **Facility Management Database**):
- **Monthly Report** table (`tblJ7i6J3wxf03Kxk`) — one row per month; seeded with 2024/2025/2026 figures.
- **TOWED ILLEGAL PARKER** table — towing counts are aggregated live and overlaid on the current year.

## Deploy to Render

1. Push this folder to a GitHub repo (or upload it).
2. In Render → **New → Web Service** → connect the repo.
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   (Or just use the included `render.yaml` via **New → Blueprint**.)
3. Add an environment variable:
   - `AIRTABLE_TOKEN` = your Airtable Personal Access Token.
4. Deploy. Open the Render URL — the report loads automatically.

### Creating the Airtable token
At https://airtable.com/create/tokens create a Personal Access Token with:
- Scopes: `data.records:read` (add `data.records:write` to use the Monthly Entry form)
- Access: the **Facility Management Database** base

Optional env vars (defaults already point to your base/tables): `AIRTABLE_BASE_ID`,
`MONTHLY_TABLE`, `TOWING_TABLE`, `TOWING_DATE_FIELD`. See `.env.example`.

## Run locally

```bash
npm install
AIRTABLE_TOKEN=pat_your_token npm start
# open http://localhost:3000
```

## Monthly workflow

Towing updates automatically from your towing log. For everything else (reservations,
customers, refunds, tow incidents, listing issues, expenses), click **+ Monthly Entry**,
enter the month's numbers, and Save — the row is written to the Monthly Report table and the
report rebuilds. Next year's report then fills itself in as you go.
