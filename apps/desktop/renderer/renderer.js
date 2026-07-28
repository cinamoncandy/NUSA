const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const byId = (id) => document.getElementById(id);
const textNode = (tag, value, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
};
const renderWarnings = (target, warnings) => target.replaceChildren(...warnings.map((warning) => textNode("li", warning)));
const renderA4Rows = (title, rows) => {
  const section = document.createElement("section");
  section.append(textNode("h3", title));
  const list = document.createElement("dl");
  for (const [label, value] of rows) {
    const item = document.createElement("div");
    item.append(textNode("dt", label), textNode("dd", String(value)));
    list.append(item);
  }
  section.append(list);
  return section;
};
function renderA4Diagnostics(diagnostics) {
  const verdict = byId("a4-diagnostics-verdict");
  const grid = byId("a4-diagnostics-grid");
  if (!verdict || !grid) return;
  const bridgeMethods = typeof window.dokkaebi === "object" && window.dokkaebi
    ? Object.keys(window.dokkaebi).length
    : 0;
  const shadowBridge = typeof window.shadowPilot === "object" && window.shadowPilot;
  const bridgeConnected = bridgeMethods > 0 && Boolean(shadowBridge);
  verdict.textContent = bridgeConnected ? diagnostics.verdict : "BLOCKED";
  verdict.className = `a4-verdict ${bridgeConnected && diagnostics.verdict === "READY_FOR_OBSERVATION" ? "ready" : "blocked"}`;
  grid.hidden = false;
  grid.replaceChildren(
    renderA4Rows("Preload bridge", [
      ["window.dokkaebi", bridgeMethods > 0 ? "CONNECTED" : "MISSING"],
      ["window.shadowPilot", shadowBridge ? "CONNECTED" : "MISSING"],
      ["Exposed methods", bridgeMethods],
      ["Arbitrary IPC", "DISABLED"]
    ]),
    renderA4Rows("Deployment integrity", [
      ["Status", diagnostics.deployment.status],
      ["Verification", diagnostics.deployment.method],
      ["Strategy", diagnostics.shadow.strategyId],
      ["Market / interval", `${diagnostics.market.symbol} / ${diagnostics.market.interval}`],
      ["Market connection", diagnostics.market.connected ? "CONNECTED" : "DISCONNECTED"],
      ["Market freshness", diagnostics.market.fresh ? "FRESH" : "STALE / UNKNOWN"],
      ["Market source", diagnostics.market.source],
      ["Blockers", diagnostics.deployment.blockers.join(", ") || "None"]
    ]),
    renderA4Rows("Reconciliation", [
      ["Status", diagnostics.reconciliation.status],
      ["Blockers", diagnostics.reconciliation.blockers.join(", ") || "None"],
      ["Mutation counters", Object.entries(diagnostics.mutationCounters).map(([key, value]) => `${key}:${value}`).join(" ")]
    ]),
    renderA4Rows("Risk gate", [
      ["Status", diagnostics.riskGate.status],
      ["Fail-closed", "ACTIVE"],
      ["Live / private / credentials", "DISABLED / DISABLED / DISABLED"],
      ["Blockers", diagnostics.riskGate.blockers.join(", ") || "None"]
    ]),
    renderA4Rows("Safety state", [
      ["Kill Switch", diagnostics.safety.killSwitchActive ? "ACTIVE" : "INACTIVE"],
      ["Open P0 alerts", diagnostics.safety.openP0Count],
      ["P0 codes", diagnostics.safety.openP0Codes.join(", ") || "None"],
      ["Reason", diagnostics.safety.reasonCode || "None"],
      ["Activation source", diagnostics.safety.activationSource || "None"]
    ]),
    renderA4Rows("Shadow runtime", [
      ["State", diagnostics.shadow.state],
      ["Session", diagnostics.shadow.sessionId ? "PRESENT" : "NONE"],
      ["Recovery required", diagnostics.shadow.recoveryRequired ? "YES" : "NO"],
      ["Observation started", diagnostics.shadow.observationStarted ? "YES" : "NO"],
      ["Elapsed", `${diagnostics.shadow.elapsedMs} ms`],
      ["Queue depth / high water", `${diagnostics.shadow.queueDepth} / ${diagnostics.shadow.queueHighWaterMark}`],
      ["Duplicate / stale / out-of-order", `${diagnostics.shadow.duplicateCandleCount} / ${diagnostics.shadow.staleCandleCount} / ${diagnostics.shadow.outOfOrderCandleCount}`]
    ]),
    renderA4Rows("Evidence", [
      ["Root writable", diagnostics.evidence.rootWritable ? "YES" : "NO"],
      ["Markerless archives", diagnostics.evidence.markerlessArchiveCount],
      ["Active archive", diagnostics.evidence.activeArchivePresent ? "PRESENT" : "NONE"],
      ["Last verifier", diagnostics.evidence.lastVerifierResult],
      ["Completed marker", diagnostics.evidence.completedMarkerPresent ? "PRESENT" : "NONE"],
      ["Evidence bus", diagnostics.evidence.busStatus]
    ]),
    renderA4Rows("Decision", [
      ["Shadow start precheck", diagnostics.startPrecheckBlockers.join(", ") || "PASS"],
      ["Blockers", diagnostics.blockers.join(", ") || "None"]
    ])
  );
}
byId("run-a4-diagnostics")?.addEventListener("click", async () => {
  const button = byId("run-a4-diagnostics");
  const error = byId("a4-diagnostics-error");
  if (button) button.disabled = true;
  if (error) error.textContent = "";
  try {
    renderA4Diagnostics(await window.dokkaebi.getA4Diagnostics());
  } catch {
    if (error) error.textContent = "Diagnostics unavailable. No runtime action was attempted.";
    const verdict = byId("a4-diagnostics-verdict");
    if (verdict) { verdict.textContent = "ERROR"; verdict.className = "a4-verdict blocked"; }
  } finally {
    if (button) button.disabled = false;
  }
});
/*
 * Recovery reconciliation and owner review (WO-0034-A4H).
 *
 * The renderer decides nothing here. It shows the status the main process reports and
 * enables the approve control on `approvalAllowed` alone -- which the main process sets only
 * for a MATCHED comparison. Re-deriving "looks matched to me" in the renderer would put a
 * second, weaker opinion next to the authoritative one.
 *
 * Approving does not complete the recovery. Two separate controls, two separate decisions.
 */
const RECOVERY_VERDICT_TEXT = {
  NOT_RUN: "아직 대조하지 않았습니다.",
  MATCHED: "일치 — 소유자 검토를 진행할 수 있습니다.",
  MISMATCHED: "불일치 — 아래 항목을 해결해야 합니다.",
  ERROR: "대조 불가 — 비교 자체를 수행하지 못했습니다."
};

function renderRecoveryReview(status) {
  const verdict = byId("recovery-review-verdict");
  const grid = byId("recovery-review-grid");
  const approve = byId("approve-recovery-review");
  const complete = byId("complete-recovery");
  if (!verdict || !grid) return;

  verdict.textContent = RECOVERY_VERDICT_TEXT[status.reconciliation] ?? status.reconciliation;
  // MATCHED is not "ready": it only means the approval step may begin. The gate is what
  // reports readiness, and it stays blocked until completion actually succeeds.
  verdict.className = `a4-verdict ${status.gate === "CLEAR" ? "ready" : status.reconciliation === "MATCHED" ? "neutral" : "blocked"}`;

  grid.hidden = false;
  grid.replaceChildren(
    renderA4Rows("대조 결과", [
      ["상태", status.reconciliation],
      ["복구 기록", status.recoveryRecordId ?? "없음"],
      ["확인 시각", status.checkedAt === null ? "-" : new Date(status.checkedAt).toLocaleString("ko-KR")],
      // Shown truncated: it identifies the comparison, and the full digest adds nothing a
      // reader can act on.
      ["대조 지문", status.fingerprint === null ? "-" : `${status.fingerprint.slice(0, 12)}…`]
    ]),
    renderA4Rows("불일치 항목", status.mismatchCodes.length > 0
      ? status.mismatchCodes.map((code) => [code, "해결 필요"])
      : [["없음", "-"]]),
    renderA4Rows("대조 불가 사유", status.errorCodes.length > 0
      ? status.errorCodes.map((code) => [code, "확인 필요"])
      : [["없음", "-"]]),
    renderA4Rows("소유자 검토", [
      ["승인 여부", status.ownerApproved ? "승인됨" : "미승인"],
      // A stale approval is called out rather than quietly ignored: the owner did approve,
      // and the honest statement is that the state moved afterwards.
      ["승인 유효성", status.approvalStale ? "무효 — 승인 후 상태가 바뀜" : status.ownerApproved ? "유효" : "-"],
      ["복구 게이트", status.gate === "CLEAR" ? "해제됨" : "차단됨"]
    ])
  );

  if (approve) approve.disabled = !status.approvalAllowed || status.ownerApproved;
  if (complete) complete.disabled = !(status.ownerApproved && status.reconciliation === "MATCHED") || status.gate === "CLEAR";
}

const recoveryError = (message) => {
  const error = byId("recovery-review-error");
  if (error) error.textContent = message;
};

/*
 * The last status the main process reported. Kept so a finished request can restore the
 * controls to what that status permits, rather than to "enabled".
 */
let lastRecoveryStatus = null;

/*
 * Each control disables itself while in flight: these are not retried, so a double click
 * must not become a second recorded comparison or a second approval attempt.
 *
 * On completion the controls are restored from the reported status, NOT simply re-enabled.
 * Blanket re-enabling in a `finally` would hand back an approve button after the approval
 * had already been recorded, and a complete button after the gate had already cleared --
 * making a second attempt one click away from an operator who had every reason to think the
 * step was done.
 */
const restoreRecoveryControls = () => {
  const reconcile = byId("run-recovery-reconcile");
  // Re-running the comparison is always allowed: it is read-only and re-reads live state.
  if (reconcile) reconcile.disabled = false;
  if (lastRecoveryStatus) renderRecoveryReview(lastRecoveryStatus);
};

const wireRecoveryButton = (id, run) => {
  const button = byId(id);
  if (!button) return;
  button.addEventListener("click", async () => {
    if (!window.recoveryReview) { recoveryError("복구 검토 기능을 사용할 수 없습니다. 어떤 동작도 수행하지 않았습니다."); return; }
    button.disabled = true;
    recoveryError("");
    try {
      lastRecoveryStatus = await run();
    } catch (error) {
      // The refusal reason is the useful part and it is generated by the main process, never
      // by the renderer -- so it cannot report a success the main process did not grant.
      recoveryError(error && error.message ? String(error.message) : "요청이 거부되었습니다. 어떤 상태도 변경되지 않았습니다.");
      try { lastRecoveryStatus = await window.recoveryReview.status(); } catch { /* status read failed; leave the message shown */ }
    } finally {
      restoreRecoveryControls();
    }
  });
};

wireRecoveryButton("run-recovery-reconcile", () => window.recoveryReview.reconcile());
wireRecoveryButton("approve-recovery-review", () => window.recoveryReview.ownerReview());
wireRecoveryButton("complete-recovery", () => window.recoveryReview.complete());

const renderPortfolio = (portfolio, available) => {
  const entries = available
    ? [["Total equity", cioMoney(portfolio.totalEquity)], ["Available", cioMoney(portfolio.deployableCapital)], ["Reserved", cioMoney(portfolio.reservedCapital)], ["Gross / Net Exposure", `${cioPercent(portfolio.grossExposureRatio)} / ${cioPercent(portfolio.netExposureRatio)}`]]
    : [["Total equity", "No data"]];
  byId("cio-portfolio").replaceChildren(...entries.map(([label, value]) => {
    const item = document.createElement("div");
    item.append(textNode("dt", label), textNode("dd", value));
    return item;
  }));
};
let lastPrice = 0;
const chartPoints = [];
const focusModeStorageKey = "dokkaebi.focus-mode";

/*
 * Control room mount, declared before renderControl runs so the panel is always available
 * to it. `window.shadowPilot` only exists once the preload bridge exposes it, so the panel
 * degrades to a plain status readout rather than throwing when Shadow control is absent.
 */
const controlRoom = (() => {
  const root = byId("control-room");
  if (!root || !window.DokkaebiControlRoom) return null;
  return window.DokkaebiControlRoom.createControlRoom({ root, document, shadowPilot: window.shadowPilot || null });
})();
let controlRoomTimer;
function scheduleControlRoomRefresh() {
  clearTimeout(controlRoomTimer);
  controlRoomTimer = setTimeout(async () => {
    await controlRoom?.refresh();
    scheduleControlRoomRefresh();
  }, 5_000);
}
if (controlRoom) {
  controlRoom.refresh();
  scheduleControlRoomRefresh();
  window.addEventListener("beforeunload", () => clearTimeout(controlRoomTimer));
}

function renderSnapshot(snapshot) {
  if (!snapshot) return;
  byId("equity").textContent = won.format(snapshot.equity);
  byId("cash").textContent = won.format(snapshot.cash);
  byId("position").textContent = `${number.format(snapshot.position.quantity)} BTC`;
  byId("average").textContent = snapshot.position.averagePrice ? won.format(snapshot.position.averagePrice) : "-";
  byId("unrealized").textContent = won.format(snapshot.unrealizedPnl);
  byId("realized").textContent = won.format(snapshot.position.realizedPnl);
  const orders = byId("orders");
  if (!snapshot.orders.length) {
    const row = document.createElement("tr");
    const cell = textNode("td", "No fills");
    cell.colSpan = 6;
    row.append(cell);
    orders.replaceChildren(row);
  } else orders.replaceChildren(...snapshot.orders.map((order) => {
    const row = document.createElement("tr");
    const executionCost = (order.spreadCost ?? 0) + (order.slippageCost ?? 0) + (order.marketImpactCost ?? 0);
    row.append(textNode("td", new Date(order.filledAt).toLocaleTimeString("ko-KR")), textNode("td", order.side, order.side.toLowerCase()), textNode("td", number.format(order.quantity)), textNode("td", won.format(order.price)), textNode("td", won.format(order.fee)), textNode("td", won.format(executionCost)));
    return row;
  }));
}

function renderControl(snapshot) {
  if (!snapshot) return;
  byId("strategy-status").textContent = snapshot.status;
  byId("strategy-id").textContent = snapshot.strategyId;
  byId("auto-trade").checked = snapshot.autoTradeEnabled;
  byId("strategy-quantity").value = String(snapshot.orderQuantity);
  byId("strategy-start").disabled = snapshot.status === "RUNNING";
  byId("strategy-stop").disabled = snapshot.status === "STOPPED";
  controlRoom?.setControlSnapshot(snapshot);
  const events = byId("events");
  if (!snapshot.events.length) events.replaceChildren(textNode("li", "No events"));
  else events.replaceChildren(...snapshot.events.slice(0, 30).map((event) => {
    const item = document.createElement("li");
    item.append(textNode("time", new Date(event.timestamp).toLocaleTimeString("ko-KR")), textNode("strong", event.type), textNode("span", event.message));
    return item;
  }));
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
  if (button) {
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "집중 모드 끄기" : "집중 모드 켜기");
  }
  if (label) label.textContent = enabled ? "전체 보기" : "집중 모드";
  if (hint) hint.hidden = !enabled;
  if (persist) storeFocusMode(enabled);
  if (!enabled) window.requestAnimationFrame(drawChart);
}

function toggleFocusMode() {
  setFocusMode(!document.body.classList.contains("focus-mode"));
}

window.dokkaebi.onStatus((status) => {
  byId("status").textContent = status === "connected" ? "Upbit 연결됨" : status;
  byId("status").classList.toggle("online", status === "connected");
  controlRoom?.setMarketStatus(status);
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
byId("focus-mode")?.addEventListener("click", toggleFocusMode);
window.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (!editing && event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    toggleFocusMode();
  }
});
setFocusMode(readStoredFocusMode(), { persist: false });

function focusElement(id) {
  const element = byId(id);
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
  element?.focus?.();
}

const commandPalette = window.DokkaebiCommandPalette.createCommandPalette({
  document,
  storage: window.localStorage,
  commands: () => {
    const running = !byId("strategy-start").disabled;
    const stopped = !byId("strategy-stop").disabled;
    const autoTrade = byId("auto-trade").checked;
    const commands = [
      { id: "toggle-focus", title: document.body.classList.contains("focus-mode") ? "집중 모드 끄기" : "집중 모드 켜기", keywords: ["집중", "focus"], hint: "화면 집중", run: toggleFocusMode },
      { id: "start-strategy", title: "전략 시작", keywords: ["전략", "strategy", "start"], hint: "Paper 전략", enabled: running, run: () => byId("strategy-start").click() },
      { id: "stop-strategy", title: "전략 중지", keywords: ["전략", "strategy", "stop"], hint: "Paper 전략", enabled: stopped, run: () => byId("strategy-stop").click() },
      { id: "toggle-auto-trade", title: autoTrade ? "Paper 자동매매 끄기" : "Paper 자동매매 켜기", keywords: ["자동", "auto", "paper"], hint: "Paper only", run: () => byId("auto-trade").click() },
      { id: "focus-order-quantity", title: "가상 주문 수량으로 이동", keywords: ["주문", "수량", "order", "quantity"], hint: "입력", run: () => focusElement("quantity") },
      { id: "focus-strategy-quantity", title: "자동주문 수량으로 이동", keywords: ["자동", "수량", "strategy", "quantity"], hint: "입력", run: () => focusElement("strategy-quantity") },
      { id: "focus-events", title: "최근 이벤트로 이동", keywords: ["이벤트", "events"], hint: "기록", run: () => focusElement("events") },
      { id: "focus-orders", title: "최근 체결로 이동", keywords: ["체결", "orders", "fills"], hint: "기록", run: () => focusElement("orders") },
      { id: "focus-operations", title: "운영 상세로 이동", keywords: ["운영", "details", "control"], hint: "제어", run: () => focusElement("operations-detail") },
      { id: "scroll-top", title: "화면 맨 위로 이동", keywords: ["위", "top", "home"], hint: "탐색", run: () => window.scrollTo({ top: 0, behavior: "smooth" }) }
    ];
    const recent = commandPalette?.recent?.() || [];
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
  renderPortfolio(undefined, false);
  renderWarnings(byId("cio-warnings"), [blocked ? "Dashboard unavailable" : "Dashboard 데이터 없음"]);
}

function renderCioDashboard(envelope) {
  const snapshot = envelope.snapshot;
  const statusNode = byId("cio-status");
  statusNode.textContent = snapshot.status;
  statusNode.className = `cio-status ${snapshot.status.toLowerCase().replace("_", "-")}`;
  cioText("cio-freshness", `마지막 갱신 ${new Date(envelope.generatedAt).toLocaleString("ko-KR")} · ${envelope.mode} · 읽기 전용`);
  cioText("cio-system", `${snapshot.status} · 자동 실행 ${snapshot.tradingPermitted ? "PAPER 허용" : "차단"}`);
  const portfolio = snapshot.portfolio;
  renderPortfolio(portfolio, cioSectionAvailable(portfolio));
  cioText("cio-opportunity", cioSectionAvailable(snapshot.opportunities) ? `활성 ${snapshot.opportunities.activeCount} · 배분 ${cioMoney(snapshot.opportunities.totalAllocatedCapital)}` : "데이터 없음");
  cioText("cio-strategy", cioSectionAvailable(snapshot.strategies) ? `거래 ${snapshot.strategies.totalTrades} · 차단 ${snapshot.strategies.blockedStrategies} · 경고 ${snapshot.strategies.warningStrategies}` : "데이터 없음");
  cioText("cio-committee", cioSectionAvailable(snapshot.committee) ? `${snapshot.committee.decision} · Confidence ${cioPercent(snapshot.committee.confidence)} · Edge ${cioPercent(snapshot.committee.edge)} · Risk ${cioPercent(snapshot.committee.risk)}` : "데이터 없음");
  cioText("cio-execution", cioSectionAvailable(snapshot.execution) ? `Fill ${cioPercent(snapshot.execution.fillQuality)} · Slippage ${snapshot.execution.slippageBps.toFixed(2)} bps · Latency ${snapshot.execution.latencyMs} ms` : "데이터 없음");
  cioText("cio-risk", cioSectionAvailable(snapshot.risk) ? `Drawdown ${cioPercent(snapshot.risk.dailyDrawdownRatio)} · Heat ${cioPercent(snapshot.risk.portfolioHeatRatio)} · Kill Switch ${snapshot.risk.killSwitchActive ? "ACTIVE" : "OFF"}` : "데이터 없음");
  cioText("cio-research", cioSectionAvailable(snapshot.research) ? `Walk-forward ${snapshot.research.walkForwardPassed ? "PASS" : "FAIL"} · Monte Carlo ${snapshot.research.monteCarloPassed ? "PASS" : "FAIL"} · Cost Stress ${snapshot.research.costStressPassed ? "PASS" : "FAIL"}` : "데이터 없음");
  renderWarnings(byId("cio-warnings"), snapshot.warnings.length ? snapshot.warnings : ["경고 없음"]);
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
