const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const byId = (id) => document.getElementById(id);
let lastPrice = 0;
const chartPoints = [];
const focusModeStorageKey = "dokkaebi.focus-mode";

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

function readStoredFocusMode() {
  try {
    return window.localStorage.getItem(focusModeStorageKey) === "true";
  } catch {
    return false;
  }
}

function storeFocusMode(enabled) {
  try {
    window.localStorage.setItem(focusModeStorageKey, String(enabled));
  } catch {
    // Focus mode remains available for the current session when storage is unavailable.
  }
}

function setFocusMode(enabled, { persist = true } = {}) {
  document.body.classList.toggle("focus-mode", enabled);
  const button = byId("focus-mode");
  const label = byId("focus-mode-label");
  const hint = byId("focus-hint");
  button.setAttribute("aria-pressed", String(enabled));
  button.setAttribute("aria-label", enabled ? "집중 모드 끄기" : "집중 모드 켜기");
  label.textContent = enabled ? "전체 보기" : "집중 모드";
  hint.hidden = !enabled;
  if (persist) storeFocusMode(enabled);
  if (!enabled) window.requestAnimationFrame(drawChart);
}

function toggleFocusMode() {
  setFocusMode(!document.body.classList.contains("focus-mode"));
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
byId("focus-mode").addEventListener("click", toggleFocusMode);
window.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (!editing && event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    toggleFocusMode();
  }
});
setFocusMode(readStoredFocusMode(), { persist: false });

function focusPanel(id) {
  const element = byId(id);
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
  element?.focus?.();
}

let commandPalette;
commandPalette = window.DokkaebiCommandPalette.create({
  document,
  storage: window.localStorage,
  commands: () => {
    const recent = commandPalette?.recent?.() || [];
    const commands = [
      { id: "focus", title: document.body.classList.contains("focus-mode") ? "집중 모드 끄기" : "집중 모드 켜기", keywords: ["집중", "focus"], hint: "화면", run: toggleFocusMode },
      { id: "start", title: "전략 시작", keywords: ["전략", "strategy", "start"], hint: "Paper", enabled: !byId("strategy-start").disabled, run: () => byId("strategy-start").click() },
      { id: "stop", title: "전략 중지", keywords: ["전략", "strategy", "stop"], hint: "Paper", enabled: !byId("strategy-stop").disabled, run: () => byId("strategy-stop").click() },
      { id: "auto", title: byId("auto-trade").checked ? "Paper 자동매매 끄기" : "Paper 자동매매 켜기", keywords: ["자동", "auto"], hint: "Paper only", run: () => byId("auto-trade").click() },
      { id: "order-quantity", title: "가상 주문 수량으로 이동", keywords: ["주문", "수량", "order"], hint: "입력", run: () => focusPanel("quantity") },
      { id: "strategy-quantity", title: "자동주문 수량으로 이동", keywords: ["자동", "수량", "strategy"], hint: "입력", run: () => focusPanel("strategy-quantity") },
      { id: "events", title: "최근 이벤트로 이동", keywords: ["이벤트", "events"], hint: "기록", run: () => focusPanel("events") },
      { id: "orders", title: "최근 체결로 이동", keywords: ["체결", "orders"], hint: "기록", run: () => focusPanel("orders") },
      { id: "details", title: "운영 상세로 이동", keywords: ["운영", "details"], hint: "읽기 전용", run: () => focusPanel("ai-cio-dashboard") },
      { id: "top", title: "화면 맨 위로 이동", keywords: ["위", "top"], hint: "탐색", run: () => window.scrollTo({ top: 0, behavior: "smooth" }) }
    ];
    return [...commands.filter((command) => recent.includes(command.id)), ...commands.filter((command) => !recent.includes(command.id))];
  }
});

Promise.all([window.dokkaebi.getSnapshot(), window.dokkaebi.getControlSnapshot()]).then(([paper, control]) => {
  renderSnapshot(paper);
  renderControl(control);
}).catch(() => {
  byId("error").textContent = "데이터를 가져오지 못했습니다. 잠시 후 다시 시도합니다.";
});

const cioPercent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "데이터 없음";
const cioMoney = (value) => Number.isFinite(value) ? won.format(value) : "데이터 없음";
const cioText = (id, value) => { byId(id).textContent = value; };
const cioSectionAvailable = (section) => section != null && (section.availability == null || section.availability === "AVAILABLE");
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
  byId("cio-portfolio").innerHTML = cioSectionAvailable(portfolio)
    ? `<div><dt>전체 자본</dt><dd>${cioMoney(portfolio.totalEquity)}</dd></div><div><dt>운용 가능</dt><dd>${cioMoney(portfolio.deployableCapital)}</dd></div><div><dt>출금 예약</dt><dd>${cioMoney(portfolio.reservedCapital)}</dd></div><div><dt>Gross / Net Exposure</dt><dd>${cioPercent(portfolio.grossExposureRatio)} / ${cioPercent(portfolio.netExposureRatio)}</dd></div>`
    : "<div><dt>전체 자본</dt><dd>데이터 없음</dd></div>";
  cioText("cio-opportunity", cioSectionAvailable(snapshot.opportunities) ? `활성 ${snapshot.opportunities.activeCount} · 배분 ${cioMoney(snapshot.opportunities.totalAllocatedCapital)}` : "데이터 없음");
  cioText("cio-strategy", cioSectionAvailable(snapshot.strategies) ? `거래 ${snapshot.strategies.totalTrades} · 차단 ${snapshot.strategies.blockedStrategies} · 경고 ${snapshot.strategies.warningStrategies}` : "데이터 없음");
  cioText("cio-committee", cioSectionAvailable(snapshot.committee) ? `${snapshot.committee.decision} · Confidence ${cioPercent(snapshot.committee.confidence)} · Edge ${cioPercent(snapshot.committee.edge)} · Risk ${cioPercent(snapshot.committee.risk)}` : "데이터 없음");
  cioText("cio-execution", cioSectionAvailable(snapshot.execution) ? `Fill ${cioPercent(snapshot.execution.fillQuality)} · Slippage ${snapshot.execution.slippageBps.toFixed(2)} bps · Latency ${snapshot.execution.latencyMs} ms` : "데이터 없음");
  cioText("cio-risk", cioSectionAvailable(snapshot.risk) ? `Drawdown ${cioPercent(snapshot.risk.dailyDrawdownRatio)} · Heat ${cioPercent(snapshot.risk.portfolioHeatRatio)} · Kill Switch ${snapshot.risk.killSwitchActive ? "ACTIVE" : "OFF"}` : "데이터 없음");
  cioText("cio-research", cioSectionAvailable(snapshot.research) ? `Walk-forward ${snapshot.research.walkForwardPassed ? "PASS" : "FAIL"} · Monte Carlo ${snapshot.research.monteCarloPassed ? "PASS" : "FAIL"} · Cost Stress ${snapshot.research.costStressPassed ? "PASS" : "FAIL"}` : "데이터 없음");
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
