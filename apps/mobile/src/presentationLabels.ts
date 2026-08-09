export function runtimeStateLabel(value: string | null | undefined): string {
  switch (value) {
    case "RUNNING": return "운영 중";
    case "READY": return "준비됨";
    case "HALTED": return "중지";
    case "FAIL_CLOSED": return "안전 차단";
    case "DEGRADED": return "점검 필요";
    case "DOWN": return "연결 끊김";
    default: return "확인 필요";
  }
}

export function healthLabel(value: string | null | undefined): string {
  switch (value) {
    case "HEALTHY": return "정상";
    case "READY": return "준비됨";
    case "FAIL_CLOSED": return "안전 차단";
    case "DEGRADED": return "점검 필요";
    case "STALE": return "데이터 지연";
    case "DOWN": return "연결 끊김";
    default: return "확인 필요";
  }
}

export function aiStatusLabel(value: string | null | undefined): string {
  switch (value) {
    case "AVAILABLE": return "분석 준비됨";
    case "INCOMPLETE": return "분석 불완전";
    case "UNAVAILABLE": return "분석 없음";
    default: return "확인 필요";
  }
}

export function calibrationLabel(value: string | null | undefined): string {
  return value === "UNKNOWN" ? "미보정" : value ? "보정됨" : "확인 필요";
}

export function criticSeverityLabel(value: string | null | undefined): string {
  switch (value) {
    case "critical": return "매우 높음";
    case "high": return "높음";
    case "medium": return "중간";
    case "low": return "낮음";
    case "none": return "없음";
    default: return "확인 필요";
  }
}

export function transportLabel(value: string | null | undefined): string {
  switch (value) {
    case "ONLINE": return "온라인";
    case "OFFLINE": return "오프라인";
    default: return "확인 중";
  }
}

export function marketConnectionLabel(value: string | null | undefined): string {
  switch (value) {
    case "CONNECTED":
    case "HEALTHY":
    case "ONLINE": return "온라인";
    case "DISCONNECTED":
    case "OFFLINE":
    case "DOWN": return "오프라인";
    default: return "확인 중";
  }
}

export function liveAuthorityLabel(value: string | null | undefined): string {
  return value === "NONE" ? "없음" : "확인 필요";
}

export function productionMutationLabel(value: boolean | null | undefined): string {
  return value === false ? "금지" : value === true ? "허용" : "확인 필요";
}

export function researchAuthorityLabel(value: string | null | undefined): string {
  switch (value) {
    case "PAPER_ONLY": return "PAPER 전용";
    case "ZERO_AUTHORITY": return "실행 권한 없음";
    case "RESEARCH_ONLY": return "리서치 전용";
    default: return value ? "제한됨" : "확인 필요";
  }
}

export function orderStatusLabel(value: string): string {
  switch (value) {
    case "FILLED": return "체결";
    case "CANCELLED": return "취소";
    case "OPEN": return "진행 중";
    case "FAILED": return "실패";
    default: return "확인 필요";
  }
}

export function orderSideLabel(value: string): string {
  return value === "BUY" ? "매수" : value === "SELL" ? "매도" : "확인 필요";
}

export function tradingReasonLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    "price is required": "가격을 입력해 주세요.",
    "price must be positive": "가격은 0보다 커야 합니다.",
    "quantity is required": "수량을 입력해 주세요.",
    "quantity must be positive": "수량은 0보다 커야 합니다.",
    "cash is invalid": "사용 가능 현금 정보를 확인할 수 없습니다.",
    "asset quantity is invalid": "보유 수량 정보를 확인할 수 없습니다.",
    "market is unavailable": "현재 시장 정보를 사용할 수 없습니다.",
    "estimated amount is invalid": "예상 주문 금액을 계산할 수 없습니다.",
    "insufficient available cash": "사용 가능한 현금이 부족합니다.",
    "insufficient available asset": "사용 가능한 보유 수량이 부족합니다.",
    MARKET_DATA_NOT_READY: "시장 데이터가 아직 준비되지 않았습니다.",
    PRICE_NOT_RECEIVED: "현재 가격을 아직 받지 못했습니다.",
    PAPER_MODE_REQUIRED: "PAPER 모드에서만 사용할 수 있습니다.",
    LIVE_MUTATION_DISABLED: "실거래 변경 권한이 금지되어 있습니다.",
    ORDER_SUBMISSION_NOT_CONNECTED: "주문 전송 경로가 연결되어 있지 않습니다.",
  };
  return labels[value] ?? "입력 또는 시장 상태를 확인해 주세요.";
}

export function orderHistoryErrorLabel(value: string | null): string {
  if (value === "REFERENCE_DATE_INVALID") return "주문 기간 기준을 확인할 수 없습니다.";
  if (value === "PAGE_SIZE_INVALID") return "주문 목록 설정을 확인할 수 없습니다.";
  return "주문 데이터를 확인할 수 없습니다. 다시 불러와 주세요.";
}
