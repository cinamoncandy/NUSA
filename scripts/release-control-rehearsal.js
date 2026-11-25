#!/usr/bin/env node
"use strict";

// Cloudflare removal S3b rehearsal (docs/CLOUDFLARE_REMOVAL_S3_DESIGN_2026-11-20.md section 3), run in a dispatch-only workflow, never in a real merge.
// It feeds the REAL config/release-control.json (read from main by the workflow) and mutated copies of it to the gate and prints one line per case.
// Every refusal case must BLOCK; the positive control (the unmodified real file with everything matching) must be CLEAR, so an
// always-BLOCK gate cannot pass the rehearsal. It reads no network, writes nothing, changes no decision of any workflow and is not wired into the audit.
// Cases 1 (404) and 11 (concurrent audits, stale status) are workflow behaviour; case 1 is rehearsed by the workflow's real fetch of a missing path, case 11 is read from the workflow.

const fs = require("node:fs");
const { decideRelease: realGate } = require("./release-control-gate");

const MAIN = "a".repeat(40);
const OTHER = "c".repeat(40);
const HEAD = "b".repeat(40);

function rehearse(cleanText, decideRelease = realGate) {
  const clean = JSON.parse(cleanText);
  const withFile = (over) => JSON.stringify({ ...clean, ...over });
  const input = (over = {}) => ({
    firstReadText: cleanText, secondReadText: cleanText, auditedBase: MAIN, mainHeadAtSecondRead: MAIN,
    identity: { repository: "o/r", prNumber: 7, headSha: HEAD, baseSha: MAIN }, worker: { reachable: true, decision: "CLEAR" }, ...over
  });
  const dupHold = cleanText.replace("{", '{"holdState":"HOLD",');
  const refusals = [
    ["1-unreadable-first", input({ firstReadText: "" })],
    ["1-unreadable-second", input({ secondReadText: undefined })],
    ["2-invalid-json", input({ firstReadText: "{nope" })],
    ["2-unknown-field", input({ firstReadText: withFile({ extra: 1 }) })],
    ["2-missing-field", input({ firstReadText: JSON.stringify({ schemaVersion: 1 }) })],
    ["2-wrong-type", input({ firstReadText: withFile({ globalReleaseFreeze: "false" }) })],
    ["2-bom", input({ firstReadText: "﻿" + cleanText })],
    ["2-duplicate-key-first", input({ firstReadText: dupHold })],
    ["2-duplicate-key-second", input({ secondReadText: dupHold })],
    ["3-global-freeze", input({ firstReadText: withFile({ globalReleaseFreeze: true }) })],
    ["4-hold-active", input({ firstReadText: withFile({ holdState: "HOLD" }) })],
    ["5-live-authority", input({ firstReadText: withFile({ liveAuthority: "LIVE" }) })],
    ["5-production-mutation", input({ firstReadText: withFile({ productionMutationAllowed: true }) })],
    ["5-ai-authority", input({ firstReadText: withFile({ aiAuthority: "FULL" }) })],
    ["6-hold-between-reads", input({ secondReadText: withFile({ holdState: "HOLD" }) })],
    ["7-pr-cannot-clear-itself", input({ firstReadText: withFile({ holdState: "HOLD" }), secondReadText: withFile({ holdState: "HOLD" }) })],
    ["8-other-base", input({ identity: { repository: "o/r", prNumber: 7, headSha: HEAD, baseSha: OTHER } })],
    ["8-bad-head", input({ identity: { repository: "o/r", prNumber: 7, headSha: "nothex", baseSha: MAIN } })],
    ["8-bad-pr", input({ identity: { repository: "o/r", prNumber: 0, headSha: HEAD, baseSha: MAIN } })],
    ["9-stale-base", input({ mainHeadAtSecondRead: OTHER })],
    ["9-base-unknown", input({ auditedBase: "short" })],
    ["10-clear-after-first-block", input({ firstReadText: withFile({ holdState: "HOLD" }), secondReadText: cleanText })],
    ["12-worker-block", input({ worker: { reachable: true, decision: "BLOCK" } })]
  ];
  const rows = refusals.map(([name, i]) => {
    const r = decideRelease(i);
    return { name, expect: "BLOCK", got: r.decision, code: r.code, ok: r.decision === "BLOCK" };
  });
  for (const [name, i] of [["control-clear", input()], ["control-worker-unreachable", input({ worker: { reachable: false } })]]) {
    const r = decideRelease(i);
    rows.push({ name, expect: "CLEAR", got: r.decision, code: r.code, ok: r.decision === "CLEAR" });
  }
  return { rows, pass: rows.every((row) => row.ok) };
}

function main(argv) {
  const text = fs.readFileSync(argv[2], "utf8");
  const { rows, pass } = rehearse(text);
  for (const row of rows) console.log(`RELEASE_CONTROL_REHEARSAL case=${row.name} expect=${row.expect} got=${row.got} code=${row.code} ok=${row.ok}`);
  console.log(`RELEASE_CONTROL_REHEARSAL_RESULT ${pass ? "PASS" : "FAIL"} cases=${rows.length}`);
  return pass ? 0 : 1;
}

module.exports = { rehearse };
if (require.main === module) process.exitCode = main(process.argv);
