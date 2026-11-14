# Batch 2 Testnet operations

## Account roles

- The sponsor account creates deterministic Google-player subaccounts and pays
  their bounded initial balance. Its private key exists only in `.env` and the
  API process.
- The contract account is separately faucet-funded because the JavaScript WASM
  requires substantial storage staking. Its deployment key is also server-only.
- The gas relayer is separately faucet-funded and can submit only validated,
  player-signed Meteor delegates for approved arcade calls.
- A Google player account receives the NEAR Auth MPC full-access public key and
  a device-local function-call key restricted to `fast-auth.testnet::sign`.

The sponsor API has no generic relay endpoint. It verifies the Auth0 ID-token
signature, issuer, audience, expiry, Google subject, derived MPC key, and device
key before creating an account. Funding and daily/per-IP creation counts are
capped.

The Meteor endpoint is not a generic transaction proxy. It accepts one signed
delegate, requires the deployed arcade contract as receiver, allows only
session, score, and tournament-entry calls with exact cost bounds, validates the
signature/nonce/expiry, and applies per-IP, per-account, and daily limits.

## Provision and deploy

```bash
npm install
npm run provision:testnet
npm run provision:relayer
npm run deploy:testnet
npm run smoke:testnet
npm run check
```

Both provisioning scripts are idempotent when their account credentials are
already present. `.env` is ignored and written with mode `0600`.

## Google transaction path

1. Google login supplies a signed Auth0 ID token to the sponsor API.
2. The API creates the deterministic player account once and installs the MPC
   key plus the scoped local key.
3. For a contract write, NEAR Auth authorizes the player's arcade delegate.
4. The scoped device key signs a second delegate for only the matching
   `fast-auth.testnet::sign` call.
5. The relayer pays for that FastAuth call, recovers the MPC signature, then
   pays to submit the signed arcade delegate and any approved deposit.

The account-creation sponsor is not involved after account creation. The
separate bounded relayer handles approved writes. Cross-device device-key
enrollment is deferred; the UI reports this limitation rather than silently
creating an unusable replacement key.

## Meteor transaction path

1. Meteor signs a NEP-366 delegate for the exact arcade action.
2. The API validates its signature and bounded policy without receiving a
   player private key.
3. The dedicated relayer submits the delegate and pays gas plus attached token
   costs.
4. The contract still sees the Meteor account as predecessor, preserving
   player ownership and authorization.

## Trust boundary

The contract generates and records the session seed, but the seed is revealed at
session creation so the product does not claim grinding resistance. Batch 3 now
adds canonical replay verification and accepted score records while retaining
that explicit limitation.
