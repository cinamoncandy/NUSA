"use strict";
/**
 * A deterministic, offline WO-0034-A4 observation smoke run.
 *
 * This exists because the only way to start a Shadow session before A4 was to click a button
 * in the Electron GUI. That makes the observation path impossible to exercise in CI and
 * impossible to rehearse before a real six-hour run. This runner drives the SAME
 * ShadowOperationalRuntime, the SAME ShadowEvidenceBus, and the SAME on-disk
 * ShadowEvidenceArchive the desktop uses -- only the market data and the clock are
 * substituted, and both are substituted with fixed values rather than randomised ones so a
 * failure reproduces exactly.
 *
 * What it does NOT do, by construction:
 *   - open a socket (there is no network client in this file, mocked or otherwise)
 *   - call any Upbit endpoint, public or private
 *   - construct a PaperBroker, place an order, or touch cash or position
 *   - accept a credential, a key, or an "enable real orders" flag
 *
 * The archive is written to a caller-supplied directory. The caller is responsible for it
 * being a scratch directory; this runner will not write into the repository.
 */
const path = require("node:path");
const { ShadowOperationalRuntime } = require("../../dist/apps/desktop/src/shadow/shadowOperationalRuntime.js");
const { ShadowEvidenceBus, DurableEvidenceSink, InMemoryEvidenceSink } = require("../../dist/apps/desktop/src/shadow/shadowEvidenceBus.js");
const { ShadowEvidenceArchive, verifyShadowEvidenceDirectory, findIncompleteShadowArchivesSync } = require("../../dist/apps/desktop/src/shadow/shadowEvidenceArchive.js");
const { StrategyEngine, SmaCrossoverStrategy } = require("../../dist/apps/desktop/src/strategy/strategyEngine.js");
const { SHADOW_OBSERVATION_PROFILE, withShortenedObservation } = require("../../dist/apps/desktop/src/shadow/shadowObservationProfile.js");
const { evaluateShadowObservationPreflight } = require("../../dist/apps/desktop/src/shadow/shadowObservationPreflight.js");
const { buildShadowObservationSummary } = require("../../dist/apps/desktop/src/shadow/shadowObservationSummary.js");
const { scanCapabilities } = require("../build-deployment-descriptor.js");

const MINUTE = 60_000;
const REPO_ROOT = path.resolve(__dirname, "..", "..");
/** A fixed, plausible wall clock. Fixed so every run of this smoke test is byte-comparable. */
const BASE_CLOCK = Date.UTC(2026, 0, 2, 0, 0, 0);
const SOURCE_COMMIT = process.env.GITHUB_SHA || "local-paper-build";
const FINGERPRINTS = Object.freeze({ strategy: "smoke-strategy", config: "smoke-config", runtime: "smoke-runtime", riskPolicy: "smoke-risk" });

/**
 * A price path that produces at least one real SMA(5)/SMA(20) crossover.
 *
 * The prices are chosen, not random: 20 flat warm-up minutes so both averages agree, then a
 * sustained rise that pulls the short average above the long one. If this ever stops
 * producing a signal the smoke test fails loudly rather than passing with zero signals.
 */
function priceAt(minute) {
  return minute <= 20 ? 100 : 100 + (minute - 20) * 40;
}

/**
 * Runs the smoke observation.
 *
 * @param {object} options
 * @param {string} options.root            Scratch directory for the evidence archive.
 * @param {number} [options.candleCount]   Closed candles to feed after warm-up. Default 6.
 * @param {number} [options.maxSessionDurationMs] Session ceiling. Must not exceed the profile's.
 * @returns {Promise<{preflight: object, summary: object, archiveDirectory: string|null}>}
 */
async function runShadowObservationSmoke(options) {
  const root = options.root;
  if (typeof root !== "string" || root.length === 0) throw new Error("smoke run requires an explicit scratch root");
  if (path.resolve(root).startsWith(REPO_ROOT + path.sep)) throw new Error("smoke run refuses to write evidence inside the repository");
  const candleCount = options.candleCount === undefined ? 6 : options.candleCount;
  // The session ceiling is measured in SIMULATED minutes -- one per candle -- so it has to
  // leave room for the candles being fed. It is not the runner's wall-clock budget: the whole
  // run finishes in well under a second of real time because the clock is a variable, not a
  // timer. Defaulting to a two-minute ceiling here would end the session after two candles,
  // before the strategy could ever cross, and the smoke test would silently observe nothing.
  const profile = options.maxSessionDurationMs === undefined
    ? SHADOW_OBSERVATION_PROFILE
    : withShortenedObservation(SHADOW_OBSERVATION_PROFILE, options.maxSessionDurationMs);

  let clock = BASE_CLOCK;
  const now = () => clock;

  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  strategy.start();

  let archive = null;
  let busCapacity = 0;
  const createEvidenceBus = ({ sessionId, createdAt, onHalt }) => {
    const pending = ShadowEvidenceArchive.create(root, {
      sessionId,
      createdAt,
      sourceCommitSha: SOURCE_COMMIT,
      symbol: profile.market,
      strategyId: profile.strategyId,
      strategyVersion: profile.strategyVersion,
      controlOrigin: "LOCAL_INTERACTIVE_UI",
      authenticatedOwner: false,
      fingerprints: FINGERPRINTS
    }).then((created) => { archive = created; return created; });
    const writer = {
      append: async (event, receivedAt) => (await pending).append(event, receivedAt),
      finalize: async (reason, generatedAt, status) => (await pending).finalize(reason, generatedAt, status)
    };
    const bus = new ShadowEvidenceBus({
      sessionId,
      capacity: profile.maxQueueDepth,
      sinks: [new InMemoryEvidenceSink(), new DurableEvidenceSink(writer, now)],
      onHalt
    });
    busCapacity = bus.diagnostics().capacity;
    return bus;
  };

  const incompleteBefore = findIncompleteShadowArchivesSync(root);

  const runtime = new ShadowOperationalRuntime({
    symbol: profile.market,
    strategyId: profile.strategyId,
    strategyVersion: profile.strategyVersion,
    sourceCommitSha: SOURCE_COMMIT,
    fingerprints: FINGERPRINTS,
    strategy,
    getPositionQuantity: () => 0,
    // The real desktop drives Automatic Paper trading here. The smoke run has no broker at
    // all, so this is a no-op -- which is also the honest statement that this run cannot
    // have moved cash or a position even by accident.
    onProductionSignal: () => {},
    riskGate: { evaluate: () => Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }) },
    getHypotheticalOrderQuantity: () => 0.001,
    getSafetyState: () => ({
      deploymentIntegrity: true, reconciliation: true, killSwitch: false,
      // safety-input-literal-ok: read-only shadow observation smoke harness. This run has no
      // broker and takes no action regardless of what getSafetyState reports (see
      // onProductionSignal above); the fixed fixture proves the wiring runs end to end, it is
      // not a live safety input a real Shadow session would use.
      openP0: false, automaticTrading: false, currentModeIsCanaryOrExtended: false
    }),
    now,
    maxSessionDurationMs: profile.maxSessionDurationMs,
    maxCandleAgeMs: profile.maxCandleAgeMs,
    createEvidenceBus,
    findIncompleteEvidence: () => incompleteBefore
  });

  // Warm up: 21 minutes of ticks, so the closed-candle adapter reaches its 20-candle warm-up.
  runtime.onWebSocketStatus("connected");
  for (let minute = 0; minute <= 20; minute += 1) {
    clock = BASE_CLOCK + minute * MINUTE;
    runtime.onTicker({ code: profile.market, trade_price: priceAt(minute), trade_timestamp: clock, trade_volume: 1, trade_id: `warmup-${minute}` });
  }

  // The capability facts come from the same scanner the deployment descriptor uses, so the
  // preflight is fed a measurement of this repository rather than a hardcoded `false`.
  const capabilities = scanCapabilities();
  const preflight = evaluateShadowObservationPreflight({
    profile,
    runtimeState: runtime.diagnostics().state,
    evidenceRecoveryState: runtime.evidenceRecoveryState(),
    incompleteEvidenceArchives: incompleteBefore,
    evidenceArchiveWritable: true,
    liveTradingCapabilityPresent: capabilities.liveTradingCapabilityPresent,
    privateApiCapabilityPresent: capabilities.privateApiCapabilityPresent,
    credentialStoragePresent: capabilities.credentialStoragePresent,
    capabilityScanMethod: "source-pattern-scan(apps,packages); proves presence, not absence",
    mutationCounters: {
      actualBrokerCallCount: runtime.diagnostics().actualBrokerCallCount,
      actualOrderCount: runtime.diagnostics().actualOrderCount,
      actualFillCount: runtime.diagnostics().actualFillCount,
      cashMutationCount: runtime.diagnostics().cashMutationCount,
      positionMutationCount: runtime.diagnostics().positionMutationCount,
      privateApiCallCount: 0
    },
    configuredMarket: runtime.diagnostics().symbol,
    configuredInterval: runtime.diagnostics().interval,
    configuredSourceType: runtime.diagnostics().sourceType,
    closedCandlesOnly: runtime.diagnostics().inputType === "CLOSED_CANDLE",
    now: clock,
    // The bus does not exist until start(); the profile's own ceiling is what will be
    // applied to it, so that is what is checked here rather than a value read after the fact.
    evidenceSinkReady: true,
    busCapacity: profile.maxQueueDepth
  });

  if (preflight.status !== "PASS") {
    return { preflight, summary: null, archiveDirectory: null };
  }

  runtime.start();
  for (let index = 0; index < candleCount; index += 1) {
    const minute = 21 + index;
    clock = BASE_CLOCK + minute * MINUTE;
    runtime.onTicker({ code: profile.market, trade_price: priceAt(minute), trade_timestamp: clock, trade_volume: 1, trade_id: `obs-${minute}a` });
    clock = BASE_CLOCK + (minute + 1) * MINUTE;
    runtime.onTicker({ code: profile.market, trade_price: priceAt(minute + 1), trade_timestamp: clock, trade_volume: 1, trade_id: `obs-${minute}b` });
  }

  const stateBeforeStop = runtime.diagnostics().state;
  if (stateBeforeStop === "RUNNING" || stateBeforeStop === "PAUSED" || stateBeforeStop === "HALTED") runtime.stop();
  await runtime.awaitEvidenceFinalized();

  const archiveDirectory = archive === null ? null : archive.directoryPath();
  const verification = archiveDirectory === null ? null : await verifyShadowEvidenceDirectory(archiveDirectory, clock);
  const completionMarker = archiveDirectory === null ? "NONE" : await readCompletionMarker(archiveDirectory);

  const summary = buildShadowObservationSummary({
    diagnostics: runtime.diagnostics(),
    evidence: runtime.evidenceDiagnostics(),
    verification,
    completionMarker,
    evidenceRecoveryState: runtime.evidenceRecoveryState(),
    privateApiCallCount: 0,
    endedAt: clock
  });

  return { preflight, summary, archiveDirectory };
}

async function readCompletionMarker(directory) {
  const { readdir } = require("node:fs/promises");
  const files = new Set(await readdir(directory));
  if (files.has("completed.marker") && files.has("aborted.marker")) return "NONE";
  if (files.has("completed.marker")) return "COMPLETED";
  if (files.has("aborted.marker")) return "ABORTED";
  return "NONE";
}

module.exports = { runShadowObservationSmoke, priceAt, BASE_CLOCK, MINUTE };
