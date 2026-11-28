"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const m = require("../dist/apps/mobile/src/loopChainModel.js");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", name), "utf8").replace(/\r\n/g, "\n");
const steps = (states) => states.map((state, i) => ({ label: `s${i}`, state }));

// UI v7 phase 5d (docs/NUSA_MOBILE_UIUX_V6_CALM_FIELD.md): the learning loop as one chain in the sphere's language.
test("the chain lights the confirmed nodes and rings only the next unconfirmed step", () => {
  assert.deepEqual({ ...m.loopChain(steps(["DONE", "NONE", "NONE", "NONE", "NONE", "NONE"])) }, { lastDone: 0, nextIndex: 1 });
  assert.deepEqual({ ...m.loopChain(steps(["NONE", "NONE", "NONE"])) }, { lastDone: -1, nextIndex: null }, "nothing confirmed: nothing is ringed (the server did not say which step is next)");
  assert.deepEqual({ ...m.loopChain(steps(["DONE", "DONE", "DONE"])) }, { lastDone: 2, nextIndex: null }, "everything confirmed: no next ring");
  assert.equal(m.loopChain(steps(["DONE", "DONE", "BLOCKED", "NONE"])).nextIndex, null, "a blocked step keeps its attention colour and gets no ring");
  assert.deepEqual({ ...m.loopChain(steps(["DONE", "BLOCKED", "DONE"])) }, { lastDone: 0, nextIndex: null }, "the line stops at the first gap: it never implies a confirmed chain across a blocked step");
  assert.deepEqual({ ...m.loopChain(steps(["DONE", "NONE", "DONE"])) }, { lastDone: 0, nextIndex: 1 });
  assert.deepEqual({ ...m.loopChain(steps(["NONE", "DONE", "DONE"])) }, { lastDone: -1, nextIndex: null }, "a later step confirmed without the first one: no lit line, no ring");
  assert.equal(m.loopChain(steps([])).lastDone, -1);
  assert.equal(m.loopChain(steps([])).nextIndex, null);
});

test("the line runs between the first and the last node centre and is lit up to the last confirmed node", () => {
  const p = m.chainLinePercents(6, 1);
  assert.ok(Math.abs(p.start - (0.5 / 6) * 100) < 1e-9);
  assert.ok(Math.abs(p.end - (5.5 / 6) * 100) < 1e-9);
  assert.ok(Math.abs(p.litEnd - (1.5 / 6) * 100) < 1e-9);
  assert.equal(m.chainLinePercents(6, -1).litEnd, m.chainLinePercents(6, -1).start, "nothing confirmed: no lit part");
  assert.equal(m.chainLinePercents(6, 99).litEnd, m.chainLinePercents(6, 5).litEnd, "clamped to the last node");
  assert.deepEqual({ ...m.chainLinePercents(1, 0) }, { start: 0, end: 0, litEnd: 0 });
  assert.deepEqual({ ...m.chainLinePercents(Number.NaN, 0) }, { start: 0, end: 0, litEnd: 0 });
});

test("source pin: 학습 draws the chain from the model's steps, static, with the same accessibility label as before", () => {
  const view = read("learningView.tsx");
  assert.match(view, /<LoopChainStrip steps=\{model\.steps\} \/>/);
  assert.match(view, /testID="learning-loop-chain"/);
  assert.match(view, /accessibilityLabel=\{steps\.map\(\(s\) => `\$\{s\.label\} \$\{s\.state === "DONE" \? "확인" : s\.state === "BLOCKED" \? "막힘" : "없음"\}`\)\.join\(", "\)\}/);
  const strip = view.slice(view.indexOf("function LoopChainStrip"), view.indexOf("const styles = StyleSheet.create"));
  assert.doesNotMatch(strip, /requestAnimationFrame|setInterval|Animated|useEffect|Math\.random|Date\.now|fetch\(/, "no motion and no data of its own");
  assert.match(view, /<SectionLabel left="PAPER 연계 · 모의투자" right=\{`\$\{model\.steps\.filter\(\(x\) => x\.state === "DONE"\)\.length\} \/ \$\{model\.steps\.length\}`\} \/>/, "the 1 / 6 count stays");
});
