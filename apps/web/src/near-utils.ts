import { utils } from "near-api-js";

export const GAME_ID = "cloud-hop";
export const RULESET_VERSION = "cloud-hop-v1";
export const SESSION_DEPOSIT_YOCTO = "5000000000000000000000";
export const SESSION_GAS = "70000000000000";
export const SCORE_SUBMISSION_GAS = "180000000000000";
export const TOURNAMENT_GAS = "60000000000000";

export const normalizeNearPublicKey = (
  value: string | { toString(): string },
): ReturnType<typeof utils.PublicKey.from> =>
  utils.PublicKey.from(value.toString());

export interface ChainSession {
  readonly sessionId: string;
  readonly playerId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly seed: string;
  readonly seedCommitment: string;
  readonly createdAtNs: string;
  readonly expiresAtNs: string;
  readonly status: "active" | "abandoned" | "expired" | "submitted";
  readonly tournamentId?: string | null;
}

export interface SessionStartResult {
  readonly session: ChainSession;
  readonly transactionHash: string;
  readonly explorerUrl: string;
}

export interface ChainScoreRecord {
  readonly sessionId: string;
  readonly playerId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly score: number;
  readonly replayHash: string;
  readonly verifierPublicKey: string;
  readonly acceptedAtNs: string;
  readonly acceptedBlockHeight?: string;
  readonly tournamentId?: string | null;
}

export interface ChainTournamentEntry {
  readonly tournamentId: string;
  readonly playerId: string;
  readonly joinedAtNs: string;
  readonly acceptedRuns: number;
  readonly bestScore: number | null;
  readonly bestSessionId: string | null;
  readonly bestReplayHash: string | null;
  readonly bestAcceptedAtNs: string | null;
  readonly bestAcceptedBlockHeight: string | null;
}

export interface TournamentJoinResult {
  readonly entry: ChainTournamentEntry;
  readonly transactionHash: string;
  readonly explorerUrl: string;
}

export interface ScoreAttestation {
  readonly networkId: string;
  readonly contractId: string;
  readonly playerId: string;
  readonly sessionId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly score: number;
  readonly replayHash: string;
  readonly expiresAtNs: string;
}

export interface VerifiedReplayResponse {
  readonly status: "verified";
  readonly score: number;
  readonly replayHash: string;
  readonly replayBytes: number;
  readonly attestation: ScoreAttestation;
  readonly verifierSignature: string;
  readonly recoveryId: number;
}

export interface ScoreSubmissionResult {
  readonly record: ChainScoreRecord;
  readonly replayHash: string;
  readonly replayBytes: number;
  readonly transactionHash: string;
  readonly explorerUrl: string;
}

interface OutcomeStatus {
  readonly SuccessValue?: unknown;
  readonly Failure?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

export const successValueFromOutcome = (outcome: unknown): string => {
  const outcomeRecord = asRecord(outcome);
  const status = asRecord(outcomeRecord?.status) as OutcomeStatus | null;
  if (status !== null && typeof status.SuccessValue === "string") {
    return status.SuccessValue;
  }
  if (status !== null && status.Failure !== undefined) {
    throw new Error("The NEAR transaction failed.");
  }
  throw new Error("The NEAR transaction did not return a final value.");
};

export const transactionHashFromOutcome = (outcome: unknown): string => {
  const transaction = asRecord(asRecord(outcome)?.transaction);
  if (transaction !== null && typeof transaction.hash === "string") {
    return transaction.hash;
  }
  throw new Error("The NEAR transaction hash is unavailable.");
};

export const decodeBase64Utf8 = (value: string): string => {
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const isChainSession = (value: unknown): value is ChainSession => {
  const record = asRecord(value);
  if (record === null) return false;
  return (
    typeof record.sessionId === "string" &&
    typeof record.playerId === "string" &&
    typeof record.gameId === "string" &&
    typeof record.rulesetVersion === "string" &&
    typeof record.seed === "string" &&
    /^[a-f0-9]{64}$/.test(record.seed) &&
    typeof record.seedCommitment === "string" &&
    typeof record.createdAtNs === "string" &&
    typeof record.expiresAtNs === "string" &&
    ["active", "abandoned", "expired", "submitted"].includes(
      String(record.status),
    ) &&
    (record.tournamentId === undefined ||
      record.tournamentId === null ||
      typeof record.tournamentId === "string")
  );
};

const isScoreAttestation = (value: unknown): value is ScoreAttestation => {
  const record = asRecord(value);
  return (
    record !== null &&
    record.networkId === "testnet" &&
    typeof record.contractId === "string" &&
    typeof record.playerId === "string" &&
    typeof record.sessionId === "string" &&
    /^[a-f0-9]{64}$/.test(record.sessionId) &&
    typeof record.gameId === "string" &&
    typeof record.rulesetVersion === "string" &&
    typeof record.score === "number" &&
    Number.isInteger(record.score) &&
    typeof record.replayHash === "string" &&
    /^[a-f0-9]{64}$/.test(record.replayHash) &&
    typeof record.expiresAtNs === "string" &&
    /^\d+$/.test(record.expiresAtNs)
  );
};

const isChainScoreRecord = (value: unknown): value is ChainScoreRecord => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.sessionId === "string" &&
    /^[a-f0-9]{64}$/.test(record.sessionId) &&
    typeof record.playerId === "string" &&
    typeof record.gameId === "string" &&
    typeof record.rulesetVersion === "string" &&
    typeof record.score === "number" &&
    Number.isInteger(record.score) &&
    typeof record.replayHash === "string" &&
    /^[a-f0-9]{64}$/.test(record.replayHash) &&
    typeof record.verifierPublicKey === "string" &&
    /^[a-f0-9]{128}$/.test(record.verifierPublicKey) &&
    typeof record.acceptedAtNs === "string" &&
    /^\d+$/.test(record.acceptedAtNs) &&
    (record.acceptedBlockHeight === undefined ||
      (typeof record.acceptedBlockHeight === "string" &&
        /^\d+$/.test(record.acceptedBlockHeight))) &&
    (record.tournamentId === undefined ||
      record.tournamentId === null ||
      typeof record.tournamentId === "string")
  );
};

const isChainTournamentEntry = (
  value: unknown,
): value is ChainTournamentEntry => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.tournamentId === "string" &&
    typeof record.playerId === "string" &&
    typeof record.joinedAtNs === "string" &&
    /^\d+$/.test(record.joinedAtNs) &&
    typeof record.acceptedRuns === "number" &&
    Number.isInteger(record.acceptedRuns) &&
    (record.bestScore === null ||
      (typeof record.bestScore === "number" && Number.isInteger(record.bestScore)))
  );
};

export const sessionFromOutcome = (outcome: unknown): ChainSession => {
  const encoded = successValueFromOutcome(outcome);
  let value: unknown;
  try {
    value = JSON.parse(decodeBase64Utf8(encoded));
  } catch {
    throw new Error("The arcade contract returned an invalid session.");
  }
  if (!isChainSession(value)) {
    throw new Error("The arcade contract returned an incomplete session.");
  }
  return value;
};

export const scoreRecordFromOutcome = (outcome: unknown): ChainScoreRecord => {
  const encoded = successValueFromOutcome(outcome);
  let value: unknown;
  try {
    value = JSON.parse(decodeBase64Utf8(encoded));
  } catch {
    throw new Error("The arcade contract returned an invalid score record.");
  }
  if (!isChainScoreRecord(value)) {
    throw new Error("The arcade contract returned an incomplete score record.");
  }
  return value;
};

export const tournamentEntryFromOutcome = (
  outcome: unknown,
): ChainTournamentEntry => {
  const encoded = successValueFromOutcome(outcome);
  let value: unknown;
  try {
    value = JSON.parse(decodeBase64Utf8(encoded));
  } catch {
    throw new Error("The arcade contract returned an invalid tournament entry.");
  }
  if (!isChainTournamentEntry(value)) {
    throw new Error("The arcade contract returned an incomplete tournament entry.");
  }
  return value;
};

export const parseVerifiedReplayResponse = (
  value: unknown,
): VerifiedReplayResponse => {
  const record = asRecord(value);
  if (
    record === null ||
    record.status !== "verified" ||
    typeof record.score !== "number" ||
    !Number.isInteger(record.score) ||
    typeof record.replayHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.replayHash) ||
    typeof record.replayBytes !== "number" ||
    !Number.isInteger(record.replayBytes) ||
    !isScoreAttestation(record.attestation) ||
    typeof record.verifierSignature !== "string" ||
    !/^[a-f0-9]{128}$/.test(record.verifierSignature) ||
    typeof record.recoveryId !== "number" ||
    ![0, 1].includes(record.recoveryId)
  ) {
    throw new Error("The replay verifier returned an invalid attestation.");
  }
  return record as unknown as VerifiedReplayResponse;
};

export const gameSeedFromChainSeed = (seed: string): number => {
  if (!/^[a-f0-9]{64}$/.test(seed)) {
    throw new Error("The on-chain session seed is invalid.");
  }
  const value = Number.parseInt(seed.slice(0, 8), 16) >>> 0;
  return value === 0 ? 1 : value;
};

export const deriveGoogleAccountId = async (
  publicKey: string,
  parentAccountId: string,
): Promise<string> => {
  const availableLabelLength = 64 - parentAccountId.length - 1;
  if (availableLabelLength < 18) {
    throw new Error("The Google wallet parent account is too long.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(publicKey),
  );
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `g-${hex.slice(0, availableLabelLength - 2)}.${parentAccountId}`;
};

export const compactAccountId = (accountId: string): string =>
  accountId.length <= 28
    ? accountId
    : `${accountId.slice(0, 12)}…${accountId.slice(-12)}`;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The request could not be completed.";

export const isMissingAccessKeyError = (error: unknown): boolean => {
  let details = errorMessage(error);
  try {
    details += ` ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
  } catch {
    // The human-readable message remains enough for cyclic error objects.
  }
  return /AccessKeyDoesNotExist|UNKNOWN_ACCESS_KEY|access key .*does(?:n't| not) exist/i.test(
    details,
  );
};
