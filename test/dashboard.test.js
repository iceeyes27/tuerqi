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

function testEnvironment({ omitItems = [], omitTurkeyDenoms = [], historyPointCount = 2 } = {}) {
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
  const earlierDashboardRecord = structuredClone(history[0]);
  earlierDashboardRecord.capturedAt = new Date(Date.parse(capturedAt) - 24 * 60 * 60 * 1000).toISOString();
  Object.values(earlierDashboardRecord.items).forEach((price) => {
    price.priceCny = Math.max(0.01, price.priceCny - 0.5);
  });
  Object.values(earlierDashboardRecord.conversions).forEach((conversion) => {
    conversion.convertedAmount = Math.max(0.01, conversion.convertedAmount - 0.5);
  });
  history.unshift(earlierDashboardRecord);
  while (history.length < historyPointCount) {
    const earlierRecord = structuredClone(history[0]);
    earlierRecord.capturedAt = new Date(Date.parse(history[0].capturedAt) - 24 * 60 * 60 * 1000).toISOString();
    Object.values(earlierRecord.items).forEach((price) => {
      price.priceCny = Math.max(0.01, price.priceCny - 0.5);
    });
    Object.values(earlierRecord.conversions).forEach((conversion) => {
      conversion.convertedAmount = Math.max(0.01, conversion.convertedAmount - 0.5);
    });
    history.unshift(earlierRecord);
  }
  const turkeyHistory = [{
    capturedAt,
    sourceUrl: "https://www.seagm.com/zh-cn/itunes-gift-card-turkey",
    fx: {
      ok: true,
      source: "Google Finance",
      rateCnyPerTry: 0.17,
    },
    prices: [
      { denomTl: 500, priceCny: 95, originalPriceCny: 100, googlePriceCny: 85, googlePremiumCny: 10, googlePremiumPercent: 11.76, credits: 5513 },
      { denomTl: 1000, priceCny: 185, originalPriceCny: 195, googlePriceCny: 170, googlePremiumCny: 15, googlePremiumPercent: 8.82, credits: 10736 },
      { denomTl: 2000, priceCny: 360, originalPriceCny: 380, googlePriceCny: 340, googlePremiumCny: 20, googlePremiumPercent: 5.88, credits: 20892 },
    ].filter((price) => !omitTurkeyDenoms.includes(price.denomTl)).map((price) => ({
      ...price,
      discountPercent: 5,
      available: true,
    })),
  }];
  const earlierTurkeyRecord = structuredClone(turkeyHistory[0]);
  earlierTurkeyRecord.capturedAt = earlierDashboardRecord.capturedAt;
  earlierTurkeyRecord.prices.forEach((price) => {
    price.priceCny -= 1;
    price.originalPriceCny -= 1;
    price.googlePremiumCny -= 1;
  });
  turkeyHistory.unshift(earlierTurkeyRecord);
  while (turkeyHistory.length < historyPointCount) {
    const earlierRecord = structuredClone(turkeyHistory[0]);
    earlierRecord.capturedAt = new Date(Date.parse(turkeyHistory[0].capturedAt) - 24 * 60 * 60 * 1000).toISOString();
    earlierRecord.prices.forEach((price) => {
      price.priceCny -= 1;
      price.originalPriceCny -= 1;
      price.googlePremiumCny -= 1;
    });
    turkeyHistory.unshift(earlierRecord);
  }

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
  assert.match(body, /\.trend-tabs \{[^}]*flex-wrap: nowrap;/);
  assert.match(body, />玻利维亚<\/button>.*>菲律宾<\/button>.*>YouTube<\/button>.*>Spotify<\/button>.*>土耳其礼品卡<\/button>/);
  assert.match(body, /data-trend-tab[^>]*>YouTube<\/button>/);
  assert.match(body, /data-trend-tab[^>]*>Spotify<\/button>/);
  assert.equal((body.match(/aria-controls="ng-trend-/g) || []).length, 5);
  assert.match(body, /data-combined-chart="trend-ng-group-2"/);
  assert.match(body, /data-series="youtube-solo" data-series-color="#e0513b"/);
  assert.match(body, /data-series="youtube-family" data-series-color="#2f68b8"/);
  assert.match(body, /data-series="spotify-solo" data-series-color="#1db954"/);
  assert.match(body, /data-series="spotify-family" data-series-color="#7a4db3"/);
  assert.match(body, /data-trend-key="turkey-gift-cards"/);
  assert.match(body, /data-combined-chart="trend-turkey-4"/);
  assert.match(body, /data-series="turkey-500" data-series-color="#1e7c63"/);
  assert.match(body, /data-series="turkey-1000" data-series-color="#2f68b8"/);
  assert.match(body, /data-series="turkey-2000" data-series-color="#a86912"/);
  assert.match(body, /<polyline data-series="turkey-500"/);
  assert.match(body, /<polyline data-series="turkey-1000"/);
  assert.match(body, /<polyline data-series="turkey-2000"/);
  assert.match(body, /500 TL/);
  assert.match(body, /1000 TL/);
  assert.match(body, /2000 TL/);
  assert.match(body, /¥95/);
  assert.doesNotMatch(body, /aria-controls="trend-panel-/);
  assert.doesNotMatch(body, /href="\/#turkey-gift-cards"/);
  assert.doesNotMatch(body, /<section id="turkey-gift-cards"/);
  assert.match(body, /window\.location\.hash\.slice\(1\)/);
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

test("redirects the retired Turkey page to the homepage tab", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/turkey"),
    testEnvironment(),
    executionContext,
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/#turkey-gift-cards");
});

test("keeps the Turkey combined chart when one denomination has no data", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/"),
    testEnvironment({ omitTurkeyDenoms: [1000] }),
    executionContext,
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /data-combined-chart="trend-turkey-4"/);
  assert.match(body, /data-series="turkey-500"/);
  assert.doesNotMatch(body, /data-series="turkey-1000"/);
  assert.match(body, /data-series="turkey-2000"/);
  assert.match(body, /1000 TL 最新 <strong>--<\/strong>/);
});

test("keeps only the latest solid marker on dense combined charts", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/"),
    testEnvironment({ historyPointCount: 5 }),
    executionContext,
  );
  const body = await response.text();
  const turkey500 = body.match(/<g data-series="turkey-500"[^>]*>(.*?)<\/g>/s)?.[1] || "";

  assert.equal(response.status, 200);
  assert.equal((turkey500.match(/data-series-marker=/g) || []).length, 1);
  assert.match(turkey500, /data-series-marker="latest"[^>]*fill="#1e7c63"/);
  assert.match(body, /data-hover-marker="turkey-500"[^>]*fill="#1e7c63"/);
});

test("shows both solid markers when a combined series has only two points", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), testEnvironment(), executionContext);
  const body = await response.text();
  const youtubeSolo = body.match(/<g data-series="youtube-solo"[^>]*>(.*?)<\/g>/s)?.[1] || "";

  assert.equal(response.status, 200);
  assert.equal((youtubeSolo.match(/data-series-marker=/g) || []).length, 2);
  assert.match(youtubeSolo, /data-series-marker="short-series"[^>]*fill="#e0513b"/);
  assert.match(youtubeSolo, /data-series-marker="latest"[^>]*fill="#e0513b"/);
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
