import type { LiveGateSummary } from "./liveGateModel";
import type { CalmTone } from "./uiKitModel";

/**
 * "안전" screen model. The first two rows are fixed facts of this build (PAPER only, AI advisory
 * only) and never depend on a server value, so no response can make LIVE look unlocked.
 * Gate progress is shown as information, never as an invitation to enable anything.
 */
export interface SafetyRow { readonly label: string; readonly hint: string; readonly value: string; readonly tone: CalmTone }
export interface SafetyScreenModel { readonly rows: readonly SafetyRow[]; readonly advanced: readonly string[] }

const GATE_WORD = Object.freeze({ PASS: "통과", BLOCKED: "막힘", UNKNOWN: "확인 중" } as const);

export function buildSafetyScreen(gates: LiveGateSummary | null, blockers: readonly string[]): SafetyScreenModel {
  const rows: SafetyRow[] = [
    { label: "실거래", hint: "모의투자만 할 수 있어요", value: "잠김 · 영구", tone: "ORDER" },
    { label: "AI", hint: "의견만 낼 수 있어요", value: "권한 없음", tone: "NORMAL" },
  ];
  if (gates != null) {
    rows.push({ label: "실거래 준비 관문", hint: "통과해도 실거래는 켜지지 않아요", value: `${gates.passed} / ${gates.total}`, tone: "MUTED" });
    for (const gate of gates.gates) rows.push({ label: gate.title, hint: gate.detail, value: GATE_WORD[gate.state], tone: gate.state === "PASS" ? "NORMAL" : gate.state === "BLOCKED" ? "ATTENTION" : "MUTED" });
  }
  const advanced = [
    ...(gates?.gates.map((gate) => `${gate.id}=${gate.state}`) ?? []),
    ...blockers.map((blocker) => `blocker: ${blocker}`),
  ];
  return Object.freeze({ rows: Object.freeze(rows.map((row) => Object.freeze(row))), advanced: Object.freeze(advanced) });
}
