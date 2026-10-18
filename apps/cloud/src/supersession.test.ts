import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SupersessionRegistry, assertSupersessionLink, buildSupersessionLink, SUPERSESSION_SCHEMA_VERSION, type SupersessionLinkInput } from "./supersession";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function link(overrides: Partial<SupersessionLinkInput> = {}): SupersessionLinkInput {
  return {
    surface: "longBarTickEvery",
    previousDecisionFingerprint: A,
    nextDecisionFingerprint: B,
    reason: "cycle-2 revised the cadence after cycle-1 proved too frequent",
    timestamp: "2026-10-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("A5 - history is appended, never rewritten (section 23)", () => {
  it("records a successor without altering the predecessor", () => {
    const registry = new SupersessionRegistry();
    const first = registry.supersede(link());
    assert.equal(first.schemaVersion, SUPERSESSION_SCHEMA_VERSION);
    assert.equal(registry.size(), 1);
    assert.equal(registry.successorOf(A, "longBarTickEvery")?.nextDecisionFingerprint, B);
    // The predecessor's own identity is untouched: links reference decisions, they do not own them.
    assert.equal(first.previousDecisionFingerprint, A);
    assert.equal(first.nextDecisionFingerprint, B);
  });

  it("replaying the same link is idempotent, not a second relationship", () => {
    const registry = new SupersessionRegistry();
    const first = registry.supersede(link());
    const second = registry.supersede(link());
    assert.equal(second.linkFingerprint, first.linkFingerprint, "identical content yields the identical link");
    assert.equal(registry.size(), 1, "no duplicate relationship");
  });

  it("carries every required field", () => {
    const registry = new SupersessionRegistry();
    const built = registry.supersede(link());
    assert.equal(built.surface, "longBarTickEvery");
    assert.equal(built.previousDecisionFingerprint, A);
    assert.equal(built.nextDecisionFingerprint, B);
    assert.ok(built.reason.length > 0, "a supersession states why");
    assert.ok(built.timestamp.length > 0);
    assert.ok(built.linkFingerprint.length === 64);
  });

  it("refuses a decision that would supersede itself", () => {
    const registry = new SupersessionRegistry();
    assert.throws(() => registry.supersede(link({ nextDecisionFingerprint: A })), /cannot supersede itself/);
    assert.equal(registry.size(), 0);
  });

  it("refuses a malformed predecessor identity", () => {
    const registry = new SupersessionRegistry();
    assert.throws(() => registry.supersede(link({ previousDecisionFingerprint: "short" })), /SHA-256 digest/);
    assert.equal(registry.size(), 0);
  });
});

describe("A5 - supersession fork detection (section 24)", () => {
  it("refuses a second successor on the same predecessor and surface", () => {
    const registry = new SupersessionRegistry();
    registry.supersede(link());
    // Two different successors: the history no longer says which change took effect.
    assert.throws(() => registry.supersede(link({ nextDecisionFingerprint: C })), /already has successor/);
    assert.equal(registry.size(), 1, "the fork never becomes a second record");
    assert.equal(registry.successorCount(A, "longBarTickEvery"), 1);
    assert.equal(registry.successorOf(A, "longBarTickEvery")?.nextDecisionFingerprint, B, "the first successor is preserved, not replaced");
  });

  it("does not prefer the later timestamp when a fork would otherwise resolve", () => {
    const registry = new SupersessionRegistry();
    registry.supersede(link({ timestamp: "2026-10-18T00:00:00.000Z" }));
    assert.throws(
      () => registry.supersede(link({ nextDecisionFingerprint: C, timestamp: "2099-01-01T00:00:00.000Z" })),
      /conflict, not a newer timestamp to prefer/,
    );
    assert.equal(registry.successorOf(A, "longBarTickEvery")?.timestamp, "2026-10-18T00:00:00.000Z", "the newer timestamp did not win");
  });

  it("allows one successor per surface, because surfaces are tracked separately", () => {
    const registry = new SupersessionRegistry();
    registry.supersede(link());
    // A different surface with the same predecessor is a separate lineage, not a fork.
    registry.supersede(link({ surface: "researchCadence" }));
    assert.equal(registry.size(), 2);
    assert.equal(registry.successorCount(A, "longBarTickEvery"), 1);
    assert.equal(registry.successorCount(A, "researchCadence"), 1);
    assert.equal(registry.successorOf(A, "researchCadence")?.nextDecisionFingerprint, B);
  });

  it("distinguishes successors of different predecessors", () => {
    const registry = new SupersessionRegistry();
    registry.supersede(link());
    registry.supersede(link({ previousDecisionFingerprint: C }));
    assert.equal(registry.size(), 2, "two predecessors, two independent lineages");
  });

  it("reports a fork as a conflict on rehydration too, rather than keeping both", () => {
    const registry = new SupersessionRegistry();
    const good = registry.supersede(link());
    // A second, *validly formed* link in the same slot - the hard case, since identity checks pass.
    const other = buildSupersessionLink(link({ nextDecisionFingerprint: C }));
    assert.throws(() => registry.rehydrate([good, other]), /already has successor/);
    assert.equal(registry.successorCount(A, "longBarTickEvery"), 1, "history still has exactly one successor");
    assert.equal(registry.successorOf(A, "longBarTickEvery")?.nextDecisionFingerprint, B, "the original successor is preserved");
  });
});

describe("A5 - the chain reads forward without cycles", () => {
  it("walks a lineage from first decision to last", () => {
    const registry = new SupersessionRegistry();
    registry.supersede(link());
    registry.supersede(link({ previousDecisionFingerprint: B, nextDecisionFingerprint: C }));
    assert.deepEqual([...registry.lineage(A, "longBarTickEvery")], [B, C]);
    assert.deepEqual([...registry.lineage(C, "longBarTickEvery")], [], "the latest decision has no successor yet");
  });

  it("fails closed if a lineage were ever to cycle", () => {
    const registry = new SupersessionRegistry();
    registry.supersede(link());
    // Inject a back-edge directly: this can only happen if history was rewritten out of band.
    (registry as unknown as { links: Array<Record<string, unknown>> }).links.push({
      schemaVersion: SUPERSESSION_SCHEMA_VERSION,
      surface: "longBarTickEvery",
      previousDecisionFingerprint: B,
      nextDecisionFingerprint: A,
      reason: "cycle",
      timestamp: "2026-10-18T00:00:00.000Z",
      linkFingerprint: "f".repeat(64),
      supersessionPolicyVersion: "supersession-v1",
    });
    assert.throws(() => registry.lineage(A, "longBarTickEvery"), /cycles back/);
  });
});

describe("A5 - links are self-verifying", () => {
  it("an edited link no longer matches its own identity", () => {
    const registry = new SupersessionRegistry();
    const link0 = registry.supersede(link());
    assert.doesNotThrow(() => assertSupersessionLink(link0));

    const tampered = JSON.parse(JSON.stringify(link0)) as Record<string, unknown>;
    tampered.nextDecisionFingerprint = C;
    assert.throws(() => assertSupersessionLink(tampered), /does not match its own fingerprint/);
  });

  it("rejects a link with an unsupported schema or policy version", () => {
    const registry = new SupersessionRegistry();
    const link0 = registry.supersede(link());
    assert.throws(() => assertSupersessionLink({ ...link0, schemaVersion: 99 }), /schema version is unsupported/);
    assert.throws(() => assertSupersessionLink({ ...link0, supersessionPolicyVersion: "supersession-v9" }), /policy version is unsupported/);
  });

  it("rejects an untrusted injected link on rehydration", () => {
    const registry = new SupersessionRegistry();
    assert.throws(() => registry.rehydrate([{ schemaVersion: SUPERSESSION_SCHEMA_VERSION, surface: "longBarTickEvery", previousDecisionFingerprint: A, nextDecisionFingerprint: B, reason: "x", timestamp: "t", linkFingerprint: "0".repeat(64), supersessionPolicyVersion: "supersession-v1" }]), /does not match its own fingerprint/);
    assert.equal(registry.size(), 0, "the forged link never enters history");
  });
});
