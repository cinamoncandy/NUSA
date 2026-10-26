"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const m = require("../dist/apps/mobile/src/waveCoreModel.js");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");

test("a real rise makes exactly that many pulses; no rise, a fall or the first value makes none", () => {
  assert.equal(m.pulsesForRise(10, 13, 2, 2, 0).length, 3);
  assert.equal(m.pulsesForRise(10, 10, 2, 2, 0).length, 0);
  assert.equal(m.pulsesForRise(10, 7, 2, 2, 0).length, 0);
  assert.equal(m.pulsesForRise(null, 13, null, 3, 0).length, 0);
  assert.equal(m.pulsesForRise(1, 999, 0, 0, 0).length, m.WAVE_MAX_PULSES);
  assert.deepEqual(m.pulsesForRise(10, 13, 2, 3, 0).map((p) => p.order), [false, false, true]);
  const burst = m.pulsesForRise(0, 3, 0, 0, 1000);
  assert.ok(burst[1].born > burst[0].born, "a burst is staggered");
});

test("the envelope is pinched at the ends and a live pulse raises the waves where it passes", () => {
  assert.equal(m.waveEnvelope(0, [], 0), 0);
  assert.equal(m.waveEnvelope(1, [], 0), 0);
  const quiet = m.waveEnvelope(0.5, [], 0);
  const p = [{ born: 0, order: false }];
  const at = 0.5 / 1.2 * m.WAVE_PULSE_MS + 0.1 / 1.2 * m.WAVE_PULSE_MS;
  assert.ok(m.waveEnvelope(0.5, p, at) > quiet + 0.5);
  assert.equal(m.waveEnvelope(0.5, p, m.WAVE_PULSE_MS + 10), quiet, "a finished pulse adds nothing");
  assert.ok(m.waveEnvelope(0.5, [{ born: 0, order: true }], at) > m.waveEnvelope(0.5, p, at), "order pulses are taller");
});

test("the spring settles at rest; without data the rest is flat", () => {
  let s = { amp: 0.22, velocity: m.pulseKick(true) };
  for (let i = 0; i < 300; i += 1) s = m.springStep(s.amp, s.velocity, m.restAmplitude(true, 0), 1 / 30);
  assert.ok(Math.abs(s.amp - 0.22) < 0.01);
  assert.equal(m.restAmplitude(false, 1), 0);
  assert.ok(m.restAmplitude(true, 1) > m.restAmplitude(true, 0));
  assert.ok(m.pulseKick(true) > m.pulseKick(false));
});

test("the last-minute strip shows only rises from the last minute, newest at the right", () => {
  const ticks = m.historyTicks([{ born: 0, order: false }, { born: 50_000, order: true }, { born: 100_000, order: false }], 100_000);
  assert.equal(ticks.length, 2);
  assert.equal(ticks[1].x, 1);
  assert.equal(ticks[0].order, true);
});

test("the wave draws only counts it is given, pauses in the background and settles under reduce-motion", () => {
  const src = read("waveCore.tsx");
  assert.doesNotMatch(src, /fetch\(|Math\.random\(/);
  assert.match(src, /AppState\.addEventListener/);
  assert.match(src, /if \(!active\) return undefined;/);
  assert.match(src, /if \(reducedMotion !== false\) \{ setFrame/);
  assert.match(src, /cancelAnimationFrame\(handle\)/);
});

test("a real fill rise locks the waves into one line briefly; no rise, none", () => {
  assert.equal(m.fillRise(3, 4), 1);
  assert.equal(m.fillRise(3, 3), 0);
  assert.equal(m.fillRise(null, 4), 0);
  assert.equal(m.fillLock(-1), 0);
  assert.ok(m.fillLock(200) > 0.6);
  assert.equal(m.fillLock(1500), 0);
  const view = read("nowView.tsx");
  assert.match(view, /fillCount=\{blocked \? null : heartbeat\?\.paperFillCount \?\? null\}/);
});
