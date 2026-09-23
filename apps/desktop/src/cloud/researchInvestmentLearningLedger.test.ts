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

const stubQualify = (): ResearchFactoryQualificationResult => qualification();

function withStore<T>(fn: (filename: string, store: FileResearchInvestmentLearningLedgerStore) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-investment-learning-"));
  try {
    const filename = path.join(root, "learning.jsonl");
    return fn(filename, new FileResearchInvestmentLearningLedgerStore(filename, stubQualify));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const codeOf = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

describe("Research investment-learning ledger", () => {
  it("replays a retried search idempotently when only the timestamp and fingerprint changed", () => {
    const once = appendResearchQualificationToLearningLedger([], run(), qualification(), stubQualify);
    const base = run();
    const retried = {
      ...base,
      provenance: { ...base.provenance, runFingerprintSha256: "9".repeat(64) },
      standing: { ...base.standing, generatedAt: "2026-09-11T00:00:00.000Z" },
    };
    const twice = appendResearchQualificationToLearningLedger(once, retried, qualification(), stubQualify);
    assert.equal(twice.length, once.length);
    assert.equal(new Set(twice.map((record) => record.search.searchId)).size, 1);
  });

  it("appends a new search when the dataset content changes", () => {
    const once = appendResearchQualificationToLearningLedger([], run(), qualification(), stubQualify);
    const base = run();
    const next = {
      ...base,
      provenance: {
        ...base.provenance,
        dataset: { ...base.provenance.dataset, contentSha256: "3".repeat(64) },
        candidateBindings: base.provenance.candidateBindings.map((binding) => ({ ...binding, datasetContentSha256: "3".repeat(64) })),
      },
    };
    const twice = appendResearchQualificationToLearningLedger(once, next, qualification(), stubQualify);
    assert.equal(twice.length, 6);
    assert.equal(new Set(twice.map((record) => record.search.searchId)).size, 2);
  });

  it("rejects a qualification that does not match the canonical qualification of the supplied run", () => {
    const stale = qualification();
    const recomputed = (): ResearchFactoryQualificationResult => ({
      ...stale,
      candidates: stale.candidates.map((candidate) => candidate.candidateId === "candidate-a"
        ? { ...candidate, outcome: "QUALIFIED_FOR_LEAGUE" as const, reasons: [] }
        : candidate),
    });
    assert.throws(() => appendResearchQualificationToLearningLedger([], run(), stale, recomputed), codeOf("QUALIFICATION_RUN_MISMATCH"));
    assert.throws(() => appendResearchQualificationToLearningLedger([], run(), stale, () => { throw new Error("x"); }), codeOf("QUALIFICATION_RECOMPUTE_FAILED"));
  });

  it("serializes appends: a held lock fails closed without writing", () => {
    withStore((filename, store) => {
      fs.writeFileSync(`${filename}.lock`, "");
      assert.throws(() => store.appendRun(run(), qualification()), codeOf("CONCURRENT_LEDGER_APPEND"));
      assert.equal(fs.existsSync(filename), false);
    });
  });

  it("detects deletion, truncation, and rollback of anchored ledger history", () => {
    withStore((filename, store) => {
      store.appendRun(run(), qualification());
      const bytes = fs.readFileSync(filename, "utf8");
      const lines = bytes.trimEnd().split("\n");

      fs.writeFileSync(filename, `${lines.slice(0, 2).join("\n")}\n`);
      assert.throws(() => store.read(), codeOf("LEDGER_HISTORY_ROLLBACK"));

      fs.rmSync(filename);
      assert.throws(() => store.read(), codeOf("LEDGER_HISTORY_LOST"));
      assert.throws(() => store.appendRun(run(), qualification()), codeOf("LEDGER_HISTORY_LOST"));

      fs.writeFileSync(filename, bytes);
      assert.equal(store.read().length, 3);
      fs.rmSync(`${filename}.anchor.json`);
      assert.throws(() => store.read(), codeOf("LEDGER_ANCHOR_MISSING"));
    });
  });

  it("learns from final qualification truth, not DSR availability", () => {
    const ledger = appendResearchQualificationToLearningLedger([], run(), qualification(), stubQualify);
    assert.equal(ledger.length, 3);
    assert.deepEqual(ledger.map((record) => record.outcome), ["REJECTED", "ABSTAINED", "COMPLETED"]);
    assert.deepEqual(ledger[0]!.rejectionReasons, ["REGIME_FRAGILE_EDGE"]);
    assert.deepEqual(ledger[1]!.abstentionReasons, ["TRIAL_LEDGER_EVIDENCE_MISSING"]);
    assert.equal(ledger[2]!.metrics?.qualificationOutcome, "QUALIFIED_FOR_LEAGUE");
  });

  it("is exactly idempotent for an identical canonical run replay", () => {
    const once = appendResearchQualificationToLearningLedger([], run(), qualification(), stubQualify);
    const twice = appendResearchQualificationToLearningLedger(once, run(), qualification(), stubQualify);
    assert.equal(twice.length, once.length);
    assert.equal(twice.at(-1)!.recordHash, once.at(-1)!.recordHash);
  });

  it("fails closed when qualification coverage or candidate provenance is inconsistent", () => {
    const badQualification = { ...qualification(), coverage: { candidateCount: 3, qualifiedCount: 99, insufficientCount: 1, rejectedCount: 1 } };
    assert.throws(() => appendResearchQualificationToLearningLedger([], run(), badQualification, stubQualify));
    const base = run();
    const badRun = { ...base, provenance: { ...base.provenance, candidateBindings: base.provenance.candidateBindings.slice(1) } };
    assert.throws(() => appendResearchQualificationToLearningLedger([], badRun, qualification(), stubQualify));
  });

  it("persists only append-only sealed records and replays without duplicate bytes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-investment-learning-"));
    try {
      const filename = path.join(root, "learning.jsonl");
      const store = new FileResearchInvestmentLearningLedgerStore(filename, stubQualify);
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
