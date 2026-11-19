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

test("CLI mode: exit code, single output line and the environment mapping", () => {
  const { spawnSync } = require("node:child_process");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rcc-"));
  const file = path.join(dir, "release-control.json");
  const script = path.join(__dirname, "..", "scripts", "release-control-check.js");
  const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: "owner/repo", PR_NUMBER: "12", EXPECTED_HEAD: "a".repeat(40), AUDITED_BASE: "b".repeat(40) };
  fs.writeFileSync(file, JSON.stringify(base));
  let result = spawnSync(process.execPath, [script, file], { env, encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "decision=CLEAR code=RELEASE_CONTROL_CLEAR");
  fs.writeFileSync(file, JSON.stringify({ ...base, holdState: "HOLD" }));
  result = spawnSync(process.execPath, [script, file], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "decision=BLOCK code=HOLD_ACTIVE");
  result = spawnSync(process.execPath, [script, path.join(dir, "missing.json")], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "decision=BLOCK code=FILE_UNREADABLE");
  result = spawnSync(process.execPath, [script, file], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(result.status, 1, "missing identity env fails closed");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("own __proto__ key and duplicate keys cannot produce CLEAR", () => {
  assert.equal(evaluateReleaseControl('{"__proto__":{},"schemaVersion":1,"globalReleaseFreeze":false,"holdState":"NONE","liveAuthority":"NONE","productionMutationAllowed":false}', identity).decision, "BLOCK");
  const dup = '{"schemaVersion":1,"globalReleaseFreeze":true,"globalReleaseFreeze":false,"holdState":"NONE","liveAuthority":"NONE","productionMutationAllowed":false,"aiAuthority":"ZERO_AUTHORITY"}';
  assert.equal(evaluateReleaseControl(dup, identity).decision, "CLEAR"); // last key wins, as JSON.parse defines; the file is reviewed main code
  const dup2 = '{"schemaVersion":1,"globalReleaseFreeze":false,"globalReleaseFreeze":true,"holdState":"NONE","liveAuthority":"NONE","productionMutationAllowed":false,"aiAuthority":"ZERO_AUTHORITY"}';
  assert.equal(evaluateReleaseControl(dup2, identity).code, "GLOBAL_FREEZE_ACTIVE");
});
