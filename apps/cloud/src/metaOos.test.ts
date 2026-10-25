import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import { SqliteResearchHoldoutLedger, type HoldoutKey } from "../../../packages/storage/src/researchHoldoutLedger";
import {
  META_MINIMUM_CYCLES_FOR_ELIGIBILITY,
  assertMetaOosAssignment,
  assignMetaPartition,
  metaOosCyclesEligibility,
  type MetaOosAssignment,
  type MetaOosAssignmentInput,
} from "./metaOos";
import { MetaOosLedger } from "./metaOosLedger";
import { buildLearningDecision, learningDecisionFingerprint } from "./learningDecision";
import { buildLearningInputSet } from "./learningInputSet";
import { applyBoundedChange, ApplicationRegistry, type ApplicationContext, type ApplicationPorts } from "./learningApplication";
import { LearningApplicationLedger } from "./learningApplicationLedger";

const POLICIES = {
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
};
const SPEC_A = "a".repeat(64);
const HOLDOUT: HoldoutKey = Object.freeze({ strategyConfigHash: "a".repeat(64), market: "KRW-BTC", intervalMs: 60_000, holdoutStartMs: 1_000, holdoutEndMs: 2_000 });
const ASSIGNMENT_PROBLEM = "NUSA meta-OOS partition assignment: which cross-cycle partition judged this learning cycle";

function cycleId(seed: string): string {
  return "learning-cycle:" + seed.repeat(64).slice(0, 64);
}

function assignment(overrides: Partial<MetaOosAssignmentInput> = {}): MetaOosAssignmentInput {
  return {
    learningCycleId: cycleId("a"),
    learningDecisionFingerprint: "c".repeat(64),
    partition: "meta-train",
    policyVersion: "learn-v1",
    cutoff: 900,
    assignedAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  };
}

function signedAssignment(content: Record<string, unknown>): Record<string, unknown> {
  const fingerprint = createHash("sha256").update(canonicalResearchJson(content), "utf8").digest("hex");
  return { ...content, assignmentFingerprint: fingerprint };
}

function validDurableAssignment(overrides: Record<string, unknown> = {}): MetaOosAssignment {
  return signedAssignment({
    schemaVersion: 1,
    learningCycleId: cycleId("a"),
    learningDecisionFingerprint: "c".repeat(64),
    partition: "meta-train",
    policyVersion: "learn-v1",
    cutoff: 900,
    assignedAt: "2026-10-18T00:00:00.000Z",
    metaOosPolicyVersion: "meta-oos-v1",
    ...overrides,
  }) as unknown as MetaOosAssignment;
}

function durableRecord(value: MetaOosAssignment, overrides: Record<string, unknown> = {}) {
  const evidenceReferences = [
    `meta-oos:${value.assignmentFingerprint}`,
    value.learningCycleId,
    value.learningDecisionFingerprint,
    ...(value.holdoutClaimIdentity == null ? [] : [`holdout:${value.holdoutClaimIdentity}`]),
  ].sort((left, right) => left.localeCompare(right));
  return {
    opportunityId: `meta-oos:${value.assignmentFingerprint}`,
    problem: ASSIGNMENT_PROBLEM,
    evidenceReferences,
    hypothesis: canonicalResearchJson(value),
    changeReference: value.policyVersion,
    validationStatus: "META_OOS_ASSIGNMENT",
    outcome: "SUCCESS",
    failureReason: null,
    rollbackReference: null,
    reusable: true,
    recordedAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  } as never;
}

function eligibilityIdentity() {
  return { learningCycleId: cycleId("d"), learningDecisionFingerprint: "d".repeat(64) };
}

function decision() {
  return buildLearningDecision({
    inputSet: buildLearningInputSet({
      cutoffTimestamp: 900,
      researchEvidence: [{ recordId: "trial-a", recordedAt: 100 }],
      paperEvidence: [{ recordId: "p1", recordedAt: 200 }],
      policies: POLICIES,
    }),
    previousResearchSpecFingerprint: SPEC_A,
    objectiveVersion: "objective-v1",
    proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }],
    reasonEvidence: ["trial-a"],
    createdAt: "2026-10-18T00:00:00.000Z",
    sourceCommit: "273d785df7b14c3a8e541ae45ea71fe3aacb49b4",
    runtimeIdentity: "runtime-test",
  });
}

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const holdouts = new SqliteResearchHoldoutLedger(db);
  const ledger = new MetaOosLedger(new SqliteEvolutionLearningLedger(db), () => Date.parse("2026-10-18T00:00:00.000Z"));
  return { db, holdouts, ledger, close: () => db.close() };
}

describe("A3 fails closed until the cycle-order partition owner defines policy", () => {
  it("rejects every caller-selected partition before a holdout claim or durable write", () => {
    const { ledger, holdouts, close } = fixture();
    try {
      let claims = 0;
      const claimPort = {
        claim: () => { claims += 1; return "CLAIMED" as const; },
        isUsed: () => false,
      };
      for (const partition of ["meta-train", "meta-validation", "meta-holdout"] as const) {
        assert.throws(
          () => ledger.assign(assignment({ partition, holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" }), claimPort),
          (error: unknown) => error instanceof Error && "code" in error && error.code === "META_PARTITION_POLICY_UNDEFINED",
        );
      }
      assert.equal(claims, 0);
      assert.equal(holdouts.isUsed(HOLDOUT), false);
      assert.equal(ledger.summary().assignmentsRecorded, 0);
    } finally {
      close();
    }
  });

  it("remains closed after restart and never lets caller-supplied cycles establish eligibility", () => {
    const filename = join(mkdtempSync(join(tmpdir(), "nusa-meta-policy-closed-")), "learning.db");
    let db = new SqliteDatabase(filename);
    try {
      const first = new MetaOosLedger(new SqliteEvolutionLearningLedger(db));
      assert.throws(() => first.assign(assignment(), { claim: () => "CLAIMED", isUsed: () => false }), { code: "META_PARTITION_POLICY_UNDEFINED" });
      assert.equal(first.summary().assignmentsRecorded, 0);
      db.close();

      db = new SqliteDatabase(filename);
      const restarted = new MetaOosLedger(new SqliteEvolutionLearningLedger(db));
      const eligible = restarted.eligibility("meta-holdout", eligibilityIdentity());
      assert.equal(eligible.eligible, false);
      assert.equal(eligible.cyclesEvaluated, 0);
      assert.match(eligible.reason, /partition policy is undefined/);
      assert.deepEqual(restarted.assignments(), []);
    } finally {
      db.close();
      rmSync(dirname(filename), { recursive: true, force: true });
    }
  });

  it("does not grant eligibility even when a caller supplies enough fabricated assignment objects", () => {
    const fabricated = Array.from({ length: META_MINIMUM_CYCLES_FOR_ELIGIBILITY }, (_, index) => validDurableAssignment({
      learningCycleId: cycleId(String(index)),
      partition: "meta-holdout",
      holdoutClaimIdentity: String(index + 1).repeat(64),
    }));
    const result = metaOosCyclesEligibility(fabricated, "meta-holdout", fabricated.length, eligibilityIdentity());
    assert.equal(result.eligible, false);
    assert.equal(result.cyclesEvaluated, 0);
    assert.match(result.reason, /policy is undefined/);
  });

  it("keeps bounded A4 application rejected without owner-authorized durable assignments", () => {
    const { ledger, close } = fixture();
    const context: ApplicationContext = {
      applicationTimestamp: "2026-10-18T00:00:00.000Z",
      runtimeIdentity: "runtime-test",
      sourceCommit: "273d785df7b14c3a8e541ae45ea71fe3aacb49b4",
    };
    try {
      const state = { value: 1 };
      const ports: ApplicationPorts = {
        readCurrent: () => state.value,
        readCurrentResearchSpec: () => ({ fingerprint: SPEC_A, values: { longBarTickEvery: state.value } }),
        commit: (_surface, value) => { state.value = value; },
        failSafeValue: () => 1,
        withExclusiveApplicationLease: (_identity, operation) => Object.freeze({ acquired: true, value: operation() }),
        resolveMetaOosEligibility: (target) => ledger.eligibility("meta-holdout", {
          learningCycleId: target.learningCycleId,
          learningDecisionFingerprint: learningDecisionFingerprint(target),
        }),
      };
      const records: Array<Record<string, unknown>> = [];
      const appendWithResult = (record: Record<string, unknown>) => {
        const existing = records.find((item) => item.opportunityId === record.opportunityId);
        if (existing != null) return Object.freeze({ record: existing, inserted: false });
        records.push(record);
        return Object.freeze({ record, inserted: true });
      };
      const journal = new LearningApplicationLedger({
        append: (record: Record<string, unknown>) => appendWithResult(record).record,
        appendWithResult,
        list: () => records as never,
      } as never, () => Date.parse(context.applicationTimestamp));
      const receipt = applyBoundedChange(decision(), ports, context, journal, new ApplicationRegistry());
      assert.equal(receipt.applicationOutcome, "REJECTED");
      assert.match(receipt.rejectionReason ?? "", /meta-OOS eligibility not established/);
      assert.equal(state.value, 1);
    } finally {
      close();
    }
  });
});

describe("A3 durable assignment schema validation", () => {
  it("accepts only the complete canonical assignment field set", () => {
    const valid = validDurableAssignment();
    assert.doesNotThrow(() => assertMetaOosAssignment(valid));

    const missingDecisionFingerprint = { ...validDurableAssignment() } as Record<string, unknown>;
    delete missingDecisionFingerprint.learningDecisionFingerprint;
    assert.throws(() => assertMetaOosAssignment(signedAssignment(missingDecisionFingerprint)), /decision fingerprint is invalid|closed schema/);

    const malformedCutoff = signedAssignment({ ...validDurableAssignment(), assignmentFingerprint: undefined, cutoff: "900" });
    assert.throws(() => assertMetaOosAssignment(malformedCutoff), /cutoff must be a non-negative integer/);

    const extraField = signedAssignment({ ...validDurableAssignment(), assignmentFingerprint: undefined, callerSelected: true });
    assert.throws(() => assertMetaOosAssignment(extraField), /closed schema/);
  });

  it("requires a valid holdout claim identity and rejects claim fields on other partitions", () => {
    const missingClaim = signedAssignment({
      schemaVersion: 1,
      learningCycleId: cycleId("a"),
      learningDecisionFingerprint: "c".repeat(64),
      partition: "meta-holdout",
      policyVersion: "learn-v1",
      cutoff: 900,
      assignedAt: "2026-10-18T00:00:00.000Z",
      metaOosPolicyVersion: "meta-oos-v1",
    });
    assert.throws(() => assertMetaOosAssignment(missingClaim), /closed schema/);

    const invalidClaim = validDurableAssignment({ partition: "meta-holdout", holdoutClaimIdentity: "not-a-digest" });
    assert.throws(() => assertMetaOosAssignment(invalidClaim), /valid durable holdout claim identity/);

    const strayClaim = validDurableAssignment({ holdoutClaimIdentity: "e".repeat(64) });
    assert.throws(() => assertMetaOosAssignment(strayClaim), /closed schema/);
  });

  it("rejects a self-consistent but malformed durable record before eligibility counts it", () => {
    const malformed = signedAssignment({
      schemaVersion: 1,
      learningCycleId: cycleId("a"),
      learningDecisionFingerprint: undefined,
      partition: "meta-holdout",
      policyVersion: "learn-v1",
      cutoff: 900,
      assignedAt: "2026-10-18T00:00:00.000Z",
      holdoutClaimIdentity: "e".repeat(64),
      metaOosPolicyVersion: "meta-oos-v1",
    });
    const record = durableRecord(malformed as unknown as MetaOosAssignment);
    const ledger = new MetaOosLedger({ list: () => [record], appendWithValidation: () => { throw new Error("must not append"); } } as never);
    assert.throws(() => ledger.eligibility("meta-holdout", eligibilityIdentity()), { code: "MALFORMED_RECEIPT" });
  });

  it("rejects a malformed Evolution envelope even when its assignment payload is valid", () => {
    const record = durableRecord(validDurableAssignment(), { outcome: "FAILED" });
    const ledger = new MetaOosLedger({ list: () => [record], appendWithValidation: () => { throw new Error("must not append"); } } as never);
    assert.throws(() => ledger.assignments(), { code: "MALFORMED_RECEIPT" });
  });

  it("validates malformed assignment inputs before reporting the missing policy", () => {
    const { holdouts, close } = fixture();
    try {
      assert.throws(() => assignMetaPartition(assignment({ learningCycleId: "learning-cycle:short" }), holdouts), /cycle id is invalid/);
      assert.throws(() => assignMetaPartition(assignment({ partition: "meta-tune" as never }), holdouts), /outside the closed set/);
    } finally {
      close();
    }
  });
});
