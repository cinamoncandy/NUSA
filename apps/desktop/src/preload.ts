import { contextBridge, ipcRenderer } from "electron";
import { AI_CIO_DASHBOARD_CHANNEL, type AiCioDashboardReadResult } from "../../../packages/contracts/src/aiCioDashboard";
import type { AiCioCommandCenterEnvelopeV1 } from "./aiCioCommandCenterAdapter";
import type { ControlSnapshot } from "./controlPlane";
import type { PaperAccountSnapshot, PaperOrder, PaperSide } from "./paperBroker";
import type { UpbitTicker } from "./upbitWebSocket";
import { retryWithTimeout } from "./recovery";

export interface ChartPoint { time: number; value: number; }

export interface DokkaebiApi {
  placeOrder(side: PaperSide, quantity: number): Promise<{ order: PaperOrder; snapshot: PaperAccountSnapshot }>;
  getSnapshot(): Promise<PaperAccountSnapshot | null>;
  getControlSnapshot(): Promise<ControlSnapshot>;
  startStrategy(): Promise<ControlSnapshot>;
  stopStrategy(): Promise<ControlSnapshot>;
  setAutoTrade(enabled: boolean): Promise<ControlSnapshot>;
  setStrategyQuantity(quantity: number): Promise<ControlSnapshot>;
  onTicker(handler: (ticker: UpbitTicker) => void): () => void;
  onStatus(handler: (status: string) => void): () => void;
  onSnapshot(handler: (snapshot: PaperAccountSnapshot) => void): () => void;
  onControl(handler: (snapshot: ControlSnapshot) => void): () => void;
  onChartPoint(handler: (point: ChartPoint) => void): () => void;
}

const subscribe = <T>(channel: string, handler: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => handler(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const invokeWithRecovery = <T>(channel: string, ...args: readonly unknown[]): Promise<T> =>
  retryWithTimeout(() => ipcRenderer.invoke(channel, ...args) as Promise<T>, { timeoutMs: 3_000, maximumAttempts: 3 });

const api: DokkaebiApi = {
  placeOrder: (side, quantity) => invokeWithRecovery("paper:order", { side, quantity }),
  getSnapshot: () => invokeWithRecovery("paper:snapshot"),
  getControlSnapshot: () => invokeWithRecovery("control:snapshot"),
  startStrategy: () => invokeWithRecovery("control:start"),
  stopStrategy: () => invokeWithRecovery("control:stop"),
  setAutoTrade: (enabled) => invokeWithRecovery("control:auto", enabled),
  setStrategyQuantity: (quantity) => invokeWithRecovery("control:quantity", quantity),
  onTicker: (handler) => subscribe("market:ticker", handler),
  onStatus: (handler) => subscribe("market:status", handler),
  onSnapshot: (handler) => subscribe("paper:snapshot", handler),
  onControl: (handler) => subscribe("control:snapshot", handler),
  onChartPoint: (handler) => subscribe("chart:point", handler)
};

export interface AiCioDashboardApi {
  getAiCioDashboard(): Promise<AiCioDashboardReadResult<AiCioCommandCenterEnvelopeV1>>;
}

const aiCioDashboard: AiCioDashboardApi = Object.freeze({
  getAiCioDashboard: () => invokeWithRecovery<AiCioDashboardReadResult<AiCioCommandCenterEnvelopeV1>>(AI_CIO_DASHBOARD_CHANNEL)
});

contextBridge.exposeInMainWorld("dokkaebi", api);
contextBridge.exposeInMainWorld("aiCioDashboard", aiCioDashboard);
