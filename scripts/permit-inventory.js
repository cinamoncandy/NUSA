"use strict";
// READ-ONLY inventory for the permit producer design (docs/NUSA_PERMIT_PRODUCER_DESIGN_V2_2026-11-17.md, section 4).
// It opens the state database read-only and prints, as JSON, which of the tables the design asks about exist and how many rows they hold:
// research candidates and experiments, the calibration and outcome-attribution samples of the probability engine, futures data (the
// regime signals the design says nothing produces today), order-book and trade-tick samples, and the permit-related stores. It writes
// nothing, opens no network connection, prints no row content and no secret, and changes no state. Run on the host as the service user:
//   node scripts/permit-inventory.js /var/lib/nusa/state.sqlite
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

// Fixed allow-list: nothing outside it is ever queried, so the file path argument cannot widen what is read.
const TABLES = Object.freeze({
  models_and_samples: ["ai_calibration_durability_events", "ai_outcome_attribution_memory_events", "ai_evaluation_records", "evaluation_traces"],
  research: ["research_candidates", "research_experiment_records", "research_evaluation_ledger", "research_holdout_usage", "research_promotion_audit", "research_champion_pointer", "champion_assignments"],
  market_data: ["research_closed_candles", "research_orderbook_samples", "research_trade_ticks_v2", "paper_public_market_observations"],
  futures_data: ["research_futures_klines", "research_futures_funding", "research_futures_marks"],
  permits_and_governance: ["trade_permission_records", "evidence_items", "decision_certifications", "strategy_governance_state", "risk_paper_approvals"],
});

function inventory(dbPath) {
  const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
  const out = { schema: "NUSA_PERMIT_INVENTORY_V1", readOnly: true, groups: {} };
  try {
    const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    for (const [group, tables] of Object.entries(TABLES)) {
      out.groups[group] = {};
      for (const table of tables) {
        if (!existing.has(table)) { out.groups[group][table] = { exists: false }; continue; }
        // The name comes from the frozen list above and is quoted; it is never taken from input.
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get();
        out.groups[group][table] = { exists: true, rows: Number(row.n) };
      }
    }
  } finally { db.close(); }
  const rows = (g, t) => (out.groups[g][t] && out.groups[g][t].exists ? out.groups[g][t].rows : 0);
  out.summary = {
    calibrationSamples: rows("models_and_samples", "ai_calibration_durability_events"),
    outcomeSamples: rows("models_and_samples", "ai_outcome_attribution_memory_events"),
    futuresRows: ["research_futures_klines", "research_futures_funding", "research_futures_marks"].reduce((n, t) => n + rows("futures_data", t), 0),
    permitRecords: rows("permits_and_governance", "trade_permission_records"),
    researchCandidates: rows("research", "research_candidates"),
    note: "Counts only. A table that does not exist reads as 0. Whether samples are bound to a model, market and outcome definition is NOT shown here.",
  };
  return out;
}

if (require.main === module) {
  const target = process.argv[2];
  if (!target) { process.stderr.write("usage: node scripts/permit-inventory.js <state.sqlite>\n"); process.exit(64); }
  try { process.stdout.write(`${JSON.stringify(inventory(target), null, 2)}\n`); } catch (e) { process.stderr.write(`inventory failed: ${String(e && e.message).slice(0, 160)}\n`); process.exit(1); }
}
module.exports = { inventory, TABLES };
