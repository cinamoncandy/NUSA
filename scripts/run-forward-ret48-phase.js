"use strict";
/**
 * Config-gated, read-only host phase of the RET48 forward confirmation (docs/RESEARCH_PREREG_2026-11-24_FORWARD_CONFIRMATION_RET48_H24.md, amendment 7a).
 * Runs on the PAPER host as one bounded child of the Research snapshot runner (like scripts/run-history-mining-discover.js). It orders, gates and grants nothing.
 *
 *   - deploy/oracle/forward-ret48.json ABSENT (the default): prints exactly `FORWARD_RET48 {"status":"WAITING_CONFIG"}` and opens no database.
 *   - present: it must hold exactly {"spanStart": "<ISO UTC midnight, not before 2026-12-11T00:00:00Z>"}; anything else exits non-zero.
 *   - date guard: before the first quarter end (2027-03-31T00:00Z) it prints WAITING_DATE and opens no database (blindness: no span row is read earlier).
 *   - within 3 days after a quarter end (2027-03-31, 2027-06-30, 2027-09-30, 2027-12-31) it prints one line `FORWARD_QUARTER_HASH {...}` (segment record, hashes and counts
 *     only, via the pinned scripts/run-history-mining-forward.js); the owner's agent commits the first such line of a quarter UNREAD.
 *   - within 3 days after the decision date (2028-03-31T00:00Z) it prints one line `FORWARD_DECISION {...}` through `evaluate` of the same script, with the committed quarterly
 *     records from deploy/oracle/forward-ret48-committed.json (a list; absent = none). The first FORWARD_DECISION line printed is the decision; later lines are void (prereg).
 *   - at any other time it prints WAITING_DATE and opens no database. The database is opened read-only. Prices are never printed.
 */
const fs = require("node:fs");
const path = require("node:path");
const forward = require("./run-history-mining-forward.js");

const ROOT = path.join(__dirname, "..");
const CONFIG_FILE = path.join(ROOT, "deploy", "oracle", "forward-ret48.json");
const COMMITTED_FILE = path.join(ROOT, "deploy", "oracle", "forward-ret48-committed.json");
const FREEZE_FILE = path.join(ROOT, "docs", "research-data", "history-mining-h2-freeze-record-2026-11-23.json");
const DAY = 86_400_000;
const WINDOW_MS = 3 * DAY;
const QUARTER_ENDS = Object.freeze(["2027-03-31T00:00:00Z", "2027-06-30T00:00:00Z", "2027-09-30T00:00:00Z", "2027-12-31T00:00:00Z"].map((s) => Date.parse(s)));
const WAITING_CONFIG = 'FORWARD_RET48 {"status":"WAITING_CONFIG"}';
const WAITING_DATE = 'FORWARD_RET48 {"status":"WAITING_DATE"}';
const MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/;

/** Strict parse: exactly one field, an ISO UTC midnight not before the earliest span start; a repeated key is refused. */
function parseConfig(text) {
  const seen = new Set();
  for (const m of String(text).matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) { let k; try { k = JSON.parse(`"${m[1]}"`); } catch { throw new Error("config has a bad key"); } if (seen.has(k)) throw new Error("config has a repeated key"); seen.add(k); }
  let raw; try { raw = JSON.parse(text); } catch { throw new Error("config is not JSON"); }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).join() !== "spanStart") throw new Error("config must be exactly {spanStart}");
  const v = raw.spanStart;
  if (typeof v !== "string" || !MIDNIGHT.test(v)) throw new Error("spanStart must be an ISO UTC midnight");
  const t = Date.parse(v);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v.slice(0, 10) || t % DAY !== 0) throw new Error("spanStart must be a real UTC midnight");
  if (t < forward.SPAN_EARLIEST) throw new Error("spanStart is before 2026-12-11");
  return t;
}

/** What this hour does: "WAIT", {quarter: atMs, prevAtMs} or "DECISION". Pure; the clock is passed in. */
function planFor(now) {
  if (now >= forward.DECISION && now < forward.DECISION + WINDOW_MS) return "DECISION";
  for (let i = 0; i < QUARTER_ENDS.length; i += 1) if (now >= QUARTER_ENDS[i] && now < QUARTER_ENDS[i] + WINDOW_MS) return { quarter: QUARTER_ENDS[i], prevAtMs: i === 0 ? null : QUARTER_ENDS[i - 1] };
  return "WAIT";
}

function run(options = {}) {
  const configPath = options.configPath ?? CONFIG_FILE;
  const committedPath = options.committedPath ?? COMMITTED_FILE;
  const freezePath = options.freezePath ?? FREEZE_FILE;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const log = options.log ?? ((line) => console.log(line));
  if (!fs.existsSync(configPath)) { log(WAITING_CONFIG); return 0; }
  const spanStart = parseConfig(fs.readFileSync(configPath, "utf8"));
  const plan = planFor(now);
  if (plan === "WAIT") { log(WAITING_DATE); return 0; }
  const dbPath = String(env.NUSA_CLOUD_STATE_DB_PATH || "");
  if (!path.isAbsolute(dbPath)) throw new Error("state path");
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (plan === "DECISION") {
      const freezeJson = JSON.parse(fs.readFileSync(freezePath, "utf8"));
      const committed = fs.existsSync(committedPath) ? JSON.parse(fs.readFileSync(committedPath, "utf8")) : [];
      if (!Array.isArray(committed)) throw new Error("committed records must be a list");
      const out = forward.evaluate({ db, freeze: freezeJson.freeze || freezeJson, spanStart, committed, now });
      log(`FORWARD_DECISION ${JSON.stringify(out)}`);
      return out.status === "PASS" || out.status === "FAIL" || out.status === "INCONCLUSIVE" ? 0 : 1;
    }
    log(`FORWARD_QUARTER_HASH ${JSON.stringify(forward.quarterRecord(db, plan.quarter, plan.prevAtMs))}`);
    return 0;
  } finally { db.close(); }
}

if (require.main === module) {
  try { process.exitCode = run(); }
  catch (error) { console.error(`FORWARD_RET48_FAILED_CLOSED ${String(error && error.message).slice(0, 120)}`); process.exitCode = 1; }
}

module.exports = { run, parseConfig, planFor, CONFIG_FILE, COMMITTED_FILE, QUARTER_ENDS, WAITING_CONFIG, WAITING_DATE };
