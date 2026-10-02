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
const { displaySessionState, RESUME_GRACE_MS } = shim.exports;

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
  assert.match(app, /readOnlyError=\{resumingQuietly \? null : readOnlyError\} notConfigured=\{resumingQuietly \? null : notConfigured\}/, "grace keeps HOME notices quiet");
  // The safety line always gets the real session state; grace only softens its wording.
  assert.match(app, /buildSafetyLine\(\{ sessionState: paperSessionState, resuming: shownSessionState !== paperSessionState,/);
});

test("app launch gets the same grace as a resume", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /verified: lastSessionState\.current === "VERIFIED" \|\| launchPending\.current/);
  assert.match(app, /if \(paperSessionState !== "NOT_CONFIGURED"\) launchPending\.current = false;/);
});
