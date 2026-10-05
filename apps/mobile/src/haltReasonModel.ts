/**
 * Why the server reports PAPER as HALTED, in plain Korean, from values the server already sends.
 *
 * Read-only presentation: it never decides, clears or hides a halt. Unknown codes are shown verbatim
 * and a missing cause is stated as unknown, never guessed. Raw server text is bounded and shown as data.
 */
export interface HaltEvidenceInput {
  readonly runtimeHaltReasons?: unknown;
  readonly killSwitchActive?: unknown;
  readonly lastError?: unknown;
}

export interface HaltExplanation {
  readonly title: string;
  readonly lines: readonly string[];
}

const REASON_COPY: Readonly<Record<string, string>> = Object.freeze({
  KILL_SWITCH_ACTIVE: "비상 정지 스위치가 켜져 있습니다",
  AI_P0_OPEN: "AI 중대 경보(P0)가 열려 있습니다",
  AI_P0_UNVERIFIABLE: "AI 중대 경보(P0) 상태를 확인할 수 없습니다",
  DASHBOARD_FAULTED: "서버 대시보드가 장애 상태입니다",
});
const MAX_RAW = 160;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
// Per-tick market rejections are diagnostics, not halts (same rule as the server projection).
const DIAGNOSTIC_ERROR_PREFIX = "PUBLIC_MARKET_EVENT_REJECTED:";

const bounded = (value: string): string => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > MAX_RAW ? `${flat.slice(0, MAX_RAW - 1)}…` : flat;
};

export function buildHaltExplanation(status: string, evidence: HaltEvidenceInput | null | undefined): HaltExplanation | null {
  if (status !== "HALTED") return null;
  const lines: string[] = [];
  const reasons = Array.isArray(evidence?.runtimeHaltReasons) ? evidence.runtimeHaltReasons : [];
  for (const reason of reasons) {
    if (typeof reason !== "string" || !CODE.test(reason)) continue;
    const text = REASON_COPY[reason] ?? `알 수 없는 정지 코드: ${reason}`;
    if (!lines.includes(text)) lines.push(text);
  }
  if (evidence?.killSwitchActive === true && !reasons.includes("KILL_SWITCH_ACTIVE")) lines.push(REASON_COPY.KILL_SWITCH_ACTIVE);
  const error = typeof evidence?.lastError === "string" ? evidence.lastError.trim() : "";
  if (error !== "" && !error.startsWith(DIAGNOSTIC_ERROR_PREFIX)) lines.push(`서버가 기록한 마지막 오류: ${bounded(error)}`);
  if (lines.length === 0) lines.push("서버가 정지 사유를 보내지 않았습니다. 이 앱에서는 원인을 확인할 수 없습니다.");
  return Object.freeze({ title: "정지 사유", lines: Object.freeze(lines) });
}
