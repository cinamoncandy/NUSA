#!/usr/bin/env node
"use strict";
/**
 * Sanitizer for the automatic independent review (WO-OPS-20261114-INDEPENDENT-REVIEW-AUTOMATION, phase R2).
 *
 * The reviewer (a model) runs on the self-hosted runner that also holds the owner's ChatGPT login, and the repository is public.
 * A prompt-injected reviewer could try to print something it can read. So its output is never posted as written: it must match a
 * strict line grammar, it must carry the expected head sha, it is length-capped, and anything that looks like a credential, a
 * host path or a long opaque token rejects the WHOLE output (the caller then posts a fixed message with no content).
 *
 *   node scripts/independent-review-sanitize.js <expected-head-sha> <raw-file> <out-file>
 * exit 0: out-file holds the sanitized text. exit 2: out-file holds one fixed line "REVIEW_OUTPUT_REJECTED reason=<CODE>".
 */
const fs = require("node:fs");

const MAX_TOTAL = 12000;
const MAX_LINE = 500;
const MAX_LINES = 60;
const MAX_TOKEN = 56;
const VERDICTS = new Set(["ACCEPT", "ACCEPT WITH P2", "REJECT"]);
// Letters (any language), digits, space and a small punctuation set. No quotes, brackets, braces, angle brackets, backticks, dollar, backslash, pipe, equals, plus, hash.
const ALLOWED_TEXT = /^[\p{L}\p{N} .,:;()\-_/'?!%]*$/u;
const FORBIDDEN = [
  [/eyJ[A-Za-z0-9_-]{8,}/, "JWT_LIKE"],
  [/(?:sk|pk|ghp|gho|ghs|ghu|github_pat|xox[abprs]|AKIA|ASIA)[-_A-Za-z0-9]{10,}/i, "KEY_PREFIX"],
  [/BEGIN [A-Z ]*(?:KEY|CERTIFICATE)/, "PEM"],
  [/\.codex|auth\.json|authorization|bearer\s/i, "AUTH_FILE_OR_HEADER"],
  [/(?:^|[\s(])\/(?:home|root|etc|proc|var|opt|usr|tmp|run|mnt|srv)\b/, "HOST_PATH"],
  [/\b(?:token|secret|password|passwd|api[_ -]?key|credential)s?\b\s*[:=]/i, "SECRET_ASSIGNMENT"],
];

function reject(code) { return { ok: false, text: `REVIEW_OUTPUT_REJECTED reason=${code}\n`, reason: code }; }

function opaqueToken(text) {
  for (const token of text.split(/[\s/:,;()?!%']+/)) {
    if (token.length > MAX_TOKEN && /^[A-Za-z0-9_.-]+$/.test(token)) return true;
    if (token.length >= 24 && /[a-z]/.test(token) && /[A-Z]/.test(token) && (token.match(/\d/g) || []).length >= 2 && /^[A-Za-z0-9_-]+$/.test(token)) return true;
  }
  return false;
}

function sanitize(raw, expectedHead) {
  if (typeof raw !== "string" || raw.trim() === "") return reject("EMPTY");
  if (!/^[0-9a-f]{40}$/.test(String(expectedHead))) return reject("BAD_EXPECTED_HEAD");
  const text = raw.replace(/\r\n/g, "\n");
  if (text.length > MAX_TOTAL) return reject("TOO_LONG");
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > MAX_LINES) return reject("TOO_MANY_LINES");
  if (lines.length < 2) return reject("TOO_SHORT");
  const first = /^VERDICT: (ACCEPT WITH P2|ACCEPT|REJECT)$/.exec(lines[0]);
  if (first === null || !VERDICTS.has(first[1])) return reject("VERDICT_LINE");
  const head = /^HEAD: ([0-9a-f]{40})$/.exec(lines[1]);
  if (head === null) return reject("HEAD_LINE");
  if (head[1] !== expectedHead) return reject("HEAD_MISMATCH");
  const out = [lines[0], lines[1]];
  const severities = new Set();
  for (const line of lines.slice(2)) {
    if (line === "") { out.push(""); continue; }
    const match = /^(P0|P1|P2|NOTE|SCOPE): (.*)$/u.exec(line);
    if (match === null) return reject("LINE_GRAMMAR");
    const body = match[2];
    if (body.length === 0 || body.length > MAX_LINE) return reject("LINE_LENGTH");
    if (!ALLOWED_TEXT.test(body)) return reject("CHARSET");
    for (const [pattern, code] of FORBIDDEN) if (pattern.test(body)) return reject(code);
    if (opaqueToken(body)) return reject("OPAQUE_TOKEN");
    if (["P0", "P1", "P2"].includes(match[1])) severities.add(match[1]);
    out.push(line);
  }
  // The verdict must agree with the findings: a REJECT needs a P0 or P1, an ACCEPT must have none, ACCEPT WITH P2 needs a P2 and no P0 or P1.
  const verdict = first[1];
  const blocking = severities.has("P0") || severities.has("P1");
  if (verdict === "REJECT" && !blocking) return reject("VERDICT_WITHOUT_BLOCKER");
  if (verdict !== "REJECT" && blocking) return reject("BLOCKER_WITHOUT_REJECT");
  if (verdict === "ACCEPT WITH P2" && !severities.has("P2")) return reject("P2_VERDICT_WITHOUT_P2");
  if (verdict === "ACCEPT" && severities.size > 0) return reject("ACCEPT_WITH_FINDINGS");
  if (!out.some((line) => line.startsWith("SCOPE: "))) return reject("SCOPE_MISSING");
  return { ok: true, text: `${out.join("\n")}\n`, reason: "OK" };
}

module.exports = { sanitize, MAX_TOTAL, MAX_LINE, MAX_TOKEN };

if (require.main === module) {
  const [expectedHead, rawFile, outFile] = process.argv.slice(2);
  let raw = "";
  try { raw = fs.readFileSync(rawFile, "utf8"); } catch { raw = ""; }
  const result = sanitize(raw, expectedHead);
  fs.writeFileSync(outFile, result.text);
  process.exit(result.ok ? 0 : 2);
}
