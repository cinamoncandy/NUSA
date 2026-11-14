#!/usr/bin/env node
"use strict";
/**
 * Validator and renderer for the automatic independent review (WO-OPS-20261114-INDEPENDENT-REVIEW-R2, review round 1).
 *
 * The repository is PUBLIC and the reviewer runs on the self-hosted runner that also holds the owner's ChatGPT login. A regex filter over free text
 * cannot prove that nothing readable on that runner is smuggled out (review of PR 3126: REJECT). So NO model-written sentence is ever published.
 * The reviewer may only emit a fixed record: a verdict, the expected head sha, a coverage flag and up to 12 findings of the form
 * `FINDING: <severity> <CATEGORY> <path>` where CATEGORY is from a fixed list and path must be a file in the PR's changed-file list (taken from the
 * GitHub API by trusted code, never from the model). Findings are de-duplicated and sorted by trusted code, line numbers do not exist, and the public text
 * is rendered here from fixed sentences. What is left as a channel is the choice of a few (file, category, severity) tuples, a few bytes at most.
 * The same validation runs again in the post job on the uploaded file.
 *
 *   node scripts/independent-review-sanitize.js check  <expected-head-sha> <changed-files.txt> <raw-file> <out-file>   (runner: raw -> reduced record)
 *   node scripts/independent-review-sanitize.js render <expected-head-sha> <changed-files.txt> <reduced-file> <out-md>  (post job: reduced -> markdown)
 * exit 0: out-file written. exit 2: out-file holds the fixed line "REVIEW_OUTPUT_REJECTED reason=<CODE>" and nothing else.
 */
const fs = require("node:fs");

const MAX_TOTAL = 4000;
const MAX_FINDINGS = 12;
const MAX_PATH = 200;
const VERDICTS = new Set(["ACCEPT", "ACCEPT WITH P2", "REJECT"]);
const SEVERITIES = ["P0", "P1", "P2"];
const CATEGORIES = Object.freeze({
  AUTHORITY_OR_GATE_CHANGE: "A change adds authority or changes a gate or required check (권한 또는 게이트 변경)",
  SAFETY_RULE_LOOSENED: "A safety rule, limit, threshold or validator may be loosened (안전 규칙 완화 가능성)",
  CORRECTNESS_BUG: "A correctness bug is suspected (정확성 오류 의심)",
  SECURITY_EXPOSURE: "A security or exposure risk is suspected (보안 노출 위험 의심)",
  UNSUPPORTED_CLAIM: "A claim in text or description is not supported by the code (근거 없는 주장)",
  MISSING_TEST: "An important path appears untested (중요 경로의 테스트 부족)",
  DOC_INACCURACY: "A document or comment is inaccurate (문서 또는 주석 부정확)",
  OTHER: "Another point to look at (기타 확인 필요)",
});
const PATH_PATTERN = /^[A-Za-z0-9_./-]+$/;

function reject(code) { return { ok: false, text: `REVIEW_OUTPUT_REJECTED reason=${code}\n`, reason: code }; }

function parseChangedFiles(text) {
  const files = new Set();
  for (const line of String(text).split("\n")) {
    const name = line.trim();
    // Plain repository-relative names only: no absolute path, no traversal segment, no space or other character outside the pattern.
    if (name !== "" && name.length <= MAX_PATH && PATH_PATTERN.test(name) && !name.startsWith("/") && !name.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) files.add(name);
  }
  return files;
}

/** Strict parse of a record (raw model output or an already reduced record) against the expected head and the changed-file set. */
function parseRecord(raw, expectedHead, changedFiles) {
  if (typeof raw !== "string" || raw.trim() === "") return reject("EMPTY");
  if (!/^[0-9a-f]{40}$/.test(String(expectedHead))) return reject("BAD_EXPECTED_HEAD");
  if (!(changedFiles instanceof Set) || changedFiles.size === 0) return reject("NO_CHANGED_FILES");
  const text = raw.replace(/\r\n/g, "\n");
  if (text.length > MAX_TOTAL) return reject("TOO_LONG");
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 3 || lines.length > 3 + MAX_FINDINGS) return reject("LINE_COUNT");
  const verdict = /^VERDICT: (ACCEPT WITH P2|ACCEPT|REJECT)$/.exec(lines[0]);
  if (verdict === null || !VERDICTS.has(verdict[1])) return reject("VERDICT_LINE");
  const head = /^HEAD: ([0-9a-f]{40})$/.exec(lines[1]);
  if (head === null) return reject("HEAD_LINE");
  if (head[1] !== expectedHead) return reject("HEAD_MISMATCH");
  const coverage = /^COVERAGE: (FULL|PARTIAL)$/.exec(lines[2]);
  if (coverage === null) return reject("COVERAGE_LINE");
  const unique = new Map();
  for (const line of lines.slice(3)) {
    const match = /^FINDING: (P0|P1|P2) ([A-Z_]+) ([A-Za-z0-9_./-]+)$/.exec(line);
    if (match === null) return reject("FINDING_GRAMMAR");
    const [, severity, category, file] = match;
    if (!Object.prototype.hasOwnProperty.call(CATEGORIES, category)) return reject("CATEGORY");
    if (file.length > MAX_PATH || !changedFiles.has(file)) return reject("PATH_NOT_CHANGED");
    unique.set(`${severity} ${category} ${file}`, { severity, category, file });
  }
  const findings = [...unique.values()].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.category.localeCompare(b.category) || a.file.localeCompare(b.file));
  const blocking = findings.some((f) => f.severity !== "P2");
  const hasP2 = findings.some((f) => f.severity === "P2");
  if (verdict[1] === "REJECT" && !blocking) return reject("VERDICT_WITHOUT_BLOCKER");
  if (verdict[1] !== "REJECT" && blocking) return reject("BLOCKER_WITHOUT_REJECT");
  if (verdict[1] === "ACCEPT WITH P2" && !hasP2) return reject("P2_VERDICT_WITHOUT_P2");
  if (verdict[1] === "ACCEPT" && findings.length > 0) return reject("ACCEPT_WITH_FINDINGS");
  return { ok: true, verdict: verdict[1], head: head[1], coverage: coverage[1], findings };
}

function reducedText(record) {
  return `${[`VERDICT: ${record.verdict}`, `HEAD: ${record.head}`, `COVERAGE: ${record.coverage}`, ...record.findings.map((f) => `FINDING: ${f.severity} ${f.category} ${f.file}`)].join("\n")}\n`;
}

function renderMarkdown(record) {
  const lines = [`Verdict: **${record.verdict}** (coverage: ${record.coverage === "FULL" ? "full" : "PARTIAL: not everything could be judged"})`, ""];
  if (record.findings.length === 0) lines.push("No finding was reported.");
  else {
    lines.push("| Level | What | File |", "| --- | --- | --- |");
    for (const f of record.findings) lines.push(`| ${f.severity} | ${CATEGORIES[f.category]} | ${f.file} |`);
  }
  lines.push("", "These are pointers produced by an automatic reviewer. The text above is fixed wording chosen by the checking code, not the reviewer's own sentences. Details need the manual review.");
  return `${lines.join("\n")}\n`;
}

function check(raw, expectedHead, changedFiles) {
  const record = parseRecord(raw, expectedHead, changedFiles);
  return record.ok ? { ok: true, text: reducedText(record), reason: "OK", record } : record;
}

function render(reduced, expectedHead, changedFiles) {
  const record = parseRecord(reduced, expectedHead, changedFiles);
  return record.ok ? { ok: true, text: renderMarkdown(record), reason: "OK", record } : record;
}

module.exports = { check, render, parseRecord, parseChangedFiles, reducedText, renderMarkdown, CATEGORIES, MAX_TOTAL, MAX_FINDINGS };

if (require.main === module) {
  const [mode, expectedHead, filesFile, inFile, outFile] = process.argv.slice(2);
  let input = ""; let filesText = "";
  try { input = fs.readFileSync(inFile, "utf8"); } catch { input = ""; }
  try { filesText = fs.readFileSync(filesFile, "utf8"); } catch { filesText = ""; }
  const files = parseChangedFiles(filesText);
  const result = mode === "render" ? render(input, expectedHead, files) : mode === "check" ? check(input, expectedHead, files) : reject("BAD_MODE");
  fs.writeFileSync(outFile, result.text);
  process.exit(result.ok ? 0 : 2);
}
