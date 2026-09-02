import assert from "node:assert/strict";
import test from "node:test";

import { dashboardCollectionError } from "../src/monitor-health.js";

test("reports a successful collection only when every configured source is present", () => {
  assert.equal(dashboardCollectionError([], []), null);
});

test("turns missing subscriptions into a monitor failure even when FX succeeded", () => {
  assert.equal(
    dashboardCollectionError(["youtube-solo", "spotify-family"], []),
    "App Store Price missing subscriptions: youtube-solo, spotify-family",
  );
});

test("combines subscription and conversion failures into one actionable error", () => {
  assert.equal(
    dashboardCollectionError(["youtube-solo"], ["philippines-php-cny"]),
    "App Store Price missing subscriptions: youtube-solo; Google Finance missing conversions: philippines-php-cny",
  );
});
