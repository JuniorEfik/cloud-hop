# Architecture

NEAR Arcade keeps real-time play in the browser and uses NEAR Testnet for
identity-bound sessions, accepted results, rankings, tournaments, and
achievements. The boundary is deliberate: no flap or animation frame requires
a blockchain transaction.

## Runtime map

```text
                         public final-state reads
Browser UI  ───────────────► API ───────────────► FastNEAR RPC
   │                         │                       │
   │ deterministic replay   │ verify + attest       │
   └────────────────────────►│                       ▼
   │                                             Arcade contract
   │ player-signed delegated action                  ▲
   └──────────────► bounded gas relayer ─────────────┘

Google sign-in ─► Auth0/FastAuth ─► sponsored account + delegated signing
Meteor wallet ─► NEAR Connect ─► signed delegate ─► relayer-paid transaction
```

## Components

| Component | Responsibility | Authority |
| --- | --- | --- |
| `packages/game-core` | Fixed 60 Hz simulation, seeded obstacles, replay format, canonical serialization, replay execution | Derives gameplay outcome only |
| `apps/web` | Canvas rendering, input capture, wallet UX, transaction prompts, public read UI | Cannot authorize a score by itself |
| `apps/api` | Public contract reads, Google-wallet sponsorship, bounded Meteor relay, replay verification, short-lived score attestations | Can pay approved transaction costs but cannot create a valid player action |
| `contracts/arcade` | Game registry, one-time sessions, score records, profiles, leaderboards, tournaments, achievements, authorization | Canonical Testnet state |
| NEAR wallet / FastAuth wallet | Signs player actions | Controls only its account and sessions |

## Verified-score sequence

1. A connected Meteor or Google player signs a delegated `create_session`; the
   bounded relayer pays gas and the exact 0.005 NEAR deposit. For Google, the
   browser obtains an approved FastAuth JWT for the exact delegate, and the
   relayer submits the FastAuth signing call with its required 1 yoctoNEAR.
2. The contract binds a unique session, ruleset, seed, expiry, player, and
   optional active tournament.
3. The browser runs `cloud-hop-v1` locally and stores flap ticks.
4. The browser sends the completed canonical replay to the verifier API.
5. The verifier loads final on-chain session state, enforces bounds, replays the
   inputs independently, and signs a domain-separated, short-lived attestation.
6. The same player signs a delegated `submit_verified_score` with that
   attestation; the relayer validates and submits it.
7. The contract checks caller, session state, verifier key, signature domain,
   expiry, score, and one-time use before updating records and bounded rankings.

The verifier key is not a NEAR transaction key. A verifier cannot write a score
without the session owner's signature, and a player cannot invent a score
without the configured verifier's signature.

## Storage and read model

The contract stores sessions and accepted score records canonically. It also
maintains bounded views suitable for the hackathon cohort:

- one profile and personal best per player/game;
- top-100 all-time, UTC-daily, and tournament rankings;
- one entry per registered player/tournament;
- up to 256 deterministic, account-bound achievements per player.

The API validates parameters and shapes these final contract views for the web
app. It is not an indexer and does not override chain state. A production system
with more than 100 ranked players would add an indexer for complete history.

## Deployment

Public Testnet coordinates and proof hashes are versioned in
[`deployment.testnet.json`](../deployment.testnet.json). Server secrets remain
only in `.env`, which is ignored and held with mode `0600` in the controlled
environment.

Production mode serves the built web app and API from one Node.js origin. The
host must preserve the documented security headers, terminate HTTPS, add HSTS,
and keep the sponsor, relayer, and verifier keys server-side. Host steps are in
[`deployment.md`](./deployment.md).
