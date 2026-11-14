# Security review

Review date: 2026-11-13  
Scope: browser, API, deterministic core, Testnet contract, deployment scripts,
and operational configuration in this repository.

This is an engineering security review for a hackathon Testnet release, not a
professional smart-contract audit.

## Protected assets

- contract owner/deployment key;
- Google account-creation sponsor key and balance;
- Meteor gas-relayer key and balance;
- replay-verifier secp256k1 key;
- player wallet/device keys;
- canonical session, score, tournament, and achievement state;
- ruleset/replay integrity and public proof links.

## Controls verified

- `.env` is ignored, mode `0600` in the controlled environment, and private key
  names/values are scanned out of the production frontend bundle.
- Sponsor provisioning validates the Google token, independently derives the
  account, caps initial funding and gas allowance, rate-limits by IP and day,
  and exposes no arbitrary account or transaction creation.
- The player relay decodes signed delegates and verifies the player signature,
  current nonce, bounded expiry, exact arcade receiver, allowed method sequence,
  argument shapes, gas, and deposits. Per-IP, per-account, and daily limits cap
  relayer exposure, and submissions are serialized to avoid relayer nonce races.
- Google signing uses a second device-key delegate restricted to
  `fast-auth.testnet::sign`; its 32-byte signing payload must equal the SHA-256
  of the same validated arcade delegate later submitted to the relay.
- Replay requests are capped at 16 KiB and per-IP rate-limited. Replays enforce
  canonical shape, tick/input/duration bounds, terminal state, session owner,
  session expiry, seed commitment, and registered ruleset hash.
- Attestations bind protocol, network, contract, player, session, game,
  ruleset, score, replay hash, and expiry. The contract recovers only the
  configured verifier key.
- Contract tests cover ownership, exact deposits, duplicate/expired/cross-user
  sessions, score tampering, bounded rankings, tournament windows, late runs,
  finalization rewrites, and duplicate achievements.
- Public API reads validate identifiers, periods, cursor/limit bounds, and
  returned shapes. CORS permits only configured web origins plus the bounded
  local-development range.
- Web responses set CSP, clickjacking, MIME-sniffing, referrer, opener,
  resource, and permissions policies. API JSON sets a deny-by-default CSP,
  no-store caching, request IDs, and equivalent baseline headers.
- The headless Chrome acceptance checks security headers, named interactive
  controls, unique IDs, landmarks, canvas instructions, semantic table cells,
  keyboard-operated tabs, mobile overflow, and browser errors.

## Findings and accepted limitations

| Severity | Finding | Disposition |
| --- | --- | --- |
| Design | One centralized verifier can attest any internally consistent replay | Disclosed in UI and trust model; player signature is still required |
| Design | Session seed is public and a player can pay to abandon/retry seeds | No grinding-resistance claim; stronger randomness is deferred |
| Medium operational | Owner/operator/verifier/sponsor/relayer keys are single-service secrets | Keep isolated server-side; rotate and pause on suspected compromise |
| Medium operational | Google recovery is bound to the original browser/device | Clearly disclosed; second-device enrollment is deferred |
| Low | 13 low advisories remain in the pinned NEAR/FastAuth graph | Accepted for the Testnet deadline; automated remediation requires a breaking `near-api-js` upgrade; 0 high/critical |
| Low | CSP allows HTTPS connections/images and HTTPS wallet frames for the dynamic wallet ecosystem | Script execution remains self-only; narrow the remote allowlist after final wallet-provider selection |
| Deployment | Local preview does not provide TLS or HSTS | Public host must terminate HTTPS and add HSTS; secrets must never enter static-host variables |

## Remaining manual checks

- Complete one real Google consent flow and one external NEAR wallet flow in
  the final public origin because third-party popups require authenticated user
  interaction.
- Reconfirm the deployed host preserves all response headers and configured
  CORS origins.
- Re-run `npm run acceptance` after changing dependencies, public origin,
  contract code, verifier key, or deployment account.

## Review commands

```bash
npm run check
npm ls --depth=0
npm audit --omit=dev --audit-level=high
npm run smoke:production
npm run smoke:web
npm run smoke:testnet
```
