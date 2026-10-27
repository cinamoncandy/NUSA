"use strict";
/**
 * Freeze mechanics of the pre-registered studies S2-S4 (docs/research-ledger/PREREGISTERED_STUDIES_2026-10-21.md, section "Freeze and
 * amendments"). DESIGN_SHA256 is the sha256 of the design file's exact bytes at the freeze commit; it is set in a commit AFTER the final
 * design commit (a file cannot contain its own hash). While it is PENDING the studies cannot run for a verdict. ADDENDA lists dated
 * clarifications, append-only; each file's sha256 is asserted too.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DESIGN_FILE = path.join(__dirname, "..", "..", "docs", "research-ledger", "PREREGISTERED_STUDIES_2026-10-21.md");
const DESIGN_SHA256 = "c5308ca4688f48848b585e1d6a7332c1af6025ceea0f472ae773ff3802fd00dc";
/** Study S5 (order-book imbalance, 15-minute horizon) is registered separately: its own design file, its own hash. */
const S5_DESIGN_FILE = path.join(__dirname, "..", "..", "docs", "research-ledger", "PREREGISTERED_STUDY_S5_2026-10-22.md");
const S5_DESIGN_SHA256 = "e64aeec4a7f8ad3c2ac42919c589550320ca0b31f5be994d98abba0df24a5575";
/** @type {ReadonlyArray<{ file: string, sha256: string, date: string }>} */
const ADDENDA = Object.freeze([]);

const sha256Bytes = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Throws unless the design file and every addendum still hash to their registered values. */
function assertDesignFrozen({ file = DESIGN_FILE, expected = DESIGN_SHA256, addenda = ADDENDA } = {}) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("DESIGN_NOT_FROZEN");
  const actual = sha256Bytes(file);
  if (actual !== expected) throw new Error("DESIGN_CHANGED");
  for (const a of addenda) if (sha256Bytes(path.join(path.dirname(DESIGN_FILE), a.file)) !== a.sha256) throw new Error("ADDENDUM_CHANGED");
  return { designSha256: actual, addenda: addenda.length };
}

module.exports = { DESIGN_FILE, DESIGN_SHA256, S5_DESIGN_FILE, S5_DESIGN_SHA256, ADDENDA, assertDesignFrozen, sha256Bytes };
