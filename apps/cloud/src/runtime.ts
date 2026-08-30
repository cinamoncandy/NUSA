import { buildMobileDashboardResponse } from "./mobileDashboardApi";
import { InMemoryCloudDashboardStateProvider, type CloudDashboardStateProvider } from "./cloudDashboardStateProvider";
import { readCloudRuntimeConfig, createSharedSecretTokenVerifier } from "./cloudRuntimeConfig";
import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";
import { DurableCloudDashboardStateProvider } from "./durableCloudDashboardStateProvider";
import { SqliteCloudDashboardSnapshotRepository, type CloudDashboardSnapshotRepository } from "./cloudDashboardSnapshotRepository";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, type PaperAccountRepository } from "./paperTradingExecutionLoop";
import { CloudPaperCanonicalRiskGateway } from "./cloudPaperCanonicalRiskGateway";
import { CloudPaperExecutionBoundary } from "./cloudPaperExecutionBoundary";
import { SqliteP0AlertRepository } from "./p0AlertRepository";
import fs from "node:fs";
import path from "node:path";
import { createShutdownController, type ShutdownController } from "./cloudRuntimeShutdown";
import { startCloudDashboardServer, type CloudDashboardServerHandle, type CloudReadinessSnapshot } from "./server";
import { CloudRuntimeDashboardHydrator } from "./cloudRuntimeDashboardHydrator";
import { UpbitWebSocketClient, type UpbitOrderBook, type UpbitTicker, type UpbitWebSocketOptions } from "./upbitWebSocket";
import { upbitTickerToIntelligenceObservation } from "./upbitTickerObservation";
import type { IntelligenceObservation } from "./marketIntelligenceFusion";
import type { ResearchRuntimeMarketDataTick } from "./researchRuntimeCoordinator";
import type { ResearchRecoveryResult } from "../../../packages/contracts/src/researchRecovery";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import {
  buildPersonalPaperOperationsSnapshot,
  type PersonalPaperMarketProjection,
  type PersonalPaperOperationsSnapshot,
  type PersonalPaperOrderProjection,
  type PersonalPaperPortfolioProjection,
  type PersonalPaperRuntimeHeartbeat
} from "../../../packages/contracts/src/personalPaperOperations";
import type { PersonalPaperOrderCommand, PersonalPaperOrderCommandResult } from "../../../packages/contracts/src/personalPaperOrderCommand";
import type { DashboardPrincipal } from "./mobileDashboardHttp";
import type { CloudAiRuntime } from "./ai/runtime";
import { AI_CALIBRATION_OUTCOME_DEFINITION_ID, attributionScope, createCloudAiRuntime } from "./ai/runtime";
import { projectAiReadOnly } from "./ai/projection";
import { buildCloudRuntimeAiEvidence, type CloudRuntimeAiP0State } from "./ai/cloudRuntimeEvidence";
import { InMemoryInvestmentAllocationSettingsRepository, SqliteInvestmentAllocationSettingsRepository, type InvestmentAllocationSettingsRepository } from "./cloudInvestmentAllocationSettings";
import { SqliteNusaUserAccessRepository } from "./operatorUserAccess";
import { DesktopSessionService } from "./desktopSessionService";
import { PaperLearningEventRecorder, paperLearningCycleId } from "./paperLearningObservability";
import { buildPaperLearningReadOnlyProjection } from "./paperLearningReadOnlyProjection";
import { readPaperRuntimeSupervisorProjection } from "./paperRuntimeSupervisorProjection";
import type { ShadowObservabilitySnapshot } from "../../../packages/contracts/src/shadowObservabilityReadOnly";
import { validateShadowObservabilitySnapshot } from "../../../packages/contracts/src/shadowObservabilityReadOnly";
import { createDormantLiveAuthority } from "./liveReadinessGate";
import {
  createLiveReadinessSourceProvider,
  type LiveReadinessProductionSourceSnapshot,
  type LiveReadinessSourceReaders,
} from "./liveReadinessSourceProvider";
import { RealReadOnlyEventRecorder } from "./realReadOnlyObservabilityPersistence";
import type { RealReadOnlyEvent, RealReadOnlyObservabilitySnapshot } from "../../../packages/contracts/src/realReadOnlyObservability";
import { readCloudRuntimeSafety, readPaperAutoLearningReadiness } from "./liveReadinessRuntimeReaders";
import { paperExecutionObservationId, PaperRealizedPeriodProducer, SqlitePaperRealizedPeriodRepository, type PaperRealizedPeriodCanonicalCloseInput, type PaperRealizedPeriodCloseInput, type PaperRealizedPeriodOpenInput, type PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";
import { readCanonicalPaperTickerBenchmark } from "./paperMarketBenchmark";
import { buildPaperObservedExecutionQuote, type PaperObservedExecutionQuote } from "./paperRuntimeExecutionCostEvidence";
import { SqlitePaperMarketObservationRepository } from "../../../packages/storage/src/paperMarketObservationRepository";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import { buildEvolutionLearningSupervisorSnapshot } from "./evolutionLearningSupervisorProjection";
import {
  createNusaEngineeringOperatingReadModel,
  type NusaEngineeringOperatingReadModel,
  type NusaEngineeringOperatingSnapshot,
  type NusaEngineeringOperatingSource,
} from "./engineeringOperatingReadModel";

export interface CloudRuntimeDashboardHydratorLike { hydrate(provider: CloudDashboardStateProvider, observations?: readonly IntelligenceObservation[]): void; }
export interface CloudRuntimeMarketDataClientLike { subscribe(markets: readonly string[]): void; start(): void; stop(): void; }
export interface CloudRuntimeResearchRuntimeLike { onMarketData(tick: ResearchRuntimeMarketDataTick): void; }
export interface CloudRuntimeResearchRecoveryLike { recover(): ResearchRecoveryResult; }
export interface CloudRuntimeResearchAutomationLike { recover?(): ResearchRecoveryResult; onMarketData(tick: ResearchRuntimeMarketDataTick): void; statusProjection?(): ResearchStatusProjection | null; }
export type CloudRuntimeMarketDataClientFactory = (markets: readonly string[], onTicker: (ticker: UpbitTicker) => void, onConnectionState: (state: string) => void, onOrderBook?: (orderBook: UpbitOrderBook) => void) => CloudRuntimeMarketDataClientLike;
export type CloudRuntimeShadowObservabilityProvider = (principal: DashboardPrincipal) => ShadowObservabilitySnapshot;
export type CloudRuntimeRealReadOnlyObservabilityProvider = (principal: DashboardPrincipal, events: readonly RealReadOnlyEvent[]) => RealReadOnlyObservabilitySnapshot;
export interface CloudRuntimeHandle extends CloudDashboardServerHandle {
  readonly getLiveReadinessSourceSnapshot: () => LiveReadinessProductionSourceSnapshot;
  readonly getEngineeringOperatingSnapshot: () => NusaEngineeringOperatingSnapshot;
  readonly recordRealReadOnlyEvent: (event: RealReadOnlyEvent) => RealReadOnlyEvent;
  readonly openPaperRealizedPeriod: (input: PaperRealizedPeriodOpenInput) => PersistedPaperRealizedPeriodPlan;
  readonly observePaperRealizedExecution: (observation: { readonly observationId: string; readonly observedAt: number; readonly status: "FILLED" | "WAIT" | "BLOCKED" | "REJECTED" | "FAILED" | "DUPLICATE" }) => "RECORDED" | "DUPLICATE" | "NO_ACTIVE_PERIOD";
  readonly closePaperRealizedPeriod: (input: PaperRealizedPeriodCloseInput) => PersistedPaperPeriodEnvelope;
  /** Canonical account-boundary path; no caller-supplied outcome metrics are accepted. */
  readonly openPaperRealizedPeriodFromCanonicalAccount: (input: PaperRealizedPeriodOpenInput) => PersistedPaperRealizedPeriodPlan;
  readonly closePaperRealizedPeriodFromCanonicalAccount: (input: PaperRealizedPeriodCanonicalCloseInput) => PersistedPaperPeriodEnvelope;
  readonly listPaperRealizedPeriods: () => readonly PersistedPaperPeriodEnvelope[];
}

function createSnapshotRepository(pathname: string): CloudDashboardSnapshotRepository {
  if (pathname !== ":memory:") {
    const absolute = path.resolve(pathname);
    const sourceTree = path.resolve(process.cwd()) + path.sep;
    if (absolute === path.resolve(process.cwd()) || absolute.startsWith(sourceTree)) throw new Error("cloud state database must not be inside the source tree");
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
  }
  return new SqliteCloudDashboardSnapshotRepository(new SqliteDatabase(pathname));
}

function buildReadOnlyPortfolio(paperSnapshot: ReturnType<PaperTradingExecutionLoop["snapshot"]> | undefined, fallbackMarket: PersonalPaperMarketProjection | undefined): PersonalPaperPortfolioProjection | null {
  if (paperSnapshot == null) return null;
  const positions = [...paperSnapshot.positions].sort((left, right) => left.market.localeCompare(right.market));
  const position = positions.find((item) => item.quantity > 0) ?? positions[0];
  const market = position?.market ?? fallbackMarket?.market ?? "";
  const markPrice = position?.markPrice ?? fallbackMarket?.price ?? 0;
  const assetValue = paperSnapshot.positions.reduce((sum, item) => sum + item.quantity * item.markPrice, 0);
  if (position != null && (!market || !Number.isFinite(markPrice) || markPrice <= 0)) return null;
  return { observedAt: new Date(paperSnapshot.updatedAt).toISOString(), mode: "PAPER", account: { available: true, cash: paperSnapshot.cash, equity: paperSnapshot.equity, unrealizedPnl: paperSnapshot.unrealizedPnL, assetValue, realizedPnl: paperSnapshot.realizedPnL, markPrice, position: position == null ? { market, quantity: 0, averagePrice: 0, realizedPnl: paperSnapshot.realizedPnL, unrealizedPnl: 0 } : { market: position.market, quantity: position.quantity, averagePrice: position.averageEntryPrice, realizedPnl: position.realizedPnL, unrealizedPnl: position.unrealizedPnL } }, openOrderCount: 0 };
}

function buildReadOnlyOrders(paperSnapshot: ReturnType<PaperTradingExecutionLoop["snapshot"]> | undefined): readonly PersonalPaperOrderProjection[] {
  if (paperSnapshot == null) return [];
  return paperSnapshot.orders.map((order) => ({ id: order.id, market: order.market, side: order.side, quantity: order.quantity, price: order.price, fee: order.fee, filledAt: new Date(order.filledAt).toISOString(), status: "FILLED" as const, fills: paperSnapshot.fills.filter((fill) => fill.orderId === order.id).map((fill) => ({ id: fill.id, quantity: fill.quantity, price: fill.price, filledAt: new Date(fill.filledAt).toISOString() })) }));
}

function buildCloudRuntimeReadiness(durableRepository: CloudDashboardSnapshotRepository | undefined, effectiveProvider: CloudDashboardStateProvider): CloudReadinessSnapshot {
  const failed = (): CloudReadinessSnapshot => Object.freeze({ ok: false, checks: Object.freeze({ database: false, migrations: false, dashboardPersistence: false, runtimeRecovery: false }) });
  if (!(durableRepository instanceof SqliteCloudDashboardSnapshotRepository)) return failed();
  try {
    const db = durableRepository.database();
    const quickCheck = db.connection.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
    const database = quickCheck != null && Object.values(quickCheck).includes("ok");
    const latestMigration = db.connection.prepare("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    const migrations = db.migrationResult.currentVersion !== undefined && String(latestMigration?.id ?? "") === db.migrationResult.currentVersion;
    const dashboardState = effectiveProvider.read({ userId: "operator", scopes: ["dashboard:read"] });
    const persistedSnapshot = durableRepository.loadLatest();
    const dashboardPersistence = dashboardState != null && persistedSnapshot != null;
    const corrupted = db.connection.prepare("SELECT COUNT(*) AS count FROM cloud_dashboard_snapshots WHERE status = 'CORRUPTED'").get() as Record<string, unknown> | undefined;
    const runtimeRecovery = persistedSnapshot != null && Number(corrupted?.count ?? 0) === 0;
    const checks = Object.freeze({ database, migrations, dashboardPersistence, runtimeRecovery });
    return Object.freeze({ ok: Object.values(checks).every(Boolean), checks });
  } catch { return failed(); }
}

export function startCloudRuntime(
  env: NodeJS.ProcessEnv = process.env,
  stateProvider: CloudDashboardStateProvider = new InMemoryCloudDashboardStateProvider(),
  dashboardHydrator: CloudRuntimeDashboardHydratorLike = new CloudRuntimeDashboardHydrator(),
  marketDataClientFactory: CloudRuntimeMarketDataClientFactory = (markets, onTicker, onConnectionState, onOrderBook) => new UpbitWebSocketClient(markets, onTicker, undefined, undefined, undefined, { onConnectionState: (diagnostics) => onConnectionState(diagnostics.marketConnectionState), onOrderBook } satisfies UpbitWebSocketOptions),
  snapshotRepository?: CloudDashboardSnapshotRepository,
  paperAccountRepository?: PaperAccountRepository,
  paperExecutionLoop?: PaperTradingExecutionLoop,
  researchRuntime?: CloudRuntimeResearchRuntimeLike,
  researchRecoveryCoordinator?: CloudRuntimeResearchRecoveryLike,
  researchAutomation?: CloudRuntimeResearchAutomationLike,
  aiRuntime?: CloudAiRuntime,
  shadowObservabilityProvider?: CloudRuntimeShadowObservabilityProvider,
  liveReadinessSourceReaders?: LiveReadinessSourceReaders,
  realReadOnlyObservabilityProvider?: CloudRuntimeRealReadOnlyObservabilityProvider,
  engineeringOperatingSource?: NusaEngineeringOperatingSource
): CloudRuntimeHandle {
  const config = readCloudRuntimeConfig(env);
  const paperSupervisor = readPaperRuntimeSupervisorProjection(env);
  const runtimeStartedAt = Date.now();
  const heartbeat: {
    startedAt: number;
    lastHeartbeatAt: number;
    lastMarketEventAt: number | null;
    lastPaperDecisionAt: number | null;
    lastPaperOrderAt: number | null;
    lastPaperFillAt: number | null;
    eventCount: number;
    decisionCount: number;
    paperOrderCount: number;
    paperFillCount: number;
    lastError: string | null;
  } = {
    startedAt: runtimeStartedAt,
    lastHeartbeatAt: runtimeStartedAt,
    lastMarketEventAt: null,
    lastPaperDecisionAt: null,
    lastPaperOrderAt: null,
    lastPaperFillAt: null,
    eventCount: 0,
    decisionCount: 0,
    paperOrderCount: 0,
    paperFillCount: 0,
    lastError: null
  };
  const readHeartbeat = (): PersonalPaperRuntimeHeartbeat => Object.freeze({ ...heartbeat });
  const tokenVerifier = createSharedSecretTokenVerifier(config.dashboardToken, env);
  const durableRepository = snapshotRepository ?? (env.NUSA_CLOUD_STATE_DB_PATH === undefined ? undefined : createSnapshotRepository(config.cloudStateDbPath));
  // This recorder observes the canonical PAPER boundary below. It is deliberately
  // downstream-only: it never submits orders or mutates runtime state.
  const paperLearningRecorder = new PaperLearningEventRecorder(
    durableRepository instanceof SqliteCloudDashboardSnapshotRepository
      ? { persistencePath: config.cloudStateDbPath }
      : {}
  );
  const realReadOnlyEventRecorder = new RealReadOnlyEventRecorder(
    durableRepository instanceof SqliteCloudDashboardSnapshotRepository ? { persistencePath: config.cloudStateDbPath } : {}
  );
  const paperMarketObservationRepository = durableRepository instanceof SqliteCloudDashboardSnapshotRepository
    ? new SqlitePaperMarketObservationRepository(durableRepository.database())
    : undefined;
  let effectivePaperLoop: PaperTradingExecutionLoop | undefined;
  const paperRealizedPeriodProducer = durableRepository instanceof SqliteCloudDashboardSnapshotRepository
    ? new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(durableRepository.database()), {
      onLifecycleEvent: (event) => paperLearningRecorder.record({
        cycleId: `paper-period:${event.periodId}`,
        stage: event.type,
        occurredAt: event.occurredAt,
        market: "PAPER_PERIOD",
        status: event.type === "PERIOD_REJECTED" ? "FAIL" : "PASS",
        ...(event.type === "PERIOD_REJECTED" ? { reason: event.reasonCode } : {}),
      }),
      readCanonicalPaperAccount: () => {
        const loop = effectivePaperLoop;
        if (loop == null) throw new Error("canonical PAPER account source is unavailable");
        return loop.snapshot();
      },
      ...(paperMarketObservationRepository == null ? {} : { readCanonicalBenchmarkEvidence: (periodStartAt: number, periodEndAt: number, market?: string) => readCanonicalPaperTickerBenchmark(paperMarketObservationRepository, market, periodStartAt, periodEndAt) }),
    })
    : undefined;
  const effectiveProvider = durableRepository == null ? stateProvider : new DurableCloudDashboardStateProvider(stateProvider, durableRepository, env.NUSA_SOURCE_COMMIT?.trim() || "unknown", env.NUSA_CLOUD_SOURCE_VERSION?.trim() || "unknown");
  const recovered = durableRepository != null && effectiveProvider instanceof DurableCloudDashboardStateProvider && effectiveProvider.recover();
  const durableAuthDatabase = durableRepository instanceof SqliteCloudDashboardSnapshotRepository ? durableRepository.database() : undefined;
  const loadEvolutionLearning = durableAuthDatabase == null
    ? undefined
    : () => buildEvolutionLearningSupervisorSnapshot(new SqliteEvolutionLearningLedger(durableAuthDatabase).replay());
  const userAccessRepository = durableAuthDatabase == null ? undefined : new SqliteNusaUserAccessRepository(durableAuthDatabase);
  const desktopSessionService = durableAuthDatabase == null || userAccessRepository == null ? undefined : new DesktopSessionService(durableAuthDatabase, userAccessRepository);
  const effectiveP0Repository = durableRepository instanceof SqliteCloudDashboardSnapshotRepository ? new SqliteP0AlertRepository(durableRepository.database()) : undefined;
  const investmentAllocationSettings: InvestmentAllocationSettingsRepository = durableRepository instanceof SqliteCloudDashboardSnapshotRepository
    ? new SqliteInvestmentAllocationSettingsRepository(durableRepository.database())
    : new InMemoryInvestmentAllocationSettingsRepository();
  const readPaperP0State = () => { if (effectiveP0Repository == null) throw new Error("P0 safety repository unavailable"); return effectiveP0Repository.readState(); };
  const readAiP0State = (): CloudRuntimeAiP0State => { if (effectiveP0Repository == null) return "UNAVAILABLE"; try { return effectiveP0Repository.readState().openP0 ? "OPEN" : "CLOSED"; } catch { return "UNVERIFIABLE"; } };
  const effectivePaperRepository = paperAccountRepository ?? (config.paperInitialCapitalKrw !== undefined && durableRepository instanceof SqliteCloudDashboardSnapshotRepository ? new SqliteCloudPaperAccountRepository(durableRepository.database()) : undefined);
  const productionPaperRiskGate = config.paperInitialCapitalKrw !== undefined && durableRepository instanceof SqliteCloudDashboardSnapshotRepository
    ? new CloudPaperCanonicalRiskGateway({ database: durableRepository.database(), initialCapital: config.paperInitialCapitalKrw, sourceCommitSha: env.NUSA_SOURCE_COMMIT?.trim() || env.GITHUB_SHA?.trim() || "local-paper-build" })
    : undefined;
  effectivePaperLoop = paperExecutionLoop ?? (config.paperInitialCapitalKrw === undefined || effectivePaperRepository === undefined ? undefined : new PaperTradingExecutionLoop({ initialCapital: config.paperInitialCapitalKrw, repository: effectivePaperRepository, readP0State: readPaperP0State }));
  const productionPaperBoundary = effectivePaperLoop != null && productionPaperRiskGate != null
    ? new CloudPaperExecutionBoundary({ loop: effectivePaperLoop, riskGate: productionPaperRiskGate, readP0State: readPaperP0State })
    : undefined;
  const operatorPrincipal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read"]) });
  const sourceCommit = env.NUSA_SOURCE_COMMIT?.trim() || env.GITHUB_SHA?.trim() || "";
  const sourceVersion = env.NUSA_CLOUD_SOURCE_VERSION?.trim() || "unknown";
  const engineeringOperatingReadModel: NusaEngineeringOperatingReadModel = createNusaEngineeringOperatingReadModel(engineeringOperatingSource);
  let marketConnectionState = config.upbitPublicDataEnabled ? "DISCONNECTED" : "DISABLED";
  const defaultLiveReadinessReaders: LiveReadinessSourceReaders = {
    ...liveReadinessSourceReaders,
    currentHeadSha: liveReadinessSourceReaders?.currentHeadSha ?? (() => sourceCommit),
    authority: liveReadinessSourceReaders?.authority ?? (() => Object.freeze({ value: createDormantLiveAuthority(), freshness: "FRESH" as const, fingerprint: "dormant-authority-v1" })),
    paperAutoLearning: liveReadinessSourceReaders?.paperAutoLearning ?? (() => readPaperAutoLearningReadiness({
      configured: effectivePaperLoop != null,
      publicMarketDataEnabled: config.upbitPublicDataEnabled,
      connectionState: marketConnectionState,
      state: effectiveProvider.read(operatorPrincipal),
      heartbeat: readHeartbeat(),
    }, Date.now())),
    runtimeSafety: liveReadinessSourceReaders?.runtimeSafety ?? (() => readCloudRuntimeSafety({
      state: effectiveProvider.read(operatorPrincipal),
      connectionState: marketConnectionState,
    })),
    shadowReplay: liveReadinessSourceReaders?.shadowReplay ?? (shadowObservabilityProvider == null ? undefined : (() => {
      try {
        const snapshot = validateShadowObservabilitySnapshot(shadowObservabilityProvider(operatorPrincipal));
        const value = snapshot.events.length === 0 ? "MISSING" as const : snapshot.blockers.length > 0 || ["HALTED", "FAILED", "INVALIDATED"].includes(snapshot.runtimeStatus) ? "INVALID" as const : "VALID" as const;
        return Object.freeze({ value, freshness: snapshot.marketFreshness, observedAt: new Date(snapshot.generatedAt).toISOString() });
      } catch {
        return Object.freeze({ value: "MISSING" as const, freshness: "UNKNOWN" as const });
      }
    })),
  };
  const liveReadinessSourceProvider = createLiveReadinessSourceProvider({ now: () => new Date().toISOString(), sourceVersion, readers: defaultLiveReadinessReaders });
  const effectiveResearchRuntime: CloudRuntimeResearchRuntimeLike | undefined = researchAutomation ?? researchRuntime;
  try { researchAutomation?.recover?.() ?? researchRecoveryCoordinator?.recover(); } catch { /* Research owns its fail-closed state. */ }
  const clearPaperProjection = (): void => { try { effectivePaperRepository?.clear(); } catch { /* remain fail-closed */ } effectiveProvider.clear(); };
  const projectPaperAccount = (): void => {
    if (effectivePaperLoop == null) return;
    const state = effectiveProvider.read({ userId: "operator", scopes: ["dashboard:read"] });
    if (state == null) { clearPaperProjection(); return; }
    try { effectiveProvider.set(effectivePaperLoop.applyToDashboard(state, Date.now())); } catch { clearPaperProjection(); }
  };
  try { if (!recovered) dashboardHydrator.hydrate(effectiveProvider); projectPaperAccount(); } catch { clearPaperProjection(); }
  const observations = new Map<string, IntelligenceObservation>();
  const latestTickers = new Map<string, PersonalPaperMarketProjection>();
  const latestExecutionQuotes = new Map<string, PaperObservedExecutionQuote>();
  const safeHydrate = (next: readonly IntelligenceObservation[]): void => { try { dashboardHydrator.hydrate(effectiveProvider, next); } catch { effectiveProvider.clear(); } };
  const marketDataClient = config.upbitPublicDataEnabled ? marketDataClientFactory(config.upbitMarkets, (ticker) => {
    heartbeat.lastHeartbeatAt = Date.now();
    heartbeat.lastMarketEventAt = ticker.trade_timestamp;
    heartbeat.eventCount += 1;
    latestTickers.set(ticker.code, { market: ticker.code, price: ticker.trade_price, changeRate: ticker.signed_change_rate ?? null, volume: ticker.acc_trade_volume ?? null, observedAt: new Date(ticker.trade_timestamp).toISOString(), source: "UPBIT_PUBLIC_TICKER" });
    try { paperMarketObservationRepository?.append({ market: ticker.code, observedAt: ticker.trade_timestamp, price: ticker.trade_price, signedChangeRate: ticker.signed_change_rate, accumulatedVolume: ticker.acc_trade_volume, accumulatedPrice: ticker.acc_trade_price_24h }); }
    catch { heartbeat.lastError = "PAPER_MARKET_OBSERVATION_REJECTED"; }
    const now = Date.now();
    const observation = upbitTickerToIntelligenceObservation(ticker, { now });
    if (!observation) { heartbeat.lastError = "PUBLIC_MARKET_EVENT_REJECTED"; safeHydrate([]); return; }
    observations.set(observation.id, observation); while (observations.size > 50) observations.delete(observations.keys().next().value!); safeHydrate([...observations.values()]);
    const researchTick = { market: ticker.code, price: ticker.trade_price, observedAt: ticker.trade_timestamp, now };
    try { effectiveResearchRuntime?.onMarketData(researchTick); } catch { /* isolated */ }
    const state = effectiveProvider.read({ userId: "operator", scopes: ["dashboard:read"] });
    if (state != null) {
      const dashboard = buildMobileDashboardResponse(state);
      try {
        const p0State = readAiP0State();
        const lessons = aiRuntime?.applicableLessons(attributionScope({ outcomeDefinitionId: AI_CALIBRATION_OUTCOME_DEFINITION_ID, targetId: ticker.code }), now) ?? [];
        const grounded = buildCloudRuntimeAiEvidence(ticker, { mode: dashboard.mode, killSwitchActive: dashboard.killSwitchActive, tradingAllowed: dashboard.tradingAllowed, overallHealth: dashboard.overallHealth, p0State, observedAt: now }, lessons);
        const orchestrationRunId = `cloud-ai:${ticker.code}:${ticker.trade_timestamp}:${grounded.identityHash.slice(0, 20)}`;
        aiRuntime?.schedule({ orchestrationRunId, decisionId: `${orchestrationRunId}:decision`, evaluatedAt: now, evidence: grounded.evidence, evidenceMaterializations: grounded.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1", "NUSA_DETERMINISTIC_SAFETY_V1"], certificationIds: [], controlPlaneStateId: `cloud:${dashboard.mode}:${dashboard.killSwitchActive ? "KILL" : "ACTIVE"}:${p0State}`, contextValidForMs: 120_000, learningProvenance: "AUTO_BACKGROUND" });
      } catch { /* advisory AI only */ }
      if (effectivePaperLoop != null) {
        const investmentPercent = investmentAllocationSettings.get(config.ownerId)?.investmentPercent ?? config.paperInvestmentPercent;
        const tick = { now, market: ticker.code, price: ticker.trade_price, observedAt: ticker.trade_timestamp, mode: state.mode, killSwitchActive: state.killSwitchActive, tradingAllowed: dashboard.tradingAllowed, overallHealth: state.overallHealth, decisions: state.decisions, investmentPercent, observedQuote: latestExecutionQuotes.get(ticker.code) };
        heartbeat.lastPaperDecisionAt = now;
        heartbeat.decisionCount += state.decisions.length;
        // A supplied loop is a read/recovery fixture unless it is composed behind the
        // canonical Cloud PAPER risk boundary. Never let dependency injection create a
        // second mutation path for strategy ticks.
        const result = productionPaperBoundary?.processTick(tick);
          if (result != null) {
          try { paperRealizedPeriodProducer?.observeExecution({ observationId: paperExecutionObservationId(ticker.code, ticker.trade_timestamp, result.status), observedAt: now, status: result.status }); } catch (error) { heartbeat.lastError = error instanceof Error ? "PAPER_PERIOD_EVIDENCE_REJECTED" : "PAPER_PERIOD_EVIDENCE_REJECTED"; }
          }
        const cycleId = paperLearningCycleId(ticker.code, ticker.trade_timestamp);
        const canonicalDecision = state.decisions.find((decision) => decision.symbol === ticker.code) ?? state.decisions[0];
        paperLearningRecorder.record({ cycleId, stage: "MARKET_DATA", occurredAt: ticker.trade_timestamp, market: ticker.code, status: "PASS", reason: `source=UPBIT_PUBLIC_TICKER;observedAt=${ticker.trade_timestamp}` });
        const decisionSupported = canonicalDecision != null && ["BUY", "SELL", "HOLD", "REDUCE", "INCREASE"].includes(canonicalDecision.action);
        paperLearningRecorder.record({ cycleId, stage: "DECISION", occurredAt: now, market: ticker.code, status: canonicalDecision == null ? "SKIP" : "PASS", reason: canonicalDecision == null ? "NO_CANONICAL_DECISION" : decisionSupported ? undefined : `UNSUPPORTED_ACTION:${canonicalDecision.action}`, ...(canonicalDecision == null ? {} : { decision: canonicalDecision }) });
        paperLearningRecorder.record({ cycleId, stage: "PERMISSION", occurredAt: now, market: ticker.code, status: "SKIP", reason: "NO_CANONICAL_TRADE_PERMISSION_EVIDENCE" });
        if (result != null) {
          if (result.orders.length > 0) heartbeat.lastPaperOrderAt = now;
          if (result.fills.length > 0) heartbeat.lastPaperFillAt = now;
          heartbeat.paperOrderCount += result.orders.length;
          heartbeat.paperFillCount += result.fills.length;
          if (result.status === "FAILED") heartbeat.lastError = result.reason ?? "PAPER_EXECUTION_FAILED";
          const intentStatus = result.status === "FILLED" ? "PASS" : result.status === "WAIT" ? "SKIP" : "FAIL";
          if (result.risk != null) paperLearningRecorder.record({ cycleId, stage: "RISK", occurredAt: now, market: ticker.code, status: result.risk.status === "ALLOW" ? "PASS" : "FAIL", reason: result.risk.reasonCodes.join(",") || result.risk.status });
          paperLearningRecorder.record({ cycleId, stage: "ORDER_INTENT", occurredAt: now, market: ticker.code, status: intentStatus, reason: result.reason ?? result.status });
          if (result.status === "DUPLICATE") paperLearningRecorder.record({ cycleId, stage: "IDEMPOTENCY", occurredAt: now, market: ticker.code, status: "SKIP", reason: result.reason ?? "PAPER_DUPLICATE" });
          for (const fill of result.fills) paperLearningRecorder.record({ cycleId, stage: "FILL", occurredAt: fill.filledAt, market: ticker.code, status: "PASS", fill, idSuffix: fill.id });
          paperLearningRecorder.record({ cycleId, stage: "PNL", occurredAt: now, market: ticker.code, status: "PASS", account: result.state, reason: `cash:${result.state.cash};equity:${result.state.equity};realizedPnL:${result.state.realizedPnL};unrealizedPnL:${result.state.unrealizedPnL}` });
          if (result.status === "FILLED") paperLearningRecorder.record({ cycleId, stage: "LEARNING", occurredAt: now, market: ticker.code, status: "PASS", reason: "PAPER_OUTCOME_AVAILABLE" });
        }
        // Missing boundary means no strategy mutation; retain a verified read projection so
        // recovery/fixtures remain observable without turning the loop into a writer.
        if (result != null && result.status === "FAILED") clearPaperProjection(); else projectPaperAccount();
      }
    } else if (effectivePaperLoop != null) clearPaperProjection();
  }, (state) => {
    heartbeat.lastHeartbeatAt = Date.now();
    marketConnectionState = state;
    heartbeat.lastError = state === "CONNECTED" ? null : `PUBLIC_MARKET_${state}`;
    if (state !== "CONNECTED") { observations.clear(); latestTickers.clear(); latestExecutionQuotes.clear(); safeHydrate([]); }
  }, (orderBook) => {
    heartbeat.lastHeartbeatAt = Date.now();
    try {
      const quote = buildPaperObservedExecutionQuote({ market: orderBook.code, observedAt: Date.now(), totalAskSize: orderBook.total_ask_size, totalBidSize: orderBook.total_bid_size, units: orderBook.orderbook_units.map((unit) => ({ askPrice: unit.ask_price, bidPrice: unit.bid_price, askSize: unit.ask_size, bidSize: unit.bid_size })) });
      latestExecutionQuotes.set(quote.market, quote);
    } catch { heartbeat.lastError = "PAPER_ORDERBOOK_OBSERVATION_REJECTED"; }
  }) : undefined;
  if (marketDataClient) { marketDataClient.subscribe(config.upbitMarkets); marketDataClient.start(); }
  const heartbeatTimer = setInterval(() => { heartbeat.lastHeartbeatAt = Date.now(); }, 2_000);
  heartbeatTimer.unref?.();

  const loadPaperOperations = (principal: DashboardPrincipal): PersonalPaperOperationsSnapshot => {
    const input = effectiveProvider.read(principal);
    if (input === undefined) throw new Error("dashboard state is not ready");
    const dashboard = buildMobileDashboardResponse(input);
    const paperSnapshot = effectivePaperLoop?.snapshot();
    const transport = marketConnectionState === "CONNECTED" ? "ONLINE" as const : "OFFLINE" as const;
    const p0State = readAiP0State();
    const p0Halted = p0State === "OPEN" || p0State === "UNVERIFIABLE";
    const autoRunning = effectivePaperLoop != null && config.upbitPublicDataEnabled;
    const runtimeState = dashboard.mode === "FAULTED" || dashboard.killSwitchActive || p0Halted ? "HALTED" as const : dashboard.mode === "STOPPED" ? "STOPPED" as const : !autoRunning ? "STOPPED" as const : transport === "ONLINE" ? "RUNNING" as const : "DEGRADED" as const;
    const learningRuntimeStatus = dashboard.mode === "FAULTED" || dashboard.killSwitchActive || p0Halted || heartbeat.lastError != null ? "HALTED" as const : autoRunning && transport === "ONLINE" ? "RUNNING" as const : "PAUSED" as const;
    const primaryMarket = latestTickers.get(config.upbitMarkets[0] ?? "");
    const generatedAt = Math.max(dashboard.generatedAt, heartbeat.lastHeartbeatAt);
    const paperLearning = { schemaVersion: 1 as const, mode: "PAPER" as const, readOnly: true as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, runtimeStatus: learningRuntimeStatus, generatedAt, events: buildPaperLearningReadOnlyProjection(paperLearningRecorder.replay(), 250) };
    return buildPersonalPaperOperationsSnapshot({ dashboard, research: researchAutomation?.statusProjection?.() ?? null, ai: aiRuntime == null ? null : projectAiReadOnly(aiRuntime.latest(Date.now())), paperLearning, operations: { runtimeState, schedulerRunning: autoRunning, schedulerMode: autoRunning ? "ACTIVE" : "OFF", pipelineStage: effectivePaperLoop == null ? "READ_ONLY_DASHBOARD" : "PAPER_EXECUTION_LOOP", transport, killSwitchActive: dashboard.killSwitchActive, accountHalted: dashboard.mode === "FAULTED" || p0Halted, pendingWrites: 0, ...(paperSnapshot != null && paperSnapshot.updatedAt > 0 ? { lastEventAt: paperSnapshot.updatedAt } : {}), updatedAt: generatedAt, heartbeat: readHeartbeat(), ...(paperSupervisor == null ? {} : { supervisor: paperSupervisor }) }, portfolio: buildReadOnlyPortfolio(paperSnapshot, primaryMarket), orders: buildReadOnlyOrders(paperSnapshot), markets: [...latestTickers.values()].sort((left, right) => left.market.localeCompare(right.market)) }, generatedAt);
  };

  const submitPaperOrder = (principal: DashboardPrincipal, command: PersonalPaperOrderCommand): PersonalPaperOrderCommandResult => {
    const input = effectiveProvider.read(principal);
    if (input === undefined || effectivePaperLoop == null) return Object.freeze({ schemaVersion: 1, status: "BLOCKED", reason: "PAPER_RUNTIME_UNAVAILABLE", liveAuthority: "NONE", productionMutationAllowed: false });
    const dashboard = buildMobileDashboardResponse(input);
    const market = latestTickers.get(command.market);
    if (market == null || marketConnectionState !== "CONNECTED") return Object.freeze({ schemaVersion: 1, status: "BLOCKED", reason: "PAPER_MARKET_DATA_UNAVAILABLE", liveAuthority: "NONE", productionMutationAllowed: false });
    const observedAt = Date.parse(market.observedAt);
    const now = Date.now();
    const investmentPercent = investmentAllocationSettings.get(principal.userId)?.investmentPercent ?? 100;
    const context = { now, marketPrice: market.price, observedAt, mode: dashboard.mode, killSwitchActive: dashboard.killSwitchActive, tradingAllowed: dashboard.tradingAllowed, overallHealth: dashboard.overallHealth, investmentPercent };
    // Manual mutation is available only through the canonical Cloud PAPER boundary. A
    // caller-supplied execution loop must not become an implicit risk-gate bypass.
    const result = productionPaperBoundary?.submitManualOrder(principal.userId, command, context);
    if (result == null) return Object.freeze({ schemaVersion: 1, status: "BLOCKED", reason: "PAPER_RISK_BOUNDARY_UNAVAILABLE", liveAuthority: "NONE", productionMutationAllowed: false });
    try { paperRealizedPeriodProducer?.observeExecution({ observationId: paperExecutionObservationId(command.market, observedAt, result.status), observedAt: now, status: result.status }); } catch { /* producer emitted a structured rejection; PAPER execution remains canonical */ }
    if (result.status === "FILLED") projectPaperAccount();
    const snapshot = loadPaperOperations(principal);
    const order = result.orders[0] == null ? undefined : buildReadOnlyOrders(result.state).find((item) => item.id === result.orders[0]!.id);
    const status: PersonalPaperOrderCommandResult["status"] = result.status === "FILLED" ? "FILLED" : result.status === "DUPLICATE" ? "DUPLICATE" : result.status === "REJECTED" ? "REJECTED" : "BLOCKED";
    return Object.freeze({ schemaVersion: 1, status, ...(result.reason ? { reason: result.reason } : {}), ...(order ? { order } : {}), ...(status === "FILLED" ? { snapshot } : {}), liveAuthority: "NONE", productionMutationAllowed: false });
  };

  const handle = startCloudDashboardServer({
    port: config.port,
    ...(config.host ? { host: config.host } : {}),
    tokenVerifier,
    ...(userAccessRepository == null ? {} : { userAccessRepository }),
    ...(desktopSessionService == null ? {} : { desktopSessionService }),
    readiness: () => buildCloudRuntimeReadiness(durableRepository, effectiveProvider),
    loadDashboard: (principal) => { const input = effectiveProvider.read(principal); if (input === undefined) throw new Error("dashboard state is not ready"); return buildMobileDashboardResponse(input); },
    loadPaperOperations,
    ...(shadowObservabilityProvider == null ? {} : { loadShadowOperations: shadowObservabilityProvider }),
    ...(realReadOnlyObservabilityProvider == null ? {} : { loadRealReadOnlyOperations: (principal: DashboardPrincipal) => realReadOnlyObservabilityProvider(principal, realReadOnlyEventRecorder.replay()) }),
    loadLiveReadiness: () => liveReadinessSourceProvider.getSnapshot(),
    loadEngineeringOperations: () => engineeringOperatingReadModel.getSnapshot(),
    ...(loadEvolutionLearning == null ? {} : { loadEvolutionLearning }),
    submitPaperOrder,
    investmentAllocationSettings
  });
  process.stdout.write(`[cloud-runtime] listening on ${handle.host}:${handle.port}\n`);
  const requirePaperRealizedPeriodProducer = (): PaperRealizedPeriodProducer => {
    if (paperRealizedPeriodProducer == null) throw new Error("PAPER_REALIZED_PERIOD_PERSISTENCE_UNAVAILABLE");
    return paperRealizedPeriodProducer;
  };
  return {
    ...handle,
    getLiveReadinessSourceSnapshot: () => liveReadinessSourceProvider.getSnapshot(),
    getEngineeringOperatingSnapshot: () => engineeringOperatingReadModel.getSnapshot(),
    recordRealReadOnlyEvent: (event) => realReadOnlyEventRecorder.record(event),
    openPaperRealizedPeriod: (input) => requirePaperRealizedPeriodProducer().openPeriod(input),
    observePaperRealizedExecution: (observation) => requirePaperRealizedPeriodProducer().observeExecution(observation),
    closePaperRealizedPeriod: (input) => requirePaperRealizedPeriodProducer().closePeriod(input),
    openPaperRealizedPeriodFromCanonicalAccount: (input) => requirePaperRealizedPeriodProducer().openPeriodFromCanonicalAccount(input),
    closePaperRealizedPeriodFromCanonicalAccount: (input) => requirePaperRealizedPeriodProducer().closePeriodFromCanonicalAccount(input),
    listPaperRealizedPeriods: () => requirePaperRealizedPeriodProducer().listRealizedPeriods(),
    stop: async () => { try { clearInterval(heartbeatTimer); marketDataClient?.stop(); await handle.stop(); } finally { paperLearningRecorder.close(); realReadOnlyEventRecorder.close(); effectivePaperRepository?.close?.(); if (durableRepository != null) effectiveProvider instanceof DurableCloudDashboardStateProvider ? effectiveProvider.close() : durableRepository.close(); } }
  };
}

export function registerGracefulShutdown(handle: CloudDashboardServerHandle, exit: (code: number) => void = process.exit): ShutdownController {
  const controller = createShutdownController({ stop: () => handle.stop(), exit });
  process.on("SIGTERM", () => controller.trigger("SIGTERM")); process.on("SIGINT", () => controller.trigger("SIGINT"));

  // Unrecoverable runtime faults must terminate the process so supervisors can restart
  // from a fail-closed state instead of serving potentially stale mutation paths.
  process.on("uncaughtException", (error) => {
    console.error("[cloud-runtime-crash] uncaught exception", error instanceof Error ? error.message : "unknown error");
    exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[cloud-runtime-crash] unhandled rejection", reason instanceof Error ? reason.message : "unknown error");
    exit(1);
  });

  return controller;
}
function main(): void { const config = readCloudRuntimeConfig(process.env); const handle = startCloudRuntime(process.env, undefined, undefined, undefined, createSnapshotRepository(config.cloudStateDbPath), undefined, undefined, undefined, undefined, undefined, createCloudAiRuntime(process.env)); registerGracefulShutdown(handle); }
if (require.main === module) main();