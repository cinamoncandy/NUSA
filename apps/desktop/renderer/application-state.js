/* global module */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DokkaebiApplicationState = api;
})(globalThis, function () {
  const catalog = Object.freeze({
    LOADING: { tone: "neutral", title: "운용 상태를 불러오는 중", description: "Paper 계정과 시장 연결 상태를 확인하고 있습니다.", action: "잠시 기다려 주세요." },
    RECONNECTING: { tone: "warning", title: "시장 데이터 재연결 중", description: "기존 연결이 끊어져 공개 시세 스트림에 다시 연결하고 있습니다.", action: "자동 주문은 최신 시세가 확인될 때까지 보류됩니다." },
    OFFLINE: { tone: "critical", title: "시장 데이터 연결 끊김", description: "공개 시세를 받을 수 없어 새로운 Paper 판단과 주문을 진행할 수 없습니다.", action: "네트워크를 확인하고 연결 복구를 기다려 주세요." },
    NO_DATA: { tone: "neutral", title: "아직 시세 데이터가 없습니다", description: "첫 번째 정상 시세가 수신되기 전입니다.", action: "연결 상태를 확인한 뒤 잠시 기다려 주세요." },
    STRATEGY_STOPPED: { tone: "neutral", title: "전략이 중지되어 있습니다", description: "판단 엔진은 새로운 자동 Paper 주문을 만들지 않습니다.", action: "검토 후 전략 시작을 선택할 수 있습니다." },
    PAPER_DISABLED: { tone: "warning", title: "Paper 자동매매가 비활성화됨", description: "전략이 실행 중이어도 자동 주문은 허용되지 않습니다.", action: "판단과 위험 상태를 확인한 뒤 명시적으로 허용하세요." },
    NO_QUORUM: { tone: "warning", title: "합의 정족수 부족", description: "응답한 모델과 전략 수가 정책 기준에 미달했습니다.", action: "거래하지 않고 다음 평가 주기를 기다립니다." },
    ABSTAIN: { tone: "neutral", title: "위원회 기권", description: "현재 근거로는 방향성 행동을 정당화할 수 없습니다.", action: "포지션을 늘리지 않고 관찰을 계속합니다." },
    DISAGREEMENT: { tone: "warning", title: "모델 간 의견 불일치", description: "상반된 근거가 있어 합의 임계치를 충족하지 못했습니다.", action: "거래하지 않고 반대 근거를 기록합니다." },
    SAFETY_BLOCKED: { tone: "critical", title: "안전 게이트가 행동을 차단함", description: "리스크, 저장, 무결성 또는 실행 조건이 충족되지 않았습니다.", action: "원인을 해결하기 전에는 Paper 주문도 실행하지 않습니다." },
    APPROVED_PAPER_ACTION: { tone: "positive", title: "Paper 행동 승인", description: "합의와 안전 게이트를 통과한 모의 거래 후보입니다.", action: "실거래가 아닌 로컬 Paper 환경에서만 실행됩니다." },
    READY: { tone: "positive", title: "Paper 운용 준비됨", description: "공개 시세 연결과 로컬 Paper 상태가 정상입니다.", action: "현재 판단과 위험 상태를 계속 확인하세요." }
  });

  const normalize = (value) => String(value || "").trim().toUpperCase();

  function resolveState(input = {}) {
    const decision = normalize(input.decisionState);
    if (["NO_QUORUM", "ABSTAIN", "DISAGREEMENT", "SAFETY_BLOCKED", "APPROVED_PAPER_ACTION"].includes(decision)) return decision;
    if (input.loading) return "LOADING";
    if (input.online === false) return "OFFLINE";
    const connection = normalize(input.connectionStatus);
    if (connection.includes("RECONNECT") || connection.includes("RETRY")) return "RECONNECTING";
    if (connection && connection !== "CONNECTED" && connection !== "UPBIT 연결됨") return "OFFLINE";
    if (!input.hasPrice) return "NO_DATA";
    if (normalize(input.strategyStatus) === "STOPPED") return "STRATEGY_STOPPED";
    if (!input.autoTradeEnabled) return "PAPER_DISABLED";
    return "READY";
  }

  function render(document, state) {
    const key = catalog[state] ? state : "LOADING";
    const item = catalog[key];
    const root = document.getElementById("application-state");
    if (!root) return;
    root.dataset.state = key;
    root.dataset.tone = item.tone;
    document.getElementById("application-state-title").textContent = item.title;
    document.getElementById("application-state-description").textContent = item.description;
    document.getElementById("application-state-action").textContent = item.action;
  }

  function mount(document, windowObject, options = {}) {
    const loadingTimeoutMs = Number.isSafeInteger(options.loadingTimeoutMs) && options.loadingTimeoutMs > 0
      ? options.loadingTimeoutMs
      : 8_000;
    let loadingTimer;
    const read = () => {
      const price = document.getElementById("price")?.textContent || "";
      const status = document.getElementById("status")?.textContent || "";
      const strategy = document.getElementById("strategy-status")?.textContent || "";
      const auto = document.getElementById("auto-trade")?.checked === true;
      const decisionState = document.body.dataset.decisionState;
      const loading = price.includes("대기") && !status.includes("연결됨");
      render(document, resolveState({
        loading,
        online: windowObject.navigator?.onLine !== false,
        connectionStatus: status,
        hasPrice: !price.includes("대기") && price !== "-" && price !== "",
        strategyStatus: strategy,
        autoTradeEnabled: auto,
        decisionState
      }));
      if (!loading && loadingTimer !== undefined) {
        windowObject.clearTimeout(loadingTimer);
        loadingTimer = undefined;
      }
    };

    const observer = new windowObject.MutationObserver(read);
    for (const id of ["price", "status", "strategy-status"]) {
      const node = document.getElementById(id);
      if (node) observer.observe(node, { childList: true, characterData: true, subtree: true });
    }
    document.getElementById("auto-trade")?.addEventListener("change", read);
    windowObject.addEventListener("online", read);
    windowObject.addEventListener("offline", read);
    read();
    loadingTimer = windowObject.setTimeout(() => {
      const price = document.getElementById("price")?.textContent || "";
      const status = document.getElementById("status")?.textContent || "";
      if (price.includes("?湲?") && !status.includes("?곌껐??")) {
        render(document, resolveState({
          loading: false,
          online: windowObject.navigator?.onLine !== false,
          connectionStatus: status || "connected",
          hasPrice: false,
          strategyStatus: document.getElementById("strategy-status")?.textContent || "",
          autoTradeEnabled: document.getElementById("auto-trade")?.checked === true,
          decisionState: document.body.dataset.decisionState
        }));
      }
      loadingTimer = undefined;
    }, loadingTimeoutMs);
    return {
      refresh: read,
      disconnect: () => {
        observer.disconnect();
        if (loadingTimer !== undefined) windowObject.clearTimeout(loadingTimer);
      }
    };
  }

  return { catalog, resolveState, render, mount };
});
