"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { canonicalJson, registerHypothesis, recordVerdict } = require("../scripts/alpha-lab/registry.js");
const { EXPORT_KEYS, SCHEMA_VERSION, buildStatus, runCli, serializeStatus } = require("../scripts/alpha-lab/status-export.js");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-alpha-status-"));
  const registry = path.join(directory, "registry", "events.jsonl");
  const hypothesisFile = path.join(directory, "hypothesis.json");
  const resultFile = path.join(directory, "result.json");
  const spec = {
    schemaVersion: 1,
    id: "status-test-001",
    shortNameKo: "상태 시험",
    kContribution: 1,
    alphaSpent: 0.0125,
    hold: 20,
    universe: ["KRW-BTC", "KRW-ETH"],
    signal: { kind: "momentum", lookbackDays: 28 },
    looks: [
      { id: "L30", date: "2026-12-29" },
      { id: "L60", date: "2027-01-28" },
    ],
  };
  fs.mkdirSync(path.dirname(hypothesisFile), { recursive: true });
  fs.writeFileSync(hypothesisFile, `${canonicalJson(spec)}\n`);
  return { directory, registry, hypothesisFile, resultFile, spec };
}

function register(f) {
  return registerHypothesis(f.registry, f.hypothesisFile, { now: () => new Date("2026-11-28T12:00:00.000Z") });
}

function record(f, look, resultCode, evaluatedAtUtc) {
  fs.writeFileSync(f.resultFile, `${canonicalJson({ schemaVersion: 1, id: f.spec.id, look, resultCode, evaluatedAtUtc, metric: 123.45 })}\n`);
  return recordVerdict(f.registry, f.spec.id, look, f.resultFile, { now: () => new Date(`${f.spec.looks.find((item) => item.id === look).date}T12:00:00.000Z`) });
}

function assertNoNumericFields(value) {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(typeof child, "number", `unexpected numeric value at ${key}`);
      assertNoNumericFields(child);
    }
  }
}

test("empty registry exports schema version 1 and an empty hypothesis list", () => {
  const f = fixture();
  assert.deepEqual(buildStatus(f.registry), { schemaVersion: SCHEMA_VERSION, hypotheses: [] });
  assert.equal(fs.existsSync(f.registry), false);
});

test("schema exports only display fields; an untested hypothesis has null verdict and no number", () => {
  const f = fixture();
  register(f);
  const status = buildStatus(f.registry);
  assert.deepEqual(Object.keys(status), ["schemaVersion", "hypotheses"]);
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.hypotheses.length, 1);
  const item = status.hypotheses[0];
  assert.deepEqual(Object.keys(item), EXPORT_KEYS);
  assert.deepEqual(item, {
    id: f.spec.id,
    shortNameKo: f.spec.shortNameKo,
    state: "REGISTERED",
    nextLookDate: "2026-12-29",
    lastVerdictCode: null,
  });
  assertNoNumericFields(item);
  assert.doesNotMatch(serializeStatus(status), /price|return|order|metric|alphaSpent|evidenceSha256/i);
});

test("a nonterminal verdict advances the next date and exports only its code", () => {
  const f = fixture();
  register(f);
  record(f, "L30", "NO_INFORMATION_YET", "2026-12-29T00:00:00.000Z");
  const item = buildStatus(f.registry).hypotheses[0];
  assert.equal(item.state, "OPEN_WITH_VERDICTS");
  assert.equal(item.nextLookDate, "2027-01-28");
  assert.equal(item.lastVerdictCode, "NO_INFORMATION_YET");
  assertNoNumericFields(item);
  assert.doesNotMatch(JSON.stringify(item), /123\.45|evidenceSha256/);
});

test("terminal verdict has no next look and the CLI emits a JSON-only status", () => {
  const f = fixture();
  register(f);
  record(f, "L30", "PASS", "2026-12-29T00:00:00.000Z");
  const item = buildStatus(f.registry).hypotheses[0];
  assert.equal(item.state, "PASS");
  assert.equal(item.nextLookDate, null);

  let stdout = "";
  let stderr = "";
  const code = runCli([], { stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { schemaVersion: 1, hypotheses: [] });
});
