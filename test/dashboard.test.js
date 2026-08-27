import assert from "node:assert/strict";
import test from "node:test";

globalThis.caches = {
  default: {
    async match() { return null; },
    async put() {},
    async delete() { return true; },
  },
};

const worker = (await import("../src/index.js")).default;

function testEnvironment({ omitItems = [] } = {}) {
  const capturedAt = new Date().toISOString();
  const history = [{
    capturedAt,
    fx: {
      date: capturedAt.slice(0, 10),
      usdToCny: 6.8,
      usdToNgn: 1400,
      ngnToCny: 0.00485714,
    },
    items: {
      "claude-pro": { priceNgn: 29900, priceUsd: 21.66, priceCny: 147.08 },
      "youtube-solo": { priceNgn: 2200, priceUsd: 1.59, priceCny: 10.82 },
      "youtube-family": { priceNgn: 3600, priceUsd: 2.61, priceCny: 17.71 },
      "spotify-solo": { priceNgn: 1600, priceUsd: 1.16, priceCny: 7.87 },
      "spotify-family": { priceNgn: 2500, priceUsd: 1.81, priceCny: 12.3 },
    },
    conversions: {
      "bolivia-bob-cny": {
        baseCurrency: "BOB",
        quoteCurrency: "CNY",
        amount: 139.9,
        rate: 0.58252467,
        convertedAmount: 81.5,
        source: "Google Finance",
        sourceUrl: "https://www.google.com/finance/beta/quote/BOB-CNY",
      },
      "philippines-php-usd": {
        baseCurrency: "PHP",
        quoteCurrency: "USD",
        amount: 9010,
        rate: 0.01621893,
        convertedAmount: 146.13,
        source: "Google Finance",
        sourceUrl: "https://www.google.com/finance/beta/quote/PHP-USD",
      },
      "philippines-php-cny": {
        baseCurrency: "PHP",
        quoteCurrency: "CNY",
        amount: 9010,
        rate: 0.10903581,
        convertedAmount: 982.41,
        source: "Google Finance",
        sourceUrl: "https://www.google.com/finance/beta/quote/PHP-CNY",
      },
    },
  }];
  omitItems.forEach((key) => delete history[0].items[key]);
  const turkeyHistory = [{
    capturedAt,
    sourceUrl: "https://www.seagm.com/zh-cn/itunes-gift-card-turkey",
    fx: {
      ok: true,
      source: "Google Finance",
      rateCnyPerTry: 0.17,
    },
    prices: [{
      denomTl: 500,
      priceCny: 95,
      originalPriceCny: 100,
      discountPercent: 5,
      credits: 5513,
      available: true,
      googlePriceCny: 85,
      googlePremiumCny: 10,
      googlePremiumPercent: 11.76,
    }],
  }];

  return {
    PRICE_HISTORY: {
      async get(key) {
        if (key === "appstore:ng-claude:v1") return history;
        if (key === "seagm:history:v1") return turkeyHistory;
        return null;
      },
      async put() {},
    },
    RETENTION_DAYS: "60",
    MAX_HISTORY_RECORDS: "500",
    RIDESHARE_PLANS_JSON: "",
  };
}

const executionContext = { waitUntil() {} };

test("renders separate Bolivia and Philippines cards and omits seat detail tables", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), testEnvironment(), executionContext);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /玻利维亚 139\.9 BOB/);
  assert.match(body, /¥81\.5/);
  assert.match(body, /菲律宾 9010 PHP/);
  assert.match(body, /US\$146\.13/);
  assert.match(body, /¥982\.41/);
  assert.match(body, /编辑拼车/);
  assert.match(body, /data-trend-tab[^>]*>YouTube<\/button>/);
  assert.match(body, /data-trend-tab[^>]*>Spotify<\/button>/);
  assert.equal((body.match(/aria-controls="ng-trend-/g) || []).length, 4);
  assert.match(body, /data-combined-chart="trend-ng-group-2"/);
  assert.match(body, /data-series="youtube-solo" data-series-color="#e0513b"/);
  assert.match(body, /data-series="youtube-family" data-series-color="#2f68b8"/);
  assert.match(body, /data-series="spotify-solo" data-series-color="#1db954"/);
  assert.match(body, /data-series="spotify-family" data-series-color="#7a4db3"/);
  assert.match(body, /id="turkey-gift-cards"/);
  assert.match(body, /土耳其礼品卡/);
  assert.match(body, /500 TL/);
  assert.match(body, /¥95/);
  assert.ok(body.indexOf('id="turkey-gift-cards"') > body.indexOf("汇率来源"));
  assert.doesNotMatch(body, /Claude Pro/);
  assert.doesNotMatch(body, /车位明细/);
});

test("keeps a combined subscription chart when one plan has no data", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/"),
    testEnvironment({ omitItems: ["youtube-family"] }),
    executionContext,
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /data-combined-chart="trend-ng-group-2"/);
  assert.match(body, /data-series="youtube-solo"/);
  assert.doesNotMatch(body, /data-series="youtube-family"/);
  assert.match(body, /YT 家庭 最新 <strong>--<\/strong>/);
});

test("redirects the retired Turkey page to the homepage section", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/turkey"),
    testEnvironment(),
    executionContext,
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/#turkey-gift-cards");
});

test("publishes conversion metadata while hiding legacy Claude data", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/nigeria"), testEnvironment(), executionContext);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.conversions.length, 3);
  assert.equal(body.items.length, 4);
  assert.equal(body.items.some((item) => item.key === "claude-pro"), false);
  assert.equal(Object.hasOwn(body.latest.items, "claude-pro"), false);
  assert.equal(body.latest.conversions["philippines-php-usd"].convertedAmount, 146.13);
});
