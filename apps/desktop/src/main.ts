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
import { parsePaperOrderIpc } from "./paperIpcValidation";
import { buildPaperDashboardSections } from "./paperDashboardProjection";
import { buildPersistedResearchDashboardSection } from "./researchDashboardProjection";
import { resolveRendererIndexPath } from "./rendererPath";
import {
  createPreloadErrorDiagnostic,
  createRendererConsoleErrorDiagnostic,
  createRendererLoadFailedDiagnostic,
  createRendererLoadFinishedDiagnostic,
  createRendererProcessGoneDiagnostic,
  createRendererResponsiveDiagnostic,
  createRendererUnresponsiveDiagnostic,
  formatDesktopStartupDiagnostic
} from "./desktopStartupDiagnostics";
import { PERSISTENCE_FAULT_MESSAGE, PERSISTENCE_REPAIR_MESSAGE, RuntimeCommandService, type PaperCommandRiskGate } from "./runtimeCommandService";
import { formatRuntimeMutationDiagnostic } from "./runtimeMutationDiagnostics";
import { PaperSessionStore } from "./paperSessionStore";
import { PaperScenarioEvidenceRecorder } from "./paperScenarioEvidenceRecorder";
import { PaperRuntimeEvidenceState } from "./paperRuntimeEvidenceState";
import { SmaCrossoverStrategy, StrategyEngine, type StrategySignal } from "./strategyEngine";
import { UpbitWebSocketClient, type UpbitTicker } from "./upbitWebSocket";
import { buildRecoveryHealthReport, RecoveryLedger, type RecoveryComponent, type RecoveryHealth } from "./recovery";
import { createHash } from "node:crypto";
import { createPaperSafetySnapshot, recoverPaperSafetySnapshot } from "./paperSafetySnapshot";
import { ShadowOperationalRuntime } from "./shadowOperationalRuntime";
import { DomainEventBus, DurableEvidenceSink, InMemoryEvidenceSink, type DurableEvidenceWriter } from "./domainEventBus";
import { ShadowEvidenceArchive, findIncompleteShadowArchivesSync } from "./shadowEvidenceArchive";
import { parseShadowSessionIpc, parseShadowStartIpc, parseShadowStatusIpc } from "./shadowIpcValidation";
import { UpbitMinuteCandleSource } from "./upbitMinuteCandleSource";

const MARKET = "KRW-BTC";
const INITIAL_CASH = 10_000_000;
const FEE_RATE = 0.0005;
const MAXIMUM_MARKET_DATA_AGE_MS = 30_000;
const RECONNECT_COOLDOWN_MS = 5_000;
const REQUIRED_WARMUP_SAMPLES = 20;
const SHADOW_STRATEGY_VERSION = "sma-crossover:closed-candle-1m-v1";
const SHADOW_STRATEGY_FINGERPRINT = createHash("sha256").update(JSON.stringify({ strategyId: "sma-crossover", strategyVersion: SHADOW_STRATEGY_VERSION, inputType: "CLOSED_CANDLE", interval: "1m", sourceType: "UPBIT_PUBLIC_CANDLE", shortWindow: 5, longWindow: 20 })).digest("hex");
// minOrderNotional matches Upbit's documented 5,000 KRW minimum order value for KRW markets.
// priceTick is intentionally left unset: Upbit's KRW tick size is tiered by price range, and an
// incorrect single-tier constant would incorrectly reject valid Paper orders.
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
// Conservative Paper fill assumptions: adverse slippage against the trader and a cap on
// how much of a requested quantity fills against one quote. Both bias results pessimistically
// rather than assuming unrealistic perfect execution. Simulated fills only; no real exchange order is placed.
const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };
const PAPER_SAFETY_SOURCE_COMMIT = process.env.GITHUB_SHA ?? "local-paper-build";
const PAPER_SAFETY_FINGERPRINTS = Object.freeze({
  strategy: createHash("sha256").update("sma-crossover:5:20").digest("hex"),
  config: createHash("sha256").update(JSON.stringify({ MARKET, INITIAL_CASH, FEE_RATE })).digest("hex"),
  runtime: createHash("sha256").update("desktop-paper-runtime-v1").digest("hex"),
  riskPolicy: createHash("sha256").update(JSON.stringify(RISK_POLICY)).digest("hex")
});
// Shared by both RuntimeCommandService (real Automatic/Manual Paper orders) and Shadow's
// hypothetical dispatch, so Shadow's risk decision is the SAME real decision, never a
// separately fabricated ALLOW. WO-0032 composition (approval/reconciliation/deployment
// state) is not wired yet, so this currently HALTs every path unconditionally -- honest,
// not a placeholder success.
const paperCommandRiskGate: PaperCommandRiskGate = { evaluate: () => Object.freeze({ status: "HALT" as const, reasonCodes: Object.freeze(["RISK_GATE_NOT_CONFIGURED"]) }) };
let window: BrowserWindow | undefined;
let latestTicker: UpbitTicker | undefined;
let broker: PaperBroker;
let sessionStore: PaperSessionStore;
let controlStore: ControlSessionStore;
let persistenceStore: DesktopPersistenceStore | undefined;
let stream: UpbitWebSocketClient;
let paperTradingAvailable = false;
const smaStrategy = new SmaCrossoverStrategy(5, 20);
const strategy = new StrategyEngine(smaStrategy);
const aiCioEnvelopeSource = new InMemoryAiCioEnvelopeSource();
const aiCioSnapshotPublisher = new AiCioSnapshotPublisher(aiCioEnvelopeSource, {
  mode: "PAPER",
  maximumSectionAgeMs: 60_000,
  maximumEnvelopeAgeMs: 30_000
});
let control: ControlPlane;
let runtime: RuntimeCommandService;
let shadowRuntime: ShadowOperationalRuntime;
let evidenceRecorder: PaperScenarioEvidenceRecorder | undefined;
let runtimeEvidenceState: PaperRuntimeEvidenceState;
let liveMarketRegimeObserver: LiveMarketRegimeObserver;
let websocketConnected = false;
let disconnectedAt: number | undefined;
let reconnectedAt: number | undefined;
let rendererHealthy = true;
let healthTimer: NodeJS.Timeout | undefined;
let officialCandleTimer: NodeJS.Timeout | undefined;
const officialCandleSource = new UpbitMinuteCandleSource(MARKET);
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
      }),
      strategyWarmup: { current: strategy.getHistory().length, required: REQUIRED_WARMUP_SAMPLES },
      executionCostBps: FILL_MODEL.slippageBps + FILL_MODEL.spreadBps / 2
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

/**
 * The strategy is driven ONLY from a closed 1-minute candle, never from this raw ticker
 * directly (WO-0034-A2) -- shadowRuntime.onTicker aggregates candles internally and calls
 * strategy.onTick exactly once per closed candle, via onProductionSignal below.
 */
function handleTicker(ticker: UpbitTicker): void {
  latestTicker = ticker;
  window?.webContents.send("market:ticker", ticker);
  window?.webContents.send("chart:point", { time: ticker.trade_timestamp, value: ticker.trade_price });
  if (!recordLiveMarketRegime(ticker)) return;
}

/** Fires once per closed candle, for BOTH real Automatic Paper trading and (separately) Shadow. */
function handleProductionSignal(input: { market: string; price: number; positionQuantity: number; signal: StrategySignal }): void {
  if (persistenceStore) {
    try { persistenceStore.saveStrategyPriceHistory(strategy.getHistory()); } catch {
      // Best-effort continuity only; never affects paperTradingAvailable or the account/control write path.
    }
  }
  runtime.automaticSignal(input.market, input.price, input.positionQuantity, input.signal);
  paperTradingAvailable = runtime.isAvailable();
  publishPaper();
  publishControl();
  publishAiCioDashboard();
}

function handleMarketStatus(status: string): void {
  const now = Date.now();
  websocketConnected = status === "connected";
  window?.webContents.send("market:status", status);
  shadowRuntime.onWebSocketStatus(status);

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
  window.loadFile(resolveRendererIndexPath(__dirname));
  window.webContents.on("did-finish-load", () => {
    console.info(formatDesktopStartupDiagnostic(createRendererLoadFinishedDiagnostic()));
    rendererHealthy = true;
    publishControl();
    publishPaper();
    publishAiCioDashboard();
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(formatDesktopStartupDiagnostic(createRendererLoadFailedDiagnostic({ errorCode, errorDescription, validatedUrl: validatedURL, isMainFrame })));
    if (isMainFrame) {
      rendererHealthy = false;
      recordRecovery("RENDERER", "CRITICAL", `Renderer main-frame load failed: ${errorDescription}`);
    }
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(formatDesktopStartupDiagnostic(createPreloadErrorDiagnostic({ preloadPath, errorMessage: error instanceof Error ? error.message : String(error) })));
  });
  window.webContents.on("console-message", (details) => {
    if (details.level !== "error") return;
    console.warn(formatDesktopStartupDiagnostic(createRendererConsoleErrorDiagnostic({ message: details.message, line: details.lineNumber, sourceId: details.sourceId })));
  });
  window.webContents.on("unresponsive", () => {
    console.warn(formatDesktopStartupDiagnostic(createRendererUnresponsiveDiagnostic()));
  });
  window.webContents.on("responsive", () => {
    console.info(formatDesktopStartupDiagnostic(createRendererResponsiveDiagnostic()));
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(formatDesktopStartupDiagnostic(createRendererProcessGoneDiagnostic({ reason: details.reason, exitCode: details.exitCode })));
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
  const shadowEvidenceRoot = path.join(app.getPath("userData"), "shadow-evidence");
  let shadowIncompleteEvidence: readonly string[] = [];
  let shadowEvidenceScanBlocked = false;
  try {
    shadowIncompleteEvidence = findIncompleteShadowArchivesSync(shadowEvidenceRoot);
  } catch {
    // An unreadable archive root is uncertainty about the prior session. Shadow start will
    // expose RECOVERY_REQUIRED rather than continuing beside evidence it cannot inspect.
    shadowEvidenceScanBlocked = true;
  }
  sessionStore = new PaperSessionStore(path.join(app.getPath("userData"), "paper-session.json"));
  controlStore = new ControlSessionStore(path.join(app.getPath("userData"), "control-session.json"));
  const paperLoad = sessionStore.loadSafe();
  const controlLoad = controlStore.loadSafe();
  let restored = paperLoad.state && controlLoad.state ? { paper: paperLoad.state, control: controlLoad.state } : undefined;
  let restoredFromSqlite = false;
  let persistenceDiagnostic: string | undefined;
  let safetyRecoveryBlocked = false;
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
  if (persistenceStore) {
    try {
      const restoredHistory = persistenceStore.loadStrategyPriceHistory();
      if (restoredHistory) strategy.restoreHistory(restoredHistory);
    } catch {
      // Best-effort continuity only: fall back to warming up from empty history.
      // Must never affect persistenceDiagnostic or paperTradingAvailable.
    }
  }
  broker = new PaperBroker(INITIAL_CASH, MARKET, FEE_RATE, RISK_POLICY, restored?.paper, FILL_MODEL);
  control = new ControlPlane("sma-crossover", 200, restored?.control);
  if (persistenceStore) {
    try {
      const safety = persistenceStore.loadPaperSafetySnapshot();
      if (safety) {
        const recovery = recoverPaperSafetySnapshot(safety, { sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT, fingerprints: PAPER_SAFETY_FINGERPRINTS });
        control.record("SYSTEM", `Paper safety recovery: ${recovery.reasonCodes.join(",")}`);
        if (recovery.blocked) {
          safetyRecoveryBlocked = true;
          control.fault("Paper safety recovery is blocked pending reconciliation and owner review");
        }
      }
    } catch (error) {
      persistenceDiagnostic = `Paper safety snapshot recovery failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (persistenceStore) {
    evidenceRecorder = new PaperScenarioEvidenceRecorder({
      append: (event) => {
        persistenceStore!.saveWithScenarioEvent(broker.exportState(), control.exportState(), event);
        return { sequence: 0, previousHash: "", event, hash: "" };
      }
    }, evidenceSessionId);
  }
  const createSafetySnapshot = (paper: ReturnType<PaperBroker["exportState"]>) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    const snapshot = createPaperSafetySnapshot({
      snapshotId: `paper-safety-${Date.now()}`, createdAt: Date.now(), tradingMode: "PAPER_MANUAL", killSwitch: { active: control.snapshot().status === "FAULTED", activatedAt: control.snapshot().status === "FAULTED" ? Date.now() : null, reason: control.snapshot().status === "FAULTED" ? "runtime fault" : null }, approval: null,
      fingerprints: PAPER_SAFETY_FINGERPRINTS, deploymentIntegrity: { status: "UNKNOWN", checkedAt: null, reasonCodes: [] }, reconciliation: { status: "REQUIRED", checkedAt: null, ledgerSha256: null, reasonCodes: [] },
      idempotency: { signalIds: [], commandIds: [], clientOrderIds: [], orderIds: paper.orders.map((order) => order.id), fillIds: paper.orders.map((order) => order.id) }, openAlerts: control.snapshot().status === "FAULTED" ? [{ alertId: "runtime-fault", severity: "P0" as const, status: "OPEN" as const, reasonCode: "RUNTIME_FAULT", createdAt: Date.now() }] : [],
      lossState: { tradingDay: new Date().toISOString().slice(0, 10), dayStartEquity: INITIAL_CASH, realizedDailyPnl: 0, unrealizedDailyPnl: 0, consecutiveLossCount: 0, sessionPeakEquity: INITIAL_CASH, sessionDrawdown: 0 }, marketDataRecovery: { status: "WARMING_UP", consecutiveHealthyClosedCandles: 0, reconnectCount: 0 }, sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT
    });
    return snapshot;
  };
  const saveSafety = (paper: ReturnType<PaperBroker["exportState"]>, controlState: ReturnType<ControlPlane["exportState"]>) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    persistenceStore.saveWithPaperSafetySnapshot(paper, controlState, createSafetySnapshot(paper));
  };
  runtime = new RuntimeCommandService(broker, control, strategy, { save: (paper, controlState) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    saveSafety(paper, controlState);
  }, saveWithScenarioEvent: (paper, controlState, event) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    persistenceStore.saveWithScenarioEventsAndPaperSafetySnapshot(paper, controlState, [event], createSafetySnapshot(paper));
  }, saveWithScenarioEvents: (paper, controlState, events) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    persistenceStore.saveWithScenarioEventsAndPaperSafetySnapshot(paper, controlState, events, createSafetySnapshot(paper));
  } }, paperCommandRiskGate, () => {
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
  }, evidenceRecorder, (diagnostic) => {
    const logger = diagnostic.kind === "PERSISTENCE_ROLLBACK_COMPLETED" ? console.info : console.error;
    logger(formatRuntimeMutationDiagnostic(diagnostic));
  });
  shadowRuntime = new ShadowOperationalRuntime({
    symbol: MARKET,
    strategyId: smaStrategy.id,
    strategyVersion: SHADOW_STRATEGY_VERSION,
    strategyFingerprint: SHADOW_STRATEGY_FINGERPRINT,
    sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT,
    fingerprints: PAPER_SAFETY_FINGERPRINTS,
    strategy,
    getPositionQuantity: () => broker.exportState().position.quantity,
    onProductionSignal: handleProductionSignal,
    riskGate: paperCommandRiskGate,
    getHypotheticalOrderQuantity: () => control.getOrderQuantity(),
    createEvidenceBus: ({ sessionId, createdAt, onHalt }) => {
      const archivePromise = ShadowEvidenceArchive.create(shadowEvidenceRoot, {
        sessionId,
        createdAt,
        sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT,
        symbol: MARKET,
        strategyId: smaStrategy.id,
        strategyVersion: SHADOW_STRATEGY_VERSION,
        controlOrigin: "LOCAL_INTERACTIVE_UI",
        authenticatedOwner: false,
        fingerprints: PAPER_SAFETY_FINGERPRINTS
      });
      const writer: DurableEvidenceWriter = {
        append: async (event, receivedAt) => (await archivePromise).append(event, receivedAt),
        finalize: async (reason: string, generatedAt?: number, status?: "COMPLETED" | "ABORTED") => (await archivePromise).finalize(reason, generatedAt, status)
      };
      return new DomainEventBus({
        sessionId,
        sinks: [new InMemoryEvidenceSink(), new DurableEvidenceSink(writer)],
        onHalt
      });
    },
    findIncompleteEvidence: () => shadowEvidenceScanBlocked ? ["UNREADABLE_SHADOW_EVIDENCE"] : shadowIncompleteEvidence,
    getSafetyState: () => ({
      // Matches createSafetySnapshot()'s own current, honestly-unresolved values: neither
      // deployment integrity nor reconciliation has a real PASS source wired yet, so
      // Shadow correctly cannot reach RUNNING until that composition exists.
      deploymentIntegrity: false,
      reconciliation: false,
      killSwitch: control.snapshot().status === "FAULTED",
      openP0: control.snapshot().status === "FAULTED",
      automaticTrading: control.snapshot().autoTradeEnabled,
      // No Canary/Extended runtime mode is wired into this process at all yet.
      currentModeIsCanaryOrExtended: false
    })
  });
  paperTradingAvailable = !safetyRecoveryBlocked && persistenceDiagnostic == null && paperLoad.diagnostic == null && controlLoad.diagnostic == null;
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
  const { side, quantity } = parsePaperOrderIpc(input);
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

function requireCurrentShadowSession(input: unknown): void {
  const { sessionId } = parseShadowSessionIpc(input);
  if (shadowRuntime.diagnostics().sessionId !== sessionId) throw new Error("shadow session mismatch");
}
ipcMain.handle("shadow:start", (_event, input: unknown) => {
  parseShadowStartIpc(input);
  return shadowRuntime.start();
});
ipcMain.handle("shadow:pause", (_event, input: unknown) => {
  requireCurrentShadowSession(input);
  return shadowRuntime.pause();
});
ipcMain.handle("shadow:resume", (_event, input: unknown) => {
  requireCurrentShadowSession(input);
  return shadowRuntime.resume();
});
ipcMain.handle("shadow:stop", (_event, input: unknown) => {
  requireCurrentShadowSession(input);
  return shadowRuntime.stop();
});
ipcMain.handle("shadow:status", (_event, input: unknown) => {
  parseShadowStatusIpc(input);
  return shadowRuntime.diagnostics();
});

app.whenReady().then(() => {
  initializeRuntime();
  createWindow();
  if (paperTradingAvailable) stream.start();
  void shadowRuntime.syncOfficialCandles(officialCandleSource);
  officialCandleTimer = setInterval(() => { void shadowRuntime.syncOfficialCandles(officialCandleSource); }, 60_000);
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
  if (officialCandleTimer) clearInterval(officialCandleTimer);
  persistenceStore?.close();
  if (process.platform !== "darwin") app.quit();
});
