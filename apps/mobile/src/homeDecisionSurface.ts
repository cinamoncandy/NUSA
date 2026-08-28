export type HomeDecisionAttention = "ACTION REQUIRED" | "WATCH" | "QUIET";
export type HomeDecisionTone = "success" | "warning" | "danger" | "info";
export type HomeDecisionPrimaryAction = "SETTINGS" | "PORTFOLIO" | "AI_SIGNAL" | "MARKETS";

export interface HomeDecisionSurfaceInput {
  readonly runtimeState?: string;
  readonly health?: string;
  readonly readyForPaperOperations: boolean;
  readonly disconnected: boolean;
  readonly readOnlyError: boolean;
  readonly accountSource: "CLOUD" | "LOCAL" | null;
  readonly paperEquity?: number;
  readonly paperTotalPnl?: number | null;
  readonly aiThesis?: string | null;
  readonly aiEvidenceCount: number;
  readonly aiCalibrationStatus?: string | null;
  readonly aiConfidence?: number | null;
}

export interface HomeDecisionSurface {
  readonly attention: HomeDecisionAttention;
  readonly statusLabel: string;
  readonly statusTone: HomeDecisionTone;
  readonly now: string;
  readonly why: string;
  readonly result: string;
  readonly risk: string;
  readonly learning: string;
  readonly primaryLabel: string;
  readonly primaryDetail: string;
  readonly primaryAction: HomeDecisionPrimaryAction;
  readonly aiInsightAvailable: boolean;
  readonly calibratedConfidence?: string;
  readonly signalReady: boolean;
  readonly runtimeNeedsSupervision: boolean;
}

const ACTION_RUNTIME_STATES = new Set(["HALTED", "ERROR"]);
const WATCH_RUNTIME_STATES = new Set(["DEGRADED", "STOPPED", "STOPPING"]);

function krw(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function healthyTone(health: string | undefined): HomeDecisionTone {
  return health === "HEALTHY" || health === "READY" || health === "ONLINE" || health === "RUNNING"
    ? "success"
    : health === "FAIL_CLOSED" || health === "DOWN"
      ? "danger"
      : "warning";
}

export function buildHomeDecisionSurface(input: HomeDecisionSurfaceInput): HomeDecisionSurface {
  const runtimeState = input.runtimeState;
  const runtimeActionRequired = runtimeState != null && ACTION_RUNTIME_STATES.has(runtimeState);
  const runtimeWatch = runtimeState != null && WATCH_RUNTIME_STATES.has(runtimeState);
  const runtimeNeedsSupervision = runtimeActionRequired || runtimeWatch;
  const signalReady = input.health === "HEALTHY" && input.readyForPaperOperations;
  const aiThesis = input.aiThesis?.trim() ?? "";
  const aiInsightAvailable = aiThesis.length > 0 && input.aiEvidenceCount > 0;
  const calibratedConfidence = aiInsightAvailable && input.aiCalibrationStatus === "CALIBRATED" && input.aiConfidence != null
    ? `${Math.round(input.aiConfidence * 100)}%`
    : undefined;

  const attention: HomeDecisionAttention = input.disconnected || input.readOnlyError || runtimeActionRequired
    ? "ACTION REQUIRED"
    : runtimeWatch || (input.accountSource === "CLOUD" && !signalReady)
      ? "WATCH"
      : "QUIET";

  const statusLabel = input.accountSource === "CLOUD"
    ? `PAPER · ${runtimeState === "RUNNING" ? "RUNNING" : runtimeState === "DEGRADED" ? "DEGRADED" : runtimeState === "HALTED" ? "HALTED" : runtimeState === "ERROR" ? "ERROR" : runtimeState === "STOPPED" || runtimeState === "STOPPING" ? "STOPPED" : signalReady ? "READY" : "CHECK"}`
    : input.accountSource === "LOCAL"
      ? "PAPER · LOCAL"
      : input.disconnected
        ? "PAPER · OFFLINE"
        : "PAPER · STANDBY";

  const statusTone: HomeDecisionTone = input.accountSource === "CLOUD"
    ? runtimeActionRequired
      ? "danger"
      : runtimeWatch
        ? "warning"
        : healthyTone(input.health)
    : input.accountSource === "LOCAL"
      ? "info"
      : "warning";

  const now = input.disconnected
    ? "PAPER LINK REQUIRED"
    : input.readOnlyError
      ? "RECOVERY REQUIRED"
      : runtimeState === "HALTED"
        ? "PAPER RUNTIME HALTED"
        : runtimeState === "ERROR"
          ? "PAPER RUNTIME ERROR"
          : runtimeState === "STOPPED" || runtimeState === "STOPPING"
            ? "PAPER RUNTIME STOPPED"
            : runtimeState === "DEGRADED"
              ? "PAPER RUNTIME DEGRADED"
              : runtimeState === "RUNNING"
                ? "PAPER SUPERVISION RUNNING"
                : signalReady
                  ? "PAPER DECISION READY"
                  : "DECISION HOLD";

  const why = input.disconnected
    ? "PAPER 데이터 연결 전에는 판단을 생성하지 않습니다."
    : input.readOnlyError
      ? "시장 연결의 신뢰성이 확인될 때까지 새로운 판단을 보류합니다."
      : runtimeState === "HALTED"
        ? "PAPER runtime이 중단되어 새로운 판단을 진행하지 않습니다."
        : runtimeState === "ERROR"
          ? "PAPER runtime이 오류를 보고하여 감독자의 확인이 필요합니다."
          : runtimeState === "STOPPED" || runtimeState === "STOPPING"
            ? "PAPER runtime이 정지되어 있어 새로운 판단이 생성되지 않습니다."
            : runtimeState === "DEGRADED"
              ? "PAPER runtime 상태가 저하되어 감독자의 확인이 필요합니다."
              : aiInsightAvailable
                ? aiThesis
                : signalReady
                  ? "검증 가능한 AI 근거가 축적될 때까지 판단을 확대하지 않습니다."
                  : "운영·시장 입력이 안전 게이트를 통과할 때까지 대기합니다.";

  const result = input.paperEquity == null
    ? "검증된 PAPER 성과 데이터 없음"
    : `PAPER P&L ${input.paperTotalPnl == null ? "—" : `${input.paperTotalPnl >= 0 ? "+" : ""}${krw(input.paperTotalPnl)}`} · EQUITY ${krw(input.paperEquity)}`;

  const risk = input.disconnected
    ? "BLOCKED · PAPER LINK REQUIRED"
    : input.readOnlyError
      ? "BLOCKED · READ-ONLY RECOVERY REQUIRED"
      : runtimeActionRequired
        ? "BLOCKED · PAPER RUNTIME REQUIRES ACTION"
        : runtimeWatch
          ? "WATCH · PAPER RUNTIME REQUIRES SUPERVISION"
          : input.accountSource !== "CLOUD"
            ? "INSUFFICIENT · PAPER RUNTIME EVIDENCE UNAVAILABLE"
            : signalReady
              ? "PAPER ONLY · SAFETY GATES READY · LIVE NONE"
              : "WATCH · PAPER SAFETY GATES NOT READY";

  const learning = aiInsightAvailable
    ? `근거 ${input.aiEvidenceCount}개 · ${calibratedConfidence ?? "UNCALIBRATED"} · 검증된 근거만 학습 화면으로 연결`
    : "검증 근거가 없으므로 새로운 학습 결론을 표시하지 않습니다.";

  const primaryLabel = input.disconnected
    ? "CONNECT PAPER"
    : input.readOnlyError
      ? "RECOVER"
      : runtimeNeedsSupervision
        ? "SUPERVISE PAPER"
        : aiInsightAvailable
          ? "OPEN SIGNAL"
          : "OPEN MARKET";

  const primaryDetail = input.disconnected
    ? "PAPER 연결 후 실제 시장 입력과 모의계좌 상태를 표시합니다."
    : input.readOnlyError
      ? "현재 연결 상태를 복구한 뒤 판단을 다시 확인합니다."
      : runtimeNeedsSupervision
        ? "현재 PAPER runtime 상태와 계좌 결과를 먼저 감독합니다."
        : aiInsightAvailable
          ? "검증된 근거와 현재 NUSA 판단을 확인합니다."
          : "시장 데이터는 읽기 전용으로 분석 중입니다.";

  const primaryAction: HomeDecisionPrimaryAction = input.disconnected || input.readOnlyError
    ? "SETTINGS"
    : runtimeNeedsSupervision
      ? "PORTFOLIO"
      : aiInsightAvailable
        ? "AI_SIGNAL"
        : "MARKETS";

  return {
    attention,
    statusLabel,
    statusTone,
    now,
    why,
    result,
    risk,
    learning,
    primaryLabel,
    primaryDetail,
    primaryAction,
    aiInsightAvailable,
    calibratedConfidence,
    signalReady,
    runtimeNeedsSupervision,
  };
}
