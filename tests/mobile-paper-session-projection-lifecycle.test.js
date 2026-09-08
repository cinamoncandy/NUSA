const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("projection outcome is separated from mobile authentication lifecycle", () => {
  const session = read("apps/mobile/src/dashboardCredentialSession.ts");
  const client = read("apps/mobile/src/personalPaperOperationsClient.ts");
  assert.match(session, /projectionFailureProtectedSession = false/);
  assert.match(session, /noteProjectionResult: \(outcome: DashboardProjectionOutcome\)/);
  assert.match(session, /if \(projectionFailureProtectedSession\) \{[\s\S]*session\.clearMemory\(\);[\s\S]*return;[\s\S]*\}/);
  assert.match(session, /token !== lastAuthenticatedBootstrapToken[\s\S]*&& !projectionFailureProtectedSession/);
  assert.match(session, /projectionFailureProtectedSession && token === lastAuthenticatedBootstrapToken/);
  assert.match(client, /provider\.noteProjectionResult\?\.\(outcome\)/);
  assert.match(client, /noteProjectionResult\(options\.credentialProvider, "READY"\)/);
  assert.ok((client.match(/noteProjectionResult\(options\.credentialProvider, "PROJECTION_UNAVAILABLE"\)/g) || []).length >= 3);
  assert.match(client, /response\.status === 401 \|\| response\.status === 403 \? "AUTH_REJECTED" : "PROJECTION_UNAVAILABLE"/);
});

test("explicit endpoint change still destroys the old encrypted session", () => {
  const session = read("apps/mobile/src/dashboardCredentialSession.ts");
  assert.match(session, /if \(previous != null && previous !== next\) \{[\s\S]*void mobileApprovedSession\(\)\.disconnect\(previous\);[\s\S]*\}/);
  assert.match(session, /public clear\(\): void \{[\s\S]*void session\.disconnect\(endpoint \?\? undefined\);/);
  const approved = read("apps/mobile/src/mobileApprovedSession.ts");
  assert.match(approved, /const candidateEndpoint = baseUrl == null \? this\.endpoint : baseUrl;[\s\S]*await this\.clearLocal\(\);[\s\S]*secureEndpoint\(candidateEndpoint\)/);
});