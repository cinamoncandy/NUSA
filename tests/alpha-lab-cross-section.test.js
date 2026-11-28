"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const f2b = require("../scripts/alpha-lab/f2b-evalue-power.js");
const recorder = require("../scripts/alpha-lab/cross-section.js");

const ZERO_SHA256 = "0".repeat(64);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function specFor(id = "synthetic-fixture-only", hold = 20) {
  return {
    schemaVersion: 1,
    id,
    shortNameKo: "테스트 전용 가설 fixture",
    kContribution: 1,
    alphaSpent: 0.0125,
    hold,
    universe: ["KRW-AAA", "KRW-BBB", "KRW-CCC"],
    signal: { kind: "momentum", lookbackDays: 1 },
    looks: [
      { id: "look-1", date: "2026-12-20" },
      { id: "look-2", date: "2027-01-20" },
    ],
  };
}

function writeRegisteredFixture(directory, spec = specFor(), firstEvaluableDate = "2026-12-10") {
  fs.mkdirSync(directory, { recursive: true });
  const hypothesisText = recorder.canonicalJson(spec) + "\n";
  const hypothesisSha256 = sha256(Buffer.from(hypothesisText, "utf8"));
  const payload = {
    hypothesisSha256,
    kContribution: spec.kContribution,
    alphaSpent: spec.alphaSpent,
    hold: spec.hold,
    universe: spec.universe,
    firstEvaluableDate,
    shortNameKo: spec.shortNameKo,
    signal: spec.signal,
    looks: spec.looks,
  };
  const body = {
    schemaVersion: 1,
    sequence: 1,
    rowType: "REGISTERED",
    id: spec.id,
    recordedAtUtc: "2026-12-09T23:00:00.000Z",
    previousRowSha256: ZERO_SHA256,
    payload,
  };
  const row = { ...body, rowSha256: sha256(Buffer.from(recorder.canonicalJson(body), "utf8")) };
  const registryPath = path.join(directory, "events.jsonl");
  const hypothesisPath = path.join(directory, "hypothesis.json");
  fs.writeFileSync(registryPath, recorder.canonicalJson(row) + "\n", { mode: 0o600 });
  fs.writeFileSync(hypothesisPath, hypothesisText, { mode: 0o600 });
  return { spec, registryPath, hypothesisPath, registration: recorder.readRegistry(registryPath)[0] };
}

function syntheticFetcher() {
  const marketIndex = new Map([["KRW-AAA", 0], ["KRW-BBB", 1], ["KRW-CCC", 2]]);
  return async (market) => {
    const slope = marketIndex.get(market) + 1;
    return ["2026-12-11", "2026-12-10", "2026-12-09", "2026-12-08", "2026-12-12"].map((date) => {
      const day = Date.parse(date + "T00:00:00.000Z");
      const base = 100 + marketIndex.get(market) * 30;
      const elapsed = Math.round((day - Date.parse("2026-12-08T00:00:00.000Z")) / 86400000);
      return {
        candle_date_time_utc: date + "T00:00:00",
        trade_price: base + elapsed * slope,
      };
    });
  };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticPassCount(dailyIc, holdDays, replications = 200) {
  let passes = 0;
  const innovationOffset = 0x13579b; // F2b symmetric-t4 scenario seed offset.
  const seed = (f2b.PRIMARY_CONFIG.seed + holdDays * 100003 + Math.round(dailyIc * 100000) * 37 + innovationOffset) >>> 0;
  const random = mulberry32(seed);
  for (let replication = 0; replication < replications; replication += 1) {
    const pathData = f2b.generateExcessPath({
      random,
      dailyIc,
      holdDays,
      innovationShape: "symmetric-t4",
      costOn: dailyIc !== 0,
      config: f2b.PRIMARY_CONFIG,
    });
    const result = recorder.evaluateEProcess(Array.from(pathData.excess), f2b.PRIMARY_CONFIG.nullAlphaForComparisonOnly);
    if (result.status === "PASS") passes += 1;
  }
  return passes;
}

function fixtureDirectory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-cross-section-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the registered hypothesis file and E1 row use exact canonical hashes", (t) => {
  const root = fixtureDirectory(t);
  const fixture = writeRegisteredFixture(root);
  assert.equal(recorder.readHypothesisFile(fixture.hypothesisPath).hypothesisSha256, fixture.registration.hypothesisSha256);
  assert.equal(recorder.findRegistration(fixture.spec, fixture.registration.hypothesisSha256, fixture.registryPath).firstEvaluableDate, "2026-12-10");
  const nonCanonical = path.join(root, "non-canonical.json");
  fs.writeFileSync(nonCanonical, JSON.stringify(fixture.spec, null, 2) + "\n");
  assert.throws(() => recorder.readHypothesisFile(nonCanonical), /HYPOTHESIS_FILE_NOT_CANONICAL/);
});

test("unregistered hypotheses fail before any public-data request", async (t) => {
  const root = fixtureDirectory(t);
  const fixture = writeRegisteredFixture(root);
  const emptyRegistry = path.join(root, "empty-events.jsonl");
  let requests = 0;
  await assert.rejects(
    recorder.recordFromFile(fixture.hypothesisPath, path.join(root, "data"), {
      registryPath: emptyRegistry,
      now: new Date("2026-12-12T00:20:00.000Z"),
      fetcher: async () => { requests += 1; return []; },
    }),
    /HYPOTHESIS_NOT_REGISTERED/,
  );
  assert.equal(requests, 0);
});

test("date and first-evaluable guards prevent fetching early or before registration eligibility", async (t) => {
  const root = fixtureDirectory(t);
  const fixture = writeRegisteredFixture(root);
  let requests = 0;
  const beforeWallClockCutoff = await recorder.recordFromFile(fixture.hypothesisPath, path.join(root, "before-cutoff"), {
    registryPath: fixture.registryPath,
    now: new Date("2026-12-09T12:00:00.000Z"),
    fetcher: async () => { requests += 1; return []; },
  });
  assert.deepEqual(beforeWallClockCutoff, { recorded: false, reason: "FETCH_DATE_NOT_REACHED" });
  const beforeFirstEvaluation = await recorder.recordFromFile(fixture.hypothesisPath, path.join(root, "before-first-date"), {
    registryPath: fixture.registryPath,
    now: new Date("2026-12-11T00:20:00.000Z"),
    fetcher: async () => { requests += 1; return []; },
  });
  assert.deepEqual(beforeFirstEvaluation, { recorded: false, reason: "FIRST_EVALUABLE_DATE_NOT_REACHED" });
  assert.equal(requests, 0);
});

test("record stores a reproducible ranked portfolio outcome and evaluate hashes its projection", async (t) => {
  const root = fixtureDirectory(t);
  const fixture = writeRegisteredFixture(root);
  const dataDir = path.join(root, "data", fixture.spec.id);
  const requestCursors = [];
  const first = await recorder.recordFromFile(fixture.hypothesisPath, dataDir, {
    registryPath: fixture.registryPath,
    now: new Date("2026-12-12T00:20:00.000Z"),
    fetcher: async (market, count, to) => {
      requestCursors.push(to);
      return syntheticFetcher()(market, count, to);
    },
  });
  assert.equal(first.recorded, true);
  assert.equal(first.signalDate, "2026-12-10");
  assert.equal(requestCursors.length, fixture.spec.universe.length);
  assert.ok(requestCursors.every((cursor) => cursor === "2026-12-12T00:20:00Z"));
  const firstRows = recorder.readObservationChain(dataDir, fixture.registration, fixture.registryPath);
  assert.equal(firstRows.length, 1);
  assert.equal(firstRows[0].payload.ranks[0].market, "KRW-CCC");
  assert.equal(firstRows[0].payload.weights.find((row) => row.weight > 0).market, "KRW-CCC");
  assert.equal(firstRows[0].payload.turnover, 1);
  assert.equal(firstRows[0].payload.transactionCost, 0.0015);
  assert.equal(firstRows[0].payload.outcomeCloseDate, "2026-12-11");

  const second = await recorder.recordFromFile(fixture.hypothesisPath, dataDir, {
    registryPath: fixture.registryPath,
    now: new Date("2026-12-13T00:20:00.000Z"),
    fetcher: syntheticFetcher(),
  });
  assert.equal(second.recorded, true);
  assert.equal(second.signalDate, "2026-12-11");
  const rows = recorder.readObservationChain(dataDir, fixture.registration, fixture.registryPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].payload.rebalance, false);
  assert.equal(rows[1].payload.turnover, 0);
  assert.equal(rows[1].payload.transactionCost, 0);

  const status = recorder.evaluateDirectory(dataDir, { registryPath: fixture.registryPath });
  const { statusSha256, ...statusBody } = status;
  assert.equal(statusSha256, sha256(Buffer.from(recorder.canonicalJson(statusBody), "utf8")));
  assert.equal(status.days, 2);
  assert.equal(status.status, "NOT_PASSED");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "status.json"), "utf8")).statusSha256, statusSha256);
});

test("retries are idempotent and missed dates are never backfilled", async (t) => {
  const root = fixtureDirectory(t);
  const fixture = writeRegisteredFixture(root);
  const dataDir = path.join(root, "data", fixture.spec.id);
  let requests = 0;
  const fetcher = async (...args) => { requests += 1; return syntheticFetcher()(...args); };
  const first = await recorder.recordFromFile(fixture.hypothesisPath, dataDir, {
    registryPath: fixture.registryPath,
    now: new Date("2026-12-12T00:20:00.000Z"),
    fetcher,
  });
  assert.equal(first.recorded, true);
  const callsBeforeRetry = requests;
  const retry = await recorder.recordFromFile(fixture.hypothesisPath, dataDir, {
    registryPath: fixture.registryPath,
    now: new Date("2026-12-12T00:25:00.000Z"),
    fetcher,
  });
  assert.deepEqual(retry, { recorded: false, reason: "OBSERVATION_ALREADY_CURRENT" });
  assert.equal(requests, callsBeforeRetry);
  await assert.rejects(recorder.recordFromFile(fixture.hypothesisPath, path.join(root, "missed"), {
    registryPath: fixture.registryPath,
    now: new Date("2026-12-13T00:20:00.000Z"),
    fetcher,
  }), /OBSERVATION_GAP_BEFORE_FIRST_RECORD/);
});

test("terminal E1 verdicts and retirement stop future market-data access", async (t) => {
  const root = fixtureDirectory(t);
  const fixture = writeRegisteredFixture(root);
  const registrationRow = JSON.parse(fs.readFileSync(fixture.registryPath, "utf8").trimEnd());
  const verdictBody = {
    schemaVersion: 1,
    sequence: 2,
    rowType: "VERDICT",
    id: fixture.spec.id,
    recordedAtUtc: "2026-12-21T01:00:00.000Z",
    previousRowSha256: registrationRow.rowSha256,
    payload: {
      evidenceEvaluatedAtUtc: "2026-12-21T00:30:00.000Z",
      evidenceSha256: "a".repeat(64),
      look: "look-1",
      lookDate: "2026-12-20",
      resultCode: "FAIL",
    },
  };
  const verdictRow = { ...verdictBody, rowSha256: sha256(Buffer.from(recorder.canonicalJson(verdictBody), "utf8")) };
  fs.appendFileSync(fixture.registryPath, recorder.canonicalJson(verdictRow) + "\n");
  const registrations = recorder.readRegistry(fixture.registryPath);
  assert.equal(registrations[0].active, false);
  let requests = 0;
  const outcome = await recorder.recordFromFile(fixture.hypothesisPath, path.join(root, "terminal"), {
    registryPath: fixture.registryPath,
    now: new Date("2026-12-22T00:20:00.000Z"),
    fetcher: async () => { requests += 1; return []; },
  });
  assert.deepEqual(outcome, { recorded: false, reason: "HYPOTHESIS_NOT_ACTIVE" });
  assert.equal(requests, 0);

  const retirementDir = path.join(root, "retired-fixture");
  const retired = writeRegisteredFixture(retirementDir, specFor("retired-fixture-only"));
  const registeredRow = JSON.parse(fs.readFileSync(retired.registryPath, "utf8").trimEnd());
  const retirementBody = {
    schemaVersion: 1,
    sequence: 2,
    rowType: "RETIRED",
    id: retired.spec.id,
    recordedAtUtc: "2026-12-10T12:00:00.000Z",
    previousRowSha256: registeredRow.rowSha256,
    payload: { reason: "temporary test fixture retirement" },
  };
  const retirementRow = { ...retirementBody, rowSha256: sha256(Buffer.from(recorder.canonicalJson(retirementBody), "utf8")) };
  fs.appendFileSync(retired.registryPath, recorder.canonicalJson(retirementRow) + "\n");
  assert.equal(recorder.readRegistry(retired.registryPath)[0].active, false);
});

test("unsupported registered signals and observations past the last look never fetch", async (t) => {
  const root = fixtureDirectory(t);
  const unsupportedSpec = { ...specFor("unsupported-fixture-only"), signal: { kind: "not-yet-supported" } };
  const unsupported = writeRegisteredFixture(root, unsupportedSpec);
  assert.equal(unsupported.registration.supported, false);
  const firstRow = JSON.parse(fs.readFileSync(unsupported.registryPath, "utf8").trimEnd());
  const supportedSpec = specFor("supported-fixture-only");
  const supportedHypothesisText = recorder.canonicalJson(supportedSpec) + "\n";
  const supportedPayload = {
    hypothesisSha256: sha256(Buffer.from(supportedHypothesisText, "utf8")),
    kContribution: supportedSpec.kContribution,
    alphaSpent: supportedSpec.alphaSpent,
    hold: supportedSpec.hold,
    universe: supportedSpec.universe,
    firstEvaluableDate: "2026-12-10",
    shortNameKo: supportedSpec.shortNameKo,
    signal: supportedSpec.signal,
    looks: supportedSpec.looks,
  };
  const supportedBody = {
    schemaVersion: 1,
    sequence: 2,
    rowType: "REGISTERED",
    id: supportedSpec.id,
    recordedAtUtc: "2026-12-09T23:00:00.000Z",
    previousRowSha256: firstRow.rowSha256,
    payload: supportedPayload,
  };
  const supportedRow = { ...supportedBody, rowSha256: sha256(Buffer.from(recorder.canonicalJson(supportedBody), "utf8")) };
  fs.appendFileSync(unsupported.registryPath, recorder.canonicalJson(supportedRow) + "\n");
  const ready = recorder.listReadyRegistrations(unsupported.registryPath, new Date("2026-12-12T00:20:00.000Z"));
  assert.deepEqual(ready.ready.map((registration) => registration.spec.id), [supportedSpec.id]);
  assert.equal(ready.reason, null);
  let requests = 0;
  assert.deepEqual(await recorder.recordRegistered(unsupported.registration, path.join(root, "unsupported"), {
    registryPath: unsupported.registryPath,
    now: new Date("2026-12-12T00:20:00.000Z"),
    fetcher: async () => { requests += 1; return []; },
  }), { recorded: false, reason: "HYPOTHESIS_SIGNAL_OR_UNIVERSE_UNSUPPORTED" });

  const cutoffSpec = {
    ...specFor("look-cutoff-fixture-only"),
    looks: [{ id: "only-look", date: "2026-12-20" }],
  };
  const cutoff = writeRegisteredFixture(path.join(root, "cutoff"), cutoffSpec, "2026-12-10");
  assert.deepEqual(await recorder.recordFromFile(cutoff.hypothesisPath, path.join(root, "after-look"), {
    registryPath: cutoff.registryPath,
    now: new Date("2026-12-22T00:20:00.000Z"),
    fetcher: async () => { requests += 1; return []; },
  }), { recorded: false, reason: "DECLARED_LOOK_WINDOW_CLOSED" });
  assert.equal(requests, 0);
});

test("edited or reordered observation rows fail hash-chain validation", async (t) => {
  const root = fixtureDirectory(t);
  const fixture = writeRegisteredFixture(root);
  const dataDir = path.join(root, "data", fixture.spec.id);
  for (const now of ["2026-12-12T00:20:00.000Z", "2026-12-13T00:20:00.000Z"]) {
    await recorder.recordFromFile(fixture.hypothesisPath, dataDir, {
      registryPath: fixture.registryPath,
      now: new Date(now),
      fetcher: syntheticFetcher(),
    });
  }
  const filePath = path.join(dataDir, recorder.RECORD_FILE);
  const original = fs.readFileSync(filePath, "utf8");
  const lines = original.trimEnd().split("\n");
  const edited = JSON.parse(lines[0]);
  edited.payload.netExcess += 0.01;
  const editedPath = path.join(root, "edited");
  fs.mkdirSync(editedPath);
  fs.writeFileSync(path.join(editedPath, recorder.RECORD_FILE), recorder.canonicalJson(edited) + "\n" + lines[1] + "\n");
  assert.throws(() => recorder.readObservationChain(editedPath, fixture.registration, fixture.registryPath), /OBSERVATION_ROW_HASH_MISMATCH/);
  const reorderedPath = path.join(root, "reordered");
  fs.mkdirSync(reorderedPath);
  fs.writeFileSync(path.join(reorderedPath, recorder.RECORD_FILE), lines.reverse().join("\n") + "\n");
  assert.throws(() => recorder.readObservationChain(reorderedPath, fixture.registration, fixture.registryPath), /OBSERVATION_CHAIN_LINK_INVALID|OBSERVATION_ROW_INVALID/);
});

test("the combined baseline/adaptive e-process matches the synthetic F2b null and alternative behavior", () => {
  const nullPasses = syntheticPassCount(0, 20, 200);
  const alternativePasses = syntheticPassCount(0.04, 20, 200);
  assert.equal(nullPasses, 0, "null synthetic paths must not pass in 200 runs");
  const reference = f2b.runScenario({
    holdDays: 20,
    dailyIc: 0.04,
    innovationShape: "symmetric-t4",
    config: { ...f2b.PRIMARY_CONFIG, replicationsPerScenario: 200 },
  }).rows[0].passByDay365;
  const observed = alternativePasses / 200;
  assert.ok(Math.abs(observed - reference) <= 0.12, `observed=${observed}, F2b fixed-mixture reference=${reference}`);
  assert.ok(alternativePasses > 0, "IC 0.04 / hold 20 synthetic alternatives should pass at a nonzero rate");
});

test("the workflow readiness query is a no-op without a registered hypothesis and before the fetch date", (t) => {
  const root = fixtureDirectory(t);
  const absentRegistry = path.join(root, "missing-events.jsonl");
  assert.deepEqual(recorder.listReadyRegistrations(absentRegistry, new Date("2026-12-20T00:20:00.000Z")), {
    ready: [],
    reason: "NO_ELIGIBLE_REGISTERED_HYPOTHESIS",
  });
  assert.deepEqual(recorder.listReadyRegistrations(absentRegistry, new Date("2026-12-09T12:00:00.000Z")), {
    ready: [],
    reason: "FETCH_DATE_NOT_REACHED",
  });
});

test("the hosted workflow is scheduled after close, main-ref-only, and limited to contents write", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/research-cross-section.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /schedule:[\s\S]*cron: "17 0 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /record:[\s\S]*permissions:\n\s+contents: write/);
  assert.match(workflow, /DATA_BRANCH: alpha-lab-cross-section-data/);
  assert.match(workflow, /refs\/heads\/\$DATA_BRANCH/);
  assert.match(workflow, /scripts\/alpha-lab\/cross-section\.js', 'ready/);
  assert.doesNotMatch(workflow, /self-hosted|wrangler|deploy|release|secrets\./i);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
});
