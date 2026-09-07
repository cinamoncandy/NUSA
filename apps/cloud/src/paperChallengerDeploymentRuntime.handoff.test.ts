import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PaperChallengerDeploymentRuntime, type PaperChallengerDeploymentRuntimeOptions, type QualifiedPaperChallengerArtifact } from "./paperChallengerDeploymentRuntime";
import type { PaperChallengerActivationReceipt } from "./paperChallengerBindingLedger";

const HASH = "a".repeat(64);
const OLD_HASH = "b".repeat(64);
const DATASET_HASH = "c".repeat(64);
const ORIGINAL = "d".repeat(64);
const REPLAY = "e".repeat(64);
const ACCOUNT_AT = 10_000;
const CANDIDATE = "challenger-next";
const VERSION = "f".repeat(64);
const DECISION_REFERENCE = "research:qualified-next";

function artifact(): QualifiedPaperChallengerArtifact {
  return Object.freeze({
    schemaVersion: 1,
    candidateId: CANDIDATE,
    candidateVersion: VERSION,
    market: "KRW-BTC",
    advisory: Object.freeze({
      schemaVersion: 1,
      generatedAt: new Date(1_000).toISOString(),
      policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
      entries: Object.freeze([{ id: CANDIDATE, familyId: "family", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: Object.freeze([]), sourceDatasetIds: Object.freeze(["dataset-next"]) }]),
      excludedCandidateIds: Object.freeze([]),
      reasons: Object.freeze([]),
      provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-next"]) }),
    }),
    candidateProvenance: Object.freeze([{ candidateId: CANDIDATE, datasetId: "dataset-next", datasetContentSha256: DATASET_HASH }]),
    candidateStrategy: Object.freeze({ candidateId: CANDIDATE, familyId: "sma-crossover", lineageId: "sma-v1", specificationHash: VERSION, codeSha: "f".repeat(40), costModelVersion: "cost-v1", parameters: Object.freeze({ shortPeriod: 2, longPeriod: 3 }) }),
    researchDecisionReference: DECISION_REFERENCE,
    researchLineage: Object.freeze({
      schemaVersion: 1,
      candidateId: CANDIDATE,
      candidateVersion: VERSION,
      originalRunFingerprintSha256: ORIGINAL,
      replayRunFingerprintSha256: REPLAY,
      researchDecisionReference: DECISION_REFERENCE,
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function oldActivation(): PaperChallengerActivationReceipt {
  return Object.freeze({
    schemaVersion: 1,
    status: "ACTIVE",
    market: "KRW-BTC",
    binding: Object.freeze({
      schemaVersion: 1,
      status: "BOUND_UNVERIFIED",
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      candidateId: "challenger-old",
      datasetId: "dataset-old",
      datasetContentSha256: HASH,
      advisoryGeneratedAt: 500,
      periodStartAt: 5_000,
      advisoryFingerprintSha256: HASH,
      bindingFingerprintSha256: OLD_HASH,
    }),
    activatedAt: 5_000,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function deploymentInput() {
  return Object.freeze({
    cycleId: `closed-learning:${"f".repeat(64)}`,
    decision: Object.freeze({ decisionId: "decision-next", outcome: "QUALIFIED_FOR_LEAGUE" as const, candidateId: CANDIDATE, candidateVersion: VERSION, decisionReference: DECISION_REFERENCE, reasons: Object.freeze([]) }),
    authority: "PAPER_RESEARCH_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
}

describe("PaperChallengerDeploymentRuntime qualified handoff", () => {
  it("revokes the prior PAPER challenger before activating and opening the qualified replacement", () => {
    const events: string[] = [];
    let active: PaperChallengerActivationReceipt | undefined = oldActivation();
    const next = artifact();
    const options = {
      artifacts: { read: () => next },
      bindings: {
        current: () => active,
        revoke: (_market: string, fingerprint: string, candidateId: string, revokedAt: number) => {
          assert.equal(fingerprint, OLD_HASH);
          assert.equal(candidateId, "challenger-old");
          assert.equal(revokedAt, ACCOUNT_AT);
          events.push("revoke");
          active = undefined;
          return {} as never;
        },
        activate: (market: string, binding: PaperChallengerActivationReceipt["binding"], researchLineage: NonNullable<PaperChallengerActivationReceipt["researchLineage"]>) => {
          events.push("activate");
          active = Object.freeze({ schemaVersion: 1, status: "ACTIVE", market, binding, activatedAt: binding.periodStartAt, researchLineage, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
          return active;
        },
      },
      periods: {
        listRealizedPeriods: () => Object.freeze([]),
        openPeriodFromCanonicalAccount: (input: unknown) => { events.push("open"); return input as never; },
      },
      readCanonicalPaperAccount: () => Object.freeze({ version: 1, initialCapital: 1_000_000, cash: 1_000_000, equity: 1_000_000, realizedPnL: 0, unrealizedPnL: 0, positions: Object.freeze([]), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]), updatedAt: ACCOUNT_AT }),
    } as unknown as PaperChallengerDeploymentRuntimeOptions;

    const runtime = new PaperChallengerDeploymentRuntime(options);
    const receipt = runtime.deploy(deploymentInput());
    assert.deepEqual(events, ["revoke", "activate", "open"]);
    assert.equal(receipt.candidateId, CANDIDATE);
    assert.equal(active?.binding.candidateId, CANDIDATE);
    assert.equal(active?.researchLineage?.candidateVersion, VERSION);
  });

  it("replays the same replacement without revoking or reactivating the already-matching binding", () => {
    const events: string[] = [];
    let active: PaperChallengerActivationReceipt | undefined = oldActivation();
    const next = artifact();
    const options = {
      artifacts: { read: () => next },
      bindings: {
        current: () => active,
        revoke: () => { events.push("revoke"); active = undefined; return {} as never; },
        activate: (market: string, binding: PaperChallengerActivationReceipt["binding"], researchLineage: NonNullable<PaperChallengerActivationReceipt["researchLineage"]>) => {
          events.push("activate");
          active = Object.freeze({ schemaVersion: 1, status: "ACTIVE", market, binding, activatedAt: binding.periodStartAt, researchLineage, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
          return active;
        },
      },
      periods: {
        listRealizedPeriods: () => Object.freeze([]),
        openPeriodFromCanonicalAccount: (input: unknown) => { events.push("open"); return input as never; },
      },
      readCanonicalPaperAccount: () => Object.freeze({ version: 1, initialCapital: 1_000_000, cash: 1_000_000, equity: 1_000_000, realizedPnL: 0, unrealizedPnL: 0, positions: Object.freeze([]), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]), updatedAt: ACCOUNT_AT }),
    } as unknown as PaperChallengerDeploymentRuntimeOptions;

    const runtime = new PaperChallengerDeploymentRuntime(options);
    runtime.deploy(deploymentInput());
    events.length = 0;
    runtime.deploy(deploymentInput());
    assert.deepEqual(events, ["open"]);
  });
});
