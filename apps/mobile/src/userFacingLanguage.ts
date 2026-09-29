export const USER_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  NOT_CONFIGURED: "설정 필요", UNAVAILABLE: "사용 불가", DISCONNECTED: "연결 안 됨", CONNECTED: "연결됨",
  RUNNING: "실행 중", READY: "준비됨", NOT_READY: "준비 안 됨", READY_FOR_MANUAL_ENABLE: "사용자 확인 대기",
  ENABLED: "활성화됨", FAILED: "실패", FAIL: "실패", ERROR: "오류", RECOVERING: "복구 중",
  WAITING_PROVIDER_CAPACITY: "외부 사용량 한도 대기", RATE_LIMITED: "요청 한도 초과", STALE: "최신 정보 아님",
  FRESH: "최신", NO_PROJECTION: "상태 정보 없음", PROJECTION_ABSENT: "상태 정보 없음", PROJECTION_EMPTY: "서버 기록 없음",
  INSUFFICIENT_EVIDENCE: "확인할 데이터 부족", BLOCKED: "진행 불가", HALTED: "안전 정지", PAUSED: "일시 중지",
  OBSERVING: "확인 중", ACTIVE: "실행 중", DEGRADED: "일부 문제", UNKNOWN: "정보 없음", PASS: "통과", SKIP: "건너뜀",
  APPROVED: "승인됨", REJECTED: "거부됨", REJECT: "거부됨", PERMIT: "허용", HEALTHY: "정상", ONLINE: "연결됨",
  OFFLINE: "연결 안 됨", AUTH_ERROR: "인증 실패", RELAY_ERROR: "연결 오류", STABLE: "안정", UNSTABLE: "불안정",
  VALID: "정상", INVALID: "확인 필요", MISSING: "정보 없음", ABSENT: "없음", PRESENT: "있음", EXPIRED: "만료됨",
  CLEAR: "이상 없음", WATCH: "주의", REVIEW: "확인 필요", INSUFFICIENT: "데이터 부족", AGING: "조금 오래됨", SUCCESS: "성공", PARTIAL_SUCCESS: "일부 성공", UNDERPERFORMED: "기대 미달", REGRESSION: "이전보다 나빠짐", AVAILABLE: "사용 가능", VALIDATED: "검증 완료", WARNING: "주의", CRITICAL: "긴급", PENDING: "대기 중", CONFIGURED: "설정됨", VERIFYING: "확인 중", VERIFIED: "확인 완료", RETRY: "다시 시도", LOADING: "불러오는 중", NONE: "없음",
});
export const USER_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  SERVER_STREAM: "서버 실시간 데이터", LOCAL_FALLBACK: "기기 내 대체 데이터", NOT_CONFIGURED: "설정 필요",
  UNAVAILABLE: "사용 불가", PROJECTION_ABSENT: "상태 정보 없음", PROJECTION_EMPTY: "서버 기록 없음",
  CLOUD: "서버", LOCAL: "기기 내", REAL_READ_ONLY: "실계좌 보기 전용",
});
export const USER_STAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  MARKET_DATA: "시세 데이터", SIGNAL: "판단 신호", CANDIDATE: "전략 후보", DECISION: "결정", PERMISSION: "권한 확인",
  RISK: "위험 확인", ORDER_INTENT: "주문 판단", FILL: "체결", PNL: "손익", LEARNING: "학습", HALT: "안전 정지",
  ERROR: "오류", IDEMPOTENCY: "중복 처리 확인", PERIOD_OPEN: "평가 시작", PERIOD_REALIZED_PERSISTED: "확정 손익 기록",
  PERIOD_REJECTED: "평가 제외", SUBMIT: "주문 요청", ACK: "주문 확인", RECONCILIATION: "데이터 맞춤 확인",
});
export const USER_SOURCE_ID_LABELS: Readonly<Record<string, string>> = Object.freeze({
  currentHeadSha: "현재 버전", paperAutoLearning: "모의투자 학습", shadowReplay: "가상 검증 재생",
  realAccountMonitor: "실계좌 확인", governance: "전략 관리", tradePermission: "거래 권한", riskAuthority: "위험관리 상태",
  reconciliationTests: "데이터 맞춤 확인", killSwitchTests: "안전 정지 확인", idempotencyTests: "중복 처리 확인",
  exchangeFaultTests: "거래소 장애 확인", workflows: "자동 확인", prohibitedFinancialMutationScan: "금지된 변경 확인",
  environmentFingerprint: "실행 환경 식별값", accountFingerprint: "계좌 식별값", riskLimits: "위험 한도",
  runtimeSafety: "실행 안전 상태", authority: "권한", activationState: "활성화 상태", activationLeaseState: "활성화 유효 상태",
});
export function userStatus(value: string | null | undefined): string { if (!value) return "정보 없음"; return USER_STATUS_LABELS[value] ?? value; }
export function userSource(value: string | null | undefined): string { if (!value) return "정보 없음"; return USER_SOURCE_LABELS[value] ?? value; }
export function userStage(value: string | null | undefined): string { if (!value) return "정보 없음"; return USER_STAGE_LABELS[value] ?? value; }
export function userSourceId(value: string): string { return USER_SOURCE_ID_LABELS[value] ?? "기타 상태"; }
export function userOrderSide(value: string | null | undefined): string { return value === "BUY" ? "매수" : value === "SELL" ? "매도" : value ?? "정보 없음"; }
export function userOrderStatus(value: string | null | undefined): string { if (value === "FILLED") return "체결"; if (value === "CANCELLED") return "취소"; return userStatus(value); }
export function userReason(value: string | null | undefined): string {
  if (!value) return "상세 정보 없음";
  const exact: Readonly<Record<string, string>> = {
    "Cloud PAPER connection is not configured.": "모의투자 서버 연결이 설정되지 않았습니다.",
    "Cloud PAPER endpoint is not configured.": "모의투자 서버 주소가 설정되지 않았습니다.",
    "Cloud PAPER connection verification is in progress.": "모의투자 서버 연결을 확인하는 중입니다.",
    "Secure installation identity is unavailable.": "이 기기의 보안 식별 정보를 사용할 수 없습니다.",
    "Settings are unavailable.": "설정을 사용할 수 없습니다.",
    "Settings could not be saved.": "설정을 저장할 수 없습니다.",
    "Investment allocation is invalid.": "투자 비중을 확인해 주세요.",
    "Upbit bridge connection failed.": "Upbit 계좌 보기 연결에 실패했습니다.",
  };
  if (exact[value]) return exact[value];
  let result = value
    .replaceAll("REAL_READ_ONLY", "실계좌 보기 전용").replaceAll("LOCAL_FALLBACK", "기기 내 대체 데이터")
    .replaceAll("SERVER_STREAM", "서버 실시간 데이터").replaceAll("PAPER", "모의투자").replaceAll("LIVE", "실거래")
    .replaceAll("runtime", "실행 상태").replaceAll("Runtime", "실행 상태").replaceAll("endpoint", "서버 주소")
    .replaceAll("Endpoint", "서버 주소").replaceAll("session", "로그인 상태").replaceAll("Session", "로그인 상태")
    .replaceAll("projection", "상태 정보").replaceAll("Projection", "상태 정보").replaceAll("canonical", "기준")
    .replaceAll("Canonical", "기준").replaceAll("readiness", "준비 상태").replaceAll("Readiness", "준비 상태")
    .replaceAll("transport", "연결").replaceAll("Transport", "연결").replaceAll("connection", "연결").replaceAll("Connection", "연결").replaceAll("verification", "확인").replaceAll("Verification", "확인").replaceAll("Cloud", "서버").replaceAll("cloud", "서버");
  for (const [raw, friendly] of Object.entries(USER_STATUS_LABELS)) result = result.replaceAll(raw, friendly);
  return result;
}
