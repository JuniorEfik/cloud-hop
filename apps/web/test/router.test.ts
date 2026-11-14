import assert from "node:assert/strict";
import test from "node:test";

import { APP_ROUTES, normalizePathname, parseAppRoute } from "../src/router.js";

test("approved client routes parse with optional trailing slashes", () => {
  for (const route of Object.keys(APP_ROUTES)) {
    assert.equal(parseAppRoute(route), route);
    if (route !== "/") assert.equal(parseAppRoute(`${route}/`), route);
  }
});

test("unknown paths stay outside the client router", () => {
  assert.equal(parseAppRoute("/missing"), null);
  assert.equal(parseAppRoute("/leaderboard/extra"), null);
  assert.equal(normalizePathname("/play///"), "/play");
});
