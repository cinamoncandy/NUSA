import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { validatePersonalPaperOrderCommand, type PersonalPaperOrderCommand } from "../../../packages/contracts/src/personalPaperOrderCommand";
import { validatePaperCandidateExecutionBinding, type CioDecision, type PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import type { PortfolioPlan } from "./portfolioOrchestrator";
import { buildPaperObservedExecutionCostAttribution, buildPaperRuntimeExecutionCostEvidence, validatePaperObservedExecutionCostAttribution, validatePaperObservedExecutionQuote, type PaperObservedExecutionQuote, type PaperRuntimeExecutionCostEvidence, type PaperExecutionCostAttribution } from "./paperRuntimeExecutionCostEvidence";
import { validatePaperOrderBookQuoteReceipt, type PaperOrderBookQuoteReceipt } from "./paperOrderBookQuoteReceipt";
import { guardCashInvestmentAllocation } from "../../mobile/src/capitalAllocationGuard";

const ACCOUNT_ID = "paper-default";
const SCHEMA_VERSION = 1;
const LEDGER_ROUND_SCALE = 100_000_000n;
const round8 = (value: number): number => Number(value.toFixed(8));
const toScaledLedgerAmount = (value: number): bigint => BigInt(Math.round(value * Number(LEDGER_ROUND_SCALE)));
const fromScaledLedgerAmount = (value: bigint): number => Number(value) / Number(LEDGER_ROUND_SCALE);
function divideRound8(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new Error("division denominator must be positive");
  return fromScaledLedgerAmount((numerator + denominator / 2n) / denominator);
}
const finiteNonNegative = (value: number, name: string): void => { if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`); };
const SHA256 = /^[a-f0-9]{64}$/;

export interface PaperAccountPosition {
  readonly market: string;
  readonly quantity: number;
  readonly averageEntryPrice: number;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly markPrice: number;
}
export interface PaperOrderRecord {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly status: "FILLED";
  readonly createdAt: number;
  readonly filledAt: number;
  readonly requestFingerprint?: string;
}
export interface PaperFillCandidateProvenance {
  readonly schemaVersion: 1;
  readonly source: "CIO_DECISION_BINDING";
  readonly decisionAt: number;
  readonly binding: PaperCandidateExecutionBinding;
}
export interface PaperFillRecord {
  readonly id: string;
  readonly orderId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly filledAt: number;
  /** Canonical public order-book receipt retained with the fill for restart-safe attribution. */
  readonly orderBookQuoteReceipt?: PaperOrderBookQuoteReceipt;
  /** Point-in-time candidate binding copied from the exact CIO decision that caused this strategy fill. */
  readonly candidateProvenance?: PaperFillCandidateProvenance;
  /**
   * Canonical boundary evidence for only the execution costs the simulator actually observed.
   * This remains INCOMPLETE until trusted spread/slippage evidence completes it, so it cannot
   * satisfy realized-period admission on its own.
   */
  readonly runtimeExecutionCostEvidence?: PaperRuntimeExecutionCostEvidence;
  /** Complete observed cost attribution, present only when a fresh public quote was captured. */
  readonly executionCostAttribution?: PaperExecutionCostAttribution;
}
export interface PaperAccountState {
  readonly version: 1;
  readonly initialCapital: number;
  readonly cash: number;
  readonly equity: number;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly positions: readonly PaperAccountPosition[];
  readonly orders: readonly PaperOrderRecord[];
  readonly fills: readonly PaperFillRecord[];
  readonly processedIdempotencyKeys: readonly string[];
  readonly updatedAt: number;
}
export interface PaperAccountRepository { save(state: PaperAccountState): void; loadLatest(): PaperAccountState | undefined; clear(): void; close?: () => void; }

export interface PaperWriterLeaseOptions {
  readonly now?: () => number;
  readonly leaseDurationMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly ownerId?: string;
  readonly maxClockAdvanceMs?: number;
  readonly maxTakeoverAgeMs?: number;
}

export class SqliteCloudPaperAccountRepository implements PaperAccountRepository {
  private readonly ownerId: string;
  private readonly now: () => number;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxClockAdvanceMs: number;
  private readonly maxTakeoverAgeMs: number;
  private readonly heartbeat?: ReturnType<typeof setInterval>;
  private closed = false;
  private leaseLost = false;
  private lastObservedNowMs = 0;
  public constructor(private readonly db: SqliteDatabase, options: PaperWriterLeaseOptions = {}) {
    this.ownerId = options.ownerId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1_000, Math.floor(this.leaseDurationMs / 3));
    this.maxClockAdvanceMs = options.maxClockAdvanceMs ?? Math.max(this.leaseDurationMs * 2, 60_000);
    this.maxTakeoverAgeMs = options.maxTakeoverAgeMs ?? this.leaseDurationMs * 4;
    if (!Number.isSafeInteger(this.leaseDurationMs) || this.leaseDurationMs < 1_000) throw new Error("paper writer lease duration is invalid");
    if (!Number.isSafeInteger(this.heartbeatIntervalMs) || this.heartbeatIntervalMs < 1_000 || this.heartbeatIntervalMs >= this.leaseDurationMs) throw new Error("paper writer heartbeat interval is invalid");
    if (!Number.isSafeInteger(this.maxClockAdvanceMs) || this.maxClockAdvanceMs < this.leaseDurationMs) throw new Error("paper writer clock advance limit is invalid");
    if (!Number.isSafeInteger(this.maxTakeoverAgeMs) || this.maxTakeoverAgeMs < this.leaseDurationMs) throw new Error("paper writer takeover age limit is invalid");
    this.acquireLease();
    const timer = setInterval(() => this.heartbeatLease(), this.heartbeatIntervalMs);
    timer.unref?.();
    this.heartbeat = timer;
  }
  public save(state: PaperAccountState): void {
    validateState(state);
    const stateJson = JSON.stringify(state);
    this.db.transaction(() => {
      this.assertLeaseHeld();
      this.db.connection.prepare(`
        INSERT INTO cloud_paper_accounts (account_id, schema_version, updated_at, state_json, checksum, status)
        VALUES (?, ?, ?, ?, ?, 'VALID')
        ON CONFLICT(account_id) DO UPDATE SET schema_version=excluded.schema_version, updated_at=excluded.updated_at,
          state_json=excluded.state_json, checksum=excluded.checksum, status='VALID'
      `).run(ACCOUNT_ID, SCHEMA_VERSION, state.updatedAt, stateJson, accountChecksum(state));
    });
  }
  public loadLatest(): PaperAccountState | undefined {
    this.assertLeaseHeld();
    const row = this.db.connection.prepare("SELECT * FROM cloud_paper_accounts WHERE account_id = ? AND status = 'VALID'").get(ACCOUNT_ID) as Record<string, string | number | null> | undefined;
    if (row == null) return undefined;
    try {
      if (Number(row.schema_version) !== SCHEMA_VERSION) throw new Error("unsupported paper account schema");
      const state = JSON.parse(String(row.state_json)) as PaperAccountState;
      validateState(state);
      if (String(row.checksum) !== accountChecksum(state)) throw new Error("paper account checksum mismatch");
      return state;
    } catch (error) {
      this.db.connection.prepare("UPDATE cloud_paper_accounts SET status = 'CORRUPTED' WHERE account_id = ?").run(ACCOUNT_ID);
      throw error;
    }
  }
  public clear(): void { this.db.transaction(() => { this.assertLeaseHeld(); this.db.connection.prepare("DELETE FROM cloud_paper_accounts WHERE account_id = ?").run(ACCOUNT_ID); }); }
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat != null) clearInterval(this.heartbeat);
    try { this.db.transaction(() => { this.db.connection.prepare("DELETE FROM cloud_paper_writer_leases WHERE account_id = ? AND owner_id = ?").run(ACCOUNT_ID, this.ownerId); }); } catch { /* DB close/recovery remains fail-closed until lease expiry. */ }
  }
  private acquireLease(): void {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("paper writer clock is invalid");
    this.db.transaction(() => {
      const row = this.db.connection.prepare("SELECT owner_id, lease_until_ms, heartbeat_at_ms FROM cloud_paper_writer_leases WHERE account_id = ?").get(ACCOUNT_ID) as { owner_id?: string; lease_until_ms?: number; heartbeat_at_ms?: number } | undefined;
      if (row != null) {
        const heartbeatAt = Number(row.heartbeat_at_ms);
        const leaseUntil = Number(row.lease_until_ms);
        if (!Number.isSafeInteger(heartbeatAt) || heartbeatAt < 0 || !Number.isSafeInteger(leaseUntil) || leaseUntil < heartbeatAt) throw new Error("PAPER_WRITER_LEASE_CORRUPTED");
        if (now < heartbeatAt) throw new Error("PAPER_WRITER_CLOCK_REGRESSION");
        if (now - heartbeatAt > this.maxTakeoverAgeMs) throw new Error("PAPER_WRITER_CLOCK_ANOMALY");
      }
      if (row != null && String(row.owner_id) !== this.ownerId && Number(row.lease_until_ms) > now) throw new Error("PAPER_WRITER_ALREADY_ACTIVE");
      this.db.connection.prepare(`
        INSERT INTO cloud_paper_writer_leases (account_id, owner_id, lease_until_ms, heartbeat_at_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET owner_id=excluded.owner_id, lease_until_ms=excluded.lease_until_ms, heartbeat_at_ms=excluded.heartbeat_at_ms
      `).run(ACCOUNT_ID, this.ownerId, now + this.leaseDurationMs, now);
    });
    this.lastObservedNowMs = now;
  }
  private heartbeatLease(): void {
    if (this.closed || this.leaseLost) return;
    try { this.db.transaction(() => this.assertLeaseHeld()); } catch { this.leaseLost = true; }
  }
  private assertLeaseHeld(): void {
    if (this.closed || this.leaseLost) throw new Error("PAPER_WRITER_LEASE_LOST");
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) { this.leaseLost = true; throw new Error("PAPER_WRITER_CLOCK_INVALID"); }
    if (now < this.lastObservedNowMs) { this.leaseLost = true; throw new Error("PAPER_WRITER_CLOCK_REGRESSION"); }
    if (now - this.lastObservedNowMs > this.maxClockAdvanceMs) { this.leaseLost = true; throw new Error("PAPER_WRITER_CLOCK_ANOMALY"); }
    const result = this.db.connection.prepare(`UPDATE cloud_paper_writer_leases SET lease_until_ms = ?, heartbeat_at_ms = ? WHERE account_id = ? AND owner_id = ? AND lease_until_ms > ?`).run(now + this.leaseDurationMs, now, ACCOUNT_ID, this.ownerId, now);
    if (Number(result.changes) !== 1) { this.leaseLost = true; throw new Error("PAPER_WRITER_LEASE_LOST"); }
    this.lastObservedNowMs = now;
  }
}

function accountChecksum(state: PaperAccountState): string { return createHash("sha256").update(JSON.stringify(state), "utf8").digest("hex"); }
function validateFillCandidateProvenance(fill: PaperFillRecord): void {
  const provenance = fill.candidateProvenance;
  if (provenance == null) return;
  if (provenance.schemaVersion !== 1 || provenance.source !== "CIO_DECISION_BINDING") throw new Error("paper fill candidate provenance is invalid");
  if (!Number.isSafeInteger(provenance.decisionAt) || provenance.decisionAt < 0 || provenance.decisionAt > fill.filledAt) throw new Error("paper fill candidate decision time is invalid");
  validatePaperCandidateExecutionBinding(provenance.binding, provenance.decisionAt);
}
function validateRuntimeExecutionCostEvidence(fill: PaperFillRecord): void {
  const evidence = fill.runtimeExecutionCostEvidence;
  if (evidence == null) return;
  if (fill.candidateProvenance == null) throw new Error("paper runtime execution-cost evidence requires candidate provenance");
  const rebuilt = buildPaperRuntimeExecutionCostEvidence(fill, evidence.quotePrice);
  if (JSON.stringify(evidence) !== JSON.stringify(rebuilt)) throw new Error("paper runtime execution-cost evidence is invalid");
}
function validateObservedExecutionCostAttribution(fill: PaperFillRecord): void {
  const attribution = fill.executionCostAttribution;
  if (attribution == null) return;
  if (attribution.evidenceKind !== "OBSERVED") {
    if (attribution.source !== "PAPER_EXECUTION_BOUNDARY" || attribution.schemaVersion !== 1 || !attribution.evidenceId.trim() || !SHA256.test(attribution.evidenceFingerprintSha256)) throw new Error("paper modeled execution-cost attribution identity is invalid");
    if (attribution.candidateId !== canonicalCandidateIdForFill(fill) || attribution.fillPrice !== fill.price || attribution.feeAmount !== fill.fee || ![attribution.quotePrice, attribution.spreadAmount, attribution.slippageAmount].every(Number.isFinite) || attribution.quotePrice <= 0 || attribution.fillPrice <= 0 || attribution.feeAmount < 0 || attribution.spreadAmount < 0 || attribution.slippageAmount < 0) throw new Error("paper modeled execution-cost attribution is invalid");
    return;
  }
  const quoteEvidenceId = attribution.quoteEvidenceId;
  const quoteFingerprint = attribution.quoteEvidenceFingerprintSha256;
  const quoteObservedAt = attribution.quoteObservedAt;
  const quoteBidPrice = attribution.quoteBidPrice;
  const quoteAskPrice = attribution.quoteAskPrice;
  if (fill.orderBookQuoteReceipt == null || typeof quoteEvidenceId !== "string" || typeof quoteFingerprint !== "string" || !Number.isSafeInteger(quoteObservedAt) || typeof quoteBidPrice !== "number" || typeof quoteAskPrice !== "number") throw new Error("paper observed execution-cost quote provenance is missing");
  validatePaperObservedExecutionCostAttribution(fill, {
    schemaVersion: 1,
    source: "UPBIT_PUBLIC_ORDERBOOK",
    market: fill.market,
    observedAt: fill.orderBookQuoteReceipt.observedAt,
    bidPrice: fill.orderBookQuoteReceipt.bestBidPrice,
    askPrice: fill.orderBookQuoteReceipt.bestAskPrice,
    evidenceId: quoteEvidenceId,
    evidenceFingerprintSha256: quoteFingerprint,
    receipt: fill.orderBookQuoteReceipt,
  }, attribution);
}

function canonicalCandidateIdForFill(fill: PaperFillRecord): string {
  const provenance = fill.candidateProvenance;
  if (provenance == null) throw new Error("paper execution-cost attribution requires candidate provenance");
  try { return validatePaperCandidateExecutionBinding(provenance.binding, provenance.decisionAt).candidateId; }
  catch { throw new Error("paper execution-cost attribution candidate provenance is invalid"); }
}

function validateState(state: PaperAccountState): void {
  if (state.version !== 1) throw new Error("unsupported paper account state version");
  for (const [name, value] of [["initialCapital", state.initialCapital], ["cash", state.cash], ["equity", state.equity], ["realizedPnL", state.realizedPnL], ["unrealizedPnL", state.unrealizedPnL]] as const) if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  if (state.initialCapital <= 0 || state.cash < 0 || state.equity < 0) throw new Error("paper account balance invariant failed");
  if (!Number.isSafeInteger(state.updatedAt) || state.updatedAt < 0) throw new Error("paper account updatedAt is invalid");
  const positionMarkets = new Set<string>();
  for (const position of state.positions) {
    if (!position.market.trim() || positionMarkets.has(position.market)) throw new Error("paper position identity is invalid");
    positionMarkets.add(position.market);
    finiteNonNegative(position.quantity, "position.quantity"); finiteNonNegative(position.averageEntryPrice, "position.averageEntryPrice"); finiteNonNegative(position.markPrice, "position.markPrice");
    if (![position.realizedPnL, position.unrealizedPnL].every(Number.isFinite)) throw new Error("paper position PnL is invalid");
  }
  const orderIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const order of state.orders) {
    if (!order.id.trim() || orderIds.has(order.id) || !order.idempotencyKey.trim() || idempotencyKeys.has(order.idempotencyKey) || !order.market.trim() || order.status !== "FILLED") throw new Error("paper order identity is invalid");
    orderIds.add(order.id); idempotencyKeys.add(order.idempotencyKey);
    finiteNonNegative(order.quantity, "paper order quantity"); finiteNonNegative(order.price, "paper order price"); finiteNonNegative(order.fee, "paper order fee");
    if (order.quantity <= 0 || order.price <= 0 || !Number.isSafeInteger(order.createdAt) || !Number.isSafeInteger(order.filledAt) || order.createdAt < 0 || order.filledAt < order.createdAt) throw new Error("paper order accounting fields are invalid");
    if (order.requestFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(order.requestFingerprint)) throw new Error("paper order request fingerprint is invalid");
  }
  const fillIds = new Set<string>();
  const fillsByOrder = new Map<string, PaperFillRecord>();
  for (const fill of state.fills) {
    if (!fill.id.trim() || fillIds.has(fill.id) || !orderIds.has(fill.orderId) || fillsByOrder.has(fill.orderId) || !fill.market.trim()) throw new Error("paper fill identity is invalid");
    fillIds.add(fill.id); fillsByOrder.set(fill.orderId, fill);
    finiteNonNegative(fill.quantity, "paper fill quantity"); finiteNonNegative(fill.price, "paper fill price"); finiteNonNegative(fill.fee, "paper fill fee");
    if (fill.quantity <= 0 || fill.price <= 0 || !Number.isSafeInteger(fill.filledAt) || fill.filledAt < 0) throw new Error("paper fill accounting fields are invalid");
    if (fill.orderBookQuoteReceipt != null) {
      try { validatePaperOrderBookQuoteReceipt(fill.orderBookQuoteReceipt, fill.market, fill.filledAt, 5_000); }
      catch (error) { throw new Error(`paper fill order-book quote receipt is invalid: ${error instanceof Error ? error.message : "unknown error"}`); }
    }
    validateFillCandidateProvenance(fill);
    validateRuntimeExecutionCostEvidence(fill);
    validateObservedExecutionCostAttribution(fill);
  }
  for (const order of state.orders) {
    const fill = fillsByOrder.get(order.id);
    if (fill == null || fill.market !== order.market || fill.side !== order.side || fill.quantity !== order.quantity || fill.price !== order.price || fill.fee !== order.fee || fill.filledAt !== order.filledAt) throw new Error("paper order/fill reconciliation mismatch");
  }
  if (state.processedIdempotencyKeys.some((key) => !key.trim()) || new Set(state.processedIdempotencyKeys).size !== state.processedIdempotencyKeys.length || state.orders.some((order) => !state.processedIdempotencyKeys.includes(order.idempotencyKey))) throw new Error("paper idempotency ledger mismatch");
  const expectedEquity = round8(state.cash + state.positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0));
  const expectedUnrealized = round8(state.positions.reduce((sum, position) => sum + position.unrealizedPnL, 0));
  if (state.equity !== expectedEquity || state.unrealizedPnL !== expectedUnrealized) throw new Error("paper account projection mismatch");
}

function manualCommandFingerprint(command: PersonalPaperOrderCommand): string {
  const canonical = JSON.stringify({
    schemaVersion: command.schemaVersion,
    authority: command.authority,
    productionMutationAllowed: command.productionMutationAllowed,
    idempotencyKey: command.idempotencyKey,
    market: command.market.trim().toUpperCase(),
    side: command.side,
    orderType: command.orderType,
    quantity: command.quantity,
    limitPrice: command.limitPrice ?? null
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface PaperExecutionTick {
  readonly now: number;
  readonly market: string;
  readonly price: number;
  readonly quantity?: number;
  readonly observedAt: number;
  readonly mode: MobileDashboardApiInput["mode"];
  readonly killSwitchActive: boolean;
  readonly tradingAllowed: boolean;
  readonly overallHealth: MobileDashboardApiInput["overallHealth"];
  readonly decisions: readonly CioDecision[];
  readonly investmentPercent?: number;
  readonly observedQuote?: PaperObservedExecutionQuote;
}
export interface PaperManualOrderContext {
  readonly now: number;
  readonly marketPrice: number;
  readonly observedAt: number;
  readonly mode: MobileDashboardApiInput["mode"];
  readonly killSwitchActive: boolean;
  readonly tradingAllowed: boolean;
  readonly overallHealth: MobileDashboardApiInput["overallHealth"];
}
export interface PaperExecutionResult {
  readonly status: "FILLED" | "WAIT" | "BLOCKED" | "REJECTED" | "DUPLICATE" | "FAILED";
  readonly reason?: string;
  readonly orders: readonly PaperOrderRecord[];
  readonly fills: readonly PaperFillRecord[];
  readonly state: PaperAccountState;
  readonly risk?: Readonly<{ readonly status: "ALLOW" | "REJECT" | "HALT"; readonly reasonCodes: readonly string[] }>;
}
export interface PaperExecutionSafetyState { readonly openP0: boolean; }
export interface PaperTradingExecutionLoopOptions {
  readonly initialCapital: number;
  readonly feeRate?: number;
  readonly staleWindowMs?: number;
  readonly repository?: PaperAccountRepository;
  readonly restoredState?: PaperAccountState;
  readonly readP0State?: () => PaperExecutionSafetyState;
}

export class PaperTradingExecutionLoop {
  private state: PaperAccountState;
  private readonly feeRate: number;
  private readonly staleWindowMs: number;
  private readonly repository?: PaperAccountRepository;
  private readonly readP0State?: () => PaperExecutionSafetyState;

  public constructor(options: PaperTradingExecutionLoopOptions) {
    if (!Number.isFinite(options.initialCapital) || options.initialCapital <= 0) throw new Error("paper initial capital must be positive");
    this.feeRate = options.feeRate ?? 0.0005;
    this.staleWindowMs = options.staleWindowMs ?? 30_000;
    if (!Number.isFinite(this.feeRate) || this.feeRate < 0) throw new Error("paper fee rate must be non-negative");
    if (!Number.isSafeInteger(this.staleWindowMs) || this.staleWindowMs < 1_000) throw new Error("paper stale window is invalid");
    this.repository = options.repository;
    this.readP0State = options.readP0State;
    const restored = options.restoredState ?? this.repository?.loadLatest();
    this.state = restored == null ? initialState(options.initialCapital) : restored;
    if (Math.abs(this.state.initialCapital - options.initialCapital) > Number.EPSILON) throw new Error("paper initial capital mismatch");
    validateState(this.state);
  }

  public snapshot(): PaperAccountState { return this.state; }

  public submitManualOrder(command: PersonalPaperOrderCommand, context: PaperManualOrderContext): PaperExecutionResult {
    let validatedCommand: PersonalPaperOrderCommand;
    try { validatedCommand = validatePersonalPaperOrderCommand(command); } catch { return this.result("FAILED", "invalid PAPER order command"); }
    command = validatedCommand;
    const requestFingerprint = manualCommandFingerprint(command);
    const prior = this.state.orders.find((order) => order.idempotencyKey === command.idempotencyKey);
    if (prior != null) {
      if (prior.requestFingerprint !== requestFingerprint) return this.result("REJECTED", "PAPER_IDEMPOTENCY_CONFLICT");
      const fills = this.state.fills.filter((fill) => fill.orderId === prior.id);
      return Object.freeze({ status: "DUPLICATE", reason: command.idempotencyKey, orders: Object.freeze([prior]), fills: Object.freeze(fills), state: this.state });
    }
    if (this.state.processedIdempotencyKeys.includes(command.idempotencyKey)) return this.result("REJECTED", "PAPER_IDEMPOTENCY_CONFLICT");
    const gate = this.executionGate(context);
    if (gate != null) return this.result("BLOCKED", gate);
    const market = command.market.trim().toUpperCase();
    if (command.orderType === "LIMIT") {
      const limit = command.limitPrice;
      if (!Number.isFinite(limit) || (limit ?? 0) <= 0) return this.result("FAILED", "invalid PAPER limit price");
      const marketable = command.side === "BUY" ? context.marketPrice <= limit! : context.marketPrice >= limit!;
      if (!marketable) return this.result("REJECTED", "PAPER_LIMIT_NOT_MARKETABLE");
    }
    let executed: ReturnType<typeof executeOrder>;
    try { executed = executeOrder(this.state, command.idempotencyKey, market, command.side, command.quantity, context.marketPrice, context.now, this.feeRate, requestFingerprint); }
    catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "paper order rejected"); }
    const working = markToMarket(executed.state, market, context.marketPrice, context.now);
    try { this.repository?.save(working); } catch { return this.result("FAILED", "paper account persistence failed"); }
    this.state = working;
    return Object.freeze({ status: "FILLED", orders: Object.freeze([executed.order]), fills: Object.freeze([executed.fill]), state: this.state });
  }

  public processTick(tick: PaperExecutionTick): PaperExecutionResult {
    const gate = this.executionGate({ now: tick.now, marketPrice: tick.price, observedAt: tick.observedAt, mode: tick.mode, killSwitchActive: tick.killSwitchActive, tradingAllowed: tick.tradingAllowed, overallHealth: tick.overallHealth });
    if (gate != null) return this.result(gate === "invalid tick" ? "FAILED" : "BLOCKED", gate);
    if (tick.quantity !== undefined && (!Number.isFinite(tick.quantity) || tick.quantity <= 0)) return this.result("FAILED", "invalid order quantity");
    const actionable = tick.decisions.filter((decision) => decision.symbol === tick.market && (decision.action === "BUY" || decision.action === "SELL"));
    if (actionable.length === 0) return this.result("WAIT", "no actionable paper decision");
    const existingKeys = new Set(this.state.processedIdempotencyKeys);
    const nextOrders: PaperOrderRecord[] = [];
    const nextFills: PaperFillRecord[] = [];
    let working = cloneState(this.state);
    const investmentPercent = tick.investmentPercent ?? 100;
    if (!Number.isFinite(investmentPercent) || investmentPercent < 0 || investmentPercent > 100) return this.result("REJECTED", "invalid investment percentage");
    for (const decision of actionable.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.action.localeCompare(b.action))) {
      const key = `paper:${tick.market}:${tick.observedAt}:${decision.action}:${decision.decidedAt}`;
      if (existingKeys.has(key)) return this.result("DUPLICATE", key);
      const position = working.positions.find((item) => item.market === tick.market);
      const quantity = round8(tick.quantity ?? (decision.action === "SELL" ? position?.quantity ?? 0 : working.cash * (investmentPercent / 100) * decision.allocation / tick.price));
      if (quantity <= 0) return this.result("REJECTED", decision.action === "SELL" ? "insufficient paper position" : "decision allocation is zero");
      const side = decision.action === "BUY" ? "BUY" : "SELL";
      if (side === "BUY") {
        const treasury = { totalAssets: working.cash, tradingCapital: working.cash, reserveCapital: 0, pendingDepositCapital: 0, reservations: [], reservedWithdrawalCapital: 0, deployableCapital: working.cash, activeReservations: [] };
        const requestedAmount = quantity * tick.price * (1 + this.feeRate);
        try { guardCashInvestmentAllocation(treasury, [{ id: key, bucket: "SPOT", amount: requestedAmount }], investmentPercent); }
        catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "cash investment allocation exceeded"); }
      }
      const candidateProvenance: PaperFillCandidateProvenance | undefined = decision.paperCandidateBinding == null ? undefined : Object.freeze({
        schemaVersion: 1,
        source: "CIO_DECISION_BINDING",
        decisionAt: decision.decidedAt,
        binding: validatePaperCandidateExecutionBinding(decision.paperCandidateBinding, decision.decidedAt),
      });
      let order: ReturnType<typeof executeOrder>;
      try { order = executeOrder(working, key, tick.market, side, quantity, tick.price, tick.now, this.feeRate, undefined, candidateProvenance, tick.price, tick.observedQuote); }
      catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "paper order rejected"); }
      working = order.state; nextOrders.push(order.order); nextFills.push(order.fill); existingKeys.add(key);
    }
    working = markToMarket(working, tick.market, tick.price, tick.now);
    try { this.repository?.save(working); } catch { return this.result("FAILED", "paper account persistence failed"); }
    this.state = working;
    return Object.freeze({ status: "FILLED", orders: Object.freeze(nextOrders), fills: Object.freeze(nextFills), state: this.state });
  }

  public applyToDashboard(base: MobileDashboardApiInput, now: number): MobileDashboardApiInput {
    const deployed = this.state.positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0);
    const allocations = this.state.positions.filter((position) => position.quantity > 0).map((position) => Object.freeze({ symbol: position.market, instrument: "SPOT" as const, action: "HOLD" as const, capital: round8(position.quantity * position.markPrice), share: this.state.equity > 0 ? round8(position.quantity * position.markPrice / this.state.equity) : 0, leverage: 1, confidence: 0, risk: "LOW" as const }));
    const portfolio: PortfolioPlan = Object.freeze({ allocations: Object.freeze(allocations), deployedCapital: round8(deployed), cashCapital: round8(this.state.cash), reservedCapital: 0, grossShare: this.state.equity > 0 ? round8(deployed / this.state.equity) : 0, futuresShare: 0, decidedAt: now });
    return Object.freeze({ ...base, now, portfolio, paper: Object.freeze({ cash: this.state.cash, equity: this.state.equity, realizedPnL: this.state.realizedPnL, unrealizedPnL: this.state.unrealizedPnL, orders: Object.freeze(this.state.orders.slice(0, 20)), fills: Object.freeze(this.state.fills.slice(0, 20)) }) });
  }

  private executionGate(context: PaperManualOrderContext): string | null {
    if (!Number.isSafeInteger(context.now) || context.now < 0 || !Number.isFinite(context.marketPrice) || context.marketPrice <= 0) return "invalid tick";
    if (context.mode === "PAPER" && this.readP0State != null) {
      try { if (this.readP0State().openP0) return "OPEN_P0_ALERT"; }
      catch { return "P0_STATE_UNVERIFIABLE"; }
    }
    if (context.mode !== "PAPER" || context.killSwitchActive || !context.tradingAllowed || context.overallHealth !== "HEALTHY") return "paper execution gate is closed";
    if (!Number.isSafeInteger(context.observedAt) || context.observedAt < 0 || context.observedAt > context.now || context.now - context.observedAt >= this.staleWindowMs) return "market data is stale";
    return null;
  }

  private result(status: PaperExecutionResult["status"], reason: string): PaperExecutionResult { return Object.freeze({ status, reason, orders: Object.freeze([]), fills: Object.freeze([]), state: this.state }); }
}

function initialState(initialCapital: number): PaperAccountState { return Object.freeze({ version: 1, initialCapital, cash: initialCapital, equity: initialCapital, realizedPnL: 0, unrealizedPnL: 0, positions: Object.freeze([]), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]), updatedAt: 0 }); }
function cloneState(state: PaperAccountState): PaperAccountState { return { ...state, positions: state.positions.map((item) => ({ ...item })), orders: [...state.orders], fills: [...state.fills], processedIdempotencyKeys: [...state.processedIdempotencyKeys] }; }

function executeOrder(state: PaperAccountState, key: string, market: string, side: "BUY" | "SELL", quantity: number, price: number, now: number, feeRate: number, requestFingerprint?: string, candidateProvenance?: PaperFillCandidateProvenance, quotePrice?: number, observedQuote?: PaperObservedExecutionQuote): { state: PaperAccountState; order: PaperOrderRecord; fill: PaperFillRecord } {
  const canonicalObservedQuote = observedQuote == null ? undefined : validatePaperObservedExecutionQuote(observedQuote, market, now);
  const positions = state.positions.map((item) => ({ ...item }));
  const index = positions.findIndex((item) => item.market === market);
  const previous = index < 0 ? { market, quantity: 0, averageEntryPrice: 0, realizedPnL: 0, unrealizedPnL: 0, markPrice: price } : positions[index]!;
  const notional = round8(quantity * price);
  const fee = round8(notional * feeRate);
  let cash = state.cash;
  let position: PaperAccountPosition;
  let realizedPnL = state.realizedPnL;
  if (side === "BUY") {
    if (notional + fee > cash) throw new Error("insufficient paper cash");
    const nextQuantity = round8(previous.quantity + quantity);
    const costBasis = toScaledLedgerAmount(previous.averageEntryPrice * previous.quantity + notional + fee);
    position = { ...previous, quantity: nextQuantity, averageEntryPrice: divideRound8(costBasis * LEDGER_ROUND_SCALE, toScaledLedgerAmount(nextQuantity)), markPrice: price };
    cash = round8(cash - notional - fee);
  } else {
    if (quantity > previous.quantity + Number.EPSILON) throw new Error("insufficient paper position");
    const realized = round8((price - previous.averageEntryPrice) * quantity - fee);
    const nextQuantity = round8(previous.quantity - quantity);
    position = { ...previous, quantity: nextQuantity, averageEntryPrice: nextQuantity === 0 ? 0 : previous.averageEntryPrice, realizedPnL: round8(previous.realizedPnL + realized), markPrice: price };
    realizedPnL = round8(realizedPnL + realized);
    cash = round8(cash + notional - fee);
  }
  if (index < 0) positions.push(position); else positions[index] = position;
  const id = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 24);
  const order: PaperOrderRecord = Object.freeze({ id, idempotencyKey: key, market, side, quantity, price, fee, status: "FILLED", createdAt: now, filledAt: now, ...(requestFingerprint === undefined ? {} : { requestFingerprint }) });
  const baseFill: PaperFillRecord = { id: `fill:${id}`, orderId: id, market, side, quantity, price, fee, filledAt: now, ...(candidateProvenance === undefined ? {} : { candidateProvenance }), ...(canonicalObservedQuote === undefined ? {} : { orderBookQuoteReceipt: canonicalObservedQuote.receipt }) };
  const runtimeExecutionCostEvidence = candidateProvenance == null || quotePrice == null ? undefined : buildPaperRuntimeExecutionCostEvidence(baseFill, quotePrice);
  let executionCostAttribution: PaperExecutionCostAttribution | undefined;
  if (candidateProvenance != null && canonicalObservedQuote != null) {
    executionCostAttribution = buildPaperObservedExecutionCostAttribution({ ...baseFill, candidateProvenance }, canonicalObservedQuote);
  }
  const fill: PaperFillRecord = Object.freeze({
    ...baseFill,
    ...(executionCostAttribution === undefined ? {} : { executionCostAttribution }),
    ...(executionCostAttribution === undefined && runtimeExecutionCostEvidence !== undefined ? { runtimeExecutionCostEvidence } : {})
  });
  return { state: { ...state, cash, realizedPnL, positions, orders: [order, ...state.orders].slice(0, 1_000), fills: [fill, ...state.fills].slice(0, 1_000), processedIdempotencyKeys: [key, ...state.processedIdempotencyKeys], updatedAt: now }, order, fill };
}

function markToMarket(state: PaperAccountState, market: string, price: number, now: number): PaperAccountState {
  const positions = state.positions.map((position) => position.market === market ? { ...position, markPrice: price, unrealizedPnL: round8(position.quantity * (price - position.averageEntryPrice)) } : position);
  const unrealizedPnL = round8(positions.reduce((sum, position) => sum + position.unrealizedPnL, 0));
  const equity = round8(state.cash + positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0));
  return Object.freeze({ ...state, positions: Object.freeze(positions), equity, unrealizedPnL, updatedAt: now });
}
