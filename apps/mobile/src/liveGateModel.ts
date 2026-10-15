// Presentation-only model for the LIVE tab: turns the read-only LIVE readiness snapshot into a
// short checklist of gates in plain Korean. It grants no authority; passing every gate still
// leaves LIVE sealed until the owner enables it outside the app. Import-free on purpose so tests
// can transpile this file alone.

/**
 * PASS only when the evidence says pass AND its source is FRESH. FAIL is an explicit negative result, BLOCKED a missing
 * prerequisite, STALE evidence too old to trust, CHECKING no evidence yet. Missing or old evidence is never PASS.
 */
export type LiveGateState = "PASS" | "FAIL" | "BLOCKED" | "STALE" | "CHECKING";

export interface LiveGateSnapshot {
  readonly status: string;
  readonly blockers: readonly string[];
  readonly paperAutoLearning: string;
  readonly shadowReplay: string;
  readonly realAccountMonitor: string;
  readonly credentialReadiness: string;
  readonly governance: string;
  readonly tradePermission: string;
  readonly riskAuthority: string;
  readonly reconciliationTests: string;
  readonly killSwitchTests: string;
  readonly idempotencyTests: string;
  readonly exchangeFaultTests: string;
  readonly prohibitedFinancialMutationScan: string;
  /** Every boolean flag on it is a safety breach when true. */
  readonly runtimeSafety: object;
  /** Per-source freshness ("FRESH" | "STALE" | "UNKNOWN"); runtimeSafety flags are only trusted when fresh. */
  readonly freshness: object;
}

export interface LiveGate {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly state: LiveGateState;
}

export interface LiveGateSummary {
  readonly gates: readonly LiveGate[];
  readonly passed: number;
  readonly total: number;
  readonly headline: string;
  readonly detail: string;
}

type Outcome = Exclude<LiveGateState, "STALE">;

function freshnessOf(snapshot: LiveGateSnapshot, sources: readonly string[]): "FRESH" | "STALE" | "UNKNOWN" {
  const freshness = snapshot.freshness as Record<string, unknown>;
  const values = sources.map((source) => freshness[source]);
  if (values.every((value) => value === "FRESH")) return "FRESH";
  return values.some((value) => value === "STALE") ? "STALE" : "UNKNOWN";
}

/** A negative result stays FAIL whatever its age; anything else needs fresh evidence before it can read PASS. */
function settle(outcome: Outcome, freshness: "FRESH" | "STALE" | "UNKNOWN"): LiveGateState {
  if (outcome === "FAIL") return "FAIL";
  if (freshness === "STALE") return "STALE";
  if (freshness === "UNKNOWN") return "CHECKING";
  return outcome;
}

function gate(id: string, title: string, detail: string, state: LiveGateState): LiveGate {
  return Object.freeze({ id, title, detail, state });
}

function mapped(value: string, outcomes: Readonly<Record<string, Outcome>>): Outcome {
  return outcomes[value] ?? "CHECKING";
}

export function buildLiveGates(snapshot: LiveGateSnapshot | null): LiveGateSummary | null {
  if (snapshot == null) return null;
  const safetyBreached = Object.values(snapshot.runtimeSafety as Record<string, unknown>).some((flag) => flag === true);
  // An unavailable safety reader is normalised to all-false flags, so "no flags" only counts when the source is fresh (settle).
  const evaluatorClear = snapshot.blockers.length === 0 && (snapshot.status === "READY_FOR_MANUAL_ENABLE" || snapshot.status === "ENABLED");
  const fresh = (...sources: string[]) => freshnessOf(snapshot, sources);
  const drillValues = [snapshot.reconciliationTests, snapshot.killSwitchTests, snapshot.idempotencyTests, snapshot.exchangeFaultTests];
  const drills: Outcome = drillValues.some((v) => v === "FAIL") ? "FAIL" : drillValues.every((v) => v === "PASS") ? "PASS" : "CHECKING";
  const gates = Object.freeze([
    gate("paper", "PAPER 자동 학습이 안정적", "모의 매매 학습 결과가 흔들리지 않아야 합니다.", settle(mapped(snapshot.paperAutoLearning, { STABLE: "PASS", UNSTABLE: "FAIL" }), fresh("paperAutoLearning"))),
    gate("shadow", "SHADOW 재현 검증 통과", "같은 시장 기록으로 판단을 재현할 수 있어야 합니다.", settle(mapped(snapshot.shadowReplay, { VALID: "PASS", INVALID: "FAIL", MISSING: "BLOCKED" }), fresh("shadowReplay"))),
    // The monitor's own STALE value is age, not a failure.
    gate("account", "실제 계좌 읽기 연결", "읽기 전용으로 계좌 상태를 확인할 수 있어야 합니다.", snapshot.realAccountMonitor === "STALE" ? "STALE" : settle(mapped(snapshot.realAccountMonitor, { CONNECTED: "PASS", AUTH_ERROR: "FAIL", RELAY_ERROR: "FAIL", OFFLINE: "FAIL" }), fresh("realAccountMonitor"))),
    gate("credential", "인증 정보 준비", "거래소 인증이 안전하게 준비되어야 합니다.", settle(mapped(snapshot.credentialReadiness, { READY: "PASS", NOT_READY: "BLOCKED" }), fresh("realAccountMonitor"))),
    gate("governance", "전략 거버넌스 승인", "전략 운영 규칙 승인입니다. 실제 LIVE 활성화 승인과는 별개입니다.", settle(mapped(snapshot.governance, { APPROVED: "PASS", REJECTED: "FAIL" }), fresh("governance"))),
    gate("permission", "거래 허가", "거래 허가 판정이 PERMIT이어야 합니다.", settle(mapped(snapshot.tradePermission, { PERMIT: "PASS", REJECT: "FAIL" }), fresh("tradePermission"))),
    gate("risk", "위험 관리 정상", "위험 관리가 정지 상태가 아니어야 합니다.", settle(mapped(snapshot.riskAuthority, { HEALTHY: "PASS", HALTED: "FAIL" }), fresh("riskAuthority"))),
    gate("drills", "안전 훈련 4종 통과", "장부 대조 · 긴급 정지 · 중복 주문 방지 · 거래소 장애", settle(drills, fresh("reconciliationTests", "killSwitchTests", "idempotencyTests", "exchangeFaultTests"))),
    gate("mutation", "금지된 자금 이동 코드 없음", "출금·이체 같은 기능이 코드에 없어야 합니다.", settle(mapped(snapshot.prohibitedFinancialMutationScan, { ABSENT: "PASS", PRESENT: "FAIL" }), fresh("prohibitedFinancialMutationScan"))),
    gate("runtime", "실행 중 안전 신호 정상", "긴급 정지·시세 지연·장부 불일치 신호가 없어야 합니다.", settle(safetyBreached ? "FAIL" : "PASS", fresh("runtimeSafety"))),
    gate("evaluator", "준비 판정기 차단 없음", snapshot.blockers.length > 0 ? `남은 차단 ${snapshot.blockers.length}개 · 세부 기록에서 확인` : "최종 준비 판정이 차단 없이 통과해야 합니다.", evaluatorClear ? "PASS" : snapshot.blockers.length > 0 ? "BLOCKED" : "CHECKING"),
  ]);
  const passed = gates.filter((g) => g.state === "PASS").length;
  const total = gates.length;
  const halted = snapshot.status === "HALTED" || safetyBreached;
  const headline = halted ? "안전 정지 신호가 있습니다" : passed === total ? "모든 관문 통과 · 소유자 LIVE 활성화 승인 대기" : "LIVE는 잠겨 있습니다";
  const detail = halted
    ? "실행 중 안전 신호가 위반되어 LIVE 후보에서 제외됩니다."
    : passed === total
      ? "앱에서는 LIVE를 켤 수 없습니다. 활성화는 소유자가 앱 밖에서 직접 승인해야 합니다."
      : `관문 ${total}개 중 ${passed}개 통과. 실제 돈 거래는 모든 관문 통과 뒤 소유자의 LIVE 활성화 승인이 따로 필요합니다.`;
  return Object.freeze({ gates, passed, total, headline, detail });
}
