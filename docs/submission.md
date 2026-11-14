# Submission guide

## Short description

NEAR Arcade is a Testnet arcade mini-app where a player can instantly play an
original deterministic one-button game, connect an existing NEAR wallet or
create one with Google, register a one-time on-chain session, submit a replay
that a centralized verifier independently reproduces, and record the accepted
score, ranking, tournament entry, and account-bound achievements on NEAR.

## Suggested submission links

- Source repository: add the final public repository URL.
- Demo application: add the final HTTPS application URL.
- Demo video: add the final rendered Batch 6 video URL.
- Contract: <https://testnet.nearblocks.io/address/near-arcade-contract-bf1dd35d6d.testnet>
- Deployment proof: <https://testnet.nearblocks.io/txns/w6gJ49iRcrqbtm6z8FYnaAV3s1qKoRWYp3jWXnN8nQo>
- Finalized tournament proof: <https://testnet.nearblocks.io/txns/AgfWNn7DRhRPcnEkz2iQmZViQnmHa3WHnoKbFbKm3cE6>

## What to claim

- deterministic fixed-timestep gameplay and canonical replay data;
- player-bound Testnet sessions and one accepted result per session;
- independent server replay plus player-signed on-chain acceptance;
- public profiles, deterministic rankings, free weekly tournaments, immutable
  finalization, and non-transferable achievements;
- existing-wallet connection plus Google-created Testnet wallets;
- explicit pending/confirmed states and explorer evidence for writes.

## What not to claim

- fully on-chain or trustless gameplay;
- proof that a human, rather than a bot, generated the inputs;
- grinding-resistant randomness;
- token, NFT, wager, paid entry, guaranteed prize, or earnings;
- unbounded leaderboard history or cross-device Google-wallet recovery.

## Ninety-second demo order

1. Open on mobile width and show guest play plus the three-step onboarding.
2. Open account choices and show both existing NEAR wallet and Google paths.
3. Show a connected account, free tournament registration, and its explorer
   transaction.
4. Start a session, play briefly, and show the session transaction.
5. Finish the run and show local replay, verifier pending, wallet pending, and
   confirmed score states.
6. Open the score proof, then show refreshed profile, leaderboard, tournament
   rank, and badges.
7. Close on the trust disclosure and finalized accelerated tournament proof.

## Final checklist

- [ ] Public source URL added above.
- [ ] HTTPS demo URL added above and CORS origin configured.
- [ ] Real external-wallet flow completed on the public origin.
- [ ] Real Google consent/account-creation flow completed on the public origin.
- [ ] `npm run acceptance` passed after the final deployment.
- [ ] Demo video rendered, reviewed, uploaded, and linked.
- [ ] No private key, `.env`, real OAuth token, or personal account data appears
      in source, screenshots, terminal output, or video.
- [ ] Submission copy matches [`trust-model.md`](./trust-model.md).
