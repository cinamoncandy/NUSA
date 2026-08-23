import { buildMobileDashboardResponse } from "./mobileDashboardApi";
import { InMemoryCloudDashboardStateProvider, type CloudDashboardStateProvider } from "./cloudDashboardStateProvider";
import { readCloudRuntimeConfig, createSharedSecretTokenVerifier } from "./cloudRuntimeConfig";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { DurableCloudDashboardStateProvider } from "./durableCloudDashboardStateProvider";
import { SqliteCloudDashboardSnapshotRepository, type CloudDashboardSnapshotRepository } from "./cloudDashboardSnapshotRepository";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, type PaperAccountRepository, type PaperExecutionRiskGate } from "./paperTradingExecutionLoop";
import { evaluatePreTradeRisk, type IndependentRiskLimits, type RiskIdentityState } from "./independentRiskGateway";
import { SqliteP0AlertRepository } from "./p0AlertRepository";
import fs from "node:fs";
import path from "node:path";
import { createShutdownController, type ShutdownController } from "./cloudRuntimeShutdown";
import { startCloudDashboardServer, type CloudDashboardServerHandle, type CloudReadinessSnapshot } from "./server";
import { CloudRuntimeDashboardHydrator } from "./cloudRuntimeDashboardHydrator";
import { UpbitWebSocketClient, type UpbitTicker, type UpbitWebSocketOptions } from "./upbitWebSocket";
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
  type PersonalPaperPortfolioProjection
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

export interface CloudRuntimeDashboardHydratorLike { hydrate(provider: CloudDashboardStateProvider, observations?: readonly IntelligenceObservation[]): void; }
export interface CloudRuntimeMarketDataClientLike { subscribe(markets: readonly string[]): void; start(): void; stop(): void; }
export interface CloudRuntimeResearchRuntimeLike { onMarketData(tick: ResearchRuntimeMarketDataTick): void; }
export interface CloudRuntimeResearchRecoveryLike { recover(): ResearchRecoveryResult; }
export interface CloudRuntimeResearchAutomationLike { recover?(): ResearchRecoveryResult; onMarketData(tick: ResearchRuntimeMarketDataTick): void; statusProjection?(): ResearchStatusProjection | null; }
export type CloudRuntimeMarketDataClientFactory = (markets: readonly string[], onTicker: (ticker: UpbitTicker) => void, onConnectionState: (state: string) => void) => CloudRuntimeMarketDataClientLike;

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

/**
 * Wires PaperTradingExecutionLoop's automated STRATEGY decisions to
 * independentRiskGateway.ts's evaluatePreTradeRisk() (WO-0032's exposure/rate/burst/
 * drawdown/consecutive-loss/price-deviation circuit breakers). Limits scale off the
 * account's own initial capital rather than a hardcoded absolute won figure, since cloud's
 * paper capital is operator-configured (NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW) and a fixed
 * number would either be meaningless for a small account or toothless for a large one.
 *
 * Identity fingerprints and the seen-id dedup sets reset on every runtime start -- there is
 * no persisted strategy/config/runtime build identity on the cloud path yet, unlike desktop's
 * PAPER_SAFETY_FINGERPRINTS. That means STRATEGY_FINGERPRINT_MISMATCH and its siblings can
 * never fire here; the circuit breakers that matter for an automated loop (exposure, rate,
 * daily loss, consecutive loss, drawdown) still do.
 */
function buildCloudPaperRiskGate(initialCapital: number): PaperExecutionRiskGate {
  const fingerprints = Object.freeze({
    strategy: "cloud-paper-strategy-v1",
    config: "cloud-paper-config-v1",
    runtime: "cloud-paper-runtime-v1",
    riskPolicy: "cloud-paper-risk-policy-v1"
  });
  const identity: RiskIdentityState = {
    strategyFingerprint: fingerprints.strategy,
    configFingerprint: fingerprints.config,
    runtimeFingerprint: fingerprints.runtime,
    riskPolicyFingerprint: fingerprints.riskPolicy,
    seenSignalIds: new Set(),
    seenCommandIds: new Set(),
    seenClientOrderIds: new Set()
  };
  const limits: IndependentRiskLimits = {
    maxOrderNotional: initialCapital * 0.2,
    maxPositionNotional: initialCapital * 0.8,
    maxOpenOrders: 20,
    maxOrdersPerSecond: 2,
    maxOrdersPerMinute: 30,
    maxSameSideStreak: 10,
    maxSymbolExposureNotional: initialCapital * 0.8,
    maxPortfolioExposureNotional: initialCapital * 0.8,
    maxDailyBuyNotional: initialCapital * 0.5,
    maxDailySellNotional: initialCapital * 0.5,
    maxDailyLoss: initialCapital * 0.1,
    maxConsecutiveLosses: 5,
    maxSessionDrawdownRatio: 0.25,
    maxPriceDeviationRatio: 0.05
  };
  return Object.freeze({
    fingerprints,
    evaluate: (request: Parameters<typeof evaluatePreTradeRisk>[0]) => evaluatePreTradeRisk(request, identity, limits)
  });
}

export function startCloudRuntime(
  env: NodeJS.ProcessEnv = process.env,
  stateProvider: CloudDashboardStateProvider = new InMemoryCloudDashboardStateProvider(),
  dashboardHydrator: CloudRuntimeDashboardHydratorLike = new CloudRuntimeDashboardHydrator(),
  marketDataClientFactory: CloudRuntimeMarketDataClientFactory = (markets, onTicker, onConnectionState) => new UpbitWebSocketClient(markets, onTicker, undefined, undefined, undefined, { onConnectionState: (diagnostics) => onConnectionState(diagnostics.marketConnectionState) } satisfies UpbitWebSocketOptions),
  snapshotRepository?: CloudDashboardSnapshotRepository,
  paperAccountRepository?: PaperAccountRepository,
  paperExecutionLoop?: PaperTradingExecutionLoop,
  researchRuntime?: CloudRuntimeResearchRuntimeLike,
  researchRecoveryCoordinator?: CloudRuntimeResearchRecoveryLike,
  researchAutomation?: CloudRuntimeResearchAutomationLike,
  aiRuntime?: CloudAiRuntime
): CloudDashboardServerHandle {
  const config = readCloudRuntimeConfig(env);
  const tokenVerifier = createSharedSecretTokenVerifier(config.dashboardToken, env);
  const durableRepository = snapshotRepository ?? (env.NUSA_CLOUD_STATE_DB_PATH === undefined ? undefined : createSnapshotRepository(config.cloudStateDbPath));
  const effectiveProvider = durableRepository == null ? stateProvider : new DurableCloudDashboardStateProvider(stateProvider, durableRepository, env.NUSA_SOURCE_COMMIT?.trim() || "unknown", env.NUSA_CLOUD_SOURCE_VERSION?.trim() || "unknown");
  const recovered = durableRepository != null && effectiveProvider instanceof DurableCloudDashboardStateProvider && effectiveProvider.recover();
  const durableAuthDatabase = durableRepository instanceof SqliteCloudDashboardSnapshotRepository ? durableRepository.database() : undefined;
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
  const effectivePaperLoop = paperExecutionLoop ?? (config.paperInitialCapitalKrw === undefined || effectivePaperRepository === undefined ? undefined : new PaperTradingExecutionLoop({ initialCapital: config.paperInitialCapitalKrw, repository: effectivePaperRepository, readP0State: readPaperP0State }));
  const productionPaperBoundary = effectivePaperLoop != null && productionPaperRiskGate != null
    ? new CloudPaperExecutionBoundary({ loop: effectivePaperLoop, riskGate: productionPaperRiskGate, readP0State: readPaperP0State })
    : undefined;
  const readAiP0State = (): CloudRuntimeAiP0State => {
    if (effectiveP0Repository == null) return "UNAVAILABLE";
    try { return effectiveP0Repository.readState().openP0 ? "OPEN" : "CLOSED"; }
    catch { return "UNVERIFIABLE"; }
  };
  const effectivePaperRepository = paperAccountRepository ?? (config.paperInitialCapitalKrw !== undefined && durableRepository instanceof SqliteCloudDashboardSnapshotRepository
    ? new SqliteCloudPaperAccountRepository(durableRepository.database())
    : undefined);
  const effectivePaperLoop = paperExecutionLoop ?? (config.paperInitialCapitalKrw === undefined || effectivePaperRepository === undefined
    ? undefined
    : new PaperTradingExecutionLoop({
      initialCapital: config.paperInitialCapitalKrw,
      repository: effectivePaperRepository,
      readP0State: () => {
        if (effectiveP0Repository == null) throw new Error("P0 safety repository unavailable");
        return effectiveP0Repository.readState();
      },
      riskGate: buildCloudPaperRiskGate(config.paperInitialCapitalKrw)
    }));
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
  const safeHydrate = (next: readonly IntelligenceObservation[]): void => { try { dashboardHydrator.hydrate(effectiveProvider, next); } catch { effectiveProvider.clear(); } };
  let marketConnectionState = config.upbitPublicDataEnabled ? "DISCONNECTED" : "DISABLED";
  const marketDataClient = config.upbitPublicDataEnabled ? marketDataClientFactory(config.upbitMarkets, (ticker) => {
    latestTickers.set(ticker.code, { market: ticker.code, price: ticker.trade_price, changeRate: ticker.signed_change_rate ?? null, volume: ticker.acc_trade_volume ?? null, observedAt: new Date(ticker.trade_timestamp).toISOString(), source: "UPBIT_PUBLIC_TICKER" });
    const now = Date.now();
    const observation = upbitTickerToIntelligenceObservation(ticker, { now });
    if (!observation) { safeHydrate([]); return; }
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
        aiRuntime?.schedule({ orchestrationRunId, decisionId: `${orchestrationRunId}:decision`, evaluatedAt: now, evidence: grounded.evidence, evidenceMaterializations: grounded.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1", "NUSA_DETERMINISTIC_SAFETY_V1"], certificationIds: [], controlPlaneStateId: `cloud:${dashboard.mode}:${dashboard.killSwitchActive ? "KILL" : "ACTIVE"}:${p0State}`, contextValidForMs: 120_000 });
      } catch { /* advisory AI only */ }
      if (effectivePaperLoop != null) {
        const investmentPercent = investmentAllocationSettings.get(config.ownerId)?.investmentPercent ?? config.paperInvestmentPercent;
        const tick = { now, market: ticker.code, price: ticker.trade_price, observedAt: ticker.trade_timestamp, mode: state.mode, killSwitchActive: state.killSwitchActive, tradingAllowed: dashboard.tradingAllowed, overallHealth: state.overallHealth, decisions: state.decisions, investmentPercent };
        // A supplied loop is a read/recovery fixture unless it is composed behind the
        // canonical Cloud PAPER risk boundary. Never let dependency injection create a
        // second mutation path for strategy ticks.
        const result = productionPaperBoundary?.processTick(tick);
        // Missing boundary means no strategy mutation; retain a verified read projection so
        // recovery/fixtures remain observable without turning the loop into a writer.
        if (result != null && result.status === "FAILED") clearPaperProjection(); else projectPaperAccount();
      }
    } else if (effectivePaperLoop != null) clearPaperProjection();
  }, (state) => { marketConnectionState = state; if (state !== "CONNECTED") { observations.clear(); latestTickers.clear(); safeHydrate([]); } }) : undefined;
  if (marketDataClient) { marketDataClient.subscribe(config.upbitMarkets); marketDataClient.start(); }

  const loadPaperOperations = (principal: DashboardPrincipal): PersonalPaperOperationsSnapshot => {
    const input = effectiveProvider.read(principal);
    if (input === undefined) throw new Error("dashboard state is not ready");
    const dashboard = buildMobileDashboardResponse(input);
    const paperSnapshot = effectivePaperLoop?.snapshot();
    const transport = marketConnectionState === "CONNECTED" ? "ONLINE" as const : "OFFLINE" as const;
    const p0State = readAiP0State();
    const p0Halted = p0State === "OPEN" || p0State === "UNVERIFIABLE";
    const runtimeState = dashboard.mode === "FAULTED" || dashboard.killSwitchActive || p0Halted ? "HALTED" as const : dashboard.mode === "STOPPED" ? "STOPPED" as const : effectivePaperLoop == null ? "STOPPED" as const : transport === "ONLINE" ? "READY" as const : "READY_OFFLINE" as const;
    const primaryMarket = latestTickers.get(config.upbitMarkets[0] ?? "");
    return buildPersonalPaperOperationsSnapshot({ dashboard, research: researchAutomation?.statusProjection?.() ?? null, ai: aiRuntime == null ? null : projectAiReadOnly(aiRuntime.latest(Date.now())), operations: { runtimeState, schedulerRunning: false, schedulerMode: "OFF", pipelineStage: effectivePaperLoop == null ? "READ_ONLY_DASHBOARD" : "PAPER_EXECUTION_LOOP", transport, killSwitchActive: dashboard.killSwitchActive, accountHalted: dashboard.mode === "FAULTED" || p0Halted, pendingWrites: 0, ...(paperSnapshot != null && paperSnapshot.updatedAt > 0 ? { lastEventAt: paperSnapshot.updatedAt } : {}), updatedAt: dashboard.generatedAt }, portfolio: buildReadOnlyPortfolio(paperSnapshot, primaryMarket), orders: buildReadOnlyOrders(paperSnapshot), markets: [...latestTickers.values()].sort((left, right) => left.market.localeCompare(right.market)) }, dashboard.generatedAt);
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
    submitPaperOrder,
    investmentAllocationSettings
  });
  process.stdout.write(`[cloud-runtime] listening on ${handle.host}:${handle.port}\n`);
  return { ...handle, stop: async () => { try { marketDataClient?.stop(); await handle.stop(); } finally { effectivePaperRepository?.close?.(); if (durableRepository != null) effectiveProvider instanceof DurableCloudDashboardStateProvider ? effectiveProvider.close() : durableRepository.close(); } } };
}

const CRASH_CLEANUP_TIMEOUT_MS = 5_000;

/**
 * Best-effort cleanup for an uncaught exception / unhandled rejection. Deliberately does NOT
 * call `controller.trigger()`: that path is ShutdownController's graceful-shutdown machinery,
 * and it exits 0 when `stop()` resolves -- correct for an intentional SIGTERM/SIGINT, wrong
 * here. server.ts's "EADDRINUSE ... must terminate the runtime" comment depends on an
 * unhandled bind-failure surfacing as an uncaughtException with a non-zero exit, so a second
 * runtime racing for an occupied port fails closed instead of exiting 0 and reading as a
 * clean, healthy shutdown to anything watching the process. This path always exits 1; the
 * only thing it changes versus letting Node's own default handler kill the process is giving
 * `handle.stop()` a bounded chance to flush/close before that exit.
 */
export function crashCleanupAndExit(handle: CloudDashboardServerHandle, controller: ShutdownController, exit: (code: number) => void): void {
  if (controller.isShuttingDown()) return; // a graceful shutdown is already in flight; let it finish and own the exit code
  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    exit(1);
  };
  const timer = setTimeout(finish, CRASH_CLEANUP_TIMEOUT_MS);
  timer.unref?.();
  handle.stop().then(finish, finish);
}

export function registerGracefulShutdown(handle: CloudDashboardServerHandle, exit: (code: number) => void = process.exit): ShutdownController {
  const controller = createShutdownController({ stop: () => handle.stop(), exit });
  process.on("SIGTERM", () => controller.trigger("SIGTERM"));
  process.on("SIGINT", () => controller.trigger("SIGINT"));
  process.on("uncaughtException", (error: Error) => {
    process.stderr.write(`[cloud-runtime] uncaught exception: ${error.message}\n`);
    crashCleanupAndExit(handle, controller, exit);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`[cloud-runtime] unhandled rejection: ${message}\n`);
    crashCleanupAndExit(handle, controller, exit);
  });
  return controller;
}
function main(): void { const config = readCloudRuntimeConfig(process.env); const handle = startCloudRuntime(process.env, undefined, undefined, undefined, createSnapshotRepository(config.cloudStateDbPath), undefined, undefined, undefined, undefined, undefined, createCloudAiRuntime(process.env)); registerGracefulShutdown(handle); }
if (require.main === module) main();
