# NEAR Arcade --- Implementation Outline

**Document status:** Planning draft\
**Product shape:** NEAR-native, wallet-enabled arcade mini-app\
**Reference:** Flabitrum (HackQuest)\
**Initial game:** Flappy Bird-style tap-to-fly arcade game\
**Chain scope:** NEAR Testnet for development and hackathon
demonstration\
**Execution model:** Responsive off-chain gameplay with on-chain
sessions, verified score records, tournaments, and rewards\
**Deferred scope:** Multi-game platform, transferable game assets, token
economy, and permissionless game publishing

------------------------------------------------------------------------

## 1. Executive summary

Build a lightweight arcade game inspired by Flabitrum: players connect a
NEAR account, start a game, guide a character through obstacles, submit
a completed run, and compete on public leaderboards and recurring
tournaments.

The product should preserve the simplicity that makes arcade games
addictive while making blockchain participation meaningful. NEAR is used
for player identity, session registration, score records, tournament
state, achievement ownership, and reward distribution. The real-time
game loop remains in the browser so movement is immediate and does not
require a transaction for every tap.

The first release focuses on one polished Flappy Bird-style game. It
should demonstrate a complete player journey: connect wallet, play,
submit a score, verify the run, appear on a leaderboard, and claim or
receive a tournament reward where enabled.

The system must not claim that a score is provably fair merely because
it is written to a blockchain. Score integrity requires deterministic
game rules, replayable run data, anti-tampering checks, and clearly
documented trust assumptions. The MVP should favor a verifiable,
auditable design over exaggerated claims of fully on-chain gameplay.

## 2. Goals and non-goals

### 2.1 Goals

-   Deliver a responsive, immediately playable Flappy Bird-style game.
-   Support NEAR wallet connection and account-based player identity.
-   Register game sessions on NEAR before a run begins, or use a clearly
    documented session-registration flow.
-   Submit completed runs and verify scores against deterministic game
    rules.
-   Maintain public personal-best and tournament leaderboards.
-   Support daily challenges and weekly tournaments through a simple
    ruleset.
-   Make meaningful gameplay outcomes and reward claims inspectable on
    NEAR.
-   Prevent duplicate submissions, replay attacks, score inflation, and
    unauthorized reward claims.
-   Keep the first release small enough to finish, test, and demonstrate
    during a hackathon.
-   Design clean boundaries so more arcade games can be added later
    without rewriting wallet, tournament, or reward infrastructure.

### 2.2 Non-goals

-   No requirement to put every frame, movement, or tap on-chain.
-   No high-frequency blockchain writes during active gameplay.
-   No token launch, speculative tokenomics, staking, or yield promises
    in the MVP.
-   No paid entry, wagering, gambling, or prize pools funded by player
    deposits in the MVP.
-   No transferable NFT economy or marketplace in the MVP.
-   No multiplayer real-time networking in the MVP.
-   No arbitrary user-created games or permissionless game publishing in
    the MVP.
-   No claim that a backend-verified score is trustless unless the
    verification design actually provides that guarantee.
-   No guarantee of earnings, rewards, or tournament placement.

## 3. Product principles

1.  **Fun comes first:** Gameplay must remain responsive and
    understandable without requiring blockchain knowledge.
2.  **Blockchain has a clear purpose:** NEAR stores identity-linked game
    records, tournament state, and reward claims; it is not used as a
    frame-rendering engine.
3.  **Verifiability over marketing:** Every fairness claim must match
    the actual verification mechanism and its trust assumptions.
4.  **Deterministic gameplay:** A versioned ruleset and deterministic
    random-seed process must make a run reproducible.
5.  **One run, one result:** Session IDs, nonces, and state transitions
    prevent duplicate score submissions.
6.  **No hidden score edits:** Accepted results and tournament outcomes
    are auditable; corrections require explicit, recorded administrative
    procedures.
7.  **Safe rewards:** Reward allocation is bounded, funded, and
    independently testable. No unfunded reward promises.
8.  **Small MVP, expandable core:** Build one excellent game and a
    reusable platform foundation rather than several unfinished games.

## 4. Users and roles

### 4.1 Player

Connects a NEAR account, starts a run, plays, submits the result, views
personal statistics, competes in challenges, and claims eligible
rewards.

### 4.2 Tournament operator

Creates and configures tournaments, sets start/end times and scoring
rules, funds or assigns a reward budget, and finalizes results under
controlled permissions.

### 4.3 Platform administrator

Manages game versions, approved verifier versions, tournament
configuration, operational settings, abuse reports, and emergency
pauses. Administrative actions must be logged.

### 4.4 Verifier service

Validates submitted run data against the registered session, game
version, seed, timing constraints, and deterministic scoring rules. It
has no authority to invent rewards or alter finalized on-chain records.

## 5. High-level player journey

### 5.1 First visit

1.  Player opens the game without being forced to connect a wallet
    immediately.
2.  Landing screen explains the game in one sentence and shows a clear
    Play action.
3.  Player can try a limited guest/demo run if this is enabled.
4.  To save a score, join a tournament, or claim an achievement, the
    player connects a NEAR account.
5.  The app displays the connected account and network clearly.
6.  The player signs only the transactions needed for the selected
    action.

### 5.2 Starting a run

1.  Player selects Play.
2.  The app checks network, account, game availability, and current
    ruleset.
3.  The app requests a new session from the game contract.
4.  The contract creates a unique session ID, binds it to the
    predecessor account, records the game/ruleset version and expiry,
    and returns the session parameters.
5.  The client initializes the game using the session seed or a seed
    commitment/reveal protocol.
6.  Gameplay begins locally in the browser.

### 5.3 Completing a run

1.  The game ends on collision, timeout, or another defined terminal
    condition.
2.  The client produces a canonical run record containing session ID,
    game version, seed reference, inputs or replay data, final score,
    and relevant timing data.
3.  The verifier validates the record and rejects malformed, expired,
    duplicate, or impossible runs.
4.  An accepted result is submitted to the NEAR contract by the player
    or an authorized relayer, depending on the chosen transaction flow.
5.  The contract verifies the caller/session relationship and records
    the accepted result or verifier attestation.
6.  The UI waits for transaction finality before presenting the result
    as confirmed on-chain.
7.  The player sees the score, personal-best status, leaderboard
    position, and transaction link.

### 5.4 Tournament journey

1.  Player opens the tournament page.
2.  App displays rules, game version, start/end time, scoring method,
    reward details, and eligibility.
3.  Player joins before the deadline if explicit registration is
    required.
4.  Player completes eligible runs during the tournament window.
5.  The system ranks accepted results using a deterministic tie-break
    rule.
6.  At tournament close, the result set is finalized and recorded.
7.  Eligible players claim rewards, or the contract distributes them
    through a clearly defined and tested process.

## 6. Game design and rules

### 6.1 Initial game

A one-button vertical obstacle-avoidance game inspired by Flappy Bird.

Core loop:

-   Character falls under gravity.
-   Tap, click, or press Space to flap upward.
-   Obstacles move horizontally across the play area.
-   Passing an obstacle pair increases the score.
-   Collision ends the run.
-   A run can be restarted after its result is recorded or safely
    abandoned.

The visual identity, character, obstacle art, sounds, and UI must be
original. Do not reuse protected Flappy Bird assets or branding.

### 6.2 Deterministic ruleset

The game must use a versioned ruleset with explicit values for:

-   Physics timestep and update order.
-   Gravity, flap impulse, velocity cap, and collision geometry.
-   Obstacle spacing, speed, gap size, and spawn schedule.
-   Score increment conditions.
-   Maximum run duration and score bounds.
-   Seed generation and obstacle-generation algorithm.
-   Ruleset version and client build compatibility.

Use a fixed simulation timestep. Avoid relying on variable frame rate
for score-affecting physics. Rendering may use requestAnimationFrame,
but simulation updates must use a deterministic timestep and bounded
catch-up behavior.

### 6.3 Randomness and seed handling

The MVP must not let the client choose an arbitrary favorable seed.

Preferred design:

-   Contract or trusted session service generates a cryptographically
    secure seed.
-   Contract stores a commitment to the seed when the session starts.
-   The seed is revealed after the run closes, or is made available
    through a protocol that prevents the player from choosing among many
    seeds.
-   The verifier replays the run using the committed seed and the exact
    ruleset version.

If the MVP uses a server-generated seed, disclose that the server is
trusted for seed generation. A later version may explore stronger
on-chain randomness or commit/reveal mechanisms after reviewing NEAR
randomness availability and the relevant security model.

### 6.4 Input and replay representation

Choose one canonical representation and version it. Options include:

-   Timestamped flap inputs relative to a fixed simulation tick; or
-   A compact per-tick input bitset.

The verifier must enforce maximum input count, maximum run duration,
monotonic tick order, valid input timing, and payload-size limits. Do
not accept a client-supplied score as authoritative.

### 6.5 Accessibility and usability

-   Support touch, mouse, and keyboard input.
-   Provide readable instructions and visible pause/restart states.
-   Respect reduced-motion preferences where practical.
-   Keep gameplay usable on common mobile viewport sizes.
-   Avoid requiring a wallet popup for every flap or obstacle
    interaction.

## 7. On-chain versus off-chain responsibilities

### 7.1 On-chain responsibilities

The NEAR contract should own or authoritatively record:

-   Player account identity for accepted records.
-   Game and ruleset version identifiers.
-   Game session IDs, owner, expiry, and session status.
-   Seed commitment or other session fairness commitment.
-   Accepted score records or verifier attestations.
-   Personal-best values if maintained by the contract.
-   Tournament definitions, registration, windows, and finalization
    state.
-   Tournament result roots or finalized ranking records.
-   Achievement identifiers and claim status.
-   Reward budgets, allocations, and claim status where rewards are
    enabled.
-   Pause state and authorized operator roles.

### 7.2 Off-chain responsibilities

The frontend and backend handle:

-   Real-time physics and rendering.
-   Audio, animation, menus, and responsive controls.
-   Replay packaging and submission transport.
-   Deterministic replay verification, unless a future contract design
    can perform it economically.
-   Cached leaderboard reads and profile presentation.
-   Notifications, analytics, abuse triage, and operational monitoring.
-   Media assets and static game content.

### 7.3 Trust model

The MVP should clearly state whether the verifier is:

-   A centralized service that validates replays and submits an
    attestation;
-   A permissioned set of verifiers with threshold approval; or
-   A fully on-chain verification mechanism.

Do not describe a centralized verifier as trustless. If a verifier key
can authorize results, protect it, scope its permissions, rotate it, and
make its accepted actions publicly auditable. The contract must still
enforce session ownership, expiry, one-time submission, game version,
and tournament boundaries.

## 8. NEAR contract design

### 8.1 Contract modules

The initial implementation may use one contract with well-separated
modules. Split contracts only if independent upgrade, storage, or
permission boundaries justify the complexity.

Suggested logical modules:

-   **GameRegistry:** Approved game IDs, ruleset versions, verifier
    keys, and pause status.
-   **SessionManager:** Creates sessions, records commitments, expires
    sessions, and prevents reuse.
-   **ScoreRegistry:** Accepts verified results, enforces one result per
    session, and updates personal bests.
-   **TournamentManager:** Creates tournaments, handles registration,
    tracks accepted results, and finalizes outcomes.
-   **AchievementRegistry:** Records milestone achievements and claim
    status.
-   **RewardManager:** Holds or references reward budgets, records
    allocations, and supports safe claims.
-   **AccessControl:** Owner, operator, verifier, and emergency-pause
    permissions.

For the hackathon MVP, GameRegistry, SessionManager, ScoreRegistry, and
a minimal TournamentManager are the essential scope. Achievement and
reward modules can be simplified or deferred.

### 8.2 Suggested public methods

Names are illustrative; finalize exact signatures after contract design.

View methods:

-   `get_game(game_id)`
-   `get_ruleset(game_id, version)`
-   `get_session(session_id)`
-   `get_player_stats(account_id)`
-   `get_personal_best(account_id, game_id)`
-   `get_leaderboard_page(game_id, period, cursor, limit)`
-   `get_tournament(tournament_id)`
-   `get_tournament_result(tournament_id, account_id)`
-   `get_contract_config()`

Change methods:

-   `create_session(game_id, ruleset_version, commitment)`
-   `submit_verified_score(session_id, score, replay_hash, verifier_signature)`
-   `join_tournament(tournament_id)`
-   `finalize_tournament(tournament_id, result_root, metadata_hash)`
-   `claim_reward(tournament_id, proof)`
-   `pause_game(game_id)`
-   `unpause_game(game_id)`
-   `set_verifier(verifier_account, enabled)`
-   `register_ruleset(game_id, version, ruleset_hash)`

The final method set must be minimal. Do not expose a generic method
that lets an operator arbitrarily write player scores.

### 8.3 Contract invariants

-   Only the session owner can submit or authorize a result for their
    session, subject to the verifier model.
-   A session can produce at most one accepted result.
-   Expired, canceled, paused, or unknown sessions cannot produce
    accepted results.
-   The score must be within the configured ruleset bounds.
-   The submitted game and ruleset versions must match the session.
-   A verifier signature or attestation must be valid and scoped to the
    intended contract and network.
-   A tournament result must fall within the tournament window and
    accepted ruleset.
-   A finalized tournament cannot be silently rewritten.
-   A reward cannot be claimed more than once.
-   Contract storage and reward liabilities must be bounded.
-   Administrative actions must be restricted and auditable.
-   Unknown game versions and malformed inputs fail closed.

### 8.4 Storage and gas considerations

NEAR contract storage has economic implications. Store compact records
and hashes where full replay payloads are unnecessary. Keep large replay
data off-chain and store a cryptographic hash or content reference
on-chain. Paginate leaderboard and history reads. Avoid unbounded
iteration over every player during a transaction.

Leaderboard design must be selected deliberately:

-   For a small hackathon cohort, a bounded on-chain top-N list may be
    acceptable.
-   For larger scale, store accepted score events and maintain an
    indexed off-chain leaderboard, with on-chain records as the source
    of truth.
-   Do not claim an off-chain ranking is independently trustless unless
    the ranking can be reconstructed from verifiable on-chain data.

## 9. Proposed architecture

### 9.1 System overview

``` text
Player Browser
    |
    +--> Game UI / Phaser gameplay engine
    |
    +--> NEAR Wallet Selector / wallet signing
    |
    +--> App API
            |
            +--> Session service
            |       |
            |       +--> NEAR game contract
            |
            +--> Replay submission
            |       |
            |       +--> Deterministic verifier
            |               |
            |               +--> Result attestation
            |                       |
            |                       +--> NEAR game contract
            |
            +--> Leaderboard query service
            |       |
            |       +--> NEAR RPC / indexer
            |       +--> PostgreSQL read model
            |
            +--> Tournament and reward service
                    |
                    +--> NEAR game contract
```

### 9.2 Frontend

The frontend owns game rendering, input handling, wallet connection,
transaction prompts, player dashboard, leaderboard, and tournament
screens. Blockchain calls must be isolated behind a typed client module.

### 9.3 Backend

The backend handles replay validation, rate limits, leaderboard
indexing, tournament scheduling, notifications, and operational tooling.
It must not be treated as the authoritative owner of player assets or
unrestricted contract state.

### 9.4 Indexing and read model

For the MVP, query contract views directly where practical. If
leaderboard reads become expensive or awkward, add an indexer that
consumes NEAR events or indexed contract activity and builds a
PostgreSQL read model. The read model is a cache/projection; it must be
rebuildable from canonical chain data.

### 9.5 Mobile-first application and screen architecture

The browser application must be organized as distinct screens rather
than one continuously scrolling page. Design from 320--430 px mobile
viewports first, then progressively enhance the same information
hierarchy for tablets and large screens. Desktop layouts must not be
shrunk into mobile layouts, and mobile layouts must not require
horizontal scrolling.

Approved routes:

-   `/` --- main menu and concise product entry point.
-   `/play` --- run selection, session preparation, immersive gameplay,
    pause, verification, and results.
-   `/dashboard` --- public game and community overview.
-   `/tournaments` --- tournament rules, registration, lifecycle, and
    rankings.
-   `/leaderboard` --- complete period-based rankings.
-   `/profile` --- connected player's statistics and achievements.
-   `/how-it-works` --- gameplay tutorial, architecture, and trust
    disclosures.
-   `/settings` --- sound, vibration, motion, orientation, and display
    preferences.

Browser back/forward navigation and deep links must work. Route changes
must update the document title, move focus to the new main heading, and
announce the new screen to assistive technology. Authentication remains
a global modal or sheet and must return the player to the route that
requested it.

#### 9.5.1 Boot and loading screen

Show a dedicated branded boot screen while public configuration,
restored identity, contract availability, and the initial route data are
being resolved. It is a transient application state, not a history entry.
Deep links must finish booting and then open their requested route.

If wallet, API, or RPC initialization fails, present clear retry and
continue-as-guest actions. After boot, use local skeleton, empty, retry,
and stale-data states within individual screens instead of returning to
the full loading screen for ordinary navigation.

#### 9.5.2 Main menu and app shell

The main menu prioritizes one Play action, account/network status, a
small current-tournament preview, and links to dashboard, rankings,
profile, help, and settings. Do not place complete leaderboards,
tournament tables, documentation, and gameplay on the menu screen.

Use a thumb-friendly bottom navigation pattern on phones and a compact
top or side navigation pattern where larger viewports provide room. All
touch targets must be approximately 44 by 44 CSS pixels or larger.

#### 9.5.3 Immersive game screen

`/play` begins with a compact preflight state that lets the player choose
guest, verified, or eligible tournament play and explains any required
transaction before it opens a wallet.

Once a run starts:

-   Hide the standard application navigation and prevent page scrolling.
-   Fill the available `100dvh` viewport while respecting safe-area
    insets and mobile browser controls.
-   Keep the portrait game canvas centered and readable. Wider screens
    may add restrained ambient space or supporting status without
    shrinking the game.
-   Show only the essential score/time HUD, pause control, and an
    optional browser-fullscreen control. Do not require native browser
    fullscreen, because it may be unavailable or rejected.
-   Support touch, pointer, keyboard, reduced motion, sound preferences,
    and optional vibration without making any of them mandatory.

The run state machine is:

``` text
preflight -> session pending -> playing -> paused
          -> local replay check -> verifier pending -> wallet pending
          -> confirmed | rejected/retry -> results
```

The pause menu provides Resume, controls, sound/vibration settings,
restart or abandon, and exit to menu. Routing away, refreshing, or
closing during an active or pending verified run must pause where
possible and warn before losing replay data or abandoning a session.
Never silently replace a pending score submission.

The result overlay stays in the immersive game context and provides the
score, verification state, explorer proof where available, Play again,
and Exit to menu. Starting a new connected run must explicitly reconcile
or abandon any prior active session.

#### 9.5.4 Public dashboard

Keep `/dashboard` separate from the main menu. It provides a compact
mobile-first overview rather than another navigation landing page.

Public dashboard content should include:

-   Unique visitors for the current UTC day, rolling seven days, and
    rolling 30 days, with the measurement definition visible.
-   New versus returning visitors and the previous-period change where
    enough data exists.
-   Runs started and completed, split between guest and connected play.
-   Verified on-chain scores and the run-to-confirmed-score conversion
    rate.
-   Active wallets and newly created Google wallets as aggregate counts.
-   Average and highest accepted score for the selected period.
-   Current tournament state, participant count, eligible runs, and time
    remaining.
-   The top five on-chain leaderboard rows with account/block proof and
    a link to the complete leaderboard.
-   Recent confirmed transactions and recently earned achievement
    categories without exposing private replay data.
-   Public network, contract, RPC, and verifier availability.

Every metric must show its source and freshness. Use labels such as
“On-chain,” “Off-chain estimate,” and “Updated 2 minutes ago.” Never
present visitor analytics as blockchain facts. Use clear empty and
insufficient-data states instead of invented values.

On phones, use a compact two-column metric grid followed by single-column
rankings and activity. Tablets and desktops may expand to wider grids and
side-by-side sections while preserving the mobile reading order.

Operational data belongs in a separately authorized operator view, not
the public dashboard. Sponsor balance, rate-limit consumption, detailed
verification failures, internal error traces, and privileged controls
must require operator authentication.

#### 9.5.5 Privacy-safe analytics

Visitor and gameplay analytics are off-chain and approximate. Use a
rotating anonymous identifier or an equivalent privacy-preserving
method. Do not store raw IP addresses, Google identities, wallet keys,
full account IDs, replay payloads, or cross-site advertising identifiers
as analytics fields.

Allowed aggregate event categories include:

-   Application/menu/dashboard view.
-   Guest, verified, or tournament run started.
-   Run completed or abandoned.
-   Wallet connection method without identity data.
-   Replay accepted or rejected with a bounded reason category.
-   Score transaction confirmed or failed.
-   Tournament registration confirmed.

Store analytics in a persistent database or a reviewed privacy-friendly
analytics service. Do not rely on browser-local counters, process memory,
or an ephemeral hosting filesystem. Apply retention limits, payload
validation, rate limits, and bot filtering. Dashboard rollups must remain
available if individual raw events are deleted under the retention
policy.

#### 9.5.6 Performance and installability

Lazy-load wallet, analytics, dashboard, and non-game route code where
practical so a mobile visitor reaches the menu quickly. Mount the Canvas
and animation loop only on `/play`, and give the game component an
explicit destroy lifecycle for events and animation frames.

Provide a web-app manifest and installable mobile shell when it does not
delay the submission. Cached guest play may work offline, but wallet,
verification, dashboard freshness, and on-chain actions must clearly
state that they require connectivity. Service-worker updates must not
leave the game core and verifier protocol on incompatible versions.

#### 9.5.7 Frontend module boundaries

Retain the working TypeScript stack while splitting the current browser
entry point into clear boundaries:

``` text
src/
  app.ts                    # boot and shared services
  router.ts                 # routes, history, and guards
  state/                    # identity, run, and cached public data
  screens/                  # loading, menu, play, dashboard, tournament,
                            # leaderboard, profile, trust, settings
  components/               # navigation, auth, status, proof links
  game/                     # mountable Cloud Hop view and lifecycle
  analytics/                # bounded event client and metric types
```

Blockchain calls remain behind the typed NEAR client. Screen components
must not duplicate signing, parsing, or trust decisions.

#### 9.5.8 Responsive acceptance matrix

Test at minimum 320x568, 360x800, 390x844, 430x932, 768 px tablet, and
1440 px desktop layouts. At every size:

-   No required content or control is clipped or horizontally scrolled.
-   Gameplay becomes immersive and scroll-free after the run begins.
-   Safe areas, touch targets, dialogs, and keyboard focus remain usable.
-   Screen routing, deep links, back/forward, pause, and active-run guards
    behave consistently.
-   Loading, empty, stale, error, retry, pending, and confirmed states
    are distinguishable without relying only on color.
-   Mouse, keyboard, touch, reduced-motion, and screen-reader paths remain
    supported.

## 10. Core backend components

### 10.1 API gateway

Provides versioned endpoints, request validation, rate limiting, CORS
policy, request IDs, and consistent error responses.

### 10.2 Session service

Requests session creation, tracks transaction finality, associates
sessions with the authenticated NEAR account, and exposes the exact
session parameters to the game client.

### 10.3 Replay ingestion

Accepts bounded replay payloads, validates schema and size, computes
canonical hashes, and stores temporary or durable replay artifacts
according to retention policy.

### 10.4 Deterministic verifier

Replays the input sequence against the versioned physics engine and
seed. It rejects altered rulesets, impossible timing, invalid
collisions, score mismatches, excessive duration, malformed inputs, and
reused sessions.

The verifier should share a small deterministic game-core package with
the frontend where possible, but the server must independently execute
the simulation. Do not trust a client-computed result.

### 10.5 Attestation service

Produces a scoped signature or authorization for an accepted result if
the contract uses a verifier-key model. The signed message must bind at
least the network, contract, player, session ID, game ID, ruleset
version, score, replay hash, and expiry/nonce.

### 10.6 Leaderboard service

Builds player and tournament views from canonical accepted results. It
must use deterministic sorting and tie-break rules. Clearly label
pending versus finalized results.

### 10.7 Tournament scheduler

Opens and closes scheduled tournaments, validates their configured time
windows, and triggers finalization workflows. Contract timestamps and
transaction ordering remain authoritative for on-chain state.

### 10.8 Reward service

Coordinates funded reward budgets and claim proofs. It must never
display a reward as claimable until the contract confirms the allocation
and sufficient funds or assets are available.

### 10.9 Administration and abuse controls

Provides game pause, tournament pause, verifier rotation, player/session
review, rate-limit configuration, and incident controls. Every
privileged action is audited.

## 11. Wallet and identity model

### 11.1 Wallet integration

Use a maintained NEAR wallet integration path, such as NEAR Wallet
Selector or the currently recommended equivalent. Confirm current wallet
compatibility and package maintenance before implementation.

The app should support:

-   Connect and disconnect.
-   Account display and network display.
-   Transaction signing for session creation and result submission where
    required.
-   Clear handling of wallet rejection, timeout, and network mismatch.
-   Reconnection without silently changing the selected account.

### 11.2 Account identity

A NEAR account ID is the player's primary on-chain identity. Do not
require email or custodial accounts for the hackathon MVP unless a
specific product requirement justifies them.

### 11.3 Transaction UX

-   Avoid wallet prompts during active gameplay.
-   Explain why a transaction is required before opening the wallet.
-   Show pending, successful, failed, and unknown transaction states.
-   Never label a transaction successful before chain confirmation.
-   Provide an explorer link for confirmed actions.
-   Do not ask users to share seed phrases or private keys.

## 12. Data model

### 12.1 On-chain entities

-   **GameConfig:** Game ID, active ruleset, enabled state, and verifier
    configuration.
-   **Ruleset:** Version, ruleset hash, physics parameters hash, and
    activation status.
-   **GameSession:** Session ID, player account, game ID, ruleset
    version, seed commitment, creation time, expiry, and status.
-   **ScoreRecord:** Session ID, player, score, replay hash, verifier
    identity/attestation reference, and accepted timestamp.
-   **PlayerStats:** Player account, total accepted runs, personal best,
    and selected aggregate counters.
-   **Tournament:** ID, game/ruleset version, start/end time, scoring
    method, status, and reward configuration.
-   **TournamentEntry:** Tournament ID, player account, and registration
    state.
-   **TournamentResult:** Final rank/score or a result-root reference,
    finalization metadata, and tie-break evidence.
-   **RewardAllocation:** Tournament ID, player, reward amount/type,
    proof or allocation reference, and claimed status.
-   **AuditRecord:** Privileged action type, actor, target, timestamp,
    and relevant hashes.

### 12.2 Off-chain entities

-   **PlayerProfile:** Display name, avatar reference, preferences, and
    public profile settings.
-   **ReplayArtifact:** Session ID, canonical input stream, replay hash,
    storage location, and retention status.
-   **VerificationAttempt:** Replay hash, verifier version, result,
    rejection reason, and execution duration.
-   **LeaderboardProjection:** Cached ranking rows and source
    block/height.
-   **TournamentProjection:** Cached tournament state and ranking view.
-   **AbuseSignal:** Rate-limit events, suspicious run patterns, and
    review status.
-   **Notification:** Player, channel, event, delivery status, and
    redacted payload.
-   **AnonymousAnalyticsEvent:** Rotating anonymous visitor reference,
    bounded event category, route/game context, coarse timestamp, and
    non-identifying result category.
-   **AnalyticsRollup:** UTC day or rolling-period bucket, metric name,
    aggregate count/value, source, and last-updated timestamp.
-   **ServiceHealthSample:** Public service name, availability state,
    coarse latency/status, and measured timestamp. Internal traces and
    credentials are excluded.

### 12.3 Storage

Use PostgreSQL for profiles, replay metadata, verification attempts, and
indexed read models. Use object storage only if replay payload volume
justifies it. Keep the canonical accepted result and critical
authorization state on NEAR. Redis is optional for rate limiting,
caching, and short-lived coordination; it is not the source of truth.

## 13. API outline

Illustrative endpoints:

-   `GET /api/v1/game/config`
-   `GET /api/v1/game/rulesets/:gameId/:version`
-   `POST /api/v1/sessions/prepare`
-   `GET /api/v1/sessions/:sessionId`
-   `POST /api/v1/runs/:sessionId/replay`
-   `GET /api/v1/players/:accountId/stats`
-   `GET /api/v1/leaderboards/:gameId`
-   `GET /api/v1/tournaments`
-   `GET /api/v1/tournaments/:tournamentId`
-   `POST /api/v1/tournaments/:tournamentId/join`
-   `GET /api/v1/tournaments/:tournamentId/leaderboard`
-   `POST /api/v1/analytics/events`
-   `GET /api/v1/dashboard/summary`
-   `GET /api/v1/admin/operations` (operator-authenticated)
-   `GET /api/v1/health`

The API must validate NEAR account IDs, request sizes, replay schema,
session ownership, and idempotency. Mutating endpoints require rate
limits and replay protection. Analytics payloads require a fixed event
allowlist, strict size limits, origin checks, rate limits, and removal of
unexpected identifying fields.

## 14. Security and threat model

### 14.1 Primary threats

-   Client modifies the score or replay after gameplay.
-   Player fabricates input sequences or submits impossible timing.
-   Player reuses a session or replays an old valid result.
-   Player selects or brute-forces favorable random seeds.
-   Verifier key is compromised or abused.
-   Operator changes tournament rules after players have entered.
-   Duplicate transactions or retries create multiple accepted results.
-   A malicious client floods replay endpoints or creates excessive
    storage costs.
-   Leaderboard indexer misses, duplicates, or reorders events.
-   Reward claim proofs are forged or claimed more than once.
-   Contract upgrade or admin key compromise changes game rules or
    reward authority.
-   Frontend dependency or game asset supply-chain compromise.
-   Analytics accidentally collects identifying data, can be spammed, or
    exposes privileged operational information publicly.

### 14.2 Required mitigations

-   Use deterministic fixed-timestep simulation and versioned rulesets.
-   Verify every submitted replay independently on the server.
-   Bind replay hash, player, session, game version, seed commitment,
    and score into the accepted result.
-   Use one-time session IDs and explicit session expiry.
-   Use secure randomness for session seeds and document the trust
    model.
-   Use domain-separated signatures that bind network, contract, player,
    session, score, and expiry.
-   Restrict verifier authority to score submission; it must not
    withdraw funds or change contract ownership.
-   Use multisig or delayed upgrade controls for production contract
    administration where feasible.
-   Freeze tournament rules and reward terms once a tournament begins,
    except through a documented emergency cancellation path.
-   Enforce payload limits, rate limits, per-account run limits, and
    storage quotas.
-   Make score submission idempotent and reject duplicate session
    results.
-   Reconcile leaderboard projections against canonical contract state.
-   Keep secrets out of frontend bundles and logs.
-   Use dependency pinning, secret scanning, static analysis, and signed
    deployment artifacts.
-   Provide a global pause mechanism for game sessions and reward
    claims.
-   Separate public dashboard metrics from authenticated operator data.
-   Collect only allowlisted aggregate analytics, avoid raw IP/account
    storage, apply retention limits, and make off-chain estimates explicit.

### 14.3 Fairness claims

The product must distinguish:

-   **On-chain recorded:** A transaction/result is stored or emitted by
    the NEAR contract.
-   **Replay verified:** A verifier independently reproduced the score
    from the submitted inputs and ruleset.
-   **Seed committed:** The seed was committed before the run and
    revealed or otherwise made verifiable afterward.
-   **Trust-minimized:** Multiple independent components or
    cryptographic proofs reduce reliance on one operator.
-   **Fully on-chain verified:** The contract itself verifies the
    relevant game computation.

These terms are not interchangeable. The MVP should use only the claims
it can demonstrate.

## 15. Tournament and reward design

### 15.1 MVP tournament format

-   One active weekly tournament.
-   One game and one approved ruleset version.
-   Free participation.
-   Highest verified score wins.
-   Tie-break: earliest accepted on-chain result timestamp, or another
    explicitly selected deterministic rule.
-   Tournament start and end times are fixed before registration opens.
-   Late runs are rejected by contract rules.

### 15.2 Reward scope

For the hackathon MVP, rewards may be limited to non-financial
achievements, leaderboard badges, or a small sponsor-funded reward pool
if the organizer permits it and funding is secured.

If token rewards are included:

-   Use a clearly specified NEAR-native asset and token standard.
-   Fund the contract before advertising rewards.
-   Set a hard reward budget.
-   Define exact rank allocations and rounding rules.
-   Provide a claim deadline and unclaimed-reward policy.
-   Prevent duplicate claims.
-   Test failed transfers and recovery behavior.
-   Do not use player deposits or wagering mechanics.

### 15.3 Achievements

Potential achievements:

-   First verified run.
-   First personal best.
-   Score milestones.
-   Consecutive-day play streak.
-   Tournament participation.
-   Tournament podium finish.

For the MVP, achievements can be contract records or simple
non-transferable profile badges. NFT issuance is deferred unless it is a
specific hackathon requirement.

## 16. Suggested technology stack

-   **Frontend:** Next.js + React + TypeScript.
-   **Game engine:** Phaser 3, or a small custom Canvas engine if the
    game remains very simple.
-   **Smart contracts:** Rust + `near-sdk` as the default
    recommendation; evaluate `near-sdk-js` only if it materially
    improves delivery speed and the required APIs are supported.
-   **Wallet:** NEAR Wallet Selector or the currently recommended NEAR
    wallet integration.
-   **Backend:** Node.js + TypeScript with a lightweight framework such
    as Fastify or NestJS.
-   **Database:** PostgreSQL.
-   **Cache/limits:** Redis optional.
-   **Replay storage:** Object storage optional; store replay hashes
    on-chain.
-   **Testing:** near-workspaces / NEAR Sandbox, contract unit tests,
    deterministic game-core tests, and browser end-to-end tests.
-   **Deployment:** Static frontend hosting, backend hosting, and NEAR
    Testnet contract deployment.

Pin exact package versions after checking current NEAR documentation and
repository maintenance. Do not copy outdated wallet or SDK examples
without validating them against the current toolchain.

## 17. Testing strategy

### 17.1 Game tests

-   Fixed-timestep behavior is deterministic.
-   Identical ruleset, seed, and input sequence produce identical
    outcomes.
-   Collision boundaries and scoring are consistent.
-   Long frame pauses do not create impossible physics updates.
-   Mobile touch, mouse, and keyboard inputs behave consistently.
-   Restarting a run does not reuse the previous session.

### 17.2 Verifier tests

-   Valid replay accepted.
-   Modified score rejected.
-   Modified input stream rejected when hash does not match.
-   Impossible tick ordering rejected.
-   Excessive duration and payload size rejected.
-   Wrong ruleset or seed rejected.
-   Expired session rejected.
-   Duplicate replay/session submission rejected.
-   Replay from another player's session rejected.
-   Deterministic replay output matches the client for approved test
    vectors.

### 17.3 Smart contract tests

-   Session creation and expiry.
-   Session ownership checks.
-   One result per session.
-   Invalid verifier signature rejected.
-   Wrong network/domain/contract signature rejected.
-   Wrong game or ruleset version rejected.
-   Tournament boundary enforcement.
-   Tournament finalization cannot be repeated or silently changed.
-   Reward claim cannot be repeated.
-   Paused game rejects new sessions and/or submissions according to
    policy.
-   Unauthorized operator and verifier calls fail.
-   Storage growth and pagination remain bounded.

### 17.4 Integration tests

-   Wallet connects and signs a session transaction.
-   Session finality is handled correctly.
-   A complete run is replayed and verified.
-   Accepted result appears on-chain and in the leaderboard.
-   Indexer/read model can be rebuilt from canonical chain data.
-   Tournament closes and finalizes correctly.
-   Reward claim succeeds only for an eligible player.
-   Network errors and wallet rejection leave the UI in a recoverable
    state.
-   Boot completes into the requested deep link and can fall back to
    guest mode when wallet services are unavailable.
-   Browser back/forward, document titles, focus movement, and route
    announcements work across all screens.
-   Starting gameplay hides the app shell, prevents scrolling, respects
    safe areas, and restores navigation after results or exit.
-   Navigating away from an active or pending verified run requires an
    explicit pause/abandon decision.
-   Public dashboard metrics label source and freshness; operator-only
    metrics cannot be fetched anonymously.
-   Analytics rejects unknown events, oversized payloads, and identifying
    fields.

### 17.5 Security and resilience tests

-   Replay endpoint abuse and rate-limit enforcement.
-   Verifier key rotation and revocation.
-   Backend restart during verification.
-   Duplicate job delivery.
-   RPC/indexer delay or disagreement.
-   Contract pause during an active tournament.
-   Malformed account IDs and oversized payloads.
-   Frontend tampering and direct API calls.
-   Admin role escalation attempts.

## 18. Delivery plan

### Phase 0 --- Scope and technical decisions

-   Confirm hackathon requirements, judging criteria, deadline, and
    required NEAR features.
-   Freeze the one-game MVP and define what counts as a successful
    on-chain demonstration.
-   Choose Rust or JavaScript smart contracts after checking the current
    SDK and team capability.
-   Define the score-verification and seed trust model.
-   Define tournament rules and whether rewards are in scope.
-   Create a small architecture diagram and threat model.

**Exit criterion:** A frozen MVP specification with no unresolved
decision that blocks implementation.

### Phase 1 --- Playable game prototype

-   Build the game scene, physics, obstacles, collision, score, and
    restart flow.
-   Implement deterministic fixed-timestep simulation.
-   Add mobile, mouse, and keyboard controls.
-   Add a local ruleset version and replay/input capture.
-   Polish the game loop before integrating blockchain.

**Exit criterion:** A player can complete repeatable local runs, and
identical test inputs produce identical outcomes.

### Phase 2 --- NEAR wallet and contract foundation

-   Create and test the NEAR contract.
-   Add game/ruleset registry and session creation.
-   Integrate wallet connection and network selection.
-   Create session IDs and bind them to player accounts.
-   Add session expiry and one-time-use rules.
-   Deploy to NEAR Testnet.

**Exit criterion:** A connected player can create a session and inspect
the confirmed transaction on a NEAR explorer.

### Phase 3 --- Replay verification and score records

-   Implement replay serialization and canonical hashing.
-   Build the deterministic server verifier.
-   Add seed commitment/reveal or document the selected seed trust
    model.
-   Add verifier authorization and contract score submission.
-   Add duplicate, expiry, ownership, and score-bound checks.
-   Display pending and confirmed score states.

**Exit criterion:** A valid controlled run becomes an accepted on-chain
score, while tampered and replayed submissions are rejected.

### Phase 4 --- Leaderboards and player profiles

-   Add player stats and personal best.
-   Add global and daily/weekly leaderboard views.
-   Add deterministic ranking and tie-break rules.
-   Build an indexer/read model only if direct contract reads are
    insufficient.
-   Link accepted records to their transaction hashes.

**Exit criterion:** A judge can connect a wallet, submit a run, and see
the confirmed result reflected in the leaderboard.

### Phase 5 --- Tournaments and achievements

-   Add tournament creation and fixed rules.
-   Add registration and tournament eligibility.
-   Add tournament-scoped score ranking and finalization.
-   Add simple achievements and badge presentation.
-   Add reward claims only if funding, scope, and time permit.

**Exit criterion:** A complete tournament lifecycle works on Testnet
with deterministic results and no duplicate claims.

### Phase 6 --- Hackathon polish and submission

-   Improve loading, empty, error, pending, and success states.
-   Add a concise onboarding explanation and gameplay tutorial.
-   Add explorer links for all important on-chain actions.
-   Record a short demo showing wallet connection, gameplay, score
    verification, and leaderboard update.
-   Publish source code, deployment addresses, test instructions, and
    architecture notes.
-   Prepare a clear explanation of what is on-chain, what is off-chain,
    and the verifier trust model.
-   Run a final clean deployment and acceptance test.

**Exit criterion:** The project can be independently tested by judges,
the demo is reproducible, and all claimed blockchain functionality is
live on the stated network.

### Phase 6A --- Mobile-first application shell and dashboard

-   Replace the single scrolling presentation with the approved routes
    and transient boot screen.
-   Build a focused main menu and mobile bottom navigation, progressively
    enhanced for larger screens.
-   Refactor Cloud Hop into a lifecycle-managed `/play` screen with
    preflight, immersive `100dvh` gameplay, pause menu, route guards, and
    result states.
-   Move tournaments, full leaderboards, profile/achievements, trust
    documentation, and settings into dedicated screens.
-   Add the public dashboard, privacy-safe analytics events, persistent
    rollups, on-chain top-five data, freshness labels, and protected
    operator monitoring.
-   Add installable-app metadata and lazy route/wallet loading where they
    improve mobile startup without risking protocol version mismatch.
-   Extend browser acceptance across the approved mobile, tablet, and
    desktop matrix.

**Exit criterion:** A player can boot into a compact mobile menu, navigate
distinct deep-linked screens, start a guarded full-viewport run, return
through results, and inspect a source-labeled dashboard without any
single page becoming a catch-all interface.

### Deferred Phase 7 --- Platform expansion

-   Add more arcade games behind a shared game interface.
-   Add seasonal leagues and team competitions.
-   Explore stronger decentralized replay verification.
-   Add optional NFTs or non-transferable achievements.
-   Add a carefully designed reward economy only after product and legal
    review.
-   Explore social sharing, referrals, and community tournaments.
-   Add additional NEAR ecosystem integrations where they improve the
    player experience.

## 19. Hackathon acceptance criteria

The minimum credible demonstration should prove all of the following:

-   A player can open and play the game without a wallet prompt on every
    action.
-   A NEAR wallet can connect and identify the player.
-   A session is created on NEAR Testnet and bound to the player.
-   The game uses a versioned deterministic ruleset.
-   A completed run produces replay data and a canonical hash.
-   The verifier accepts a valid run and rejects a modified or duplicate
    run.
-   The accepted score is recorded through a NEAR transaction.
-   The leaderboard displays the accepted result.
-   A judge can inspect the relevant contract calls and transaction
    hashes.
-   The app clearly labels pending versus confirmed blockchain state.
-   The demo explains the verifier's trust assumptions honestly.
-   No unfunded token or reward promise is presented as live
    functionality.

## 20. Open decisions

1.  What is the final product name and visual identity?
2.  Which NEAR wallet integration is required by the hackathon, and
    which wallets must be supported?
3.  Will the verifier be a single backend service for the MVP, or is
    there time for a multi-verifier design?
4.  Will session seeds use a contract commitment/reveal flow or a
    documented server-generated seed for the first demo?
5.  Is the hackathon judged on NEAR Testnet, Mainnet, or both?
6.  Are token rewards explicitly required, or are verifiable scores and
    achievements sufficient?
7.  Does the hackathon provide a sponsor-funded prize budget?
8.  What is the exact submission deadline and what evidence must be
    included?
9.  Is a guest mode desirable, or should every scored run require a
    connected NEAR account?
10. Which team members own frontend, game logic, contract, backend, and
    demo?

Resolve the decisions that affect contract interfaces before
implementation. Avoid adding tokenomics, NFTs, or multiple games until
the core play-to-verified-score loop is complete.

## 21. References

-   [Flabitrum --- HackQuest project
    page](https://www.hackquest.io/zh-cn/projects/flabitrum)
-   [NEAR Developer Documentation](https://docs.near.org/)
-   [NEAR Developer Experience guide](https://near.github.io/DX/)
-   [NEAR Rust SDK](https://github.com/near/near-sdk-rs)
-   [NEAR JavaScript SDK](https://github.com/near/near-api-js)
-   [NEAR Wallet Selector](https://github.com/near/wallet-selector)
-   [NEAR Workspaces JS](https://github.com/near/workspaces-js)
-   [NEAR Enhancement Proposals](https://near.github.io/NEPs/)

------------------------------------------------------------------------

## Appendix A --- Key implementation constraint

The game must not send a blockchain transaction for every flap or frame
in the MVP. That approach would add latency, wallet friction, and
unnecessary transaction cost to the core game loop.

Instead, register a session, play locally, verify the deterministic
replay, and record the accepted result on NEAR. If the team later
experiments with fully on-chain movement or action recording, treat it
as a separate mode with its own performance, cost, and fairness
evaluation.

## Appendix B --- Suggested repository structure

``` text
near-arcade/
  apps/
    web/                  # Next.js player application
    api/                  # Session, replay, verification, leaderboard API
  packages/
    game-core/            # Deterministic physics, rulesets, replay format
    near-client/          # Typed contract and wallet integration
    shared/               # Shared schemas, types, validation
    ui/                   # Shared UI components
  contracts/
    arcade/               # NEAR smart contract
  services/
    verifier/             # Replay verification and attestation
    indexer/              # Optional chain event projection
  tests/
    e2e/
    fixtures/
    contract/
  docs/
    architecture.md
    threat-model.md
    verifier-spec.md
    demo-runbook.md
  .env.example
  README.md
```

Keep secrets in environment variables or a secrets manager. Never commit
wallet seed phrases, private keys, verifier secrets, or production
credentials.
