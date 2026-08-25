import type { MobileRuntimeSnapshot } from "./mobileRuntime";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";

export type MobileUxState =
  | "BOOTING"
  | "CONNECTING"
  | "OFFLINE"
  | "READY"
  | "ANALYZING"
  | "INSUFFICIENT_DATA"
  | "VIEW_READY"
  | "STALE"
  | "EXECUTING"
  | "EXECUTION_UNKNOWN"
  | "FILLED"
  | "FAILED";

export interface MobileUxInput {
  readonly authReady: boolean;
  readonly operations: PersonalPaperOperationsLoadResult;
  readonly runtime: MobileRuntimeSnapshot;
  readonly refreshing: boolean;
}

export function mapMobileUxState(input: MobileUxInput): MobileUxState {
  if (!input.authReady) return "BOOTING";
  if (input.refreshing) return "CONNECTING";
  if (input.runtime.network !== "ONLINE") return "OFFLINE";
  if (input.operations.status === "NOT_CONFIGURED") return "OFFLINE";
  if (input.operations.status === "UNAVAILABLE") return "FAILED";
  if (input.operations.status !== "READY") return "CONNECTING";

  const snapshot = input.operations.snapshot;
  if (snapshot.health !== "HEALTHY" || !snapshot.readyForPaperOperations) return "STALE";

  const ai = snapshot.ai;
  if (ai == null || ai.status !== "AVAILABLE") return "ANALYZING";
  const hasEvidence = Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  if (!hasEvidence || ai.calibrationStatus !== "CALIBRATED") return "INSUFFICIENT_DATA";
  return "VIEW_READY";
}

export function mobileUxLabel(state: MobileUxState): string {
  switch (state) {
    case "BOOTING": return "시작 중";
    case "CONNECTING": return "연결 중";
    case "OFFLINE": return "연결 필요";
    case "READY": return "준비됨";
    case "ANALYZING": return "시장 분석 중";
    case "INSUFFICIENT_DATA": return "판단 보류";
    case "VIEW_READY": return "판단 준비됨";
    case "STALE": return "업데이트 지연";
    case "EXECUTING": return "주문 처리 중";
    case "EXECUTION_UNKNOWN": return "주문 상태 확인 중";
    case "FILLED": return "체결 완료";
    case "FAILED": return "복구 필요";
  }
}
