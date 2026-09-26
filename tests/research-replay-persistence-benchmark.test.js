"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("research replay persistence benchmark emits machine-readable non-production evidence", () => {
  const script = path.join(__dirname, "..", "scripts", "research-replay-persistence-benchmark.js");
  const result = spawnSync(process.execPath, [script], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      NUSA_REPLAY_BENCH_SEED_COUNT: "2",
    },
    encoding: "utf8",
    timeout: 60_000,
  });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.benchmark, "research-replay-persistence-save");
  assert.equal(receipt.sourceMode, "SYNTHETIC");
  assert.equal(receipt.seedCount, 2);
  assert.ok(Number.isSafeInteger(receipt.archiveBytesBefore) && receipt.archiveBytesBefore > 0);
  assert.ok(Number.isSafeInteger(receipt.archiveBytesAfter) && receipt.archiveBytesAfter > receipt.archiveBytesBefore);
  assert.equal(typeof receipt.saveElapsedMs, "number");
  assert.ok(Number.isFinite(receipt.saveElapsedMs) && receipt.saveElapsedMs >= 0);
  assert.ok(Number.isSafeInteger(receipt.copyFileCalls) && receipt.copyFileCalls >= 0);
  assert.ok(Number.isSafeInteger(receipt.copiedArchiveBytesObserved) && receipt.copiedArchiveBytesObserved >= 0);
  assert.equal(typeof receipt.workAmplificationRatio, "number");
  assert.ok(Number.isFinite(receipt.workAmplificationRatio) && receipt.workAmplificationRatio >= 0);
  assert.equal(receipt.sourceArchiveMutated, false);
  assert.deepEqual(receipt.safety, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});
