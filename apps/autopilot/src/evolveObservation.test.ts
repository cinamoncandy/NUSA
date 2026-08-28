import assert from "node:assert/strict";
import test from "node:test";
import { createEvolutionObservation } from "./evolveObservation";

test("classifies healthy and degraded observations", () => {
  assert.equal(createEvolutionObservation({ revision: "abc", health: true }).status, "HEALTHY");
  assert.equal(createEvolutionObservation({ revision: "abc", health: true, errors: 1 }).status, "DEGRADED");
  assert.equal(createEvolutionObservation({ revision: "abc", health: false }).status, "FAILED");
});

test("rejects invalid observation metrics", () => {
  assert.throws(() => createEvolutionObservation({ revision: "", health: true }), /EVOLVE_OBSERVATION_REVISION_INVALID/);
  assert.throws(() => createEvolutionObservation({ revision: "abc", health: true, errors: -1 }), /EVOLVE_OBSERVATION_ERRORS_INVALID/);
});
