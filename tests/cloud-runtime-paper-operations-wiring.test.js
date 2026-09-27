const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtimePath = path.join(__dirname, "..", "apps", "cloud", "src", "runtime.ts");
const serverPath = path.join(__dirname, "..", "apps", "cloud", "src", "server.ts");

test("startCloudRuntime wires the authenticated PAPER operations loader into the actual server", () => {
  const source = fs.readFileSync(runtimePath, "utf8");
  assert.match(source, /startCloudDashboardServer\(\{/);
  assert.match(source, /const\s+loadPaperOperations\s*=\s*\(principal:\s*DashboardPrincipal\)\s*:\s*PersonalPaperOperationsSnapshot\s*=>/);
  assert.match(source, /startCloudDashboardServer\(\{[\s\S]*?\bloadPaperOperations\s*,[\s\S]*?\bsubmitPaperOrder\b/);
  assert.match(source, /buildPersonalPaperOperationsSnapshot/);
  assert.match(source, /effectiveProvider\.read\(principal\)/);
  assert.match(source, /marketConnectionState\s*===\s*"CONNECTED"/);
  assert.match(source, /researchAutomation\?\.statusProjection\?\.\(\)\s*\?\?\s*null/);
  assert.match(source, /liveAuthority|buildPersonalPaperOperationsSnapshot/);
  assert.doesNotMatch(source, /loadPaperOperations:\s*\(.*\)\s*=>\s*\{[^}]*productionMutationAllowed:\s*true/s);
});

test("runtime PAPER operations remains behind the same GET-only dashboard server boundary", () => {
  const source = fs.readFileSync(serverPath, "utf8");
  assert.match(source, /req\.url\s*===\s*"\/api\/paper-operations"/);
  assert.match(source, /handlePersonalPaperOperationsHttp/);
  assert.match(source, /tokenVerifier:\s*requestTokenVerifier/);
  assert.doesNotMatch(source, /\/api\/paper-operations[^\n]*(POST|PUT|PATCH|DELETE)/);
});

// #1855. A soak observation read HALTED with no recorded cause, so 330 minutes of evidence could
// not be attributed and had to be discarded. The fix is only trustworthy if the state and the
// reasons cannot disagree, which means HALTED must be *derived from* the reason list rather than
// re-deriving the same three conditions beside it. This is a structural assertion, not a
// behavioural one: it pins the single-source shape, and the receipt-level behaviour is covered in
// tests/paper-elapsed-soak.test.js.
test("HALTED is derived from the recorded halt reasons, so state and cause cannot drift", () => {
  const source = fs.readFileSync(runtimePath, "utf8");

  assert.match(source, /const runtimeHaltReasons: PersonalPaperRuntimeHaltReason\[\] = \[\];/);
  for (const reason of ["DASHBOARD_FAULTED", "KILL_SWITCH_ACTIVE", "AI_P0_OPEN", "AI_P0_UNVERIFIABLE"]) {
    assert.match(source, new RegExp(`runtimeHaltReasons\\.push\\("${reason}"\\)`), reason);
  }

  // The state reads the list; it must not re-test the same inputs on its own.
  assert.match(source, /const runtimeState = runtimeHaltReasons\.length > 0 \? "HALTED" as const/);
  assert.doesNotMatch(
    source,
    /const runtimeState = dashboard\.mode === "FAULTED"/,
    "re-deriving HALTED beside the reason list is what let the two disagree"
  );

  // The reasons ship only while halted, so a healthy observation carries no empty array to read
  // as evidence of a halt that did not happen.
  assert.match(source, /runtimeHaltReasons\.length > 0 \? \{ runtimeHaltReasons: Object\.freeze\(\[\.\.\.runtimeHaltReasons\]\) \} : \{\}/);
});
