import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPLORATION_ALLOTMENT_PER_CYCLE,
  FAMILY_REPETITION_CEILING,
  GATES_STILL_REQUIRED,
  ExplorationRegistry,
  type ExplorationAttempt,
  type ExperimentShape,
} from "./exploration";

const CONFIG = (seed: string) => seed.repeat(64).slice(0, 64);

function shape(overrides: Partial<ExperimentShape> = {}): ExperimentShape {
  return {
    experimentIdentity: "exp-" + CONFIG("1"),
    family: "RULE/CLOSE/FIVE",
    configurationIdentity: CONFIG("1"),
    ...overrides,
  };
}

describe("A6 - exact duplicate suppression", () => {
  it("does not allot the same experiment identity twice", () => {
    const registry = new ExplorationRegistry();
    const first = registry.propose(shape());
    assert.equal(first.verdict, "ALLOTTED");

    const second = registry.propose(shape());
    assert.equal(second.verdict, "SUPPRESSED_EXACT_DUPLICATE");
    assert.equal(registry.status().allotted, 1, "the duplicate never consumed a second allotment");
    assert.equal(registry.status().attempts, 2, "but it is still recorded, not dropped");
  });

  it("keeps the suppression in the record rather than silently ignoring it", () => {
    const registry = new ExplorationRegistry();
    registry.propose(shape());
    registry.propose(shape());
    const recorded = registry.recordedAttempts();
    assert.equal(recorded.length, 2);
    assert.equal(recorded[1].verdict, "SUPPRESSED_EXACT_DUPLICATE");
    assert.match(recorded[1].reason, /already been attempted/);
  });
});

describe("A6 - near-duplicate accounting", () => {
  it("counts a different identity on the same family and configuration", () => {
    const registry = new ExplorationRegistry();
    registry.propose(shape({ experimentIdentity: "exp-a" }));
    const near = registry.propose(shape({ experimentIdentity: "exp-b" }));
    assert.equal(near.verdict, "ALLOTTED", "a renamed proposal is still distinguishable, but the similarity is counted");
    assert.equal(near.nearDuplicateCount, 1, "one near-duplicate of this shape already exists");
  });

  it("does not count unrelated shapes as near-duplicates", () => {
    const registry = new ExplorationRegistry();
    registry.propose(shape({ experimentIdentity: "exp-a", configurationIdentity: CONFIG("2") }));
    const other = registry.propose(shape({ experimentIdentity: "exp-b", family: "ML/OHLCV/ALL_KRW", configurationIdentity: CONFIG("3") }));
    assert.equal(other.nearDuplicateCount, 0);
  });
});

describe("A6 - family repetition count", () => {
  it("counts attempts per family and reports the number on each attempt", () => {
    const registry = new ExplorationRegistry();
    for (let index = 0; index < FAMILY_REPETITION_CEILING; index += 1) {
      const attempt = registry.propose(shape({ experimentIdentity: "exp-" + String(index), configurationIdentity: CONFIG(String(index + 1)) }));
      assert.equal(attempt.verdict, "ALLOTTED");
      assert.equal(attempt.familyRepetitionCount, index + 1);
    }
    assert.equal(registry.familyRepetitionCount("RULE/CLOSE/FIVE"), FAMILY_REPETITION_CEILING);
  });

  it("stops a family at its ceiling so the same idea is not re-run forever", () => {
    const registry = new ExplorationRegistry();
    for (let index = 0; index < FAMILY_REPETITION_CEILING; index += 1) {
      registry.propose(shape({ experimentIdentity: "exp-" + String(index), configurationIdentity: CONFIG(String(index + 1)) }));
    }
    const blocked = registry.propose(shape({ experimentIdentity: "exp-late", configurationIdentity: CONFIG("9") }));
    assert.equal(blocked.verdict, "SUPPRESSED_FAMILY_CEILING");
    assert.match(blocked.reason, /the loop this control exists to break/);
    assert.equal(blocked.familyRepetitionCount, FAMILY_REPETITION_CEILING, "the count shown is the one at the ceiling");
  });

  it("tracks families independently", () => {
    const registry = new ExplorationRegistry();
    registry.propose(shape({ experimentIdentity: "a", configurationIdentity: CONFIG("1") }));
    registry.propose(shape({ experimentIdentity: "b", configurationIdentity: CONFIG("2") }));
    assert.equal(registry.familyRepetitionCount("RULE/CLOSE/FIVE"), 2);
    assert.equal(registry.familyRepetitionCount("ML/OHLCV/ALL_KRW"), 0);
  });
});

describe("A6 - allotment is bounded and exhaustion is durable (section 26)", () => {
  it("reaches EXHAUSTED once the owner allotment is used up", () => {
    const registry = new ExplorationRegistry();
    for (let index = 0; index < EXPLORATION_ALLOTMENT_PER_CYCLE; index += 1) {
      assert.equal(registry.propose(shape({ experimentIdentity: "exp-" + String(index), family: "F" + String(index), configurationIdentity: CONFIG(String(index + 1)) })).verdict, "ALLOTTED");
    }
    assert.equal(registry.allotmentRemaining(), 0);

    const blocked = registry.propose(shape({ experimentIdentity: "exp-late", family: "F-late", configurationIdentity: CONFIG("9") }));
    assert.equal(blocked.verdict, "EXHAUSTED");
    assert.equal(blocked.allotmentRemaining, 0);
    assert.match(blocked.reason, /not raised automatically/);
    assert.equal(registry.status().exhausted, true);
  });

  it("never raises the budget to admit a request it just refused", () => {
    const registry = new ExplorationRegistry();
    for (let index = 0; index < EXPLORATION_ALLOTMENT_PER_CYCLE; index += 1) {
      registry.propose(shape({ experimentIdentity: "exp-" + String(index), family: "F" + String(index), configurationIdentity: CONFIG(String(index + 1)) }));
    }
    // Repeatedly wanting in does not create room.
    for (let index = 0; index < 10; index += 1) {
      registry.propose(shape({ experimentIdentity: "refused-" + String(index), family: "F-late" + String(index), configurationIdentity: CONFIG(((index + 7) % 16).toString(16)) }));
    }
    assert.equal(registry.allotmentRemaining(), 0, "the allotment is still zero");
    assert.equal(EXPLORATION_ALLOTMENT_PER_CYCLE, 4, "the owner allotment is unchanged by any of it");
    assert.equal(registry.status().allotted, EXPLORATION_ALLOTMENT_PER_CYCLE, "exactly the owner allotment was ever granted");
  });

  it("does not let suppressions drain the budget", () => {
    const registry = new ExplorationRegistry();
    const unique = registry.propose(shape({ experimentIdentity: "exp-0", family: "F0", configurationIdentity: CONFIG("1") }));
    assert.equal(unique.verdict, "ALLOTTED");

    // Duplicates cost nothing, so hammering one identity cannot consume or manufacture allotment.
    for (let index = 0; index < 8; index += 1) registry.propose(shape({ experimentIdentity: "exp-0", family: "F0", configurationIdentity: CONFIG("1") }));

    assert.equal(registry.allotmentRemaining(), EXPLORATION_ALLOTMENT_PER_CYCLE - 1, "suppressions consumed no allotment");
    assert.equal(registry.status().suppressed, 8);
    assert.equal(registry.status().allotted, 1);
  });

  it("survives a restart without handing back spent allotment", () => {
    const registry = new ExplorationRegistry();
    for (let index = 0; index < EXPLORATION_ALLOTMENT_PER_CYCLE; index += 1) {
      registry.propose(shape({ experimentIdentity: "exp-" + String(index), family: "F" + String(index), configurationIdentity: CONFIG(String(index + 1)) }));
    }
    const history = registry.recordedAttempts();

    const afterRestart = new ExplorationRegistry();
    afterRestart.rehydrate(history);
    assert.equal(afterRestart.allotmentRemaining(), 0, "the spent allotment is re-derived from history, not reset");
    assert.equal(afterRestart.propose(shape({ experimentIdentity: "fresh", family: "F-fresh", configurationIdentity: CONFIG("a") })).verdict, "EXHAUSTED");
  });

  it("rejects an attempt record carrying an unknown verdict on rehydration", () => {
    const registry = new ExplorationRegistry();
    assert.throws(() => registry.rehydrate([{ verdict: "QUALIFIED" } as unknown as ExplorationAttempt]), /outside the closed set/);
    assert.equal(registry.recordedAttempts().length, 0, "the forged record never enters history");
  });
});

describe("A6 - exploration is not a gate bypass (section 27)", () => {
  it("always states the full gate list, for every verdict", () => {
    const registry = new ExplorationRegistry();
    const verdicts = [
      registry.propose(shape({ experimentIdentity: "e0", family: "F0", configurationIdentity: CONFIG("1") })).verdict,
      registry.propose(shape({ experimentIdentity: "e0", family: "F0", configurationIdentity: CONFIG("1") })).verdict,
      registry.propose(shape({ experimentIdentity: "e1", family: "F0", configurationIdentity: CONFIG("1") })).verdict,
    ];
    for (const verdict of verdicts) {
      const attempt = registry.recordedAttempts().find((candidate) => candidate.verdict === verdict);
      assert.ok(attempt, "the verdict was recorded");
      assert.deepEqual([...attempt.gatesStillRequired], [...GATES_STILL_REQUIRED], "no verdict narrows the gates");
      assert.equal(attempt.gatesStillRequired.length, 7, "PIT, OOS, walk-forward, cost, sample, qualification, governance");
    }
  });

  it("offers no verdict that could be read as a pass", () => {
    const registry = new ExplorationRegistry();
    const permitted = ["ALLOTTED", "SUPPRESSED_EXACT_DUPLICATE", "SUPPRESSED_FAMILY_CEILING", "EXHAUSTED"];
    const produced = new Set<string>();
    for (let index = 0; index < EXPLORATION_ALLOTMENT_PER_CYCLE + 2; index += 1) {
      produced.add(registry.propose(shape({ experimentIdentity: "exp-" + String(index), family: "F" + String(index), configurationIdentity: CONFIG(String(index + 1)) })).verdict);
    }
    for (const verdict of produced) assert.ok(permitted.includes(verdict), "unexpected verdict " + verdict);
    assert.ok(!produced.has("QUALIFIED"), "exploration never reports qualification");
    assert.ok(!produced.has("APPLIED"), "exploration never reports application");
    // ALLOTTED is only permission to be evaluated, and the field says so.
    const allotted = registry.recordedAttempts().find((attempt) => attempt.verdict === "ALLOTTED");
    assert.ok(allotted?.reason.includes("still faces every gate"));
  });

  it("produces a malformed shape rejection rather than guessing", () => {
    const registry = new ExplorationRegistry();
    assert.throws(() => registry.propose({ experimentIdentity: "exp", family: "F", configurationIdentity: "not-a-hash" }), /SHA-256 digest/);
    assert.equal(registry.recordedAttempts().length, 0);
  });
});
