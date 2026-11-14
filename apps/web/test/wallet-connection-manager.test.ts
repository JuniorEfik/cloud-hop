import assert from "node:assert/strict";
import test from "node:test";

import type {
  NearConnector_ConnectOptions,
  NearWalletBase,
} from "@hot-labs/near-connect";

import {
  WalletConnectionAttemptReplacedError,
  WalletConnectionManager,
} from "../src/wallet-connection-manager.js";

class MemoryStorage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

const createWallet = (
  id: string,
  options: {
    readonly signOut?: () => Promise<void>;
    readonly clearStorage?: () => Promise<void>;
    readonly signedAuthorization?: boolean;
    readonly messageAuthorization?: boolean;
    readonly accounts?: Awaited<ReturnType<NearWalletBase["getAccounts"]>>;
  } = {},
): NearWalletBase =>
  ({
    manifest: {
      id,
      features: {
        signMessage: options.messageAuthorization ?? false,
        signInAndSignMessage: options.signedAuthorization ?? false,
      },
    },
    signOut: options.signOut ?? (async () => undefined),
    getAccounts: async () => options.accounts ?? [],
    signMessage: async (params: Parameters<NearWalletBase["signMessage"]>[0]) => ({
      accountId: params.signerId ?? "",
      publicKey: options.accounts?.[0]?.publicKey ?? "",
      signature: "signed",
    }),
    executor:
      options.clearStorage === undefined
        ? undefined
        : { clearStorage: options.clearStorage },
  }) as unknown as NearWalletBase;

const createConnector = (
  storage: MemoryStorage,
  wallets: readonly NearWalletBase[],
  onDisconnect?: (wallet: NearWalletBase) => void,
) => ({
  whenManifestLoaded: Promise.resolve(),
  selectWallet: async () => wallets[0]!.manifest.id,
  connect: async () => wallets[0]!,
  disconnect: async (wallet?: NearWalletBase) => {
    if (wallet === undefined) throw new Error("Wallet required");
    onDisconnect?.(wallet);
    await wallet.signOut({ network: "testnet" });
    storage.removeItem("selected-wallet");
  },
  getConnectedWallet: async () => ({ wallet: wallets[0]!, accounts: [] }),
  wallet: async (id?: string | null) => {
    const wallet = wallets.find((candidate) => candidate.manifest.id === id);
    if (wallet === undefined) throw new Error("Wallet not found");
    return wallet;
  },
});

test("recovery signs out any selected adapter and clears its dynamic namespace", async () => {
  const storage = new MemoryStorage();
  storage.setItem("selected-wallet", "example-wallet");
  storage.setItem("example-wallet:pending", "true");
  storage.setItem("another-wallet:session", "preserve");
  let signOuts = 0;
  let executorClears = 0;
  let dismissed = 0;
  const wallet = createWallet("example-wallet", {
    signOut: async () => {
      signOuts += 1;
    },
    clearStorage: async () => {
      executorClears += 1;
    },
  });
  const connector = createConnector(storage, [wallet]);
  const manager = new WalletConnectionManager({
    connector,
    storage,
    dismissConnectorUi: () => {
      dismissed += 1;
    },
  });

  const result = await manager.cancel();

  assert.equal(result.walletId, "example-wallet");
  assert.equal(result.adapterSignOutAttempted, true);
  assert.equal(result.adapterSignOutCompleted, true);
  assert.equal(result.adapterStorageCleared, true);
  assert.equal(signOuts, 1);
  assert.equal(executorClears, 1);
  assert.equal(dismissed, 1);
  assert.equal(storage.getItem("selected-wallet"), null);
  assert.equal(storage.getItem("example-wallet:pending"), null);
  assert.equal(storage.getItem("another-wallet:session"), "preserve");
});

test("recovery remains bounded when a wallet adapter never finishes sign-out", async () => {
  const storage = new MemoryStorage();
  storage.setItem("selected-wallet", "unresponsive-wallet");
  storage.setItem("unresponsive-wallet:pending", "true");
  const wallet = createWallet("unresponsive-wallet", {
    signOut: async () => await new Promise<void>(() => undefined),
  });
  const connector = createConnector(storage, [wallet]);
  const manager = new WalletConnectionManager({
    connector,
    storage,
    dismissConnectorUi: () => undefined,
    recoveryTimeoutMs: 5,
  });

  const result = await manager.cancel();

  assert.equal(result.adapterSignOutAttempted, true);
  assert.equal(result.adapterSignOutCompleted, false);
  assert.equal(storage.getItem("selected-wallet"), null);
  assert.equal(storage.getItem("unresponsive-wallet:pending"), null);
});

test("recovery resolves wallets by manifest id instead of known wallet names", async () => {
  const storage = new MemoryStorage();
  storage.setItem("selected-wallet", "future-wallet-2030");
  let disconnectedId: string | null = null;
  const wallet = createWallet("future-wallet-2030");
  const connector = createConnector(storage, [wallet], (selected) => {
    disconnectedId = selected.manifest.id;
  });
  const manager = new WalletConnectionManager({
    connector,
    storage,
    dismissConnectorUi: () => undefined,
  });

  await manager.clearUnconfirmedSelection();

  assert.equal(disconnectedId, "future-wallet-2030");
  assert.equal(storage.getItem("selected-wallet"), null);
});

test("a cancelled adapter cannot complete an obsolete connection attempt", async () => {
  const storage = new MemoryStorage();
  storage.setItem("selected-wallet", "slow-wallet");
  const wallet = createWallet("slow-wallet");
  let finishConnection: ((wallet: NearWalletBase) => void) | undefined;
  const connector = {
    ...createConnector(storage, [wallet]),
    connect: async () =>
      await new Promise<NearWalletBase>((resolve) => {
        finishConnection = resolve;
      }),
  };
  const manager = new WalletConnectionManager({
    connector,
    storage,
    dismissConnectorUi: () => undefined,
  });

  const connection = manager.connect();
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  await manager.cancel();
  finishConnection?.(wallet);

  await assert.rejects(
    connection,
    (error: unknown) => error instanceof WalletConnectionAttemptReplacedError,
  );
});

test("connection does not require optional message-signing capabilities", async () => {
  const account = {
    accountId: "pilot.testnet",
    publicKey: `ed25519:${"1".repeat(32)}`,
  };

  for (const mode of ["combined", "message", "account-only"] as const) {
    const storage = new MemoryStorage();
    const wallet = createWallet(`wallet-${mode}`, {
      signedAuthorization: mode === "combined",
      messageAuthorization: mode === "message",
      accounts: [account],
    });
    let connectOptions: NearConnector_ConnectOptions | undefined;
    let signMessageCalls = 0;
    const walletWithProbe = {
      ...wallet,
      signMessage: async () => {
        signMessageCalls += 1;
        throw new Error("Message signing must not block wallet connection.");
      },
    } as NearWalletBase;
    const connector = {
      ...createConnector(storage, [walletWithProbe]),
      connect: async (options?: NearConnector_ConnectOptions) => {
        connectOptions = options;
        return walletWithProbe;
      },
    };
    const manager = new WalletConnectionManager({
      connector,
      storage,
      dismissConnectorUi: () => undefined,
    });

    const connection = await manager.connect();

    assert.deepEqual(connectOptions, { walletId: walletWithProbe.manifest.id });
    assert.equal(signMessageCalls, 0);
    assert.deepEqual(connection.accounts, [account]);
  }
});

test("recovery discovers a persisted stale wallet selection", async () => {
  const storage = new MemoryStorage();
  const wallet = createWallet("stale-wallet");
  let disconnected = false;
  storage.setItem("selected-wallet", "stale-wallet");
  const connector = createConnector(storage, [wallet], () => {
    disconnected = true;
  });
  const manager = new WalletConnectionManager({
    connector,
    storage,
    dismissConnectorUi: () => undefined,
  });

  const recovery = await manager.clearUnconfirmedSelection();

  assert.equal(recovery.walletId, "stale-wallet");
  assert.equal(recovery.adapterSignOutAttempted, true);
  assert.equal(disconnected, true);
});
