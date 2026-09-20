import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { validatePersonalPaperOrderCommand, type PersonalPaperOrderCommand } from "../../../packages/contracts/src/personalPaperOrderCommand";
import { validatePaperCandidateExecutionBinding, type CioDecision, type PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import type { PortfolioPlan } from "./portfolioOrchestrator";
import { buildPaperObservedExecutionCostAttribution, buildPaperRuntimeExecutionCostEvidence, validatePaperObservedExecutionCostAttribution, validatePaperObservedExecutionQuote, type PaperObservedExecutionQuote, type PaperRuntimeExecutionCostEvidence, type PaperExecutionCostAttribution } from "./paperRuntimeExecutionCostEvidence";
import { validatePaperOrderBookQuoteReceipt, type PaperOrderBookQuoteReceipt } from "./paperOrderBookQuoteReceipt";
import { guardCashInvestmentAllocation } from "../../mobile/src/capitalAllocationGuard";
import { assertPaperAccountingReconciled } from "./paperAccountingLedger";
import { createPaperOrderLifecycle, transitionPaperOrderLifecycle, validatePaperOrderLifecycle, type PaperOrderLifecycleState } from "./paperOrderLifecycle";
import { paperExecutionIntentCommandId, validatePaperExecutionIntent, type PaperExecutionIntent } from "./paperExecutionIntent";
import { buildPaperOrderBookExecutionReceipt, validatePaperOrderBookExecutionReceipt, type PaperOrderBookExecutionReceipt } from "./paperOrderBookExecution";

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

export interface PaperExecutionProfile {
  readonly schemaVersion: 1;
  readonly engineVersion: "cloud-paper-execution-v1";
  readonly feeRate: number;
  readonly slippageBps: number;
  readonly spreadBps: number;
  readonly maxFillRatio: number;
  readonly latencyTicks: number;
  readonly fingerprintSha256: string;
}
function buildExecutionProfile(input: Omit<PaperExecutionProfile, "schemaVersion" | "engineVersion" | "fingerprintSha256">): PaperExecutionProfile {
  for (const [name, value] of [["feeRate", input.feeRate], ["slippageBps", input.slippageBps], ["spreadBps", input.spreadBps]] as const) finiteNonNegative(value, name);
  if (!Number.isFinite(input.maxFillRatio) || input.maxFillRatio <= 0 || input.maxFillRatio > 1) throw new Error("maxFillRatio must be in (0, 1]");
  if (!Number.isSafeInteger(input.latencyTicks) || input.latencyTicks < 0) throw new Error("latencyTicks must be a non-negative integer");
  const canonical = Object.freeze({ schemaVersion: 1 as const, engineVersion: "cloud-paper-execution-v1" as const, ...input });
  const fingerprintSha256 = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
  return Object.freeze({ ...canonical, fingerprintSha256 });
}
function validateExecutionProfile(profile: PaperExecutionProfile): PaperExecutionProfile {
  const rebuilt = buildExecutionProfile({ feeRate: profile.feeRate, slippageBps: profile.slippageBps, spreadBps: profile.spreadBps, maxFillRatio: profile.maxFillRatio, latencyTicks: profile.latencyTicks });
  if (profile.schemaVersion !== 1 || profile.engineVersion !== "cloud-paper-execution-v1" || JSON.stringify(profile) !== JSON.stringify(rebuilt)) throw new Error("paper execution profile is invalid");
  return profile;
}

function deterministicFill(profile: PaperExecutionProfile, side: "BUY" | "SELL", requestedQuantity: number, quotePrice: number, liquidityBaseQuantity = requestedQuantity): Readonly<{ quantity: number; price: number }> {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || !Number.isFinite(liquidityBaseQuantity) || liquidityBaseQuantity <= 0 || !Number.isFinite(quotePrice) || quotePrice <= 0) throw new Error("paper fill input is invalid");
  const quantity = Math.min(requestedQuantity, round8(liquidityBaseQuantity * profile.maxFillRatio));
  if (quantity <= 0) throw new Error("paper liquidity model produced zero fill");
  const adverseBps = profile.slippageBps + profile.spreadBps / 2;
  const multiplier = side === "BUY" ? 1 + adverseBps / 10_000 : 1 - adverseBps / 10_000;
  const price = round8(quotePrice * multiplier);
  if (!Number.isFinite(price) || price <= 0) throw new Error("paper execution profile produced invalid fill price");
  return Object.freeze({ quantity, price });
}

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
  readonly status: "FILLED" | "CANCELLED";
  readonly createdAt: number;
  readonly filledAt: number;
  readonly requestFingerprint?: string;
  /** Canonical lifecycle evidence. Optional only for persisted schema-v1 compatibility. */
  readonly lifecycle?: PaperOrderLifecycleState;
  readonly executionProfile?: PaperExecutionProfile;
}
export interface PaperStrategyWorkingOrderProvenance {
  readonly schemaVersion: 1;
  readonly source: "PAPER_EXECUTION_INTENT";
  readonly executionIntent: PaperExecutionIntent;
  readonly candidateProvenance?: PaperFillCandidateProvenance;
  readonly quotePrice: number;
  readonly remainingAllocationCapital: number | null;
}
export interface PaperWorkingOrderRecord {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly orderType: "MARKET" | "LIMIT";
  readonly requestedQuantity: number;
  readonly limitPrice?: number;
  readonly createdAt: number;
  readonly requestFingerprint: string;
  readonly lifecycle: PaperOrderLifecycleState;
  readonly executionProfile: PaperExecutionProfile;
  /** Number of deterministic fill attempts observed since OPEN. */
  readonly observedTicks?: number;
  /** Strategy-only provenance for automatic residual fills. Manual LIMIT orders omit it. */
  readonly strategyExecution?: PaperStrategyWorkingOrderProvenance;
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
  /** Immutable execution-model identity for canonical working-order fills. */
  readonly executionProfileFingerprintSha256?: string;
  readonly executionEngineVersion?: PaperExecutionProfile["engineVersion"];
  /** Canonical public best-quote receipt retained with the fill for restart-safe attribution. */
  readonly orderBookQuoteReceipt?: PaperOrderBookQuoteReceipt;
  /** Derived depth/VWAP execution facts. Stores only consumed levels, never the full raw book. */
  readonly orderBookExecutionReceipt?: PaperOrderBookExecutionReceipt;
  /** Point-in-time candidate binding copied from the exact CIO decision that caused this strategy fill. */
  readonly candidateProvenance?: PaperFillCandidateProvenance;
  /** Canonical PortfolioPlan-derived execution intent that crossed the risk boundary. */
  readonly executionIntent?: PaperExecutionIntent;
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
  /** Restart-safe non-terminal orders. Optional only for persisted schema-v1 compatibility. */
  readonly workingOrders?: readonly PaperWorkingOrderRecord[];
  readonly updatedAt: number;
}
export interface PaperAccountRepository { save(state: PaperAccountState): void; loadLatest(): PaperAccountState | undefined; loadHistory?: () => readonly PaperAccountState[]; loadFills?: () => readonly PaperFillRecord[]; clear(): void; close?: () => void; }

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
    this.backfillFillLedgerFromHistory();
    const timer = setInterval(() => this.heartbeatLease(), this.heartbeatIntervalMs);
    timer.unref?.();
    this.heartbeat = timer;
  }
  public save(state: PaperAccountState): void {
    validateState(state);
    const stateJson = JSON.stringify(state);
    this.db.transaction(() => {
      this.assertLeaseHeld();
      this.appendFillLedgerRows(state.fills);
      this.assertFillLedgerReconcilesState(state);
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
      this.assertFillLedgerReconcilesState(state);
      return state;
    } catch (error) {
      this.db.connection.prepare("UPDATE cloud_paper_accounts SET status = 'CORRUPTED' WHERE account_id = ?").run(ACCOUNT_ID);
      throw error;
    }
  }
  public loadHistory(): readonly PaperAccountState[] {
    this.assertLeaseHeld();
    const rows = this.db.connection.prepare(
      "SELECT schema_version, updated_at, state_json, checksum FROM cloud_paper_account_history WHERE account_id = ? ORDER BY updated_at ASC"
    ).all(ACCOUNT_ID) as Array<Record<string, string | number | null>>;
    return Object.freeze(rows.map((row) => {
      if (Number(row.schema_version) !== SCHEMA_VERSION) throw new Error("unsupported paper account history schema");
      const state = JSON.parse(String(row.state_json)) as PaperAccountState;
      validateState(state);
      if (Number(row.updated_at) !== state.updatedAt || String(row.checksum) !== accountChecksum(state)) throw new Error("paper account history checksum mismatch");
      return state;
    }));
  }
  public loadFills(): readonly PaperFillRecord[] {
    this.assertLeaseHeld();
    return this.readFillLedgerRows();
  }
  public clear(): void {
    this.db.transaction(() => {
      this.assertLeaseHeld();
      this.db.connection.prepare("DELETE FROM cloud_paper_fill_ledger WHERE account_id = ?").run(ACCOUNT_ID);
      this.db.connection.prepare("DELETE FROM cloud_paper_account_history WHERE account_id = ?").run(ACCOUNT_ID);
      this.db.connection.prepare("DELETE FROM cloud_paper_accounts WHERE account_id = ?").run(ACCOUNT_ID);
    });
  }
  private fillChecksum(fill: PaperFillRecord): string {
    return createHash("sha256").update(JSON.stringify(fill), "utf8").digest("hex");
  }
  private appendFillLedgerRows(fills: readonly PaperFillRecord[]): void {
    const ordered = [...fills].sort((left, right) => left.filledAt - right.filledAt || left.id.localeCompare(right.id));
    let sequence = Number((this.db.connection.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM cloud_paper_fill_ledger WHERE account_id = ?"
    ).get(ACCOUNT_ID) as Record<string, number | bigint>).sequence);
    for (const fill of ordered) {
      const fillJson = JSON.stringify(fill);
      const checksum = this.fillChecksum(fill);
      const existing = this.db.connection.prepare(
        "SELECT fill_json, checksum, filled_at FROM cloud_paper_fill_ledger WHERE account_id = ? AND fill_id = ?"
      ).get(ACCOUNT_ID, fill.id) as Record<string, string | number> | undefined;
      if (existing != null) {
        if (String(existing.fill_json) !== fillJson || String(existing.checksum) !== checksum || Number(existing.filled_at) !== fill.filledAt) {
          throw new Error("PAPER_FILL_LEDGER_CONFLICT");
        }
        continue;
      }
      sequence += 1;
      this.db.connection.prepare(
        "INSERT INTO cloud_paper_fill_ledger(account_id,sequence,fill_id,filled_at,fill_json,checksum) VALUES(?,?,?,?,?,?)"
      ).run(ACCOUNT_ID, sequence, fill.id, fill.filledAt, fillJson, checksum);
    }
  }
  private readFillLedgerRows(): readonly PaperFillRecord[] {
    const rows = this.db.connection.prepare(
      "SELECT sequence, fill_id, filled_at, fill_json, checksum FROM cloud_paper_fill_ledger WHERE account_id = ? ORDER BY sequence ASC"
    ).all(ACCOUNT_ID) as Array<Record<string, string | number>>;
    const ids = new Set<string>();
    return Object.freeze(rows.map((row, index) => {
      if (Number(row.sequence) !== index + 1) throw new Error("PAPER_FILL_LEDGER_SEQUENCE_GAP");
      const fill = JSON.parse(String(row.fill_json)) as PaperFillRecord;
      if (!fill.id.trim() || ids.has(fill.id) || fill.id !== String(row.fill_id) || fill.filledAt !== Number(row.filled_at)) throw new Error("PAPER_FILL_LEDGER_IDENTITY_INVALID");
      ids.add(fill.id);
      if (String(row.checksum) !== this.fillChecksum(fill)) throw new Error("PAPER_FILL_LEDGER_CHECKSUM_MISMATCH");
      return fill;
    }));
  }
  private assertFillLedgerReconcilesState(state: PaperAccountState): void {
    const fills = this.readFillLedgerRows();
    if (fills.length === 0 && state.fills.length === 0) return;
    const byId = new Map(fills.map((fill) => [fill.id, JSON.stringify(fill)]));
    for (const fill of state.fills) {
      if (byId.get(fill.id) !== JSON.stringify(fill)) throw new Error("PAPER_FILL_LEDGER_STATE_CONFLICT");
    }
    assertPaperAccountingReconciled({
      initialCapital: state.initialCapital,
      fills,
      cash: state.cash,
      realizedPnL: state.realizedPnL,
      positions: state.positions
    });
  }
  private backfillFillLedgerFromHistory(): void {
    const account = this.db.connection.prepare(
      "SELECT 1 FROM cloud_paper_accounts WHERE account_id = ? AND status = 'VALID'"
    ).get(ACCOUNT_ID);
    if (account == null) return;
    const states = this.loadHistory();
    const fillsById = new Map<string, PaperFillRecord>();
    for (const state of states) {
      for (const fill of state.fills) {
        const previous = fillsById.get(fill.id);
        if (previous != null && JSON.stringify(previous) !== JSON.stringify(fill)) throw new Error("PAPER_FILL_LEDGER_HISTORY_CONFLICT");
        fillsById.set(fill.id, fill);
      }
    }
    this.db.transaction(() => {
      this.assertLeaseHeld();
      this.appendFillLedgerRows([...fillsById.values()]);
    });
  }
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
    if (!order.id.trim() || orderIds.has(order.id) || !order.idempotencyKey.trim() || idempotencyKeys.has(order.idempotencyKey) || !order.market.trim() || (order.status !== "FILLED" && order.status !== "CANCELLED")) throw new Error("paper order identity is invalid");
    orderIds.add(order.id); idempotencyKeys.add(order.idempotencyKey);
    finiteNonNegative(order.quantity, "paper order quantity"); finiteNonNegative(order.price, "paper order price"); finiteNonNegative(order.fee, "paper order fee");
    if ((order.status === "FILLED" && order.quantity <= 0) || order.price <= 0 || !Number.isSafeInteger(order.createdAt) || !Number.isSafeInteger(order.filledAt) || order.createdAt < 0 || order.filledAt < order.createdAt) throw new Error("paper order accounting fields are invalid");
    if (order.requestFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(order.requestFingerprint)) throw new Error("paper order request fingerprint is invalid");
    if (order.lifecycle !== undefined) {
      const lifecycle = validatePaperOrderLifecycle(order.lifecycle);
      if (lifecycle.status !== order.status || lifecycle.filledQuantity !== order.quantity || lifecycle.lastTransitionAt !== order.filledAt) throw new Error("paper order lifecycle reconciliation mismatch");
      if (order.status === "FILLED" && (lifecycle.requestedQuantity !== order.quantity || lifecycle.remainingQuantity !== 0)) throw new Error("paper filled order lifecycle reconciliation mismatch");
    }
    if (order.executionProfile !== undefined) validateExecutionProfile(order.executionProfile);
  }
  const workingOrderIds = new Set<string>();
  const workingIdempotencyKeys = new Set<string>();
  for (const order of state.workingOrders ?? []) {
    if (!order.id.trim() || orderIds.has(order.id) || workingOrderIds.has(order.id) || !order.idempotencyKey.trim() || idempotencyKeys.has(order.idempotencyKey) || workingIdempotencyKeys.has(order.idempotencyKey) || !order.market.trim()) throw new Error("paper working order identity is invalid");
    if (order.orderType !== "MARKET" && order.orderType !== "LIMIT") throw new Error("paper working order type is invalid");
    if (!Number.isFinite(order.requestedQuantity) || order.requestedQuantity <= 0 || !Number.isSafeInteger(order.createdAt) || order.createdAt < 0 || !SHA256.test(order.requestFingerprint)) throw new Error("paper working order fields are invalid");
    if (order.orderType === "LIMIT" && (!Number.isFinite(order.limitPrice) || (order.limitPrice ?? 0) <= 0)) throw new Error("paper working limit price is invalid");
    const lifecycle = validatePaperOrderLifecycle(order.lifecycle);
    if (lifecycle.requestedQuantity !== order.requestedQuantity || lifecycle.status === "FILLED" || lifecycle.status === "CANCELLED" || lifecycle.status === "REJECTED") throw new Error("paper working order lifecycle is terminal or mismatched");
    if (order.strategyExecution != null) {
      const strategy = order.strategyExecution;
      if (strategy.schemaVersion !== 1 || strategy.source !== "PAPER_EXECUTION_INTENT" || order.orderType !== "MARKET") throw new Error("paper strategy working-order provenance is invalid");
      const intent = validatePaperExecutionIntent(strategy.executionIntent);
      if (intent.market !== order.market || intent.side !== order.side || intent.quantity !== order.requestedQuantity ||
          paperExecutionIntentCommandId(intent) !== order.idempotencyKey || !Number.isFinite(strategy.quotePrice) || strategy.quotePrice <= 0) {
        throw new Error("paper strategy working-order intent mismatch");
      }
      if (intent.side === "BUY") {
        if (!Number.isFinite(strategy.remainingAllocationCapital) || (strategy.remainingAllocationCapital ?? -1) < 0 ||
            (strategy.remainingAllocationCapital ?? Number.POSITIVE_INFINITY) > intent.allocationCapital + 1e-8) {
          throw new Error("paper strategy working-order budget is invalid");
        }
      } else if (strategy.remainingAllocationCapital !== null) throw new Error("paper strategy SELL working-order budget must be null");
      if (strategy.candidateProvenance != null) {
        validateFillCandidateProvenance({ id: "working-provenance", orderId: order.id, market: order.market, side: order.side, quantity: 1, price: strategy.quotePrice, fee: 0, filledAt: order.createdAt, candidateProvenance: strategy.candidateProvenance });
        if (strategy.candidateProvenance.binding.candidateId !== intent.candidateId ||
            strategy.candidateProvenance.binding.bindingFingerprintSha256 !== intent.candidateBindingFingerprintSha256) {
          throw new Error("paper strategy working-order candidate mismatch");
        }
      }
    }
    workingOrderIds.add(order.id); workingIdempotencyKeys.add(order.idempotencyKey);
  }
  const fillIds = new Set<string>();
  const fillsByOrder = new Map<string, PaperFillRecord[]>();
  const knownOrderIds = new Set([...orderIds, ...workingOrderIds]);
  for (const fill of state.fills) {
    if (!fill.id.trim() || fillIds.has(fill.id) || !knownOrderIds.has(fill.orderId) || !fill.market.trim()) throw new Error("paper fill identity is invalid");
    fillIds.add(fill.id);
    const grouped = fillsByOrder.get(fill.orderId) ?? [];
    grouped.push(fill);
    fillsByOrder.set(fill.orderId, grouped);
    finiteNonNegative(fill.quantity, "paper fill quantity"); finiteNonNegative(fill.price, "paper fill price"); finiteNonNegative(fill.fee, "paper fill fee");
    if (fill.quantity <= 0 || fill.price <= 0 || !Number.isSafeInteger(fill.filledAt) || fill.filledAt < 0) throw new Error("paper fill accounting fields are invalid");
    if (fill.orderBookQuoteReceipt != null) {
      try { validatePaperOrderBookQuoteReceipt(fill.orderBookQuoteReceipt, fill.market, fill.filledAt, 5_000); }
      catch (error) { throw new Error(`paper fill order-book quote receipt is invalid: ${error instanceof Error ? error.message : "unknown error"}`); }
    }
    validateFillCandidateProvenance(fill);
    let intent: PaperExecutionIntent | undefined;
    if (fill.executionIntent != null) {
      intent = validatePaperExecutionIntent(fill.executionIntent);
      if (intent.market !== fill.market || intent.side !== fill.side) throw new Error("paper fill execution intent mismatch");
      if (fill.candidateProvenance == null ||
          intent.candidateId !== fill.candidateProvenance.binding.candidateId ||
          intent.candidateBindingFingerprintSha256 !== fill.candidateProvenance.binding.bindingFingerprintSha256) {
        throw new Error("paper fill execution intent provenance mismatch");
      }
    }
    if (fill.orderBookExecutionReceipt != null) {
      if (fill.orderBookQuoteReceipt == null) throw new Error("paper depth execution requires order-book quote receipt");
      try {
        validatePaperOrderBookExecutionReceipt(fill.orderBookExecutionReceipt, {
          market: fill.market,
          side: fill.side,
          filledQuantity: fill.quantity,
          fillPrice: fill.price,
          quoteReceipt: fill.orderBookQuoteReceipt,
          ...(intent == null ? {} : { intentQuantity: intent.quantity }),
          ...(intent?.side === "BUY" ? { allocationCapital: intent.allocationCapital } : {}),
        });
      } catch (error) {
        throw new Error(`paper fill order-book execution receipt is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    } else if (intent != null && intent.quantity !== fill.quantity) {
      throw new Error("paper fill execution intent mismatch");
    }
    validateRuntimeExecutionCostEvidence(fill);
    validateObservedExecutionCostAttribution(fill);
  }
  for (const [orderId, orderFills] of fillsByOrder) {
    const intentFills = orderFills.filter((fill) => fill.executionIntent != null);
    if (intentFills.length > 0) {
      if (intentFills.length !== orderFills.length) throw new Error("paper order execution-intent provenance is incomplete");
      const intent = validatePaperExecutionIntent(intentFills[0]!.executionIntent!);
      if (intentFills.some((fill) => fill.executionIntent!.intentFingerprintSha256 !== intent.intentFingerprintSha256)) throw new Error("paper order execution-intent provenance diverged");
      const cumulativeQuantity = round8(intentFills.reduce((sum, fill) => sum + fill.quantity, 0));
      if (cumulativeQuantity > intent.quantity + 1e-8) throw new Error("paper order cumulative fill exceeds execution intent");
      if (intent.side === "BUY") {
        const cumulativeGrossNotional = round8(intentFills.reduce((sum, fill) => sum + (fill.orderBookExecutionReceipt?.grossNotional ?? round8(fill.quantity * fill.price)), 0));
        if (cumulativeGrossNotional > intent.allocationCapital + 1e-6) throw new Error("paper order cumulative fill exceeds execution-intent capital");
      }
      const working = (state.workingOrders ?? []).find((order) => order.id === orderId);
      if (working?.strategyExecution != null) {
        const expectedRemaining = intent.side === "BUY"
          ? round8(Math.max(0, intent.allocationCapital - intentFills.reduce((sum, fill) => sum + (fill.orderBookExecutionReceipt?.grossNotional ?? round8(fill.quantity * fill.price)), 0)))
          : null;
        if (expectedRemaining !== working.strategyExecution.remainingAllocationCapital) throw new Error("paper strategy working-order residual budget mismatch");
      }
    }
  }
  for (const order of state.orders) {
    const fills = fillsByOrder.get(order.id) ?? [];
    const quantity = round8(fills.reduce((sum, fill) => sum + fill.quantity, 0));
    const fee = round8(fills.reduce((sum, fill) => sum + fill.fee, 0));
    const notional = fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
    const averagePrice = quantity > 0 ? round8(notional / quantity) : 0;
    const lastFilledAt = fills.reduce((latest, fill) => Math.max(latest, fill.filledAt), 0);
    const fillShapeMismatch = fills.some((fill) => fill.market !== order.market || fill.side !== order.side) || quantity !== order.quantity || fee !== order.fee;
    if (order.status === "FILLED") {
      if (fills.length === 0 || fillShapeMismatch || averagePrice !== order.price || lastFilledAt !== order.filledAt) throw new Error("paper order/fill reconciliation mismatch");
    } else if (fillShapeMismatch || (fills.length > 0 && (averagePrice !== order.price || lastFilledAt > order.filledAt))) {
      throw new Error("paper cancelled order/fill reconciliation mismatch");
    }
  }
  for (const order of state.workingOrders ?? []) {
    const fills = fillsByOrder.get(order.id) ?? [];
    const quantity = round8(fills.reduce((sum, fill) => sum + fill.quantity, 0));
    if (quantity !== order.lifecycle.filledQuantity || fills.some((fill) => fill.market !== order.market || fill.side !== order.side)) throw new Error("paper working order/fill reconciliation mismatch");
  }
  if (state.processedIdempotencyKeys.some((key) => !key.trim()) || new Set(state.processedIdempotencyKeys).size !== state.processedIdempotencyKeys.length || state.orders.some((order) => !state.processedIdempotencyKeys.includes(order.idempotencyKey)) || (state.workingOrders ?? []).some((order) => !state.processedIdempotencyKeys.includes(order.idempotencyKey))) throw new Error("paper idempotency ledger mismatch");
  // Strict accounting replay is valid only while the bounded order history still represents
  // every processed execution identity. Open/cancelled orders may legitimately have zero fills,
  // and one order may have multiple partial fills, so fill-count equality is not a valid gate.
  const representedIdempotencyKeys = new Set([
    ...state.orders.map((order) => order.idempotencyKey),
    ...(state.workingOrders ?? []).map((order) => order.idempotencyKey)
  ]);
  const completeExecutionHistory =
    state.processedIdempotencyKeys.length > 0
    && representedIdempotencyKeys.size === state.processedIdempotencyKeys.length
    && state.processedIdempotencyKeys.every((key) => representedIdempotencyKeys.has(key));
  if (completeExecutionHistory) {
    assertPaperAccountingReconciled({
      initialCapital: state.initialCapital,
      fills: state.fills,
      cash: state.cash,
      realizedPnL: state.realizedPnL,
      positions: state.positions
    });
  }
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
  /** Planned portfolio state used by the canonical production boundary. */
  readonly portfolio?: PortfolioPlan;
  /** Immutable PortfolioPlan-derived execution intent. Raw simulator callers may omit it. */
  readonly executionIntent?: PaperExecutionIntent;
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
  readonly slippageBps?: number;
  readonly spreadBps?: number;
  readonly maxFillRatio?: number;
  readonly latencyTicks?: number;
  readonly staleWindowMs?: number;
  readonly repository?: PaperAccountRepository;
  readonly restoredState?: PaperAccountState;
  readonly readP0State?: () => PaperExecutionSafetyState;
}

export class PaperTradingExecutionLoop {
  private state: PaperAccountState;
  private readonly feeRate: number;
  private readonly executionProfile: PaperExecutionProfile;
  private readonly staleWindowMs: number;
  private readonly repository?: PaperAccountRepository;
  private readonly readP0State?: () => PaperExecutionSafetyState;

  public constructor(options: PaperTradingExecutionLoopOptions) {
    if (!Number.isFinite(options.initialCapital) || options.initialCapital <= 0) throw new Error("paper initial capital must be positive");
    this.feeRate = options.feeRate ?? 0.0005;
    this.executionProfile = buildExecutionProfile({ feeRate: this.feeRate, slippageBps: options.slippageBps ?? 0, spreadBps: options.spreadBps ?? 0, maxFillRatio: options.maxFillRatio ?? 1, latencyTicks: options.latencyTicks ?? 0 });
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

  public openLimitOrder(command: PersonalPaperOrderCommand, context: PaperManualOrderContext): PaperExecutionResult {
    let validated: PersonalPaperOrderCommand;
    try { validated = validatePersonalPaperOrderCommand(command); } catch { return this.result("FAILED", "invalid PAPER order command"); }
    if (validated.orderType !== "LIMIT") return this.result("REJECTED", "PAPER_WORKING_ORDER_REQUIRES_LIMIT");
    const gate = this.executionGate(context);
    if (gate != null) return this.result("BLOCKED", gate);
    const fingerprint = manualCommandFingerprint(validated);
    const priorFilled = this.state.orders.find((order) => order.idempotencyKey === validated.idempotencyKey);
    const priorWorking = (this.state.workingOrders ?? []).find((order) => order.idempotencyKey === validated.idempotencyKey);
    if (priorFilled != null || priorWorking != null) {
      const priorFingerprint = priorFilled?.requestFingerprint ?? priorWorking?.requestFingerprint;
      return this.result(priorFingerprint === fingerprint ? "DUPLICATE" : "REJECTED", priorFingerprint === fingerprint ? validated.idempotencyKey : "PAPER_IDEMPOTENCY_CONFLICT");
    }
    const id = createHash("sha256").update(validated.idempotencyKey, "utf8").digest("hex").slice(0, 24);
    let lifecycle = createPaperOrderLifecycle(validated.quantity, context.now);
    lifecycle = transitionPaperOrderLifecycle(lifecycle, "ACCEPTED", context.now);
    lifecycle = transitionPaperOrderLifecycle(lifecycle, "OPEN", context.now);
    const order: PaperWorkingOrderRecord = Object.freeze({
      id, idempotencyKey: validated.idempotencyKey, market: validated.market, side: validated.side,
      orderType: "LIMIT", requestedQuantity: validated.quantity, limitPrice: validated.limitPrice,
      createdAt: context.now, requestFingerprint: fingerprint, lifecycle, executionProfile: this.executionProfile, observedTicks: 0,
    });
    const working = Object.freeze({ ...this.state, workingOrders: Object.freeze([order, ...(this.state.workingOrders ?? [])].slice(0, 1_000)), processedIdempotencyKeys: Object.freeze([validated.idempotencyKey, ...this.state.processedIdempotencyKeys]), updatedAt: context.now });
    try { this.repository?.save(working); } catch { return this.result("FAILED", "paper account persistence failed"); }
    this.state = working;
    return Object.freeze({ status: "WAIT", reason: "PAPER_LIMIT_OPEN", orders: Object.freeze([]), fills: Object.freeze([]), state: this.state });
  }

  public fillWorkingOrder(orderId: string, fillQuantity: number, context: PaperManualOrderContext, fillEventId?: string): PaperExecutionResult {
    const gate = this.executionGate(context);
    if (gate != null) return this.result("BLOCKED", gate);
    if (!orderId.trim() || !Number.isFinite(fillQuantity) || fillQuantity <= 0 || (fillEventId !== undefined && !fillEventId.trim())) return this.result("FAILED", "invalid PAPER working fill request");
    const eventId = fillEventId?.trim();
    if (eventId != null) {
      const priorEventFill = this.state.fills.find((fill) => fill.id === `fill-event:${eventId}`);
      if (priorEventFill != null) return Object.freeze({ status: "DUPLICATE", reason: eventId, orders: Object.freeze([]), fills: Object.freeze([priorEventFill]), state: this.state });
    }
    const workingOrders = [...(this.state.workingOrders ?? [])];
    const index = workingOrders.findIndex((order) => order.id === orderId);
    if (index < 0) return this.result("REJECTED", "PAPER_WORKING_ORDER_NOT_FOUND");
    let current = workingOrders[index]!;
    if (current.strategyExecution != null) return this.result("REJECTED", "PAPER_STRATEGY_WORKING_ORDER_AUTOMATIC_ONLY");
    const observedTicks = (current.observedTicks ?? 0) + 1;
    if (observedTicks <= current.executionProfile.latencyTicks) {
      current = Object.freeze({ ...current, observedTicks });
      workingOrders[index] = current;
      const next = Object.freeze({ ...this.state, workingOrders: Object.freeze(workingOrders), updatedAt: context.now });
      try { this.repository?.save(next); } catch { return this.result("FAILED", "paper account persistence failed"); }
      this.state = next;
      return this.result("WAIT", `PAPER_EXECUTION_LATENCY:${observedTicks}/${current.executionProfile.latencyTicks}`);
    }
    if (current.observedTicks !== observedTicks) {
      current = Object.freeze({ ...current, observedTicks });
      workingOrders[index] = current;
    }
    if (current.market !== current.market.trim().toUpperCase()) return this.result("REJECTED", "paper working order market is invalid");
    const marketable = current.side === "BUY" ? context.marketPrice <= (current.limitPrice ?? 0) : context.marketPrice >= (current.limitPrice ?? Number.POSITIVE_INFINITY);
    if (!marketable) return this.result("WAIT", "PAPER_LIMIT_NOT_MARKETABLE");
    if (fillQuantity > current.lifecycle.remainingQuantity) return this.result("REJECTED", "fill quantity exceeds remaining quantity");
    const modeled = deterministicFill(current.executionProfile, current.side, Math.min(fillQuantity, current.lifecycle.remainingQuantity), context.marketPrice, current.requestedQuantity);
    fillQuantity = modeled.quantity;
    const fillPrice = modeled.price;
    if (current.orderType === "LIMIT") {
      const limitPrice = current.limitPrice!;
      const modeledPriceBreachesLimit = current.side === "BUY" ? fillPrice > limitPrice : fillPrice < limitPrice;
      if (modeledPriceBreachesLimit) return this.result("WAIT", "PAPER_LIMIT_MODELED_PRICE_OUTSIDE_LIMIT");
    }

    const fee = round8(fillQuantity * fillPrice * current.executionProfile.feeRate);
    const positions = this.state.positions.map((item) => ({ ...item }));
    const positionIndex = positions.findIndex((item) => item.market === current.market);
    const previous = positionIndex < 0 ? { market: current.market, quantity: 0, averageEntryPrice: 0, realizedPnL: 0, unrealizedPnL: 0, markPrice: fillPrice } : positions[positionIndex]!;
    let cash = this.state.cash;
    let realizedPnL = this.state.realizedPnL;
    let position: PaperAccountPosition;
    const notional = round8(fillQuantity * fillPrice);
    if (current.side === "BUY") {
      if (notional + fee > cash) return this.result("REJECTED", "insufficient paper cash");
      const nextQuantity = round8(previous.quantity + fillQuantity);
      const costBasis = toScaledLedgerAmount(previous.averageEntryPrice * previous.quantity + notional + fee);
      position = { ...previous, quantity: nextQuantity, averageEntryPrice: divideRound8(costBasis * LEDGER_ROUND_SCALE, toScaledLedgerAmount(nextQuantity)), markPrice: fillPrice };
      cash = round8(cash - notional - fee);
    } else {
      if (fillQuantity > previous.quantity + Number.EPSILON) return this.result("REJECTED", "insufficient paper position");
      const realized = round8((fillPrice - previous.averageEntryPrice) * fillQuantity - fee);
      const nextQuantity = round8(previous.quantity - fillQuantity);
      position = { ...previous, quantity: nextQuantity, averageEntryPrice: nextQuantity === 0 ? 0 : previous.averageEntryPrice, realizedPnL: round8(previous.realizedPnL + realized), markPrice: fillPrice };
      realizedPnL = round8(realizedPnL + realized);
      cash = round8(cash + notional - fee);
    }
    if (positionIndex < 0) positions.push(position); else positions[positionIndex] = position;

    const terminal = Math.abs(fillQuantity - current.lifecycle.remainingQuantity) <= Number.EPSILON;
    let lifecycle: PaperOrderLifecycleState;
    try { lifecycle = transitionPaperOrderLifecycle(current.lifecycle, terminal ? "FILLED" : "PARTIALLY_FILLED", context.now, fillQuantity); }
    catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "paper working fill rejected"); }
    const priorFills = this.state.fills.filter((fill) => fill.orderId === current.id);
    const fill: PaperFillRecord = Object.freeze({ id: eventId == null ? `fill:${current.id}:${priorFills.length + 1}` : `fill-event:${eventId}`, orderId: current.id, market: current.market, side: current.side, quantity: fillQuantity, price: fillPrice, fee, filledAt: context.now, executionProfileFingerprintSha256: current.executionProfile.fingerprintSha256, executionEngineVersion: current.executionProfile.engineVersion });
    // Working-order fills are reconciliation state, not telemetry. Never truncate them independently of their order.
    const fills = Object.freeze([fill, ...this.state.fills]);

    let orders = this.state.orders;
    if (terminal) {
      workingOrders.splice(index, 1);
      const orderFills = [...priorFills, fill];
      const totalQuantity = round8(orderFills.reduce((sum, item) => sum + item.quantity, 0));
      const totalFee = round8(orderFills.reduce((sum, item) => sum + item.fee, 0));
      const averagePrice = round8(orderFills.reduce((sum, item) => sum + item.quantity * item.price, 0) / totalQuantity);
      const completed: PaperOrderRecord = Object.freeze({ id: current.id, idempotencyKey: current.idempotencyKey, market: current.market, side: current.side, quantity: totalQuantity, price: averagePrice, fee: totalFee, status: "FILLED", createdAt: current.createdAt, filledAt: context.now, requestFingerprint: current.requestFingerprint, lifecycle, executionProfile: current.executionProfile });
      orders = Object.freeze([completed, ...orders].slice(0, 1_000));
    } else {
      workingOrders[index] = Object.freeze({ ...current, lifecycle });
    }
    let next: PaperAccountState = Object.freeze({ ...this.state, cash, realizedPnL, positions: Object.freeze(positions), orders, fills, workingOrders: Object.freeze(workingOrders), updatedAt: context.now });
    next = markToMarket(next, current.market, context.marketPrice, context.now);
    try { this.repository?.save(next); } catch { return this.result("FAILED", "paper account persistence failed"); }
    this.state = next;
    return Object.freeze({ status: terminal ? "FILLED" : "WAIT", reason: terminal ? "PAPER_LIMIT_FILLED" : "PAPER_LIMIT_PARTIALLY_FILLED", orders: terminal ? Object.freeze([orders[0]!]) : Object.freeze([]), fills: Object.freeze([fill]), state: this.state });
  }

  public cancelWorkingOrder(orderId: string, now: number): PaperExecutionResult {
    if (!orderId.trim() || !Number.isSafeInteger(now) || now < 0) return this.result("FAILED", "invalid PAPER cancel request");
    const workingOrders = [...(this.state.workingOrders ?? [])];
    const index = workingOrders.findIndex((order) => order.id === orderId);
    if (index < 0) return this.result("REJECTED", "PAPER_WORKING_ORDER_NOT_FOUND");
    const current = workingOrders[index]!;
    let lifecycle: PaperOrderLifecycleState;
    try { lifecycle = transitionPaperOrderLifecycle(current.lifecycle, "CANCELLED", now); }
    catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "paper cancel rejected"); }
    workingOrders.splice(index, 1);
    const priorFills = this.state.fills.filter((fill) => fill.orderId === current.id);
    const totalQuantity = round8(priorFills.reduce((sum, fill) => sum + fill.quantity, 0));
    const totalFee = round8(priorFills.reduce((sum, fill) => sum + fill.fee, 0));
    const averagePrice = totalQuantity > 0 ? priorFills.reduce((sum, fill) => sum + fill.price * fill.quantity, 0) / totalQuantity : (current.limitPrice ?? 0);
    const cancelled: PaperOrderRecord = Object.freeze({ id: current.id, idempotencyKey: current.idempotencyKey, market: current.market, side: current.side, quantity: totalQuantity, price: averagePrice, fee: totalFee, status: "CANCELLED", createdAt: current.createdAt, filledAt: now, requestFingerprint: current.requestFingerprint, lifecycle, executionProfile: current.executionProfile });
    const orders = Object.freeze([cancelled, ...this.state.orders.filter((order) => order.id !== current.id)].slice(0, 1_000));
    const next = Object.freeze({ ...this.state, orders, workingOrders: Object.freeze(workingOrders), updatedAt: now });
    try { this.repository?.save(next); } catch { return this.result("FAILED", "paper account persistence failed"); }
    this.state = next;
    return Object.freeze({ status: "WAIT", reason: `PAPER_ORDER_CANCELLED:${lifecycle.transitionSequence}`, orders: Object.freeze([cancelled]), fills: Object.freeze(priorFills), state: this.state });
  }

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
    try { executed = executeOrder(this.state, command.idempotencyKey, market, command.side, command.quantity, context.marketPrice, context.now, this.executionProfile, requestFingerprint); }
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

    const strategyWorking = (this.state.workingOrders ?? []).filter((order) => order.market === tick.market.trim().toUpperCase() && order.strategyExecution != null);
    if (strategyWorking.length > 1) return this.result("FAILED", "multiple canonical strategy working orders exist for one market");
    if (strategyWorking.length === 1) {
      const current = strategyWorking[0]!;
      const strategy = current.strategyExecution!;
      if (tick.observedQuote?.depth == null || tick.observedQuote.depthFingerprintSha256 == null) return this.result("WAIT", "PAPER_STRATEGY_WORKING_WAITING_FOR_DEPTH");
      let receipt: PaperOrderBookExecutionReceipt;
      try {
        receipt = buildPaperOrderBookExecutionReceipt({
          quote: tick.observedQuote,
          side: current.side,
          requestedQuantity: current.lifecycle.remainingQuantity,
          filledAt: tick.now,
          ...(current.side === "BUY" ? { maximumNotional: strategy.remainingAllocationCapital ?? 0 } : {}),
          maximumFillRatio: current.executionProfile.maxFillRatio,
          allowLiquidityPartial: true,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "public orderbook cannot advance strategy working order";
        return this.result("WAIT", `PAPER_STRATEGY_WORKING_DEPTH_WAIT:${reason}`);
      }
      let advanced: PaperStrategyDepthAdvance;
      try {
        advanced = applyStrategyDepthFill(this.state, {
          key: current.idempotencyKey,
          market: current.market,
          side: current.side,
          targetQuantity: current.requestedQuantity,
          now: tick.now,
          executionProfile: current.executionProfile,
          ...(strategy.candidateProvenance === undefined ? {} : { candidateProvenance: strategy.candidateProvenance }),
          quotePrice: tick.price,
          observedQuote: tick.observedQuote,
          executionIntent: strategy.executionIntent,
          receipt,
          existingWorking: current,
        });
      } catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "strategy working fill rejected"); }
      if (advanced.status === "DUPLICATE") return Object.freeze({ status: "DUPLICATE", reason: advanced.reason, orders: Object.freeze([]), fills: advanced.fill == null ? Object.freeze([]) : Object.freeze([advanced.fill]), state: this.state });
      const next = markToMarket(advanced.state, tick.market, tick.price, tick.now);
      try { this.repository?.save(next); } catch { return this.result("FAILED", "paper account persistence failed"); }
      this.state = next;
      return Object.freeze({
        status: advanced.status,
        reason: advanced.reason,
        orders: advanced.order == null ? Object.freeze([]) : Object.freeze([advanced.order]),
        fills: advanced.fill == null ? Object.freeze([]) : Object.freeze([advanced.fill]),
        state: this.state,
      });
    }
    let canonicalExecutionIntent: PaperExecutionIntent | undefined;
    if (tick.executionIntent != null) {
      try { canonicalExecutionIntent = validatePaperExecutionIntent(tick.executionIntent); }
      catch { return this.result("FAILED", "invalid PAPER execution intent"); }
      if (canonicalExecutionIntent.market !== tick.market.trim().toUpperCase() || canonicalExecutionIntent.referencePrice !== tick.price) {
        return this.result("FAILED", "PAPER execution intent does not match tick");
      }
      if (tick.quantity !== undefined && round8(tick.quantity) !== canonicalExecutionIntent.quantity) {
        return this.result("REJECTED", "PAPER execution intent quantity mismatch");
      }
    }
    const actionable = tick.decisions.filter((decision) => decision.symbol === tick.market && (decision.action === "BUY" || decision.action === "SELL"));
    if (actionable.length === 0) return this.result("WAIT", "no actionable paper decision");
    if (canonicalExecutionIntent != null && actionable.length !== 1) return this.result("REJECTED", "PAPER execution intent requires exactly one actionable decision");
    const existingKeys = new Set(this.state.processedIdempotencyKeys);
    const nextOrders: PaperOrderRecord[] = [];
    const nextFills: PaperFillRecord[] = [];
    let working = cloneState(this.state);
    const investmentPercent = tick.investmentPercent ?? 100;
    if (!Number.isFinite(investmentPercent) || investmentPercent < 0 || investmentPercent > 100) return this.result("REJECTED", "invalid investment percentage");
    for (const decision of actionable.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.action.localeCompare(b.action))) {
      if (canonicalExecutionIntent != null) {
        const expectedSide = decision.action === "BUY" ? "BUY" : "SELL";
        if (canonicalExecutionIntent.side !== expectedSide ||
            canonicalExecutionIntent.decisionDecidedAt !== decision.decidedAt ||
            canonicalExecutionIntent.candidateId !== decision.paperCandidateBinding?.candidateId ||
            canonicalExecutionIntent.candidateBindingFingerprintSha256 !== decision.paperCandidateBinding?.bindingFingerprintSha256) {
          return this.result("REJECTED", "PAPER execution intent decision mismatch");
        }
      }
      const key = canonicalExecutionIntent == null
        ? `paper:${tick.market}:${tick.observedAt}:${decision.action}:${decision.decidedAt}`
        : paperExecutionIntentCommandId(canonicalExecutionIntent);
      if (existingKeys.has(key)) return this.result("DUPLICATE", key);
      const position = working.positions.find((item) => item.market === tick.market);
      const quantity = round8(canonicalExecutionIntent?.quantity ?? tick.quantity ?? (decision.action === "SELL" ? position?.quantity ?? 0 : working.cash * (investmentPercent / 100) * decision.allocation / tick.price));
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
      if (canonicalExecutionIntent != null && tick.observedQuote?.depth != null && tick.observedQuote.depthFingerprintSha256 != null) {
        let preview: PaperOrderBookExecutionReceipt;
        try {
          preview = buildPaperOrderBookExecutionReceipt({
            quote: tick.observedQuote,
            side,
            requestedQuantity: quantity,
            filledAt: tick.now,
            ...(side === "BUY" ? { maximumNotional: canonicalExecutionIntent.allocationCapital } : {}),
            maximumFillRatio: this.executionProfile.maxFillRatio,
            allowLiquidityPartial: true,
          });
        } catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "paper order depth preview rejected"); }
        if (preview.liquidityLimited) {
          let partial: PaperStrategyDepthAdvance;
          try {
            partial = applyStrategyDepthFill(working, {
              key,
              market: tick.market,
              side,
              targetQuantity: quantity,
              now: tick.now,
              executionProfile: this.executionProfile,
              ...(candidateProvenance === undefined ? {} : { candidateProvenance }),
              quotePrice: tick.price,
              observedQuote: tick.observedQuote,
              executionIntent: canonicalExecutionIntent,
              receipt: preview,
            });
          } catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "paper strategy partial fill rejected"); }
          working = partial.state;
          if (partial.fill != null) nextFills.push(partial.fill);
          if (partial.order != null) nextOrders.push(partial.order);
          existingKeys.add(key);
          continue;
        }
      }
      let order: ReturnType<typeof executeOrder>;
      try { order = executeOrder(working, key, tick.market, side, quantity, tick.price, tick.now, this.executionProfile, undefined, candidateProvenance, tick.price, tick.observedQuote, canonicalExecutionIntent); }
      catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "paper order rejected"); }
      working = order.state; nextOrders.push(order.order); nextFills.push(order.fill); existingKeys.add(key);
    }
    working = markToMarket(working, tick.market, tick.price, tick.now);
    try { this.repository?.save(working); } catch { return this.result("FAILED", "paper account persistence failed"); }
    this.state = working;
    const hasOpenStrategyWorking = (this.state.workingOrders ?? []).some((order) => order.strategyExecution != null);
    return Object.freeze({ status: hasOpenStrategyWorking ? "WAIT" : "FILLED", ...(hasOpenStrategyWorking ? { reason: "PAPER_STRATEGY_WORKING_PARTIALLY_FILLED" } : {}), orders: Object.freeze(nextOrders), fills: Object.freeze(nextFills), state: this.state });
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
function cloneState(state: PaperAccountState): PaperAccountState { return { ...state, positions: state.positions.map((item) => ({ ...item })), orders: [...state.orders], fills: [...state.fills], processedIdempotencyKeys: [...state.processedIdempotencyKeys], ...(state.workingOrders === undefined ? {} : { workingOrders: [...state.workingOrders] }) }; }

function executeOrder(state: PaperAccountState, key: string, market: string, side: "BUY" | "SELL", quantity: number, price: number, now: number, executionProfile: PaperExecutionProfile, requestFingerprint?: string, candidateProvenance?: PaperFillCandidateProvenance, quotePrice?: number, observedQuote?: PaperObservedExecutionQuote, executionIntent?: PaperExecutionIntent): { state: PaperAccountState; order: PaperOrderRecord; fill: PaperFillRecord } {
  const canonicalObservedQuote = observedQuote == null ? undefined : validatePaperObservedExecutionQuote(observedQuote, market, now);
  const requestedQuantity = quantity;
  let orderBookExecutionReceipt: PaperOrderBookExecutionReceipt | undefined;
  if (canonicalObservedQuote?.depth != null && canonicalObservedQuote.depthFingerprintSha256 != null) {
    orderBookExecutionReceipt = buildPaperOrderBookExecutionReceipt({
      quote: canonicalObservedQuote,
      side,
      requestedQuantity,
      filledAt: now,
      ...(executionIntent?.side === "BUY" ? { maximumNotional: executionIntent.allocationCapital } : {}),
      maximumFillRatio: executionProfile.maxFillRatio,
    });
    quantity = orderBookExecutionReceipt.filledQuantity;
    price = orderBookExecutionReceipt.vwapPrice;
  } else {
    const modeled = deterministicFill(executionProfile, side, requestedQuantity, price);
    if (modeled.quantity !== requestedQuantity) throw new Error("PAPER_PARTIAL_FILL_REQUIRES_WORKING_ORDER");
    quantity = modeled.quantity;
    price = modeled.price;
  }
  const positions = state.positions.map((item) => ({ ...item }));
  const index = positions.findIndex((item) => item.market === market);
  const previous = index < 0 ? { market, quantity: 0, averageEntryPrice: 0, realizedPnL: 0, unrealizedPnL: 0, markPrice: price } : positions[index]!;
  const notional = round8(quantity * price);
  const fee = round8(notional * executionProfile.feeRate);
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
  let lifecycle = createPaperOrderLifecycle(quantity, now);
  lifecycle = transitionPaperOrderLifecycle(lifecycle, "ACCEPTED", now);
  lifecycle = transitionPaperOrderLifecycle(lifecycle, "FILLED", now, quantity);
  const order: PaperOrderRecord = Object.freeze({ id, idempotencyKey: key, market, side, quantity, price, fee, status: "FILLED", createdAt: now, filledAt: now, ...(requestFingerprint === undefined ? {} : { requestFingerprint }), lifecycle, executionProfile });
  const baseFill: PaperFillRecord = { id: `fill:${id}`, orderId: id, market, side, quantity, price, fee, filledAt: now, ...(candidateProvenance === undefined ? {} : { candidateProvenance }), ...(executionIntent === undefined ? {} : { executionIntent: validatePaperExecutionIntent(executionIntent) }), ...(canonicalObservedQuote === undefined ? {} : { orderBookQuoteReceipt: canonicalObservedQuote.receipt }), ...(orderBookExecutionReceipt === undefined ? {} : { orderBookExecutionReceipt }) };
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


interface PaperStrategyDepthAdvance {
  readonly status: "FILLED" | "WAIT" | "DUPLICATE";
  readonly reason: string;
  readonly state: PaperAccountState;
  readonly order?: PaperOrderRecord;
  readonly fill?: PaperFillRecord;
}

function applyStrategyDepthFill(
  state: PaperAccountState,
  input: {
    readonly key: string;
    readonly market: string;
    readonly side: "BUY" | "SELL";
    readonly targetQuantity: number;
    readonly now: number;
    readonly executionProfile: PaperExecutionProfile;
    readonly candidateProvenance?: PaperFillCandidateProvenance;
    readonly quotePrice: number;
    readonly observedQuote: PaperObservedExecutionQuote;
    readonly executionIntent: PaperExecutionIntent;
    readonly receipt: PaperOrderBookExecutionReceipt;
    readonly existingWorking?: PaperWorkingOrderRecord;
  },
): PaperStrategyDepthAdvance {
  const intent = validatePaperExecutionIntent(input.executionIntent);
  const current = input.existingWorking;
  const id = current?.id ?? createHash("sha256").update(input.key, "utf8").digest("hex").slice(0, 24);
  const remainingBefore = current?.lifecycle.remainingQuantity ?? input.targetQuantity;
  if (input.receipt.requestedQuantity !== round8(remainingBefore)) throw new Error("PAPER_STRATEGY_DEPTH_ATTEMPT_MISMATCH");
  const fillId = `fill-depth:${id}:${input.receipt.fingerprintSha256.slice(0, 24)}`;
  const priorSameFill = state.fills.find((fill) => fill.id === fillId);
  if (priorSameFill != null) return Object.freeze({ status: "DUPLICATE", reason: input.receipt.fingerprintSha256, state, fill: priorSameFill });

  const quantity = input.receipt.filledQuantity;
  const price = input.receipt.vwapPrice;
  const positions = state.positions.map((item) => ({ ...item }));
  const positionIndex = positions.findIndex((item) => item.market === input.market);
  const previous = positionIndex < 0
    ? { market: input.market, quantity: 0, averageEntryPrice: 0, realizedPnL: 0, unrealizedPnL: 0, markPrice: price }
    : positions[positionIndex]!;
  const notional = round8(quantity * price);
  const fee = round8(notional * input.executionProfile.feeRate);
  let cash = state.cash;
  let realizedPnL = state.realizedPnL;
  let position: PaperAccountPosition;
  if (input.side === "BUY") {
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
  if (positionIndex < 0) positions.push(position); else positions[positionIndex] = position;

  let lifecycle = current?.lifecycle ?? createPaperOrderLifecycle(input.targetQuantity, input.now);
  if (current == null) {
    lifecycle = transitionPaperOrderLifecycle(lifecycle, "ACCEPTED", input.now);
    lifecycle = transitionPaperOrderLifecycle(lifecycle, "OPEN", input.now);
  }
  const terminalByQuantity = Math.abs(quantity - lifecycle.remainingQuantity) <= 1e-8;
  lifecycle = transitionPaperOrderLifecycle(lifecycle, terminalByQuantity ? "FILLED" : "PARTIALLY_FILLED", input.now, quantity);
  const cancelForBudget = !terminalByQuantity && input.receipt.budgetLimited;
  if (cancelForBudget) lifecycle = transitionPaperOrderLifecycle(lifecycle, "CANCELLED", input.now);

  const baseFill: PaperFillRecord = {
    id: fillId,
    orderId: id,
    market: input.market,
    side: input.side,
    quantity,
    price,
    fee,
    filledAt: input.now,
    executionProfileFingerprintSha256: input.executionProfile.fingerprintSha256,
    executionEngineVersion: input.executionProfile.engineVersion,
    executionIntent: intent,
    ...(input.candidateProvenance === undefined ? {} : { candidateProvenance: input.candidateProvenance }),
    orderBookQuoteReceipt: input.observedQuote.receipt,
    orderBookExecutionReceipt: input.receipt,
  };
  const runtimeExecutionCostEvidence = input.candidateProvenance == null ? undefined : buildPaperRuntimeExecutionCostEvidence(baseFill, input.quotePrice);
  const executionCostAttribution = input.candidateProvenance == null ? undefined : buildPaperObservedExecutionCostAttribution({ ...baseFill, candidateProvenance: input.candidateProvenance }, input.observedQuote);
  const fill: PaperFillRecord = Object.freeze({
    ...baseFill,
    ...(executionCostAttribution === undefined ? {} : { executionCostAttribution }),
    ...(executionCostAttribution === undefined && runtimeExecutionCostEvidence !== undefined ? { runtimeExecutionCostEvidence } : {}),
  });

  const priorFills = state.fills.filter((item) => item.orderId === id);
  const orderFills = [...priorFills, fill];
  const cumulativeGross = round8(orderFills.reduce((sum, item) => sum + (item.orderBookExecutionReceipt?.grossNotional ?? round8(item.quantity * item.price)), 0));
  const remainingAllocationCapital = input.side === "BUY" ? round8(Math.max(0, intent.allocationCapital - cumulativeGross)) : null;
  const strategyExecution: PaperStrategyWorkingOrderProvenance = Object.freeze({
    schemaVersion: 1,
    source: "PAPER_EXECUTION_INTENT",
    executionIntent: intent,
    ...(input.candidateProvenance === undefined ? {} : { candidateProvenance: input.candidateProvenance }),
    quotePrice: input.quotePrice,
    remainingAllocationCapital,
  });

  let workingOrders = [...(state.workingOrders ?? [])].filter((order) => order.id !== id);
  let orders = state.orders;
  let terminalOrder: PaperOrderRecord | undefined;
  if (lifecycle.status === "FILLED" || lifecycle.status === "CANCELLED") {
    const totalQuantity = round8(orderFills.reduce((sum, item) => sum + item.quantity, 0));
    const totalFee = round8(orderFills.reduce((sum, item) => sum + item.fee, 0));
    const averagePrice = round8(orderFills.reduce((sum, item) => sum + item.quantity * item.price, 0) / totalQuantity);
    terminalOrder = Object.freeze({
      id,
      idempotencyKey: input.key,
      market: input.market,
      side: input.side,
      quantity: totalQuantity,
      price: averagePrice,
      fee: totalFee,
      status: lifecycle.status === "FILLED" ? "FILLED" : "CANCELLED",
      createdAt: current?.createdAt ?? input.now,
      filledAt: input.now,
      requestFingerprint: intent.intentFingerprintSha256,
      lifecycle,
      executionProfile: input.executionProfile,
    });
    orders = Object.freeze([terminalOrder, ...orders.filter((order) => order.id !== id)].slice(0, 1_000));
  } else {
    const workingOrder: PaperWorkingOrderRecord = Object.freeze({
      id,
      idempotencyKey: input.key,
      market: input.market,
      side: input.side,
      orderType: "MARKET",
      requestedQuantity: input.targetQuantity,
      createdAt: current?.createdAt ?? input.now,
      requestFingerprint: intent.intentFingerprintSha256,
      lifecycle,
      executionProfile: input.executionProfile,
      observedTicks: (current?.observedTicks ?? 0) + 1,
      strategyExecution,
    });
    workingOrders = [workingOrder, ...workingOrders].slice(0, 1_000);
  }

  const processedIdempotencyKeys = state.processedIdempotencyKeys.includes(input.key)
    ? state.processedIdempotencyKeys
    : Object.freeze([input.key, ...state.processedIdempotencyKeys]);
  const next = Object.freeze({
    ...state,
    cash,
    realizedPnL,
    positions: Object.freeze(positions),
    orders: Object.freeze([...orders]),
    fills: Object.freeze([fill, ...state.fills]),
    workingOrders: Object.freeze(workingOrders),
    processedIdempotencyKeys,
    updatedAt: input.now,
  });
  const reason = lifecycle.status === "FILLED"
    ? "PAPER_STRATEGY_WORKING_FILLED"
    : lifecycle.status === "CANCELLED"
      ? "PAPER_STRATEGY_WORKING_BUDGET_EXHAUSTED"
      : "PAPER_STRATEGY_WORKING_PARTIALLY_FILLED";
  return Object.freeze({ status: lifecycle.status === "FILLED" ? "FILLED" : "WAIT", reason, state: next, ...(terminalOrder === undefined ? {} : { order: terminalOrder }), fill });
}

function markToMarket(state: PaperAccountState, market: string, price: number, now: number): PaperAccountState {
  const positions = state.positions.map((position) => position.market === market ? { ...position, markPrice: price, unrealizedPnL: round8(position.quantity * (price - position.averageEntryPrice)) } : position);
  const unrealizedPnL = round8(positions.reduce((sum, position) => sum + position.unrealizedPnL, 0));
  const equity = round8(state.cash + positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0));
  return Object.freeze({ ...state, positions: Object.freeze(positions), equity, unrealizedPnL, updatedAt: now });
}
