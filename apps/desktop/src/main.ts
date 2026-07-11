import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { ControlPlane } from "./controlPlane";
import { ControlSessionStore } from "./controlSessionStore";
import { DesktopPersistenceStore } from "./desktopPersistenceStore";
import { executeAutomaticPaperSignal } from "./paperAutomation";
import { PaperBroker, type PaperSide } from "./paperBroker";
import { PaperSessionStore } from "./paperSessionStore";
import { SmaCrossoverStrategy, StrategyEngine } from "./strategyEngine";
import { UpbitWebSocketClient, type UpbitTicker } from "./upbitWebSocket";

const MARKET = "KRW-BTC";
const INITIAL_CASH = 10_000_000;
const FEE_RATE = 0.0005;
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000 };
let window: BrowserWindow | undefined;
let latestTicker: UpbitTicker | undefined;
let broker: PaperBroker;
let sessionStore: PaperSessionStore;
let controlStore: ControlSessionStore;
let persistenceStore: DesktopPersistenceStore | undefined;
let stream: UpbitWebSocketClient;
let paperTradingAvailable = false;
const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
let control: ControlPlane;

function persistRuntime(): void {
  if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
  persistenceStore.save(broker.exportState(), control.exportState());
}

function publishControl(): void { window?.webContents.send("control:snapshot", control.snapshot()); }
function publishPaper(): void {
  if (latestTicker) window?.webContents.send("paper:snapshot", broker.snapshot(latestTicker.trade_price));
}

function handleTicker(ticker: UpbitTicker): void {
  latestTicker = ticker;
  window?.webContents.send("market:ticker", ticker);
  window?.webContents.send("chart:point", { time: ticker.trade_timestamp, value: ticker.trade_price });
  const position = broker.snapshot(ticker.trade_price).position.quantity;
  const signal = strategy.onTick({ market: MARKET, price: ticker.trade_price, timestamp: ticker.trade_timestamp }, position);
  control.record("SIGNAL", `${signal.type}: ${signal.reason}`, signal);

  const automatic = executeAutomaticPaperSignal(control, broker, MARKET, ticker.trade_price, position, signal, persistRuntime);
  if (automatic.outcome === "FILLED" && automatic.order) {
    control.record("ORDER", `automatic ${signal.type} filled`, automatic.order);
  } else if (automatic.outcome === "REJECTED") {
    control.record("RISK", automatic.error ?? "automatic paper order rejected");
  }
  try { persistRuntime(); } catch (error) { paperTradingAvailable = false; control.fault(`SQLite persistence failed: ${String(error)}`); }
  publishPaper();
  publishControl();
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
  window.on("closed", () => { window = undefined; });
}

function initializeRuntime(): void {
  sessionStore = new PaperSessionStore(path.join(app.getPath("userData"), "paper-session.json"));
  controlStore = new ControlSessionStore(path.join(app.getPath("userData"), "control-session.json"));
  const paperLoad = sessionStore.loadSafe();
  const controlLoad = controlStore.loadSafe();
  let restored = paperLoad.state && controlLoad.state ? { paper: paperLoad.state, control: controlLoad.state } : undefined;
  let persistenceDiagnostic: string | undefined;
  try {
    persistenceStore = new DesktopPersistenceStore(path.join(app.getPath("userData"), "dokkaebi.db"));
    const sqliteState = persistenceStore.load();
    if (sqliteState) restored = sqliteState;
    else if (restored) persistenceStore.importLegacy(restored);
  } catch (error) {
    persistenceStore = undefined;
    persistenceDiagnostic = `SQLite recovery failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  broker = new PaperBroker(INITIAL_CASH, MARKET, FEE_RATE, RISK_POLICY, restored?.paper);
  control = new ControlPlane("sma-crossover", 200, restored?.control);
  paperTradingAvailable = persistenceDiagnostic == null && paperLoad.diagnostic == null && controlLoad.diagnostic == null;
  if (control.snapshot().status === "RUNNING") strategy.start();
  for (const diagnostic of [paperLoad.diagnostic, controlLoad.diagnostic, persistenceDiagnostic]) {
    if (diagnostic) control.fault(diagnostic);
  }
  if (paperTradingAvailable) persistRuntime();
  stream = new UpbitWebSocketClient(MARKET, handleTicker, (status) => window?.webContents.send("market:status", status));
}

ipcMain.handle("paper:order", (_event, input: { side: PaperSide; quantity: number }) => {
  if (!paperTradingAvailable) throw new Error("paper trading unavailable: session recovery requires operator repair");
  if (!latestTicker) throw new Error("market price is not available yet");
  if (input.side !== "BUY" && input.side !== "SELL") throw new Error("invalid paper order side");
  const order = broker.execute(input.side, input.quantity, latestTicker.trade_price);
  control.record("ORDER", `manual ${input.side} filled`, order);
  persistRuntime();
  publishControl();
  return { order, snapshot: broker.snapshot(latestTicker.trade_price) };
});

ipcMain.handle("paper:snapshot", () => latestTicker ? broker.snapshot(latestTicker.trade_price) : null);
ipcMain.handle("control:snapshot", () => control.snapshot());
ipcMain.handle("control:start", () => { strategy.start(); control.start(); persistRuntime(); publishControl(); return control.snapshot(); });
ipcMain.handle("control:stop", () => { strategy.stop(); control.stop(); persistRuntime(); publishControl(); return control.snapshot(); });
ipcMain.handle("control:auto", (_event, enabled: boolean) => { control.setAutoTrade(Boolean(enabled)); persistRuntime(); publishControl(); return control.snapshot(); });
ipcMain.handle("control:quantity", (_event, quantity: number) => { control.setOrderQuantity(quantity); persistRuntime(); publishControl(); return control.snapshot(); });

app.whenReady().then(() => {
  initializeRuntime();
  createWindow();
  stream.start();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  stream?.stop();
  persistenceStore?.close();
  if (process.platform !== "darwin") app.quit();
});

