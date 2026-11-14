# Trust model

## What each claim means

| Product statement | Evidence | Trust still required |
| --- | --- | --- |
| “Deterministic” | Same ruleset, seed, and flap ticks produce the locked result in tests and in the verifier | Correct published game-core code and ruleset hash |
| “Replay verified” | The backend independently executes the canonical replay and signs the derived result | The currently centralized verifier service and its key |
| “Recorded on-chain” | The player's transaction and stored score can be inspected on NEAR Testnet | NEAR Testnet consensus and explorer/RPC availability |
| “One run, one result” | Session state changes from active to submitted; duplicate submission is rejected | Correct deployed contract code |
| “Tournament result frozen” | Final result hash, podium, count, and repeat-finalization rejection are on-chain | Authorized operator performs the initial finalization after close |
| “Google-created wallet” | Google identity is verified before a capped Testnet subaccount is created | Auth0/FastAuth, MPC signing service, sponsor availability, and the original device key |

## On-chain

- game and ruleset registry, including the ruleset SHA-256;
- verifier public key and administrative roles;
- player-bound sessions, seed and commitment, expiry, and status;
- replay hash, accepted score, block/time metadata, and one-use transition;
- personal statistics and bounded deterministic rankings;
- tournament definition, registration, entries, final result hash, and podium;
- deterministic non-transferable achievement records.

## Off-chain

- Canvas rendering and all 60 Hz gameplay steps;
- flap-input capture and full replay payload;
- replay execution by the centralized verifier;
- Google OAuth/FastAuth interaction and sponsor policy enforcement;
- Meteor delegated-action validation plus Google approved-signing-request
  validation, rate limiting, and relayer submission;
- API-shaped public reads and browser presentation.

Only the replay SHA-256 is retained on-chain. The current service does not
promise permanent public storage of every replay payload.

## Explicit non-claims

- Gameplay is not fully on-chain or trustless.
- A replay proves consistency with the ruleset, not that a human played it.
- The public session seed does not prevent seed grinding by abandoning and
  starting another paid session.
- Rankings are bounded to the top 100 and are not a complete high-volume index.
- Badges are account-bound contract records, not transferable NFTs.
- The current tournament has no token reward, wager, paid entry, or prize pool.
- Google-wallet recovery on a second device is not implemented.

## Privileged actors

The contract owner can register/pause games, configure the verifier key, assign
the tournament operator, and upgrade the contract. The tournament operator can
create and finalize allowed tournaments but cannot rewrite a finalized result.
The sponsor can spend only through the account-creation policy. A separate
relayer pays only for signed player actions that exactly match the arcade
contract allowlist, cost bounds, nonce, and expiry policy. Google FastAuth sign
calls are additionally bound to the exact raw encoding of the already
validated arcade delegate; FastAuth hashes it before MPC signing. Neither
service can forge the player's signature. The verifier can
issue scoped score attestations but cannot sign as a player.

Compromise of an owner, operator, sponsor, relayer, or verifier key is an operational
incident. Rotate the affected key, stop the corresponding service, preserve the
chain evidence, and disclose the affected trust guarantee before resuming.
