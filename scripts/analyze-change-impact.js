#!/usr/bin/env node
"use strict";
/**
 * CLI for the change impact analyzer (WO-0037). Reads a real `git diff` between two
 * commits, builds a change set, and analyzes it. No network, no database.
 *
 * Usage:
 *   node scripts/analyze-change-impact.js --baseline <sha> --target <sha> \
 *        --change-request <change-request.json> --output <change-impact.json>
 *
 * Or, for a pre-built change set (used by fixtures and tests):
 *   node scripts/analyze-change-impact.js --change-set <change-set.json> --output <out.json>
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { analyzeChangeImpact } = require("./lib/change-impact-analyzer.js");
const { verifyChangeControlResult } = require("./lib/change-control-verifier.js");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) { args[argv[index].slice(2)] = argv[index + 1]; index += 1; }
  }
  return args;
}

const STATUS_MAP = { A: "ADDED", M: "MODIFIED", D: "DELETED", R: "RENAMED" };

function buildChangeSetFromGit(baseline, target, changeRequest) {
  const nameStatus = execFileSync("git", ["diff", "--name-status", `${baseline}..${target}`], { encoding: "utf8" });
  const changedFiles = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const statusCode = parts[0][0];
    const filePath = parts[parts.length - 1];
    const status = STATUS_MAP[statusCode] ?? "MODIFIED";

    let addedLines = [];
    let removedLines = [];
    if (status !== "DELETED") {
      const patch = execFileSync("git", ["diff", "--unified=0", `${baseline}..${target}`, "--", filePath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      for (const patchLine of patch.split("\n")) {
        if (patchLine.startsWith("+++") || patchLine.startsWith("---")) continue;
        if (patchLine.startsWith("+")) addedLines.push(patchLine.slice(1));
        else if (patchLine.startsWith("-")) removedLines.push(patchLine.slice(1));
      }
    }
    changedFiles.push({ path: filePath, status, addedLines, removedLines });
  }
  return {
    schemaVersion: 1,
    changeId: changeRequest.changeId,
    baselineCommitSha: execFileSync("git", ["rev-parse", baseline], { encoding: "utf8" }).trim(),
    targetCommitSha: execFileSync("git", ["rev-parse", target], { encoding: "utf8" }).trim(),
    changeRequest,
    changedFiles
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output || (!args["change-set"] && !(args.baseline && args.target && args["change-request"]))) {
    console.error("usage: node scripts/analyze-change-impact.js --baseline <sha> --target <sha> --change-request <cr.json> --output <out.json>");
    console.error("   or: node scripts/analyze-change-impact.js --change-set <change-set.json> --output <out.json>");
    process.exitCode = 1;
    return;
  }
  if (fs.existsSync(args.output)) {
    console.error(`refusing to overwrite existing output file: ${args.output}`);
    process.exitCode = 1;
    return;
  }

  const changeSet = args["change-set"]
    ? JSON.parse(fs.readFileSync(args["change-set"], "utf8"))
    : buildChangeSetFromGit(args.baseline, args.target, JSON.parse(fs.readFileSync(args["change-request"], "utf8")));

  console.log(`[change-impact] analyzing ${changeSet.changedFiles.length} changed file(s)`);
  const result = analyzeChangeImpact(changeSet);
  const verification = result.status === "FAIL" && result.changedFiles.length === 0
    ? { status: "SKIPPED_CHANGE_SET_INVALID", errors: [] }
    : verifyChangeControlResult(changeSet, result);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ result, verification }, null, 2));

  console.log(`[change-impact] risk: ${result.riskLevel ?? "n/a"}, decision: ${result.changeDecision}, verification: ${verification.status}`);
  for (const blocker of result.blockers ?? []) console.log(`[change-impact] BLOCKER: ${blocker}`);
  for (const warning of result.warnings ?? []) console.log(`[change-impact] WARNING: ${warning}`);

  if (result.status !== "PASS" || verification.status === "FAIL" || (result.blockers ?? []).length > 0) {
    process.exitCode = 1;
  }
}

main();
