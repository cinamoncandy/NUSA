// Presentation-only model for the LIVE tab: turns the read-only LIVE readiness snapshot into a
// short checklist of gates in plain Korean. It grants no authority; passing every gate still
// leaves LIVE sealed until the owner enables it outside the app. Import-free on purpose so tests
// can transpile this file alone.

export type LiveGateState = "PASS" | "BLOCKED" | "UNKNOWN";

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

function gate(id: string, title: string, detail: string, value: string, pass: string, unknown = "UNKNOWN"): LiveGate {
  const state: LiveGateState = value === pass ? "PASS" : value === unknown ? "UNKNOWN" : "BLOCKED";
  return Object.freeze({ id, title, detail, state });
}

function allOf(id: string, title: string, detail: string, values: readonly string[], pass: string): LiveGate {
  const state: LiveGateState = values.every((v) => v === pass) ? "PASS" : values.some((v) => v !== pass && v !== "UNKNOWN") ? "BLOCKED" : "UNKNOWN";
  return Object.freeze({ id, title, detail, state });
}

export function buildLiveGates(snapshot: LiveGateSnapshot | null): LiveGateSummary | null {
  if (snapshot == null) return null;
  const safetyBreached = Object.values(snapshot.runtimeSafety as Record<string, unknown>).some((flag) => flag === true);
  // An unavailable safety reader is normalised to all-false flags, so "no flags" only counts when the source is fresh.
  const safetyFresh = (snapshot.freshness as Record<string, unknown>).runtimeSafety === "FRESH";
  const evaluatorClear = snapshot.blockers.length === 0 && (snapshot.status === "READY_FOR_MANUAL_ENABLE" || snapshot.status === "ENABLED");
  const gates = Object.freeze([
    gate("paper", "PAPER 자동 학습이 안정적", "모의 매매 학습 결과가 흔들리지 않아야 합니다.", snapshot.paperAutoLearning, "STABLE"),
    gate("shadow", "SHADOW 재현 검증 통과", "같은 시장 기록으로 판단을 재현할 수 있어야 합니다.", snapshot.shadowReplay, "VALID", "MISSING"),
    gate("account", "실제 계좌 읽기 연결", "읽기 전용으로 계좌 상태를 확인할 수 있어야 합니다.", snapshot.realAccountMonitor, "CONNECTED"),
    gate("credential", "인증 정보 준비", "거래소 인증이 안전하게 준비되어야 합니다.", snapshot.credentialReadiness, "READY"),
    gate("governance", "전략 거버넌스 승인", "전략 운영 규칙 승인입니다. 실제 LIVE 활성화 승인과는 별개입니다.", snapshot.governance, "APPROVED"),
    gate("permission", "거래 허가", "거래 허가 판정이 PERMIT이어야 합니다.", snapshot.tradePermission, "PERMIT"),
    gate("risk", "위험 관리 정상", "위험 관리가 정지 상태가 아니어야 합니다.", snapshot.riskAuthority, "HEALTHY"),
    allOf("drills", "안전 훈련 4종 통과", "장부 대조 · 긴급 정지 · 중복 주문 방지 · 거래소 장애", [snapshot.reconciliationTests, snapshot.killSwitchTests, snapshot.idempotencyTests, snapshot.exchangeFaultTests], "PASS"),
    gate("mutation", "금지된 자금 이동 코드 없음", "출금·이체 같은 기능이 코드에 없어야 합니다.", snapshot.prohibitedFinancialMutationScan, "ABSENT"),
    Object.freeze({ id: "runtime", title: "실행 중 안전 신호 정상", detail: "긴급 정지·시세 지연·장부 불일치 신호가 없어야 합니다.", state: (safetyBreached ? "BLOCKED" : safetyFresh ? "PASS" : "UNKNOWN") as LiveGateState }),
    Object.freeze({ id: "evaluator", title: "준비 판정기 차단 없음", detail: snapshot.blockers.length > 0 ? `남은 차단 ${snapshot.blockers.length}개 · 세부 기록에서 확인` : "최종 준비 판정이 차단 없이 통과해야 합니다.", state: (evaluatorClear ? "PASS" : snapshot.blockers.length > 0 ? "BLOCKED" : "UNKNOWN") as LiveGateState }),
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
