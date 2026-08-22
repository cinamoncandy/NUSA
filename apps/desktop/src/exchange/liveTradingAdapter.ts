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
import type {
  UpbitOrderAdapter,
  UpbitSubmitOrderRequest,
} from "./upbitExecutionRestClient";

export type TradingAdapterMode = "MOCK" | "LIVE";

export interface TradingAdapter {
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

export interface TradingAdapterEnvironment {
  readonly mode: TradingAdapterMode;
  readonly liveAdapterEnabled: boolean;
  readonly liveOrderMutationEnabled: boolean;
}

export interface TradingAdapterDependencies {
  readonly mockReadAdapter?: UpbitReadAdapter;
  readonly liveReadAdapter?: UpbitReadAdapter;
  /** Must come from the separately authorized Restricted-LIVE runtime. Never auto-created here. */
  readonly liveOrderAdapter?: UpbitOrderAdapter;
}

export interface LiveOrderAuthority {
  readonly productionMutationAllowed: true;
  readonly confirmation: "CONFIRM_UPBIT_LIVE_ORDER";
}

export interface LiveOrderExecutionAdapter {
  readonly mode: "LIVE";
  readonly readOnly: false;
  readonly productionMutationAllowed: true;
  getAccounts(signal?: AbortSignal): Promise<readonly UpbitAccountBalance[]>;
  getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder>;
  getOrderChance(market: string, signal?: AbortSignal): Promise<UpbitOrderChance>;
  testOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder>;
  submitOrder(order: UpbitSubmitOrderRequest, authority: LiveOrderAuthority, signal?: AbortSignal): Promise<UpbitOrder>;
  cancelOrder(uuid: string, authority: LiveOrderAuthority, signal?: AbortSignal): Promise<UpbitOrder>;
  withdraw(): Promise<never>;
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
    liveOrderMutationEnabled: environment.NUSA_ENABLE_LIVE_ORDER_MUTATION?.trim().toLowerCase() === "true",
  });
}

abstract class ReadOnlyTradingAdapter implements TradingAdapter {
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

/** Deterministic adapter used by default and by tests; it has the same read-only contract. */
export class MockTradingAdapter extends ReadOnlyTradingAdapter {
  public readonly mode = "MOCK" as const;

  constructor(readAdapter: UpbitReadAdapter = new MockUpbitRestAdapter()) {
    super(readAdapter);
  }
}

export class UpbitLiveOrderExecutionAdapter implements LiveOrderExecutionAdapter {
  public readonly mode = "LIVE" as const;
  public readonly readOnly = false as const;
  public readonly productionMutationAllowed = true as const;

  constructor(private readonly orderAdapter: UpbitOrderAdapter) {}

  public getAccounts(signal?: AbortSignal): Promise<readonly UpbitAccountBalance[]> { return this.orderAdapter.getAccounts(signal); }
  public getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder> { return this.orderAdapter.getOrder(uuid, signal); }
  public getOrderChance(market: string, signal?: AbortSignal): Promise<UpbitOrderChance> { return this.orderAdapter.getOrderChance(market, signal); }
  public testOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder> { return this.orderAdapter.testOrder(order, signal); }

  public submitOrder(order: UpbitSubmitOrderRequest, authority: LiveOrderAuthority, signal?: AbortSignal): Promise<UpbitOrder> {
    assertLiveOrderAuthority(authority);
    return this.orderAdapter.submitOrder(order, signal) as unknown as Promise<UpbitOrder>;
  }

  public cancelOrder(uuid: string, authority: LiveOrderAuthority, signal?: AbortSignal): Promise<UpbitOrder> {
    assertLiveOrderAuthority(authority);
    return this.orderAdapter.cancelOrder(uuid, signal) as unknown as Promise<UpbitOrder>;
  }

  public async withdraw(): Promise<never> { throw new LiveMutationDisabledError("LIVE:withdraw"); }
}

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

export function createLiveOrderExecutionAdapter(
  environment: Record<string, string | undefined> = process.env,
  dependencies: TradingAdapterDependencies = {},
): LiveOrderExecutionAdapter {
  const configuration = readTradingAdapterEnvironment(environment);
  if (configuration.mode !== "LIVE") throw new LiveAdapterSelectionError("Live order execution requires NUSA_TRADING_ADAPTER_MODE=LIVE");
  if (!configuration.liveAdapterEnabled) throw new LiveAdapterSelectionError("Live order execution requires NUSA_ENABLE_LIVE_ADAPTER=true");
  if (!configuration.liveOrderMutationEnabled) throw new LiveAdapterSelectionError("Live order execution requires NUSA_ENABLE_LIVE_ORDER_MUTATION=true");
  if (!dependencies.liveOrderAdapter) {
    throw new LiveAdapterSelectionError("Live order execution requires an explicitly injected Restricted-LIVE transport");
  }
  return new UpbitLiveOrderExecutionAdapter(dependencies.liveOrderAdapter);
}

function assertLiveOrderAuthority(authority: LiveOrderAuthority): void {
  if (authority?.productionMutationAllowed !== true || authority.confirmation !== "CONFIRM_UPBIT_LIVE_ORDER") {
    throw new LiveMutationDisabledError("LIVE:missing-explicit-order-authority");
  }
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
