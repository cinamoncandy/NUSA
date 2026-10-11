const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// The flag is read when the server starts, so set it before requiring the server module.
process.env.NUSA_CLOUD_ANONYMOUS_OBSERVATION = "1";
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { hasAuthorizationHeader } = require("../dist/apps/cloud/src/observation/anonymousObservationScope.js");

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { connection: "close", ...headers } }, (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject); req.end();
  });
}

test("any Authorization header counts as a presented credential", () => {
  for (const value of ["Bearer", "Bearer ", "Basic abc", "Bearer a b", "garbage", "Bearer valid-looking-token"]) assert.equal(hasAuthorizationHeader({ authorization: value }), true, value);
  assert.equal(hasAuthorizationHeader({}), false);
  assert.equal(hasAuthorizationHeader({ authorization: "" }), false);
});

test("a malformed or wrong credential is rejected and never downgraded to anonymous observation", async () => {
  const verifier = Object.freeze({ verify: () => undefined });
  const handle = startCloudDashboardServer({ port: 42331, tokenVerifier: verifier, loadDashboard: () => { throw new Error("not used"); }, loadPaperOperations: () => { throw new Error("SNAPSHOT_REACHED"); } });
  try {
    await new Promise((r) => setTimeout(r, 50));
    for (const authorization of ["Bearer", "Basic abc", "Bearer a b", "Bearer wrong-token"]) {
      const res = await get(handle.port ?? 42331, "/api/paper-operations", { authorization });
      assert.equal(res.status, 401, `${authorization} -> ${res.status} ${res.body}`);
    }
    const anonymous = await get(handle.port ?? 42331, "/api/paper-operations");
    assert.notEqual(anonymous.status, 401, "no credential at all is the only anonymous path");
  } finally { await handle.close?.(); handle.stop?.(); }
});
