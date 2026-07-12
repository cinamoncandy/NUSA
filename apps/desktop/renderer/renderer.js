const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const byId = (id) => document.getElementById(id);
let lastPrice = 0;
const chartPoints = [];

function renderSnapshot(snapshot) {
  if (!snapshot) return;
  byId("equity").textContent = won.format(snapshot.equity);
  byId("cash").textContent = won.format(snapshot.cash);
  byId("position").textContent = `${number.format(snapshot.position.quantity)} BTC`;
  byId("average").textContent = snapshot.position.averagePrice ? won.format(snapshot.position.averagePrice) : "-";
  byId("unrealized").textContent = won.format(snapshot.unrealizedPnl);
  byId("realized").textContent = won.format(snapshot.position.realizedPnl);
  byId("orders").innerHTML = snapshot.orders.length
    ? snapshot.orders.map((order) => `<tr><td>${new Date(order.filledAt).toLocaleTimeString("ko-KR")}</td><td class="${order.side.toLowerCase()}">${order.side}</td><td>${number.format(order.quantity)}</td><td>${won.format(order.price)}</td><td>${won.format(order.fee)}</td></tr>`).join("")
    : '<tr><td colspan="5">체결 없음</td></tr>';
}

function renderControl(snapshot) {
  if (!snapshot) return;
  byId("strategy-status").textContent = snapshot.status;
  byId("strategy-id").textContent = snapshot.strategyId;
  byId("auto-trade").checked = snapshot.autoTradeEnabled;
  byId("strategy-quantity").value = String(snapshot.orderQuantity);
  byId("strategy-start").disabled = snapshot.status === "RUNNING";
  byId("strategy-stop").disabled = snapshot.status === "STOPPED";
  byId("events").innerHTML = snapshot.events.length
    ? snapshot.events.slice(0, 30).map((event) => `<li><time>${new Date(event.timestamp).toLocaleTimeString("ko-KR")}</time><strong>${event.type}</strong><span>${event.message}</span></li>`).join("")
    : "<li>이벤트 없음</li>";
}

function drawChart() {
  const canvas = byId("chart");
  const context = canvas.getContext("2d");
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (chartPoints.length < 2) return;
  const values = chartPoints.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const padding = 18;
  context.beginPath();
  chartPoints.forEach((point, index) => {
    const x = padding + (index / (chartPoints.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.value - min) / range) * (height - padding * 2);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.lineWidth = 2;
  context.strokeStyle = "#8f7cff";
  context.stroke();
}

window.dokkaebi.onStatus((status) => {
  byId("status").textContent = status === "connected" ? "Upbit 연결됨" : status;
  byId("status").classList.toggle("online", status === "connected");
});
window.dokkaebi.onTicker((ticker) => {
  lastPrice = ticker.trade_price;
  byId("price").textContent = won.format(lastPrice);
  byId("change").textContent = ticker.signed_change_rate == null ? "실시간" : `${(ticker.signed_change_rate * 100).toFixed(2)}%`;
});
window.dokkaebi.onSnapshot(renderSnapshot);
window.dokkaebi.onControl(renderControl);
window.dokkaebi.onChartPoint((point) => {
  chartPoints.push(point);
  if (chartPoints.length > 240) chartPoints.splice(0, chartPoints.length - 240);
  drawChart();
});
window.addEventListener("resize", drawChart);

async function order(side) {
  byId("error").textContent = "";
  const quantity = Number(byId("quantity").value);
  if (!Number.isFinite(quantity) || quantity <= 0) { byId("error").textContent = "올바른 수량을 입력하세요."; return; }
  if (!lastPrice) { byId("error").textContent = "시세 연결을 기다려 주세요."; return; }
  try { renderSnapshot((await window.dokkaebi.placeOrder(side, quantity)).snapshot); }
  catch (error) { byId("error").textContent = error instanceof Error ? error.message : String(error); }
}

byId("buy").addEventListener("click", () => order("BUY"));
byId("sell").addEventListener("click", () => order("SELL"));
byId("strategy-start").addEventListener("click", async () => renderControl(await window.dokkaebi.startStrategy()));
byId("strategy-stop").addEventListener("click", async () => renderControl(await window.dokkaebi.stopStrategy()));
byId("auto-trade").addEventListener("change", async (event) => {
  try { renderControl(await window.dokkaebi.setAutoTrade(event.target.checked)); }
  catch (error) { event.target.checked = false; byId("error").textContent = error instanceof Error ? error.message : String(error); }
});
byId("strategy-quantity").addEventListener("change", async (event) => {
  const quantity = Number(event.target.value);
  try { renderControl(await window.dokkaebi.setStrategyQuantity(quantity)); }
  catch (error) { byId("error").textContent = error instanceof Error ? error.message : String(error); }
});

Promise.all([window.dokkaebi.getSnapshot(), window.dokkaebi.getControlSnapshot()]).then(([paper, control]) => {
  renderSnapshot(paper);
  renderControl(control);
});


const cioPercent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "데이터 없음";
const cioMoney = (value) => Number.isFinite(value) ? won.format(value) : "데이터 없음";
const cioText = (id, value) => { byId(id).textContent = value; };
let cioRefreshTimer;
let cioRefreshInFlight = false;
let cioRefreshStopped = false;
let cioRefreshDelayMs = 5_000;

function renderCioUnavailable(status) {
  const blocked = status === "UNAVAILABLE";
  const label = blocked ? "BLOCKED" : "NO_DATA";
  const statusNode = byId("cio-status");
  statusNode.textContent = label;
  statusNode.className = `cio-status ${blocked ? "blocked" : "no-data"}`;
  cioText("cio-freshness", blocked ? "Dashboard 조회 실패 · 이전 상태는 유효하지 않음" : "Dashboard 데이터 없음");
  for (const id of ["cio-system", "cio-opportunity", "cio-strategy", "cio-committee", "cio-execution", "cio-risk", "cio-research"]) cioText(id, "데이터 없음");
  byId("cio-portfolio").innerHTML = "<div><dt>전체 자본</dt><dd>데이터 없음</dd></div>";
  byId("cio-warnings").innerHTML = `<li>${blocked ? "Dashboard unavailable" : "Dashboard 데이터 없음"}</li>`;
}

function renderCioDashboard(envelope) {
  const snapshot = envelope.snapshot;
  const statusNode = byId("cio-status");
  statusNode.textContent = snapshot.status;
  statusNode.className = `cio-status ${snapshot.status.toLowerCase().replace("_", "-")}`;
  cioText("cio-freshness", `마지막 갱신 ${new Date(envelope.generatedAt).toLocaleString("ko-KR")} · ${envelope.mode} · 읽기 전용`);
  cioText("cio-system", `${snapshot.status} · 자동 실행 ${snapshot.tradingPermitted ? "PAPER 허용" : "차단"}`);
  const portfolio = snapshot.portfolio;
  byId("cio-portfolio").innerHTML = `<div><dt>전체 자본</dt><dd>${cioMoney(portfolio?.totalEquity)}</dd></div><div><dt>운용 가능</dt><dd>${cioMoney(portfolio?.deployableCapital)}</dd></div><div><dt>출금 예약</dt><dd>${cioMoney(portfolio?.reservedCapital)}</dd></div><div><dt>Gross / Net Exposure</dt><dd>${cioPercent(portfolio?.grossExposureRatio)} / ${cioPercent(portfolio?.netExposureRatio)}</dd></div>`;
  cioText("cio-opportunity", snapshot.opportunities ? `활성 ${snapshot.opportunities.activeCount} · 배분 ${cioMoney(snapshot.opportunities.totalAllocatedCapital)}` : "데이터 없음");
  cioText("cio-strategy", snapshot.strategies ? `거래 ${snapshot.strategies.totalTrades} · 차단 ${snapshot.strategies.blockedStrategies} · 경고 ${snapshot.strategies.warningStrategies}` : "데이터 없음");
  cioText("cio-committee", snapshot.committee ? `${snapshot.committee.decision} · Confidence ${cioPercent(snapshot.committee.confidence)} · Edge ${cioPercent(snapshot.committee.edge)} · Risk ${cioPercent(snapshot.committee.risk)}` : "데이터 없음");
  cioText("cio-execution", snapshot.execution ? `Fill ${cioPercent(snapshot.execution.fillQuality)} · Slippage ${snapshot.execution.slippageBps.toFixed(2)} bps · Latency ${snapshot.execution.latencyMs} ms` : "데이터 없음");
  cioText("cio-risk", snapshot.risk ? `Drawdown ${cioPercent(snapshot.risk.dailyDrawdownRatio)} · Heat ${cioPercent(snapshot.risk.portfolioHeatRatio)} · Kill Switch ${snapshot.risk.killSwitchActive ? "ACTIVE" : "OFF"}` : "데이터 없음");
  cioText("cio-research", snapshot.research ? `Walk-forward ${snapshot.research.walkForwardPassed ? "PASS" : "FAIL"} · Monte Carlo ${snapshot.research.monteCarloPassed ? "PASS" : "FAIL"} · Cost Stress ${snapshot.research.costStressPassed ? "PASS" : "FAIL"}` : "데이터 없음");
  const list = byId("cio-warnings");
  list.replaceChildren(...(snapshot.warnings.length ? snapshot.warnings : ["경고 없음"]).map((warning) => { const item = document.createElement("li"); item.textContent = warning; return item; }));
}

function scheduleCioRefresh() {
  if (cioRefreshStopped) return;
  clearTimeout(cioRefreshTimer);
  cioRefreshTimer = setTimeout(refreshCioDashboard, cioRefreshDelayMs);
}

async function refreshCioDashboard() {
  if (cioRefreshInFlight || cioRefreshStopped) return;
  cioRefreshInFlight = true;
  try {
    const result = await window.aiCioDashboard.getAiCioDashboard();
    if (result.ok) {
      renderCioDashboard(result.snapshot);
      cioRefreshDelayMs = 5_000;
    } else {
      renderCioUnavailable(result.status);
      cioRefreshDelayMs = Math.min(30_000, cioRefreshDelayMs * 2);
    }
  } catch {
    renderCioUnavailable("UNAVAILABLE");
    cioRefreshDelayMs = Math.min(30_000, cioRefreshDelayMs * 2);
  } finally {
    cioRefreshInFlight = false;
    scheduleCioRefresh();
  }
}

window.addEventListener("beforeunload", () => {
  cioRefreshStopped = true;
  clearTimeout(cioRefreshTimer);
});
refreshCioDashboard();
