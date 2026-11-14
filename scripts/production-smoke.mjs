import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("Could not reserve a production smoke port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitFor = async (url, attempts = 100) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The production server did not become ready.", {
    cause: lastError,
  });
};

const waitForExit = (child, timeoutMs = 5_000) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
const child = spawn(process.execPath, ["scripts/start-production.mjs"], {
  env: {
    ...process.env,
    API_HOST: "127.0.0.1",
    API_PORT: String(port),
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => output.push(chunk));
}

try {
  const pageResponse = await waitFor(baseUrl);
  assert.equal(pageResponse.headers.get("x-frame-options"), "DENY");
  const pageCsp = pageResponse.headers.get("content-security-policy") ?? "";
  const pageNonce = pageCsp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  assert.ok(pageNonce);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /Cloud Hop · NEAR Arcade/);
  assert.ok(pageHtml.includes(`nonce="${pageNonce}"`));
  assert.doesNotMatch(pageHtml, /__CSP_NONCE__/);

  const deepLinkResponse = await fetch(`${baseUrl}/dashboard`);
  assert.equal(deepLinkResponse.status, 200);
  assert.match(deepLinkResponse.headers.get("content-type") ?? "", /^text\/html/);
  const deepLinkCsp = deepLinkResponse.headers.get("content-security-policy") ?? "";
  const deepLinkNonce = deepLinkCsp.match(
    /script-src[^;]*'nonce-([^']+)'/,
  )?.[1];
  assert.ok(deepLinkNonce);
  assert.notEqual(deepLinkNonce, pageNonce);
  const deepLinkHtml = await deepLinkResponse.text();
  assert.match(deepLinkHtml, /Cloud Hop · NEAR Arcade/);
  assert.ok(deepLinkHtml.includes(`nonce="${deepLinkNonce}"`));
  assert.doesNotMatch(deepLinkHtml, /__CSP_NONCE__/);

  const scriptResponse = await fetch(`${baseUrl}/app.js`);
  assert.equal(scriptResponse.status, 200);
  const script = await scriptResponse.text();
  assert.doesNotMatch(script, /http:\/\/127\.0\.0\.1:8787\/api\/v1/);
  assert.match(script, /\/api\/v1\/game\/config/);

  const gameplayAssetResponse = await fetch(
    `${baseUrl}/assets/cloud-hop-arena.webp`,
  );
  assert.equal(gameplayAssetResponse.status, 200);
  assert.equal(gameplayAssetResponse.headers.get("content-type"), "image/webp");

  const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(healthResponse.status, 200);
  assert.match(
    healthResponse.headers.get("content-security-policy") ?? "",
    /default-src 'none'/,
  );
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.contractConfigured, true);

  const preflightResponse = await fetch(`${baseUrl}/api/v1/health`, {
    method: "OPTIONS",
    headers: { origin: baseUrl },
  });
  assert.equal(preflightResponse.status, 204);
  assert.equal(preflightResponse.headers.get("access-control-allow-origin"), baseUrl);

  const missingResponse = await fetch(`${baseUrl}/missing-file`);
  assert.equal(missingResponse.status, 404);
  assert.match(missingResponse.headers.get("content-type") ?? "", /^text\/plain/);

  console.log(
    JSON.stringify(
      {
        sameOriginWebAndApi: true,
        deepLinkFallback: true,
        gameplayArtwork: true,
        contractConfigured: health.contractConfigured,
        sponsorConfigured: health.sponsorConfigured,
        verifierConfigured: health.verifierConfigured,
        securityHeaders: true,
        perResponseCspNonce: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (output.length > 0) console.error(output.join("").slice(-4_000));
  throw error;
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await waitForExit(child);
}
