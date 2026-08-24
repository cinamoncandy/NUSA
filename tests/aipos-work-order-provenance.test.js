const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { RECONCILIATION_PATH, workOrderFiles, validateRepository } = require("../scripts/validate-aipos-work-order-provenance.js");
const { block, scalar } = require("../scripts/validate-aipos-drift.js");

const root = path.resolve(__dirname, "..");
const reconciliation = JSON.parse(fs.readFileSync(path.join(root, RECONCILIATION_PATH), "utf8"));
const scopeById = new Map(reconciliation.scopes.map((scope) => [scope.scope_id, scope]));

function resolvesInRepository(sha) {
  try {
    // stdio "pipe" keeps git's expected "Not a valid object name" chatter out of the test
    // report: probing a deliberately unresolvable identity is a passing case here, not an error.
    return execFileSync("git", ["cat-file", "-t", sha], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() === "commit";
  } catch {
    return false;
  }
}

test("WO-0071: the repository's work-order provenance validates as reconciled", () => {
  const result = validateRepository(root);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  // The reported collision was WO-0070; WO-0063 was found while enforcing it. Both are covered,
  // and this assertion is what makes a newly-introduced third collision fail loudly here.
  assert.deepEqual([...result.collidingIds].sort(), ["WO-0063", "WO-0070"]);
});

test("WO-0071: the canonical deterministic-remediation-prioritization lineage is preserved exactly", () => {
  const scope = scopeById.get("WO-0070.deterministic-remediation-prioritization");
  assert.ok(scope, "canonical prioritization scope must be recorded");
  assert.equal(scope.pull_request, 738);
  assert.equal(scope.implementation_head, "d83b7e0354681df3b1b86bee1e0d805d2108b970");
  assert.equal(scope.merge_commit, "43fdc4a12305d10c16e5c70ba0f20caa9b501188");
  assert.equal(scope.work_order, ".aipos/work-orders/WO-0070-deterministic-remediation-prioritization.yaml");
  assert.equal(scope.implementation_module, "packages/core/src/improvement/remediationPrioritization.ts");

  // Every SHA asserted as canonical must actually resolve, or the record is a claim, not evidence.
  assert.equal(resolvesInRepository(scope.implementation_head), true, "prioritization implementation head must resolve");
  assert.equal(resolvesInRepository(scope.merge_commit), true, "prioritization merge commit must resolve");

  const source = fs.readFileSync(path.join(root, scope.work_order), "utf8");
  const provenance = block(source, "provenance");
  assert.equal(scalar(provenance, "canonical_pull_request"), "738");
  assert.equal(scalar(provenance, "canonical_implementation_head"), "d83b7e0354681df3b1b86bee1e0d805d2108b970");
  assert.equal(scalar(provenance, "canonical_merge_commit"), "43fdc4a12305d10c16e5c70ba0f20caa9b501188");
});

test("WO-0071: the separate remediation-plan-evaluation history is preserved, not absorbed", () => {
  const scope = scopeById.get("WO-0070.remediation-plan-evaluation");
  assert.ok(scope, "plan-evaluation scope must remain recorded as its own history");
  assert.equal(scope.pull_request, 731);
  assert.equal(resolvesInRepository(scope.implementation_head), true);
  assert.equal(resolvesInRepository(scope.merge_commit), true);

  // Both files still exist on disk: reconciliation is additive, never a deletion.
  for (const relative of [
    ".aipos/work-orders/WO-0070-remediation-plan-evaluation.yaml",
    ".aipos/work-orders/WO-0070-deterministic-remediation-prioritization.yaml",
    ".aipos/evidence/WO-0070-completion.json"
  ]) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, `${relative} must not be deleted`);
  }

  // The one existing WO-0070 completion record belongs to this scope only. Attributing it to the
  // prioritization scope is the exact confusion the bare work-order number invites.
  const completion = JSON.parse(fs.readFileSync(path.join(root, ".aipos/evidence/WO-0070-completion.json"), "utf8"));
  assert.match(completion.scope, /plan candidate evaluation/i);
  assert.equal(completion.implementationSha, scope.implementation_head);
  assert.equal(scope.completion_evidence, ".aipos/evidence/WO-0070-completion.json");
  assert.equal(scopeById.get("WO-0070.deterministic-remediation-prioritization").completion_evidence, null);
});

test("WO-0071: distinct scopes sharing a work-order number cannot collapse into one record", () => {
  const scopeIds = reconciliation.scopes.map((scope) => scope.scope_id);
  assert.equal(new Set(scopeIds).size, scopeIds.length, "scope ids must be unique");

  for (const [id, expected] of [["WO-0063", 2], ["WO-0070", 2]]) {
    const onDisk = workOrderFiles(root).filter((file) => scalar(file.source, "id") === id);
    assert.equal(onDisk.length, expected, `${id} must still have ${expected} distinct work-order files`);
    const declared = scopeIds.filter((scopeId) => scopeId.startsWith(`${id}.`));
    assert.equal(declared.length, expected, `${id} must have one reconciled scope per file`);

    // Each file names the other, so neither can be read as "the" record for the number.
    for (const file of onDisk) {
      const provenance = block(file.source, "provenance");
      const collidesWith = scalar(provenance, "collides_with");
      const others = onDisk.filter((other) => other.path !== file.path).map((other) => other.path);
      assert.ok(others.includes(collidesWith), `${file.path} must point at its counterpart`);
      assert.equal(scalar(provenance, "work_order_id_collision"), "true");
    }
  }

  // No completion-evidence file may be claimed by two scopes.
  const claimed = reconciliation.scopes.map((scope) => scope.completion_evidence).filter((value) => typeof value === "string");
  assert.equal(new Set(claimed).size, claimed.length);
});

test("WO-0071: reconciliation is non-destructive and invents no completion metadata", () => {
  assert.equal(reconciliation.reconciliation, "NON_DESTRUCTIVE");
  assert.equal(reconciliation.reconciled_by, "WO-0071");
  for (const file of workOrderFiles(root)) {
    const provenance = block(file.source, "provenance");
    if (!provenance) continue;
    assert.equal(scalar(provenance, "reconciliation"), "NON_DESTRUCTIVE", `${file.path} must declare non-destructive reconciliation`);
  }

  // A scope without completion evidence must say so, never borrow another scope's record.
  for (const scope of reconciliation.scopes) {
    assert.ok("completion_evidence" in scope, `${scope.scope_id} must declare its completion-evidence state`);
    if (scope.completion_evidence === null) assert.match(scope.completion_evidence_note, /no completion-evidence record exists/i);
  }

  // The Mobile MASTER UX work order merged, but reconciling an id collision must not silently
  // close a work order out -- that needs its own verification.
  const mobile = fs.readFileSync(path.join(root, ".aipos/work-orders/WO-0063-mobile-master-ux-wave1.yaml"), "utf8");
  assert.equal(scalar(mobile, "status"), "IN_PROGRESS");
});

test("WO-0071: unresolvable recorded commits are annotated rather than deleted or invented", () => {
  const dangling = reconciliation.unresolvable_recorded_commits;
  assert.ok(Array.isArray(dangling) && dangling.length > 0);
  for (const entry of dangling) {
    // The whole point: it is recorded because it does NOT resolve. If a future change makes it
    // resolvable, this record is stale and must be revisited rather than left asserting a
    // falsehood in the opposite direction.
    assert.equal(resolvesInRepository(entry.value), false, `${entry.value} is recorded as unresolvable but now resolves`);
    assert.equal(entry.handling, "PRESERVED_NOT_DELETED_EXPLICITLY_ANNOTATED");
    assert.equal(resolvesInRepository(entry.superseded_by.implementation_head), true);
    assert.equal(resolvesInRepository(entry.superseded_by.merge_commit), true);
    for (const location of entry.recorded_in) {
      const source = fs.readFileSync(path.join(root, location), "utf8");
      assert.ok(source.includes(entry.value), `${location} must still contain the original recorded value ${entry.value}`);
    }
  }
});
