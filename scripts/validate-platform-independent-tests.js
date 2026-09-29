#!/usr/bin/env node
"use strict";

/**
 * Catches, on any machine, the two ways a test passes on Linux and fails on the Windows CI shards.
 *
 * Both were hit for real on 2026-09-20, in consecutive pull requests, and together they accounted
 * for every repair round in that work. Neither is visible from a Linux container, so CI was the
 * only detector and each cost a full failed run plus a repair push.
 *
 * A. A test reads a repository file and matches patterns anchored on line structure. The Windows
 *    runner checks the repository out with CRLF, so `permissions:\n\s+contents: read` matches
 *    nothing and the file reads as one unmatchable blob.
 *
 * B. A test builds a git fixture without pinning core.autocrlf. A Windows runner has
 *    core.autocrlf=true globally, the fixture inherits it, and git rewrites LF to CRLF on
 *    checkout -- so content read back out of the fixture differs from what the test committed.
 *
 * Both rules are deliberately narrow: each needs two independent signals before it reports, so a
 * test that merely mentions a newline or merely runs git is not flagged.
 */

const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const ROOT = join(__dirname, "..");
// The override exists so the guard's own regression test can point it at a fixture directory.
const TEST_DIR = process.env.NUSA_TEST_DIR_OVERRIDE ?? join(ROOT, "tests");

/**
 * One file, and the reason is structural rather than a concession: the guard's own regression test
 * contains both hazardous and safe patterns as fixture text, because that is how it proves the
 * guard tells them apart. A scanner cannot distinguish a demonstration from live code, so this
 * file is skipped. `tests/platform-independent-test-guard.test.js` asserts this list stays at one
 * entry, so it cannot quietly become a place to park failures.
 */
const EXEMPT = Object.freeze(["tests/platform-independent-test-guard.test.js"]);

const NORMALISES_LINE_ENDINGS = [
  /\.replace\(\s*\/\\r\\n\/g/,          // .replace(/\r\n/g, "\n")
  /\.replace\(\s*\/\\r\/g/,             // .replace(/\r/g, "")
  /\\r\?\\n/,                            // split or match on /\r?\n/
  /\[\\r\\n\]/,                          // character class covering both
];
const READS_REPOSITORY_FILE = /readFileSync\s*\(\s*(join|resolve|path\.join|path\.resolve)\s*\(/;
/**
 * Finds the one hazardous shape, and deliberately nothing else.
 *
 * A `\n` in a pattern is usually fine against a CRLF file, because the `\n` of a `\r\n` pair is
 * still there to match. What breaks is a `\n` that the pattern requires to come immediately after
 * a concrete character:
 *
 *   /permissions:\n\s+contents: read/   the `:` must be followed by `\n`, but it is followed by
 *                                       `\r` -- this is the pattern that failed on the Windows
 *                                       shards on 2026-09-20
 *   /permissions:\s*\n\s*contents/      safe: `\s*` consumes the `\r`
 *   /[^\n]*\n/                          safe: a negated class matches `\r`
 *   /[\s\S]*?\n\}/                      safe for the same reason
 *   /\n\s*stream\.start/                safe: nothing is required before the newline
 *
 * So the report is limited to a `\n` preceded by something concrete. A quantifier, an alternation,
 * a group or class close, or the start of the pattern all mean something flexible comes first, and
 * none of those are reported. This errs toward missing a case rather than inventing one: a
 * validator that cries wolf gets switched off.
 */
const FLEXIBLE_BEFORE_NEWLINE = new Set(["*", "+", "?", ")", "]", "|", "("]);

function regexLiterals(source) {
  return source.match(/\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g) ?? [];
}

function requiresLiteralNewline(source) {
  for (const candidate of regexLiterals(source)) {
    // A `\n` inside a character class is never the hazard: `[^\n]` matches `\r` happily, and the
    // class itself is what precedes the newline in every real use. Classes are removed first so
    // the scan only sees newlines in the pattern's own sequence.
    const body = candidate.slice(1, candidate.lastIndexOf("/")).replace(/\[(?:\\.|[^\]\\])*\]/g, "\u0001");
    for (let index = body.indexOf("\\n"); index >= 0; index = body.indexOf("\\n", index + 2)) {
      if (index === 0) continue;
      if (index >= 2 && body.slice(index - 2, index) === "\\r") continue;
      const preceding = body[index - 1];
      if (preceding !== undefined && !FLEXIBLE_BEFORE_NEWLINE.has(preceding)) return true;
    }
  }
  return false;
}

const GIT_INIT_FIXTURE = /["']init["']/;
const RUNS_GIT = /(spawnSync|execFileSync|execSync|spawn)\s*\(\s*["']git["']/;
const PINS_AUTOCRLF = /core\.autocrlf/;

function testFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) { found.push(...testFiles(full)); continue; }
    if (/\.(test|vitest)\.(js|cjs|mjs)$/.test(entry)) found.push(full);
  }
  return found;
}

function findings() {
  const problems = [];
  for (const file of testFiles(TEST_DIR)) {
    const source = readFileSync(file, "utf8");
    const name = relative(ROOT, file).split("\\").join("/");
    if (EXEMPT.includes(name)) continue;
    const normalises = NORMALISES_LINE_ENDINGS.some((pattern) => pattern.test(source));

    if (READS_REPOSITORY_FILE.test(source) && requiresLiteralNewline(source) && !normalises) {
      problems.push({
        file: name,
        rule: "CRLF_BLIND_FILE_READ",
        detail: "reads a repository file and matches a pattern containing a literal \\n, without normalising line endings; a Windows checkout is CRLF",
        remedy: 'read it as `readFileSync(path, "utf8").replace(/\\r\\n/g, "\\n")`',
      });
    }

    if (RUNS_GIT.test(source) && GIT_INIT_FIXTURE.test(source) && !PINS_AUTOCRLF.test(source)) {
      problems.push({
        file: name,
        rule: "GIT_FIXTURE_INHERITS_AUTOCRLF",
        detail: "builds a git fixture without pinning core.autocrlf; a Windows runner sets it true globally and git rewrites content on checkout",
        remedy: 'configure the fixture with `git config core.autocrlf false` (and `core.eol lf`) right after init',
      });
    }
  }
  return problems;
}

const problems = findings();
if (problems.length === 0) {
  console.log("Platform-independent test validation passed.");
  process.exit(0);
}

console.error("Tests that pass on Linux and fail on the Windows CI shards:\n");
for (const problem of problems) {
  console.error(`  ${problem.file}`);
  console.error(`    ${problem.rule}: ${problem.detail}`);
  console.error(`    fix: ${problem.remedy}\n`);
}
process.exit(1);
