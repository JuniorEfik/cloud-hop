import type {
  NearConnector_ConnectOptions,
  NearWalletBase,
} from "@hot-labs/near-connect";

interface WalletConnectorLike {
  readonly whenManifestLoaded: Promise<void>;
  selectWallet(): Promise<string>;
  connect(options?: NearConnector_ConnectOptions): Promise<NearWalletBase>;
  disconnect(wallet?: NearWalletBase): Promise<void>;
  getConnectedWallet(): Promise<{
    readonly wallet: NearWalletBase;
    readonly accounts: Awaited<ReturnType<NearWalletBase["getAccounts"]>>;
  }>;
  wallet(id?: string | null): Promise<NearWalletBase>;
}

interface WalletStorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
}

interface RecoverableWallet extends NearWalletBase {
  readonly executor?: {
    clearStorage?: () => Promise<void>;
  };
}

export interface ManagedWalletConnection {
  readonly wallet: NearWalletBase;
  readonly accounts: Awaited<ReturnType<NearWalletBase["getAccounts"]>>;
  readonly attempt: number;
}

export interface WalletRecoveryResult {
  readonly walletId: string | null;
  readonly adapterSignOutAttempted: boolean;
  readonly adapterSignOutCompleted: boolean;
  readonly adapterStorageCleared: boolean;
}

export interface WalletConnectionManagerOptions {
  readonly connector: WalletConnectorLike;
  readonly storage: WalletStorageLike;
  readonly dismissConnectorUi: () => void;
  readonly recoveryTimeoutMs?: number;
}

const SELECTED_WALLET_STORAGE = "selected-wallet";
const DEFAULT_RECOVERY_TIMEOUT_MS = 1_500;
const REPLACED_ATTEMPT_MESSAGE = "The wallet connection attempt was replaced.";

export class WalletConnectionAttemptReplacedError extends Error {
  constructor() {
    super(REPLACED_ATTEMPT_MESSAGE);
    this.name = "WalletConnectionAttemptReplacedError";
  }
}

const withTimeout = async <Result>(
  promise: Promise<Result>,
  timeoutMs: number,
): Promise<Result | undefined> => {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeout = globalThis.setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
};

export class WalletConnectionManager {
  readonly #connector: WalletConnectorLike;
  readonly #storage: WalletStorageLike;
  readonly #dismissConnectorUi: () => void;
  readonly #recoveryTimeoutMs: number;

  #attempt = 0;

  constructor(options: WalletConnectionManagerOptions) {
    this.#connector = options.connector;
    this.#storage = options.storage;
    this.#dismissConnectorUi = options.dismissConnectorUi;
    this.#recoveryTimeoutMs =
      options.recoveryTimeoutMs ?? DEFAULT_RECOVERY_TIMEOUT_MS;
  }

  async connect(): Promise<ManagedWalletConnection> {
    const attempt = this.#attempt + 1;
    this.#attempt = attempt;
    let wallet: NearWalletBase | null = null;

    try {
      await this.#connector.whenManifestLoaded;
      this.#assertCurrent(attempt);

      if (this.#selectedWalletId() !== null) {
        await this.#recoverIncompleteConnection();
        this.#assertCurrent(attempt);
      }

      const walletId = await this.#connector.selectWallet();
      this.#assertCurrent(attempt);
      wallet = await this.#connector.connect({ walletId });
      this.#assertCurrent(attempt);
      const accounts = await wallet.getAccounts({ network: "testnet" });
      this.#assertCurrent(attempt);
      return {
        wallet,
        accounts,
        attempt,
      };
    } catch (error) {
      if (attempt === this.#attempt) {
        await this.#recoverIncompleteConnection(wallet);
      }
      throw error;
    }
  }

  async restore(): Promise<
    Omit<ManagedWalletConnection, "attempt">
  > {
    return await this.#connector.getConnectedWallet();
  }

  async cancel(): Promise<WalletRecoveryResult> {
    this.#attempt += 1;
    this.#dismissConnectorUi();
    return await this.#recoverIncompleteConnection();
  }

  async invalidate(wallet: NearWalletBase): Promise<WalletRecoveryResult> {
    this.#attempt += 1;
    this.#dismissConnectorUi();
    return await this.#recoverIncompleteConnection(wallet);
  }

  async disconnect(wallet: NearWalletBase): Promise<WalletRecoveryResult> {
    this.#attempt += 1;
    this.#dismissConnectorUi();
    return await this.#recoverIncompleteConnection(wallet);
  }

  async clearUnconfirmedSelection(): Promise<WalletRecoveryResult> {
    return await this.#recoverIncompleteConnection();
  }

  assertActive(connection: ManagedWalletConnection): void {
    this.#assertCurrent(connection.attempt);
  }

  #assertCurrent(attempt: number): void {
    if (attempt !== this.#attempt) {
      throw new WalletConnectionAttemptReplacedError();
    }
  }

  #selectedWalletId(): string | null {
    return this.#storage.getItem(SELECTED_WALLET_STORAGE);
  }

  async #recoverIncompleteConnection(
    knownWallet: NearWalletBase | null = null,
  ): Promise<WalletRecoveryResult> {
    const selectedWalletId =
      knownWallet?.manifest.id ?? this.#selectedWalletId();
    let wallet = knownWallet;

    if (wallet === null && selectedWalletId !== null) {
      wallet = await this.#connector.wallet(selectedWalletId).catch(() => null);
    }

    let adapterSignOutAttempted = false;
    let adapterSignOutCompleted = false;
    let adapterStorageCleared = false;

    if (wallet !== null) {
      adapterSignOutAttempted = true;
      adapterSignOutCompleted =
        (await withTimeout(
          this.#connector.disconnect(wallet).then(() => true).catch(() => false),
          this.#recoveryTimeoutMs,
        )) === true;

      const clearStorage = (wallet as RecoverableWallet).executor?.clearStorage;
      if (clearStorage !== undefined) {
        adapterStorageCleared =
          (await withTimeout(
            clearStorage.call((wallet as RecoverableWallet).executor)
              .then(() => true)
              .catch(() => false),
            this.#recoveryTimeoutMs,
          )) === true;
      }
    }

    if (selectedWalletId !== null) this.#clearWalletNamespace(selectedWalletId);
    this.#storage.removeItem(SELECTED_WALLET_STORAGE);

    return {
      walletId: selectedWalletId,
      adapterSignOutAttempted,
      adapterSignOutCompleted,
      adapterStorageCleared,
    };
  }

  #clearWalletNamespace(walletId: string): void {
    const prefix = `${walletId}:`;
    const keys: string[] = [];
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) this.#storage.removeItem(key);
  }
}
