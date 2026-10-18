import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqlitePaperRealizedPeriodRepository } from "./paperRealizedPeriodProducer";
import { ClosedLearningPendingPeriodReader } from "./closedLearningPendingPeriodReader";

const START = Date.parse("2026-09-04T15:00:00.000Z");
const HASH = "a".repeat(64);

function payload(periodIndex = 0, periodId = `period-${periodIndex}`, periodStartAt = START + periodIndex * 1_000) {
  const observationId = `obs-${periodIndex + 1}`;
  return {
    schemaVersion: 1 as const,
    periodId,
    periodIndex,
    market: "KRW-BTC",
    advisory: {
      schemaVersion: 1 as const,
      generatedAt: new Date(periodStartAt - 60_000).toISOString(),
      policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 },
      entries: [{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: [], sourceDatasetIds: ["dataset-a"] }],
      excludedCandidateIds: [], reasons: [], provenance: { sourceDatasetIds: ["dataset-a"] },
    },
    candidateProvenance: [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }],
    periodStartAt,
    observationIds: [observationId],
    observations: [{ observationId, observedAt: periodStartAt + 1, status: "FILLED" as const }],
    lastObservedAt: periodStartAt + 1,
    accountBoundary: { initialCapital: 1_000_000, equity: 1_000_000, capturedAt: periodStartAt },
  };
}

function checksum(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

describe("ClosedLearningPendingPeriodReader", () => {
  it("reads the canonical pending plan without creating a second producer", () => {
    const database = new SqliteDatabase(":memory:");
    const repository = new SqlitePaperRealizedPeriodRepository(database);
    const body = JSON.stringify(payload());
    repository.putPending({ periodId: "period-0", periodIndex: 0, periodStartAt: START, payloadJson: body, checksum: checksum(body) });
    const result = new ClosedLearningPendingPeriodReader(database).list();
    assert.equal(result.length, 1);
    assert.equal(result[0]?.periodId, "period-0");
    assert.equal(result[0]?.observations[0]?.status, "FILLED");
    database.close();
  });

  it("fails closed when the persisted checksum is not the payload checksum", () => {
    const database = new SqliteDatabase(":memory:");
    const repository = new SqlitePaperRealizedPeriodRepository(database);
    const body = JSON.stringify(payload());
    repository.putPending({ periodId: "period-0", periodIndex: 0, periodStartAt: START, payloadJson: body, checksum: checksum(body) });
    database.connection.prepare("UPDATE research_paper_forward_period_pending SET checksum = ? WHERE period_id = ?").run("b".repeat(64), "period-0");
    assert.throws(() => new ClosedLearningPendingPeriodReader(database).list(), /checksum mismatch/);
    database.close();
  });

  it("fails closed when the row identity and payload identity diverge despite a valid checksum", () => {
    const database = new SqliteDatabase(":memory:");
    const repository = new SqlitePaperRealizedPeriodRepository(database);
    const changed = { ...payload(), periodId: "period-other" };
    const body = JSON.stringify(changed);
    repository.putPending({ periodId: "period-0", periodIndex: 0, periodStartAt: START, payloadJson: body, checksum: checksum(body) });
    assert.throws(() => new ClosedLearningPendingPeriodReader(database).list(), /row identity conflicts/);
    database.close();
  });

  it("reads only the schema-v1 successor while validating and quarantining the schema-v2 terminal disposition", () => {
    const database = new SqliteDatabase(":memory:");
    const repository = new SqlitePaperRealizedPeriodRepository(database);
    const originalBody = JSON.stringify(payload());
    const successorBody = JSON.stringify(payload(1));
    const original = { periodId: "period-0", periodIndex: 0, periodStartAt: START, payloadJson: originalBody, checksum: checksum(originalBody) };
    const successor = { periodId: "period-1", periodIndex: 1, periodStartAt: START + 1_000, payloadJson: successorBody, checksum: checksum(successorBody) };
    repository.putPending(original);
    repository.markPendingIneligible({
      original,
      successor,
      reason: { stage: "PERIOD_CLOSE", code: "INCOMPLETE_EXECUTION_COST_EVIDENCE", boundaryAt: successor.periodStartAt, sourceRuntimeSha: null, blockedEvidenceFingerprintSha256: checksum("blocked-cost-evidence") },
    });
    const result = new ClosedLearningPendingPeriodReader(database).list();
    assert.deepEqual(result.map((item) => [item.periodId, item.schemaVersion]), [["period-1", 1]]);
    assert.equal(repository.listPendingDispositions().length, 1);
    database.close();
  });

  it("fails closed on an unknown pending schema instead of treating it as an open plan", () => {
    const database = new SqliteDatabase(":memory:");
    const repository = new SqlitePaperRealizedPeriodRepository(database);
    const body = JSON.stringify(payload());
    repository.putPending({ periodId: "period-0", periodIndex: 0, periodStartAt: START, payloadJson: body, checksum: checksum(body) });
    const unknown = JSON.stringify({ ...payload(), schemaVersion: 3 });
    database.connection.prepare("UPDATE research_paper_forward_period_pending SET payload_json = ?, checksum = ? WHERE period_id = ?").run(unknown, checksum(unknown), "period-0");
    assert.throws(() => new ClosedLearningPendingPeriodReader(database).list(), /pending PAPER disposition|INVALID_PENDING_DISPOSITION/);
    database.close();
  });

  it("fails closed when a schema-v2 disposition fingerprint is tampered even if its row checksum is recomputed", () => {
    const database = new SqliteDatabase(":memory:");
    const repository = new SqlitePaperRealizedPeriodRepository(database);
    const originalBody = JSON.stringify(payload());
    const successorBody = JSON.stringify(payload(1));
    const original = { periodId: "period-0", periodIndex: 0, periodStartAt: START, payloadJson: originalBody, checksum: checksum(originalBody) };
    const successor = { periodId: "period-1", periodIndex: 1, periodStartAt: START + 1_000, payloadJson: successorBody, checksum: checksum(successorBody) };
    repository.putPending(original);
    repository.markPendingIneligible({ original, successor, reason: { stage: "PERIOD_CLOSE", code: "INCOMPLETE_EXECUTION_COST_EVIDENCE", boundaryAt: successor.periodStartAt, sourceRuntimeSha: null, blockedEvidenceFingerprintSha256: checksum("blocked") } });
    const row = database.connection.prepare("SELECT payload_json FROM research_paper_forward_period_pending WHERE period_id = ?").get("period-0") as { payload_json: string };
    const terminal = JSON.parse(row.payload_json); terminal.evidenceFingerprintSha256 = "f".repeat(64);
    const poisoned = JSON.stringify(terminal);
    database.connection.prepare("UPDATE research_paper_forward_period_pending SET payload_json = ?, checksum = ? WHERE period_id = ?").run(poisoned, checksum(poisoned), "period-0");
    assert.throws(() => new ClosedLearningPendingPeriodReader(database).list(), /pending PAPER disposition|INVALID_PENDING_DISPOSITION/);
    database.close();
  });

});
