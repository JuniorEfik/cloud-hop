import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const chromeExecutable = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
process.loadEnvFile(path.join(repositoryDirectory, ".env"));

const meteorProbeAccountId = process.env.NEAR_SPONSOR_ACCOUNT_ID;
const meteorProbeRpcUrl =
  process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";

if (!meteorProbeAccountId) {
  throw new Error("NEAR_SPONSOR_ACCOUNT_ID is required for the Meteor browser probe.");
}

const accessKeyResponse = await fetch(meteorProbeRpcUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "meteor-headless-probe",
    method: "query",
    params: {
      request_type: "view_access_key_list",
      finality: "final",
      account_id: meteorProbeAccountId,
    },
  }),
});
const accessKeyPayload = await accessKeyResponse.json();
const meteorProbePublicKey = accessKeyPayload.result?.keys?.find(
  ({ access_key: accessKey }) => accessKey.permission === "FullAccess",
)?.public_key;

if (typeof meteorProbePublicKey !== "string") {
  throw new Error("The Meteor browser probe account has no full-access key.");
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("Could not reserve a local port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitFor = async (check, label, attempts = 100) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become ready.`, { cause: lastError });
};

const startService = (command, args, env) => {
  const output = [];
  const child = spawn(command, args, {
    cwd: repositoryDirectory,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => output.push(chunk));
  }
  child.output = output;
  return child;
};

const waitForExit = (child, timeoutMs = 5_000) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
};

const stopService = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child)) return;
  child.kill("SIGKILL");
  await waitForExit(child);
};

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === "number") {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.#listeners.get(message.method) ?? [];
      for (const listener of listeners) listener(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    const response = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  on(method, listener) {
    this.#listeners.set(method, [
      ...(this.#listeners.get(method) ?? []),
      listener,
    ]);
  }

  once(method) {
    return new Promise((resolve) => {
      const listener = (params) => {
        this.#listeners.set(
          method,
          (this.#listeners.get(method) ?? []).filter(
            (candidate) => candidate !== listener,
          ),
        );
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  close() {
    this.#socket.close();
  }
}

const evaluate = async (page, expression) => {
  const response = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "Browser evaluation failed.");
  }
  return response.result.value;
};

const apiPort = await freePort();
const webPort = await freePort();
const debuggingPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://localhost:${webPort}`;
const profileDirectory = await mkdtemp(path.join(tmpdir(), "near-arcade-chrome-"));
const webOutputDirectory = await mkdtemp(
  path.join(tmpdir(), "near-arcade-web-smoke-"),
);
const screenshotPath = path.join(tmpdir(), "near-arcade-headless-smoke.png");
const leaderboardScreenshotPath = path.join(
  tmpdir(),
  "near-arcade-headless-leaderboard.png",
);
const dashboardScreenshotPath = path.join(
  tmpdir(),
  "near-arcade-headless-dashboard.png",
);
const tournamentScreenshotPath = path.join(
  tmpdir(),
  "near-arcade-headless-tournament.png",
);
const gameplayScreenshotPath = path.join(
  tmpdir(),
  "near-arcade-headless-gameplay.png",
);
const children = [];
let browser;
let page;

try {
  const api = startService(
    process.execPath,
    ["apps/api/dist/src/server.js"],
    { API_PORT: String(apiPort), WEB_ORIGINS: webUrl },
  );
  children.push(api);
  const apiHealthResponse = await waitFor(async () => {
    const response = await fetch(`${apiUrl}/api/v1/health`);
    return response.ok ? response : null;
  }, "API");
  assert.equal(apiHealthResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(apiHealthResponse.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    apiHealthResponse.headers.get("content-security-policy") ?? "",
    /default-src 'none'/,
  );
  const apiHealth = await apiHealthResponse.json();

  const web = startService(
    process.execPath,
    ["apps/web/scripts/dev.mjs"],
    {
      PORT: String(webPort),
      PUBLIC_API_BASE_URL: apiUrl,
      DEV_API_ORIGIN: apiUrl,
      WEB_OUTPUT_DIRECTORY: webOutputDirectory,
    },
  );
  children.push(web);
  const webResponse = await waitFor(async () => {
    const response = await fetch(webUrl);
    return response.ok ? response : null;
  }, "web app", 300);
  assert.equal(webResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(webResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(webResponse.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    webResponse.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  const webCsp = webResponse.headers.get("content-security-policy") ?? "";
  const webNonce = webCsp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  assert.ok(webNonce);
  const webHtml = await webResponse.text();
  assert.ok(webHtml.includes(`nonce="${webNonce}"`));
  assert.doesNotMatch(webHtml, /__CSP_NONCE__/);
  const proxiedHealthResponse = await fetch(`${webUrl}/api/v1/health`);
  assert.equal(proxiedHealthResponse.status, 200);
  assert.equal((await proxiedHealthResponse.json()).ok, true);

  const chrome = startService(
    chromeExecutable,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profileDirectory}`,
      "about:blank",
    ],
    {},
  );
  children.push(chrome);

  const version = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
    return response.ok ? response.json() : null;
  }, "Chrome DevTools");
  browser = await CdpClient.connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
    const targets = await response.json();
    return targets.find((candidate) => candidate.id === targetId);
  }, "Chrome page target");
  page = await CdpClient.connect(target.webSocketDebuggerUrl);

  const browserErrors = [];
  page.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserErrors.push(exceptionDetails.text ?? "Uncaught browser exception");
  });
  page.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type === "error") {
      browserErrors.push(
        args.map((argument) => argument.value ?? argument.description).join(" "),
      );
    }
  });
  await Promise.all([
    page.send("Page.enable"),
    page.send("Runtime.enable"),
    page.send("Network.enable"),
    page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }),
  ]);

  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const accountId = ${JSON.stringify(meteorProbeAccountId)};
      const publicKey = ${JSON.stringify(meteorProbePublicKey)};
      const probe = {
        connectCalls: 0,
        connectResolved: 0,
        disconnectCalls: 0,
        signMessageCalls: 0,
        signTransactionCalls: 0,
        signDelegateCalls: 0,
        lastTransaction: null,
        lastDelegate: null,
      };
      let connected = false;
      const wallet = {
        manifest: {
          id: "meteor-wallet",
          name: "Meteor Wallet",
          description: "Injected Meteor-compatible wallet used by the browser integration test.",
          icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
          website: "https://example.com",
          version: "1.0.0",
          executor: "",
          type: "injected",
          platform: [],
          permissions: {},
          features: {
            signMessage: true,
            signTransaction: true,
            signAndSendTransaction: true,
            signAndSendTransactions: true,
            signInWithoutAddKey: true,
            signInAndSignMessage: true,
            signInWithFunctionCallKey: false,
            signDelegateActions: true,
            mainnet: true,
            testnet: true,
          },
        },
        async signIn() {
          probe.connectCalls += 1;
          connected = true;
          probe.connectResolved += 1;
          return [{ accountId, publicKey }];
        },
        async signInAndSignMessage({ messageParams }) {
          probe.connectCalls += 1;
          probe.signMessageCalls += 1;
          if (probe.signMessageCalls === 1) {
            throw new Error("User rejected headless wallet authorization probe.");
          }
          connected = true;
          probe.connectResolved += 1;
          return [{
            accountId,
            publicKey,
            signedMessage: {
              accountId,
              publicKey,
              signature: "headless-wallet-signature",
              message: messageParams.message,
            },
          }];
        },
        async signOut() {
          probe.disconnectCalls += 1;
          connected = false;
        },
        async getAccounts() {
          return connected ? [{ accountId, publicKey }] : [];
        },
        async signAndSendTransaction(transaction) {
          probe.signTransactionCalls += 1;
          probe.lastTransaction = {
            signerId: transaction?.signerId ?? null,
            receiverId: transaction?.receiverId ?? null,
            actionCount: transaction?.actions?.length ?? null,
          };
          throw new Error("Headless wallet rejected transaction signing.");
        },
        async signAndSendTransactions() {
          throw new Error("Headless wallet rejected transaction signing.");
        },
        async signMessage() {
          probe.signMessageCalls += 1;
          return { accountId, publicKey, signature: "headless-wallet-signature" };
        },
        async signDelegateActions(params) {
          probe.signDelegateCalls += 1;
          const delegated = params?.delegateActions?.[0];
          probe.lastDelegate = {
            signerId: params?.signerId ?? null,
            receiverId: delegated?.receiverId ?? null,
            actionCount: delegated?.actions?.length ?? null,
          };
          throw new Error("Headless wallet rejected delegated transaction signing.");
        },
      };
      Object.defineProperty(window, "__nearConnectProbe", {
        configurable: false,
        enumerable: false,
        value: probe,
      });
      const inject = () => {
        window.dispatchEvent(new CustomEvent("near-wallet-injected", { detail: wallet }));
      };
      window.addEventListener("near-selector-ready", inject);
    })();`,
  });

  await page.send("Network.setBlockedURLs", { urls: [`${apiUrl}/*`] });
  const loaded = page.once("Page.loadEventFired");
  await page.send("Page.navigate", { url: `${webUrl}/settings` });
  await loaded;
  const bootFailure = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          status: document.querySelector('[data-boot-status]')?.textContent?.trim(),
          actionsHidden: document.querySelector('[data-boot-actions]')?.hidden,
          appHidden: document.querySelector('[data-app]')?.hidden,
        }))()`,
      );
      return /could not finish loading/i.test(state.status ?? "") &&
        state.actionsHidden === false && state.appHidden === true
        ? state
        : null;
    },
    "recoverable boot failure",
    200,
  );
  await evaluate(
    page,
    "document.querySelector('[data-action=\"continue-guest\"]')?.click()",
  );
  const guestFallback = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          pathname: location.pathname,
          appHidden: document.querySelector('[data-app]')?.hidden,
          visibleScreen: document.querySelector('[data-screen]:not([hidden])')?.getAttribute('data-screen'),
        }))()`,
      );
      return state.pathname === "/settings" && state.appHidden === false
        ? state
        : null;
    },
    "guest boot fallback",
  );
  assert.equal(guestFallback.visibleScreen, "/settings");

  await page.send("Network.setBlockedURLs", { urls: [] });
  browserErrors.length = 0;
  const automaticRecovery = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          status: document.querySelector('[data-status]')?.textContent?.trim(),
          googleDisabled: document.querySelector('[data-auth="google"]')?.disabled,
        }))()`,
      );
      return /Guest play is ready\. Connect to save/i.test(state.status ?? "")
        ? state
        : null;
    },
    "automatic service recovery",
    300,
  );
  assert.equal(automaticRecovery.googleDisabled, !apiHealth.sponsorConfigured);
  const deepLinkLoaded = page.once("Page.loadEventFired");
  await page.send("Page.navigate", { url: `${webUrl}/leaderboard` });
  await deepLinkLoaded;
  const status = await waitFor(
    async () => {
      const text = await evaluate(
        page,
        "document.querySelector('[data-status]')?.textContent?.trim()",
      );
      return typeof text === "string" && !text.startsWith("Loading") ? text : null;
    },
    "wallet configuration",
    200,
  );
  assert.match(status, /Guest play is ready/i);

  const deepLinkState = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          pathname: location.pathname,
          title: document.title,
          visibleScreen: document.querySelector('[data-screen]:not([hidden])')?.getAttribute('data-screen'),
          focusedHeading: document.activeElement?.hasAttribute('data-route-heading') ?? false,
        }))()`,
      );
      return state.pathname === "/leaderboard" &&
        state.visibleScreen === "/leaderboard" && state.focusedHeading
        ? state
        : null;
    },
    "leaderboard deep link",
  );
  assert.match(deepLinkState.title, /Leaderboard · NEAR Arcade/);

  const accessibilityState = await evaluate(
    page,
    `(() => {
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
      const describedBy = document.querySelector('[data-canvas]')
        ?.getAttribute('aria-describedby')?.split(/\\s+/).filter(Boolean) ?? [];
      const appRoot = document.querySelector('#root');
      const unnamedInteractive = [...(appRoot?.querySelectorAll('button, a[href]') ?? [])]
        .filter((element) => !(
          element.getAttribute('aria-label')?.trim() ||
          element.textContent?.trim() ||
          element.getAttribute('title')?.trim()
        )).length;
      return {
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        skipTarget: document.querySelector('.skip-link')?.getAttribute('href'),
        primaryNav: document.querySelector('nav[aria-label="Primary navigation"]') !== null,
        mobileNav: document.querySelector('nav[aria-label="Mobile navigation"]') !== null,
        mainLandmark: document.querySelector('main#main-content') !== null,
        visibleScreens: document.querySelectorAll('[data-screen]:not([hidden])').length,
        onboardingSteps: document.querySelectorAll('.journey-list > li').length,
        canvasDescriptionsResolve: describedBy.length === 2 && describedBy.every((id) => document.getElementById(id)),
        unnamedInteractive,
        proofLinks: document.querySelectorAll('footer a[href]').length,
      };
    })()`,
  );
  assert.deepEqual(accessibilityState.duplicateIds, []);
  assert.equal(accessibilityState.skipTarget, "#main-content");
  assert.equal(accessibilityState.primaryNav, true);
  assert.equal(accessibilityState.mobileNav, true);
  assert.equal(accessibilityState.mainLandmark, true);
  assert.equal(accessibilityState.visibleScreens, 1);
  assert.equal(accessibilityState.onboardingSteps, 3);
  assert.equal(accessibilityState.canvasDescriptionsResolve, true);
  assert.equal(accessibilityState.unnamedInteractive, 0);
  assert.equal(accessibilityState.proofLinks, 1);

  await evaluate(
    page,
    "document.querySelector('a[data-route=\"/tournaments\"]')?.click()",
  );
  const tournamentRoute = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          pathname: location.pathname,
          screen: document.querySelector('[data-screen]:not([hidden])')?.getAttribute('data-screen'),
          heading: document.activeElement?.id,
          announcement: document.querySelector('[data-route-announcer]')?.textContent?.trim(),
        }))()`,
      );
      return state.pathname === "/tournaments" &&
        state.screen === "/tournaments" && state.heading === "tournament-title"
        ? state
        : null;
    },
    "tournament route",
  );
  assert.match(tournamentRoute.announcement ?? "", /Tournaments screen opened/);

  const tournamentState = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          name: document.querySelector('[data-tournament-name]')?.textContent?.trim(),
          status: document.querySelector('[data-tournament-status]')?.textContent?.trim(),
          reward: document.querySelector('[data-tournament-reward]')?.textContent?.trim(),
          action: document.querySelector('[data-tournament-action]')?.textContent?.trim(),
          rows: document.querySelectorAll('.tournament-row').length,
        }))()`,
      );
      return /^weekly-/.test(state.name ?? "") &&
        /active|scheduled/i.test(state.status ?? "")
        ? state
        : null;
    },
    "weekly tournament",
    200,
  );
  assert.equal(tournamentState.reward, "No token reward");
  assert.match(tournamentState.action ?? "", /NEAR account|required|registration/i);

  await evaluate(
    page,
    "document.querySelector('a[data-route=\"/leaderboard\"]')?.click()",
  );
  await waitFor(
    async () =>
      (await evaluate(page, "location.pathname")) === "/leaderboard" &&
      (await evaluate(page, "document.activeElement?.id")) === "leaderboard-title",
    "leaderboard route",
  );

  const allTimeLeaderboard = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          status: document.querySelector('[data-leaderboard-status]')?.textContent?.trim(),
          rows: document.querySelectorAll('.leaderboard-row').length,
        }))()`,
      );
      return /all time.*on-chain source/i.test(state.status ?? "") ? state : null;
    },
    "all-time leaderboard",
    200,
  );
  assert.ok(allTimeLeaderboard.rows >= 1);
  const semanticCells = await evaluate(
    page,
    "document.querySelectorAll('.leaderboard-row [role=\"cell\"]').length",
  );
  assert.equal(semanticCells, allTimeLeaderboard.rows * 5);

  await evaluate(
    page,
    `(() => {
      const tab = document.querySelector('[data-leaderboard-period="all"]');
      tab?.focus();
      tab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    })()`,
  );
  const dailyLeaderboard = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          selected: document.querySelector('[data-leaderboard-period="daily"]')?.getAttribute('aria-selected'),
          focused: document.activeElement?.getAttribute('data-leaderboard-period'),
          tabIndex: document.querySelector('[data-leaderboard-period="daily"]')?.getAttribute('tabindex'),
          labelledBy: document.querySelector('#leaderboard-panel')?.getAttribute('aria-labelledby'),
          status: document.querySelector('[data-leaderboard-status]')?.textContent?.trim(),
          rows: document.querySelectorAll('.leaderboard-row').length,
        }))()`,
      );
      return state.selected === "true" &&
        state.focused === "daily" &&
        state.tabIndex === "0" &&
        state.labelledBy === "leaderboard-tab-daily" &&
        /current UTC day/i.test(state.status ?? "")
        ? state
        : null;
    },
    "daily leaderboard",
    200,
  );
  assert.ok(Number.isInteger(dailyLeaderboard.rows));
  assert.ok(dailyLeaderboard.rows >= 0);

  await evaluate(
    page,
    "document.querySelector('a[data-route=\"/play\"]')?.click()",
  );
  await waitFor(
    async () =>
      (await evaluate(page, "location.pathname")) === "/play" &&
      (await evaluate(page, "document.activeElement?.id")) === "game-title",
    "play route",
  );

  await evaluate(
    page,
    "document.querySelector('[data-action=\"open-auth\"]')?.click()",
  );
  const authState = await evaluate(
    page,
    `(() => {
      const dialog = document.querySelector('[data-auth-dialog]');
      return {
        open: dialog?.open === true,
        options: dialog?.querySelectorAll('[data-auth]').length ?? 0,
        googleDisabled: dialog?.querySelector('[data-auth="google"]')?.disabled ?? true,
      };
    })()`,
  );
  assert.deepEqual(authState, {
    open: true,
    options: 2,
    googleDisabled: !apiHealth.sponsorConfigured,
  });

  const authDialogOpenDuringHandoff = await evaluate(
    page,
    `(() => {
      const dialog = document.querySelector('[data-auth-dialog]');
      document.querySelector('[data-auth="wallet"]')?.click();
      return dialog?.open === true;
    })()`,
  );
  assert.equal(authDialogOpenDuringHandoff, false);
  const connectorWallets = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          open: document.querySelector('.hot-connector-popup .modal-container') !== null,
          count: document.querySelectorAll('.hot-connector-popup .connect-item').length,
          meteorAvailable: document.querySelector('.hot-connector-popup [data-type="meteor-wallet"]') !== null,
          nightlyAvailable: document.querySelector('.hot-connector-popup [data-type="nightly-wallet"]') !== null,
          intearWalletAvailable: document.querySelector('.hot-connector-popup [data-type="intear-wallet"]') !== null,
        }))()`,
      );
      return state.open && state.meteorAvailable && state.count === 1
        ? state
        : null;
    },
    "NEAR Connect wallet list",
    300,
  );
  assert.equal(connectorWallets.nightlyAvailable, false);
  assert.equal(connectorWallets.intearWalletAvailable, false);
  await evaluate(
    page,
    "document.querySelector('.hot-connector-popup .modal-container')?.click()",
  );
  const walletCancellation = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          dialogOpen: document.querySelector('[data-auth-dialog]')?.open === true,
          walletDisabled:
            document.querySelector('[data-auth="wallet"]')?.disabled ?? true,
          selectorOpen: document.querySelector('.hot-connector-popup .modal-container') !== null,
          rememberedWallet: localStorage.getItem('selected-wallet'),
          status: document.querySelector('[data-status]')?.textContent?.trim(),
        }))()`,
      );
      return state.dialogOpen && !state.walletDisabled && !state.selectorOpen &&
        /cancelled/i.test(state.status ?? "")
        ? state
        : null;
    },
    "NEAR Connect cancellation",
    200,
  );
  const authHandoffLoaded = page.once("Page.loadEventFired");
  await page.send("Page.reload", { ignoreCache: true });
  await authHandoffLoaded;
  browserErrors.length = 0;
  const silentRefresh = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          pathname: location.pathname,
          appHidden: document.querySelector('[data-app]')?.hidden,
          status: document.querySelector('[data-status]')?.textContent?.trim(),
          authDialogOpen:
            document.querySelector('[data-auth-dialog]')?.open === true,
          selectorOpen: document.querySelector('.hot-connector-popup .modal-container') !== null,
          rememberedWallet: localStorage.getItem('selected-wallet'),
        }))()`,
      );
      return state.pathname === "/play" && state.appHidden === false &&
        /Guest play is ready/i.test(state.status ?? "")
        ? state
        : null;
    },
    "wallet modal handoff reload",
    200,
  );
  assert.equal(silentRefresh.authDialogOpen, false);
  assert.equal(silentRefresh.selectorOpen, false);
  assert.equal(silentRefresh.rememberedWallet, null);
  await evaluate(
    page,
    "document.querySelector('[data-action=\"start\"], [data-action=\"restart\"]')?.click()",
  );
  const countdownValues = [];
  for (const expected of [3, 2, 1]) {
    const countdownValue = await waitFor(
      async () => {
        const state = await evaluate(
          page,
          `(() => ({
            value: document.querySelector('[data-countdown-value]')?.textContent?.trim(),
            overlayHidden: document.querySelector('[data-overlay]')?.hidden,
            flight: document.querySelector('[data-flight]')?.textContent?.trim(),
            pauseDisabled: document.querySelector('[data-action="pause"]')?.disabled,
          }))()`,
        );
        return state.value === String(expected) ? state : null;
      },
      `guest countdown ${expected}`,
    );
    assert.equal(countdownValue.overlayHidden, false);
    assert.equal(countdownValue.flight, "0.0s");
    assert.equal(countdownValue.pauseDisabled, true);
    countdownValues.push(Number(countdownValue.value));
  }
  await waitFor(
    async () =>
      (await evaluate(page, "document.querySelector('[data-overlay]')?.hidden")) ===
      true,
    "guest run",
  );
  const immersiveState = await evaluate(
    page,
    `(() => {
      const playLayout = document.querySelector('.play-layout');
      return {
        active: document.body.classList.contains('game-immersive'),
        detailsDisplay: getComputedStyle(document.querySelector('.details-panel')).display,
        navigationDisplay: getComputedStyle(document.querySelector('.bottom-nav')).display,
        statusDisplay: getComputedStyle(document.querySelector('[data-status]')).display,
        playHeight: Math.round(playLayout?.getBoundingClientRect().height ?? 0),
        viewportHeight: window.innerHeight,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    })()`,
  );
  assert.deepEqual(
    {
      active: immersiveState.active,
      detailsDisplay: immersiveState.detailsDisplay,
      navigationDisplay: immersiveState.navigationDisplay,
      statusDisplay: immersiveState.statusDisplay,
      bodyOverflow: immersiveState.bodyOverflow,
    },
    {
      active: true,
      detailsDisplay: "none",
      navigationDisplay: "none",
      statusDisplay: "none",
      bodyOverflow: "hidden",
    },
  );
  assert.ok(Math.abs(immersiveState.playHeight - immersiveState.viewportHeight) <= 1);
  await evaluate(
    page,
    `(async () => {
      for (let index = 0; index < 4; index += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 190));
      }
    })()`,
  );
  const guestState = await evaluate(
    page,
    `(() => ({
      label: document.querySelector('[data-session-label]')?.textContent?.trim(),
      canvasWidth: Math.round(document.querySelector('[data-canvas]')?.getBoundingClientRect().width ?? 0),
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))()`,
  );
  assert.equal(guestState.label, "Guest session");
  assert.ok(guestState.canvasWidth > 250 && guestState.canvasWidth <= 390);
  assert.ok(guestState.scrollWidth <= guestState.viewportWidth);

  await evaluate(
    page,
    `(() => {
      const navigation = document.querySelector('.bottom-nav');
      if (navigation instanceof HTMLElement) navigation.style.visibility = 'hidden';
    })()`,
  );
  const gameplayClip = await evaluate(
    page,
    `(() => {
      const rect = document.querySelector('.game-frame')?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
        scale: 1,
      };
    })()`,
  );
  assert.ok(gameplayClip !== null);
  const gameplayScreenshot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: gameplayClip,
  });
  await writeFile(
    gameplayScreenshotPath,
    Buffer.from(gameplayScreenshot.data, "base64"),
  );
  await evaluate(
    page,
    `(() => {
      const navigation = document.querySelector('.bottom-nav');
      if (navigation instanceof HTMLElement) navigation.style.removeProperty('visibility');
    })()`,
  );

  await evaluate(
    page,
    "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }))",
  );
  const pausedText = await waitFor(
    async () => {
      const text = await evaluate(
        page,
        "document.querySelector('[data-overlay]')?.textContent",
      );
      return /Paused/.test(text ?? "") ? text : null;
    },
    "pause overlay",
  );
  assert.match(pausedText, /Paused/);

  await evaluate(
    page,
    "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }))",
  );
  const guestResult = await waitFor(
    async () => {
      const result = await evaluate(
        page,
        `(() => {
          const overlay = document.querySelector('[data-overlay]');
          return {
            state: overlay?.dataset.resultState,
            text: overlay?.textContent,
          };
        })()`,
      );
      return result.state === "local" ? result : null;
    },
    "guest replay result",
    200,
  );
  assert.match(guestResult.text ?? "", /Run complete/i);
  const restoredShell = await evaluate(
    page,
    `(() => ({
      immersive: document.body.classList.contains('game-immersive'),
      detailsDisplay: getComputedStyle(document.querySelector('.details-panel')).display,
      navigationDisplay: getComputedStyle(document.querySelector('.bottom-nav')).display,
    }))()`,
  );
  assert.equal(restoredShell.immersive, false);
  assert.notEqual(restoredShell.detailsDisplay, "none");
  assert.notEqual(restoredShell.navigationDisplay, "none");

  const screenshot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  await evaluate(
    page,
    "document.querySelector('a[data-route=\"/leaderboard\"]')?.click()",
  );
  await waitFor(
    async () => (await evaluate(page, "location.pathname")) === "/leaderboard",
    "leaderboard screenshot route",
  );
  const leaderboardClip = await evaluate(
    page,
    `(() => {
      const rect = document.querySelector('.leaderboard-section')?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: 0,
        y: rect.top + window.scrollY,
        width: window.innerWidth,
        height: Math.min(844, Math.ceil(rect.height)),
        scale: 1,
      };
    })()`,
  );
  assert.ok(leaderboardClip !== null);
  const leaderboardScreenshot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: leaderboardClip,
  });
  await writeFile(
    leaderboardScreenshotPath,
    Buffer.from(leaderboardScreenshot.data, "base64"),
  );
  await evaluate(
    page,
    "document.querySelector('a[data-route=\"/tournaments\"]')?.click()",
  );
  await waitFor(
    async () => (await evaluate(page, "location.pathname")) === "/tournaments",
    "tournament screenshot route",
  );
  const tournamentClip = await evaluate(
    page,
    `(() => {
      const rect = document.querySelector('.tournament-section')?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: 0,
        y: rect.top + window.scrollY,
        width: window.innerWidth,
        height: Math.min(844, Math.ceil(rect.height)),
        scale: 1,
      };
    })()`,
  );
  assert.ok(tournamentClip !== null);
  const tournamentScreenshot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: tournamentClip,
  });
  await writeFile(
    tournamentScreenshotPath,
    Buffer.from(tournamentScreenshot.data, "base64"),
  );

  await evaluate(
    page,
    "document.querySelector('a[data-route=\"/dashboard\"]')?.click()",
  );
  await waitFor(
    async () => (await evaluate(page, "location.pathname")) === "/dashboard",
    "dashboard history entry",
  );
  const dashboardScreenshot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(
    dashboardScreenshotPath,
    Buffer.from(dashboardScreenshot.data, "base64"),
  );
  await evaluate(
    page,
    "document.querySelector('a[data-route=\"/profile\"]')?.click()",
  );
  await waitFor(
    async () => (await evaluate(page, "location.pathname")) === "/profile",
    "profile history entry",
  );
  await evaluate(page, "history.back()");
  const backState = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          pathname: location.pathname,
          screen: document.querySelector('[data-screen]:not([hidden])')?.getAttribute('data-screen'),
          heading: document.activeElement?.id,
        }))()`,
      );
      return state.pathname === "/dashboard" && state.heading === "dashboard-title"
        ? state
        : null;
    },
    "browser back navigation",
  );
  assert.equal(backState.screen, "/dashboard");
  await evaluate(page, "history.forward()");
  const forwardState = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          pathname: location.pathname,
          screen: document.querySelector('[data-screen]:not([hidden])')?.getAttribute('data-screen'),
          heading: document.activeElement?.id,
        }))()`,
      );
      return state.pathname === "/profile" && state.heading === "profile-title"
        ? state
        : null;
    },
    "browser forward navigation",
  );
  assert.equal(forwardState.screen, "/profile");

  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const routeLayoutChecks = [];
  for (const route of [
    "/",
    "/play",
    "/dashboard",
    "/tournaments",
    "/leaderboard",
    "/profile",
    "/how-it-works",
    "/settings",
  ]) {
    await evaluate(
      page,
      `document.querySelector('a[data-route="${route}"]')?.click()`,
    );
    const layout = await waitFor(
      async () => {
        const state = await evaluate(
          page,
          `(() => {
            const activeScreen = document.querySelector('[data-screen]:not([hidden])');
            const touchTargets = [...document.querySelectorAll('.bottom-nav a')]
              .map((element) => Math.round(element.getBoundingClientRect().height));
            return {
              pathname: location.pathname,
              screen: activeScreen?.getAttribute('data-screen'),
              title: document.title,
              focusedHeading: activeScreen?.querySelector('[data-route-heading]') === document.activeElement,
              scrollWidth: document.documentElement.scrollWidth,
              viewportWidth: window.innerWidth,
              touchTargets,
            };
          })()`,
        );
        return state.pathname === route && state.focusedHeading ? state : null;
      },
      `320 px route ${route}`,
    );
    assert.equal(layout.screen, route);
    assert.ok(layout.scrollWidth <= layout.viewportWidth);
    assert.ok(layout.touchTargets.every((height) => height >= 44));
    routeLayoutChecks.push({ route, title: layout.title });
  }

  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate(
    page,
    "document.querySelector('a[data-route=\"/play\"]')?.click()",
  );
  await waitFor(
    async () => (await evaluate(page, "location.pathname")) === "/play",
    "NEAR Connect probe play route",
  );
  await evaluate(
    page,
    "document.querySelector('[data-action=\"open-auth\"]')?.click()",
  );
  await waitFor(
    async () =>
      (await evaluate(
        page,
        "document.querySelector('[data-auth-dialog]')?.open === true",
      )) === true,
    "NEAR Connect probe authentication dialog",
  );
  await evaluate(
    page,
    "document.querySelector('[data-auth=\"wallet\"]')?.click()",
  );
  await waitFor(
    async () =>
      (await evaluate(
        page,
        "document.querySelector('.hot-connector-popup .modal-container') !== null",
      )) === true,
    "NEAR Connect probe wallet chooser",
  );
  await evaluate(
    page,
    "document.querySelector('.hot-connector-popup [data-type=\"meteor-wallet\"]')?.click()",
  );
  let connectorConnection;
  try {
    connectorConnection = await waitFor(
      async () => {
        const state = await evaluate(
          page,
          `(() => ({
            connectCalls: window.__nearConnectProbe?.connectCalls,
            connectResolved: window.__nearConnectProbe?.connectResolved,
            signMessageCalls: window.__nearConnectProbe?.signMessageCalls,
            account: document.querySelector('[data-identity-account]')?.textContent?.trim(),
            status: document.querySelector('[data-status]')?.textContent?.trim(),
            selectedWallet: localStorage.getItem('selected-wallet'),
            authorization: localStorage.getItem('near-arcade:wallet-authorization:v3'),
            authDialogOpen: document.querySelector('[data-auth-dialog]')?.open === true,
          }))()`,
        );
      return state.connectResolved >= 1 && state.signMessageCalls === 0 &&
        state.selectedWallet === "meteor-wallet" &&
          /connected on Testnet/i.test(state.status ?? "")
          ? state
          : null;
      },
      "NEAR Connect mocked connection",
      300,
    );
  } catch (error) {
    console.error(
      "NEAR Connect state:",
      await evaluate(
        page,
        `(() => ({
          probe: window.__nearConnectProbe,
          status: document.querySelector('[data-status]')?.textContent?.trim(),
          selectedWallet: localStorage.getItem('selected-wallet'),
          authorization: localStorage.getItem('near-arcade:wallet-authorization:v3'),
          authDialogOpen: document.querySelector('[data-auth-dialog]')?.open === true,
        }))()`,
      ),
    );
    throw error;
  }
  await evaluate(
    page,
    "document.querySelector('[data-action=\"start\"], [data-action=\"restart\"]')?.click()",
  );
  const connectorTransactionAuthorization = await waitFor(
    async () => {
      const state = await evaluate(
        page,
        `(() => ({
          signDelegateCalls: window.__nearConnectProbe?.signDelegateCalls,
          lastDelegate: window.__nearConnectProbe?.lastDelegate,
          status: document.querySelector('[data-status]')?.textContent?.trim(),
          overlay: document.querySelector('[data-overlay]')?.textContent?.trim(),
        }))()`,
      );
      return state.signDelegateCalls === 1 &&
        /Headless wallet rejected delegated transaction signing/i.test(
          `${state.status ?? ""} ${state.overlay ?? ""}`,
        )
        ? state
        : null;
    },
    "NEAR Connect mocked transaction authorization",
    300,
  );
  assert.deepEqual(browserErrors, []);

  console.log(
    JSON.stringify(
      {
        status,
        bootRecovery: {
          failure: bootFailure.status,
          guestRoute: guestFallback.visibleScreen,
          automatic: automaticRecovery.status,
        },
        deepLink: deepLinkState.pathname,
        historyNavigation: {
          back: backState.pathname,
          forward: forwardState.pathname,
        },
        routeLayoutChecks,
        authOptions: authState.options,
        walletDialogHandoff: !authDialogOpenDuringHandoff,
        walletConnectorReady: connectorWallets.open,
        supportedWalletOptions: connectorWallets.count,
        meteorAvailable: connectorWallets.meteorAvailable,
        unsupportedWalletsHidden:
          !connectorWallets.nightlyAvailable &&
          !connectorWallets.intearWalletAvailable,
        nearConnectProbe: {
          messageSigningSkipped: connectorConnection.signMessageCalls === 0,
          account: connectorConnection.account,
          connectCalls: connectorConnection.connectCalls,
          connectResolved: connectorConnection.connectResolved,
          signMessageCalls: connectorConnection.signMessageCalls,
          signDelegateCalls:
            connectorTransactionAuthorization.signDelegateCalls,
          delegatedTransaction: connectorTransactionAuthorization.lastDelegate,
        },
        walletCancellationRecovered:
          walletCancellation.dialogOpen && !walletCancellation.walletDisabled,
        walletStateCleared:
          walletCancellation.rememberedWallet === null &&
          silentRefresh.rememberedWallet === null,
        refreshStayedGuest:
          !silentRefresh.authDialogOpen &&
          !silentRefresh.selectorOpen,
        googleEnabled: !authState.googleDisabled,
        sponsorConfigured: apiHealth.sponsorConfigured,
        tournament: tournamentState.name,
        tournamentStatus: tournamentState.status,
        tournamentReward: tournamentState.reward,
        tournamentRows: tournamentState.rows,
        allTimeLeaderboardRows: allTimeLeaderboard.rows,
        dailyLeaderboardRows: dailyLeaderboard.rows,
        guestSession: guestState.label,
        startCountdown: countdownValues,
        mobileCanvasWidth: guestState.canvasWidth,
        pauseOverlay: true,
        immersiveRun: immersiveState.active,
        shellRestoredAfterRun: !restoredShell.immersive,
        guestResult: guestResult.state,
        accessibility: accessibilityState,
        securityHeaders: {
          api: true,
          web: true,
        },
        browserErrors: browserErrors.length,
        screenshotPath,
        gameplayScreenshotPath,
        dashboardScreenshotPath,
        leaderboardScreenshotPath,
        tournamentScreenshotPath,
      },
      null,
      2,
    ),
  );
} catch (error) {
  for (const child of children) {
    if (child.exitCode === null && child.output?.length) {
      console.error(child.output.join("").slice(-4_000));
    }
  }
  throw error;
} finally {
  page?.close();
  if (browser) {
    await browser.send("Browser.close").catch(() => undefined);
    browser.close();
  }
  await Promise.all(children.map(stopService));
  await rm(profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  }).catch((error) => {
    console.warn(
      `Browser checks passed, but the temporary Chrome profile could not be removed: ${error.message}`,
    );
  });
  await rm(webOutputDirectory, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  }).catch((error) => {
    console.warn(
      `Browser checks passed, but the temporary web build could not be removed: ${error.message}`,
    );
  });
}
