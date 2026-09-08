const test = require("node:test");
const assert = require("node:assert/strict");

const { describeProjectionRejection } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const { validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");

// The contract judges a server-generated timestamp against this device's clock inside a 15s
// window, so a modest clock disagreement fails the whole connection. Saying only "invalid or
// stale" sent the operator looking at their token instead of at the clocks.
test("a stale or future-dated snapshot names the clock as the thing to check", () => {
  const stale = describeProjectionRejection(new Error("personal PAPER operations snapshot is stale"));
  const future = describeProjectionRejection(new Error("personal PAPER operations snapshot is from the future"));
  assert.match(stale, /시계/);
  assert.match(stale, /오래되었습니다/);
  assert.match(future, /시계/);
  assert.match(future, /앞서 있습니다/);
  assert.notEqual(stale, future, "the two clock failures read differently");
});

test("a structural rejection carries the validator's own words", () => {
  const reason = describeProjectionRejection(new Error("personal PAPER operations health mismatch"));
  assert.match(reason, /health mismatch/);
  assert.doesNotMatch(reason, /시계/, "a structural fault must not be blamed on the clock");
});

test("a reason stays bounded and survives a non-Error throw", () => {
  assert.ok(describeProjectionRejection(new Error("x".repeat(5_000))).length <= 360);
  assert.match(describeProjectionRejection(null), /해석할 수 없습니다/);
});

// Drives the real contract so the message stays tied to what the validator actually throws.
test("the real validator's staleness rejection maps to the clock message", () => {
  const base = {
    schemaVersion: 1,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    generatedAt: Date.now() - 600_000
  };
  let thrown;
  try { validatePersonalPaperOperationsSnapshot(base); } catch (error) { thrown = error; }
  assert.ok(thrown, "an old snapshot is rejected");
  assert.match(describeProjectionRejection(thrown), /시계/, "and that rejection names the clock");
});
