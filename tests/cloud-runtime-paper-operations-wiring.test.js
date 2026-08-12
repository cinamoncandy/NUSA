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
  assert.match(source, /tokenVerifier:\s*accessControlledTokenVerifier/);
  assert.doesNotMatch(source, /\/api\/paper-operations[^\n]*(POST|PUT|PATCH|DELETE)/);
});
