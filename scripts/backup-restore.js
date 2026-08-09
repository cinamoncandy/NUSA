#!/usr/bin/env node
"use strict";

const securityGate = require("./security-gate.js");

const AUTHORIZATION_ASSIGNMENT = /(?:^|[\s,{;])(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?:\.\s*authorization|\[\s*["']authorization["']\s*\])|["']?authorization["']?)\s*(?::|=)\s*(?<credential>"[^"\r\n]*"|'[^'\r\n]*'|[^,}\];)\r\n]*)/gi;
const AUTHORIZATION_PAIR = /(?:^|\[|,)\s*["']authorization["']\s*,\s*(?<credential>"[^"\r\n]*"|'[^'\r\n]*'|[^,}\];)\r\n]*)/gi;
const AUTHORIZATION_SETTER = /\.\s*(?:set|append|setHeader|appendHeader|setRequestHeader)\s*\(\s*["']authorization["']\s*,\s*(?<credential>"[^"\r\n]*"|'[^'\r\n]*'|[^,}\];)\r\n]*)/gi;

function authorizationCredential(match) {
  if (!match) return undefined;
  const raw = String(match.groups?.credential ?? "").trim();
  const quoted = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));
  if (quoted) {
    const value = raw.slice(1, -1).trim();
    return value || undefined;
  }
  if (!raw || /^(?:null|undefined)$/i.test(raw)) return undefined;
  return raw;
}

function expressionHasAuthorizationCredential(expression, normalized) {
  const matcher = new RegExp(expression.source, expression.flags);
  for (const match of normalized.matchAll(matcher)) {
    if (authorizationCredential(match) !== undefined) return true;
  }
  return false;
}

function hasAuthorizationCredential(value) {
  const normalized = String(value ?? "").replace(/\\(["'])/g, "$1");
  return [AUTHORIZATION_ASSIGNMENT, AUTHORIZATION_PAIR, AUTHORIZATION_SETTER]
    .some((expression) => expressionHasAuthorizationCredential(expression, normalized));
}

const originalScanText = securityGate.scanText;
securityGate.scanText = (value, file = "<text>") => {
  const findings = originalScanText(value, file);
  if (hasAuthorizationCredential(value)) findings.push({ file, line: 0, rule: "AUTHORIZATION_CREDENTIAL" });
  return findings;
};
const core = require("./backup-restore-core.js");
securityGate.scanText = originalScanText;

function parseArgs(argv) {
  const args = { include: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--include") args.include.push(argv[++i]);
    else if (value.startsWith("--")) args[value.slice(2)] = argv[++i] ?? true;
    else if (!args.command) args.command = value;
    else throw new Error(`unexpected argument: ${value}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "backup") {
    const result = core.createBackup(args);
    console.log(JSON.stringify({ status: "PASS", mode: "BACKUP_COPY_ONLY", snapshot: result.snapshot, artifactCount: result.manifest.entries.length, secretExcludedCount: result.manifest.secretExcludedCount, productionMutationAllowed: false }, null, 2));
    return;
  }
  if (args.command === "verify") {
    const result = core.readAndVerify(args.snapshot);
    console.log(JSON.stringify({ status: "PASS", mode: "VERIFY_ONLY", snapshotId: result.manifest.snapshotId, artifactCount: result.manifest.entries.length, manifestSha256: result.manifestSha256, productionMutationAllowed: false }, null, 2));
    return;
  }
  if (args.command === "drill") {
    console.log(JSON.stringify(core.runDrill(args), null, 2));
    return;
  }
  if (args.command === "restore") throw new Error("destructive restore is intentionally unsupported; use the verify-only drill command");
  throw new Error("usage: backup-restore.js <backup|verify|drill> [options]");
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`[backup-restore] ${error instanceof Error ? error.message : "recovery operation failed"}`);
    process.exitCode = 1;
  }
}

module.exports = core;
