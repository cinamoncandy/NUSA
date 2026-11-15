"use strict";
// The whole C1 state table of deploy/control/nusa-control.js (design v5 section 3), run with a real temp filesystem, a
// fake systemd, a fake health endpoint, a fake process table and fake clocks; plus file-safety attacks and a property
// test over random verb sequences with injected faults.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeController, validateState, stateStore, writeModeFile, UNITS } = require("../deploy/control/nusa-control.js");

const SHA = "c".repeat(40);
const OTHER = "d".repeat(40);
const UID = process.getuid ? process.getuid() : 0;
const posixOnly = process.platform === "win32" ? { skip: "the controller runs only on the Linux host" } : {};

function world(opts = {}) {
  const { healthAnswers = [], stuck = [], failVerbs = {}, listener = "nusa", fsOverrides = {} } = opts;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-control-"));
  const stateDir = path.join(base, "state"); fs.mkdirSync(stateDir); fs.chmodSync(stateDir, 0o700);
  const etc = path.join(base, "etc"); fs.mkdirSync(etc); fs.chmodSync(etc, 0o755);
  for (const sha of [SHA, OTHER]) fs.mkdirSync(path.join(base, "releases", sha), { recursive: true });
  const currentLink = path.join(base, "current");
  fs.symlinkSync(path.join(base, "releases", SHA), currentLink);
  const units = Object.fromEntries(UNITS.map((u) => [u, { active: true, enabled: true }]));
  const calls = [];
  let wall = 1_000_000; let mono = 0;
  const answers = [...healthAnswers];
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
  // An answer is "MODE@BUILD"; missing build means the recorded SHA. null means no answer.
  const health = async () => {
    const a = answers.length > 0 ? answers.shift() : null;
    if (a === null || a === undefined) return null;
    const [runMode, build] = a.split("@");
    return { runtime: { runMode, sourceCommitSha: build === undefined ? SHA : build } };
  };
  const w = { base, stateDir, etc, currentLink, units, calls, modeFile: path.join(etc, "run-mode.env"), listener };
  const fsx = { ...fs, ...fsOverrides };
  w.ctl = makeController({
    fs: fsx, systemctl, health,
    listenerPids: () => (w.listener === "none" ? [] : [4242]),
    cgroupOf: () => (w.listener === "nusa" ? "0::/system.slice/nusa.service" : "0::/user.slice/user-1000.slice/session-1.scope"),
    now: () => (opts.wallBackwards ? (wall -= 10_000) : wall),
    monotonic: () => mono,
    sleep: async (ms) => { mono += ms; wall += ms; },
    config: { stateDir, modeFile: w.modeFile, currentLink, startCeilingMs: 60_000, pollMs: 5_000, expectedUid: UID },
  });
  w.store = stateStore(fs, stateDir, UID);
  w.setLink = (sha) => { fs.rmSync(currentLink); fs.symlinkSync(path.join(base, "releases", sha), currentLink); };
  w.state = () => w.store.read();
  return w;
}
const allStopped = (w) => UNITS.every((u) => !w.units[u].active) && ["nusa.service", "nusa-research.timer"].every((u) => !w.units[u].enabled);
const seed = async (w) => { assert.equal((await w.ctl.init(SHA)).code, "INITIALISED_STOPPED"); w.calls.length = 0; };
const rawWrite = (w, patch) => { const s = w.state().state; w.store.write(s.version, { ...s, version: s.version + 1, ...patch }); };

test("init stops every owned unit first, then records the running build as adopted and STOPPED", posixOnly, async () => {
  const w = world();
  assert.equal((await w.ctl.init(SHA)).code, "INITIALISED_STOPPED");
  assert.ok(allStopped(w), "the record matches reality");
  const s = w.state().state;
  assert.deepEqual([s.desired, s.active, s.adopted, s.version], ["STOPPED", SHA, true, 1]);
  assert.equal((await w.ctl.init(SHA)).code, "ALREADY_INITIALISED");
});

test("init never overwrites a broken file, refuses a moved pointer, and records nothing if the units do not stop", posixOnly, async () => {
  const broken = world();
  fs.writeFileSync(path.join(broken.stateDir, "state.json"), "{not json");
  assert.equal((await broken.ctl.init(SHA)).code, "STATE_NOT_JSON");
  assert.equal(fs.readFileSync(path.join(broken.stateDir, "state.json"), "utf8"), "{not json");
  assert.equal((await world().ctl.init(OTHER)).code, "ACTIVE_MISMATCH");
  assert.equal((await world().ctl.init("nope")).code, "BAD_SHA");
  const stuck = world({ stuck: ["nusa.service"] });
  assert.equal((await stuck.ctl.init(SHA)).code, "STOP_NOT_CONFIRMED");
  assert.equal(stuck.state().reason, "STATE_MISSING");
});

test("stop stops and disables every owned unit, verifies, then records STOPPED", posixOnly, async () => {
  const w = world({ healthAnswers: ["COLLECT_ONLY"] }); await seed(w); await w.ctl.collect();
  const r = await w.ctl.stop();
  assert.equal(r.code, "STOPPED"); assert.equal(r.ok, true); assert.ok(allStopped(w));
  assert.equal(w.state().state.desired, "STOPPED");
});

test("stop still stops the units when the state file is missing or cannot be written, and says the state was not recorded", posixOnly, async () => {
  const missing = world();
  const r1 = await missing.ctl.stop();
  assert.equal(r1.code, "STOPPED_STATE_NOT_RECORDED"); assert.ok(allStopped(missing));
  const failing = world({ fsOverrides: { renameSync: () => { throw Object.assign(new Error("EIO"), { code: "EIO" }); } } });
  await seed(failing);
  for (const u of UNITS) { failing.units[u].active = true; failing.units[u].enabled = true; }
  const r2 = await failing.ctl.stop();
  assert.equal(r2.code, "STOPPED_STATE_NOT_RECORDED"); assert.equal(r2.ok, false); assert.ok(allStopped(failing), "units are stopped even though the record failed");
});

test("a unit that does not stop or stays enabled, or a failing command, is STOP_NOT_CONFIRMED", posixOnly, async () => {
  const w = world({ stuck: ["nusa.service"] });
  fs.writeFileSync(path.join(w.stateDir, "state.json"), JSON.stringify({ schemaVersion: 1, version: 1, desired: "COLLECT_ONLY", active: SHA, adopted: true, proven: [], attempt: null, grant: null, intent: null }), { mode: 0o600 });
  assert.equal((await w.ctl.stop()).code, "STOP_NOT_CONFIRMED");
  const f = world({ failVerbs: { stop: ["nusa-research.service"] } });
  assert.equal((await f.ctl.init(SHA)).code, "STOP_NOT_CONFIRMED", "init itself refuses to record while a stop fails");
  fs.writeFileSync(path.join(f.stateDir, "state.json"), JSON.stringify({ schemaVersion: 1, version: 1, desired: "COLLECT_ONLY", active: SHA, adopted: true, proven: [], attempt: null, grant: null, intent: null }), { mode: 0o600 });
  assert.equal((await f.ctl.stop()).code, "STOP_NOT_CONFIRMED", "a failing stop command is never confirmed even if the unit looks inactive");
});

test("collect writes the mode file, starts the units and accepts only a verified answer from nusa.service with the recorded build", posixOnly, async () => {
  const w = world({ healthAnswers: [null, "STARTING", "COLLECT_ONLY"] }); await seed(w);
  const r = await w.ctl.collect();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(w.modeFile, "utf8"), "NUSA_RUN_MODE=COLLECT_ONLY\n");
  assert.ok(w.units["nusa.service"].active && w.units["nusa.service"].enabled);
  assert.equal(w.state().state.desired, "COLLECT_ONLY");
});

test("collect ends STOPPED on a foreign listener, a different build, PAPER_ORDERS, a missing listener until the ceiling, or no answer", posixOnly, async () => {
  for (const [label, opts] of [
    ["foreign listener", { healthAnswers: ["COLLECT_ONLY"], listener: "foreign" }],
    ["other build", { healthAnswers: [`COLLECT_ONLY@${OTHER}`] }],
    ["orders", { healthAnswers: ["PAPER_ORDERS"] }],
    ["no listener", { healthAnswers: Array(20).fill("COLLECT_ONLY"), listener: "none" }],
    ["no answer", { healthAnswers: [] }],
  ]) {
    const w = world(opts); await seed(w);
    const r = await w.ctl.collect();
    assert.equal(r.ok, false, label); assert.equal(r.stopped, true, `${label}: ${JSON.stringify(r)}`);
    assert.ok(allStopped(w), label);
    assert.equal(w.state().state.desired, "STOPPED", label); assert.equal(w.state().state.intent, null, label);
  }
});

test("collect deadline uses the monotonic clock: a wall clock running backwards cannot extend it", posixOnly, async () => {
  const w = world({ healthAnswers: [], wallBackwards: true }); await seed(w);
  const r = await w.ctl.collect();
  assert.equal(r.code, "START_CEILING");
});

test("collect where a unit cannot be enabled or started ends STOPPED; a failed intent write changes nothing", posixOnly, async () => {
  for (const failVerbs of [{ enable: ["nusa.service"] }, { restart: ["nusa.service"] }, { start: ["nusa-research.timer"] }]) {
    const w = world({ failVerbs, healthAnswers: ["COLLECT_ONLY"] }); await seed(w);
    const r = await w.ctl.collect();
    assert.equal(r.ok, false); assert.ok(allStopped(w), JSON.stringify(failVerbs));
  }
  let renames = 0;
  const w = world({ fsOverrides: { renameSync: (...a) => { renames += 1; if (renames >= 1) throw Object.assign(new Error("EIO"), { code: "EIO" }); return fs.renameSync(...a); } } });
  await seed(w);
  const r = await w.ctl.collect();
  assert.equal(r.code, "EIO"); assert.equal(w.calls.length, 0, "no unit touched"); assert.equal(fs.existsSync(w.modeFile), false);
});

test("collect is refused (nothing touched) with an invalid state, a different running build, or an unproven non-adopted build", posixOnly, async () => {
  const invalid = world();
  fs.writeFileSync(path.join(invalid.stateDir, "state.json"), JSON.stringify({ schemaVersion: 1 }), { mode: 0o600 });
  assert.match((await invalid.ctl.collect()).code, /^STATE_INVALID/); assert.equal(invalid.calls.length, 0);
  const moved = world(); await seed(moved); moved.setLink(OTHER);
  assert.equal((await moved.ctl.collect()).code, "ACTIVE_MISMATCH"); assert.equal(moved.calls.length, 0);
  const unproven = world(); await seed(unproven); rawWrite(unproven, { adopted: false });
  assert.equal((await unproven.ctl.collect()).code, "ACTIVE_NOT_PROVEN"); assert.equal(fs.existsSync(unproven.modeFile), false);
});

test("compare-and-swap refuses to write over a deleted, corrupt or newer state file", posixOnly, () => {
  const w = world();
  const s = { schemaVersion: 1, version: 5, desired: "STOPPED", active: SHA, adopted: true, proven: [], attempt: null, grant: null, intent: null };
  fs.writeFileSync(path.join(w.stateDir, "state.json"), JSON.stringify(s), { mode: 0o600 });
  assert.throws(() => w.store.write(4, { ...s, version: 5 }), /changed underneath/);
  assert.throws(() => w.store.write(5, { ...s, version: 7 }), /exactly one/);
  fs.writeFileSync(path.join(w.stateDir, "state.json"), "{");
  assert.throws(() => w.store.write(5, { ...s, version: 6 }), /refusing to write over STATE_NOT_JSON/);
  fs.rmSync(path.join(w.stateDir, "state.json"));
  assert.throws(() => w.store.write(5, { ...s, version: 6 }), /refusing to write over STATE_MISSING/);
});

test("file safety: a symlinked or loose state directory, a symlinked state file, a symlinked mode file or a writable /etc dir are refused", posixOnly, async () => {
  const w = world(); await seed(w);
  const realDir = w.stateDir;
  const alias = path.join(w.base, "alias"); fs.symlinkSync(realDir, alias);
  assert.match(stateStore(fs, alias, UID).read().reason, /^STATE_DIR_UNSAFE/);
  fs.chmodSync(realDir, 0o755);
  assert.match(w.state().reason, /^STATE_DIR_UNSAFE/);
  fs.chmodSync(realDir, 0o700);
  const file = path.join(realDir, "state.json");
  fs.renameSync(file, path.join(w.base, "elsewhere.json")); fs.symlinkSync(path.join(w.base, "elsewhere.json"), file);
  assert.equal(w.state().reason, "STATE_UNSAFE");
  const victim = path.join(w.base, "victim"); fs.writeFileSync(victim, "keep");
  fs.symlinkSync(victim, w.modeFile);
  assert.throws(() => writeModeFile(fs, w.modeFile, "COLLECT_ONLY", UID), /not a regular file/);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep", "the symlink target is untouched");
  fs.rmSync(w.modeFile); fs.chmodSync(w.etc, 0o777);
  assert.throws(() => writeModeFile(fs, w.modeFile, "COLLECT_ONLY", UID), /writable by group or others/);
  assert.throws(() => writeModeFile(fs, w.modeFile, "PAPER_ORDERS", UID), /cannot be written/);
});

test("boot reconcile: missing or unsafe state, a pending intent, or a moved pointer end STOPPED; a consistent record only PERMITS the start", posixOnly, async () => {
  const missing = world();
  const m = await missing.ctl.reconcile();
  assert.match(m.code, /RECONCILED_STOPPED:STATE_MISSING/); assert.equal(m.ok, false); assert.ok(allStopped(missing));
  const pending = world(); await seed(pending); rawWrite(pending, { desired: "COLLECT_ONLY", intent: { verb: "collect", version: 3, at: 1 } });
  assert.match((await pending.ctl.reconcile()).code, /MISMATCH_OR_PENDING_INTENT/); assert.ok(allStopped(pending));
  assert.equal(pending.state().state.desired, "STOPPED");
  const moved = world({ healthAnswers: ["COLLECT_ONLY"] }); await seed(moved); await moved.ctl.collect(); moved.setLink(OTHER);
  assert.match((await moved.ctl.reconcile()).code, /MISMATCH/); assert.ok(allStopped(moved));
  const kept = world({ healthAnswers: ["COLLECT_ONLY"] }); await seed(kept); await kept.ctl.collect();
  fs.writeFileSync(path.join(kept.stateDir, ".state.json.1.x.tmp"), "half");
  const k = await kept.ctl.reconcile();
  assert.equal(k.code, "START_PERMITTED_COLLECT_ONLY"); assert.equal(k.quarantined, 1);
  const badEtc = world({ healthAnswers: ["COLLECT_ONLY"] }); await seed(badEtc); await badEtc.ctl.collect();
  fs.chmodSync(badEtc.etc, 0o777);
  const b = await badEtc.ctl.reconcile();
  assert.match(b.code, /RECONCILED_STOPPED:UNSAFE_PATH/); assert.ok(allStopped(badEtc), "an error inside reconcile ends STOPPED");
});

test("verify: a consistent running runtime passes; a dead runtime, a foreign listener, another build, or units running while STOPPED end STOPPED", posixOnly, async () => {
  const ok = world({ healthAnswers: ["COLLECT_ONLY", "COLLECT_ONLY"] }); await seed(ok); await ok.ctl.collect();
  assert.equal((await ok.ctl.verify()).code, "COLLECT_ONLY_VERIFIED");
  const dead = world({ healthAnswers: ["COLLECT_ONLY"] }); await seed(dead); await dead.ctl.collect(); dead.units["nusa.service"].active = false;
  assert.match((await dead.ctl.verify()).code, /RUNTIME_NOT_ACTIVE/); assert.ok(allStopped(dead));
  const foreign = world({ healthAnswers: ["COLLECT_ONLY", "COLLECT_ONLY"] }); await seed(foreign); await foreign.ctl.collect(); foreign.listener = "foreign";
  assert.match((await foreign.ctl.verify()).code, /FOREIGN_LISTENER/); assert.ok(allStopped(foreign));
  const other = world({ healthAnswers: ["COLLECT_ONLY", `COLLECT_ONLY@${OTHER}`] }); await seed(other); await other.ctl.collect();
  assert.match((await other.ctl.verify()).code, /BUILD_MISMATCH/); assert.ok(allStopped(other));
  const stray = world(); await seed(stray); stray.units["nusa.service"].active = true;
  assert.match((await stray.ctl.verify()).code, /UNIT_RUNNING_WHILE_STOPPED/); assert.ok(allStopped(stray));
});

test("the state schema refuses PAPER_ORDERS, a grant, an attempt, unknown fields and bad SHAs in this version", () => {
  const base = { schemaVersion: 1, version: 1, desired: "STOPPED", active: SHA, adopted: true, proven: [], attempt: null, grant: null, intent: null };
  assert.doesNotThrow(() => validateState(base));
  for (const bad of [{ desired: "PAPER_ORDERS" }, { grant: { sha: SHA } }, { attempt: { sha: SHA } }, { extra: 1 }, { active: "x" }, { version: 0 }, { proven: [{ sha: "x", evidence: "e" }] }, { intent: { verb: "init", version: 1, at: 1 } }]) {
    assert.throws(() => validateState({ ...base, ...bad }), /./, JSON.stringify(bad));
  }
});

test("release and grant-orders are not available in this version", posixOnly, async () => {
  const w = world();
  assert.equal((await w.ctl.release(SHA)).code, "NOT_AVAILABLE");
  assert.equal((await w.ctl["grant-orders"](SHA)).code, "NOT_AVAILABLE");
  assert.equal(w.calls.length, 0);
});

// Property test: random verb sequences with random faults. Invariants after every step:
//  1. the state file stays valid unless the test itself corrupted it, and its version never decreases;
//  2. desired is never PAPER_ORDERS and the mode file never names PAPER_ORDERS;
//  3. every non-ok result of collect, reconcile or verify either stopped every owned unit or reports problems;
//  4. a successful collect or verify only happens with the running build equal to the recorded one and a nusa listener.
test("property: no sequence of verbs and faults reaches orders, loses the state, or half-starts silently", posixOnly, async () => {
  let s = 20261115;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  for (let run = 0; run < 200; run += 1) {
    const answers = Array.from({ length: 60 }, () => pick([null, "COLLECT_ONLY", "COLLECT_ONLY", "PAPER_ORDERS", "STARTING", `COLLECT_ONLY@${OTHER}`]));
    const w = world({ healthAnswers: answers, stuck: rand() < 0.2 ? [pick(UNITS)] : [], failVerbs: rand() < 0.2 ? { [pick(["enable", "restart", "start", "stop", "disable"])]: [pick(UNITS)] } : {} });
    let corrupted = false; let lastVersion = 0;
    if (rand() < 0.9) await w.ctl.init(SHA);
    for (let step = 0; step < 15; step += 1) {
      const action = pick(["stop", "collect", "collect", "reconcile", "verify", "status", "move", "corrupt", "listener"]);
      if (action === "move") { w.setLink(pick([SHA, OTHER])); continue; }
      if (action === "corrupt") { if (rand() < 0.3) { fs.writeFileSync(path.join(w.stateDir, "state.json"), "{"); corrupted = true; } continue; }
      if (action === "listener") { w.listener = pick(["nusa", "nusa", "foreign", "none"]); continue; }
      const r = await w.ctl[action]();
      const st = w.state();
      if (!corrupted && lastVersion > 0) assert.ok(st.ok, `state stays valid (run ${run} step ${step} ${action})`);
      if (st.ok) { assert.ok(st.state.version >= lastVersion); lastVersion = st.state.version; assert.notEqual(st.state.desired, "PAPER_ORDERS"); }
      if (fs.existsSync(w.modeFile)) assert.doesNotMatch(fs.readFileSync(w.modeFile, "utf8"), /PAPER_ORDERS/);
      if (["collect", "reconcile", "verify"].includes(action) && !r.ok && r.stopped !== undefined) assert.ok(r.stopped ? allStopped(w) : r.problems.length > 0, `run ${run} ${action} ${r.code}`);
      if ((action === "collect" && r.ok) || r.code === "COLLECT_ONLY_VERIFIED") { assert.equal(path.basename(fs.readlinkSync(w.currentLink)), st.state.active); assert.equal(w.listener, "nusa"); }
    }
  }
});
