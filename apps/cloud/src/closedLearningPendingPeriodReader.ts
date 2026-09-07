import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqlitePaperRealizedPeriodRepository, type PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";

const MARKET = /^KRW-[A-Z0-9-]+$/;
const STATUSES = new Set(["FILLED", "WAIT", "BLOCKED", "REJECTED", "FAILED", "DUPLICATE"]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validatePlan(value: unknown, row: Readonly<{ periodId: string; periodIndex: number; periodStartAt: number }>): PersistedPaperRealizedPeriodPlan {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("closed-learning pending PAPER payload is invalid");
  const plan = value as PersistedPaperRealizedPeriodPlan;
  if (plan.schemaVersion !== 1 || plan.periodId !== row.periodId || plan.periodIndex !== row.periodIndex || plan.periodStartAt !== row.periodStartAt) {
    throw new Error("closed-learning pending PAPER row identity conflicts with payload");
  }
  if (!safeInteger(plan.periodIndex) || !safeInteger(plan.periodStartAt)) throw new Error("closed-learning pending PAPER chronology is invalid");
  if (plan.market !== undefined && !MARKET.test(plan.market.trim().toUpperCase())) throw new Error("closed-learning pending PAPER market is invalid");
  if (plan.advisory == null || !Array.isArray(plan.advisory.entries) || !Array.isArray(plan.candidateProvenance) || plan.candidateProvenance.length === 0) {
    throw new Error("closed-learning pending PAPER candidate provenance is unavailable");
  }
  if (!Array.isArray(plan.observationIds) || !Array.isArray(plan.observations) || plan.observationIds.length !== plan.observations.length) {
    throw new Error("closed-learning pending PAPER observations are invalid");
  }
  for (let index = 0; index < plan.observations.length; index += 1) {
    const observation = plan.observations[index];
    if (observation == null || observation.observationId !== plan.observationIds[index] || !safeInteger(observation.observedAt) || !STATUSES.has(observation.status)) {
      throw new Error("closed-learning pending PAPER observation identity is invalid");
    }
  }
  if (plan.accountBoundary == null || !Number.isFinite(plan.accountBoundary.initialCapital) || plan.accountBoundary.initialCapital <= 0 || !Number.isFinite(plan.accountBoundary.equity) || plan.accountBoundary.equity < 0 || plan.accountBoundary.capturedAt !== plan.periodStartAt) {
    throw new Error("closed-learning pending PAPER canonical account boundary is invalid");
  }
  return Object.freeze({
    ...plan,
    candidateProvenance: Object.freeze(plan.candidateProvenance.map((item) => Object.freeze({ ...item }))),
    observationIds: Object.freeze([...plan.observationIds]),
    observations: Object.freeze(plan.observations.map((item) => Object.freeze({ ...item }))),
    accountBoundary: Object.freeze({ ...plan.accountBoundary }),
  });
}

/**
 * Read-only view over the exact pending-period ledger owned by the canonical producer. It creates
 * no second producer and performs no period writes. Every payload must match its persisted SHA-256
 * checksum and row identity before it can drive closed-learning rollover decisions.
 */
export class ClosedLearningPendingPeriodReader {
  private readonly repository: SqlitePaperRealizedPeriodRepository;

  public constructor(database: SqliteDatabase) {
    this.repository = new SqlitePaperRealizedPeriodRepository(database);
  }

  public list(): readonly PersistedPaperRealizedPeriodPlan[] {
    const rows = this.repository.listPending();
    return Object.freeze(rows.map((row) => {
      if (sha256(row.payloadJson) !== row.checksum) throw new Error("closed-learning pending PAPER checksum mismatch");
      let parsed: unknown;
      try { parsed = JSON.parse(row.payloadJson); }
      catch { throw new Error("closed-learning pending PAPER payload is malformed"); }
      return validatePlan(parsed, row);
    }));
  }
}
