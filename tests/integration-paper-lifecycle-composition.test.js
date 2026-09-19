import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../apps/cloud/src/runtime.ts", import.meta.url), "utf8");

test("production Cloud runtime must not silently omit canonical closed-learning composition", () => {
  const mainMatch = runtimeSource.match(/function main\(\): void \{([\s\S]*?)\n\}/);
  assert.ok(mainMatch, "production Cloud runtime main() must remain inspectable by the Integration/E2E gate");

  const mainSource = mainMatch[1];
  assert.match(mainSource, /startCloudRuntime\(/, "production main() must compose the canonical Cloud runtime");

  const callMatch = mainSource.match(/startCloudRuntime\(([\s\S]*?)\);/);
  assert.ok(callMatch, "production startCloudRuntime(...) composition must remain explicit");

  const args = callMatch[1].split(",").map((value) => value.trim());
  assert.ok(args.length >= 11, "production runtime composition signature changed; Integration/E2E evidence must be reviewed");

  // startCloudRuntime currently accepts optional Research/closed-learning collaborators.
  // A positional undefined in the production composition root is not evidence that the
  // canonical Market -> Research -> PAPER -> Evidence feedback lifecycle is wired.
  // Fail closed until production supplies explicit collaborators or the composition API
  // is replaced by an equivalent typed object whose required dependencies are testable.
  const omitted = args
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => index > 1 && index < args.length - 1 && value === "undefined");

  assert.deepEqual(
    omitted,
    [],
    "production Cloud runtime omits canonical Integration/E2E collaborators; component availability is not closed-loop composition",
  );
});

test("production composition gate preserves PAPER-only authority invariants", () => {
  assert.doesNotMatch(runtimeSource, /productionMutationAllowed\s*:\s*true/);
  assert.doesNotMatch(runtimeSource, /liveAuthority\s*:\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.match(runtimeSource, /productionMutationAllowed\s*:\s*false/);
  assert.match(runtimeSource, /liveAuthority\s*:\s*["']NONE["']/);
});
