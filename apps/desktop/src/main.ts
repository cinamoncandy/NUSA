import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { ControlPlane } from "./controlPlane";
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
let stream: UpbitWebSocketClient;
const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
const control = new ControlPlane("sma-crossover");

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

  if (control.canAutoTrade() && signal.type !== "HOLD") {
    try {
      const side: PaperSide = signal.type;
      if (side === "SELL" && position <= 0) return;
      const quantity = side === "SELL" ? Math.min(position, control.getOrderQuantity()) : control.getOrderQuantity();
      const order = broker.execute(side, quantity, ticker.trade_price);
      sessionStore.save(broker.exportState());
      control.record("ORDER", `automatic ${side} filled`, order);
    } catch (error) {
      control.record("RISK", error instanceof Error ? error.message : String(error));
    }
  }
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
  broker = new PaperBroker(INITIAL_CASH, MARKET, FEE_RATE, RISK_POLICY, sessionStore.load());
  stream = new UpbitWebSocketClient(MARKET, handleTicker, (status) => window?.webContents.send("market:status", status));
}

ipcMain.handle("paper:order", (_event, input: { side: PaperSide; quantity: number }) => {
  if (!latestTicker) throw new Error("market price is not available yet");
  if (input.side !== "BUY" && input.side !== "SELL") throw new Error("invalid paper order side");
  const order = broker.execute(input.side, input.quantity, latestTicker.trade_price);
  sessionStore.save(broker.exportState());
  control.record("ORDER", `manual ${input.side} filled`, order);
  publishControl();
  return { order, snapshot: broker.snapshot(latestTicker.trade_price) };
});

ipcMain.handle("paper:snapshot", () => latestTicker ? broker.snapshot(latestTicker.trade_price) : null);
ipcMain.handle("control:snapshot", () => control.snapshot());
ipcMain.handle("control:start", () => { strategy.start(); control.start(); publishControl(); return control.snapshot(); });
ipcMain.handle("control:stop", () => { strategy.stop(); control.stop(); publishControl(); return control.snapshot(); });
ipcMain.handle("control:auto", (_event, enabled: boolean) => { control.setAutoTrade(Boolean(enabled)); publishControl(); return control.snapshot(); });
ipcMain.handle("control:quantity", (_event, quantity: number) => { control.setOrderQuantity(quantity); publishControl(); return control.snapshot(); });

app.whenReady().then(() => {
  initializeRuntime();
  createWindow();
  stream.start();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  stream?.stop();
  if (process.platform !== "darwin") app.quit();
});
