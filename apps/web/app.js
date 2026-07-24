const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const byId = (id) => document.getElementById(id);
const textNode = (tag, value, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
};

async function fetchJson(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `request failed: ${response.status}`);
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
    ctx.strokeStyle = ctx.fillStyle = up ? "#33c07f" : "#e0524d";
    ctx.beginPath();
    ctx.moveTo(x, y(candle.high));
    ctx.lineTo(x, y(candle.low));
    ctx.stroke();
    const top = y(Math.max(candle.open, candle.close));
    const bodyHeight = Math.max(1, Math.abs(y(candle.open) - y(candle.close)));
    ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
  });
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
  } else orders.replaceChildren(...account.orders.map((order) => {
    const row = document.createElement("tr");
    const executionCost = (order.spreadCost ?? 0) + (order.slippageCost ?? 0) + (order.marketImpactCost ?? 0);
    row.append(
      textNode("td", new Date(order.filledAt).toLocaleTimeString("ko-KR")),
      textNode("td", order.side, order.side.toLowerCase()),
      textNode("td", number.format(order.quantity)),
      textNode("td", won.format(order.price)),
      textNode("td", won.format(order.fee)),
      textNode("td", won.format(executionCost))
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
  byId("strategy-status").textContent = control.status;
  byId("strategy-id").textContent = control.activeStrategyId;
  byId("strategy-select").value = control.activeStrategyId;
  byId("auto-trade").checked = control.autoTradeEnabled;
  byId("strategy-quantity").value = String(control.orderQuantity);
  byId("strategy-start").disabled = control.status === "RUNNING";
  byId("strategy-stop").disabled = control.status === "STOPPED";
}

const MAX_EVENT_ROWS = 30;

function renderEvents(events) {
  const tbody = byId("events");
  if (!events.length) {
    const row = document.createElement("tr");
    const cell = textNode("td", "이벤트 없음");
    cell.colSpan = 3;
    tbody.replaceChildren(row);
    row.append(cell);
    return;
  }
  tbody.replaceChildren(...events.slice(0, MAX_EVENT_ROWS).map((event) => {
    const row = document.createElement("tr");
    if (event.type === "RISK") row.className = "event-row-risk";
    const typeCell = document.createElement("td");
    typeCell.append(textNode("span", event.type, `event-type ${event.type.toLowerCase()}`));
    row.append(textNode("td", new Date(event.timestamp).toLocaleTimeString("ko-KR")), typeCell, textNode("td", event.message));
    return row;
  }));
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
      Object.assign(textNode("span", section.status ?? section.availability ?? "NO_DATA", `cio-badge ${badgeClass}`), {}),
      ...(section.reasons && section.reasons.length ? [textNode("p", section.reasons.join(", "))] : [])
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
    const control = await fetchJson("/api/control");
    renderControl(control);
    renderEvents(control.events);
    try {
      renderAccount(await fetchJson("/api/account"));
      renderDashboard(await fetchJson("/api/dashboard"));
      renderReferenceAccounting(await fetchJson("/api/reference-accounting"));
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

async function submitCommand(path, body, errorElementId) {
  const errorElement = byId(errorElementId);
  errorElement.textContent = "";
  try {
    await fetchJson(path, body === undefined ? { method: "POST" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await refresh();
  } catch (error) {
    errorElement.textContent = error.message;
  }
}

byId("strategy-start").addEventListener("click", () => submitCommand("/api/strategy/start", undefined, "control-error"));
byId("strategy-stop").addEventListener("click", () => submitCommand("/api/strategy/stop", undefined, "control-error"));
byId("auto-trade").addEventListener("change", (event) => submitCommand("/api/strategy/auto-trade", { enabled: event.target.checked }, "control-error"));
byId("strategy-quantity").addEventListener("change", (event) => submitCommand("/api/strategy/quantity", { quantity: Number(event.target.value) }, "control-error"));
byId("strategy-select").addEventListener("change", (event) => submitCommand("/api/strategy/select", { choice: event.target.value }, "control-error"));
byId("buy").addEventListener("click", () => submitCommand("/api/orders", { side: "BUY", quantity: Number(byId("order-quantity").value) }, "order-error"));
byId("sell").addEventListener("click", () => submitCommand("/api/orders", { side: "SELL", quantity: Number(byId("order-quantity").value) }, "order-error"));

window.addEventListener("beforeunload", () => clearTimeout(refreshTimer));
refresh();
