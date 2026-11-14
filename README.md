# NEAR Arcade

NEAR Arcade is a wallet-enabled arcade mini-app. The first original game,
**Cloud Hop**, is a one-button obstacle game backed by a deterministic,
replayable simulation.

The implementation follows [`outline.md`](./outline.md) in deliberately small
batches. The browser owns responsive gameplay while NEAR records sessions,
replay-verified results, player statistics, public rankings, weekly tournaments,
and non-transferable achievements.

## Current batch

Batch 6 completes the judge-ready Testnet delivery:

- explicit loading, empty, error, pending, retry, and confirmed states;
- three-step onboarding, keyboard-operated ranking tabs, semantic tables, skip
  navigation, Canvas instructions, reduced-motion support, and mobile QA;
- session, registration, score, account, block, contract, deployment, and
  tournament explorer proofs;
- browser/API security headers plus documented architecture, trust boundaries,
  security findings, judging steps, and submission claims;
- one command for the final local/live acceptance sequence.

There is no token reward, NFT, wager, or paid entry. Tournaments explicitly
store `rewardType: "none"`; recognition is limited to rankings and
non-transferable badges. Direct contract views remain sufficient for the
bounded MVP, so no indexer is required yet.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Use Space, Arrow Up, click, or tap to flap. Press
`P` or Escape to pause.

`npm run dev` starts both the API and web app. Guest play works without any
wallet configuration.

For a single-origin production build suitable for a Node host:

```bash
npm run build:production
npm start
```

See [`docs/deployment.md`](./docs/deployment.md) and the included Render
blueprint for host configuration.

## Testnet setup

For a fresh Testnet deployment:

```bash
npm run provision:testnet
npm run provision:relayer
npm run deploy:testnet
```

The provisioning commands create separate faucet-funded sponsor and gas-relayer
accounts plus a verifier key, saving their credentials only in the ignored
`.env` file with owner-only permissions. Deployment uses another faucet-funded
account for contract storage and code.

Never expose `NEAR_SPONSOR_PRIVATE_KEY`, `NEAR_CONTRACT_PRIVATE_KEY`, or
`NEAR_RELAYER_PRIVATE_KEY` or `NEAR_VERIFIER_PRIVATE_KEY` through a public
environment variable or frontend build setting.

Meteor and Google players sign bounded delegated actions. The server verifies
the sender, signature, nonce, expiry, receiver, method, arguments, gas, and
deposit before the dedicated relayer pays the Testnet gas and token costs.

Google-created wallets retain a scoped device key in browser storage. Returning
on the same browser is supported; enrolling a second device is intentionally not
enabled yet, so players should keep access to the original browser during the
current Testnet pilot.

The public deployment coordinates and immutable proof links are recorded in
[`deployment.testnet.json`](./deployment.testnet.json). The active contract is
[`near-arcade-contract-bf1dd35d6d.testnet`](https://testnet.nearblocks.io/address/near-arcade-contract-bf1dd35d6d.testnet).

## Verify

```bash
npm run check
npm run smoke:web
npm run smoke:production
npm run smoke:testnet
npm run smoke:tournament-demo
npm run acceptance
```

`npm run acceptance` includes a live Testnet write and therefore requires the
controlled `.env`. Public reviewers can run the non-mutating path with
`ACCEPTANCE_SKIP_LIVE=1 npm run acceptance`.

Start with the [`judge runbook`](./docs/judge-runbook.md). The system design,
claims, and release review are documented in
[`architecture.md`](./docs/architecture.md),
[`trust-model.md`](./docs/trust-model.md), and
[`security-review.md`](./docs/security-review.md). Tournament lifecycle and
achievement policy remain in
[`docs/batch-5-operations.md`](./docs/batch-5-operations.md).

## Completed batches

1. Deterministic playable prototype.
2. NEAR wallet connection and contract session foundation.
3. Independent replay verifier and accepted on-chain score records.
4. Player profiles and canonical leaderboards.
5. Tournaments, achievements, and optional funded rewards.
6. Accessibility, security review, deployment evidence, demo, and judge polish.

See [`CHANGES.log`](./CHANGES.log) for the append-only implementation record.
