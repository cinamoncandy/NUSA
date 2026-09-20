import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../apps/cloud/src/runtime.ts", import.meta.url), "utf8");

test("production Cloud runtime must not silently omit canonical closed-learning composition", () => {
  const mainStart = runtimeSource.indexOf("function main(): void {");
  assert.ok(mainStart >= 0, "production Cloud runtime main() must remain inspectable by the Integration/E2E gate");

  const mainEnd = runtimeSource.indexOf("if (require.main === module)", mainStart);
  assert.ok(mainEnd > mainStart, "production Cloud runtime main() boundary must remain inspectable");
  const mainSource = runtimeSource.slice(mainStart, mainEnd);
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
  const researchCollaboratorIndexes = [7, 8, 9];
  const omittedResearch = researchCollaboratorIndexes
    .map((index) => ({ index, value: args[index] }))
    .filter(({ value }) => value === "undefined");

  assert.deepEqual(
    omittedResearch,
    [],
    "production Cloud runtime omits canonical Research/Integration collaborators; optional infrastructure defaults must not be confused with lifecycle composition",
  );
});

test("production composition gate preserves PAPER-only authority invariants", () => {
  assert.doesNotMatch(runtimeSource, /productionMutationAllowed\s*:\s*true/);
  assert.doesNotMatch(runtimeSource, /liveAuthority\s*:\s*["'](?:FULL|LIVE|ENABLED)["']/);
  assert.match(runtimeSource, /productionMutationAllowed\s*:\s*false/);
  assert.match(runtimeSource, /liveAuthority\s*:\s*["']NONE["']/);
});
