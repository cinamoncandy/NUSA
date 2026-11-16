#!/usr/bin/env node
"use strict";
// nusa-control: the single decider and actor for the NUSA PAPER host (docs/NUSA_CORE_DESIGN_V5_2026-11-15.md).
// Installed root-owned at /opt/nusa-control, outside every release, byte-pinned. Started through nusa-control.sh, which
// holds the exclusive lock. No dependencies; every effect (filesystem, systemctl, health, process table, clocks) is
// injected so the whole state table runs in tests. It grants no LIVE authority and, in this version, can never select
// PAPER_ORDERS. Rule of thumb for every verb: the result is either "nothing changed" or "every owned unit is stopped
// and disabled, verified"; anything that cannot be verified is reported as not confirmed, never as success.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCHEMA_VERSION = 1;
const MODES = Object.freeze(["STOPPED", "COLLECT_ONLY", "PAPER_ORDERS"]);
// The units this controller owns. The autopilot is a separate system and not part of a PAPER release (design v5 section 2).
const UNITS = Object.freeze(["nusa-research.timer", "nusa.service", "nusa-research.service"]);
const BOOT_UNITS = Object.freeze(["nusa-research.timer", "nusa.service"]); // units that start by themselves when enabled
const RUNTIME_UNIT = "nusa.service";
const SHA = /^[0-9a-f]{40}$/;
const RELEASE_PHASES = Object.freeze(["PREPARED", "UNITS_STOPPED", "ACTIVATING", "SWAPPING", "SWAPPED", "STARTING_NEW", "ROLLING_BACK", "STARTING_OLD"]);
const RELEASE_OUTCOMES = Object.freeze(["DEPLOYED", "ROLLED_BACK", "STOPPED_SAFE", "REFUSED", "SUPERSEDED"]);
const DEFAULTS = Object.freeze({
  stateDir: "/var/lib/nusa-control",
  modeFile: "/etc/nusa/run-mode.env",
  currentLink: "/opt/nusa/current",
  releasesDir: "/opt/nusa/releases",
  // Volatile directory (tmpfs): the stop marker and the single-use start grant live here, so a reboot erases both and the durable
  // state file alone decides what may start after a boot.
  runDir: "/run/nusa-control",
  grantTtlMs: 60_000,
  // The reviewed host helper does the real activation (design C4 3.6); the controller runs it as a child while it holds the lock.
  helperPath: "/opt/nusa/bin/nusa-release-step",
  activateTimeoutMs: 40 * 60 * 1000,
  activatingGrantTtlMs: 10 * 60 * 1000,
  healthPort: 41731,
  expectedUid: 0,
  checkAncestors: true,
  startCeilingMs: 20 * 60 * 1000,
  pollMs: 5000,
  // The periodic verify tolerates a runtime that is busy for a moment (a long synchronous research job can keep /health from
  // answering for about 15 s): "no answer" is asked again this many times, this far apart, before the runtime is stopped. A WRONG answer
  // (other build, other mode, foreign sender) is never retried and stops at once. The whole verify holds the controller lock, and an
  // emergency `stop` waits for that lock (nusa-control.sh, 90 s): the worst case of the retries must stay far below that wait
  // (2 x 8 s of sleeping plus 3 probes of at most 5 s each is about 31 s).
  verifyNoAnswerAttempts: 3,
  verifyNoAnswerRetryMs: 8_000,
});

class ControlError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---- safe file primitives ---------------------------------------------------------------------------------------
// A directory the controller writes into must be a real directory (not a symlink), owned by the expected user and not
// writable by group or others. Files are opened with O_NOFOLLOW and created with O_EXCL under a random name.
function assertSafeDir(fsx, dir, uid, { exactMode, ancestors = false } = {}) {
  // With ancestors, every parent up to / must also be a real directory owned by root (or uid) and not writable by group or
  // others, so nobody but root can swap a path component between the check and the use (no TOCTOU without root).
  if (ancestors) {
    for (let d = path.dirname(dir); ; d = path.dirname(d)) {
      let a;
      try { a = fsx.lstatSync(d); } catch { throw new ControlError("UNSAFE_PATH", `${d} is missing`); }
      if (a.isSymbolicLink() || !a.isDirectory() || (a.uid !== 0 && a.uid !== uid) || (a.mode & 0o022) !== 0) throw new ControlError("UNSAFE_PATH", `ancestor ${d} is not a root-owned, non-writable real directory`);
      if (d === path.dirname(d)) break;
    }
  }
  let st;
  try { st = fsx.lstatSync(dir); } catch { throw new ControlError("UNSAFE_PATH", `${dir} is missing`); }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new ControlError("UNSAFE_PATH", `${dir} is not a real directory`);
  if (st.uid !== uid) throw new ControlError("UNSAFE_PATH", `${dir} is not owned by uid ${uid}`);
  if ((st.mode & 0o022) !== 0) throw new ControlError("UNSAFE_PATH", `${dir} is writable by group or others`);
  if (exactMode !== undefined && (st.mode & 0o777) !== exactMode) throw new ControlError("UNSAFE_PATH", `${dir} mode is not ${exactMode.toString(8)}`);
}
function readNoFollow(fsx, file) {
  const fd = fsx.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fsx.fstatSync(fd);
    if (!st.isFile()) throw new ControlError("UNSAFE_PATH", `${file} is not a regular file`);
    return fsx.readFileSync(fd, "utf8");
  } finally { fsx.closeSync(fd); }
}
function atomicWrite(fsx, dir, target, text, mode) {
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  const fd = fsx.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try {
    fsx.writeSync(fd, text);
    fsx.fsyncSync(fd);
  } catch (e) { fsx.closeSync(fd); try { fsx.unlinkSync(tmp); } catch { /* best effort */ } throw e; }
  fsx.closeSync(fd);
  try { fsx.renameSync(tmp, target); } catch (e) { try { fsx.unlinkSync(tmp); } catch { /* best effort */ } throw e; }
  const dfd = fsx.openSync(dir, fs.constants.O_RDONLY);
  try { fsx.fsyncSync(dfd); } finally { fsx.closeSync(dfd); }
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
  if (s.intent !== null) {
    const i = s.intent;
    if (!(i && ["stop", "collect", "release"].includes(i.verb) && Number.isSafeInteger(i.version) && Number.isSafeInteger(i.at))) fail("intent");
    if (i.verb === "collect" && !(i.owner && Number.isSafeInteger(i.owner.pid) && typeof i.owner.ident === "string" && i.owner.ident.length > 0 && typeof i.owner.bootId === "string" && i.owner.bootId.length > 0 && Number.isSafeInteger(i.owner.atMono))) fail("collect intent needs an owner (pid, ident, bootId, atMono)");
    if (i.verb === "release") {
      const owner = i.owner;
      if (!(typeof i.runId === "string" && /^[0-9a-f]{32}$/.test(i.runId) && SHA.test(i.from) && SHA.test(i.to) && i.from !== i.to && RELEASE_PHASES.includes(i.phase))) fail("release intent needs runId, from, to and a known phase");
      if (!(owner && Number.isSafeInteger(owner.pid) && typeof owner.ident === "string" && owner.ident.length > 0 && typeof owner.bootId === "string" && owner.bootId.length > 0 && Number.isSafeInteger(owner.atMono))) fail("release intent needs an owner (pid, ident, bootId, atMono)");
    }
  }
  return s;
}

function stateStore(fsx, stateDir, uid, ancestors = false) {
  const file = path.join(stateDir, "state.json");
  const read = () => {
    try { assertSafeDir(fsx, stateDir, uid, { exactMode: 0o700, ancestors }); } catch (e) { return { ok: false, reason: `STATE_DIR_UNSAFE:${e.message}` }; }
    let text;
    try { text = readNoFollow(fsx, file); } catch (e) {
      if (e.code === "ENOENT") return { ok: false, reason: "STATE_MISSING" };
      return { ok: false, reason: e.code === "UNSAFE_PATH" || e.code === "ELOOP" ? "STATE_UNSAFE" : "STATE_UNREADABLE" };
    }
    try { return { ok: true, state: validateState(JSON.parse(text)) }; } catch (e) { return { ok: false, reason: e.code === "STATE_INVALID" ? `STATE_INVALID:${e.message}` : "STATE_NOT_JSON" }; }
  };
  // Compare-and-swap: the current file must be valid AND at exactly prevVersion, and the new version must be one more.
  // A missing, corrupt or replaced file is never overwritten here (only create() can make the first file).
  const write = (prevVersion, next) => {
    validateState(next);
    if (next.version !== prevVersion + 1) throw new ControlError("STATE_VERSION", "version must increase by exactly one");
    const now = read();
    if (!now.ok) throw new ControlError("STATE_CONFLICT", `refusing to write over ${now.reason}`);
    if (now.state.version !== prevVersion) throw new ControlError("STATE_CONFLICT", "state changed underneath");
    atomicWrite(fsx, stateDir, file, `${JSON.stringify(next, null, 2)}\n`, 0o600);
    return next;
  };
  const create = (first) => {
    validateState(first);
    assertSafeDir(fsx, stateDir, uid, { exactMode: 0o700, ancestors });
    const fd = fsx.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fsx.writeSync(fd, `${JSON.stringify(first, null, 2)}\n`); fsx.fsyncSync(fd); } finally { fsx.closeSync(fd); }
    const dfd = fsx.openSync(stateDir, fs.constants.O_RDONLY);
    try { fsx.fsyncSync(dfd); } finally { fsx.closeSync(dfd); }
  };
  // Leftover temp files from an interrupted write are moved aside, never used.
  const quarantineTemps = () => {
    let moved = 0;
    for (const name of fsx.readdirSync(stateDir)) if (/^\.state\.json\..*\.tmp$/.test(name)) { fsx.renameSync(path.join(stateDir, name), path.join(stateDir, `quarantine-${name.slice(1)}`)); moved += 1; }
    return moved;
  };
  return { file, read, write, create, quarantineTemps };
}

function writeModeFile(fsx, modeFile, mode, uid, ancestors = false) {
  if (mode !== "COLLECT_ONLY") throw new ControlError("MODE_REFUSED", `mode ${mode} cannot be written`);
  const dir = path.dirname(modeFile);
  assertSafeDir(fsx, dir, uid, { ancestors });
  try { const st = fsx.lstatSync(modeFile); if (st.isSymbolicLink() || !st.isFile()) throw new ControlError("UNSAFE_PATH", `${modeFile} is not a regular file`); } catch (e) { if (e.code !== "ENOENT") throw e; }
  atomicWrite(fsx, dir, modeFile, `NUSA_RUN_MODE=${mode}\n`, 0o644);
}

// ---- systemd and process identity -------------------------------------------------------------------------------
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
    let rc;
    try { rc = sys(["disable", unit]); } catch { rc = 99; }
    if (rc !== 0) problems.push(`${unit}:disable-failed`);
    try { rc = sys(["stop", unit]); } catch { rc = 99; }
    if (rc !== 0) problems.push(`${unit}:stop-failed`);
  }
  for (const unit of UNITS) {
    let st;
    try { st = unitState(sys, unit); } catch { st = { active: "unknown:throw", enabled: "unknown:throw" }; }
    if (st.active !== "inactive") problems.push(`${unit}:${st.active}`);
    if (BOOT_UNITS.includes(unit) && st.enabled !== "disabled") problems.push(`${unit}:${st.enabled}`);
  }
  return problems;
}

// The /health answer counts only if it is bound to its sender: the controller opens the TCP connection itself, finds the
// SERVER side of that very connection in the kernel socket tables (IPv4 and IPv6), resolves the process holding it and
// requires that process to be in the nusa.service cgroup, all while the connection is open and before the answer is read.
// A stale or foreign process on the port, or a listener swapped between checks, can therefore never pass.
async function verifyRuntime(deps, cfg, expectedSha, expectedMode) {
  let r; let error = null;
  try { r = await deps.identifiedHealth(cfg.healthPort); } catch (e) { r = null; error = e; }
  // The diagnostics survive every failure path: the identification record, or the connection/response error with its record.
  const diag = (r && r.diag) || (error && error.diag) || null;
  if (!r || !Array.isArray(r.ownerPids) || r.ownerPids.length === 0) return { ok: false, reason: "SENDER_UNKNOWN", ...(diag ? { diag } : {}), ...(error ? { error: String(error.message || error).slice(0, 120) } : {}) };
  const withDiag = (o) => ({ ...o, ...(diag ? { diag } : {}) });
  for (const pid of r.ownerPids) {
    let cg;
    try { cg = deps.cgroupOf(pid); } catch { cg = null; }
    if (typeof cg !== "string" || !cg.split("\n").some((line) => line.endsWith(`/${RUNTIME_UNIT}`))) return withDiag({ ok: false, reason: "FOREIGN_SENDER", pid });
  }
  const h = r.body;
  if (!h || !h.runtime) return withDiag({ ok: false, reason: "HEALTH_UNAVAILABLE" });
  if (h.runtime.sourceCommitSha !== expectedSha) return withDiag({ ok: false, reason: "BUILD_MISMATCH", seen: h.runtime.sourceCommitSha });
  if (h.runtime.runMode !== expectedMode) return withDiag({ ok: false, reason: "MODE_MISMATCH", seen: h.runtime.runMode });
  return { ok: true };
}

// Only "no answer yet" can be a start in progress; any answer from a sender that identified itself with another build or
// any other mode is wrong at once. Used by collect and verify alike.
const NO_ANSWER_REASONS = Object.freeze(["HEALTH_UNAVAILABLE", "SENDER_UNKNOWN"]);
const isWrongAnswer = (v) => !v.ok && !NO_ANSWER_REASONS.includes(v.reason);

// ---- verbs ------------------------------------------------------------------------------------------------------
function makeController(deps) {
  const cfg = { ...DEFAULTS, ...(deps.config || {}) };
  const fsx = deps.fs || fs;
  const sys = deps.systemctl;
  const now = deps.now || (() => Date.now());
  const monotonic = deps.monotonic || (() => Number(process.hrtime.bigint() / 1_000_000n));
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const store = stateStore(fsx, cfg.stateDir, cfg.expectedUid, cfg.checkAncestors);
  const modeWrite = () => writeModeFile(fsx, cfg.modeFile, "COLLECT_ONLY", cfg.expectedUid, cfg.checkAncestors);
  const currentSha = () => { try { const t = fsx.readlinkSync(cfg.currentLink); const sha = path.basename(t); return SHA.test(sha) ? sha : null; } catch { return null; } };
  // True when any owned unit is active, or a unit that starts by itself is still enabled: either needs the verified stop.
  const anyOwnedUnitRunning = () => UNITS.some((u) => { try { const st = unitState(sys, u); return st.active !== "inactive" || (BOOT_UNITS.includes(u) && st.enabled !== "disabled"); } catch { return true; } });
  // A collect is "in flight" only while the process that wrote the intent is still the same process (pid and start time), in
  // the same boot, and the intent is younger than the start ceiling plus a margin. Anything else is a stale intent.
  const collectInFlight = (intent) => {
    if (!intent || intent.verb !== "collect" || !intent.owner) return false;
    try {
      if (intent.owner.bootId !== deps.bootId()) return false;
      if (deps.processIdentity(intent.owner.pid) !== intent.owner.ident) return false;
    } catch { return false; }
    // Same boot, so the monotonic clock is comparable across processes; the wall clock plays no part.
    const age = monotonic() - intent.owner.atMono;
    return age >= 0 && age <= cfg.startCeilingMs + 60_000;
  };
  // Gate denial: stop what is running, disable what would start by itself, and leave inactive units alone (a stop on a unit
  // with a queued start job is avoided; the failed gate already fails that job).
  const gateStop = () => {
    const problems = [];
    for (const unit of UNITS) {
      let st;
      try { st = unitState(sys, unit); } catch { st = { active: "unknown:throw", enabled: "unknown:throw" }; }
      if (BOOT_UNITS.includes(unit) && st.enabled !== "disabled") { let rc; try { rc = sys(["disable", unit]); } catch { rc = 99; } if (rc !== 0) problems.push(`${unit}:disable-failed`); }
      if (st.active !== "inactive") { let rc; try { rc = sys(["stop", unit]); } catch { rc = 99; } if (rc !== 0) problems.push(`${unit}:stop-failed`); }
    }
    for (const unit of UNITS) {
      let st;
      try { st = unitState(sys, unit); } catch { st = { active: "unknown:throw", enabled: "unknown:throw" }; }
      if (st.active !== "inactive") problems.push(`${unit}:${st.active}`);
      if (BOOT_UNITS.includes(unit) && st.enabled !== "disabled") problems.push(`${unit}:${st.enabled}`);
    }
    return problems;
  };
  const stoppedResult = (code, extra = {}) => { const problems = stopAll(sys); return { ok: false, code, stopped: problems.length === 0, problems, ...extra }; };

  // ---- volatile control files: the stop marker and the single-use start grant (design C4 sections 3.1 and 3.4) ----------
  const markerFile = path.join(cfg.runDir, "stop-requested");
  const grantFile = path.join(cfg.runDir, "start-grant");
  const unlinkQuiet = (f) => { try { fsx.unlinkSync(f); } catch { /* best effort */ } };
  const peek = (file) => { try { return { exists: true, text: readNoFollow(fsx, file) }; } catch (e) { if (e.code === "ENOENT" || e.code === "ENOTDIR") return { exists: false }; return { exists: true, text: null }; } };
  // An unreadable or unsafe marker still counts as a marker (fail closed).
  const markerState = () => { const m = peek(markerFile); if (!m.exists) return { present: false, rec: null }; let rec = null; try { rec = JSON.parse(m.text); } catch { rec = null; } return { present: true, rec }; };
  const markerLive = (rec) => { try { return !!(rec && Number.isSafeInteger(rec.pid) && typeof rec.ident === "string" && deps.processIdentity(rec.pid) === rec.ident); } catch { return false; } };
  const exclusiveWrite = (file, obj) => {
    assertSafeDir(fsx, cfg.runDir, cfg.expectedUid, { exactMode: 0o700 });
    const fd = fsx.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fsx.writeSync(fd, `${JSON.stringify(obj)}\n`); fsx.fsyncSync(fd); } finally { fsx.closeSync(fd); }
  };
  // `stop` creates the marker first (O_EXCL; an existing marker is joined, never replaced).
  const createMarker = () => {
    try { const me = deps.selfIdentity(); exclusiveWrite(markerFile, { pid: me.pid, ident: me.ident, createdAt: now() }); return true; } catch (e) { return e.code === "EEXIST"; }
  };
  const writeGrant = (intent, phase, sha, { uses = 1, ttlMs = cfg.grantTtlMs } = {}) => {
    unlinkQuiet(grantFile);
    const me = deps.selfIdentity();
    const at = monotonic();
    exclusiveWrite(grantFile, { runId: intent.runId, phase, sha, uses, pid: me.pid, ident: me.ident, bootId: deps.bootId(), atMono: at, expiresAtMono: at + ttlMs });
  };
  // The gate's check of a release start: every condition must hold, and the grant is consumed (deleted) when it permits.
  const takeGrant = (s) => {
    const g = peek(grantFile);
    if (!g.exists) return { ok: false, why: "NO_GRANT" };
    const no = (why) => ({ ok: false, why });
    let rec;
    try { rec = JSON.parse(g.text); } catch { unlinkQuiet(grantFile); return no("GRANT_UNREADABLE"); }
    const i = s.intent;
    if (!rec || typeof rec !== "object" || !i || i.verb !== "release") return no("NO_RELEASE_INTENT");
    if (rec.runId !== i.runId) return no("WRONG_RUN");
    if (!["STARTING_NEW", "STARTING_OLD", "ACTIVATING"].includes(i.phase) || rec.phase !== i.phase) return no("WRONG_PHASE");
    const expected = i.phase === "STARTING_OLD" ? i.from : i.to;
    // While the helper activates, the helper swaps the link before its restarts: the link must already be the new build and the
    // record must still say the old one (it is only advanced after the controller's own verification).
    const recordOk = i.phase === "ACTIVATING" ? s.active === i.from : rec.sha === s.active;
    if (rec.sha !== expected || rec.sha !== currentSha() || !recordOk) return no("WRONG_BUILD");
    const uses = rec.uses === undefined ? 1 : rec.uses;
    if (!Number.isSafeInteger(uses) || uses < 1 || uses > 2) return no("GRANT_USES");
    try { if (rec.bootId !== deps.bootId()) return no("OTHER_BOOT"); } catch { return no("OTHER_BOOT"); }
    const at = monotonic();
    if (!(Number.isFinite(rec.atMono) && Number.isFinite(rec.expiresAtMono) && at >= rec.atMono && at <= rec.expiresAtMono)) return no("EXPIRED");
    if (!(rec.pid === i.owner.pid && rec.ident === i.owner.ident)) return no("WRONG_OWNER");
    let alive = false; let isRelease = false; let holdsLock = false;
    try { alive = deps.processIdentity(rec.pid) === rec.ident; } catch { alive = false; }
    try { isRelease = !!(deps.cmdlineIsRelease && deps.cmdlineIsRelease(rec.pid)); } catch { isRelease = false; }
    try { holdsLock = !!(deps.lockHeldBy && deps.lockHeldBy(rec.pid)); } catch { holdsLock = false; }
    if (!alive) return no("OWNER_GONE");
    if (!isRelease) return no("OWNER_NOT_RELEASE");
    if (!holdsLock) return no("OWNER_NOT_HOLDING_LOCK");
    // One use is consumed per permitted start; the last use deletes the grant. The ACTIVATING grant has two (nusa.service, research timer).
    try {
      if (uses > 1) atomicWrite(fsx, cfg.runDir, grantFile, `${JSON.stringify({ ...rec, uses: uses - 1 })}\n`, 0o600);
      else fsx.unlinkSync(grantFile);
    } catch { return no("GRANT_NOT_CONSUMED"); }
    return { ok: true };
  };
  const swapLink = (sha) => {
    const dest = path.join(cfg.releasesDir, sha);
    const st = fsx.lstatSync(dest);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new ControlError("RELEASE_NOT_STAGED", dest);
    const tmp = `${cfg.currentLink}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    fsx.symlinkSync(dest, tmp);
    try { fsx.renameSync(tmp, cfg.currentLink); } catch (e) { try { fsx.unlinkSync(tmp); } catch { /* best effort */ } throw e; }
  };

  // Recovery of a release intent whose process is gone (design C4 section 3.2). Called only with the controller lock held, so no
  // live release can exist. It never moves forward and never starts anything: it ends STOPPED on the previous build, or STOPPED
  // with the link untouched and active=null when the facts match no allowed combination.
  const recoverRelease = () => {
    const r = store.read();
    if (!r.ok || !r.state.intent || r.state.intent.verb !== "release") return { recovered: false };
    const s = r.state; const i = s.intent; const link = currentSha();
    const problems = stopAll(sys);
    if (problems.length > 0) return { recovered: true, ok: false, code: "STOPPED_UNCONFIRMED", problems };
    const both = (a, b) => (link === a || link === b);
    let combo;
    switch (i.phase) {
      case "PREPARED": case "UNITS_STOPPED": case "STARTING_OLD": combo = link === i.from && s.active === i.from; break;
      case "SWAPPING": case "ACTIVATING": combo = both(i.from, i.to) && s.active === i.from; break;
      // From SWAPPED on, link and record may each be either of the two known builds (a crash between the two writes of this very
      // recovery leaves exactly such a pair, and running the recovery again must reach the same end).
      case "SWAPPED": case "STARTING_NEW": case "ROLLING_BACK": combo = both(i.from, i.to) && (s.active === i.from || s.active === i.to); break;
      default: combo = false;
    }
    try {
      unlinkQuiet(grantFile);
      if (!combo) {
        store.write(s.version, { ...s, version: s.version + 1, desired: "STOPPED", active: null, intent: null });
        return { recovered: true, ok: true, code: "RECOVERY_UNKNOWN", detail: `phase ${i.phase} link ${link} active ${s.active}; the link was left untouched` };
      }
      if (link !== i.from) swapLink(i.from);
      store.write(s.version, { ...s, version: s.version + 1, desired: "STOPPED", active: i.from, intent: null });
      return { recovered: true, ok: true, code: "RECOVERED_STOPPED" };
    } catch (e) { return { recovered: true, ok: false, code: "RECOVERY_FAILED", detail: String(e.code || e.message).slice(0, 120) }; }
  };

  const status = async () => {
    const r = store.read();
    const units = Object.fromEntries(UNITS.map((u) => [u, unitState(sys, u)]));
    const runtime = r.ok && r.state.active ? await verifyRuntime(deps, cfg, r.state.active, "COLLECT_ONLY") : null;
    return { ok: true, state: r.ok ? r.state : null, stateProblem: r.ok ? null : r.reason, current: currentSha(), units, runtime, stopMarker: markerState().present };
  };

  // stop never depends on the state file: it records a "stop" intent first when it can (so a concurrent gate sees a command in
  // progress), always stops the units, and records STOPPED afterwards if it can.
  const stop = async () => {
    const markerCreated = createMarker();
    recoverRelease(); // repairs link and record of an interrupted release; the stop below goes on whatever it says
    let r = store.read();
    if (r.ok) { try { store.write(r.state.version, { ...r.state, version: r.state.version + 1, intent: { verb: "stop", version: r.state.version + 1, at: now() } }); } catch { /* the stop goes on without the marker */ } }
    const problems = stopAll(sys);
    let stateRecorded = false;
    let stateProblem = null;
    r = store.read();
    if (r.ok) {
      try { store.write(r.state.version, { ...r.state, version: r.state.version + 1, desired: "STOPPED", intent: null }); stateRecorded = true; } catch (e) { stateProblem = e.code || "STATE_WRITE_FAILED"; }
    } else stateProblem = r.reason;
    if (problems.length > 0) return { ok: false, code: "STOP_NOT_CONFIRMED", problems, stateRecorded, stateProblem };
    // State first, marker second: a crash between the two leaves a marker with a STOPPED record, which is harmless.
    if (stateRecorded && markerCreated) unlinkQuiet(markerFile);
    return { ok: stateRecorded, code: stateRecorded ? "STOPPED" : "STOPPED_STATE_NOT_RECORDED", stateRecorded, stateProblem };
  };

  const collect = async () => {
    // A refused collect changes nothing when the host is already stopped; if owned units are running in a state the
    // controller cannot vouch for (invalid record, other build, unproven build), it stops them instead of leaving them.
    const refuse = (code, detail) => (anyOwnedUnitRunning() ? stoppedResult(code, { detail }) : { ok: false, code, detail });
    const rec = recoverRelease();
    if (rec.recovered && !rec.ok) return { ok: false, code: rec.code, problems: rec.problems, detail: rec.detail };
    // An explicit collect by the owner may clear a LEFTOVER stop marker, only when no live process matches it and the record says STOPPED.
    const mk = markerState();
    if (mk.present) {
      if (markerLive(mk.rec)) return refuse("STOP_IN_PROGRESS");
      const rs = store.read();
      if (!(rs.ok && rs.state.desired === "STOPPED" && rs.state.intent === null)) return refuse("STOP_MARKER_STATE_NOT_STOPPED", "run stop first; a leftover marker is only cleared when the record says STOPPED");
      unlinkQuiet(markerFile);
    }
    const r2 = store.read();
    if (!r2.ok) return refuse(r2.reason, "only status and stop are allowed while the state file is not valid");
    const s = r2.state;
    const cur = currentSha();
    if (!s.active || cur !== s.active) return refuse("ACTIVE_MISMATCH", `state active=${s.active} current=${cur}`);
    if (!s.adopted && !s.proven.some((p) => p.sha === s.active)) return refuse("ACTIVE_NOT_PROVEN");
    let intentState;
    try {
      const me = deps.selfIdentity();
      intentState = store.write(s.version, { ...s, version: s.version + 1, intent: { verb: "collect", version: s.version + 1, at: now(), owner: { pid: me.pid, ident: me.ident, bootId: deps.bootId(), atMono: monotonic() } } });
    } catch (e) { return { ok: false, code: e.code || "STATE_WRITE_FAILED", detail: "no unit was touched; if the record holds a pending intent, verify or the boot reconcile resolves it to STOPPED" }; }
    try {
      modeWrite();
      for (const unit of BOOT_UNITS) if (sys(["enable", unit]) !== 0) throw new ControlError("ENABLE_FAILED", unit);
      if (sys(["restart", RUNTIME_UNIT]) !== 0) throw new ControlError("START_FAILED", RUNTIME_UNIT);
      if (sys(["start", "nusa-research.timer"]) !== 0) throw new ControlError("START_FAILED", "nusa-research.timer");
      const deadline = monotonic() + cfg.startCeilingMs;
      let last = null;
      while (monotonic() < deadline) {
        last = await verifyRuntime(deps, cfg, s.active, "COLLECT_ONLY");
        if (last.ok) {
          store.write(intentState.version, { ...intentState, version: intentState.version + 1, desired: "COLLECT_ONLY", intent: null });
          return { ok: true, code: "COLLECT_ONLY" };
        }
        // An answer that is wrong (not merely absent) ends the attempt at once.
        if (isWrongAnswer(last)) throw new ControlError(last.reason, JSON.stringify(last));
        await sleep(cfg.pollMs);
      }
      throw new ControlError("START_CEILING", `not verified within ${cfg.startCeilingMs} ms (last ${last ? JSON.stringify(last).slice(0, 600) : "none"})`);
    } catch (e) {
      const out = stoppedResult(e.code || "COLLECT_FAILED", { detail: e.message });
      // The intent stays recorded if this write fails; the boot reconcile or a later stop completes it as STOPPED.
      try { const after = store.read(); if (after.ok) store.write(after.state.version, { ...after.state, version: after.state.version + 1, desired: "STOPPED", intent: null }); } catch { out.stateRecorded = false; }
      return out;
    }
  };

  // Install-time initialisation: stops every owned unit (so the record matches reality), then records the running build
  // as adopted (not proven) and desired STOPPED. Never overwrites an existing, unreadable or invalid state file.
  const init = async (sha) => {
    if (!SHA.test(String(sha))) return { ok: false, code: "BAD_SHA" };
    const r = store.read();
    if (r.ok) return { ok: false, code: "ALREADY_INITIALISED" };
    if (r.reason !== "STATE_MISSING") return { ok: false, code: r.reason, detail: "an unreadable, unsafe or invalid state file is never overwritten by init" };
    if (currentSha() !== sha) return { ok: false, code: "ACTIVE_MISMATCH" };
    const problems = stopAll(sys);
    if (problems.length > 0) return { ok: false, code: "STOP_NOT_CONFIRMED", problems, detail: "init records nothing until the units are stopped" };
    try { store.create({ schemaVersion: SCHEMA_VERSION, version: 1, desired: "STOPPED", active: sha, adopted: true, proven: [], attempt: null, grant: null, intent: null }); } catch (e) { return stoppedResult(e.code || "STATE_CREATE_FAILED", { detail: "re-checked: the units were stopped again" }); }
    return { ok: true, code: "INITIALISED_STOPPED" };
  };

  // Start gate (runs before the runtime units; they Require= it, and the gate unit has no RemainAfterExit, so it is
  // evaluated again for every start). It succeeds ONLY when a start is permitted: a valid record whose build is the running
  // build, and either desired COLLECT_ONLY with nothing pending, or a collect that is verifiably in flight (its owner process
  // is alive, same start time, same boot, intent still fresh). Everything else FAILS the gate, so systemd fails the runtime
  // start jobs. With { readonly: true } (the controller lock is held by another command) it never writes or stops anything.
  const reconcileSync = ({ readonly = false } = {}) => {
    try {
      const quarantined = readonly ? 0 : store.quarantineTemps();
      if (!readonly) recoverRelease(); // a dead release is settled to STOPPED before any gate decision
      const deny = (code, extra = {}) => {
        if (readonly) return { ok: false, code, readonly: true, ...extra };
        const problems = gateStop();
        return { ok: false, code, quarantined, stopped: problems.length === 0, problems, ...extra };
      };
      const r = store.read();
      if (!r.ok) return deny(`GATE_DENIED:${r.reason}`);
      const s = r.state;
      // A stop marker denies every start, even one with a valid grant: the file's existence is the atomic authority (design C4 3.4).
      if (markerState().present) return deny("GATE_DENIED:STOP_REQUESTED");
      // A release intent is never a settled or collect state: only a valid single-use grant from the live release verb permits.
      if (s.intent !== null && s.intent.verb === "release") {
        const g = takeGrant(s);
        if (!g.ok) return deny(`GATE_DENIED:RELEASE_${g.why}`);
        return { ok: true, code: "START_PERMITTED_RELEASE_PHASE", phase: s.intent.phase, quarantined };
      }
      const resolveStopped = (out) => { if (!readonly && out.stopped && (s.desired !== "STOPPED" || s.intent !== null)) { try { store.write(s.version, { ...s, version: s.version + 1, desired: "STOPPED", intent: null }); } catch { out.stateRecorded = false; } } return out; };
      if (s.active !== currentSha()) return resolveStopped(deny("GATE_DENIED:MISMATCH"));
      const inFlight = collectInFlight(s.intent);
      // With the lock held by another command (readonly) a settled record is NOT enough: that command may be a stop that has
      // not recorded yet. Only a verifiably live collect, whose own lock this is, may start the runtime.
      const settledCollect = !readonly && s.desired === "COLLECT_ONLY" && s.intent === null;
      if (!inFlight && !settledCollect) {
        const stale = s.intent !== null;
        const busy = readonly && s.desired === "COLLECT_ONLY" && s.intent === null;
        return resolveStopped(deny(busy ? "GATE_DENIED:CONTROLLER_COMMAND_RUNNING" : stale ? "GATE_DENIED:STALE_OR_UNKNOWN_INTENT" : "GATE_DENIED:STOPPED"));
      }
      if (!readonly) modeWrite();
      return { ok: true, code: "START_PERMITTED_COLLECT_ONLY", quarantined };
    } catch (e) {
      if (readonly) return { ok: false, code: `GATE_DENIED:${e.code || "ERROR"}`, readonly: true };
      const problems = stopAll(sys);
      return { ok: false, code: `GATE_DENIED:${e.code || "ERROR"}`, detail: e.message, stopped: problems.length === 0, problems };
    }
  };
  const reconcile = async (o) => reconcileSync(o);

  // Post-start and periodic check: the recorded desired state must match reality (units, listener identity, build, mode).
  const verify = async ({ readonly = false } = {}) => {
    // Another controller command holds the lock: it is responsible for its own result; a periodic check never interferes.
    // The result says plainly that NOTHING was verified; the next timer run verifies again once the command has finished.
    if (readonly) return { ok: true, verified: false, skipped: true, code: "VERIFY_SKIPPED_CONTROLLER_COMMAND_RUNNING" };
    try {
      const rr = recoverRelease();
      if (rr.recovered) return rr.ok ? { ok: false, code: "VERIFY_STOPPED:RELEASE_INTERRUPTED", recovery: rr.code, stopped: true } : stoppedResult(`VERIFY_STOPPED:${rr.code}`);
      const r = store.read();
      if (!r.ok) return stoppedResult(`VERIFY_STOPPED:${r.reason}`);
      const s = r.state;
      if (markerState().present && s.desired !== "STOPPED") return stoppedResult("VERIFY_STOPPED:STOP_REQUESTED");
      if (s.desired === "STOPPED") {
        const bad = UNITS.filter((u) => { const st = unitState(sys, u); return st.active !== "inactive" || (BOOT_UNITS.includes(u) && st.enabled !== "disabled"); });
        return bad.length === 0 ? { ok: true, code: "STOPPED_VERIFIED" } : stoppedResult("VERIFY_STOPPED:UNIT_RUNNING_OR_ENABLED_WHILE_STOPPED", { units: bad });
      }
      if (s.intent !== null && collectInFlight(s.intent) && s.active === currentSha()) return { ok: true, code: "COLLECT_IN_PROGRESS", verified: false };
      if (s.intent !== null || s.active !== currentSha()) return stoppedResult("VERIFY_STOPPED:MISMATCH_OR_PENDING_INTENT");
      if (unitState(sys, RUNTIME_UNIT).active !== "active") return stoppedResult("VERIFY_STOPPED:RUNTIME_NOT_ACTIVE");
      let v = await verifyRuntime(deps, cfg, s.active, "COLLECT_ONLY");
      for (let n = 1; !v.ok && !isWrongAnswer(v) && n < cfg.verifyNoAnswerAttempts; n += 1) {
        await sleep(cfg.verifyNoAnswerRetryMs);
        // The runtime may have died while we waited: that is a stop now, not another probe.
        if (unitState(sys, RUNTIME_UNIT).active !== "active") return stoppedResult("VERIFY_STOPPED:RUNTIME_NOT_ACTIVE");
        v = await verifyRuntime(deps, cfg, s.active, "COLLECT_ONLY");
      }
      if (v.ok) return { ok: true, code: "COLLECT_ONLY_VERIFIED" };
      // A wrong answer stops at once. No answer yet is tolerated only while the unit is younger than the start ceiling.
      // Only "no answer yet" (HEALTH_UNAVAILABLE, SENDER_UNKNOWN) can be a start in progress. Any answer that arrives from a
      // process that identified itself, with another build or any other mode, is wrong at once.
      const wrong = isWrongAnswer(v);
      let age = null;
      try { age = deps.unitActiveAgeMs(RUNTIME_UNIT); } catch { age = null; }
      if (!wrong && Number.isFinite(age) && age >= 0 && age < cfg.startCeilingMs) return { ok: true, code: "STARTING_WITHIN_CEILING", reason: v.reason, ageMs: age };
      return stoppedResult(`VERIFY_STOPPED:${v.reason}`, { seen: v.seen });
    } catch (e) {
      return stoppedResult(`VERIFY_STOPPED:${e.code || "ERROR"}`, { detail: e.message });
    }
  };

  // ---- release <sha> (design C4): one verb changes the build, the unit state and the record together ---------------------
  // Outcomes: DEPLOYED (new build verified), ROLLED_BACK (previous proven build verified), STOPPED_SAFE (nothing verified, every unit
  // stopped), REFUSED (a precondition failed, nothing changed), SUPERSEDED (decided by the workflow before the host is touched),
  // plus STOPPED_UNCONFIRMED (a unit would not stop: never a success). Only DEPLOYED has ok=true. It never sets PAPER_ORDERS.
  const releaseResult = (outcome, extra = {}) => ({ ok: outcome === "DEPLOYED", code: outcome, outcome, ...extra });
  const release = async (sha) => {
    const refuse = (reason, detail) => releaseResult("REFUSED", { reason, ...(detail ? { detail } : {}) });
    if (!SHA.test(String(sha))) return refuse("BAD_SHA");
    const rec = recoverRelease();
    if (rec.recovered && !rec.ok) return releaseResult("STOPPED_UNCONFIRMED", { reason: rec.code, problems: rec.problems });
    if (markerState().present) return refuse("STOP_REQUESTED");
    const r0 = store.read();
    if (!r0.ok) return refuse(r0.reason);
    let cur = r0.state;
    if (cur.intent !== null) return refuse("INTENT_PENDING");
    if (!cur.active) return refuse("NO_ACTIVE_BUILD");
    if (currentSha() !== cur.active) return refuse("ACTIVE_MISMATCH");
    if (cur.active === sha) return refuse("SAME_BUILD");
    if (!cur.adopted && !cur.proven.some((p) => p.sha === cur.active)) return refuse("ROLLBACK_TARGET_NOT_PROVEN");
    try { const st = fsx.lstatSync(path.join(cfg.releasesDir, sha)); if (st.isSymbolicLink() || !st.isDirectory()) return refuse("RELEASE_NOT_STAGED"); } catch { return refuse("RELEASE_NOT_STAGED"); }
    const ordersOffNow = async () => { try { return !!(deps.ordersOff && (await deps.ordersOff())); } catch { return false; } };
    if (!(await ordersOffNow())) return refuse("ORDERS_NOT_OFF");
    if (cur.desired === "COLLECT_ONLY") {
      const v = await verifyRuntime(deps, cfg, cur.active, "COLLECT_ONLY");
      if (!v.ok) return refuse("RUNTIME_NOT_VERIFIED", v.reason);
    } else if (anyOwnedUnitRunning()) return refuse("UNITS_RUNNING_WHILE_STOPPED");
    const from = cur.active; const to = sha;
    const me = deps.selfIdentity();
    const runId = (deps.randomId || (() => require("node:crypto").randomBytes(16).toString("hex")))();
    const owner = { pid: me.pid, ident: me.ident, bootId: deps.bootId(), atMono: monotonic() };
    const setPhase = (phase, patch = {}) => { cur = store.write(cur.version, { ...cur, ...patch, version: cur.version + 1, intent: { verb: "release", version: cur.version + 1, at: now(), runId, from, to, phase, owner } }); };
    const finish = (patch) => { cur = store.write(cur.version, { ...cur, ...patch, version: cur.version + 1, intent: null }); };
    try { setPhase("PREPARED"); } catch (e) { return refuse(e.code || "STATE_WRITE_FAILED", "no unit was touched"); }
    // Back to a verified stop: units stopped, link and record back on the previous build, intent cleared.
    const settleStopped = (why) => {
      const problems = stopAll(sys);
      if (problems.length > 0) return releaseResult("STOPPED_UNCONFIRMED", { reason: why, problems });
      try {
        if (currentSha() !== from) swapLink(from);
        finish({ desired: "STOPPED", active: from });
        return releaseResult("STOPPED_SAFE", { reason: why });
      } catch (e) { return releaseResult("STOPPED_SAFE", { reason: why, stateRecorded: false, detail: "recovery settles the record on the next command" }); }
    };
    const guard = async () => (markerState().present ? "STOP_REQUESTED" : (await ordersOffNow()) ? null : "ORDERS_NOT_OFF");
    // The controller's OWN check that the running runtime is the expected build in COLLECT_ONLY (the helper's readiness is not trusted alone).
    const waitVerified = async (build) => {
      const deadline = monotonic() + cfg.startCeilingMs;
      let last = null;
      while (monotonic() < deadline) {
        if (markerState().present) return { ok: false, reason: "STOP_REQUESTED" };
        last = await verifyRuntime(deps, cfg, build, "COLLECT_ONLY");
        if (last.ok) return { ok: true };
        if (isWrongAnswer(last)) return { ok: false, reason: last.reason };
        await sleep(cfg.pollMs);
      }
      return { ok: false, reason: "START_CEILING" };
    };
    // Rollback start of the previous proven build: the controller starts it itself, one grant per gated start.
    const startAndVerify = async (phase, build) => {
      try {
        modeWrite();
        writeGrant(cur.intent, phase, build);
        for (const unit of BOOT_UNITS) if (sys(["enable", unit]) !== 0) throw new ControlError("ENABLE_FAILED", unit);
        if (sys(["restart", RUNTIME_UNIT]) !== 0) throw new ControlError("START_FAILED", RUNTIME_UNIT);
        // The research timer has its own gate check: one grant is one start, so it gets its own grant (same run, same phase).
        writeGrant(cur.intent, phase, build);
        if (sys(["start", "nusa-research.timer"]) !== 0) throw new ControlError("START_FAILED", "nusa-research.timer");
        return await waitVerified(build);
      } catch (e) { return { ok: false, reason: e.code || "START_FAILED" }; } finally { unlinkQuiet(grantFile); }
    };
    // Delegation (design C4 3.6): the reviewed host helper does the real activation (link swap, unit files, source identity,
    // restarts, readiness, soak). Its two gated starts (nusa.service, research timer) use ONE grant with two uses.
    const activate = async (build) => {
      try {
        modeWrite();
        writeGrant(cur.intent, "ACTIVATING", build, { uses: 2, ttlMs: cfg.activatingGrantTtlMs });
        const r = deps.runHelper ? deps.runHelper(build) : { status: 127 };
        if (!r || r.status !== 0) return { ok: false, reason: `HELPER_EXIT_${r ? r.status : "NONE"}` };
        if (currentSha() !== build) return { ok: false, reason: "HELPER_LINK_MISMATCH" };
        return { ok: true };
      } catch (e) { return { ok: false, reason: e.code || "HELPER_ERROR" }; } finally { unlinkQuiet(grantFile); }
    };
    const settleRunning = (outcome, patch, extra = {}) => {
      finish({ desired: "COLLECT_ONLY", ...patch });
      return releaseResult(outcome, extra);
    };
    try {
      let g = await guard(); if (g) return settleStopped(g);
      const problems = stopAll(sys);
      if (problems.length > 0) return releaseResult("STOPPED_UNCONFIRMED", { reason: "STOP_NOT_CONFIRMED", problems });
      setPhase("UNITS_STOPPED", { desired: "STOPPED" });
      g = await guard(); if (g) return settleStopped(g);
      setPhase("ACTIVATING");
      let started = await activate(to);
      if (started.ok) {
        // Only now does the record move to the new build; then the controller verifies on its own.
        g = await guard(); if (g) return settleStopped(g);
        setPhase("SWAPPED", { active: to });
        started = await waitVerified(to);
      }
      if (started.ok) {
        const proven = cur.proven.some((p) => p.sha === to) ? cur.proven : [...cur.proven, { sha: to, evidence: `RELEASE_VERIFIED:${runId}` }];
        return settleRunning("DEPLOYED", { proven });
      }
      // The new build failed: roll back to the previous proven build, unless a stop was requested (then stop, no start).
      if (started.reason === "STOP_REQUESTED" || markerState().present) return settleStopped("STOP_REQUESTED");
      const down = stopAll(sys);
      if (down.length > 0) return releaseResult("STOPPED_UNCONFIRMED", { reason: started.reason, problems: down });
      g = await guard(); if (g) return settleStopped(g);
      setPhase("ROLLING_BACK"); swapLink(from); setPhase("STARTING_OLD", { active: from });
      const back = await startAndVerify("STARTING_OLD", from);
      if (back.ok) return settleRunning("ROLLED_BACK", {}, { reason: started.reason });
      return settleStopped(`ROLLBACK_FAILED:${back.reason}`);
    } catch (e) { return settleStopped(e.code || "RELEASE_ERROR"); }
  };

  const refuse = async (verb) => ({ ok: false, code: "NOT_AVAILABLE", detail: `${verb} is not available in this version` });
  return { status, stop, collect, init, reconcile, reconcileSync, verify, release, "grant-orders": () => refuse("grant-orders") };
}

// ---- host implementations of the injected effects ---------------------------------------------------------------
// True when the process holds a lock on the controller lock file (the inode appears in /proc/locks with that pid).
function lockHeldBy(pid, lockFile, readLocks = () => fs.readFileSync("/proc/locks", "utf8"), statIno = (f) => fs.statSync(f).ino) {
  const ino = statIno(lockFile);
  return readLocks().split("\n").some((line) => { const f = line.trim().split(/\s+/); return f[1] === "FLOCK" && f[2] === "ADVISORY" && f[3] === "WRITE" && f[4] === String(pid) && /^[0-9a-f]+:[0-9a-f]+:\d+$/.test(f[5] || "") && f[5].split(":")[2] === String(ino); });
}
// Runs the reviewed host helper's `activate` as a child of the controller (which holds the controller lock). The helper must be a
// root-owned regular file nobody else can write; anything else is refused (status 127). The environment is minimal and fixed.
function runHelperActivate(helper, sha, timeoutMs) {
  if (!SHA.test(String(sha))) return { status: 127 };
  try {
    const st = fs.lstatSync(helper);
    if (!st.isFile() || st.isSymbolicLink() || st.uid !== 0 || (st.mode & 0o022) !== 0) return { status: 127 };
  } catch { return { status: 127 }; }
  const r = spawnSync(helper, ["activate", sha], { stdio: ["ignore", 2, 2], timeout: timeoutMs, env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" } });
  return { status: r.status === null ? 99 : r.status };
}
// Port of install.sh orders_off_everywhere: fail closed, every query must succeed and make sense.
function ordersOffEverywhere({ root = "", read = (f) => fs.readFileSync(f, "utf8"), show = (a) => { const r = spawnSync("systemctl", ["show", "nusa.service", ...a], { encoding: "utf8", timeout: 10_000 }); if (r.status !== 0) throw new Error("systemctl show failed"); return String(r.stdout).trim(); }, lstat = (f) => fs.lstatSync(f), list = (d) => fs.readdirSync(d) } = {}) {
  try {
    const envFile = `${root}/etc/nusa/cloud-runtime.env`;
    const lines = read(envFile).split("\n");
    const mentions = lines.filter((l) => l.includes("NUSA_PAPER_ORDER_PATH"));
    if (mentions.length < 1 || !mentions.every((l) => l === "NUSA_PAPER_ORDER_PATH=OFF")) return false;
    if (show(["-p", "Id", "--value"]) !== "nusa.service") return false;
    if (show(["-p", "Environment", "--value"]).includes("NUSA_PAPER_ORDER_PATH")) return false;
    let sawRuntime = false;
    for (const part of show(["-p", "EnvironmentFiles", "--value"]).replace(/\s*\(ignore_errors=([a-z]*)\)\s*/g, " $1\n").split("\n")) {
      if (part.trim() === "") continue;
      const [f, flag, extra] = part.trim().split(/\s+/);
      if (extra !== undefined || !flag) return false;
      if (f === envFile) { if (flag !== "no") return false; sawRuntime = true; } else if (f === `${root}/etc/nusa/run-mode.env`) { if (flag !== "no") return false; } else return false;
    }
    if (!sawRuntime) return false;
    const unitDir = `${root}/etc/systemd/system`;
    const files = [`${unitDir}/nusa.service`];
    try { for (const n of list(`${unitDir}/nusa.service.d`)) files.push(`${unitDir}/nusa.service.d/${n}`); } catch (e) { if (e.code !== "ENOENT") return false; }
    for (const f of files) { if (!lstat(f).isFile()) return false; if (read(f).split("\n").some((l) => /^\s*Environment=.*NUSA_PAPER_ORDER_PATH/.test(l))) return false; }
    try { if (read(`${root}/etc/nusa/run-mode.env`).trim() !== "NUSA_RUN_MODE=COLLECT_ONLY") return false; } catch (e) { if (e.code !== "ENOENT") return false; }
    return true;
  } catch { return false; }
}

// Canonical text of an address as written in /proc/net/tcp (4 hex bytes, little-endian) and /proc/net/tcp6 (four 32-bit
// little-endian words). IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are folded to plain IPv4 so both tables compare.
function procAddress(hex) {
  const bytes = [];
  if (hex.length === 8) { for (let i = 0; i < 8; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16)); return bytes.reverse().join("."); }
  if (hex.length !== 32) return null;
  for (let w = 0; w < 32; w += 8) { const word = []; for (let i = 0; i < 8; i += 2) word.push(parseInt(hex.slice(w + i, w + i + 2), 16)); bytes.push(...word.reverse()); }
  if (bytes.slice(0, 10).every((x) => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12).join(".");
  return bytes.map((x) => x.toString(16).padStart(2, "0")).join("");
}
function canonicalAddress(text) {
  const m = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(text);
  if (m) return m[1];
  if (/^::1$/.test(text)) return "00000000000000000000000000000001";
  return text;
}
// Socket inodes of ESTABLISHED connections that are exactly the SERVER side of the connection the controller opened: the
// local address and port equal the client's remote address and port, and the remote address and port equal the client's
// local ones. Ports alone are never enough.
function serverSideInodes(readFile, { serverAddress, serverPort, clientAddress, clientPort }) {
  const hexPort = (n) => n.toString(16).toUpperCase().padStart(4, "0");
  const wantServer = canonicalAddress(serverAddress);
  const wantClient = canonicalAddress(clientAddress);
  const inodes = [];
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try { text = readFile(table); } catch { continue; }
    for (const line of text.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      // inode 0 is a connection the kernel completed but the server has not accept()ed yet: it has no owner process to find.
      if (f.length < 10 || f[3] !== "01" || f[9] === "0") continue;
      const [la, lp] = f[1].split(":"); const [ra, rp] = f[2].split(":");
      if (!la || !ra || lp !== hexPort(serverPort) || rp !== hexPort(clientPort)) continue;
      if (procAddress(la) === wantServer && procAddress(ra) === wantClient) inodes.push(f[9]);
    }
  }
  return inodes;
}
function pidsHoldingInodes(inodes) {
  const want = new Set(inodes);
  const pids = [];
  for (const pid of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    let fds;
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      let target;
      try { target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      const m = /^socket:\[(\d+)\]$/.exec(target);
      if (m && want.has(m[1])) { pids.push(Number(pid)); break; }
    }
  }
  return pids;
}
// GET /health over one connection the controller owns; the sender is identified while that connection is open.
// A connection the kernel has completed but the server has not accept()ed yet shows inode 0 and has no owner process, so
// right after connect() the owner can legitimately be unknown (a busy runtime during start-up accepts late). The controller
// therefore waits, polling the kernel table, until exactly one accepted server-side socket exists (or the identification
// budget runs out), and only THEN sends the request. A first real-host run (2026-11-16) failed with SENDER_UNKNOWN here.
function hostIdentifiedHealth(port, { host = "127.0.0.1", timeoutMs = 5000, identifyBudgetMs = 3000, pollMs = 20, readTable = (f) => fs.readFileSync(f, "utf8") } = {}) {
  const net = require("node:net");
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const diag = { attempts: 0, waitedMs: 0, inodes: [], holders: 0, tableErrors: 0, tableError: null, requestSent: false, responseStatus: null, bodyParsed: false, responseBytes: 0 };
    const fail = (e) => { clearTimeout(timer); try { socket.destroy(); } catch { /* already closed */ } e.diag = diag; reject(e); };
    const timer = setTimeout(() => fail(new Error("health timeout")), timeoutMs);
    let ownerPids = null;
    const chunks = [];
    socket.once("connect", () => {
      const t0 = process.hrtime.bigint();                                  // monotonic: a wall-clock change cannot stretch the budget
      const elapsedMs = () => Number((process.hrtime.bigint() - t0) / 1_000_000n);
      // A /proc read failure is recorded (and still treated as "no match"), so it can be told apart from "no such socket".
      const tracked = (f) => { try { return readTable(f); } catch (e) { diag.tableErrors += 1; diag.tableError = String((e && e.code) || (e && e.message) || e).slice(0, 40); throw e; } };
      const identify = () => {
        let inodes = [];
        try { inodes = serverSideInodes(tracked, { serverAddress: socket.remoteAddress, serverPort: port, clientAddress: socket.localAddress, clientPort: socket.localPort }); } catch { inodes = []; }
        diag.attempts += 1; diag.waitedMs = elapsedMs(); diag.inodes = inodes.slice(0, 4);
        if (inodes.length > 1) return finish([]);                       // ambiguous: the sender is unknown
        if (inodes.length === 0 && diag.waitedMs < identifyBudgetMs) return void setTimeout(identify, pollMs);
        // Exactly one matching server-side socket, or the sender is unknown.
        const inode = inodes.length === 1 ? inodes[0] : null;
        let pids = [];
        try { pids = inode === null ? [] : pidsHoldingInodes([inode]); } catch { pids = []; }
        finish(pids);
      };
      const finish = (pids) => {
        ownerPids = pids; diag.holders = pids.length;
        // The request is ONLY sent to a sender that was identified (holders were read while the connection was open and BEFORE
        // the request). An unidentified peer never receives it: the connection is closed and the sender is unknown.
        if (pids.length === 0) { clearTimeout(timer); socket.destroy(); resolve({ body: null, ownerPids: [], diag }); return; }
        diag.requestSent = true;
        socket.write(`GET /health HTTP/1.0\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`);
      };
      identify();
    });
    socket.on("data", (c) => chunks.push(c));
    socket.on("error", (e) => fail(e));
    socket.on("end", () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks);
      const text = raw.toString("utf8");
      const split = text.indexOf("\r\n\r\n");
      const head = split < 0 ? text : text.slice(0, split);
      let body = null;
      const status = /^HTTP\/1\.[01] (\d{3}) /.exec(head);
      diag.responseStatus = status ? Number(status[1]) : null; diag.responseBytes = raw.length;
      if (/^HTTP\/1\.[01] 200 /.test(head) && !/transfer-encoding:\s*chunked/i.test(head)) { try { body = JSON.parse(text.slice(split + 4)); } catch { body = null; } }
      diag.bodyParsed = body !== null;
      // Every process that holds the server-side socket is in the list; a foreign process could only answer by receiving the
      // descriptor from one of them.
      resolve({ body, ownerPids: ownerPids || [], diag });
    });
  });
}

async function main(argv) {
  const [verb, ...args] = argv;
  const sys = (a) => { const r = spawnSync("systemctl", a, { stdio: ["ignore", "ignore", "inherit"], timeout: 120_000 }); return r.status === null ? 99 : r.status; };
  // Age of the unit's current activation, from systemd's monotonic timestamp (microseconds, CLOCK_MONOTONIC).
  const unitActiveAgeMs = (unit) => {
    const r = spawnSync("systemctl", ["show", "-p", "ActiveEnterTimestampMonotonic", "--value", unit], { encoding: "utf8", timeout: 10_000 });
    const us = Number(String(r.stdout).trim());
    if (r.status !== 0 || !Number.isSafeInteger(us) || us <= 0) throw new Error("no activation timestamp");
    return Number(process.hrtime.bigint() / 1000n - BigInt(us)) / 1000;
  };
  const startTicks = (pid) => { const t = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); const f = t.slice(t.lastIndexOf(")") + 2).split(" "); return f[19]; };
  const ctl = makeController({ systemctl: sys, identifiedHealth: hostIdentifiedHealth, unitActiveAgeMs,
    selfIdentity: () => ({ pid: process.pid, ident: startTicks(process.pid) }),
    processIdentity: (pid) => { try { return startTicks(pid); } catch { return null; } },
    bootId: () => fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), cgroupOf: (pid) => fs.readFileSync(`/proc/${pid}/cgroup`, "utf8"),
    cmdlineIsRelease: (pid) => { const a = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0"); return a.some((x) => x.endsWith("nusa-control.js")) && a.includes("release"); },
    lockHeldBy: (pid) => lockHeldBy(pid, path.join(DEFAULTS.runDir, "lock")),
    ordersOff: () => ordersOffEverywhere(),
    runHelper: (sha) => runHelperActivate(DEFAULTS.helperPath, sha, DEFAULTS.activateTimeoutMs) });
  const known = ["status", "stop", "collect", "init", "reconcile", "verify", "release", "grant-orders"];
  if (!known.includes(verb)) { process.stdout.write(`${JSON.stringify({ ok: false, code: "UNKNOWN_VERB", known })}\n`); return 64; }
  const readonly = args.includes("--readonly");
  const out = await ctl[verb](...args.filter((a) => a !== "--readonly"), ...(readonly && ["reconcile", "verify"].includes(verb) ? [{ readonly: true }] : []));
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return out.ok ? 0 : 1;
}

module.exports = { runHelperActivate, lockHeldBy, ordersOffEverywhere, RELEASE_PHASES, RELEASE_OUTCOMES, DEFAULTS, makeController, validateState, stateStore, writeModeFile, assertSafeDir, hostIdentifiedHealth, serverSideInodes, procAddress, UNITS, BOOT_UNITS, SCHEMA_VERSION, ControlError };
if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stdout.write(`${JSON.stringify({ ok: false, code: "INTERNAL", detail: String(e && e.message) })}\n`); process.exit(70); });
