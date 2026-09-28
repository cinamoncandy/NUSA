/**
 * Field headers for the PAPER and LIVE tabs, in the same visual language as the HOME
 * Intelligence Field. Pure projections of canonical read-only state: no authority, no
 * synthetic values, and uncertainty always renders as a non-green tone.
 */
import type { FieldSubsystem, FieldTone } from "./intelligenceFieldModel";
import type { PaperLearningScreenState } from "./paperLearningScreen";
import type { LiveReadinessObservabilitySnapshot } from "../../../packages/contracts/src/liveReadinessObservability";

export interface FieldHeaderModel {
  readonly eyebrow: string;
  readonly statusWord: string;
  readonly tone: FieldTone;
  readonly headline: string;
  readonly detail: string;
  readonly subsystem: FieldSubsystem;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
}

const count = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)).toLocaleString("en-US") : "—");

export function buildPaperFieldHeader(paper: PaperLearningScreenState): FieldHeaderModel {
  const perf = paper.performance;
  const facts = Object.freeze([
    { label: "CYCLES", value: count(perf.completedCycles) },
    { label: "FILLS", value: count(perf.filledCycles) },
    { label: "SOURCE", value: paper.dataSource.replace(/_/g, " ") },
  ]);
  const base = { eyebrow: "PAPER", facts } as const;
  if (paper.dataSource === "NOT_CONFIGURED" || paper.dataSource === "UNAVAILABLE") {
    return Object.freeze({ ...base, statusWord: "OFFLINE", tone: "amber", headline: "PAPER 기록을\n불러오지 못했습니다", detail: "서버 연결이 확인되면 실행 기록이 표시됩니다.", subsystem: "governance" });
  }
  if (paper.status === "HALTED") {
    return Object.freeze({ ...base, statusWord: "HALTED", tone: "red", headline: "PAPER 정지", detail: "리스크 경계가 실행을 멈췄습니다. 원장은 보존됩니다.", subsystem: "risk" });
  }
  if (paper.status === "ERROR") {
    return Object.freeze({ ...base, statusWord: "ERROR", tone: "amber", headline: "PAPER 상태 확인 필요", detail: "최근 사이클에서 오류가 기록되었습니다.", subsystem: "governance" });
  }
  if (paper.status === "PAUSED") {
    return Object.freeze({ ...base, statusWord: "PAUSED", tone: "dim", headline: "PAPER 일시정지", detail: "새 사이클을 시작하지 않고 대기 중입니다.", subsystem: "paper" });
  }
  if (perf.filledCycles > 0) {
    return Object.freeze({ ...base, statusWord: "RUNNING", tone: "green", headline: "PAPER 실행 중", detail: `가상 체결 ${count(perf.filledCycles)}회가 기록되었습니다.`, subsystem: "paper" });
  }
  return Object.freeze({ ...base, statusWord: "RUNNING", tone: "green", headline: "관측은 하지만\n체결이 없습니다", detail: "사이클은 진행되지만 가상 체결은 아직 0건입니다.", subsystem: "paper" });
}

export function buildLiveFieldHeader(snapshot: LiveReadinessObservabilitySnapshot | null, unavailableReason?: string): FieldHeaderModel {
  if (snapshot == null) {
    return Object.freeze({ eyebrow: "LIVE", statusWord: "SEALED", tone: "dim", headline: "LIVE는 봉인되어 있습니다", detail: unavailableReason ? `준비도 정보를 불러오지 못했습니다 · ${unavailableReason}` : "준비도 정보를 불러오지 못했습니다.", subsystem: "governance", facts: Object.freeze([{ label: "AUTHORITY", value: "NONE" }]) });
  }
  const s = snapshot.runtimeSafety;
  const hardStop = snapshot.status === "HALTED" || s.killSwitchActive || s.exchangeError || s.staleMarketData || s.riskBudgetBreached || s.reconciliationMismatch || s.abnormalBalanceDrift || s.strategyInvalidated || s.latencyOrSlippageBreached;
  const facts = Object.freeze([
    { label: "BLOCKERS", value: count(snapshot.blockers.length) },
    { label: "STATUS", value: snapshot.status.replace(/_/g, " ") },
    { label: "AUTHORITY", value: snapshot.liveAuthority },
  ]);
  if (hardStop) {
    return Object.freeze({ eyebrow: "LIVE", statusWord: "HALTED", tone: "red", headline: "안전 정지 신호", detail: "런타임 안전 조건이 위반되어 LIVE 후보에서 제외됩니다.", subsystem: "risk", facts });
  }
  if (snapshot.status === "READY_FOR_MANUAL_ENABLE" && snapshot.blockers.length === 0) {
    // Readiness is evidence only; enabling LIVE remains an explicit owner decision outside the app.
    return Object.freeze({ eyebrow: "LIVE", statusWord: "SEALED", tone: "amber", headline: "승인 대기", detail: "모든 준비 조건이 통과했습니다. LIVE 활성화는 소유자 승인으로만 가능합니다.", subsystem: "governance", facts });
  }
  return Object.freeze({ eyebrow: "LIVE", statusWord: "SEALED", tone: "dim", headline: "LIVE는 봉인되어 있습니다", detail: snapshot.blockers.length > 0 ? `남은 차단 조건 ${count(snapshot.blockers.length)}개` : "준비도 증거를 수집하고 있습니다.", subsystem: "governance", facts });
}
