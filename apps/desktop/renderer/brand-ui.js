(function mountDokkaebiBrandUI(global) {
  "use strict";

  const document = global.document;
  const byId = (id) => document.getElementById(id);
  const STATUS_PRESENTATION = Object.freeze({
    PASS: ["PASS", "검증을 통과했습니다"], RUNNING: ["실행 중", "관측이 진행 중입니다"], SHADOW: ["Shadow", "실제 주문 없이 관측합니다"],
    RECONNECTING: ["재연결 중", "시장 데이터를 다시 연결하고 있습니다"], RECOVERED: ["복구됨", "연결이 복구되었습니다"], CHECK_REQUIRED: ["확인 필요", "추가 확인이 필요합니다"],
    HALT: ["중지됨", "안전을 위해 실행을 차단했습니다"], REJECT: ["거부됨", "요청이 안전 기준에 맞지 않습니다"], BLOCKED: ["차단됨", "사전 조건을 충족하지 못했습니다"],
    COMPLETED: ["완료", "세션이 정상적으로 종료되었습니다"], RECOVERY_REQUIRED: ["복구 필요", "이전 실행을 확인해야 합니다"], MATCHED: ["일치", "상태 대조가 일치합니다"],
    MISMATCHED: ["불일치", "상태 대조가 일치하지 않습니다"], ERROR: ["오류", "오류가 발생했습니다"], NOT_RUN: ["미실행", "아직 실행하지 않았습니다"], "N/A": ["해당 없음", "사용할 수 없는 상태입니다"]
  });

  function statusPresentation(code) {
    const value = STATUS_PRESENTATION[String(code)] || [String(code || "N/A"), "상태 설명을 확인할 수 없습니다"];
    return Object.freeze({ code: String(code || "N/A"), label: value[0], description: value[1] });
  }

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function copyButton(value, label) {
    const button = node("button", "workspace-copy", "복사");
    button.type = "button";
    button.setAttribute("aria-label", `${label} 복사`);
    button.dataset.copyValue = value;
    return button;
  }

  function installCopyButtons() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-copy-value]");
      if (!button || !global.navigator?.clipboard?.writeText) return;
      const value = button.getAttribute("data-copy-value");
      if (!value) return;
      void global.navigator.clipboard.writeText(value).then(() => {
        const original = button.textContent;
        button.textContent = "복사됨";
        global.setTimeout(() => { button.textContent = original; }, 1200);
      });
    });
  }

  function view(title, eyebrow, description) {
    const section = node("section", "workspace-view");
    section.setAttribute("role", "region");
    section.setAttribute("aria-labelledby", `workspace-title-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
    const header = node("header", "workspace-view__header");
    const text = node("div");
    const heading = node("h2", "workspace-view__title", title);
    heading.id = `workspace-title-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    text.append(node("p", "eyebrow", eyebrow), heading, node("p", "workspace-view__description", description));
    header.append(text);
    section.append(header);
    return section;
  }

  function sectionTitle(label, value, tone) {
    const card = node("article", `workspace-card workspace-card--${tone || "neutral"}`);
    card.append(node("p", "workspace-card__label", label), node("strong", "workspace-card__value", value));
    return card;
  }

  function makeSummary() {
    const summary = node("div", "workspace-dashboard-grid");
    const safety = node("article", "workspace-card workspace-card--hero");
    safety.append(node("p", "workspace-card__label", "현재 안전 상태"), node("h3", "workspace-card__headline", "Paper 환경에서 안전하게 대기 중"), node("p", "workspace-card__copy", "실제 주문과 Private API는 비활성화되어 있습니다."), node("span", "workspace-status-pill is-safe", "LIVE TRADING DISABLED"), copyButton("LIVE TRADING DISABLED", "거래 상태"));
    const action = node("article", "workspace-card workspace-card--action");
    action.append(node("p", "workspace-card__label", "다음 행동"), node("h3", "workspace-card__headline", "읽기 전용 진단을 확인하세요"), node("p", "workspace-card__copy", "관측을 시작하기 전 시장 연결과 안전 게이트를 점검합니다."));
    const actionLink = node("a", "workspace-action-link", "Risk & Safety 열기 →");
    actionLink.href = "#risk"; actionLink.dataset.navTarget = "risk"; action.append(actionLink);
    const diagnosisButton = node("button", "workspace-primary", "Run read-only check");
    diagnosisButton.type = "button";
    diagnosisButton.addEventListener("click", () => {
      activate("risk");
      byId("run-a4-diagnostics")?.focus();
    });
    action.append(diagnosisButton);
    summary.append(safety, action);
    const metrics = node("div", "workspace-kpi-grid");
    metrics.append(sectionTitle("시장 데이터", "확인 필요", "info"), sectionTitle("Shadow 세션", "대기 중", "neutral"), sectionTitle("최근 신호", "없음", "neutral"), sectionTitle("실제 변동", "0", "safe"));
    summary.append(metrics);
    const next = node("article", "workspace-card workspace-card--wide");
    next.append(node("p", "workspace-card__label", "최근 활동"), node("h3", "workspace-card__headline", "아직 표시할 활동이 없습니다"), node("p", "workspace-card__copy", "세션을 시작하면 신호와 Evidence가 이곳에 기록됩니다."));
    summary.append(next);
    return summary;
  }

  function connectDashboardSummary(summary) {
    const values = [...summary.querySelectorAll(".workspace-kpi-grid .workspace-card__value")];
    const recentHeadline = summary.querySelector(".workspace-card--wide .workspace-card__headline");
    const refresh = () => {
      if (values[0]) values[0].textContent = byId("status")?.textContent?.trim() || "N/A";
      if (values[1]) values[1].textContent = byId("application-state-title")?.textContent?.trim() || "N/A";
      if (values[2]) values[2].textContent = byId("events")?.querySelector("li")?.textContent?.trim() || "N/A";
      if (recentHeadline) {
        const latest = byId("events")?.querySelector("li");
        recentHeadline.textContent = latest?.textContent?.trim() || "최근 활동 없음";
      }
    };
    refresh();
    const timer = global.setInterval(refresh, 1500);
    global.addEventListener("beforeunload", () => global.clearInterval(timer), { once: true });
  }

  function moveInto(target, selectors) {
    for (const selector of selectors) {
      const item = document.querySelector(selector);
      if (item && item.parentElement !== target) target.append(item);
    }
  }

  function buildWorkspace() {
    const main = document.querySelector(".app-main");
    const header = main?.querySelector(".app-header");
    if (!main || !header || byId("workspace-views")) return;
    const views = node("div", "workspace-views");
    views.id = "workspace-views";
    header.after(views);
    const definitions = {
      dashboard: ["Dashboard", "OVERVIEW", "지금 상태와 다음 행동을 한눈에 확인합니다."],
      market: ["Market", "PUBLIC MARKET", "검증된 공개 시장 데이터만 읽습니다."],
      shadow: ["Shadow Session", "OBSERVATION", "가상 관측의 상태와 안전 카운터를 확인합니다."],
      orders: ["Orders & Fills", "PAPER LEDGER", "Paper 기록을 검토합니다. 실제 주문은 없습니다."],
      portfolio: ["Portfolio", "PAPER ACCOUNT", "Paper 계좌의 현재 상태를 확인합니다."],
      risk: ["Risk & Safety", "READ ONLY", "사용자 요약과 개발자 진단을 분리해 보여줍니다."],
      recovery: ["Recovery", "CONTROLLED RECOVERY", "감지부터 완료까지 복구 단계를 추적합니다."],
      evidence: ["Evidence", "IMMUTABLE RECORDS", "세션별 기록과 검증 상태를 관리합니다."],
      diagnostics: ["Diagnostics", "DEEP INSPECTION", "운영 상세 진단은 이 화면에서만 확인합니다."],
      settings: ["Settings", "PREFERENCES", "표시와 알림 환경을 관리합니다."],
      about: ["About", "DOKKAEBI", "Paper Investment OS의 버전과 안전 상태입니다."]
    };
    const panels = {};
    for (const [id, [title, eyebrow, description]] of Object.entries(definitions)) {
      panels[id] = view(title, eyebrow, description);
      panels[id].id = `workspace-${id}`;
      views.append(panels[id]);
    }
    const dashboardSummary = makeSummary();
    panels.dashboard.append(dashboardSummary);
    connectDashboardSummary(dashboardSummary);
    moveInto(panels.market, ["#market", ".chart-card"]);
    moveInto(panels.shadow, ["#control-room", "#operations-detail", ".grid .card:first-child", "#application-state"]);
    const eventsCard = document.querySelector("#events")?.closest("article");
    if (eventsCard) panels.shadow.append(eventsCard);
    const ordersSection = document.querySelector("#orders")?.closest("section");
    const accountCard = document.querySelector("#cash")?.closest("article");
    if (accountCard && accountCard !== panels.portfolio) panels.portfolio.append(accountCard);
    moveInto(panels.risk, ["#a4-diagnostics"]);
    moveInto(panels.recovery, ["#recovery-review"]);
    moveInto(panels.diagnostics, ["#ai-cio-dashboard"]);
    moveInto(panels.settings, ["#product-settings"]);
    moveInto(panels.about, ["#product-about"]);
    const evidence = node("div", "workspace-evidence-tools");
    const search = node("input", "workspace-search"); search.type = "search"; search.placeholder = "세션 ID 또는 상태 검색"; search.setAttribute("aria-label", "Evidence 검색");
    const status = node("select", "workspace-filter"); status.setAttribute("aria-label", "Evidence 상태 필터");
    for (const optionText of ["전체 상태", "PASS", "REJECT", "ERROR"]) { const option = node("option", "", optionText); option.value = optionText; status.append(option); }
    const exportButton = node("button", "workspace-secondary", "Evidence 내보내기"); exportButton.type = "button"; exportButton.disabled = true; exportButton.title = "현재 안전 브리지에서 제공될 때 활성화됩니다";
    evidence.append(search, status, exportButton);
    panels.evidence.append(evidence, node("p", "workspace-note", "삭제하거나 덮어쓰지 않는 Paper Evidence 기록입니다."));
    const evidenceList = node("article", "workspace-card evidence-list");
    evidenceList.append(node("div", "evidence-list__header", "세션 ID                         생성 시각             종료 사유                 검증 상태"), node("p", "evidence-list__empty", "현재 세션에 완료된 Evidence 기록이 없습니다."));
    panels.evidence.append(evidenceList);
    if (ordersSection && ordersSection !== panels.evidence) panels.evidence.append(ordersSection);
    const recoveryFlow = node("ol", "recovery-flow");
    for (const label of ["비정상 종료 감지", "상태 대조", "결과 확인", "소유자 검토", "복구 완료"]) recoveryFlow.append(node("li", "recovery-flow__step", label));
    panels.recovery.prepend(recoveryFlow);
    panels.risk.prepend(node("article", "workspace-card workspace-card--summary", "현재 진단은 읽기 전용입니다. 문제가 있으면 자동 실행하지 않고 차단 상태를 유지합니다."));
    panels.shadow.append(node("p", "workspace-note", "가상 체결은 관측 설명용이며 실제 주문·체결·현금·포지션 변동은 0이어야 합니다."));
    const orderSummary = node("div", "workspace-kpi-grid workspace-kpi-grid--two");
    orderSummary.append(sectionTitle("Paper 주문", "0", "neutral"), sectionTitle("Paper 체결", "0", "neutral"), sectionTitle("현금 변동", "0", "safe"), sectionTitle("포지션 변동", "0", "safe"));
    panels.orders.append(orderSummary, node("p", "workspace-note", "주문과 체결은 Paper ledger에서만 기록됩니다. 실제 주문 경로는 비활성화되어 있습니다."));
    panels.portfolio.append(node("p", "workspace-note", "이 화면의 계좌 수치는 Paper 환경에서만 계산됩니다."));
    for (const child of [...main.children]) {
      if (child !== header && child !== views && child.id !== "dashboard") child.hidden = true;
    }
    activate("dashboard");
  }

  function activate(targetId, updateHash) {
    const canonicalId = targetId === "shadow-session" ? "shadow" : targetId;
    const target = document.getElementById(`workspace-${canonicalId}`) || document.getElementById(targetId);
    if (!target) return;
    document.querySelectorAll(".workspace-view").forEach((panel) => { const active = panel === target; panel.classList.toggle("is-active", active); panel.hidden = !active; panel.setAttribute("aria-hidden", String(!active)); });
    document.querySelectorAll("[data-nav-target]").forEach((item) => { const active = item.dataset.navTarget === targetId || item.dataset.navTarget === canonicalId; item.classList.toggle("is-active", active); if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current", "page"); });
    if (updateHash !== false) global.history.replaceState(null, "", `#${targetId}`);
    const heading = target.querySelector(".workspace-view__title");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }

  function wireNavigation() {
    document.querySelectorAll("[data-nav-target]").forEach((item) => item.addEventListener("click", (event) => { event.preventDefault(); activate(item.dataset.navTarget); }));
    global.addEventListener("popstate", () => activate(global.location.hash.slice(1) || "dashboard", false));
  }

  buildWorkspace();
  wireNavigation();
  installCopyButtons();
  activate(global.location.hash.slice(1) || "dashboard", false);
  global.DokkaebiBrandUI = Object.freeze({ statusPresentation, statuses: STATUS_PRESENTATION, activate });
})(window);
