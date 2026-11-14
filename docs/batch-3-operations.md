# Batch 3 replay-verifier operations

## Result flow

1. The player's wallet creates an on-chain session before gameplay.
2. The browser records flap ticks and emits the canonical version-1 replay.
3. `POST /api/v1/runs/:sessionId/replay` receives at most 16 KiB.
4. The API loads the final session and ruleset directly from NEAR RPC.
5. The verifier checks ownership, active status, expiry, seed commitment,
   ruleset hash, replay bounds, elapsed-time feasibility, terminal state, and
   the independently computed score.
6. The API hashes the canonical replay bytes and signs a short-lived score
   attestation with the server-only secp256k1 verifier key.
7. The session owner's wallet calls `submit_verified_score` with that
   attestation.
8. The contract reconstructs the exact domain-separated message, recovers the
   verifier public key, checks the caller and session invariants, stores one
   score record, and marks the session submitted.

The verifier never receives a general NEAR transaction key and cannot submit a
result by itself. A player wallet cannot invent a result without a valid
verifier signature.

## Signed protocol

The canonical JSON message uses the fixed protocol name
`near-arcade-score-v1` and binds:

- network and contract account;
- player and session IDs;
- game and ruleset versions;
- independently computed score;
- canonical replay SHA-256;
- short attestation expiry, capped by the session expiry.

The contract stores the replay hash, not the full replay payload. Canonical
serialization and attestation ordering are locked by shared and contract test
vectors.

## Provision, deploy, and verify

```bash
npm install
npm run provision:testnet
npm run deploy:testnet
npm run smoke:testnet
npm run smoke:web
npm run check
```

`provision:testnet` preserves an existing sponsor and creates
`NEAR_VERIFIER_PRIVATE_KEY` only when absent. `.env` remains ignored with mode
`0600`. `deploy:testnet` upgrades the existing contract and configures the
derived public key through the owner account. Batch 3 additions use versioned
raw storage keys so the Batch 2 contract state remains readable across the
upgrade.

To rotate a suspected verifier key, replace the private key in the server-only
environment, stop replay issuance, and run `npm run deploy:testnet`. The owner
transaction updates the contract's accepted public key. Previously accepted
records retain the public key that authorized them.

## Trust boundary and limitations

- “Replay verified” means the centralized service reproduced the terminal
  score with the registered deterministic ruleset. It is not fully on-chain or
  trustless verification.
- The session seed is public when the session is created, and players can start
  another session after abandoning one. Batch 3 therefore does not claim
  grinding-resistant randomness.
- A valid replay proves simulation consistency, not that a human generated the
  inputs or that the browser was unmodified. Bot detection and stronger input
  provenance are outside this batch.
- Replay payloads are verified in memory and only their SHA-256 records are
  stored on-chain. Durable replay archives can be added when operational volume
  justifies them.
- Global and personal-best rankings are Batch 4 scope; a confirmed result is an
  accepted score record, not yet a leaderboard placement.
