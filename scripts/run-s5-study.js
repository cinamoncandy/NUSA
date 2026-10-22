"use strict";
/**
 * Runner for the pre-registered study S5 (docs/research-ledger/PREREGISTERED_STUDY_S5_2026-10-22.md). Opens the PAPER host state database
 * READ-ONLY, reads the live books and the study archive as one source (as scripts/run-preregistered-studies.js) and prints one line per hypothesis:
 *   S5_STUDY {"study":"S5H"|"S5L","status":"WAITING_DATA"|"INSUFFICIENT_DATA"|"BOTH_TAILS_AMBIGUOUS"|"INCONCLUSIVE_DEPENDENCE"|"SIGNAL_NOT_FOUND"|
 *             "SIGNAL_EXISTS_NOT_TRADABLE"|"HOLDOUT_PASS"|"DATA_INTEGRITY_FAIL", ...numbers}
 * It refuses to run unless the S5 design file still hashes to S5_DESIGN_SHA256. It places no order and writes nothing; the result is research evidence.
 */
const { runImbalanceStudy, constants } = require("./lib/orderBookImbalanceStudy.js");
const { assertDesignFrozen, S5_DESIGN_FILE, S5_DESIGN_SHA256 } = require("./lib/preregisteredDesign.js");
const { makeDbProvider, bookSource } = require("./run-preregistered-studies.js");

const frozenS5 = () => assertDesignFrozen({ file: S5_DESIGN_FILE, expected: S5_DESIGN_SHA256 });

function runS5({ db, now = Date.now(), frozen = frozenS5 }) {
  frozen();
  const { TRAIN_START, HOLD_END, PRINT_AT, H } = constants;
  if (now < PRINT_AT) return ["S5H", "S5L"].map((study) => ({ study, status: "WAITING_DATA" }));
  // Any stored row stamped after the run time (beyond 5 s) means the clock or the source cannot be trusted.
  if (Number(db.prepare(`SELECT COUNT(*) AS n FROM ${bookSource(db)} WHERE captured_at_ms > ?`).get(now + 5_000).n) > 0) return ["S5H", "S5L"].map((study) => ({ study, status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" }));
  const provider = makeDbProvider(db, { from: TRAIN_START - H, to: HOLD_END + H });
  const results = runImbalanceStudy({ provider, now });
  const identity = provider.hashRows();
  return results.map((r) => ({ ...r, datasetSha256: identity.sha256, datasetRows: identity.rows }));
}

if (require.main === module) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const path = String(process.env.NUSA_CLOUD_STATE_DB_PATH || "");
    if (!path.startsWith("/")) throw new Error("state path");
    const db = new DatabaseSync(path, { readOnly: true });
    try { for (const result of runS5({ db })) console.log("S5_STUDY", JSON.stringify(result)); } finally { db.close(); }
  } catch { console.error("S5_STUDY_FAILED_CLOSED"); process.exitCode = 1; }
}

module.exports = { runS5 };
