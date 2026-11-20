#!/usr/bin/env node
"use strict";

// Cloudflare removal S3b preparation (docs/CLOUDFLARE_REMOVAL_S3_DESIGN_2026-11-20.md section 3): the pure decision of the future
// authoritative release-control gate, so the rehearsal cases can be tested offline BEFORE anything is switched.
// NOT WIRED into any workflow yet: the Worker stays authoritative, nothing here runs in the audit. It reads no network and writes nothing.
//
// Inputs (all read by the caller from the AUDITED BASE, never from the PR head; the PR head's copy of the file is deliberately not an input):
//   firstReadText / secondReadText  the text of config/release-control.json at the first and the second read
//   auditedBase                     the base sha the audit bound to
//   mainHeadAtSecondRead            the head sha of main at the second read
//   identity                        { repository, prNumber, headSha, baseSha } (baseSha must equal auditedBase)
//   worker                          { reachable: boolean, decision: "CLEAR" | "BLOCK" | other } (the reversed shadow after the switch)
// Every doubt blocks. The result carries the first blocking code or RELEASE_CONTROL_CLEAR and a `worker` note that can only block.

const { evaluateReleaseControl } = require("./release-control-check");

const SHA = /^[0-9a-f]{40}$/i;

function block(code, worker) {
  return Object.freeze({ decision: "BLOCK", code, worker });
}

// The file is flat (scalar values only), so every `"key":` occurrence is a top-level key. JSON.parse keeps the LAST duplicate, which could
// hide an earlier HOLD from another reader; the gate refuses any repeated key instead.
function hasDuplicateKey(text) {
  if (typeof text !== "string") return false;
  const seen = new Set();
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) {
    // Decode the key like JSON.parse does, so an escaped spelling (hold\u0053tate) counts as the same key.
    let key;
    try { key = JSON.parse(`"${match[1]}"`); } catch { return true; }
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function readDecision(text, identity) {
  return hasDuplicateKey(text) ? Object.freeze({ decision: "BLOCK", code: "FILE_DUPLICATE_KEY" }) : evaluateReleaseControl(text, identity);
}

function decideRelease(input) {
  const i = input || {};
  const identity = i.identity || {};
  const workerNote = i.worker && i.worker.reachable === true ? (i.worker.decision === "CLEAR" ? "WORKER_CLEAR" : "WORKER_BLOCK") : "WORKER_UNREACHABLE";
  if (typeof i.auditedBase !== "string" || !SHA.test(i.auditedBase) || typeof i.mainHeadAtSecondRead !== "string" || !SHA.test(i.mainHeadAtSecondRead)) return block("BASE_UNKNOWN", workerNote);
  if (typeof identity.baseSha !== "string" || identity.baseSha.toLowerCase() !== i.auditedBase.toLowerCase()) return block("IDENTITY_BASE_MISMATCH", workerNote);
  // Stale base: a HOLD or freeze merged to main after the PR's base would be invisible.
  if (i.auditedBase.toLowerCase() !== i.mainHeadAtSecondRead.toLowerCase()) return block("STALE_BASE", workerNote);
  const first = readDecision(i.firstReadText, identity);
  if (first.decision !== "CLEAR") return block(`FIRST_READ_${first.code}`, workerNote);
  const second = readDecision(i.secondReadText, identity);
  if (second.decision !== "CLEAR") return block(`SECOND_READ_${second.code}`, workerNote);
  // After the switch the Worker is only a reversed shadow: its HOLD also blocks (stricter), its silence or CLEAR never releases or blocks.
  if (workerNote === "WORKER_BLOCK") return block("WORKER_DISAGREES_BLOCK", workerNote);
  return Object.freeze({ decision: "CLEAR", code: "RELEASE_CONTROL_CLEAR", worker: workerNote });
}

module.exports = { decideRelease };
