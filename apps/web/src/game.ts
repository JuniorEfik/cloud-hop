import {
  RULESET_V1,
  createInitialState,
  createReplay,
  stepGame,
  toPixels,
  verifyCompletedReplay,
  type GameReplay,
  type GameState,
} from "@near-arcade/game-core";

export type CloudHopGameMode =
  | "idle"
  | "countdown"
  | "running"
  | "paused"
  | "finished";

interface RunResult {
  readonly accepted: boolean;
  readonly score: number;
}

export interface GameStartSession {
  readonly gameSeed: number;
  readonly sessionId: string;
  readonly transactionUrl: string;
}

export interface GameSubmissionResult {
  readonly score: number;
  readonly transactionUrl: string;
}

export interface CloudHopGameOptions {
  readonly createSession?: () => Promise<GameStartSession | null>;
  readonly submitReplay?: (
    session: GameStartSession,
    replay: GameReplay,
    score: number,
  ) => Promise<GameSubmissionResult>;
  readonly onError?: (error: unknown) => void;
  readonly onImmersiveChange?: (immersive: boolean) => void;
}

const LOGICAL_WIDTH = toPixels(RULESET_V1.worldWidth);
const LOGICAL_HEIGHT = toPixels(RULESET_V1.worldHeight);
const TICK_DURATION = 1_000 / RULESET_V1.tickRate;
const MAX_FRAME_DELTA = 200;
const MAX_CATCH_UP_TICKS = 8;
const START_COUNTDOWN_SECONDS = 3;

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, durationMs));

const requireElement = <ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType => {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) {
    throw new Error(`Required element was not found: ${selector}`);
  }
  return element;
};

const createSeed = (): number => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] ?? 1;
};

const drawRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
};

const drawScene = (
  context: CanvasRenderingContext2D,
  state: GameState,
  mode: CloudHopGameMode,
  reducedMotion: boolean,
): void => {
  const width = LOGICAL_WIDTH;
  const height = LOGICAL_HEIGHT;
  const floorY = height - toPixels(RULESET_V1.groundHeight);
  const visualTick = reducedMotion ? 0 : state.tick;

  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#0a2330");
  sky.addColorStop(0.55, "#123644");
  sky.addColorStop(1, "#1c4c51");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.38;
  for (let index = 0; index < 24; index += 1) {
    const speed = 0.08 + (index % 3) * 0.04;
    const x = ((index * 83 - visualTick * speed) % 420 + 420) % 420 - 30;
    const y = 34 + ((index * 67) % 430);
    const size = 1 + (index % 3) * 0.55;
    context.fillStyle = index % 4 === 0 ? "#b9ff52" : "#dff9ee";
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  context.save();
  context.globalAlpha = 0.12;
  context.strokeStyle = "#d8fff1";
  context.lineWidth = 1;
  for (let x = -40; x < width + 80; x += 48) {
    const offset = (visualTick * 0.35) % 48;
    context.beginPath();
    context.moveTo(x - offset, floorY);
    context.lineTo(x + 90 - offset, 0);
    context.stroke();
  }
  context.restore();

  for (const obstacle of state.obstacles) {
    const x = toPixels(obstacle.x);
    const obstacleWidth = toPixels(RULESET_V1.obstacleWidth);
    const gapTop = toPixels(obstacle.gapTop);
    const gapBottom = gapTop + toPixels(RULESET_V1.obstacleGap);
    const capHeight = 18;

    context.save();
    context.shadowColor = "rgba(185, 255, 82, 0.45)";
    context.shadowBlur = 18;
    context.fillStyle = "#8ccf3f";
    drawRoundedRect(context, x, -8, obstacleWidth, gapTop - capHeight + 8, 8);
    drawRoundedRect(
      context,
      x,
      gapBottom + capHeight,
      obstacleWidth,
      floorY - gapBottom - capHeight + 8,
      8,
    );

    context.shadowBlur = 8;
    context.fillStyle = "#b9ff52";
    drawRoundedRect(context, x - 7, gapTop - capHeight, obstacleWidth + 14, capHeight, 6);
    drawRoundedRect(context, x - 7, gapBottom, obstacleWidth + 14, capHeight, 6);

    context.shadowBlur = 0;
    context.fillStyle = "rgba(8, 32, 36, 0.32)";
    context.fillRect(x + 11, 0, 8, Math.max(0, gapTop - capHeight));
    context.fillRect(
      x + 11,
      gapBottom + capHeight,
      8,
      Math.max(0, floorY - gapBottom),
    );
    context.restore();
  }

  const birdX = toPixels(RULESET_V1.birdX);
  const birdY = toPixels(state.birdY);
  const rotation = Math.max(-0.45, Math.min(0.75, state.birdVelocity / 11_000));

  context.save();
  context.translate(birdX, birdY);
  context.rotate(rotation);
  context.shadowColor = "rgba(185, 255, 82, 0.7)";
  context.shadowBlur = mode === "running" ? 20 : 12;
  context.fillStyle = "#d8ff7a";
  context.beginPath();
  context.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#082329";
  context.beginPath();
  context.moveTo(-3, -2);
  context.lineTo(-18, 5 + Math.sin(visualTick * 0.35) * 3);
  context.lineTo(-2, 7);
  context.closePath();
  context.fill();
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(7, -4, 4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#07141d";
  context.beginPath();
  context.arc(8.5, -4, 1.7, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ff8659";
  context.beginPath();
  context.moveTo(16, -1);
  context.lineTo(25, 2);
  context.lineTo(16, 5);
  context.closePath();
  context.fill();
  context.restore();

  const ground = context.createLinearGradient(0, floorY, 0, height);
  ground.addColorStop(0, "#173a36");
  ground.addColorStop(1, "#071b20");
  context.fillStyle = ground;
  context.fillRect(0, floorY, width, height - floorY);
  context.fillStyle = "#b9ff52";
  context.fillRect(0, floorY, width, 4);
  context.globalAlpha = 0.18;
  context.fillStyle = "#dfffb2";
  for (let x = -30; x < width + 30; x += 28) {
    const offset = reducedMotion ? 0 : (visualTick * 1.2) % 28;
    context.fillRect(x - offset, floorY + 18, 16, 2);
  }
  context.globalAlpha = 1;
};

export class CloudHopGame {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #scoreElement: HTMLElement;
  readonly #bestElement: HTMLElement;
  readonly #flightElement: HTMLElement;
  readonly #sessionLabelElement: HTMLElement;
  readonly #sessionLinkElement: HTMLAnchorElement;
  readonly #statusElement: HTMLElement;
  readonly #overlay: HTMLElement;
  readonly #pauseButton: HTMLButtonElement;
  readonly #pixelRatio: number;
  readonly #reducedMotion: boolean;
  readonly #options: CloudHopGameOptions;

  #state: GameState;
  #mode: CloudHopGameMode = "idle";
  #immersive = false;
  #seed: number;
  #flapTicks: number[] = [];
  #pendingFlap = false;
  #bestScore: number;
  #animationFrame = 0;
  #previousTime = performance.now();
  #accumulator = 0;
  #starting = false;
  #submitting = false;
  #session: GameStartSession | null = null;
  #completedRun: { readonly replay: GameReplay; readonly result: RunResult } | null =
    null;

  constructor(root: HTMLElement, options: CloudHopGameOptions = {}) {
    this.#options = options;
    this.#canvas = requireElement(root, "[data-canvas]");
    const context = this.#canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D rendering is not available.");
    }
    this.#context = context;
    this.#scoreElement = requireElement(root, "[data-score]");
    this.#bestElement = requireElement(root, "[data-best]");
    this.#flightElement = requireElement(root, "[data-flight]");
    this.#sessionLabelElement = requireElement(root, "[data-session-label]");
    this.#sessionLinkElement = requireElement(root, "[data-session-link]");
    this.#statusElement = requireElement(root, "[data-game-status]");
    this.#overlay = requireElement(root, "[data-overlay]");
    this.#pauseButton = requireElement(root, "[data-action='pause']");
    this.#pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.#reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.#seed = createSeed();
    this.#state = createInitialState(this.#seed);
    const storedBest = Number.parseInt(localStorage.getItem("cloud-hop-best") ?? "0", 10);
    this.#bestScore = Number.isFinite(storedBest) ? storedBest : 0;

    this.#canvas.width = Math.round(LOGICAL_WIDTH * this.#pixelRatio);
    this.#canvas.height = Math.round(LOGICAL_HEIGHT * this.#pixelRatio);
    this.#bestElement.textContent = this.#formatScore(this.#bestScore);
    this.#canvas.setAttribute("aria-busy", "false");

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const actionElement = target.closest<HTMLElement>("[data-action]");
      const action = actionElement?.dataset.action;
      if (action === "start" || action === "restart") void this.start();
      if (action === "submit-result") void this.#submitCompletedRun();
      if (action === "pause" || action === "resume") this.togglePause();
    });

    this.#canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.#canvas.focus();
      if (this.#mode === "idle" || this.#mode === "finished") void this.start();
      else if (this.#mode === "paused") this.togglePause();
      else this.queueFlap();
    });

    window.addEventListener("keydown", (event) => this.#handleKeyDown(event));
    this.#animationFrame = requestAnimationFrame((time) => this.#frame(time));
  }

  async start(): Promise<void> {
    if (
      this.#starting ||
      this.#submitting ||
      this.#mode === "running" ||
      this.#mode === "countdown" ||
      this.#mode === "paused"
    ) {
      return;
    }
    this.#starting = true;
    this.#setImmersive(true);
    this.#setAccessibleStatus(
      "Preparing the run. Connected players may need to approve a request.",
      true,
    );
    this.#overlay.hidden = false;
    delete this.#overlay.dataset.resultState;
    this.#overlay.className = "game-overlay pending-overlay";
    this.#overlay.innerHTML = `
      <span class="overlay-kicker">Preparing flight</span>
      <h2>Opening<br>the runway…</h2>
      <p>Approve the request if prompted.</p>
    `;

    try {
      this.#session = (await this.#options.createSession?.()) ?? null;
    } catch (error) {
      this.#setImmersive(false);
      this.#options.onError?.(error);
      this.#setAccessibleStatus(
        "The session was not started. Activate Try again when ready.",
        false,
      );
      this.#overlay.className = "game-overlay error-overlay";
      this.#overlay.innerHTML = `
        <span class="overlay-kicker">Session not started</span>
        <h2>Ready when<br>you are.</h2>
        <button type="button" class="primary-button" data-action="start">
          Try again <span>→</span>
        </button>
        <p>No run was started.</p>
      `;
      this.#focusOverlayAction();
      return;
    } finally {
      this.#starting = false;
    }

    this.#seed = this.#session?.gameSeed ?? createSeed();
    this.#state = createInitialState(this.#seed);
    this.#flapTicks = [];
    this.#completedRun = null;
    this.#pendingFlap = true;
    this.#accumulator = 0;
    if (this.#session === null) {
      this.#sessionLabelElement.textContent = "Guest session";
      this.#sessionLinkElement.hidden = true;
      this.#sessionLinkElement.removeAttribute("href");
    } else {
      this.#sessionLabelElement.textContent = "On-chain session";
      this.#sessionLinkElement.hidden = false;
      this.#sessionLinkElement.href = this.#session.transactionUrl;
      this.#sessionLinkElement.textContent = "View session ↗";
    }
    this.#scoreElement.textContent = "00";
    this.#flightElement.textContent = "0.0s";
    await this.#runStartCountdown();
    this.#setMode("running");
    this.#canvas.focus({ preventScroll: true });
  }

  queueFlap(): void {
    if (this.#mode === "running") this.#pendingFlap = true;
  }

  togglePause(): void {
    if (this.#mode === "running") this.#setMode("paused");
    else if (this.#mode === "paused") this.#setMode("running");
  }

  #formatScore(score: number): string {
    return score.toString().padStart(2, "0");
  }

  #setMode(mode: CloudHopGameMode): void {
    this.#mode = mode;
    this.#setImmersive(
      mode === "countdown" || mode === "running" || mode === "paused",
    );
    this.#pauseButton.disabled =
      mode === "idle" || mode === "countdown" || mode === "finished";
    this.#pauseButton.textContent = mode === "paused" ? "▶" : "Ⅱ";
    this.#pauseButton.ariaLabel = mode === "paused" ? "Resume game" : "Pause game";

    if (mode === "running") {
      this.#overlay.hidden = true;
      this.#setAccessibleStatus(
        "Flight active. Press Space or Arrow Up to flap. Press P or Escape to pause.",
        false,
      );
      queueMicrotask(() => this.#canvas.focus({ preventScroll: true }));
    } else if (mode === "paused") {
      this.#overlay.hidden = false;
      this.#overlay.className = "game-overlay pause-overlay";
      this.#overlay.innerHTML = `
        <span class="overlay-kicker">Run held safely</span>
        <h2>Paused</h2>
        <button type="button" class="primary-button" data-action="resume">
          Resume flight <span>→</span>
        </button>
      `;
      this.#setAccessibleStatus("Flight paused. Activate Resume flight to continue.", false);
      this.#focusOverlayAction();
    }
  }

  async #runStartCountdown(): Promise<void> {
    this.#setMode("countdown");
    this.#overlay.hidden = false;
    this.#overlay.className = "game-overlay countdown-overlay";
    delete this.#overlay.dataset.resultState;

    for (
      let remaining = START_COUNTDOWN_SECONDS;
      remaining >= 1;
      remaining -= 1
    ) {
      this.#overlay.innerHTML = `
        <span class="overlay-kicker">Session ready</span>
        <div class="countdown-number" data-countdown-value>${remaining}</div>
        <p>Flight begins automatically</p>
      `;
      this.#setAccessibleStatus(
        `Session confirmed. Flight begins in ${remaining} ${
          remaining === 1 ? "second" : "seconds"
        }.`,
        true,
      );
      await wait(1_000);
    }
  }

  #setImmersive(immersive: boolean): void {
    if (immersive === this.#immersive) return;
    this.#immersive = immersive;
    this.#options.onImmersiveChange?.(immersive);
  }

  #finish(finalState: GameState): void {
    const replay = createReplay(this.#seed, finalState.tick, this.#flapTicks);
    const verification = verifyCompletedReplay(replay);
    const result: RunResult = {
      accepted: verification.accepted && verification.state?.score === finalState.score,
      score: finalState.score,
    };
    this.#completedRun = { replay, result };

    this.#bestScore = Math.max(this.#bestScore, finalState.score);
    localStorage.setItem("cloud-hop-best", String(this.#bestScore));
    this.#bestElement.textContent = this.#formatScore(this.#bestScore);

    this.#setMode("finished");
    this.#overlay.hidden = false;
    this.#overlay.setAttribute("aria-live", "polite");
    if (!result.accepted) {
      this.#overlay.dataset.resultState = "rejected";
      this.#overlay.className = "game-overlay result-overlay error-overlay";
      this.#overlay.innerHTML = `
        <span class="overlay-kicker">Replay rejected locally</span>
        <div class="result-score">${result.score}</div>
        <p class="replay-fail"><i></i> Replay mismatch</p>
        <button type="button" class="primary-button" data-action="restart">
          Start a clean run <span>↻</span>
        </button>
      `;
      this.#setAccessibleStatus(
        `Run finished with score ${result.score}, but the local replay did not match.`,
        false,
      );
      this.#focusOverlayAction();
      return;
    }

    if (this.#session === null || this.#options.submitReplay === undefined) {
      this.#overlay.dataset.resultState = "local";
      this.#overlay.className = "game-overlay result-overlay";
      this.#overlay.innerHTML = `
        <span class="overlay-kicker">Local result</span>
        <div class="result-score">${result.score}</div>
        <p class="replay-pass"><i></i> Run complete</p>
        <button type="button" class="primary-button" data-action="restart">
          Fly again <span>↻</span>
        </button>
      `;
      this.#setAccessibleStatus(
        `Guest run finished with score ${result.score}.`,
        false,
      );
      this.#focusOverlayAction();
      return;
    }

    void this.#submitCompletedRun();
  }

  async #submitCompletedRun(): Promise<void> {
    const completed = this.#completedRun;
    const session = this.#session;
    const submitReplay = this.#options.submitReplay;
    if (
      this.#submitting ||
      completed === null ||
      session === null ||
      submitReplay === undefined
    ) {
      return;
    }

    this.#submitting = true;
    this.#setAccessibleStatus(
      `Saving score ${completed.result.score}.`,
      true,
    );
    this.#overlay.dataset.resultState = "pending";
    this.#overlay.className = "game-overlay result-overlay pending-overlay";
    this.#overlay.innerHTML = `
      <span class="overlay-kicker">Saving score</span>
      <div class="result-score">${completed.result.score}</div>
      <p class="replay-pass"><i></i> Run complete</p>
      <p>Checking and saving your result…</p>
    `;

    try {
      const confirmed = await submitReplay(
        session,
        completed.replay,
        completed.result.score,
      );
      this.#sessionLabelElement.textContent = "Score confirmed";
      this.#sessionLinkElement.href = confirmed.transactionUrl;
      this.#sessionLinkElement.textContent = "View score ↗";
      this.#overlay.dataset.resultState = "confirmed";
      this.#overlay.className = "game-overlay result-overlay confirmed-overlay";
      this.#overlay.innerHTML = `
        <span class="overlay-kicker">Score saved</span>
        <div class="result-score">${confirmed.score}</div>
        <p class="replay-pass"><i></i> Added to your record</p>
        <a class="result-transaction" data-result-transaction target="_blank" rel="noreferrer">
          View score transaction ↗
        </a>
        <button type="button" class="primary-button" data-action="restart">
          Fly again <span>↻</span>
        </button>
      `;
      const resultLink = this.#overlay.querySelector<HTMLAnchorElement>(
        "[data-result-transaction]",
      );
      if (resultLink !== null) resultLink.href = confirmed.transactionUrl;
      this.#setAccessibleStatus(
        `Score ${confirmed.score} was saved successfully.`,
        false,
      );
      this.#focusOverlayAction();
    } catch (error) {
      this.#options.onError?.(error);
      this.#overlay.dataset.resultState = "rejected";
      this.#overlay.className = "game-overlay result-overlay error-overlay";
      this.#overlay.innerHTML = `
        <span class="overlay-kicker">Score not recorded</span>
        <div class="result-score">${completed.result.score}</div>
        <p class="replay-fail"><i></i> Score could not be saved</p>
        <div class="result-actions">
          <button type="button" class="primary-button" data-action="submit-result">
            Retry submission <span>→</span>
          </button>
          <button type="button" class="text-button" data-action="restart">
            Abandon and start a new run
          </button>
        </div>
      `;
      this.#setAccessibleStatus(
        `Score ${completed.result.score} was not recorded. Retry submission or abandon the run.`,
        false,
      );
      this.#focusOverlayAction();
    } finally {
      this.#submitting = false;
      this.#canvas.setAttribute("aria-busy", "false");
    }
  }

  #handleKeyDown(event: KeyboardEvent): void {
    if (document.querySelector("dialog[open]") !== null) return;
    const target = event.target;
    const interactiveTarget =
      target instanceof Element &&
      target !== this.#canvas &&
      target.closest("button, a, input, select, textarea, [contenteditable='true']") !==
        null;
    if (event.code === "Space" || event.code === "ArrowUp") {
      if (interactiveTarget) return;
      event.preventDefault();
      if (this.#mode === "idle" || this.#mode === "finished") void this.start();
      else this.queueFlap();
    }

    if (event.code === "KeyP" || event.code === "Escape") {
      event.preventDefault();
      this.togglePause();
    }
  }

  #setAccessibleStatus(message: string, busy: boolean): void {
    this.#statusElement.textContent = message;
    this.#canvas.setAttribute("aria-busy", String(busy));
  }

  #focusOverlayAction(): void {
    queueMicrotask(() => {
      const action =
        this.#overlay.querySelector<HTMLElement>("button:not(:disabled)") ??
        this.#overlay.querySelector<HTMLElement>("a[href]");
      action?.focus({ preventScroll: true });
    });
  }

  #frame(currentTime: number): void {
    const frameDelta = Math.min(currentTime - this.#previousTime, MAX_FRAME_DELTA);
    this.#previousTime = currentTime;

    if (this.#mode === "running") {
      this.#accumulator += frameDelta;
      let catchUpTicks = 0;

      while (
        this.#accumulator >= TICK_DURATION &&
        catchUpTicks < MAX_CATCH_UP_TICKS &&
        this.#mode === "running"
      ) {
        const previousState = this.#state;
        const flap = this.#pendingFlap;
        this.#pendingFlap = false;

        if (flap) this.#flapTicks.push(previousState.tick);
        this.#state = stepGame(previousState, flap);
        this.#accumulator -= TICK_DURATION;
        catchUpTicks += 1;

        if (this.#state.score !== previousState.score) {
          this.#scoreElement.textContent = this.#formatScore(this.#state.score);
        }
        if (this.#state.tick % 6 === 0) {
          this.#flightElement.textContent = `${(
            this.#state.tick / RULESET_V1.tickRate
          ).toFixed(1)}s`;
        }
        if (this.#state.status !== "running") {
          this.#flightElement.textContent = `${(
            this.#state.tick / RULESET_V1.tickRate
          ).toFixed(1)}s`;
          this.#finish(this.#state);
        }
      }

      if (catchUpTicks === MAX_CATCH_UP_TICKS) {
        this.#accumulator = Math.min(this.#accumulator, TICK_DURATION);
      }
    } else {
      this.#accumulator = 0;
    }

    this.#context.setTransform(
      this.#pixelRatio,
      0,
      0,
      this.#pixelRatio,
      0,
      0,
    );
    drawScene(this.#context, this.#state, this.#mode, this.#reducedMotion);
    this.#animationFrame = requestAnimationFrame((time) => this.#frame(time));
  }
}
