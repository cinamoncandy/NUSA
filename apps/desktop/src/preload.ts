import { contextBridge, ipcRenderer } from "electron";
import type { PaperAccountSnapshot, PaperOrder, PaperSide } from "./paperBroker";
import type { UpbitTicker } from "./upbitWebSocket";

export interface DokkaebiApi {
  placeOrder(side: PaperSide, quantity: number): Promise<{ order: PaperOrder; snapshot: PaperAccountSnapshot }>;
  getSnapshot(): Promise<PaperAccountSnapshot | null>;
  onTicker(handler: (ticker: UpbitTicker) => void): () => void;
  onStatus(handler: (status: string) => void): () => void;
  onSnapshot(handler: (snapshot: PaperAccountSnapshot) => void): () => void;
}

const api: DokkaebiApi = {
  placeOrder: (side, quantity) => ipcRenderer.invoke("paper:order", { side, quantity }),
  getSnapshot: () => ipcRenderer.invoke("paper:snapshot"),
  onTicker: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, ticker: UpbitTicker) => handler(ticker);
    ipcRenderer.on("market:ticker", listener);
    return () => ipcRenderer.removeListener("market:ticker", listener);
  },
  onStatus: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, status: string) => handler(status);
    ipcRenderer.on("market:status", listener);
    return () => ipcRenderer.removeListener("market:status", listener);
  },
  onSnapshot: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: PaperAccountSnapshot) => handler(snapshot);
    ipcRenderer.on("paper:snapshot", listener);
    return () => ipcRenderer.removeListener("paper:snapshot", listener);
  }
};

contextBridge.exposeInMainWorld("dokkaebi", api);
