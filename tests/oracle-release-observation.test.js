"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const EXPECTED_SHA = "a".repeat(40);
const STALE_SHA = "b".repeat(40);
const OBSERVER = path.join(__dirname, "..", "scripts", "oracle-release-observation.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-oracle-release-observation-"));
  fs.mkdirSync(path.join(root, "releases"), { recursive: true });
  return root;
}

function stage(root, sha) {
  const release = path.join(root, "releases", sha);
  fs.mkdirSync(release, { recursive: true });
  return release;
}

function pointCurrent(root, release) {
  const current = path.join(root, "current");
  fs.rmSync(current, { force: true });
  fs.symlinkSync(release, current, "junction");
}

function observe(root, expectedSha = EXPECTED_SHA) {
  const result = spawnSync(process.execPath, [OBSERVER], {
    env: {
      ...process.env,
      NUSA_DEPLOY_ROOT: root,
      NUSA_EXPECTED_SHA: expectedSha,
    },
    encoding: "utf8",
  });
  return {
    result,
    receipt: JSON.parse(result.stdout.trim()),
  };
}

test("passes only when Oracle current points at the exact expected staged release", () => {
  const root = fixture();
  const expectedRelease = stage(root, EXPECTED_SHA);
  pointCurrent(root, expectedRelease);

  const { result, receipt } = observe(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.status, "CURRENT");
  assert.equal(receipt.pass, true);
  assert.equal(receipt.reason, "EXACT_MAIN_RELEASE");
  assert.equal(receipt.observed_sha, EXPECTED_SHA);
  assert.equal(receipt.target_release_staged, true);
  assert.deepEqual(receipt.safety, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});

test("reports STALE and fails closed when current points at an older release", () => {
  const root = fixture();
  const staleRelease = stage(root, STALE_SHA);
  pointCurrent(root, staleRelease);

  const { result, receipt } = observe(root);
  assert.notEqual(result.status, 0);
  assert.equal(receipt.status, "STALE");
  assert.equal(receipt.pass, false);
  assert.equal(receipt.reason, "TARGET_NOT_STAGED");
  assert.equal(receipt.observed_sha, STALE_SHA);
  assert.equal(receipt.target_release_staged, false);
});

test("distinguishes a staged target that has not become current", () => {
  const root = fixture();
  const staleRelease = stage(root, STALE_SHA);
  stage(root, EXPECTED_SHA);
  pointCurrent(root, staleRelease);

  const { result, receipt } = observe(root);
  assert.notEqual(result.status, 0);
  assert.equal(receipt.status, "STALE");
  assert.equal(receipt.reason, "TARGET_STAGED_NOT_CURRENT");
  assert.equal(receipt.target_release_staged, true);
});

test("reports BLOCKED when current is missing instead of guessing deployment identity", () => {
  const root = fixture();
  stage(root, EXPECTED_SHA);

  const { result, receipt } = observe(root);
  assert.notEqual(result.status, 0);
  assert.equal(receipt.status, "BLOCKED");
  assert.equal(receipt.reason, "CURRENT_PATH_MISSING");
  assert.equal(receipt.observed_sha, null);
});

test("rejects a current junction that escapes the immutable releases directory", () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-oracle-release-outside-"));
  const outsideRelease = path.join(outside, EXPECTED_SHA);
  fs.mkdirSync(outsideRelease, { recursive: true });
  pointCurrent(root, outsideRelease);

  const { result, receipt } = observe(root);
  assert.notEqual(result.status, 0);
  assert.equal(receipt.status, "BLOCKED");
  assert.equal(receipt.reason, "CURRENT_TARGET_INVALID");
  assert.equal(receipt.pass, false);
});

test("rejects malformed expected SHAs before reading deployment identity", () => {
  const root = fixture();
  const { result, receipt } = observe(root, "not-a-sha");
  assert.notEqual(result.status, 0);
  assert.equal(receipt.status, "BLOCKED");
  assert.equal(receipt.reason, "INVALID_EXPECTED_SHA");
  assert.equal(receipt.pass, false);
});

test("replayed exact-SHA observations are deterministic and do not mutate current", () => {
  const root = fixture();
  const expectedRelease = stage(root, EXPECTED_SHA);
  pointCurrent(root, expectedRelease);
  const current = path.join(root, "current");
  const beforeTarget = fs.realpathSync(current);

  const first = observe(root);
  const second = observe(root);

  assert.equal(first.result.status, 0, first.result.stderr);
  assert.equal(second.result.status, 0, second.result.stderr);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(fs.realpathSync(current), beforeTarget);
  assert.equal(fs.lstatSync(current).isSymbolicLink(), true);
});
