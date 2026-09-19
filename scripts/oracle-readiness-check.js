"use strict";
const fs = require("node:fs");
const http = require("node:http");

const envPath = process.env.NUSA_ENV_FILE || "/etc/nusa/cloud-runtime.env";
if (!fs.existsSync(envPath)) throw new Error(`missing environment file: ${envPath}`);
const values = Object.fromEntries(fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf("=");
  return index < 1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
}));
const host = values.NUSA_CLOUD_DASHBOARD_HOST || "127.0.0.1";
const port = Number(values.NUSA_CLOUD_DASHBOARD_PORT);
const token = values.NUSA_CLOUD_DASHBOARD_TOKEN || "";
if (host !== "127.0.0.1" && host.toLowerCase() !== "localhost") throw new Error("readiness host must be localhost");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("invalid readiness port");
if (Buffer.byteLength(token, "utf8") < 32) throw new Error("dashboard token must be at least 32 bytes");

// These are the exact owner-device bootstrap routes consumed by the mobile client. A release
// that answers /ready but omits either route is still unusable for the first-device flow (and
// previously caused a production 404), so readiness must fail closed before switching current.
const REQUIRED_MOBILE_OWNER_AUTH_ROUTES = Object.freeze([
  "/v1/mobile/session/password",
  "/v1/mobile/session/password/change",
]);

if (process.env.NUSA_DRY_RUN === "1") {
  console.log(JSON.stringify({ status: "DRY_RUN", host, port, path: "/ready", authenticated: true }));
  process.exit(0);
}

const timeoutMs = Number(process.env.NUSA_READY_TIMEOUT_MS || 5000);
const requestStatus = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    host,
    port,
    method: "GET",
    path,
    headers,
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000
  }, (res) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
  });
  req.on("timeout", () => req.destroy(new Error("readiness request timed out")));
  req.on("error", reject);
  req.end();
});

const run = async () => {
  let readinessResponse;
  try {
    readinessResponse = await requestStatus("/ready", { authorization: `Bearer ${token}` });
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "readiness request failed" }));
    process.exitCode = 1;
    return;
  }

  let parsed;
  try { parsed = JSON.parse(readinessResponse.body); } catch { throw new Error("readiness response is not JSON"); }
  const checks = parsed && parsed.checks;
  const healthy = readinessResponse.statusCode === 200 && parsed?.ok === true && checks && Object.values(checks).every((value) => value === true);
  if (!healthy) {
    console.error(JSON.stringify({ status: "FAIL", httpStatus: readinessResponse.statusCode, ready: parsed?.ok === true, checks: checks ?? null }));
    process.exitCode = 1;
    return;
  }

  const routeChecks = [];
  for (const path of REQUIRED_MOBILE_OWNER_AUTH_ROUTES) {
    let probe;
    try { probe = await requestStatus(path); } catch (error) {
      console.error(JSON.stringify({ status: "FAIL", route: path, error: error instanceof Error ? error.message : "mobile owner route probe failed" }));
      process.exitCode = 1;
      return;
    }
    // GET is intentionally used as a non-mutating route-presence probe. The canonical handlers
    // reject it with 405; 404 means this release is stale and cannot serve the mobile client.
    routeChecks.push({ path, status: probe.statusCode });
    if (probe.statusCode !== 405) {
      console.error(JSON.stringify({ status: "FAIL", route: path, expectedStatus: 405, actualStatus: probe.statusCode }));
      process.exitCode = 1;
      return;
    }
  }
  console.log(JSON.stringify({ status: "PASS", httpStatus: readinessResponse.statusCode, ready: true, checks, mobileOwnerAuthRoutes: routeChecks }));
};

run().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "readiness request failed" }));
  process.exitCode = 1;
});

module.exports = { REQUIRED_MOBILE_OWNER_AUTH_ROUTES };
