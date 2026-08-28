import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import {
  PaperRealizedPeriodProducer,
  PaperRealizedPeriodProducerError,
  SqlitePaperRealizedPeriodRepository,
  paperExecutionObservationId,
  type PaperRealizedPeriodCloseInput,
  type PaperRealizedPeriodOpenInput,
} from "./paperRealizedPeriodProducer";

const BASE = 1_800_000_000_000;
const HASH = "a".repeat(64);

function openPeriod(index = 0, periodId = `period-${index}`): PaperRealizedPeriodOpenInput {
  const periodStartAt = BASE + index * 1_000;
  return { periodId, periodIndex: index, candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH, advisoryGeneratedAt: periodStartAt - 100, periodStartAt };
}

function closePeriod(periodId: string, periodStartAt: number, status: PaperRealizedPeriodCloseInput["status"] = "COMPLETED"): PaperRealizedPeriodCloseInput {
  return { periodId, periodEndAt: periodStartAt + 900, grossReturn: status === "COMPLETED" ? 0.02 : 0, turnover: status === "COMPLETED" ? 1 : 0, feeRate: 0.001, spreadRate: 0.0005, slippageRate: 0.0005, status };
}

function producer(maximumPeriods?: number) {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqlitePaperRealizedPeriodRepository(db, maximumPeriods);
  return { db, repository, producer: new PaperRealizedPeriodProducer(repository) };
}

function codeOf(action: () => unknown): string {
  try { action(); } catch (error) { if (error instanceof PaperRealizedPeriodProducerError) return error.code; throw error; }
  throw new Error("expected PaperRealizedPeriodProducerError");
}

describe("PaperRealizedPeriodProducer", () => {
  it("persists a realized period through restart after a canonical PAPER observation", () => {
    const first = producer();
    try {
      const plan = first.producer.openPeriod(openPeriod());
      first.producer.observeExecution({ observationId: "paper-tick-a", observedAt: plan.periodStartAt + 1, status: "WAIT" });
      const expected = first.producer.closePeriod(closePeriod(plan.periodId, plan.periodStartAt));
      const restarted = new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(first.db));
      assert.deepEqual(restarted.listRealizedPeriods(), [expected]);
      assert.deepEqual(restarted.listOpenPeriods(), []);
    } finally { first.db.close(); }
  });

  it("deduplicates an identical close and rejects a conflicting close", () => {
    const state = producer();
    try {
      const plan = state.producer.openPeriod(openPeriod());
      state.producer.observeExecution({ observationId: "paper-tick-a", observedAt: plan.periodStartAt + 1, status: "FILLED" });
      assert.equal(codeOf(() => state.producer.observeExecution({ observationId: "paper-tick-a", observedAt: plan.periodStartAt + 2, status: "FILLED" })), "OBSERVATION_ID_CONFLICT");
      const close = closePeriod(plan.periodId, plan.periodStartAt);
      const first = state.producer.closePeriod(close);
      assert.deepEqual(state.producer.closePeriod(close), first);
      assert.equal(codeOf(() => state.producer.closePeriod({ ...close, grossReturn: 0.9 })), "PERIOD_ID_CONFLICT");
    } finally { state.db.close(); }
  });

  it("survives restart between open and close with observation identity retained", () => {
    const state = producer();
    try {
      const plan = state.producer.openPeriod(openPeriod());
      state.producer.observeExecution({ observationId: "paper-tick-a", observedAt: plan.periodStartAt + 1, status: "BLOCKED" });
      const recovered = new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(state.db));
      assert.equal(recovered.listOpenPeriods()[0]!.observationIds[0], "paper-tick-a");
      recovered.closePeriod(closePeriod(plan.periodId, plan.periodStartAt, "HALTED"));
      assert.equal(recovered.listRealizedPeriods()[0]!.status, "HALTED");
    } finally { state.db.close(); }
  });

  it("rejects missing observation, overlap, and out-of-order chronology fail-closed", () => {
    const state = producer();
    try {
      const first = state.producer.openPeriod(openPeriod(0));
      assert.equal(codeOf(() => state.producer.closePeriod(closePeriod(first.periodId, first.periodStartAt))), "PERIOD_OUTCOME_NOT_OBSERVED");
      state.producer.observeExecution({ observationId: "first", observedAt: first.periodStartAt + 1, status: "WAIT" });
      state.producer.closePeriod(closePeriod(first.periodId, first.periodStartAt));
      const second = state.producer.openPeriod({ ...openPeriod(1), advisoryGeneratedAt: BASE + 400, periodStartAt: BASE + 500 });
      state.producer.observeExecution({ observationId: "second", observedAt: second.periodStartAt + 1, status: "WAIT" });
      assert.equal(codeOf(() => state.producer.closePeriod(closePeriod(second.periodId, second.periodStartAt))), "PERIOD_CHRONOLOGY_CONFLICT");
    } finally { state.db.close(); }
  });

  it("keeps rejected and halted periods in bounded deterministic history", () => {
    const state = producer(2);
    try {
      for (const index of [0, 1, 2]) {
        const plan = state.producer.openPeriod(openPeriod(index));
        state.producer.observeExecution({ observationId: `observation-${index}`, observedAt: plan.periodStartAt + 1, status: "REJECTED" });
        state.producer.closePeriod(closePeriod(plan.periodId, plan.periodStartAt, index === 1 ? "HALTED" : "REJECTED"));
      }
      assert.deepEqual(state.producer.listRealizedPeriods().map((item) => item.periodId), ["period-1", "period-2"]);
      assert.deepEqual(state.producer.listRealizedPeriods().map((item) => item.status), ["HALTED", "REJECTED"]);
    } finally { state.db.close(); }
  });

  it("rejects malformed, secret-bearing, and provenance-invalid input before persistence", () => {
    const state = producer();
    try {
      assert.equal(codeOf(() => state.producer.openPeriod({ ...openPeriod(), token: "not-persisted" } as unknown as PaperRealizedPeriodOpenInput)), "FORBIDDEN_FIELD");
      assert.equal(codeOf(() => state.producer.openPeriod({ ...openPeriod(), datasetContentSha256: "not-a-digest" })), "INVALID_DATASET_PROVENANCE");
      const plan = state.producer.openPeriod(openPeriod());
      state.producer.observeExecution({ observationId: "safe", observedAt: plan.periodStartAt + 1, status: "WAIT" });
      state.producer.closePeriod(closePeriod(plan.periodId, plan.periodStartAt));
      state.db.connection.prepare("UPDATE paper_realized_periods SET payload_json = ? WHERE period_id = ?").run("{", plan.periodId);
      assert.equal(codeOf(() => state.producer.listRealizedPeriods()), "MALFORMED_PERSISTED_PERIOD");
    } finally { state.db.close(); }
  });

  it("rejects persisted row identity and chronology mismatches", () => {
    const state = producer();
    try {
      const plan = state.producer.openPeriod(openPeriod());
      state.producer.observeExecution({ observationId: "safe", observedAt: plan.periodStartAt + 1, status: "WAIT" });
      state.producer.closePeriod(closePeriod(plan.periodId, plan.periodStartAt));
      state.db.connection.prepare("UPDATE paper_realized_periods SET period_id = ? WHERE period_id = ?").run("row-only-id", plan.periodId);
      assert.equal(codeOf(() => state.producer.listRealizedPeriods()), "PERSISTED_ROW_IDENTITY_MISMATCH");
    } finally { state.db.close(); }

    const chronology = producer();
    try {
      const plan = chronology.producer.openPeriod(openPeriod());
      chronology.producer.observeExecution({ observationId: "safe", observedAt: plan.periodStartAt + 1, status: "WAIT" });
      chronology.producer.closePeriod(closePeriod(plan.periodId, plan.periodStartAt));
      chronology.db.connection.prepare("UPDATE paper_realized_periods SET period_end_at = ? WHERE period_id = ?").run(plan.periodStartAt + 901, plan.periodId);
      assert.equal(codeOf(() => chronology.producer.listRealizedPeriods()), "PERSISTED_ROW_IDENTITY_MISMATCH");
    } finally { chronology.db.close(); }
  });

  it("uses a deterministic observation identity and has no authority or execution side effect", () => {
    assert.equal(paperExecutionObservationId("KRW-BTC", 10, "WAIT"), paperExecutionObservationId("KRW-BTC", 10, "WAIT"));
    const state = producer();
    try {
      const before = state.producer.listRealizedPeriods();
      assert.equal(state.producer.observeExecution({ observationId: "without-period", observedAt: BASE, status: "WAIT" }), "NO_ACTIVE_PERIOD");
      assert.deepEqual(state.producer.listRealizedPeriods(), before);
    } finally { state.db.close(); }
  });
});
