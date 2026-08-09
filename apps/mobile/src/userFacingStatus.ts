import type { AiReadOnlyProjection } from "../../../packages/contracts/src/aiInference";
import type { PersonalPaperOperationsHealth, PersonalPaperRuntimeState } from "../../../packages/contracts/src/personalPaperOperations";
import type { ResearchHealth, ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import type { OrderHistoryStatus } from "./orderHistory";

export function aiStatusLabel(status: AiReadOnlyProjection["status"] | null | undefined): string {
  if (status === "AVAILABLE") return "분석 준비됨";
  if (status === "INCOMPLETE") return "분석 불완전";
  if (status === "UNAVAILABLE") return "분석 없음";
  return "확인 필요";
}

export function criticSeverityLabel(severity: AiReadOnlyProjection["criticSeverity"]): string {
  if (severity === "none") return "없음";
  if (severity === "low") return "낮음";
  if (severity === "medium") return "중간";
  if (severity === "high") return "높음";
  if (severity === "critical") return "매우 높음";
  return "-";
}

export function calibrationStatusLabel(status: AiReadOnlyProjection["calibrationStatus"] | null | undefined): string {
  return status === "UNKNOWN" ? "미보정" : "확인 필요";
}

export function researchHealthLabel(health: ResearchHealth | null | undefined): string {
  if (health === "HEALTHY") return "정상";
  if (health === "STALE") return "오래된 데이터";
  if (health === "DEGRADED") return "저하";
  if (health === "FAIL_CLOSED") return "안전 차단";
  return "확인 필요";
}

export function strategyAuthorityLabel(authority: ResearchStatusProjection["champion"]["authority"] | ResearchStatusProjection["challenger"]["authority"] | null | undefined): string {
  if (authority === "PAPER_ONLY") return "PAPER 전용";
  if (authority === "ZERO_AUTHORITY") return "실행 권한 없음";
  return "확인 필요";
}

export function operationsHealthLabel(health: PersonalPaperOperationsHealth | string | null | undefined): string {
  if (health === "HEALTHY") return "정상";
  if (health === "DEGRADED") return "저하";
  if (health === "FAIL_CLOSED") return "안전 차단";
  if (health === "DOWN") return "중단";
  if (health === "READY") return "준비됨";
  return "확인 필요";
}

export function runtimeStateLabel(state: PersonalPaperRuntimeState | string | null | undefined): string {
  if (state === "READY") return "준비됨";
  if (state === "READY_OFFLINE") return "오프라인 준비";
  if (state === "HALTED") return "안전 중지";
  if (state === "STOPPING") return "중지 중";
  if (state === "STOPPED") return "중지됨";
  return "확인 필요";
}

export function liveAuthorityLabel(authority: "NONE" | null | undefined): string {
  return authority === "NONE" ? "없음" : "확인 필요";
}

export function marketConnectionLabel(state: string | null | undefined): string {
  if (state === "CONNECTED" || state === "ONLINE") return "연결됨";
  if (state === "DISCONNECTED" || state === "OFFLINE") return "연결 안 됨";
  return "확인 필요";
}

export function orderStatusLabel(status: OrderHistoryStatus): string {
  if (status === "FILLED") return "체결 완료";
  if (status === "CANCELLED") return "취소";
  if (status === "OPEN") return "대기";
  if (status === "FAILED") return "실패";
  return "확인 필요";
}

export function orderSideLabel(side: "BUY" | "SELL"): string {
  return side === "BUY" ? "매수" : "매도";
}
