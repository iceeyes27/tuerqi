import {
  buildGoogleConversionSnapshot,
  extractGoogleFinanceRate,
  googleFinanceQuoteUrls,
} from "./google-finance.js";

const HISTORY_KEY = "seagm:history:v1";
const NIGERIA_HISTORY_KEY = "appstore:ng-claude:v1";
const RIDESHARE_PLANS_KEY = "rideshare:plans:v1";
const NIGERIA_APPSTORE_BASE = "https://appstoreprice.org/zh/apps/";

// Subscriptions tracked on the Nigeria page. `plan` must equal the App Store
// Price plan name (matched case-insensitively) and `duration` its billing period.
function nigeriaItems() {
  return [
    { key: "youtube-solo", label: "YouTube Premium 单人", short: "YT 单人", url: `${NIGERIA_APPSTORE_BASE}544007664`, plan: "YouTube Premium", duration: "monthly", color: "#e0513b" },
    { key: "youtube-family", label: "YouTube Premium 家庭", short: "YT 家庭", url: `${NIGERIA_APPSTORE_BASE}544007664`, plan: "YouTube Premium Family", duration: "monthly", color: "#c0392b" },
    { key: "spotify-solo", label: "Spotify 个人", short: "Spotify 个人", url: `${NIGERIA_APPSTORE_BASE}spotify`, plan: "Premium Individual", duration: "monthly", color: "#1db954" },
    { key: "spotify-family", label: "Spotify 家庭", short: "Spotify 家庭", url: `${NIGERIA_APPSTORE_BASE}spotify`, plan: "Premium Family", duration: "monthly", color: "#157a3a" },
  ];
}
const CURRENCY_CONVERSIONS = [
  {
    key: "bolivia-bob-cny",
    groupKey: "bolivia",
    label: "玻利维亚 139.9 BOB → CNY",
    short: "139.9 BOB → CNY",
    amount: 139.9,
    baseCurrency: "BOB",
    quoteCurrency: "CNY",
    color: "#2f68b8",
  },
  {
    key: "philippines-php-usd",
    groupKey: "philippines",
    label: "菲律宾 9010 PHP → USD",
    short: "9010 PHP → USD",
    amount: 9010,
    baseCurrency: "PHP",
    quoteCurrency: "USD",
    color: "#8a5cc2",
  },
  {
    key: "philippines-php-cny",
    groupKey: "philippines",
    label: "菲律宾 9010 PHP → CNY",
    short: "9010 PHP → CNY",
    amount: 9010,
    baseCurrency: "PHP",
    quoteCurrency: "CNY",
    color: "#a86912",
  },
];
const CURRENCY_CONVERSION_GROUPS = [
  { key: "bolivia", label: "玻利维亚 139.9 BOB", color: "#2f68b8" },
  { key: "philippines", label: "菲律宾 9010 PHP", color: "#8a5cc2" },
];
const DEFAULT_RIDESHARE_PLANS = [
  {
    id: "youtube-family",
    sourceKey: "youtube-family",
    name: "YouTube Premium Family",
    platform: "YouTube",
    totalSeats: 6,
    ownerSeats: 1,
    renewOn: "2026-07-31",
    note: "价格来自 App Store Price 的尼日利亚 CNY 数据。",
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
    note: "价格来自 App Store Price 的尼日利亚 CNY 数据。",
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
          const rideShareConfig = await loadRideShareConfig(env);
          return html(renderNigeriaDashboard(history, env, rideShareConfig), 200, READ_CACHE_CONTROL);
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
          const publicRecords = records.map(publicDashboardRecord);
          return json({
            ok: true,
            retentionDays: retentionDays(env),
            conversions: CURRENCY_CONVERSIONS.map(publicConversionDefinition),
            items: nigeriaItems().map(({ key, label, plan, url }) => ({ key, label, plan, url })),
            latest: latestRecord(publicRecords),
            records: publicRecords,
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

      if (url.pathname === "/api/rideshare") {
        if (request.method === "POST") {
          if (!isAuthorizedRun(request, env)) {
            return json({ ok: false, error: "Forbidden" }, 403);
          }

          const payload = await request.json().catch(() => null);
          if (!Array.isArray(payload?.plans)) {
            return json({ ok: false, error: "Invalid rideshare plans payload" }, 400);
          }

          const plansConfig = sanitizeRideSharePlans(payload.plans);
          await saveRideShareConfig(env, plansConfig);
          await purgeReadCache(request);

          const records = normalizeNigeriaHistory(await loadNigeriaHistory(env), env);
          const latest = latestRecord(records);
          const plans = buildRideSharePlans(plansConfig, latest);
          return json({
            ok: true,
            latestFx: latest?.fx || null,
            summary: summarizeRideSharePlans(plans),
            plansConfig,
            plans,
          });
        }

        return cachedResponse(request, ctx, async () => {
          const records = normalizeNigeriaHistory(await loadNigeriaHistory(env), env);
          const latest = latestRecord(records);
          const plansConfig = await loadRideShareConfig(env);
          const plans = buildRideSharePlans(plansConfig, latest);
          return json({
            ok: true,
            latestFx: latest?.fx || null,
            summary: summarizeRideSharePlans(plans),
            plansConfig,
            plans,
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

  const items = nigeriaItems();
  const [nigeria, googleConversions] = await Promise.all([
    collectNigeriaPrices(items),
    collectCurrencyConversions(),
  ]);

  if (Object.keys(nigeria.prices).length === 0 && Object.keys(googleConversions.values).length === 0) {
    console.error("Dashboard data sources unavailable", {
      appStoreFailures: nigeria.failures,
      googleFinanceFailures: googleConversions.failures,
    });
    throw new Error("Could not collect any dashboard prices or currency conversions");
  }

  const record = {
    capturedAt: new Date().toISOString(),
    fx: nigeria.fx,
    items: nigeria.prices,
    conversions: googleConversions.values,
  };

  if (!options.dryRun) {
    const history = await loadNigeriaHistory(env);
    await saveNigeriaHistory(env, normalizeNigeriaHistory(upsertDailyRecord(history, record), env));
  }

  console.log("Dashboard price monitor completed", {
    source: options.source || "unknown",
    dryRun: Boolean(options.dryRun),
    capturedAt: record.capturedAt,
    itemCount: Object.keys(nigeria.prices).length,
    conversionCount: Object.keys(googleConversions.values).length,
    missingItems: nigeria.missing,
    missingConversions: googleConversions.missing,
  });

  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    record,
    missing: nigeria.missing,
    missingConversions: googleConversions.missing,
  };
}

async function collectNigeriaPrices(items) {
  const urls = [...new Set(items.map((item) => item.url))];
  const pageResults = await Promise.allSettled(
    urls.map(async (url) => [url, await fetchAppStoreHtml(url)]),
  );
  const pages = new Map(pageResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value));
  const failures = pageResults
    .filter((result) => result.status === "rejected")
    .map((result) => String(result.reason?.message || result.reason));

  let fx = null;
  const prices = {};
  const missing = [];
  for (const item of items) {
    const pageHtml = pages.get(item.url);
    if (!pageHtml) {
      missing.push(item.key);
      continue;
    }
    if (!fx) {
      fx = extractNigeriaFx(pageHtml);
    }
    const parsed = extractNigeriaPlanPrice(pageHtml, item.plan, item.duration);
    if (parsed) {
      prices[item.key] = {
        priceNgn: parsed.priceNgn,
        priceUsd: parsed.priceUsd,
        priceCny: parsed.priceCny,
      };
    } else {
      missing.push(item.key);
    }
  }

  return { fx, prices, missing, failures };
}

async function collectCurrencyConversions() {
  const results = await Promise.allSettled(
    CURRENCY_CONVERSIONS.map(async (definition) => {
      const quote = await fetchGoogleFinancePair(definition.baseCurrency, definition.quoteCurrency);
      return [definition.key, buildGoogleConversionSnapshot(definition, quote.rate, quote.sourceUrl)];
    }),
  );
  const values = {};
  const missing = [];
  const failures = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const [key, value] = result.value;
      values[key] = value;
    } else {
      missing.push(CURRENCY_CONVERSIONS[index].key);
      failures.push(String(result.reason?.message || result.reason));
    }
  });

  return { values, missing, failures };
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

// Pulls the Nigeria (NG/NGN) price for a single subscription plan. The page
// embeds Next.js RSC-escaped JSON where each plan is one object keyed by
// `subscriptionId`, e.g.
//   \"subscriptionId\":\"...\",\"name\":\"YouTube Premium\",...,\"duration\":\"monthly\",...,
//   \"prices\":[{\"region\":\"NG\",...,\"currency\":\"NGN\",\"price\":2200,\"priceUsd\":1.62,\"priceCny\":10.97}, ...]
// Falls back to plain (unescaped) JSON in case the embedding format changes.
function extractNigeriaPlanPrice(pageHtml, planName, duration = "monthly") {
  const variants = [
    {
      split: '\\"subscriptionId\\":',
      name: /^\\"[^"\\]*\\",\\"name\\":\\"([^"\\]+)\\"/,
      duration: /\\"duration\\":\\"([^"\\]+)\\"/,
      ng: /\\"region\\":\\"NG\\",\\"regionName\\":\\"[^"\\]*\\",\\"currency\\":\\"NGN\\",\\"price\\":([0-9.]+),\\"priceUsd\\":([0-9.]+),\\"priceCny\\":([0-9.]+)/,
    },
    {
      split: '"subscriptionId":',
      name: /^"[^"]*","name":"([^"]+)"/,
      duration: /"duration":"([^"]+)"/,
      ng: /"region":"NG","regionName":"[^"]*","currency":"NGN","price":([0-9.]+),"priceUsd":([0-9.]+),"priceCny":([0-9.]+)/,
    },
  ];

  const target = planName.toLowerCase();
  for (const variant of variants) {
    const blocks = pageHtml.split(variant.split);
    if (blocks.length < 2) {
      continue;
    }

    for (const block of blocks.slice(1)) {
      const nameMatch = block.match(variant.name);
      if (!nameMatch || nameMatch[1].toLowerCase() !== target) {
        continue;
      }

      const durationMatch = block.match(variant.duration);
      if (duration && durationMatch && durationMatch[1] !== duration) {
        continue;
      }

      const ng = block.match(variant.ng);
      if (!ng) {
        continue;
      }

      const priceCny = Number(ng[3]);
      if (Number.isFinite(priceCny) && priceCny > 0) {
        return { priceNgn: Number(ng[1]), priceUsd: Number(ng[2]), priceCny };
      }
    }
  }

  return null;
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
  const records = history
    .map(migrateNigeriaRecord)
    .filter((record) => record && hasDashboardData(record));
  return limitHistory(pruneHistory(records, retentionDays(env)), maxHistoryRecords(env));
}

function hasDashboardData(record) {
  const hasNigeriaPrice = Object.values(record.items || {})
    .some((price) => Number.isFinite(Number(price?.priceCny)));
  const hasConversion = Object.values(record.conversions || {})
    .some((conversion) => Number.isFinite(Number(conversion?.convertedAmount)));
  return hasNigeriaPrice || hasConversion;
}

function publicDashboardRecord(record) {
  const items = Object.fromEntries(
    Object.entries(record.items || {}).filter(([key]) => key !== "claude-pro"),
  );
  return { ...record, items };
}

function publicConversionDefinition(definition) {
  return {
    key: definition.key,
    label: definition.label,
    amount: definition.amount,
    baseCurrency: definition.baseCurrency,
    quoteCurrency: definition.quoteCurrency,
    sourceUrl: googleFinanceQuoteUrls(definition.baseCurrency, definition.quoteCurrency)[0],
  };
}

// Upgrades the legacy single-Claude shape ({ priceNgn, priceCny, priceUsd })
// to the multi-item shape ({ items: { "claude-pro": {...} } }) so old KV data
// keeps rendering after the multi-subscription change.
function migrateNigeriaRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  if (record.items && typeof record.items === "object") {
    return record;
  }
  if (!Number.isFinite(Number(record.priceCny))) {
    return null;
  }
  return {
    capturedAt: record.capturedAt,
    fx: record.fx || null,
    items: {
      "claude-pro": {
        priceNgn: Number(record.priceNgn),
        priceUsd: Number(record.priceUsd),
        priceCny: Number(record.priceCny),
      },
    },
  };
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
  try {
    const quote = await fetchGoogleFinancePair("TRY", "CNY");
    return {
      ok: true,
      source: "Google Finance",
      sourceUrl: quote.sourceUrl,
      pair: "TRY/CNY",
      rateCnyPerTry: quote.rate,
      prices: denoms.map((denomTl) => ({
        denomTl,
        priceCny: round2(denomTl * quote.rate),
      })),
    };
  } catch {
    return {
      ok: false,
      source: "Google Finance",
      sourceUrl: googleFinanceQuoteUrls("TRY", "CNY")[0],
      pair: "TRY/CNY",
      error: "Google Finance unavailable",
      prices: [],
    };
  }
}

async function fetchGoogleFinancePair(baseCurrency, quoteCurrency) {
  const sourceUrls = googleFinanceQuoteUrls(baseCurrency, quoteCurrency);
  const failures = [];
  for (const sourceUrl of sourceUrls) {
    try {
      const response = await fetchWithTimeout(sourceUrl, {
        headers: {
          "accept": "text/html,application/xhtml+xml",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "user-agent": "Mozilla/5.0 price-monitor/3.0",
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
      const rate = extractGoogleFinanceRate(pageHtml, baseCurrency, quoteCurrency);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Could not parse Google Finance ${baseCurrency}/${quoteCurrency} rate`);
      }
      return { rate: round2dp(rate, 8), sourceUrl };
    } catch (error) {
      failures.push(`${sourceUrl}: ${String(error?.message || error)}`);
      continue;
    }
  }

  throw new Error(`Google Finance ${baseCurrency}/${quoteCurrency} unavailable (${failures.join("; ")})`);
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

const CHART_STYLE = `
    svg.trend { display: block; width: 100%; min-width: 640px; height: auto; }
    .ng-point { outline: none; }
    .ng-hit { fill: transparent; pointer-events: all; }
    .ng-point .tooltip { display: none; pointer-events: none; }
    .ng-point:hover .tooltip,
    .ng-point:focus .tooltip { display: block; }`;

// Tabbed trend chart styling + behaviour shared by the Nigeria and Turkey pages.
const TREND_TABS_STYLE = `
    .chart-wrap { padding: 16px 16px 8px; overflow-x: auto; }
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
    .trend-panels { border-top: 1px solid var(--line); }
    .trend-panel { display: none; }
    .trend-panel.active { display: block; }
    .trend-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      padding: 12px 16px 0;
      font-size: 13px;
      color: var(--muted);
    }
    .trend-summary strong { color: var(--ink); }`;

const TREND_TABS_SCRIPT = `
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
    });`;

function renderNav(active) {
  const items = [
    { href: "/", label: "跨区汇率与订阅", key: "nigeria" },
    { href: "/turkey", label: "土耳其礼品卡", key: "turkey" },
  ];
  return `<nav class="nav">${items.map((item) =>
    `<a href="${item.href}"${item.key === active ? ' class="active" aria-current="page"' : ""}>${item.label}</a>`
  ).join("")}</nav>`;
}

function renderNigeriaDashboard(history, env, rideShareConfig = null) {
  const records = normalizeNigeriaHistory(history, env);
  const items = nigeriaItems();
  const latest = records[records.length - 1] || null;
  const updatedAt = latest ? formatDateTime(latest.capturedAt) : "暂无数据";
  const cards = `${renderCurrencyConversionCards(records)}${renderNigeriaCards(records, items)}`;
  const trend = renderNigeriaTrendTabs(records, items);
  const rideSharePlansConfig = rideShareConfig || parseRideSharePlans(env);
  const rideSharePlans = buildRideSharePlans(rideSharePlansConfig, latest);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>跨区汇率与订阅价格走势</title>
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
${CHART_STYLE}${TREND_TABS_STYLE}
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
    .card .sub .up { color: var(--green); font-weight: 700; }
    .card .sub .down { color: var(--coral); font-weight: 700; }
    .card .value.dual { display: grid; gap: 8px; font-size: 24px; line-height: 1.15; }
    .conversion-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .conversion-chart-grid > section + section { border-left: 1px solid var(--line); }
    .conversion-chart-title { margin: 0; padding: 14px 16px 0; font-size: 13px; color: var(--muted); }
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
    .ride-cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 16px;
      border-top: 1px solid var(--line);
    }
    .ride-card {
      background: #fbfcf9;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 16px;
    }
    .ride-card h3 { margin: 0; font-size: 18px; }
    .ride-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
      margin-top: 14px;
    }
    .ride-metric { min-width: 0; }
    .ride-metric .label,
    .ride-card .label { display: block; color: var(--muted); font-size: 13px; font-weight: 700; }
    .ride-metric .value { margin-top: 4px; font-size: 18px; font-weight: 760; line-height: 1.2; }
    .ride-note, .legend { color: var(--muted); font-size: 13px; line-height: 1.5; }
    .ride-note { margin-top: 12px; }
    .legend { padding: 0 16px 14px; }
    .edit-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 16px 14px; }
    .edit-form { display: none; padding: 0 16px 16px; }
    .edit-form.active { display: block; }
    .edit-plan { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-top: 12px; }
    .edit-plan-head { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; padding: 12px; background: #fbfcf9; border-bottom: 1px solid var(--line); }
    .edit-field { display: grid; gap: 4px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .edit-field input,
    .edit-field select { min-height: 34px; min-width: 120px; border: 1px solid var(--line); border-radius: 8px; padding: 0 10px; font: inherit; background: #fff; color: var(--ink); }
    .edit-field input[type="number"] { width: 92px; min-width: 92px; }
    .edit-table { overflow-x: auto; }
    .edit-table input,
    .edit-table select { min-height: 32px; border: 1px solid var(--line); border-radius: 7px; padding: 0 8px; font: inherit; background: #fff; color: var(--ink); }
    .edit-table input[type="number"] { width: 84px; }
    .edit-status { padding: 0 16px 14px; color: var(--muted); font-size: 13px; }
    .edit-status.error { color: var(--coral); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 11px 16px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th { color: var(--muted); font-size: 12px; background: #fbfcf9; font-weight: 700; }
    tbody tr:last-child td { border-bottom: 0; }
    .table-wrap { overflow-x: auto; }
    @media (max-width: 760px) {
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ride-cards,
      .ride-grid,
      .conversion-chart-grid { grid-template-columns: 1fr; }
      .conversion-chart-grid > section + section { border-left: 0; border-top: 1px solid var(--line); }
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
        <h1>跨区汇率与订阅价格走势</h1>
      </div>
      ${trend}
    </section>

    <section class="cards">${cards}</section>
    <section class="cards">${renderRideShareOverview(rideSharePlans)}</section>
    <section class="panel">
      <div class="panel-head"><h2>拼车</h2><p class="phead-meta">用于对账、成本核算和车位状态跟踪</p></div>
      ${renderRideShareSection(rideSharePlans, rideSharePlansConfig)}
    </section>
    ${renderNigeriaRates(latest)}
    ${renderNigeriaHistory(records, items)}
    <p class="meta">汇率来源 <a href="https://www.google.com/finance" target="_blank" rel="noreferrer">Google Finance</a> · 订阅来源 <a href="https://appstoreprice.org/zh" target="_blank" rel="noreferrer">App Store Price</a> · 每日更新 · 最后更新：${escapeHtml(updatedAt)}</p>
  </main>
  <script>${TREND_TABS_SCRIPT}
    const rideShareInitialPlans = ${scriptJson(rideSharePlansConfig)};
    const rideShareForm = document.querySelector("[data-rideshare-form]");
    const rideShareStatus = document.querySelector("[data-rideshare-status]");
    const rideShareEditBtn = document.querySelector("[data-rideshare-edit]");
    const rideShareSaveBtn = document.querySelector("[data-rideshare-save]");
    const rideShareCancelBtn = document.querySelector("[data-rideshare-cancel]");
    const setRideShareStatus = (message, isError = false) => {
      if (!rideShareStatus) return;
      rideShareStatus.textContent = message || "";
      rideShareStatus.classList.toggle("error", Boolean(isError));
    };
    const resetRideShareForm = () => {
      rideShareInitialPlans.forEach((plan, planIndex) => {
        const root = document.querySelector('[data-plan-index="' + planIndex + '"]');
        root?.querySelectorAll("[data-plan-field]").forEach((input) => {
          input.value = (plan[input.dataset.planField] ?? "").toString();
        });
        plan.seats.forEach((seat, seatIndex) => {
          const row = root?.querySelector('[data-seat-index="' + seatIndex + '"]');
          row?.querySelectorAll("[data-seat-field]").forEach((input) => {
            const field = input.dataset.seatField;
            const value = field === "chargeCny" || field === "paidAmountCny"
              ? formatInputNumber(seat[field])
              : (seat[field] ?? "").toString();
            input.value = value;
          });
        });
      });
    };
    rideShareEditBtn?.addEventListener("click", () => {
      rideShareForm?.classList.add("active");
      rideShareEditBtn.disabled = true;
      setRideShareStatus("修改后点击保存。首次保存需要输入 RUN_TOKEN。");
    });
    rideShareCancelBtn?.addEventListener("click", () => {
      resetRideShareForm();
      rideShareForm?.classList.remove("active");
      if (rideShareEditBtn) rideShareEditBtn.disabled = false;
      setRideShareStatus("");
    });
    const readMoneyInput = (input) => {
      const value = input?.value?.trim();
      if (!value) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const collectRideSharePlans = () => rideShareInitialPlans.map((plan, planIndex) => {
      const root = document.querySelector('[data-plan-index="' + planIndex + '"]');
      const nextPlan = { ...plan };
      root?.querySelectorAll("[data-plan-field]").forEach((input) => {
        nextPlan[input.dataset.planField] = input.value.trim();
      });
      nextPlan.seats = plan.seats.map((seat, seatIndex) => {
        const row = root?.querySelector('[data-seat-index="' + seatIndex + '"]');
        const nextSeat = { ...seat };
        row?.querySelectorAll("[data-seat-field]").forEach((input) => {
          const field = input.dataset.seatField;
          nextSeat[field] = field === "chargeCny" || field === "paidAmountCny" ? readMoneyInput(input) : input.value.trim();
        });
        return nextSeat;
      });
      return nextPlan;
    });
    rideShareSaveBtn?.addEventListener("click", async () => {
      let token = localStorage.getItem("ng_run_token") || "";
      if (!token) {
        token = (window.prompt("请输入 RUN_TOKEN（用于保存拼车信息）") || "").trim();
        if (!token) return;
        localStorage.setItem("ng_run_token", token);
      }
      const original = rideShareSaveBtn.textContent;
      rideShareSaveBtn.disabled = true;
      rideShareSaveBtn.textContent = "保存中…";
      setRideShareStatus("保存中…");
      try {
        const res = await fetch("/api/rideshare?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plans: collectRideSharePlans() }),
        });
        if (res.status === 403) {
          localStorage.removeItem("ng_run_token");
          setRideShareStatus("RUN_TOKEN 无效，请重新保存并输入。", true);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setRideShareStatus("保存失败：" + (data.error || ("HTTP " + res.status)), true);
          return;
        }
        setRideShareStatus("保存成功，正在刷新…");
        window.location.reload();
      } catch (error) {
        setRideShareStatus("请求出错：" + error.message, true);
      } finally {
        rideShareSaveBtn.disabled = false;
        rideShareSaveBtn.textContent = original;
      }
    });
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
  const fx = latest?.fx || null;
  if (!fx) {
    return `<section class="panel">
      <div class="panel-head"><h2>汇率情况</h2></div>
      <div class="empty">暂无数据，等待首次抓取。</div>
    </section>`;
  }

  const cnyToNgn = Number(fx.ngnToCny) > 0 ? round2(1 / Number(fx.ngnToCny)) : null;
  const rateItem = (label, value) =>
    `<div class="rate-item"><div class="label">${label}</div><div class="value">${value}</div></div>`;

  const items = [
    rateItem("1 美元 ≈ 人民币", fx.usdToCny ? `¥${formatMoney(fx.usdToCny)}` : "--"),
    rateItem("1 美元 ≈ 奈拉", fx.usdToNgn ? `₦${formatInteger(Math.round(fx.usdToNgn))}` : "--"),
    rateItem("1 人民币 ≈ 奈拉", cnyToNgn ? `₦${formatMoney(cnyToNgn)}` : "--"),
    rateItem("汇率日期", fx.date ? escapeHtml(fx.date) : "--"),
  ].join("");

  return `<section class="panel">
    <div class="panel-head"><h2>汇率情况</h2></div>
    <div class="rates">${items}</div>
  </section>`;
}

function renderNigeriaHistory(records, items) {
  if (records.length === 0) {
    return `<section class="panel">
      <div class="panel-head"><h2>历史记录</h2></div>
      <div class="empty">暂无历史记录。</div>
    </section>`;
  }

  const conversionHeader = CURRENCY_CONVERSIONS
    .map((item) => `<th>${escapeHtml(item.short)}</th>`)
    .join("");
  const subscriptionHeader = items
    .map((item) => `<th>${escapeHtml(item.short || item.label)}</th>`)
    .join("");
  const rows = [...records].reverse().map((record) => {
    const conversionCells = CURRENCY_CONVERSIONS.map((definition) => {
      const conversion = record.conversions?.[definition.key];
      return `<td>${formatConversionValue(conversion, definition.quoteCurrency)}</td>`;
    }).join("");
    const subscriptionCells = items.map((item) => {
      const price = record.items?.[item.key];
      return `<td>${Number.isFinite(Number(price?.priceCny)) ? `¥${formatMoney(price.priceCny)}` : "--"}</td>`;
    }).join("");
    return `<tr><td>${escapeHtml(formatDateTime(record.capturedAt))}</td>${conversionCells}${subscriptionCells}</tr>`;
  }).join("");

  return `<section class="panel">
    <div class="panel-head"><h2>历史记录</h2><p class="phead-meta">${records.length} 天 · USD / CNY</p></div>
    <div class="table-wrap"><table>
      <thead><tr><th>时间</th>${conversionHeader}${subscriptionHeader}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function renderCurrencyConversionCards(records) {
  const bolivia = CURRENCY_CONVERSIONS.find((item) => item.key === "bolivia-bob-cny");
  const philippinesUsd = CURRENCY_CONVERSIONS.find((item) => item.key === "philippines-php-usd");
  const philippinesCny = CURRENCY_CONVERSIONS.find((item) => item.key === "philippines-php-cny");
  return `${renderSingleConversionCard(records, bolivia)}${renderPhilippinesConversionCard(records, philippinesUsd, philippinesCny)}`;
}

function renderSingleConversionCard(records, definition) {
  const latest = latestCurrencyConversion(records, definition.key);
  if (!latest) {
    return `<article class="card"><div class="label">${escapeHtml(definition.label)}</div><div class="value">--</div><div class="sub">等待首次抓取</div></article>`;
  }

  const sourceUrl = googleFinanceQuoteUrls(definition.baseCurrency, definition.quoteCurrency)[0];
  return `<article class="card">
    <div class="label">${escapeHtml(definition.label)}</div>
    <div class="value"><span class="hl">${formatCurrencyAmount(latest.convertedAmount, definition.quoteCurrency)}</span></div>
    <div class="sub">1 ${definition.baseCurrency} ≈ ${formatCurrencyAmount(latest.rate, definition.quoteCurrency, 6)} · <a href="${sourceUrl}" target="_blank" rel="noreferrer">Google Finance</a><br>${escapeHtml(formatDateTime(latest.capturedAt))}</div>
  </article>`;
}

function renderPhilippinesConversionCard(records, usdDefinition, cnyDefinition) {
  const latestUsd = latestCurrencyConversion(records, usdDefinition.key);
  const latestCny = latestCurrencyConversion(records, cnyDefinition.key);
  if (!latestUsd && !latestCny) {
    return `<article class="card"><div class="label">菲律宾 9010 PHP</div><div class="value">--</div><div class="sub">等待首次抓取</div></article>`;
  }

  const latestTime = [latestUsd, latestCny]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0].capturedAt;
  const usdSource = googleFinanceQuoteUrls("PHP", "USD")[0];
  const cnySource = googleFinanceQuoteUrls("PHP", "CNY")[0];
  return `<article class="card">
    <div class="label">菲律宾 9010 PHP</div>
    <div class="value dual">
      <span><span class="hl">${latestUsd ? formatCurrencyAmount(latestUsd.convertedAmount, "USD") : "USD --"}</span></span>
      <span><span class="hl">${latestCny ? formatCurrencyAmount(latestCny.convertedAmount, "CNY") : "CNY --"}</span></span>
    </div>
    <div class="sub"><a href="${usdSource}" target="_blank" rel="noreferrer">PHP/USD</a> · <a href="${cnySource}" target="_blank" rel="noreferrer">PHP/CNY</a> · Google Finance<br>${escapeHtml(formatDateTime(latestTime))}</div>
  </article>`;
}

function renderNigeriaCards(records, items) {
  return items.map((item) => {
    const series = nigeriaItemSeries(records, item.key);
    if (series.length === 0) {
      return `<article class="card"><div class="label">${escapeHtml(item.label)}</div><div class="value">--</div><div class="sub">等待首次抓取</div></article>`;
    }

    const latest = series[series.length - 1];
    const first = series[0];
    const changePercent = Number(first.priceCny) > 0
      ? round2((Number(latest.priceCny) / Number(first.priceCny) - 1) * 100)
      : 0;
    const direction = changePercent > 0 ? "up" : changePercent < 0 ? "down" : "";
    const arrow = changePercent > 0 ? "↗" : changePercent < 0 ? "↘" : "→";

    return `<article class="card">
      <div class="label">${escapeHtml(item.label)}</div>
      <div class="value"><span class="hl">¥${formatMoney(latest.priceCny)}</span></div>
      <div class="sub">${formatInteger(latest.priceNgn)} NGN · <span class="${direction}">${arrow} ${formatSignedPercent(changePercent)}</span></div>
    </article>`;
  }).join("");
}

async function loadRideShareConfig(env) {
  assertKv(env);
  const saved = await env.PRICE_HISTORY.get(RIDESHARE_PLANS_KEY, "json");
  if (Array.isArray(saved)) {
    return sanitizeRideSharePlans(saved);
  }
  return parseRideSharePlans(env);
}

async function saveRideShareConfig(env, plans) {
  assertKv(env);
  await env.PRICE_HISTORY.put(RIDESHARE_PLANS_KEY, JSON.stringify(sanitizeRideSharePlans(plans)));
}

function parseRideSharePlans(env) {
  const source = String(env.RIDESHARE_PLANS_JSON || "").trim();
  if (!source) {
    return sanitizeRideSharePlans(DEFAULT_RIDESHARE_PLANS);
  }

  try {
    const parsed = JSON.parse(source);
    return sanitizeRideSharePlans(Array.isArray(parsed) ? parsed : DEFAULT_RIDESHARE_PLANS);
  } catch {
    return sanitizeRideSharePlans(DEFAULT_RIDESHARE_PLANS);
  }
}

function sanitizeRideSharePlans(input) {
  const plans = Array.isArray(input) && input.length > 0 ? input : DEFAULT_RIDESHARE_PLANS;
  return plans.map((plan, index) => {
    const totalSeats = Math.max(1, Math.min(20, Math.round(Number(plan.totalSeats) || 6)));
    const ownerSeats = Math.min(totalSeats, Math.max(1, Math.round(Number(plan.ownerSeats) || 1)));
    return {
      id: safeText(plan.id || `plan-${index + 1}`, 80),
      sourceKey: safeText(plan.sourceKey || "", 80),
      name: safeText(plan.name || `拼车计划 ${index + 1}`, 120),
      platform: safeText(plan.platform || "", 80),
      region: safeText(plan.region || "尼日利亚", 80),
      currency: safeText(plan.currency || "NGN", 16),
      billingCycle: safeText(plan.billingCycle || "monthly", 32),
      sourceUrl: safeText(plan.sourceUrl || "", 300),
      totalSeats,
      ownerSeats,
      renewOn: safeDate(plan.renewOn),
      note: safeText(plan.note || "", 300),
      seats: sanitizeRideShareSeats(plan.seats, totalSeats, ownerSeats),
    };
  });
}

function sanitizeRideShareSeats(inputSeats, totalSeats, ownerSeats) {
  const seats = Array.isArray(inputSeats) ? inputSeats : [];
  return Array.from({ length: totalSeats }, (_, index) => {
    const seat = seats[index] || {};
    const status = normalizeSeatStatus(seat.status, index, ownerSeats);
    return {
      slot: safeText(seat.slot || String(index + 1), 16),
      name: safeText(seat.name || (status === "owner" ? "我" : ""), 80),
      status,
      onboardedAt: safeDate(seat.onboardedAt),
      paidThrough: safeDate(seat.paidThrough),
      chargeCny: toFiniteNumber(seat.chargeCny),
      paidAmountCny: toFiniteNumber(seat.paidAmountCny),
      note: safeText(seat.note || "", 160),
    };
  });
}

function safeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function safeDate(value) {
  const text = safeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function buildRideSharePlans(plans, latestNigeriaRecord) {
  return plans.map((plan, index) => buildRideSharePlan(plan, index, latestNigeriaRecord?.items?.[plan.sourceKey] || null));
}

function buildRideSharePlan(plan, index, price) {
  const totalSeats = Math.max(1, Number(plan.totalSeats) || 6);
  const ownerSeats = Math.min(totalSeats, Math.max(1, Number(plan.ownerSeats) || 1));
  const sellableSeats = Math.max(0, totalSeats - ownerSeats);
  const priceCny = toFiniteNumber(price?.priceCny);
  const seats = normalizeRideShareSeats(plan.seats, totalSeats, ownerSeats, priceCny, sellableSeats);
  const occupiedExternalSeats = seats.filter((seat) => seat.status === "occupied" || seat.status === "pending").length;
  const availableSeats = seats.filter((seat) => seat.status === "available").length;
  const paidRevenueCny = round2(seats.reduce((sum, seat) => sum + (seat.status === "owner" ? 0 : (toFiniteNumber(seat.paidAmountCny) || 0)), 0));
  const ownerSeatCostCny = priceCny != null ? round2(priceCny / totalSeats) : null;
  const breakEvenPerExternalSeatCny = priceCny != null && sellableSeats > 0 ? round2(priceCny / sellableSeats) : null;
  const suggestedPerExternalSeatCny = breakEvenPerExternalSeatCny != null ? roundUpCnyPrice(breakEvenPerExternalSeatCny) : null;
  const expectedRevenueCny = suggestedPerExternalSeatCny != null ? round2(occupiedExternalSeats * suggestedPerExternalSeatCny) : null;
  const outstandingCny = expectedRevenueCny != null ? round2(Math.max(0, expectedRevenueCny - paidRevenueCny)) : null;

  return {
    id: plan.id || `plan-${index + 1}`,
    sourceKey: plan.sourceKey || "",
    name: plan.name || `拼车计划 ${index + 1}`,
    platform: plan.platform || "",
    region: plan.region || "尼日利亚",
    currency: plan.currency || "NGN",
    billingCycle: plan.billingCycle || "monthly",
    sourceUrl: plan.sourceUrl || rideShareSourceUrl(plan.sourceKey),
    originalPriceText: price?.priceNgn ? `NGN ${formatInteger(price.priceNgn)}` : "",
    priceCny,
    totalSeats,
    ownerSeats,
    sellableSeats,
    occupiedExternalSeats,
    availableSeats,
    renewOn: plan.renewOn || "",
    daysUntilRenew: daysUntil(plan.renewOn),
    note: plan.note || "",
    ownerSeatCostCny,
    breakEvenPerExternalSeatCny,
    suggestedPerExternalSeatCny,
    expectedRevenueCny,
    paidRevenueCny,
    outstandingCny,
    seats,
  };
}

function rideShareSourceUrl(sourceKey) {
  if (sourceKey === "youtube-family") {
    return `${NIGERIA_APPSTORE_BASE}544007664`;
  }
  if (sourceKey === "spotify-family") {
    return `${NIGERIA_APPSTORE_BASE}spotify`;
  }
  return "";
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
      onboardedAt: seat.onboardedAt || "",
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
      value: summary.totalMonthlyCostCny > 0 ? formatCny(summary.totalMonthlyCostCny) : "价格读取失败",
      sub: "按 App Store Price 尼日利亚价格汇总",
    },
    {
      label: "可外拼车位",
      value: `${summary.totalOccupiedSeats}/${summary.totalSellableSeats}`,
      sub: `已占用 ${summary.totalOccupiedSeats} · 空位 ${summary.totalAvailableSeats}`,
    },
    {
      label: "待收金额",
      value: summary.totalOutstandingCny != null ? formatCny(summary.totalOutstandingCny) : "价格读取失败",
      sub: summary.nextRenewOn ? `最近到期 ${formatDay(summary.nextRenewOn)}` : "补充 renewOn 后可显示最近到期日",
    },
  ];

  return cards.map((item) => `<article class="card">
    <div class="label">${escapeHtml(item.label)}</div>
    <div class="value"><span class="hl">${escapeHtml(item.value)}</span></div>
    <div class="sub">${escapeHtml(item.sub)}</div>
  </article>`).join("");
}

function renderRideShareSection(plans, plansConfig = plans) {
  if (plans.length === 0) {
    return `<div class="empty">暂无拼车配置。</div>`;
  }

  const cards = plans.map((plan) => renderRideSharePlanCard(plan)).join("");
  return `<div class="ride-cards">${cards}</div>
    <div class="legend">说明：价格取自 App Store Price 尼日利亚区 CNY。自用成本 = 总价 ÷ 总座位；回本价 = 总价 ÷ 可外拼座位；建议收费 = 回本价向上取整到 0.5 元。状态：owner 自用，occupied 已上车，pending 待付款/待确认，available 空位。</div>
    <div class="edit-actions">
      <button class="btn" type="button" data-rideshare-edit>编辑拼车</button>
      <a class="btn" href="/api/rideshare">拼车 JSON</a>
    </div>
    ${renderRideShareEditForm(plansConfig)}
    <div class="edit-status" data-rideshare-status></div>`;
}

function renderRideShareEditForm(plansConfig) {
  const plans = sanitizeRideSharePlans(plansConfig);
  const planForms = plans.map((plan, planIndex) => {
    const rows = plan.seats.map((seat, seatIndex) => `<tr data-seat-index="${seatIndex}">
      <td>${escapeHtml(seat.slot)}</td>
      <td><input data-seat-field="name" value="${escapeAttr(seat.name)}" placeholder="成员" /></td>
      <td><select data-seat-field="status">
        ${renderSeatStatusOptions(seat.status)}
      </select></td>
      <td><input data-seat-field="onboardedAt" type="date" value="${escapeAttr(seat.onboardedAt)}" /></td>
      <td><input data-seat-field="paidThrough" type="date" value="${escapeAttr(seat.paidThrough)}" /></td>
      <td><input data-seat-field="chargeCny" type="number" step="0.01" min="0" value="${formatInputNumber(seat.chargeCny)}" /></td>
      <td><input data-seat-field="paidAmountCny" type="number" step="0.01" min="0" value="${formatInputNumber(seat.paidAmountCny)}" /></td>
      <td><input data-seat-field="note" value="${escapeAttr(seat.note)}" placeholder="备注" /></td>
    </tr>`).join("");

    return `<section class="edit-plan" data-plan-index="${planIndex}">
      <div class="edit-plan-head">
        <strong>${escapeHtml(plan.name)}</strong>
        <label class="edit-field">续费/到期
          <input data-plan-field="renewOn" type="date" value="${escapeAttr(plan.renewOn)}" />
        </label>
        <label class="edit-field">备注
          <input data-plan-field="note" value="${escapeAttr(plan.note)}" />
        </label>
      </div>
      <div class="edit-table"><table>
        <thead><tr><th>车位</th><th>成员</th><th>状态</th><th>上车时间</th><th>有效期到</th><th>收费</th><th>已收</th><th>备注</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }).join("");

  return `<div class="edit-form" data-rideshare-form>
    ${planForms}
    <div class="edit-actions">
      <button class="btn primary" type="button" data-rideshare-save>保存拼车</button>
      <button class="btn" type="button" data-rideshare-cancel>取消</button>
    </div>
  </div>`;
}

function renderSeatStatusOptions(current) {
  const options = [
    ["owner", "自用"],
    ["occupied", "已上车"],
    ["pending", "待确认"],
    ["available", "空位"],
  ];
  return options.map(([value, label]) =>
    `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`
  ).join("");
}

function formatInputNumber(value) {
  return Number.isFinite(value) ? String(value) : "";
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function renderRideSharePlanCard(plan) {
  const renewLine = plan.renewOn
    ? `${formatDay(plan.renewOn)}${plan.daysUntilRenew != null ? ` · ${plan.daysUntilRenew >= 0 ? `还有 ${plan.daysUntilRenew} 天` : `已过期 ${Math.abs(plan.daysUntilRenew)} 天`}` : ""}`
    : "未填写";
  const priceLine = plan.priceCny != null
    ? `${plan.originalPriceText || ""}${plan.originalPriceText ? " · " : ""}${formatCny(plan.priceCny)} / 月`
    : "价格读取失败";

  return `<article class="ride-card">
    <div class="label">${escapeHtml([plan.platform, plan.region].filter(Boolean).join(" · "))}</div>
    <h3>${escapeHtml(plan.name)}</h3>
    <div class="ride-grid">
      <div class="ride-metric"><span class="label">官方标价</span><div class="value">${escapeHtml(priceLine)}</div></div>
      <div class="ride-metric"><span class="label">续费/到期</span><div class="value">${escapeHtml(renewLine)}</div></div>
      <div class="ride-metric"><span class="label">我的单座成本</span><div class="value">${formatMaybeCny(plan.ownerSeatCostCny)}</div></div>
      <div class="ride-metric"><span class="label">外拼回本价</span><div class="value">${formatMaybeCny(plan.breakEvenPerExternalSeatCny)}</div></div>
      <div class="ride-metric"><span class="label">建议收费</span><div class="value">${formatMaybeCny(plan.suggestedPerExternalSeatCny)}</div></div>
      <div class="ride-metric"><span class="label">车位情况</span><div class="value">${plan.occupiedExternalSeats}/${plan.sellableSeats} 已上车 · ${plan.availableSeats} 空位</div></div>
      <div class="ride-metric"><span class="label">已收 / 待收</span><div class="value">${formatMaybeCny(plan.paidRevenueCny)} / ${formatMaybeCny(plan.outstandingCny)}</div></div>
      <div class="ride-metric"><span class="label">价格来源</span><div class="value">${plan.sourceUrl ? `<a href="${escapeHtml(plan.sourceUrl)}" target="_blank" rel="noreferrer">App Store Price</a>` : "--"}</div></div>
    </div>
    ${plan.note ? `<div class="ride-note">${escapeHtml(plan.note)}</div>` : ""}
  </article>`;
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

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function renderNigeriaTrendTabs(records, items) {
  if (records.length === 0) {
    return `<div class="empty">暂无数据，点击“手动抓取”生成第一条记录。</div>`;
  }

  const tabDefinitions = [
    ...CURRENCY_CONVERSION_GROUPS.map((group) => ({ type: "conversion", ...group })),
    ...items.map((item) => ({ type: "subscription", ...item })),
  ];
  const tabs = tabDefinitions.map((item, index) => {
    const active = index === 0 ? " active" : "";
    const selected = index === 0 ? "true" : "false";
    return `<button class="${active}" type="button" role="tab" aria-selected="${selected}" aria-controls="ng-trend-${index}" data-trend-tab style="color:${item.color}">${escapeHtml(item.label)}</button>`;
  }).join("");
  const panels = tabDefinitions.map((item, index) => {
    const active = index === 0 ? " active" : "";
    return `<div id="ng-trend-${index}" class="trend-panel${active}" role="tabpanel" data-trend-panel>
      ${item.type === "conversion"
        ? renderCurrencyConversionTrendPanel(records, item, index)
        : `${renderNigeriaTrendSummary(records, item)}<div class="chart-wrap">${renderNigeriaItemChart(records, item, index)}</div>`}
    </div>`;
  }).join("");

  return `<div class="trend-tabs" role="tablist" aria-label="汇率与订阅项目" data-trend-tabs>${tabs}</div>
    <div class="trend-panels">${panels}</div>`;
}

function renderCurrencyConversionTrendPanel(records, group, index) {
  const definitions = CURRENCY_CONVERSIONS.filter((item) => item.groupKey === group.key);
  if (definitions.length === 1) {
    const definition = definitions[0];
    return `${renderCurrencyTrendSummary(records, definition)}
      <div class="chart-wrap">${renderCurrencyConversionChart(records, definition, `trend-fx-${index}-0`)}</div>`;
  }

  const summaries = definitions.map((definition) => {
    const series = currencyConversionSeries(records, definition.key);
    const latest = series[series.length - 1];
    return `<span>${definition.quoteCurrency} 最新 <strong>${latest ? formatCurrencyAmount(latest.convertedAmount, definition.quoteCurrency) : "--"}</strong></span>`;
  }).join("");
  const charts = definitions.map((definition, chartIndex) => `<section>
    <h3 class="conversion-chart-title">${escapeHtml(definition.label)}</h3>
    <div class="chart-wrap">${renderCurrencyConversionChart(records, definition, `trend-fx-${index}-${chartIndex}`)}</div>
  </section>`).join("");

  return `<div class="trend-summary">${summaries}</div><div class="conversion-chart-grid">${charts}</div>`;
}

function renderCurrencyTrendSummary(records, definition) {
  const series = currencyConversionSeries(records, definition.key);
  if (series.length === 0) {
    return `<div class="trend-summary"><span>暂无 ${escapeHtml(definition.label)} 数据</span></div>`;
  }

  const values = series.map((item) => item.convertedAmount);
  const latest = values[values.length - 1];
  const first = values[0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  return `<div class="trend-summary">
    <span>最新 <strong>${formatCurrencyAmount(latest, definition.quoteCurrency)}</strong></span>
    <span>区间 <strong>${formatCurrencyAmount(min, definition.quoteCurrency)} - ${formatCurrencyAmount(max, definition.quoteCurrency)}</strong></span>
    <span>较首条 <strong>${formatSignedCurrency(round2(latest - first), definition.quoteCurrency)}</strong></span>
  </div>`;
}

function renderCurrencyConversionChart(records, definition, gradientId) {
  const points = currencyConversionSeries(records, definition.key)
    .map((item) => ({ price: item.convertedAmount, capturedAt: item.capturedAt }));
  return renderTrendChart(points, definition.color, gradientId, {
    ariaLabel: `${definition.label} 每日走势`,
    emptyText: `暂无 ${escapeHtml(definition.label)} 数据。`,
    tooltipDate: formatChartTime,
    formatValue: (value) => formatCurrencyAmount(value, definition.quoteCurrency),
  });
}

function renderNigeriaTrendSummary(records, item) {
  const series = nigeriaItemSeries(records, item.key);
  if (series.length === 0) {
    return `<div class="trend-summary"><span>暂无 ${escapeHtml(item.label)} 数据</span></div>`;
  }

  const values = series.map((price) => Number(price.priceCny));
  const latest = values[values.length - 1];
  const first = values[0];
  const min = Math.min(...values);
  const max = Math.max(...values);

  return `<div class="trend-summary">
    <span>最新 <strong>¥${formatMoney(latest)}</strong></span>
    <span>区间 <strong>¥${formatMoney(min)} - ¥${formatMoney(max)}</strong></span>
    <span>较首条 <strong>${formatSignedMoney(round2(latest - first))}</strong></span>
  </div>`;
}

function renderNigeriaItemChart(records, item, index) {
  const points = records
    .map((record) => {
      const price = record.items?.[item.key];
      return Number.isFinite(Number(price?.priceCny))
        ? { price: Number(price.priceCny), capturedAt: record.capturedAt }
        : null;
    })
    .filter(Boolean);
  return renderTrendChart(points, item.color, `trend-ng-${index}`, {
    ariaLabel: `${item.label} 人民币价格走势`,
    emptyText: `暂无 ${escapeHtml(item.label)} 数据。`,
  });
}

function nigeriaItemSeries(records, key) {
  return records
    .map((record) => record.items?.[key])
    .filter((price) => Number.isFinite(Number(price?.priceCny)));
}

function currencyConversionSeries(records, key) {
  return records
    .map((record) => {
      const conversion = record.conversions?.[key];
      return Number.isFinite(Number(conversion?.convertedAmount))
        ? { ...conversion, capturedAt: record.capturedAt }
        : null;
    })
    .filter(Boolean);
}

// Shared area-style trend chart used by both the Nigeria and Turkey pages.
// `points` is an array of { price, capturedAt }; `gradientId` must be unique per
// chart on the page so multiple charts don't share one gradient definition.
function renderTrendChart(points, color, gradientId, options = {}) {
  const ariaLabel = options.ariaLabel || "价格趋势图";
  const emptyText = options.emptyText || "暂无数据。";
  const tooltipDate = options.tooltipDate || formatDay;
  const formatValue = options.formatValue || ((value) => `¥${formatMoney(value)}`);
  if (points.length === 0) {
    return `<div class="empty">${emptyText}</div>`;
  }

  const width = 960;
  const height = 320;
  const pad = { top: 24, right: 24, bottom: 34, left: 64 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const baseline = pad.top + plotHeight;
  const count = points.length;
  const x = (index) => count > 1 ? pad.left + (index / (count - 1)) * plotWidth : pad.left + plotWidth / 2;

  const values = points.map((point) => point.price);
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
      <text x="${pad.left - 12}" y="${gy + 4}" fill="#8a948e" font-size="12" text-anchor="end">${escapeHtml(formatValue(label))}</text>`;
  }).join("");

  const plotted = points.map((point, index) => ({
    cx: x(index),
    cy: y(point.price),
    price: point.price,
    capturedAt: point.capturedAt,
  }));
  const line = plotted.map((point) => `${point.cx.toFixed(2)},${point.cy.toFixed(2)}`).join(" ");
  const area = `${plotted[0].cx.toFixed(2)},${baseline} ${line} ${plotted[plotted.length - 1].cx.toFixed(2)},${baseline}`;

  const labelEvery = Math.max(1, Math.ceil(count / 6));
  const axis = plotted.map((point, index) => {
    if (index !== 0 && index !== count - 1 && index % labelEvery !== 0) {
      return "";
    }
    return `<text x="${point.cx.toFixed(2)}" y="${height - 10}" fill="#8a948e" font-size="12" text-anchor="middle">${formatMonthDay(point.capturedAt)}</text>`;
  }).join("");

  // With only one or two points there is no visible line, so render solid dots;
  // for longer ranges keep the clean line and reveal a dot on hover only.
  const showDots = count <= 2;
  const dotRadius = showDots ? "4.5" : "3.4";
  const dotOpacity = showDots ? "1" : "0";
  const hover = plotted.map((point) => {
    const half = count > 1 ? plotWidth / (count - 1) / 2 : plotWidth / 2;
    return `<g class="ng-point" tabindex="0" aria-label="${escapeHtml(`${tooltipDate(point.capturedAt)} ${formatValue(point.price)}`)}">
      <rect class="ng-hit" x="${(point.cx - half).toFixed(2)}" y="${pad.top}" width="${(half * 2).toFixed(2)}" height="${plotHeight}" />
      <circle cx="${point.cx.toFixed(2)}" cy="${point.cy.toFixed(2)}" r="${dotRadius}" fill="#ffffff" stroke="${color}" stroke-width="2.4" opacity="${dotOpacity}" />
      ${renderTrendTooltip(point, color, width, pad, tooltipDate, formatValue)}
    </g>`;
  }).join("");

  return `<svg class="trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.28" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02" />
      </linearGradient>
    </defs>
    ${grid}
    <polygon points="${area}" fill="url(#${gradientId})" stroke="none" />
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    ${axis}
    ${hover}
  </svg>`;
}

function renderTrendTooltip(point, color, width, pad, tooltipDate = formatDay, formatValue = (value) => `¥${formatMoney(value)}`) {
  const tooltipWidth = 124;
  const tooltipHeight = 44;
  const gap = 10;
  const x = point.cx > width - pad.right - tooltipWidth - gap
    ? point.cx - tooltipWidth - gap
    : point.cx + gap;
  const y = Math.max(pad.top, point.cy - tooltipHeight - gap);

  return `<g class="tooltip">
    <line x1="${point.cx.toFixed(2)}" y1="${pad.top}" x2="${point.cx.toFixed(2)}" y2="${point.cy.toFixed(2)}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.5" />
    <circle cx="${point.cx.toFixed(2)}" cy="${point.cy.toFixed(2)}" r="4" fill="#ffffff" stroke="${color}" stroke-width="2.2" />
    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${tooltipWidth}" height="${tooltipHeight}" rx="8" fill="#ffffff" stroke="${color}" stroke-width="1.3" />
    <text x="${(x + 12).toFixed(2)}" y="${(y + 18).toFixed(2)}" fill="#1c2321" font-size="13" font-weight="750">${escapeHtml(formatValue(point.price))}</text>
    <text x="${(x + 12).toFixed(2)}" y="${(y + 35).toFixed(2)}" fill="#66706b" font-size="12">${tooltipDate(point.capturedAt)}</text>
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
${CHART_STYLE}${TREND_TABS_STYLE}
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
  <script>${TREND_TABS_SCRIPT}
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
      <div class="chart-wrap">${renderChart(records, denom, color, index)}</div>
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

function renderChart(records, denom, color, index = 0) {
  const points = records
    .map((record) => {
      const price = record.prices.find((item) => item.denomTl === denom);
      return price && Number.isFinite(Number(price.priceCny))
        ? { price: Number(price.priceCny), capturedAt: record.capturedAt }
        : null;
    })
    .filter(Boolean);
  return renderTrendChart(points, color, `trend-tk-${index}`, {
    ariaLabel: `${denom} TL 价格趋势`,
    emptyText: `暂无 ${denom} TL 数据。`,
    tooltipDate: formatChartTime,
  });
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

function formatCurrencyAmount(value, currency, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  const formatted = number.toFixed(decimals).replace(/\.?0+$/, "");
  if (currency === "CNY") {
    return `¥${formatted}`;
  }
  if (currency === "USD") {
    return `US$${formatted}`;
  }
  return `${currency} ${formatted}`;
}

function formatConversionValue(conversion, currency) {
  return Number.isFinite(Number(conversion?.convertedAmount))
    ? formatCurrencyAmount(conversion.convertedAmount, currency)
    : "--";
}

function formatSignedCurrency(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return `${number >= 0 ? "+" : "-"}${formatCurrencyAmount(Math.abs(number), currency)}`;
}

function latestCurrencyConversion(records, key) {
  const series = currencyConversionSeries(records, key);
  return series[series.length - 1] || null;
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
    caches.default.delete(cacheKeyFor(url, "/api/rideshare")),
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
