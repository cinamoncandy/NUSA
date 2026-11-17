"use strict";
// C4 maintenance window (docs/NUSA_C4_MAINTENANCE_WINDOW_DESIGN_2026-11-17.md): `maintenance begin <sha>` / `maintenance end <sha>` and the
// periodic verify while a window is open. A real temp filesystem, a fake systemd and health, fake clocks (the world of nusa-control-release.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeController, stateStore, UNITS } = require("../deploy/control/nusa-control.js");

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const UID = process.getuid ? process.getuid() : 0;
const posixOnly = process.platform === "win32" ? { skip: "the controller runs only on the Linux host" } : {};

class Crash extends Error {}

// opts.crashAt: the n-th mutation (state or link rename, any systemctl verb that changes something) throws and the process is
// "dead" from then on: every later mutation throws too. opts.afterStateWrite(n, w): called after the n-th state write.
function world(opts = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-release-"));
  const mk = (d, mode) => { fs.mkdirSync(d, { recursive: true }); fs.chmodSync(d, mode); return d; };
  const stateDir = mk(path.join(base, "state"), 0o700);
  const runDir = mk(path.join(base, "run"), 0o700);
  const etc = mk(path.join(base, "etc"), 0o755);
  for (const sha of [A, B, C]) mk(path.join(base, "releases", sha), 0o755);
  const currentLink = path.join(base, "current");
  fs.symlinkSync(path.join(base, "releases", A), currentLink);
  const units = Object.fromEntries(UNITS.map((u) => [u, { active: true, enabled: true }]));
  const w = { base, stateDir, runDir, units, calls: [], mono: 0, dead: false, mutations: 0, stateWrites: 0, bad: new Set(opts.bad || []), wrongMode: new Set(opts.wrongMode || []), orders: true, lockHeld: true, cmdIsRelease: true, ownerAlive: true, gateResults: [], crashAt: opts.crashAt ?? null, modeFile: path.join(etc, "run-mode.env"), currentLink };
  const crashCheck = () => { if (w.dead) throw new Crash("dead"); w.mutations += 1; if (w.crashAt !== null && w.mutations === w.crashAt) { w.dead = true; throw new Crash("crash"); } };
  const fsx = {
    ...fs,
    renameSync: (a, b) => {
      // a competing gate claims the same slot first / a stop marker appears between the gate's marker check and its claim
      if (/start-grant\.[12]$/.test(String(a)) && String(b).includes(".used-")) {
        if (opts.stealGrant && !w.stolen) { w.stolen = true; fs.renameSync(a, `${a}.used-competitor`); }
        if (opts.markerAtClaim && !fs.existsSync(w.marker)) fs.writeFileSync(w.marker, JSON.stringify({ pid: 4999, ident: "x" }), { mode: 0o600 });
      }
      crashCheck(); const isState = String(b).endsWith("state.json"); fs.renameSync(a, b); if (isState) { w.stateWrites += 1; if (opts.afterStateWrite) opts.afterStateWrite(w.stateWrites, w); }
    },
    symlinkSync: (a, b) => { if (w.dead) throw new Crash("dead"); return fs.symlinkSync(a, b); },
    unlinkSync: (f) => { if (w.dead) throw new Crash("dead"); return fs.unlinkSync(f); },
    openSync: (f, flags, mode) => { if (w.dead && typeof flags === "number" && (flags & fs.constants.O_CREAT)) throw new Crash("dead"); return fs.openSync(f, flags, mode); },
  };
  const systemctl = (args) => {
    const [verb, ...rest] = args;
    const unit = rest.filter((a) => a !== "--quiet")[0];
    const changing = ["stop", "disable", "enable", "start", "restart"].includes(verb);
    if (changing) { if (w.dead) return 99; w.mutations += 1; if (w.crashAt !== null && w.mutations === w.crashAt) { w.dead = true; return 99; } }
    w.calls.push(args.join(" "));
    const u = units[unit];
    if (!u) return 4;
    switch (verb) {
      case "stop": u.active = false; return 0;
      case "disable": u.enabled = false; return 0;
      case "enable": u.enabled = true; return 0;
      case "start": case "restart": {
        // systemd runs the real start gate of nusa.service (Requires=) while the release verb holds the controller lock: readonly.
        if (unit === "nusa.service" || unit === "nusa-research.timer") {
          w.gateRuns = (w.gateRuns || 0) + 1;
          if (opts.beforeStart) opts.beforeStart(w, unit);
          const g = w.gateSync(unit);
          w.gateResults.push(g);
          if (!g.ok) return 1;
        }
        u.active = true; return 0;
      }
      case "is-active": return u.active ? 0 : 3;
      case "is-enabled": return u.enabled ? 0 : 1;
      default: return 1;
    }
  };
  const buildNow = () => { try { return path.basename(fs.readlinkSync(currentLink)); } catch { return null; } };
  const identifiedHealth = async () => {
    if (!units["nusa.service"].active || w.noAnswer) return { body: null, ownerPids: [] };
    if (w.wrongBuild) return { body: { runtime: { runMode: "COLLECT_ONLY", sourceCommitSha: "d".repeat(40) } }, ownerPids: [4242] };
    const b = buildNow();
    if (w.bad.has(b)) return { body: null, ownerPids: [4242] };
    return { body: { runtime: { runMode: w.wrongMode.has(b) ? "PAPER_ORDERS" : "COLLECT_ONLY", sourceCommitSha: b } }, ownerPids: [4242] };
  };
  w.ctl = makeController({
    fs: fsx, systemctl, identifiedHealth,
    cgroupOf: () => "0::/system.slice/nusa.service",
    unitActiveAgeMs: () => w.unitAge ?? 1000,
    selfIdentity: () => ({ pid: 4001, ident: "t1" }),
    processIdentity: (pid) => (pid === 4001 && w.ownerAlive ? "t1" : null),
    bootId: () => "boot-A",
    cmdlineIsRelease: (pid) => pid === 4001 && w.cmdIsRelease,
    lockHeldBy: (pid) => pid === 4001 && w.lockHeld,
    ordersOff: async () => w.orders,
    randomId: () => "0123456789abcdef0123456789abcdef",
    // A stand-in for the reviewed host helper's `activate`: swap the link, restart nusa.service and start the research timer (both
    // go through the real start gate), then judge readiness; on a failure it ends with its own safe stop, like the real helper.
    runHelper: (sha) => {
      (w.helperCalls ||= []).push(sha);
      if (opts.helper) return opts.helper(w, sha);
      if (w.dead) throw new Crash("dead");
      const tmp = `${currentLink}.tmp-h`;
      fsx.symlinkSync(path.join(base, "releases", sha), tmp);
      fsx.renameSync(tmp, currentLink);
      const fail = () => { for (const u of UNITS) { systemctl(["disable", u]); systemctl(["stop", u]); } return { status: 1 }; };
      if (systemctl(["restart", "nusa.service"]) !== 0) return fail();
      if (systemctl(["start", "nusa-research.timer"]) !== 0) return fail();
      if (w.dead) throw new Crash("dead");
      if (w.bad.has(sha) || w.wrongMode.has(sha)) return fail();
      return { status: 0 };
    },
    now: () => 1_000_000 + w.mono,
    monotonic: () => w.mono,
    sleep: async (ms) => { w.mono += ms; },
    config: { stateDir, runDir, releasesDir: path.join(base, "releases"), modeFile: w.modeFile, currentLink, startCeilingMs: 60_000, pollMs: 5_000, expectedUid: UID, checkAncestors: false },
  });
  // The readonly gate is exactly what systemd runs while the release verb holds the lock (the lock wrapper runs it with --readonly).
  w.gateSync = () => w.ctl.reconcileSync({ readonly: true });
  w.store = stateStore(fs, stateDir, UID);
  w.state = () => w.store.read();
  w.marker = path.join(runDir, "stop-requested");
  w.grant = path.join(runDir, "start-grant");
  w.link = buildNow;
  return w;
}

// A running, verified host on build A with the controller installed (what the real host is in COLLECT_ONLY).
async function up(w, { adopted = true } = {}) {
  assert.equal((await w.ctl.init(A)).code, "INITIALISED_STOPPED");
  const s = w.state().state;
  w.store.write(s.version, { ...s, version: s.version + 1, desired: "COLLECT_ONLY", adopted });
  for (const u of ["nusa.service", "nusa-research.timer"]) { w.units[u].active = true; w.units[u].enabled = true; }
  w.calls.length = 0; w.mutations = 0; w.stateWrites = 0; w.gateResults.length = 0;
}

const winFile = (w) => path.join(w.runDir, "maintenance");
const readWin = (w) => JSON.parse(fs.readFileSync(winFile(w), "utf8"));
const MAX = 60 * 60 * 1000;
const running = (w) => w.units["nusa.service"].active && w.units["nusa-research.timer"].active;
test("begin: records a window bound to the sha and this boot, with the hard limit, and starts nothing", posixOnly, async () => {
  const w = world(); await up(w);
  const before = w.calls.filter((c) => !/^is-(active|enabled) /.test(c)).length;
  const r = await w.ctl.maintenance("begin", A);
  assert.equal(r.code, "MAINTENANCE_BEGUN"); assert.equal(r.ok, true);
  const rec = readWin(w);
  assert.equal(rec.sha, A); assert.equal(rec.bootId, "boot-A"); assert.equal(rec.expiresAtMs - rec.beginsAtMs, MAX);
  assert.equal(fs.statSync(winFile(w)).mode & 0o777, 0o600);
  assert.equal(w.calls.filter((c) => !/^is-(active|enabled) /.test(c)).length, before, "begin must not start, stop or restart anything");
});

test("begin refuses, and writes nothing, on each unmet precondition", posixOnly, async () => {
  const cases = {
    BAD_SHA: async (w) => w.ctl.maintenance("begin", "xyz"),
    STOP_REQUESTED: async (w) => { fs.writeFileSync(w.marker, JSON.stringify({ pid: 1, ident: "z" }), { mode: 0o600 }); return w.ctl.maintenance("begin", A); },
    NOT_COLLECT_ONLY: async (w) => { const s = w.state().state; w.store.write(s.version, { ...s, version: s.version + 1, desired: "STOPPED" }); return w.ctl.maintenance("begin", A); },
    INTENT_PENDING: async (w) => { const s = w.state().state; w.store.write(s.version, { ...s, version: s.version + 1, intent: { verb: "stop", version: s.version + 1, at: 1 } }); return w.ctl.maintenance("begin", A); },
    ACTIVE_MISMATCH: async (w) => { fs.rmSync(w.currentLink); fs.symlinkSync(path.join(w.base, "releases", B), w.currentLink); return w.ctl.maintenance("begin", A); },
    ORDERS_NOT_OFF: async (w) => { w.orders = false; return w.ctl.maintenance("begin", A); },
    RUNTIME_NOT_VERIFIED: async (w) => { w.units["nusa.service"].active = false; return w.ctl.maintenance("begin", A); },
    WINDOW_ALREADY_OPEN: async (w) => { await w.ctl.maintenance("begin", A); return w.ctl.maintenance("begin", A); },
  };
  for (const [reason, run] of Object.entries(cases)) {
    const w = world(); await up(w);
    const r = await run(w);
    assert.equal(r.ok, false, reason); assert.equal(r.code === "MAINTENANCE_REFUSED", true, reason);
    assert.equal(r.reason, reason, JSON.stringify(r));
    if (reason !== "WINDOW_ALREADY_OPEN") assert.equal(fs.existsSync(winFile(w)), false, `${reason}: nothing may be written`);
  }
});

test("end: only the run that began the window ends it; a leftover or expired file is removed by anyone", posixOnly, async () => {
  const w = world(); await up(w);
  await w.ctl.maintenance("begin", A);
  const other = await w.ctl.maintenance("end", B);
  assert.equal(other.ok, false); assert.equal(other.reason, "OTHER_RUN"); assert.equal(fs.existsSync(winFile(w)), true);
  assert.equal((await w.ctl.maintenance("end", A)).code, "MAINTENANCE_ENDED"); assert.equal(fs.existsSync(winFile(w)), false);
  assert.equal((await w.ctl.maintenance("end", A)).code, "MAINTENANCE_NONE");
  // an expired window is no window: anyone may end it
  await w.ctl.maintenance("begin", A); w.mono += MAX + 1;
  assert.equal((await w.ctl.maintenance("end", B)).code, "MAINTENANCE_ENDED"); assert.equal(fs.existsSync(winFile(w)), false);
  // garbage is no window either
  fs.writeFileSync(winFile(w), "not json", { mode: 0o600 });
  assert.equal((await w.ctl.maintenance("end", B)).code, "MAINTENANCE_ENDED"); assert.equal(fs.existsSync(winFile(w)), false);
});

test("verify without a window: a runtime that gives no answer is still stopped (today's behaviour is unchanged)", posixOnly, async () => {
  const w = world(); await up(w);
  w.units["nusa.service"].active = true; w.noAnswer = true; w.unitAge = 3_600_000;
  const v = await w.ctl.verify();
  assert.equal(v.ok, false); assert.match(v.code, /^VERIFY_STOPPED:(SENDER_UNKNOWN|HEALTH_UNAVAILABLE)$/); assert.equal(running(w), false);
});

test("verify in a valid window: no answer is tolerated, nothing is stopped, nothing waits", posixOnly, async () => {
  const w = world(); await up(w);
  await w.ctl.maintenance("begin", A);
  w.noAnswer = true; w.unitAge = 3_600_000;
  const t0 = w.mono;
  const v = await w.ctl.verify();
  assert.equal(v.ok, true); assert.equal(v.code, "MAINTENANCE_WINDOW"); assert.equal(v.verified, false);
  assert.equal(running(w), true, "nothing may be stopped"); assert.equal(w.mono, t0, "the window is the allowance: no patience loop");
});

test("verify in a valid window still stops at once on every wrong answer and unsafe fact", posixOnly, async () => {
  const stops = {
    "wrong build": (w) => { w.wrongBuild = true; },
    "wrong mode": (w) => { w.wrongMode.add(A); },
    "orders not off": (w) => { w.orders = false; w.noAnswer = true; w.unitAge = 3_600_000; },
    "runtime not active": (w) => { w.units["nusa.service"].active = false; },
    "stop request": (w) => { fs.writeFileSync(w.marker, JSON.stringify({ pid: 1, ident: "z" }), { mode: 0o600 }); w.noAnswer = true; w.unitAge = 3_600_000; },
    "state problem": (w) => { fs.writeFileSync(path.join(w.stateDir, "state.json"), "{broken", { mode: 0o600 }); w.noAnswer = true; w.unitAge = 3_600_000; },
  };
  for (const [name, arrange] of Object.entries(stops)) {
    const w = world(); await up(w);
    await w.ctl.maintenance("begin", A);
    arrange(w);
    const v = await w.ctl.verify();
    assert.equal(v.ok, false, name); assert.match(v.code, /^VERIFY_STOPPED:/, name); assert.equal(running(w), false, `${name}: the runtime must be stopped`);
  }
});

test("a window is no window when expired, from another boot, malformed, longer than the limit, or with a clock set back", posixOnly, async () => {
  const bad = {
    expired: (w, r) => { w.mono += MAX + 1; },
    "other boot": (w, r) => { fs.writeFileSync(winFile(w), JSON.stringify({ ...r, bootId: "boot-B" })); },
    "no sha": (w, r) => { fs.writeFileSync(winFile(w), JSON.stringify({ ...r, sha: "x" })); },
    "too long": (w, r) => { fs.writeFileSync(winFile(w), JSON.stringify({ ...r, expiresAtMs: r.beginsAtMs + MAX + 1000 })); },
    "clock set back": (w, r) => { w.mono -= 10 * MAX; },
    "begins in the future": (w, r) => { fs.writeFileSync(winFile(w), JSON.stringify({ ...r, beginsAtMs: r.beginsAtMs + 5000, expiresAtMs: r.expiresAtMs + 5000 })); },
    garbage: (w, r) => { fs.writeFileSync(winFile(w), "{{"); },
  };
  for (const [name, arrange] of Object.entries(bad)) {
    const w = world(); await up(w);
    await w.ctl.maintenance("begin", A);
    arrange(w, readWin(w));
    w.noAnswer = true; w.unitAge = 3_600_000;
    const v = await w.ctl.verify();
    assert.equal(v.ok, false, name); assert.match(v.code, /^VERIFY_STOPPED:/, name);
  }
});

test("stop ends the window at once", posixOnly, async () => {
  const w = world(); await up(w);
  await w.ctl.maintenance("begin", A);
  await w.ctl.stop();
  assert.equal(fs.existsSync(winFile(w)), false);
});

test("a truncated window file (a crash in the middle of the write) is no window, and a later begin replaces it", posixOnly, async () => {
  const w = world(); await up(w);
  fs.writeFileSync(winFile(w), '{"sha":"' + A.slice(0, 10), { mode: 0o600 });
  w.noAnswer = true; w.unitAge = 3_600_000;
  const v = await w.ctl.verify();
  assert.equal(v.ok, false); assert.match(v.code, /^VERIFY_STOPPED:/);
  const w2 = world(); await up(w2);
  fs.writeFileSync(winFile(w2), '{"sha":"' + A.slice(0, 10), { mode: 0o600 });
  assert.equal((await w2.ctl.maintenance("begin", A)).code, "MAINTENANCE_BEGUN");
  assert.equal(readWin(w2).sha, A);
});
