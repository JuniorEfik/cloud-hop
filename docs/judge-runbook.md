# Judge runbook

This runbook offers a public, no-secret inspection path and a controlled full
write path. Node.js 22+ and Google Chrome are required.

## Five-minute public review

1. Install the pinned workspace:

   ```bash
   npm install
   ```

2. Create a local public configuration without adding any private key:

   ```bash
   install -m 600 .env.example .env
   ```

3. Start the API and web app, then open `http://127.0.0.1:3000`:

   ```bash
   npm run dev
   ```

4. Play a guest run. Use Space, Arrow Up, click, or tap to flap; use P or
   Escape to pause. The result must say that the replay reproduced locally and
   must not claim an on-chain score.
5. Inspect the live weekly tournament, all-time and daily rankings, contract
   link, and deployment link. With no server secrets, Google creation and score
   attestation are intentionally disabled while public chain reads continue to
   work.
6. Run the non-mutating automated browser journey:

   ```bash
   npm run smoke:web
   ```

The browser smoke starts isolated local services and Chrome, verifies the 390 px
layout, accessibility semantics, headers, tournament/ranking reads, guest
replay, pause behavior, and zero browser errors, then removes its temporary
profile.

## Public Testnet evidence

- Contract: <https://testnet.nearblocks.io/address/near-arcade-contract-bf1dd35d6d.testnet>
- Current tournament: `weekly-togg5u`
- Final deployment proof: <https://testnet.nearblocks.io/txns/w6gJ49iRcrqbtm6z8FYnaAV3s1qKoRWYp3jWXnN8nQo>
- Accelerated finalized lifecycle: <https://testnet.nearblocks.io/txns/AgfWNn7DRhRPcnEkz2iQmZViQnmHa3WHnoKbFbKm3cE6>
- Frozen accelerated result hash:
  `dfde5b1c089a56d3f255040ad9be524fbedef3c3705394d417e86c3fd5be756f`

The machine-readable versions are in
[`deployment.testnet.json`](../deployment.testnet.json).

## Interactive player journey

On the configured demo environment:

1. Select **Connect account**.
2. Choose an existing NEAR Testnet wallet, or choose Google to create a bounded
   sponsor-funded Testnet wallet on that device.
3. Join the free weekly tournament and open the registration transaction link.
4. Start a run and approve the 0.005 NEAR session transaction.
5. Finish the run. The UI first shows local reproduction, then verifier
   pending, wallet pending, and confirmed states.
6. Open the score transaction, confirm the player/session/score record, and
   verify that the leaderboard/profile/badge views refresh.

No transaction is requested for each flap. Only registration, session creation,
and accepted-score recording are player-signed writes.

## Controlled full acceptance

The complete automated write journey needs the protected contract account and
configured verifier key in `.env`. In that controlled environment run:

```bash
npm run acceptance
```

This runs type checks, 49+ tests, all builds, the frontend secret scan,
dependency integrity, a high-severity production audit, the single-port release
server, headless Chrome, and a fresh Testnet session/score/tournament
reconciliation. It also proves modified score, duplicate score, and duplicate
registration rejection.

For a public source review without those keys:

```bash
ACCEPTANCE_SKIP_LIVE=1 npm run acceptance
```

The accelerated lifecycle command is intentionally separate because it creates
an isolated demo tournament and waits for its immutable close:

```bash
npm run smoke:tournament-demo
```

The already-finalized proof above should normally be inspected instead of
creating another one during judging.

## Expected limitations

- no Mainnet deployment;
- no token/NFT reward or paid entry;
- centralized replay verifier, disclosed throughout the UI/docs;
- public seeds and no bot/human-attestation claim;
- Google wallets currently restore only on the original enrolled browser;
- top-100 bounded rankings rather than an unbounded historical index.
