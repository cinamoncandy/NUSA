export type HomeDecisionAttention = "ACTION REQUIRED" | "WATCH" | "QUIET";
export type HomeDecisionTone = "success" | "warning" | "danger" | "info";
export type HomeDecisionPrimaryAction = "SETTINGS" | "PORTFOLIO" | "AI_SIGNAL" | "MARKETS";

export interface HomeDecisionSurfaceInput {
  readonly runtimeState: string | undefined;
  readonly health: string | undefined;
  readonly readyForPaperOperations: boolean;
  readonly disconnected: boolean;
  readonly readOnlyError: boolean;
  readonly accountSource: "CLOUD" | "LOCAL" | null;
  readonly paperEquity: number | undefined;
  readonly paperTotalPnl: number | null | undefined;
  readonly aiThesis: string | null | undefined;
  readonly aiEvidenceCount: number;
  readonly aiCalibrationStatus: string | null | undefined;
  readonly aiConfidence: number | null | undefined;
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
  readonly calibratedConfidence: string | undefined;
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
  // A retained Cloud snapshot is historical evidence, not proof that its current read-only
  // transport is usable. Connection/recovery failure must therefore outrank a prior RUNNING
  // runtime state in every visible status projection.
  const connectionRecoveryRequired = input.disconnected || input.readOnlyError;
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
    : runtimeWatch || input.accountSource === "LOCAL" || (input.accountSource === "CLOUD" && !signalReady)
      ? "WATCH"
      : "QUIET";

  const statusLabel = connectionRecoveryRequired
    ? "모의투자 · 복구 필요"
    : input.accountSource === "CLOUD"
    ? `모의투자 · ${runtimeState === "RUNNING" ? "실행 중" : runtimeState === "DEGRADED" ? "일부 문제" : runtimeState === "HALTED" ? "안전 정지" : runtimeState === "ERROR" ? "오류" : runtimeState === "STOPPED" || runtimeState === "STOPPING" ? "정지됨" : signalReady ? "준비됨" : "확인 필요"}`
    : input.accountSource === "LOCAL"
      ? "모의투자 · 기기 내"
      : input.disconnected
        ? "모의투자 · 연결 안 됨"
        : "모의투자 · 대기 중";

  const statusTone: HomeDecisionTone = connectionRecoveryRequired
    ? "danger"
    : input.accountSource === "CLOUD"
    ? runtimeActionRequired
      ? "danger"
      : runtimeWatch
        ? "warning"
        : healthyTone(input.health)
    : input.accountSource === "LOCAL"
      ? "info"
      : "warning";

  const now = input.disconnected
    ? "모의투자 연결 필요"
    : input.readOnlyError
      ? "복구 필요"
      : runtimeState === "HALTED"
        ? "모의투자 안전 정지"
        : runtimeState === "ERROR"
          ? "모의투자 실행 오류"
          : runtimeState === "STOPPED" || runtimeState === "STOPPING"
            ? "모의투자 정지됨"
            : runtimeState === "DEGRADED"
              ? "모의투자 일부 문제"
              : runtimeState === "RUNNING"
                ? "모의투자 실행 중"
                : signalReady
                  ? "모의투자 판단 준비됨"
                  : "판단 보류";

  const why = input.disconnected
    ? "PAPER 데이터 연결 전에는 판단을 생성하지 않습니다."
    : input.readOnlyError
      ? "시장 연결의 신뢰성이 확인될 때까지 새로운 판단을 보류합니다."
      : runtimeState === "HALTED"
        ? "모의투자가 안전 정지되어 새로운 판단을 진행하지 않습니다."
        : runtimeState === "ERROR"
          ? "모의투자 실행에 오류가 있어 확인이 필요합니다."
          : runtimeState === "STOPPED" || runtimeState === "STOPPING"
            ? "모의투자가 정지되어 새로운 판단이 생성되지 않습니다."
            : runtimeState === "DEGRADED"
              ? "모의투자 실행 상태에 문제가 있어 확인이 필요합니다."
              : aiInsightAvailable
                ? aiThesis
                : signalReady
                  ? "검증 가능한 AI 근거가 축적될 때까지 판단을 확대하지 않습니다."
                  : "운영·시장 입력이 안전 게이트를 통과할 때까지 대기합니다.";

  const result = input.paperEquity == null
    ? "검증된 PAPER 성과 데이터 없음"
    : `모의투자 손익 ${input.paperTotalPnl == null ? "—" : `${input.paperTotalPnl >= 0 ? "+" : ""}${krw(input.paperTotalPnl)}`} · 평가 자산 ${krw(input.paperEquity)}`;

  const risk = input.disconnected
    ? "진행 불가 · 모의투자 연결 필요"
    : input.readOnlyError
      ? "진행 불가 · 연결 복구 필요"
      : runtimeActionRequired
        ? "진행 불가 · 모의투자 상태 확인 필요"
        : runtimeWatch
          ? "주의 · 모의투자 상태 확인 필요"
          : input.accountSource !== "CLOUD"
            ? "확인할 데이터 부족 · 모의투자 실행 기록 없음"
            : signalReady
              ? "모의투자 전용 · 안전 확인 완료 · 실거래 권한 없음"
              : "주의 · 모의투자 안전 확인 필요";

  const learning = aiInsightAvailable
    ? `근거 ${input.aiEvidenceCount}개 · ${calibratedConfidence ?? "확신도 검증 안 됨"} · 검증된 근거만 학습 화면으로 연결`
    : "검증 근거가 없으므로 새로운 학습 결론을 표시하지 않습니다.";

  const primaryLabel = input.disconnected
    ? "모의투자 연결"
    : input.readOnlyError
      ? "복구"
      : runtimeNeedsSupervision
        ? "모의투자 상태 확인"
        : aiInsightAvailable
          ? "판단 근거 보기"
          : "시세 보기";

  const primaryDetail = input.disconnected
    ? "PAPER 연결 후 실제 시장 입력과 모의계좌 상태를 표시합니다."
    : input.readOnlyError
      ? "현재 연결 상태를 복구한 뒤 판단을 다시 확인합니다."
      : runtimeNeedsSupervision
        ? "현재 모의투자 실행 상태와 계좌 결과를 먼저 확인합니다."
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
