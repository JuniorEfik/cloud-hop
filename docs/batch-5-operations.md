# Batch 5 tournament and achievement operations

## Weekly tournament lifecycle

The contract permits one current tournament per game. A tournament is created
by the owner or configured tournament operator with an immutable game, ruleset,
start timestamp, registration deadline, participant cap, and reward disclosure.
Its end timestamp is always exactly seven days after its start.

The visible status is derived from the final chain timestamp:

- `scheduled`: before the fixed start;
- `active`: from the start until the end;
- `closed`: after the end and before operator finalization;
- `finalized`: the bounded result set and podium are frozen.

Registration is explicit, free, limited to 500 accounts, and accepted only
before the configured deadline and tournament end. Duplicate registration is
rejected. A registered player may create a tournament session only while the
tournament is active and only for its fixed game and ruleset. The session stores
the tournament ID and its expiry is capped at the tournament end, so an
attestation cannot turn a late run into an eligible score.

The deployment script retains an existing scheduled or active tournament. When
the current tournament is closed it finalizes it, then schedules the next week.
The Testnet deployment currently uses tournament `weekly-togg5u`.

For time-bounded hackathon verification, the owner may also create an
accelerated `demo` tournament only on a dedicated `-demo` game namespace. Its
immutable duration is restricted to 3-60 minutes, it remains free with
`rewardType: "none"`, and it cannot replace or shorten the player-facing weekly
tournament. This mode exists to prove the same close/finalize/rewrite guards
before a submission deadline.

## Ranking and finalization

Each accepted tournament score updates one entry per registered player and a
bounded top-100 board. Ordering is identical to the public leaderboard:

1. higher score;
2. earlier acceptance timestamp;
3. lower session ID;
4. lower account ID.

Lower reruns increment the player's eligible-run count without replacing their
better row. Finalization is operator-controlled and cannot occur before the
fixed end. It hashes a domain-separated canonical serialization of the
tournament identity, ruleset, window, and ordered top-100 rows, records the row
count, and freezes the top three as the podium. A finalized record cannot be
finalized or rewritten again.

This bounded result is suitable for the hackathon cohort. It is not a complete
history once more than 100 distinct players submit eligible scores; accepted
session and score records remain canonical, and an indexer would be required to
reconstruct a larger historical ranking.

## Non-transferable achievements

Achievements are account-bound contract records with no transfer or arbitrary
mint method. Deterministic IDs prevent duplicate issuance. The first release
awards:

- first replay-verified run;
- first personal best;
- verified score milestones at 1, 5, 10, 25, 50, and 100;
- first eligible score in each tournament;
- final tournament podium rank.

Each player is capped at 256 records, and reads are paginated at 25 records.
Once the cap is reached, later badge issuance is skipped rather than blocking a
canonical score or tournament finalization.
Existing players whose profile predates Batch 5 begin receiving milestone and
tournament achievements on new accepted runs; historical records are not
silently backfilled.

## Reward scope

Batch 5 has no token, NFT, wager, paid entry, prize pool, or claimable financial
reward. Every tournament stores `rewardType: "none"` and the UI states “No token
reward.” Recognition consists only of the on-chain ranking and non-transferable
badges. A funded asset and separately tested claim path are required before any
financial reward can be advertised.

## Public reads and wallet changes

The frontend uses final contract views through these validated API routes:

```text
GET /api/v1/tournaments/current?gameId=cloud-hop
GET /api/v1/tournaments/:tournamentId
GET /api/v1/tournaments/:tournamentId/entries/:accountId
GET /api/v1/tournaments/:tournamentId/leaderboard?cursor=0&limit=10
GET /api/v1/players/:accountId/achievements?cursor=0&limit=25
```

Registration and session creation remain player-signed transactions. Both an
existing NEAR wallet and a Google-created FastAuth wallet can call
`join_tournament`; once registered, active-game sessions automatically include
the current tournament ID.

## Verification

```bash
npm run check
npm run deploy:testnet
npm run smoke:testnet
npm run smoke:tournament-demo
npm run smoke:web
```

The live smoke registers the contract test account, rejects a duplicate join,
creates a tournament-bound session, independently reproduces a controlled
score-1 replay, records it, reconciles the tournament entry and rank, confirms
the milestone and participation badges, and retains the modified-score and
duplicate-result rejection checks. Re-running it also confirms deterministic
achievement IDs do not create duplicate badges.

`npm run smoke:tournament-demo` runs the identical lifecycle in the isolated
`cloud-hop-demo` namespace, waits for its immutable five-minute close, rejects a
late session, finalizes the on-chain ranking and podium, and rejects a rewrite.
The production weekly window is never shortened; deployment automation will
finalize it only after its real seven-day end.
