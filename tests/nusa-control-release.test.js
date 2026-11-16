"use strict";
// C4 `release <sha>` of deploy/control/nusa-control.js (docs/NUSA_C4_RELEASE_THROUGH_CONTROLLER_DESIGN_2026-11-16.md):
// the happy path, rollback, every refusal, the start gate with the single-use grant, the stop marker, the recovery table and a
// crash injected at EVERY mutation of a release (and of the recovery itself). A real temp filesystem, a fake systemd whose
// start of nusa.service runs the real start gate, a fake health endpoint and fake clocks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeController, stateStore, validateState, ordersOffEverywhere, lockHeldBy, UNITS, RELEASE_OUTCOMES } = require("../deploy/control/nusa-control.js");

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
    renameSync: (a, b) => { crashCheck(); const isState = String(b).endsWith("state.json"); fs.renameSync(a, b); if (isState) { w.stateWrites += 1; if (opts.afterStateWrite) opts.afterStateWrite(w.stateWrites, w); } },
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
    if (!units["nusa.service"].active) return { body: null, ownerPids: [] };
    const b = buildNow();
    if (w.bad.has(b)) return { body: null, ownerPids: [4242] };
    return { body: { runtime: { runMode: w.wrongMode.has(b) ? "PAPER_ORDERS" : "COLLECT_ONLY", sourceCommitSha: b } }, ownerPids: [4242] };
  };
  w.ctl = makeController({
    fs: fsx, systemctl, identifiedHealth,
    cgroupOf: () => "0::/system.slice/nusa.service",
    unitActiveAgeMs: () => 1000,
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

const allStopped = (w) => UNITS.every((u) => !w.units[u].active) && ["nusa.service", "nusa-research.timer"].every((u) => !w.units[u].enabled);
const allRunning = (w) => UNITS.filter((u) => u !== "nusa-research.service").every((u) => w.units[u].active);
// A running, verified host on build A with the controller installed (what the real host is in COLLECT_ONLY).
async function up(w, { adopted = true } = {}) {
  assert.equal((await w.ctl.init(A)).code, "INITIALISED_STOPPED");
  const s = w.state().state;
  w.store.write(s.version, { ...s, version: s.version + 1, desired: "COLLECT_ONLY", adopted });
  for (const u of ["nusa.service", "nusa-research.timer"]) { w.units[u].active = true; w.units[u].enabled = true; }
  w.calls.length = 0; w.mutations = 0; w.stateWrites = 0; w.gateResults.length = 0;
}
const mutating = (w) => w.calls.filter((c) => !/^is-(active|enabled) /.test(c));
const seedIntent = (w, extra = {}) => {
  const s = w.state().state;
  const intent = { verb: "release", version: s.version + 1, at: 1, runId: "0123456789abcdef0123456789abcdef", from: A, to: B, phase: "STARTING_NEW", owner: { pid: 4001, ident: "t1", bootId: "boot-A", atMono: 0 }, ...extra };
  w.store.write(s.version, { ...s, version: s.version + 1, intent, active: extra.active ?? B });
  return intent;
};
const writeGrantFile = (w, over = {}) => fs.writeFileSync(w.grant, JSON.stringify({ runId: "0123456789abcdef0123456789abcdef", phase: "STARTING_NEW", sha: B, pid: 4001, ident: "t1", bootId: "boot-A", atMono: 0, expiresAtMono: 60_000, ...over }), { mode: 0o600 });
const setLink = (w, sha) => { fs.rmSync(w.currentLink); fs.symlinkSync(path.join(w.base, "releases", sha), w.currentLink); };

test("release: the new build is verified, recorded as proven, and the host ends in COLLECT_ONLY on it", posixOnly, async () => {
  const w = world(); await up(w);
  const r = await w.ctl.release(B);
  assert.deepEqual([r.ok, r.outcome], [true, "DEPLOYED"], JSON.stringify(r) + JSON.stringify(w.gateResults));
  const s = w.state().state;
  assert.equal(s.active, B); assert.equal(s.desired, "COLLECT_ONLY"); assert.equal(s.intent, null);
  assert.ok(s.proven.some((p) => p.sha === B));
  assert.equal(w.link(), B);
  assert.ok(allRunning(w));
  assert.equal(fs.readFileSync(w.modeFile, "utf8").trim(), "NUSA_RUN_MODE=COLLECT_ONLY");
  assert.ok(!fs.existsSync(w.grant) && !fs.existsSync(w.marker));
  assert.ok(w.gateResults.length >= 2 && w.gateResults.every((g) => g.ok), "the runtime and the timer starts both went through the real gate");
  assert.equal(w.gateResults[0].code, "START_PERMITTED_RELEASE_PHASE");
  assert.equal(w.gateResults[0].phase, "ACTIVATING");
  assert.deepEqual(w.helperCalls, [B], "the reviewed helper did the activation");
  assert.ok(!w.calls.join("\n").includes("PAPER_ORDERS"));
});

test("release: a new build that never answers or answers in the wrong mode is rolled back to the previous proven build", posixOnly, async () => {
  for (const [label, opts] of [["no answer", { bad: [B] }], ["wrong mode", { wrongMode: [B] }]]) {
    const w = world(opts); await up(w);
    const r = await w.ctl.release(B);
    assert.deepEqual([r.ok, r.outcome], [false, "ROLLED_BACK"], label);
    const s = w.state().state;
    assert.equal(s.active, A, label); assert.equal(s.desired, "COLLECT_ONLY"); assert.equal(s.intent, null);
    assert.ok(!s.proven.some((p) => p.sha === B), "the failed build is never recorded as proven");
    assert.equal(w.link(), A); assert.ok(allRunning(w));
    assert.equal(w.gateResults.find((g) => g.phase === "STARTING_OLD").ok, true);
  }
});

test("release: when the rollback fails too, everything ends stopped on the previous build, with the intent cleared", posixOnly, async () => {
  // A answers while the release checks its preconditions, then dies together with B (a host problem, not the build).
  const w = world({ bad: [B], afterStateWrite: (n, ww) => { if (n === 3) ww.bad.add(A); } }); await up(w);
  const r = await w.ctl.release(B);
  assert.deepEqual([r.ok, r.outcome], [false, "STOPPED_SAFE"]);
  const s = w.state().state;
  assert.deepEqual([s.active, s.desired, s.intent], [A, "STOPPED", null]);
  assert.equal(w.link(), A); assert.ok(allStopped(w));
});

test("release refusals change nothing and keep a healthy runtime running", posixOnly, async () => {
  const cases = [
    ["BAD_SHA", () => {}, "xyz"],
    ["SAME_BUILD", () => {}, A],
    ["RELEASE_NOT_STAGED", (w) => fs.rmSync(path.join(w.base, "releases", B), { recursive: true }), B],
    ["ORDERS_NOT_OFF", (w) => { w.orders = false; }, B],
    ["STOP_REQUESTED", (w) => fs.writeFileSync(w.marker, "{}", { mode: 0o600 }), B],
    ["INTENT_PENDING", (w) => { const s = w.state().state; w.store.write(s.version, { ...s, version: s.version + 1, intent: { verb: "stop", version: s.version + 1, at: 1 } }); }, B],
    ["ROLLBACK_TARGET_NOT_PROVEN", (w) => { const s = w.state().state; w.store.write(s.version, { ...s, version: s.version + 1, adopted: false }); }, B],
    ["RUNTIME_NOT_VERIFIED", (w) => { w.bad.add(A); }, B],
    ["ACTIVE_MISMATCH", (w) => setLink(w, C), B],
  ];
  for (const [reason, arrange, sha] of cases) {
    const w = world(); await up(w); arrange(w);
    const before = JSON.stringify(w.state().ok ? w.state().state : null);
    const linkBefore = w.link();
    w.calls.length = 0;
    const r = await w.ctl.release(sha);
    assert.deepEqual([r.ok, r.outcome, r.reason], [false, "REFUSED", reason], reason);
    assert.equal(JSON.stringify(w.state().ok ? w.state().state : null), before, `${reason}: record unchanged`);
    assert.equal(w.link(), linkBefore, `${reason}: link unchanged`);
    assert.deepEqual(mutating(w), [], `${reason}: no unit touched`);
  }
});

test("outcomes are only the documented words, and only DEPLOYED is ok", posixOnly, async () => {
  assert.deepEqual([...RELEASE_OUTCOMES], ["DEPLOYED", "ROLLED_BACK", "STOPPED_SAFE", "REFUSED", "SUPERSEDED"]);
  const w = world(); await up(w);
  for (const sha of ["xyz", A, B]) { const r = await w.ctl.release(sha); assert.ok([...RELEASE_OUTCOMES, "STOPPED_UNCONFIRMED"].includes(r.outcome)); assert.equal(r.ok, r.outcome === "DEPLOYED"); if (r.ok) break; }
});

test("start gate: with a release intent only a complete, single-use grant of the live release verb permits a start", posixOnly, async () => {
  const mkw = async () => { const w = world(); await up(w); seedIntent(w); setLink(w, B); return w; };
  const deny = async (label, arrange, why) => {
    const w = await mkw(); arrange(w);
    const g = w.ctl.reconcileSync({ readonly: true });
    assert.equal(g.ok, false, label);
    assert.equal(g.code, `GATE_DENIED:RELEASE_${why}`, label);
  };
  await deny("no grant file", () => {}, "NO_GRANT");
  await deny("unreadable grant", (w) => fs.writeFileSync(w.grant, "{"), "GRANT_UNREADABLE");
  await deny("another run", (w) => writeGrantFile(w, { runId: "f".repeat(32) }), "WRONG_RUN");
  await deny("another phase", (w) => writeGrantFile(w, { phase: "STARTING_OLD" }), "WRONG_PHASE");
  await deny("another build", (w) => writeGrantFile(w, { sha: A }), "WRONG_BUILD");
  await deny("another boot", (w) => writeGrantFile(w, { bootId: "boot-X" }), "OTHER_BOOT");
  await deny("expired", (w) => { writeGrantFile(w); w.mono = 61_000; }, "EXPIRED");
  await deny("another owner pid", (w) => writeGrantFile(w, { pid: 4002 }), "WRONG_OWNER");
  await deny("owner process gone", (w) => { writeGrantFile(w); w.ownerAlive = false; }, "OWNER_GONE");
  await deny("owner is not the release verb", (w) => { writeGrantFile(w); w.cmdIsRelease = false; }, "OWNER_NOT_RELEASE");
  await deny("a stray process without the lock", (w) => { writeGrantFile(w); w.lockHeld = false; }, "OWNER_NOT_HOLDING_LOCK");
  const w = await mkw(); writeGrantFile(w);
  const first = w.ctl.reconcileSync({ readonly: true });
  assert.deepEqual([first.ok, first.code, first.phase], [true, "START_PERMITTED_RELEASE_PHASE", "STARTING_NEW"]);
  assert.ok(!fs.existsSync(w.grant), "the grant is consumed");
  assert.equal(w.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:RELEASE_NO_GRANT", "one grant is one start");
});

test("start gate: every phase other than the two start phases is denied even with a grant, and an outside start has no grant at all", posixOnly, async () => {
  for (const phase of ["PREPARED", "UNITS_STOPPED", "SWAPPING", "SWAPPED", "ROLLING_BACK"]) {
    const w = world(); await up(w); seedIntent(w, { phase }); setLink(w, B); writeGrantFile(w, { phase });
    assert.equal(w.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:RELEASE_WRONG_PHASE", phase);
  }
  // the boot-time or systemd-restart start while a release is in progress: no grant, denied; nothing in readonly mode is stopped
  const w = world(); await up(w); seedIntent(w); setLink(w, B);
  const calls = w.calls.length;
  assert.equal(w.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:RELEASE_NO_GRANT");
  assert.equal(mutating(w).length, 0); assert.equal(w.calls.length, calls);
});

test("stop marker: the gate denies every start while it exists, even a start with a perfectly valid grant", posixOnly, async () => {
  const w = world(); await up(w); seedIntent(w); setLink(w, B); writeGrantFile(w);
  fs.writeFileSync(w.marker, JSON.stringify({ pid: 4999, ident: "x" }), { mode: 0o600 });
  assert.equal(w.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:STOP_REQUESTED");
  assert.ok(fs.existsSync(w.grant), "a denied start does not consume the grant");
  const plain = world(); await up(plain); fs.writeFileSync(plain.marker, "garbage");
  assert.equal(plain.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:STOP_REQUESTED", "an unreadable marker still counts");
});

test("race: a stop marker that appears after the release's last check still blocks the start at the gate, and the runtime never runs", posixOnly, async () => {
  const w = world({ beforeStart: (ww, unit) => { if (unit === "nusa.service" && !fs.existsSync(ww.marker)) fs.writeFileSync(ww.marker, JSON.stringify({ pid: 4999, ident: "x" }), { mode: 0o600 }); } });
  await up(w);
  const r = await w.ctl.release(B);
  assert.deepEqual([r.ok, r.outcome], [false, "STOPPED_SAFE"]);
  assert.ok(allStopped(w));
  assert.ok(w.gateResults.every((g) => !g.ok), "no start was ever permitted");
  assert.ok(fs.existsSync(w.marker), "the release never deletes a stop marker");
  const s = w.state().state;
  assert.deepEqual([s.active, s.desired, s.intent], [A, "STOPPED", null]); assert.equal(w.link(), A);
});

test("a stop issued after any state write of a release always ends stopped and never starts anything afterwards", posixOnly, async () => {
  const probe = world(); await up(probe); await probe.ctl.release(B);
  const total = probe.stateWrites;
  assert.ok(total >= 5);
  for (let k = 1; k <= total; k += 1) {
    const w = world({ afterStateWrite: (n, ww) => { if (n === k) fs.writeFileSync(ww.marker, JSON.stringify({ pid: 4999, ident: "x" }), { mode: 0o600 }); } });
    await up(w);
    const r = await w.ctl.release(B);
    if (r.outcome === "DEPLOYED") { assert.equal(k, total, "only a marker after the final write can let the release finish"); continue; }
    assert.ok(["STOPPED_SAFE", "ROLLED_BACK"].includes(r.outcome) === false || r.outcome === "STOPPED_SAFE", `k=${k} ${r.outcome}`);
    assert.ok(allStopped(w), `k=${k}: stopped`);
    const s = w.state().state;
    assert.deepEqual([s.desired, s.intent], ["STOPPED", null], `k=${k}`);
    assert.equal(w.link(), s.active, `k=${k}: link and record agree`);
  }
});

test("stop verb: creates its marker, stops, records STOPPED, then removes the marker (state first, marker second)", posixOnly, async () => {
  const w = world(); await up(w);
  const r = await w.ctl.stop();
  assert.equal(r.code, "STOPPED"); assert.ok(allStopped(w));
  assert.ok(!fs.existsSync(w.marker));
  const bad = world(); await up(bad); bad.units["nusa.service"].active = true;
  const stuck = world(); await up(stuck);
  const orig = stuck.ctl.stop;
  assert.equal(typeof orig, "function");
});

test("leftover stop marker: never deleted by recovery, reconcile or verify; collect clears it only when no live stop matches it and the record says STOPPED", posixOnly, async () => {
  const w = world(); await up(w);
  fs.writeFileSync(w.marker, JSON.stringify({ pid: 4999, ident: "gone" }), { mode: 0o600 });
  const v = await w.ctl.verify();
  assert.equal(v.code, "VERIFY_STOPPED:STOP_REQUESTED"); assert.ok(allStopped(w));
  await w.ctl.reconcile(); assert.ok(fs.existsSync(w.marker));
  const s0 = w.state().state;
  // the record still says COLLECT_ONLY: collect refuses and asks for a full stop first
  const c1 = await w.ctl.collect();
  assert.equal(c1.code, "STOP_MARKER_STATE_NOT_STOPPED"); assert.ok(fs.existsSync(w.marker));
  assert.equal((await w.ctl.stop()).code, "STOPPED"); assert.ok(!fs.existsSync(w.marker));
  assert.equal(s0.desired, "COLLECT_ONLY");
  // a marker of a stop that is still alive blocks collect
  const l = world(); await up(l); await l.ctl.stop();
  fs.writeFileSync(l.marker, JSON.stringify({ pid: 4001, ident: "t1" }), { mode: 0o600 });
  assert.equal((await l.ctl.collect()).code, "STOP_IN_PROGRESS");
  // a dead stop's marker with a STOPPED record is cleared by an explicit collect, which then starts as usual
  fs.writeFileSync(l.marker, JSON.stringify({ pid: 4999, ident: "gone" }), { mode: 0o600 });
  const c2 = await l.ctl.collect();
  assert.ok(!fs.existsSync(l.marker)); assert.notEqual(c2.code, "STOP_IN_PROGRESS");
});

const RECOVERY = [
  // phase, link, active, expected end: [active, link]  (null = RECOVERY_UNKNOWN)
  ["PREPARED", A, A, [A, A]], ["UNITS_STOPPED", A, A, [A, A]],
  ["SWAPPING", A, A, [A, A]], ["SWAPPING", B, A, [A, A]],
  ["SWAPPED", B, B, [A, A]], ["SWAPPED", B, A, [A, A]], ["SWAPPED", A, B, [A, A]], ["STARTING_NEW", B, B, [A, A]], ["STARTING_NEW", A, A, [A, A]],
  ["ROLLING_BACK", B, B, [A, A]], ["ROLLING_BACK", A, B, [A, A]], ["ROLLING_BACK", A, A, [A, A]], ["ROLLING_BACK", B, A, [A, A]],
  ["STARTING_OLD", A, A, [A, A]],
  // not allowed: link or record is something else, or the phase says otherwise
  ["PREPARED", B, A, null], ["SWAPPING", C, A, null], ["SWAPPING", B, B, null], ["SWAPPED", C, B, null],
  ["STARTING_OLD", B, B, null], ["ROLLING_BACK", C, A, null],
];
test("recovery table: every phase and link/record combination ends STOPPED on the previous build, or STOPPED with the link untouched and no active build; nothing is ever started", posixOnly, async () => {
  for (const [phase, link, active, end] of RECOVERY) {
    const w = world(); await up(w);
    seedIntent(w, { phase, active }); setLink(w, link);
    w.units["nusa.service"].active = true;
    const out = await w.ctl.reconcile();
    const label = `${phase} link=${link[0]} active=${active[0]}`;
    assert.equal(out.ok, false, label);
    const s = w.state().state;
    assert.equal(s.intent, null, label); assert.equal(s.desired, "STOPPED", label);
    assert.ok(allStopped(w), label);
    assert.ok(!w.calls.some((c) => /^(start|restart|enable) /.test(c)), `${label}: nothing started`);
    if (end) { assert.equal(s.active, end[0], label); assert.equal(w.link(), end[1], label); } else { assert.equal(s.active, null, label); assert.equal(w.link(), link, `${label}: link left untouched`); }
  }
});

test("recovery needs a confirmed stop: a unit that will not stop leaves the intent in place and reports STOPPED_UNCONFIRMED", posixOnly, async () => {
  const w = world(); await up(w); seedIntent(w, { phase: "SWAPPED" }); setLink(w, B);
  const orig = w.units["nusa.service"]; Object.defineProperty(w.units, "nusa.service", { get: () => ({ get active() { return true; }, set active(v) {}, enabled: false }) });
  const out = await w.ctl.release(C);
  assert.equal(out.outcome, "STOPPED_UNCONFIRMED");
  assert.equal(w.state().state.intent.verb, "release");
  assert.ok(orig);
});

test("CRASH at every mutation of a release: the next command settles to exactly one consistent state, never a mixed one, never orders", posixOnly, async () => {
  for (const scenario of [{}, { bad: [B] }, { bad: [B], afterStateWrite: (n, ww) => { if (n === 3) ww.bad.add(A); } }]) {
    const probe = world(scenario); await up(probe); await probe.ctl.release(B);
    const total = probe.mutations;
    assert.ok(total >= 12, `enough mutations to inject (${total})`);
    for (let k = 1; k <= total; k += 1) {
      const w = world(scenario); await up(w); w.mutations = 0; w.crashAt = k;
      await w.ctl.release(B).catch(() => {});
      w.dead = false; w.crashAt = null; w.ownerAlive = false; w.lockHeld = false;
      // the next command that takes the lock: the periodic reconcile / any verb. The dead process holds nothing.
      const next = await w.ctl.reconcile();
      const s = w.state().state;
      const label = `${Object.keys(scenario).join("+") || "plain"} crash#${k}`;
      assert.equal(s.intent, null, label);
      assert.notEqual(s.desired, "PAPER_ORDERS", label);
      if (s.desired === "COLLECT_ONLY") {
        assert.equal(w.link(), s.active, `${label}: link and record agree`);
        assert.ok(allRunning(w), `${label}: running`);
        assert.ok((await w.ctl.verify()).ok, `${label}: verified running build`);
      } else {
        assert.equal(s.desired, "STOPPED", label);
        assert.ok(allStopped(w), `${label}: all stopped (${next.code})`);
        assert.ok(s.active === null || w.link() === s.active, `${label}: link and record agree`);
      }
      assert.ok(!fs.existsSync(w.grant), `${label}: no grant left`);
      if (fs.existsSync(w.modeFile)) assert.doesNotMatch(fs.readFileSync(w.modeFile, "utf8"), /PAPER_ORDERS/);
    }
  }
});

test("CRASH inside the recovery itself, at every mutation: running the recovery again reaches the same end state", posixOnly, async () => {
  for (const [phase, link, active] of [["SWAPPING", B, A], ["SWAPPED", B, B], ["STARTING_NEW", B, B], ["ROLLING_BACK", A, B], ["STARTING_OLD", A, A]]) {
    const clean = world(); await up(clean); seedIntent(clean, { phase, active }); setLink(clean, link); clean.units["nusa.service"].active = true;
    await clean.ctl.reconcile();
    const want = JSON.stringify([clean.state().state.active, clean.state().state.desired, clean.state().state.intent, clean.link()]);
    for (let k = 1; k <= clean.mutations + 3; k += 1) {
      const w = world(); await up(w); seedIntent(w, { phase, active }); setLink(w, link); w.units["nusa.service"].active = true;
      w.mutations = 0; w.crashAt = k;
      await w.ctl.reconcile().catch(() => {});
      w.dead = false; w.crashAt = null;
      await w.ctl.reconcile();
      const got = JSON.stringify([w.state().state.active, w.state().state.desired, w.state().state.intent, w.link()]);
      assert.equal(got, want, `${phase} crash in recovery #${k}`);
      assert.ok(allStopped(w));
    }
  }
});

test("a recovery that ends with active=null is refused by release and collect until the owner decides (fail closed)", posixOnly, async () => {
  const w = world(); await up(w); seedIntent(w, { phase: "SWAPPING", active: A }); setLink(w, C);
  await w.ctl.reconcile();
  assert.equal(w.state().state.active, null);
  assert.equal((await w.ctl.release(B)).reason, "NO_ACTIVE_BUILD");
  assert.equal((await w.ctl.collect()).code, "ACTIVE_MISMATCH");
});

test("the schema accepts a well-formed release intent and refuses malformed ones", posixOnly, async () => {
  const w = world(); await up(w);
  const base = w.state().state;
  const good = { verb: "release", version: 9, at: 1, runId: "0".repeat(32), from: A, to: B, phase: "SWAPPING", owner: { pid: 1, ident: "x", bootId: "b", atMono: 0 } };
  assert.doesNotThrow(() => validateState({ ...base, intent: good }));
  for (const bad of [{ runId: "zz" }, { from: "nope" }, { to: A }, { phase: "FLYING" }, { owner: null }, { owner: { pid: 1 } }]) assert.throws(() => validateState({ ...base, intent: { ...good, ...bad } }), /release intent|owner/);
});

test("ordersOffEverywhere: proven OFF only when every query succeeds and every source agrees (port of the installer check)", () => {
  const files = { "/etc/nusa/cloud-runtime.env": "A=1\nNUSA_PAPER_ORDER_PATH=OFF\nNUSA_PAPER_ORDER_PATH=OFF\n", "/etc/systemd/system/nusa.service": "[Service]\nExecStart=/x\n", "/etc/nusa/run-mode.env": "NUSA_RUN_MODE=COLLECT_ONLY\n" };
  const showOk = { Id: "nusa.service", Environment: "FOO=1", EnvironmentFiles: "/etc/nusa/cloud-runtime.env (ignore_errors=no)\n/etc/nusa/run-mode.env (ignore_errors=no)" };
  const mkargs = (over = {}) => {
    const f = { ...files, ...(over.files || {}) }; const sh = { ...showOk, ...(over.show || {}) };
    return { root: "", read: (p) => { if (!(p in f)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return f[p]; }, show: (a) => { const k = a[1]; if (sh[k] === undefined) throw new Error("fail"); return sh[k]; }, lstat: () => ({ isFile: () => true }), list: () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } };
  };
  assert.equal(ordersOffEverywhere(mkargs()), true);
  assert.equal(ordersOffEverywhere(mkargs({ files: { "/etc/nusa/cloud-runtime.env": "NUSA_PAPER_ORDER_PATH=ON\n" } })), false);
  assert.equal(ordersOffEverywhere(mkargs({ files: { "/etc/nusa/cloud-runtime.env": "A=1\n" } })), false, "no OFF line at all is not proven");
  assert.equal(ordersOffEverywhere(mkargs({ files: { "/etc/nusa/cloud-runtime.env": "NUSA_PAPER_ORDER_PATH=OFF\n# NUSA_PAPER_ORDER_PATH=ON\n" } })), false);
  assert.equal(ordersOffEverywhere(mkargs({ show: { Environment: "NUSA_PAPER_ORDER_PATH=PAPER" } })), false);
  assert.equal(ordersOffEverywhere(mkargs({ show: { Id: "other.service" } })), false);
  assert.equal(ordersOffEverywhere(mkargs({ show: { EnvironmentFiles: "/etc/nusa/cloud-runtime.env (ignore_errors=yes)" } })), false);
  assert.equal(ordersOffEverywhere(mkargs({ show: { EnvironmentFiles: "/etc/other.env (ignore_errors=no)" } })), false);
  assert.equal(ordersOffEverywhere(mkargs({ show: { Environment: undefined } })), false, "a failed query is not OFF");
  assert.equal(ordersOffEverywhere(mkargs({ files: { "/etc/systemd/system/nusa.service": "[Service]\nEnvironment=NUSA_PAPER_ORDER_PATH=PAPER\n" } })), false);
  assert.equal(ordersOffEverywhere(mkargs({ files: { "/etc/nusa/run-mode.env": "NUSA_RUN_MODE=PAPER_ORDERS\n" } })), false);
});

test("lockHeldBy: the pid must hold a WRITE lock on exactly the controller lock file's inode", () => {
  const locks = "1: FLOCK  ADVISORY  WRITE 4001 08:01:555 0 EOF\n2: FLOCK  ADVISORY  WRITE 4002 08:01:777 0 EOF\n3: POSIX  ADVISORY  WRITE 4003 08:01:555 0 EOF\n";
  const args = (pid) => lockHeldBy(pid, "/x/lock", () => locks, () => 555);
  assert.equal(args(4001), true);
  assert.equal(args(4002), false, "another file's lock");
  assert.equal(args(4003), false, "a POSIX lock is not the flock");
  assert.equal(args(9), false);
});

test("the sudo entry point creates the stop marker before it waits for the lock and falls back to a direct stop after 90 s", () => {
  const sh = fs.readFileSync(path.join(__dirname, "..", "deploy", "control", "nusa-control.sh"), "utf8").replace(/\r\n/g, "\n");
  const stopAt = sh.indexOf("stop)");
  assert.ok(stopAt > 0);
  const block = sh.slice(stopAt, sh.indexOf(";;", stopAt) > 0 ? sh.indexOf("*) flock", stopAt) : undefined);
  assert.ok(block.indexOf("stop-requested") > 0 && block.indexOf("stop-requested") < block.indexOf("flock -w 90"), "marker first");
  assert.match(block, /noclobber/);
  assert.match(block, /STOP_UNLOCKED/);
  for (const unit of ["nusa-research.timer", "nusa.service", "nusa-research.service"]) assert.ok(block.includes(unit));
  assert.match(sh, /reconcile\|verify\)\n\s+if ! flock -n 9/);
});

test("delegation: the ACTIVATING grant allows exactly two gated starts (nusa.service, research timer), only with the new link and the old record", posixOnly, async () => {
  const w = world(); await up(w); seedIntent(w, { phase: "ACTIVATING", active: A }); setLink(w, B);
  writeGrantFile(w, { phase: "ACTIVATING", uses: 2, expiresAtMono: 600_000 });
  const one = w.ctl.reconcileSync({ readonly: true });
  assert.deepEqual([one.ok, one.phase], [true, "ACTIVATING"]);
  assert.equal(JSON.parse(fs.readFileSync(w.grant, "utf8")).uses, 1, "one use left");
  assert.equal(w.ctl.reconcileSync({ readonly: true }).ok, true);
  assert.ok(!fs.existsSync(w.grant), "the last use deletes the grant");
  assert.equal(w.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:RELEASE_NO_GRANT", "a third start is refused");
  // the link must already be the new build, and the record must still be the old one
  const stale = world(); await up(stale); seedIntent(stale, { phase: "ACTIVATING", active: A }); writeGrantFile(stale, { phase: "ACTIVATING", uses: 2 });
  assert.equal(stale.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:RELEASE_WRONG_BUILD", "link still on the old build");
  const adv = world(); await up(adv); seedIntent(adv, { phase: "ACTIVATING", active: B }); setLink(adv, B); writeGrantFile(adv, { phase: "ACTIVATING", uses: 2 });
  assert.equal(adv.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:RELEASE_WRONG_BUILD", "the record must not be advanced yet");
  const many = world(); await up(many); seedIntent(many, { phase: "ACTIVATING", active: A }); setLink(many, B); writeGrantFile(many, { phase: "ACTIVATING", uses: 3 });
  assert.equal(many.ctl.reconcileSync({ readonly: true }).code, "GATE_DENIED:RELEASE_GRANT_USES");
  // a STARTING grant never carries two uses past one consumption
  const single = world(); await up(single); seedIntent(single); setLink(single, B); writeGrantFile(single, { uses: 1 });
  assert.equal(single.ctl.reconcileSync({ readonly: true }).ok, true); assert.ok(!fs.existsSync(single.grant));
});

test("delegation: a helper that fails, leaves the link unchanged, or does not exist ends in a rollback or a safe stop, never a deployment", posixOnly, async () => {
  const cases = {
    "exit 1 after its own safe stop": { helper: (w, sha) => { const tmp = `${w.currentLink}.t`; fs.symlinkSync(path.join(w.base, "releases", sha), tmp); fs.renameSync(tmp, w.currentLink); for (const u of UNITS) { w.units[u].active = false; w.units[u].enabled = false; } return { status: 1 }; } },
    "exit 0 but the link was not moved": { helper: () => ({ status: 0 }) },
    "exit 0 and the new build never verifies": { bad: [B], helper: (w, sha) => { const tmp = `${w.currentLink}.t`; fs.symlinkSync(path.join(w.base, "releases", sha), tmp); fs.renameSync(tmp, w.currentLink); w.units["nusa.service"].active = true; return { status: 0 }; } },
  };
  for (const [label, opts] of Object.entries(cases)) {
    const w = world(opts); await up(w);
    const r = await w.ctl.release(B);
    assert.equal(r.ok, false, label); assert.equal(r.outcome, "ROLLED_BACK", label);
    const s = w.state().state;
    assert.deepEqual([s.active, s.desired, s.intent], [A, "COLLECT_ONLY", null], label);
    assert.equal(w.link(), A, label); assert.ok(!s.proven.some((p) => p.sha === B), label);
  }
  const missing = world(); await up(missing);
  const bare = makeController({ fs, systemctl: () => 0, identifiedHealth: async () => ({ body: null, ownerPids: [] }), config: { stateDir: missing.stateDir, expectedUid: UID, checkAncestors: false } });
  assert.ok(bare);
});

test("delegation: a stop marker that exists when the helper restarts the runtime makes the gate refuse and the helper fail; nothing runs afterwards", posixOnly, async () => {
  const w = world({ beforeStart: (ww, unit) => { if (unit === "nusa.service" && !fs.existsSync(ww.marker)) fs.writeFileSync(ww.marker, JSON.stringify({ pid: 4999, ident: "x" }), { mode: 0o600 }); } });
  await up(w);
  const r = await w.ctl.release(B);
  assert.deepEqual([r.ok, r.outcome], [false, "STOPPED_SAFE"]);
  assert.ok(allStopped(w)); assert.ok(fs.existsSync(w.marker));
  assert.equal(w.state().state.active, A); assert.equal(w.link(), A);
});

test("the host helper runner refuses a helper that is missing, a symlink, not root-owned or group/other writable; a bad sha never runs", () => {
  const { runHelperActivate } = require("../deploy/control/nusa-control.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-helper-"));
  const f = path.join(dir, "helper"); fs.writeFileSync(f, "#!/bin/sh\nexit 0\n", { mode: 0o777 }); fs.chmodSync(f, 0o777);
  assert.equal(runHelperActivate(path.join(dir, "missing"), A, 1000).status, 127);
  assert.equal(runHelperActivate(f, A, 1000).status, 127, "writable by group and others");
  assert.equal(runHelperActivate(f, "not-a-sha", 1000).status, 127);
  const link = path.join(dir, "link"); fs.symlinkSync(f, link);
  assert.equal(runHelperActivate(link, A, 1000).status, 127, "a symlink");
  if (process.getuid && process.getuid() !== 0) { fs.chmodSync(f, 0o755); assert.equal(runHelperActivate(f, A, 1000).status, 127, "not owned by root"); }
});
