import assert from "node:assert/strict";
import test from "node:test";

import { extractNigeriaPlanPrice } from "../src/appstore-price.js";

test("parses current escaped payload when upstream inserts extra fields", () => {
  const pageHtml = String.raw`prefix\"subscriptionId\":\"spotify_individual\",\"productId\":\"spotify_individual\",\"name\":\"Premium Individual\",\"duration\":\"monthly\",\"prices\":[{\"region\":\"NG\",\"regionName\":\"尼日利亚\",\"currency\":\"NGN\",\"price\":1600,\"observedAt\":\"2026-07-19\",\"isFree\":false,\"priceUsd\":1.2,\"priceCny\":8.09}]suffix`;

  assert.deepEqual(extractNigeriaPlanPrice(pageHtml, "Premium Individual"), {
    priceNgn: 1600,
    priceUsd: 1.2,
    priceCny: 8.09,
  });
});

test("keeps compatibility with plain JSON and reordered price metadata", () => {
  const pageHtml = `{"subscriptionId":"youtube-premium","productId":"youtube-premium","name":"YouTube Premium","duration":"monthly","prices":[{"region":"NG","currency":"NGN","observedAt":"2026-09-02","price":2200,"isFree":false,"priceCny":11.12,"priceUsd":1.65}]}`;

  assert.deepEqual(extractNigeriaPlanPrice(pageHtml, "YouTube Premium"), {
    priceNgn: 2200,
    priceUsd: 1.65,
    priceCny: 11.12,
  });
});

test("does not borrow fields from another region or billing period", () => {
  const pageHtml = String.raw`\"subscriptionId\":\"family-yearly\",\"name\":\"Premium Family\",\"duration\":\"yearly\",\"prices\":[{\"region\":\"NG\",\"currency\":\"NGN\",\"price\":2500},{\"region\":\"US\",\"currency\":\"USD\",\"price\":5,\"priceUsd\":5,\"priceCny\":34}]`;

  assert.equal(extractNigeriaPlanPrice(pageHtml, "Premium Family", "monthly"), null);
});
