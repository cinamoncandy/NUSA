import { contextBridge, ipcRenderer } from "electron";
import type { AiCioDashboardReadResult } from "../../../packages/contracts/src/aiCioDashboard";
import type { AiCioCommandCenterEnvelopeV1 } from "./aiCioCommandCenterAdapter";
import type { ControlSnapshot } from "./controlPlane";
import type { PaperAccountSnapshot, PaperOrder, PaperSide } from "./paperBroker";
import type { UpbitTicker } from "./upbitWebSocket";
import type { OperationalPreflightState } from "./paperOperationalPreflight";
import type { A4RuntimeDiagnostics } from "./a4RuntimeDiagnostics";

export interface ChartPoint { time: number; value: number; }

// Keep this runtime value inside the sandbox preload bundle. Importing the contract source
// here makes Electron's sandbox resolver look outside the compiled preload tree and fail at
// startup. The main-process handler and the public contract intentionally use this exact
// immutable channel value; the type-only contract import above is erased by TypeScript.
const AI_CIO_DASHBOARD_CHANNEL = "ai-cio:dashboard:get" as const;

// Sandboxed preloads cannot resolve sibling CommonJS modules. Keep the small read retry
// primitive in this bundle; all domain/runtime imports above are type-only and are erased.
async function retryWithTimeout<T>(operation: () => Promise<T>, policy: Readonly<{ timeoutMs: number; maximumAttempts: number }>): Promise<T> {
  if (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0 || !Number.isSafeInteger(policy.maximumAttempts) || policy.maximumAttempts < 1) throw new Error("invalid retry policy");
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maximumAttempts; attempt += 1) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("IPC request timed out")), policy.timeoutMs); })
      ]);
    } catch (error) {
      lastError = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("IPC request failed");
}

export interface NUSAApi {
  placeOrder(side: PaperSide, quantity: number): Promise<{ order: PaperOrder; snapshot: PaperAccountSnapshot }>;
  getSnapshot(): Promise<PaperAccountSnapshot | null>;
  getPreflight(): Promise<OperationalPreflightState>;
  getA4Diagnostics(): Promise<A4RuntimeDiagnostics>;
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

const api: NUSAApi = {
  placeOrder: (side, quantity) => invokeMutation("paper:order", { side, quantity }),
  getSnapshot: () => invokeReadWithRecovery("paper:snapshot"),
  getPreflight: () => invokeReadWithRecovery<OperationalPreflightState>("paper:preflight"),
  getA4Diagnostics: () => invokeReadWithRecovery<A4RuntimeDiagnostics>("diagnostics:a4"),
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

/**
 * Shadow lifecycle bridge. Fixed method names only -- the renderer can never pass an
 * arbitrary IPC channel name, and start() always names the exact scope Shadow supports
 * (symbol/strategyId are literal constants here, re-validated again on the main-process
 * side by shadowIpcValidation.ts).
 */
export interface ShadowPilotApi {
  preflight(): Promise<readonly string[]>;
  start(): Promise<unknown>;
  pause(sessionId: string): Promise<unknown>;
  resume(sessionId: string): Promise<unknown>;
  stop(sessionId: string): Promise<unknown>;
  status(): Promise<unknown>;
}

export interface NUSAOperationsApi {
  snapshot(): Promise<Readonly<Record<string, unknown>>>;
  listExecutions(): Promise<readonly unknown[]>;
  getExecution(executionId: string): Promise<unknown | null>;
  listTransitions(executionId: string): Promise<readonly unknown[]>;
  listFills(executionId: string): Promise<readonly unknown[]>;
  getExecutionHealth(): Promise<Readonly<Record<string, unknown>>>;
}

const operations: NUSAOperationsApi = Object.freeze({
  snapshot: () => invokeReadWithRecovery<Readonly<Record<string, unknown>>>("operations:snapshot"),
  listExecutions: () => invokeReadWithRecovery<readonly unknown[]>("execution:list"),
  getExecution: (executionId: string) => invokeReadWithRecovery("execution:get", executionId),
  listTransitions: (executionId: string) => invokeReadWithRecovery<readonly unknown[]>("execution:transitions", executionId),
  listFills: (executionId: string) => invokeReadWithRecovery<readonly unknown[]>("execution:fills", executionId),
  getExecutionHealth: () => invokeReadWithRecovery<Readonly<Record<string, unknown>>>("execution:health")
});

const shadowPilot: ShadowPilotApi = Object.freeze({
  preflight: () => invokeReadWithRecovery<readonly string[]>("shadow:preflight"),
  start: () => invokeMutation("shadow:start", { symbol: "KRW-BTC", strategyId: "sma-crossover", strategyVersion: "sma-crossover:closed-candle-1m-v1" }),
  pause: (sessionId: string) => invokeMutation("shadow:pause", { sessionId }),
  resume: (sessionId: string) => invokeMutation("shadow:resume", { sessionId }),
  stop: (sessionId: string) => invokeMutation("shadow:stop", { sessionId }),
  status: () => invokeReadWithRecovery("shadow:status")
});

/**
 * WO-0034-A4H recovery reconciliation and owner review. Four fixed channels, nothing else.
 *
 * `ownerReview` takes no arguments the caller can shape: the renderer states only that the
 * owner clicked, and the main process derives the fingerprint, reviewer and timestamp from
 * state it already holds. A renderer able to name the fingerprint it was approving could
 * approve a comparison that never ran.
 */
export interface RecoveryReviewApi {
  status(): Promise<unknown>;
  reconcile(): Promise<unknown>;
  ownerReview(): Promise<unknown>;
  complete(): Promise<unknown>;
}

const recoveryReview: RecoveryReviewApi = Object.freeze({
  status: () => invokeReadWithRecovery("recovery:status"),
  // Read-only, but never auto-retried: each run records a new comparison, and a silent retry
  // would leave a second comparison in the audit trail that no owner asked for.
  reconcile: () => invokeMutation("recovery:reconcile", {}),
  ownerReview: () => invokeMutation("recovery:owner-review", { confirmed: true }),
  complete: () => invokeMutation("recovery:complete", {})
});

/**
 * WO-0034-A4O productization bridge. Ten fixed methods, no channel name the renderer can
 * shape.
 *
 * What is absent matters as much as what is here: no method accepts a secret of any kind, and
 * none can enable real execution or an authenticated endpoint. Those are not disabled behind
 * a flag -- the bridge has no such surface, so a compromised renderer has nothing to call.
 *
 * `openFolder` takes one of three KEYS, never a path. A renderer able to name a directory
 * would turn "open my logs" into "open anything on this machine, from the main process".
 */
export interface NUSAAppApi {
  firstRun(): Promise<unknown>;
  acknowledgeFirstRun(): Promise<unknown>;
  settings(): Promise<unknown>;
  saveSettings(value: unknown): Promise<unknown>;
  resetSettings(): Promise<unknown>;
  about(): Promise<unknown>;
  openFolder(folder: "LOGS" | "EVIDENCE" | "USER_DATA"): Promise<unknown>;
  exportDiagnostics(): Promise<unknown>;
  shutdownProgress(): Promise<unknown>;
  onShutdown(listener: (progress: unknown) => void): void;
}

const nusaApp: NUSAAppApi = Object.freeze({
  firstRun: () => invokeReadWithRecovery("app:first-run"),
  // A confirmation is a mutation: it is never retried on the user's behalf, because a retry
  // would record a second acknowledgement nobody clicked for.
  acknowledgeFirstRun: () => invokeMutation("app:first-run-acknowledge", { confirmed: true }),
  settings: () => invokeReadWithRecovery("app:settings"),
  saveSettings: (value: unknown) => invokeMutation("app:settings-save", value),
  resetSettings: () => invokeMutation("app:settings-reset", {}),
  about: () => invokeReadWithRecovery("app:about"),
  openFolder: (folder: "LOGS" | "EVIDENCE" | "USER_DATA") => invokeMutation("app:open-folder", { folder }),
  exportDiagnostics: () => invokeMutation("app:export-diagnostics", {}),
  shutdownProgress: () => invokeReadWithRecovery("app:shutdown-progress"),
  onShutdown: (listener: (progress: unknown) => void) => {
    // The payload is forwarded, never the Electron event object: handing the renderer an
    // IpcRendererEvent would hand it `sender`, and with it a way back into the main process.
    ipcRenderer.on("app:shutdown", (_event, progress: unknown) => listener(progress));
  }
});

contextBridge.exposeInMainWorld("nusa", api);
contextBridge.exposeInMainWorld("nusaApp", nusaApp);
contextBridge.exposeInMainWorld("aiCioDashboard", aiCioDashboard);
contextBridge.exposeInMainWorld("shadowPilot", shadowPilot);
contextBridge.exposeInMainWorld("recoveryReview", recoveryReview);
contextBridge.exposeInMainWorld("operations", operations);
