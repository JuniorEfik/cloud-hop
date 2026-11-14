# Implementation batches

This plan translates the phases in `outline.md` into reviewable build batches.
Each batch must pass its own checks before the next batch changes a public
interface.

## Batch 1 — deterministic playable prototype

Build one polished local game around a versioned fixed-timestep simulation.
Capture player inputs as simulation ticks and prove that replaying the same seed
and inputs produces the same result.

Exit gate: `npm run check` passes and the game is playable on desktop and mobile
without a wallet.

## Batch 2 — wallet and session contract

Add the supported NEAR wallet path, a typed chain client, and the minimal game,
ruleset, and one-time session contract APIs. Pin the SDK only after validating
the current NEAR documentation and toolchain.

Exit gate: a Testnet account creates a session bound to its account and can open
the confirmed transaction in an explorer.

## Batch 3 — replay verification and score records

Define canonical replay bytes and hashing, independently run the game core in a
bounded backend verifier, authorize one accepted result per session, and expose
pending versus confirmed result states.

Exit gate: valid controlled replays are accepted and modified, expired,
cross-account, and duplicate submissions are rejected.

## Batch 4 — profiles and leaderboards

Add personal bests, player statistics, deterministic global and period ranking,
pagination, and transaction links. Introduce an indexer only if contract views
are insufficient.

Exit gate: a confirmed run appears in the player's stats and leaderboard with a
deterministic tie-break.

## Batch 5 — tournaments and achievements

Add one fixed-rules weekly tournament, registration, eligibility, finalization,
and non-transferable achievements. Add rewards only when their budget is funded
and the claim path is fully tested.

Exit gate: a tournament can progress from scheduled to finalized without late
runs, rewrites, or duplicate claims.

## Batch 6 — delivery polish

Finish empty/error/pending states, accessibility, security review, deployment,
architecture/trust-model documentation, demo recording, and the judge runbook.

Exit gate: a new reviewer can reproduce the complete Testnet journey from the
published instructions.

## Batch 6A.1 — mobile shell, boot, and routing

Replace the catch-all presentation with a mobile-first application shell,
transient boot/loading screen, focused main menu, route-aware navigation,
history/deep-link handling, route titles, and focus announcements. Add server
fallbacks for approved client routes without changing contract behavior.

Exit gate: a reviewer can open or deep-link to each implemented route, use
back/forward navigation, recover from boot failure into guest mode, and navigate
at 320 px without horizontal overflow.

## Batch 6A.2 — immersive game route

Refactor Cloud Hop into a mountable lifecycle-managed play screen with
preflight selection, full-viewport active play, safe-area HUD, pause menu,
optional browser fullscreen, active-run navigation guards, and contained result
states.

Exit gate: starting a run removes the normal shell and scrolling; pause,
resume, result, retry, replay proof, exit, and session-abandon decisions remain
safe on mobile and desktop.

## Batch 6A.3 — dedicated content screens

Move tournaments, full leaderboards, player profile/achievements, trust/help,
and settings into dedicated responsive routes. Add route-local loading, empty,
stale, error, retry, and proof states while preserving shared data services.

Exit gate: no screen acts as a catch-all page, and every approved non-dashboard
route is independently navigable and accessible.

## Batch 6A.4 — privacy-safe analytics and dashboard

Add allowlisted anonymous event ingestion, persistent aggregate rollups, public
dashboard reads, source/freshness labels, on-chain top five, tournament and
conversion metrics, plus a protected boundary for operator-only health data.

Exit gate: the dashboard shows real source-labeled day/seven-day/30-day metrics
without raw IP, wallet identity, Google identity, replay, or privileged service
data entering public analytics.

## Batch 6A.5 — installability, performance, and responsive acceptance

Add manifest/installability, safe caching where appropriate, lazy route/wallet
loading, final motion/sound/orientation settings, and the full mobile/tablet/
desktop acceptance matrix.

Exit gate: production and browser acceptance pass at 320x568, 360x800, 390x844,
430x932, 768 px tablet, and 1440 px desktop, with no clipping, stale protocol
cache, focus loss, or active-run data loss.
