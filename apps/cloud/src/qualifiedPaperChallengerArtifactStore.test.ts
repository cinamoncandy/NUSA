import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { QualifiedPaperChallengerArtifact } from "./paperChallengerDeploymentRuntime";
import { FileQualifiedPaperChallengerArtifactStore } from "./qualifiedPaperChallengerArtifactStore";

const HASH = "a".repeat(64);
const advisory: LeagueCapitalAllocationAdvisory = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date(1_000).toISOString(),
  policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
  entries: Object.freeze([{ id: "challenger-a", familyId: "sma", rank: 1, leagueScore: 1, evidenceBreadth: 5, researchWeight: 1, reasons: Object.freeze(["qualified"]), sourceDatasetIds: Object.freeze(["dataset-a"]) }]),
  excludedCandidateIds: Object.freeze([]),
  reasons: Object.freeze(["research-only allocation"]),
  provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
});
const artifact: QualifiedPaperChallengerArtifact = Object.freeze({ schemaVersion: 1, candidateId: "challenger-a", candidateVersion: "immutable-v9", market: "KRW-BTC", advisory, candidateProvenance: Object.freeze([{ candidateId: "challenger-a", datasetId: "dataset-a", datasetContentSha256: HASH }]), researchDecisionReference: "research-decision:1", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });

function temporaryStore(): { store: FileQualifiedPaperChallengerArtifactStore; filename: string; cleanup: () => void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-paper-artifact-"));
  const filename = path.join(directory, "challengers.json");
  return { store: new FileQualifiedPaperChallengerArtifactStore(filename), filename, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

describe("FileQualifiedPaperChallengerArtifactStore", () => {
  it("persists and restores an immutable qualified artifact across store restart", () => {
    const fixture = temporaryStore();
    try {
      fixture.store.save(artifact);
      const restored = new FileQualifiedPaperChallengerArtifactStore(fixture.filename).read("challenger-a", "immutable-v9");
      assert.deepEqual(restored, artifact);
    } finally { fixture.cleanup(); }
  });

  it("is idempotent for identical replay and rejects candidate/version mutation", () => {
    const fixture = temporaryStore();
    try {
      assert.deepEqual(fixture.store.save(artifact), fixture.store.save(artifact));
      assert.throws(() => fixture.store.save(Object.freeze({ ...artifact, researchDecisionReference: "research-decision:2" })), /identity conflict/);
    } finally { fixture.cleanup(); }
  });

  it("fails closed when persisted payload integrity is corrupted", () => {
    const fixture = temporaryStore();
    try {
      fixture.store.save(artifact);
      const raw = fs.readFileSync(fixture.filename, "utf8");
      fs.writeFileSync(fixture.filename, raw.replace("research-decision:1", "research-decision:x"), "utf8");
      assert.throws(() => fixture.store.read("challenger-a", "immutable-v9"), /checksum mismatch/);
    } finally { fixture.cleanup(); }
  });
});
