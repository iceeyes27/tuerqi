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

function testEnvironment() {
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

  return {
    PRICE_HISTORY: {
      async get(key) {
        return key === "appstore:ng-claude:v1" ? history : null;
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
  assert.doesNotMatch(body, /Claude Pro/);
  assert.doesNotMatch(body, /车位明细/);
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
