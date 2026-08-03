import {
  LiveMutationDisabledError,
  loadUpbitCredentials,
  MockUpbitRestAdapter,
  UpbitRestClient,
  type UpbitAccountBalance,
  type UpbitLiveReadOnlySnapshot,
  type UpbitOrder,
  type UpbitOrderChance,
  type UpbitOrderQuery,
  type UpbitReadAdapter,
} from "./upbitRestAdapter";

export type TradingAdapterMode = "MOCK" | "LIVE";

export interface TradingProvider {
  readonly mode: TradingAdapterMode;
  readonly readOnly: true;
  readonly productionMutationAllowed: false;
  getAccounts(signal?: AbortSignal): Promise<readonly UpbitAccountBalance[]>;
  getOrders(query?: UpbitOrderQuery, signal?: AbortSignal): Promise<readonly UpbitOrder[]>;
  getOpenOrders(market?: string, signal?: AbortSignal): Promise<readonly UpbitOrder[]>;
  getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder>;
  getOrderChance(market: string, signal?: AbortSignal): Promise<UpbitOrderChance>;
  captureSnapshot(market?: string, signal?: AbortSignal): Promise<UpbitLiveReadOnlySnapshot>;
  submitOrder(): Promise<never>;
  cancelOrder(): Promise<never>;
  withdraw(): Promise<never>;
}

/** Backward-compatible name retained for existing desktop callers. */
export type TradingAdapter = TradingProvider;

export interface TradingAdapterEnvironment {
  readonly mode: TradingAdapterMode;
  readonly liveAdapterEnabled: boolean;
}

export interface TradingAdapterDependencies {
  readonly mockReadAdapter?: UpbitReadAdapter;
  readonly liveReadAdapter?: UpbitReadAdapter;
}

export class LiveAdapterSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveAdapterSelectionError";
  }
}

export function readTradingAdapterEnvironment(environment: Record<string, string | undefined> = process.env): TradingAdapterEnvironment {
  const rawMode = (environment.NUSA_TRADING_ADAPTER_MODE ?? "MOCK").trim().toUpperCase();
  if (rawMode !== "MOCK" && rawMode !== "LIVE") throw new LiveAdapterSelectionError("NUSA_TRADING_ADAPTER_MODE must be MOCK or LIVE");
  return Object.freeze({
    mode: rawMode,
    liveAdapterEnabled: environment.NUSA_ENABLE_LIVE_ADAPTER?.trim().toLowerCase() === "true",
  });
}

abstract class ReadOnlyTradingAdapter implements TradingProvider {
  public abstract readonly mode: TradingAdapterMode;
  public readonly readOnly = true;
  public readonly productionMutationAllowed = false;

  protected constructor(protected readonly readAdapter: UpbitReadAdapter) {}

  public getAccounts(signal?: AbortSignal): Promise<readonly UpbitAccountBalance[]> { return this.readAdapter.getAccounts(signal); }
  public getOrders(query?: UpbitOrderQuery, signal?: AbortSignal): Promise<readonly UpbitOrder[]> { return this.readAdapter.getOrders(query, signal); }
  public getOpenOrders(market?: string, signal?: AbortSignal): Promise<readonly UpbitOrder[]> { return this.readAdapter.getOpenOrders(market, signal); }
  public getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder> { return this.readAdapter.getOrder(uuid, signal); }
  public getOrderChance(market: string, signal?: AbortSignal): Promise<UpbitOrderChance> { return this.readAdapter.getOrderChance(market, signal); }
  public captureSnapshot(market?: string, signal?: AbortSignal): Promise<UpbitLiveReadOnlySnapshot> { return this.readAdapter.captureSnapshot(market, signal); }

  public async submitOrder(): Promise<never> { throw new LiveMutationDisabledError(`${this.mode}:submitOrder`); }
  public async cancelOrder(): Promise<never> { throw new LiveMutationDisabledError(`${this.mode}:cancelOrder`); }
  public async withdraw(): Promise<never> { throw new LiveMutationDisabledError(`${this.mode}:withdraw`); }
}

/** Explicit live-read adapter. It never grants order or capital-mutation authority. */
export class LiveTradingAdapter extends ReadOnlyTradingAdapter {
  public readonly mode = "LIVE" as const;

  constructor(readAdapter: UpbitReadAdapter) {
    super(readAdapter);
  }
}

/** Paper provider used by default; it has no external mutation capability. */
export class PaperTradingAdapter extends ReadOnlyTradingAdapter {
  public readonly mode = "MOCK" as const;

  constructor(readAdapter: UpbitReadAdapter = new MockUpbitRestAdapter()) {
    super(readAdapter);
  }
}

/** Compatibility name retained for existing callers and tests. */
export class MockTradingAdapter extends PaperTradingAdapter {}

export function createTradingAdapter(
  environment: Record<string, string | undefined> = process.env,
  dependencies: TradingAdapterDependencies = {},
): TradingAdapter {
  const configuration = readTradingAdapterEnvironment(environment);
  if (configuration.mode === "MOCK") return new MockTradingAdapter(dependencies.mockReadAdapter);
  if (!configuration.liveAdapterEnabled) throw new LiveAdapterSelectionError("LIVE adapter requires NUSA_ENABLE_LIVE_ADAPTER=true");
  const readAdapter = dependencies.liveReadAdapter ?? new UpbitRestClient({ credentials: loadUpbitCredentials(environment) });
  return new LiveTradingAdapter(readAdapter);
}

/** Canonical provider factory for application code. */
export function createTradingProvider(
  environment: Record<string, string | undefined> = process.env,
  dependencies: TradingAdapterDependencies = {},
): TradingProvider {
  return createTradingAdapter(environment, dependencies);
}

/** Runtime mode switch. Switching is explicit, validated, and never enables mutation. */
export class TradingAdapterRuntime {
  private readonly environment: Record<string, string | undefined>;
  private readonly dependencies: TradingAdapterDependencies;
  private currentAdapter: TradingAdapter;

  constructor(environment: Record<string, string | undefined> = process.env, dependencies: TradingAdapterDependencies = {}) {
    this.environment = { ...environment };
    this.dependencies = dependencies;
    this.currentAdapter = createTradingAdapter(this.environment, this.dependencies);
  }

  public get adapter(): TradingAdapter { return this.currentAdapter; }

  public switchMode(mode: TradingAdapterMode): TradingAdapter {
    this.currentAdapter = createTradingAdapter({ ...this.environment, NUSA_TRADING_ADAPTER_MODE: mode }, this.dependencies);
    return this.currentAdapter;
  }
}
