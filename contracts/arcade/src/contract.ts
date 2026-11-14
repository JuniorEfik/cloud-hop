import {
  LookupMap,
  NearBindgen,
  assert,
  call,
  encode,
  initialize,
  near,
  view,
} from "near-sdk-js";

import {
  MAX_TOURNAMENT_PARTICIPANTS,
  MAX_DEMO_TOURNAMENT_DURATION_NS,
  MIN_DEMO_TOURNAMENT_DURATION_NS,
  MAX_LEADERBOARD_ENTRIES,
  MIN_SESSION_STORAGE_DEPOSIT,
  SCORE_MILESTONES,
  WEEK_NS,
  appendAchievement,
  dailyPeriodId,
  effectiveSessionStatus,
  fromHex,
  finalizeTournamentRecord,
  paginateAchievements,
  paginateLeaderboard,
  paginateTournamentLeaderboard,
  rulesetKey,
  serializeScoreAttestation,
  serializeTournamentResult,
  toHex,
  tournamentViewAt,
  updateTournamentEntry,
  updatePlayerStats,
  upsertLeaderboard,
  validateGameId,
  validateMaxScore,
  validateRulesetHash,
  validateRulesetVersion,
  validateScoreAcceptance,
  validateSessionTtl,
  validateTournamentId,
  validateTournamentRegistration,
  validateTournamentSchedule,
  validateTournamentScore,
  validateTournamentSession,
  validateVerifierPublicKey,
  validateVerifierSignature,
  type AchievementPage,
  type AchievementRecord,
  type GameRecord,
  type LeaderboardEntry,
  type LeaderboardPage,
  type PlayerStats,
  type RulesetRecord,
  type ScoreRecord,
  type SessionRecord,
  type StoredLeaderboard,
  type TournamentEntry,
  type TournamentLeaderboardPage,
  type TournamentKind,
  type TournamentRecord,
  type TournamentView,
} from "./model.js";

const DEFAULT_GAME_ID = "cloud-hop";
const DEFAULT_RULESET_VERSION = "cloud-hop-v1";
const DEFAULT_SESSION_TTL_NS = "900000000000";
const NETWORK_ID = "testnet";
const VERIFIER_PUBLIC_KEY_STORAGE = "config:verifier-public-key";
const TOURNAMENT_OPERATOR_STORAGE = "config:tournament-operator";

const scoreStorageKey = (sessionId: string): string => `score:${sessionId}`;
const playerStatsStorageKey = (gameId: string, playerId: string): string =>
  `stats:${gameId}:${playerId}`;
const leaderboardStorageKey = (
  gameId: string,
  period: "all" | "daily",
): string => `leaderboard:${gameId}:${period}`;
const tournamentStorageKey = (tournamentId: string): string =>
  `tournament:${tournamentId}`;
const currentTournamentStorageKey = (gameId: string): string =>
  `tournament-current:${gameId}`;
const tournamentEntryStorageKey = (
  tournamentId: string,
  playerId: string,
): string => `tournament-entry:${tournamentId}:${playerId}`;
const tournamentBoardStorageKey = (tournamentId: string): string =>
  `tournament-board:${tournamentId}`;
const achievementStorageKey = (playerId: string): string =>
  `achievements:${playerId}`;

const getJson = <Value>(key: string): Value | null => {
  const stored = near.storageRead(key);
  return stored === null ? null : (JSON.parse(stored) as Value);
};

const setJson = (key: string, value: unknown): void => {
  near.storageWrite(key, JSON.stringify(value));
};

const getVerifierPublicKey = (): string =>
  near.storageRead(VERIFIER_PUBLIC_KEY_STORAGE) ?? "";

const getScoreRecord = (sessionId: string): ScoreRecord | null => {
  return getJson<ScoreRecord>(scoreStorageKey(sessionId));
};

const setScoreRecord = (record: ScoreRecord): void => {
  setJson(scoreStorageKey(record.sessionId), record);
};

const getPlayerStatsRecord = (
  gameId: string,
  playerId: string,
): PlayerStats | null =>
  getJson<PlayerStats>(playerStatsStorageKey(gameId, playerId));

const setPlayerStatsRecord = (stats: PlayerStats): void => {
  setJson(playerStatsStorageKey(stats.gameId, stats.playerId), stats);
};

const getStoredLeaderboard = (
  gameId: string,
  period: "all" | "daily",
): StoredLeaderboard | null =>
  getJson<StoredLeaderboard>(leaderboardStorageKey(gameId, period));

const setStoredLeaderboard = (
  gameId: string,
  period: "all" | "daily",
  leaderboard: StoredLeaderboard,
): void => {
  setJson(leaderboardStorageKey(gameId, period), leaderboard);
};

const getTournamentRecord = (tournamentId: string): TournamentRecord | null =>
  getJson<TournamentRecord>(tournamentStorageKey(tournamentId));

const setTournamentRecord = (tournament: TournamentRecord): void => {
  setJson(tournamentStorageKey(tournament.tournamentId), tournament);
};

const getTournamentEntryRecord = (
  tournamentId: string,
  playerId: string,
): TournamentEntry | null =>
  getJson<TournamentEntry>(tournamentEntryStorageKey(tournamentId, playerId));

const setTournamentEntryRecord = (entry: TournamentEntry): void => {
  setJson(tournamentEntryStorageKey(entry.tournamentId, entry.playerId), entry);
};

const getTournamentBoard = (
  tournamentId: string,
): readonly LeaderboardEntry[] =>
  getJson<readonly LeaderboardEntry[]>(tournamentBoardStorageKey(tournamentId)) ?? [];

const setTournamentBoard = (
  tournamentId: string,
  entries: readonly LeaderboardEntry[],
): void => {
  setJson(tournamentBoardStorageKey(tournamentId), entries);
};

const getPlayerAchievements = (
  playerId: string,
): readonly AchievementRecord[] =>
  getJson<readonly AchievementRecord[]>(achievementStorageKey(playerId)) ?? [];

const awardAchievement = (achievement: AchievementRecord): void => {
  const result = appendAchievement(
    getPlayerAchievements(achievement.playerId),
    achievement,
  );
  if (!result.added) return;
  setJson(achievementStorageKey(achievement.playerId), result.records);
  near.log(
    JSON.stringify({
      standard: "near-arcade",
      version: "1.0.0",
      event: "achievement_earned",
      data: [achievement],
    }),
  );
};

const awardScoreAchievements = (
  record: ScoreRecord,
  firstAcceptedRun: boolean,
): void => {
  const common = {
    playerId: record.playerId,
    gameId: record.gameId,
    earnedAtNs: record.acceptedAtNs,
    sourceSessionId: record.sessionId,
    tournamentId: null,
    rank: null,
    score: record.score,
  } as const;
  if (firstAcceptedRun) {
    awardAchievement({
      ...common,
      achievementId: `first-run:${record.gameId}`,
      kind: "first-run",
      title: "First verified run",
      description: "Recorded a replay-verified run on NEAR.",
    });
    awardAchievement({
      ...common,
      achievementId: `first-personal-best:${record.gameId}`,
      kind: "first-personal-best",
      title: "First personal best",
      description: "Set an account-bound personal best.",
    });
  }
  for (const milestone of SCORE_MILESTONES) {
    if (record.score < milestone) continue;
    awardAchievement({
      ...common,
      achievementId: `score-milestone:${record.gameId}:${milestone}`,
      kind: "score-milestone",
      title: `${milestone}-point flight`,
      description: `Reached a verified score of at least ${milestone}.`,
      score: milestone,
    });
  }
  if (record.tournamentId !== null && record.tournamentId !== undefined) {
    awardAchievement({
      ...common,
      achievementId: `tournament-participant:${record.tournamentId}`,
      kind: "tournament-participant",
      title: "Tournament pilot",
      description: "Landed a verified score in a tournament.",
      tournamentId: record.tournamentId,
    });
  }
};

const recordPlayerResult = (record: ScoreRecord, timestampNs: bigint): void => {
  const stats = updatePlayerStats(
    getPlayerStatsRecord(record.gameId, record.playerId),
    record,
  );
  setPlayerStatsRecord(stats);

  const allTime = getStoredLeaderboard(record.gameId, "all");
  setStoredLeaderboard(record.gameId, "all", {
    periodId: "all",
    entries: upsertLeaderboard(allTime?.entries ?? [], record),
  });

  const periodId = dailyPeriodId(timestampNs);
  const daily = getStoredLeaderboard(record.gameId, "daily");
  setStoredLeaderboard(record.gameId, "daily", {
    periodId,
    entries: upsertLeaderboard(
      daily?.periodId === periodId ? daily.entries : [],
      record,
    ),
  });
};

const withEffectiveStatus = (session: SessionRecord): SessionRecord => ({
  ...session,
  status: effectiveSessionStatus(session, near.blockTimestamp()),
});

@NearBindgen({ requireInit: true })
export class ArcadeContract {
  ownerId = "";
  globalPaused = false;
  sessionNonce = "0";
  games = new LookupMap<GameRecord>("g");
  rulesets = new LookupMap<RulesetRecord>("r");
  sessions = new LookupMap<SessionRecord>("s");
  activeSessions = new LookupMap<string>("a");

  @initialize({})
  init({
    owner_id,
    ruleset_hash,
    verifier_public_key,
  }: {
    owner_id: string;
    ruleset_hash: string;
    verifier_public_key: string;
  }): void {
    assert(owner_id.length > 1, "Owner account is required.");
    validateRulesetHash(ruleset_hash);
    validateVerifierPublicKey(verifier_public_key);

    this.ownerId = owner_id;
    near.storageWrite(VERIFIER_PUBLIC_KEY_STORAGE, verifier_public_key);
    this.games.set(DEFAULT_GAME_ID, {
      gameId: DEFAULT_GAME_ID,
      activeRuleset: DEFAULT_RULESET_VERSION,
      enabled: true,
      paused: false,
    });
    this.rulesets.set(rulesetKey(DEFAULT_GAME_ID, DEFAULT_RULESET_VERSION), {
      gameId: DEFAULT_GAME_ID,
      version: DEFAULT_RULESET_VERSION,
      rulesetHash: ruleset_hash,
      maxScore: 150,
      sessionTtlNs: DEFAULT_SESSION_TTL_NS,
      enabled: true,
    });
  }

  @view({})
  get_contract_config(): Record<string, unknown> {
    return {
      ownerId: this.ownerId,
      networkId: NETWORK_ID,
      globalPaused: this.globalPaused,
      verifierPublicKey: getVerifierPublicKey(),
      minimumSessionDeposit: MIN_SESSION_STORAGE_DEPOSIT.toString(),
      leaderboardMaximumEntries: MAX_LEADERBOARD_ENTRIES,
      tournamentMaximumParticipants: MAX_TOURNAMENT_PARTICIPANTS,
      tournamentOperator: near.storageRead(TOURNAMENT_OPERATOR_STORAGE) ?? this.ownerId,
      tournamentRewardType: "none",
      demoTournamentDurationRangeNs: {
        minimum: MIN_DEMO_TOURNAMENT_DURATION_NS.toString(),
        maximum: MAX_DEMO_TOURNAMENT_DURATION_NS.toString(),
      },
      currentDailyPeriod: dailyPeriodId(near.blockTimestamp()),
      defaultGameId: DEFAULT_GAME_ID,
      defaultRulesetVersion: DEFAULT_RULESET_VERSION,
    };
  }

  @view({})
  get_game({ game_id }: { game_id: string }): GameRecord | null {
    return this.games.get(game_id);
  }

  @view({})
  get_ruleset({
    game_id,
    version,
  }: {
    game_id: string;
    version: string;
  }): RulesetRecord | null {
    return this.rulesets.get(rulesetKey(game_id, version));
  }

  @view({})
  get_session({ session_id }: { session_id: string }): SessionRecord | null {
    const session = this.sessions.get(session_id);
    return session === null ? null : withEffectiveStatus(session);
  }

  @view({})
  get_active_session({ account_id }: { account_id: string }): SessionRecord | null {
    const sessionId = this.activeSessions.get(account_id);
    if (sessionId === null) return null;
    const session = this.sessions.get(sessionId);
    return session === null ? null : withEffectiveStatus(session);
  }

  @view({})
  get_score({ session_id }: { session_id: string }): ScoreRecord | null {
    return getScoreRecord(session_id);
  }

  @view({})
  get_player_stats({
    account_id,
    game_id,
  }: {
    account_id: string;
    game_id: string;
  }): PlayerStats | null {
    validateGameId(game_id);
    return getPlayerStatsRecord(game_id, account_id);
  }

  @view({})
  get_personal_best({
    account_id,
    game_id,
  }: {
    account_id: string;
    game_id: string;
  }): LeaderboardEntry | null {
    const stats = this.get_player_stats({ account_id, game_id });
    if (stats === null) return null;
    return {
      playerId: stats.playerId,
      score: stats.personalBest,
      sessionId: stats.bestSessionId,
      replayHash: stats.bestReplayHash,
      rulesetVersion: stats.bestRulesetVersion,
      acceptedAtNs: stats.bestAcceptedAtNs,
      acceptedBlockHeight: stats.bestAcceptedBlockHeight,
    };
  }

  @view({})
  get_leaderboard_page({
    game_id,
    period,
    cursor,
    limit,
  }: {
    game_id: string;
    period: "all" | "daily";
    cursor: number;
    limit: number;
  }): LeaderboardPage {
    validateGameId(game_id);
    assert(this.games.get(game_id) !== null, "Game was not found.");
    assert(period === "all" || period === "daily", "Leaderboard period is invalid.");

    const stored = getStoredLeaderboard(game_id, period);
    const periodId = period === "all" ? "all" : dailyPeriodId(near.blockTimestamp());
    const entries =
      stored !== null && stored.periodId === periodId ? stored.entries : [];
    return paginateLeaderboard(game_id, period, periodId, entries, cursor, limit);
  }

  @view({})
  get_tournament({
    tournament_id,
  }: {
    tournament_id: string;
  }): TournamentView | null {
    validateTournamentId(tournament_id);
    const tournament = getTournamentRecord(tournament_id);
    return tournament === null
      ? null
      : tournamentViewAt(tournament, near.blockTimestamp());
  }

  @view({})
  get_current_tournament({
    game_id,
  }: {
    game_id: string;
  }): TournamentView | null {
    validateGameId(game_id);
    const tournamentId = near.storageRead(currentTournamentStorageKey(game_id));
    if (tournamentId === null) return null;
    const tournament = getTournamentRecord(tournamentId);
    return tournament === null
      ? null
      : tournamentViewAt(tournament, near.blockTimestamp());
  }

  @view({})
  get_tournament_entry({
    tournament_id,
    account_id,
  }: {
    tournament_id: string;
    account_id: string;
  }): TournamentEntry | null {
    validateTournamentId(tournament_id);
    return getTournamentEntryRecord(tournament_id, account_id);
  }

  @view({})
  get_tournament_leaderboard_page({
    tournament_id,
    cursor,
    limit,
  }: {
    tournament_id: string;
    cursor: number;
    limit: number;
  }): TournamentLeaderboardPage {
    validateTournamentId(tournament_id);
    assert(getTournamentRecord(tournament_id) !== null, "Tournament was not found.");
    return paginateTournamentLeaderboard(
      tournament_id,
      getTournamentBoard(tournament_id),
      cursor,
      limit,
    );
  }

  @view({})
  get_player_achievements({
    account_id,
    cursor,
    limit,
  }: {
    account_id: string;
    cursor: number;
    limit: number;
  }): AchievementPage {
    return paginateAchievements(
      account_id,
      getPlayerAchievements(account_id),
      cursor,
      limit,
    );
  }

  @call({ payableFunction: true })
  create_session({
    game_id,
    ruleset_version,
    tournament_id,
  }: {
    game_id: string;
    ruleset_version: string;
    tournament_id?: string | null;
  }): SessionRecord {
    assert(!this.globalPaused, "Arcade is paused.");
    assert(
      near.attachedDeposit() === MIN_SESSION_STORAGE_DEPOSIT,
      `Attach exactly ${MIN_SESSION_STORAGE_DEPOSIT.toString()} yoctoNEAR.`,
    );

    const game = this.games.get(game_id);
    assert(game !== null && game.enabled, "Game is not enabled.");
    assert(!game.paused, "Game is paused.");

    const ruleset = this.rulesets.get(rulesetKey(game_id, ruleset_version));
    assert(ruleset !== null && ruleset.enabled, "Ruleset is not enabled.");

    const playerId = near.predecessorAccountId();
    const timestamp = near.blockTimestamp();
    const tournamentId = tournament_id ?? null;
    let tournament: TournamentRecord | null = null;
    if (tournamentId !== null) {
      validateTournamentId(tournamentId);
      tournament = getTournamentRecord(tournamentId);
      assert(tournament !== null, "Tournament was not found.");
      validateTournamentSession({
        tournament,
        entry: getTournamentEntryRecord(tournamentId, playerId),
        gameId: game_id,
        rulesetVersion: ruleset_version,
        nowNs: timestamp,
      });
    }
    const activeSessionId = this.activeSessions.get(playerId);

    if (activeSessionId !== null) {
      const activeSession = this.sessions.get(activeSessionId);
      if (activeSession !== null) {
        const status = effectiveSessionStatus(activeSession, timestamp);
        assert(status !== "active", "Player already has an active session.");
        if (status === "expired" && activeSession.status === "active") {
          this.sessions.set(activeSessionId, { ...activeSession, status: "expired" });
        }
      }
    }

    const nextNonce = BigInt(this.sessionNonce) + 1n;
    this.sessionNonce = nextNonce.toString();
    const randomHex = toHex(near.randomSeed());
    const material = `${playerId}:${this.sessionNonce}:${timestamp.toString()}:${randomHex}`;
    const sessionId = toHex(near.sha256(encode(`session:${material}`)));
    const seed = toHex(near.sha256(encode(`seed:${material}`)));
    const seedCommitment = toHex(near.sha256(encode(seed)));
    const normalExpiry = timestamp + BigInt(ruleset.sessionTtlNs);
    const expiresAt =
      tournament === null || normalExpiry < BigInt(tournament.endAtNs)
        ? normalExpiry
        : BigInt(tournament.endAtNs);

    const session: SessionRecord = {
      sessionId,
      playerId,
      gameId: game_id,
      rulesetVersion: ruleset_version,
      seed,
      seedCommitment,
      createdAtNs: timestamp.toString(),
      expiresAtNs: expiresAt.toString(),
      status: "active",
      tournamentId,
    };

    this.sessions.set(sessionId, session);
    this.activeSessions.set(playerId, sessionId);
    near.log(
      JSON.stringify({
        standard: "near-arcade",
        version: "1.0.0",
        event: "session_created",
        data: [session],
      }),
    );

    return session;
  }

  @call({})
  abandon_session({ session_id }: { session_id: string }): SessionRecord {
    const playerId = near.predecessorAccountId();
    const session = this.sessions.get(session_id);
    assert(session !== null, "Session was not found.");
    assert(session.playerId === playerId, "Only the session owner can abandon it.");
    assert(
      effectiveSessionStatus(session, near.blockTimestamp()) === "active",
      "Session is not active.",
    );

    const abandoned: SessionRecord = { ...session, status: "abandoned" };
    this.sessions.set(session_id, abandoned);
    this.activeSessions.remove(playerId);
    return abandoned;
  }

  @call({})
  submit_verified_score({
    session_id,
    score,
    replay_hash,
    attestation_expires_at_ns,
    verifier_signature,
    recovery_id,
  }: {
    session_id: string;
    score: number;
    replay_hash: string;
    attestation_expires_at_ns: string;
    verifier_signature: string;
    recovery_id: number;
  }): ScoreRecord {
    assert(!this.globalPaused, "Arcade is paused.");
    const verifierPublicKey = getVerifierPublicKey();
    assert(verifierPublicKey.length > 0, "Score verifier is not configured.");
    validateVerifierPublicKey(verifierPublicKey);
    validateVerifierSignature(verifier_signature);
    assert(
      Number.isInteger(recovery_id) && (recovery_id === 0 || recovery_id === 1),
      "Signature recovery id must be zero or one.",
    );

    const session = this.sessions.get(session_id);
    assert(session !== null, "Session was not found.");
    const ruleset = this.rulesets.get(
      rulesetKey(session.gameId, session.rulesetVersion),
    );
    assert(ruleset !== null && ruleset.enabled, "Ruleset is not enabled.");
    const now = near.blockTimestamp();
    validateScoreAcceptance({
      session,
      ruleset,
      callerId: near.predecessorAccountId(),
      score,
      replayHash: replay_hash,
      attestationExpiresAtNs: attestation_expires_at_ns,
      nowNs: now,
      resultExists: getScoreRecord(session_id) !== null,
    });

    let tournament: TournamentRecord | null = null;
    let tournamentEntry: TournamentEntry | null = null;
    if (session.tournamentId !== null && session.tournamentId !== undefined) {
      tournament = getTournamentRecord(session.tournamentId);
      assert(tournament !== null, "Tournament was not found.");
      tournamentEntry = getTournamentEntryRecord(
        session.tournamentId,
        session.playerId,
      );
      validateTournamentScore({
        tournament,
        entry: tournamentEntry,
        session,
        nowNs: now,
      });
    }

    const message = serializeScoreAttestation({
      networkId: NETWORK_ID,
      contractId: near.currentAccountId(),
      playerId: session.playerId,
      sessionId: session.sessionId,
      gameId: session.gameId,
      rulesetVersion: session.rulesetVersion,
      score,
      replayHash: replay_hash,
      expiresAtNs: attestation_expires_at_ns,
    });
    const recovered = near.ecrecover(
      near.sha256(encode(message)),
      fromHex(verifier_signature),
      recovery_id,
      1,
    );
    assert(
      recovered !== null && toHex(recovered) === verifierPublicKey,
      "Verifier attestation signature is invalid.",
    );

    const record: ScoreRecord = {
      sessionId: session.sessionId,
      playerId: session.playerId,
      gameId: session.gameId,
      rulesetVersion: session.rulesetVersion,
      score,
      replayHash: replay_hash,
      verifierPublicKey,
      acceptedAtNs: now.toString(),
      acceptedBlockHeight: near.blockHeight().toString(),
      tournamentId: session.tournamentId ?? null,
    };
    const previousStats = getPlayerStatsRecord(record.gameId, record.playerId);
    setScoreRecord(record);
    recordPlayerResult(record, now);
    if (tournament !== null && tournamentEntry !== null) {
      const updatedEntry = updateTournamentEntry(tournamentEntry, record);
      setTournamentEntryRecord(updatedEntry);
      setTournamentBoard(
        tournament.tournamentId,
        upsertLeaderboard(
          getTournamentBoard(tournament.tournamentId),
          record,
          MAX_LEADERBOARD_ENTRIES,
        ),
      );
    }
    awardScoreAchievements(record, previousStats === null);
    this.sessions.set(session_id, { ...session, status: "submitted" });
    this.activeSessions.remove(session.playerId);
    near.log(
      JSON.stringify({
        standard: "near-arcade",
        version: "1.0.0",
        event: "score_accepted",
        data: [record],
      }),
    );
    return record;
  }

  @call({})
  create_tournament({
    tournament_id,
    game_id,
    ruleset_version,
    start_at_ns,
    registration_ends_at_ns,
    max_participants,
    reward_description,
    tournament_kind,
    duration_ns,
  }: {
    tournament_id: string;
    game_id: string;
    ruleset_version: string;
    start_at_ns: string;
    registration_ends_at_ns: string;
    max_participants: number;
    reward_description: string;
    tournament_kind?: TournamentKind;
    duration_ns?: string;
  }): TournamentView {
    this.assertTournamentOperator();
    validateTournamentId(tournament_id);
    validateGameId(game_id);
    validateRulesetVersion(ruleset_version);
    assert(getTournamentRecord(tournament_id) === null, "Tournament already exists.");
    const game = this.games.get(game_id);
    assert(game !== null && game.enabled, "Game is not enabled.");
    const ruleset = this.rulesets.get(rulesetKey(game_id, ruleset_version));
    assert(ruleset !== null && ruleset.enabled, "Ruleset is not enabled.");
    assert(
      reward_description.length >= 1 && reward_description.length <= 160,
      "Reward description must be between 1 and 160 characters.",
    );

    const currentId = near.storageRead(currentTournamentStorageKey(game_id));
    if (currentId !== null) {
      const current = getTournamentRecord(currentId);
      assert(
        current === null || current.status === "finalized",
        "Finalize the current tournament before creating another.",
      );
    }

    const now = near.blockTimestamp();
    assert(/^\d+$/.test(start_at_ns), "Tournament start must be an integer string.");
    const kind = tournament_kind ?? "weekly";
    assert(kind === "weekly" || kind === "demo", "Tournament kind is invalid.");
    if (kind === "demo") {
      assert(
        near.predecessorAccountId() === this.ownerId,
        "Only the owner can create accelerated demo tournaments.",
      );
      assert(
        game_id.endsWith("-demo"),
        "Demo tournaments require a dedicated demo game id.",
      );
    }
    const duration =
      kind === "weekly"
        ? WEEK_NS
        : /^\d+$/.test(duration_ns ?? "")
          ? BigInt(duration_ns as string)
          : 0n;
    const endAtNs = (BigInt(start_at_ns) + duration).toString();
    validateTournamentSchedule({
      startAtNs: start_at_ns,
      endAtNs,
      registrationEndsAtNs: registration_ends_at_ns,
      maxParticipants: max_participants,
      nowNs: now,
      kind,
    });

    const tournament: TournamentRecord = {
      tournamentId: tournament_id,
      gameId: game_id,
      rulesetVersion: ruleset_version,
      startAtNs: start_at_ns,
      endAtNs,
      registrationEndsAtNs: registration_ends_at_ns,
      maxParticipants: max_participants,
      participantCount: 0,
      createdAtNs: now.toString(),
      createdBy: near.predecessorAccountId(),
      kind,
      status: "open",
      finalizedAtNs: null,
      resultHash: null,
      resultCount: 0,
      podium: [],
      rewardType: "none",
      rewardDescription: reward_description,
    };
    setTournamentRecord(tournament);
    near.storageWrite(currentTournamentStorageKey(game_id), tournament_id);
    setTournamentBoard(tournament_id, []);
    near.log(
      JSON.stringify({
        standard: "near-arcade",
        version: "1.0.0",
        event: "tournament_created",
        data: [tournament],
      }),
    );
    return tournamentViewAt(tournament, now);
  }

  @call({})
  join_tournament({
    tournament_id,
  }: {
    tournament_id: string;
  }): TournamentEntry {
    assert(!this.globalPaused, "Arcade is paused.");
    validateTournamentId(tournament_id);
    const tournament = getTournamentRecord(tournament_id);
    assert(tournament !== null, "Tournament was not found.");
    const playerId = near.predecessorAccountId();
    const existing = getTournamentEntryRecord(tournament_id, playerId);
    const now = near.blockTimestamp();
    validateTournamentRegistration({
      tournament,
      nowNs: now,
      alreadyJoined: existing !== null,
    });
    const entry: TournamentEntry = {
      tournamentId: tournament_id,
      playerId,
      joinedAtNs: now.toString(),
      acceptedRuns: 0,
      bestScore: null,
      bestSessionId: null,
      bestReplayHash: null,
      bestAcceptedAtNs: null,
      bestAcceptedBlockHeight: null,
    };
    setTournamentEntryRecord(entry);
    setTournamentRecord({
      ...tournament,
      participantCount: tournament.participantCount + 1,
    });
    near.log(
      JSON.stringify({
        standard: "near-arcade",
        version: "1.0.0",
        event: "tournament_joined",
        data: [entry],
      }),
    );
    return entry;
  }

  @call({})
  finalize_tournament({
    tournament_id,
  }: {
    tournament_id: string;
  }): TournamentView {
    this.assertTournamentOperator();
    validateTournamentId(tournament_id);
    const tournament = getTournamentRecord(tournament_id);
    assert(tournament !== null, "Tournament was not found.");
    const now = near.blockTimestamp();
    const entries = getTournamentBoard(tournament_id);
    const resultHash = toHex(
      near.sha256(
        encode(serializeTournamentResult(tournament, entries)),
      ),
    );
    const finalized = finalizeTournamentRecord(
      tournament,
      entries,
      resultHash,
      now,
    );
    const podium = finalized.podium;
    setTournamentRecord(finalized);
    podium.forEach((entry, index) => {
      const rank = index + 1;
      awardAchievement({
        achievementId: `tournament-podium:${tournament_id}:${rank}`,
        playerId: entry.playerId,
        gameId: tournament.gameId,
        kind: "tournament-podium",
        title: rank === 1 ? "Tournament champion" : `Tournament podium #${rank}`,
        description: `Finished rank ${rank} in ${tournament_id}.`,
        earnedAtNs: now.toString(),
        sourceSessionId: entry.sessionId,
        tournamentId: tournament_id,
        rank,
        score: entry.score,
      });
    });
    near.log(
      JSON.stringify({
        standard: "near-arcade",
        version: "1.0.0",
        event: "tournament_finalized",
        data: [finalized],
      }),
    );
    return tournamentViewAt(finalized, now);
  }

  @call({})
  register_ruleset({
    game_id,
    version,
    ruleset_hash,
    max_score,
    session_ttl_ns,
    activate,
  }: {
    game_id: string;
    version: string;
    ruleset_hash: string;
    max_score: number;
    session_ttl_ns: string;
    activate: boolean;
  }): RulesetRecord {
    this.assertOwner();
    validateGameId(game_id);
    validateRulesetVersion(version);
    validateRulesetHash(ruleset_hash);
    validateMaxScore(max_score);
    validateSessionTtl(session_ttl_ns);

    const key = rulesetKey(game_id, version);
    assert(this.rulesets.get(key) === null, "Ruleset already exists.");
    const record: RulesetRecord = {
      gameId: game_id,
      version,
      rulesetHash: ruleset_hash,
      maxScore: max_score,
      sessionTtlNs: session_ttl_ns,
      enabled: true,
    };
    this.rulesets.set(key, record);

    const existingGame = this.games.get(game_id);
    if (existingGame === null) {
      this.games.set(game_id, {
        gameId: game_id,
        activeRuleset: version,
        enabled: true,
        paused: false,
      });
    } else if (activate) {
      this.games.set(game_id, { ...existingGame, activeRuleset: version });
    }

    return record;
  }

  @call({})
  set_global_pause({ paused }: { paused: boolean }): void {
    this.assertOwner();
    this.globalPaused = paused;
  }

  @call({})
  set_game_paused({ game_id, paused }: { game_id: string; paused: boolean }): void {
    this.assertOwner();
    const game = this.games.get(game_id);
    assert(game !== null, "Game was not found.");
    this.games.set(game_id, { ...game, paused });
  }

  @call({})
  set_verifier_key({ verifier_public_key }: { verifier_public_key: string }): void {
    this.assertOwner();
    validateVerifierPublicKey(verifier_public_key);
    near.storageWrite(VERIFIER_PUBLIC_KEY_STORAGE, verifier_public_key);
  }

  @call({})
  set_tournament_operator({
    account_id,
  }: {
    account_id: string;
  }): void {
    this.assertOwner();
    assert(account_id.length >= 2 && account_id.length <= 64, "Operator account is invalid.");
    near.storageWrite(TOURNAMENT_OPERATOR_STORAGE, account_id);
    near.log(
      JSON.stringify({
        standard: "near-arcade",
        version: "1.0.0",
        event: "tournament_operator_changed",
        data: [{ accountId: account_id }],
      }),
    );
  }

  private assertOwner(): void {
    assert(near.predecessorAccountId() === this.ownerId, "Owner access required.");
  }

  private assertTournamentOperator(): void {
    const operator = near.storageRead(TOURNAMENT_OPERATOR_STORAGE) ?? this.ownerId;
    const caller = near.predecessorAccountId();
    assert(
      caller === this.ownerId || caller === operator,
      "Tournament operator access required.",
    );
  }
}
