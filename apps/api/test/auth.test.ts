import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey as NodeJsonWebKey,
} from "node:crypto";
import test from "node:test";

import { verifyGoogleIdTokenWithKeys } from "../src/auth.js";

const domain = "login.testnet.fast-auth.com";
const clientId = "test-client";
const now = 2_000_000_000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2_048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
} as NodeJsonWebKey & { kid: string };

const createToken = (overrides: Record<string, unknown> = {}): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: `https://${domain}/`,
      aud: clientId,
      sub: "google-oauth2|123456789",
      iat: now - 10,
      exp: now + 300,
      ...overrides,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${claims}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${claims}.${signature}`;
};

test("Google ID tokens require a valid Auth0 signature and claims", async () => {
  assert.equal(
    await verifyGoogleIdTokenWithKeys(
      createToken(),
      [publicJwk],
      domain,
      clientId,
      now,
    ),
    "google-oauth2|123456789",
  );

  await assert.rejects(
    verifyGoogleIdTokenWithKeys(
      createToken({ exp: now - 120 }),
      [publicJwk],
      domain,
      clientId,
      now,
    ),
    /invalid/i,
  );
  await assert.rejects(
    verifyGoogleIdTokenWithKeys(
      createToken({ aud: "another-client" }),
      [publicJwk],
      domain,
      clientId,
      now,
    ),
    /invalid/i,
  );
});
