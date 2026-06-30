# SEAGM Price Monitor

Cloudflare Worker Cron job for tracking SEAGM Turkey iTunes gift card CNY prices. Data is stored in Cloudflare KV and shown directly on the Worker page.

首页现在除了礼品卡价格，也支持一个**拼车对账板块**，用于记录：

- YouTube 家庭会员
- Spotify 家庭会员
- 车位状态
- 到期时间
- 成本、建议收费、已收/待收

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

## Configure Ride Sharing Board

拼车板块分成两部分：

1. **订阅价格**：自动从 appstoreprice 读取尼日利亚区 CNY
2. **对账信息**：继续由 `RIDESHARE_PLANS_JSON` 维护车位、到期日、已收金额

当前接入来源：

- YouTube Premium Family: `https://appstoreprice.org/zh/apps/544007664`
- Spotify 家庭会员: `https://appstoreprice.org/zh/apps/spotify`

`RIDESHARE_PLANS_JSON` 主要字段：

- `id`
- `sourceKey`
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
- `paidThrough`
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
      { "slot": "2", "name": "A", "status": "occupied", "paidThrough": "2026-07-31", "paidAmountCny": 2.5 },
      { "slot": "3", "status": "available" }
    ]
  }
]
'''
```

页面会自动计算：

- 官方标价（原价 + CNY）
- 我的单座成本 = `总价 / 总座位数`
- 外拼回本价 = `总价 / 可外拼座位数`
- 建议收费 = 回本价向上取整到 `0.5` 元
- 已收 / 待收金额
- 已占用 / 空余车位数

说明：

- 默认按“我占 1 座”设计。
- 价格读取失败时，拼车板块会显示失败状态，但不会影响主页面返回。
- 当前抓取的家庭会员价格以 appstoreprice 尼日利亚区页面为准。

## View Data

Production dashboard:

```text
https://tuerqi.littlelittlepony.workers.dev/
```

JSON history:

```text
https://tuerqi.littlelittlepony.workers.dev/api/history
```

Ride share JSON:

```text
https://tuerqi.littlelittlepony.workers.dev/api/rideshare
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
- When saving, duplicate snapshots with identical source, FX, and price data inside a 6-hour window are compacted so only the latest copy remains.
- Data is stored in Cloudflare KV under `seagm:history:v1`.

Relevant docs:

- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Workers KV: https://developers.cloudflare.com/kv/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
