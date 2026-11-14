# Batch 4 profile and leaderboard operations

## Canonical profile state

Each accepted score updates one per-player, per-game statistics record with:

- total accepted runs;
- personal best and its session, replay hash, ruleset, timestamp, and block;
- latest accepted score and equivalent metadata.

Every accepted run increments the total and latest values. A personal best is
replaced only when the new leaderboard entry sorts ahead of the existing one.
Profile counters begin with results accepted after the Batch 4 contract upgrade;
the isolated Batch 3 smoke-test record was not silently rewritten or backfilled.

## Ranking rules

The contract maintains two bounded boards for `cloud-hop`:

- `all`: all-time top 100;
- `daily`: the current chain-timestamp UTC day top 100.

Each board contains at most one row per NEAR account. Sorting is deterministic:

1. higher score;
2. earlier on-chain acceptance timestamp;
3. lexicographically lower session ID;
4. lexicographically lower account ID.

Lower or later equal-score runs still increment player statistics but cannot
replace that player's better leaderboard row. The daily board uses one rolling
storage key and is replaced when the chain day changes, preventing unbounded
daily-period storage growth.

## Public reads

The frontend uses these API routes:

```text
GET /api/v1/players/:accountId/stats
GET /api/v1/leaderboards/:gameId?period=all|daily&cursor=0&limit=10
```

The API validates parameters, calls final contract views, validates returned
shapes, and adds NEAR explorer account and acceptance-block links. Contract page
sizes are capped at 25 and absolute ranks are preserved across cursors.

The contract cannot read the originating transaction hash from its execution
environment. The just-confirmed result screen therefore keeps the exact
transaction link returned to the wallet, while later profile/leaderboard reads
link to the authoritative acceptance block and player account. Adding exact
historical transaction links would require an indexer; Batch 4 deliberately
avoids one while direct views remain sufficient.

## Storage and scale boundary

All-time and daily boards are capped at 100 rows and updated transactionally
with the score record. The separately funded Testnet contract currently
subsidizes this bounded ranking/profile storage from its balance. Before a
production launch, storage charging and sustained full-board gas usage should be
re-measured under realistic volume.

An indexer becomes appropriate when the product needs historical periods, more
than the bounded top 100, exact historical transaction lookup, filtering, or
high-volume reads. Any such projection must remain rebuildable from accepted
contract records/events.

## Verification

```bash
npm run deploy:testnet
npm run smoke:testnet
npm run smoke:web
npm run check
```

The live smoke run creates a controlled score-1 replay and confirms that the
score record, accepted-run count, personal best, all-time row, and current daily
row agree, while duplicate score submission remains rejected.
