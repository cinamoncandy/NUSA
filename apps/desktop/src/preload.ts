import { contextBridge, ipcRenderer } from "electron";
import type { ControlSnapshot } from "./controlPlane";
import type { PaperAccountSnapshot, PaperOrder, PaperSide } from "./paperBroker";
import type { UpbitTicker } from "./upbitWebSocket";

export interface ChartPoint { time: number; value: number; }
export interface KillSwitchResult { readonly killSwitchActive: boolean; }

const AI_CIO_DASHBOARD_CHANNEL = "ai-cio:dashboard:get" as const;

async function retryWithTimeout<T>(operation: () => Promise<T>, timeoutMs = 3_000, maximumAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("IPC request timed out")), timeoutMs); })
      ]);
    } catch (error) {
      lastError = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("IPC request failed");
}

const invokeRead = <T>(channel: string, ...args: readonly unknown[]): Promise<T> =>
  retryWithTimeout(() => ipcRenderer.invoke(channel, ...args) as Promise<T>);
const invokeMutation = <T>(channel: string, ...args: readonly unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;
const subscribe = <T>(channel: string, handler: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => handler(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

function subscribeCloudPaperSnapshot(handler: (snapshot: PaperAccountSnapshot) => void): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async (): Promise<void> => {
    if (!active) return;
    try {
      const snapshot = await invokeRead<PaperAccountSnapshot | null>("cloud-paper:snapshot");
      if (active && snapshot != null) handler(snapshot);
    } catch {
      // Best-effort refresh only. Never fall back to the legacy local broker.
    } finally {
      if (active) timer = setTimeout(() => { void poll(); }, 2_000);
    }
  };
  void poll();
  return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
}

const automaticUnavailable = <T>(): Promise<T> => invokeMutation<T>("cloud-paper:automatic-unavailable");

const nusa = Object.freeze({
  placeOrder: (side: PaperSide, quantity: number): Promise<{ order: PaperOrder; snapshot: PaperAccountSnapshot }> =>
    invokeMutation("cloud-paper:order", { side, quantity }),
  getSnapshot: (): Promise<PaperAccountSnapshot | null> => invokeRead("cloud-paper:snapshot"),
  getPreflight: (): Promise<unknown> => invokeRead("paper:preflight"),
  getA4Diagnostics: (): Promise<unknown> => invokeRead("diagnostics:a4"),
  getControlSnapshot: (): Promise<ControlSnapshot> => invokeRead("control:snapshot"),
  getRiskBudgetUsage: (): Promise<Readonly<Record<string, unknown>> | null> => invokeRead("paper:risk-budget-usage"),
  // Automatic strategy execution stays fail-closed until the successor migration moves it
  // through Cloud canonical strategy approval/risk/execution.
  startStrategy: (): Promise<ControlSnapshot> => automaticUnavailable(),
  stopStrategy: (): Promise<ControlSnapshot> => invokeMutation("control:stop"),
  setAutoTrade: (enabled: boolean): Promise<ControlSnapshot> => enabled ? automaticUnavailable() : invokeMutation("control:auto", false),
  setStrategyQuantity: (_quantity: number): Promise<ControlSnapshot> => automaticUnavailable(),
  releaseKillSwitch: (confirmationText: string, reason: string): Promise<KillSwitchResult> => invokeMutation("safety:kill-switch-release", { confirmationText, reason }),
  activateKillSwitch: (reason: string): Promise<KillSwitchResult> => invokeMutation("safety:kill-switch-activate", { reason }),
  onTicker: (handler: (ticker: UpbitTicker) => void): (() => void) => subscribe("market:ticker", handler),
  onStatus: (handler: (status: string) => void): (() => void) => subscribe("market:status", handler),
  onSnapshot: (handler: (snapshot: PaperAccountSnapshot) => void): (() => void) => subscribeCloudPaperSnapshot(handler),
  onControl: (handler: (snapshot: ControlSnapshot) => void): (() => void) => subscribe("control:snapshot", handler),
  onChartPoint: (handler: (point: ChartPoint) => void): (() => void) => subscribe("chart:point", handler)
});

const aiCioDashboard = Object.freeze({
  getAiCioDashboard: (): Promise<unknown> => invokeRead(AI_CIO_DASHBOARD_CHANNEL)
});

const shadowPilot = Object.freeze({
  preflight: (): Promise<readonly string[]> => invokeRead("shadow:preflight"),
  start: (): Promise<unknown> => invokeMutation("shadow:start", { symbol: "KRW-BTC", strategyId: "sma-crossover", strategyVersion: "sma-crossover:closed-candle-1m-v1" }),
  pause: (sessionId: string): Promise<unknown> => invokeMutation("shadow:pause", { sessionId }),
  resume: (sessionId: string): Promise<unknown> => invokeMutation("shadow:resume", { sessionId }),
  stop: (sessionId: string): Promise<unknown> => invokeMutation("shadow:stop", { sessionId }),
  status: (): Promise<unknown> => invokeRead("shadow:status")
});

const recoveryReview = Object.freeze({
  status: (): Promise<unknown> => invokeRead("recovery:status"),
  reconcile: (): Promise<unknown> => invokeMutation("recovery:reconcile", {}),
  ownerReview: (): Promise<unknown> => invokeMutation("recovery:owner-review", { confirmed: true }),
  complete: (): Promise<unknown> => invokeMutation("recovery:complete", {})
});

const operations = Object.freeze({
  snapshot: (): Promise<Readonly<Record<string, unknown>>> => invokeRead("operations:snapshot"),
  listExecutions: (): Promise<readonly unknown[]> => invokeRead("execution:list"),
  getExecution: (executionId: string): Promise<unknown | null> => invokeRead("execution:get", executionId),
  listTransitions: (executionId: string): Promise<readonly unknown[]> => invokeRead("execution:transitions", executionId),
  listFills: (executionId: string): Promise<readonly unknown[]> => invokeRead("execution:fills", executionId),
  getExecutionHealth: (): Promise<Readonly<Record<string, unknown>>> => invokeRead("execution:health")
});

const nusaApp = Object.freeze({
  firstRun: (): Promise<unknown> => invokeRead("app:first-run"),
  acknowledgeFirstRun: (): Promise<unknown> => invokeMutation("app:first-run-acknowledge", { confirmed: true }),
  settings: (): Promise<unknown> => invokeRead("app:settings"),
  saveSettings: (value: unknown): Promise<unknown> => invokeMutation("app:settings-save", value),
  resetSettings: (): Promise<unknown> => invokeMutation("app:settings-reset", {}),
  about: (): Promise<unknown> => invokeRead("app:about"),
  openFolder: (folder: "LOGS" | "EVIDENCE" | "USER_DATA"): Promise<unknown> => invokeMutation("app:open-folder", { folder }),
  exportDiagnostics: (): Promise<unknown> => invokeMutation("app:export-diagnostics", {}),
  shutdownProgress: (): Promise<unknown> => invokeRead("app:shutdown-progress"),
  onShutdown: (listener: (progress: unknown) => void): void => {
    ipcRenderer.on("app:shutdown", (_event, progress: unknown) => listener(progress));
  }
});

const aiResearch = Object.freeze({
  explainLatestSignal: (): Promise<unknown> => invokeRead("ai:explain-latest-signal"),
  askFollowUpQuestion: (question: string): Promise<unknown> => invokeRead("ai:ask-followup-question", question),
  summarizeSession: (): Promise<unknown> => invokeRead("ai:summarize-session"),
  explainRegime: (): Promise<unknown> => invokeRead("ai:explain-regime"),
  explainRisk: (): Promise<unknown> => invokeRead("ai:explain-risk")
});

const aiChallenger = Object.freeze({
  status: (): Promise<unknown> => invokeRead("ai:challenger-status"),
  explainDisagreement: (): Promise<unknown> => invokeRead("ai:explain-challenger-disagreement"),
  history: (): Promise<readonly unknown[]> => invokeRead("ai:challenger-history")
});

contextBridge.exposeInMainWorld("nusa", nusa);
contextBridge.exposeInMainWorld("nusaApp", nusaApp);
contextBridge.exposeInMainWorld("aiCioDashboard", aiCioDashboard);
contextBridge.exposeInMainWorld("shadowPilot", shadowPilot);
contextBridge.exposeInMainWorld("recoveryReview", recoveryReview);
contextBridge.exposeInMainWorld("operations", operations);
contextBridge.exposeInMainWorld("aiChallenger", aiChallenger);
contextBridge.exposeInMainWorld("aiResearch", aiResearch);
