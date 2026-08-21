import type { IpcMain } from "electron";
import type { PaperBroker } from "../paper/paperBroker";
import type { ControlPlane } from "../control/controlPlane";
import type { RuntimeCommandService } from "../control/runtimeCommandService";
import type { PaperApprovalService } from "../paper/paperApprovalService";
import type { ShadowOperationalRuntime } from "../shadow/shadowOperationalRuntime";
import type { RecoveryReviewState, compareRecoveryState } from "../recovery/recoveryReconciliation";
import type { OperationalPreflightState } from "../paper/paperOperationalPreflight";
import type { SqliteDurableExecutionRepository } from "../../../../packages/storage/src/durable-execution";
import type { DesktopPersistenceStore, OperationsAlertRecord, OperationsAuditRecord } from "../persistence/desktopPersistenceStore";
import type { UpbitTicker, UpbitWebSocketClient } from "../exchange/upbitWebSocket";
import type { StrategyEngine, SmaCrossoverStrategy } from "../strategy/strategyEngine";
import type { AiSignalExplainerClient, SignalExplanationRequest } from "../ai/aiSignalExplainer";
import type { AiChallengerObserver, AiChallengerClient } from "../ai/aiChallengerObserver";
import type { AiDisagreementExplainerClient } from "../ai/aiChallengerDisagreementExplainer";
import type { AiSessionSummaryClient } from "../ai/aiSessionSummary";
import type { AiRegimeExplainerClient } from "../ai/aiRegimeExplainer";
import type { AiRiskCommentaryClient } from "../ai/aiRiskCommentary";
import type { InMemoryAiCioEnvelopeSource } from "../ai/aiCioIpcBridge";
import type { UserDataLayout } from "../userDataLayout";
import type { AppSettingsStore } from "../appSettingsStore";
import type { FirstRunNoticeStore } from "../firstRunNotice";
import type { AppLogger } from "../appLogger";
import type { AboutInfo } from "../aboutInfo";
import type { ProductionPolicy } from "../productionHardening";
import type { ShutdownSequence } from "../shutdownSequence";
import type { CrashRecoveryDiagnostic } from "../crashRecoveryMarker";
import type { CanonicalRiskDecision } from "../../../../packages/contracts/src/risk-safety-integration";
import type { SqliteRiskEvidenceRepository } from "../../../../packages/storage/src/risk-evidence";

/**
 * The desktop main process' shared mutable runtime state, as a proxy over main.ts's own
 * module-level bindings. Every property here is a live getter/setter into main.ts, not a copy
 * -- constructing this object introduces no new state and no snapshot-staleness risk: reading
 * `ctx.broker` after main.ts reassigns `broker` (e.g. on initializeRuntime()) always observes
 * the current value, exactly as the inline handler bodies this replaces did.
 *
 * This exists so the ~45 ipcMain handlers that used to be inlined in main.ts can live in
 * per-domain files (see registerPaperIpcHandlers.ts and its siblings) without each one
 * reaching back into main.ts's module scope directly.
 */
export interface RuntimeContext {
  readonly ipcMain: IpcMain;

  // --- Constants (never reassigned; still routed through ctx so handler modules import one
  // thing instead of duplicating these literals). ---
  readonly MARKET: string;
  readonly PAPER_SAFETY_FINGERPRINTS: Readonly<Record<string, string>>;
  readonly PAPER_SAFETY_SOURCE_COMMIT: string;
  readonly productRunId: string;

  // --- Core trading state ---
  readonly broker: PaperBroker;
  readonly control: ControlPlane;
  readonly runtime: RuntimeCommandService;
  readonly strategy: StrategyEngine;
  readonly smaStrategy: SmaCrossoverStrategy;
  readonly stream: UpbitWebSocketClient;
  readonly latestTicker: UpbitTicker | undefined;
  paperTradingAvailable: boolean;
  readonly operationalPreflight: OperationalPreflightState;
  readonly lastRiskBudgetUsage: any | undefined;
  readonly executionRepository: SqliteDurableExecutionRepository | undefined;
  readonly paperApprovalService: PaperApprovalService | undefined;
  currentStrategyApprovalId: string | undefined;
  readonly marketDataStatus: string;
  readonly websocketConnected: boolean;
  readonly rendererHealthy: boolean;

  // --- Kill switch / safety-critical persisted facts ---
  persistedKillSwitchActive: boolean;
  persistedKillSwitchReason: string | null;
  persistedKillSwitchActivatedAt: number | null;
  readonly persistedOpenP0Codes: readonly string[];
  readonly lastCanonicalRiskDecision: CanonicalRiskDecision;

  // --- AI research assistants (dark-by-default; undefined when ANTHROPIC_API_KEY unset) ---
  readonly aiSignalExplainerClient: AiSignalExplainerClient | undefined;
  lastAiSignalExplanation: Readonly<{ request: SignalExplanationRequest; explanation: string }> | undefined;
  readonly aiChallengerClient: AiChallengerClient | undefined;
  readonly aiChallengerObserver: AiChallengerObserver;
  readonly aiDisagreementExplainerClient: AiDisagreementExplainerClient | undefined;
  readonly aiSessionSummaryClient: AiSessionSummaryClient | undefined;
  readonly aiRegimeExplainerClient: AiRegimeExplainerClient | undefined;
  readonly aiRiskCommentaryClient: AiRiskCommentaryClient | undefined;
  readonly aiCioEnvelopeSource: InMemoryAiCioEnvelopeSource;
  governedAiAssistantCall<TResponse>(
    assistantId: "SIGNAL_EXPLAINER" | "SESSION_SUMMARY" | "REGIME_EXPLAINER" | "RISK_COMMENTARY",
    requestForHash: unknown,
    fallback: (reason: "RATE_LIMITED") => TResponse,
    invoke: () => Promise<TResponse>
  ): Promise<TResponse>;

  // --- Shadow observation runtime ---
  readonly shadowRuntime: ShadowOperationalRuntime;
  lastEvidenceId: string | null;
  readonly diagnosticsEvidenceRoot: string;
  readonly shadowIncompleteEvidence: readonly string[];
  readonly shadowEvidenceScanBlocked: boolean;

  // --- Recovery ---
  readonly recoveryReview: RecoveryReviewState;
  readonly recoveryRecordId: string | null;
  readonly crashRecoveryRequired: boolean;
  readonly crashRecoveryDiagnostic: CrashRecoveryDiagnostic;
  buildRecoveryComparison(): ReturnType<typeof compareRecoveryState>;

  // --- Persistence / operations ---
  readonly persistenceStore: DesktopPersistenceStore | undefined;
  readonly paperRiskEvidenceRepository: SqliteRiskEvidenceRepository | undefined;
  readonly operationsAudit: readonly OperationsAuditRecord[];
  readonly operationsAlerts: readonly OperationsAlertRecord[];

  // --- Product/app shell ---
  readonly userDataLayout: UserDataLayout | undefined;
  readonly settingsStore: AppSettingsStore | undefined;
  readonly firstRunStore: FirstRunNoticeStore | undefined;
  readonly appLogger: AppLogger | undefined;
  readonly aboutInfo: AboutInfo | undefined;
  readonly productionPolicy: ProductionPolicy;
  readonly shutdownSequence: ShutdownSequence | undefined;
  readonly recentErrorCodes: readonly string[];

  // --- Shared helper functions, defined once in main.ts, referenced (never re-implemented)
  // by the extracted handler modules. ---
  publishControl(): void;
  publishPaper(): void;
  publishAiCioDashboard(): void;
  runControlCommand(command: () => void): ReturnType<ControlPlane["snapshot"]>;
  assertFreshMarketData(): UpbitTicker;
  requireLayout(): UserDataLayout;
  logProduct(level: "DEBUG" | "INFO" | "WARN" | "ERROR", message: string, detail?: Readonly<Record<string, unknown>>, errorCode?: string): void;
  recordKillSwitchAudit(action: "KILL_SWITCH_RELEASED" | "KILL_SWITCH_ACTIVATED", reason: string, previousState: boolean, newState: boolean): void;
  saveSafety(paper: ReturnType<PaperBroker["exportState"]>, controlState: ReturnType<ControlPlane["exportState"]>): void;
  updateCrashMarker(): void;
  requireCurrentShadowSession(input: unknown): void;
}
