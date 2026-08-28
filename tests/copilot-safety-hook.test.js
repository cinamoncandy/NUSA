"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classify } = require("../scripts/copilot-safety-hook.js");

test("allows ordinary read-only and validation commands", () => {
  for (const command of [
    "pnpm run preflight",
    "pnpm run safety:invariants",
    "git status --short",
    "git diff --check",
    "node --test tests/example.test.js"
  ]) {
    assert.equal(classify({ toolName: "bash", toolArgs: { command } }).deny, false, command);
  }
});

test("denies destructive git history mutations", () => {
  for (const command of [
    "git push origin feature --force",
    "git push --force-with-lease origin main",
    "git reset --hard HEAD~1",
    "git branch -D important-branch"
  ]) {
    assert.equal(classify({ toolName: "bash", toolArgs: { command } }).deny, true, command);
  }
});

test("denies explicit authority escalation", () => {
  for (const command of [
    "productionMutationAllowed=true node run.js",
    "NUSA_LIVE=1 node runtime.js",
    "LIVE_TRADING=yes node runtime.js",
    "echo 'liveAuthority: FULL' > state.yaml",
    "echo 'aiAuthority=EXECUTE' > state.env",
    "BROKER_MUTATION=enabled node runtime.js"
  ]) {
    assert.equal(classify({ toolName: "bash", toolArgs: { command } }).deny, true, command);
  }
});

test("allows canonical zero-authority literals", () => {
  for (const command of [
    "echo 'liveAuthority: NONE'",
    "echo 'aiAuthority: ZERO_AUTHORITY'",
    "echo 'productionMutationAllowed: false'"
  ]) {
    assert.equal(classify({ toolName: "bash", toolArgs: { command } }).deny, false, command);
  }
});

test("denies broker or wallet transfer-like commands", () => {
  assert.equal(classify({ toolName: "bash", toolArgs: { command: "broker api withdraw funds --asset USDT" } }).deny, true);
  assert.equal(classify({ toolName: "bash", toolArgs: { command: "wallet transfer asset to destination" } }).deny, true);
});

test("fails closed on malformed hook input marker", () => {
  assert.equal(classify({ __malformed: true }).deny, true);
});
