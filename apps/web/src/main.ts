import { CloudHopGame } from "./game.js";
import { isNetlifyDeployment } from "./hosting.js";
import {
  NearArcadeClient,
  describeNearError,
  loadArcadeConfiguration,
  type ConnectedIdentity,
} from "./near-client.js";
import { compactAccountId, gameSeedFromChainSeed } from "./near-utils.js";
import {
  formatChainTimestamp,
  loadCurrentTournament,
  loadLeaderboardPage,
  loadPlayerAchievements,
  loadPlayerStats,
  loadTournamentEntry,
  loadTournamentLeaderboardPage,
  type Achievement,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type PlayerStatsResponse,
  type Tournament,
  type TournamentEntry,
} from "./public-data.js";
import {
  APP_ROUTES,
  AppRouter,
  parseAppRoute,
  type RouteChange,
} from "./router.js";

const root = document.querySelector<HTMLDivElement>("#root");

if (root === null) {
  throw new Error("Application root was not found.");
}

root.innerHTML = `
  <section class="boot-screen" data-boot aria-labelledby="boot-title" aria-describedby="boot-status">
    <div class="boot-orbit" aria-hidden="true">
      <span class="boot-brand-mark">
        <svg viewBox="0 0 28 28"><path d="M15.8 1.8 5.2 15h7.1l-1.1 11.2L22.8 11h-7.2l.2-9.2Z"></path></svg>
      </span>
      <i></i><i></i><i></i>
    </div>
    <p class="boot-kicker">NEAR Arcade</p>
    <h1 id="boot-title">Cloud Hop</h1>
    <p class="boot-status" id="boot-status" data-boot-status role="status" aria-live="polite">
      Loading public game configuration…
    </p>
    <div class="boot-actions" data-boot-actions hidden>
      <button type="button" class="primary-button" data-action="retry-boot">
        Retry connection <span>↻</span>
      </button>
      <button type="button" class="text-button" data-action="continue-guest">
        Continue as guest
      </button>
    </div>
  </section>

  <div class="app-frame" data-app hidden>
  <a class="skip-link" href="#main-content">Skip to screen content</a>
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="/" data-route="/" aria-label="NEAR Arcade main menu">
        <span class="brand-mark">
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <path d="M15.8 1.8 5.2 15h7.1l-1.1 11.2L22.8 11h-7.2l.2-9.2Z"></path>
          </svg>
        </span>
        <span>NEAR ARCADE</span>
      </a>
      <nav class="primary-nav" aria-label="Primary navigation">
        <a href="/play" data-route="/play">Play</a>
        <a href="/dashboard" data-route="/dashboard">Dashboard</a>
        <a href="/tournaments" data-route="/tournaments">Tournaments</a>
        <a href="/leaderboard" data-route="/leaderboard">Rankings</a>
      </nav>
      <div class="topbar-meta">
        <span class="network-pill" data-network><i></i> NEAR Testnet</span>
        <button type="button" class="connect-button" data-action="open-auth">
          Connect account
        </button>
        <div class="account-menu" data-account-menu hidden>
          <a data-account-link target="_blank" rel="noreferrer"></a>
          <button type="button" data-action="logout" aria-label="Disconnect account">×</button>
        </div>
      </div>
    </header>

    <div class="app-status" data-status role="status" aria-live="polite" aria-atomic="true">
      Loading NEAR Testnet configuration…
    </div>
    <div class="visually-hidden" data-route-announcer role="status" aria-live="polite" aria-atomic="true"></div>

    <main class="route-stage" id="main-content" tabindex="-1">
    <section class="route-screen menu-screen" data-screen="/" aria-labelledby="menu-title" hidden>

    <section class="hero">
      <div class="eyebrow"><span>02</span> Cloud Hop</div>
      <h1 id="menu-title" data-route-heading tabindex="-1">Thread the gap.<br><em>Own the run.</em></h1>
      <p>
        One-button arcade flight with deterministic replays and optional
        on-chain score proofs. Play instantly—no wallet required.
      </p>
    </section>

    <div class="menu-actions">
      <a class="primary-button menu-play" href="/play" data-route="/play">
        Play Cloud Hop <span>→</span>
      </a>
      <button type="button" class="menu-account" data-action="open-auth">
        <span class="detail-label">Player</span>
        <strong data-menu-player>Guest pilot</strong>
        <small data-menu-player-method>Connect only when you want verified scores.</small>
      </button>
    </div>

    <article class="menu-tournament" aria-labelledby="menu-tournament-title">
      <div>
        <span class="detail-label">Current tournament</span>
        <h2 id="menu-tournament-title" data-menu-tournament-name>Checking Testnet…</h2>
        <p data-menu-tournament-copy>Reading the active flight window.</p>
      </div>
      <div class="menu-tournament-side">
        <span class="tournament-status" data-menu-tournament-status>Loading</span>
        <a href="/tournaments" data-route="/tournaments">Open tournament →</a>
      </div>
    </article>

    <nav class="menu-grid" aria-label="Explore NEAR Arcade">
      <a href="/dashboard" data-route="/dashboard"><span>01</span><strong>Dashboard</strong><small>Game and community pulse</small></a>
      <a href="/leaderboard" data-route="/leaderboard"><span>02</span><strong>Leaderboard</strong><small>Verified on-chain pilots</small></a>
      <a href="/profile" data-route="/profile"><span>03</span><strong>Profile</strong><small>Stats, proofs, and badges</small></a>
      <a href="/how-it-works" data-route="/how-it-works"><span>04</span><strong>How it works</strong><small>Controls and trust model</small></a>
      <a href="/settings" data-route="/settings"><span>05</span><strong>Settings</strong><small>Display and play preferences</small></a>
    </nav>
    </section>

    <section class="route-screen information-screen" data-screen="/how-it-works" aria-labelledby="onboarding-title" hidden>

    <section class="onboarding" aria-labelledby="onboarding-title">
      <div class="onboarding-intro">
        <span class="detail-label">First flight</span>
        <h1 id="onboarding-title" data-route-heading tabindex="-1">Play now. Prove it when ready.</h1>
      </div>
      <ol class="journey-list">
        <li><span>01</span><div><strong>Choose how to play</strong><p>Start as a guest, connect Meteor, or continue with Google.</p></div></li>
        <li><span>02</span><div><strong>Take flight</strong><p>Tap, click, <kbd>Space</kbd>, or <kbd>↑</kbd> to climb through each gate.</p></div></li>
        <li><span>03</span><div><strong>Save your score</strong><p>Connected players can keep scores, join rankings, and earn achievements.</p></div></li>
      </ol>
    </section>
    <div class="information-grid">
      <article><span class="detail-label">Guest play</span><h2>Jump straight in</h2><p>No account is required. Your best local score stays on this device.</p></article>
      <article><span class="detail-label">Connected play</span><h2>Keep your progress</h2><p>Save completed runs to your account and compete on the leaderboard.</p></article>
      <article><span class="detail-label">Fair competition</span><h2>Scores are checked</h2><p>Connected scores are validated before they count toward rankings and achievements.</p></article>
    </div>
    </section>

    <section class="route-screen play-screen" data-screen="/play" aria-labelledby="game-title" hidden>

    <section class="play-layout" id="game" aria-labelledby="game-title">
      <h1 class="visually-hidden" id="game-title" data-route-heading tabindex="-1">Play Cloud Hop</h1>
      <div class="game-column" data-game-root>
        <div class="game-toolbar">
          <div><span>Score</span><strong data-score>00</strong></div>
          <div><span>Best</span><strong data-best>00</strong></div>
          <div><span>Flight</span><strong data-flight>0.0s</strong></div>
          <button
            type="button"
            class="pause-button"
            data-action="pause"
            aria-label="Pause game"
            disabled
          >Ⅱ</button>
        </div>

        <div class="game-frame">
          <canvas
            class="game-canvas"
            data-canvas
            aria-label="Cloud Hop game area. Tap, click, or press Space to flap."
            aria-describedby="game-instructions game-status"
            tabindex="0"
          >Cloud Hop requires a browser with Canvas support.</canvas>
          <p class="visually-hidden" id="game-instructions">
            Avoid the gates. Press Space or Arrow Up to flap. Press P or Escape
            to pause. Touch and pointer controls are also supported.
          </p>
          <p class="visually-hidden" id="game-status" data-game-status role="status" aria-live="polite" aria-atomic="true">
            Ready to start a run.
          </p>
          <div class="game-overlay intro-overlay" data-overlay>
            <span class="overlay-kicker">Cloud Hop</span>
            <h2>Ready to<br>break orbit?</h2>
            <button type="button" class="primary-button" data-action="start">
              Start a run <span>→</span>
            </button>
            <p>Space / click / tap</p>
          </div>
        </div>

        <div class="session-strip">
          <span><i></i><span data-session-label>Guest session</span></span>
          <a data-session-link target="_blank" rel="noreferrer" hidden></a>
        </div>
      </div>

      <aside class="details-panel">
        <div class="details-block account-card">
          <span class="detail-label">Player identity</span>
          <strong data-player-label>Guest pilot</strong>
          <p data-player-method>Local runs need no wallet.</p>
          <a data-player-link target="_blank" rel="noreferrer" hidden>
            Open in explorer ↗
          </a>
          <div class="player-stats" data-player-stats aria-label="Player statistics">
            <div><span>Personal best</span><strong data-player-best>—</strong></div>
            <div><span>Verified runs</span><strong data-player-runs>—</strong></div>
            <div><span>Latest</span><strong data-player-latest>—</strong></div>
          </div>
          <a data-best-block-link target="_blank" rel="noreferrer" hidden>
            Inspect personal best block ↗
          </a>
        </div>

        <div class="details-block">
          <span class="detail-label">How to fly</span>
          <ol class="control-list">
            <li><span>01</span><p>Tap, click, or press <kbd>Space</kbd> to climb.</p></li>
            <li><span>02</span><p>Pass each energy gate to score.</p></li>
            <li><span>03</span><p>Press <kbd>P</kbd> or <kbd>Esc</kbd> to pause.</p></li>
          </ol>
        </div>

      </aside>
    </section>
    </section>

    <section class="route-screen game-world-screen tournament-route-screen" data-screen="/tournaments" aria-labelledby="tournament-title" hidden>

    <section class="tournament-section" id="tournament" aria-labelledby="tournament-title" data-tournament-section>
      <div class="tournament-heading">
        <div>
          <div class="eyebrow"><span>03</span> Weekly tournament</div>
          <h1 id="tournament-title" data-route-heading tabindex="-1">Seven days. One ruleset.</h1>
          <p>Free entry. Highest score wins, with the earlier score breaking ties.</p>
        </div>
        <div class="tournament-heading-side">
          <div class="screen-game-chip">
            <img src="/assets/cloud-hop-flight.webp" alt="" width="364" height="647">
            <span><small>Active game</small><strong>Cloud Hop</strong></span>
          </div>
          <span class="tournament-status" data-tournament-status>Loading</span>
        </div>
      </div>
      <div class="tournament-grid">
        <div class="tournament-card">
          <span class="detail-label">Current flight window</span>
          <strong data-tournament-name>Checking Testnet…</strong>
          <p data-tournament-window>Reading the current weekly tournament.</p>
          <dl class="tournament-facts">
            <div><dt>Ruleset</dt><dd data-tournament-ruleset>—</dd></div>
            <div><dt>Pilots</dt><dd data-tournament-participants>—</dd></div>
            <div><dt>Reward</dt><dd data-tournament-reward>None</dd></div>
          </dl>
          <button type="button" class="primary-button tournament-join" data-action="join-tournament" disabled>
            Join tournament <span>→</span>
          </button>
          <p class="tournament-action-copy" data-tournament-action>
            Connect an account to register.
          </p>
          <div class="tournament-links">
            <a data-tournament-registration target="_blank" rel="noreferrer" hidden>
              View registration transaction ↗
            </a>
            <a data-tournament-contract target="_blank" rel="noreferrer" hidden>
              Inspect tournament contract ↗
            </a>
            <button type="button" class="text-button" data-action="retry-tournament" hidden>
              Retry tournament read
            </button>
          </div>
        </div>
        <div class="tournament-ranking">
          <div class="mini-heading">
            <span class="detail-label">Tournament leaders</span>
            <span data-tournament-ranking-status>Top verified flights</span>
          </div>
          <div data-tournament-rows class="tournament-rows" role="list"></div>
        </div>
        <div class="achievement-card">
          <div class="mini-heading">
            <span class="detail-label">Non-transferable badges</span>
            <span data-achievement-count>Connect to view</span>
          </div>
          <div data-achievement-rows class="achievement-rows" aria-live="polite">
            <p class="compact-empty">Achievements stay bound to the earning NEAR account.</p>
          </div>
        </div>
      </div>
    </section>
    </section>

    <section class="route-screen game-world-screen leaderboard-route-screen" data-screen="/leaderboard" aria-labelledby="leaderboard-title" hidden>

    <section class="leaderboard-section" id="leaderboard" aria-labelledby="leaderboard-title">
      <div class="leaderboard-heading">
        <div>
          <div class="eyebrow"><span>04</span> Public rankings</div>
          <h1 id="leaderboard-title" data-route-heading tabindex="-1">Verified pilots.</h1>
          <p>One best score from every connected player.</p>
        </div>
        <div class="leaderboard-heading-side">
          <div class="screen-game-chip">
            <img src="/assets/cloud-hop-flight.webp" alt="" width="364" height="647">
            <span><small>Ranking game</small><strong>Cloud Hop</strong></span>
          </div>
          <div class="leaderboard-tabs" role="tablist" aria-label="Leaderboard period">
            <button type="button" id="leaderboard-tab-all" role="tab" data-leaderboard-period="all" aria-controls="leaderboard-panel" aria-selected="true" tabindex="0">
              All time
            </button>
            <button type="button" id="leaderboard-tab-daily" role="tab" data-leaderboard-period="daily" aria-controls="leaderboard-panel" aria-selected="false" tabindex="-1">
              Today
            </button>
          </div>
        </div>
      </div>
      <div id="leaderboard-panel" role="tabpanel" aria-labelledby="leaderboard-tab-all">
        <div class="leaderboard-table" id="leaderboard-table" role="table" aria-label="Cloud Hop leaderboard" aria-live="polite">
          <div class="leaderboard-header" role="row">
            <span role="columnheader">Rank</span><span role="columnheader">Pilot</span><span role="columnheader">Score</span><span role="columnheader">Accepted</span><span role="columnheader">Proof</span>
          </div>
          <div data-leaderboard-rows role="rowgroup"></div>
        </div>
      </div>
      <div class="leaderboard-footer">
        <p data-leaderboard-status role="status" aria-live="polite">
          Loading on-chain rankings…
        </p>
        <div class="leaderboard-actions">
          <button type="button" class="text-button" data-action="retry-leaderboard" hidden>
            Retry rankings
          </button>
          <button type="button" class="text-button leaderboard-more" data-action="load-leaderboard" hidden>
            Load more ↓
          </button>
        </div>
      </div>
    </section>
    </section>

    <section class="route-screen utility-screen game-world-screen dashboard-screen" data-screen="/dashboard" aria-labelledby="dashboard-title" hidden>
      <div class="dashboard-showcase">
        <header class="screen-heading">
          <div class="eyebrow"><span>01</span> Arcade dashboard</div>
          <h1 id="dashboard-title" data-route-heading tabindex="-1">Enter the game world.</h1>
          <p>See what is playable now, then follow the verified competition and community activity around each game.</p>
          <a class="primary-button dashboard-play" href="/play" data-route="/play">
            Play Cloud Hop <span>→</span>
          </a>
        </header>
        <a class="featured-game-card" href="/play" data-route="/play" aria-label="Play Cloud Hop, available now">
          <img src="/assets/cloud-hop-flight.webp" alt="Cloud Hop gameplay with the pilot approaching a glowing energy gate" width="364" height="647">
          <span class="game-card-shade"></span>
          <span class="game-card-status"><i></i> Playable now</span>
          <span class="game-card-copy">
            <small>Arcade game</small>
            <strong>Cloud Hop</strong>
            <em>One button. Verified scores. Global rankings.</em>
          </span>
          <span class="game-card-action" aria-hidden="true">▶</span>
        </a>
      </div>
      <div class="game-library-heading">
        <div><span class="detail-label">Available games</span><h2>The arcade floor</h2></div>
        <span>1 live / more flights incoming</span>
      </div>
      <div class="foundation-grid">
        <article class="arcade-panel"><span class="detail-label">More games</span><strong>New flights incoming</strong><p>Cloud Hop is the first stop. More arcade challenges are on the way.</p><span class="foundation-state">Coming soon</span></article>
        <article class="arcade-panel"><span class="detail-label">Live competition</span><strong>Verified top five</strong><p>Follow the best Cloud Hop pilots and inspect their Testnet proof.</p><a href="/leaderboard" data-route="/leaderboard">Open rankings →</a></article>
        <article class="arcade-panel"><span class="detail-label">Weekly flight</span><strong>Tournament arena</strong><p>Enter the active Cloud Hop window, review the ruleset, and register a connected pilot.</p><a href="/tournaments" data-route="/tournaments">Open tournament →</a></article>
      </div>
    </section>

    <section class="route-screen utility-screen" data-screen="/profile" aria-labelledby="profile-title" hidden>
      <header class="screen-heading">
        <div class="eyebrow"><span>05</span> Player identity</div>
        <h1 id="profile-title" data-route-heading tabindex="-1">Your flight record.</h1>
        <p data-profile-copy>Connect a NEAR account to load verified statistics and account-bound achievements.</p>
      </header>
      <div class="profile-foundation">
        <div>
          <span class="detail-label">Current pilot</span>
          <strong data-profile-name>Guest pilot</strong>
          <p data-profile-method>Local runs stay on this device.</p>
        </div>
        <button type="button" class="primary-button" data-action="open-auth" data-profile-connect>
          Connect account <span>→</span>
        </button>
        <a data-profile-link target="_blank" rel="noreferrer" hidden>Open account proof ↗</a>
      </div>
      <div class="foundation-grid profile-next">
        <article><span class="detail-label">Statistics</span><strong>Personal best + run history</strong><p>Your saved runs and best scores belong to your connected account.</p></article>
        <article><span class="detail-label">Achievements</span><strong>Account-bound badges</strong><p>Earned tournament and score milestones remain non-transferable.</p></article>
      </div>
    </section>

    <section class="route-screen utility-screen" data-screen="/settings" aria-labelledby="settings-title" hidden>
      <header class="screen-heading">
        <div class="eyebrow"><span>07</span> Preferences</div>
        <h1 id="settings-title" data-route-heading tabindex="-1">Play your way.</h1>
        <p>Cloud Hop follows your device's reduced-motion preference. More play controls are coming soon.</p>
      </header>
      <div class="settings-preview" aria-label="Upcoming settings">
        <div><span>Reduced motion</span><strong>Follows device</strong></div>
        <div><span>Sound</span><strong>Coming soon</strong></div>
        <div><span>Vibration</span><strong>Coming soon</strong></div>
        <div><span>Orientation</span><strong>Responsive</strong></div>
      </div>
    </section>
    </main>

    <nav class="bottom-nav" aria-label="Mobile navigation">
      <a href="/" data-route="/"><span aria-hidden="true">⌂</span><small>Menu</small></a>
      <a href="/play" data-route="/play"><span aria-hidden="true">▶</span><small>Play</small></a>
      <a href="/dashboard" data-route="/dashboard"><span aria-hidden="true">▦</span><small>Dashboard</small></a>
      <a href="/leaderboard" data-route="/leaderboard"><span aria-hidden="true">≡</span><small>Ranks</small></a>
      <a href="/profile" data-route="/profile"><span aria-hidden="true">●</span><small>Profile</small></a>
    </nav>

    <footer>
      <span>NEAR Arcade</span>
      <span class="footer-links">
        <a data-contract-proof target="_blank" rel="noreferrer">Contract ↗</a>
      </span>
      <span>Built for NEAR Testnet</span>
    </footer>
  </div>

  <dialog class="auth-dialog" data-auth-dialog aria-labelledby="auth-title" aria-describedby="auth-description" aria-busy="false">
    <button type="button" class="dialog-close" data-action="close-auth" aria-label="Close">×</button>
    <span class="detail-label">Choose your path</span>
    <h2 id="auth-title">Connect to NEAR Arcade</h2>
    <p class="dialog-intro" id="auth-description">
      Use an existing Meteor wallet, or sign in with Google and receive a new
      Testnet wallet funded only for onboarding and play setup.
    </p>
    <div class="auth-options">
      <button type="button" class="auth-option" data-auth="wallet">
        <span class="auth-icon">M</span>
        <span><strong>Meteor wallet</strong><small>Connect a Meteor Testnet wallet</small></span>
        <b>→</b>
      </button>
      <button type="button" class="auth-option" data-auth="google" disabled>
        <span class="auth-icon google-icon">G</span>
        <span><strong>Continue with Google</strong><small>A Testnet account is created for you</small></span>
        <b>→</b>
      </button>
    </div>
  </dialog>
  <dialog class="auth-dialog notice-dialog" data-google-disabled-dialog aria-labelledby="google-disabled-title" aria-describedby="google-disabled-description">
    <button type="button" class="dialog-close" data-action="close-google-disabled" aria-label="Close">×</button>
    <span class="detail-label">Netlify deployment</span>
    <h2 id="google-disabled-title">Google sign-in is unavailable</h2>
    <p class="dialog-intro" id="google-disabled-description">
      Google sign-in is not supported on this hosted Netlify demo because its
      FastAuth callback cannot be enabled here. It remains available when Cloud
      Hop is run locally with an approved FastAuth configuration.
    </p>
    <p class="notice-copy">Connect with Meteor Wallet to save your scores on this deployment.</p>
    <button type="button" class="primary-button notice-button" data-action="close-google-disabled">
      Got it <span>✓</span>
    </button>
  </dialog>
  </div>
`;

const requireElement = <ElementType extends Element>(selector: string): ElementType => {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Required element was not found: ${selector}`);
  return element;
};

const gameRoot = requireElement<HTMLElement>("[data-game-root]");
const statusElement = requireElement<HTMLElement>("[data-status]");
const connectButton = requireElement<HTMLButtonElement>("[data-action='open-auth']");
const accountMenu = requireElement<HTMLElement>("[data-account-menu]");
const accountLink = requireElement<HTMLAnchorElement>("[data-account-link]");
const playerLabel = requireElement<HTMLElement>("[data-player-label]");
const playerMethod = requireElement<HTMLElement>("[data-player-method]");
const playerLink = requireElement<HTMLAnchorElement>("[data-player-link]");
const playerBest = requireElement<HTMLElement>("[data-player-best]");
const playerRuns = requireElement<HTMLElement>("[data-player-runs]");
const playerLatest = requireElement<HTMLElement>("[data-player-latest]");
const playerStats = requireElement<HTMLElement>("[data-player-stats]");
const bestBlockLink = requireElement<HTMLAnchorElement>("[data-best-block-link]");
const authDialog = requireElement<HTMLDialogElement>("[data-auth-dialog]");
const googleDisabledDialog = requireElement<HTMLDialogElement>(
  "[data-google-disabled-dialog]",
);
const walletButton = requireElement<HTMLButtonElement>("[data-auth='wallet']");
const googleButton = requireElement<HTMLButtonElement>("[data-auth='google']");
const leaderboardRowsElement = requireElement<HTMLElement>("[data-leaderboard-rows]");
const leaderboardPanel = requireElement<HTMLElement>("#leaderboard-panel");
const leaderboardTable = requireElement<HTMLElement>("#leaderboard-table");
const leaderboardStatus = requireElement<HTMLElement>("[data-leaderboard-status]");
const leaderboardMore = requireElement<HTMLButtonElement>("[data-action='load-leaderboard']");
const leaderboardRetry = requireElement<HTMLButtonElement>("[data-action='retry-leaderboard']");
const tournamentSection = requireElement<HTMLElement>("[data-tournament-section]");
const tournamentStatus = requireElement<HTMLElement>("[data-tournament-status]");
const tournamentName = requireElement<HTMLElement>("[data-tournament-name]");
const tournamentWindow = requireElement<HTMLElement>("[data-tournament-window]");
const tournamentRuleset = requireElement<HTMLElement>("[data-tournament-ruleset]");
const tournamentParticipants = requireElement<HTMLElement>("[data-tournament-participants]");
const tournamentReward = requireElement<HTMLElement>("[data-tournament-reward]");
const tournamentJoin = requireElement<HTMLButtonElement>("[data-action='join-tournament']");
const tournamentAction = requireElement<HTMLElement>("[data-tournament-action]");
const tournamentContract = requireElement<HTMLAnchorElement>("[data-tournament-contract]");
const tournamentRegistration = requireElement<HTMLAnchorElement>(
  "[data-tournament-registration]",
);
const tournamentRetry = requireElement<HTMLButtonElement>("[data-action='retry-tournament']");
const tournamentRowsElement = requireElement<HTMLElement>("[data-tournament-rows]");
const tournamentRankingStatus = requireElement<HTMLElement>("[data-tournament-ranking-status]");
const achievementRowsElement = requireElement<HTMLElement>("[data-achievement-rows]");
const achievementCount = requireElement<HTMLElement>("[data-achievement-count]");
const contractProof = requireElement<HTMLAnchorElement>("[data-contract-proof]");
const bootScreen = requireElement<HTMLElement>("[data-boot]");
const bootStatus = requireElement<HTMLElement>("[data-boot-status]");
const bootActions = requireElement<HTMLElement>("[data-boot-actions]");
const appFrame = requireElement<HTMLElement>("[data-app]");
const routeAnnouncer = requireElement<HTMLElement>("[data-route-announcer]");
const menuPlayer = requireElement<HTMLElement>("[data-menu-player]");
const menuPlayerMethod = requireElement<HTMLElement>("[data-menu-player-method]");
const menuTournamentName = requireElement<HTMLElement>("[data-menu-tournament-name]");
const menuTournamentCopy = requireElement<HTMLElement>("[data-menu-tournament-copy]");
const menuTournamentStatus = requireElement<HTMLElement>("[data-menu-tournament-status]");
const profileName = requireElement<HTMLElement>("[data-profile-name]");
const profileMethod = requireElement<HTMLElement>("[data-profile-method]");
const profileCopy = requireElement<HTMLElement>("[data-profile-copy]");
const profileConnect = requireElement<HTMLButtonElement>("[data-profile-connect]");
const profileLink = requireElement<HTMLAnchorElement>("[data-profile-link]");

const routeScreens = [
  ...root.querySelectorAll<HTMLElement>("[data-screen]"),
];
const routeLinks = [
  ...root.querySelectorAll<HTMLAnchorElement>("a[data-route]"),
];
let appReady = false;
const googleSignInDisabled = isNetlifyDeployment(window.location.hostname);

const renderRoute = ({ route, kind }: RouteChange): void => {
  for (const screen of routeScreens) {
    screen.hidden = screen.dataset.screen !== route;
  }
  for (const link of routeLinks) {
    const active = link.dataset.route === route;
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.body.dataset.route = route === "/" ? "menu" : route.slice(1);
  document.title =
    route === "/"
      ? "Cloud Hop · NEAR Arcade"
      : `${APP_ROUTES[route].title} · NEAR Arcade`;
  if (!appReady) return;

  routeAnnouncer.textContent = "";
  queueMicrotask(() => {
    routeAnnouncer.textContent = `${APP_ROUTES[route].label} screen opened.`;
  });
  if (kind !== "initial") window.scrollTo({ top: 0, behavior: "auto" });
  requestAnimationFrame(() => {
    const activeScreen = routeScreens.find((screen) => !screen.hidden);
    activeScreen
      ?.querySelector<HTMLElement>("[data-route-heading]")
      ?.focus({ preventScroll: true });
  });
};

const router = new AppRouter(renderRoute);
router.start();

let nearClient: NearArcadeClient | null = null;
let authBusy = false;
let authAttempt = 0;
let activeAuthMethod: "wallet" | "google" | null = null;
let leaderboardBusy = false;
let leaderboardRequestId = 0;
let leaderboardPeriod: LeaderboardPeriod = "all";
let leaderboardRows: LeaderboardRow[] = [];
let leaderboardNextCursor: number | null = null;
let currentTournament: Tournament | null = null;
let currentTournamentEntry: TournamentEntry | null = null;
let tournamentRows: LeaderboardRow[] = [];
let tournamentBusy = false;
let achievements: Achievement[] = [];
let sponsorConfigured = false;
let bootBusy = false;
let serviceRecoveryBusy = false;
let serviceRecoveryAttempt = 0;
let serviceRecoveryTimer: number | null = null;
let registrationProof: {
  readonly accountId: string;
  readonly tournamentId: string;
  readonly explorerUrl: string;
} | null = null;

const setStatus = (message: string, tone: "neutral" | "success" | "error" = "neutral"): void => {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
};

const renderPlayerStats = (response: PlayerStatsResponse | null): void => {
  playerStats.setAttribute("aria-busy", "false");
  if (response === null) {
    playerStats.setAttribute("aria-label", "Player statistics are available after connecting.");
    playerBest.textContent = "—";
    playerRuns.textContent = "—";
    playerLatest.textContent = "—";
    bestBlockLink.hidden = true;
    bestBlockLink.removeAttribute("href");
    return;
  }
  playerStats.setAttribute("aria-label", "Player statistics");
  const stats = response.stats;
  playerBest.textContent = String(stats?.personalBest ?? 0).padStart(2, "0");
  playerRuns.textContent = String(stats?.totalAcceptedRuns ?? 0).padStart(2, "0");
  playerLatest.textContent = String(stats?.latestScore ?? 0).padStart(2, "0");
  if (response.bestBlockExplorerUrl === null) {
    bestBlockLink.hidden = true;
    bestBlockLink.removeAttribute("href");
  } else {
    bestBlockLink.href = response.bestBlockExplorerUrl;
    bestBlockLink.hidden = false;
  }
};

const refreshPlayerStats = async (
  identity: ConnectedIdentity | null,
): Promise<void> => {
  if (identity === null) {
    renderPlayerStats(null);
    return;
  }
  playerStats.setAttribute("aria-busy", "true");
  playerStats.setAttribute("aria-label", "Loading player statistics");
  playerBest.textContent = "…";
  playerRuns.textContent = "…";
  playerLatest.textContent = "…";
  try {
    renderPlayerStats(await loadPlayerStats(identity.accountId));
  } catch {
    playerBest.textContent = "?";
    playerRuns.textContent = "?";
    playerLatest.textContent = "?";
    bestBlockLink.hidden = true;
    playerStats.setAttribute("aria-busy", "false");
    playerStats.setAttribute("aria-label", "Player statistics are unavailable.");
  }
};

const createCell = (
  text: string,
  className?: string,
  role?: "cell",
): HTMLSpanElement => {
  const cell = document.createElement("span");
  cell.textContent = text;
  if (className !== undefined) cell.className = className;
  if (role !== undefined) cell.setAttribute("role", role);
  return cell;
};

const renderTournamentRows = (): void => {
  tournamentRowsElement.replaceChildren();
  if (tournamentRows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "compact-empty";
    empty.textContent =
      currentTournament === null
        ? "No weekly tournament is scheduled."
        : "No eligible tournament score has landed yet.";
    tournamentRowsElement.append(empty);
    return;
  }
  const currentPlayer = nearClient?.identity?.accountId ?? null;
  for (const entry of tournamentRows.slice(0, 5)) {
    const row = document.createElement("a");
    row.className = "tournament-row";
    row.setAttribute("role", "listitem");
    row.href = entry.blockExplorerUrl ?? entry.playerExplorerUrl;
    row.target = "_blank";
    row.rel = "noreferrer";
    if (entry.playerId === currentPlayer) row.dataset.currentPlayer = "true";
    row.append(
      createCell(`#${entry.rank}`, "rank-cell"),
      createCell(
        `${compactAccountId(entry.playerId)}${
          entry.playerId === currentPlayer ? " · you" : ""
        }`,
      ),
      createCell(String(entry.score).padStart(2, "0"), "score-cell"),
    );
    tournamentRowsElement.append(row);
  }
};

const renderAchievements = (): void => {
  achievementRowsElement.replaceChildren();
  achievementCount.textContent = `${achievements.length} earned`;
  if (achievements.length === 0) {
    const empty = document.createElement("p");
    empty.className = "compact-empty";
    empty.textContent =
      nearClient?.identity === null || nearClient === null
        ? "Connect to view account-bound achievements."
        : "Complete a verified run to earn the first badges.";
    achievementRowsElement.append(empty);
    return;
  }
  for (const achievement of achievements.slice(0, 8)) {
    const badge = document.createElement("article");
    badge.className = "achievement-badge";
    const icon = document.createElement("span");
    icon.textContent =
      achievement.kind === "tournament-podium"
        ? String(achievement.rank ?? "★")
        : achievement.kind === "tournament-participant"
          ? "T"
          : achievement.kind === "score-milestone"
            ? String(achievement.score ?? "S")
            : "✓";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = achievement.title;
    const description = document.createElement("small");
    description.textContent = achievement.description;
    copy.append(title, description);
    badge.append(icon, copy);
    achievementRowsElement.append(badge);
  }
};

const renderTournament = (): void => {
  tournamentJoin.setAttribute("aria-busy", String(tournamentBusy));
  const tournament = currentTournament;
  if (tournament === null) {
    delete tournamentStatus.dataset.state;
    tournamentStatus.textContent = "Unscheduled";
    delete menuTournamentStatus.dataset.state;
    menuTournamentStatus.textContent = "Unscheduled";
    menuTournamentName.textContent = "No current tournament";
    menuTournamentCopy.textContent = "Verified standard runs remain available.";
    tournamentName.textContent = "No current tournament";
    tournamentWindow.textContent = "The operator has not scheduled the next week.";
    tournamentRuleset.textContent = "—";
    tournamentParticipants.textContent = "0";
    tournamentReward.textContent = "No token reward";
    tournamentJoin.disabled = true;
    tournamentJoin.firstChild!.textContent = "Tournament unavailable ";
    tournamentAction.textContent = "Regular verified runs remain available.";
    tournamentContract.hidden = true;
    tournamentRegistration.hidden = true;
    tournamentRankingStatus.textContent = "Waiting for a schedule";
    renderTournamentRows();
    return;
  }

  tournamentStatus.textContent = tournament.status;
  tournamentStatus.dataset.state = tournament.status;
  menuTournamentStatus.textContent = tournament.status;
  menuTournamentStatus.dataset.state = tournament.status;
  menuTournamentName.textContent = tournament.tournamentId;
  menuTournamentCopy.textContent = `${tournament.participantCount}/${tournament.maxParticipants} pilots · ${formatChainTimestamp(tournament.endAtNs)} close`;
  tournamentName.textContent = tournament.tournamentId;
  tournamentWindow.textContent = `${formatChainTimestamp(tournament.startAtNs)} → ${formatChainTimestamp(tournament.endAtNs)}`;
  tournamentRuleset.textContent = tournament.rulesetVersion;
  tournamentParticipants.textContent = `${tournament.participantCount}/${tournament.maxParticipants}`;
  tournamentReward.textContent = "No token reward";
  tournamentRankingStatus.textContent = `${tournamentRows.length} ranked · top 100 bounded`;
  tournamentContract.hidden = false;
  const identity = nearClient?.identity ?? null;
  const matchingRegistrationProof =
    registrationProof !== null &&
    registrationProof.tournamentId === tournament.tournamentId &&
    registrationProof.accountId === identity?.accountId
      ? registrationProof
      : null;
  if (matchingRegistrationProof === null) {
    tournamentRegistration.hidden = true;
    tournamentRegistration.removeAttribute("href");
  } else {
    tournamentRegistration.href = matchingRegistrationProof.explorerUrl;
    tournamentRegistration.hidden = false;
  }

  const registrationOpen =
    tournament.status !== "closed" &&
    tournament.status !== "finalized" &&
    BigInt(Date.now()) * 1_000_000n < BigInt(tournament.registrationEndsAtNs);
  if (currentTournamentEntry !== null) {
    tournamentJoin.disabled = true;
    tournamentJoin.firstChild!.textContent = "Registered ";
    tournamentAction.textContent =
      tournament.status === "active"
        ? `${currentTournamentEntry.acceptedRuns} eligible run${
            currentTournamentEntry.acceptedRuns === 1 ? "" : "s"
          } · new sessions enter this tournament automatically.`
        : `Registration confirmed · best ${currentTournamentEntry.bestScore ?? "—"}.`;
  } else if (identity === null) {
    tournamentJoin.disabled = true;
    tournamentJoin.firstChild!.textContent = "Connect to join ";
    tournamentAction.textContent = "A NEAR account is required for explicit registration.";
  } else if (registrationOpen) {
    tournamentJoin.disabled = tournamentBusy;
    tournamentJoin.firstChild!.textContent = tournamentBusy
      ? "Confirming… "
      : "Join tournament ";
    tournamentAction.textContent = "Free registration · no wager and no token prize.";
  } else {
    tournamentJoin.disabled = true;
    tournamentJoin.firstChild!.textContent = "Registration closed ";
    tournamentAction.textContent =
      tournament.status === "finalized"
        ? `Final result ${tournament.resultHash?.slice(0, 10) ?? "recorded"}… is frozen on-chain.`
        : "Late registration and late tournament scores are rejected.";
  }
  renderTournamentRows();
};

const refreshAchievements = async (
  identity: ConnectedIdentity | null,
): Promise<void> => {
  if (identity === null) {
    achievements = [];
    renderAchievements();
    return;
  }
  achievementCount.textContent = "Loading…";
  try {
    const page = await loadPlayerAchievements(identity.accountId);
    if (nearClient?.identity?.accountId !== identity.accountId) return;
    achievements = [...page.rows];
    renderAchievements();
  } catch {
    achievements = [];
    achievementCount.textContent = "Unavailable";
    achievementRowsElement.innerHTML =
      '<div class="compact-empty"><p>Achievements could not be read from Testnet.</p><button type="button" class="text-button" data-action="retry-achievements">Retry badges</button></div>';
  }
};

const refreshTournament = async (
  identity: ConnectedIdentity | null = nearClient?.identity ?? null,
): Promise<void> => {
  tournamentSection.setAttribute("aria-busy", "true");
  tournamentRetry.hidden = true;
  tournamentRankingStatus.textContent = "Reading Testnet…";
  try {
    const response = await loadCurrentTournament();
    currentTournament = response.tournament;
    tournamentContract.href = response.contractExplorerUrl;
    currentTournamentEntry = null;
    tournamentRows = [];
    if (currentTournament !== null) {
      const [ranking, entry] = await Promise.all([
        loadTournamentLeaderboardPage(currentTournament.tournamentId, 0, 10),
        identity === null
          ? Promise.resolve(null)
          : loadTournamentEntry(currentTournament.tournamentId, identity.accountId),
      ]);
      if (
        identity !== null &&
        nearClient?.identity?.accountId !== identity.accountId
      ) {
        return;
      }
      tournamentRows = [...ranking.rows];
      currentTournamentEntry = entry?.entry ?? null;
    }
    renderTournament();
  } catch {
    currentTournament = null;
    currentTournamentEntry = null;
    tournamentRows = [];
    renderTournament();
    tournamentStatus.textContent = "Unavailable";
    tournamentName.textContent = "Tournament read failed";
    tournamentWindow.textContent = "Testnet tournament state could not be loaded.";
    delete menuTournamentStatus.dataset.state;
    menuTournamentStatus.textContent = "Unavailable";
    menuTournamentName.textContent = "Tournament read failed";
    menuTournamentCopy.textContent = "Open the tournament screen to retry the Testnet read.";
    tournamentRetry.hidden = false;
  } finally {
    tournamentSection.setAttribute("aria-busy", "false");
  }
};

const renderLeaderboardRows = (): void => {
  leaderboardRowsElement.replaceChildren();
  if (leaderboardRows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "leaderboard-empty";
    empty.setAttribute("role", "status");
    empty.textContent =
      leaderboardBusy
        ? "Loading on-chain rankings…"
        : leaderboardPeriod === "daily"
          ? "No verified scores have landed today."
          : "No verified scores have landed yet.";
    leaderboardRowsElement.append(empty);
    return;
  }

  const currentPlayer = nearClient?.identity?.accountId ?? null;
  for (const entry of leaderboardRows) {
    const row = document.createElement("div");
    row.className = "leaderboard-row";
    row.setAttribute("role", "row");
    if (entry.playerId === currentPlayer) row.dataset.currentPlayer = "true";
    row.append(
      createCell(`#${entry.rank.toString().padStart(2, "0")}`, "rank-cell", "cell"),
    );

    const player = document.createElement("a");
    player.className = "pilot-cell";
    player.href = entry.playerExplorerUrl;
    player.target = "_blank";
    player.rel = "noreferrer";
    player.setAttribute("role", "cell");
    player.textContent = `${compactAccountId(entry.playerId)}${
      entry.playerId === currentPlayer ? " · you" : ""
    }`;
    row.append(player);
    row.append(createCell(String(entry.score).padStart(2, "0"), "score-cell", "cell"));
    row.append(
      createCell(formatChainTimestamp(entry.acceptedAtNs), "time-cell", "cell"),
    );

    const proof = document.createElement("a");
    proof.className = "proof-cell";
    proof.href = entry.blockExplorerUrl ?? entry.playerExplorerUrl;
    proof.target = "_blank";
    proof.rel = "noreferrer";
    proof.setAttribute("role", "cell");
    proof.textContent = entry.blockExplorerUrl === null ? "Account ↗" : "Block ↗";
    row.append(proof);
    leaderboardRowsElement.append(row);
  }
};

const loadLeaderboard = async (reset: boolean): Promise<void> => {
  if (leaderboardBusy && !reset) return;
  const requestedPeriod = leaderboardPeriod;
  const cursor = reset ? 0 : leaderboardNextCursor;
  if (!reset && cursor === null) return;
  const requestId = ++leaderboardRequestId;
  leaderboardBusy = true;
  leaderboardTable.setAttribute("aria-busy", "true");
  leaderboardMore.disabled = true;
  leaderboardRetry.hidden = true;
  if (reset) {
    leaderboardStatus.textContent = "Loading on-chain rankings…";
    leaderboardRows = [];
    renderLeaderboardRows();
  }
  try {
    const page = await loadLeaderboardPage(requestedPeriod, cursor ?? 0, 10);
    if (
      requestId !== leaderboardRequestId ||
      requestedPeriod !== leaderboardPeriod
    ) {
      return;
    }
    leaderboardRows = reset ? [...page.rows] : [...leaderboardRows, ...page.rows];
    leaderboardNextCursor = page.nextCursor;
    renderLeaderboardRows();
    leaderboardMore.hidden = page.nextCursor === null;
    leaderboardRetry.hidden = true;
    leaderboardStatus.textContent = `${page.total} ranked pilot${
      page.total === 1 ? "" : "s"
    } · ${page.period === "daily" ? "current UTC day" : "all time"} · on-chain source`;
  } catch (error) {
    if (requestId !== leaderboardRequestId) return;
    if (reset) leaderboardRows = [];
    renderLeaderboardRows();
    leaderboardMore.hidden = true;
    leaderboardRetry.hidden = false;
    leaderboardStatus.textContent = `Rankings unavailable: ${describeNearError(error)}`;
  } finally {
    if (requestId === leaderboardRequestId) {
      leaderboardBusy = false;
      leaderboardTable.setAttribute("aria-busy", "false");
      leaderboardMore.disabled = false;
    }
  }
};

const renderIdentity = (identity: ConnectedIdentity | null): void => {
  if (identity === null) {
    connectButton.hidden = false;
    accountMenu.hidden = true;
    menuPlayer.textContent = "Guest pilot";
    menuPlayerMethod.textContent = "Connect only when you want verified scores.";
    playerLabel.textContent = "Guest pilot";
    playerMethod.textContent = "Local runs need no wallet.";
    playerLink.hidden = true;
    profileName.textContent = "Guest pilot";
    profileMethod.textContent = "Local runs stay on this device.";
    profileCopy.textContent =
      "Connect a NEAR account to load verified statistics and account-bound achievements.";
    profileConnect.hidden = false;
    profileLink.hidden = true;
    profileLink.removeAttribute("href");
    void refreshPlayerStats(null);
    void refreshAchievements(null);
    void refreshTournament(null);
    renderLeaderboardRows();
    return;
  }

  connectButton.hidden = true;
  accountMenu.hidden = false;
  menuPlayer.textContent = compactAccountId(identity.accountId);
  menuPlayerMethod.textContent =
    identity.method === "google" ? "Google-created Testnet wallet" : "Connected Meteor wallet";
  accountLink.href = identity.explorerUrl;
  accountLink.textContent = compactAccountId(identity.accountId);
  playerLabel.textContent = compactAccountId(identity.accountId);
  playerMethod.textContent =
    identity.method === "google"
      ? "Signed in with Google"
      : "Meteor wallet";
  playerLink.href = identity.explorerUrl;
  playerLink.hidden = false;
  profileName.textContent = compactAccountId(identity.accountId);
  profileMethod.textContent =
    identity.method === "google"
      ? "Signed in with Google"
      : "Meteor wallet";
  profileCopy.textContent =
    "Your saved scores, rankings, and achievements are available to this account.";
  profileConnect.hidden = true;
  profileLink.href = identity.explorerUrl;
  profileLink.hidden = false;
  void refreshPlayerStats(identity);
  void refreshAchievements(identity);
  void refreshTournament(identity);
  renderLeaderboardRows();
};

const selectLeaderboardPeriod = (
  period: LeaderboardPeriod,
  moveFocus = false,
): void => {
  const buttons = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-leaderboard-period]"),
  ];
  for (const button of buttons) {
    const selected = button.dataset.leaderboardPeriod === period;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected) {
      leaderboardPanel.setAttribute("aria-labelledby", button.id);
      if (moveFocus) button.focus();
    }
  }
  if (period === leaderboardPeriod && leaderboardRows.length > 0) return;
  leaderboardPeriod = period;
  leaderboardRows = [];
  leaderboardNextCursor = null;
  void loadLeaderboard(true);
};

const setAuthBusy = (busy: boolean): void => {
  authBusy = busy;
  authDialog.setAttribute("aria-busy", String(busy));
  if (busy) authDialog.dataset.busy = "true";
  else delete authDialog.dataset.busy;
  walletButton.disabled = busy;
  googleButton.disabled = busy || !sponsorConfigured;
};

new CloudHopGame(gameRoot, {
  createSession: async () => {
    const client = nearClient;
    if (client?.identity === null || client === null) return null;
    setStatus("Approve the request to begin your flight.");
    const tournamentId =
      currentTournament?.status === "active" && currentTournamentEntry !== null
        ? currentTournament.tournamentId
        : null;
    const result = await client.createSession(tournamentId);
    setStatus("Run ready. Get set for the countdown.", "success");
    return {
      gameSeed: gameSeedFromChainSeed(result.session.seed),
      sessionId: result.session.sessionId,
      transactionUrl: result.explorerUrl,
    };
  },
  submitReplay: async (session, replay, score) => {
    const client = nearClient;
    if (client === null || client.identity === null) {
      throw new Error("Reconnect the session owner before submitting this score.");
    }
    setStatus("Saving your score…");
    const result = await client.submitReplay(session.sessionId, replay, score);
    setStatus(
      `Score ${result.record.score} saved.`,
      "success",
    );
    void refreshPlayerStats(client.identity);
    void refreshAchievements(client.identity);
    void refreshTournament(client.identity);
    void loadLeaderboard(true);
    return {
      score: result.record.score,
      transactionUrl: result.explorerUrl,
    };
  },
  onError: (error) => setStatus(describeNearError(error), "error"),
  onImmersiveChange: (immersive) => {
    document.body.classList.toggle("game-immersive", immersive);
    appFrame.dataset.gameState = immersive ? "active" : "preflight";
    if (immersive) window.scrollTo({ top: 0, behavior: "auto" });
  },
});

root.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const routeLink = target.closest<HTMLAnchorElement>("a[data-route]");
  if (
    routeLink !== null &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  ) {
    const route = parseAppRoute(routeLink.dataset.route ?? "");
    if (route !== null) {
      event.preventDefault();
      router.navigate(route);
      return;
    }
  }
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  const selectedPeriod = target.closest<HTMLElement>(
    "[data-leaderboard-period]",
  )?.dataset.leaderboardPeriod;
  if (
    (selectedPeriod === "all" || selectedPeriod === "daily") &&
    selectedPeriod !== leaderboardPeriod
  ) {
    selectLeaderboardPeriod(selectedPeriod);
  }
  if (action === "load-leaderboard") void loadLeaderboard(false);
  if (action === "retry-leaderboard") void loadLeaderboard(true);
  if (action === "retry-tournament") void refreshTournament();
  if (action === "retry-achievements") {
    void refreshAchievements(nearClient?.identity ?? null);
  }
  if (action === "retry-boot") void runBoot();
  if (action === "continue-guest") continueAsGuest();
  if (
    action === "join-tournament" &&
    nearClient !== null &&
    nearClient.identity !== null &&
    currentTournament !== null &&
    !tournamentBusy
  ) {
    tournamentBusy = true;
    renderTournament();
    setStatus("Confirm the free tournament registration transaction.");
    void nearClient
      .joinTournament(currentTournament.tournamentId)
      .then((result) => {
        currentTournamentEntry = result.entry;
        registrationProof = {
          accountId: result.entry.playerId,
          tournamentId: result.entry.tournamentId,
          explorerUrl: result.explorerUrl,
        };
        setStatus("Tournament registration confirmed on NEAR Testnet.", "success");
        return refreshTournament(nearClient?.identity ?? null);
      })
      .catch((error: unknown) => setStatus(describeNearError(error), "error"))
      .finally(() => {
        tournamentBusy = false;
        renderTournament();
      });
  }
  if (action === "open-auth") {
    if (nearClient === null) {
      setStatus("Wallet services are not ready. Check the API configuration.", "error");
    } else {
      if (authBusy && activeAuthMethod === "wallet") {
        authAttempt += 1;
        activeAuthMethod = null;
        setStatus(
          "Resetting the selected wallet and its pending authorization…",
        );
        void nearClient
          .resetWalletConnection()
          .then((recovery) => {
            const walletLabel = recovery.walletId === null
              ? "wallet"
              : "selected wallet";
            setStatus(
              recovery.adapterSignOutCompleted
                ? `The ${walletLabel} was signed out and reset. Choose a sign-in path to reconnect.`
                : recovery.adapterSignOutAttempted
                  ? `Local connector state was reset, but the ${walletLabel} did not confirm sign-out. Try it again; if it remains stuck, disconnect this site once inside that wallet.`
                  : `The ${walletLabel} connection was reset. Choose a sign-in path to reconnect.`,
              recovery.adapterSignOutAttempted && !recovery.adapterSignOutCompleted
                ? "error"
                : "success",
            );
          })
          .catch((error: unknown) => setStatus(describeNearError(error), "error"))
          .finally(() => {
            setAuthBusy(false);
            if (!authDialog.open) authDialog.showModal();
          });
        return;
      } else if (authBusy) {
        setStatus("Finish or close the current sign-in before starting another.");
        return;
      }
      authDialog.showModal();
    }
  }
  if (action === "close-auth") authDialog.close();
  if (action === "close-google-disabled") googleDisabledDialog.close();
  if (action === "logout" && nearClient !== null && !authBusy) {
    setAuthBusy(true);
    void nearClient
      .disconnect()
      .then(() => setStatus("Disconnected. Guest play remains available.", "success"))
      .catch((error: unknown) => setStatus(describeNearError(error), "error"))
      .finally(() => {
        setAuthBusy(false);
      });
  }
});

root.addEventListener("keydown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  if (target.dataset.leaderboardPeriod === undefined) return;
  const tabs = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-leaderboard-period]"),
  ];
  const currentIndex = tabs.indexOf(target);
  if (currentIndex < 0) return;
  let nextIndex: number | null = null;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  const period = tabs[nextIndex]?.dataset.leaderboardPeriod;
  if (period === "all" || period === "daily") selectLeaderboardPeriod(period, true);
});

authDialog.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element) || authBusy || nearClient === null) return;
  const method = target.closest<HTMLElement>("[data-auth]")?.dataset.auth;
  if (method !== "wallet" && method !== "google") return;
  if (method === "google" && googleSignInDisabled) {
    authDialog.close();
    googleDisabledDialog.showModal();
    return;
  }

  const attempt = authAttempt + 1;
  authAttempt = attempt;
  activeAuthMethod = method;
  setAuthBusy(true);
  setStatus(
    method === "google"
      ? "Opening Google sign-in and preparing your NEAR wallet…"
      : "Opening the Meteor wallet connector…",
  );
  authDialog.close();
  const request =
    method === "google" ? nearClient.connectGoogle() : nearClient.connectWallet();
  void request
    .then((identity) => {
      if (attempt !== authAttempt) return;
      setStatus(
        `${compactAccountId(identity.accountId)} is connected on Testnet.`,
        "success",
      );
    })
    .catch((error: unknown) => {
      if (attempt !== authAttempt) return;
      setStatus(describeNearError(error), "error");
      if (!authDialog.open) authDialog.showModal();
    })
    .finally(() => {
      if (attempt !== authAttempt) return;
      activeAuthMethod = null;
      setAuthBusy(false);
    });
});

const initializeNear = async (): Promise<void> => {
  try {
    const configuration = await loadArcadeConfiguration();
    sponsorConfigured = configuration.sponsorConfigured;
    setAuthBusy(false);
    if (!configuration.sponsorConfigured) {
      googleButton.title = "Google sign-in is temporarily unavailable.";
    } else if (googleSignInDisabled) {
      googleButton.title = "Google sign-in is unavailable on this Netlify deployment.";
    }
    contractProof.href = `${configuration.explorerUrl}/address/${encodeURIComponent(configuration.contractId)}`;
    nearClient = await NearArcadeClient.create(configuration);
    nearClient.onIdentityChanged(renderIdentity);
    if (configuration.contractId.length === 0) {
      setStatus(
        "Guest play is ready. Saved scores are temporarily unavailable.",
      );
    } else if (nearClient.identity === null) {
      setStatus(
        configuration.verifierConfigured
          ? "Guest play is ready. Connect to save scores."
          : "Guest play is ready. Saved scores are temporarily unavailable.",
        configuration.verifierConfigured ? "success" : "error",
      );
    } else {
      setStatus(
        `${compactAccountId(nearClient.identity.accountId)} restored on Testnet.`,
        "success",
      );
    }
    void loadLeaderboard(true);
  } catch (error) {
    setStatus(
      `Guest play is ready, but wallet services are unavailable: ${describeNearError(error)}`,
      "error",
    );
    void loadLeaderboard(true);
    void refreshTournament(null);
    void refreshAchievements(null);
    throw error;
  }
};

const finishBoot = (): void => {
  appReady = true;
  bootScreen.hidden = true;
  appFrame.hidden = false;
  document.body.classList.add("app-ready");
  router.refresh("initial");
};

const setBootBusy = (busy: boolean): void => {
  bootBusy = busy;
  bootScreen.setAttribute("aria-busy", String(busy));
  for (const button of bootActions.querySelectorAll<HTMLButtonElement>("button")) {
    button.disabled = busy;
  }
};

const scheduleServiceRecovery = (): void => {
  if (nearClient !== null || serviceRecoveryAttempt >= 3) return;
  if (serviceRecoveryTimer !== null) window.clearTimeout(serviceRecoveryTimer);
  const delays = [2_000, 5_000, 10_000] as const;
  const delay = delays[serviceRecoveryAttempt] ?? 10_000;
  serviceRecoveryTimer = window.setTimeout(() => {
    serviceRecoveryTimer = null;
    void recoverServices();
  }, delay);
};

const recoverServices = async (): Promise<void> => {
  if (nearClient !== null || serviceRecoveryBusy) return;
  serviceRecoveryBusy = true;
  setStatus("Connectivity returned. Restoring wallet and Testnet services…");
  try {
    await initializeNear();
    serviceRecoveryAttempt = 0;
  } catch {
    serviceRecoveryAttempt += 1;
    setStatus(
      "Guest play remains ready. Wallet services will retry when connectivity returns.",
      "error",
    );
    scheduleServiceRecovery();
  } finally {
    serviceRecoveryBusy = false;
  }
};

const continueAsGuest = (): void => {
  if (bootBusy) return;
  renderIdentity(null);
  setStatus(
    "Guest play is ready. Wallet and on-chain actions can be retried after connectivity returns.",
    "error",
  );
  finishBoot();
  serviceRecoveryAttempt = 0;
  scheduleServiceRecovery();
};

const runBoot = async (): Promise<void> => {
  if (bootBusy) return;
  setBootBusy(true);
  bootActions.hidden = true;
  bootStatus.dataset.tone = "neutral";
  bootStatus.textContent = "Loading public configuration, identity, and Testnet access…";
  try {
    await initializeNear();
    bootStatus.textContent = "Runway ready.";
    bootStatus.dataset.tone = "success";
    if (serviceRecoveryTimer !== null) window.clearTimeout(serviceRecoveryTimer);
    serviceRecoveryTimer = null;
    serviceRecoveryAttempt = 0;
    finishBoot();
  } catch (error) {
    bootStatus.textContent = `Arcade services could not finish loading: ${describeNearError(error)}`;
    bootStatus.dataset.tone = "error";
    bootActions.hidden = false;
  } finally {
    setBootBusy(false);
  }
};

window.addEventListener("online", () => {
  if (nearClient !== null) return;
  serviceRecoveryAttempt = 0;
  void recoverServices();
});

void runBoot();
