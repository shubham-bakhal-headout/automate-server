# Automate Server

Vendor form-filling script store + observability dashboard for the Headout booking team.

## Architecture

```
automate-server/
  backend/      Express + Prisma + TypeScript API on Postgres
  frontend/     React + TS dashboard (Vite)
  docker-compose.yml   Postgres 16
```

The Chrome extension (`hackathon-extension-poc`) calls the backend to:
1. Fetch the autofill script for a vendor form URL.
2. Report the fill result (telemetry) after each booking is processed.

## Quick start

### 1. Start Postgres

```sh
docker compose up -d postgres
```

Or use your local Postgres instance — just set `DATABASE_URL` in `backend/.env`.

### 2. Backend

```sh
cd backend
cp .env.example .env          # edit DATABASE_URL if needed
npm install
npx prisma migrate dev        # applies DB schema
npm run seed                  # seeds sample data
npm run dev                   # starts on http://127.0.0.1:3000
```

### 3. Frontend dashboard

```sh
cd frontend
cp .env.example .env          # VITE_API_URL defaults to http://127.0.0.1:3000
npm install
npm run dev                   # opens http://localhost:5173
```

## API reference

### Script store (extension-facing)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/vendors` | List vendors with latest script status |
| `GET` | `/api/vendors/:id` | Vendor + all script versions |
| `POST` | `/api/vendors` | Create vendor `{ name, url }` |
| `POST` | `/api/vendors/:id/scripts` | Add script version `{ content, fieldMap? }` |
| `GET` | `/api/scripts/resolve?url=<formUrl>` | Resolve latest active script for a URL |
| `GET` | `/api/scripts/resolve?url=<formUrl>&format=js` | Same, returns raw JavaScript |
| `PUT` | `/api/scripts/:id` | Update `content`, `fieldMap`, or `status` |

### Observability

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/events` | Report a fill event from the extension |
| `GET` | `/api/analytics/summary` | Totals: fills, success rate, active users, failing scripts |
| `GET` | `/api/analytics/timeseries?granularity=day\|hour` | Fills over time |
| `GET` | `/api/analytics/by-vendor` | Fills + success rate per vendor |
| `GET` | `/api/analytics/by-user` | Fills per booking-team agent |
| `GET` | `/api/analytics/script-health` | Failing/active scripts + recent errors |

### Event payload (extension → server)

```json
{
  "vendorUrl": "https://vendor.com/booking-form",
  "userEmail": "agent@headout.com",
  "userName": "Riya Sharma",
  "bookingId": "BK-12345",
  "status": "SUCCESS",
  "durationMs": 1200,
  "fieldResults": [{ "key": "name", "ok": true }, { "key": "date", "ok": false, "error": "Field not found" }]
}
```

`status` is one of `SUCCESS` / `PARTIAL` / `FAILURE`. A `FAILURE` or any `ok: false` field automatically marks the script as `FAILING` (the vendor form changed).

## Extension setup

In `hackathon-extension-poc/config.js`, `AUTOFILL_SERVICE.scriptUrl` is pre-pointed at `http://127.0.0.1:3000/api/scripts/resolve`. Load the extension as unpacked in Chrome — it will fetch scripts and send telemetry to the running backend.

## Dashboard pages

- **Overview** — stat cards + fills-over-time line chart (day / hour toggle)
- **Vendors** — table with fill counts, success rate, script status; inline script editor
- **Script Health** — failing scripts, field-level errors, one-click "mark active" after fixing
- **Team** — fills per booking agent
