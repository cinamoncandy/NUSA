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
const DEFAULTS = Object.freeze({
  stateDir: "/var/lib/nusa-control",
  modeFile: "/etc/nusa/run-mode.env",
  currentLink: "/opt/nusa/current",
  healthPort: 41731,
  expectedUid: 0,
  checkAncestors: true,
  startCeilingMs: 20 * 60 * 1000,
  pollMs: 5000,
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
  if (s.intent !== null && !(s.intent && ["stop", "collect"].includes(s.intent.verb) && Number.isSafeInteger(s.intent.version) && Number.isSafeInteger(s.intent.at))) fail("intent");
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
  let r;
  try { r = await deps.identifiedHealth(cfg.healthPort); } catch { r = null; }
  if (!r || !Array.isArray(r.ownerPids) || r.ownerPids.length === 0) return { ok: false, reason: "SENDER_UNKNOWN" };
  for (const pid of r.ownerPids) {
    let cg;
    try { cg = deps.cgroupOf(pid); } catch { cg = null; }
    if (typeof cg !== "string" || !cg.split("\n").some((line) => line.endsWith(`/${RUNTIME_UNIT}`))) return { ok: false, reason: "FOREIGN_SENDER", pid };
  }
  const h = r.body;
  if (!h || !h.runtime) return { ok: false, reason: "HEALTH_UNAVAILABLE" };
  if (h.runtime.sourceCommitSha !== expectedSha) return { ok: false, reason: "BUILD_MISMATCH", seen: h.runtime.sourceCommitSha };
  if (h.runtime.runMode !== expectedMode) return { ok: false, reason: "MODE_MISMATCH", seen: h.runtime.runMode };
  return { ok: true };
}

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
  const anyOwnedUnitRunning = () => UNITS.some((u) => { try { return unitState(sys, u).active !== "inactive"; } catch { return true; } });
  const stoppedResult = (code, extra = {}) => { const problems = stopAll(sys); return { ok: false, code, stopped: problems.length === 0, problems, ...extra }; };

  const status = async () => {
    const r = store.read();
    const units = Object.fromEntries(UNITS.map((u) => [u, unitState(sys, u)]));
    const runtime = r.ok && r.state.active ? await verifyRuntime(deps, cfg, r.state.active, "COLLECT_ONLY") : null;
    return { ok: true, state: r.ok ? r.state : null, stateProblem: r.ok ? null : r.reason, current: currentSha(), units, runtime };
  };

  // stop never depends on the state file: the units are stopped first, then the state is recorded if it can be.
  const stop = async () => {
    const problems = stopAll(sys);
    let stateRecorded = false;
    let stateProblem = null;
    const r = store.read();
    if (r.ok) {
      try { store.write(r.state.version, { ...r.state, version: r.state.version + 1, desired: "STOPPED", intent: null }); stateRecorded = true; } catch (e) { stateProblem = e.code || "STATE_WRITE_FAILED"; }
    } else stateProblem = r.reason;
    if (problems.length > 0) return { ok: false, code: "STOP_NOT_CONFIRMED", problems, stateRecorded, stateProblem };
    return { ok: stateRecorded, code: stateRecorded ? "STOPPED" : "STOPPED_STATE_NOT_RECORDED", stateRecorded, stateProblem };
  };

  const collect = async () => {
    const r = store.read();
    // A refused collect changes nothing when the host is already stopped; if owned units are running in a state the
    // controller cannot vouch for (invalid record, other build, unproven build), it stops them instead of leaving them.
    const refuse = (code, detail) => (anyOwnedUnitRunning() ? stoppedResult(code, { detail }) : { ok: false, code, detail });
    if (!r.ok) return refuse(r.reason, "only status and stop are allowed while the state file is not valid");
    const s = r.state;
    const cur = currentSha();
    if (!s.active || cur !== s.active) return refuse("ACTIVE_MISMATCH", `state active=${s.active} current=${cur}`);
    if (!s.adopted && !s.proven.some((p) => p.sha === s.active)) return refuse("ACTIVE_NOT_PROVEN");
    let intentState;
    try {
      intentState = store.write(s.version, { ...s, version: s.version + 1, intent: { verb: "collect", version: s.version + 1, at: now() } });
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
        if (["FOREIGN_SENDER", "BUILD_MISMATCH"].includes(last.reason) || (last.reason === "MODE_MISMATCH" && last.seen === "PAPER_ORDERS")) throw new ControlError(last.reason, JSON.stringify(last));
        await sleep(cfg.pollMs);
      }
      throw new ControlError("START_CEILING", `not verified within ${cfg.startCeilingMs} ms (last ${last && last.reason})`);
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

  // Boot gate (runs before nusa.service): it only PERMITS the start (writes the mode file, keeps units enabled) when the
  // record is consistent; any doubt or error ends STOPPED. It does not claim the runtime is healthy: that is `verify`.
  const reconcile = async () => {
    try {
      const quarantined = store.quarantineTemps();
      const r = store.read();
      if (!r.ok) return stoppedResult(`RECONCILED_STOPPED:${r.reason}`, { quarantined });
      const s = r.state;
      if (s.desired === "STOPPED" || s.intent !== null || s.active !== currentSha()) {
        const out = stoppedResult(s.desired === "STOPPED" && s.intent === null ? "STOPPED" : "RECONCILED_STOPPED:MISMATCH_OR_PENDING_INTENT", { quarantined });
        if (out.stopped && (s.desired !== "STOPPED" || s.intent !== null)) { try { store.write(s.version, { ...s, version: s.version + 1, desired: "STOPPED", intent: null }); } catch { out.stateRecorded = false; } }
        if (out.code === "STOPPED" && out.stopped) out.ok = true;
        return out;
      }
      modeWrite();
      return { ok: true, code: "START_PERMITTED_COLLECT_ONLY", quarantined };
    } catch (e) {
      return stoppedResult(`RECONCILED_STOPPED:${e.code || "ERROR"}`, { detail: e.message });
    }
  };

  // Post-start and periodic check: the recorded desired state must match reality (units, listener identity, build, mode).
  const verify = async () => {
    try {
      const r = store.read();
      if (!r.ok) return stoppedResult(`VERIFY_STOPPED:${r.reason}`);
      const s = r.state;
      if (s.desired === "STOPPED") {
        const bad = UNITS.filter((u) => { const st = unitState(sys, u); return st.active !== "inactive" || (BOOT_UNITS.includes(u) && st.enabled !== "disabled"); });
        return bad.length === 0 ? { ok: true, code: "STOPPED_VERIFIED" } : stoppedResult("VERIFY_STOPPED:UNIT_RUNNING_OR_ENABLED_WHILE_STOPPED", { units: bad });
      }
      if (s.intent !== null || s.active !== currentSha()) return stoppedResult("VERIFY_STOPPED:MISMATCH_OR_PENDING_INTENT");
      if (unitState(sys, RUNTIME_UNIT).active !== "active") return stoppedResult("VERIFY_STOPPED:RUNTIME_NOT_ACTIVE");
      const v = await verifyRuntime(deps, cfg, s.active, "COLLECT_ONLY");
      if (v.ok) return { ok: true, code: "COLLECT_ONLY_VERIFIED" };
      // A wrong answer stops at once. No answer yet is tolerated only while the unit is younger than the start ceiling.
      const wrong = ["FOREIGN_SENDER", "BUILD_MISMATCH"].includes(v.reason) || (v.reason === "MODE_MISMATCH" && v.seen === "PAPER_ORDERS");
      let age = null;
      try { age = deps.unitActiveAgeMs(RUNTIME_UNIT); } catch { age = null; }
      if (!wrong && Number.isFinite(age) && age >= 0 && age < cfg.startCeilingMs) return { ok: true, code: "STARTING_WITHIN_CEILING", reason: v.reason, ageMs: age };
      return stoppedResult(`VERIFY_STOPPED:${v.reason}`, { seen: v.seen });
    } catch (e) {
      return stoppedResult(`VERIFY_STOPPED:${e.code || "ERROR"}`, { detail: e.message });
    }
  };

  const refuse = async (verb) => ({ ok: false, code: "NOT_AVAILABLE", detail: `${verb} is not available in this version` });
  return { status, stop, collect, init, reconcile, verify, release: () => refuse("release"), "grant-orders": () => refuse("grant-orders") };
}

// ---- host implementations of the injected effects ---------------------------------------------------------------
// Socket inodes of ESTABLISHED connections whose local port is `serverPort` and remote port is `clientPort`, from both
// /proc/net/tcp and /proc/net/tcp6 (IPv4-mapped addresses appear in tcp6 when the server listens on ::).
function serverSideInodes(readFile, serverPort, clientPort) {
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
  const inodes = [];
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try { text = readFile(table); } catch { continue; }
    for (const line of text.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length > 9 && f[3] === "01" && f[1].endsWith(`:${hex(serverPort)}`) && f[2].endsWith(`:${hex(clientPort)}`)) inodes.push(f[9]);
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
function hostIdentifiedHealth(port, { host = "127.0.0.1", timeoutMs = 5000 } = {}) {
  const net = require("node:net");
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("health timeout")); }, timeoutMs);
    let ownerPids = null;
    const chunks = [];
    socket.once("connect", () => {
      try {
        const inodes = serverSideInodes((f) => fs.readFileSync(f, "utf8"), port, socket.localPort);
        ownerPids = inodes.length > 0 ? pidsHoldingInodes(inodes) : [];
      } catch { ownerPids = []; }
      socket.write(`GET /health HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (c) => chunks.push(c));
    socket.on("error", (e) => { clearTimeout(timer); reject(e); });
    socket.on("end", () => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8");
      const split = text.indexOf("\r\n\r\n");
      const head = split < 0 ? text : text.slice(0, split);
      let body = null;
      if (/^HTTP\/1\.[01] 200 /.test(head) && !/transfer-encoding:\s*chunked/i.test(head)) { try { body = JSON.parse(text.slice(split + 4)); } catch { body = null; } }
      resolve({ body, ownerPids: ownerPids || [] });
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
  const ctl = makeController({ systemctl: sys, identifiedHealth: hostIdentifiedHealth, unitActiveAgeMs, cgroupOf: (pid) => fs.readFileSync(`/proc/${pid}/cgroup`, "utf8") });
  const known = ["status", "stop", "collect", "init", "reconcile", "verify", "release", "grant-orders"];
  if (!known.includes(verb)) { process.stdout.write(`${JSON.stringify({ ok: false, code: "UNKNOWN_VERB", known })}\n`); return 64; }
  const out = await ctl[verb](...args);
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return out.ok ? 0 : 1;
}

module.exports = { makeController, validateState, stateStore, writeModeFile, assertSafeDir, hostIdentifiedHealth, serverSideInodes, UNITS, BOOT_UNITS, SCHEMA_VERSION, ControlError };
if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stdout.write(`${JSON.stringify({ ok: false, code: "INTERNAL", detail: String(e && e.message) })}\n`); process.exit(70); });
