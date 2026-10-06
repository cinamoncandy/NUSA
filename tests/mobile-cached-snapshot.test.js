const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/cachedSnapshotModel.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { serializeCache, parseCache, shouldSaveCache, staleLabel, CACHE_MAX_AGE_MS } = shim.exports;
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
const NOW = Date.UTC(2026, 9, 3, 6, 0, 0);
const EP = "https://nusa-api.example";
const ok = (v) => v;

test("a stored snapshot round-trips only for the same endpoint", () => {
  const raw = serializeCache({ health: "HEALTHY" }, NOW - 5 * 60_000, EP);
  assert.deepEqual(parseCache(raw, NOW, EP, ok).snapshot, { health: "HEALTHY" });
  assert.equal(parseCache(raw, NOW, "https://other", ok), null);
  assert.equal(parseCache(raw, NOW, "", ok), null);
});

test("expired, future-dated, malformed and invalid entries are rejected", () => {
  assert.equal(parseCache(serializeCache({}, NOW - CACHE_MAX_AGE_MS - 1, EP), NOW, EP, ok), null);
  assert.equal(parseCache(serializeCache({}, NOW + 10 * 60_000, EP), NOW, EP, ok), null);
  assert.equal(parseCache("{not json", NOW, EP, ok), null);
  assert.equal(parseCache(null, NOW, EP, ok), null);
  assert.equal(parseCache(JSON.stringify({ savedAt: "x", endpoint: EP, snapshot: {} }), NOW, EP, ok), null);
  assert.equal(parseCache(serializeCache({}, NOW, EP), NOW, EP, () => { throw new Error("schema"); }), null, "a snapshot the validator rejects is never shown");
});

test("serialization fails closed on bad input and oversize", () => {
  assert.equal(serializeCache({}, 0, EP), null);
  assert.equal(serializeCache({}, NOW, " "), null);
  assert.equal(serializeCache({ big: "x".repeat(500_000) }, NOW, EP), null);
  const circular = {}; circular.self = circular;
  assert.equal(serializeCache(circular, NOW, EP), null);
});

test("saving is throttled to once a minute", () => {
  assert.equal(shouldSaveCache(null, NOW), true);
  assert.equal(shouldSaveCache(NOW - 10_000, NOW), false);
  assert.equal(shouldSaveCache(NOW - 60_000, NOW), true);
  assert.equal(shouldSaveCache(NOW + 5_000, NOW), true, "a clock that moved back does not freeze saving");
});

test("the age label is plain Korean and never claims freshness", () => {
  assert.equal(staleLabel(NOW - 20_000, NOW), "마지막 확인 방금 전");
  assert.equal(staleLabel(NOW - 7 * 60_000, NOW), "마지막 확인 7분 전");
  assert.equal(staleLabel(NOW - 3 * 3_600_000, NOW), "마지막 확인 3시간 전");
  assert.equal(staleLabel(NOW - 2 * 86_400_000, NOW), "마지막 확인 2일 전");
  assert.equal(staleLabel(NOW + 1000, NOW), "마지막 확인 시각 불명");
});

test("HOME shows cached values only without a live snapshot or setup request, and never as a live reading", () => {
  assert.match(view, /const stale = liveSnapshot == null && cachedSnapshot != null && notConfigured == null/);
  assert.match(view, /home-stale-note/);
  for (const guarded of [/decisionWhy = stale \|\|/, /orderReason = stale \|\|/, /buyHeartbeat = stale \|\|/, /windowNote = !stale/, /health: stale \? undefined/, /readyForPaperOperations: stale \? false/, /killSwitchActive: stale \? null/, /connectionLabel\(\{ recovering, stale, disconnected/, /snapshot: stale \? null : snapshot/, /useDailyCounts\(stale \? null/]) assert.match(view, guarded);
});

test("the app loads the cache per endpoint, stores only fresh READY snapshots, and clears it on sign-out", () => {
  assert.match(app, /useCachedSnapshot\(getConfiguredPaperEndpoint\(\) \?\? null, operations\.status === "READY" \? operations\.snapshot : null\)/);
  assert.match(app, /void clearCachedSnapshot\(\); signOut\(\)/);
  assert.match(app, /cachedSnapshot=\{cachedSnapshot\}/);
});

test("a stored snapshot is judged for structure against its own timestamp, not rejected as 15 s stale", () => {
  const hook = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/useCachedSnapshot.ts"), "utf8");
  assert.match(hook, /validatePersonalPaperOperationsSnapshot\(value as Snapshot, generatedAt\)/);
  const { validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const old = { schemaVersion: 1, liveAuthority: "NONE", productionMutationAllowed: false, generatedAt: Date.now() - 600_000 };
  assert.throws(() => validatePersonalPaperOperationsSnapshot(old), /stale/, "live validation still rejects an old one");
  let structural;
  try { validatePersonalPaperOperationsSnapshot(old, old.generatedAt); } catch (error) { structural = error; }
  assert.ok(structural instanceof Error && !/stale|future/.test(structural.message), "judged by its own time it fails only on structure");
});

// The Android touch-visual job caught this: a hook placed after the CHECKING / not-signed-in early returns changes the
// hook count between renders, and React then drops the whole app into the recovery screen.
test("every hook added for the cache is called before the App early returns (rules of hooks)", () => {
  const firstEarlyReturn = app.search(/^  if \(authStatus === "CHECKING"\) return /m);
  assert.ok(firstEarlyReturn > 0, "the early return still exists");
  const hookAt = app.indexOf("useCachedSnapshot(getConfiguredPaperEndpoint()");
  assert.ok(hookAt > 0 && hookAt < firstEarlyReturn, "useCachedSnapshot must run before the first early return");
});
