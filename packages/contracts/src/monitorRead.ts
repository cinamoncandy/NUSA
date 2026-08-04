export const MONITOR_READ_CONTRACT_VERSION = "1.0.0" as const;

export type MonitorMode = "PAPER" | "SHADOW";

export interface MonitorStatus {
  readonly app: "NUSA";
  readonly mode: MonitorMode;
  readonly marketConnectionState: string;
  readonly warmupState: string;
  readonly stale: boolean;
  readonly observedAt: string;
}

export interface MonitorContractEnvelope {
  /**
   * SemVer wire-contract version. Consumers accept only major version 1 in
   * this contract module; absent versions are legacy v1 responses.
   */
  readonly contractVersion: string;
}

export interface MonitorStatusResponse extends MonitorStatus, MonitorContractEnvelope {}

export interface MonitorMarketStatusResponse extends MonitorContractEnvelope {
  readonly observedAt: string;
  readonly marketConnectionState: string;
  readonly warmupState: string;
  readonly stale: boolean;
}

export interface MonitorMarket {
  readonly market: string;
  readonly price: number;
  readonly changeRate: number | null;
  readonly volume: number | null;
  readonly observedAt: string;
  readonly source: "UPBIT_PUBLIC_TICKER";
}

export interface MonitorMarketsResponse extends MonitorContractEnvelope {
  readonly observedAt: string;
  readonly markets: readonly MonitorMarket[];
}

export interface MonitorCandle {
  readonly market: string;
  readonly interval: "1m";
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly source: "UPBIT_PUBLIC_CANDLE";
}

export interface MonitorCandlesResponse extends MonitorContractEnvelope {
  readonly observedAt: string;
  readonly market: string;
  readonly interval: string;
  readonly candles: readonly MonitorCandle[];
}

export interface MonitorPosition {
  readonly market: string;
  readonly quantity: number;
  readonly averagePrice: number;
  readonly realizedPnl: number;
}

export interface MonitorPortfolio {
  readonly cash: number;
  readonly equity: number;
  readonly unrealizedPnl: number;
  readonly markPrice: number;
  readonly position: MonitorPosition;
}

export interface MonitorOrder {
  readonly id: string;
  readonly strategyId?: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly filledAt: string;
  readonly requestedQuantity: number;
  readonly quotedPrice: number;
  readonly spreadCost: number;
  readonly slippageCost: number;
  readonly marketImpactCost: number;
}

export interface MonitorAvailableAccount extends MonitorPortfolio {
  readonly available?: true;
  readonly orders: readonly MonitorOrder[];
}

export interface MonitorUnavailableAccount {
  readonly available: false;
  readonly reason: string;
  readonly orders?: never;
}

export type MonitorAccount = MonitorAvailableAccount | MonitorUnavailableAccount;

export interface MonitorAccountResponse extends MonitorContractEnvelope {
  readonly observedAt: string;
  readonly mode: MonitorMode;
  readonly account: MonitorAccount;
  readonly openOrderCount: number;
}

type UnknownRecord = Readonly<Record<string, unknown>>;
const MARKET_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function freeze<T>(value: T): Readonly<T> { return Object.freeze(value); }

function record(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as UnknownRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
  return result;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function nonNegative(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result < 0) throw new Error(`${label} must be non-negative`);
  return result;
}

function positive(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result <= 0) throw new Error(`${label} must be positive`);
  return result;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

function market(value: unknown, label: string): string {
  const result = text(value, label).trim().toUpperCase();
  if (!MARKET_PATTERN.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function contractVersion(source: UnknownRecord): string {
  const value = source.contractVersion;
  if (value === undefined) return MONITOR_READ_CONTRACT_VERSION;
  if (typeof value !== "string") throw new Error("monitor contractVersion must be a SemVer string");
  const match = SEMVER_PATTERN.exec(value);
  if (!match || Number(match[1]) !== 1) throw new Error(`unsupported monitor contractVersion: ${value}`);
  return value;
}

function mode(value: unknown): MonitorMode {
  if (value !== "PAPER" && value !== "SHADOW") throw new Error("monitor mode is invalid");
  return value;
}

function parseMonitorPosition(value: unknown): MonitorPosition {
  const source = record(value, "monitor position");
  return freeze({
    market: market(source.market, "monitor position.market"),
    quantity: nonNegative(source.quantity, "monitor position.quantity"),
    averagePrice: nonNegative(source.averagePrice, "monitor position.averagePrice"),
    realizedPnl: finite(source.realizedPnl, "monitor position.realizedPnl")
  });
}

export function parseMonitorOrder(value: unknown): MonitorOrder {
  const source = record(value, "monitor order");
  const strategyId = source.strategyId === undefined ? undefined : text(source.strategyId, "monitor order.strategyId");
  const result: MonitorOrder = {
    id: text(source.id, "monitor order.id"),
    ...(strategyId === undefined ? {} : { strategyId }),
    market: market(source.market, "monitor order.market"),
    side: source.side === "BUY" || source.side === "SELL" ? source.side : (() => { throw new Error("monitor order.side is invalid"); })(),
    quantity: positive(source.quantity, "monitor order.quantity"),
    price: positive(source.price, "monitor order.price"),
    fee: nonNegative(source.fee, "monitor order.fee"),
    filledAt: timestamp(source.filledAt, "monitor order.filledAt"),
    requestedQuantity: positive(source.requestedQuantity, "monitor order.requestedQuantity"),
    quotedPrice: positive(source.quotedPrice, "monitor order.quotedPrice"),
    spreadCost: nonNegative(source.spreadCost, "monitor order.spreadCost"),
    slippageCost: nonNegative(source.slippageCost, "monitor order.slippageCost"),
    marketImpactCost: nonNegative(source.marketImpactCost, "monitor order.marketImpactCost")
  };
  return freeze(result);
}

function parseMonitorAccount(value: unknown): MonitorAccount {
  const source = record(value, "monitor account");
  if (source.available === false) return freeze({ available: false, reason: text(source.reason, "monitor account.reason") });
  if (source.available !== undefined && source.available !== true) throw new Error("monitor account.available is invalid");
  if (!Array.isArray(source.orders)) throw new Error("monitor account.orders must be an array");
  const portfolio: MonitorPortfolio = {
    cash: nonNegative(source.cash, "monitor account.cash"),
    equity: nonNegative(source.equity, "monitor account.equity"),
    unrealizedPnl: finite(source.unrealizedPnl, "monitor account.unrealizedPnl"),
    markPrice: positive(source.markPrice, "monitor account.markPrice"),
    position: parseMonitorPosition(source.position)
  };
  const orders = freeze(source.orders.map(parseMonitorOrder));
  return freeze({
    ...(source.available === true ? { available: true as const } : {}),
    ...portfolio,
    orders
  });
}

export function parseMonitorStatusResponse(value: unknown): MonitorStatusResponse {
  const source = record(value, "monitor status response");
  if (source.app !== "NUSA") throw new Error("monitor app is invalid");
  return freeze({
    contractVersion: contractVersion(source),
    app: "NUSA",
    mode: mode(source.mode),
    marketConnectionState: text(source.marketConnectionState, "monitor marketConnectionState"),
    warmupState: text(source.warmupState, "monitor warmupState"),
    stale: typeof source.stale === "boolean" ? source.stale : (() => { throw new Error("monitor stale is invalid"); })(),
    observedAt: timestamp(source.observedAt, "monitor observedAt")
  });
}

export function parseMonitorMarketStatusResponse(value: unknown): MonitorMarketStatusResponse {
  const source = record(value, "monitor market status response");
  return freeze({
    contractVersion: contractVersion(source),
    observedAt: timestamp(source.observedAt, "monitor observedAt"),
    marketConnectionState: text(source.marketConnectionState, "monitor marketConnectionState"),
    warmupState: text(source.warmupState, "monitor warmupState"),
    stale: typeof source.stale === "boolean" ? source.stale : (() => { throw new Error("monitor stale is invalid"); })()
  });
}

export function parseMonitorMarket(value: unknown): MonitorMarket {
  const source = record(value, "monitor market");
  const changeRate = source.changeRate === null ? null : finite(source.changeRate, "monitor market.changeRate");
  const volume = source.volume === null ? null : nonNegative(source.volume, "monitor market.volume");
  if (source.source !== "UPBIT_PUBLIC_TICKER") throw new Error("monitor market.source is invalid");
  return freeze({
    market: market(source.market, "monitor market.market"),
    price: positive(source.price, "monitor market.price"),
    changeRate,
    volume,
    observedAt: timestamp(source.observedAt, "monitor market.observedAt"),
    source: "UPBIT_PUBLIC_TICKER"
  });
}

export function parseMonitorMarketsResponse(value: unknown): MonitorMarketsResponse {
  const source = record(value, "monitor markets response");
  if (!Array.isArray(source.markets)) throw new Error("monitor markets must be an array");
  return freeze({
    contractVersion: contractVersion(source),
    observedAt: timestamp(source.observedAt, "monitor observedAt"),
    markets: freeze(source.markets.map(parseMonitorMarket))
  });
}

export function parseMonitorCandle(value: unknown): MonitorCandle {
  const source = record(value, "monitor candle");
  const openTime = safeInteger(source.openTime, "monitor candle.openTime");
  const closeTime = safeInteger(source.closeTime, "monitor candle.closeTime");
  const open = positive(source.open, "monitor candle.open");
  const high = positive(source.high, "monitor candle.high");
  const low = positive(source.low, "monitor candle.low");
  const close = positive(source.close, "monitor candle.close");
  if (source.interval !== "1m" || source.source !== "UPBIT_PUBLIC_CANDLE" || openTime < 0 || closeTime - openTime !== 60_000 || low > high || open < low || open > high || close < low || close > high) throw new Error("monitor candle metadata is invalid");
  return freeze({ market: market(source.market, "monitor candle.market"), interval: "1m", openTime, closeTime, open, high, low, close, volume: nonNegative(source.volume, "monitor candle.volume"), source: "UPBIT_PUBLIC_CANDLE" });
}

export function parseMonitorCandlesResponse(value: unknown): MonitorCandlesResponse {
  const source = record(value, "monitor candles response");
  if (typeof source.market !== "string" || typeof source.interval !== "string" || !Array.isArray(source.candles)) throw new Error("monitor candles response is invalid");
  const candles = source.candles.map(parseMonitorCandle);
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index]!.market !== candles[0]!.market || candles[index]!.openTime !== candles[index - 1]!.closeTime) throw new Error("monitor candles are not contiguous");
  }
  if (candles.length > 0 && (source.interval !== "1m" || source.market !== candles[0]!.market)) throw new Error("monitor candles response metadata is invalid");
  return freeze({
    contractVersion: contractVersion(source),
    observedAt: timestamp(source.observedAt, "monitor observedAt"),
    market: source.market,
    interval: source.interval,
    candles: freeze(candles)
  });
}

export function parseMonitorAccountResponse(value: unknown): MonitorAccountResponse {
  const source = record(value, "monitor account response");
  const openOrderCount = safeInteger(source.openOrderCount, "monitor openOrderCount");
  if (openOrderCount < 0) throw new Error("monitor openOrderCount must be non-negative");
  const account = parseMonitorAccount(source.account);
  if (account.available !== false && openOrderCount !== account.orders.length) throw new Error("monitor openOrderCount does not match orders");
  return freeze({
    contractVersion: contractVersion(source),
    observedAt: timestamp(source.observedAt, "monitor observedAt"),
    mode: mode(source.mode),
    account,
    openOrderCount
  });
}
