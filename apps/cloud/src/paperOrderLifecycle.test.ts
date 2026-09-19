import { describe, expect, it } from "vitest";
import { createPaperOrderLifecycle, transitionPaperOrderLifecycle, validatePaperOrderLifecycle } from "./paperOrderLifecycle";

describe("canonical PAPER order lifecycle", () => {
  it("supports accepted open partial fill complete fill deterministically", () => {
    let state = createPaperOrderLifecycle(10, 100);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 101);
    state = transitionPaperOrderLifecycle(state, "OPEN", 102);
    state = transitionPaperOrderLifecycle(state, "PARTIALLY_FILLED", 103, 4);
    expect(state).toMatchObject({ status: "PARTIALLY_FILLED", filledQuantity: 4, remainingQuantity: 6, transitionSequence: 3 });
    state = transitionPaperOrderLifecycle(state, "FILLED", 104, 6);
    expect(validatePaperOrderLifecycle(state)).toMatchObject({ status: "FILLED", filledQuantity: 10, remainingQuantity: 0, transitionSequence: 4 });
  });

  it("supports cancellation after partial fill without inventing another fill", () => {
    let state = createPaperOrderLifecycle(5, 100);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 101);
    state = transitionPaperOrderLifecycle(state, "OPEN", 102);
    state = transitionPaperOrderLifecycle(state, "PARTIALLY_FILLED", 103, 2);
    state = transitionPaperOrderLifecycle(state, "CANCELLED", 104);
    expect(state).toMatchObject({ status: "CANCELLED", filledQuantity: 2, remainingQuantity: 3 });
  });

  it("supports rejection before execution", () => {
    const rejected = transitionPaperOrderLifecycle(createPaperOrderLifecycle(1, 100), "REJECTED", 101);
    expect(rejected).toMatchObject({ status: "REJECTED", filledQuantity: 0, remainingQuantity: 1 });
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
    expect(() => transitionPaperOrderLifecycle(state, next, 103, next === "FILLED" ? 1 : 0)).toThrow(/terminal state cannot transition/);
  });

  it("rejects overfill and incomplete FILLED transitions", () => {
    let state = createPaperOrderLifecycle(10, 100);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 101);
    state = transitionPaperOrderLifecycle(state, "OPEN", 102);
    expect(() => transitionPaperOrderLifecycle(state, "PARTIALLY_FILLED", 103, 11)).toThrow(/exceeds remaining/);
    expect(() => transitionPaperOrderLifecycle(state, "FILLED", 103, 9)).toThrow(/consume remaining/);
  });

  it("rejects clock regression", () => {
    const state = transitionPaperOrderLifecycle(createPaperOrderLifecycle(1, 100), "ACCEPTED", 101);
    expect(() => transitionPaperOrderLifecycle(state, "OPEN", 100)).toThrow(/time is invalid/);
  });
});


describe("restart-safe working order semantics", () => {
  it("keeps OPEN lifecycle non-terminal across serialization", () => {
    let state = createPaperOrderLifecycle(3, 200);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 201);
    state = transitionPaperOrderLifecycle(state, "OPEN", 202);
    const restored = JSON.parse(JSON.stringify(state));
    expect(validatePaperOrderLifecycle(restored)).toEqual(state);
  });

  it("keeps PARTIALLY_FILLED quantities across serialization", () => {
    let state = createPaperOrderLifecycle(8, 200);
    state = transitionPaperOrderLifecycle(state, "ACCEPTED", 201);
    state = transitionPaperOrderLifecycle(state, "OPEN", 202);
    state = transitionPaperOrderLifecycle(state, "PARTIALLY_FILLED", 203, 3);
    const restored = validatePaperOrderLifecycle(JSON.parse(JSON.stringify(state)));
    expect(restored).toMatchObject({ status: "PARTIALLY_FILLED", requestedQuantity: 8, filledQuantity: 3, remainingQuantity: 5 });
  });
});
