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
  /** Task-level Korean lines for the owner. Never a raw internal code. */
  readonly lines: readonly string[];
  /** One short phrase for space-constrained surfaces (HOME rail and headline). */
  readonly summary: string;
  /** Raw server error text for the advanced diagnostic line only; null when there is none. */
  readonly diagnostic: string | null;
}

const REASON_COPY: Readonly<Record<string, string>> = Object.freeze({
  KILL_SWITCH_ACTIVE: "비상 정지 스위치가 켜져 있습니다",
  AI_P0_OPEN: "AI 중대 경보(P0)가 열려 있습니다",
  AI_P0_UNVERIFIABLE: "AI 중대 경보(P0) 상태를 확인할 수 없습니다",
  DASHBOARD_FAULTED: "서버 대시보드가 장애 상태입니다",
});
const SHORT_COPY: Readonly<Record<string, string>> = Object.freeze({
  KILL_SWITCH_ACTIVE: "비상 정지 스위치",
  AI_P0_OPEN: "AI 중대 경보",
  AI_P0_UNVERIFIABLE: "경보 확인 불가",
  DASHBOARD_FAULTED: "서버 장애",
});
const MAX_RAW = 160;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
// Per-tick market rejections are diagnostics, not halts (same rule as the server projection).
const DIAGNOSTIC_ERROR_PREFIX = "PUBLIC_MARKET_EVENT_REJECTED:";

const bounded = (value: string): string => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > MAX_RAW ? `${flat.slice(0, MAX_RAW - 1)}…` : flat;
};

const PERSISTENCE_PREFIX = "paper account persistence failed";

/** Plain-Korean hint for why a PAPER account save failed, from the server's short cause text; null when it matches nothing known. */
function describePersistenceCause(cause: string): string | null {
  const c = cause.toLowerCase();
  if (/lease|writer/.test(c)) return "다른 프로세스가 쓰기 권한을 쥐고 있거나 권한을 잃었습니다";
  if (/readonly|read only|read-only/.test(c)) return "저장소가 읽기 전용입니다";
  if (/\bfull\b|enospc|no space/.test(c)) return "저장 공간이 부족합니다";
  if (/busy|locked/.test(c)) return "저장소가 다른 작업에 잠겨 있습니다";
  if (/cantopen|unable to open|eacces|permission/.test(c)) return "저장소 파일을 열거나 쓸 권한이 없습니다";
  if (/ledger|reconcile|checksum|schema|invalid/.test(c)) return "장부가 체결 기록과 맞지 않거나 형식이 올바르지 않습니다";
  return null;
}

/** Known server error codes in task-level Korean; anything else gets a generic line (raw text stays diagnostic). */
function describeServerError(code: string): string {
  if (code.startsWith(PERSISTENCE_PREFIX)) {
    const hint = describePersistenceCause(code.slice(PERSISTENCE_PREFIX.length));
    return hint == null ? "모의 계좌 상태를 서버가 저장하지 못했습니다" : `모의 계좌 상태를 서버가 저장하지 못했습니다 (${hint})`;
  }
  if (code === "PAPER_EXECUTION_FAILED" || code.startsWith("PAPER_EXECUTION_")) return "모의 주문 실행이 실패했습니다";
  if (code === "PUBLIC_ORDERBOOK_SNAPSHOT_UNAVAILABLE") return "호가 정보를 가져오지 못했습니다";
  if (code === "PAPER_ORDERBOOK_UNRECONCILED") return "호가 정보가 서로 맞지 않아 확인 중입니다";
  if (code === "PAPER_ORDERBOOK_OBSERVATION_REJECTED") return "호가 관측값이 거절되었습니다";
  if (code.startsWith("PAPER_MARKET_OBSERVATION_REJECTED")) return "시세 관측값이 거절되었습니다";
  if (code.startsWith("PUBLIC_MARKET_")) return "시세 연결 상태가 정상이 아닙니다";
  return "서버가 운영 중 오류를 기록했습니다";
}

export function buildHaltExplanation(status: string, evidence: HaltEvidenceInput | null | undefined): HaltExplanation | null {
  if (status !== "HALTED") return null;
  const lines: string[] = [];
  const shorts: string[] = [];
  const add = (line: string, short: string) => { if (!lines.includes(line)) { lines.push(line); shorts.push(short); } };
  const reasons = Array.isArray(evidence?.runtimeHaltReasons) ? evidence.runtimeHaltReasons : [];
  for (const reason of reasons) {
    if (typeof reason !== "string" || !CODE.test(reason)) continue;
    add(REASON_COPY[reason] ?? "서버가 알 수 없는 정지 사유를 보냈습니다", SHORT_COPY[reason] ?? "알 수 없는 사유");
  }
  if (evidence?.killSwitchActive === true) add(REASON_COPY.KILL_SWITCH_ACTIVE, SHORT_COPY.KILL_SWITCH_ACTIVE);
  const error = typeof evidence?.lastError === "string" ? evidence.lastError.trim() : "";
  const hasError = error !== "" && !error.startsWith(DIAGNOSTIC_ERROR_PREFIX);
  if (hasError) add(`서버가 기록한 마지막 오류: ${describeServerError(error)}`, "서버 오류");
  if (lines.length === 0) add("서버가 정지 사유를 보내지 않았습니다. 이 앱에서는 원인을 확인할 수 없습니다.", "사유 확인 불가");
  return Object.freeze({ title: "정지 사유", lines: Object.freeze(lines), summary: shorts.join(" · "), diagnostic: hasError ? bounded(error) : null });
}

/**
 * Short halt cause for HOME from a snapshot-shaped value. Kept here (not in homeFieldInput) so that
 * module stays a dependency-free single file, as its tests require.
 */
export function haltCauseFromSnapshot(snapshot: {
  readonly dashboard: { readonly killSwitchActive: boolean };
  readonly operations: { readonly runtimeState: string; readonly runtimeHaltReasons?: unknown; readonly heartbeat?: { readonly lastError?: unknown } };
} | null | undefined): string | null {
  if (snapshot == null) return null;
  const halted = snapshot.dashboard.killSwitchActive === true || snapshot.operations.runtimeState === "HALTED";
  if (!halted) return null;
  return buildHaltExplanation("HALTED", {
    runtimeHaltReasons: snapshot.operations.runtimeHaltReasons,
    killSwitchActive: snapshot.dashboard.killSwitchActive,
    lastError: snapshot.operations.heartbeat?.lastError,
  })?.summary ?? null;
}
