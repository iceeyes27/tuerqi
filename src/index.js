const HISTORY_KEY = "seagm:history:v1";
const NIGERIA_HISTORY_KEY = "appstore:ng-claude:v1";
const DEFAULT_APPSTORE_URL = "https://appstoreprice.org/zh/apps/6473753684";
const NIGERIA_PLAN_LABEL = "Claude Pro · 月度订阅";
const DEFAULT_RETENTION_DAYS = 60;
const DEFAULT_MAX_HISTORY_RECORDS = 500;
const DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
const READ_CACHE_TTL_SECONDS = 60;
const NO_STORE = "no-store";
const READ_CACHE_CONTROL = `public, max-age=${READ_CACHE_TTL_SECONDS}`;
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=()",
};
const GOOGLE_FINANCE_TRY_CNY_URLS = [
  "https://www.google.com/finance/quote/TRY-CNY",
  "https://www.google.com/finance/beta/quote/TRY-CNY",
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledMonitor(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        return cachedResponse(request, ctx, async () => {
          const history = await loadNigeriaHistory(env);
          return html(renderNigeriaDashboard(history, env), 200, READ_CACHE_CONTROL);
        });
      }

      if (url.pathname === "/turkey") {
        return cachedResponse(request, ctx, async () => {
          const history = await loadHistory(env);
          return html(renderDashboard(history, env), 200, READ_CACHE_CONTROL);
        });
      }

      if (url.pathname === "/api/nigeria") {
        return cachedResponse(request, ctx, async () => {
          const records = normalizeNigeriaHistory(await loadNigeriaHistory(env), env);
          return json({
            ok: true,
            retentionDays: retentionDays(env),
            latest: latestRecord(records),
            records,
          }, 200, READ_CACHE_CONTROL);
        });
      }

      if (url.pathname === "/api/history") {
        return cachedResponse(request, ctx, async () => {
          const history = await loadHistory(env);
          const records = normalizeHistory(history, env);
          return json({
            ok: true,
            retentionDays: retentionDays(env),
            maxHistoryRecords: maxHistoryRecords(env),
            latest: latestRecord(records),
            records,
          }, 200, READ_CACHE_CONTROL);
        });
      }

      if (url.pathname === "/run") {
        const dryRun = url.searchParams.get("dry") === "1";
        if (!dryRun && !isAuthorizedRun(request, env)) {
          return json({ ok: false, error: "Forbidden" }, 403);
        }

        const result = await runAllMonitors(env, { dryRun, source: "manual" });
        if (!dryRun) {
          await purgeReadCache(request);
        }
        return json(result);
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      console.error("Worker request failed", {
        path: url.pathname,
        error: error.message,
      });
      return json({ ok: false, error: error.message }, 500);
    }
  },
};

async function runScheduledMonitor(env) {
  const result = await runAllMonitors(env, { source: "scheduled" });
  if (!result.ok) {
    console.error("Scheduled price monitor had failures", { errors: result.errors });
    throw new Error(result.errors.map((item) => `${item.site}: ${item.error}`).join("; "));
  }
}

async function runAllMonitors(env, options = {}) {
  const [turkey, nigeria] = await Promise.allSettled([
    runMonitor(env, options),
    runNigeriaMonitor(env, options),
  ]);

  const errors = [];
  if (turkey.status === "rejected") {
    errors.push({ site: "turkey", error: String(turkey.reason?.message || turkey.reason) });
  }
  if (nigeria.status === "rejected") {
    errors.push({ site: "nigeria", error: String(nigeria.reason?.message || nigeria.reason) });
  }

  return {
    ok: errors.length === 0,
    dryRun: Boolean(options.dryRun),
    turkey: turkey.status === "fulfilled" ? turkey.value : null,
    nigeria: nigeria.status === "fulfilled" ? nigeria.value : null,
    errors,
  };
}

async function runNigeriaMonitor(env, options = {}) {
  assertKv(env);

  const sourceUrl = env.APPSTORE_URL || DEFAULT_APPSTORE_URL;
  const pageHtml = await fetchAppStoreHtml(sourceUrl);
  const parsed = extractNigeriaClaudePrice(pageHtml);
  if (!parsed) {
    throw new Error("Could not parse Nigeria Claude price from App Store Price page");
  }

  const record = {
    capturedAt: new Date().toISOString(),
    sourceUrl,
    plan: NIGERIA_PLAN_LABEL,
    currency: "NGN",
    priceNgn: parsed.priceNgn,
    priceCny: parsed.priceCny,
    priceUsd: parsed.priceUsd,
    fx: extractNigeriaFx(pageHtml),
  };

  if (!options.dryRun) {
    const history = await loadNigeriaHistory(env);
    await saveNigeriaHistory(env, normalizeNigeriaHistory(upsertDailyRecord(history, record), env));
  }

  console.log("Nigeria price monitor completed", {
    source: options.source || "unknown",
    dryRun: Boolean(options.dryRun),
    capturedAt: record.capturedAt,
    priceCny: record.priceCny,
  });

  return { ok: true, dryRun: Boolean(options.dryRun), record };
}

async function fetchAppStoreHtml(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 appstore-price-monitor/1.0",
    },
  }, 12000);

  if (!response.ok) {
    throw new Error(`App Store Price request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function extractNigeriaClaudePrice(pageHtml) {
  // The page embeds Next.js RSC-escaped JSON, e.g.
  //   \"region\":\"NG\",\"regionName\":\"尼日利亚\",\"currency\":\"NGN\",\"price\":14900,\"priceUsd\":10.96,\"priceCny\":74.38
  // Fall back to plain (unescaped) JSON in case the embedding format changes.
  const escaped = /\\"region\\":\\"NG\\",\\"regionName\\":\\"[^"\\]*\\",\\"currency\\":\\"NGN\\",\\"price\\":([0-9.]+),\\"priceUsd\\":([0-9.]+),\\"priceCny\\":([0-9.]+)/g;
  const plain = /"region":"NG","regionName":"[^"]*","currency":"NGN","price":([0-9.]+),"priceUsd":([0-9.]+),"priceCny":([0-9.]+)/g;

  const entries = [];
  for (const re of [escaped, plain]) {
    let match;
    while ((match = re.exec(pageHtml))) {
      const priceNgn = Number(match[1]);
      const priceUsd = Number(match[2]);
      const priceCny = Number(match[3]);
      if (Number.isFinite(priceCny) && priceCny > 0) {
        entries.push({ priceNgn, priceUsd, priceCny });
      }
    }
    if (entries.length) {
      break;
    }
  }

  if (!entries.length) {
    return null;
  }

  // Claude Pro monthly sits on the 14,900 NGN tier; fall back to the cheapest plan.
  const pro = entries.find((entry) => entry.priceNgn === 14900);
  return pro || entries.reduce((lowest, entry) => (entry.priceCny < lowest.priceCny ? entry : lowest));
}

// Pulls the source's USD-based FX table + data date so the page can show the
// exchange-rate context behind each CNY price.
function extractNigeriaFx(pageHtml) {
  const matchNumber = (escaped, plain) => {
    const match = pageHtml.match(escaped) || pageHtml.match(plain);
    return match ? Number(match[1]) : NaN;
  };
  const matchString = (escaped, plain) => {
    const match = pageHtml.match(escaped) || pageHtml.match(plain);
    return match ? match[1] : null;
  };

  const usdToCny = matchNumber(/\\"CNY\\":([0-9][0-9.]*)/, /"CNY":([0-9][0-9.]*)/);
  const usdToNgn = matchNumber(/\\"NGN\\":([0-9][0-9.]*)/, /"NGN":([0-9][0-9.]*)/);
  if (!Number.isFinite(usdToCny) || usdToCny <= 0 || !Number.isFinite(usdToNgn) || usdToNgn <= 0) {
    return null;
  }

  return {
    date: matchString(/\\"date\\":\\"(\d{4}-\d{2}-\d{2})\\"/, /"date":"(\d{4}-\d{2}-\d{2})"/),
    updatedAt: matchString(/\\"time_last_update\\":\\"([^"\\]+)\\"/, /"time_last_update":"([^"]+)"/),
    usdToCny: round2dp(usdToCny, 6),
    usdToNgn: round2dp(usdToNgn, 6),
    ngnToCny: round2dp(usdToCny / usdToNgn, 8),
  };
}

async function loadNigeriaHistory(env) {
  assertKv(env);
  const history = await env.PRICE_HISTORY.get(NIGERIA_HISTORY_KEY, "json");
  return Array.isArray(history) ? history : [];
}

async function saveNigeriaHistory(env, history) {
  await env.PRICE_HISTORY.put(NIGERIA_HISTORY_KEY, JSON.stringify(history));
}

function normalizeNigeriaHistory(history, env) {
  return limitHistory(
    pruneHistory(history.filter((record) => Number.isFinite(Number(record?.priceCny))), retentionDays(env)),
    maxHistoryRecords(env),
  );
}

// Keep at most one record per calendar day (Asia/Shanghai); a later read on the
// same day overwrites the earlier one so the chart shows one point per day.
function upsertDailyRecord(history, record) {
  const day = shanghaiDayKey(record.capturedAt);
  const sameDay = (item) => shanghaiDayKey(item.capturedAt) === day;
  return [...history.filter((item) => !sameDay(item)), record]
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

function shanghaiDayKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function runMonitor(env, options = {}) {
  assertKv(env);

  const denoms = parseDenoms(env.DENOMS);
  const [pageHtml, fx] = await Promise.all([
    fetchSeagmHtml(env.SEAGM_URL),
    fetchGoogleFxSnapshot(denoms),
  ]);
  const prices = enrichPricesWithGoogleReference(extractPrices(pageHtml, denoms), fx);
  const record = {
    capturedAt: new Date().toISOString(),
    sourceUrl: env.SEAGM_URL,
    fx,
    prices,
  };

  if (!options.dryRun) {
    const history = await loadHistory(env);
    history.push(record);
    await saveHistory(env, normalizeHistory(history, env));
  }

  console.log("Price monitor completed", {
    source: options.source || "unknown",
    dryRun: Boolean(options.dryRun),
    capturedAt: record.capturedAt,
    priceCount: prices.length,
    fxOk: Boolean(fx?.ok),
  });

  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    record,
  };
}

async function fetchGoogleFxSnapshot(denoms) {
  for (const sourceUrl of GOOGLE_FINANCE_TRY_CNY_URLS) {
    try {
      const response = await fetchWithTimeout(sourceUrl, {
        headers: {
          "accept": "text/html,application/xhtml+xml",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "user-agent": "Mozilla/5.0 seagm-price-monitor/2.0",
        },
        redirect: "manual",
      }, 8000);

      if (response.status >= 300 && response.status < 400) {
        throw new Error(`Google Finance redirect blocked: ${response.status}`);
      }

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
        sourceUrl,
        pair: "TRY/CNY",
        rateCnyPerTry,
        prices: denoms.map((denomTl) => ({
          denomTl,
          priceCny: round2(denomTl * rateCnyPerTry),
        })),
      };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    source: "Google Finance",
    sourceUrl: GOOGLE_FINANCE_TRY_CNY_URLS[0],
    pair: "TRY/CNY",
    error: "Google Finance unavailable",
    prices: [],
  };
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

function normalizeHistory(history, env) {
  return limitHistory(compactDuplicateHistory(pruneHistory(history, retentionDays(env))), maxHistoryRecords(env));
}

function pruneHistory(history, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history
    .filter((record) => Date.parse(record.capturedAt) >= cutoff)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

function limitHistory(history, maxRecords) {
  if (!Number.isFinite(maxRecords) || maxRecords <= 0 || history.length <= maxRecords) {
    return history;
  }

  return history.slice(history.length - maxRecords);
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

const NAV_STYLE = `
    .nav {
      display: flex;
      gap: 8px;
      margin-bottom: 22px;
    }
    .nav a {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 16px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 700;
    }
    .nav a.active {
      background: var(--green);
      border-color: var(--green);
      color: #ffffff;
    }`;

function renderNav(active) {
  const items = [
    { href: "/", label: "尼日利亚 Claude", key: "nigeria" },
    { href: "/turkey", label: "土耳其礼品卡", key: "turkey" },
  ];
  return `<nav class="nav">${items.map((item) =>
    `<a href="${item.href}"${item.key === active ? ' class="active" aria-current="page"' : ""}>${item.label}</a>`
  ).join("")}</nav>`;
}

function renderNigeriaDashboard(history, env) {
  const records = normalizeNigeriaHistory(history, env);
  const latest = records[records.length - 1] || null;
  const updatedAt = latest ? formatDateTime(latest.capturedAt) : "暂无数据";
  const cards = renderNigeriaCards(records, env);
  const chart = renderNigeriaChart(records, "#2bb673");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>尼日利亚 Claude 价格走势</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f2;
      --ink: #1c2321;
      --muted: #66706b;
      --line: #e2e7e0;
      --panel: #ffffff;
      --green: #1e7c63;
      --green-soft: #e9f7ef;
      --green-line: #2bb673;
      --coral: #d34a3a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    main {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 40px;
    }${NAV_STYLE}
    .meta {
      margin: 14px 2px 0;
      color: var(--muted);
      font-size: 13px;
    }
    .chart-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(28, 35, 33, 0.04);
    }
    .chart-card-head {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 20px 24px;
      background: var(--green-soft);
    }
    .chart-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #d6efe0;
      color: var(--green-line);
      flex: none;
    }
    .chart-card-head h1 {
      margin: 0;
      font-size: clamp(20px, 2.6vw, 26px);
      font-weight: 780;
    }
    .chart-body {
      padding: 18px 18px 8px;
      overflow-x: auto;
    }
    svg.trend {
      display: block;
      width: 100%;
      min-width: 640px;
      height: auto;
    }
    .ng-point .tooltip { display: none; pointer-events: none; }
    .ng-point:hover .tooltip, .ng-point:focus .tooltip { display: block; }
    .ng-point { outline: none; }
    .ng-hit { fill: transparent; pointer-events: all; }
    .cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-top: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 18px 18px 16px;
    }
    .card .label { color: var(--muted); font-size: 14px; font-weight: 650; }
    .card .value {
      margin-top: 12px;
      font-size: 30px;
      line-height: 1;
      font-weight: 800;
    }
    .card .value .hl {
      background: #d6f3e1;
      border-radius: 7px;
      padding: 2px 8px;
    }
    .card .value.down { color: var(--coral); }
    .card .value.up { color: var(--green); }
    .card .sub { margin-top: 12px; color: var(--muted); font-size: 13px; }
    .empty { padding: 60px 16px; text-align: center; color: var(--muted); }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 22px;
    }
    .top .nav { margin-bottom: 0; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 16px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      color: var(--ink);
      text-decoration: none;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn.primary { background: var(--green); border-color: var(--green); color: #ffffff; }
    .btn:disabled { opacity: 0.6; cursor: default; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      margin-top: 16px;
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
    }
    .panel-head h2 { margin: 0; font-size: 16px; font-weight: 760; }
    .phead-meta { margin: 0; color: var(--muted); font-size: 13px; }
    .rates { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .rate-item { padding: 16px 18px; border-right: 1px solid var(--line); }
    .rate-item:last-child { border-right: 0; }
    .rate-item .label { color: var(--muted); font-size: 13px; font-weight: 650; }
    .rate-item .value { margin-top: 8px; font-size: 22px; font-weight: 780; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 11px 16px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th { color: var(--muted); font-size: 12px; background: #fbfcf9; font-weight: 700; }
    tbody tr:last-child td { border-bottom: 0; }
    .table-wrap { overflow-x: auto; }
    @media (max-width: 760px) {
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .rates { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .rate-item:nth-child(2) { border-right: 0; }
      main { width: min(100vw - 24px, 1120px); padding-top: 20px; }
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      ${renderNav("nigeria")}
      <div class="actions">
        <button class="btn primary" type="button" data-scrape>手动抓取</button>
        <a class="btn" href="/api/nigeria">JSON</a>
      </div>
    </div>
    <section class="chart-card">
      <div class="chart-card-head">
        <span class="chart-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 L9 12 L13 15 L20 6"/><path d="M3 21 H21"/></svg>
        </span>
        <h1>尼日利亚 · 人民币价格走势</h1>
      </div>
      <div class="chart-body">${chart}</div>
    </section>

    <section class="cards">${cards}</section>
    ${renderNigeriaRates(latest)}
    ${renderNigeriaHistory(records)}
    <p class="meta">Claude Pro 月度订阅 · 数据来源 <a href="${escapeHtml(env.APPSTORE_URL || DEFAULT_APPSTORE_URL)}" target="_blank" rel="noreferrer">App Store Price</a> · 每日更新 · 最后更新：${escapeHtml(updatedAt)}</p>
  </main>
  <script>
    const scrapeBtn = document.querySelector("[data-scrape]");
    scrapeBtn?.addEventListener("click", async () => {
      let token = localStorage.getItem("ng_run_token") || "";
      if (!token) {
        token = (window.prompt("请输入 RUN_TOKEN（用于授权写入数据）") || "").trim();
        if (!token) return;
        localStorage.setItem("ng_run_token", token);
      }
      const original = scrapeBtn.textContent;
      scrapeBtn.disabled = true;
      scrapeBtn.textContent = "抓取中…";
      try {
        const res = await fetch("/run?token=" + encodeURIComponent(token), { method: "GET" });
        if (res.status === 403) {
          localStorage.removeItem("ng_run_token");
          window.alert("RUN_TOKEN 无效，请重新输入");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data && data.nigeria && data.nigeria.ok) {
          window.location.reload();
          return;
        }
        const reason = (data && data.errors && JSON.stringify(data.errors)) || (data && data.error) || ("HTTP " + res.status);
        window.alert("抓取失败：" + reason);
      } catch (error) {
        window.alert("请求出错：" + error.message);
      } finally {
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = original;
      }
    });
  </script>
</body>
</html>`;
}

function renderNigeriaRates(latest) {
  if (!latest) {
    return `<section class="panel">
      <div class="panel-head"><h2>汇率情况</h2></div>
      <div class="empty">暂无数据，等待首次抓取。</div>
    </section>`;
  }

  const fx = latest.fx || null;
  const cnyToNgn = Number(latest.priceCny) > 0
    ? round2(Number(latest.priceNgn) / Number(latest.priceCny))
    : null;
  const rateItem = (label, value) =>
    `<div class="rate-item"><div class="label">${label}</div><div class="value">${value}</div></div>`;

  const items = [
    rateItem("Claude Pro 美元价", Number.isFinite(Number(latest.priceUsd)) ? `$${formatMoney(latest.priceUsd)}` : "--"),
    rateItem("1 美元 ≈ 人民币", fx?.usdToCny ? `¥${formatMoney(fx.usdToCny)}` : "--"),
    rateItem("1 美元 ≈ 奈拉", fx?.usdToNgn ? `₦${formatInteger(Math.round(fx.usdToNgn))}` : "--"),
    rateItem("1 人民币 ≈ 奈拉", cnyToNgn ? `₦${formatMoney(cnyToNgn)}` : "--"),
  ].join("");

  const dataDate = fx?.date ? `汇率日期 ${escapeHtml(fx.date)}` : "";

  return `<section class="panel">
    <div class="panel-head"><h2>汇率情况</h2><p class="phead-meta">${dataDate}</p></div>
    <div class="rates">${items}</div>
  </section>`;
}

function renderNigeriaHistory(records) {
  if (records.length === 0) {
    return `<section class="panel">
      <div class="panel-head"><h2>历史记录</h2></div>
      <div class="empty">暂无历史记录。</div>
    </section>`;
  }

  const rows = [...records].reverse().map((record) => {
    const cnyToNgn = Number(record.priceCny) > 0
      ? round2(Number(record.priceNgn) / Number(record.priceCny))
      : null;
    return `<tr>
      <td>${escapeHtml(formatDay(record.capturedAt))}</td>
      <td>¥${formatMoney(record.priceCny)}</td>
      <td>${Number.isFinite(Number(record.priceUsd)) ? `$${formatMoney(record.priceUsd)}` : "--"}</td>
      <td>${cnyToNgn ? `₦${formatMoney(cnyToNgn)}` : "--"}</td>
      <td><a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noreferrer">App Store</a></td>
    </tr>`;
  }).join("");

  return `<section class="panel">
    <div class="panel-head"><h2>历史记录</h2><p class="phead-meta">${records.length} 天</p></div>
    <div class="table-wrap"><table>
      <thead><tr><th>日期</th><th>人民币</th><th>美元</th><th>1 元 ≈ 奈拉</th><th>来源</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function renderNigeriaCards(records, env) {
  if (records.length === 0) {
    const placeholder = (label) => `<article class="card"><div class="label">${label}</div><div class="value">--</div><div class="sub">等待首次抓取</div></article>`;
    return ["当前", "最高", "最低", "涨跌"].map(placeholder).join("");
  }

  const latest = records[records.length - 1];
  const first = records[0];
  const highest = records.reduce((a, b) => (Number(b.priceCny) > Number(a.priceCny) ? b : a));
  const lowest = records.reduce((a, b) => (Number(b.priceCny) < Number(a.priceCny) ? b : a));
  const changePercent = Number(first.priceCny) > 0
    ? round2((Number(latest.priceCny) / Number(first.priceCny) - 1) * 100)
    : 0;
  const direction = changePercent > 0 ? "up" : changePercent < 0 ? "down" : "";
  const arrow = changePercent > 0 ? "↗" : changePercent < 0 ? "↘" : "→";

  return `<article class="card">
      <div class="label">当前</div>
      <div class="value"><span class="hl">¥${formatMoney(latest.priceCny)}</span></div>
      <div class="sub">${formatInteger(latest.priceNgn)} NGN</div>
    </article>
    <article class="card">
      <div class="label">最高</div>
      <div class="value">¥${formatMoney(highest.priceCny)}</div>
      <div class="sub">${escapeHtml(formatDay(highest.capturedAt))}</div>
    </article>
    <article class="card">
      <div class="label">最低</div>
      <div class="value">¥${formatMoney(lowest.priceCny)}</div>
      <div class="sub">${escapeHtml(formatDay(lowest.capturedAt))}</div>
    </article>
    <article class="card">
      <div class="label">涨跌</div>
      <div class="value ${direction}">${arrow} ${formatSignedPercent(changePercent)}</div>
      <div class="sub">较 ${escapeHtml(String(retentionDays(env)))} 天前</div>
    </article>`;
}

function renderNigeriaChart(records, color) {
  if (records.length === 0) {
    return `<div class="empty">暂无数据，等待首次抓取生成第一条记录。</div>`;
  }

  const width = 960;
  const height = 320;
  const pad = { top: 24, right: 24, bottom: 34, left: 64 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const baseline = pad.top + plotHeight;
  const count = records.length;
  const x = (index) => count > 1 ? pad.left + (index / (count - 1)) * plotWidth : pad.left + plotWidth / 2;

  const values = records.map((record) => Number(record.priceCny));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.2, 0.05);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const y = (value) => pad.top + (max - value) / Math.max(0.01, max - min) * plotHeight;

  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => max - (i / ticks) * (max - min)).map((label) => {
    const gy = y(label);
    return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="${color}" stroke-opacity="0.18" stroke-dasharray="4 6" />
      <text x="${pad.left - 12}" y="${gy + 4}" fill="#8a948e" font-size="12" text-anchor="end">¥${formatMoney(label)}</text>`;
  }).join("");

  const points = records.map((record, index) => ({
    cx: x(index),
    cy: y(Number(record.priceCny)),
    price: Number(record.priceCny),
    capturedAt: record.capturedAt,
  }));
  const line = points.map((point) => `${point.cx.toFixed(2)},${point.cy.toFixed(2)}`).join(" ");
  const area = `${points[0].cx.toFixed(2)},${baseline} ${line} ${points[points.length - 1].cx.toFixed(2)},${baseline}`;

  const labelEvery = Math.max(1, Math.ceil(count / 6));
  const axis = records.map((record, index) => {
    if (index !== 0 && index !== count - 1 && index % labelEvery !== 0) {
      return "";
    }
    return `<text x="${x(index)}" y="${height - 10}" fill="#8a948e" font-size="12" text-anchor="middle">${formatMonthDay(record.capturedAt)}</text>`;
  }).join("");

  // With only one or two days of data there is no visible line, so render solid
  // dots; for longer ranges keep the clean line and reveal a dot on hover only.
  const showDots = count <= 2;
  const dotRadius = showDots ? "4.5" : "3.4";
  const dotOpacity = showDots ? "1" : "0";
  const hover = points.map((point) => {
    const half = count > 1 ? plotWidth / (count - 1) / 2 : plotWidth / 2;
    return `<g class="ng-point" tabindex="0" aria-label="${formatDay(point.capturedAt)} ¥${formatMoney(point.price)}">
      <rect class="ng-hit" x="${(point.cx - half).toFixed(2)}" y="${pad.top}" width="${(half * 2).toFixed(2)}" height="${plotHeight}" />
      <circle cx="${point.cx.toFixed(2)}" cy="${point.cy.toFixed(2)}" r="${dotRadius}" fill="#ffffff" stroke="${color}" stroke-width="2.4" opacity="${dotOpacity}" />
      ${renderNigeriaTooltip(point, color, width, pad)}
    </g>`;
  }).join("");

  return `<svg class="trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="尼日利亚 Claude 人民币价格走势">
    <defs>
      <linearGradient id="ng-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.28" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02" />
      </linearGradient>
    </defs>
    ${grid}
    <polygon points="${area}" fill="url(#ng-fill)" stroke="none" />
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    ${axis}
    ${hover}
  </svg>`;
}

function renderNigeriaTooltip(point, color, width, pad) {
  const tooltipWidth = 124;
  const tooltipHeight = 44;
  const gap = 10;
  const x = point.cx > width - pad.right - tooltipWidth - gap
    ? point.cx - tooltipWidth - gap
    : point.cx + gap;
  const y = Math.max(pad.top, point.cy - tooltipHeight - gap);

  return `<g class="tooltip">
    <line x1="${point.cx.toFixed(2)}" y1="${pad.top}" x2="${point.cx.toFixed(2)}" y2="${(pad.top + (point.cy - pad.top)).toFixed(2)}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.5" />
    <circle cx="${point.cx.toFixed(2)}" cy="${point.cy.toFixed(2)}" r="4" fill="#ffffff" stroke="${color}" stroke-width="2.2" />
    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${tooltipWidth}" height="${tooltipHeight}" rx="8" fill="#ffffff" stroke="${color}" stroke-width="1.3" />
    <text x="${(x + 12).toFixed(2)}" y="${(y + 18).toFixed(2)}" fill="#1c2321" font-size="13" font-weight="750">¥${formatMoney(point.price)}</text>
    <text x="${(x + 12).toFixed(2)}" y="${(y + 35).toFixed(2)}" fill="#66706b" font-size="12">${formatDay(point.capturedAt)}</text>
  </g>`;
}

function renderDashboard(history, env) {
  const denoms = parseDenoms(env.DENOMS);
  const records = compactDuplicateHistory(pruneHistory(history, retentionDays(env)));
  const latest = latestRecord(records);
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
    }${NAV_STYLE}
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
    ${renderNav("turkey")}
    <header>
      <div>
        <h1>土区礼品卡价格</h1>
        <p class="meta">最近 ${escapeHtml(String(retentionDays(env)))} 天数据，最后更新：${escapeHtml(updatedAt)}</p>
      </div>
      <div class="actions">
        <a class="button" href="/api/history">JSON</a>
        <a class="button" href="/run?dry=1">试抓</a>
      </div>
    </header>

    <section class="cards">${latestCards}</section>

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
      : "Google 汇率暂无";

    return `<article class="card">
      <div class="label">${denom} TL</div>
      <div class="price">¥${formatMoney(price.priceCny)}</div>
      <div class="sub">原价 ¥${formatMoney(price.originalPriceCny)} · 折扣 ${formatMoney(price.discountPercent)}%<br>${googleLine}<br>SEAGM Credits ${price.credits}</div>
    </article>`;
  }).join("");
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

function maxHistoryRecords(env) {
  const value = Number(env.MAX_HISTORY_RECORDS || DEFAULT_MAX_HISTORY_RECORDS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_HISTORY_RECORDS;
}

function assertKv(env) {
  if (!env.PRICE_HISTORY) {
    throw new Error("Missing Cloudflare KV binding: PRICE_HISTORY");
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round2dp(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "--";
}

function formatDay(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatMonthDay(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
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

function isAuthorizedRun(request, env) {
  const token = env.RUN_TOKEN;
  if (!token) {
    return false;
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const auth = request.headers.get("authorization") || "";
  const bearerToken = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return queryToken === token || bearerToken === token;
}

function cacheKeyFor(url, pathname) {
  return new Request(new URL(pathname, url.origin).toString(), { method: "GET" });
}

async function cachedResponse(request, ctx, createResponse) {
  if (request.method !== "GET") {
    return createResponse();
  }

  const cache = caches.default;
  const cacheKey = cacheKeyFor(new URL(request.url), new URL(request.url).pathname);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await createResponse();
  if (response.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

async function purgeReadCache(request) {
  const url = new URL(request.url);
  await Promise.all([
    caches.default.delete(cacheKeyFor(url, "/")),
    caches.default.delete(cacheKeyFor(url, "/turkey")),
    caches.default.delete(cacheKeyFor(url, "/api/nigeria")),
    caches.default.delete(cacheKeyFor(url, "/api/history")),
  ]);
}

function withSecurityHeaders(headers) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
}

function json(body, status = 200, cacheControl = NO_STORE) {
  const headers = withSecurityHeaders(new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": cacheControl,
  }));
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}

function html(body, status = 200, cacheControl = NO_STORE) {
  const headers = withSecurityHeaders(new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
  }));
  return new Response(body, { status, headers });
}
