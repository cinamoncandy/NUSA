(function mountCanonicalRuntime(global) {
  "use strict";

  const document = global.document;
  const root = document?.getElementById("simple-ui-root");
  if (!document || !root) return;

  const pageLabels = Object.freeze({ dashboard: "홈", orders: "거래", positions: "포트폴리오", strategy: "NUSA", logs: "기록", settings: "설정" });
  const routeAliases = Object.freeze({ market: "orders", balance: "positions", more: "settings" });
  const state = {
    page: "dashboard",
    connectionCode: "unknown",
    connection: "unknown",
    connectionLabel: "연결 상태 확인 중",
    lastPrice: null,
    changeRate: null,
    snapshot: null,
    control: null,
    chartPoints: [],
    logs: [],
    settings: null,
    pendingOrder: null,
    orderTrigger: null,
    orderSubmitting: false,
    loading: true,
    lastUpdated: null
  };
  const viewModel = global.NUSAMobileViewModel;
  const unsubscribers = [];
  const cleanup = [];
  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });

  function text(selector, value) { $$(selector).forEach((node) => { node.textContent = value == null ? "-" : String(value); }); }
  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function moneyValue(value) { return viewModel?.formatMoney(value) || (finite(value) ? money.format(value) : "-"); }
  function numberValue(value) { return viewModel?.formatQuantity(value) || (finite(value) ? decimal.format(value) : "-"); }
  function signedMoney(value) { return viewModel?.formatSignedMoney(value) || "-"; }
  function signedPercent(value) { return viewModel?.formatSignedPercent(value) || "-"; }
  function normalizeRoute(value) { const route = routeAliases[value] || value; return Object.hasOwn(pageLabels, route) ? route : "dashboard"; }
  function normalizedConnection(value) {
    if (viewModel?.normalizeConnection) return viewModel.normalizeConnection(value);
    const code = String(value ?? "").toLowerCase();
    if (code.includes("reconnect")) return ["reconnecting", "재연결 중"];
    if (["disconnect", "stale", "offline"].some((item) => code.includes(item))) return ["disconnected", "연결 끊김"];
    if (code === "connected" || ["online", "healthy", "fresh"].some((item) => code.includes(item))) return ["connected", "연결됨"];
    if (code.includes("connect")) return ["connecting", "연결 중"];
    if (["error", "fault"].some((item) => code.includes(item))) return ["error", "오류"];
    return ["unknown", "확인 중"];
  }
  function recordLog(category, message, severity = "정보") {
    if (!message) return;
    const key = `${category}:${message}:${severity}`;
    if (state.logs[0]?.key === key) return;
    state.logs.unshift({ key, category, message, severity, time: new Date().toISOString() });
    state.logs = state.logs.slice(0, 40);
  }
  function applyTheme(theme) { document.documentElement.dataset.theme = theme === "contrast" ? "contrast" : "dark"; }

  function renderConnection() {
    const [tone, label] = normalizedConnection(state.connectionCode);
    state.connection = tone;
    state.connectionLabel = label;
    root.dataset.state = state.loading ? "loading" : tone;
    $$("[data-simple-connection]").forEach((node) => {
      node.dataset.state = tone;
      const dot = node.querySelector(".simple-status-dot");
      if (dot) node.replaceChildren(dot, document.createTextNode(label)); else node.textContent = label;
    });
    text("[data-simple-market-status]", label);
    text("[data-simple-settings-market]", label);
  }
  function renderNav() {
    $$("[data-simple-nav]").forEach((button) => {
      const active = button.dataset.simpleNav === state.page;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
  }
  function showPage(target, updateHash = true) {
    const page = normalizeRoute(target);
    state.page = page;
    $$("[data-simple-page]").forEach((section) => {
      const active = section.dataset.simplePage === page;
      section.hidden = !active;
      section.classList.toggle("is-active", active);
    });
    renderNav();
    if (updateHash && global.location.hash !== `#${page}`) global.history.replaceState(null, "", `#${page}`);
    if (page === "settings") void loadSettings();
    if (page !== "dashboard") $("#simple-page-content")?.focus({ preventScroll: true });
  }
  function renderComposition(snapshot) {
    const target = $("[data-simple-composition]");
    if (!target) return;
    const summary = viewModel?.summarize(snapshot, state.lastPrice);
    const position = summary?.position || snapshot?.position || {};
    const held = summary?.heldValue ?? 0;
    const cash = summary?.cash ?? 0;
    const total = summary?.total ?? cash + held;
    if (!snapshot || total <= 0 || (cash === 0 && held === 0)) {
      target.replaceChildren(Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "보유 자산이 없습니다." }));
      return;
    }
    const rows = [["KRW", cash], [position.market || "보유 자산", held]];
    target.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement("div"); row.className = "simple-composition__row";
      const meta = document.createElement("div"); meta.className = "simple-composition__meta";
      const name = document.createElement("strong"); name.textContent = label;
      const amount = document.createElement("span"); amount.textContent = `${moneyValue(value)} · ${((value / total) * 100).toFixed(1)}%`;
      meta.append(name, amount);
      const track = document.createElement("div"); track.className = "simple-composition__track";
      const fill = document.createElement("div"); fill.className = "simple-composition__fill"; fill.style.width = `${Math.min(100, Math.max(0, value / total * 100))}%`;
      track.append(fill); row.append(meta, track); return row;
    }));
  }
  function positionRow(snapshot, full = false) {
    const summary = viewModel?.summarize(snapshot, state.lastPrice);
    const position = summary?.position || snapshot?.position;
    if (!summary?.hasPosition && (!position || !finite(position.quantity) || position.quantity <= 0)) return null;
    const current = finite(state.lastPrice) ? state.lastPrice : null;
    const value = current == null ? null : current * position.quantity;
    const pnl = finite(snapshot?.unrealizedPnl) ? snapshot.unrealizedPnl : null;
    const rate = value != null && finite(position.averagePrice) && position.averagePrice > 0 ? (current - position.averagePrice) / position.averagePrice : null;
    const tr = document.createElement("tr");
    const cells = full
      ? [position.market || "KRW-BTC", numberValue(position.quantity), moneyValue(position.averagePrice), moneyValue(current), moneyValue(value), signedMoney(pnl), signedPercent(rate)]
      : [position.market || "KRW-BTC", numberValue(position.quantity), moneyValue(position.averagePrice), moneyValue(current), signedMoney(pnl), signedPercent(rate)];
    cells.forEach((cellValue, index) => { const td = document.createElement("td"); td.textContent = cellValue; if (index >= cells.length - 2 && pnl != null) td.className = pnl >= 0 ? "simple-position-pnl--positive" : "simple-position-pnl--negative"; tr.append(td); });
    return tr;
  }
  function emptyTableRow(colSpan) { const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = colSpan; const empty = document.createElement("span"); empty.className = "simple-empty"; empty.textContent = "보유 중인 Paper 포지션이 없습니다."; td.append(empty); tr.append(td); return tr; }
  function renderPositions(snapshot) {
    const compact = $("[data-simple-position-table]"); const full = $("[data-simple-position-table-full]");
    if (compact) compact.replaceChildren(positionRow(snapshot, false) || emptyTableRow(6));
    if (full) full.replaceChildren(positionRow(snapshot, true) || emptyTableRow(7));
  }
  function activityRow(order) {
    const row = document.createElement("div"); row.className = "simple-activity-row";
    const detail = document.createElement("div"); const title = document.createElement("strong"); title.textContent = `${order.side === "BUY" ? "매수" : "매도"} · ${order.market || "KRW-BTC"}`;
    const meta = document.createElement("small"); meta.textContent = `${numberValue(order.quantity)} · ${moneyValue(order.price)}`; detail.append(title, meta);
    const time = document.createElement("span"); time.textContent = order.filledAt ? new Date(order.filledAt).toLocaleTimeString("ko-KR") : "-"; row.append(detail, time); return row;
  }
  function renderOrders(snapshot) {
    const orders = Array.isArray(snapshot?.orders) ? [...snapshot.orders].reverse() : [];
    $$("[data-simple-order-list]").forEach((target) => target.replaceChildren(...(orders.length ? orders.slice(0, 20).map(activityRow) : [Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "아직 주문 기록이 없습니다." })])));
  }
  function renderSnapshot(snapshot) {
    state.snapshot = snapshot || null;
    const summary = viewModel?.summarize(snapshot, state.lastPrice);
    const position = summary?.position || snapshot?.position || {};
    const quantity = summary?.quantity ?? (finite(position.quantity) ? position.quantity : 0);
    const held = summary?.heldValue ?? 0;
    text("[data-simple-total-equity]", moneyValue(snapshot?.equity));
    text("[data-simple-pnl]", signedMoney(snapshot?.unrealizedPnl));
    text("[data-simple-position-count]", quantity > 0 ? "1개" : "0개");
    text("[data-simple-cash]", moneyValue(snapshot?.cash));
    text("[data-simple-held-value]", snapshot ? moneyValue(held) : "-");
    text("[data-simple-balance-total]", moneyValue(snapshot?.equity));
    text("[data-simple-realized-pnl]", signedMoney(snapshot?.position?.realizedPnl));
    renderComposition(snapshot); renderPositions(snapshot); renderOrders(snapshot); renderOrderSummary();
    state.loading = false; state.lastUpdated = new Date(); root.dataset.state = state.connection; text("[data-simple-updated]", `마지막 업데이트 ${state.lastUpdated.toLocaleTimeString("ko-KR")}`);
  }
  function orderBlockReason(quantity) {
    if (state.connection !== "connected") return "시장 데이터가 연결되지 않아 주문할 수 없습니다.";
    if (!finite(state.lastPrice)) return "유효한 현재가가 없어 주문할 수 없습니다.";
    if (!finite(quantity) || quantity <= 0) return "0보다 큰 주문 수량을 입력하세요.";
    if (state.orderSubmitting) return "Paper 주문을 처리 중입니다.";
    return "";
  }
  function renderOrderSummary() {
    text("[data-simple-market-price]", moneyValue(state.lastPrice)); text("[data-simple-order-price]", moneyValue(state.lastPrice));
    const quantity = Number($("[data-simple-order-quantity]")?.value);
    text("[data-simple-order-notional]", finite(quantity) && finite(state.lastPrice) ? moneyValue(quantity * state.lastPrice) : "-");
    text("[data-simple-order-fee]", finite(state.lastPrice) ? "Paper 설정값 적용" : "연결 후 계산");
    const reason = orderBlockReason(quantity);
    $$("[data-simple-order]").forEach((button) => { button.disabled = Boolean(reason); button.title = reason; });
    const confirm = $("[data-simple-sheet-confirm]"); if (confirm) { confirm.disabled = state.orderSubmitting; confirm.setAttribute("aria-busy", String(state.orderSubmitting)); }
    renderOrderSheet();
  }
  function renderOrderSheet() {
    const pending = state.pendingOrder; const sheet = $("[data-simple-sheet]"); const backdrop = $("[data-simple-sheet-backdrop]"); if (!sheet || !backdrop) return;
    const quantity = Number($("[data-simple-order-quantity]")?.value);
    text("[data-simple-sheet-side]", pending?.side === "BUY" ? "Paper 매수" : pending?.side === "SELL" ? "Paper 매도" : "-");
    text("[data-simple-sheet-price]", moneyValue(state.lastPrice)); text("[data-simple-sheet-quantity]", finite(quantity) && quantity > 0 ? numberValue(quantity) : "-");
    text("[data-simple-sheet-notional]", finite(quantity) && quantity > 0 && finite(state.lastPrice) ? moneyValue(quantity * state.lastPrice) : "-"); text("[data-simple-sheet-fee]", finite(state.lastPrice) ? "Paper 설정값 적용" : "연결 후 계산");
    const open = Boolean(pending); sheet.hidden = !open; backdrop.hidden = !open;
  }
  function closeOrderSheet({ restoreFocus = true } = {}) { state.pendingOrder = null; const trigger = state.orderTrigger; state.orderTrigger = null; renderOrderSheet(); if (restoreFocus && trigger && typeof trigger.focus === "function") trigger.focus(); }
  function openOrderSheet(side) {
    const quantity = Number($("[data-simple-order-quantity]")?.value); const message = $("[data-simple-order-message]"); const reason = orderBlockReason(quantity);
    if (reason) { if (message) message.textContent = reason; return; }
    state.pendingOrder = { side }; state.orderTrigger = document.activeElement; renderOrderSheet(); $("[data-simple-sheet-confirm]")?.focus();
  }
  function renderTicker(ticker) {
    if (finite(ticker?.trade_price)) state.lastPrice = ticker.trade_price;
    state.changeRate = finite(ticker?.signed_change_rate) ? ticker.signed_change_rate : null;
    text("[data-simple-market-price]", moneyValue(state.lastPrice)); text("[data-simple-order-price]", moneyValue(state.lastPrice)); text("[data-simple-market-change]", signedPercent(state.changeRate));
    renderPositions(state.snapshot); renderComposition(state.snapshot); renderOrderSummary();
  }
  function renderCharts() {
    const targets = $$("[data-simple-equity-chart]"); if (!targets.length) return;
    const values = state.chartPoints.map((point) => point.value).filter(finite);
    if (values.length < 2) { for (const target of targets) target.replaceChildren(Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "아직 표시할 자산 추이 데이터가 없습니다." })); return; }
    const min = Math.min(...values); const max = Math.max(...values); const range = Math.max(1, max - min);
    const points = values.map((value, index) => `${16 + index / (values.length - 1) * 768},${164 - (value - min) / range * 148}`).join(" ");
    for (const target of targets) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 800 180"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Paper 계정 자산 추이");
      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); polyline.setAttribute("fill", "none"); polyline.setAttribute("stroke", "currentColor"); polyline.setAttribute("stroke-width", "3"); polyline.setAttribute("points", points); svg.append(polyline); target.replaceChildren(svg);
    }
  }
  function logRow(titleValue, messageValue, timestamp) { const row = document.createElement("div"); row.className = "simple-log-row"; const detail = document.createElement("div"); const title = document.createElement("strong"); title.textContent = titleValue; const message = document.createElement("small"); message.textContent = messageValue || ""; detail.append(title, message); const time = document.createElement("span"); time.textContent = timestamp ? new Date(timestamp).toLocaleTimeString("ko-KR") : "-"; row.append(detail, time); return row; }
  function renderControl(control) {
    state.control = control || null; const status = String(control?.status || "STOPPED");
    text("[data-simple-strategy-status]", status === "RUNNING" ? "실행 중" : status === "PAUSED" ? "일시 중지" : "중지됨"); text("[data-simple-auto-trade]", control?.autoTradeEnabled ? "켜짐" : "꺼짐");
    $$("[data-simple-strategy='start']").forEach((button) => { button.disabled = status === "RUNNING"; }); $$("[data-simple-strategy='stop']").forEach((button) => { button.disabled = status === "STOPPED"; });
    const latest = Array.isArray(control?.events) ? control.events[0] : null; text("[data-simple-last-signal]", latest ? `${latest.type || "이벤트"} · ${latest.message || ""}` : "아직 운영 이벤트가 없습니다.");
    const eventRows = Array.isArray(control?.events) ? control.events.slice(0, 40).map((event) => logRow(event.type || "운영 이벤트", event.message, event.timestamp)) : [];
    const localRows = state.logs.map((log) => logRow(`${log.category} · ${log.severity}`, log.message, log.time)); const rows = [...eventRows, ...localRows].slice(0, 40);
    $$("[data-simple-log-list]").forEach((target) => target.replaceChildren(...(rows.length ? rows.map((row) => row.cloneNode(true)) : [Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "아직 운영 기록이 없습니다." })])));
  }
  function render() { renderConnection(); renderNav(); renderSnapshot(state.snapshot); renderTicker({ trade_price: state.lastPrice, signed_change_rate: state.changeRate }); renderControl(state.control); renderCharts(); }
  async function read(method, fallback = null) { try { return typeof method === "function" ? await method() : fallback; } catch { return fallback; } }
  async function loadSettings() {
    const api = global.nusaApp; const payload = await read(api?.settings?.bind(api)); const settings = payload?.settings || payload; if (!settings || typeof settings !== "object") return;
    state.settings = settings; applyTheme(settings.theme);
    for (const key of ["theme", "logLevel"]) { const control = $(`[data-simple-setting="${key}"]`); if (control && settings[key] != null) control.value = settings[key]; }
    for (const key of ["showDiagnostics", "showNotifications"]) { const control = $(`[data-simple-setting="${key}"]`); if (control && settings[key] != null) control.checked = Boolean(settings[key]); }
  }
  async function loadAbout() { const payload = await read(global.nusaApp?.about?.bind(global.nusaApp)); const about = payload?.about || payload; if (!about || typeof about !== "object") return; text("[data-simple-app-version]", `버전 ${about.appVersion || "확인 불가"} · Electron ${about.electronVersion || "확인 불가"} · Node ${about.nodeVersion || "확인 불가"}`); text("[data-simple-app-mode]", about.mode || "Paper Trading"); }
  async function saveSettings() {
    const api = global.nusaApp; const message = $("[data-simple-settings-message]"); if (!api?.saveSettings) { if (message) message.textContent = "설정 저장 기능을 사용할 수 없습니다."; return; }
    const value = { theme: $("[data-simple-setting='theme']")?.value, logLevel: $("[data-simple-setting='logLevel']")?.value, showDiagnostics: Boolean($("[data-simple-setting='showDiagnostics']")?.checked), showNotifications: Boolean($("[data-simple-setting='showNotifications']")?.checked) };
    try { await api.saveSettings(value); state.settings = value; applyTheme(value.theme); if (message) message.textContent = "설정을 저장했습니다."; } catch { if (message) message.textContent = "설정을 저장하지 못했습니다."; }
  }
  async function resetSettings() {
    const api = global.nusaApp; const message = $("[data-simple-settings-message]"); if (!api?.resetSettings || (typeof global.confirm === "function" && !global.confirm("화면 설정을 초기화하시겠습니까? 거래 및 복구 기록은 삭제되지 않습니다."))) return;
    try { await api.resetSettings(); await loadSettings(); if (message) message.textContent = "화면 설정을 초기화했습니다."; } catch { if (message) message.textContent = "설정을 초기화하지 못했습니다."; }
  }
  async function placePaperOrder(side) {
    const quantity = Number($("[data-simple-order-quantity]")?.value); const message = $("[data-simple-order-message]");
    if (state.orderSubmitting || !state.pendingOrder || state.pendingOrder.side !== side || !global.nusa?.placeOrder) return;
    const reason = orderBlockReason(quantity); if (reason) { if (message) message.textContent = reason; return; }
    state.orderSubmitting = true; renderOrderSummary();
    try {
      const result = await global.nusa.placeOrder(side, quantity); closeOrderSheet({ restoreFocus: false }); renderSnapshot(result?.snapshot || state.snapshot);
      if (message) message.textContent = "Paper 주문이 기록되었습니다. 실제 주문은 발생하지 않았습니다."; recordLog("주문", side === "BUY" ? "Paper 매수 기록" : "Paper 매도 기록", "정보"); renderControl(state.control);
    } catch (error) { if (message) message.textContent = error instanceof Error ? error.message : "Paper 주문을 기록하지 못했습니다."; }
    finally { state.orderSubmitting = false; renderOrderSummary(); }
  }
  async function strategyCommand(command) {
    const api = global.nusa; const message = $("[data-simple-last-signal]"); const method = command === "start" ? api?.startStrategy : api?.stopStrategy;
    if (typeof method !== "function") { if (message) message.textContent = "전략 제어 기능을 사용할 수 없습니다."; return; }
    try { const result = await method.call(api); renderControl(result); if (message) message.textContent = command === "start" ? "Paper 전략 시작 요청 완료" : "Paper 전략 중지 요청 완료"; } catch { if (message) message.textContent = "전략 상태를 변경하지 못했습니다."; }
  }
  function on(target, type, handler) { target?.addEventListener(type, handler); cleanup.push(() => target?.removeEventListener(type, handler)); }
  function installEvents() {
    $$('[data-simple-nav]').forEach((button) => on(button, "click", () => showPage(button.dataset.simpleNav)));
    on(global, "hashchange", () => showPage(global.location.hash.slice(1), false));
    on($("[data-simple-order-quantity]"), "input", renderOrderSummary);
    $$('[data-simple-order]').forEach((button) => on(button, "click", () => openOrderSheet(button.dataset.simpleOrder)));
    $$('[data-simple-sheet-close]').forEach((button) => on(button, "click", () => closeOrderSheet()));
    on($("[data-simple-sheet-confirm]"), "click", () => void placePaperOrder(state.pendingOrder?.side));
    on($("[data-simple-sheet-backdrop]"), "click", (event) => { if (event.target === event.currentTarget) closeOrderSheet(); });
    on(global, "keydown", (event) => { if (event.key === "Escape" && state.pendingOrder) closeOrderSheet(); });
    $$('[data-simple-strategy]').forEach((button) => on(button, "click", () => void strategyCommand(button.dataset.simpleStrategy)));
    on($("[data-simple-settings-save]"), "click", () => void saveSettings()); on($("[data-simple-settings-reset]"), "click", () => void resetSettings());
    on($("[data-simple-setting='theme']"), "change", (event) => applyTheme(event.currentTarget.value));
    const api = global.nusa; if (!api) return;
    if (typeof api.onStatus === "function") unsubscribers.push(api.onStatus((value) => { state.connectionCode = value; recordLog("시장 데이터", `연결 상태: ${value}`, value === "connected" ? "정보" : "주의"); renderConnection(); renderOrderSummary(); }));
    if (typeof api.onTicker === "function") unsubscribers.push(api.onTicker(renderTicker));
    if (typeof api.onSnapshot === "function") unsubscribers.push(api.onSnapshot(renderSnapshot));
    if (typeof api.onControl === "function") unsubscribers.push(api.onControl(renderControl));
    if (typeof api.onChartPoint === "function") unsubscribers.push(api.onChartPoint((value) => { if (finite(value?.value)) { state.chartPoints.push(value); if (state.chartPoints.length > 120) state.chartPoints.splice(0, state.chartPoints.length - 120); renderCharts(); } }));
  }
  async function loadInitial() {
    const api = global.nusa; const [snapshot, control] = await Promise.all([read(api?.getSnapshot?.bind(api)), read(api?.getControlSnapshot?.bind(api))]);
    if (snapshot) renderSnapshot(snapshot); if (control) renderControl(control); await loadSettings(); await loadAbout(); render();
  }

  installEvents(); showPage(global.location.hash.slice(1) || "dashboard", false); render(); void loadInitial();
  global.addEventListener("beforeunload", () => { unsubscribers.forEach((unsubscribe) => { try { unsubscribe?.(); } catch { /* best effort */ } }); cleanup.forEach((dispose) => { try { dispose(); } catch { /* best effort */ } }); });
  global.NUSACanonicalUI = Object.freeze({ showPage, state });
})(window);
