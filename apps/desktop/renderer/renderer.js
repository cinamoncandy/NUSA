const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const byId = (id) => document.getElementById(id);
/**
 * Canvas's strokeStyle and SVG's stroke attribute cannot consume `var(--token)` directly the way
 * CSS properties can, so a chart drawn with either API needs a resolved value. Reading it here
 * at draw time (rather than hardcoding a literal) keeps the chart following tokens.css --
 * DESIGN_SYSTEM.md's rule against literal colors applies to these draw calls too, and a literal
 * here was previously invisible to design-tokens.test.js because that test only checks that
 * tokens.css defines the expected tokens, not that renderer code avoids bypassing them.
 */
const resolveColorToken = (name, fallback) => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : fallback;
};
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
function renderA4Diagnostics(diagnostics, operationsSnapshot = null) {
  const verdict = byId("a4-diagnostics-verdict");
  const grid = byId("a4-diagnostics-grid");
  if (!verdict || !grid) return;
  const bridgeMethods = typeof window.nusa === "object" && window.nusa
    ? Object.keys(window.nusa).length
    : 0;
  const shadowBridge = typeof window.shadowPilot === "object" && window.shadowPilot;
  const bridgeConnected = bridgeMethods > 0 && Boolean(shadowBridge);
  const marketConnection = diagnostics.shadow.marketConnection || {
    marketConnectionState: "DISCONNECTED",
    lastMarketMessageAt: null,
    reconnectAttempt: 0,
    lastSuccessfulReconnectAt: null,
    activeMarketListenerCount: 0,
    activeMarketSubscriptionCount: 0,
    reconnectTimerCount: 0,
    reconnectFailureReason: null
  };
  verdict.textContent = bridgeConnected ? diagnostics.verdict : "BLOCKED";
  verdict.className = `a4-verdict ${bridgeConnected && diagnostics.verdict === "READY_FOR_OBSERVATION" ? "ready" : "blocked"}`;
  grid.hidden = false;
  grid.replaceChildren(
    operationsSnapshot ? renderA4Rows("Operations snapshot", [
      ["Mode", operationsSnapshot.mode],
      ["Application", operationsSnapshot.applicationVersion],
      ["Market", operationsSnapshot.marketData?.status ?? "UNKNOWN"],
      ["Recovery", operationsSnapshot.recovery?.required ? "REQUIRED" : "CLEAR"],
      ["Reconciliation", operationsSnapshot.reconciliation?.status ?? "UNKNOWN"],
      ["Risk", operationsSnapshot.risk?.status ?? "UNKNOWN"],
      ["Live trading", operationsSnapshot.liveTradingDisabled ? "DISABLED" : "BLOCKED"],
      ["Production mutation", operationsSnapshot.productionMutationAllowed ? "ENABLED" : "DISABLED"]
    ]) : renderA4Rows("Operations snapshot", [["Status", "NOT LOADED"]]),
    renderA4Rows("Preload bridge", [
      ["window.nusa", bridgeMethods > 0 ? "CONNECTED" : "MISSING"],
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
    renderA4Rows("Crash recovery", [
      ["Recovery required", diagnostics.crashRecovery.recoveryRequired ? "YES" : "NO"],
      ["Previous run", diagnostics.crashRecovery.previousRunId || "None"],
      ["Previous session / state", `${diagnostics.crashRecovery.previousSessionId || "None"} / ${diagnostics.crashRecovery.previousSessionState || "None"}`],
      ["Recovery state", diagnostics.crashRecovery.recoveryState || "None"],
      ["Last normal Evidence", diagnostics.crashRecovery.lastEvidenceId || "None"],
      ["Detected at", diagnostics.crashRecovery.detectedAt || "None"],
      ["Reason", diagnostics.crashRecovery.reasonCodes.join(", ") || "None"],
      ["Fail-closed", diagnostics.crashRecovery.failClosed ? "ACTIVE" : "READY"]
    ]),
    renderA4Rows("Public market reconnect", [
      ["State", marketConnection.marketConnectionState],
      ["Last market message", marketConnection.lastMarketMessageAt || "None"],
      ["Reconnect", `${marketConnection.reconnectAttempt} attempts`],
      ["Last recovery", marketConnection.lastSuccessfulReconnectAt || "None"],
      ["Listeners / subscriptions / timers", `${marketConnection.activeMarketListenerCount} / ${marketConnection.activeMarketSubscriptionCount} / ${marketConnection.reconnectTimerCount}`],
      ["Failure", marketConnection.reconnectFailureReason || "None"]
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
    const preflightBlockers = await window.shadowPilot.preflight();
    const diagnostics = await window.nusa.getA4Diagnostics();
    const operationsSnapshot = await window.operations.snapshot();
    const reportedBlockers = diagnostics.startPrecheckBlockers;
    if (preflightBlockers.length !== reportedBlockers.length || preflightBlockers.some((blocker, index) => blocker !== reportedBlockers[index])) {
      throw new Error("shadow preflight and diagnostics disagree");
    }
    renderA4Diagnostics(diagnostics, operationsSnapshot);
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
const focusModeStorageKey = "nusa.focus-mode";

/*
 * Control room mount, declared before renderControl runs so the panel is always available
 * to it. `window.shadowPilot` only exists once the preload bridge exposes it, so the panel
 * degrades to a plain status readout rather than throwing when Shadow control is absent.
 */
const controlRoom = (() => {
  const root = byId("control-room");
  if (!root || !window.NUSAControlRoom) return null;
  return window.NUSAControlRoom.createControlRoom({ root, document, shadowPilot: window.shadowPilot || null });
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
  context.strokeStyle = resolveColorToken("--color-primary", "#8f7cff");
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

window.nusa.onStatus((status) => {
  byId("status").textContent = status === "connected" ? "Upbit 연결됨" : status;
  byId("status").classList.toggle("online", status === "connected");
  controlRoom?.setMarketStatus(status);
});
window.nusa.onTicker((ticker) => {
  lastPrice = ticker.trade_price;
  byId("price").textContent = won.format(lastPrice);
  byId("change").textContent = ticker.signed_change_rate == null ? "실시간" : `${(ticker.signed_change_rate * 100).toFixed(2)}%`;
});
window.nusa.onSnapshot(renderSnapshot);
window.nusa.onControl(renderControl);
window.nusa.onChartPoint((point) => {
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
  try { renderSnapshot((await window.nusa.placeOrder(side, quantity)).snapshot); }
  catch (error) { byId("error").textContent = error instanceof Error ? error.message : String(error); }
}

byId("buy").addEventListener("click", () => order("BUY"));
byId("sell").addEventListener("click", () => order("SELL"));

/**
 * WO-0019. The exact confirmation phrase is re-validated by the main process regardless of
 * what this reads here -- this client-side check exists only to give the operator an early,
 * readable error instead of a rejected IPC call.
 */
byId("kill-switch-release")?.addEventListener("click", async () => {
  const message = byId("kill-switch-message");
  const reason = byId("kill-switch-reason")?.value ?? "";
  const confirmationText = byId("kill-switch-confirm")?.value ?? "";
  try {
    const result = await window.nusa.releaseKillSwitch(confirmationText, reason);
    if (message) message.textContent = `Kill Switch ${result.killSwitchActive ? "ACTIVE" : "해제됨"}`;
  } catch (error) {
    if (message) message.textContent = error instanceof Error ? error.message : "Kill Switch를 해제하지 못했습니다.";
  }
});
byId("kill-switch-activate")?.addEventListener("click", async () => {
  const message = byId("kill-switch-message");
  const reason = byId("kill-switch-reason")?.value ?? "";
  try {
    const result = await window.nusa.activateKillSwitch(reason);
    if (message) message.textContent = `Kill Switch ${result.killSwitchActive ? "ACTIVE" : "해제됨"}`;
  } catch (error) {
    if (message) message.textContent = error instanceof Error ? error.message : "Kill Switch를 재활성화하지 못했습니다.";
  }
});
byId("strategy-start").addEventListener("click", async () => renderControl(await window.nusa.startStrategy()));
byId("strategy-stop").addEventListener("click", async () => renderControl(await window.nusa.stopStrategy()));
byId("auto-trade").addEventListener("change", async (event) => {
  try { renderControl(await window.nusa.setAutoTrade(event.target.checked)); }
  catch (error) { event.target.checked = false; byId("error").textContent = error instanceof Error ? error.message : String(error); }
});
byId("strategy-quantity").addEventListener("change", async (event) => {
  const quantity = Number(event.target.value);
  try { renderControl(await window.nusa.setStrategyQuantity(quantity)); }
  catch (error) { byId("error").textContent = error instanceof Error ? error.message : String(error); }
});
byId("ai-explain-signal")?.addEventListener("click", async () => {
  const button = byId("ai-explain-signal");
  const output = byId("ai-explain-output");
  const followup = byId("ai-followup");
  const followupAnswer = byId("ai-followup-answer");
  button.disabled = true;
  try {
    const result = await window.aiResearch.explainLatestSignal();
    output.textContent = result.explanation;
    output.hidden = false;
    followupAnswer.hidden = true;
    followupAnswer.textContent = "";
    followup.hidden = result.status !== "OK";
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
    output.hidden = false;
    followup.hidden = true;
  } finally {
    button.disabled = false;
  }
});
byId("ai-followup-ask")?.addEventListener("click", async () => {
  const button = byId("ai-followup-ask");
  const questionInput = byId("ai-followup-question");
  const answer = byId("ai-followup-answer");
  const question = questionInput.value.trim();
  if (question.length === 0) return;
  button.disabled = true;
  try {
    const result = await window.aiResearch.askFollowUpQuestion(question);
    answer.textContent = result.answer;
    answer.hidden = false;
    if (result.status === "OK") questionInput.value = "";
  } catch (error) {
    answer.textContent = error instanceof Error ? error.message : String(error);
    answer.hidden = false;
  } finally {
    button.disabled = false;
  }
});
let lastSeenChallengerTimestamp;
async function refreshAiChallenger() {
  if (!window.aiChallenger) return;
  const card = byId("ai-challenger");
  const disagreementButton = byId("ai-explain-disagreement");
  try {
    const { configured, latest, stats } = await window.aiChallenger.status();
    card.hidden = !configured;
    if (!configured) return;
    if (latest) {
      byId("ai-challenger-champion").textContent = `${latest.championSignal.type} (${latest.championSignal.reason})`;
      byId("ai-challenger-ai").textContent = `${latest.aiSignal.type} (신뢰도 ${latest.aiSignal.confidence.toFixed(2)})`;
      byId("ai-challenger-agreement").textContent = latest.agreesWithChampion ? "일치" : "불일치";
      byId("ai-challenger-reason").textContent = latest.aiSignal.reason;
      disagreementButton.hidden = latest.agreesWithChampion;
      if (latest.timestamp !== lastSeenChallengerTimestamp) {
        const disagreementOutput = byId("ai-disagreement-output");
        disagreementOutput.hidden = true;
        disagreementOutput.textContent = "";
        lastSeenChallengerTimestamp = latest.timestamp;
      }
    }
    const rateNode = byId("ai-challenger-agreement-rate");
    rateNode.textContent = stats.agreementRate === null
      ? "관찰 없음"
      : `${Math.round(stats.agreementRate * 100)}% (${stats.agreementCount}/${stats.totalObservations}건)`;
  } catch {
    card.hidden = true;
  } finally {
    // Self-rescheduling rather than setInterval so a slow IPC round-trip can never overlap
    // with the next poll.
    setTimeout(refreshAiChallenger, 15000);
  }
}
refreshAiChallenger();
byId("ai-explain-disagreement")?.addEventListener("click", async () => {
  const button = byId("ai-explain-disagreement");
  const output = byId("ai-disagreement-output");
  button.disabled = true;
  try {
    const result = await window.aiChallenger.explainDisagreement();
    output.textContent = result.explanation;
    output.hidden = false;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
    output.hidden = false;
  } finally {
    button.disabled = false;
  }
});
byId("ai-challenger-history-toggle")?.addEventListener("click", async () => {
  const table = byId("ai-challenger-history-table");
  if (!table.hidden) {
    table.hidden = true;
    return;
  }
  const button = byId("ai-challenger-history-toggle");
  const body = byId("ai-challenger-history-body");
  button.disabled = true;
  try {
    const history = await window.aiChallenger.history();
    if (!history.length) {
      const row = document.createElement("tr");
      const cell = textNode("td", "관찰 기록 없음");
      cell.colSpan = 4;
      row.append(cell);
      body.replaceChildren(row);
    } else body.replaceChildren(...history.map((entry) => {
      const row = document.createElement("tr");
      row.append(
        textNode("td", new Date(entry.timestamp).toLocaleTimeString("ko-KR")),
        textNode("td", `${entry.championSignal.type} (${entry.championSignal.reason})`),
        textNode("td", `${entry.aiSignal.type} (신뢰도 ${entry.aiSignal.confidence.toFixed(2)})`),
        textNode("td", entry.agreesWithChampion ? "일치" : "불일치")
      );
      return row;
    }));
    table.hidden = false;
  } catch (error) {
    const row = document.createElement("tr");
    const cell = textNode("td", error instanceof Error ? error.message : String(error));
    cell.colSpan = 4;
    row.append(cell);
    body.replaceChildren(row);
    table.hidden = false;
  } finally {
    button.disabled = false;
  }
});
byId("ai-summarize-session")?.addEventListener("click", async () => {
  const button = byId("ai-summarize-session");
  const output = byId("ai-summary-output");
  button.disabled = true;
  try {
    const result = await window.aiResearch.summarizeSession();
    output.textContent = result.summary;
    output.hidden = false;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
    output.hidden = false;
  } finally {
    button.disabled = false;
  }
});
byId("ai-explain-regime")?.addEventListener("click", async () => {
  const button = byId("ai-explain-regime");
  const output = byId("ai-regime-output");
  button.disabled = true;
  try {
    const result = await window.aiResearch.explainRegime();
    output.textContent = result.explanation;
    output.hidden = false;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
    output.hidden = false;
  } finally {
    button.disabled = false;
  }
});
byId("ai-explain-risk")?.addEventListener("click", async () => {
  const button = byId("ai-explain-risk");
  const output = byId("ai-risk-output");
  button.disabled = true;
  try {
    const result = await window.aiResearch.explainRisk();
    output.textContent = result.commentary;
    output.hidden = false;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
    output.hidden = false;
  } finally {
    button.disabled = false;
  }
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

const commandPalette = window.NUSACommandPalette.createCommandPalette({
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

Promise.all([window.nusa.getSnapshot(), window.nusa.getControlSnapshot()]).then(([paper, control]) => {
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
  for (const id of ["cio-system", "cio-opportunity", "cio-strategy", "cio-committee", "cio-execution", "cio-risk", "cio-risk-reasons", "cio-research"]) cioText(id, "데이터 없음");
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
  // WO-0019: killSwitchActive is the real, persisted switch only. A rejection for any other
  // reason (daily loss, missing approval, stale market data, ...) shows up in the reasons line
  // below, never relabeled as "Kill Switch ACTIVE".
  cioText("cio-risk", cioSectionAvailable(snapshot.risk) ? `Drawdown ${cioPercent(snapshot.risk.dailyDrawdownRatio)} · Heat ${cioPercent(snapshot.risk.portfolioHeatRatio)} · Kill Switch ${snapshot.risk.killSwitchActive ? "ACTIVE" : "OFF"}` : "데이터 없음");
  cioText("cio-risk-reasons", cioSectionAvailable(snapshot.risk) && snapshot.risk.reasons.length ? `차단 사유: ${snapshot.risk.reasons.join(", ")}` : "차단 사유 없음");
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

/*
 * Risk Budget Projection: 11-category usage display (read-only).
 * Categories: symbolExposure, portfolioExposure, dailyBuyNotional, dailySellNotional,
 *             openOrders, ordersPerSecond, ordersPerMinute, sameSideStreak,
 *             dailyLoss, consecutiveLosses, sessionDrawdown
 */
let riskBudgetRefreshTimer;
let riskBudgetRefreshInFlight = false;

function buildRiskGauge(categoryName, ratio) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 24");
  svg.setAttribute("class", `risk-gauge ${ratio >= 0.9 ? "danger" : ratio >= 0.7 ? "warn" : "ok"}`);

  // Background
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100");
  bg.setAttribute("height", "24");
  bg.setAttribute("class", "risk-gauge-bg");
  svg.appendChild(bg);

  // Fill (width-based, CSS class for color)
  const fill = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  fill.setAttribute("width", String(Math.round(ratio * 100)));
  fill.setAttribute("height", "24");
  fill.setAttribute("class", "risk-gauge-fill");
  svg.appendChild(fill);

  return svg;
}

function renderRiskBudgetUsage(usage) {
  if (!usage) {
    const grid = byId("risk-budget-grid");
    if (grid) grid.replaceChildren(textNode("p", "위험 예산 데이터 없음", "risk-budget-empty"));
    return;
  }

  const categories = [
    { name: "symbolExposure", label: "심볼 노출" },
    { name: "portfolioExposure", label: "포트폴리오 노출" },
    { name: "dailyBuyNotional", label: "일일 매수 액면" },
    { name: "dailySellNotional", label: "일일 매도 액면" },
    { name: "openOrders", label: "미체결 주문" },
    { name: "ordersPerSecond", label: "초당 주문" },
    { name: "ordersPerMinute", label: "분당 주문" },
    { name: "sameSideStreak", label: "동방향 연속" },
    { name: "dailyLoss", label: "일일 손실" },
    { name: "consecutiveLosses", label: "연속 손실" },
    { name: "sessionDrawdown", label: "세션 낙폭" }
  ];

  const grid = byId("risk-budget-grid");
  if (!grid) return;

  grid.replaceChildren(...categories.map(cat => {
    const container = document.createElement("div");
    container.className = "risk-budget-item";

    const label = document.createElement("div");
    label.className = "risk-budget-label";
    label.textContent = cat.label;

    const ratio = usage[cat.name] ?? 0;
    const gauge = buildRiskGauge(cat.name, ratio);

    const value = document.createElement("div");
    value.className = "risk-budget-value";
    value.textContent = `${(ratio * 100).toFixed(0)}%`;

    container.append(label, gauge, value);
    return container;
  }));
}

async function refreshRiskBudgetUsage() {
  if (riskBudgetRefreshInFlight) return;
  riskBudgetRefreshInFlight = true;
  try {
    const usage = await window.nusa.getRiskBudgetUsage();
    renderRiskBudgetUsage(usage);
  } catch (error) {
    window.console?.error("Risk budget refresh failed:", error);
    renderRiskBudgetUsage(null);
  } finally {
    riskBudgetRefreshInFlight = false;
    scheduleRiskBudgetRefresh();
  }
}

function scheduleRiskBudgetRefresh() {
  clearTimeout(riskBudgetRefreshTimer);
  riskBudgetRefreshTimer = setTimeout(refreshRiskBudgetUsage, 10_000);
}

byId("refresh-risk-budget")?.addEventListener("click", refreshRiskBudgetUsage);
window.addEventListener("beforeunload", () => clearTimeout(riskBudgetRefreshTimer));
refreshRiskBudgetUsage();

/*
 * WO-0034-A4O productization screens.
 *
 * Mounted last, after the dashboard is already live, so a failure here degrades to "no
 * settings panel" rather than "no application". The first-run notice is the one exception:
 * it is modal, and it is shown before the user can act on anything.
 */
(function mountProductScreens() {
  const factory = window.NUSAProductScreens;
  const api = window.nusaApp;
  if (!factory || !api) return;

  const overlays = document.getElementById("product-overlays") || document.body;
  const settingsRoot = document.getElementById("product-settings");
  const aboutRoot = document.getElementById("product-about");
  const evidenceRoot = document.getElementById("evidence");

  const about = factory.createAboutPanel({ api });
  const settings = factory.createSettingsPanel({
    api,
    onShowNotice: () => { void showFirstRunNotice(true); }
  });
  const operations = factory.createOperationsPanel({ api: window.operations });
  if (settingsRoot) settingsRoot.replaceChildren(settings.element);
  if (aboutRoot) aboutRoot.replaceChildren(about.element);
  if (evidenceRoot) evidenceRoot.replaceChildren(operations.element);
  void settings.refresh();
  void about.refresh();
  void operations.refresh();

  const shutdown = factory.createShutdownOverlay({ api, root: overlays });
  shutdown.listen();
  void shutdown.refresh();

  async function showFirstRunNotice(force) {
    const notice = factory.createFirstRunNotice({ api, onAcknowledged: () => { void settings.refresh(); } });
    if (force) {
      // "Show me that again" reads the stored notice and displays it. It does NOT clear the
      // acknowledgement: the record of what the user confirmed, and when, is not rewritten
      // by them looking at it a second time.
      try {
        const state = await api.firstRun();
        notice.render(state.notice);
        overlays.append(notice.element);
      } catch (cause) {
        void cause;
      }
      return;
    }
    await notice.mount(overlays);
  }

  void showFirstRunNotice(false);
})();

/*
 * Product navigation is a view switch, not an arbitrary anchor router. The existing
 * sections remain the source of truth for their data and controls; this layer only groups
 * them into operator-facing views and keeps the selected view keyboard-visible.
 */
(function mountWorkspaceNavigation() {
  const navigation = Array.from(document.querySelectorAll("[data-nav-target]"));
  if (!navigation.length) return;

  const views = {
    dashboard: ["#control-room", "#application-state"],
    market: ["#market", ".chart-card"],
    "shadow-session": ["#control-room", "#application-state"],
    orders: ["#operations-detail", "#orders-panel"],
    portfolio: [".grid > article:nth-child(3)"],
    risk: ["#a4-diagnostics", "#operations-detail"],
    recovery: ["#recovery-review"],
    evidence: ["#evidence"],
    diagnostics: ["#ai-cio-dashboard", "#a4-diagnostics"],
    settings: ["#product-settings"],
    about: ["#product-about"]
  };
  const persistent = [".app-header"];
  const allContent = [
    "#control-room", "#application-state", "#market", ".chart-card", "#operations-detail",
    ".grid > article:nth-child(3)", "#a4-diagnostics", "#recovery-review", "#evidence",
    "#ai-cio-dashboard", "#product-settings", "#product-about", "#orders-panel"
  ];

  function setVisible(selector, visible) {
    document.querySelectorAll(selector).forEach((node) => {
      node.hidden = !visible;
      node.setAttribute("aria-hidden", String(!visible));
    });
  }

  function activate(name, updateHash) {
    const selected = views[name] ? name : "dashboard";
    allContent.forEach((selector) => setVisible(selector, false));
    (views[selected] || []).forEach((selector) => setVisible(selector, true));
    persistent.forEach((selector) => setVisible(selector, true));
    navigation.forEach((link) => {
      const active = link.dataset.navTarget === selected;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (updateHash && window.location.hash !== `#${selected}`) window.history.replaceState(null, "", `#${selected}`);
  }

  navigation.forEach((link) => link.addEventListener("click", (event) => {
    const target = link.dataset.navTarget;
    if (!views[target]) return;
    event.preventDefault();
    activate(target, true);
  }));
  activate(window.location.hash.slice(1), false);
})();
