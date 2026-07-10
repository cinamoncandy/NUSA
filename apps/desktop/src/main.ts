import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { PaperBroker, type PaperSide } from "./paperBroker";
import { UpbitWebSocketClient, type UpbitTicker } from "./upbitWebSocket";

const MARKET = "KRW-BTC";
let window: BrowserWindow | undefined;
let latestTicker: UpbitTicker | undefined;
const broker = new PaperBroker(10_000_000, MARKET);
const stream = new UpbitWebSocketClient(
  MARKET,
  (ticker) => {
    latestTicker = ticker;
    window?.webContents.send("market:ticker", ticker);
    window?.webContents.send("paper:snapshot", broker.snapshot(ticker.trade_price));
  },
  (status) => window?.webContents.send("market:status", status)
);

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
  window.loadFile(path.join(__dirname, "../renderer/index.html"));
  window.on("closed", () => { window = undefined; });
}

ipcMain.handle("paper:order", (_event, input: { side: PaperSide; quantity: number }) => {
  if (!latestTicker) throw new Error("market price is not available yet");
  const order = broker.execute(input.side, input.quantity, latestTicker.trade_price);
  return { order, snapshot: broker.snapshot(latestTicker.trade_price) };
});

ipcMain.handle("paper:snapshot", () => {
  if (!latestTicker) return null;
  return broker.snapshot(latestTicker.trade_price);
});

app.whenReady().then(() => {
  createWindow();
  stream.start();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  stream.stop();
  if (process.platform !== "darwin") app.quit();
});
