import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResearchFactoryQualificationResult } from "./researchFactoryQualification";
import type { ResearchRunLeagueResult } from "./researchRunLeagueBridge";
import { FileResearchInvestmentLearningLedgerStore, appendResearchQualificationToLearningLedger } from "./researchInvestmentLearningLedger";

const H40 = "a".repeat(40);
const H64 = "b".repeat(64);
const fingerprint = "c".repeat(64);

function run(): ResearchRunLeagueResult {
  const ids = ["candidate-a", "candidate-b", "candidate-c"];
  return {
    schemaVersion: 1,
    evidenceMode: "RESEARCH_TIER_ONLY",
    provenance: {
      schemaVersion: 1,
      runFingerprintSha256: fingerprint,
      sourceCommitSha: H40,
      costModelVersion: "cost-v1",
      dataset: { datasetId: "dataset-a", contentSha256: H64, source: "fixture", market: "KRW-BTC", interval: "1d", startOpenTime: 1, endCloseTime: 2 },
      candidateBindings: ids.map((candidateId) => ({ candidateId, familyId: "trend", lineageId: "trend-v1", specificationHash: "d".repeat(64), datasetId: "dataset-a", datasetContentSha256: H64, parameters: { p: 1 } })),
      benchmarkIdentity: { kind: "BUY_AND_HOLD", evidenceSha256: "e".repeat(64) },
      evidenceIdentity: { dsrSha256: "f".repeat(64), regimeSha256: "1".repeat(64), oosObservationSha256: "2".repeat(64) },
    },
    standing: {
      schemaVersion: 1,
      generatedAt: "2026-09-10T00:00:00.000Z",
      policy: { probabilityBacktestOverfittingPenaltyWeight: 200, regimeRobustnessThreshold: 0.5, fragileEvidenceDiscount: 0.25, insufficientRegimeEvidenceDiscount: 0.5 },
      entries: ids.map((id) => ({ id, familyId: "trend", eligible: id === "candidate-c", outcome: id === "candidate-c" ? "QUALIFIED_FOR_LEAGUE" as const : "REJECTED" as const, reasons: ["fixture"], evidenceBreadth: 1, components: { outOfSamplePerformance: 0, benchmarkExcess: 0, maximumDrawdown: 0 }, ...(id === "candidate-c" ? { leagueScore: 1, rank: 1 } : {}), sourceDatasetIds: ["dataset-a"] })),
      coverage: { candidateCount: 3, eligibleCount: 1, familyCount: 1 },
      provenance: { sourceDatasetIds: ["dataset-a"] },
    },
    evidenceReport: ids.map((candidateId) => ({ candidateId, outcome: candidateId === "candidate-c" ? "QUALIFIED_FOR_LEAGUE" as const : "REJECTED" as const, summary: "fixture", supportingEvidence: [], counterEvidence: [], missingEvidence: [], costSensitivity: { status: "MISSING" as const }, overfitRisk: "MISSING" as const })),
    reasons: ["fixture"],
  };
}

function qualification(): ResearchFactoryQualificationResult {
  return {
    schemaVersion: 1,
    candidates: [
      { candidateId: "candidate-a", outcome: "REJECTED", reasons: ["REGIME_FRAGILE_EDGE"], summary: "rejected" },
      { candidateId: "candidate-b", outcome: "INSUFFICIENT", reasons: ["TRIAL_LEDGER_EVIDENCE_MISSING"], summary: "insufficient" },
      { candidateId: "candidate-c", outcome: "QUALIFIED_FOR_LEAGUE", reasons: [], summary: "qualified" },
    ],
    coverage: { candidateCount: 3, qualifiedCount: 1, insufficientCount: 1, rejectedCount: 1 },
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

describe("Research investment-learning ledger", () => {
  it("learns from final qualification truth, not DSR availability", () => {
    const ledger = appendResearchQualificationToLearningLedger([], run(), qualification());
    assert.equal(ledger.length, 3);
    assert.deepEqual(ledger.map((record) => record.outcome), ["REJECTED", "ABSTAINED", "COMPLETED"]);
    assert.deepEqual(ledger[0]!.rejectionReasons, ["REGIME_FRAGILE_EDGE"]);
    assert.deepEqual(ledger[1]!.abstentionReasons, ["TRIAL_LEDGER_EVIDENCE_MISSING"]);
    assert.equal(ledger[2]!.metrics?.qualificationOutcome, "QUALIFIED_FOR_LEAGUE");
  });

  it("is exactly idempotent for an identical canonical run replay", () => {
    const once = appendResearchQualificationToLearningLedger([], run(), qualification());
    const twice = appendResearchQualificationToLearningLedger(once, run(), qualification());
    assert.equal(twice.length, once.length);
    assert.equal(twice.at(-1)!.recordHash, once.at(-1)!.recordHash);
  });

  it("fails closed when qualification coverage or candidate provenance is inconsistent", () => {
    const badQualification = { ...qualification(), coverage: { candidateCount: 3, qualifiedCount: 99, insufficientCount: 1, rejectedCount: 1 } };
    assert.throws(() => appendResearchQualificationToLearningLedger([], run(), badQualification));
    const base = run();
    const badRun = { ...base, provenance: { ...base.provenance, candidateBindings: base.provenance.candidateBindings.slice(1) } };
    assert.throws(() => appendResearchQualificationToLearningLedger([], badRun, qualification()));
  });

  it("persists only append-only sealed records and replays without duplicate bytes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-investment-learning-"));
    try {
      const filename = path.join(root, "learning.jsonl");
      const store = new FileResearchInvestmentLearningLedgerStore(filename);
      const first = store.appendRun(run(), qualification());
      const firstBytes = fs.readFileSync(filename, "utf8");
      const second = store.appendRun(run(), qualification());
      const secondBytes = fs.readFileSync(filename, "utf8");
      assert.equal(first.length, 3);
      assert.equal(second.length, 3);
      assert.equal(secondBytes, firstBytes);
      assert.equal(store.read().at(-1)!.recordHash, first.at(-1)!.recordHash);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
