const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategyEngine.js");
const { ShadowOperationalRuntime } = require("../dist/apps/desktop/src/shadowOperationalRuntime.js");
const { createShadowEvidenceBusFactory } = require("../dist/apps/desktop/src/shadowEvidenceComposition.js");
const { verifyShadowEvidenceDirectory, findIncompleteShadowArchives } = require("../dist/apps/desktop/src/shadowEvidenceArchive.js");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "main.ts"), "utf8");
const SYMBOL = "KRW-BTC";
const MINUTE = 60_000;
const COMMIT = "a".repeat(40);

/**
 * Drives the real Shadow runtime against the same bus factory main.ts composes. Only the
 * archive root differs -- the desktop uses userData, this uses a temp directory.
 */
function makeRuntime(root, findIncompleteEvidence) {
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  strategy.start();
  let now = 0;
  const runtime = new ShadowOperationalRuntime({
    symbol: SYMBOL,
    strategyId: "sma-crossover",
    strategyVersion: "sma-crossover:closed-candle-1m-v1",
    sourceCommitSha: COMMIT,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    strategy,
    getPositionQuantity: () => 0,
    onProductionSignal: () => {},
    riskGate: { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) },
    getHypotheticalOrderQuantity: () => 0.001,
    getSafetyState: () => ({
      deploymentIntegrity: true, reconciliation: true, killSwitch: false,
      openP0: false, automaticTrading: false, currentModeIsCanaryOrExtended: false
    }),
    now: () => now,
    createEvidenceBus: createShadowEvidenceBusFactory({
      root,
      sourceCommitSha: COMMIT,
      symbol: SYMBOL,
      strategyId: "sma-crossover",
      strategyVersion: "sma-crossover:closed-candle-1m-v1",
      fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" }
    }),
    ...(findIncompleteEvidence ? { findIncompleteEvidence } : {})
  });
  return {
    runtime,
    warmUp: () => {
      runtime.onWebSocketStatus("connected");
      for (let minute = 0; minute <= 20; minute += 1) {
        now = minute * MINUTE;
        runtime.onTicker({ code: SYMBOL, trade_price: 100, trade_timestamp: minute * MINUTE, trade_volume: 1, trade_id: `w-${minute}` });
      }
    },
    crossover: (minute, price) => {
      now = minute * MINUTE;
      runtime.onTicker({ code: SYMBOL, trade_price: price, trade_timestamp: minute * MINUTE, trade_volume: 1, trade_id: `x-${minute}a` });
      now = (minute + 1) * MINUTE;
      runtime.onTicker({ code: SYMBOL, trade_price: price, trade_timestamp: (minute + 1) * MINUTE, trade_volume: 1, trade_id: `x-${minute}b` });
    }
  };
}

test("the factory main.ts composes writes a real, verifiable archive under the given root", async (t) => {
  const root = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), "shadow-wiring-")), "shadow-evidence");
  t.after(() => fsp.rm(path.dirname(root), { recursive: true, force: true }));

  // The root does not exist yet: the desktop's userData has no shadow-evidence directory on a
  // first run, so the factory has to create it rather than fail the session's first write.
  assert.equal(fs.existsSync(root), false);

  const h = makeRuntime(root);
  h.warmUp();
  h.runtime.start();
  h.crossover(21, 300);
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();

  assert.equal(h.runtime.diagnostics().state, "COMPLETED");
  const sessions = await fsp.readdir(root);
  assert.equal(sessions.length, 1, "one session archive per started session");
  const verification = await verifyShadowEvidenceDirectory(path.join(root, sessions[0]));
  assert.equal(verification.status, "PASS", JSON.stringify(verification.blockers));
  assert.equal(verification.actualBrokerCalls, 0);
  assert.equal(verification.actualOrders, 0);
  assert.equal(verification.actualFills, 0);
  assert.equal(verification.cashMutations, 0);
  assert.equal(verification.positionMutations, 0);
  // A sealed archive leaves nothing for the next process to recover.
  assert.deepEqual(await findIncompleteShadowArchives(root), []);
});

test("an archive left unsealed by a previous process blocks the next start", async (t) => {
  const root = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), "shadow-wiring-")), "shadow-evidence");
  t.after(() => fsp.rm(path.dirname(root), { recursive: true, force: true }));

  // Simulate a crashed process: an archive directory with no completed/aborted marker.
  await fsp.mkdir(path.join(root, "crashed-session"), { recursive: true });
  await fsp.writeFile(path.join(root, "crashed-session", "events.ndjson"), "", "utf8");
  const incomplete = await findIncompleteShadowArchives(root);
  assert.equal(incomplete.length, 1);

  const h = makeRuntime(root, () => incomplete);
  h.warmUp();
  const result = h.runtime.start();
  assert.equal(result.state, "HALTED");
  assert.ok(result.blockers.includes("EVIDENCE_RECOVERY_REQUIRED"), JSON.stringify(result.blockers));
  assert.equal(h.runtime.evidenceRecoveryState(), "RECOVERY_REQUIRED");
  // Nothing new was written beside the unsealed archive: a blocked start must not create a
  // second archive that recovery would then have to disentangle from the first.
  assert.deepEqual(await fsp.readdir(root), ["crashed-session"]);
});

test("main.ts scans for incomplete archives before the runtime exists, and never again", () => {
  const scan = source.indexOf("await findIncompleteShadowArchives(shadowEvidenceRoot())");
  const init = source.indexOf("initializeRuntime(incompleteEvidence)");
  assert.ok(scan >= 0, "startup must scan for archives left open by a previous process");
  assert.ok(init > scan, "the scan result must be available before the Shadow runtime is constructed");
  // Re-scanning later would sweep up this process's own open archive.
  assert.match(source, /findIncompleteEvidence:\s*\(\)\s*=>\s*incompleteEvidence/);
  assert.equal(source.split("findIncompleteShadowArchives(").length - 1, 1, "exactly one call site");
});

test("main.ts seals a live Shadow archive on a clean quit", () => {
  const handler = source.match(/app\.on\("before-quit"[\s\S]*?\n\}\);/);
  assert.ok(handler, "a before-quit handler is required");
  assert.match(handler[0], /event\.preventDefault\(\)/);
  assert.match(handler[0], /shadowRuntime\.stop\(\)/);
  assert.match(handler[0], /awaitEvidenceFinalized\(\)/);
  assert.match(handler[0], /app\.quit\(\)/);
  // Without the guard the deferred quit would re-enter this handler forever.
  assert.match(handler[0], /if \(shadowEvidenceSealed \|\| !shadowRuntime\) return;/);
});

test("the desktop writes Shadow evidence under userData, not the repository", () => {
  const root = source.match(/function shadowEvidenceRoot\(\): string \{[\s\S]*?\n\}/);
  assert.ok(root, "shadowEvidenceRoot helper is required");
  assert.match(root[0], /app\.getPath\("userData"\)/);
  assert.match(root[0], /"shadow-evidence"/);
});
