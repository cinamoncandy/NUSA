"use strict";

// Offline harness tests for scripts/compare-audit-models.js (issue #1545).
// No Workers AI, no network, no credentials. Deterministic fixtures only.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_DIFF_CHARS,
  validateDiffEntry,
  validateVerdict,
  compareVerdicts,
} = require("../scripts/compare-audit-models");

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

function diffWithFiles(n) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(`diff --git a/f${i}.ts b/f${i}.ts\n+x${i}\n`);
  return parts.join("");
}

function entry(overrides = {}) {
  return { prNumber: 1, headSha: HEAD, baseSha: BASE, changedFiles: 2, diff: diffWithFiles(2), ...overrides };
}

function verdict(overrides = {}) {
  return { verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: { result: "PASS" }, evidenceRefs: [], ...overrides };
}

test("accepts a well-formed diff entry", () => {
  const r = validateDiffEntry(entry());
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  assert.equal(r.stats.fileCount, 2);
});

test("rejects empty diff, oversize diff, and file-count mismatch (fail-closed)", () => {
  assert.ok(validateDiffEntry(entry({ diff: "   " })).failures.includes("AUDIT_DIFF_EMPTY"));
  assert.ok(validateDiffEntry(entry({ diff: "x".repeat(MAX_DIFF_CHARS + 1), changedFiles: 1 })).failures.includes("AUDIT_DIFF_TOO_LARGE"));
  assert.ok(validateDiffEntry(entry({ changedFiles: 3 })).failures.includes("AUDIT_DIFF_FILE_COUNT_MISMATCH"));
});

test("rejects malformed SHAs and out-of-range file counts", () => {
  assert.ok(validateDiffEntry(entry({ headSha: "abc" })).failures.includes("HEAD_SHA_INVALID"));
  assert.ok(validateDiffEntry(entry({ changedFiles: 0, diff: diffWithFiles(0) })).failures.includes("CHANGED_FILES_OUT_OF_RANGE"));
});

test("mergeAllowed requires PASS verdict + PASS safety + zero blockers", () => {
  assert.equal(validateVerdict(verdict()).mergeAllowed, true);
  assert.equal(validateVerdict(verdict({ verdict: "PASS_WITH_NOTES" })).mergeAllowed, false);
  assert.equal(validateVerdict(verdict({ verdict: "FAIL", blockers: [{ code: "X" }] })).mergeAllowed, false);
  assert.equal(validateVerdict(verdict({ blockers: [{ code: "X" }] })).mergeAllowed, false);
  assert.equal(validateVerdict(verdict({ safetyInvariantResult: { result: "FAIL" } })).mergeAllowed, false);
});

test("rejects invalid verdicts and oversized finding arrays", () => {
  assert.ok(validateVerdict({ ...verdict(), verdict: "MAYBE" }).failures.includes("AUDIT_VERDICT_INVALID"));
  assert.ok(validateVerdict(verdict({ findings: new Array(41).fill({}) })).failures.includes("MAX_FINDINGS_EXCEEDED"));
});

test("compare reports agreement, FAIL recall, false-PASS, and merge parity", () => {
  const fail = verdict({ verdict: "FAIL", blockers: [{ code: "B" }], safetyInvariantResult: { result: "FAIL" } });
  const pairs = [
    { baseline: verdict(), candidate: verdict() },
    { baseline: fail, candidate: fail },
    { baseline: fail, candidate: verdict() }, // false PASS
  ];
  const m = compareVerdicts(pairs);
  assert.equal(m.n, 3);
  assert.equal(m.agreementRate, 2 / 3);
  assert.equal(m.failRecall, 1 / 2);
  assert.equal(m.falsePassCount, 1);
  assert.equal(m.mergeAllowedParity, 2 / 3);
  assert.equal(m.confusionMatrix.FAIL.FAIL, 1);
  assert.equal(m.confusionMatrix.FAIL.PASS, 1);
});
