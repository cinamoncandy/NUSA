"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateReleaseControl } = require("../scripts/release-control-check.js");

const identity = { repository: "owner/repo", prNumber: 12, headSha: "a".repeat(40), baseSha: "b".repeat(40) };
const base = { schemaVersion: 1, globalReleaseFreeze: false, holdState: "NONE", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" };
const run = (patch, id = identity) => evaluateReleaseControl(JSON.stringify({ ...base, ...patch }), id);

test("the committed file on main is CLEAR", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "config", "release-control.json"), "utf8");
  assert.deepEqual({ ...evaluateReleaseControl(text, identity) }, { decision: "CLEAR", code: "RELEASE_CONTROL_CLEAR" });
});
test("CLEARED hold is also clear", () => assert.equal(run({ holdState: "CLEARED" }).decision, "CLEAR"));
test("unreadable, empty and invalid files block", () => {
  assert.equal(evaluateReleaseControl(undefined, identity).code, "FILE_UNREADABLE");
  assert.equal(evaluateReleaseControl("  ", identity).code, "FILE_UNREADABLE");
  assert.equal(evaluateReleaseControl("{", identity).code, "FILE_INVALID_JSON");
  assert.equal(evaluateReleaseControl("[]", identity).code, "FILE_NOT_OBJECT");
  assert.equal(evaluateReleaseControl("null", identity).code, "FILE_NOT_OBJECT");
});
test("freeze active blocks, and only an exact false is accepted", () => {
  assert.equal(run({ globalReleaseFreeze: true }).code, "GLOBAL_FREEZE_ACTIVE");
  assert.equal(run({ globalReleaseFreeze: "false" }).code, "GLOBAL_FREEZE_ACTIVE");
  assert.equal(run({ globalReleaseFreeze: 0 }).code, "GLOBAL_FREEZE_ACTIVE");
});
test("an active or unknown hold blocks", () => {
  assert.equal(run({ holdState: "HOLD" }).code, "HOLD_ACTIVE");
  assert.equal(run({ holdState: "" }).code, "HOLD_ACTIVE");
  assert.equal(run({ holdState: null }).code, "HOLD_ACTIVE");
});
test("a changed or missing safety fact blocks", () => {
  assert.equal(run({ liveAuthority: "LIMITED" }).code, "SAFETY_FACT_MISMATCH");
  assert.equal(run({ productionMutationAllowed: true }).code, "SAFETY_FACT_MISMATCH");
  assert.equal(run({ aiAuthority: "ADVISORY" }).code, "SAFETY_FACT_MISMATCH");
  const { aiAuthority, ...missing } = base;
  assert.equal(evaluateReleaseControl(JSON.stringify(missing), identity).code, "FILE_KEYS_UNEXPECTED");
});
test("unknown fields and schema versions block", () => {
  assert.equal(run({ extra: 1 }).code, "FILE_KEYS_UNEXPECTED");
  assert.equal(run({ schemaVersion: 2 }).code, "SCHEMA_VERSION");
});
test("a bad PR identity blocks", () => {
  assert.equal(run({}, { ...identity, repository: "x" }).code, "IDENTITY_REPOSITORY");
  assert.equal(run({}, { ...identity, prNumber: 0 }).code, "IDENTITY_PR");
  assert.equal(run({}, { ...identity, prNumber: Number.NaN }).code, "IDENTITY_PR");
  assert.equal(run({}, { ...identity, headSha: "abc" }).code, "IDENTITY_SHA");
  assert.equal(run({}, { ...identity, baseSha: undefined }).code, "IDENTITY_SHA");
  assert.equal(evaluateReleaseControl(JSON.stringify(base), undefined).code, "IDENTITY_REPOSITORY");
});
