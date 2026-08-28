import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import {
  PaperRealizedPeriodProducer,
  PaperRealizedPeriodProducerError,
  SqlitePaperRealizedPeriodRepository,
  paperExecutionObservationId,
  type PaperRealizedPeriodOpenInput,
} from "./paperRealizedPeriodProducer";

const BASE = 1_800_000_000_000;
const HASH = "a".repeat(64);
const PLAN: PaperRealizedPeriodOpenInput = Object.freeze({
  periodId: "legacy-period",
  periodIndex: 0,
  candidateId: "candidate-a",
  datasetId: "dataset-a",
  datasetContentSha256: HASH,
  advisoryGeneratedAt: BASE - 100,
  periodStartAt: BASE,
});

function codeOf(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof PaperRealizedPeriodProducerError) return error.code;
    throw error;
  }
  throw new Error("expected PaperRealizedPeriodProducerError");
}

describe("retired PaperRealizedPeriodProducer", () => {
  it("rejects opening a caller-supplied realized period", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const producer = new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(db));
      assert.equal(codeOf(() => producer.openPeriod(PLAN)), "NON_CANONICAL_LEGACY_PRODUCER_DISABLED");
      assert.deepEqual(producer.listOpenPeriods(), []);
      assert.deepEqual(producer.listRealizedPeriods(), []);
    } finally { db.close(); }
  });

  it("rejects caller-supplied return and cost metrics at close", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const producer = new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(db));
      assert.equal(codeOf(() => producer.closePeriod({
        periodId: PLAN.periodId,
        periodEndAt: BASE + 900,
        grossReturn: 0.99,
        turnover: 10,
        feeRate: 0,
        spreadRate: 0,
        slippageRate: 0,
        status: "COMPLETED",
      })), "NON_CANONICAL_LEGACY_PRODUCER_DISABLED");
      assert.deepEqual(producer.listRealizedPeriods(), []);
    } finally { db.close(); }
  });

  it("does not persist normal PAPER execution observations through the retired path", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const producer = new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(db));
      assert.equal(producer.observeExecution({ observationId: "paper-tick-a", observedAt: BASE, status: "FILLED" }), "NO_ACTIVE_PERIOD");
      assert.deepEqual(producer.listOpenPeriods(), []);
      assert.deepEqual(producer.listRealizedPeriods(), []);
    } finally { db.close(); }
  });

  it("keeps the repository itself read-only and fail-closed", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const repository = new SqlitePaperRealizedPeriodRepository(db);
      assert.equal(codeOf(() => repository.open({ ...PLAN, schemaVersion: 1, observationIds: [], observations: [] })), "NON_CANONICAL_LEGACY_PRODUCER_DISABLED");
      assert.equal(repository.getRealized(PLAN.periodId), undefined);
      assert.deepEqual(repository.list(), []);
      assert.deepEqual(repository.listOpen(), []);
    } finally { db.close(); }
  });

  it("retains deterministic observation IDs only for telemetry compatibility", () => {
    const first = paperExecutionObservationId("krw-btc", 10, "WAIT");
    const second = paperExecutionObservationId("KRW-BTC", 10, "WAIT");
    assert.equal(first, second);
    assert.match(first, /^paper-runtime:[a-f0-9]{32}$/);
  });

  it("still rejects invalid retention configuration without writing anything", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      assert.equal(codeOf(() => new SqlitePaperRealizedPeriodRepository(db, 0)), "INVALID_RETENTION");
    } finally { db.close(); }
  });
});
