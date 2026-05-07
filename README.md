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

The dashboard keeps the latest `60` days by default.

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

Run and save to KV:

```sh
curl 'http://localhost:8787/run'
```

Open the dashboard:

```text
http://localhost:8787/
```

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

Manual scrape and save:

```text
https://tuerqi.littlelittlepony.workers.dev/run
```

Manual scrape without saving:

```text
https://tuerqi.littlelittlepony.workers.dev/run?dry=1
```

## Notes

- The Worker reads the Chinese/CNY SEAGM page directly.
- It records the displayed discounted CNY price, not an inferred FX conversion.
- Data is stored in Cloudflare KV under `seagm:history:v1`.

Relevant docs:

- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Workers KV: https://developers.cloudflare.com/kv/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
