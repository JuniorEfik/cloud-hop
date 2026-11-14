import assert from "node:assert/strict";
import test from "node:test";

import { isNetlifyDeployment } from "../src/hosting.js";

test("Google sign-in hosting restriction applies only to Netlify hosts", () => {
  assert.equal(isNetlifyDeployment("cloud-hop-near-arcade.netlify.app"), true);
  assert.equal(
    isNetlifyDeployment("deploy-preview-4--cloud-hop-near-arcade.netlify.app"),
    true,
  );
  assert.equal(isNetlifyDeployment("localhost"), false);
  assert.equal(isNetlifyDeployment("cloud-hop.example.com"), false);
  assert.equal(isNetlifyDeployment("notnetlify.app.example.com"), false);
});
