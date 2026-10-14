# gold-rate-api

Cloudflare Worker (Node.js tooling, zero runtime dependencies) that replicates this Google Sheets formula as a JSON API:

```
=VALUE(SUBSTITUTE(REGEXEXTRACT(INDEX(IMPORTHTML("https://www.goodreturns.in/gold-rates/", "table", 1), 2, 2), "[0-9,]+"), ",", ""))
```

It fetches `https://www.goodreturns.in/gold-rates/bangalore.html`, reads **table 1 → row 2 → columns 2–4** (Bangalore **24K, 22K and 18K gold prices per gram**), strips commas, and returns the numbers.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /` | Endpoint info |
| `GET /api/gold` | JSON (below) |
| `GET /api/gold?format=raw` | CSV row, e.g. `14826,13590,11119` |
| `GET /api/gold?format=raw&purity=24` | Single value (purity: `24`, `22` or `18`), e.g. `14826` |

```json
{
  "city": "Bangalore",
  "currency": "INR",
  "unit": "gram",
  "gold24kPerGramInr": 14826,
  "gold22kPerGramInr": 13590,
  "gold18kPerGramInr": 11119,
  "source": "https://www.goodreturns.in/gold-rates/bangalore.html",
  "fetchedAt": "2026-10-14T04:59:20.396Z"
}
```

Responses are cached (Cache API) for 1 hour. CORS is open (`*`). Upstream failures return HTTP 502 with a JSON error.

## Google Sheets

After deploying, replace the formula with:

```
=IMPORTDATA("https://gold-rate-api.<your-subdomain>.workers.dev/api/gold?format=raw")
```

That single call spreads across three columns: 24K | 22K | 18K.

For one purity only:

```
https://gold-rate-api.<your-subdomain>.workers.dev/api/gold?format=raw&purity=22
```

An unsupported purity returns HTTP 400 with `{ "error": "Invalid purity", "validValues": ["24", "22", "18"] }`.

## Local development

```bash
npm install
npm run dev        # wrangler dev -> http://localhost:8787
npm test           # node --test (number-extraction unit tests)
```

## Deploy

```bash
npx wrangler login   # once
npm run deploy
```
