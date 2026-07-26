const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const byId = (id) => document.getElementById(id);
const sideKo = (side) => (side === "BUY" ? "매수" : "매도");
const CONTROL_STATUS_KO = { STOPPED: "중지됨", RUNNING: "실행 중", PAUSED: "일시정지", FAULTED: "오류 발생" };
const controlStatusKo = (status) => CONTROL_STATUS_KO[status] ?? status;
const STRATEGY_NAME_KO = { "sma-crossover": "SMA 크로스오버", "ema-crossover": "EMA 크로스오버" };
const strategyNameKo = (choice) => STRATEGY_NAME_KO[choice] ?? choice;

// AI CIO dashboard (apps/desktop/src/paperDashboardProjection.ts) status/availability/reason
// codes -- a fixed, fully enumerated set (see that file), translated here rather than server
// side since these are read-only display codes, not thrown errors (errorMessages.ts covers those).
const CIO_BADGE_KO = {
  HEALTHY: "정상", CAUTION: "주의", BLOCKED: "차단됨",
  AVAILABLE: "사용 가능", UNAVAILABLE: "사용 불가", INVALID: "무효", NO_DATA: "데이터 없음"
};
const CIO_REASON_KO = {
  PAPER_RUNTIME_UNAVAILABLE: "Paper 실행 환경을 사용할 수 없음",
  SOURCE_NOT_CONNECTED: "데이터 소스가 연결되지 않음",
  CONTROL_PLANE_FAULTED: "제어 시스템이 오류 상태임",
  STRATEGY_ANALYTICS_NOT_CONNECTED: "전략 분석 데이터가 연결되지 않음",
  STRATEGY_STOPPED: "전략이 중지됨",
  STRATEGY_PAUSED: "전략이 일시정지됨",
  STRATEGY_WARMING_UP: "전략이 워밍업 중임",
  PAPER_SYNTHETIC_EXECUTION: "Paper 합성 체결(시뮬레이션) 사용 중"
};
const cioBadgeKo = (code) => CIO_BADGE_KO[code] ?? code;
const cioReasonKo = (code) => CIO_REASON_KO[code] ?? code;
const textNode = (tag, value, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
};

async function fetchJson(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    // The server itself is unreachable (down, restarting, network drop) -- the browser's own
    // fetch() throws a raw English message (e.g. "Failed to fetch") in this case, before any
    // JSON response exists to translate, so it's replaced here rather than in errorMessages.ts
    // (which only ever sees text the server actually sent).
    throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `요청 실패 (status ${response.status})`);
  return body;
}

function renderMarket(market) {
  const status = byId("market-status");
  status.className = `status ${market.status === "CONNECTED" ? "connected" : "error"}`;
  status.textContent = market.status === "CONNECTED" ? "실시간 연결됨" : market.status === "CONNECTING" ? "연결 중..." : `오류: ${market.lastError ?? "알 수 없음"}`;
  byId("chart-price").textContent = market.price ? won.format(market.price) : "-";
}

function renderChart(candles) {
  const canvas = byId("chart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!candles.length) return;
  const low = Math.min(...candles.map((c) => c.low));
  const high = Math.max(...candles.map((c) => c.high));
  const range = high - low || 1;
  const slot = width / candles.length;
  const bodyWidth = Math.max(1, slot * 0.6);
  const y = (price) => height - ((price - low) / range) * height;
  candles.forEach((candle, index) => {
    const x = index * slot + slot / 2;
    const up = candle.close >= candle.open;
    ctx.strokeStyle = ctx.fillStyle = up ? "#34d399" : "#f2596b";
    ctx.beginPath();
    ctx.moveTo(x, y(candle.high));
    ctx.lineTo(x, y(candle.low));
    ctx.stroke();
    const top = y(Math.max(candle.open, candle.close));
    const bodyHeight = Math.max(1, Math.abs(y(candle.open) - y(candle.close)));
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight, Math.min(2, bodyWidth / 2));
      ctx.fill();
    } else {
      ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
    }
  });
}

function renderDrawdown(drawdown) {
  byId("dd-peak").textContent = drawdown.peakEquity === null ? "-" : won.format(drawdown.peakEquity);
  byId("dd-current").textContent = drawdown.currentDrawdownPercent === null
    ? "-"
    : `${won.format(drawdown.currentDrawdown)} (${percent.format(drawdown.currentDrawdownPercent)})`;
  byId("dd-max").textContent = drawdown.maxDrawdownPercent === null
    ? "-"
    : `${won.format(drawdown.maxDrawdown)} (${percent.format(drawdown.maxDrawdownPercent)})`;
}

function renderEquityCurve(history) {
  byId("equity-latest").textContent = history.length ? won.format(history[history.length - 1].equity) : "-";

  const canvas = byId("equity-chart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (history.length < 2) return;

  const values = history.map((sample) => sample.equity);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const startingEquity = values[0];
  const x = (index) => (index / (history.length - 1)) * width;
  const y = (equity) => height - ((equity - low) / range) * height;
  const up = values[values.length - 1] >= startingEquity;
  const lineColor = up ? "#34d399" : "#f2596b";

  // gradient area fill under the line, fading to transparent at the bottom
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, up ? "rgba(52, 211, 153, 0.28)" : "rgba(242, 89, 107, 0.28)");
  gradient.addColorStop(1, "rgba(52, 211, 153, 0)");
  ctx.beginPath();
  history.forEach((sample, index) => {
    const px = x(index);
    const py = y(sample.equity);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((sample, index) => {
    const px = x(index);
    const py = y(sample.equity);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.strokeStyle = "#8891a0";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y(startingEquity));
  ctx.lineTo(width, y(startingEquity));
  ctx.stroke();
  ctx.setLineDash([]);
}

function renderKpiStrip(account, control, stats) {
  byId("kpi-equity").textContent = won.format(account.equity);

  const totalPnl = account.unrealizedPnl + account.position.realizedPnl;
  const pnlEl = byId("kpi-total-pnl");
  pnlEl.textContent = won.format(totalPnl);
  pnlEl.className = totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : "";

  byId("kpi-position").textContent = `${number.format(account.position.quantity)} BTC`;
  byId("kpi-win-rate").textContent = stats.winRate === null ? "-" : percent.format(stats.winRate);
  byId("kpi-status").textContent = `${controlStatusKo(control.status)}${control.autoTradeEnabled ? " · 자동" : ""}`;
}

function renderAccount(account) {
  byId("cash").textContent = won.format(account.cash);
  byId("equity").textContent = won.format(account.equity);
  byId("position").textContent = `${number.format(account.position.quantity)} BTC`;
  byId("average").textContent = account.position.averagePrice ? won.format(account.position.averagePrice) : "-";
  byId("unrealized").textContent = won.format(account.unrealizedPnl);
  byId("realized").textContent = won.format(account.position.realizedPnl);

  const orders = byId("orders");
  if (!account.orders.length) {
    const row = document.createElement("tr");
    const cell = textNode("td", "체결 없음");
    cell.colSpan = 6;
    row.append(cell);
    orders.replaceChildren(row);
  } else orders.replaceChildren(...account.orders.slice(0, MAX_ORDER_ROWS).map((order) => {
    const row = document.createElement("tr");
    const executionCost = (order.spreadCost ?? 0) + (order.slippageCost ?? 0) + (order.marketImpactCost ?? 0);
    row.append(
      textNode("td", new Date(order.filledAt).toLocaleTimeString("ko-KR")),
      textNode("td", sideKo(order.side), order.side.toLowerCase()),
      textNode("td", number.format(order.quantity)),
      textNode("td", won.format(order.price)),
      textNode("td", won.format(order.fee)),
      textNode("td", won.format(executionCost))
    );
    return row;
  }));
  byId("orders-hint").textContent = account.orders.length > MAX_ORDER_ROWS
    ? `최근 ${MAX_ORDER_ROWS}건만 표시됩니다 (전체 ${number.format(account.orders.length)}건). 전체 내역은 CSV 다운로드로 확인하세요.`
    : "";
}

function renderLimitOrders(orders) {
  const tbody = byId("limit-orders");
  if (!orders.length) {
    const row = document.createElement("tr");
    const cell = textNode("td", "대기 중인 지정가 주문 없음");
    cell.colSpan = 5;
    row.append(cell);
    tbody.replaceChildren(row);
    return;
  }
  tbody.replaceChildren(...orders.map((order) => {
    const row = document.createElement("tr");
    const cancelCell = document.createElement("td");
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary";
    cancelButton.textContent = "취소";
    cancelButton.addEventListener("click", (event) => submitCommand("/api/limit-orders/cancel", { id: order.id }, "limit-order-error", event.currentTarget));
    cancelCell.append(cancelButton);
    row.append(
      textNode("td", sideKo(order.side), order.side.toLowerCase()),
      textNode("td", number.format(order.quantity)),
      textNode("td", won.format(order.limitPrice)),
      textNode("td", new Date(order.createdAt).toLocaleTimeString("ko-KR")),
      cancelCell
    );
    return row;
  }));
}

function renderPositionProtection(protection) {
  byId("protection-stop-loss").textContent = protection.stopLossPrice === null ? "미설정" : won.format(protection.stopLossPrice);
  byId("protection-take-profit").textContent = protection.takeProfitPrice === null ? "미설정" : won.format(protection.takeProfitPrice);
  byId("protection-trailing").textContent = protection.trailingStopPercent === null
    ? "미설정"
    : `-${percent.format(protection.trailingStopPercent)}${protection.currentTrailingStopPrice === null ? "" : ` (현재 ${won.format(protection.currentTrailingStopPrice)})`}`;
}

const percent = new Intl.NumberFormat("ko-KR", { style: "percent", maximumFractionDigits: 1 });
const pnlText = (value) => (value === null ? "-" : won.format(value));

function renderTradeStatistics(stats) {
  byId("stats-total").textContent = number.format(stats.totalTrades);
  byId("stats-buy-sell").textContent = `${number.format(stats.buyCount)} / ${number.format(stats.sellCount)}`;
  byId("stats-win-rate").textContent = stats.winRate === null ? "-" : percent.format(stats.winRate);
  byId("stats-win-loss").textContent = `${number.format(stats.wins)} / ${number.format(stats.losses)}`;
  byId("stats-avg-win").textContent = pnlText(stats.averageWin);
  byId("stats-avg-loss").textContent = pnlText(stats.averageLoss);
  byId("stats-largest-win").textContent = pnlText(stats.largestWin);
  byId("stats-largest-loss").textContent = pnlText(stats.largestLoss);
  byId("stats-profit-factor").textContent = stats.profitFactor === null ? "-" : stats.profitFactor.toFixed(2);
  byId("stats-expectancy").textContent = pnlText(stats.expectancy);
}

function renderChampionStandings({ challengers }) {
  const tbody = byId("champion-standings");
  tbody.replaceChildren(...challengers.map((challenger) => {
    const row = document.createElement("tr");
    const totalPnl = challenger.account.unrealizedPnl + challenger.account.position.realizedPnl;
    const nameCell = document.createElement("td");
    nameCell.append(textNode("span", challenger.label));
    if (challenger.isChampion) nameCell.append(" ", Object.assign(textNode("span", "챔피언"), { className: "cio-badge healthy" }));
    const actionCell = document.createElement("td");
    if (!challenger.isChampion) {
      const promoteButton = document.createElement("button");
      promoteButton.type = "button";
      promoteButton.className = "secondary";
      promoteButton.textContent = "승격";
      promoteButton.addEventListener("click", (event) => submitCommand("/api/champion/promote", { id: challenger.id }, "champion-error", event.currentTarget));
      actionCell.append(promoteButton);
    }
    const pnlCell = textNode("td", pnlText(totalPnl));
    pnlCell.className = totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : "";
    row.append(
      nameCell,
      textNode("td", won.format(challenger.account.equity)),
      pnlCell,
      textNode("td", challenger.stats.winRate === null ? "-" : percent.format(challenger.stats.winRate)),
      textNode("td", number.format(challenger.stats.totalTrades)),
      textNode("td", challenger.drawdown.maxDrawdownPercent === null ? "-" : percent.format(challenger.drawdown.maxDrawdownPercent)),
      actionCell
    );
    return row;
  }));
}

function renderBacktestResults(results) {
  const tbody = byId("backtest-results");
  tbody.replaceChildren(...results.map(({ label, metrics }) => {
    const row = document.createElement("tr");
    const returnCell = textNode("td", percent.format(metrics.totalReturn));
    returnCell.className = metrics.totalReturn > 0 ? "positive" : metrics.totalReturn < 0 ? "negative" : "";
    const excessCell = textNode("td", percent.format(metrics.excessReturn));
    excessCell.className = metrics.excessReturn > 0 ? "positive" : metrics.excessReturn < 0 ? "negative" : "";
    row.append(
      textNode("td", label),
      returnCell,
      excessCell,
      textNode("td", percent.format(metrics.maxDrawdown)),
      textNode("td", number.format(metrics.fillCount)),
      textNode("td", number.format(metrics.rejectionCount)),
      textNode("td", won.format(metrics.totalTradingCost))
    );
    return row;
  }));
}

function renderReferenceAccounting({ portfolio, pnl, reconciliation }) {
  byId("ref-cash").textContent = won.format(portfolio.cash);
  byId("ref-position").textContent = `${number.format(portfolio.quantity)} BTC`;
  byId("ref-average").textContent = portfolio.averagePrice ? won.format(portfolio.averagePrice) : "-";
  byId("ref-unrealized").textContent = won.format(pnl.unrealizedPnl);
  byId("ref-realized").textContent = won.format(pnl.realizedPnl);
  byId("ref-total").textContent = won.format(pnl.totalPnl);

  const badge = byId("ref-consistency");
  badge.className = `status ${reconciliation.consistent ? "connected" : "error"}`;
  badge.textContent = reconciliation.consistent ? "실제 계좌와 일치" : "불일치 감지됨";
  byId("ref-discrepancies").textContent = reconciliation.consistent ? "" : reconciliation.discrepancies.join(" · ");
}

function renderControl(control) {
  byId("strategy-status").textContent = controlStatusKo(control.status);
  byId("strategy-id").textContent = strategyNameKo(control.activeStrategyId);
  byId("strategy-select").value = control.activeStrategyId;
  byId("auto-trade").checked = control.autoTradeEnabled;
  byId("strategy-quantity").value = String(control.orderQuantity);
  byId("strategy-start").disabled = control.status === "RUNNING";
  byId("strategy-stop").disabled = control.status === "STOPPED";
}

function renderStrategyPeriods(periods) {
  byId("strategy-short-period").value = String(periods.shortPeriod);
  byId("strategy-long-period").value = String(periods.longPeriod);
}

function renderPositionSizing(sizing) {
  byId("sizing-mode").value = sizing.mode;
  byId("sizing-risk-fraction").value = String(sizing.riskFraction);
  byId("sizing-risk-fraction").disabled = sizing.mode !== "FIXED_FRACTIONAL";
}

const MAX_EVENT_ROWS = 30;
// account.orders can grow unbounded over a long-running session (PaperBroker keeps full
// history) -- capped here the same way the event log already is, since account.orders is
// already newest-first (see paperRuntime.ts's getTradeStatistics() doc comment); the full
// history remains available via the existing CSV export, unaffected by this display cap.
const MAX_ORDER_ROWS = 50;

// apiRouter.ts's /api/control handler already translates events[].type to Korean
// (신호/상태/시스템/주문/리스크) server-side -- this maps that Korean label back to the CSS
// class suffix .event-type/.event-row-risk actually expect (styles.css only defines
// .event-type.risk/.order/.signal/.system/.status), since comparing against the old raw
// English values here would never match once the server started translating them.
const EVENT_TYPE_CSS_CLASS = Object.freeze({ "신호": "signal", "상태": "status", "시스템": "system", "주문": "order", "리스크": "risk" });

function renderEvents(events) {
  const tbody = byId("events");
  if (!events.length) {
    const row = document.createElement("tr");
    const cell = textNode("td", "이벤트 없음");
    cell.colSpan = 3;
    tbody.replaceChildren(row);
    row.append(cell);
    byId("events-hint").textContent = "";
    return;
  }
  tbody.replaceChildren(...events.slice(0, MAX_EVENT_ROWS).map((event) => {
    const row = document.createElement("tr");
    if (event.type === "리스크") row.className = "event-row-risk";
    const typeCell = document.createElement("td");
    typeCell.append(textNode("span", event.type, `event-type ${EVENT_TYPE_CSS_CLASS[event.type] ?? ""}`));
    row.append(textNode("td", new Date(event.timestamp).toLocaleTimeString("ko-KR")), typeCell, textNode("td", event.message));
    return row;
  }));
  // account.orders already gets this same truncation disclosure (orders-hint) -- the event log
  // had the identical MAX_EVENT_ROWS cap since it was first added but never got the matching
  // hint, so a long-running session silently hid older events with no indication why.
  byId("events-hint").textContent = events.length > MAX_EVENT_ROWS
    ? `최근 ${MAX_EVENT_ROWS}건만 표시됩니다 (전체 ${number.format(events.length)}건).`
    : "";
}

const CIO_SECTIONS = [
  ["portfolio", "포트폴리오"],
  ["opportunities", "기회"],
  ["strategies", "전략"],
  ["committee", "투자위원회"],
  ["execution", "체결"],
  ["risk", "리스크"],
  ["research", "리서치"]
];

function renderDashboard(dashboard) {
  const grid = byId("cio-grid");
  grid.replaceChildren(...CIO_SECTIONS.map(([key, label]) => {
    const section = dashboard[key];
    const el = document.createElement("section");
    const badgeClass = section.status ? section.status.toLowerCase() : section.availability === "UNAVAILABLE" ? "unavailable" : "no-data";
    el.append(
      textNode("h3", label),
      Object.assign(textNode("span", cioBadgeKo(section.status ?? section.availability ?? "NO_DATA"), `cio-badge ${badgeClass}`), {}),
      ...(section.reasons && section.reasons.length ? [textNode("p", section.reasons.map(cioReasonKo).join(", "))] : [])
    );
    return el;
  }));
}

let refreshInFlight = false;
let refreshTimer;
let refreshDelayMs = 5_000;

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const market = await fetchJson("/api/market");
    renderMarket(market);
    const { candles } = await fetchJson("/api/chart/candles");
    renderChart(candles);
    const { history, drawdown } = await fetchJson("/api/equity-history");
    renderEquityCurve(history);
    renderDrawdown(drawdown);
    const control = await fetchJson("/api/control");
    renderControl(control);
    renderEvents(control.events);
    renderPositionProtection(await fetchJson("/api/position-protection"));
    const { orders: limitOrders } = await fetchJson("/api/limit-orders");
    renderLimitOrders(limitOrders);
    renderPositionSizing(await fetchJson("/api/position-sizing"));
    renderStrategyPeriods(await fetchJson("/api/strategy/periods"));
    try {
      const account = await fetchJson("/api/account");
      renderAccount(account);
      renderDashboard(await fetchJson("/api/dashboard"));
      renderReferenceAccounting(await fetchJson("/api/reference-accounting"));
      const stats = await fetchJson("/api/trade-statistics");
      renderTradeStatistics(stats);
      renderKpiStrip(account, control, stats);
      renderChampionStandings(await fetchJson("/api/champion"));
    } catch {
      // Market price not ready yet (e.g. first few seconds after boot) -- account/dashboard
      // need a price to compute equity/exposure; market/control/chart above degrade independently.
    }
    refreshDelayMs = 5_000;
  } catch {
    refreshDelayMs = Math.min(30_000, refreshDelayMs * 2);
  } finally {
    refreshInFlight = false;
    refreshTimer = setTimeout(refresh, refreshDelayMs);
  }
}

// triggerButton (optional) is disabled for the duration of the request -- manual orders have
// no server-side idempotency key the way automatic-strategy signals do
// (ControlPlane.claimAutomaticSignal), so a rapid double-click on 매수/매도/전량 청산/주문 등록
// without this would place two genuinely separate orders, not a deduplicated retry.
async function submitCommand(path, body, errorElementId, triggerButton) {
  const errorElement = byId(errorElementId);
  errorElement.textContent = "";
  if (triggerButton) triggerButton.disabled = true;
  try {
    await fetchJson(path, body === undefined ? { method: "POST" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await refresh();
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    // refresh() may have already set a button's disabled state from server truth (e.g.
    // strategy-start/stop based on control.status) -- only clear the flag this call itself set,
    // never force it back on if something else legitimately still wants it disabled... in
    // practice renderControl() re-runs inside refresh() and re-derives this correctly either way.
    if (triggerButton) triggerButton.disabled = false;
  }
}

byId("strategy-start").addEventListener("click", (event) => submitCommand("/api/strategy/start", undefined, "control-error", event.currentTarget));
byId("strategy-stop").addEventListener("click", (event) => submitCommand("/api/strategy/stop", undefined, "control-error", event.currentTarget));
byId("auto-trade").addEventListener("change", (event) => submitCommand("/api/strategy/auto-trade", { enabled: event.target.checked }, "control-error"));
byId("strategy-quantity").addEventListener("change", (event) => submitCommand("/api/strategy/quantity", { quantity: Number(event.target.value) }, "control-error"));
byId("strategy-select").addEventListener("change", (event) => submitCommand("/api/strategy/select", { choice: event.target.value }, "control-error"));
const submitPositionSizing = () => submitCommand("/api/position-sizing", {
  mode: byId("sizing-mode").value,
  riskFraction: Number(byId("sizing-risk-fraction").value)
}, "control-error");
byId("sizing-mode").addEventListener("change", submitPositionSizing);
byId("sizing-risk-fraction").addEventListener("change", submitPositionSizing);
byId("strategy-periods-set").addEventListener("click", (event) => submitCommand("/api/strategy/periods", {
  shortPeriod: Number(byId("strategy-short-period").value),
  longPeriod: Number(byId("strategy-long-period").value)
}, "control-error", event.currentTarget));
byId("buy").addEventListener("click", (event) => submitCommand("/api/orders", { side: "BUY", quantity: Number(byId("order-quantity").value) }, "order-error", event.currentTarget));
byId("sell").addEventListener("click", (event) => submitCommand("/api/orders", { side: "SELL", quantity: Number(byId("order-quantity").value) }, "order-error", event.currentTarget));
byId("close-position").addEventListener("click", (event) => submitCommand("/api/position/close", undefined, "order-error", event.currentTarget));

byId("limit-order-submit").addEventListener("click", (event) => submitCommand("/api/limit-orders", {
  side: byId("limit-order-side").value,
  quantity: Number(byId("limit-order-quantity").value),
  limitPrice: Number(byId("limit-order-price").value)
}, "limit-order-error", event.currentTarget));

const protectionValue = (id) => { const raw = byId(id).value.trim(); return raw === "" ? null : Number(raw); };
byId("protection-set").addEventListener("click", (event) => {
  const trailingPercent = protectionValue("protection-trailing-input");
  submitCommand("/api/position-protection", {
    stopLossPrice: protectionValue("protection-stop-loss-input"),
    takeProfitPrice: protectionValue("protection-take-profit-input"),
    trailingStopPercent: trailingPercent === null ? null : trailingPercent / 100
  }, "protection-error", event.currentTarget);
});
byId("protection-clear").addEventListener("click", (event) => {
  byId("protection-stop-loss-input").value = "";
  byId("protection-take-profit-input").value = "";
  byId("protection-trailing-input").value = "";
  submitCommand("/api/position-protection", { stopLossPrice: null, takeProfitPrice: null, trailingStopPercent: null }, "protection-error", event.currentTarget);
});

// Not part of the periodic refresh() cycle -- an on-demand action (real network fetch to
// Upbit + a backtest run), triggered only by this button, not hammered every 5s like everything else.
byId("backtest-run").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const errorElement = byId("backtest-error");
  errorElement.textContent = "";
  button.disabled = true;
  const loadingRow = document.createElement("tr");
  const loadingCell = textNode("td", "실행 중...");
  loadingCell.colSpan = 7;
  loadingRow.append(loadingCell);
  byId("backtest-results").replaceChildren(loadingRow);
  try {
    const { results } = await fetchJson("/api/backtest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: byId("backtest-unit").value })
    });
    renderBacktestResults(results);
  } catch (error) {
    errorElement.textContent = error.message;
    loadingCell.textContent = "실행 버튼을 눌러주세요";
  } finally {
    button.disabled = false;
  }
});

byId("champion-reset").addEventListener("click", (event) => submitCommand("/api/champion/reset", undefined, "champion-error", event.currentTarget));

const TAB_STORAGE_KEY = "dokkaebi-active-tab";
const TAB_NAMES = ["trading", "performance", "audit"];

function activateTab(tab) {
  if (!TAB_NAMES.includes(tab)) tab = "trading";
  document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.dataset.tab !== tab; });
  document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch {
    // Storage can be unavailable (e.g. private browsing); the tab still switches, it just won't persist.
  }
}
document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
let savedTab = null;
try { savedTab = localStorage.getItem(TAB_STORAGE_KEY); } catch {
  // Same as above -- fall through to the "trading" default.
}
activateTab(savedTab ?? "trading");

window.addEventListener("beforeunload", () => clearTimeout(refreshTimer));
refresh();
