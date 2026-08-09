#!/usr/bin/env node
"use strict";

const PLACEHOLDERS = new Set([
  "",
  "[redacted]",
  "redacted",
  "change-me",
  "example",
  "example-key",
  "not-configured",
  "secret-key",
  "test",
  "testing",
  "undefined",
  "unknown"
]);

const TOKEN_PREFIX = /\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{16,}/gi;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi;
const CLOUD_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const AUTHORIZATION_VALUE = /(\bauthorization\b\s*["']?\s*[:=]\s*["']?(?:bearer\s+)?)([^"'\s,}]{16,})/gi;
const BARE_BEARER = /(\bbearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi;
const CREDENTIAL_ASSIGNMENT = /(\b(?:access[_-]?key|api[_-]?key|client[_-]?secret|password|passwd|secret[_-]?key|token)\b\s*["']?\s*[:=]\s*["']?)([^"'\s,}]{8,})/gi;
const AUTHORIZATION_REDACTION = /(\bauthorization\b\s*["']?\s*[:=]\s*["']?(?:bearer\s+)?)([^"'\s,}]+)/gi;
const BARE_BEARER_REDACTION = /(\bbearer\s+)([A-Za-z0-9._~+/=-]+)/gi;
const CREDENTIAL_REDACTION = /(\b(?:access[_-]?key|api[_-]?key|client[_-]?secret|password|passwd|secret[_-]?key|token)\b\s*["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi;

function normalizedCandidate(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isPlaceholder(value) {
  return PLACEHOLDERS.has(normalizedCandidate(value));
}

function addMatches(findings, text, id, expression, capture = 0) {
  expression.lastIndex = 0;
  for (const match of text.matchAll(expression)) {
    const candidate = match[capture] ?? match[0];
    if (isPlaceholder(candidate)) continue;
    findings.push(Object.freeze({ rule: id, index: match.index ?? -1 }));
  }
}

function scanSecretText(value) {
  const text = String(value ?? "");
  const findings = [];
  addMatches(findings, text, "PRIVATE_KEY", PRIVATE_KEY_BLOCK);
  addMatches(findings, text, "CLOUD_ACCESS_KEY", CLOUD_ACCESS_KEY);
  addMatches(findings, text, "TOKEN_PREFIX", TOKEN_PREFIX);
  addMatches(findings, text, "JWT_VALUE", JWT_VALUE);
  addMatches(findings, text, "AUTHORIZATION_VALUE", AUTHORIZATION_VALUE, 2);
  addMatches(findings, text, "BARE_BEARER", BARE_BEARER, 2);
  addMatches(findings, text, "CREDENTIAL_ASSIGNMENT", CREDENTIAL_ASSIGNMENT, 2);
  return Object.freeze(findings);
}

function scanSecretBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return scanSecretText(bytes.toString("utf8"));
}

function redactSecretText(value) {
  let safe = String(value ?? "");
  safe = safe.replace(PRIVATE_KEY_BLOCK, "[REDACTED_PRIVATE_KEY]");
  safe = safe.replace(AUTHORIZATION_REDACTION, "$1[REDACTED]");
  safe = safe.replace(BARE_BEARER_REDACTION, "$1[REDACTED]");
  safe = safe.replace(CREDENTIAL_REDACTION, "$1[REDACTED]");
  safe = safe.replace(TOKEN_PREFIX, "[REDACTED_TOKEN]");
  safe = safe.replace(JWT_VALUE, "[REDACTED_JWT]");
  safe = safe.replace(CLOUD_ACCESS_KEY, "[REDACTED_ACCESS_KEY]");
  return safe;
}

function assertSecretFree(value, label = "content") {
  const findings = Buffer.isBuffer(value) || value instanceof Uint8Array ? scanSecretBytes(value) : scanSecretText(value);
  if (findings.length > 0) throw new Error(`${label} contains secret material: ${[...new Set(findings.map((item) => item.rule))].join(",")}`);
}

module.exports = { assertSecretFree, redactSecretText, scanSecretBytes, scanSecretText };
