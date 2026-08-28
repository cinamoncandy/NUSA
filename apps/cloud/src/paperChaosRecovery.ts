import { createHash } from "node:crypto";

export type PaperChaosScenario =
  | "PROCESS_RESTART"
  | "STALE_FEED"
  | "PAUSED_FEED"
  | "DUPLICATE_REPLAY"
  | "PERSISTENCE_WRITE_INTERRUPTION"
  | "PERSISTENCE_READ_CORRUPTION"
  | "CLOCK_REGRESSION"
  | "UPSTREAM_OUTAGE"
  | "RECONCILIATION_MISMATCH";

export type PaperChaosRuntimeStatus = "RUNNING" | "PAUSED" | "HALTED" | "ERROR";
export type PaperChaosPersistenceStatus = "AVAILABLE" | "INTERRUPTED" | "CORRUPTED" | "UNKNOWN";
export type PaperChaosUpstreamStatus = "HEALTHY" | "STALE" | "DOWN" | "UNKNOWN";
export type PaperChaosChronologyStatus = "VALID" | "REGRESSED" | "UNKNOWN";
export type PaperChaosReconciliationStatus = "MATCH" | "MISMATCH" | "UNKNOWN";

export interface PaperChaosState {
  readonly runtimeStatus: PaperChaosRuntimeStatus;
  readonly persistenceStatus: PaperChaosPersistenceStatus;
  readonly upstreamStatus: PaperChaosUpstreamStatus;
  readonly chronologyStatus: PaperChaosChronologyStatus;
  readonly reconciliationStatus: PaperChaosReconciliationStatus;
  readonly orderIds: readonly string[];
  readonly fillIds: readonly string[];
  readonly observedAt: number;
}

export interface PaperChaosDrillInput {
  readonly schemaVersion: 1;
  readonly drillId: string;
  readonly scenario: PaperChaosScenario;
  /** Set only after the real PAPER runtime/recovery boundary was exercised. */
  readonly triggerObserved: boolean;
  readonly before: PaperChaosState;
  readonly after: PaperChaosState;
}

export type PaperChaosResolution = "RECOVERED" | "NO_MUTATION" | "HALTED";

export interface PaperChaosStateProjection {
  readonly runtimeStatus: PaperChaosRuntimeStatus;
  readonly persistenceStatus: PaperChaosPersistenceStatus;
  readonly upstreamStatus: PaperChaosUpstreamStatus;
  readonly chronologyStatus: PaperChaosChronologyStatus;
  readonly reconciliationStatus: PaperChaosReconciliationStatus;
  readonly orderCount: number;
  readonly fillCount: number;
  readonly orderIdentityHash: string;
  readonly fillIdentityHash: string;
  readonly observedAt: number;
}

export interface PaperChaosRecoveryReceipt {
  readonly schemaVersion: 1;
  readonly source: "PAPER_RUNTIME";
  readonly drillId: string;
  readonly scenario: PaperChaosScenario;
  readonly observedAt: number;
  readonly before: PaperChaosStateProjection;
  readonly after: PaperChaosStateProjection;
  readonly orderCountDelta: number;
  readonly fillCountDelta: number;
  readonly identityPreserved: boolean;
  readonly noMutation: boolean;
  readonly resolution: PaperChaosResolution;
  readonly status: "PASS" | "FAIL";
  readonly reasonCode: string;
  readonly evidenceSha256: string;
}

export interface PaperChaosRecoveryReport {
  readonly schemaVersion: 1;
  readonly source: "PAPER_RUNTIME";
  readonly generatedAt: number;
  readonly status: "PASS" | "FAIL";
  readonly receiptCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly haltedCount: number;
  readonly receipts: readonly PaperChaosRecoveryReceipt[];
  readonly evidenceSha256: string;
}

const MAX_RECEIPTS = 32;
const SCENARIOS: readonly PaperChaosScenario[] = [
  "PROCESS_RESTART",
  "STALE_FEED",
  "PAUSED_FEED",
  "DUPLICATE_REPLAY",
  "PERSISTENCE_WRITE_INTERRUPTION",
  "PERSISTENCE_READ_CORRUPTION",
  "CLOCK_REGRESSION",
  "UPSTREAM_OUTAGE",
  "RECONCILIATION_MISMATCH",
];

const freeze = <T>(value: T): T => Object.freeze(value);

function canonical(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return entry;
    if (Array.isArray(entry)) return entry.map(normalize);
    if (typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalize(record[key])]));
    }
    throw new Error("PAPER_CHAOS_CANONICAL_VALUE_INVALID");
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} is required`);
}

function requireTime(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is invalid`);
}

function requireUniqueIds(values: readonly string[], field: string): void {
  values.forEach((value) => requireText(value, `${field} identity`));
  if (new Set(values).size !== values.length) throw new Error(`${field} identities must be unique`);
}

function validateState(state: PaperChaosState, field: string): void {
  if (state == null || typeof state !== "object") throw new Error(`${field} is required`);
  requireTime(state.observedAt, `${field}.observedAt`);
  requireUniqueIds(state.orderIds, `${field}.orderIds`);
  requireUniqueIds(state.fillIds, `${field}.fillIds`);
  if (!SCENARIO_STATUSES.runtime.includes(state.runtimeStatus)) throw new Error(`${field}.runtimeStatus is invalid`);
  if (!SCENARIO_STATUSES.persistence.includes(state.persistenceStatus)) throw new Error(`${field}.persistenceStatus is invalid`);
  if (!SCENARIO_STATUSES.upstream.includes(state.upstreamStatus)) throw new Error(`${field}.upstreamStatus is invalid`);
  if (!SCENARIO_STATUSES.chronology.includes(state.chronologyStatus)) throw new Error(`${field}.chronologyStatus is invalid`);
  if (!SCENARIO_STATUSES.reconciliation.includes(state.reconciliationStatus)) throw new Error(`${field}.reconciliationStatus is invalid`);
}

const SCENARIO_STATUSES = {
  runtime: ["RUNNING", "PAUSED", "HALTED", "ERROR"] as const,
  persistence: ["AVAILABLE", "INTERRUPTED", "CORRUPTED", "UNKNOWN"] as const,
  upstream: ["HEALTHY", "STALE", "DOWN", "UNKNOWN"] as const,
  chronology: ["VALID", "REGRESSED", "UNKNOWN"] as const,
  reconciliation: ["MATCH", "MISMATCH", "UNKNOWN"] as const,
};

function identityHash(values: readonly string[]): string {
  return sha256(canonical([...values].sort()));
}

function projectState(state: PaperChaosState): PaperChaosStateProjection {
  return freeze({
    runtimeStatus: state.runtimeStatus,
    persistenceStatus: state.persistenceStatus,
    upstreamStatus: state.upstreamStatus,
    chronologyStatus: state.chronologyStatus,
    reconciliationStatus: state.reconciliationStatus,
    orderCount: state.orderIds.length,
    fillCount: state.fillIds.length,
    orderIdentityHash: identityHash(state.orderIds),
    fillIdentityHash: identityHash(state.fillIds),
    observedAt: state.observedAt,
  });
}

function sameIdentity(left: PaperChaosState, right: PaperChaosState): boolean {
  return identityHash(left.orderIds) === identityHash(right.orderIds)
    && identityHash(left.fillIds) === identityHash(right.fillIds)
    && left.orderIds.length === right.orderIds.length
    && left.fillIds.length === right.fillIds.length;
}

function halted(status: PaperChaosRuntimeStatus): boolean {
  return status === "HALTED" || status === "ERROR";
}

function expectedScenario(input: PaperChaosDrillInput, identityPreserved: boolean): { readonly safe: boolean; readonly resolution: PaperChaosResolution; readonly reasonCode: string } {
  const { scenario, after } = input;
  const noMutation = identityPreserved;
  switch (scenario) {
    case "PROCESS_RESTART":
      return { safe: noMutation && after.persistenceStatus === "AVAILABLE" && !halted(after.runtimeStatus), resolution: "RECOVERED", reasonCode: "PAPER_PROCESS_RESTART_RECOVERED" };
    case "STALE_FEED":
      return { safe: noMutation && after.upstreamStatus === "STALE" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_STALE_FEED_HALTED" };
    case "PAUSED_FEED":
      return { safe: noMutation && after.runtimeStatus === "PAUSED", resolution: "NO_MUTATION", reasonCode: "PAPER_PAUSED_FEED_NO_MUTATION" };
    case "DUPLICATE_REPLAY":
      return { safe: noMutation && !halted(after.runtimeStatus), resolution: "NO_MUTATION", reasonCode: "PAPER_DUPLICATE_REPLAY_DEDUPED" };
    case "PERSISTENCE_WRITE_INTERRUPTION":
      return { safe: noMutation && after.persistenceStatus === "INTERRUPTED" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_PERSISTENCE_WRITE_INTERRUPTION_HALTED" };
    case "PERSISTENCE_READ_CORRUPTION":
      return { safe: noMutation && after.persistenceStatus === "CORRUPTED" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_PERSISTENCE_READ_CORRUPTION_HALTED" };
    case "CLOCK_REGRESSION":
      return { safe: noMutation && after.chronologyStatus === "REGRESSED" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_CLOCK_REGRESSION_HALTED" };
    case "UPSTREAM_OUTAGE":
      return { safe: noMutation && after.upstreamStatus === "DOWN" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_UPSTREAM_OUTAGE_HALTED" };
    case "RECONCILIATION_MISMATCH":
      return { safe: noMutation && after.reconciliationStatus === "MISMATCH" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_RECONCILIATION_MISMATCH_HALTED" };
  }
}

function receiptPayload(receipt: Omit<PaperChaosRecoveryReceipt, "evidenceSha256">): string {
  return canonical(receipt);
}

export function buildPaperChaosRecoveryReceipt(input: PaperChaosDrillInput): PaperChaosRecoveryReceipt {
  if (input.schemaVersion !== 1) throw new Error("PAPER_CHAOS_SCHEMA_UNSUPPORTED");
  requireText(input.drillId, "drillId");
  if (!SCENARIOS.includes(input.scenario)) throw new Error("PAPER_CHAOS_SCENARIO_UNSUPPORTED");
  if (input.triggerObserved !== true) throw new Error("PAPER_CHAOS_TRIGGER_NOT_OBSERVED");
  validateState(input.before, "before");
  validateState(input.after, "after");

  const before = projectState(input.before);
  const after = projectState(input.after);
  const identityPreserved = sameIdentity(input.before, input.after);
  const noMutation = identityPreserved && before.orderCount === after.orderCount && before.fillCount === after.fillCount;
  const expected = expectedScenario(input, identityPreserved);
  const receiptWithoutHash: Omit<PaperChaosRecoveryReceipt, "evidenceSha256"> = {
    schemaVersion: 1,
    source: "PAPER_RUNTIME",
    drillId: input.drillId,
    scenario: input.scenario,
    observedAt: after.observedAt,
    before,
    after,
    orderCountDelta: after.orderCount - before.orderCount,
    fillCountDelta: after.fillCount - before.fillCount,
    identityPreserved,
    noMutation,
    resolution: expected.resolution,
    status: expected.safe ? "PASS" : "FAIL",
    reasonCode: expected.safe ? expected.reasonCode : "PAPER_CHAOS_SAFETY_INVARIANT_FAILED",
  };
  return freeze({ ...receiptWithoutHash, evidenceSha256: sha256(receiptPayload(receiptWithoutHash)) });
}

export function verifyPaperChaosRecoveryReceipt(receipt: PaperChaosRecoveryReceipt): PaperChaosRecoveryReceipt {
  const { evidenceSha256, ...payload } = receipt;
  if (!/^[a-f0-9]{64}$/.test(evidenceSha256) || sha256(receiptPayload(payload)) !== evidenceSha256) throw new Error("PAPER_CHAOS_RECEIPT_INTEGRITY_FAILED");
  if (receipt.schemaVersion !== 1 || receipt.source !== "PAPER_RUNTIME" || !SCENARIOS.includes(receipt.scenario)) throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  requireText(receipt.drillId, "drillId");
  requireTime(receipt.observedAt, "observedAt");
  if (!["PASS", "FAIL"].includes(receipt.status) || !["RECOVERED", "NO_MUTATION", "HALTED"].includes(receipt.resolution)) throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  requireText(receipt.reasonCode, "reasonCode");
  if (typeof receipt.identityPreserved !== "boolean" || typeof receipt.noMutation !== "boolean") throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  if (!Number.isSafeInteger(receipt.orderCountDelta) || !Number.isSafeInteger(receipt.fillCountDelta)) throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  validateProjection(receipt.before, "before");
  validateProjection(receipt.after, "after");
  if (receipt.observedAt !== receipt.after.observedAt) throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  if (receipt.orderCountDelta !== receipt.after.orderCount - receipt.before.orderCount || receipt.fillCountDelta !== receipt.after.fillCount - receipt.before.fillCount) throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  if (receipt.identityPreserved !== (receipt.before.orderCount === receipt.after.orderCount && receipt.before.fillCount === receipt.after.fillCount && receipt.before.orderIdentityHash === receipt.after.orderIdentityHash && receipt.before.fillIdentityHash === receipt.after.fillIdentityHash)) throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  if (receipt.noMutation !== (receipt.identityPreserved && receipt.orderCountDelta === 0 && receipt.fillCountDelta === 0)) throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  const expected = expectedScenarioProjection(receipt.scenario, receipt.after, receipt.identityPreserved);
  if (receipt.resolution !== expected.resolution || receipt.status !== (expected.safe ? "PASS" : "FAIL") || receipt.reasonCode !== (expected.safe ? expected.reasonCode : "PAPER_CHAOS_SAFETY_INVARIANT_FAILED")) throw new Error("PAPER_CHAOS_RECEIPT_CONTENT_INVALID");
  return receipt;
}

function validateProjection(projection: PaperChaosStateProjection, field: string): void {
  if (projection == null || typeof projection !== "object") throw new Error(`${field} is required`);
  if (!SCENARIO_STATUSES.runtime.includes(projection.runtimeStatus)
    || !SCENARIO_STATUSES.persistence.includes(projection.persistenceStatus)
    || !SCENARIO_STATUSES.upstream.includes(projection.upstreamStatus)
    || !SCENARIO_STATUSES.chronology.includes(projection.chronologyStatus)
    || !SCENARIO_STATUSES.reconciliation.includes(projection.reconciliationStatus)) throw new Error(`${field} status is invalid`);
  for (const [name, value] of [["orderCount", projection.orderCount], ["fillCount", projection.fillCount], ["observedAt", projection.observedAt]] as const) requireTime(value, `${field}.${name}`);
  if (!/^[a-f0-9]{64}$/.test(projection.orderIdentityHash) || !/^[a-f0-9]{64}$/.test(projection.fillIdentityHash)) throw new Error(`${field} identity hash is invalid`);
}

function expectedScenarioProjection(scenario: PaperChaosScenario, after: PaperChaosStateProjection, identityPreserved: boolean): { readonly safe: boolean; readonly resolution: PaperChaosResolution; readonly reasonCode: string } {
  const noMutation = identityPreserved;
  switch (scenario) {
    case "PROCESS_RESTART":
      return { safe: noMutation && after.persistenceStatus === "AVAILABLE" && !halted(after.runtimeStatus), resolution: "RECOVERED", reasonCode: "PAPER_PROCESS_RESTART_RECOVERED" };
    case "STALE_FEED":
      return { safe: noMutation && after.upstreamStatus === "STALE" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_STALE_FEED_HALTED" };
    case "PAUSED_FEED":
      return { safe: noMutation && after.runtimeStatus === "PAUSED", resolution: "NO_MUTATION", reasonCode: "PAPER_PAUSED_FEED_NO_MUTATION" };
    case "DUPLICATE_REPLAY":
      return { safe: noMutation && !halted(after.runtimeStatus), resolution: "NO_MUTATION", reasonCode: "PAPER_DUPLICATE_REPLAY_DEDUPED" };
    case "PERSISTENCE_WRITE_INTERRUPTION":
      return { safe: noMutation && after.persistenceStatus === "INTERRUPTED" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_PERSISTENCE_WRITE_INTERRUPTION_HALTED" };
    case "PERSISTENCE_READ_CORRUPTION":
      return { safe: noMutation && after.persistenceStatus === "CORRUPTED" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_PERSISTENCE_READ_CORRUPTION_HALTED" };
    case "CLOCK_REGRESSION":
      return { safe: noMutation && after.chronologyStatus === "REGRESSED" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_CLOCK_REGRESSION_HALTED" };
    case "UPSTREAM_OUTAGE":
      return { safe: noMutation && after.upstreamStatus === "DOWN" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_UPSTREAM_OUTAGE_HALTED" };
    case "RECONCILIATION_MISMATCH":
      return { safe: noMutation && after.reconciliationStatus === "MISMATCH" && halted(after.runtimeStatus), resolution: "HALTED", reasonCode: "PAPER_RECONCILIATION_MISMATCH_HALTED" };
  }
}

export function buildPaperChaosRecoveryReport(receiptsInput: readonly PaperChaosRecoveryReceipt[], generatedAt: number): PaperChaosRecoveryReport {
  requireTime(generatedAt, "generatedAt");
  if (receiptsInput.length === 0 || receiptsInput.length > MAX_RECEIPTS) throw new Error("PAPER_CHAOS_RECEIPT_LIMIT_INVALID");
  const receipts = receiptsInput.map(verifyPaperChaosRecoveryReceipt).sort((a, b) => a.scenario.localeCompare(b.scenario) || a.observedAt - b.observedAt || a.drillId.localeCompare(b.drillId));
  if (new Set(receipts.map((receipt) => receipt.drillId)).size !== receipts.length) throw new Error("PAPER_CHAOS_DRILL_ID_DUPLICATE");
  if (receipts.some((receipt) => receipt.observedAt > generatedAt)) throw new Error("PAPER_CHAOS_RECEIPT_IN_FUTURE");
  const passedCount = receipts.filter((receipt) => receipt.status === "PASS").length;
  const failedCount = receipts.length - passedCount;
  const haltedCount = receipts.filter((receipt) => receipt.resolution === "HALTED").length;
  const payload = { schemaVersion: 1 as const, source: "PAPER_RUNTIME" as const, generatedAt, receipts: Object.freeze(receipts) };
  return freeze({
    ...payload,
    status: failedCount === 0 ? "PASS" as const : "FAIL" as const,
    receiptCount: receipts.length,
    passedCount,
    failedCount,
    haltedCount,
    evidenceSha256: sha256(canonical(payload)),
  });
}
