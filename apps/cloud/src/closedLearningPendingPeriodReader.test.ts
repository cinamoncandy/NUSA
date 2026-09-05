import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqlitePaperRealizedPeriodRepository } from "./paperRealizedPeriodProducer";
import { ClosedLearningPendingPeriodReader } from "./closedLearningPendingPeriodReader";

const START = Date.parse("2026-09-04T15:00:00.000Z");
const HASH = "a".repeat(64);

function payload() {
  return {
    schemaVersion: 1 as const,
    periodId: "period-0",
    periodIndex: 0,
    market: "KRW-BTC",
    advisory: {
      schemaVersion: 1 as const,
      generatedAt: new Date(START - 60_000).toISOString(),
      policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 },
      entries: [{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: [], sourceDatasetIds: ["dataset-a"] }],
      excludedCandidateIds: [], reasons: [], provenance: { sourceDatasetIds: ["dataset-a"] },
    },
    candidateProvenance: [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }],
    periodStartAt: START,
    observationIds: ["obs-1"],
    observations: [{ observationId: "obs-1", observedAt: START + 1, status: "FILLED" as const }],
    lastObservedAt: START + 1,
    accountBoundary: { initialCapital: 1_000_000, equity: 1_000_000, capturedAt: START },
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
});
