import { createHash } from "node:crypto";

import bs58 from "bs58";
import {
  connect,
  keyStores,
  KeyPair,
  transactions,
  utils,
  type Account,
  type Near,
} from "near-api-js";

import type { ApiConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { derivePlayerAccountId } from "./policy.js";

const ACCOUNT_ID_PATTERN = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;
const TOURNAMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SESSION_DEPOSIT = 5_000_000_000_000_000_000_000n;
const FAST_AUTH_SIGN_GAS = 300_000_000_000_000n;
const FAST_AUTH_SIGN_DEPOSIT = 1n;
const ARCADE_METHOD_POLICY = Object.freeze({
  abandon_session: { gas: 30_000_000_000_000n, deposit: 0n },
  create_session: { gas: 70_000_000_000_000n, deposit: SESSION_DEPOSIT },
  join_tournament: { gas: 60_000_000_000_000n, deposit: 0n },
  submit_verified_score: { gas: 180_000_000_000_000n, deposit: 0n },
});

type KeyPairString = `ed25519:${string}` | `secp256k1:${string}`;

interface DecodedFunctionCall {
  readonly methodName: string;
  readonly args: Uint8Array;
  readonly gas: bigint;
  readonly deposit: bigint;
}

interface DecodedAction {
  readonly functionCall?: DecodedFunctionCall;
}

interface EncodedKeyPart {
  readonly data: Uint8Array;
}

interface DecodedPublicKey {
  readonly ed25519Key?: EncodedKeyPart;
  readonly secp256k1Key?: EncodedKeyPart;
}

interface DecodedSignature {
  readonly ed25519Signature?: EncodedKeyPart;
  readonly secp256k1Signature?: EncodedKeyPart;
}

interface DecodedDelegateAction {
  readonly senderId: string;
  readonly receiverId: string;
  readonly actions: readonly DecodedAction[];
  readonly nonce: bigint;
  readonly maxBlockHeight: bigint;
  readonly publicKey: DecodedPublicKey;
}

export interface DecodedSignedDelegate {
  readonly delegateAction: DecodedDelegateAction;
  readonly signature: DecodedSignature;
}

export interface RelayResult {
  readonly outcome: unknown;
  readonly transactionHash: string;
  readonly senderId: string;
}

interface ExecutionStatus {
  readonly SuccessValue?: unknown;
  readonly Failure?: unknown;
}

interface RelayExecutionOutcome {
  readonly status: ExecutionStatus;
  readonly transaction: { readonly hash: string };
  readonly receipts_outcome: readonly {
    readonly outcome: {
      readonly executor_id: string;
      readonly status: ExecutionStatus;
    };
  }[];
  readonly [key: string]: unknown;
}

interface AccessKeyResponse {
  readonly nonce: number | string;
}

interface BlockResponse {
  readonly header: { readonly height: number };
}

class RelayRateLimiter {
  readonly #ipEntries = new Map<string, number[]>();
  readonly #accountEntries = new Map<string, number[]>();
  readonly #globalEntries: number[] = [];

  constructor(
    readonly perIpMinuteLimit: number,
    readonly perAccountMinuteLimit: number,
    readonly dailyLimit: number,
  ) {}

  consume(ip: string, accountId: string, now = Date.now()): void {
    const minuteCutoff = now - 60_000;
    const dayCutoff = now - 86_400_000;
    const ipEntries = (this.#ipEntries.get(ip) ?? []).filter(
      (timestamp) => timestamp > minuteCutoff,
    );
    const accountEntries = (this.#accountEntries.get(accountId) ?? []).filter(
      (timestamp) => timestamp > minuteCutoff,
    );
    const globalEntries = this.#globalEntries.filter(
      (timestamp) => timestamp > dayCutoff,
    );

    if (ipEntries.length >= this.perIpMinuteLimit) {
      throw new ApiError(429, "RELAY_IP_RATE_LIMITED", "Gas relay limit reached.");
    }
    if (accountEntries.length >= this.perAccountMinuteLimit) {
      throw new ApiError(
        429,
        "RELAY_ACCOUNT_RATE_LIMITED",
        "This account's gas relay limit has been reached.",
      );
    }
    if (globalEntries.length >= this.dailyLimit) {
      throw new ApiError(
        503,
        "RELAY_DAILY_LIMIT",
        "The daily gas sponsorship budget has been reached.",
      );
    }

    this.#ipEntries.set(ip, [...ipEntries, now]);
    this.#accountEntries.set(accountId, [...accountEntries, now]);
    this.#globalEntries.splice(0, this.#globalEntries.length, ...globalEntries, now);
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const exactKeys = (record: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(record).length === keys.length &&
  keys.every((key) => Object.hasOwn(record, key));

const parseArgs = (
  action: DecodedFunctionCall,
  maximumBytes = 4_096,
): Record<string, unknown> => {
  if (action.args.byteLength > maximumBytes) {
    throw new ApiError(400, "RELAY_ARGS_TOO_LARGE", "Delegated arguments are too large.");
  }
  try {
    const decoded = JSON.parse(Buffer.from(action.args).toString("utf8"));
    const record = asRecord(decoded);
    if (record === null || Array.isArray(decoded)) throw new Error("Not an object");
    return record;
  } catch {
    throw new ApiError(
      400,
      "INVALID_RELAY_ARGS",
      "Delegated function arguments must be a JSON object.",
    );
  }
};

const validateMethodArgs = (
  methodName: keyof typeof ARCADE_METHOD_POLICY,
  args: Record<string, unknown>,
): void => {
  if (methodName === "abandon_session") {
    if (
      !exactKeys(args, ["session_id"]) ||
      typeof args.session_id !== "string" ||
      !SESSION_ID_PATTERN.test(args.session_id)
    ) {
      throw new ApiError(400, "INVALID_RELAY_ARGS", "Invalid session abandonment.");
    }
    return;
  }

  if (methodName === "create_session") {
    const tournamentId = args.tournament_id;
    if (
      !exactKeys(args, ["game_id", "ruleset_version", "tournament_id"]) ||
      args.game_id !== "cloud-hop" ||
      args.ruleset_version !== "cloud-hop-v1" ||
      !(
        tournamentId === null ||
        (typeof tournamentId === "string" && TOURNAMENT_ID_PATTERN.test(tournamentId))
      )
    ) {
      throw new ApiError(400, "INVALID_RELAY_ARGS", "Invalid session creation.");
    }
    return;
  }

  if (methodName === "join_tournament") {
    if (
      !exactKeys(args, ["tournament_id"]) ||
      typeof args.tournament_id !== "string" ||
      !TOURNAMENT_ID_PATTERN.test(args.tournament_id)
    ) {
      throw new ApiError(400, "INVALID_RELAY_ARGS", "Invalid tournament entry.");
    }
    return;
  }

  if (
    !exactKeys(args, [
      "session_id",
      "score",
      "replay_hash",
      "attestation_expires_at_ns",
      "verifier_signature",
      "recovery_id",
    ]) ||
    typeof args.session_id !== "string" ||
    !SESSION_ID_PATTERN.test(args.session_id) ||
    typeof args.score !== "number" ||
    !Number.isInteger(args.score) ||
    args.score < 0 ||
    args.score > 1_000_000 ||
    typeof args.replay_hash !== "string" ||
    !SESSION_ID_PATTERN.test(args.replay_hash) ||
    typeof args.attestation_expires_at_ns !== "string" ||
    !/^\d{1,30}$/.test(args.attestation_expires_at_ns) ||
    typeof args.verifier_signature !== "string" ||
    !/^[a-f0-9]{128}$/.test(args.verifier_signature) ||
    typeof args.recovery_id !== "number" ||
    ![0, 1].includes(args.recovery_id)
  ) {
    throw new ApiError(400, "INVALID_RELAY_ARGS", "Invalid score submission.");
  }
};

const publicKeyDetails = (
  publicKey: DecodedPublicKey,
): { readonly value: ReturnType<typeof utils.PublicKey.fromString>; readonly text: string } => {
  const ed25519 = publicKey.ed25519Key?.data;
  const secp256k1 = publicKey.secp256k1Key?.data;
  if ((ed25519 === undefined) === (secp256k1 === undefined)) {
    throw new ApiError(400, "INVALID_DELEGATE_KEY", "Delegate public key is invalid.");
  }
  const text =
    ed25519 !== undefined
      ? `ed25519:${bs58.encode(Uint8Array.from(ed25519))}`
      : `secp256k1:${bs58.encode(Uint8Array.from(secp256k1!))}`;
  return { value: utils.PublicKey.fromString(text), text };
};

const signatureBytes = (
  signature: DecodedSignature,
  publicKey: DecodedPublicKey,
): Uint8Array => {
  const ed25519 = signature.ed25519Signature?.data;
  const secp256k1 = signature.secp256k1Signature?.data;
  if ((ed25519 === undefined) === (secp256k1 === undefined)) {
    throw new ApiError(400, "INVALID_DELEGATE_SIGNATURE", "Delegate signature is invalid.");
  }
  if (
    (publicKey.ed25519Key !== undefined && ed25519 === undefined) ||
    (publicKey.secp256k1Key !== undefined && secp256k1 === undefined)
  ) {
    throw new ApiError(
      400,
      "DELEGATE_KEY_MISMATCH",
      "Delegate signature does not match its public key type.",
    );
  }
  return Uint8Array.from(ed25519 ?? secp256k1!);
};

const decodeSignedDelegate = (
  candidate: unknown,
): { readonly signedDelegate: DecodedSignedDelegate; readonly publicKey: string } => {
  const body = asRecord(candidate);
  const encoded = body?.signedDelegateAction;
  if (
    typeof encoded !== "string" ||
    encoded.length < 64 ||
    encoded.length > 24_000 ||
    !BASE64_PATTERN.test(encoded)
  ) {
    throw new ApiError(
      400,
      "SIGNED_DELEGATE_REQUIRED",
      "A base64-encoded signed delegate action is required.",
    );
  }

  let signedDelegate: DecodedSignedDelegate;
  try {
    signedDelegate = utils.serialize.deserialize(
      transactions.SCHEMA.SignedDelegate,
      Buffer.from(encoded, "base64"),
    ) as unknown as DecodedSignedDelegate;
  } catch {
    throw new ApiError(
      400,
      "INVALID_SIGNED_DELEGATE",
      "The signed delegate action could not be decoded.",
    );
  }

  const delegate = signedDelegate.delegateAction;
  if (!ACCOUNT_ID_PATTERN.test(delegate.senderId)) {
    throw new ApiError(403, "DELEGATE_NOT_ALLOWED", "Delegate sender is invalid.");
  }

  const publicKey = publicKeyDetails(delegate.publicKey);
  const signature = signatureBytes(signedDelegate.signature, delegate.publicKey);
  const message = transactions.encodeDelegateAction(delegate as never);
  const digest = createHash("sha256").update(message).digest();
  if (!publicKey.value.verify(digest, signature)) {
    throw new ApiError(
      403,
      "INVALID_DELEGATE_SIGNATURE",
      "The delegated action signature is invalid.",
    );
  }

  return { signedDelegate, publicKey: publicKey.text };
};

const validateArcadeDelegate = (
  delegate: DecodedDelegateAction,
  contractId: string,
): void => {
  if (
    delegate.receiverId !== contractId ||
    delegate.actions.length < 1 ||
    delegate.actions.length > 2
  ) {
    throw new ApiError(
      403,
      "DELEGATE_NOT_ALLOWED",
      "The delegated transaction is outside the arcade relay policy.",
    );
  }

  const methods: string[] = [];
  for (const action of delegate.actions) {
    const functionCall = action.functionCall;
    if (
      functionCall === undefined ||
      !(functionCall.methodName in ARCADE_METHOD_POLICY)
    ) {
      throw new ApiError(
        403,
        "DELEGATE_ACTION_NOT_ALLOWED",
        "Only approved arcade contract calls can be relayed.",
      );
    }
    const methodName = functionCall.methodName as keyof typeof ARCADE_METHOD_POLICY;
    const policy = ARCADE_METHOD_POLICY[methodName];
    if (functionCall.gas !== policy.gas || functionCall.deposit !== policy.deposit) {
      throw new ApiError(
        403,
        "DELEGATE_COST_NOT_ALLOWED",
        "Delegated gas or deposit exceeds the arcade relay policy.",
      );
    }
    validateMethodArgs(methodName, parseArgs(functionCall));
    methods.push(methodName);
  }

  const validSequence =
    methods.length === 1
      ? ["create_session", "join_tournament", "submit_verified_score"].includes(
          methods[0]!,
        )
      : methods[0] === "abandon_session" && methods[1] === "create_session";
  if (!validSequence) {
    throw new ApiError(
      403,
      "DELEGATE_SEQUENCE_NOT_ALLOWED",
      "That combination of delegated calls is not allowed.",
    );
  }

};

export const decodeAndValidateSignedDelegate = (
  candidate: unknown,
  contractId: string,
): { readonly signedDelegate: DecodedSignedDelegate; readonly publicKey: string } => {
  const decoded = decodeSignedDelegate(candidate);
  validateArcadeDelegate(decoded.signedDelegate.delegateAction, contractId);
  return decoded;
};

const decodeArcadeDelegateMessage = (
  encoded: unknown,
  contractId: string,
): { readonly delegate: DecodedDelegateAction; readonly message: Buffer } => {
  if (
    typeof encoded !== "string" ||
    encoded.length < 32 ||
    encoded.length > 12_000 ||
    !BASE64_PATTERN.test(encoded)
  ) {
    throw new ApiError(
      400,
      "ARCADE_DELEGATE_REQUIRED",
      "The arcade delegate message is required.",
    );
  }
  const message = Buffer.from(encoded, "base64");
  let delegate: DecodedDelegateAction;
  try {
    delegate = utils.serialize.deserialize(
      transactions.SCHEMA.DelegateAction,
      message.subarray(4),
    ) as unknown as DecodedDelegateAction;
  } catch {
    throw new ApiError(
      400,
      "INVALID_ARCADE_DELEGATE",
      "The arcade delegate message could not be decoded.",
    );
  }
  const canonical = Buffer.from(transactions.encodeDelegateAction(delegate as never));
  if (!canonical.equals(message)) {
    throw new ApiError(
      400,
      "INVALID_ARCADE_DELEGATE",
      "The arcade delegate message is not canonical.",
    );
  }
  validateArcadeDelegate(delegate, contractId);
  return { delegate, message };
};

export const decodeAndValidateFastAuthRequest = (
  candidate: unknown,
  configuration: Pick<
    ApiConfig,
    "contractId" | "fastAuthDomain" | "sponsorAccountId"
  >,
): {
  readonly accountId: string;
  readonly args: {
    readonly guard_id: string;
    readonly verify_payload: string;
    readonly sign_payload: number[];
    readonly algorithm: "eddsa";
  };
} => {
  const body = asRecord(candidate);
  const arcade = decodeArcadeDelegateMessage(
    body?.arcadeDelegateAction,
    configuration.contractId,
  );
  const arcadePublicKey = publicKeyDetails(arcade.delegate.publicKey).text;
  const expectedAccountId = derivePlayerAccountId(
    arcadePublicKey,
    configuration.sponsorAccountId,
  );
  if (arcade.delegate.senderId !== expectedAccountId) {
    throw new ApiError(
      403,
      "FAST_AUTH_ACCOUNT_MISMATCH",
      "The Google wallet does not match the approved arcade action.",
    );
  }

  const request = asRecord(body?.signatureRequest);
  const signPayload = request?.signPayload;
  const verifyPayload = request?.verifyPayload;
  if (
    request === null ||
    !exactKeys(request, ["guardId", "verifyPayload", "signPayload", "algorithm"]) ||
    request.guardId !== `jwt#https://${configuration.fastAuthDomain}/` ||
    typeof verifyPayload !== "string" ||
    verifyPayload.length < 100 ||
    verifyPayload.length > 10_000 ||
    verifyPayload.split(".").length !== 3 ||
    request.algorithm !== "eddsa" ||
    !Array.isArray(signPayload) ||
    signPayload.length !== arcade.message.length ||
    !signPayload.every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  ) {
    throw new ApiError(
      400,
      "INVALID_FAST_AUTH_ARGS",
      "The FastAuth signing arguments are invalid.",
    );
  }
  if (!arcade.message.equals(Buffer.from(signPayload))) {
    throw new ApiError(
      403,
      "FAST_AUTH_PAYLOAD_MISMATCH",
      "The FastAuth request does not sign the approved arcade action.",
    );
  }

  return {
    accountId: expectedAccountId,
    args: {
      guard_id: request.guardId,
      verify_payload: verifyPayload,
      sign_payload: signPayload,
      algorithm: "eddsa",
    },
  };
};

const failureMessage = (failure: unknown): string => {
  let serialized: string;
  try {
    serialized = JSON.stringify(failure);
  } catch {
    return "The sponsored NEAR transaction failed.";
  }
  const match = serialized.match(/ExecutionError\\?":\\?"([^"\\]{1,300})/);
  return match?.[1]?.replaceAll("\\n", " ") ?? "The sponsored NEAR transaction failed.";
};

export const normalizeRelayOutcome = (
  outcome: RelayExecutionOutcome,
  contractId: string,
): RelayExecutionOutcome => {
  for (const receipt of outcome.receipts_outcome) {
    if (receipt.outcome.status.Failure !== undefined) {
      throw new ApiError(
        422,
        "RELAY_EXECUTION_FAILED",
        failureMessage(receipt.outcome.status.Failure),
      );
    }
  }
  const contractReceipt = [...outcome.receipts_outcome]
    .reverse()
    .find(
      (receipt) =>
        receipt.outcome.executor_id === contractId &&
        typeof receipt.outcome.status.SuccessValue === "string" &&
        receipt.outcome.status.SuccessValue.length > 0,
    );
  if (contractReceipt === undefined) {
    throw new ApiError(
      502,
      "RELAY_RESULT_MISSING",
      "The sponsored transaction returned no arcade contract result.",
    );
  }
  return { ...outcome, status: contractReceipt.outcome.status };
};

export class RelayerService {
  readonly #limiter: RelayRateLimiter;
  #near: Near | null = null;
  #relayer: Account | null = null;
  #submissionTail: Promise<void> = Promise.resolve();

  constructor(readonly configuration: ApiConfig) {
    this.#limiter = new RelayRateLimiter(
      configuration.relayerPerIpMinuteLimit,
      configuration.relayerPerAccountMinuteLimit,
      configuration.relayerDailyLimit,
    );
  }

  async initialize(): Promise<void> {
    if (!this.configuration.relayerConfigured) return;
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(
      this.configuration.relayerPrivateKey as KeyPairString,
    );
    await keyStore.setKey(
      this.configuration.networkId,
      this.configuration.relayerAccountId,
      keyPair,
    );
    this.#near = await connect({
      networkId: this.configuration.networkId,
      nodeUrl: this.configuration.rpcUrl,
      deps: { keyStore },
    });
    this.#relayer = await this.#near.account(this.configuration.relayerAccountId);
  }

  async relayArcade(candidate: unknown, requesterKey: string): Promise<RelayResult> {
    if (!this.configuration.relayerConfigured || this.#near === null || this.#relayer === null) {
      throw new ApiError(
        503,
        "RELAYER_NOT_CONFIGURED",
        "Gas sponsorship is not configured on this deployment.",
      );
    }

    const { signedDelegate, publicKey } = decodeAndValidateSignedDelegate(
      candidate,
      this.configuration.contractId,
    );
    return this.#relayValidated(
      signedDelegate,
      publicKey,
      this.configuration.contractId,
      requesterKey,
    );
  }

  async relayFastAuthSign(
    candidate: unknown,
    requesterKey: string,
  ): Promise<RelayResult> {
    if (!this.configuration.relayerConfigured || this.#near === null || this.#relayer === null) {
      throw new ApiError(
        503,
        "RELAYER_NOT_CONFIGURED",
        "Gas sponsorship is not configured on this deployment.",
      );
    }
    const { accountId, args } = decodeAndValidateFastAuthRequest(
      candidate,
      this.configuration,
    );
    this.#limiter.consume(requesterKey, accountId);
    return this.#enqueueSubmission(async () => {
      const outcome = (await this.#relayer!.signAndSendTransaction({
        receiverId: this.configuration.fastAuthContractId,
        actions: [
          transactions.functionCall(
            "sign",
            args,
            FAST_AUTH_SIGN_GAS,
            FAST_AUTH_SIGN_DEPOSIT,
          ),
        ],
      })) as unknown as RelayExecutionOutcome;
      return {
        outcome: normalizeRelayOutcome(
          outcome,
          this.configuration.fastAuthContractId,
        ),
        transactionHash: outcome.transaction.hash,
        senderId: accountId,
      };
    });
  }

  async relay(candidate: unknown, requesterKey: string): Promise<RelayResult> {
    return this.relayArcade(candidate, requesterKey);
  }

  async #relayValidated(
    signedDelegate: DecodedSignedDelegate,
    publicKey: string,
    resultContractId: string,
    requesterKey: string,
  ): Promise<RelayResult> {
    const near = this.#near;
    const relayer = this.#relayer;
    if (near === null || relayer === null) {
      throw new ApiError(503, "RELAYER_NOT_READY", "Gas relayer is not ready.");
    }
    const delegate = signedDelegate.delegateAction;
    const [accessKey, block] = await Promise.all([
      near.connection.provider.query({
        request_type: "view_access_key",
        finality: "optimistic",
        account_id: delegate.senderId,
        public_key: publicKey,
      }) as unknown as Promise<AccessKeyResponse>,
      near.connection.provider.block({ finality: "final" }) as Promise<BlockResponse>,
    ]);
    const accessKeyNonce = BigInt(accessKey.nonce);
    const blockHeight = BigInt(block.header.height);
    if (delegate.nonce !== accessKeyNonce + 1n) {
      throw new ApiError(
        409,
        "DELEGATE_NONCE_MISMATCH",
        "The delegated action is stale. Please approve it again.",
      );
    }
    if (
      delegate.maxBlockHeight <= blockHeight ||
      delegate.maxBlockHeight > blockHeight + BigInt(this.configuration.relayerMaxBlockTtl)
    ) {
      throw new ApiError(
        400,
        "DELEGATE_EXPIRY_NOT_ALLOWED",
        "The delegated action expiry is outside the allowed window.",
      );
    }

    this.#limiter.consume(requesterKey, delegate.senderId);
    return this.#enqueueSubmission(async () => {
      const outcome = (await relayer.signAndSendTransaction({
        receiverId: delegate.senderId,
        actions: [
          new transactions.Action({
            signedDelegate,
          }),
        ],
      })) as unknown as RelayExecutionOutcome;
      const normalizedOutcome = normalizeRelayOutcome(
        outcome,
        resultContractId,
      );
      return {
        outcome: normalizedOutcome,
        transactionHash: outcome.transaction.hash,
        senderId: delegate.senderId,
      };
    });
  }

  async #enqueueSubmission<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#submissionTail;
    let release!: () => void;
    this.#submissionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
