import { calmDeltaTone, type CalmTone } from "./uiKitModel";

/**
 * "지금" (Now) screen model for the calm redesign. Pure: it only rephrases already-derived facts
 * (field phase, account, last order outcome, counts). Uncertainty never reads as healthy:
 * anything but CONNECTED/ATTENTION is amber or red, and stale/unverified values are dimmed.
 */
export type NowPhase = "LAUNCH" | "AUTHENTICATION" | "RECOVERING" | "CONNECTED" | "ATTENTION" | "DEGRADED" | "HALTED";

export interface NowScreenInput {
  readonly phase: NowPhase;
  readonly phaseHeadline: string;
  readonly phaseDetail: string;
  /** Set when the values shown come from a cached snapshot (e.g. "마지막 확인 2분 전"). */
  readonly staleLabel: string | null;
  readonly equity: number | null;
  readonly totalPnl: number | null;
  readonly startingEquity: number | null;
  readonly orderReasonText: string | null;
  readonly whyLines: readonly string[];
  readonly decisionCount: number | null;
  readonly paperOrderCount: number | null;
  readonly fillCount: number | null;
}

export interface NowScreenModel {
  readonly tone: CalmTone;
  readonly headline: string;
  readonly sub: string;
  readonly dim: boolean;
  readonly equity: string;
  readonly delta: string | null;
  readonly deltaTone: CalmTone;
  readonly why: string | null;
  readonly stats: readonly { readonly label: string; readonly value: string; readonly tone: CalmTone }[];
}

const PAPER_ONLY_SUB = "모의투자만 하고 있어요 · 실거래 잠김";

export function krwText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function countText(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : Math.round(value).toLocaleString("ko-KR");
}

function deltaText(pnl: number | null, start: number | null): string | null {
  if (pnl == null || !Number.isFinite(pnl)) return null;
  const sign = pnl > 0 ? "+" : pnl < 0 ? "−" : "";
  const money = `${sign}${krwText(Math.abs(pnl))}`;
  if (start == null || !Number.isFinite(start) || start <= 0) return `시작보다 ${money}`;
  const pct = (pnl / start) * 100;
  return `시작보다 ${money} (${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%)`;
}

export function buildNowScreen(input: NowScreenInput): NowScreenModel {
  const stale = input.staleLabel != null;
  const healthy = !stale && (input.phase === "CONNECTED" || input.phase === "ATTENTION");
  const tone: CalmTone = input.phase === "HALTED" ? "LOSS" : healthy ? "NORMAL" : "ATTENTION";
  const headline = stale ? "최근 값을 보여주고 있어요"
    : input.phase === "CONNECTED" ? "모두 정상이에요"
    : input.phaseHeadline.replace(/\n/g, " ");
  const sub = stale ? `${input.staleLabel} · 연결되면 자동으로 바뀌어요`
    : input.phase === "CONNECTED" ? PAPER_ONLY_SUB
    : input.phaseDetail;
  const unverified = stale || !healthy && input.phase !== "HALTED";
  const why = input.orderReasonText == null ? null
    : [input.orderReasonText, ...input.whyLines].filter((line) => line.trim().length > 0).join(" ");
  return Object.freeze({
    tone,
    headline,
    sub,
    dim: unverified,
    equity: krwText(input.equity),
    delta: deltaText(input.totalPnl, input.startingEquity),
    deltaTone: calmDeltaTone(input.totalPnl),
    why,
    stats: Object.freeze([
      { label: "판단", value: countText(input.decisionCount), tone: "NORMAL" as CalmTone },
      { label: "주문", value: countText(input.paperOrderCount), tone: (input.paperOrderCount ?? 0) > 0 ? "ORDER" as CalmTone : "NORMAL" as CalmTone },
      { label: "체결", value: countText(input.fillCount), tone: "NORMAL" as CalmTone },
    ]),
  });
}
