"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const c = require("../scripts/alpha-lab/cohort1.js");
const D = 86_400_000;

test("cohort 1 registers exactly three hypotheses with their holds and starts on 2026-12-06", () => {
  assert.deepEqual(c.HYPOTHESES.map((h) => [h.id, h.hold]), [["C1_LOWVOL20_H20", 20], ["C1_REV28_H20", 20], ["C1_STR1_H5", 5]]);
  assert.equal(c.FIRST_SIGNAL_DAY, Date.UTC(2026, 11, 6));
  const doc = fs.readFileSync("docs/RESEARCH_PREREG_2026-11-28_ALPHA_LAB_COHORT1.md", "utf8");
  for (const h of c.HYPOTHESES) assert.match(doc, new RegExp(h.id));
});

test("the self-test passes and no row is built before the first signal day", () => {
  c.selfTest();
  const U = [...Array(25).keys()].map((i) => "M" + i), cl = new Map();
  for (const m of U) { const mp = new Map(); for (let t = c.FIRST_SIGNAL_DAY - 40 * D; t <= c.FIRST_SIGNAL_DAY + 10 * D; t += D) mp.set(t, 100 + (t / D) % 7 + U.indexOf(m)); cl.set(m, mp); }
  const rows = c.buildRows(U, cl, c.FIRST_SIGNAL_DAY + 10 * D);
  for (const k of Object.keys(rows)) assert.equal(rows[k][0].day, "2026-12-06");
});

test("the recorder workflow is daily, secret-free and writes only the records branch", () => {
  const wf = fs.readFileSync(".github/workflows/research-alpha-lab-cohort1.yml", "utf8");
  assert.match(wf, /cron: "40 0 \* \* \*"/);
  assert.doesNotMatch(wf, /secrets\./);
  assert.match(wf, /git push origin HEAD:alpha-lab-records/);
  assert.doesNotMatch(wf, /push origin (HEAD:)?main/);
});
