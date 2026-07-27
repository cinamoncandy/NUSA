import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LimitOrder, StrategyChoice, StrategyPeriods } from "./paperRuntime";
import type { SizingMode } from "../../../packages/core/src/position/positionSizer";
import { isValidWebhookUrl } from "./webhookNotifier";

const VALID_CHOICES: readonly StrategyChoice[] = ["sma-crossover", "ema-crossover"];
const VALID_SIZING_MODES: readonly SizingMode[] = ["FIXED", "FIXED_FRACTIONAL"];

export interface PositionProtectionSettings {
  readonly stopLossPrice: number | null;
  readonly takeProfitPrice: number | null;
  readonly trailingStopPercent: number | null;
  /** Only meaningful while trailingStopPercent is set; null until the first tick after enabling. */
  readonly trailingPeakPrice: number | null;
}

export interface PositionSizingSettings {
  readonly mode: SizingMode;
  readonly riskFraction: number;
}

export interface LimitOrdersSettings {
  readonly orders: readonly LimitOrder[];
  readonly sequence: number;
}

export interface NotificationSettings {
  readonly enabled: boolean;
  readonly webhookUrl: string | null;
}

interface StoredRuntimeSettings {
  readonly choice?: unknown;
  readonly shortPeriod?: unknown;
  readonly longPeriod?: unknown;
  readonly positionProtection?: unknown;
  readonly positionSizing?: unknown;
  readonly limitOrders?: unknown;
  readonly limitOrderSequence?: unknown;
  readonly notifications?: unknown;
}

function loadRaw(path: string): StoredRuntimeSettings {
  try {
    if (!existsSync(path)) return {};
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as StoredRuntimeSettings) : {};
  } catch {
    return {};
  }
}

function saveRaw(path: string, settings: StoredRuntimeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings), "utf8");
}

/**
 * Best-effort persistence for a handful of small operator settings that used to be in-memory
 * only (reset on every server restart): which trading strategy (SMA/EMA) is selected and its
 * periods, position protection levels (stop-loss/take-profit/trailing), position sizing mode,
 * and pending limit orders. Kept deliberately separate from DesktopPersistenceStore (apps/desktop/src)
 * rather than adding tables/methods there: apps/desktop's store is reused as-is by this server
 * and is not otherwise modified by this product. This is a small sidecar JSON file next to the
 * SQLite database, matching the same "best-effort continuity only, never affects
 * paperTradingAvailable" philosophy already used for strategy price-history persistence
 * (apps/desktop/src/desktopPersistenceStore.ts's saveStrategyPriceHistory) -- losing this file
 * only means the server falls back to defaults (no protection, no pending orders, SMA(5, 20))
 * on restart, never a failure of the real account/order/control state (which stays in SQLite).
 */
export function loadStrategyChoice(path: string): StrategyChoice | undefined {
  const choice = loadRaw(path).choice;
  return typeof choice === "string" && (VALID_CHOICES as readonly string[]).includes(choice) ? (choice as StrategyChoice) : undefined;
}

/** Read-modify-write: preserves whatever other settings (see below) are already in the file. */
export function saveStrategyChoice(path: string, choice: StrategyChoice): void {
  saveRaw(path, { ...loadRaw(path), choice });
}

/**
 * Same sidecar file, same best-effort-only philosophy as the strategy choice above (losing
 * this file just falls back to the SMA/EMA classes' own (5, 20) constructor defaults, never a
 * fault of account/order/control state) -- kept in the same file rather than a second one
 * since both describe "which strategy, configured how" as a single unit.
 */
export function loadStrategyPeriods(path: string): StrategyPeriods | undefined {
  const { shortPeriod, longPeriod } = loadRaw(path);
  if (typeof shortPeriod !== "number" || typeof longPeriod !== "number") return undefined;
  if (!Number.isInteger(shortPeriod) || !Number.isInteger(longPeriod) || shortPeriod < 2 || longPeriod <= shortPeriod) return undefined;
  return { shortPeriod, longPeriod };
}

export function saveStrategyPeriods(path: string, periods: StrategyPeriods): void {
  saveRaw(path, { ...loadRaw(path), shortPeriod: periods.shortPeriod, longPeriod: periods.longPeriod });
}

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export function loadPositionProtection(path: string): PositionProtectionSettings | undefined {
  const raw = loadRaw(path).positionProtection;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { stopLossPrice, takeProfitPrice, trailingStopPercent, trailingPeakPrice } = raw as Record<string, unknown>;
  if (!isFiniteOrNull(stopLossPrice) || !isFiniteOrNull(takeProfitPrice) || !isFiniteOrNull(trailingStopPercent) || !isFiniteOrNull(trailingPeakPrice)) {
    return undefined;
  }
  return { stopLossPrice, takeProfitPrice, trailingStopPercent, trailingPeakPrice };
}

export function savePositionProtection(path: string, settings: PositionProtectionSettings): void {
  saveRaw(path, { ...loadRaw(path), positionProtection: settings });
}

export function loadPositionSizing(path: string): PositionSizingSettings | undefined {
  const raw = loadRaw(path).positionSizing;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { mode, riskFraction } = raw as Record<string, unknown>;
  if (typeof mode !== "string" || !(VALID_SIZING_MODES as readonly string[]).includes(mode)) return undefined;
  if (typeof riskFraction !== "number" || !Number.isFinite(riskFraction) || riskFraction <= 0 || riskFraction > 1) return undefined;
  return { mode: mode as SizingMode, riskFraction };
}

export function savePositionSizing(path: string, settings: PositionSizingSettings): void {
  saveRaw(path, { ...loadRaw(path), positionSizing: settings });
}

function isValidStoredLimitOrder(value: unknown): value is LimitOrder {
  if (typeof value !== "object" || value === null) return false;
  const { id, side, quantity, limitPrice, createdAt } = value as Record<string, unknown>;
  return typeof id === "string"
    && (side === "BUY" || side === "SELL")
    && typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0
    && typeof limitPrice === "number" && Number.isFinite(limitPrice) && limitPrice > 0
    && typeof createdAt === "string";
}

export function loadLimitOrders(path: string): LimitOrdersSettings | undefined {
  const raw = loadRaw(path);
  const { limitOrders, limitOrderSequence } = raw;
  if (!Array.isArray(limitOrders) || typeof limitOrderSequence !== "number" || !Number.isInteger(limitOrderSequence)) return undefined;
  if (!limitOrders.every(isValidStoredLimitOrder)) return undefined;
  return { orders: limitOrders, sequence: limitOrderSequence };
}

/** Same best-effort sidecar-file philosophy as every other setting above -- losing this file
 * just falls back to notifications disabled/no URL configured on restart. */
export function loadNotificationSettings(path: string): NotificationSettings | undefined {
  const raw = loadRaw(path).notifications;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { enabled, webhookUrl } = raw as Record<string, unknown>;
  if (typeof enabled !== "boolean") return undefined;
  if (webhookUrl !== null && (typeof webhookUrl !== "string" || !isValidWebhookUrl(webhookUrl))) return undefined;
  return { enabled, webhookUrl };
}

export function saveNotificationSettings(path: string, settings: NotificationSettings): void {
  saveRaw(path, { ...loadRaw(path), notifications: settings });
}

export function saveLimitOrders(path: string, settings: LimitOrdersSettings): void {
  saveRaw(path, { ...loadRaw(path), limitOrders: settings.orders, limitOrderSequence: settings.sequence });
}
