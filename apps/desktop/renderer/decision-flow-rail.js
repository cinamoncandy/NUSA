/* global Element */
(() => {
  const root = document.querySelector("#simple-ui-root");
  const content = document.querySelector("#simple-page-content");
  if (!root || !content || document.querySelector("[data-decision-flow-rail]")) return;

  if (!document.querySelector('link[href="decision-flow-rail.css"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "decision-flow-rail.css";
    document.head.append(stylesheet);
  }

  const steps = [
    { key: "observe", label: "Observe", target: "market" },
    { key: "assess", label: "Assess", target: "positions" },
    { key: "risk", label: "Risk", target: "orders" },
    { key: "action", label: "Paper Action", target: "orders" },
    { key: "result", label: "Result", target: "orders" },
  ];

  const orderStepKeys = new Set(["risk", "action", "result"]);
  let requestedStepKey = null;

  const rail = document.createElement("nav");
  rail.className = "decision-flow-rail";
  rail.dataset.decisionFlowRail = "";
  rail.setAttribute("aria-label", "의사결정 흐름");

  for (const step of steps) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "decision-flow-rail__step";
    button.dataset.decisionStep = step.key;
    button.dataset.targetPage = step.target;
    button.innerHTML = `<span class="decision-flow-rail__label">${step.label}</span><span class="decision-flow-rail__value" data-decision-value="${step.key}">확인 중</span><span class="decision-flow-rail__freshness" data-decision-freshness="${step.key}">상태 확인 중</span>`;
    button.addEventListener("click", () => {
      requestedStepKey = step.key;
      const nav = document.querySelector(`[data-simple-nav="${step.target}"]`);
      if (nav && typeof nav.click === "function") nav.click();
      else update();
    });
    rail.append(button);
  }

  content.prepend(rail);

  const firstText = (selector, fallback = "-") => {
    const value = document.querySelector(selector)?.textContent?.trim();
    return value && value !== "-" ? value : fallback;
  };

  const setText = (selector, value) => {
    const element = rail.querySelector(selector);
    if (element && element.textContent !== value) element.textContent = value;
  };

  const setFreshness = (key, value, state) => {
    const element = rail.querySelector(`[data-decision-freshness="${key}"]`);
    if (!element) return;
    if (element.textContent !== value) element.textContent = value;
    if (state) element.dataset.state = state;
    else delete element.dataset.state;
  };

  const freshnessState = (connectionState) => {
    if (connectionState === "connected") return "current";
    if (connectionState === "connecting" || connectionState === "reconnecting") return "updating";
    if (connectionState === "disconnected") return "stale";
    if (connectionState === "error") return "error";
    return "unavailable";
  };

  const freshnessLabel = (connectionState, fallback) => {
    if (connectionState === "connected") return fallback || "현재 데이터";
    if (connectionState === "connecting") return "연결 중";
    if (connectionState === "reconnecting") return "재연결 중";
    if (connectionState === "disconnected") return "연결 끊김 · 데이터 주의";
    if (connectionState === "error") return "데이터 오류";
    return fallback || "상태 확인 중";
  };

  const withCountUnit = (value, unit) => {
    const normalized = String(value || "0").trim();
    return normalized.endsWith(unit) ? normalized : `${normalized}${unit}`;
  };

  const update = () => {
    const price = firstText("[data-simple-market-price]", "시세 대기");
    const marketStatus = firstText("[data-simple-market-status]", "상태 확인 중");
    const connection = document.querySelector("[data-simple-connection]");
    const connectionState = connection?.dataset?.state || "unknown";
    const connectionLabel = connection?.textContent?.trim() || marketStatus;
    const freshness = freshnessState(connectionState);

    setText('[data-decision-value="observe"]', `KRW-BTC · ${price}`);
    setFreshness("observe", freshnessLabel(connectionState, marketStatus), freshness);

    const positionCount = firstText("[data-simple-position-count]", "0개");
    const pnl = firstText("[data-simple-pnl]", "손익 대기");
    setText('[data-decision-value="assess"]', `포지션 ${positionCount} · ${pnl}`);
    setFreshness("assess", freshnessLabel(connectionState, connectionLabel), freshness);

    setText('[data-decision-value="risk"]', "PAPER 전용 · 실거래 비활성");
    setFreshness("risk", "실행 권한 없음", "current");

    const orderButtons = [...document.querySelectorAll("[data-simple-order]")];
    const actionReady = connectionState === "connected" && orderButtons.length > 0 && orderButtons.some((button) => !button.disabled);
    const notional = firstText("[data-simple-order-notional]", "금액 대기");
    setText('[data-decision-value="action"]', actionReady ? `Paper 주문 검토 가능 · ${notional}` : "Paper 주문 대기");
    setFreshness("action", actionReady ? "현재 시세 기반" : freshnessLabel(connectionState, "조건 확인 필요"), actionReady ? "current" : freshness);

    const orderCount = withCountUnit(firstText("[data-simple-order-count]", "0건"), "건");
    const orderMessage = firstText("[data-simple-order-message]", "최근 결과 없음");
    setText('[data-decision-value="result"]', `체결 ${orderCount}`);
    setFreshness("result", orderMessage, orderMessage === "최근 결과 없음" ? "unavailable" : "current");

    const activePage = [...document.querySelectorAll("[data-simple-page]")].find((page) => !page.hidden)?.dataset.simplePage;
    let activeKey = null;
    if (activePage === "market") {
      activeKey = "observe";
      requestedStepKey = null;
    } else if (activePage === "positions" || activePage === "dashboard") {
      activeKey = "assess";
      requestedStepKey = null;
    } else if (activePage === "orders") {
      activeKey = orderStepKeys.has(requestedStepKey) ? requestedStepKey : "action";
    } else {
      requestedStepKey = null;
    }

    for (const button of rail.querySelectorAll("[data-decision-step]")) {
      if (button.dataset.decisionStep === activeKey) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
  };

  let queued = false;
  const queueUpdate = () => {
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => {
      queued = false;
      update();
    });
  };

  const observer = new window.MutationObserver((mutations) => {
    if (mutations.every((mutation) => mutation.target instanceof Element && mutation.target.closest("[data-decision-flow-rail]"))) return;
    queueUpdate();
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "disabled", "data-state", "class"] });

  update();
})();
