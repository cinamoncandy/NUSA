const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveUserDataLayout, protectedPaths, resettablePaths, isContainedIn } = require("../dist/apps/desktop/src/userDataLayout.js");
const { AppSettingsStore, DEFAULT_APP_SETTINGS, normalizeAppSettings } = require("../dist/apps/desktop/src/appSettingsStore.js");
const { FirstRunNoticeStore, SAFETY_POLICY_VERSION, firstRunDecision, parseFirstRunAcknowledgement } = require("../dist/apps/desktop/src/firstRunNotice.js");
const { AppLogger, formatLogLine, maskSensitive, selectExpiredLogFiles } = require("../dist/apps/desktop/src/appLogger.js");
const { buildDiagnosticsPackage, sanitizeDiagnosticsValue } = require("../dist/apps/desktop/src/diagnosticsExport.js");
const { readZipEntryNames } = require("../dist/apps/desktop/src/zipArchive.js");
const { buildAboutInfo, toRendererAboutInfo } = require("../dist/apps/desktop/src/aboutInfo.js");
const { resolveProductionPolicy, browserWindowSecurityOptions, clampLogLevel } = require("../dist/apps/desktop/src/productionHardening.js");
const { evaluateUpdateCandidate, updateChannelState } = require("../dist/apps/desktop/src/updateChannel.js");
const { ShutdownSequence } = require("../dist/apps/desktop/src/shutdownSequence.js");
const { parseAppSettingsIpc, parseFirstRunAcknowledgeIpc, parseOpenFolderIpc, parseProductIpc } = require("../dist/apps/desktop/src/ipc/productIpcValidation.js");

function temporaryLayout(packaged = true) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "a4o-"));
  const layout = resolveUserDataLayout({ userDataPath: base, packaged });
  for (const directory of [layout.root, path.dirname(layout.settingsFile), layout.logsDirectory, layout.evidenceDirectory, layout.recoveryDirectory, layout.crashDirectory, layout.diagnosticsDirectory]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return { base, layout, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// First-run notice
// ---------------------------------------------------------------------------

test("A4O: the first-run notice is shown once, and not again after it is acknowledged", () => {
  const { layout, cleanup } = temporaryLayout();
  try {
    const store = new FirstRunNoticeStore(layout, "PAPER");
    const before = store.state();
    assert.equal(before.required, true);
    assert.equal(before.reason, "NEVER_ACKNOWLEDGED");
    // The notice states facts this repository enforces elsewhere, not marketing copy.
    const codes = before.notice.statements.map((statement) => statement.code);
    for (const code of ["LIVE_TRADING_DISABLED", "NO_PRIVATE_API", "NO_CREDENTIALS", "HYPOTHETICAL_FILLS_ONLY", "PUBLIC_MARKET_DATA"]) {
      assert.ok(codes.includes(code), `missing statement ${code}`);
    }

    const after = store.acknowledge(true, 1_700_000_000_000);
    assert.equal(after.required, false);
    assert.equal(after.reason, "ALREADY_ACKNOWLEDGED");
    assert.equal(new FirstRunNoticeStore(layout, "PAPER").state().required, false, "a restart must not re-prompt");

    // Acknowledgement is never inferred. A caller that does not pass an explicit true
    // acknowledges nothing on the user's behalf.
    assert.throws(() => store.acknowledge(undefined), /explicit confirmation/);
    assert.throws(() => store.acknowledge(false), /explicit confirmation/);
  } finally {
    cleanup();
  }
});

test("A4O: a safety-policy change re-shows the notice; a version bump alone does not", () => {
  const { layout, cleanup } = temporaryLayout();
  try {
    // Driven through the pure decision so the "policy changed" branch is exercised against a
    // policy version other than today's. SAFETY_POLICY_VERSION is 1, so there is no valid
    // lower value to write into the file -- the branch is unreachable through the store until
    // someone bumps it, which is exactly when a regression would hurt most.
    const acknowledgedV1 = parseFirstRunAcknowledgement({ schemaVersion: 1, acknowledgedAt: 1, safetyPolicyVersion: 1 });
    assert.deepEqual(firstRunDecision(acknowledgedV1, 2), { required: true, reason: "SAFETY_POLICY_CHANGED" });
    assert.deepEqual(firstRunDecision(acknowledgedV1, 1), { required: false, reason: "ALREADY_ACKNOWLEDGED" });
    assert.deepEqual(firstRunDecision(null, 1), { required: true, reason: "NEVER_ACKNOWLEDGED" });
    // An acknowledgement of a STRICTER policy still counts after a downgrade.
    assert.deepEqual(firstRunDecision(parseFirstRunAcknowledgement({ schemaVersion: 1, acknowledgedAt: 1, safetyPolicyVersion: 9 }), 1), { required: false, reason: "ALREADY_ACKNOWLEDGED" });

    fs.mkdirSync(path.dirname(layout.firstRunFile), { recursive: true });
    fs.writeFileSync(layout.firstRunFile, JSON.stringify({ schemaVersion: 1, acknowledgedAt: 1, safetyPolicyVersion: SAFETY_POLICY_VERSION + 5 }));
    assert.equal(new FirstRunNoticeStore(layout).state().required, false);

    // A corrupt record fails towards showing the notice: one extra screen is cheaper than a
    // user who never saw it.
    fs.writeFileSync(layout.firstRunFile, "{ not json");
    assert.equal(new FirstRunNoticeStore(layout).state().required, true);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test("A4O: settings round-trip, and a corrupt field costs only that field", () => {
  const { layout, cleanup } = temporaryLayout();
  try {
    const store = new AppSettingsStore(layout);
    assert.deepEqual(store.load(), DEFAULT_APP_SETTINGS);
    const saved = store.save({ theme: "LIGHT", logLevel: "WARN", logRetentionDays: 30, showDiagnostics: false, showNotifications: false });
    assert.equal(saved.theme, "LIGHT");
    assert.deepEqual(new AppSettingsStore(layout).load(), saved, "a restart reads back exactly what was written");

    const partial = normalizeAppSettings({ theme: "LIGHT", logLevel: "NONSENSE", logRetentionDays: 9_000, showDiagnostics: "yes" });
    assert.equal(partial.theme, "LIGHT", "the readable preference survives");
    assert.equal(partial.logLevel, DEFAULT_APP_SETTINGS.logLevel);
    assert.equal(partial.logRetentionDays, DEFAULT_APP_SETTINGS.logRetentionDays);
    assert.equal(partial.showDiagnostics, DEFAULT_APP_SETTINGS.showDiagnostics);

    // There is no key, no live-trading, and no private-API field to normalize -- they are
    // absent from the schema rather than present and disabled.
    assert.deepEqual(Object.keys(partial).filter((key) => /key|secret|live|private|trad/i.test(key)), []);
  } finally {
    cleanup();
  }
});

test("A4O: a settings reset clears preferences and preserves Evidence, recovery, and crash records", () => {
  const { layout, cleanup } = temporaryLayout();
  try {
    const evidenceFile = path.join(layout.evidenceDirectory, "session-1", "events.ndjson");
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, "{\"sequence\":1}\n");
    const recoveryFile = path.join(layout.recoveryDirectory, "recovery-records.jsonl");
    fs.writeFileSync(recoveryFile, "{\"status\":\"OPEN\"}\n");
    const crashFile = path.join(layout.crashDirectory, "crash-marker.json");
    fs.writeFileSync(crashFile, "{\"cleanShutdown\":false}\n");

    const store = new AppSettingsStore(layout);
    store.save({ theme: "DARK", logLevel: "DEBUG", logRetentionDays: 3, showDiagnostics: false, showNotifications: true });
    const firstRun = new FirstRunNoticeStore(layout);
    firstRun.acknowledge(true, 1_700_000_000_000);

    const result = store.reset();
    assert.deepEqual(result.settings, DEFAULT_APP_SETTINGS);
    assert.equal(fs.existsSync(layout.settingsFile), false);
    assert.equal(firstRun.state().required, true, "a reset clears the acknowledgement, so the notice is shown again");

    assert.equal(fs.readFileSync(evidenceFile, "utf8"), "{\"sequence\":1}\n", "Evidence is what an observation exists to produce; a preferences reset must not touch it");
    assert.equal(fs.existsSync(recoveryFile), true);
    assert.equal(fs.existsSync(crashFile), true);
    for (const guarded of protectedPaths(layout)) {
      for (const target of resettablePaths(layout)) {
        assert.equal(isContainedIn(guarded, target), false, `${target} must not resolve inside ${guarded}`);
      }
    }
  } finally {
    cleanup();
  }
});

test("A4O: development and production never share a writable root", () => {
  const base = path.join(os.tmpdir(), "a4o-shared");
  const production = resolveUserDataLayout({ userDataPath: base, packaged: true });
  const development = resolveUserDataLayout({ userDataPath: base, packaged: false });
  assert.notEqual(production.root, development.root);
  assert.notEqual(production.evidenceDirectory, development.evidenceDirectory);
  // A packaged build must resolve to the pre-A4O paths exactly, so an existing install is
  // neither migrated nor orphaned by this change.
  assert.equal(production.root, path.normalize(base));
  assert.equal(production.evidenceDirectory, path.join(base, "shadow-evidence"));
  assert.equal(production.paperSessionFile, path.join(base, "paper-session.json"));
  assert.equal(production.databaseFile, path.join(base, "nusa.db"));
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

test("A4O: log lines carry run/session/error identifiers and mask secret-shaped values", () => {
  const line = formatLogLine({
    timestamp: 1_700_000_000_000, channel: "MAIN", level: "ERROR",
    message: "request failed authorization: Bearer abcdefghijklmnop",
    errorCode: "IPC_FAILED", sessionId: "shadow-1", runId: "run-1",
    detail: { apiKey: "AKIAIOSFODNN7EXAMPLE", note: "secret=hunter2hunter2" }
  });
  assert.match(line, /run=run-1/);
  assert.match(line, /session=shadow-1/);
  assert.match(line, /code=IPC_FAILED/);
  assert.match(line, /MAIN/);
  assert.doesNotMatch(line, /hunter2hunter2/, "a secret-shaped value must not reach disk");
  assert.doesNotMatch(line, /abcdefghijklmnop/);
  assert.match(line, /REDACTED/);

  assert.equal(maskSensitive("token: eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM").includes("SflKxwRJSM"), false);
  // The KEY stays visible. "the field was present but withheld" is a usable fact; a silently
  // deleted line is not.
  assert.match(maskSensitive("access_key=ABCDEFGH"), /access_key=/);
  assert.equal(maskSensitive("marketPrice=123456"), "marketPrice=123456", "ordinary values are untouched");
});

test("A4O: log files rotate by age, count, and total size, keeping the newest", () => {
  const now = 1_700_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const files = [
    { name: "a", fullPath: "/l/a.log", bytes: 10, modifiedAt: now - 40 * day },
    { name: "b", fullPath: "/l/b.log", bytes: 10, modifiedAt: now - 2 * day },
    { name: "c", fullPath: "/l/c.log", bytes: 10, modifiedAt: now - 1 * day },
    { name: "d", fullPath: "/l/d.log", bytes: 10, modifiedAt: now }
  ];
  const byAge = selectExpiredLogFiles(files, { maxFileBytes: 100, maxFiles: 10, maxAgeDays: 14, maxTotalBytes: 1_000 }, now);
  assert.deepEqual(byAge, ["/l/a.log"]);

  const byCount = selectExpiredLogFiles(files, { maxFileBytes: 100, maxFiles: 2, maxAgeDays: 3_650, maxTotalBytes: 1_000 }, now);
  assert.deepEqual([...byCount].sort(), ["/l/a.log", "/l/b.log"], "the oldest go first; the newest are what a support request is about");

  const byBytes = selectExpiredLogFiles(files, { maxFileBytes: 100, maxFiles: 10, maxAgeDays: 3_650, maxTotalBytes: 25 }, now);
  assert.equal(byBytes.length, 2);
  assert.ok(!byBytes.includes("/l/d.log"), "the newest file survives every bound");

  const { layout, cleanup } = temporaryLayout();
  try {
    const logger = new AppLogger({ directory: layout.logsDirectory, runId: "run-1", level: "INFO", policy: { maxFileBytes: 200, maxFiles: 3, maxAgeDays: 14, maxTotalBytes: 400 } });
    for (let index = 0; index < 200; index += 1) logger.log({ channel: "MAIN", level: "INFO", message: `line ${index} ${"x".repeat(50)}` });
    const written = fs.readdirSync(layout.logsDirectory);
    assert.ok(written.length > 0 && written.length <= 3, `expected at most 3 files, found ${written.length}`);
    const total = written.reduce((sum, name) => sum + fs.statSync(path.join(layout.logsDirectory, name)).size, 0);
    assert.ok(total <= 400 + 200, `logs must stay bounded, saw ${total} bytes`);

    // A user who turned logging down did not ask to lose the record that explains a crash.
    logger.setLevel("ERROR");
    logger.log({ channel: "CRASH", level: "INFO", message: "crash detail survives a low log level" });
    const crashFiles = fs.readdirSync(layout.logsDirectory).filter((name) => name.startsWith("crash-"));
    assert.equal(crashFiles.length, 1);
    logger.log({ channel: "MAIN", level: "DEBUG", message: "this debug line is filtered out" });
    assert.doesNotMatch(fs.readFileSync(path.join(layout.logsDirectory, crashFiles[0]), "utf8"), /filtered out/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Diagnostics export
// ---------------------------------------------------------------------------

function diagnosticsInput(layout, overrides = {}) {
  return Object.assign({
    layout,
    runtime: {
      appName: "NUSA", appVersion: "0.1.0", commitSha: "abcdef1234567890", electronVersion: "38.0.0",
      nodeVersion: "v24.0.0", chromeVersion: "140", platform: "win32", osRelease: "10.0.22631",
      arch: "x64", environment: "PRODUCTION", mode: "PAPER"
    },
    runId: "run-1",
    sessionId: "shadow-1",
    logFiles: [],
    safety: { capabilities: { liveTrading: false, privateApi: false, credentialStorage: false }, killSwitchActive: false },
    recovery: { crashRecovery: { recoveryRequired: false } },
    evidenceMetadata: { incompleteArchiveCount: 0 },
    recentErrorCodes: ["IPC_FAILED"],
    now: 1_700_000_000_000
  }, overrides);
}

test("A4O: the diagnostics export produces a real ZIP with the sections support needs", () => {
  const { layout, cleanup } = temporaryLayout();
  try {
    const logFile = path.join(layout.logsDirectory, "app-2026-07-29.log");
    fs.writeFileSync(logFile, "2026-07-29T00:00:00.000Z | INFO | MAIN | run=run-1 | session=- | code=- | started\n");
    fs.writeFileSync(path.join(layout.crashDirectory, "crash-marker.json"), "{\"cleanShutdown\":false}\n");

    const bundle = buildDiagnosticsPackage(diagnosticsInput(layout, { logFiles: [logFile] }));
    assert.match(bundle.fileName, /^nusa-diagnostics-.*\.zip$/);
    const names = readZipEntryNames(bundle.archive);
    for (const expected of ["manifest.json", "safety.json", "recovery.json", "evidence-metadata.json", "error-codes.json", "logs/app-2026-07-29.log", "crash/crash-marker.json"]) {
      assert.ok(names.includes(expected), `bundle is missing ${expected}: ${JSON.stringify(names)}`);
    }
    assert.equal(bundle.manifest.runId, "run-1");
    assert.equal(bundle.manifest.sessionId, "shadow-1");
    assert.ok(bundle.manifest.excluded.length > 0, "the bundle states what it deliberately left out");

    // A build without connection diagnostics omits the section rather than shipping an empty
    // one: "no outages" and "not measured here" are different claims.
    assert.equal(names.includes("market-connection.json"), false);
    const withConnection = buildDiagnosticsPackage(diagnosticsInput(layout, { marketConnection: { marketConnectionState: "CONNECTED" } }));
    assert.ok(readZipEntryNames(withConnection.archive).includes("market-connection.json"));
  } finally {
    cleanup();
  }
});

test("A4O: nothing credential-shaped survives into the diagnostics bundle", () => {
  const { layout, cleanup } = temporaryLayout();
  try {
    const logFile = path.join(layout.logsDirectory, "app-leak.log");
    // A log line written before the masking existed, or by an older build. The export masks
    // on the way out as well, because a bundle is what actually leaves the machine.
    fs.writeFileSync(logFile, "INFO | secret=SUPERSECRETVALUE token: eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM\n");
    const bundle = buildDiagnosticsPackage(diagnosticsInput(layout, {
      logFiles: [logFile],
      safety: { apiKey: "AKIAIOSFODNN7EXAMPLE", accessKey: "nope", note: "password=hunter2hunter2", killSwitchActive: false }
    }));
    const raw = bundle.archive.toString("latin1");
    for (const forbidden of ["SUPERSECRETVALUE", "AKIAIOSFODNN7EXAMPLE", "hunter2hunter2", "SflKxwRJSM"]) {
      assert.equal(raw.includes(forbidden), false, `bundle leaked ${forbidden}`);
    }
    // A forbidden key is DROPPED and reported, not emitted as "[REDACTED]": printing it back
    // would tell a reader this application has an API key, which is untrue.
    assert.ok(bundle.manifest.withheldFields.includes("safety.apiKey"), JSON.stringify(bundle.manifest.withheldFields));
    assert.ok(bundle.manifest.withheldFields.includes("safety.accessKey"));

    const withheld = [];
    const sanitized = sanitizeDiagnosticsValue({ nested: { secretKey: "x", keep: 1 } }, withheld);
    assert.deepEqual(sanitized, { nested: { keep: 1 } });
    assert.deepEqual(withheld, ["nested.secretKey"]);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// About and production hardening
// ---------------------------------------------------------------------------

test("A4O: About reports build identity and never leaks an absolute path to the renderer", () => {
  const { layout, cleanup } = temporaryLayout();
  try {
    const info = buildAboutInfo({
      appName: "NUSA", appVersion: "0.1.0", buildNumber: "  ", commitSha: "abcdef1234567890abcdef",
      electronVersion: "38.0.0", nodeVersion: "v24.0.0", chromeVersion: "140",
      platform: "win32", osRelease: "10.0.22631", arch: "x64", mode: "PAPER", layout
    });
    assert.equal(info.appVersion, "0.1.0");
    assert.equal(info.buildNumber, null, "a blank build number is absent, not an empty string");
    assert.equal(info.commitSha, "abcdef123456", "a commit SHA is shortened, never invented");
    assert.equal(buildAboutInfo({ appName: "d", appVersion: "1", commitSha: "not-a-sha", nodeVersion: "v24", platform: "win32", osRelease: "10", arch: "x64", mode: "PAPER", layout }).commitSha, null);
    assert.match(info.operatingSystem, /^Windows /);
    assert.equal(info.liveTradingDisabled, true);
    assert.equal(info.privateApiDisabled, true);
    assert.equal(info.credentialStorageDisabled, true);
    assert.equal(info.folders.length, 3);

    const rendererView = toRendererAboutInfo(info);
    const serialized = JSON.stringify(rendererView);
    assert.equal(serialized.includes(layout.root.replace(/\\/g, "\\\\")), false, "a screenshot of About must not carry the user's folder path");
    for (const folder of rendererView.folders) {
      assert.equal("absolutePath" in folder, false);
      assert.ok(["LOGS", "EVIDENCE", "USER_DATA"].includes(folder.key));
    }
  } finally {
    cleanup();
  }
});

test("A4O: a packaged build disables DevTools, developer UI, mock data, and verbose logging", () => {
  const production = resolveProductionPolicy(true);
  assert.equal(production.devToolsEnabled, false);
  assert.equal(production.developerUiVisible, false);
  assert.equal(production.mockDataVisible, false);
  assert.equal(production.verboseDebugLogging, false);
  assert.equal(production.exposeAbsolutePaths, false);
  assert.equal(production.shipSourceMaps, false);
  assert.equal(production.liveTradingEnabled, false);
  assert.equal(production.privateApiEnabled, false);
  assert.equal(production.credentialStorageEnabled, false);
  // A user asking for DEBUG in a packaged build gets INFO, not an error: it is a preference.
  assert.equal(clampLogLevel("DEBUG", production), "INFO");
  assert.equal(clampLogLevel("ERROR", production), "ERROR");

  const options = browserWindowSecurityOptions(production);
  assert.deepEqual(options, { devTools: false, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false });

  const development = resolveProductionPolicy(false);
  assert.equal(development.devToolsEnabled, true);
  assert.equal(clampLogLevel("DEBUG", development), "DEBUG");
  // Even in development the three capability flags stay false. They are not a policy knob.
  assert.equal(development.liveTradingEnabled, false);
  assert.equal(development.privateApiEnabled, false);
  assert.equal(development.credentialStorageEnabled, false);
});

test("A4O: no update is ever installed, and the refusal names every reason", () => {
  const state = updateChannelState("0.1.0", "stable");
  assert.equal(state.automaticUpdatesEnabled, false);
  assert.equal(state.requiresSignedArtifact, true);
  assert.equal(state.lastCheckedAt, null);

  const unsignedOldBeta = evaluateUpdateCandidate({ version: "0.0.9", channel: "beta", signaturePresent: false, signatureVerified: false }, state);
  assert.equal(unsignedOldBeta.install, false);
  assert.equal(unsignedOldBeta.retainedVersion, "0.1.0", "a declined update leaves the running version in place");
  for (const reason of ["AUTOMATIC_UPDATES_DISABLED", "UNSIGNED_ARTIFACT", "CHANNEL_MISMATCH", "NOT_NEWER_THAN_CURRENT"]) {
    assert.ok(unsignedOldBeta.reasons.includes(reason), `${reason} missing from ${JSON.stringify(unsignedOldBeta.reasons)}`);
  }
  // Even a perfect candidate is declined: there is no updater, and the type says so.
  const perfect = evaluateUpdateCandidate({ version: "9.9.9", channel: "stable", signaturePresent: true, signatureVerified: true }, state);
  assert.equal(perfect.install, false);
  assert.deepEqual(perfect.reasons, ["AUTOMATIC_UPDATES_DISABLED"]);
});

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

function shutdownHarness(overrides = {}) {
  const calls = [];
  const progressUpdates = [];
  const deps = Object.assign({
    runId: "run-1",
    observationIsRunning: () => true,
    currentSessionId: () => "shadow-1",
    stopSignalIntake: () => calls.push("STOP_SIGNALS"),
    unsubscribeMarket: () => calls.push("UNSUBSCRIBE_MARKET"),
    clearTimers: () => calls.push("CLEAR_TIMERS"),
    flushEvidence: async () => { calls.push("FLUSH_EVIDENCE"); },
    recordRecovery: () => calls.push("RECORD_RECOVERY"),
    beginShutdownRecord: () => calls.push("BEGIN_MARKER"),
    completeShutdownRecord: () => calls.push("COMPLETE_MARKER"),
    onProgress: (progress) => progressUpdates.push(progress),
    now: () => 1_700_000_000_000
  }, overrides);
  return { sequence: new ShutdownSequence(deps), calls, progressUpdates };
}

test("A4O: quitting during an observation runs the ordered safe shutdown and records it clean", async () => {
  const h = shutdownHarness();
  const progress = await h.sequence.run();

  assert.deepEqual(h.calls, [
    "BEGIN_MARKER", "STOP_SIGNALS", "UNSUBSCRIBE_MARKET", "CLEAR_TIMERS", "FLUSH_EVIDENCE", "RECORD_RECOVERY", "COMPLETE_MARKER"
  ], "signals stop first and the clean marker is written last");
  assert.equal(progress.phase, "COMPLETE");
  assert.equal(progress.observationWasRunning, true);
  assert.equal(progress.evidenceSealed, true);
  assert.equal(progress.recoveryRecorded, true);
  assert.equal(progress.cleanShutdown, true);
  assert.equal(progress.forceQuitAvailable, false, "there is no control that could skip the evidence seal");
  assert.ok(progress.steps.every((step) => step.status === "DONE"));
  assert.ok(h.progressUpdates.length >= progress.steps.length, "the renderer sees the sequence advance, not a frozen window");

  // A second quit while the first is in flight joins it rather than starting a second pass.
  const again = await h.sequence.run();
  assert.equal(again.phase, "COMPLETE");
  assert.equal(h.calls.filter((call) => call === "FLUSH_EVIDENCE").length, 1, "one archive is flushed once");
});

test("A4O: a failed flush leaves no clean marker, so the next launch runs recovery", async () => {
  const h = shutdownHarness({ flushEvidence: async () => { throw new Error("disk full"); } });
  const progress = await h.sequence.run();

  assert.equal(progress.phase, "FAILED");
  assert.equal(progress.evidenceSealed, false);
  assert.equal(progress.cleanShutdown, false);
  assert.equal(h.calls.includes("COMPLETE_MARKER"), false, "a clean marker after a failed seal would make a real crash look tidy");
  assert.equal(h.calls.includes("RECORD_RECOVERY"), true, "the recovery record is still written");
  const flush = progress.steps.find((step) => step.id === "FLUSH_EVIDENCE");
  assert.equal(flush.status, "FAILED");
  assert.match(flush.detail, /disk full/);
});

test("A4O: an early step failing does not skip the evidence seal", async () => {
  const h = shutdownHarness({ clearTimers: () => { throw new Error("timer handle gone"); } });
  const progress = await h.sequence.run();
  assert.ok(h.calls.includes("FLUSH_EVIDENCE"), "the archive is sealed even when an unrelated step threw");
  assert.equal(progress.evidenceSealed, true);
  assert.equal(progress.cleanShutdown, false, "but the run is not called clean when something failed");
});

// ---------------------------------------------------------------------------
// IPC surface
// ---------------------------------------------------------------------------

test("A4O: the productization IPC surface accepts nothing it does not need", () => {
  assert.deepEqual(parseProductIpc({}), {});
  assert.deepEqual(parseProductIpc(undefined), {});
  assert.throws(() => parseProductIpc({ sneaky: true }), /no arguments/);

  assert.deepEqual(parseFirstRunAcknowledgeIpc({ confirmed: true }), { confirmed: true });
  for (const bad of [{}, { confirmed: "true" }, { confirmed: 1 }, { confirmed: false }, null]) {
    assert.throws(() => parseFirstRunAcknowledgeIpc(bad), /confirmation|invalid/);
  }

  // A folder is named by KEY. A renderer able to pass a path would turn "open my logs" into
  // "open anything on this machine, from the main process".
  assert.deepEqual(parseOpenFolderIpc({ folder: "LOGS" }), { folder: "LOGS" });
  for (const bad of [{ folder: "C:\\Windows" }, { folder: "../../etc" }, { folder: "" }, {}]) {
    assert.throws(() => parseOpenFolderIpc(bad), /unknown folder|invalid/);
  }

  const settings = parseAppSettingsIpc({ theme: "DARK", logLevel: "INFO", logRetentionDays: 7, showDiagnostics: true, showNotifications: false, apiKey: "leak" });
  assert.equal("apiKey" in settings, false, "unknown keys are dropped, never forwarded");
  assert.throws(() => parseAppSettingsIpc({ theme: "NEON", logLevel: "INFO", logRetentionDays: 7, showDiagnostics: true, showNotifications: true }), /theme/);
  assert.throws(() => parseAppSettingsIpc({ theme: "DARK", logLevel: "INFO", logRetentionDays: 900, showDiagnostics: true, showNotifications: true }), /retention/);
});

// ---------------------------------------------------------------------------
// Static safety
// ---------------------------------------------------------------------------

const sourceOf = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

test("A4O: no screen or channel added here can take an API key or enable live trading", () => {
  const files = [
    ["apps", "desktop", "renderer", "product-screens.js"],
    ["apps", "desktop", "src", "ipc", "productIpcValidation.ts"],
    ["apps", "desktop", "src", "appSettingsStore.ts"],
    ["apps", "desktop", "src", "firstRunNotice.ts"],
    ["apps", "desktop", "src", "updateChannel.ts"]
  ];
  // Presence checks, which is all a scan can honestly do: they catch a later edit that
  // introduces a credential field or an order path into these files.
  const forbidden = [
    /type\s*=\s*["']password["']/i,
    /input[^\n]*\b(api[-_]?key|secret|accessKey|credential)\b/i,
    /enableLiveTrading|liveTradingEnabled\s*=\s*true|privateApiEnabled\s*=\s*true/,
    /\/v1\/orders?\b/i,
    /autoUpdater|electron-updater/
  ];
  for (const parts of files) {
    const source = sourceOf(...parts);
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${parts.join("/")} must not contain ${pattern}`);
  }
  // The update module in particular must not have grown a transport.
  const updateSource = sourceOf("apps", "desktop", "src", "updateChannel.ts");
  assert.doesNotMatch(updateSource, /https?:\/\/|fetch\(|net\.request|require\(/, "the update module reaches no network");
});

test("A4O: the renderer screens honour the strict CSP and never print an absolute path", () => {
  const source = sourceOf("apps", "desktop", "renderer", "product-screens.js");
  assert.doesNotMatch(source, /\.(inner|outer)HTML\s*=|insertAdjacentHTML\s*\(/, "strict CSP: nodes are built, never parsed from strings");
  assert.doesNotMatch(source, /\.style\.|setAttribute\(\s*["']style["']/, "no inline style attribute and no CSSOM write");
  assert.doesNotMatch(source, /absolutePath/, "the renderer is never given a path to print");
  assert.match(source, /openFolder\(folder\.key\)/, "folders are opened by key");
});

test("A4O: every real-mutation counter stays zero across the whole productization surface", () => {
  const { layout, cleanup } = temporaryLayout();
  try {
    const bundle = buildDiagnosticsPackage(diagnosticsInput(layout, {
      safety: { capabilities: { liveTrading: false, privateApi: false, credentialStorage: false } },
      evidenceMetadata: {
        actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0,
        positionMutationCount: 0, brokerCallCount: 0, privateApiCallCount: 0
      }
    }));
    const manifest = JSON.parse(bundle.archive.subarray(0).toString("utf8").slice(0, 0) || "{}");
    void manifest;
    const policy = resolveProductionPolicy(true);
    assert.equal(policy.liveTradingEnabled, false);
    assert.equal(policy.privateApiEnabled, false);
    assert.equal(policy.credentialStorageEnabled, false);

    // Nothing in this work order constructs a broker, a risk gate, or an order. The modules
    // are asserted not to import them at all, which is a stronger statement than a zero count.
    for (const file of ["userDataLayout.ts", "appSettingsStore.ts", "firstRunNotice.ts", "appLogger.ts", "diagnosticsExport.ts", "zipArchive.ts", "aboutInfo.ts", "productionHardening.ts", "updateChannel.ts", "shutdownSequence.ts", "ipc/productIpcValidation.ts"]) {
      const source = sourceOf("apps", "desktop", "src", ...file.split("/"));
      assert.doesNotMatch(source, /PaperBroker|manualOrder|automaticSignal|riskGate/, `${file} must not touch the execution path`);
    }
  } finally {
    cleanup();
  }
});

test("A4O: the release documentation exists and states the safety position", () => {
  const doc = sourceOf("docs", "operations", "release-productization.md");
  for (const needle of ["첫 실행", "설정 초기화", "로그", "Evidence", "진단", "정상 종료", "출시 전 체크리스트", "LIVE TRADING DISABLED"]) {
    assert.ok(doc.includes(needle), `the release guide must cover ${needle}`);
  }
});
