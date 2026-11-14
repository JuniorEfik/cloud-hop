import assert from "node:assert/strict";
import test from "node:test";

import { isMeteorExtensionAvailable } from "../src/wallet-availability.js";

test("Meteor extension detection recognizes either injected API", () => {
  assert.equal(isMeteorExtensionAvailable({}), false);
  assert.equal(isMeteorExtensionAvailable({ meteorCom: null }), false);
  assert.equal(isMeteorExtensionAvailable({ meteorCom: {} }), true);
  assert.equal(isMeteorExtensionAvailable({ meteorComV2: {} }), true);
});
