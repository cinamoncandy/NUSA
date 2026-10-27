import type { LiveGateSummary } from "./liveGateModel";
import type { CalmTone } from "./uiKitModel";

/**
 * "안전" screen model. The first two rows are fixed facts of this build (PAPER only, AI advisory
 * only) and never depend on a server value, so no response can make LIVE look unlocked.
 * Gate progress is shown as information, never as an invitation to enable anything.
 */
export interface SafetyRow { readonly label: string; readonly hint: string; readonly value: string; readonly tone: CalmTone }
export interface SafetyScreenModel { readonly rows: readonly SafetyRow[]; readonly advanced: readonly string[] }

const GATE_WORD = Object.freeze({ PASS: "통과", FAIL: "실패", BLOCKED: "막힘", STALE: "오래됨", CHECKING: "확인 중" } as const);

export function buildSafetyScreen(gates: LiveGateSummary | null, blockers: readonly string[]): SafetyScreenModel {
  const rows: SafetyRow[] = [
    { label: "실거래", hint: "모의투자만 할 수 있어요", value: "잠김 · 영구", tone: "NORMAL" },
    { label: "AI", hint: "의견만 낼 수 있어요", value: "권한 없음", tone: "NORMAL" },
  ];
  if (gates != null) {
    rows.push({ label: "실거래 준비 관문", hint: "통과해도 실거래는 켜지지 않아요", value: `${gates.passed} / ${gates.total}`, tone: "MUTED" });
    for (const gate of gates.gates) rows.push({ label: gate.title, hint: gate.detail, value: GATE_WORD[gate.state], tone: gate.state === "PASS" ? "NORMAL" : gate.state === "CHECKING" ? "MUTED" : "ATTENTION" });
  }
  const advanced = [
    ...(gates?.gates.map((gate) => `${gate.id}=${gate.state}`) ?? []),
    ...blockers.map((blocker) => `blocker: ${blocker}`),
  ];
  return Object.freeze({ rows: Object.freeze(rows.map((row) => Object.freeze(row))), advanced: Object.freeze(advanced) });
}

/** The futures limits this build enforces; passed in so this model stays dependency-free (the view passes PAPER_FUTURES_OWNER_LIMITS). */
export interface FuturesLimitsInput {
  readonly maxLeverage: number;
  readonly minLiquidationDistanceRatio: number;
  readonly maxConsecutiveLosses: number;
  readonly maxDailyLossRatio: number;
  readonly maxPositionMarginRatio: number;
}

const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;

/**
 * Binance USD-M futures (PAPER only) rows for "안전". Fixed facts of the build: the futures domain is not wired to any
 * runtime yet, so it always reads "준비 중" and never as trading; the limits are the ones the futures gate enforces.
 */
export function buildFuturesSafetyRows(limits: FuturesLimitsInput): readonly SafetyRow[] {
  const rows: SafetyRow[] = [
    { label: "선물 (바이낸스 모의)", hint: "계산 엔진만 준비됐고 아직 거래하지 않아요", value: "준비 중", tone: "MUTED" },
    { label: "선물 레버리지", hint: "격리 마진만 써요", value: `최대 ${limits.maxLeverage}배`, tone: "NORMAL" },
    { label: "청산가까지 거리", hint: "더 가까우면 새 진입을 막아요", value: `${pct(limits.minLiquidationDistanceRatio)} 이상`, tone: "NORMAL" },
    { label: "포지션 증거금", hint: "한 포지션에 쓰는 증거금, 하루 시작 자산 기준", value: `${pct(limits.maxPositionMarginRatio)}까지`, tone: "NORMAL" },
    { label: "선물 손실 한도", hint: "한국 시간 하루 기준", value: `연속 ${limits.maxConsecutiveLosses}번 · 하루 ${pct(limits.maxDailyLossRatio)}`, tone: "NORMAL" },
  ];
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}
