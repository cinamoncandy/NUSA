import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { PaperBroker, type PaperSide } from "./paperBroker";
import { PaperSessionStore } from "./paperSessionStore";
import { UpbitWebSocketClient, type UpbitTicker } from "./upbitWebSocket";

const MARKET = "KRW-BTC";
const INITIAL_CASH = 10_000_000;
const FEE_RATE = 0.0005;
let window: BrowserWindow | undefined;
let latestTicker: UpbitTicker | undefined;
let broker: PaperBroker;
let sessionStore: PaperSessionStore;
let stream: UpbitWebSocketClient;

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
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
  const restoredState = sessionStore.load();
  broker = new PaperBroker(
    INITIAL_CASH,
    MARKET,
    FEE_RATE,
    { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000 },
    restoredState
  );
  stream = new UpbitWebSocketClient(
    MARKET,
    (ticker) => {
      latestTicker = ticker;
      window?.webContents.send("market:ticker", ticker);
      window?.webContents.send("paper:snapshot", broker.snapshot(ticker.trade_price));
    },
    (status) => window?.webContents.send("market:status", status)
  );
}

ipcMain.handle("paper:order", (_event, input: { side: PaperSide; quantity: number }) => {
  if (!latestTicker) throw new Error("market price is not available yet");
  if (input.side !== "BUY" && input.side !== "SELL") throw new Error("invalid paper order side");
  const order = broker.execute(input.side, input.quantity, latestTicker.trade_price);
  sessionStore.save(broker.exportState());
  return { order, snapshot: broker.snapshot(latestTicker.trade_price) };
});

ipcMain.handle("paper:snapshot", () => latestTicker ? broker.snapshot(latestTicker.trade_price) : null);

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
