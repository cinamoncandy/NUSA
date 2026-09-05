import { formatFeedAgeMs } from "./watchlist";

/**
 * HOME first-viewport status rail domain model (STEP-3B).
 *
 * Pure builders only — no React, no wall-clock reads. The caller injects
 * `nowMs` so every rule is unit-testable and deterministic.
 *
 * Data-availability contract (do not invent beyond this):
 * - Market/system state: PAPER snapshot presence + dashboard mode +
 *   kill-switch + public feed staleness. All real, all already on device.
 * - Risk: SYSTEM-operability risk only (NORMAL..UNKNOWN). Market-regime or
 *   volatility risk has no snapshot source and is NOT fabricated; unknown
 *   is never rendered as low risk.
 * - Freshness: snapshot.generatedAt or feed observedAt, formatted with the
 *   shared watchlist relative-age rule. Unverifiable input yields null,
 *   never a guessed age.
 * - PnL basis: the PAPER contract carries no daily PnL field, so the only
 *   truthful basis label is "누적" unless the caller proves daily basis.
 * - What-changed: UNSUPPORTED — no snapshot-history source exists on
 *   device. Exposed explicitly as `changesSupported: false` instead of a
 *   fabricated delta list.
 */

export type HomePaperState = "READY" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED" | "UNAVAILABLE";
export type HomePaperMode = "PAPER" | "STOPPED" | "FAULTED";
export type HomeRiskLevel = "NORMAL" | "CAUTION" | "ELEVATED" | "HIGH" | "CRITICAL" | "UNKNOWN";
export type HomeFreshnessTone = "live" | "aged" | "stale" | "unknown";

export interface HomeStatusInput {
  readonly paperState: HomePaperState;
  readonly paperMode: HomePaperMode | null;
  readonly killSwitchActive: boolean | null;
  readonly snapshotGeneratedAtMs: number | null;
  readonly feedStale: boolean;
  readonly feedObservedAtMs: number | null;
  readonly nowMs: number;
  /** True only when the caller can prove a daily PnL basis exists. */
  readonly hasDailyPnlBasis: boolean;
}

export interface HomeStatusRail {
  readonly marketLine: string;
  readonly systemLine: string;
  readonly risk: HomeRiskLevel;
  readonly riskLabel: string;
  readonly freshnessLabel: string | null;
  readonly freshnessTone: HomeFreshnessTone;
  /** Truthful time-basis word for the hero PnL row. Never "오늘" on lifetime data. */
  readonly pnlBasisLabel: string;
  /** Always false until a snapshot-history source exists. */
  readonly changesSupported: false;
}

const RISK_LABEL: Readonly<Record<HomeRiskLevel, string>> = {
  NORMAL: "정상",
  CAUTION: "주의",
  ELEVATED: "상승",
  HIGH: "높음",
  CRITICAL: "위급",
  UNKNOWN: "확인 불가",
};

function validInstant(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function buildHomeStatusRail(input: HomeStatusInput): HomeStatusRail {
  const halted =
    input.paperState === "DOWN" ||
    input.paperMode === "FAULTED" ||
    input.killSwitchActive === true;
  const degraded =
    !halted &&
    (input.paperState === "DEGRADED" || input.paperMode === "STOPPED");
  const unconfigured =
    !halted &&
    !degraded &&
    (input.paperState === "NOT_CONFIGURED" ||
      input.paperState === "UNAVAILABLE" ||
      input.paperMode === null);

  const systemLine = halted
    ? input.killSwitchActive === true && input.paperState !== "DOWN" && input.paperMode !== "FAULTED"
      ? "PAPER 중단(킬 스위치)"
      : "PAPER 중단"
    : degraded
      ? "PAPER 저하"
      : unconfigured
        ? input.paperState === "NOT_CONFIGURED"
          ? "PAPER 미연결"
          : "PAPER 확인 불가"
        : "PAPER 정상";
  const risk: HomeRiskLevel = halted
    ? "HIGH"
    : degraded
      ? "ELEVATED"
      : unconfigured
        ? "UNKNOWN"
        : input.feedStale
          ? "CAUTION"
          : "NORMAL";

  const marketLine = input.feedStale ? "시장 대기" : "시장 온라인";

  const stamp = validInstant(input.snapshotGeneratedAtMs)
    ? input.snapshotGeneratedAtMs
    : validInstant(input.feedObservedAtMs)
      ? (input.feedObservedAtMs as number)
      : null;
  const freshnessLabel = stamp === null ? null : formatFeedAgeMs(stamp, input.nowMs);
  const elapsed = stamp === null || !Number.isFinite(input.nowMs) ? null : input.nowMs - stamp;
  const freshnessTone: HomeFreshnessTone =
    freshnessLabel === null || elapsed === null || elapsed < 0
      ? "unknown"
      : input.feedStale
        ? "stale"
        : elapsed < 30_000
          ? "live"
          : "aged";

  return Object.freeze({
    marketLine,
    systemLine,
    risk,
    riskLabel: RISK_LABEL[risk],
    freshnessLabel,
    freshnessTone,
    pnlBasisLabel: input.hasDailyPnlBasis ? "오늘" : "누적",
    changesSupported: false as const,
  });
}
