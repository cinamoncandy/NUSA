import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { auditWithRetry } = require("../scripts/security-gate-backports.js");
const source = fs.readFileSync("scripts/security-gate-backports.js", "utf8");

test("dependency audit retries transient availability failures and then succeeds", () => {
  let attempts = 0;
  const result = auditWithRetry(() => {
    attempts += 1;
    if (attempts < 3) throw new Error("AUDIT_UNAVAILABLE:23");
    return { advisories: {}, metadata: { vulnerabilities: {} } };
  }, { maxAttempts: 3, retryDelayMs: 0 });

  assert.equal(attempts, 3);
  assert.deepEqual(result, { advisories: {}, metadata: { vulnerabilities: {} } });
});

test("dependency audit remains fail-closed after bounded transient retries", () => {
  let attempts = 0;
  assert.throws(() => auditWithRetry(() => {
    attempts += 1;
    throw new Error("AUDIT_UNAVAILABLE:23");
  }, { maxAttempts: 3, retryDelayMs: 0 }), /AUDIT_UNAVAILABLE:23/);
  assert.equal(attempts, 3);
});

test("dependency audit never retries non-transient failures", () => {
  let attempts = 0;
  assert.throws(() => auditWithRetry(() => {
    attempts += 1;
    throw new Error("AUDIT_JSON_INCOMPLETE");
  }, { maxAttempts: 3, retryDelayMs: 0 }), /AUDIT_JSON_INCOMPLETE/);
  assert.equal(attempts, 1);
});

test("dependency audit attempts have an explicit wall-clock bound", () => {
  assert.match(source, /const AUDIT_ATTEMPT_TIMEOUT_MS = 120_000/);
  assert.match(source, /timeout: AUDIT_ATTEMPT_TIMEOUT_MS/);
  assert.match(source, /AUDIT_UNAVAILABLE:timeout/);
});
