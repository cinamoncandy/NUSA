const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("cloud server wires anonymous observation without weakening protected routes", () => {
  const source = read("apps/cloud/src/server.ts");
  assert.match(source, /anonymousObservationEnabled/);
  assert.match(source, /createAnonymousObservationScope/);
  assert.match(source, /isAnonymousObservationRoute/);
  assert.match(source, /!hasBearerToken\(dashboardRequest\.headers\)/);
  assert.match(source, /req\.url === "\/api\/paper-operations"[^\n]+observationRequest[^\n]+observationTokenVerifier/);
  assert.match(source, /req\.url === "\/api\/paper-orders"[\s\S]{0,900}tokenVerifier: requestTokenVerifier/);
  assert.match(source, /req\.url === "\/api\/real-readonly-operations"[^\n]+dashboardRequest[^\n]+requestTokenVerifier/);
  assert.match(source, /req\.url === "\/api\/operator\/users"[^\n]+dashboardRequest[^\n]+requestTokenVerifier/);
});

test("mobile app uses anonymous observation only before a verified session", () => {
  const source = read("apps/mobile/App.tsx");
  assert.match(source, /loadAnonymousPaperObservation/);
  assert.match(source, /if \(endpoint == null \|\| !isPaperConnectionVerified\(endpoint\)\)/);
  assert.match(source, /const result = await loadAnonymousPaperObservation\(\)/);
  assert.match(source, /if \(result\.status === "READY"\) setOperations\(\{ status: "READY", snapshot: result\.snapshot \}\)/);
  assert.match(source, /loadPersonalPaperOperations/);
});
