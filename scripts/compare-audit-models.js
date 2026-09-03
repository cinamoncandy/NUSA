"use strict";

// Offline harness for NUSA issue #1545:
// evaluate a candidate Workers AI Audit model against the current default
// WITHOUT touching the live Audit path.
//
// Mirrors apps/autopilot/src/auditRunner.ts bounds:
//   DEFAULT_AUDIT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast"
//   MAX_DIFF_CHARS = 180_000, MAX_CHANGED_FILES = 300,
//   verdicts PASS | PASS_WITH_NOTES | FAIL, MAX_FINDINGS/BLOCKERS = 40.
//
// Modes:
//   validate-corpus --corpus <dir>            shape-check saved PR diffs
//   compare --corpus <dir> --candidate-verdicts <json>
//                                            agreement metrics vs baseline
//   collect --repo <o/r> --prs 1,2,3 --out <dir>
//                                            fetch exact diffs via gh (read-only)
//
// Corpus entry (*.json): { prNumber, headSha, baseSha, changedFiles,
//   diff, baselineVerdict? }
// Candidate verdicts file: { "<prNumber>": { verdict, findings, blockers,
//   safetyInvariantResult, evidenceRefs } }
//
// This script never calls Workers AI and never changes wrangler.jsonc.
// Safety invariants unaffected: liveAuthority=NONE,
// productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MAX_DIFF_CHARS = 180_000;
const MAX_CHANGED_FILES = 300;
const MAX_FINDINGS = 40;
const MAX_BLOCKERS = 40;
const VERDICTS = ["PASS", "PASS_WITH_NOTES", "FAIL"];
const SHA40 = /^[0-9a-f]{40}$/;

function countDiffFiles(diff) {
  return (diff.match(/^diff --git /gm) ?? []).length;
}

function validateDiffEntry(entry) {
  const failures = [];
  if (!entry || typeof entry !== "object") return { ok: false, failures: ["ENTRY_NOT_OBJECT"], stats: null };
  if (!Number.isInteger(entry.prNumber) || entry.prNumber <= 0) failures.push("PR_NUMBER_INVALID");
  if (typeof entry.headSha !== "string" || !SHA40.test(entry.headSha)) failures.push("HEAD_SHA_INVALID");
  if (typeof entry.baseSha !== "string" || !SHA40.test(entry.baseSha)) failures.push("BASE_SHA_INVALID");
  if (!Number.isInteger(entry.changedFiles) || entry.changedFiles < 1 || entry.changedFiles > MAX_CHANGED_FILES) {
    failures.push("CHANGED_FILES_OUT_OF_RANGE");
  }
  if (typeof entry.diff !== "string" || entry.diff.trim().length === 0) {
    failures.push("AUDIT_DIFF_EMPTY");
    return { ok: false, failures, stats: null };
  }
  if (entry.diff.length > MAX_DIFF_CHARS) failures.push("AUDIT_DIFF_TOO_LARGE");
  const observed = countDiffFiles(entry.diff);
  if (Number.isInteger(entry.changedFiles) && observed !== entry.changedFiles) {
    failures.push("AUDIT_DIFF_FILE_COUNT_MISMATCH");
  }
  const stats = { diffChars: entry.diff.length, fileCount: observed };
  return { ok: failures.length === 0, failures, stats };
}

function validateVerdict(v) {
  const failures = [];
  if (!v || typeof v !== "object") return { ok: false, failures: ["VERDICT_NOT_OBJECT"], mergeAllowed: false };
  if (!VERDICTS.includes(v.verdict)) failures.push("AUDIT_VERDICT_INVALID");
  if (!Array.isArray(v.findings)) failures.push("FINDINGS_NOT_ARRAY");
  else if (v.findings.length > MAX_FINDINGS) failures.push("MAX_FINDINGS_EXCEEDED");
  const blockers = Array.isArray(v.blockers) ? v.blockers : null;
  if (!blockers) failures.push("BLOCKERS_NOT_ARRAY");
  else if (blockers.length > MAX_BLOCKERS) failures.push("MAX_BLOCKERS_EXCEEDED");
  if (!v.safetyInvariantResult || typeof v.safetyInvariantResult !== "object") {
    failures.push("SAFETY_RESULT_MISSING");
  }
  if (v.evidenceRefs !== undefined && (!Array.isArray(v.evidenceRefs) || v.evidenceRefs.length > 3)) {
    failures.push("EVIDENCE_REFS_INVALID");
  }
  const safetyPass = v.safetyInvariantResult?.result === "PASS";
  const mergeAllowed = v.verdict === "PASS" && safetyPass && (blockers?.length ?? 1) === 0;
  return { ok: failures.length === 0, failures, mergeAllowed };
}

function compareVerdicts(entries) {
  // entries: [{ prNumber, baseline, candidate }] with validated verdicts
  const matrix = { PASS: { PASS: 0, PASS_WITH_NOTES: 0, FAIL: 0 }, PASS_WITH_NOTES: { PASS: 0, PASS_WITH_NOTES: 0, FAIL: 0 }, FAIL: { PASS: 0, PASS_WITH_NOTES: 0, FAIL: 0 } };
  let mergeParity = 0;
  let baselineFail = 0;
  let candidateCaughtFail = 0;
  let falsePass = 0;
  for (const { baseline, candidate } of entries) {
    matrix[baseline.verdict][candidate.verdict] += 1;
    const bMerge = validateVerdict(baseline).mergeAllowed;
    const cMerge = validateVerdict(candidate).mergeAllowed;
    if (bMerge === cMerge) mergeParity += 1;
    if (baseline.verdict === "FAIL") {
      baselineFail += 1;
      if (candidate.verdict === "FAIL") candidateCaughtFail += 1;
    }
    if (baseline.verdict === "FAIL" && candidate.verdict === "PASS") falsePass += 1;
  }
  const n = entries.length;
  const agree = n === 0 ? 0 : (matrix.PASS.PASS + matrix.PASS_WITH_NOTES.PASS_WITH_NOTES + matrix.FAIL.FAIL) / n;
  return {
    n,
    agreementRate: agree,
    confusionMatrix: matrix,
    failRecall: baselineFail === 0 ? null : candidateCaughtFail / baselineFail,
    falsePassCount: falsePass,
    mergeAllowedParity: n === 0 ? 0 : mergeParity / n,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function cmdValidateCorpus(corpusDir) {
  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error("CORPUS_EMPTY");
  let okCount = 0;
  let oversize = 0;
  let totalChars = 0;
  for (const f of files) {
    const entry = readJson(path.join(corpusDir, f));
    const r = validateDiffEntry(entry);
    totalChars += r.stats?.diffChars ?? 0;
    if (!r.ok) {
      if (r.failures.includes("AUDIT_DIFF_TOO_LARGE")) oversize += 1;
      console.log(`FAIL pr=${entry.prNumber ?? f}: ${r.failures.join(",")}`);
    } else {
      okCount += 1;
      if (entry.baselineVerdict) {
        const vr = validateVerdict(entry.baselineVerdict);
        if (!vr.ok) console.log(`FAIL pr=${entry.prNumber}: baseline verdict ${vr.failures.join(",")}`);
      }
    }
  }
  console.log(JSON.stringify({ files: files.length, valid: okCount, oversizeWouldReject: oversize, totalChars }, null, 2));
  if (okCount !== files.length) process.exitCode = 1;
}

function cmdCompare(corpusDir, candidateFile) {
  const candidates = readJson(candidateFile);
  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".json")).sort();
  const pairs = [];
  for (const f of files) {
    const entry = readJson(path.join(corpusDir, f));
    const baseline = entry.baselineVerdict;
    const candidate = candidates[String(entry.prNumber)];
    if (!baseline || !candidate) {
      console.log(`SKIP pr=${entry.prNumber}: missing baseline or candidate verdict`);
      continue;
    }
    const bv = validateVerdict(baseline);
    const cv = validateVerdict(candidate);
    if (!bv.ok || !cv.ok) {
      console.log(`SKIP pr=${entry.prNumber}: invalid verdict schema`);
      continue;
    }
    pairs.push({ baseline, candidate });
  }
  if (pairs.length === 0) throw new Error("NO_COMPARABLE_PAIRS");
  console.log(JSON.stringify(compareVerdicts(pairs), null, 2));
}

function cmdCollect(repo, prList, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const pr of prList) {
    const meta = spawnSync("gh", ["api", `repos/${repo}/pulls/${pr}`, "--jq", "{head: .head.sha, base: .base.sha, files: .changed_files}"], { encoding: "utf8" });
    if (meta.status !== 0) throw new Error(`GH_META_FAILED_PR_${pr}: ${meta.stderr.trim()}`);
    const { head, base, files } = JSON.parse(meta.stdout);
    const diff = spawnSync("gh", ["api", `repos/${repo}/pulls/${pr}`, "-H", "Accept: application/vnd.github.v3.diff"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (diff.status !== 0) throw new Error(`GH_DIFF_FAILED_PR_${pr}: ${diff.stderr.trim()}`);
    const entry = { prNumber: pr, headSha: head, baseSha: base, changedFiles: files, diff: diff.stdout };
    const check = validateDiffEntry(entry);
    if (!check.ok) console.log(`WARN pr=${pr}: ${check.failures.join(",")} (saved anyway for boundary analysis)`);
    fs.writeFileSync(path.join(outDir, `pr-${pr}.json`), JSON.stringify(entry));
    console.log(`saved pr=${pr} chars=${entry.diff.length} files=${check.stats?.fileCount ?? "?"}`);
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const [mode] = args._;
  if (mode === "validate-corpus") {
    if (!args.corpus) throw new Error("MISSING_--corpus");
    cmdValidateCorpus(args.corpus);
  } else if (mode === "compare") {
    if (!args.corpus || !args["candidate-verdicts"]) throw new Error("MISSING_--corpus_OR_--candidate-verdicts");
    cmdCompare(args.corpus, args["candidate-verdicts"]);
  } else if (mode === "collect") {
    if (!args.repo || !args.prs || !args.out) throw new Error("MISSING_--repo_--prs_--out");
    cmdCollect(args.repo, args.prs.split(",").map((s) => Number(s.trim())), args.out);
  } else {
    throw new Error("UNKNOWN_MODE: use validate-corpus|compare|collect");
  }
}

module.exports = { MAX_DIFF_CHARS, MAX_CHANGED_FILES, VERDICTS, countDiffFiles, validateDiffEntry, validateVerdict, compareVerdicts };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`compare-audit-models: ${err.message}`);
    process.exitCode = 1;
  }
}
