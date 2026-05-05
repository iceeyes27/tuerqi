# SEAGM Price Monitor

Cloudflare Worker Cron job for tracking SEAGM Turkey iTunes gift card CNY prices and appending them to Google Sheets.

## What It Captures

Default denominations:

- `500 TL`
- `1000 TL`
- `2000 TL`

Each run appends one row per denomination:

```text
captured_at, denom_tl, price_cny, original_price_cny, discount_percent, seagm_credits, status, source_url
```

## Google Sheet Setup

1. Create a Google Sheet.
2. Add a tab named `Prices`.
3. Put this header row in `Prices!A1:H1`:

```text
captured_at	denom_tl	price_cny	original_price_cny	discount_percent	seagm_credits	status	source_url
```

4. In Google Cloud Console, create a Service Account and enable Google Sheets API.
5. Create a JSON key for the Service Account.
6. Share your Google Sheet with the Service Account email as an editor.

## Local Setup

Install dependencies:

```sh
npm install
```

Create local secrets:

```sh
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars`:

```sh
GOOGLE_SERVICE_ACCOUNT_EMAIL="your-service-account@your-project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID="your_google_sheet_id"
```

Run locally:

```sh
npm run dev
```

Dry run without writing to Sheets:

```sh
curl 'http://localhost:8787/run?dry=1'
```

Run and append to Sheets:

```sh
curl 'http://localhost:8787/run'
```

## Deploy To Cloudflare Workers

Login:

```sh
npx wrangler login
```

Set production secrets:

```sh
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put GOOGLE_SHEET_ID
```

Deploy:

```sh
npm run deploy
```

The Cron schedule is in `wrangler.toml`:

```toml
[triggers]
crons = ["0 2 * * *"]
```

Cloudflare Cron uses UTC. `0 2 * * *` means every day at `02:00 UTC`, which is `10:00` in China Standard Time.

## Change Tracked Denominations

Edit `wrangler.toml`:

```toml
[vars]
DENOMS = "500,1000,2000"
```

## Notes

- The Worker reads the Chinese/CNY SEAGM page directly.
- It records the displayed discounted CNY price, not an inferred FX conversion.
- Secrets stay out of git. Use `.dev.vars` locally and `wrangler secret put` in Cloudflare.

Relevant docs:

- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Google Sheets append API: https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
