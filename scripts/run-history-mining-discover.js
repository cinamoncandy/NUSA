"use strict";
/**
 * Config-gated, read-only DISCOVER step of the history mining (docs/RESEARCH_HISTORY_MINING_DESIGN_2026-11-20.md sections 4, 9 and 10;
 * work order WO-LEARNING-20261120-HISTORY-MINING-WIRING). Runs on the PAPER host as one bounded child of the Research snapshot runner.
 *
 *   - deploy/oracle/history-mining-windows.json ABSENT (the default): prints exactly `HISTORY_MINING_DISCOVER {"status":"WAITING_CONFIG"}` and
 *     opens no database, so no candle value is read.
 *   - present: it is validated strictly (exactly four ISO UTC full-hour fields discoveryStart, discoveryEnd, holdbackStart, holdbackEnd; windows
 *     ordered with the 96 hour purge; holdbackEnd <= 2026-11-20T00:00Z, through checkWindows of run-history-mining.js) and ONLY the `discover`
 *     phase of scripts/run-history-mining.js runs, read-only, its output printed as that script prints it.
 *   - The `look` phase is NEVER invoked here: the one look at the hold-back stays a manual, owner-ordered step after the freeze record is committed.
 * An invalid config or a failed child exits non-zero (the runner logs HISTORY_MINING_FAILED_CLOSED). Nothing here orders, gates or grants anything.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { checkWindows } = require("./run-history-mining.js");

const CONFIG_FILE = path.join(__dirname, "..", "deploy", "oracle", "history-mining-windows.json");
const MINING_SCRIPT = path.join(__dirname, "run-history-mining.js");
const KEYS = Object.freeze(["discoveryStart", "discoveryEnd", "holdbackStart", "holdbackEnd"]);
const FULL_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.000)?Z$/;
const WAITING = 'HISTORY_MINING_DISCOVER {"status":"WAITING_CONFIG"}';

/** Strict parse of the config text into { iso, ms }; throws on anything but exactly the four full-hour UTC fields in a valid layout. */
function parseConfig(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("history mining config is not JSON"); }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("history mining config must be an object");
  const keys = Object.keys(raw).sort();
  if (keys.length !== KEYS.length || keys.join() !== [...KEYS].sort().join()) throw new Error("history mining config must have exactly the four window fields");
  const iso = {}; const ms = {};
  for (const k of KEYS) {
    const v = raw[k];
    if (typeof v !== "string" || !FULL_HOUR.test(v)) throw new Error(`${k} must be an ISO UTC full hour`);
    const t = Date.parse(v);
    if (!Number.isFinite(t) || t % 3_600_000 !== 0 || new Date(t).toISOString().slice(0, 13) !== v.slice(0, 13)) throw new Error(`${k} must be a real UTC full hour`);
    iso[k] = new Date(t).toISOString(); ms[k] = t;
  }
  checkWindows(ms);
  return { iso, ms };
}

function run(options = {}) {
  const configPath = options.configPath ?? CONFIG_FILE;
  const env = options.env ?? process.env;
  const spawn = options.spawnSync ?? spawnSync;
  const log = options.log ?? ((line) => console.log(line));
  if (!fs.existsSync(configPath)) { log(WAITING); return 0; }
  const { iso } = parseConfig(fs.readFileSync(configPath, "utf8"));
  const dbPath = String(env.NUSA_CLOUD_STATE_DB_PATH || "");
  if (!path.isAbsolute(dbPath)) throw new Error("state path");
  // Only `discover`: the one `look` is a manual step ordered by the owner after the freeze record is committed.
  const child = spawn(options.executable ?? process.execPath, [MINING_SCRIPT, "discover", "--db", dbPath, "--discovery-start", iso.discoveryStart, "--discovery-end", iso.discoveryEnd, "--holdback-start", iso.holdbackStart, "--holdback-end", iso.holdbackEnd], { env, stdio: "inherit", shell: false, timeout: options.timeoutMs ?? 240000 });
  return child.error || child.signal || child.status !== 0 ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = run(); }
  catch (error) { console.error(`HISTORY_MINING_CONFIG_INVALID ${String(error && error.message).slice(0, 120)}`); process.exitCode = 1; }
}

module.exports = { run, parseConfig, CONFIG_FILE, WAITING };
