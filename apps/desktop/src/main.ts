import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { evaluateOperationalReadiness } from "../../cloud/src/operationalReadinessGate";
import { InMemoryAiCioEnvelopeSource, registerAiCioReadOnlyIpc } from "./aiCioIpcBridge";
import { AiCioSnapshotPublisher } from "./aiCioSnapshotPublisher";
import { ControlPlane } from "./controlPlane";
import { ControlSessionStore } from "./controlSessionStore";
import { DesktopPersistenceStore } from "./desktopPersistenceStore";
import { LiveMarketRegimeObserver } from "./liveMarketRegimeObserver";
import { PaperBroker, type PaperOrder, type PaperSide } from "./paperBroker";
import { buildPaperDashboardSections } from "./paperDashboardProjection";
import { buildPersistedResearchDashboardSection } from "./researchDashboardProjection";
import { PERSISTENCE_FAULT_MESSAGE, PERSISTENCE_REPAIR_MESSAGE, RuntimeCommandService } from "./runtimeCommandService";
import { PaperSessionStore } from "./paperSessionStore";
import { PaperScenarioEvidenceRecorder } from "./paperScenarioEvidenceRecorder";
import { PaperRuntimeEvidenceState } from "./paperRuntimeEvidenceState";
import { SmaCrossoverStrategy, StrategyEngine } from "./strategyEngine";
import { UpbitWebSocketClient, type UpbitTicker } from "./upbitWebSocket";
import { buildRecoveryHealthReport, RecoveryLedger, type RecoveryComponent, type RecoveryHealth } from "./recovery";

const MARKET = "KRW-BTC";
const INITIAL_CASH = 10_000_000;
const FEE_RATE = 0.0005;
const MAXIMUM_MARKET_DATA_AGE_MS = 30_000;
const RECONNECT_COOLDOWN_MS = 5_000;
const REQUIRED_WARMUP_SAMPLES = 20;
// minOrderNotional matches Upbit's documented 5,000 KRW minimum order value for KRW markets.
// priceTick is intentionally left unset: Upbit's KRW tick size is tiered by price range, and an
// incorrect single-tier constant would incorrectly reject valid Paper orders.
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
// Conservative Paper fill assumptions: adverse slippage against the trader and a cap on
// how much of a requested quantity fills against one quote. Both bias results pessimistically
// rather than assuming unrealistic perfect execution. Paper-only; no live order routing.
const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };
let window: BrowserWindow | undefined;
let latestTicker: UpbitTicker | undefined;
let broker: PaperBroker;
let sessionStore: PaperSessionStore;
let controlStore: ControlSessionStore;
let persistenceStore: DesktopPersistenceStore | undefined;
let stream: UpbitWebSocketClient;
let paperTradingAvailable = false;
const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
const aiCioEnvelopeSource = new InMemoryAiCioEnvelopeSource();
const aiCioSnapshotPublisher = new AiCioSnapshotPublisher(aiCioEnvelopeSource, {
  mode: "PAPER",
  maximumSectionAgeMs: 60_000,
  maximumEnvelopeAgeMs: 30_000
});
let control: ControlPlane;
let runtime: RuntimeCommandService;
let evidenceRecorder: PaperScenarioEvidenceRecorder | undefined;
let runtimeEvidenceState: PaperRuntimeEvidenceState;
let liveMarketRegimeObserver: LiveMarketRegimeObserver;
let websocketConnected = false;
let disconnectedAt: number | undefined;
let reconnectedAt: number | undefined;
let rendererHealthy = true;
let healthTimer: NodeJS.Timeout | undefined;
const recoveryLedger = new RecoveryLedger();

function recordRecovery(component: RecoveryComponent, status: RecoveryHealth, message: string): void {
  recoveryLedger.record({ id: `${component}:${Date.now()}:${recoveryLedger.list().length}`, timestamp: Date.now(), component, status, message });
}

registerAiCioReadOnlyIpc(ipcMain, aiCioEnvelopeSource);

function publishControl(): void { window?.webContents.send("control:snapshot", control.snapshot()); }
function publishPaper(): void {
  if (latestTicker) window?.webContents.send("paper:snapshot", broker.snapshot(latestTicker.trade_price));
}

function publishAiCioDashboard(): void {
  if (!latestTicker) {
    aiCioSnapshotPublisher.clear();
    return;
  }
  const generatedAt = Date.now();
  try {
    aiCioSnapshotPublisher.publishIfComplete(buildPaperDashboardSections({
      account: broker.snapshot(latestTicker.trade_price),
      control: control.snapshot(),
      markPrice: latestTicker.trade_price,
      referenceEquity: INITIAL_CASH,
      runtimeAvailable: paperTradingAvailable,
      generatedAt,
      research: persistenceStore == null ? undefined : buildPersistedResearchDashboardSection({
        manifests: persistenceStore.loadResearchRunManifests(),
        reports: persistenceStore.loadResearchValidationReports(),
        generatedAt
      })
    }), generatedAt);
  } catch {
    aiCioSnapshotPublisher.clear();
  }
}

function failClosedEvidenceWrite(): void {
  paperTradingAvailable = false;
  control.fault(PERSISTENCE_FAULT_MESSAGE);
  runtime.markUnavailable();
  publishControl();
  publishAiCioDashboard();
}

function marketDataIsFresh(now = Date.now()): boolean {
  return websocketConnected && latestTicker !== undefined && latestTicker.trade_timestamp <= now && now - latestTicker.trade_timestamp <= MAXIMUM_MARKET_DATA_AGE_MS;
}

function assertFreshMarketData(): UpbitTicker {
  if (!latestTicker) throw new Error("market price is not available yet");
  if (!websocketConnected) throw new Error("market data connection is unavailable");
  const age = Date.now() - latestTicker.trade_timestamp;
  if (!Number.isSafeInteger(latestTicker.trade_timestamp) || age < 0 || age > MAXIMUM_MARKET_DATA_AGE_MS) {
    throw new Error("market price is stale; wait for a fresh ticker");
  }
  return latestTicker;
}

function disableAutomaticTradingForMarketFault(status: string): void {
  if (!control.snapshot().autoTradeEnabled) return;
  try {
    runtime.setAutoTrade(false);
  } finally {
    paperTradingAvailable = runtime.isAvailable();
    publishControl();
    publishAiCioDashboard();
  }
  recordRecovery("WEBSOCKET", "WARNING", `Automatic Paper trading disabled: ${status}`);
}

function recordLiveMarketRegime(ticker: UpbitTicker): boolean {
  const regime = liveMarketRegimeObserver.observe(ticker);
  if (!regime || !paperTradingAvailable || !evidenceRecorder) return true;
  try {
    evidenceRecorder.regimeObserved(`regime:${regime}:${ticker.trade_timestamp}`, ticker.trade_timestamp, regime);
    return true;
  } catch {
    failClosedEvidenceWrite();
    return false;
  }
}

function handleTicker(ticker: UpbitTicker): void {
  latestTicker = ticker;
  window?.webContents.send("market:ticker", ticker);
  window?.webContents.send("chart:point", { time: ticker.trade_timestamp, value: ticker.trade_price });
  if (!recordLiveMarketRegime(ticker)) return;
  const position = broker.snapshot(ticker.trade_price).position.quantity;
  const signal = strategy.onTick({ market: MARKET, price: ticker.trade_price, timestamp: ticker.trade_timestamp }, position);
  runtime.automaticSignal(MARKET, ticker.trade_price, position, signal);
  paperTradingAvailable = runtime.isAvailable();
  publishPaper();
  publishControl();
  publishAiCioDashboard();
}

function handleMarketStatus(status: string): void {
  const now = Date.now();
  websocketConnected = status === "connected";
  window?.webContents.send("market:status", status);

  if (status === "connected") {
    reconnectedAt = now;
  } else {
    disconnectedAt ??= now;
    disableAutomaticTradingForMarketFault(status);
  }

  if (status === "reconnect-exhausted") {
    recordRecovery("WEBSOCKET", "CRITICAL", "Market WebSocket recovery exhausted");
    paperTradingAvailable = false;
    control.fault("Market WebSocket recovery exhausted");
    runtime.markUnavailable();
    publishControl();
    publishAiCioDashboard();
    return;
  }
  if (status.startsWith("reconnecting") || status.startsWith("error") || status.startsWith("decode-error") || status.startsWith("stale")) {
    recordRecovery("WEBSOCKET", "WARNING", status);
  }
  const evidence = runtimeEvidenceState.observeMarketStatus(status);
  if (evidence !== "WEBSOCKET_DISCONNECT_RECOVERED" || !paperTradingAvailable || !evidenceRecorder) return;
  const observedAt = Date.now();
  try {
    evidenceRecorder.faultScenarioPassed(`fault:websocket-disconnect:${observedAt}`, observedAt, "WEBSOCKET_DISCONNECT");
  } catch {
    failClosedEvidenceWrite();
  }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: "Dokkaebi Paper Trader",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(app.getAppPath(), "apps/desktop/renderer/index.html"));
  window.webContents.on("did-finish-load", () => {
    rendererHealthy = true;
    publishControl();
    publishPaper();
    publishAiCioDashboard();
  });
  window.webContents.on("render-process-gone", () => {
    rendererHealthy = false;
    recordRecovery("RENDERER", "WARNING", "Renderer crashed; recreating the read-only view");
    const crashedWindow = window;
    window = undefined;
    crashedWindow?.destroy();
    setTimeout(() => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }, 500);
  });
  window.on("closed", () => { window = undefined; });
}

function observeHealth(): void {
  const memory = process.memoryUsage();
  const report = buildRecoveryHealthReport({
    now: Date.now(), ipcHealthy: rendererHealthy, websocketConnected, rendererHealthy,
    storageHealthy: persistenceStore !== undefined, lastMarketDataAt: latestTicker?.trade_timestamp,
    maximumMarketDataAgeMs: 60_000, heapUsedBytes: memory.heapUsed, maximumHeapUsedBytes: 768 * 1024 * 1024
  });
  if (report.status !== "HEALTHY") recordRecovery("MEMORY", report.status, report.reasons.join("; "));
  if ((report.status === "CRITICAL" || !marketDataIsFresh()) && control.snapshot().autoTradeEnabled) {
    disableAutomaticTradingForMarketFault(report.reasons.join("; ") || "market data is not fresh");
  }
}

function initializeRuntime(): void {
  aiCioSnapshotPublisher.clear();
  evidenceRecorder = undefined;
  runtimeEvidenceState = new PaperRuntimeEvidenceState();
  liveMarketRegimeObserver = new LiveMarketRegimeObserver();
  disconnectedAt = undefined;
  reconnectedAt = undefined;
  const sessionStartedAt = Date.now();
  const evidenceSessionId = `paper-${process.pid}-${sessionStartedAt}`;
  sessionStore = new PaperSessionStore(path.join(app.getPath("userData"), "paper-session.json"));
  controlStore = new ControlSessionStore(path.join(app.getPath("userData"), "control-session.json"));
  const paperLoad = sessionStore.loadSafe();
  const controlLoad = controlStore.loadSafe();
  let restored = paperLoad.state && controlLoad.state ? { paper: paperLoad.state, control: controlLoad.state } : undefined;
  let restoredFromSqlite = false;
  let persistenceDiagnostic: string | undefined;
  try {
    persistenceStore = new DesktopPersistenceStore(path.join(app.getPath("userData"), "dokkaebi.db"));
    const sqliteState = persistenceStore.load();
    if (sqliteState) {
      restored = sqliteState;
      restoredFromSqlite = true;
    } else if (restored) persistenceStore.importLegacy(restored);
  } catch (error) {
    persistenceStore = undefined;
    persistenceDiagnostic = `SQLite recovery failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  broker = new PaperBroker(INITIAL_CASH, MARKET, FEE_RATE, RISK_POLICY, restored?.paper, FILL_MODEL);
  control = new ControlPlane("sma-crossover", 200, restored?.control);
  if (persistenceStore) {
    evidenceRecorder = new PaperScenarioEvidenceRecorder({
      append: (event) => {
        persistenceStore!.saveWithScenarioEvent(broker.exportState(), control.exportState(), event);
        return { sequence: 0, previousHash: "", event, hash: "" };
      }
    }, evidenceSessionId);
  }
  runtime = new RuntimeCommandService(broker, control, strategy, { save: (paper, controlState) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    persistenceStore.save(paper, controlState);
  }, saveWithScenarioEvent: (paper, controlState, event) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    persistenceStore.saveWithScenarioEvent(paper, controlState, event);
  }, saveWithScenarioEvents: (paper, controlState, events) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    persistenceStore.saveWithScenarioEvents(paper, controlState, events);
  } }, () => {
    const now = Date.now();
    const marketDataObservedAt = latestTicker?.trade_timestamp ?? 0;
    const input = {
      now,
      mode: paperTradingAvailable ? "PAPER" as const : "FAULTED" as const,
      killSwitchActive: control.snapshot().status === "FAULTED",
      recoveryUnresolved: !paperTradingAvailable,
      strategySuspended: !strategy.isRunning(),
      dataFingerprintMatches: true,
      marketDataObservedAt,
      maximumDataAgeMs: MAXIMUM_MARKET_DATA_AGE_MS,
      warmupSamples: strategy.getHistory().length,
      requiredWarmupSamples: REQUIRED_WARMUP_SAMPLES,
      reconnectCooldownMs: RECONNECT_COOLDOWN_MS,
      ...(disconnectedAt === undefined ? {} : { disconnectedAt }),
      ...(reconnectedAt === undefined ? {} : { reconnectedAt })
    };
    return evaluateOperationalReadiness(input);
  }, evidenceRecorder);
  paperTradingAvailable = persistenceDiagnostic == null && paperLoad.diagnostic == null && controlLoad.diagnostic == null;
  if (control.snapshot().status === "RUNNING") strategy.start();
  for (const diagnostic of [paperLoad.diagnostic, controlLoad.diagnostic, persistenceDiagnostic]) {
    if (diagnostic) control.fault(diagnostic);
  }
  if (!paperTradingAvailable) runtime.markUnavailable();
  if (paperTradingAvailable) {
    try {
      if (!evidenceRecorder) throw new Error("Paper evidence recorder is unavailable");
      evidenceRecorder.sessionObserved(`session-start:${evidenceSessionId}`, sessionStartedAt);
      if (restoredFromSqlite) evidenceRecorder.recoveryCompleted(`recovery:${evidenceSessionId}`, sessionStartedAt);
    } catch {
      failClosedEvidenceWrite();
    }
  }
  stream = new UpbitWebSocketClient(MARKET, handleTicker, handleMarketStatus);
}

ipcMain.handle("paper:order", (_event, input: unknown) => {
  if (!paperTradingAvailable) throw new Error(PERSISTENCE_REPAIR_MESSAGE);
  if (input == null || typeof input !== "object") throw new Error("invalid paper order input");
  const candidate = input as { side?: unknown; quantity?: unknown };
  if ((candidate.side !== "BUY" && candidate.side !== "SELL") || typeof candidate.quantity !== "number" || !Number.isFinite(candidate.quantity)) throw new Error("invalid paper order input");
  const side = candidate.side as PaperSide;
  const quantity = candidate.quantity;
  const ticker = assertFreshMarketData();
  let order: PaperOrder;
  try { order = runtime.manualOrder(side, quantity, ticker.trade_price); }
  finally { paperTradingAvailable = runtime.isAvailable(); }
  publishControl();
  publishAiCioDashboard();
  return { order, snapshot: broker.snapshot(ticker.trade_price) };
});

ipcMain.handle("paper:snapshot", () => latestTicker ? broker.snapshot(latestTicker.trade_price) : null);
ipcMain.handle("control:snapshot", () => control.snapshot());
function runControlCommand(command: () => void): ReturnType<ControlPlane["snapshot"]> {
  try { command(); }
  finally { paperTradingAvailable = runtime.isAvailable(); }
  publishControl();
  publishAiCioDashboard();
  return control.snapshot();
}
ipcMain.handle("control:start", () => runControlCommand(() => runtime.start()));
ipcMain.handle("control:stop", () => runControlCommand(() => runtime.stop()));
ipcMain.handle("control:auto", (_event, enabled: unknown) => {
  if (typeof enabled !== "boolean") throw new Error("invalid auto-trade input");
  if (enabled) assertFreshMarketData();
  return runControlCommand(() => runtime.setAutoTrade(enabled));
});
ipcMain.handle("control:quantity", (_event, quantity: unknown) => {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) throw new Error("invalid quantity input");
  return runControlCommand(() => runtime.setOrderQuantity(quantity));
});

app.whenReady().then(() => {
  initializeRuntime();
  createWindow();
  if (paperTradingAvailable) stream.start();
  healthTimer = setInterval(observeHealth, 30_000);
  process.on("uncaughtException", (error) => {
    recordRecovery("STORAGE", "CRITICAL", `Main process error: ${error.message}`);
    failClosedEvidenceWrite();
  });
  process.on("unhandledRejection", (reason) => {
    recordRecovery("IPC", "CRITICAL", `Unhandled recovery failure: ${reason instanceof Error ? reason.message : String(reason)}`);
    failClosedEvidenceWrite();
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  aiCioSnapshotPublisher.clear();
  stream?.stop();
  if (healthTimer) clearInterval(healthTimer);
  persistenceStore?.close();
  if (process.platform !== "darwin") app.quit();
});
