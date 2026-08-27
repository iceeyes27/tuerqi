import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleConversionSnapshot,
  extractGoogleFinanceRate,
  googleFinanceQuoteUrls,
} from "../src/google-finance.js";

test("extracts the requested pair from Google serialized data", () => {
  const html = `noise,0.982345,"BOB / CNY",1,2,["BOB","CNY" trailing`;
  assert.equal(extractGoogleFinanceRate(html, "BOB", "CNY"), 0.982345);
});

test("extracts the alternate Google serialized layout", () => {
  const html = `noise "PHP / USD",1,null,[0.0172345 trailing`;
  assert.equal(extractGoogleFinanceRate(html, "PHP", "USD"), 0.0172345);
});

test("falls back to data-last-price and visible finance price", () => {
  assert.equal(extractGoogleFinanceRate('<div data-last-price="0.121234"></div>', "PHP", "CNY"), 0.121234);
  assert.equal(extractGoogleFinanceRate('<div class="YMlKec fxKbKc">1,234.56</div>', "PHP", "CNY"), 1234.56);
});

test("returns NaN for missing or non-positive rates", () => {
  assert.equal(Number.isNaN(extractGoogleFinanceRate("<html></html>", "PHP", "USD")), true);
  assert.equal(Number.isNaN(extractGoogleFinanceRate('<div data-last-price="0"></div>', "PHP", "USD")), true);
});

test("builds a rounded conversion snapshot", () => {
  const snapshot = buildGoogleConversionSnapshot({
    amount: 9010,
    baseCurrency: "PHP",
    quoteCurrency: "USD",
  }, 0.01723456789, "https://www.google.com/finance/quote/PHP-USD");

  assert.deepEqual(snapshot, {
    baseCurrency: "PHP",
    quoteCurrency: "USD",
    amount: 9010,
    rate: 0.01723457,
    convertedAmount: 155.28,
    source: "Google Finance",
    sourceUrl: "https://www.google.com/finance/quote/PHP-USD",
  });
});

test("rejects invalid conversion rates and currency codes", () => {
  assert.throws(() => buildGoogleConversionSnapshot({ amount: 139.9 }, 0, "https://example.com"), /positive number/);
  assert.throws(() => googleFinanceQuoteUrls("PH", "USD"), /Invalid currency code/);
});

test("creates primary and beta Google Finance URLs", () => {
  assert.deepEqual(googleFinanceQuoteUrls("php", "cny"), [
    "https://www.google.com/finance/quote/PHP-CNY",
    "https://www.google.com/finance/beta/quote/PHP-CNY",
  ]);
});
