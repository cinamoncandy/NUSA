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

function advisory(generatedAt: number, candidateId = "candidate-a") {
  return {
    schemaVersion: 1 as const,
    generatedAt: new Date(generatedAt).toISOString(),
    policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 5, maximumFamilyWeight: 1 },
    entries: [{ id: candidateId, familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-a"] }],
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: ["dataset-a"] },
  };
}

function openPeriod(index = 0, periodId = `period-${index}`, candidateId = "candidate-a"): PaperRealizedPeriodOpenInput {
  const periodStartAt = BASE + index * 1_000;
  return { periodId, periodIndex: index, advisory: advisory(periodStartAt - 100, candidateId), candidateProvenance: [{ candidateId, datasetId: "dataset-a", datasetContentSha256: HASH }], periodStartAt };
}
function closePeriod(plan: PaperRealizedPeriodOpenInput, overrides: Partial<PaperRealizedPeriodCloseInput["envelope"]["record"]> = {}): PaperRealizedPeriodCloseInput {
  return {
    envelope: {
      record: {
        recordId: plan.periodId,
        periodIndex: plan.periodIndex,
        advisory: plan.advisory,
        periodStartAt: plan.periodStartAt,
        periodEndAt: plan.periodStartAt + 900,
        realizedReturns: { [plan.candidateProvenance[0]!.candidateId]: 0.02 },
        benchmarkReturn: 0.01,
        turnoverCostRate: 1,
        costEvidence: { evidenceId: `cost-${plan.periodId}`, source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "CONSERVATIVE_MODEL", evidenceFingerprintSha256: HASH, observedAt: plan.periodStartAt + 1, feeRate: 0.001, spreadRate: 0.0005, slippageRate: 0.0005 },
        status: "COMPLETED",
        ...overrides,
      },
      candidateProvenance: plan.candidateProvenance,
    },
  };
}

function producer(options?: ConstructorParameters<typeof PaperRealizedPeriodProducer>[1]) {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqlitePaperRealizedPeriodRepository(db);
  return { db, repository, producer: new PaperRealizedPeriodProducer(repository, options) };
}

function codeOf(action: () => unknown): string {
  try { action(); } catch (error) { if (error instanceof PaperRealizedPeriodProducerError) return error.code; throw error; }
  throw new Error("expected PaperRealizedPeriodProducerError");
}

describe("PaperRealizedPeriodProducer", () => {
  it("appends exactly one canonical #885 envelope and replays it after restart", () => {
    const state = producer();
    try {
      const plan = state.producer.openPeriod(openPeriod());
      state.producer.observeExecution({ observationId: "paper-tick-a", observedAt: plan.periodStartAt + 1, status: "WAIT" });
      const expected = closePeriod(plan);
      assert.deepEqual(state.producer.closePeriod(expected), expected.envelope);
      const restarted = new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(state.db));
      assert.deepEqual(restarted.listRealizedPeriods(), [expected.envelope]);
      assert.equal(Number((state.db.connection.prepare("SELECT COUNT(*) AS count FROM research_paper_forward_periods").get() as { count: number }).count), 1);
      assert.equal(Number((state.db.connection.prepare("SELECT COUNT(*) AS count FROM paper_realized_periods").get() as { count: number }).count), 0);
    } finally { state.db.close(); }
  });

  it("deduplicates identical observations/close and rejects identity or outcome conflicts", () => {
    const state = producer();
    try {
      const plan = state.producer.openPeriod(openPeriod());
      state.producer.observeExecution({ observationId: "paper-tick-a", observedAt: plan.periodStartAt + 1, status: "FILLED" });
      assert.equal(codeOf(() => state.producer.observeExecution({ observationId: "paper-tick-a", observedAt: plan.periodStartAt + 2, status: "FILLED" })), "OBSERVATION_ID_CONFLICT");
      const close = closePeriod(plan);
      assert.deepEqual(state.producer.closePeriod(close), close.envelope);
      assert.deepEqual(state.producer.closePeriod(close), close.envelope);
      assert.equal(codeOf(() => state.producer.closePeriod({ envelope: { ...close.envelope, record: { ...close.envelope.record, benchmarkReturn: 0.9 } } })), "PERIOD_ID_CONFLICT");
    } finally { state.db.close(); }
  });

  it("survives restart between open and close with observations retained", () => {
    const state = producer();
    try {
      const plan = state.producer.openPeriod(openPeriod());
      state.producer.observeExecution({ observationId: "paper-tick-a", observedAt: plan.periodStartAt + 1, status: "BLOCKED" });
      const recovered = new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(state.db));
      assert.equal(recovered.listOpenPeriods()[0]!.observationIds[0], "paper-tick-a");
      recovered.closePeriod({ envelope: closePeriod(plan, { status: "HALTED" }).envelope });
      assert.equal(recovered.listRealizedPeriods()[0]!.record.status, "HALTED");
    } finally { state.db.close(); }
  });

  it("rejects missing cost provenance, candidate/provenance retirement, and chronology overlap", () => {
    const state = producer();
    try {
      const first = state.producer.openPeriod(openPeriod(0));
      state.producer.observeExecution({ observationId: "first", observedAt: first.periodStartAt + 1, status: "WAIT" });
      assert.equal(codeOf(() => state.producer.closePeriod(closePeriod(first, { costEvidence: undefined as never }))), "MISSING_COST_PROVENANCE");
      assert.equal(codeOf(() => state.producer.closePeriod({ envelope: { ...closePeriod(first).envelope, record: { ...closePeriod(first).envelope.record, advisory: advisory(first.periodStartAt - 99, "retired-candidate") }, candidateProvenance: [{ candidateId: "retired-candidate", datasetId: "dataset-a", datasetContentSha256: HASH }] } })), "PROVENANCE_CONFLICT");
      state.producer.closePeriod(closePeriod(first));
      const second = state.producer.openPeriod({ ...openPeriod(1), advisory: advisory(BASE + 400), periodStartAt: BASE + 500 });
      state.producer.observeExecution({ observationId: "second", observedAt: second.periodStartAt + 1, status: "WAIT" });
      assert.equal(codeOf(() => state.producer.closePeriod(closePeriod(second))), "PERIOD_CHRONOLOGY_CONFLICT");
    } finally { state.db.close(); }
  });

  it("keeps rejected and halted periods in deterministic bounded canonical history", () => {
    const state = producer({ maximumPeriods: 2 });
    try {
      for (const index of [0, 1, 2]) {
        const plan = state.producer.openPeriod(openPeriod(index));
        state.producer.observeExecution({ observationId: `observation-${index}`, observedAt: plan.periodStartAt + 1, status: "REJECTED" });
        state.producer.closePeriod(closePeriod(plan, { status: index === 1 ? "HALTED" : "REJECTED" }));
      }
      assert.deepEqual(state.producer.listRealizedPeriods().map((item) => item.record.periodIndex), [1, 2]);
    } finally { state.db.close(); }
  });

  it("rejects malformed/secret input before persistence and emits exact lifecycle events", () => {
    const events: string[] = [];
    const state = producer({ now: () => BASE + 7_000, onLifecycleEvent: (event) => events.push(event.type === "PERIOD_REJECTED" ? `${event.type}:${event.reasonCode}` : event.type) });
    try {
      const forbiddenField = ["to", "ken"].join("");
      assert.equal(codeOf(() => state.producer.openPeriod({ ...openPeriod(), [forbiddenField]: "not-persisted" } as never)), "FORBIDDEN_FIELD");
      assert.equal(state.repository.listPending().length, 0);
      const plan = state.producer.openPeriod(openPeriod());
      state.producer.observeExecution({ observationId: "safe", observedAt: plan.periodStartAt + 1, status: "WAIT" });
      state.producer.closePeriod(closePeriod(plan));
      assert.deepEqual(events, ["PERIOD_REJECTED:FORBIDDEN_FIELD", "PERIOD_OPEN", "PERIOD_REALIZED_PERSISTED"]);
      state.db.connection.prepare("UPDATE research_paper_forward_periods SET payload_json = ? WHERE record_id = ?").run("{", plan.periodId);
      assert.equal(codeOf(() => state.producer.listRealizedPeriods()), "MALFORMED_PERSISTED_PERIOD");
    } finally { state.db.close(); }
  });

  it("has deterministic observation identities and no execution side effect", () => {
    assert.equal(paperExecutionObservationId("KRW-BTC", 10, "WAIT"), paperExecutionObservationId("KRW-BTC", 10, "WAIT"));
    const state = producer();
    try { assert.equal(state.producer.observeExecution({ observationId: "without-period", observedAt: BASE, status: "WAIT" }), "NO_ACTIVE_PERIOD"); }
    finally { state.db.close(); }
  });
});

describe("retiring an open period when the canonical PAPER account is replaced", () => {
  function accountWith(initialCapital: number, updatedAt: number) {
    return Object.freeze({ version: 1 as const, initialCapital, cash: initialCapital, equity: initialCapital, realizedPnL: 0, unrealizedPnL: 0, positions: Object.freeze([]), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]), updatedAt });
  }

  it("retires only a period whose account boundary differs, keeps realized history, and lets a new period open", () => {
    let current = accountWith(10_000_000, BASE);
    const events: string[] = [];
    const state = producer({ readCanonicalPaperAccount: () => current, onLifecycleEvent: (event) => events.push(`${event.type}:${"reasonCode" in event ? event.reasonCode : ""}`) });
    state.producer.openPeriodFromCanonicalAccount(openPeriod(0));
    assert.equal(codeOf(() => state.producer.retireOpenPeriodForAccountChange("period-0")), "ACCOUNT_NOT_CHANGED");
    assert.equal(state.producer.hasOpenPeriod(), true);

    current = accountWith(5_000, BASE + 5_000);
    const retired = state.producer.retireOpenPeriodForAccountChange("period-0");
    assert.equal(retired.accountBoundary?.initialCapital, 10_000_000);
    assert.equal(state.producer.hasOpenPeriod(), false);
    assert.equal(state.repository.getPending("period-0"), undefined);
    assert.ok(events.includes("PERIOD_REJECTED:ACCOUNT_REPLACED"));

    const reopened = state.producer.openPeriodFromCanonicalAccount({ ...openPeriod(0, "period-new"), periodStartAt: BASE + 5_000 });
    assert.equal(reopened.accountBoundary?.initialCapital, 5_000);
    assert.equal(codeOf(() => state.producer.retireOpenPeriodForAccountChange("missing")), "PERIOD_NOT_OPEN");
  });
});

describe("retiring an open period bound to a market the runtime no longer streams", () => {
  it("retires only a market-bound period whose market is not streamed and records why", () => {
    const events: string[] = [];
    const state = producer({ onLifecycleEvent: (event) => events.push(`${event.type}:${"reasonCode" in event ? event.reasonCode : ""}`) });
    state.producer.openPeriod({ ...openPeriod(0), market: "KRW-BTC" });
    assert.equal(codeOf(() => state.producer.retireOpenPeriodForUnstreamedMarket("period-0", ["KRW-BTC", "KRW-XRP"])), "MARKET_STILL_STREAMED");
    assert.equal(codeOf(() => state.producer.retireOpenPeriodForUnstreamedMarket("period-0", [])), "STREAMED_MARKETS_UNAVAILABLE");
    assert.equal(state.producer.hasOpenPeriod(), true);
    const retired = state.producer.retireOpenPeriodForUnstreamedMarket("period-0", ["krw-xrp"]);
    assert.equal(retired.market, "KRW-BTC");
    assert.equal(state.producer.hasOpenPeriod(), false);
    assert.equal(state.repository.getPending("period-0"), undefined);
    assert.equal(state.producer.listRealizedPeriods().length, 0, "nothing is closed or scored");
    assert.ok(events.includes("PERIOD_REJECTED:MARKET_NOT_STREAMED"));
    assert.equal(codeOf(() => state.producer.retireOpenPeriodForUnstreamedMarket("period-0", ["KRW-XRP"])), "PERIOD_NOT_OPEN");
  });

  it("never retires a period that carries no market", () => {
    const state = producer();
    state.producer.openPeriod(openPeriod(0));
    assert.equal(codeOf(() => state.producer.retireOpenPeriodForUnstreamedMarket("period-0", ["KRW-XRP"])), "MARKET_STILL_STREAMED");
    assert.equal(state.producer.hasOpenPeriod(), true);
  });
});
