const HISTORY_KEY = "seagm:history:v1";
const DEFAULT_RETENTION_DAYS = 60;
const DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
const GOOGLE_FINANCE_TRY_CNY_URL = "https://www.google.com/finance/quote/TRY-CNY";
const APPSTOREPRICE_SUBSCRIPTION_SOURCES = {
  "youtube-family": {
    url: "https://appstoreprice.org/zh/apps/544007664",
    subscriptionIds: [
      "com.google.youtube.family.red.subscription_NFT",
      "com.google.youtube.family.red.subscription",
    ],
    fallbackName: "YouTube Premium Family",
  },
  "spotify-family": {
    url: "https://appstoreprice.org/zh/apps/spotify",
    subscriptionIds: ["spotify_family"],
    fallbackName: "Spotify 会员 (家庭)",
  },
};
const DEFAULT_RIDESHARE_PLANS = [
  {
    id: "youtube-family",
    sourceKey: "youtube-family",
    name: "YouTube Premium Family",
    platform: "YouTube",
    totalSeats: 6,
    ownerSeats: 1,
    renewOn: "2026-07-31",
    note: "价格来自 appstoreprice 的尼日利亚 CNY 数据。",
    seats: [
      { slot: "1", name: "我", status: "owner", paidThrough: "2026-07-31", note: "自用" },
      { slot: "2", status: "available" },
      { slot: "3", status: "available" },
      { slot: "4", status: "available" },
      { slot: "5", status: "available" },
      { slot: "6", status: "available" },
    ],
  },
  {
    id: "spotify-family",
    sourceKey: "spotify-family",
    name: "Spotify 家庭会员",
    platform: "Spotify",
    totalSeats: 6,
    ownerSeats: 1,
    renewOn: "2026-07-31",
    note: "价格来自 appstoreprice 的尼日利亚 CNY 数据。",
    seats: [
      { slot: "1", name: "我", status: "owner", paidThrough: "2026-07-31", note: "自用" },
      { slot: "2", status: "available" },
      { slot: "3", status: "available" },
      { slot: "4", status: "available" },
      { slot: "5", status: "available" },
      { slot: "6", status: "available" },
    ],
  },
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        const history = await loadHistory(env);
        const subscriptionPrices = await loadSubscriptionPrices();
        return html(renderDashboard(history, env, subscriptionPrices));
      }

      if (url.pathname === "/api/history") {
        const history = await loadHistory(env);
        const records = compactDuplicateHistory(pruneHistory(history, retentionDays(env)));
        return json({
          ok: true,
          retentionDays: retentionDays(env),
          latest: latestRecord(records),
          records,
        });
      }

      if (url.pathname === "/api/rideshare") {
        const history = await loadHistory(env);
        const records = compactDuplicateHistory(pruneHistory(history, retentionDays(env)));
        const latest = latestRecord(records);
        const subscriptionPrices = await loadSubscriptionPrices();
        const plans = buildRideSharePlans(parseRideSharePlans(env), latest?.fx, subscriptionPrices);
        return json({
          ok: true,
          latestFx: latest?.fx || null,
          subscriptionPrices,
          summary: summarizeRideSharePlans(plans),
          plans,
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
  const fx = await fetchGoogleFxSnapshot(denoms);
  const prices = enrichPricesWithGoogleReference(extractPrices(html, denoms), fx);
  const record = {
    capturedAt: new Date().toISOString(),
    sourceUrl: env.SEAGM_URL,
    fx,
    prices,
  };

  if (!options.dryRun) {
    const history = await loadHistory(env);
    history.push(record);
    await saveHistory(env, compactDuplicateHistory(pruneHistory(history, retentionDays(env))));
  }

  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    record,
  };
}

async function fetchGoogleFxSnapshot(denoms) {
  try {
    const response = await fetchWithTimeout(GOOGLE_FINANCE_TRY_CNY_URL, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 seagm-price-monitor/2.0",
      },
    }, 8000);

    if (!response.ok) {
      throw new Error(`Google Finance request failed: ${response.status} ${response.statusText}`);
    }

    const pageHtml = await response.text();
    const rateCnyPerTry = extractGoogleTryCnyRate(pageHtml);
    if (!Number.isFinite(rateCnyPerTry) || rateCnyPerTry <= 0) {
      throw new Error("Could not parse Google Finance TRY/CNY rate");
    }

    return {
      ok: true,
      source: "Google Finance",
      sourceUrl: GOOGLE_FINANCE_TRY_CNY_URL,
      pair: "TRY/CNY",
      rateCnyPerTry,
      prices: denoms.map((denomTl) => ({
        denomTl,
        priceCny: round2(denomTl * rateCnyPerTry),
      })),
    };
  } catch (error) {
    return {
      ok: false,
      source: "Google Finance",
      sourceUrl: GOOGLE_FINANCE_TRY_CNY_URL,
      pair: "TRY/CNY",
      error: error?.message || String(error),
      prices: [],
    };
  }
}

async function loadSubscriptionPrices() {
  const entries = await Promise.all(Object.entries(APPSTOREPRICE_SUBSCRIPTION_SOURCES).map(async ([key, source]) => {
    const snapshot = await fetchAppStorePriceSubscription(source);
    return [key, snapshot];
  }));
  return Object.fromEntries(entries);
}

async function fetchAppStorePriceSubscription(source) {
  try {
    const response = await fetchWithTimeout(source.url, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 seagm-price-monitor/2.0",
      },
    }, 12000);

    if (!response.ok) {
      throw new Error(`appstoreprice request failed: ${response.status} ${response.statusText}`);
    }

    const pageHtml = await response.text();
    const parsed = extractAppStorePriceNigeriaSubscription(pageHtml, source.subscriptionIds);
    if (!parsed) {
      throw new Error("Could not find Nigeria price row for subscription");
    }

    return {
      ok: true,
      source: "appstoreprice",
      sourceUrl: source.url,
      subscriptionId: parsed.subscriptionId,
      name: parsed.name || source.fallbackName,
      region: parsed.region,
      currency: parsed.currency,
      originalPriceText: `${parsed.currency}${formatNumberString(parsed.priceLocal)}`,
      priceLocal: parsed.priceLocal,
      priceUsd: parsed.priceUsd,
      priceCny: round2(parsed.priceCny),
      status: "最低",
    };
  } catch (error) {
    return {
      ok: false,
      source: "appstoreprice",
      sourceUrl: source.url,
      name: source.fallbackName,
      error: error?.message || String(error),
    };
  }
}

function extractAppStorePriceNigeriaSubscription(pageHtml, subscriptionIds) {
  for (const subscriptionId of subscriptionIds) {
    const startIndex = pageHtml.indexOf(subscriptionId);
    if (startIndex < 0) {
      continue;
    }

    const slice = pageHtml.slice(startIndex, startIndex + 12000);
    const nameMatch = slice.match(/nameZh\\":\\"([^\\"]+)\\"/);
    const nigeriaMatch = slice.match(/\{\\"region\\":\\"NG\\",\\"regionName\\":\\"([^\\"]+)\\",\\"currency\\":\\"([^\\"]+)\\",\\"price\\":([0-9.]+),\\"priceUsd\\":([0-9.]+),\\"priceCny\\":([0-9.]+)\}/);
    if (!nameMatch || !nigeriaMatch) {
      continue;
    }

    return {
      subscriptionId,
      name: decodeEscapedText(nameMatch[1]),
      region: decodeEscapedText(nigeriaMatch[1]),
      currency: nigeriaMatch[2],
      priceLocal: Number(nigeriaMatch[3]),
      priceUsd: Number(nigeriaMatch[4]),
      priceCny: Number(nigeriaMatch[5]),
    };
  }

  return null;
}

function formatNumberString(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function decodeEscapedText(value) {
  return JSON.parse(`"${value}"`);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractGoogleTryCnyRate(pageHtml) {
  const serializedPair = extractGoogleSerializedTryCnyRate(pageHtml);
  if (Number.isFinite(serializedPair)) {
    return serializedPair;
  }

  const dataLastPrice = pageHtml.match(/data-last-price="([0-9.]+)"/);
  if (dataLastPrice) {
    return Number(dataLastPrice[1]);
  }

  const financePrice = pageHtml.match(/<div[^>]+class="[^"]*\bYMlKec\b[^"]*"[^>]*>\s*([0-9.,]+)\s*<\/div>/);
  if (financePrice) {
    return Number(financePrice[1].replace(/,/g, ""));
  }

  const textPrice = pageHtml.match(/1\s+Turkish\s+Lira\s*=\s*([0-9.]+)\s+Chinese\s+Yuan/i);
  if (textPrice) {
    return Number(textPrice[1]);
  }

  return NaN;
}

function extractGoogleSerializedTryCnyRate(pageHtml) {
  const numberPattern = "([0-9]+(?:\\.[0-9]+)?(?:E[+-]?\\d+)?)";
  const pairAfterRate = new RegExp(
    `,\\s*${numberPattern}\\s*,\\s*"TRY\\s*/\\s*CNY"\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\[\\s*"TRY"\\s*,\\s*"CNY"`,
    "i",
  );
  const pairBeforeRate = new RegExp(
    `"TRY\\s*/\\s*CNY"\\s*,\\s*\\d+\\s*,\\s*null\\s*,\\s*\\[\\s*${numberPattern}`,
    "i",
  );

  const match = pageHtml.match(pairAfterRate) || pageHtml.match(pairBeforeRate);
  return match ? Number(match[1]) : NaN;
}

function enrichPricesWithGoogleReference(prices, fx) {
  if (!fx?.ok) {
    return prices.map((price) => ({
      ...price,
      googlePriceCny: null,
      googlePremiumCny: null,
      googlePremiumPercent: null,
    }));
  }

  return prices.map((price) => {
    const googlePriceCny = round2(price.denomTl * fx.rateCnyPerTry);
    const googlePremiumCny = round2(price.priceCny - googlePriceCny);
    const googlePremiumPercent = googlePriceCny > 0
      ? round2((price.priceCny / googlePriceCny - 1) * 100)
      : null;

    return {
      ...price,
      googlePriceCny,
      googlePremiumCny,
      googlePremiumPercent,
    };
  });
}

async function fetchSeagmHtml(url) {
  const cookieJar = new Map();
  await configureSeagmSession(url, cookieJar);

  const response = await fetchWithCookies(url, cookieJar, {
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

async function configureSeagmSession(productUrl, cookieJar) {
  const url = new URL(productUrl);
  const originPath = `${url.pathname}${url.search}`;
  const languageUrl = `${url.origin}/zh-cn/language_currency?origin=${encodeURIComponent(originPath)}`;

  const languageResponse = await fetchWithCookies(languageUrl, cookieJar, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 seagm-price-monitor/2.0",
    },
  });

  if (!languageResponse.ok) {
    throw new Error(`SEAGM session init failed: ${languageResponse.status} ${languageResponse.statusText}`);
  }

  const languageHtml = await languageResponse.text();
  const tokenMatch = languageHtml.match(/\/zh-cn\/setting\?csrfToken=([a-z0-9]+)/i);
  if (!tokenMatch) {
    throw new Error("Could not find SEAGM csrfToken for currency setting");
  }

  const settingUrl = `${url.origin}/zh-cn/setting?csrfToken=${tokenMatch[1]}`;
  const settingResponse = await fetchWithCookies(settingUrl, cookieJar, {
    method: "POST",
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      "origin": url.origin,
      "referer": languageUrl,
      "user-agent": "Mozilla/5.0 seagm-price-monitor/2.0",
    },
    body: new URLSearchParams({
      region: "cn",
      language: "zh",
      currency: "CNY",
    }),
  });

  if (!settingResponse.ok) {
    throw new Error(`SEAGM currency setting failed: ${settingResponse.status} ${settingResponse.statusText}`);
  }

  await settingResponse.arrayBuffer();
}

async function fetchWithCookies(url, cookieJar, init = {}) {
  const headers = new Headers(init.headers || {});
  const cookieHeader = serializeCookies(cookieJar);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const response = await fetch(url, { ...init, headers });
  storeSetCookies(response.headers, cookieJar);
  return response;
}

function storeSetCookies(headers, cookieJar) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : splitSetCookieHeader(headers.get("set-cookie"));

  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) {
      cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

function splitSetCookieHeader(value) {
  if (!value) {
    return [];
  }
  return value.split(/,(?=\s*[^;,]+=)/).map((item) => item.trim()).filter(Boolean);
}

function serializeCookies(cookieJar) {
  return [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
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

function compactDuplicateHistory(history) {
  const sorted = [...history].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  return sorted.filter((record, index) => {
    const capturedAt = Date.parse(record.capturedAt);
    if (!Number.isFinite(capturedAt)) {
      return true;
    }

    const fingerprint = snapshotFingerprint(record);
    return !sorted.slice(index + 1).some((candidate) => {
      const candidateCapturedAt = Date.parse(candidate.capturedAt);
      return Number.isFinite(candidateCapturedAt)
        && candidateCapturedAt - capturedAt <= DUPLICATE_WINDOW_MS
        && snapshotFingerprint(candidate) === fingerprint;
    });
  });
}

function snapshotFingerprint(record) {
  return stableStringify({
    sourceUrl: record.sourceUrl || "",
    fx: record.fx || null,
    prices: Array.isArray(record.prices) ? record.prices : [],
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }

  return JSON.stringify(value);
}

function renderDashboard(history, env, subscriptionPrices = {}) {
  const denoms = parseDenoms(env.DENOMS);
  const records = compactDuplicateHistory(pruneHistory(history, retentionDays(env)));
  const latest = latestRecord(records);
  const rideSharePlans = buildRideSharePlans(parseRideSharePlans(env), latest?.fx, subscriptionPrices);
  const rideShareOverview = renderRideShareOverview(rideSharePlans);
  const rideShareSection = renderRideShareSection(rideSharePlans);
  const trendTabs = renderTrendTabs(records, denoms);
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
    .ride-cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 16px;
      border-top: 1px solid var(--line);
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-height: 128px;
    }
    .ride-card {
      background: #fbfcf9;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .ride-card h3 {
      margin: 0;
      font-size: 18px;
    }
    .ride-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
      margin-top: 14px;
    }
    .ride-metric {
      min-width: 0;
    }
    .ride-metric .label,
    .ride-card .label {
      display: block;
    }
    .ride-metric .value {
      margin-top: 4px;
      font-size: 18px;
      font-weight: 760;
      line-height: 1.2;
    }
    .ride-note {
      margin-top: 12px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .legend {
      padding: 0 16px 14px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
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
      padding: 0 16px 16px;
      overflow-x: auto;
    }
    svg {
      display: block;
      width: 100%;
      min-width: 720px;
      height: auto;
    }
    .chart-point {
      cursor: crosshair;
      outline: none;
    }
    .chart-hit {
      fill: transparent;
      stroke: transparent;
      stroke-width: 16;
      pointer-events: all;
    }
    .chart-point .tooltip {
      display: none;
      pointer-events: none;
    }
    .chart-point:hover .tooltip,
    .chart-point:focus .tooltip {
      display: block;
    }
    .trend-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 14px 16px 10px;
    }
    .trend-tabs button {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--muted);
      background: #fbfcf9;
      font: inherit;
      font-size: 13px;
      font-weight: 750;
      cursor: pointer;
    }
    .trend-tabs button.active {
      border-color: currentColor;
      background: var(--panel);
    }
    .trend-panels {
      border-top: 1px solid var(--line);
    }
    .trend-panel {
      display: none;
    }
    .trend-panel.active {
      display: block;
    }
    .trend-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      padding: 12px 16px 0;
      font-size: 13px;
      color: var(--muted);
    }
    .trend-summary strong {
      color: var(--ink);
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
      vertical-align: top;
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
      .cards,
      .ride-cards,
      .ride-grid { grid-template-columns: 1fr; }
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
        <a class="button" href="/api/rideshare">拼车 JSON</a>
        <a class="button" href="/run?dry=1">试抓</a>
        <a class="button primary" href="/run">抓取并保存</a>
      </div>
    </header>

    <section class="cards">${latestCards}</section>

    <section class="cards">${rideShareOverview}</section>

    <section class="panel">
      <div class="panel-head">
        <h2>拼车</h2>
        <p class="meta">用于对账、成本核算和车位状态跟踪</p>
      </div>
      ${rideShareSection}
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>价格趋势</h2>
      </div>
      ${trendTabs}
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>历史记录</h2>
        <p class="meta">${records.length} 次抓取</p>
      </div>
      <div class="table-wrap">${table}</div>
    </section>
  </main>
  <script>
    document.querySelectorAll("[data-trend-tabs]").forEach((tabs) => {
      const buttons = [...tabs.querySelectorAll("[data-trend-tab]")];
      const panelRoot = tabs.nextElementSibling;
      const panels = panelRoot ? [...panelRoot.querySelectorAll("[data-trend-panel]")] : [];
      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          buttons.forEach((item) => {
            const active = item === button;
            item.classList.toggle("active", active);
            item.setAttribute("aria-selected", String(active));
          });
          panels.forEach((panel) => panel.classList.toggle("active", panel.id === button.getAttribute("aria-controls")));
        });
      });
    });
  </script>
</body>
</html>`;
}

function renderLatestCards(latest, denoms) {
  return denoms.map((denom) => {
    const price = latest?.prices?.find((item) => item.denomTl === denom);
    if (!price) {
      return `<article class="card"><div class="label">${denom} TL</div><div class="price">--</div><div class="sub">等待首次抓取</div></article>`;
    }

    const googleLine = Number.isFinite(price.googlePriceCny)
      ? `Google ¥${formatMoney(price.googlePriceCny)} · 差额 ${formatSignedMoney(price.googlePremiumCny)} · ${formatSignedPercent(price.googlePremiumPercent)}`
      : `Google 汇率暂无${latest?.fx?.error ? ` · ${escapeHtml(latest.fx.error)}` : ""}`;

    return `<article class="card">
      <div class="label">${denom} TL</div>
      <div class="price">¥${formatMoney(price.priceCny)}</div>
      <div class="sub">原价 ¥${formatMoney(price.originalPriceCny)} · 折扣 ${formatMoney(price.discountPercent)}%<br>${googleLine}<br>SEAGM Credits ${price.credits}</div>
    </article>`;
  }).join("");
}

function parseRideSharePlans(env) {
  const source = String(env.RIDESHARE_PLANS_JSON || "").trim();
  if (!source) {
    return DEFAULT_RIDESHARE_PLANS;
  }

  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : DEFAULT_RIDESHARE_PLANS;
  } catch {
    return DEFAULT_RIDESHARE_PLANS;
  }
}

function buildRideSharePlans(plans, fx, subscriptionPrices = {}) {
  return plans.map((plan, index) => buildRideSharePlan(plan, fx, index, subscriptionPrices[plan.sourceKey] || null));
}

function buildRideSharePlan(plan, fx, index, subscriptionSnapshot) {
  const totalSeats = Math.max(1, Number(plan.totalSeats) || 6);
  const ownerSeats = Math.min(totalSeats, Math.max(1, Number(plan.ownerSeats) || 1));
  const sellableSeats = Math.max(0, totalSeats - ownerSeats);
  const priceCny = toFiniteNumber(subscriptionSnapshot?.priceCny);
  const seats = normalizeRideShareSeats(plan.seats, totalSeats, ownerSeats, priceCny, sellableSeats);
  const occupiedExternalSeats = seats.filter((seat) => seat.status === "occupied" || seat.status === "pending").length;
  const availableSeats = seats.filter((seat) => seat.status === "available").length;
  const paidRevenueCny = round2(seats.reduce((sum, seat) => sum + (seat.status === "owner" ? 0 : (toFiniteNumber(seat.paidAmountCny) || 0)), 0));
  const ownerSeatCostCny = priceCny != null ? round2(priceCny / totalSeats) : null;
  const breakEvenPerExternalSeatCny = priceCny != null && sellableSeats > 0 ? round2(priceCny / sellableSeats) : null;
  const suggestedPerExternalSeatCny = breakEvenPerExternalSeatCny != null ? roundUpCnyPrice(breakEvenPerExternalSeatCny) : null;
  const expectedRevenueCny = suggestedPerExternalSeatCny != null ? round2(occupiedExternalSeats * suggestedPerExternalSeatCny) : null;
  const outstandingCny = expectedRevenueCny != null ? round2(Math.max(0, expectedRevenueCny - paidRevenueCny)) : null;
  const monthlyCostTry = priceCny != null && Number.isFinite(fx?.rateCnyPerTry) && fx.rateCnyPerTry > 0
    ? round2(priceCny / fx.rateCnyPerTry)
    : null;

  return {
    id: plan.id || `plan-${index + 1}`,
    sourceKey: plan.sourceKey || "",
    name: plan.name || subscriptionSnapshot?.name || `拼车计划 ${index + 1}`,
    platform: plan.platform || "",
    region: subscriptionSnapshot?.region || plan.region || "尼日利亚",
    currency: subscriptionSnapshot?.currency || plan.currency || "NGN",
    billingCycle: plan.billingCycle || "monthly",
    sourceUrl: subscriptionSnapshot?.sourceUrl || "",
    sourceStatus: subscriptionSnapshot?.status || "",
    originalPriceText: subscriptionSnapshot?.originalPriceText || "",
    priceCny,
    priceTry: monthlyCostTry,
    totalSeats,
    ownerSeats,
    sellableSeats,
    occupiedExternalSeats,
    availableSeats,
    renewOn: plan.renewOn || "",
    daysUntilRenew: daysUntil(plan.renewOn),
    note: plan.note || subscriptionSnapshot?.error || "",
    ownerSeatCostCny,
    breakEvenPerExternalSeatCny,
    suggestedPerExternalSeatCny,
    expectedRevenueCny,
    paidRevenueCny,
    outstandingCny,
    seats,
    subscriptionSnapshot,
  };
}

function normalizeRideShareSeats(inputSeats, totalSeats, ownerSeats, priceCny, sellableSeats) {
  const suggestedCharge = priceCny != null && sellableSeats > 0 ? roundUpCnyPrice(priceCny / sellableSeats) : null;
  const seats = Array.isArray(inputSeats) ? inputSeats : [];
  const normalized = [];

  for (let index = 0; index < totalSeats; index += 1) {
    const seat = seats[index] || {};
    const status = normalizeSeatStatus(seat.status, index, ownerSeats);
    normalized.push({
      slot: seat.slot || String(index + 1),
      name: seat.name || (status === "owner" ? "我" : ""),
      status,
      paidThrough: seat.paidThrough || "",
      chargeCny: toFiniteNumber(seat.chargeCny) ?? (status === "owner" ? null : suggestedCharge),
      paidAmountCny: toFiniteNumber(seat.paidAmountCny) ?? null,
      note: seat.note || "",
    });
  }

  return normalized;
}

function normalizeSeatStatus(status, index, ownerSeats) {
  if (status === "owner" || status === "occupied" || status === "available" || status === "pending") {
    return status;
  }
  return index < ownerSeats ? "owner" : "available";
}

function summarizeRideSharePlans(plans) {
  const pricedPlans = plans.filter((plan) => plan.priceCny != null);
  const upcomingDates = plans.map((plan) => plan.renewOn).filter(Boolean).sort();
  return {
    totalMonthlyCostCny: round2(pricedPlans.reduce((sum, plan) => sum + plan.priceCny, 0)),
    totalMonthlyCostTry: summarizeOptional(plans.map((plan) => plan.priceTry)),
    totalSellableSeats: plans.reduce((sum, plan) => sum + plan.sellableSeats, 0),
    totalOccupiedSeats: plans.reduce((sum, plan) => sum + plan.occupiedExternalSeats, 0),
    totalAvailableSeats: plans.reduce((sum, plan) => sum + plan.availableSeats, 0),
    totalOutstandingCny: summarizeOptional(plans.map((plan) => plan.outstandingCny)),
    nextRenewOn: upcomingDates[0] || "",
  };
}

function summarizeOptional(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) {
    return null;
  }
  return round2(numbers.reduce((sum, value) => sum + value, 0));
}

function renderRideShareOverview(plans) {
  const summary = summarizeRideSharePlans(plans);
  const cards = [
    {
      label: "拼车月成本",
      price: summary.totalMonthlyCostCny > 0 ? formatCny(summary.totalMonthlyCostCny) : "价格读取失败",
      sub: summary.totalMonthlyCostTry != null
        ? `约 ₺${formatMoney(summary.totalMonthlyCostTry)}`
        : "按 appstoreprice 尼日利亚价格汇总",
    },
    {
      label: "可外拼车位",
      price: `${summary.totalOccupiedSeats}/${summary.totalSellableSeats}`,
      sub: `已占用 ${summary.totalOccupiedSeats} · 空位 ${summary.totalAvailableSeats}`,
    },
    {
      label: "待收金额",
      price: summary.totalOutstandingCny != null ? formatCny(summary.totalOutstandingCny) : "价格读取失败",
      sub: summary.nextRenewOn
        ? `最近到期 ${escapeHtml(formatDate(summary.nextRenewOn))}`
        : "补充 renewOn 后可显示最近到期日",
    },
  ];

  return cards.map((item) => `
    <article class="card">
      <div class="label">${escapeHtml(item.label)}</div>
      <div class="price">${escapeHtml(item.price)}</div>
      <div class="sub">${escapeHtml(item.sub)}</div>
    </article>
  `).join("");
}

function renderRideShareSection(plans) {
  if (plans.length === 0) {
    return `<div class="empty">暂无拼车配置。</div>`;
  }

  const cards = plans.map((plan) => renderRideSharePlanCard(plan)).join("");
  const tables = plans.map((plan) => renderRideShareSeatTable(plan)).join("");
  return `<div class="ride-cards">${cards}</div>
    <div class="legend">说明：价格取自 appstoreprice 尼日利亚区 CNY。自用成本 = 总价 ÷ 总座位；回本价 = 总价 ÷ 可外拼座位；建议收费 = 回本价向上取整到 0.5 元。状态：owner 自用，occupied 已上车，pending 待付款/待确认，available 空位。</div>
    ${tables}`;
}

function renderRideSharePlanCard(plan) {
  const renewLine = plan.renewOn
    ? `${formatDate(plan.renewOn)}${plan.daysUntilRenew != null ? ` · ${plan.daysUntilRenew >= 0 ? `还有 ${plan.daysUntilRenew} 天` : `已过期 ${Math.abs(plan.daysUntilRenew)} 天`}` : ""}`
    : "未填写";
  const priceLine = plan.priceCny != null
    ? `${plan.originalPriceText || ""}${plan.originalPriceText ? " · " : ""}${formatCny(plan.priceCny)} / 月`
    : "价格读取失败";

  return `<article class="ride-card">
    <div class="label">${escapeHtml([plan.platform, plan.region].filter(Boolean).join(" · "))}</div>
    <h3>${escapeHtml(plan.name)}</h3>
    <div class="ride-grid">
      <div class="ride-metric">
        <span class="label">官方标价</span>
        <div class="value">${escapeHtml(priceLine)}</div>
      </div>
      <div class="ride-metric">
        <span class="label">续费/到期</span>
        <div class="value">${escapeHtml(renewLine)}</div>
      </div>
      <div class="ride-metric">
        <span class="label">我的单座成本</span>
        <div class="value">${formatMaybeCny(plan.ownerSeatCostCny)}</div>
      </div>
      <div class="ride-metric">
        <span class="label">外拼回本价</span>
        <div class="value">${formatMaybeCny(plan.breakEvenPerExternalSeatCny)}</div>
      </div>
      <div class="ride-metric">
        <span class="label">建议收费</span>
        <div class="value">${formatMaybeCny(plan.suggestedPerExternalSeatCny)}</div>
      </div>
      <div class="ride-metric">
        <span class="label">车位情况</span>
        <div class="value">${plan.occupiedExternalSeats}/${plan.sellableSeats} 已上车 · ${plan.availableSeats} 空位</div>
      </div>
      <div class="ride-metric">
        <span class="label">已收 / 待收</span>
        <div class="value">${formatMaybeCny(plan.paidRevenueCny)} / ${formatMaybeCny(plan.outstandingCny)}</div>
      </div>
      <div class="ride-metric">
        <span class="label">价格来源</span>
        <div class="value">${plan.subscriptionSnapshot?.ok ? `<a href="${escapeHtml(plan.sourceUrl)}" target="_blank" rel="noreferrer">appstoreprice</a>` : "读取失败"}</div>
      </div>
    </div>
    ${plan.note ? `<div class="ride-note">${escapeHtml(plan.note)}</div>` : ""}
  </article>`;
}

function renderRideShareSeatTable(plan) {
  const rows = plan.seats.map((seat) => `<tr>
    <td>${escapeHtml(seat.slot)}</td>
    <td>${escapeHtml(seat.name || "--")}</td>
    <td>${escapeHtml(formatSeatStatus(seat.status))}</td>
    <td>${seat.status === "owner" ? "自用" : formatMaybeCny(seat.chargeCny)}</td>
    <td>${seat.status === "owner" ? "--" : formatMaybeCny(seat.paidAmountCny)}</td>
    <td>${escapeHtml(seat.paidThrough ? formatDate(seat.paidThrough) : "--")}</td>
    <td>${escapeHtml(seat.note || "--")}</td>
  </tr>`).join("");

  return `<div class="panel-head">
      <h2>${escapeHtml(plan.name)} 车位明细</h2>
      <p class="meta">${plan.sellableSeats} 个外拼位</p>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>车位</th><th>成员</th><th>状态</th><th>收费标准</th><th>已收金额</th><th>有效期</th><th>备注</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function formatSeatStatus(status) {
  return {
    owner: "自用",
    occupied: "已上车",
    pending: "待确认",
    available: "空位",
  }[status] || status;
}

function formatMaybeCny(value) {
  return Number.isFinite(value) ? formatCny(value) : "价格读取失败";
}

function formatCny(value) {
  return `¥${formatMoney(value)}`;
}

function roundUpCnyPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.ceil(number * 2) / 2;
}

function daysUntil(value) {
  if (!value) {
    return null;
  }
  const target = Date.parse(value);
  if (!Number.isFinite(target)) {
    return null;
  }
  return Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000));
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function renderTrendTabs(records, denoms) {
  if (records.length === 0) {
    return `<div class="empty">暂无数据，点击“抓取并保存”生成第一条记录。</div>`;
  }

  const colors = ["#1e7c63", "#2f68b8", "#c9513e", "#a86912"];
  const tabs = denoms.map((denom, index) => {
    const active = index === 0 ? " active" : "";
    const selected = index === 0 ? "true" : "false";
    const color = colors[index % colors.length];
    return `<button class="${active}" type="button" role="tab" aria-selected="${selected}" aria-controls="trend-panel-${index}" data-trend-tab style="color:${color}">${denom} TL</button>`;
  }).join("");
  const panels = denoms.map((denom, index) => {
    const color = colors[index % colors.length];
    const active = index === 0 ? " active" : "";
    return `<div id="trend-panel-${index}" class="trend-panel${active}" role="tabpanel" data-trend-panel>
      ${renderTrendSummary(records, denom)}
      <div class="chart-wrap">${renderChart(records, denom, color)}</div>
    </div>`;
  }).join("");

  return `<div class="trend-tabs" role="tablist" aria-label="价格趋势面额" data-trend-tabs>${tabs}</div>
    <div class="trend-panels">${panels}</div>`;
}

function renderTrendSummary(records, denom) {
  const values = records
    .map((record) => record.prices.find((item) => item.denomTl === denom)?.priceCny)
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return `<div class="trend-summary"><span>暂无 ${denom} TL 数据</span></div>`;
  }

  const latest = values[values.length - 1];
  const first = values[0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const change = round2(latest - first);

  return `<div class="trend-summary">
    <span>最新 <strong>¥${formatMoney(latest)}</strong></span>
    <span>区间 <strong>¥${formatMoney(min)} - ¥${formatMoney(max)}</strong></span>
    <span>较首条 <strong>${formatSignedMoney(change)}</strong></span>
  </div>`;
}

function renderChart(records, denom, color) {
  if (records.length === 0) {
    return `<div class="empty">暂无数据，点击“抓取并保存”生成第一条记录。</div>`;
  }

  const width = 960;
  const height = 300;
  const pad = { top: 30, right: 36, bottom: 38, left: 74 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const xStep = records.length > 1
    ? plotWidth / (records.length - 1)
    : 0;
  const x = (index) => records.length > 1
    ? pad.left + index * xStep
    : pad.left + plotWidth / 2;
  const values = records
    .map((record) => record.prices.find((item) => item.denomTl === denom)?.priceCny)
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return `<div class="empty">暂无 ${denom} TL 数据。</div>`;
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.25, 0.05);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const y = (value) => pad.top + (max - value) / Math.max(0.01, max - min) * plotHeight;
  const grid = [max, (min + max) / 2, min].map((label) => {
    const gy = y(label);
    return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="#d9dfd7" />
      <text x="12" y="${gy + 4}" fill="#66706b" font-size="12">¥${formatMoney(label)}</text>`;
  }).join("");
  const plottedPoints = records
    .map((record, index) => {
      const price = record.prices.find((item) => item.denomTl === denom);
      if (!price) {
        return null;
      }
      return {
        cx: x(index),
        cy: y(price.priceCny),
        price: price.priceCny,
        capturedAt: record.capturedAt,
      };
    })
    .filter(Boolean);
  const points = plottedPoints.map((point) => `${point.cx},${point.cy}`).join(" ");
  const dots = plottedPoints.map((point, index) => {
    const previous = plottedPoints[index - 1];
    const hitLine = previous
      ? `<line class="chart-hit" x1="${previous.cx}" y1="${previous.cy}" x2="${point.cx}" y2="${point.cy}" />`
      : "";
    return `<g class="chart-point" tabindex="0" aria-label="${denom} TL ¥${formatMoney(point.price)} ${formatChartTime(point.capturedAt)}">
      ${hitLine}
      <circle class="chart-hit" cx="${point.cx}" cy="${point.cy}" r="12" />
      <circle cx="${point.cx}" cy="${point.cy}" r="4" fill="#ffffff" stroke="${color}" stroke-width="2.3" />
      ${renderChartTooltip(point.cx, point.cy, point.price, point.capturedAt, color, width, pad)}
    </g>`;
  }).join("");
  const extremaLabels = plottedPoints.map((point) => {
    const isHighest = point.price === rawMax;
    const isLowest = point.price === rawMin;
    if (!isHighest && !isLowest) {
      return "";
    }
    return renderChartExtremumLabel(point, { isHighest, isLowest }, color, width, height, pad);
  }).join("");

  const marks = records.map((record, index) => {
    if (index !== 0 && index !== records.length - 1 && records.length > 8 && index % Math.ceil(records.length / 6) !== 0) {
      return "";
    }
    return `<text x="${x(index)}" y="${height - 12}" fill="#66706b" font-size="12" text-anchor="middle">${formatChartTime(record.capturedAt)}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="SEAGM 价格趋势图">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
    <text x="${pad.left}" y="18" fill="${color}" font-size="13" font-weight="700">${denom} TL</text>
    ${grid}
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
    ${dots}
    ${extremaLabels}
    ${marks}
  </svg>`;
}

function renderChartExtremumLabel(point, state, color, width, height, pad) {
  const label = state.isHighest && state.isLowest
    ? "最高/最低"
    : state.isHighest
      ? "最高"
      : "最低";
  const text = `${label} ¥${formatMoney(point.price)}`;
  const labelWidth = Math.max(state.isHighest && state.isLowest ? 98 : 78, text.length * 9);
  const labelHeight = 24;
  const gap = 10;
  const x = Math.min(
    Math.max(point.cx - labelWidth / 2, pad.left),
    width - pad.right - labelWidth,
  );
  const preferAbove = state.isHighest;
  const canPlaceBelow = point.cy + gap + labelHeight <= height - pad.bottom - 4;
  const y = preferAbove || !canPlaceBelow
    ? Math.max(pad.top, point.cy - labelHeight - gap)
    : point.cy + gap;
  const placedAbove = y < point.cy;

  return `<g aria-label="${text}" pointer-events="none">
    <line x1="${point.cx}" y1="${point.cy}" x2="${point.cx}" y2="${placedAbove ? y + labelHeight : y}" stroke="${color}" stroke-width="1.2" stroke-dasharray="3 3" />
    <rect x="${x}" y="${y}" width="${labelWidth}" height="${labelHeight}" rx="6" fill="#ffffff" stroke="${color}" stroke-width="1.4" />
    <text x="${x + labelWidth / 2}" y="${y + 16}" fill="${color}" font-size="12" font-weight="750" text-anchor="middle">${text}</text>
  </g>`;
}

function renderChartTooltip(cx, cy, price, capturedAt, color, width, pad) {
  const tooltipWidth = 118;
  const tooltipHeight = 42;
  const gap = 10;
  const x = cx > width - pad.right - tooltipWidth - gap
    ? cx - tooltipWidth - gap
    : cx + gap;
  const y = cy < pad.top + tooltipHeight + gap
    ? cy + gap
    : cy - tooltipHeight - gap;

  return `<g class="tooltip">
    <rect x="${x}" y="${y}" width="${tooltipWidth}" height="${tooltipHeight}" rx="6" fill="#ffffff" stroke="${color}" stroke-width="1.4" />
    <text x="${x + 10}" y="${y + 17}" fill="#1c2321" font-size="13" font-weight="700">¥${formatMoney(price)}</text>
    <text x="${x + 10}" y="${y + 34}" fill="#66706b" font-size="12">${formatChartTime(capturedAt)}</text>
  </g>`;
}

function renderHistoryTable(records, denoms) {
  if (records.length === 0) {
    return `<div class="empty">暂无历史记录。</div>`;
  }

  const header = denoms.map((denom) =>
    `<th>${denom} TL SEAGM</th><th>${denom} TL Google</th><th>差额</th>`
  ).join("");
  const rows = [...records].reverse().map((record) => {
    const cells = denoms.map((denom) => {
      const price = record.prices.find((item) => item.denomTl === denom);
      if (!price) {
        return "<td>--</td><td>--</td><td>--</td>";
      }

      return `<td>¥${formatMoney(price.priceCny)}</td><td>${Number.isFinite(price.googlePriceCny) ? `¥${formatMoney(price.googlePriceCny)}` : "--"}</td><td>${Number.isFinite(price.googlePremiumCny) ? formatSignedMoney(price.googlePremiumCny) : "--"}</td>`;
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

function formatSignedMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return `${number >= 0 ? "+" : "-"}¥${formatMoney(Math.abs(number))}`;
}

function formatSignedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return `${number >= 0 ? "+" : ""}${formatMoney(number)}%`;
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

function formatChartTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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
