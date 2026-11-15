#!/usr/bin/env node
"use strict";
// nusa-control: the single decider and actor for the NUSA PAPER host (docs/NUSA_CORE_DESIGN_V5_2026-11-15.md).
// Installed root-owned at /opt/nusa-control, outside every release, byte-pinned. Started through nusa-control.sh, which
// holds the exclusive lock. No dependencies; every effect (filesystem, systemctl, health, clock) is injected so the whole
// state table runs in tests. It grants no LIVE authority and, in this version, can never select PAPER_ORDERS.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCHEMA_VERSION = 1;
const MODES = Object.freeze(["STOPPED", "COLLECT_ONLY", "PAPER_ORDERS"]);
// The units this controller owns. The autopilot is a separate system and not part of a PAPER release (design v5 section 2).
const UNITS = Object.freeze(["nusa-research.timer", "nusa.service", "nusa-research.service"]);
const BOOT_UNITS = Object.freeze(["nusa-research.timer", "nusa.service"]); // units that start by themselves when enabled
const SHA = /^[0-9a-f]{40}$/;
const DEFAULTS = Object.freeze({
  stateDir: "/var/lib/nusa-control",
  modeFile: "/etc/nusa/run-mode.env",
  currentLink: "/opt/nusa/current",
  healthUrl: "http://127.0.0.1:41731/health",
  startCeilingMs: 20 * 60 * 1000,
  pollMs: 5000,
});

class ControlError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---- state file -------------------------------------------------------------------------------------------------
function validateState(s) {
  const fail = (why) => { throw new ControlError("STATE_INVALID", why); };
  if (s === null || typeof s !== "object" || Array.isArray(s)) fail("not an object");
  const allowed = new Set(["schemaVersion", "version", "desired", "active", "adopted", "proven", "attempt", "grant", "intent"]);
  for (const k of Object.keys(s)) if (!allowed.has(k)) fail(`unknown field ${k}`);
  if (s.schemaVersion !== SCHEMA_VERSION) fail("schema version");
  if (!Number.isSafeInteger(s.version) || s.version < 1) fail("version");
  if (!MODES.includes(s.desired)) fail("desired");
  if (s.active !== null && !(typeof s.active === "string" && SHA.test(s.active))) fail("active");
  if (typeof s.adopted !== "boolean") fail("adopted");
  if (!Array.isArray(s.proven) || !s.proven.every((p) => p && SHA.test(p.sha) && typeof p.evidence === "string" && p.evidence.length > 0 && p.evidence.length <= 200)) fail("proven");
  if (s.attempt !== null) fail("attempt (not supported in this version)");
  if (s.grant !== null) fail("grant (orders are not available in this version)");
  if (s.desired === "PAPER_ORDERS") fail("PAPER_ORDERS is not available in this version");
  if (s.intent !== null && !(s.intent && ["stop", "collect", "init"].includes(s.intent.verb) && Number.isSafeInteger(s.intent.version) && Number.isSafeInteger(s.intent.at))) fail("intent");
  return s;
}

function stateStore(fsx, stateDir) {
  const file = path.join(stateDir, "state.json");
  const read = () => {
    let text;
    try { text = fsx.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return { ok: false, reason: "STATE_MISSING" }; return { ok: false, reason: "STATE_UNREADABLE" }; }
    try { return { ok: true, state: validateState(JSON.parse(text)) }; } catch (e) { return { ok: false, reason: e.code === "STATE_INVALID" ? `STATE_INVALID:${e.message}` : "STATE_NOT_JSON" }; }
  };
  // Compare-and-swap: the new version must be exactly one more than the version read; written via temp + fsync + rename +
  // directory fsync, so a crash leaves either the old or the new complete file.
  const write = (prevVersion, next) => {
    validateState(next);
    if (next.version !== prevVersion + 1) throw new ControlError("STATE_VERSION", "version must increase by exactly one");
    const now = read();
    if (now.ok && now.state.version !== prevVersion) throw new ControlError("STATE_CONFLICT", "state changed underneath");
    const tmp = path.join(stateDir, `.state.${process.pid}.${Date.now()}.tmp`);
    const fd = fsx.openSync(tmp, "wx", 0o600);
    try { fsx.writeSync(fd, `${JSON.stringify(next, null, 2)}\n`); fsx.fsyncSync(fd); } finally { fsx.closeSync(fd); }
    fsx.renameSync(tmp, file);
    const dfd = fsx.openSync(stateDir, "r");
    try { fsx.fsyncSync(dfd); } finally { fsx.closeSync(dfd); }
    return next;
  };
  // Leftover temp files from an interrupted write are moved aside, never used.
  const quarantineTemps = () => {
    let moved = 0;
    for (const name of fsx.readdirSync(stateDir)) if (/^\.state\..*\.tmp$/.test(name)) { fsx.renameSync(path.join(stateDir, name), path.join(stateDir, `quarantine-${name.slice(1)}`)); moved += 1; }
    return moved;
  };
  return { file, read, write, quarantineTemps };
}

function writeModeFile(fsx, modeFile, mode) {
  if (mode !== "COLLECT_ONLY") throw new ControlError("MODE_REFUSED", `mode ${mode} cannot be written`);
  const tmp = `${modeFile}.tmp`;
  fsx.writeFileSync(tmp, `NUSA_RUN_MODE=${mode}\n`, { mode: 0o644 });
  fsx.renameSync(tmp, modeFile);
}

// ---- systemd ----------------------------------------------------------------------------------------------------
function unitState(sys, unit) {
  const active = sys(["is-active", "--quiet", unit]);
  const enabled = sys(["is-enabled", "--quiet", unit]);
  return {
    active: active === 0 ? "active" : active === 3 || active === 4 ? "inactive" : `unknown:${active}`,
    enabled: enabled === 0 ? "enabled" : enabled === 1 || enabled === 4 ? "disabled" : `unknown:${enabled}`,
  };
}

function stopAll(sys) {
  const problems = [];
  for (const unit of UNITS) {
    if (sys(["disable", unit]) !== 0) problems.push(`${unit}:disable-failed`);
    if (sys(["stop", unit]) !== 0) problems.push(`${unit}:stop-failed`);
  }
  for (const unit of UNITS) {
    const st = unitState(sys, unit);
    if (st.active !== "inactive") problems.push(`${unit}:${st.active}`);
    if (BOOT_UNITS.includes(unit) && st.enabled !== "disabled") problems.push(`${unit}:${st.enabled}`);
  }
  return problems;
}

// ---- verbs ------------------------------------------------------------------------------------------------------
function makeController(deps) {
  const cfg = { ...DEFAULTS, ...(deps.config || {}) };
  const fsx = deps.fs || fs;
  const sys = deps.systemctl;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const health = deps.health; // async () => parsed /health JSON or null
  const store = stateStore(fsx, cfg.stateDir);
  const currentSha = () => { try { const t = fsx.readlinkSync(cfg.currentLink); const sha = path.basename(t); return SHA.test(sha) ? sha : null; } catch { return null; } };

  const withIntent = (state, verb, patch) => {
    const intentState = { ...state, version: state.version + 1, intent: { verb, version: state.version + 1, at: now() } };
    store.write(state.version, intentState);
    const done = { ...intentState, ...patch, version: intentState.version + 1, intent: null };
    return { intentState, finish: () => store.write(intentState.version, done) };
  };

  const status = async () => {
    const r = store.read();
    const units = Object.fromEntries(UNITS.map((u) => [u, unitState(sys, u)]));
    let runMode = null;
    try { const h = await health(); runMode = h && h.runtime && typeof h.runtime.runMode === "string" ? h.runtime.runMode : null; } catch { runMode = null; }
    return { ok: true, state: r.ok ? r.state : null, stateProblem: r.ok ? null : r.reason, current: currentSha(), units, runMode };
  };

  // stop is allowed even when the state file is missing or invalid: stopping is always safe.
  const stop = async () => {
    const r = store.read();
    let finish = null;
    if (r.ok) ({ finish } = withIntent(r.state, "stop", { desired: "STOPPED" }));
    const problems = stopAll(sys);
    if (problems.length > 0) return { ok: false, code: "STOP_NOT_CONFIRMED", problems };
    if (finish) finish();
    return { ok: true, code: r.ok ? "STOPPED" : `STOPPED_WITH_${r.reason.split(":")[0]}` };
  };

  const collect = async () => {
    const r = store.read();
    if (!r.ok) return { ok: false, code: r.reason, detail: "only status and stop are allowed while the state file is not valid" };
    const s = r.state;
    const cur = currentSha();
    if (!s.active || cur !== s.active) return { ok: false, code: "ACTIVE_MISMATCH", detail: `state active=${s.active} current=${cur}` };
    if (!s.adopted && !s.proven.some((p) => p.sha === s.active)) return { ok: false, code: "ACTIVE_NOT_PROVEN" };
    const { finish } = withIntent(s, "collect", { desired: "COLLECT_ONLY" });
    try {
      writeModeFile(fsx, cfg.modeFile, "COLLECT_ONLY");
      for (const unit of BOOT_UNITS) if (sys(["enable", unit]) !== 0) throw new ControlError("ENABLE_FAILED", unit);
      if (sys(["restart", "nusa.service"]) !== 0) throw new ControlError("START_FAILED", "nusa.service");
      if (sys(["start", "nusa-research.timer"]) !== 0) throw new ControlError("START_FAILED", "nusa-research.timer");
      const deadline = now() + cfg.startCeilingMs;
      let seen = null;
      while (now() < deadline) {
        try { const h = await health(); seen = h && h.runtime ? h.runtime.runMode : null; } catch { seen = null; }
        if (seen === "COLLECT_ONLY") { finish(); return { ok: true, code: "COLLECT_ONLY" }; }
        if (seen === "PAPER_ORDERS") throw new ControlError("MODE_MISMATCH", "runtime reports PAPER_ORDERS");
        await sleep(cfg.pollMs);
      }
      throw new ControlError("START_CEILING", `runMode not COLLECT_ONLY within ${cfg.startCeilingMs} ms (last ${seen})`);
    } catch (e) {
      const problems = stopAll(sys);
      // The intent stays recorded; the boot reconcile (or a later stop) completes it as STOPPED.
      const after = store.read();
      if (after.ok) store.write(after.state.version, { ...after.state, version: after.state.version + 1, desired: "STOPPED", intent: null });
      return { ok: false, code: e.code || "COLLECT_FAILED", detail: e.message, stopped: problems.length === 0, problems };
    }
  };

  // Install-time initialisation: records the running build as adopted (not proven) and desired STOPPED. Refused when a
  // valid state file already exists.
  const init = async (sha) => {
    if (!SHA.test(String(sha))) return { ok: false, code: "BAD_SHA" };
    const r = store.read();
    if (r.ok) return { ok: false, code: "ALREADY_INITIALISED" };
    if (r.reason !== "STATE_MISSING") return { ok: false, code: r.reason, detail: "an unreadable or invalid state file is never overwritten by init" };
    if (currentSha() !== sha) return { ok: false, code: "ACTIVE_MISMATCH" };
    const first = { schemaVersion: SCHEMA_VERSION, version: 1, desired: "STOPPED", active: sha, adopted: true, proven: [], attempt: null, grant: null, intent: null };
    validateState(first);
    const fd = fsx.openSync(store.file, "wx", 0o600);
    try { fsx.writeSync(fd, `${JSON.stringify(first, null, 2)}\n`); fsx.fsyncSync(fd); } finally { fsx.closeSync(fd); }
    return { ok: true, code: "INITIALISED" };
  };

  // Boot reconcile (runs before nusa.service): any doubt ends STOPPED.
  const reconcile = async () => {
    const quarantined = store.quarantineTemps();
    const r = store.read();
    if (!r.ok) { const problems = stopAll(sys); return { ok: problems.length === 0, code: `RECONCILED_STOPPED:${r.reason}`, quarantined, problems }; }
    const s = r.state;
    const mismatch = s.intent !== null || s.active !== currentSha();
    if (s.desired === "STOPPED" || mismatch) {
      const problems = stopAll(sys);
      if (problems.length === 0 && s.desired !== "STOPPED") store.write(s.version, { ...s, version: s.version + 1, desired: "STOPPED", intent: null });
      if (problems.length === 0 && s.desired === "STOPPED" && s.intent !== null) store.write(s.version, { ...s, version: s.version + 1, intent: null });
      return { ok: problems.length === 0, code: mismatch ? "RECONCILED_STOPPED:MISMATCH_OR_PENDING_INTENT" : "STOPPED", quarantined, problems };
    }
    writeModeFile(fsx, cfg.modeFile, "COLLECT_ONLY");
    return { ok: true, code: "COLLECT_ONLY_KEPT", quarantined };
  };

  const refuse = async (verb) => ({ ok: false, code: "NOT_AVAILABLE", detail: `${verb} is not available in this version` });
  return { status, stop, collect, init, reconcile, release: () => refuse("release"), "grant-orders": () => refuse("grant-orders") };
}

// ---- CLI --------------------------------------------------------------------------------------------------------
async function main(argv) {
  const [verb, ...args] = argv;
  const sys = (a) => { const r = spawnSync("systemctl", a, { stdio: ["ignore", "ignore", "inherit"], timeout: 120_000 }); return r.status === null ? 99 : r.status; };
  const health = async () => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000); try { const res = await fetch(DEFAULTS.healthUrl, { signal: c.signal }); return res.ok ? await res.json() : null; } finally { clearTimeout(t); } };
  const ctl = makeController({ systemctl: sys, health });
  const known = ["status", "stop", "collect", "init", "reconcile", "release", "grant-orders"];
  if (!known.includes(verb)) { process.stdout.write(`${JSON.stringify({ ok: false, code: "UNKNOWN_VERB", known })}\n`); return 64; }
  const out = await ctl[verb](...args);
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return out.ok ? 0 : 1;
}

module.exports = { makeController, validateState, stateStore, UNITS, BOOT_UNITS, SCHEMA_VERSION, ControlError };
if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stdout.write(`${JSON.stringify({ ok: false, code: "INTERNAL", detail: String(e && e.message) })}\n`); process.exit(70); });
