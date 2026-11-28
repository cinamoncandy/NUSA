"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  appendDataAccessStarted,
  appendRegistration,
  appendResult,
  appendVerdict,
  canonicalSpecText,
  projectRegistry,
  readCanonicalSpec,
  readRegistry,
  runCli,
} = require("./hypothesis-registry.js");

function makeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-alpha-registry-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registryFile = path.join(dir, "registry", "hypotheses.jsonl");
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 10, 28, 1, 0, tick++));
  return { dir, registryFile, now, options: { now, attestedNoPriorDataAccess: true } };
}

function spec(overrides = {}) {
  return {
    schemaVersion: 1,
    hypothesis: "A frozen cross-sectional rule predicts a predeclared forward outcome.",
    rationale: "This is a research hypothesis, not an execution instruction.",
    sources: ["docs/ALPHA_LAB_V3_CROSS_SECTION_EVALUE_DESIGN_2026-11-27.md#section-2"],
    dataPlan: { source: "public daily candles", span: "predeclared UTC interval", universe: "fixed cohort" },
    metric: { name: "daily cross-sectional rank IC", horizonsDays: [1, 5, 10, 20] },
    decisionRule: { reference: "registered rule text; no default threshold" },
    ...overrides,
  };
}

function register(fixture, input = {}) {
  return appendRegistration(fixture.registryFile, {
    hypothesisId: "h1",
    familyId: "momentum-family",
    kIndex: 1,
    kTotal: 2,
    relation: "NEW",
    revisesHypothesisId: null,
    spec: spec(),
    ...input,
  }, fixture.options);
}

test("empty registry validates as empty without creating a production ledger", (t) => {
  const fixture = makeFixture(t);
  const registry = readRegistry(fixture.registryFile);
  assert.equal(registry.events.length, 0);
  assert.deepEqual(projectRegistry(registry), {
    schemaVersion: 1,
    eventCount: 0,
    hypothesisCount: 0,
    families: [],
    hypotheses: [],
  });
  assert.equal(fs.existsSync(fixture.registryFile), false);
});

test("an existing zero-byte registry fails closed instead of being treated as empty", (t) => {
  const fixture = makeFixture(t);
  fs.mkdirSync(path.dirname(fixture.registryFile), { recursive: true });
  fs.writeFileSync(fixture.registryFile, "");
  assert.throws(() => readRegistry(fixture.registryFile), /REGISTRY_EMPTY_FILE_INVALID/);
});

test("spec registration freezes canonical content and records the explicit no-prior-data attestation", (t) => {
  const fixture = makeFixture(t);
  const event = register(fixture);
  const reread = readRegistry(fixture.registryFile);
  assert.equal(event.eventType, "HYPOTHESIS_REGISTERED");
  assert.equal(event.payload.attestedNoPriorDataAccess, true);
  assert.equal(event.payload.specSha256, event.payload.specSha256.toLowerCase());
  assert.equal(reread.hypotheses.get("h1").specSha256, event.payload.specSha256);
  assert.equal(reread.hypotheses.get("h1").dataAccessStartedEventId, null);
  assert.equal(fs.readFileSync(fixture.registryFile, "utf8").split("\n").filter(Boolean).length, 1);
});

test("the registry requires an attestation and rejects non-canonical or incomplete specs", (t) => {
  const fixture = makeFixture(t);
  assert.throws(() => appendRegistration(fixture.registryFile, {
    hypothesisId: "h1", familyId: "family", kIndex: 1, kTotal: 1, relation: "NEW", spec: spec(),
  }, { now: fixture.now }), /HYPOTHESIS_NO_PRIOR_DATA_ATTESTATION_REQUIRED/);

  const nonCanonical = path.join(fixture.dir, "spec.json");
  fs.writeFileSync(nonCanonical, JSON.stringify(spec(), null, 2) + "\n");
  assert.throws(() => readCanonicalSpec(nonCanonical), /HYPOTHESIS_SPEC_NOT_CANONICAL/);
  fs.writeFileSync(nonCanonical, JSON.stringify({ ...spec(), sources: [] }) + "\n");
  assert.throws(() => readCanonicalSpec(nonCanonical), /HYPOTHESIS_SPEC_SOURCES_REQUIRED/);
  const canonical = canonicalSpecText(spec());
  const duplicateKey = canonical.replace(/("hypothesis":("(?:[^"\\]|\\.)*")),/, "$1, $1,");
  assert.notEqual(duplicateKey, canonical);
  fs.writeFileSync(nonCanonical, duplicateKey);
  assert.throws(() => readCanonicalSpec(nonCanonical), /HYPOTHESIS_SPEC_NOT_CANONICAL/);
});

test("fixed family K and unique K slots are enforced; exact specs cannot be silently re-registered", (t) => {
  const fixture = makeFixture(t);
  register(fixture);
  const before = fs.readFileSync(fixture.registryFile, "utf8");
  assert.throws(() => register(fixture), /HYPOTHESIS_ID_DUPLICATE:h1/);
  assert.throws(() => register(fixture, { hypothesisId: "h2", relation: "NEW" }), /HYPOTHESIS_SPEC_DUPLICATE:h1/);
  assert.throws(() => register(fixture, { hypothesisId: "h3", kTotal: 3, spec: spec({ hypothesis: "A distinct hypothesis." }) }), /HYPOTHESIS_FAMILY_K_CHANGED:momentum-family/);
  assert.throws(() => register(fixture, { hypothesisId: "h4", kIndex: 1, spec: spec({ hypothesis: "A distinct hypothesis." }) }), /HYPOTHESIS_K_SLOT_DUPLICATE:momentum-family:1/);
  assert.equal(fs.readFileSync(fixture.registryFile, "utf8"), before);
});

test("data access, result and negative verdict are append-only and remain visible", (t) => {
  const fixture = makeFixture(t);
  register(fixture);
  assert.throws(() => appendDataAccessStarted(fixture.registryFile, "h1", fixture.options), /HYPOTHESIS_FAMILY_K_INCOMPLETE_BEFORE_DATA:momentum-family/);
  register(fixture, { hypothesisId: "h2", kIndex: 2, spec: spec({ hypothesis: "A separate member of the frozen K family." }) });
  const dataStart = appendDataAccessStarted(fixture.registryFile, "h1", fixture.options);
  const result = appendResult(fixture.registryFile, "h1", {
    lookId: "look-1",
    evidenceRef: "docs/research-data/alpha-lab/result-1.json",
    evidenceSha256: "a".repeat(64),
  }, fixture.options);
  appendVerdict(fixture.registryFile, "h1", {
    resultEventId: result.eventId,
    verdict: "FAIL",
    reason: "The preregistered decision rule did not pass.",
  }, fixture.options);

  const registry = readRegistry(fixture.registryFile);
  const projection = projectRegistry(registry);
  assert.equal(registry.events.length, 5);
  assert.equal(dataStart.sequence, 3);
  assert.equal(projection.hypotheses[0].state, "VERDICT_RECORDED");
  assert.equal(projection.hypotheses[0].verdicts[0].verdict, "FAIL");
  assert.equal(projection.hypotheses[0].results[0].verdict, "FAIL");
  assert.equal(projection.families[0].frozenBeforeData, true);
  assert.equal(projection.families[0].dataAccessStarted, true);
  assert.equal(fs.readFileSync(fixture.registryFile, "utf8").split("\n").filter(Boolean).length, 5);
});

test("a newly recorded result remains pending while earlier negative verdicts remain visible", (t) => {
  const fixture = makeFixture(t);
  register(fixture, { kTotal: 1 });
  appendDataAccessStarted(fixture.registryFile, "h1", fixture.options);
  const first = appendResult(fixture.registryFile, "h1", {
    lookId: "look-1", evidenceRef: "docs/research-data/look-1.json", evidenceSha256: "c".repeat(64),
  }, fixture.options);
  appendVerdict(fixture.registryFile, "h1", {
    resultEventId: first.eventId, verdict: "FAIL", reason: "The predeclared rule did not pass.",
  }, fixture.options);
  appendResult(fixture.registryFile, "h1", {
    lookId: "look-2", evidenceRef: "docs/research-data/look-2.json", evidenceSha256: "d".repeat(64),
  }, fixture.options);

  const projected = projectRegistry(readRegistry(fixture.registryFile)).hypotheses[0];
  assert.equal(projected.state, "RESULT_RECORDED");
  assert.equal(projected.results[0].verdict, "FAIL");
  assert.equal(projected.results[1].verdict, null);
  assert.deepEqual(projected.verdicts.map((verdict) => verdict.verdict), ["FAIL"]);
});

test("registration revisions are linked and consume a distinct slot", (t) => {
  const fixture = makeFixture(t);
  register(fixture);
  const revision = register(fixture, {
    hypothesisId: "h2",
    kIndex: 2,
    relation: "REVISION",
    revisesHypothesisId: "h1",
    spec: spec({ hypothesis: "A revised, separately counted hypothesis." }),
  });
  assert.equal(revision.payload.revisesHypothesisId, "h1");
  assert.equal(projectRegistry(readRegistry(fixture.registryFile)).families[0].registeredSlots, 2);
});

test("result and verdict transitions fail closed before their prerequisites", (t) => {
  const fixture = makeFixture(t);
  assert.throws(() => appendDataAccessStarted(fixture.registryFile, "h1", fixture.options), /HYPOTHESIS_NOT_REGISTERED:h1/);
  register(fixture);
  register(fixture, { hypothesisId: "h2", kIndex: 2, spec: spec({ hypothesis: "A separate member of the frozen K family." }) });
  assert.throws(() => appendResult(fixture.registryFile, "h1", {
    lookId: "look-1", evidenceRef: "docs/result.json", evidenceSha256: "b".repeat(64),
  }, fixture.options), /RESULT_BEFORE_DATA_ACCESS_START/);
  assert.throws(() => appendVerdict(fixture.registryFile, "h1", {
    resultEventId: "alpha-lab-event-00000002", verdict: "FAIL", reason: "no result",
  }, fixture.options), /VERDICT_RESULT_REFERENCE_INVALID/);
  assert.equal(readRegistry(fixture.registryFile).events.length, 2);
});

test("tampering, a truncated line, or a stale writer lock fail closed", (t) => {
  const fixture = makeFixture(t);
  register(fixture);
  const original = fs.readFileSync(fixture.registryFile, "utf8");
  fs.writeFileSync(fixture.registryFile, original.replace("cross-sectional", "changed-content"));
  assert.throws(() => readRegistry(fixture.registryFile), /REGISTRY_EVENT_HASH_MISMATCH/);

  fs.writeFileSync(fixture.registryFile, original.slice(0, -1));
  assert.throws(() => readRegistry(fixture.registryFile), /REGISTRY_JSONL_TERMINATION_INVALID/);

  fs.unlinkSync(fixture.registryFile);
  fs.writeFileSync(fixture.registryFile + ".lock", "held by another writer\n");
  assert.throws(() => register(fixture, { hypothesisId: "h2", spec: spec({ hypothesis: "A second hypothesis." }), kIndex: 2 }), /REGISTRY_WRITER_LOCKED/);
  assert.equal(fs.existsSync(fixture.registryFile), false);
});

test("a symlink cannot redirect the append target", (t) => {
  const fixture = makeFixture(t);
  fs.mkdirSync(path.dirname(fixture.registryFile), { recursive: true });
  const sentinel = path.join(fixture.dir, "sentinel.txt");
  fs.writeFileSync(sentinel, "untouched\n");
  fs.symlinkSync(sentinel, fixture.registryFile);
  assert.throws(() => register(fixture), /REGISTRY_PATH_NOT_REGULAR_FILE/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "untouched\n");
});

test("CLI rejects unknown flags and never silently supplies the prior-data attestation", (t) => {
  const fixture = makeFixture(t);
  const io = { stdout: { write() {} } };
  assert.throws(() => runCli(["validate", "--typo", "x"], io), /CLI_OPTION_UNKNOWN:typo/);
  const specFile = path.join(fixture.dir, "canonical.json");
  fs.writeFileSync(specFile, canonicalSpecText(spec()));
  assert.throws(() => runCli(["register", "--id", "h1", "--family", "f", "--k-index", "1", "--k-total", "1", "--relation", "new", "--spec", specFile, "--registry", fixture.registryFile], io), /CLI_OPTION_REQUIRED:confirm-no-prior-data-access/);
  assert.equal(fs.existsSync(fixture.registryFile), false);
});

test("CLI registration and listing use the same validated append-only ledger", (t) => {
  const fixture = makeFixture(t);
  const specFile = path.join(fixture.dir, "frozen.json");
  fs.writeFileSync(specFile, canonicalSpecText(spec()));
  let output = "";
  const io = { stdout: { write(value) { output += value; } } };
  runCli([
    "register", "--id", "h1", "--family", "family-a", "--k-index", "1", "--k-total", "1",
    "--relation", "new", "--spec", specFile, "--confirm-no-prior-data-access", "--registry", fixture.registryFile,
  ], io);
  assert.equal(JSON.parse(output).eventType, "HYPOTHESIS_REGISTERED");
  output = "";
  runCli(["list", "--registry", fixture.registryFile], io);
  const listing = JSON.parse(output);
  assert.equal(listing.hypotheses[0].state, "REGISTERED");
  assert.equal(listing.families[0].frozenBeforeData, true);
  assert.equal(listing.families[0].dataAccessStarted, false);
});
