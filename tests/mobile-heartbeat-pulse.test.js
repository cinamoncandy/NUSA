"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const m = require("../dist/apps/mobile/src/heartbeatPulseModel.js");

test("a pulse happens only when a newer real heartbeat arrives", () => {
  assert.equal(m.shouldPulse(1000, 6000), true);
  assert.equal(m.shouldPulse(6000, 6000), false);
  assert.equal(m.shouldPulse(6000, 1000), false);
  assert.equal(m.shouldPulse(null, 6000), false, "the first value seen never pulses");
  assert.equal(m.shouldPulse(1000, null), false);
  assert.equal(m.shouldPulse(Number.NaN, 5), false);
});

test("resting glow fades with the real age of the last heartbeat and never invents freshness", () => {
  const now = 1_000_000;
  assert.equal(m.restingGlow(now - 5_000, now), 1);
  assert.equal(m.restingGlow(now - m.STALE_MS, now), 0.15);
  const mid = m.restingGlow(now - 37_500, now);
  assert.ok(mid > 0.15 && mid < 1);
  assert.equal(m.restingGlow(null, now), 0.15);
  assert.equal(m.restingGlow(now + 10_000, now), 0.15, "a future-dated stamp is not fresh");
  assert.equal(m.restingGlow(Number.NaN, now), 0.15);
});

test("the pulse is wired to the server heartbeat time, sweeps once and never loops", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/heartbeatPulse.tsx"), "utf8");
  assert.match(src, /reducedMotion !== false/);
  assert.doesNotMatch(src, /Animated\.loop/);
  const view = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/nowView.tsx"), "utf8");
  assert.match(view, /lastHeartbeatAt=\{blocked \? null : heartbeat\?\.lastHeartbeatAt \?\? null\}/);
});

test("review fixes: the beam is cleared when its effect restarts, hero lines have unique keys, the connection chip comes first in the tree", () => {
  const pulse = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/heartbeatPulse.tsx"), "utf8");
  assert.match(pulse, /anim\.stop\(\); opacity\.setValue\(0\)/);
  const kit = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/instrumentKit.tsx"), "utf8");
  assert.match(kit, /key=\{`\$\{order\}:\$\{l\.text\}`\}/);
  const conn = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/ownerConnectionExperience.tsx"), "utf8");
  assert.doesNotMatch(conn, /column-reverse/);
});
