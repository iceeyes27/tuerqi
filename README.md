# SEAGM Price Monitor

Cloudflare Worker Cron job for tracking SEAGM Turkey iTunes gift card CNY prices. Data is stored in Cloudflare KV and shown directly on the Worker page.

## What It Captures

Default denominations:

- `500 TL`
- `1000 TL`
- `2000 TL`

Each run stores one snapshot:

```text
captured_at, source_url, prices[]
```

The dashboard keeps the latest `60` days by default, capped at `500` records.

## Cloudflare KV Setup

Create a KV namespace:

```sh
npx wrangler kv namespace create PRICE_HISTORY
```

Wrangler prints an id like this:

```toml
[[kv_namespaces]]
binding = "PRICE_HISTORY"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Copy the printed `id` into `wrangler.toml`.

## Local Setup

Install dependencies:

```sh
npm install
```

Run locally:

```sh
npm run dev
```

Dry run without writing to KV:

```sh
curl 'http://localhost:8787/run?dry=1'
```

Run and save to KV locally with a token:

```sh
npx wrangler dev --var RUN_TOKEN:local-dev-token
curl 'http://localhost:8787/run?token=local-dev-token'
```

Open the dashboard:

```text
http://localhost:8787/
```

## Manual Run Protection

`/run?dry=1` is public and does not write to KV. A real `/run` write requires a `RUN_TOKEN` secret so visitors cannot mutate production history:

```sh
npx wrangler secret put RUN_TOKEN
```

Manual production write examples:

```sh
curl -H 'Authorization: Bearer <RUN_TOKEN>' 'https://tuerqi.littlelittlepony.workers.dev/run'
# or
curl 'https://tuerqi.littlelittlepony.workers.dev/run?token=<RUN_TOKEN>'
```

Cloudflare Cron writes do not need this token.

## Deploy To Cloudflare Workers

Login:

```sh
npx wrangler login
```

Deploy:

```sh
npm run deploy
```

The Cron schedule is in `wrangler.toml`:

```toml
[triggers]
crons = ["0 0 * * *", "0 6 * * *"]
```

Cloudflare Cron uses UTC. `0 0 * * *` and `0 6 * * *` mean every day at `00:00 UTC` and `06:00 UTC`, which are `08:00` and `14:00` in China Standard Time.

## Change Tracked Denominations

Edit `wrangler.toml`:

```toml
[vars]
DENOMS = "500,1000,2000"
```

## View Data

Production dashboard:

```text
https://tuerqi.littlelittlepony.workers.dev/
```

JSON history:

```text
https://tuerqi.littlelittlepony.workers.dev/api/history
```

Manual scrape and save with token:

```text
https://tuerqi.littlelittlepony.workers.dev/run?token=<RUN_TOKEN>
```

Manual scrape without saving:

```text
https://tuerqi.littlelittlepony.workers.dev/run?dry=1
```

## Notes

- The Worker reads the Chinese/CNY SEAGM page directly.
- It records the displayed discounted CNY price, not an inferred FX conversion.
- When saving, duplicate snapshots with identical source, FX, and price data inside a 6-hour window are compacted so only the latest copy remains.
- Data is stored in Cloudflare KV under `seagm:history:v1`.
- `/` and `/api/history` are cached at the Cloudflare edge for 60 seconds to reduce KV reads and HTML/SVG rendering work.
- History is pruned by both `RETENTION_DAYS` and `MAX_HISTORY_RECORDS` to keep the KV value bounded.

Relevant docs:

- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Workers KV: https://developers.cloudflare.com/kv/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
