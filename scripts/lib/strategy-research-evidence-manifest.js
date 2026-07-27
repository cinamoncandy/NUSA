"use strict";
/**
 * Strategy research evidence manifest (WO-0031).
 *
 * Loads, orders, and integrity-checks the research evidence a scorecard consumes. It
 * never recomputes a research result and never modifies one -- it only verifies that
 * what is claimed matches what is on disk and that every entry describes the same
 * strategy, dataset lineage, and execution assumptions.
 *
 * TRUST LEVELS are the point of this module. Evidence produced from invented candles
 * proves the implementation runs; it proves nothing about a market. VERIFIED_SYNTHETIC
 * can therefore support an implementation-correctness dimension but can never raise
 * confidence to HIGH and can never support a promotion decision.
 */
const fs = require("node:fs");
const path = require("node:path");
const { canonicalHash, sha256Hex } = require("./canonical-hash.js");

/** Canonical evidence order. Reported in this order regardless of input order. */
const EVIDENCE_ORDER = Object.freeze([
  "DATASET_QUALITY",
  "BACKTEST_BASELINE",
  "COST_STRESS",
  "WALK_FORWARD",
  "PARAMETER_ROBUSTNESS",
  "REGIME_ANALYSIS",
  "CROSS_MARKET_VALIDATION",
  "PAPER_OPERATIONAL_SAFETY"
]);

const TRUST_LEVELS = Object.freeze(["VERIFIED_REAL", "VERIFIED_SYNTHETIC", "UNVERIFIED_REAL", "MISSING", "INVALID"]);

function classifyTrust(entry) {
  if (entry == null) return "MISSING";
  if (entry.independentVerificationStatus === "FAIL") return "INVALID";
  if (entry.schemaVersion !== 1) return "INVALID";
  if (entry.dataProvenance === "SYNTHETIC_FIXTURE") {
    return entry.independentVerificationStatus === "PASS" ? "VERIFIED_SYNTHETIC" : "INVALID";
  }
  if (entry.dataProvenance === "REAL_MARKET_DATA") {
    return entry.independentVerificationStatus === "PASS" ? "VERIFIED_REAL" : "UNVERIFIED_REAL";
  }
  return "INVALID";
}

function validateEntry(entry, index) {
  const errors = [];
  const where = `evidence[${index}]${entry?.evidenceType ? ` (${entry.evidenceType})` : ""}`;
  if (!EVIDENCE_ORDER.includes(entry?.evidenceType)) errors.push(`${where}: unknown evidenceType`);
  for (const key of ["requestId", "resultPath", "requestSha256", "resultSha256", "strategyFingerprint", "sourceCommitSha"]) {
    if (typeof entry?.[key] !== "string" || entry[key].length === 0) errors.push(`${where}: ${key} must be a non-empty string`);
  }
  if (entry?.schemaVersion !== 1) errors.push(`${where}: unsupported schemaVersion`);
  if (!["PASS", "FAIL", "BLOCKED", "INVALID", "INCOMPLETE"].includes(entry?.executionStatus)) errors.push(`${where}: invalid executionStatus`);
  if (!["PASS", "FAIL", "NOT_RUN"].includes(entry?.independentVerificationStatus)) errors.push(`${where}: invalid independentVerificationStatus`);
  if (!["SYNTHETIC_FIXTURE", "REAL_MARKET_DATA"].includes(entry?.dataProvenance)) errors.push(`${where}: dataProvenance must be declared`);
  if (entry?.metrics != null && typeof entry.metrics !== "object") errors.push(`${where}: metrics must be an object when present`);
  return errors;
}

/**
 * @param {object} manifest {schemaVersion, evidence: [...]}
 * @param {object} [options] {evidenceRoot} -- when given, each entry's resultPath is
 *        read and re-hashed, so a claimed resultSha256 that does not match the file on
 *        disk is caught rather than trusted.
 */
function loadEvidenceManifest(manifest, options = {}) {
  const errors = [];
  if (manifest == null || typeof manifest !== "object") return { errors: ["manifest must be an object"], entries: [], byType: {} };
  if (manifest.schemaVersion !== 1) errors.push(`unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  if (!Array.isArray(manifest.evidence)) return { errors: [...errors, "manifest.evidence must be an array"], entries: [], byType: {} };

  const seen = new Map();
  manifest.evidence.forEach((entry, index) => {
    errors.push(...validateEntry(entry, index));
    if (!entry?.evidenceType) return;
    if (seen.has(entry.evidenceType)) {
      // Two results for one analysis: refuse rather than silently picking the better one.
      errors.push(`duplicate evidence for ${entry.evidenceType}: the request must name exactly one result per analysis, not the best of several`);
    }
    seen.set(entry.evidenceType, entry);
  });

  const entries = EVIDENCE_ORDER.map((evidenceType) => {
    const entry = seen.get(evidenceType);
    if (!entry) return { evidenceType, present: false, trust: "MISSING", entry: null, fileVerification: "NOT_CHECKED" };

    let fileVerification = "NOT_CHECKED";
    if (options.evidenceRoot) {
      const fullPath = path.join(options.evidenceRoot, entry.resultPath);
      if (!fs.existsSync(fullPath)) {
        fileVerification = "MISSING_FILE";
        errors.push(`${evidenceType}: declared resultPath does not exist under the evidence root`);
      } else {
        const actual = sha256Hex(fs.readFileSync(fullPath, "utf8"));
        if (actual !== entry.resultSha256) {
          fileVerification = "HASH_MISMATCH";
          errors.push(`${evidenceType}: resultSha256 does not match the file on disk (declared ${entry.resultSha256}, actual ${actual})`);
        } else {
          fileVerification = "HASH_MATCH";
        }
      }
    }

    return { evidenceType, present: true, trust: classifyTrust(entry), entry, fileVerification };
  });

  // Linkage: every present entry must describe the same strategy and commit.
  const fingerprints = new Set(entries.filter((e) => e.present).map((e) => e.entry.strategyFingerprint));
  if (fingerprints.size > 1) errors.push(`evidence spans multiple strategy fingerprints (${[...fingerprints].join(", ")}); results for different strategies cannot be combined`);
  const commits = new Set(entries.filter((e) => e.present).map((e) => e.entry.sourceCommitSha));
  if (commits.size > 1) errors.push(`evidence spans multiple source commits (${[...commits].join(", ")})`);

  for (const entry of entries) {
    if (entry.present && entry.entry.independentVerificationStatus === "FAIL") {
      errors.push(`${entry.evidenceType}: independent verification FAILED and cannot be ignored`);
    }
  }

  return {
    errors,
    entries,
    byType: Object.fromEntries(entries.map((entry) => [entry.evidenceType, entry])),
    manifestSha256: canonicalHash(entries.map((entry) => ({ evidenceType: entry.evidenceType, present: entry.present, trust: entry.trust, resultSha256: entry.entry?.resultSha256 ?? null })))
  };
}

module.exports = { loadEvidenceManifest, classifyTrust, EVIDENCE_ORDER, TRUST_LEVELS };
