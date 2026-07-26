"use strict";
/**
 * Deterministic JSON canonicalization + SHA-256 hashing shared by the Walk-Forward
 * runner and its independent verifier. This is a serialization utility only -- the
 * actual domain verification logic (window recomputation, aggregate recomputation,
 * selection re-derivation) is deliberately NOT shared, so a bug in one side cannot
 * hide from the other.
 */
const { createHash } = require("node:crypto");

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
  return sorted;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalHash(value) {
  return sha256Hex(canonicalStringify(value));
}

module.exports = { canonicalize, canonicalStringify, sha256Hex, canonicalHash };
