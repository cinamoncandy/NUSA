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

const invokeReadWithRecovery = <T>(channel: string, ...args: readonly unknown[]): Promise<T> =>
  retryWithTimeout(() => ipcRenderer.invoke(channel, ...args) as Promise<T>, { timeoutMs: 3_000, maximumAttempts: 3 });

// Mutations are intentionally never retried automatically. A timed-out command may
// already have committed in the main process; replaying it could duplicate an order
// or repeat a control transition.
const invokeMutation = <T>(channel: string, ...args: readonly unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: DokkaebiApi = {
  placeOrder: (side, quantity) => invokeMutation("paper:order", { side, quantity }),
  getSnapshot: () => invokeReadWithRecovery("paper:snapshot"),
  getControlSnapshot: () => invokeReadWithRecovery("control:snapshot"),
  startStrategy: () => invokeMutation("control:start"),
  stopStrategy: () => invokeMutation("control:stop"),
  setAutoTrade: (enabled) => invokeMutation("control:auto", enabled),
  setStrategyQuantity: (quantity) => invokeMutation("control:quantity", quantity),
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
  getAiCioDashboard: () => invokeReadWithRecovery<AiCioDashboardReadResult<AiCioCommandCenterEnvelopeV1>>(AI_CIO_DASHBOARD_CHANNEL)
});

contextBridge.exposeInMainWorld("dokkaebi", api);
contextBridge.exposeInMainWorld("aiCioDashboard", aiCioDashboard);
