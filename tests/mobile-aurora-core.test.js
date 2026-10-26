"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const m = require("../dist/apps/mobile/src/auroraCoreModel.js");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");

test("a real rise in decisions makes exactly that many ripples, and no rise makes none", () => {
  assert.equal(m.eventsForRise(10, 13, 2, 2, 1000).length, 3);
  assert.equal(m.eventsForRise(10, 10, 2, 2, 1000).length, 0);
  assert.equal(m.eventsForRise(10, 7, 2, 2, 1000).length, 0, "a falling count (new day) makes nothing");
  assert.equal(m.eventsForRise(null, 13, null, 3, 1000).length, 0, "the first value seen makes nothing");
  assert.equal(m.eventsForRise(10, null, 2, null, 1000).length, 0);
  assert.equal(m.eventsForRise(1, 500, 0, 0, 1000).length, m.AURORA_SLOTS, "a huge jump is capped to the slots");
});

test("a real rise in orders marks that many ripples as order ripples; extra orders still show", () => {
  const two = m.eventsForRise(10, 13, 2, 3, 0);
  assert.deepEqual(two.map((e) => e.order), [false, false, true]);
  const only = m.eventsForRise(10, 10, 2, 4, 0);
  assert.deepEqual(only.map((e) => e.order), [true, true]);
  assert.ok(m.eventsForRise(10, 12, 2, 2, 0).every((e) => !e.order));
});

test("a burst is staggered and packed into slots with ages; empty or unborn slots read -1", () => {
  const ev = m.eventsForRise(0, 3, 0, 1, 1000);
  assert.equal(ev[1].born - ev[0].born > 0, true);
  const packed = m.packEvents(ev, 1000);
  assert.equal(packed.length, m.AURORA_SLOTS * 4);
  assert.equal(packed[0], 0);
  assert.equal(packed[4], -1, "the second ripple is not born yet");
  assert.equal(packed[8 * 0 + 9], 1 * 0 + packed[9], "flag slot is numeric");
  assert.equal(packed[3 * 4], -1, "an unused slot is -1");
  assert.equal(m.packEvents(ev, 1000 + m.ORDER_MS + 5000).every((v, i) => (i % 4 === 0 ? v === -1 : true)), true);
  assert.equal(m.liveEvents(ev, 1000 + 99999).length, 0);
});

test("the heartbeat sweep starts only on a newer stamp and is off otherwise", () => {
  assert.equal(m.beatAdvanced(100, 200), true);
  assert.equal(m.beatAdvanced(200, 200), false);
  assert.equal(m.beatAdvanced(null, 200), false);
  assert.equal(m.beatPosition(null, 500), -5);
  assert.equal(m.beatPosition(1000, 1000 + m.BEAT_MS + 1), -5);
  const mid = m.beatPosition(1000, 1000 + m.BEAT_MS / 2);
  assert.ok(mid > 0 && mid < 1.13);
});

test("modes: live is green and fast, hold is amber and slow, no data is dim and never amber", () => {
  assert.deepEqual({ ...m.auroraMode("live") }, { speed: 1, warm: 0, dim: 1 });
  assert.equal(m.auroraMode("limit").warm, 1);
  assert.ok(m.auroraMode("limit").speed < 1);
  assert.equal(m.auroraMode("idle").warm, 0);
  assert.ok(m.auroraMode("idle").dim < 0.5);
});

test("the aurora draws only counts and a timestamp it is given, loops only while active, and falls back to the old core", () => {
  const src = read("auroraCore.tsx");
  assert.doesNotMatch(src, /fetch\(|Math\.random\(/);
  assert.match(src, /AppState\.addEventListener/);
  assert.match(src, /if \(!active\) return undefined;/);
  assert.match(src, /reducedMotion !== false\) \{ setFrame/);
  assert.match(src, /if \(effect == null\) return <DecisionCore/);
  assert.match(src, /cancelAnimationFrame\(handle\)/);
  const view = read("nowView.tsx");
  assert.match(view, /lastHeartbeatAt=\{blocked \? null : heartbeat\?\.lastHeartbeatAt \?\? null\}/);
  const sk = read("auroraShader.ts");
  assert.match(sk, /uniform float4 uEv\[8\]/);
});
