"use strict";
// The whole state table of deploy/control/nusa-control.js (design v5 section 3), run with a real temp filesystem, a fake
// systemd and a fake clock and health endpoint. Plus a property test over random verb sequences with injected faults.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeController, validateState, stateStore, UNITS } = require("../deploy/control/nusa-control.js");

const SHA = "c".repeat(40);
const OTHER = "d".repeat(40);

function world({ healthModes = [], stuck = [], failVerbs = {} } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-control-"));
  const stateDir = path.join(base, "state"); fs.mkdirSync(stateDir, { mode: 0o700 });
  const etc = path.join(base, "etc"); fs.mkdirSync(etc);
  fs.mkdirSync(path.join(base, "releases", SHA), { recursive: true });
  fs.mkdirSync(path.join(base, "releases", OTHER), { recursive: true });
  const currentLink = path.join(base, "current");
  fs.symlinkSync(path.join(base, "releases", SHA), currentLink);
  const units = Object.fromEntries(UNITS.map((u) => [u, { active: true, enabled: true }]));
  const calls = [];
  let clock = 1_000_000;
  const queue = [...healthModes];
  const systemctl = (args) => {
    calls.push(args.join(" "));
    const [verb, ...rest] = args;
    const unit = rest.filter((a) => a !== "--quiet")[0];
    if (failVerbs[verb] && failVerbs[verb].includes(unit)) return 1;
    const u = units[unit];
    if (!u) return 4;
    switch (verb) {
      case "stop": if (!stuck.includes(unit)) u.active = false; return 0;
      case "disable": if (!stuck.includes(unit)) u.enabled = false; return 0;
      case "enable": u.enabled = true; return 0;
      case "start": case "restart": u.active = true; return 0;
      case "is-active": return u.active ? 0 : 3;
      case "is-enabled": return u.enabled ? 0 : 1;
      default: return 1;
    }
  };
  const health = async () => {
    const m = queue.length > 0 ? queue.shift() : null;
    if (m === undefined || m === null) return null;
    const [runMode, build] = m.split("@");
    return { runtime: { runMode, sourceCommitSha: build === undefined ? SHA : build } };
  };
  const ctl = makeController({ systemctl, health, now: () => clock, sleep: async (ms) => { clock += ms; }, config: { stateDir, modeFile: path.join(etc, "run-mode.env"), currentLink, startCeilingMs: 60_000, pollMs: 5_000 } });
  const store = stateStore(fs, stateDir);
  return { base, stateDir, etc, currentLink, units, calls, ctl, store, setLink: (sha) => { fs.rmSync(currentLink); fs.symlinkSync(path.join(base, "releases", sha), currentLink); }, modeFile: path.join(etc, "run-mode.env") };
}
const allStopped = (w) => UNITS.every((u) => !w.units[u].active) && ["nusa.service", "nusa-research.timer"].every((u) => !w.units[u].enabled);

test("init records the running build as adopted and STOPPED; it never overwrites an existing or broken state file", async () => {
  const w = world();
  assert.equal((await w.ctl.init(SHA)).code, "INITIALISED");
  const s = w.store.read().state;
  assert.equal(s.desired, "STOPPED"); assert.equal(s.active, SHA); assert.equal(s.adopted, true); assert.equal(s.version, 1);
  assert.equal((await w.ctl.init(SHA)).code, "ALREADY_INITIALISED");
  const broken = world();
  fs.writeFileSync(path.join(broken.stateDir, "state.json"), "{not json");
  assert.equal((await broken.ctl.init(SHA)).code, "STATE_NOT_JSON");
  assert.equal(fs.readFileSync(path.join(broken.stateDir, "state.json"), "utf8"), "{not json", "the broken file is kept for diagnosis");
  const mismatch = world();
  assert.equal((await mismatch.ctl.init(OTHER)).code, "ACTIVE_MISMATCH");
  assert.equal((await mismatch.ctl.init("nope")).code, "BAD_SHA");
});

test("stop disables and stops every owned unit, verifies, and records STOPPED with two versioned writes", async () => {
  const w = world(); await w.ctl.init(SHA);
  const r = await w.ctl.stop();
  assert.equal(r.ok, true); assert.equal(r.code, "STOPPED");
  assert.ok(allStopped(w));
  const s = w.store.read().state;
  assert.equal(s.desired, "STOPPED"); assert.equal(s.intent, null); assert.equal(s.version, 3);
  assert.equal(w.units["nusa.service"].active, false);
});

test("stop works without a valid state file (stopping is always allowed) and says so", async () => {
  const w = world();
  const r = await w.ctl.stop();
  assert.equal(r.ok, true); assert.equal(r.code, "STOPPED_WITH_STATE_MISSING");
  assert.ok(allStopped(w));
});

test("a unit that does not stop or stays enabled, or a failing command, is STOP_NOT_CONFIRMED and the intent stays pending", async () => {
  const w = world({ stuck: ["nusa.service"] }); await w.ctl.init(SHA);
  const r = await w.ctl.stop();
  assert.equal(r.ok, false); assert.equal(r.code, "STOP_NOT_CONFIRMED");
  assert.ok(r.problems.some((p) => p.startsWith("nusa.service")));
  assert.equal(w.store.read().state.intent.verb, "stop", "the boot reconcile will finish it");
  const f = world({ failVerbs: { stop: ["nusa-research.service"] } }); await f.ctl.init(SHA);
  f.units["nusa-research.service"].active = false;
  assert.equal((await f.ctl.stop()).code, "STOP_NOT_CONFIRMED", "a failing stop command is never confirmed even if the unit looks inactive");
});

test("collect writes the mode file, starts the units and accepts only when /health reports COLLECT_ONLY", async () => {
  const w = world({ healthModes: [null, null, "COLLECT_ONLY"] }); await w.ctl.init(SHA); await w.ctl.stop();
  const r = await w.ctl.collect();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(w.modeFile, "utf8"), "NUSA_RUN_MODE=COLLECT_ONLY\n");
  assert.equal(w.units["nusa.service"].active, true); assert.equal(w.units["nusa.service"].enabled, true);
  assert.equal(w.store.read().state.desired, "COLLECT_ONLY");
});

test("collect is refused (nothing touched) with an invalid state, a different running build, or an unproven non-adopted build", async () => {
  const invalid = world();
  fs.writeFileSync(path.join(invalid.stateDir, "state.json"), JSON.stringify({ schemaVersion: 1 }));
  assert.match((await invalid.ctl.collect()).code, /^STATE_INVALID/);
  assert.equal(invalid.calls.length, 0, "no systemctl call");
  const moved = world(); await moved.ctl.init(SHA); moved.setLink(OTHER);
  assert.equal((await moved.ctl.collect()).code, "ACTIVE_MISMATCH");
  const unproven = world(); await unproven.ctl.init(SHA);
  const s = unproven.store.read().state;
  unproven.store.write(s.version, { ...s, version: s.version + 1, adopted: false });
  assert.equal((await unproven.ctl.collect()).code, "ACTIVE_NOT_PROVEN");
  assert.equal(fs.existsSync(unproven.modeFile), false);
});

test("collect that never reaches COLLECT_ONLY within the ceiling, or sees PAPER_ORDERS, ends STOPPED", async () => {
  for (const modes of [[], ["PAPER_ORDERS"]]) {
    const w = world({ healthModes: modes }); await w.ctl.init(SHA);
    const r = await w.ctl.collect();
    assert.equal(r.ok, false); assert.equal(r.stopped, true, JSON.stringify(r));
    assert.ok(allStopped(w));
    assert.equal(w.store.read().state.desired, "STOPPED");
    assert.equal(w.store.read().state.intent, null);
  }
});

test("collect where a unit cannot be enabled or started ends STOPPED", async () => {
  for (const failVerbs of [{ enable: ["nusa.service"] }, { restart: ["nusa.service"] }, { start: ["nusa-research.timer"] }]) {
    const w = world({ failVerbs, healthModes: ["COLLECT_ONLY"] }); await w.ctl.init(SHA);
    const r = await w.ctl.collect();
    assert.equal(r.ok, false); assert.ok(allStopped(w), JSON.stringify(failVerbs));
  }
});

test("boot reconcile: invalid or missing state, a pending intent, or a moved release pointer all end STOPPED; a consistent COLLECT_ONLY is kept", async () => {
  const missing = world();
  assert.match((await missing.ctl.reconcile()).code, /RECONCILED_STOPPED:STATE_MISSING/); assert.ok(allStopped(missing));
  const pending = world({ stuck: ["nusa.service"] }); await pending.ctl.init(SHA); await pending.ctl.stop();
  pending.units["nusa.service"].active = true;
  const pendingFixed = world(); await pendingFixed.ctl.init(SHA);
  const s0 = pendingFixed.store.read().state;
  pendingFixed.store.write(s0.version, { ...s0, version: s0.version + 1, desired: "COLLECT_ONLY", intent: { verb: "collect", version: s0.version + 1, at: 1 } });
  const r = await pendingFixed.ctl.reconcile();
  assert.match(r.code, /MISMATCH_OR_PENDING_INTENT/); assert.ok(allStopped(pendingFixed));
  assert.equal(pendingFixed.store.read().state.desired, "STOPPED");
  const moved = world({ healthModes: ["COLLECT_ONLY"] }); await moved.ctl.init(SHA); await moved.ctl.collect();
  moved.setLink(OTHER);
  assert.match((await moved.ctl.reconcile()).code, /MISMATCH/); assert.ok(allStopped(moved));
  const kept = world({ healthModes: ["COLLECT_ONLY"] }); await kept.ctl.init(SHA); await kept.ctl.collect();
  fs.writeFileSync(path.join(kept.stateDir, ".state.123.456.tmp"), "half");
  const k = await kept.ctl.reconcile();
  assert.equal(k.code, "COLLECT_ONLY_KEPT"); assert.equal(k.quarantined, 1);
  assert.equal(fs.existsSync(path.join(kept.stateDir, "quarantine-state.123.456.tmp")), true);
});

test("compare-and-swap: a write based on an old version is refused", () => {
  const w = world();
  fs.writeFileSync(path.join(w.stateDir, "state.json"), JSON.stringify({ schemaVersion: 1, version: 5, desired: "STOPPED", active: SHA, adopted: true, proven: [], attempt: null, grant: null, intent: null }));
  const s = w.store.read().state;
  assert.throws(() => w.store.write(4, { ...s, version: 5 }), /STATE_CONFLICT|changed underneath/);
  assert.throws(() => w.store.write(5, { ...s, version: 7 }), /exactly one/);
});

test("the state schema refuses PAPER_ORDERS, a grant, an attempt, unknown fields and bad SHAs in this version", () => {
  const base = { schemaVersion: 1, version: 1, desired: "STOPPED", active: SHA, adopted: true, proven: [], attempt: null, grant: null, intent: null };
  assert.doesNotThrow(() => validateState(base));
  for (const bad of [{ desired: "PAPER_ORDERS" }, { grant: { sha: SHA } }, { attempt: { sha: SHA } }, { extra: 1 }, { active: "x" }, { version: 0 }, { proven: [{ sha: "x", evidence: "e" }] }]) {
    assert.throws(() => validateState({ ...base, ...bad }), /./, JSON.stringify(bad));
  }
});

test("release and grant-orders are not available in this version", async () => {
  const w = world();
  assert.equal((await w.ctl.release(SHA)).code, "NOT_AVAILABLE");
  assert.equal((await w.ctl["grant-orders"](SHA)).code, "NOT_AVAILABLE");
  assert.equal(w.calls.length, 0);
});

// Property test: random verb sequences with random faults. Invariants after every step:
//  1. the state file is valid unless the test itself corrupted it; its version never decreases;
//  2. desired is never PAPER_ORDERS and the mode file never names PAPER_ORDERS;
//  3. a failed collect leaves every owned unit stopped or reports problems;
//  4. a successful collect only happens when the running build equals the recorded active build.
test("property: no sequence of verbs and faults reaches orders, loses the state, or half-starts silently", async () => {
  let seed = 20261115;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  for (let run = 0; run < 150; run += 1) {
    const modes = Array.from({ length: 40 }, () => pick([null, "COLLECT_ONLY", "COLLECT_ONLY", "PAPER_ORDERS", "STARTING"]));
    const w = world({ healthModes: modes, stuck: rand() < 0.2 ? [pick(UNITS)] : [], failVerbs: rand() < 0.2 ? { [pick(["enable", "restart", "start", "stop", "disable"])]: [pick(UNITS)] } : {} });
    let corrupted = false;
    let lastVersion = 0;
    if (rand() < 0.9) await w.ctl.init(SHA);
    for (let step = 0; step < 12; step += 1) {
      const action = pick(["stop", "collect", "collect", "reconcile", "status", "move", "corrupt", "restore"]);
      if (action === "move") { w.setLink(pick([SHA, OTHER])); continue; }
      if (action === "corrupt") { if (rand() < 0.3) { fs.writeFileSync(path.join(w.stateDir, "state.json"), "{"); corrupted = true; } continue; }
      if (action === "restore") continue;
      const r = await w.ctl[action]();
      const st = w.store.read();
      if (!corrupted && lastVersion > 0) assert.ok(st.ok, `state stays valid (run ${run} step ${step} ${action})`);
      if (st.ok) { assert.ok(st.state.version >= lastVersion, "version never decreases"); lastVersion = st.state.version; assert.notEqual(st.state.desired, "PAPER_ORDERS"); }
      if (fs.existsSync(w.modeFile)) assert.doesNotMatch(fs.readFileSync(w.modeFile, "utf8"), /PAPER_ORDERS/);
      if (action === "collect" && !r.ok && r.stopped !== undefined) assert.ok(r.stopped ? allStopped(w) : r.problems.length > 0, `failed collect is stopped or reported (run ${run})`);
      if (action === "collect" && r.ok) assert.equal(path.basename(fs.readlinkSync(w.currentLink)), st.state.active);
    }
  }
});

test("collect accepts COLLECT_ONLY only from the recorded build: a stale or foreign process on the port is a mismatch and ends STOPPED", async () => {
  const w = world({ healthModes: [`COLLECT_ONLY@${OTHER}`] }); await w.ctl.init(SHA);
  const r = await w.ctl.collect();
  assert.equal(r.ok, false); assert.equal(r.code, "BUILD_MISMATCH"); assert.ok(allStopped(w));
  const noBuild = world({ healthModes: ["COLLECT_ONLY@"] }); await noBuild.ctl.init(SHA);
  assert.equal((await noBuild.ctl.collect()).ok, false, "an answer without the build identity is not accepted");
});
