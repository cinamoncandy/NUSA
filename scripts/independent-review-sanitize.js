#!/usr/bin/env node
"use strict";
/**
 * Checker and renderer for the automatic independent review (WO-OPS-20261114-INDEPENDENT-REVIEW-R2, review rounds 1 and 2).
 *
 * The reviewer is ONE model API completion call from a hosted job (scripts/independent-review-call.js): no tools, no files, and the API key is never in the
 * prompt, so there is nothing readable to smuggle out except the public diff itself. The text is still checked here (and again in the post job): it must match a
 * line grammar, carry the expected head sha, agree with its own findings, be length-capped, and contain no markup that could break out of the fenced block or
 * ping people. The public comment wraps the checked text in a fence.
 *
 *   node scripts/independent-review-sanitize.js check  <expected-head-sha> <raw-file> <out-file>   (call job: raw -> checked text)
 *   node scripts/independent-review-sanitize.js render <expected-head-sha> <checked-file> <out-md>  (post job: checked -> markdown)
 * exit 0: out-file written. exit 2: out-file holds the fixed line "REVIEW_OUTPUT_REJECTED reason=<CODE>" and nothing else.
 */
const fs = require("node:fs");

const MAX_TOTAL = 16000;
const MAX_LINE = 700;
const MAX_LINES = 60;
const VERDICTS = new Set(["ACCEPT", "ACCEPT WITH P2", "REJECT"]);
// Printable text; no backtick (fence breakout), no angle bracket (HTML), no control character. Unicode letters (Korean) are fine.
const FORBIDDEN_CHARS = /[`<>\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

function reject(code) { return { ok: false, text: `REVIEW_OUTPUT_REJECTED reason=${code}\n`, reason: code }; }

function check(raw, expectedHead) {
  if (typeof raw !== "string" || raw.trim() === "") return reject("EMPTY");
  if (!/^[0-9a-f]{40}$/.test(String(expectedHead))) return reject("BAD_EXPECTED_HEAD");
  const text = raw.replace(/\r\n/g, "\n");
  if (text.length > MAX_TOTAL) return reject("TOO_LONG");
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 3 || lines.length > MAX_LINES) return reject("LINE_COUNT");
  const verdict = /^VERDICT: (ACCEPT WITH P2|ACCEPT|REJECT)$/.exec(lines[0]);
  if (verdict === null || !VERDICTS.has(verdict[1])) return reject("VERDICT_LINE");
  const head = /^HEAD: ([0-9a-f]{40})$/.exec(lines[1]);
  if (head === null) return reject("HEAD_LINE");
  if (head[1] !== expectedHead) return reject("HEAD_MISMATCH");
  const severities = new Set();
  let scopeSeen = false;
  const out = [lines[0], lines[1]];
  for (const line of lines.slice(2)) {
    if (line === "") { out.push(""); continue; }
    const match = /^(P0|P1|P2|NOTE|SCOPE): (.+)$/u.exec(line);
    if (match === null) return reject("LINE_GRAMMAR");
    if (match[2].length > MAX_LINE) return reject("LINE_LENGTH");
    if (FORBIDDEN_CHARS.test(match[2])) return reject("FORBIDDEN_CHAR");
    if (["P0", "P1", "P2"].includes(match[1])) severities.add(match[1]);
    if (match[1] === "SCOPE") scopeSeen = true;
    out.push(line);
  }
  const blocking = severities.has("P0") || severities.has("P1");
  if (verdict[1] === "REJECT" && !blocking) return reject("VERDICT_WITHOUT_BLOCKER");
  if (verdict[1] !== "REJECT" && blocking) return reject("BLOCKER_WITHOUT_REJECT");
  if (verdict[1] === "ACCEPT WITH P2" && !severities.has("P2")) return reject("P2_VERDICT_WITHOUT_P2");
  if (verdict[1] === "ACCEPT" && severities.size > 0) return reject("ACCEPT_WITH_FINDINGS");
  if (!scopeSeen) return reject("SCOPE_MISSING");
  return { ok: true, text: `${out.join("\n")}\n`, reason: "OK" };
}

/** Markdown for the comment: the checked text inside a fence that the text cannot close (it contains no backtick). */
function render(checkedText, expectedHead) {
  const result = check(checkedText, expectedHead);
  if (!result.ok) return result;
  return { ok: true, text: `\`\`\`\`\`text\n${result.text}\`\`\`\`\`\n`, reason: "OK" };
}

module.exports = { check, render, MAX_TOTAL, MAX_LINE, MAX_LINES };

if (require.main === module) {
  const [mode, expectedHead, inFile, outFile] = process.argv.slice(2);
  let input = "";
  try { input = fs.readFileSync(inFile, "utf8"); } catch { input = ""; }
  const result = mode === "render" ? render(input, expectedHead) : mode === "check" ? check(input, expectedHead) : reject("BAD_MODE");
  fs.writeFileSync(outFile, result.text);
  process.exit(result.ok ? 0 : 2);
}
