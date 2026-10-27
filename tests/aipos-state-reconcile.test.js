const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMerged, reconcileText, CONTROL_KEYS } = require("../scripts/aipos-state-reconcile.js");

const STATE = [
  "version: 1",
  "claimed_state:",
  "  work_order: WO-X",
  "  status: IN_PROGRESS",
  "  branch: main",
  "current_merged_a:",
  "  work_order: WO-A",
  "  status: READY_FOR_REVIEW",
  "  branch: feat/a",
  "  next: \"keep this\"",
  "current_unmerged_b:",
  "  status: LOCAL_VALIDATED_PENDING_CI",
  "  branch: feat/b",
  "current_done_c:",
  "  status: COMPLETED",
  "  branch: feat/c",
  "current_blocked_d:",
  "  status: BLOCKED_ON_OWNER",
  "  branch: feat/d",
  "current_digits_f:",
  "  status: VALIDATOR_P1_REPAIRED_PENDING_EXACT_HEAD_CI",
  "  branch: feat/f",
  "current_already_e:",
  "  status: READY_FOR_REVIEW",
  "  merged_pr: 7",
  "  branch: feat/e",
  "",
].join("\n");

const merged = parseMerged("feat/a\t101\nmain\t5\nfeat/c\t103\nfeat/d\t104\nfeat/e\t105\nfeat/f\t106\nfeat/a\t99\nbad line\n");

test("only an in-flight current_* entry with a merged branch PR becomes COMPLETED, with merged_pr as evidence", () => {
  const { text, changed } = reconcileText(STATE, merged);
  assert.deepEqual(changed, [
    { key: "current_merged_a", from: "READY_FOR_REVIEW", pr: 101 },
    { key: "current_digits_f", from: "VALIDATOR_P1_REPAIRED_PENDING_EXACT_HEAD_CI", pr: 106 },
  ]);
  assert.match(text, /current_merged_a:\n  work_order: WO-A\n  status: COMPLETED\n  merged_pr: 101\n  branch: feat\/a\n  next: "keep this"/);
});

test("control keys, unmerged, already completed, other statuses and already-reconciled entries are left unchanged", () => {
  const { text } = reconcileText(STATE, merged);
  assert.match(text, /claimed_state:\n  work_order: WO-X\n  status: IN_PROGRESS/);
  assert.match(text, /current_unmerged_b:\n  status: LOCAL_VALIDATED_PENDING_CI/);
  assert.match(text, /current_done_c:\n  status: COMPLETED\n  branch/);
  assert.match(text, /current_blocked_d:\n  status: BLOCKED_ON_OWNER/);
  assert.match(text, /current_already_e:\n  status: READY_FOR_REVIEW\n  merged_pr: 7/);
});

test("reconciling is idempotent and the newest merged PR per branch wins", () => {
  const once = reconcileText(STATE, merged).text;
  const twice = reconcileText(once, merged);
  assert.equal(twice.text, once);
  assert.deepEqual(twice.changed, []);
  assert.equal(merged.get("feat/a"), 101);
  assert.equal(merged.has("bad line"), false);
});

test("a control key with the current_ prefix is never rewritten", () => {
  const text = "current_non_live_work_order:\n  id: WO-1\n  status: READY_FOR_REVIEW\n  branch: agent/wo-1\n";
  const result = reconcileText(text, parseMerged("agent/wo-1\t9"));
  assert.deepEqual(result.changed, []);
  assert.equal(result.text, text);
});

test("every state key a validator reads by name is excluded", () => {
  const fs = require("node:fs");
  const read = new Set();
  for (const file of fs.readdirSync("scripts").filter((name) => /^(validate-|aipos-).*\.js$/.test(name) && name !== "aipos-state-reconcile.js")) {
    for (const match of fs.readFileSync(`scripts/${file}`, "utf8").matchAll(/block\(state, "([a-z_]+)"\)/g)) read.add(match[1]);
  }
  assert.ok(read.size > 0);
  for (const key of read) assert.ok(CONTROL_KEYS.has(key), `${key} is read by a validator but not excluded`);
});
