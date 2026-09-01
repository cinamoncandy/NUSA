(function mountSimplePaperUI(global) {
  "use strict";

  const document = global.document;
  const root = document?.getElementById("simple-ui-root");
  if (!document || !root) return;

  const pageLabels = Object.freeze({
    dashboard: "대시보드",
    market: "마켓",
    orders: "주문",
    positions: "포지션",
    balance: "잔고",
    strategy: "전략",
    logs: "로그",
    settings: "설정",
    more: "더보기"
  });
  const SERVER_SNAPSHOT_STALE_MS = 7_000;
  const state = {
    page: "dashboard",
    connectionCode: "unknown",
    serverConnectionCode: "unknown",
    serverLastSuccessAt: null,
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
    loading: true,
    lastUpdated: null
  };
  const viewModel = global.NUSAMobileViewModel;
  const unsubscribers = [];
  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
  let connectionWatchdog = null;

  function text(selector, value) {
    $$(selector).forEach((node) => { node.textContent = value == null ? "-" : String(value); });
  }

  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function moneyValue(value) { return viewModel?.formatMoney(value) || (finite(value) ? money.format(value) : "-"); }
  function numberValue(value) { return viewModel?.formatQuantity(value) || (finite(value) ? decimal.format(value) : "-"); }
  function signedMoney(value) { return viewModel?.formatSignedMoney(value) || "-"; }
  function signedPercent(value) { return viewModel?.formatSignedPercent(value) || "-"; }
  function normalizedConnection(value) {
    if (viewModel?.normalizeConnection) return viewModel.normalizeConnection(value);
    const code = String(value ?? "").toLowerCase();
    if (code.includes("reconnect")) return ["reconnecting", "재연결 중"];
    if (["disconnect", "stale", "offline", "unavailable"].some((item) => code.includes(item))) return ["disconnected", "연결 끊김"];
    if (code === "connected" || code === "recovered" || ["online", "healthy", "fresh"].some((item) => code.includes(item))) return ["connected", "연결됨"];
    if (code.includes("connect")) return ["connecting", "연결 중"];
    if (["error", "fault"].some((item) => code.includes(item))) return ["error", "오류"];
    return ["unknown", "확인 중"];
  }
  function marketConnection() { return normalizedConnection(state.connectionCode); }
  function serverConnection() { return normalizedConnection(state.serverConnectionCode); }
  function overallConnection() {
    const [marketTone, marketLabel] = marketConnection();
    const [serverTone, serverLabel] = serverConnection();
    if (["disconnected", "error"].includes(marketTone)) return [marketTone, `업비트 ${marketLabel}`];
    if (["disconnected", "error"].includes(serverTone)) return [serverTone, `서버 ${serverLabel}`];
    if (marketTone === "connected" && serverTone === "connected") return ["connected", "서버 · 업비트 정상"];
    if (marketTone === "reconnecting" || marketTone === "connecting") return [marketTone, "업비트 연결 중"];
    if (serverTone === "reconnecting" || serverTone === "connecting") return [serverTone, "서버 연결 중"];
    if (marketTone === "connected") return ["unknown", "서버 확인 중"];
    if (serverTone === "connected") return ["unknown", "업비트 확인 중"];
    return ["unknown", "연결 확인 중"];
  }
  function markServerConnected() {
    state.serverConnectionCode = "connected";
    state.serverLastSuccessAt = Date.now();
  }
  function markServerDisconnected(value = "disconnected") {
    state.serverConnectionCode = value;
  }
  function recordLog(category, message, severity = "정보") {
    if (!message) return;
    const key = `${category}:${message}:${severity}`;
    if (state.logs[0]?.key === key) return;
    state.logs.unshift({ key, category, message, severity, time: new Date().toISOString() });
    state.logs = state.logs.slice(0, 40);
  }
  function renderConnection() {
    const [marketTone, marketLabel] = marketConnection();
    const [serverTone, serverLabel] = serverConnection();
    const [tone, label] = overallConnection();
    state.connection = marketTone;
    state.connectionLabel = label;
    $$("[data-simple-connection]").forEach((node) => {
      node.dataset.state = tone;
      const dot = node.querySelector(".simple-status-dot");
      if (dot) node.replaceChildren(dot, document.createTextNode(label));
      else node.textContent = label;
    });
    $$("[data-simple-status-dot]").forEach((node) => node.dataset.state = tone);
    text("[data-simple-sidebar-status]", tone === "connected" ? "정상" : label);
    text("[data-simple-health]", tone === "connected" ? "정상" : label);
    text("[data-simple-health-copy]", tone === "connected" ? "NUSA 서버와 공개 시장 데이터가 연결되어 있습니다." : "연결 상태가 확인될 때까지 Paper 주문은 잠겨 있습니다.");
    text("[data-simple-market-status]", marketTone === "connected" ? "정상" : marketLabel);
    text("[data-simple-settings-market]", marketTone === "connected" ? "정상" : marketLabel);
    text("[data-simple-server-status]", serverTone === "connected" ? "정상" : serverLabel);
    const action = $("[data-simple-next-action]");
    const copy = $("[data-simple-next-copy]");
    const button = $("[data-simple-card--action]");
    if (tone === "connected") {
      if (action) action.textContent = "Paper Trading을 시작할 준비가 되었습니다.";
      if (copy) copy.textContent = "마켓을 확인하거나 주문 화면에서 Paper 주문을 검토하세요.";
      if (button) button.textContent = "주문 화면 열기";
    } else {
      if (action) action.textContent = tone === "reconnecting" ? "연결을 다시 복구하는 중입니다." : "서버와 시세 연결을 확인하는 중입니다.";
      if (copy) copy.textContent = "연결 전에는 주문 버튼이 비활성화됩니다.";
    }
  }
  function renderNav() {
    const activePage = ["strategy", "logs", "settings"].includes(state.page) ? "more" : state.page === "balance" ? "positions" : state.page;
    $$("[data-simple-nav]").forEach((button) => {
      const target = button.dataset.simpleNav;
      const active = target === activePage;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    text("#simple-page-title", pageLabels[state.page] || pageLabels.dashboard);
  }
  function showPage(target, updateHash = true) {
    const page = Object.prototype.hasOwnProperty.call(pageLabels, target) ? target : "dashboard";
    state.page = page;
    $$('[data-simple-page]').forEach((section) => {
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
    const rows = [["KRW", cash, ""], [position.market || "보유 자산", held, "simple-composition__fill--asset"]];
    target.replaceChildren(...rows.map(([label, value, modifier]) => {
      const row = document.createElement("div"); row.className = "simple-composition__row";
      const meta = document.createElement("div"); meta.className = "simple-composition__meta";
      const name = document.createElement("strong"); name.textContent = label;
      const amount = document.createElement("span"); amount.textContent = `${moneyValue(value)} · ${((value / total) * 100).toFixed(1)}%`;
      meta.append(name, amount);
      const track = document.createElement("div"); track.className = "simple-composition__track";
      const fill = document.createElement("div"); fill.className = `simple-composition__fill ${modifier}`; fill.style.width = `${Math.min(100, Math.max(0, value / total * 100))}%`;
      track.append(fill); row.append(meta, track); return row;
    }));
  }
  function positionRow(snapshot, full = false) {
    const summary = viewModel?.summarize(snapshot, state.lastPrice);
    const position = summary?.position || snapshot?.position;
    if (!summary?.hasPosition && (!position || !finite(position.quantity) || position.quantity <= 0)) return null;
    const current = finite(state.lastPrice) ? state.lastPrice : null;
    const value = current == null ? null : current * position.quantity;
    const pnl = finite(snapshot.unrealizedPnl) ? snapshot.unrealizedPnl : null;
    const rate = value != null && finite(position.averagePrice) && position.averagePrice > 0 ? (current - position.averagePrice) / position.averagePrice : null;
    const tr = document.createElement("tr");
    const cells = full
      ? [position.market || "KRW-BTC", numberValue(position.quantity), moneyValue(position.averagePrice), moneyValue(current), moneyValue(value), signedMoney(pnl), signedPercent(rate)]
      : [position.market || "KRW-BTC", numberValue(position.quantity), moneyValue(position.averagePrice), moneyValue(current), signedMoney(pnl), signedPercent(rate)];
    cells.forEach((value, index) => { const td = document.createElement("td"); td.textContent = value; if (index >= cells.length - 2 && pnl != null) td.className = pnl >= 0 ? "simple-position-pnl--positive" : "simple-position-pnl--negative"; tr.append(td); });
    return tr;
  }
  function emptyTableRow(colSpan) {
    const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = colSpan; const empty = document.createElement("span"); empty.className = "simple-empty"; empty.textContent = "보유 중인 Paper 포지션이 없습니다."; td.append(empty); tr.append(td); return tr;
  }
  function renderPositions(snapshot) {
    const compact = $("[data-simple-position-table]");
    const full = $("[data-simple-position-table-full]");
    const row = positionRow(snapshot, false);
    const fullRow = positionRow(snapshot, true);
    if (compact) compact.replaceChildren(row || emptyTableRow(6));
    if (full) full.replaceChildren(fullRow || emptyTableRow(7));
    $$("[data-simple-position-cards], [data-simple-position-cards-full]").forEach((target) => target.replaceChildren(positionCard(snapshot) || Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "보유 중인 Paper 포지션이 없습니다." })));
  }
  function positionCard(snapshot) {
    const summary = viewModel?.summarize(snapshot, state.lastPrice);
    const position = summary?.position || snapshot?.position;
    if (!summary?.hasPosition && (!position || !finite(position.quantity) || position.quantity <= 0)) return null;
    const current = finite(state.lastPrice) ? state.lastPrice : null;
    const value = current == null ? null : current * position.quantity;
    const pnl = finite(snapshot.unrealizedPnl) ? snapshot.unrealizedPnl : null;
    const card = document.createElement("article"); card.className = "simple-mobile-card";
    const header = document.createElement("div"); header.className = "simple-mobile-card__header";
    const title = document.createElement("strong"); title.textContent = position.market || "KRW-BTC";
    const badge = document.createElement("span"); badge.className = `simple-mobile-card__badge ${pnl != null && pnl < 0 ? "is-negative" : ""}`; badge.textContent = signedMoney(pnl);
    header.append(title, badge);
    const body = document.createElement("dl"); body.className = "simple-mobile-card__details";
    [["보유 수량", numberValue(position.quantity)], ["평균 단가", moneyValue(position.averagePrice)], ["현재가", moneyValue(current)], ["평가 금액", moneyValue(value)], ["평가 손익", signedMoney(pnl)]].forEach(([label, value]) => { const item = document.createElement("div"); const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; item.append(dt, dd); body.append(item); });
    card.append(header, body); return card;
  }
  function activityRow(order) {
    const row = document.createElement("div"); row.className = "simple-activity-row";
    const detail = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = `${order.side === "BUY" ? "매수" : "매도"} · ${order.market || "KRW-BTC"}`;
    const meta = document.createElement("small"); meta.textContent = `${numberValue(order.quantity)} · ${moneyValue(order.price)}`;
    detail.append(title, meta);
    const time = document.createElement("span"); time.textContent = order.filledAt ? new Date(order.filledAt).toLocaleTimeString("ko-KR") : "-";
    row.append(detail, time); return row;
  }
  function renderOrders(snapshot) {
    const orders = Array.isArray(snapshot?.orders) ? [...snapshot.orders].reverse() : [];
    $$("[data-simple-recent-orders], [data-simple-order-list]").forEach((target) => target.replaceChildren(...(orders.length ? orders.slice(0, 6).map(activityRow) : [Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "아직 주문 기록이 없습니다." })])));
    $$("[data-simple-order-cards]").forEach((target) => target.replaceChildren(...(orders.length ? orders.slice(0, 5).map((order) => { const row = activityRow(order); row.classList.add("simple-mobile-card"); return row; }) : [Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "아직 주문 기록이 없습니다." })])));
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
    text("[data-simple-order-count]", summary?.orderCount == null ? "-" : `${summary.orderCount}건`);
    text("[data-simple-cash]", moneyValue(snapshot?.cash));
    text("[data-simple-held-value]", snapshot ? moneyValue(held) : "-");
    text("[data-simple-balance-total]", moneyValue(snapshot?.equity));
    renderComposition(snapshot); renderPositions(snapshot); renderOrders(snapshot); renderOrderSummary();
    text("[data-simple-realized-pnl]", signedMoney(snapshot?.position?.realizedPnl));
    state.loading = false; state.lastUpdated = new Date(); text("[data-simple-updated]", `마지막 업데이트 ${state.lastUpdated.toLocaleTimeString("ko-KR")}`);
  }
  function renderOrderSummary() {
    text("[data-simple-market-price]", moneyValue(state.lastPrice));
    text("[data-simple-order-price]", moneyValue(state.lastPrice));
    const input = $("[data-simple-order-quantity]");
    const quantity = Number(input?.value);
    text("[data-simple-order-notional]", finite(quantity) && finite(state.lastPrice) ? moneyValue(quantity * state.lastPrice) : "-");
    text("[data-simple-order-fee]", finite(state.lastPrice) ? "Paper 설정값 적용" : "연결 후 계산");
    $$("[data-simple-order]").forEach((button) => button.disabled = !(state.connection === "connected" && finite(state.lastPrice) && finite(quantity) && quantity > 0));
    renderOrderSheet();
  }
  function renderOrderSheet() {
    const pending = state.pendingOrder;
    const sheet = $("[data-simple-sheet]");
    const backdrop = $("[data-simple-sheet-backdrop]");
    if (!sheet || !backdrop) return;
    const quantity = Number($("[data-simple-order-quantity]")?.value);
    text("[data-simple-sheet-side]", pending?.side === "BUY" ? "Paper 매수" : pending?.side === "SELL" ? "Paper 매도" : "-");
    text("[data-simple-sheet-price]", moneyValue(state.lastPrice));
    text("[data-simple-sheet-quantity]", finite(quantity) && quantity > 0 ? numberValue(quantity) : "-");
    text("[data-simple-sheet-notional]", finite(quantity) && quantity > 0 && finite(state.lastPrice) ? moneyValue(quantity * state.lastPrice) : "-");
    text("[data-simple-sheet-fee]", finite(state.lastPrice) ? "Paper 설정값 적용" : "연결 후 계산");
    const open = Boolean(pending);
    sheet.hidden = !open;
    backdrop.hidden = !open;
  }
  function closeOrderSheet({ restoreFocus = true } = {}) {
    state.pendingOrder = null;
    const trigger = state.orderTrigger;
    state.orderTrigger = null;
    renderOrderSheet();
    if (restoreFocus && trigger && typeof trigger.focus === "function") trigger.focus();
  }
  function openOrderSheet(side) {
    const quantity = Number($("[data-simple-order-quantity]")?.value);
    const message = $("[data-simple-order-message]");
    if (state.connection !== "connected" || !finite(state.lastPrice) || !finite(quantity) || quantity <= 0) {
      if (message) message.textContent = "연결 상태와 유효한 수량을 확인하세요.";
      return;
    }
    state.pendingOrder = { side };
    state.orderTrigger = document.activeElement;
    renderOrderSheet();
    $("[data-simple-sheet-confirm]")?.focus();
  }
  function renderTicker(ticker) {
    if (finite(ticker?.trade_price)) {
      state.lastPrice = ticker.trade_price;
      state.connectionCode = "connected";
    }
    state.changeRate = finite(ticker?.signed_change_rate) ? ticker.signed_change_rate : null;
    text("[data-simple-market-price]", moneyValue(state.lastPrice));
    text("[data-simple-order-price]", moneyValue(state.lastPrice));
    text("[data-simple-market-change]", signedPercent(state.changeRate));
    renderConnection(); renderSnapshot(state.snapshot); renderOrderSummary();
  }
  function renderChart() {
    const target = $("[data-simple-equity-chart]");
    if (!target) return;
    if (state.chartPoints.length < 2) { target.replaceChildren(Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "아직 표시할 자산 추이 데이터가 없습니다." })); return; }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 800 180"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Paper 계정 자산 추이");
    const values = state.chartPoints.map((point) => point.value).filter(finite); const min = Math.min(...values); const max = Math.max(...values); const range = Math.max(1, max - min);
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); polyline.setAttribute("fill", "none"); polyline.setAttribute("stroke", "#2563eb"); polyline.setAttribute("stroke-width", "3"); polyline.setAttribute("points", values.map((value, index) => `${16 + index / (values.length - 1) * 768},${164 - (value - min) / range * 148}`).join(" ")); svg.append(polyline); target.replaceChildren(svg);
  }
  function renderControl(control) {
    state.control = control || null;
    const status = String(control?.status || "STOPPED");
    text("[data-simple-strategy-status]", status === "RUNNING" ? "실행 중" : status === "PAUSED" ? "일시 중지" : "중지됨");
    text("[data-simple-auto-trade]", control?.autoTradeEnabled ? "켜짐" : "꺼짐");
    $$("[data-simple-strategy='start']").forEach((button) => button.disabled = status === "RUNNING");
    $$("[data-simple-strategy='stop']").forEach((button) => button.disabled = status === "STOPPED");
    const latest = Array.isArray(control?.events) ? control.events[0] : null;
    text("[data-simple-last-signal]", latest ? `${latest.type || "이벤트"} · ${latest.message || ""}` : "아직 없음");
    const target = $("[data-simple-log-list]");
    if (!target) return;
    const eventRows = Array.isArray(control?.events) ? control.events.slice(0, 20).map((event) => {
      const row = document.createElement("div"); row.className = "simple-log-row"; const detail = document.createElement("div"); const title = document.createElement("strong"); title.textContent = event.type || "운영 이벤트"; const message = document.createElement("small"); message.textContent = event.message || ""; detail.append(title, message); const time = document.createElement("span"); time.textContent = event.timestamp ? new Date(event.timestamp).toLocaleTimeString("ko-KR") : "-"; row.append(detail, time); return row;
    }) : [];
    const rows = [...eventRows, ...state.logs.map((log) => { const row = document.createElement("div"); row.className = "simple-log-row"; const detail = document.createElement("div"); const title = document.createElement("strong"); title.textContent = `${log.category} · ${log.severity}`; const message = document.createElement("small"); message.textContent = log.message; detail.append(title, message); const time = document.createElement("span"); time.textContent = new Date(log.time).toLocaleTimeString("ko-KR"); row.append(detail, time); return row; })];
    target.replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement("div"), { className: "simple-empty", textContent: "아직 운영 로그가 없습니다." })]));
  }
  function mountAdvanced(target) {
    const pane = $("[data-simple-advanced-pane]"); const mount = $("[data-simple-advanced-mount]");
    if (!pane || !mount) return;
    const selectors = { "control-room": ["#control-room", "#operations-detail", "#application-state"], risk: ["#a4-diagnostics"], recovery: ["#recovery-review"], evidence: ["#evidence"], diagnostics: ["#ai-cio-dashboard"] };
    mount.replaceChildren();
    const section = document.createElement("section"); section.className = "simple-legacy-panel";
    for (const selector of selectors[target] || []) { const node = document.querySelector(selector); if (node) section.append(node); }
    if (!section.children.length) section.append(Object.assign(document.createElement("p"), { className: "simple-empty", textContent: "이 운영 화면은 현재 사용할 수 없습니다." }));
    mount.append(section); pane.hidden = false;
  }
  function setAssetsTab(target) {
    $$("[data-simple-assets-tab]").forEach((button) => { const active = button.dataset.simpleAssetsTab === target; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
    $$("[data-simple-assets-panel]").forEach((panel) => { panel.hidden = panel.dataset.simpleAssetsPanel !== target; });
  }
  function render() { renderConnection(); renderNav(); renderSnapshot(state.snapshot); renderTicker({ trade_price: state.lastPrice, signed_change_rate: state.changeRate }); renderControl(state.control); renderChart(); }
  async function read(method, fallback = null) {
    try { return typeof method === "function" ? await method() : fallback; } catch { return fallback; }
  }
  async function readResult(method, fallback = null) {
    try { return { ok: true, value: typeof method === "function" ? await method() : fallback }; } catch (error) { return { ok: false, value: fallback, error }; }
  }
  async function loadSettings() {
    const api = global.nusaApp;
    const payload = await read(api?.settings?.bind(api));
    const settings = payload?.settings || payload;
    if (!settings || typeof settings !== "object") return;
    state.settings = settings;
    for (const key of ["theme", "logLevel"]) { const control = $(`[data-simple-setting="${key}"]`); if (control && settings[key] != null) control.value = settings[key]; }
    for (const key of ["showDiagnostics", "showNotifications"]) { const control = $(`[data-simple-setting="${key}"]`); if (control && settings[key] != null) control.checked = Boolean(settings[key]); }
  }
  async function loadAbout() {
    const payload = await read(global.nusaApp?.about?.bind(global.nusaApp));
    const about = payload?.about || payload;
    if (!about || typeof about !== "object") return;
    text("[data-simple-app-version]", `버전 ${about.appVersion || "확인 불가"} · Electron ${about.electronVersion || "확인 불가"} · Node ${about.nodeVersion || "확인 불가"}`);
    text("[data-simple-app-mode]", about.mode || "Paper Trading");
  }
  async function saveSettings() {
    const api = global.nusaApp; const message = $("[data-simple-settings-message]");
    if (!api?.saveSettings) { if (message) message.textContent = "설정 저장 기능을 사용할 수 없습니다."; return; }
    const value = { theme: $("[data-simple-setting='theme']")?.value, logLevel: $("[data-simple-setting='logLevel']")?.value, showDiagnostics: Boolean($("[data-simple-setting='showDiagnostics']")?.checked), showNotifications: Boolean($("[data-simple-setting='showNotifications']")?.checked) };
    try { await api.saveSettings(value); if (message) message.textContent = "설정을 저장했습니다."; } catch { if (message) message.textContent = "설정을 저장하지 못했습니다."; }
  }
  async function resetSettings() {
    const api = global.nusaApp; const message = $("[data-simple-settings-message]");
    if (!api?.resetSettings || (typeof global.confirm === "function" && !global.confirm("화면 설정을 초기화하시겠습니까? Evidence와 복구 기록은 삭제되지 않습니다."))) return;
    try { await api.resetSettings(); await loadSettings(); if (message) message.textContent = "화면 설정을 초기화했습니다."; } catch { if (message) message.textContent = "설정을 초기화하지 못했습니다."; }
  }
  async function placePaperOrder(side) {
    const input = $("[data-simple-order-quantity]"); const message = $("[data-simple-order-message]"); const quantity = Number(input?.value);
    if (!state.pendingOrder || state.pendingOrder.side !== side || !global.nusa?.placeOrder || !finite(quantity) || quantity <= 0 || !finite(state.lastPrice)) return;
    const button = $(`[data-simple-order="${side}"]`); if (button) button.disabled = true;
    try {
      const result = await global.nusa.placeOrder(side, quantity);
      closeOrderSheet({ restoreFocus: false });
      renderSnapshot(result?.snapshot || state.snapshot);
      if (message) message.textContent = "Paper 주문이 기록되었습니다. 실제 주문은 발생하지 않았습니다.";
      recordLog("주문", side === "BUY" ? "Paper 매수 기록" : "Paper 매도 기록", "정보");
      renderControl(state.control);
    } catch (error) {
      if (message) message.textContent = error instanceof Error ? error.message : "Paper 주문을 기록하지 못했습니다.";
    } finally {
      renderOrderSummary();
    }
  }
  async function strategyCommand(command) {
    const api = global.nusa; const message = $("[data-simple-last-signal]");
    try { const result = command === "start" ? await api.startStrategy() : await api.stopStrategy(); renderControl(result); if (message) message.textContent = command === "start" ? "전략 시작 요청 완료" : "전략 중지 요청 완료"; } catch { if (message) message.textContent = "전략 상태를 변경하지 못했습니다."; }
  }
  function installEvents() {
    $$('[data-simple-nav]').forEach((button) => button.addEventListener("click", () => showPage(button.dataset.simpleNav)));
    global.addEventListener("hashchange", () => showPage(global.location.hash.slice(1), false));
    $("[data-simple-order-quantity]")?.addEventListener("input", renderOrderSummary);
    $$('[data-simple-order]').forEach((button) => button.addEventListener("click", () => openOrderSheet(button.dataset.simpleOrder)));
    $$('[data-simple-sheet-close]').forEach((button) => button.addEventListener("click", () => closeOrderSheet()));
    $("[data-simple-sheet-confirm]")?.addEventListener("click", () => void placePaperOrder(state.pendingOrder?.side));
    $("[data-simple-sheet-backdrop]")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeOrderSheet(); });
    global.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.pendingOrder) closeOrderSheet(); });
    $$('[data-simple-strategy]').forEach((button) => button.addEventListener("click", () => void strategyCommand(button.dataset.simpleStrategy)));
    $("[data-simple-settings-save]")?.addEventListener("click", () => void saveSettings());
    $("[data-simple-settings-reset]")?.addEventListener("click", () => void resetSettings());
    $$('[data-simple-quick-order]').forEach((button) => button.addEventListener("click", () => { showPage("orders"); text("[data-simple-order-message]", `${button.dataset.simpleQuickOrder === "BUY" ? "Paper 매수" : "Paper 매도"} 내용을 확인하세요.`); }));
    $$('[data-simple-assets-tab]').forEach((button) => button.addEventListener("click", () => setAssetsTab(button.dataset.simpleAssetsTab)));
    $$('[data-simple-advanced]').forEach((button) => button.addEventListener("click", () => { const target = button.dataset.simpleAdvanced; if (["strategy", "logs", "settings"].includes(target)) showPage(target); else { showPage("more"); mountAdvanced(target); } }));
    $("[data-simple-more-back]")?.addEventListener("click", () => { const pane = $("[data-simple-advanced-pane]"); if (pane) pane.hidden = true; });
    const api = global.nusa;
    if (!api) return;
    if (typeof api.onStatus === "function") unsubscribers.push(api.onStatus((value) => { state.connectionCode = value; recordLog("시장 데이터", `연결 상태: ${value}`, value === "connected" ? "정보" : "주의"); renderConnection(); renderOrderSummary(); }));
    if (typeof api.onTicker === "function") unsubscribers.push(api.onTicker((value) => { renderTicker(value); renderChart(); }));
    if (typeof api.onSnapshot === "function") unsubscribers.push(api.onSnapshot((value) => { markServerConnected(); renderSnapshot(value); renderConnection(); }));
    if (typeof api.onControl === "function") unsubscribers.push(api.onControl((value) => { renderControl(value); render(); }));
    if (typeof api.onChartPoint === "function") unsubscribers.push(api.onChartPoint((value) => { if (finite(value?.value)) { state.chartPoints.push(value); state.chartPoints = state.chartPoints.slice(-120); renderChart(); } }));
  }
  async function loadInitial() {
    const api = global.nusa;
    const [snapshotResult, control] = await Promise.all([readResult(api?.getSnapshot?.bind(api)), read(api?.getControlSnapshot?.bind(api))]);
    if (snapshotResult.ok) {
      markServerConnected();
      if (snapshotResult.value) renderSnapshot(snapshotResult.value);
    } else {
      markServerDisconnected();
      recordLog("NUSA 서버", "초기 Cloud snapshot 연결 실패", "주의");
    }
    if (control) renderControl(control);
    await loadSettings(); await loadAbout(); render();
  }

  installEvents();
  showPage(global.location.hash.slice(1) || "dashboard", false);
  render();
  void loadInitial();
  connectionWatchdog = global.setInterval(() => {
    if (state.serverLastSuccessAt != null && Date.now() - state.serverLastSuccessAt > SERVER_SNAPSHOT_STALE_MS && state.serverConnectionCode !== "disconnected") {
      markServerDisconnected();
      recordLog("NUSA 서버", "Cloud snapshot이 stale 상태로 전환됨", "주의");
      renderConnection();
    }
  }, 2_000);
  global.addEventListener("beforeunload", () => {
    if (connectionWatchdog != null) global.clearInterval(connectionWatchdog);
    unsubscribers.forEach((unsubscribe) => { try { unsubscribe?.(); } catch { /* renderer teardown is best effort */ } });
  });
  global.NUSASimpleUI = Object.freeze({ showPage, state });
})(window);
