#!/usr/bin/env node
"use strict";

// S2 shadow replacement for the Worker's /control-plane/release-check (docs/CLOUDFLARE_REMOVAL_S2_DESIGN_2026-11-19.md).
// Pure and fail-closed: it reads no network and writes nothing. The audit workflow gives it the text of config/release-control.json
// read from the AUDITED BASE sha (never the PR head) and the PR identity. The Worker stays authoritative; this only prints a decision to compare.

const KEYS = ["schemaVersion", "globalReleaseFreeze", "holdState", "liveAuthority", "productionMutationAllowed", "aiAuthority"];
const SHA = /^[0-9a-f]{40}$/i;

function block(code) {
  return Object.freeze({ decision: "BLOCK", code });
}

function evaluateReleaseControl(fileText, identity) {
  if (typeof fileText !== "string" || fileText.trim() === "") return block("FILE_UNREADABLE");
  let value;
  try { value = JSON.parse(fileText); } catch { return block("FILE_INVALID_JSON"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return block("FILE_NOT_OBJECT");
  const keys = Object.keys(value).sort();
  const expected = [...KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return block("FILE_KEYS_UNEXPECTED");
  if (value.schemaVersion !== 1) return block("SCHEMA_VERSION");
  if (value.liveAuthority !== "NONE" || value.productionMutationAllowed !== false || value.aiAuthority !== "ZERO_AUTHORITY") return block("SAFETY_FACT_MISMATCH");
  if (value.globalReleaseFreeze !== false) return block("GLOBAL_FREEZE_ACTIVE");
  if (value.holdState !== "NONE" && value.holdState !== "CLEARED") return block("HOLD_ACTIVE");
  const id = identity || {};
  if (typeof id.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(id.repository)) return block("IDENTITY_REPOSITORY");
  if (!Number.isSafeInteger(id.prNumber) || id.prNumber <= 0) return block("IDENTITY_PR");
  if (!SHA.test(String(id.headSha || "")) || !SHA.test(String(id.baseSha || ""))) return block("IDENTITY_SHA");
  return Object.freeze({ decision: "CLEAR", code: "RELEASE_CONTROL_CLEAR" });
}

module.exports = { evaluateReleaseControl, KEYS };

if (require.main === module) {
  const fs = require("node:fs");
  let text = "";
  try { text = fs.readFileSync(process.argv[2] || "", "utf8"); } catch { text = ""; }
  const result = evaluateReleaseControl(text, {
    repository: process.env.GITHUB_REPOSITORY,
    prNumber: Number(process.env.PR_NUMBER),
    headSha: process.env.EXPECTED_HEAD,
    baseSha: process.env.AUDITED_BASE,
  });
  console.log(`decision=${result.decision} code=${result.code}`);
  process.exit(result.decision === "CLEAR" ? 0 : 1);
}
