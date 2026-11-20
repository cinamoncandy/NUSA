"use strict";

// The twelve rehearsal cases of docs/CLOUDFLARE_REMOVAL_S3_DESIGN_2026-11-20.md section 3 that are decisions of the gate itself
// (cases 11 and the workflow glue are checked in the workflow and in the first real run). Each case must BLOCK, never pass.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { decideRelease } = require("../scripts/release-control-gate.js");

const MAIN = "a".repeat(40);
const HEAD = "b".repeat(40);
const CLEAN = JSON.stringify({ schemaVersion: 1, globalReleaseFreeze: false, holdState: "NONE", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
const withFile = (over) => JSON.stringify({ ...JSON.parse(CLEAN), ...over });
const base = (over = {}) => ({
  firstReadText: CLEAN, secondReadText: CLEAN, auditedBase: MAIN, mainHeadAtSecondRead: MAIN,
  identity: { repository: "o/r", prNumber: 7, headSha: HEAD, baseSha: MAIN }, worker: { reachable: true, decision: "CLEAR" }, ...over
});

test("baseline: everything clear and the Worker agreeing releases", () => {
  assert.deepEqual({ ...decideRelease(base()) }, { decision: "CLEAR", code: "RELEASE_CONTROL_CLEAR", worker: "WORKER_CLEAR" });
});

test("case 1: the file cannot be read (either read) blocks", () => {
  assert.equal(decideRelease(base({ firstReadText: "" })).code, "FIRST_READ_FILE_UNREADABLE");
  assert.equal(decideRelease(base({ firstReadText: null })).decision, "BLOCK");
  assert.equal(decideRelease(base({ secondReadText: undefined })).code, "SECOND_READ_FILE_UNREADABLE");
});

test("case 2: invalid JSON, unknown or missing fields, wrong types, duplicate key, BOM block", () => {
  for (const text of ["{nope", "[]", "null", withFile({ extra: 1 }), JSON.stringify({ schemaVersion: 1 }), withFile({ globalReleaseFreeze: "false" }), "﻿" + CLEAN, CLEAN.replace("{", '{"holdState":"HOLD",')]) {
    assert.equal(decideRelease(base({ firstReadText: text })).decision, "BLOCK", text.slice(0, 40));
  }
});

test("case 2b: a repeated key is refused even when the last value looks clear (JSON.parse would keep the last)", () => {
  const dupHold = '{"holdState":"HOLD","schemaVersion":1,"globalReleaseFreeze":false,"holdState":"NONE","liveAuthority":"NONE","productionMutationAllowed":false,"aiAuthority":"ZERO_AUTHORITY"}';
  assert.equal(decideRelease(base({ firstReadText: dupHold })).code, "FIRST_READ_FILE_DUPLICATE_KEY");
  assert.equal(decideRelease(base({ secondReadText: dupHold })).code, "SECOND_READ_FILE_DUPLICATE_KEY");
  assert.equal(decideRelease(base()).decision, "CLEAR");
});

test("cases 3, 4, 5: freeze, hold and a changed safety fact block", () => {
  assert.equal(decideRelease(base({ firstReadText: withFile({ globalReleaseFreeze: true }) })).code, "FIRST_READ_GLOBAL_FREEZE_ACTIVE");
  assert.equal(decideRelease(base({ firstReadText: withFile({ holdState: "HOLD" }) })).code, "FIRST_READ_HOLD_ACTIVE");
  for (const over of [{ liveAuthority: "LIVE" }, { productionMutationAllowed: true }, { aiAuthority: "FULL" }]) assert.equal(decideRelease(base({ firstReadText: withFile(over) })).code, "FIRST_READ_SAFETY_FACT_MISMATCH");
});

test("case 6: a HOLD set between the first and the second read blocks at the second read", () => {
  assert.equal(decideRelease(base({ secondReadText: withFile({ holdState: "HOLD" }) })).code, "SECOND_READ_HOLD_ACTIVE");
  assert.equal(decideRelease(base({ secondReadText: withFile({ globalReleaseFreeze: true }) })).code, "SECOND_READ_GLOBAL_FREEZE_ACTIVE");
});

test("case 7: the PR head's copy of the file is not an input; a HOLD at the base blocks even if the head says CLEAR", () => {
  const result = decideRelease({ ...base({ firstReadText: withFile({ holdState: "HOLD" }), secondReadText: withFile({ holdState: "HOLD" }) }), headFileText: CLEAN, prHeadFile: CLEAN });
  assert.equal(result.decision, "BLOCK");
  assert.ok(!fs.readFileSync(path.join(__dirname, "../scripts/release-control-gate.js"), "utf8").match(/headFileText|prHeadFile/) || true);
  const source = fs.readFileSync(path.join(__dirname, "../scripts/release-control-gate.js"), "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(source, /headFile|prHeadFile/, "no code path reads a head copy");
});

test("case 8: an answer for another PR, head or base blocks", () => {
  assert.equal(decideRelease(base({ identity: { repository: "o/r", prNumber: 0, headSha: HEAD, baseSha: MAIN } })).decision, "BLOCK");
  assert.equal(decideRelease(base({ identity: { repository: "o/r", prNumber: 7, headSha: "xyz", baseSha: MAIN } })).decision, "BLOCK");
  assert.equal(decideRelease(base({ identity: { repository: "o/r", prNumber: 7, headSha: HEAD, baseSha: "c".repeat(40) } })).code, "IDENTITY_BASE_MISMATCH");
  assert.equal(decideRelease(base({ identity: { repository: "bad repo", prNumber: 7, headSha: HEAD, baseSha: MAIN } })).decision, "BLOCK");
});

test("case 9: a stale base blocks (main moved after the PR's base)", () => {
  assert.equal(decideRelease(base({ mainHeadAtSecondRead: "d".repeat(40) })).code, "STALE_BASE");
  assert.equal(decideRelease(base({ mainHeadAtSecondRead: "not a sha" })).code, "BASE_UNKNOWN");
  assert.equal(decideRelease(base({ auditedBase: undefined })).code, "BASE_UNKNOWN");
});

test("case 10: HOLD cleared between the reads is NOT a pass by itself; the first blocked read stops the gate (a re-run reads fresh)", () => {
  assert.equal(decideRelease(base({ firstReadText: withFile({ holdState: "HOLD" }), secondReadText: CLEAN })).code, "FIRST_READ_HOLD_ACTIVE");
  assert.equal(decideRelease(base({ firstReadText: CLEAN, secondReadText: "" })).decision, "BLOCK");
});

test("case 12: after the switch the Worker can only block; its silence never releases or blocks, a Worker HOLD blocks", () => {
  assert.equal(decideRelease(base({ worker: { reachable: true, decision: "BLOCK" } })).code, "WORKER_DISAGREES_BLOCK");
  assert.equal(decideRelease(base({ worker: { reachable: true, decision: "HOLD" } })).code, "WORKER_DISAGREES_BLOCK");
  assert.deepEqual({ ...decideRelease(base({ worker: { reachable: false } })) }, { decision: "CLEAR", code: "RELEASE_CONTROL_CLEAR", worker: "WORKER_UNREACHABLE" });
  assert.deepEqual({ ...decideRelease(base({ worker: undefined })) }, { decision: "CLEAR", code: "RELEASE_CONTROL_CLEAR", worker: "WORKER_UNREACHABLE" });
  // a replacement BLOCK is never overridden by a CLEAR Worker
  assert.equal(decideRelease(base({ firstReadText: withFile({ holdState: "HOLD" }), worker: { reachable: true, decision: "CLEAR" } })).decision, "BLOCK");
});

test("never throws and never releases on garbage input", () => {
  for (const input of [undefined, null, {}, 5, "x", { identity: null }]) assert.equal(decideRelease(input).decision, "BLOCK");
});

test("the gate is not wired into any workflow or runtime yet", () => {
  for (const file of fs.readdirSync(path.join(__dirname, "../.github/workflows"))) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../.github/workflows", file), "utf8"), /release-control-gate/, file);
});
