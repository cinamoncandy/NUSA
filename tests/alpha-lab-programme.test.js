"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const registry = require("../scripts/alpha-lab/registry.js");
const { checkRegistration, main, reportProgramme } = require("../scripts/alpha-lab/programme.js");

function temporary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-lab-programme-"));
  return {
    dir,
    registryPath: path.join(dir, "events.jsonl"),
    programmePath: path.join(dir, "programme.json"),
    hypothesisPath: (id) => path.join(dir, `${id}.json`),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
function writeCanonical(file, value) {
  fs.writeFileSync(file, `${registry.canonicalJson(value)}\n`);
}
function hypothesis(id, alphaSpent, lookDate = "2026-12-01", secondLookDate = "2027-01-01") {
  return {
    schemaVersion: 1,
    id,
    shortNameKo: `가설 ${id}`,
    kContribution: 1,
    alphaSpent,
    hold: 7,
    universe: ["KRW-BTC", "KRW-ETH"],
    signal: { kind: "momentum", lookbackDays: 7 },
    looks: [{ id: "L1", date: lookDate }, { id: "L2", date: secondLookDate }],
  };
}
function registerAt(files, value, recordedAtUtc = "2026-11-28T12:00:00.000Z") {
  const file = files.hypothesisPath(value.id);
  writeCanonical(file, value);
  return registry.registerHypothesis(files.registryPath, file, { now: () => new Date(recordedAtUtc) });
}
function defaultProgramme(files, annualAlpha = 0.05) {
  writeCanonical(files.programmePath, { annualAlpha, schemaVersion: 1 });
}

test("empty registry reports zero spend against the canonical programme budget", () => {
  const files = temporary();
  try {
    defaultProgramme(files);
    const report = reportProgramme({ registryPath: files.registryPath, programmePath: files.programmePath });
    assert.equal(report.registryRows, 0);
    assert.equal(report.registryHeadSha256, "0".repeat(64));
    assert.deepEqual(report.years, []);
    assert.match(report.reportSha256, /^[a-f0-9]{64}$/);
  } finally { files.cleanup(); }
});

test("report groups tests and alpha by registration year and lists only open look dates", () => {
  const files = temporary();
  try {
    defaultProgramme(files);
    registerAt(files, hypothesis("HYP_26_A", 0.02));
    registerAt(files, hypothesis("HYP_26_B", 0.01));
    registerAt(files, hypothesis("HYP_27_A", 0.03, "2027-01-03", "2027-02-01"), "2027-01-01T12:00:00.000Z");
    const report = reportProgramme({ registryPath: files.registryPath, programmePath: files.programmePath });
    assert.deepEqual(report.years.map((y) => y.year), [2026, 2027]);
    assert.equal(report.years[0].testsRegistered, 2);
    assert.equal(report.years[0].alphaSpent, 0.03);
    assert.equal(report.years[0].remainingAlpha, 0.05 - 0.03);
    assert.deepEqual(report.years[0].openLooks, [
      { id: "HYP_26_A", look: "L1", date: "2026-12-01" },
      { id: "HYP_26_B", look: "L1", date: "2026-12-01" },
      { id: "HYP_26_A", look: "L2", date: "2027-01-01" },
      { id: "HYP_26_B", look: "L2", date: "2027-01-01" },
    ]);
    assert.equal(report.years[1].testsRegistered, 1);
    assert.equal(report.years[1].alphaSpent, 0.03);
    assert.equal(report.years[1].openLooks.length, 2);
  } finally { files.cleanup(); }
});

test("budget check passes at the limit, fails closed above it, and never edits the registry", () => {
  const files = temporary();
  try {
    defaultProgramme(files);
    registerAt(files, hypothesis("EXISTING_A", 0.02));
    registerAt(files, hypothesis("EXISTING_B", 0.02));
    const withinPath = files.hypothesisPath("CANDIDATE_IN");
    writeCanonical(withinPath, hypothesis("CANDIDATE_IN", 0.01));
    const overPath = files.hypothesisPath("CANDIDATE_OVER");
    writeCanonical(overPath, hypothesis("CANDIDATE_OVER", 0.011));
    const before = fs.readFileSync(files.registryPath);
    const within = checkRegistration({ candidatePath: withinPath, registrationYear: 2026, registryPath: files.registryPath, programmePath: files.programmePath });
    const over = checkRegistration({ candidatePath: overPath, registrationYear: 2026, registryPath: files.registryPath, programmePath: files.programmePath });
    assert.equal(within.withinBudget, true);
    assert.equal(within.reason, "WITHIN_ANNUAL_ALPHA_BUDGET");
    assert.equal(over.withinBudget, false);
    assert.equal(over.reason, "ANNUAL_ALPHA_BUDGET_EXCEEDED");
    assert.equal(over.remainingAlpha, 0.05 - 0.04);
    assert.deepEqual(fs.readFileSync(files.registryPath), before);
  } finally { files.cleanup(); }
});

test("CLI returns a distinct denial code for an over-budget candidate", () => {
  const files = temporary();
  try {
    defaultProgramme(files, 0.01);
    writeCanonical(files.hypothesisPath("TOO_MUCH"), hypothesis("TOO_MUCH", 0.02));
    const stdout = { value: "", write(s) { this.value += s; } };
    const stderr = { value: "", write(s) { this.value += s; } };
    const exit = main(["check", files.hypothesisPath("TOO_MUCH"), "2026", files.registryPath, files.programmePath], { stdout, stderr });
    assert.equal(exit, 3);
    assert.equal(stderr.value, "");
    assert.equal(JSON.parse(stdout.value).withinBudget, false);
  } finally { files.cleanup(); }
});

test("corrupt registry and invalid programme configuration fail closed", () => {
  const files = temporary();
  try {
    defaultProgramme(files);
    fs.writeFileSync(files.registryPath, "{}\n");
    assert.throws(() => reportProgramme({ registryPath: files.registryPath, programmePath: files.programmePath }));
    defaultProgramme(files, 1);
    assert.throws(() => reportProgramme({ registryPath: path.join(files.dir, "missing.jsonl"), programmePath: files.programmePath }), /PROGRAMME_ALPHA_INVALID/);
  } finally { files.cleanup(); }
});
