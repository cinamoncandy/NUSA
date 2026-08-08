import { createHash } from "node:crypto";

export type ValidationState = "PASS" | "FAIL" | "UNKNOWN";
export type ReconciliationState = "MATCH" | "DIFF" | "UNKNOWN";
export type ClosedState = "CLOSED" | "OPEN" | "UNKNOWN";
export type MutationAfterCloseState = "NO" | "YES" | "UNKNOWN";
export type PostLiveValidationVerdict = "READY_FOR_HUMAN_REVIEW" | "SAFE_BLOCK" | "UNKNOWN";

export interface TinyApprovedLimits {
  readonly maxOrderNotionalBps: number;
  readonly maxGrossExposureBps: number;
  readonly maxDailyLossBps: number;
  readonly maxOpenOrders: number;
  readonly maxPositionCount: number;
  readonly maxSessionOrders: number;
  readonly maxSessionDurationSeconds: number;
}

export interface ObservedTinySessionMetrics {
  readonly orderCount: number;
  readonly maxOrderNotionalBps: number;
  readonly maxGrossExposureBps: number;
  readonly realizedDailyLossBps: number;
  readonly maxOpenOrders: number;
  readonly maxPositionCount: number;
}

export interface PostLiveSessionEvidence {
  readonly sessionId: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly releaseSealFingerprint: string;
  readonly externalReadOnlyPreflightReceiptFingerprint: string;
  readonly ceremonyRecordFingerprint: string;
  readonly boundedEnvelopeFingerprint: string;
  readonly auditAnchor: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly approvedLimits: TinyApprovedLimits;
  readonly observed: ObservedTinySessionMetrics;
  readonly reconciliation: {
    readonly orders: ReconciliationState;
    readonly fills: ReconciliationState;
    readonly positions: ReconciliationState;
    readonly cash: ReconciliationState;
  };
  readonly checks: {
    readonly hardRisk: ValidationState;
    readonly haltPath: ValidationState;
    readonly auditChain: ValidationState;
    readonly postTradeObservation: ValidationState;
  };
  readonly executionTransportAtValidation: ClosedState;
  readonly mutationAfterSessionClose: MutationAfterCloseState;
}

export interface PostLiveSessionValidationResult {
  readonly verdict: PostLiveValidationVerdict;
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly validationFingerprint: string;
  readonly scaleUpAuthority: false;
  readonly activationAuthority: false;
  readonly orderAuthorization: false;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly mutationPerformed: false;
  readonly realMoneyExecutionAllowed: false;
}

export const POST_LIVE_VALIDATION_DESCRIPTOR = Object.freeze({
  mode: "EVIDENCE_VALIDATION_ONLY" as const,
  actualLiveSessionInCi: false,
  scaleUpAuthority: false,
  activationAuthority: false,
  orderAuthorization: false,
  executionAuthority: false,
  authorizesLive: false,
  mutationPerformed: false,
  realMoneyExecutionAllowed: false,
});

const HARD_CEILINGS: TinyApprovedLimits = Object.freeze({
  maxOrderNotionalBps: 10,
  maxGrossExposureBps: 50,
  maxDailyLossBps: 10,
  maxOpenOrders: 1,
  maxPositionCount: 1,
  maxSessionOrders: 5,
  maxSessionDurationSeconds: 3600,
});

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function assertIdentity(evidence: PostLiveSessionEvidence): void {
  if (!ID.test(evidence.sessionId)) throw new Error("INVALID_SESSION_ID");
  if (!HEX40.test(evidence.codeRevision)) throw new Error("INVALID_CODE_REVISION");
  for (const [name, value] of Object.entries({
    configurationHash: evidence.configurationHash,
    releaseSealFingerprint: evidence.releaseSealFingerprint,
    externalReadOnlyPreflightReceiptFingerprint: evidence.externalReadOnlyPreflightReceiptFingerprint,
    ceremonyRecordFingerprint: evidence.ceremonyRecordFingerprint,
    boundedEnvelopeFingerprint: evidence.boundedEnvelopeFingerprint,
    auditAnchor: evidence.auditAnchor,
  })) {
    if (!HEX64.test(value)) throw new Error(`INVALID_${name.toUpperCase()}`);
  }
}

function positiveOrZero(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function safeIntegerOrZero(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateNumericShape(evidence: PostLiveSessionEvidence): void {
  const limits = evidence.approvedLimits;
  const observed = evidence.observed;
  const positiveLimits = [limits.maxOrderNotionalBps, limits.maxGrossExposureBps, limits.maxDailyLossBps];
  if (positiveLimits.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("INVALID_APPROVED_LIMIT");
  const countLimits = [limits.maxOpenOrders, limits.maxPositionCount, limits.maxSessionOrders, limits.maxSessionDurationSeconds];
  if (countLimits.some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new Error("INVALID_APPROVED_COUNT_LIMIT");
  if (![observed.maxOrderNotionalBps, observed.maxGrossExposureBps, observed.realizedDailyLossBps].every(positiveOrZero)) throw new Error("INVALID_OBSERVED_BPS");
  if (![observed.orderCount, observed.maxOpenOrders, observed.maxPositionCount].every(safeIntegerOrZero)) throw new Error("INVALID_OBSERVED_COUNT");
}

function addState(name: string, state: ValidationState, blockers: string[], unknowns: string[]): void {
  if (state === "FAIL") blockers.push(`${name}_FAIL`);
  else if (state === "UNKNOWN") unknowns.push(`${name}_UNKNOWN`);
}

function addReconciliation(name: string, state: ReconciliationState, blockers: string[], unknowns: string[]): void {
  if (state === "DIFF") blockers.push(`${name}_RECONCILIATION_DIFF`);
  else if (state === "UNKNOWN") unknowns.push(`${name}_RECONCILIATION_UNKNOWN`);
}

export function evaluatePostLiveSessionEvidence(evidence: PostLiveSessionEvidence): PostLiveSessionValidationResult {
  assertIdentity(evidence);
  validateNumericShape(evidence);
  const blockers: string[] = [];
  const unknowns: string[] = [];

  const startedAt = Date.parse(evidence.startedAt);
  const endedAt = Date.parse(evidence.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) throw new Error("INVALID_SESSION_TIME_RANGE");
  const durationSeconds = (endedAt - startedAt) / 1000;

  for (const [key, hardCeiling] of Object.entries(HARD_CEILINGS) as [keyof TinyApprovedLimits, number][]) {
    if (evidence.approvedLimits[key] > hardCeiling) blockers.push(`APPROVED_${key.toUpperCase()}_EXCEEDS_HARD_CEILING`);
  }

  if (durationSeconds > evidence.approvedLimits.maxSessionDurationSeconds) blockers.push("SESSION_DURATION_EXCEEDED");
  if (evidence.observed.orderCount > evidence.approvedLimits.maxSessionOrders) blockers.push("SESSION_ORDER_COUNT_EXCEEDED");
  if (evidence.observed.maxOrderNotionalBps > evidence.approvedLimits.maxOrderNotionalBps) blockers.push("ORDER_NOTIONAL_EXCEEDED");
  if (evidence.observed.maxGrossExposureBps > evidence.approvedLimits.maxGrossExposureBps) blockers.push("GROSS_EXPOSURE_EXCEEDED");
  if (evidence.observed.realizedDailyLossBps > evidence.approvedLimits.maxDailyLossBps) blockers.push("DAILY_LOSS_EXCEEDED");
  if (evidence.observed.maxOpenOrders > evidence.approvedLimits.maxOpenOrders) blockers.push("OPEN_ORDERS_EXCEEDED");
  if (evidence.observed.maxPositionCount > evidence.approvedLimits.maxPositionCount) blockers.push("POSITION_COUNT_EXCEEDED");

  addReconciliation("ORDER", evidence.reconciliation.orders, blockers, unknowns);
  addReconciliation("FILL", evidence.reconciliation.fills, blockers, unknowns);
  addReconciliation("POSITION", evidence.reconciliation.positions, blockers, unknowns);
  addReconciliation("CASH", evidence.reconciliation.cash, blockers, unknowns);
  addState("HARD_RISK", evidence.checks.hardRisk, blockers, unknowns);
  addState("HALT_PATH", evidence.checks.haltPath, blockers, unknowns);
  addState("AUDIT_CHAIN", evidence.checks.auditChain, blockers, unknowns);
  addState("POST_TRADE_OBSERVATION", evidence.checks.postTradeObservation, blockers, unknowns);

  if (evidence.executionTransportAtValidation === "OPEN") blockers.push("EXECUTION_TRANSPORT_STILL_OPEN");
  else if (evidence.executionTransportAtValidation === "UNKNOWN") unknowns.push("EXECUTION_TRANSPORT_UNKNOWN");
  if (evidence.mutationAfterSessionClose === "YES") blockers.push("MUTATION_AFTER_SESSION_CLOSE");
  else if (evidence.mutationAfterSessionClose === "UNKNOWN") unknowns.push("MUTATION_AFTER_SESSION_CLOSE_UNKNOWN");

  const verdict: PostLiveValidationVerdict = blockers.length > 0 ? "SAFE_BLOCK" : unknowns.length > 0 ? "UNKNOWN" : "READY_FOR_HUMAN_REVIEW";
  const validationFingerprint = sha256({
    ...evidence,
    blockers: [...blockers].sort(),
    unknowns: [...unknowns].sort(),
    verdict,
  });

  return Object.freeze({
    verdict,
    blockers: Object.freeze(blockers),
    unknowns: Object.freeze(unknowns),
    validationFingerprint,
    scaleUpAuthority: false,
    activationAuthority: false,
    orderAuthorization: false,
    executionAuthority: false,
    authorizesLive: false,
    mutationPerformed: false,
    realMoneyExecutionAllowed: false,
  });
}
