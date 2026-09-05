import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { QualifiedPaperChallengerArtifact } from "./paperChallengerDeploymentRuntime";
import type { PaperResearchLineage } from "./paperResearchLineage";
import { FileQualifiedPaperChallengerArtifactStore } from "./qualifiedPaperChallengerArtifactStore";

const HASH = "a".repeat(64);
const SPECIFICATION_HASH = "b".repeat(64);
const advisory: LeagueCapitalAllocationAdvisory = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date(1_000).toISOString(),
  policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
  entries: Object.freeze([{ id: "challenger-a", familyId: "sma", rank: 1, leagueScore: 1, evidenceBreadth: 5, researchWeight: 1, reasons: Object.freeze(["qualified"]), sourceDatasetIds: Object.freeze(["dataset-a"]) }]),
  excludedCandidateIds: Object.freeze([]),
  reasons: Object.freeze(["research-only allocation"]),
  provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
});
const researchLineage: PaperResearchLineage = Object.freeze({ schemaVersion: 1, candidateId: "challenger-a", candidateVersion: "immutable-v9", originalRunFingerprintSha256: "b".repeat(64), replayRunFingerprintSha256: "c".repeat(64), researchDecisionReference: "research-decision:1", authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
const artifact: QualifiedPaperChallengerArtifact = Object.freeze({ schemaVersion: 1, candidateId: "challenger-a", candidateVersion: "immutable-v9", market: "KRW-BTC", advisory, candidateProvenance: Object.freeze([{ candidateId: "challenger-a", datasetId: "dataset-a", datasetContentSha256: HASH }]), candidateStrategy: Object.freeze({ candidateId: "challenger-a", familyId: "sma-crossover", lineageId: "sma-v1", specificationHash: SPECIFICATION_HASH, codeSha: "c".repeat(40), costModelVersion: "cost-v1", parameters: Object.freeze({ shortPeriod: 2, longPeriod: 3 }) }), researchDecisionReference: "research-decision:1", researchLineage, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });

function temporaryStore(): { store: FileQualifiedPaperChallengerArtifactStore; filename: string; cleanup: () => void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-paper-artifact-"));
  const filename = path.join(directory, "challengers.json");
  return { store: new FileQualifiedPaperChallengerArtifactStore(filename), filename, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

describe("FileQualifiedPaperChallengerArtifactStore", () => {
  it("persists and restores immutable Research lineage across store restart", () => {
    const fixture = temporaryStore();
    try {
      fixture.store.save(artifact);
      const restored = new FileQualifiedPaperChallengerArtifactStore(fixture.filename).read("challenger-a", "immutable-v9");
      assert.deepEqual(restored, artifact);
      assert.deepEqual(restored?.researchLineage, researchLineage);
    } finally { fixture.cleanup(); }
  });

  it("is idempotent for identical replay and rejects candidate/version mutation", () => {
    const fixture = temporaryStore();
    try {
      assert.deepEqual(fixture.store.save(artifact), fixture.store.save(artifact));
      assert.throws(() => fixture.store.save(Object.freeze({ ...artifact, researchDecisionReference: "research-decision:2" })), /Research lineage conflict|identity conflict/);
    } finally { fixture.cleanup(); }
  });

  it("rejects lineage that is not bound to the same candidate/version/decision", () => {
    const fixture = temporaryStore();
    try {
      assert.throws(() => fixture.store.save(Object.freeze({ ...artifact, researchLineage: Object.freeze({ ...researchLineage, candidateVersion: "other" }) })), /Research lineage conflict/);
      assert.throws(() => fixture.store.save(Object.freeze({ ...artifact, researchLineage: Object.freeze({ ...researchLineage, liveAuthority: "LIVE" as never }) })), /lineage authority/);
    } finally { fixture.cleanup(); }
  });

  it("keeps legacy lineage-free artifacts readable but not upgraded implicitly", () => {
    const fixture = temporaryStore();
    try {
      const legacy = Object.freeze({ ...artifact, researchLineage: undefined });
      fixture.store.save(legacy);
      const restored = new FileQualifiedPaperChallengerArtifactStore(fixture.filename).read("challenger-a", "immutable-v9");
      assert.equal(restored?.researchLineage, undefined);
    } finally { fixture.cleanup(); }
  });

  it("fails closed when persisted payload integrity is corrupted", () => {
    const fixture = temporaryStore();
    try {
      fixture.store.save(artifact);
      const raw = fs.readFileSync(fixture.filename, "utf8");
      fs.writeFileSync(fixture.filename, raw.replace("research-decision:1", "research-decision:x"), "utf8");
      assert.throws(() => fixture.store.read("challenger-a", "immutable-v9"), /checksum mismatch|Research lineage conflict/);
    } finally { fixture.cleanup(); }
  });
});
