# NEAR Wallet Connection, Authentication & Wallet Capabilities

**Purpose:** Fix wallet login for the NEAR game (wallet sign-in and Google sign-in) and document what NEAR wallet providers expose.
**Sources:** Official NEAR docs (docs.near.org), the `@hot-labs/near-connect` repository, and NEP-413. Links are listed in section 12.
**Docs index for AI tools and humans:** https://docs.near.org/llms.txt

---

## 1. Most likely cause of the failure

NEAR's own docs now carry this warning on the Wallet Login page:

> **Do not use NEAR Wallet Selector (`@near-wallet-selector/*`).** It is deprecated and no longer maintained. Use NEAR Connect (`@hot-labs/near-connect`) to integrate wallets in new and existing apps.

Most older tutorials, blog posts and AI-generated snippets still use `setupWalletSelector`, `setupModal`, and per-wallet packages such as `setupMyNearWallet()`. The old docs pages for those now redirect to the replacements (`/tools/wallet-selector` → `/tools/near-connect`). If your code imports anything from `@near-wallet-selector/*`, migrate first, before debugging anything else.

Also note: Google sign-in is **not** a feature of wallet connectors by itself. Per the NEAR docs, Google/email login on NEAR is done through **Privy** (or Web3Auth), which creates a NEAR wallet for the user. See section 4.

**What the two sign-in types map to:**

| What you called it | What it is in NEAR's docs | Library |
|---|---|---|
| "Decentralized" wallet sign-in | Wallet login (HOT, Meteor, Nightly, Intear, etc.) | `@hot-labs/near-connect` |
| Google sign-in | Social login that creates a NEAR wallet | Privy (`@privy-io/react-auth`) or the `privy-near-connect` plugin |

---

## 2. Choose your architecture

NEAR's Privy page offers two ways to combine these:

| Option | What users get | Choose when |
|---|---|---|
| **A. NEAR Connect only** | Wallet login only | You only need crypto-native users |
| **B. NEAR Connect + Privy plugin** | All NEAR Connect wallets **plus** Google/email login in the same modal | You want both login types behind one `connector` (recommended for this project) |
| **C. Direct Privy only** | Social login only; silent signing, Web2-like UX | You only want Google/email users |

The docs state that B gives "all NEAR Wallets that support NEAR Connect, plus social login with Privy", while C "should be the preferred way for applications that want to abstract away the wallet".

A pragmatic hackathon fallback if B's extra setup (manifest + signing page) is slow: show two buttons, one calling `connector.connect()` (Option A) and one calling Privy's `login()` (Option C), and put both behind one small interface in your app (`signIn`, `signOut`, `accountId`, `sendTransaction`).

---

## 3. NEAR Connect (wallet login)

### 3.1 Install

```bash
npm install @hot-labs/near-connect near-api-js
```

Optional React hooks package (also referenced in the docs): `npm install near-connect-hooks`.

Fastest reference implementation: `npx create-near-app@latest` (the generated frontend is the official working example).

### 3.2 Create the connector

```tsx
import { NearConnector } from "@hot-labs/near-connect";

const connector = new NearConnector({ network: "testnet" }); // or "mainnet"
```

Filter which wallets appear by capability:

```tsx
const connector = new NearConnector({
  network: "testnet",
  features: {
    signMessage: true,           // only wallets that support message signing
    signTransaction: true,
    signInWithoutAddKey: true,
    signAndSendTransaction: true,
    signAndSendTransactions: true,
  },
});
```

**How it works:** wallets register integration scripts in a public manifest. The connector loads them at runtime and runs each wallet's code in an isolated sandboxed iframe. You do not install per-wallet packages.

**Wallets listed in the README:** HOT Wallet, Meteor, Intear, Nightly, Near Mobile, Unity, OKX, NEAR CLI, and any wallet via WalletConnect. NEAR's docs say 10+ wallets are supported.

**WalletConnect:** the README says some wallets only appear if you pass a WalletConnect sign client to the connector (`new NearConnector({ walletConnect })`). Without it those wallets are not offered.

### 3.3 Listen for events, then connect

```tsx
connector.on("wallet:signIn", async ({ wallet, accounts }) => {
  const accountId = accounts[0]?.accountId ?? "";
  // store wallet + accountId in app state
});

connector.on("wallet:signOut", () => {
  // clear app state
});

// Must run from a user click (opens the wallet modal)
const wallet = await connector.connect();
const accounts = await wallet.getAccounts();
```

Sign out:

```tsx
await connector.disconnect(wallet);
```

Restore an existing session on page load and remove listeners on unmount. The official React provider does both. Example provider: `near-examples/hello-near-examples` → `frontend/src/providers/near-provider.tsx`.

The README also documents a combined event, `wallet:signInAndSignMessage`, fired when you sign in and sign a message in one step (`connector.connect({...})` with message-signing options; check the README for the exact option shape before using it).

### 3.4 Call a contract method (state-changing)

```tsx
const wallet = await connector.wallet();

const result = await wallet.signAndSendTransaction({
  receiverId: "your-game.testnet",
  actions: [
    {
      type: "FunctionCall",
      params: {
        methodName: "start_run",
        args: {},
        gas: "30000000000000",          // 30 TGas
        deposit: "100000000000000000000000", // 0.1 NEAR in yoctoNEAR
      },
    },
  ],
});

console.log("Transaction:", result.transaction.hash);
```

### 3.5 Read-only calls and balance

NEAR Connect has **no built-in view calls or balance lookup**. Use `near-api-js`:

```tsx
import { JsonRpcProvider } from "near-api-js";

const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });

const leaderboard = await provider.callFunction({
  contractId: "your-game.testnet",
  method: "get_leaderboard",
  args: { round_id: 1 },
});

const account = await provider.viewAccount({ accountId: "alice.testnet" });
```

### 3.6 Multiple transactions in one prompt

```tsx
const results = await wallet.signAndSendTransactions({
  transactions: [
    { receiverId: "token.near", actions: [ /* FunctionCall ... */ ] },
    { receiverId: "nft.near",   actions: [ /* FunctionCall ... */ ] },
  ],
});
```

Use `deposit: "1"` (1 yoctoNEAR) for `ft_transfer`-style calls, as the docs do.

### 3.7 Sign messages (NEP-413) for authentication

```tsx
const wallet = await connector.wallet();

const signed = await wallet.signMessage({
  message: "Please sign this message to authenticate",
  recipient: "your-app.testnet",
  nonce: Buffer.from(crypto.randomUUID()),
});

console.log(signed.signature, signed.publicKey);
```

Notes:
- NEAR Connect's `signMessage` takes only `message`, `recipient` and `nonce`. Older docs showing `callbackUrl` are from the Wallet Selector era.
- NEP-413 requires the nonce to be **32 bytes**. If your wallet rejects the nonce, generate exactly 32 random bytes (for example `crypto.getRandomValues(new Uint8Array(32))`) instead of a UUID string. This is a standard requirement of the spec and a common failure point.
- `await` the call; the old selector-era examples did not.

### 3.8 Popup-free play with a function-call key (recommended for the game)

Request a function-call access key at login so repeated game calls don't open the wallet each time:

```bash
npm install function-call-key-plugin
```

```tsx
import { createAccessKeyPlugin } from "function-call-key-plugin";
import { nearToYocto } from "near-api-js";

const accessKeyPlugin = createAccessKeyPlugin({
  network: connector.network,
  providers: connector.providers,
  signIn: {
    contractId: "your-game.testnet",
    methodNames: ["submit_score"],              // see warning below
    allowance: nearToYocto("0.25").toString(),  // gas allowance
  },
});

await connector.use(accessKeyPlugin);   // register BEFORE connect()
const wallet = await connector.connect();
```

Behavior stated in the docs:
- The key pair is generated at sign-in and the private key is stored locally after sign-in succeeds.
- Calls within the key's permissions are signed locally; anything else goes to the wallet for approval.
- It falls back to the wallet if the allowance runs out or the key is removed on-chain.
- **Function-call keys permit zero attached deposit.** A method that requires a deposit (like `start_run` with an entry fee) cannot be signed by this key and will always prompt the wallet. Put only deposit-free methods (such as `submit_score`) in `methodNames`.
- The allowance limits gas spend only; the account still pays fees from its balance.

---

## 4. Google sign-in (Privy)

Privy lets users log in with email or social accounts (Google, GitHub, etc.). After login, a NEAR wallet is created for them. Users still need to **fund** that account before they can pay entry fees.

Common setup for both options: create an app at https://dashboard.privy.io, copy the **App ID** (and **Client ID** for Option B), and enable the login methods you want (Google, email) in the dashboard.

> Direct Privy requires Node.js **22.22.2 or newer**, per the docs.

### 4.1 Option C: Direct Privy

```bash
npm install @privy-io/react-auth near-api-js @noble/hashes
```

Wrap the app:

```tsx
import { PrivyProvider } from "@privy-io/react-auth";
import { NEARxPrivy } from "./context/provider";

<PrivyProvider
  appId="YOUR_PRIVY_APP_ID"
  config={{
    appearance: { showWalletLoginFirst: false },
    loginMethods: ["email", "google", "github"],
  }}
>
  <NEARxPrivy>
    <App />
  </NEARxPrivy>
</PrivyProvider>
```

The `NEARxPrivy` context (from the official `near-examples/hello-privy` repo) does three things:
1. Watches `usePrivy()` for an authenticated user.
2. Finds the user's linked wallet where `chainType === "near"`, or creates one with `createWallet({ chainType: "near" })` from `@privy-io/react-auth/extended-chains`.
3. Builds a `near-api-js` `Account` with a custom `privySigner` and exposes `{ provider, nearAccount, walletId }`.

Custom signer (from the docs): a class extending `Signer` from `near-api-js` that implements `getPublicKey()` and `signBytes()`; `signBytes` calls Privy's `signRawHash({ address, chainType: "near", hash })`. Copy it from:
`near-examples/hello-privy` → `src/context/signer.ts` and `src/context/provider.tsx` (these are the maintained versions).

Login/logout buttons:

```tsx
import { useLogin, useLogout, usePrivy } from "@privy-io/react-auth";

const { login } = useLogin();
const { logout } = useLogout();
const { authenticated, user } = usePrivy();
```

Calls:

```tsx
// read-only (no login needed)
await provider.callFunction({ contractId: CONTRACT, method: "get_leaderboard", args: {} });

// state-changing: signed silently by the Privy embedded wallet, no popup
await nearAccount.callFunction({
  contractId: CONTRACT,
  methodName: "start_run",
  args: {},
  // attach a deposit using the option your near-api-js version supports
});

// balance
import { NEAR } from "near-api-js/tokens";
const balance = await nearAccount.getBalance(NEAR);
```

The docs example does not show attaching a deposit to `callFunction`. Check the `Account.callFunction` signature in your installed `near-api-js` version before relying on it for the entry fee.

### 4.2 Option B: Privy exposed through NEAR Connect

```bash
npm install @peerfolio/privy-near-connect @hot-labs/near-connect @radix-ui/themes @radix-ui/react-collapsible @radix-ui/react-icons
```

Environment variables:

```bash
VITE_PRIVY_APP_ID=your-privy-app-id
VITE_PRIVY_APP_CLIENT_ID=your-privy-client-id
```

**Step 1 — `public/manifest.json`** (replace `yourdapp.com` with your real deployed origin):

```json
{
  "version": "1.0.0",
  "wallets": [
    {
      "id": "myprivywallet",
      "name": "My Privy Wallet",
      "icon": "https://yourdapp.com/favicon.ico",
      "description": "Web wallet for NEAR",
      "website": "https://yourdapp.com",
      "version": "1.0.0",
      "executor": "https://raw.githubusercontent.com/beneviolabs/privy-near-connect/3d56b782669d242a1ea432921e291abc26b4ebc7/executor.js",
      "type": "sandbox",
      "platform": { "web": "https://yourdapp.com" },
      "features": {
        "signMessage": true,
        "signInWithoutAddKey": true,
        "signInAndSignMessage": true,
        "signInWithFunctionCallKey": true,
        "signAndSendTransaction": true,
        "signAndSendTransactions": true,
        "mainnet": true,
        "testnet": true
      },
      "permissions": {
        "isPrivyConnect": true,
        "storage": true,
        "allowsOpen": ["https://yourdapp.com"]
      },
      "metadata": { "signPageURL": "https://yourdapp.com/sign" }
    }
  ]
}
```

Keep the `executor` URL pinned to an immutable commit SHA. NEAR Connect fetches and runs that script at runtime.

**Step 2 — the `/sign` route:**

```jsx
import Privy, { LocalStorage } from "@privy-io/js-sdk-core";
import { SignPagePlugin } from "@peerfolio/privy-near-connect/sign-page-plugin";
import "@radix-ui/themes/styles.css";
import "@peerfolio/privy-near-connect/sign-page-plugin/theme.css";

const privy = new Privy({
  appId: import.meta.env.VITE_PRIVY_APP_ID,
  clientId: import.meta.env.VITE_PRIVY_APP_CLIENT_ID,
  storage: new LocalStorage(),
});

export default function SignPage() {
  return (
    <SignPagePlugin
      privy={privy}
      options={{ allowedOrigins: ["https://yourdapp.com"] }}
    />
  );
}
```

`allowedOrigins` controls which dApp origins may send requests to the signing page. Add every origin you use, including `http://localhost:PORT` during development.

**Step 3 — point the connector at your manifest:**

```jsx
const connector = new NearConnector({
  manifest: "/manifest.json",
  network: "testnet",
});
```

The Privy wallet then appears in the same NEAR Connect modal as the other wallets. Everything in section 3 (events, transactions, signing) applies unchanged.

### 4.3 Alternative: Web3Auth

NEAR's docs point to Web3Auth as another social login option, with a working example at `near-examples/hello-web3auth` (a Modal integration that derives a NEAR Ed25519 key from the session, and an MPC Core Kit integration that signs through a custom SDK `Signer`).

---

## 5. Troubleshooting checklist

Items 1–4 come straight from the docs. Items 5–10 are common causes in this kind of setup and are things to check, not confirmed diagnoses of your project.

1. **Remove every `@near-wallet-selector/*` import** and migrate to `@hot-labs/near-connect`.
2. **Network match:** `network: "testnet"` in the connector, the RPC URL, the contract ID suffix (`.testnet`), and the wallet's selected network should all agree.
3. **Google login needs Privy.** NEAR Connect alone will not show a Google option. Use Option B or C.
4. **`connect()` must come from a user click.** Calling it on page load can be blocked by the browser.
5. **Server-side rendering (Next.js):** create `NearConnector` only in the browser (inside `useEffect`, or a dynamically imported component with SSR disabled). It needs `window`.
6. **Privy dashboard:** confirm Google is enabled as a login method and your site's origin (including `localhost` and your deployed domain) is allowed in the Privy app settings.
7. **Option B specifics:** `manifest.json` must be served at the path you pass to `manifest`, the `/sign` route must be publicly reachable, and the manifest's URLs and `allowedOrigins` must match the exact origin you are testing from.
8. **Privy "no NEAR wallet" state:** in Option C, a user can be authenticated but have no NEAR wallet yet; the provider must call `createWallet({ chainType: "near" })`. Wait for `walletId` before enabling the play button.
9. **Unfunded account:** a freshly created Privy account has no NEAR. Transactions and entry fees fail until it is funded. Show the address and a "fund your account" prompt, or sponsor gas.
10. **Extensions, iframes and ad blockers:** NEAR Connect runs wallet code in sandboxed iframes. Strict content blockers or CSP headers (`frame-src`, `script-src`) can break this. Test in a clean browser profile and check the browser console.

Also check the console for the exact error string. If it mentions the manifest, the executor, or an origin, it points to items 6–7.

---

## 6. Using wallet auth with your game backend (NEP-413)

Use this so your verifier service knows which NEAR account is playing, without passwords.

**Flow:**
1. Backend creates a random challenge (32-byte nonce) and stores it with an expiry.
2. Frontend asks the wallet to sign it with `wallet.signMessage({ message, recipient, nonce })`.
3. Frontend sends `{ accountId, publicKey, signature, message, nonce, recipient }` to the backend.
4. Backend verifies the signature and that the public key belongs to the account.

**What the backend must check (from NEP-413 and the NEAR backend-auth guide):**
- Rebuild the exact payload that was signed: `tag = 2147484061` (2³¹ + 413), then `message`, `nonce` (32 bytes), `recipient`, and optional `callbackUrl`. Borsh-serialize it and **SHA-256** hash it.
- Verify the ed25519 signature (base64-decoded) against the claimed public key.
- Confirm the public key is a **full-access key** of `accountId` by querying the account's access keys over RPC (`view_access_key_list`). A function-call key must not authenticate a user.
- Confirm the `recipient` equals your app, the nonce was issued by you, has not expired, and has not been used before.
- Treat a Privy-created account the same way for access-key checks if you plan to use NEP-413 with it; otherwise authenticate Privy users by verifying the Privy auth token on your backend instead (see Privy's server docs).

**Sketch (Node.js; adapt and test against the NEP before production):**

```ts
import * as borsh from "borsh";
import { createHash } from "node:crypto";
import { PublicKey } from "near-api-js/utils"; // import path may differ by near-api-js version

const schema = {
  struct: {
    tag: "u32",
    message: "string",
    nonce: { array: { type: "u8", len: 32 } },
    recipient: "string",
    callbackUrl: { option: "string" },
  },
};

export function verifyNep413({ message, nonce, recipient, publicKey, signature }) {
  const payload = borsh.serialize(schema, {
    tag: 2147484061,
    message,
    nonce: Array.from(nonce),     // Buffer of exactly 32 bytes
    recipient,
    callbackUrl: null,
  });
  const hash = createHash("sha256").update(payload).digest();
  return PublicKey.from(publicKey).verify(hash, Buffer.from(signature, "base64"));
}
```

Then query the RPC for the account's access keys and confirm `publicKey` is listed with full-access permission.

---

## 7. What wallet providers expose

### 7.1 Wallet object (returned by `connect()` / `connector.wallet()`)

| Capability | Method | Notes |
|---|---|---|
| List accounts | `wallet.getAccounts()` | Returns accounts; first entry has `accountId` |
| Sign and send one transaction | `wallet.signAndSendTransaction({ receiverId, actions })` | Result includes `transaction.hash` |
| Sign and send several | `wallet.signAndSendTransactions({ transactions })` | One prompt for multiple transactions |
| Sign a message (NEP-413) | `wallet.signMessage({ message, recipient, nonce })` | Returns `signature`, `publicKey` |
| Sign out | `connector.disconnect(wallet)` | |

The README states the wallet API follows the old `near-wallet-selector` shape, and that actions in the selector format (FunctionCall, Transfer, AddKey, and others) are accepted for backward compatibility.

### 7.2 Capability flags (feature filtering and manifests)

`signMessage`, `signTransaction`, `signInWithoutAddKey`, `signInAndSignMessage`, `signInWithFunctionCallKey`, `signAndSendTransaction`, `signAndSendTransactions`, `mainnet`, `testnet`. Use `features` in the connector config to show only wallets that support what your app needs.

### 7.3 Connector events

- `wallet:signIn` — payload includes `wallet` and `accounts`
- `wallet:signOut`
- `wallet:signInAndSignMessage` — sign-in combined with message signing

### 7.4 Things wallets do **not** give you

- No built-in view calls or balance query (use `near-api-js` `JsonRpcProvider`).
- Function-call keys cannot attach deposits.
- Not every wallet supports every feature (hence the `features` filter).

### 7.5 Other documented extras

- **EVM wallets on NEAR:** the Wallet Login page describes enabling Ethereum wallets by registering the `evm-on-near` wallet manifest (`connector.registerWallet(...)`). See the page for the exact code.
- **Adding your own wallet:** wallet developers publish an executor script plus manifest entry; after review it becomes available to all NEAR Connect dApps (README, "Wallet integration").
- **NEAR Auth / Chain Signatures:** NEAR's wiki also describes Web2-identity signing (Google, Apple, email, passkeys) and Chain Signatures for multi-chain signing. These are beyond what you need for the wallet-connection fix; consider Chain Signatures only as a stretch feature.

---

## 8. Recommended implementation for the game

1. Use **Option B** (NEAR Connect + Privy plugin) if you want both login types in one modal; otherwise Option A plus a separate Privy button.
2. Wrap everything in one React provider exposing `{ accountId, signIn, signOut, callContract, signMessage, isReady }`.
3. Use `JsonRpcProvider` for all view calls (leaderboard, rounds, claimable balances).
4. Register `function-call-key-plugin` for deposit-free methods (`submit_score`, `claim_prize` if it needs no deposit). Keep `start_run` as a normal wallet-signed call because it carries the entry fee.
5. Authenticate with your verifier backend using NEP-413 for wallet users, and the Privy auth token for Google users.
6. Show the connected `accountId`, balance, and a funding prompt for new social-login accounts.

---

## 9. Minimal test plan

- Connect and disconnect with one extension wallet and one mobile/web wallet.
- Refresh the page and confirm the session restores.
- Switch networks and confirm the app shows a clear mismatch error.
- Google login: new user gets a NEAR wallet created; returning user reuses it.
- Send a transaction with a deposit (`start_run`) and one deposit-free call (`submit_score`) and verify which ones prompt.
- Sign a NEP-413 message and verify it on your backend, including a replayed nonce being rejected.
- Remove the function-call key on-chain and confirm the app falls back to the wallet prompt.

---

## 10. Open decisions

1. Option B (one modal) or separate buttons (A + C)?
2. Will Google users be sponsored gas/funds, or required to fund their own account?
3. Testnet only for the hackathon demo, or mainnet?
4. Do you need NEP-413 backend sessions, or is on-chain signing alone enough for your verifier?

---

## 11. Version notes

NEAR's wallet tooling changed recently, so check the docs page before copying any snippet. In particular, the `near-connect-hooks` snippet on the Wallet Login page destructures `signNEP413Message` but then calls `signMessage`; treat that as a docs typo and check the package's types. `near-api-js` APIs (`callFunction`, `viewAccount`, `Account`, `Signer`) are also from the newer API style; older tutorials use `connect()`, `keyStores` and `account.functionCall`.

---

## 12. Exact docs to follow

- Wallet Login (NEAR Connect): https://docs.near.org/web3-apps/tutorials/wallet-login
- Privy / social login: https://docs.near.org/web3-apps/tutorials/social-login
- Web login concepts (overview of all options): https://docs.near.org/web3-apps/concepts/web-login
- NEAR Connect tool page: https://docs.near.org/tools/near-connect
- Backend authentication: https://docs.near.org/web3-apps/backend/backend
- NEP-413 standard: https://github.com/near/NEPs/blob/master/neps/nep-0413.md
- NEAR Connect repository: https://github.com/azbang/near-connect (also published as `@hot-labs/near-connect`)
- Official working examples: https://github.com/near-examples/hello-near-examples, https://github.com/near-examples/hello-privy, https://github.com/near-examples/hello-web3auth
- Privy-to-NEAR-Connect plugin: https://github.com/beneviolabs/privy-near-connect
- React hooks (optional): https://github.com/matiasbenary/near-connect-hooks
- Privy dashboard: https://dashboard.privy.io
