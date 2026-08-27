# Price Monitor

Cloudflare Worker Cron job that tracks currency conversions and regional prices on one dashboard:

- **`/` — 跨区汇率、订阅与土耳其礼品卡**: Google Finance conversions for `139.9 BOB → CNY` and `9010 PHP → USD / CNY`, Nigeria App Store prices for YouTube Premium and Spotify, and SEAGM Turkey iTunes gift card CNY prices compared with Google Finance TRY/CNY.

The dashboard uses one five-tab trend bar: Bolivia, Philippines, YouTube, Spotify, and Turkey gift cards. YouTube single/family prices share one two-line chart, Spotify individual/family prices share another, and Turkey `500 / 1000 / 2000 TL` prices share one three-line chart. `/turkey` redirects to the homepage and opens the Turkey tab. Data is stored in Cloudflare KV and rendered directly by the Worker. Subscription history keeps one point per Asia/Shanghai calendar day and displays the capture time in history.

## What It Captures (Turkey)

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

## Configure Ride Sharing Board

首页除了订阅价格走势，也支持一个**拼车对账板块**，用于记录 YouTube / Spotify 家庭会员的车位状态、到期时间、成本、建议收费、已收/待收金额。

拼车板块分成两部分：

1. **订阅价格**：复用尼日利亚订阅监控的每日 CNY 数据。
2. **对账信息**：优先从 KV 的 `rideshare:plans:v1` 读取线上编辑后的配置；如果 KV 里还没有数据，再回退到 `RIDESHARE_PLANS_JSON` / 默认配置。

当前默认接入来源：

- YouTube Premium Family: `https://appstoreprice.org/zh/apps/544007664`
- Spotify 家庭会员: `https://appstoreprice.org/zh/apps/spotify`

`RIDESHARE_PLANS_JSON` 主要字段：

- `id`
- `sourceKey`（对应 `nigeriaItems()` 中的 key，例如 `youtube-family` / `spotify-family`）
- `name`
- `platform`
- `totalSeats`
- `ownerSeats`
- `renewOn`
- `note`
- `seats[]`

每个 seat 可配置：

- `slot`
- `name`
- `status`: `owner | occupied | pending | available`
- `onboardedAt`（上车时间）
- `paidThrough`（有效期 / 付费到）
- `chargeCny`
- `paidAmountCny`
- `note`

示例：

```toml
RIDESHARE_PLANS_JSON = '''
[
  {
    "id": "spotify-family",
    "sourceKey": "spotify-family",
    "name": "Spotify 家庭会员",
    "platform": "Spotify",
    "totalSeats": 6,
    "ownerSeats": 1,
    "renewOn": "2026-07-31",
    "seats": [
      { "slot": "1", "name": "我", "status": "owner" },
      { "slot": "2", "name": "A", "status": "occupied", "onboardedAt": "2026-07-01", "paidThrough": "2026-07-31", "paidAmountCny": 2.5 },
      { "slot": "3", "status": "available" }
    ]
  }
]
'''
```

页面会自动计算：

- 官方标价（NGN + CNY）
- 我的单座成本 = `总价 / 总座位数`
- 外拼回本价 = `总价 / 可外拼座位数`
- 建议收费 = 回本价向上取整到 `0.5` 元
- 已收 / 待收金额
- 已占用 / 空余车位数

页面保留拼车汇总和“编辑拼车”功能，不显示只读车位明细表。“编辑拼车”可修改车位状态、成员、上车时间、有效期、收费和已收金额。保存会写入 KV，需要和 `/run` 相同的 `RUN_TOKEN` 授权：

```sh
curl -X POST -H 'Authorization: Bearer <RUN_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"plans":[...]}' \
  'https://tuerqi.littlelittlepony.workers.dev/api/rideshare'
```

保存成功后会清理 `/` 和 `/api/rideshare` 等读缓存。

说明：

- 默认按“我占 1 座”设计。
- 价格读取失败或当天缺少家庭会员数据时，拼车板块会显示失败状态，但不会影响主页面返回。
- 当前抓取的家庭会员价格以 App Store Price 尼日利亚区页面为准。

## View Data

Production dashboard:

```text
https://tuerqi.littlelittlepony.workers.dev/
```

Turkey tab compatibility URL:

```text
https://tuerqi.littlelittlepony.workers.dev/turkey
```

JSON history / config (Nigeria / Turkey / rideshare):

```text
https://tuerqi.littlelittlepony.workers.dev/api/nigeria
https://tuerqi.littlelittlepony.workers.dev/api/history
https://tuerqi.littlelittlepony.workers.dev/api/rideshare
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

- Default dashboard: Google Finance supplies direct `BOB/CNY`, `PHP/USD`, and `PHP/CNY` rates. The Worker stores the unit rate, fixed input amount, converted amount, source URL, and capture time. App Store Price supplies Nigeria YouTube and Spotify subscription prices. Each source can fail independently without suppressing successful values from the other source.
- Legacy Claude data remains in existing KV records for compatibility, but is not fetched, rendered, or returned by `/api/nigeria`.
- Turkey: the Worker reads the Chinese/CNY SEAGM page directly and records the displayed discounted CNY price, not an inferred FX conversion.
- When saving Turkey snapshots, duplicates with identical source, FX, and price data inside a 6-hour window are compacted so only the latest copy remains.
- Data is stored in Cloudflare KV under the backward-compatible `appstore:ng-claude:v1` key (default dashboard), `seagm:history:v1` (Turkey), and `rideshare:plans:v1` (editable ride-sharing config).
- `/`, `/api/nigeria`, `/api/history`, and `/api/rideshare` are cached at the Cloudflare edge for 60 seconds to reduce KV reads and HTML/SVG rendering work. `/turkey` is an uncached redirect that opens the homepage Turkey tab.
- History is pruned by both `RETENTION_DAYS` and `MAX_HISTORY_RECORDS` to keep the KV value bounded.

Relevant docs:

- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Workers KV: https://developers.cloudflare.com/kv/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
