const HISTORY_KEY = "seagm:history:v1";
const DEFAULT_RETENTION_DAYS = 60;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        const history = await loadHistory(env);
        return html(renderDashboard(history, env));
      }

      if (url.pathname === "/api/history") {
        const history = await loadHistory(env);
        return json({
          ok: true,
          retentionDays: retentionDays(env),
          latest: latestRecord(history),
          records: history,
        });
      }

      if (url.pathname === "/run") {
        const dryRun = url.searchParams.get("dry") === "1";
        const result = await runMonitor(env, { dryRun });
        return json(result);
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  },
};

async function runMonitor(env, options = {}) {
  assertKv(env);

  const html = await fetchSeagmHtml(env.SEAGM_URL);
  const denoms = parseDenoms(env.DENOMS);
  const prices = extractPrices(html, denoms);
  const record = {
    capturedAt: new Date().toISOString(),
    sourceUrl: env.SEAGM_URL,
    prices,
  };

  if (!options.dryRun) {
    const history = await loadHistory(env);
    history.push(record);
    await saveHistory(env, pruneHistory(history, retentionDays(env)));
  }

  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    record,
  };
}

async function fetchSeagmHtml(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 seagm-price-monitor/2.0",
    },
  });

  if (!response.ok) {
    throw new Error(`SEAGM request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function extractPrices(pageHtml, denoms) {
  const pageCurrency = detectPageCurrency(pageHtml);
  if (pageCurrency && pageCurrency !== "CNY") {
    throw new Error(`SEAGM returned ${pageCurrency} page instead of CNY page`);
  }

  const creditRate = extractCreditRate(pageHtml);
  const clientDataPrices = extractPricesFromClientData(pageHtml, denoms, creditRate);
  const skuBlocks = pageHtml.match(/<label>[\s\S]*?<\/label>/gi) || [];

  return denoms.map((denom) => {
    const block = skuBlocks.find((item) =>
      new RegExp(`iTunes Gift Card ${denom} TL TR`, "i").test(item)
    );

    const match = block?.match(
      /<div class="price">[\s\S]*?<b>¥\s*([0-9.]+)<\/b>\s*<b class="price_origional">¥\s*([0-9.]+)<\/b>/i
    );

    if (match) {
      return buildPrice(denom, Number(match[1]), Number(match[2]), creditRate);
    }

    const fromClientData = clientDataPrices.get(denom);
    if (fromClientData) {
      return fromClientData;
    }

    const currencyHint = pageCurrency ? ` currency=${pageCurrency}` : "";
    throw new Error(`Could not find CNY price for ${denom} TL on SEAGM page.${currencyHint}`);
  });
}

function extractPricesFromClientData(pageHtml, denoms, creditRate) {
  const prices = new Map();
  const match = pageHtml.match(/window\.clientData\s*=\s*(\{[\s\S]*?\});/);
  if (!match) {
    return prices;
  }

  let clientData;
  try {
    clientData = JSON.parse(match[1]);
  } catch {
    return prices;
  }

  const cardTypeList = clientData.cardTypeList || {};
  const cardRuleList = clientData.cardRuleList || {};

  for (const denom of denoms) {
    const cardType = Object.values(cardTypeList).find((item) =>
      String(item.name_us || item.name || "").includes(`iTunes Gift Card ${denom} TL TR`)
    );

    if (!cardType) {
      continue;
    }

    const originalPriceCny = Number(cardType.origin_price || cardType.origin_unit_price || cardType.unit_price);
    if (!Number.isFinite(originalPriceCny)) {
      continue;
    }

    const rule = Array.isArray(cardRuleList[cardType.id]) ? cardRuleList[cardType.id][0] : null;
    const rebate = rule?.type === "discount" ? Number(rule.rebate || 0) : 0;
    const priceCny = rebate > 0
      ? round2(originalPriceCny * (1 - rebate / 100))
      : originalPriceCny;

    prices.set(denom, buildPrice(denom, priceCny, originalPriceCny, creditRate));
  }

  return prices;
}

function buildPrice(denomTl, priceCny, originalPriceCny, creditRate) {
  const discountPercent = originalPriceCny > 0
    ? round2((1 - priceCny / originalPriceCny) * 100)
    : 0;

  return {
    denomTl,
    priceCny,
    originalPriceCny,
    discountPercent,
    credits: Math.round(priceCny * creditRate),
    available: true,
  };
}

function extractCreditRate(pageHtml) {
  const match = pageHtml.match(/var\s+fromCurrencyRate\s*=\s*([0-9.]+);/);
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : 58.032155;
}

function detectPageCurrency(pageHtml) {
  const gtmCurrency = pageHtml.match(/Currency:\s*'([A-Z]{3})'/);
  if (gtmCurrency) {
    return gtmCurrency[1];
  }

  const jsonCurrency = pageHtml.match(/"currency"\s*:\s*"([A-Z]{3})"/);
  if (jsonCurrency) {
    return jsonCurrency[1];
  }

  const formatCurrency = pageHtml.match(/"currency_format"\s*:\s*"\\u00a5 \$m"/);
  if (formatCurrency) {
    return "CNY";
  }

  return "";
}

async function loadHistory(env) {
  assertKv(env);
  const history = await env.PRICE_HISTORY.get(HISTORY_KEY, "json");
  return Array.isArray(history) ? history : [];
}

async function saveHistory(env, history) {
  await env.PRICE_HISTORY.put(HISTORY_KEY, JSON.stringify(history));
}

function pruneHistory(history, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history
    .filter((record) => Date.parse(record.capturedAt) >= cutoff)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

function renderDashboard(history, env) {
  const denoms = parseDenoms(env.DENOMS);
  const latest = latestRecord(history);
  const records = pruneHistory(history, retentionDays(env));
  const chart = renderChart(records, denoms);
  const latestCards = renderLatestCards(latest, denoms);
  const table = renderHistoryTable(records, denoms);
  const updatedAt = latest ? formatDateTime(latest.capturedAt) : "暂无数据";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SEAGM 土区礼品卡价格</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f2;
      --ink: #1c2321;
      --muted: #66706b;
      --line: #d9dfd7;
      --panel: #ffffff;
      --green: #1e7c63;
      --blue: #2f68b8;
      --coral: #c9513e;
      --amber: #a86912;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      letter-spacing: 0;
    }
    main {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 40px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 22px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(28px, 4vw, 44px);
      line-height: 1.05;
      font-weight: 760;
    }
    .meta {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    a.button {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--ink);
      text-decoration: none;
      font-size: 14px;
      font-weight: 650;
      white-space: nowrap;
    }
    a.primary {
      background: var(--green);
      border-color: var(--green);
      color: white;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-height: 128px;
    }
    .label {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    .price {
      margin-top: 8px;
      font-size: 32px;
      line-height: 1;
      font-weight: 790;
    }
    .sub {
      margin-top: 10px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      margin-top: 14px;
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }
    h2 {
      margin: 0;
      font-size: 16px;
    }
    .chart-wrap {
      padding: 12px 16px 16px;
      overflow-x: auto;
    }
    svg {
      display: block;
      width: 100%;
      min-width: 720px;
      height: auto;
    }
    .legend {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 13px;
      font-weight: 650;
    }
    .dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 999px;
      margin-right: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      padding: 11px 14px;
      text-align: left;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
      background: #fbfcf9;
    }
    tr:last-child td { border-bottom: 0; }
    .empty {
      padding: 34px 16px;
      color: var(--muted);
      text-align: center;
    }
    @media (max-width: 760px) {
      header { display: block; }
      .actions { justify-content: flex-start; margin-top: 14px; }
      .cards { grid-template-columns: 1fr; }
      main { width: min(100vw - 24px, 1120px); padding-top: 20px; }
      .table-wrap { overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>土区礼品卡价格</h1>
        <p class="meta">最近 ${escapeHtml(String(retentionDays(env)))} 天数据，最后更新：${escapeHtml(updatedAt)}</p>
      </div>
      <div class="actions">
        <a class="button" href="/api/history">JSON</a>
        <a class="button" href="/run?dry=1">试抓</a>
        <a class="button primary" href="/run">抓取并保存</a>
      </div>
    </header>

    <section class="cards">${latestCards}</section>

    <section class="panel">
      <div class="panel-head">
        <h2>价格趋势</h2>
        <div class="legend">${renderLegend(denoms)}</div>
      </div>
      <div class="chart-wrap">${chart}</div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>历史记录</h2>
        <p class="meta">${records.length} 次抓取</p>
      </div>
      <div class="table-wrap">${table}</div>
    </section>
  </main>
</body>
</html>`;
}

function renderLatestCards(latest, denoms) {
  return denoms.map((denom) => {
    const price = latest?.prices?.find((item) => item.denomTl === denom);
    if (!price) {
      return `<article class="card"><div class="label">${denom} TL</div><div class="price">--</div><div class="sub">等待首次抓取</div></article>`;
    }

    return `<article class="card">
      <div class="label">${denom} TL</div>
      <div class="price">¥${formatMoney(price.priceCny)}</div>
      <div class="sub">原价 ¥${formatMoney(price.originalPriceCny)} · 折扣 ${formatMoney(price.discountPercent)}%<br>SEAGM Credits ${price.credits}</div>
    </article>`;
  }).join("");
}

function renderChart(records, denoms) {
  if (records.length === 0) {
    return `<div class="empty">暂无数据，点击“抓取并保存”生成第一条记录。</div>`;
  }

  const width = 960;
  const height = 320;
  const pad = { top: 22, right: 24, bottom: 42, left: 54 };
  const values = records.flatMap((record) => record.prices.map((price) => price.priceCny));
  const min = Math.floor(Math.min(...values) * 0.98);
  const max = Math.ceil(Math.max(...values) * 1.02);
  const xStep = records.length > 1
    ? (width - pad.left - pad.right) / (records.length - 1)
    : 0;
  const y = (value) =>
    pad.top + (max - value) / Math.max(1, max - min) * (height - pad.top - pad.bottom);
  const x = (index) => pad.left + index * xStep;
  const colors = ["#1e7c63", "#2f68b8", "#c9513e", "#a86912"];
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const gy = pad.top + ratio * (height - pad.top - pad.bottom);
    const label = max - ratio * (max - min);
    return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="#d9dfd7" />
      <text x="10" y="${gy + 4}" fill="#66706b" font-size="12">¥${formatMoney(label)}</text>`;
  }).join("");

  const lines = denoms.map((denom, colorIndex) => {
    const points = records
      .map((record, index) => {
        const price = record.prices.find((item) => item.denomTl === denom);
        return price ? `${x(index)},${y(price.priceCny)}` : null;
      })
      .filter(Boolean)
      .join(" ");

    return `<polyline points="${points}" fill="none" stroke="${colors[colorIndex % colors.length]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;
  }).join("");

  const marks = records.map((record, index) => {
    if (index !== 0 && index !== records.length - 1 && records.length > 8 && index % Math.ceil(records.length / 6) !== 0) {
      return "";
    }
    return `<text x="${x(index)}" y="${height - 14}" fill="#66706b" font-size="12" text-anchor="middle">${formatShortDate(record.capturedAt)}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="SEAGM 价格趋势图">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
    ${grid}
    ${lines}
    ${marks}
  </svg>`;
}

function renderHistoryTable(records, denoms) {
  if (records.length === 0) {
    return `<div class="empty">暂无历史记录。</div>`;
  }

  const header = denoms.map((denom) => `<th>${denom} TL</th>`).join("");
  const rows = [...records].reverse().map((record) => {
    const cells = denoms.map((denom) => {
      const price = record.prices.find((item) => item.denomTl === denom);
      return `<td>${price ? `¥${formatMoney(price.priceCny)}` : "--"}</td>`;
    }).join("");

    return `<tr>
      <td>${escapeHtml(formatDateTime(record.capturedAt))}</td>
      ${cells}
      <td><a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noreferrer">SEAGM</a></td>
    </tr>`;
  }).join("");

  return `<table>
    <thead><tr><th>时间</th>${header}<th>来源</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLegend(denoms) {
  const colors = ["#1e7c63", "#2f68b8", "#c9513e", "#a86912"];
  return denoms.map((denom, index) =>
    `<span><i class="dot" style="background:${colors[index % colors.length]}"></i>${denom} TL</span>`
  ).join("");
}

function latestRecord(history) {
  return [...history].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] || null;
}

function parseDenoms(value = "500,1000,2000") {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function retentionDays(env) {
  const value = Number(env.RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RETENTION_DAYS;
}

function assertKv(env) {
  if (!env.PRICE_HISTORY) {
    throw new Error("Missing Cloudflare KV binding: PRICE_HISTORY");
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function formatMoney(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
