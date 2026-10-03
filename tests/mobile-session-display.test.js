const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "apps/mobile/src/sessionDisplayModel.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { displaySessionState, graceNotConfigured, launchSettling, LAUNCH_GRACE_MS, RESUME_GRACE_MS } = shim.exports;

test("session display model is import-free", () => {
  assert.doesNotMatch(source, /^import /m);
  assert.equal(RESUME_GRACE_MS, 5000);
});

test("a verified session re-proving on resume keeps its verified look only inside the grace window", () => {
  assert.equal(displaySessionState("RECOVERING", true, 0), "VERIFIED");
  assert.equal(displaySessionState("RECOVERING", true, 4999), "VERIFIED");
  assert.equal(displaySessionState("RECOVERING", true, 5000), "RECOVERING");
});

test("no grace without a prior verified session, and real failures always show", () => {
  assert.equal(displaySessionState("RECOVERING", false, 0), "RECOVERING");
  assert.equal(displaySessionState("RECOVERY_REQUIRED", true, 0), "RECOVERY_REQUIRED");
  assert.equal(displaySessionState("NOT_CONFIGURED", true, 0), "NOT_CONFIGURED");
});

test("only presentation reads the grace state; the refresh path still uses the real session state", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /const sessionState = getPaperSessionState\(\);/);
  assert.equal((app.match(/shownSessionState/g) || []).length, 4);
  // The safety line always gets the real session state; grace only softens its wording.
  assert.match(app, /buildSafetyLine\(\{ sessionState: paperSessionState, resuming: shownSessionState !== paperSessionState,/);
});

test("app launch gets the same grace as a resume", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /verified: lastSessionState\.current === "VERIFIED" \|\| launchPending\.current/);
  assert.match(app, /if \(paperSessionState !== "NOT_CONFIGURED"\) launchPending\.current = false;/);
});

test("grace hides only the transient not-configured notice, at its source, for every screen", () => {
  assert.equal(graceNotConfigured("PAPER endpoint must be verified", true), null, "transient setup notice is quiet during the grace");
  assert.equal(graceNotConfigured("PAPER endpoint must be verified", false), "PAPER endpoint must be verified", "after the grace the real notice shows");
  assert.equal(graceNotConfigured(null, true), null);
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
  // One source value feeds HOME, the PAPER connection screen and every other consumer.
  assert.match(app, /const notConfigured = graceNotConfigured\(/);
  // Genuine read failures are passed through untouched.
  assert.match(app, /readOnlyError=\{readOnlyError\}/);
});

test("the launch window keeps the setup notice quiet only briefly and only while the session is unverified", () => {
  assert.equal(LAUNCH_GRACE_MS, 3000);
  for (const state of ["NOT_CONFIGURED", "RECOVERING", "RECOVERY_REQUIRED"]) {
    assert.equal(launchSettling(state, 0), true, `${state} is settling right after launch`);
    assert.equal(launchSettling(state, 2000), true, "a 2 s restore stays quiet");
    assert.equal(launchSettling(state, 3000), false, "the real state shows once the window ends");
    assert.equal(launchSettling(state, 60_000), false);
  }
  assert.equal(launchSettling("VERIFIED", 100), false, "a verified session needs no quieting");
  assert.equal(launchSettling("NOT_CONFIGURED", -1), false, "a backward clock never extends the window");
  assert.equal(launchSettling("NOT_CONFIGURED", NaN), false);
});

test("App feeds the launch window into the same single not-configured source and re-renders when it ends", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /const launchedAt = useRef\(Date\.now\(\)\)/);
  assert.match(app, /const launchQuiet = launchSettling\(paperSessionState, Date\.now\(\) - launchedAt\.current\)/);
  assert.match(app, /const resumingQuietly = shownSessionState !== paperSessionState \|\| launchQuiet/);
  assert.match(app, /LAUNCH_GRACE_MS - \(Date\.now\(\) - launchedAt\.current\)/, "a timer re-renders at the end of the window");
  assert.match(app, /const notConfigured = graceNotConfigured\(/, "still one source for every screen");
});
