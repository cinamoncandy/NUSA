import { contextBridge, ipcRenderer } from "electron";
import type { AiCioDashboardReadResult } from "../../../packages/contracts/src/aiCioDashboard";
import type { AiCioCommandCenterEnvelopeV1 } from "./ai/aiCioCommandCenterAdapter";
import type { ControlSnapshot } from "./control/controlPlane";
import type { PaperAccountSnapshot, PaperOrder, PaperSide } from "./paper/paperBroker";
import type { UpbitTicker } from "./exchange/upbitWebSocket";
import type { OperationalPreflightState } from "./paper/paperOperationalPreflight";
import type { A4RuntimeDiagnostics } from "./diagnostics/a4RuntimeDiagnostics";
import type { AiSignalExplanation, AiSignalFollowUpAnswer } from "./ai/aiSignalExplainer";
import type { AiSessionSummary } from "./ai/aiSessionSummary";
import type { AiRegimeExplanation } from "./ai/aiRegimeExplainer";
import type { AiRiskCommentary } from "./ai/aiRiskCommentary";
import type { AiChallengerObservation } from "./ai/aiChallengerObserver";
import type { AiDisagreementExplanation } from "./ai/aiChallengerDisagreementExplainer";

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

export interface KillSwitchResult { readonly killSwitchActive: boolean; }

export interface NUSAApi {
  placeOrder(side: PaperSide, quantity: number): Promise<{ order: PaperOrder; snapshot: PaperAccountSnapshot }>;
  getSnapshot(): Promise<PaperAccountSnapshot | null>;
  getPreflight(): Promise<OperationalPreflightState>;
  getA4Diagnostics(): Promise<A4RuntimeDiagnostics>;
  getControlSnapshot(): Promise<ControlSnapshot>;
  getRiskBudgetUsage(): Promise<Readonly<Record<string, unknown>> | null>;
  startStrategy(): Promise<ControlSnapshot>;
  stopStrategy(): Promise<ControlSnapshot>;
  setAutoTrade(enabled: boolean): Promise<ControlSnapshot>;
  setStrategyQuantity(quantity: number): Promise<ControlSnapshot>;
  /**
   * WO-0019. `confirmationText` must be exactly "PAPER TRADING ENABLE" -- the main process
   * re-validates this itself and rejects anything else, so this is not merely a UI hint.
   */
  releaseKillSwitch(confirmationText: string, reason: string): Promise<KillSwitchResult>;
  activateKillSwitch(reason: string): Promise<KillSwitchResult>;
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

/**
 * The legacy main process still emits local paper:snapshot events for explicit local
 * simulation internals. CLOUD_PAPER never subscribes to that channel because doing so
 * would overwrite canonical Cloud account truth with a second state owner.
 */
const subscribeCloudPaperSnapshot = (handler: (snapshot: PaperAccountSnapshot) => void): (() => void) => {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async (): Promise<void> => {
    if (!active) return;
    try {
      const snapshot = await invokeReadWithRecovery<PaperAccountSnapshot | null>("cloud-paper:snapshot");
      if (active && snapshot != null) handler(snapshot);
    } catch {
      // Refresh is best-effort only. Cloud failure must never become a local broker fallback.
    } finally {
      if (active) timer = setTimeout(() => { void poll(); }, 2_000);
    }
  };
  void poll();
  return () => {
    active = false;
    if (timer !== undefined) clearTimeout(timer);
  };
};

const automaticUnavailable = <T>(): Promise<T> => invokeMutation<T>("cloud-paper:automatic-unavailable");

const api: NUSAApi = {
  placeOrder: (side, quantity) => invokeMutation("cloud-paper:order", { side, quantity }),
  getSnapshot: () => invokeReadWithRecovery("cloud-paper:snapshot"),
  getPreflight: () => invokeReadWithRecovery<OperationalPreflightState>("paper:preflight"),
  getA4Diagnostics: () => invokeReadWithRecovery<A4RuntimeDiagnostics>("diagnostics:a4"),
  getControlSnapshot: () => invokeReadWithRecovery("control:snapshot"),
  getRiskBudgetUsage: () => invokeReadWithRecovery("paper:risk-budget-usage"),
  // Automatic strategy execution is deliberately deferred until the serialized successor
  // moves strategy commands through the same Cloud canonical approval/risk boundary.
  startStrategy: () => automaticUnavailable<ControlSnapshot>(),
  stopStrategy: () => invokeMutation("control:stop"),
  setAutoTrade: (enabled) => enabled ? automaticUnavailable<ControlSnapshot>() : invokeMutation("control:auto", false),
  setStrategyQuantity: (_quantity) => automaticUnavailable<ControlSnapshot>(),
  releaseKillSwitch: (confirmationText, reason) => invokeMutation("safety:kill-switch-release", { confirmationText, reason }),
  activateKillSwitch: (reason) => invokeMutation("safety:kill-switch-activate", { reason }),
  onTicker: (handler) => subscribe("market:ticker", handler),
  onStatus: (handler) => subscribe("market:status", handler),
  onSnapshot: (handler) => subscribeCloudPaperSnapshot(handler),
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
  observability(): Promise<unknown>;
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
  status: () => invokeReadWithRecovery("shadow:status"),
  observability: () => invokeReadWithRecovery("shadow:observability", {})
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
 * Cloud PAPER provisioning happens before this preload loads. The existing stable-user
 * bearer stays in the Electron main-process session closure and never crosses this bridge.
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

/**
 * Read-only research assistant bridge. `explainLatestSignal` takes no arguments the
 * renderer can shape -- the main process derives the signal and history it explains
 * from state it already holds. `askFollowUpQuestion` is the one method here that does
 * take renderer-authored content, because a free-text question IS the input; the main
 * process still supplies all the grounding context (signal/history/prices) itself, and
 * the answer is scoped to the explanation already on screen, not a fresh channel choice.
 */
export interface AiResearchApi {
  explainLatestSignal(): Promise<AiSignalExplanation>;
  askFollowUpQuestion(question: string): Promise<AiSignalFollowUpAnswer>;
  summarizeSession(): Promise<AiSessionSummary>;
  explainRegime(): Promise<AiRegimeExplanation>;
  explainRisk(): Promise<AiRiskCommentary>;
}

const aiResearch: AiResearchApi = Object.freeze({
  explainLatestSignal: () => invokeReadWithRecovery<AiSignalExplanation>("ai:explain-latest-signal"),
  askFollowUpQuestion: (question: string) => invokeReadWithRecovery<AiSignalFollowUpAnswer>("ai:ask-followup-question", question),
  summarizeSession: () => invokeReadWithRecovery<AiSessionSummary>("ai:summarize-session"),
  explainRegime: () => invokeReadWithRecovery<AiRegimeExplanation>("ai:explain-regime"),
  explainRisk: () => invokeReadWithRecovery<AiRiskCommentary>("ai:explain-risk")
});

/**
 * Read-only AI challenger status bridge. One method, no arguments -- `latest` is whatever
 * the main process has already observed by comparing the AI's hypothetical signal against
 * the champion strategy's real signal. There is no method here shaped like a trading action.
 */
export interface AiChallengerStatus {
  readonly configured: boolean;
  readonly latest: AiChallengerObservation | null;
  readonly stats: Readonly<{ totalObservations: number; agreementCount: number; agreementRate: number | null }>;
}

export interface AiChallengerApi {
  status(): Promise<AiChallengerStatus>;
  explainDisagreement(): Promise<AiDisagreementExplanation>;
  history(): Promise<readonly AiChallengerObservation[]>;
}

const aiChallenger: AiChallengerApi = Object.freeze({
  status: () => invokeReadWithRecovery<AiChallengerStatus>("ai:challenger-status"),
  explainDisagreement: () => invokeReadWithRecovery<AiDisagreementExplanation>("ai:explain-challenger-disagreement"),
  history: () => invokeReadWithRecovery<readonly AiChallengerObservation[]>("ai:challenger-history")
});

contextBridge.exposeInMainWorld("nusa", api);
contextBridge.exposeInMainWorld("nusaApp", nusaApp);
contextBridge.exposeInMainWorld("aiCioDashboard", aiCioDashboard);
contextBridge.exposeInMainWorld("shadowPilot", shadowPilot);
contextBridge.exposeInMainWorld("recoveryReview", recoveryReview);
contextBridge.exposeInMainWorld("operations", operations);
contextBridge.exposeInMainWorld("aiChallenger", aiChallenger);
contextBridge.exposeInMainWorld("aiResearch", aiResearch);
