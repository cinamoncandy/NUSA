import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPaperOrderLifecycle, transitionPaperOrderLifecycle, validatePaperOrderLifecycle } from "./paperOrderLifecycle";

describe("canonical PAPER order lifecycle", () => {
  it("supports accepted open partial fill complete fill deterministically", () => {
    let state = createPaperOrderLifecycle(10, 100);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 101);
    state = transitionPaperOrderLifecycle(state, "OPEN", 102);
    state = transitionPaperOrderLifecycle(state, "PARTIALLY_FILLED", 103, 4);
    assert.deepEqual(Object.assign({}, state, { status: "PARTIALLY_FILLED", filledQuantity: 4, remainingQuantity: 6, transitionSequence: 3 }), state);
    state = transitionPaperOrderLifecycle(state, "FILLED", 104, 6);
    assert.deepEqual(Object.assign({}, validatePaperOrderLifecycle(state), { status: "FILLED", filledQuantity: 10, remainingQuantity: 0, transitionSequence: 4 }), validatePaperOrderLifecycle(state));
  });

  it("supports cancellation after partial fill without inventing another fill", () => {
    let state = createPaperOrderLifecycle(5, 100);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 101);
    state = transitionPaperOrderLifecycle(state, "OPEN", 102);
    state = transitionPaperOrderLifecycle(state, "PARTIALLY_FILLED", 103, 2);
    state = transitionPaperOrderLifecycle(state, "CANCELLED", 104);
    assert.deepEqual(Object.assign({}, state, { status: "CANCELLED", filledQuantity: 2, remainingQuantity: 3 }), state);
  });

  it("supports rejection before execution", () => {
    const rejected = transitionPaperOrderLifecycle(createPaperOrderLifecycle(1, 100), "REJECTED", 101);
    assert.deepEqual(Object.assign({}, rejected, { status: "REJECTED", filledQuantity: 0, remainingQuantity: 1 }), rejected);
  });

  it.each([
    ["FILLED", "OPEN"],
    ["CANCELLED", "FILLED"],
    ["REJECTED", "ACCEPTED"],
  ] as const)("fails closed for terminal transition %s -> %s", (terminal, next) => {
    let state = createPaperOrderLifecycle(1, 100);
    if (terminal === "FILLED") {
      state = transitionPaperOrderLifecycle(state, "ACCEPTED", 101);
      state = transitionPaperOrderLifecycle(state, "FILLED", 102, 1);
    } else if (terminal === "CANCELLED") {
      state = transitionPaperOrderLifecycle(state, "ACCEPTED", 101);
      state = transitionPaperOrderLifecycle(state, "CANCELLED", 102);
    } else {
      state = transitionPaperOrderLifecycle(state, "REJECTED", 101);
    }
    assert.throws(() => transitionPaperOrderLifecycle(state, next, 103, next === "FILLED" ? 1 : 0), /terminal state cannot transition/);
  });

  it("rejects overfill and incomplete FILLED transitions", () => {
    let state = createPaperOrderLifecycle(10, 100);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 101);
    state = transitionPaperOrderLifecycle(state, "OPEN", 102);
    assert.throws(() => transitionPaperOrderLifecycle(state, "PARTIALLY_FILLED", 103, 11), /exceeds remaining/);
    assert.throws(() => transitionPaperOrderLifecycle(state, "FILLED", 103, 9), /consume remaining/);
  });

  it("rejects clock regression", () => {
    const state = transitionPaperOrderLifecycle(createPaperOrderLifecycle(1, 100), "ACCEPTED", 101);
    assert.throws(() => transitionPaperOrderLifecycle(state, "OPEN", 100), /time is invalid/);
  });
});


describe("restart-safe working order semantics", () => {
  it("keeps OPEN lifecycle non-terminal across serialization", () => {
    let state = createPaperOrderLifecycle(3, 200);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 201);
    state = transitionPaperOrderLifecycle(state, "OPEN", 202);
    const restored = JSON.parse(JSON.stringify(state));
    assert.deepEqual(validatePaperOrderLifecycle(restored), state);
  });

  it("keeps PARTIALLY_FILLED quantities across serialization", () => {
    let state = createPaperOrderLifecycle(8, 200);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 201);
    state = transitionPaperOrderLifecycle(state, "OPEN", 202);
    state = transitionPaperOrderLifecycle(state, "PARTIALLY_FILLED", 203, 3);
    const restored = validatePaperOrderLifecycle(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(Object.assign({}, restored, { status: "PARTIALLY_FILLED", requestedQuantity: 8, filledQuantity: 3, remainingQuantity: 5 }), restored);
  });
});
