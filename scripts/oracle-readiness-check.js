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
const startupWaitMs = Number(process.env.NUSA_READY_STARTUP_WAIT_MS || 30_000);
const retryDelayMs = Number(process.env.NUSA_READY_RETRY_DELAY_MS || 1_000);
if (!Number.isSafeInteger(startupWaitMs) || startupWaitMs < 0 || startupWaitMs > 60_000) throw new Error("NUSA_READY_STARTUP_WAIT_MS must be an integer in [0, 60000]");
if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 5_000) throw new Error("NUSA_READY_RETRY_DELAY_MS must be an integer in [1, 5000]");
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

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const parseReadiness = (response) => {
  let parsed;
  try { parsed = JSON.parse(response.body); } catch { return { healthy: false, checks: null, ready: false, httpStatus: response.statusCode }; }
  const checks = parsed && parsed.checks;
  const checkValues = checks != null && typeof checks === "object" && !Array.isArray(checks) ? Object.values(checks) : [];
  return {
    healthy: response.statusCode === 200 && parsed?.ok === true && checkValues.length > 0 && checkValues.every((value) => value === true),
    checks: checks ?? null,
    ready: parsed?.ok === true,
    httpStatus: response.statusCode
  };
};

/**
 * A systemd restart returns after the launcher has been spawned, not after the
 * supervised runtime has bound its local dashboard port.  Probe for a bounded
 * startup window so a healthy-but-still-booting release is not rolled back.
 * This only delays acceptance: a missing, malformed, or unhealthy readiness
 * response still fails closed once the deadline expires.
 */
const awaitReadiness = async () => {
  const deadline = Date.now() + startupWaitMs;
  let attempts = 0;
  let last = { kind: "transport", message: "readiness request was not attempted" };
  for (;;) {
    attempts += 1;
    try {
      const response = await requestStatus("/ready", { authorization: `Bearer ${token}` });
      const parsed = parseReadiness(response);
      if (parsed.healthy) return { ...parsed, attempts };
      last = { kind: "response", ...parsed };
    } catch (error) {
      last = { kind: "transport", message: error instanceof Error ? error.message : "readiness request failed" };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { healthy: false, attempts, last };
    await pause(Math.min(retryDelayMs, remaining));
  }
};

const run = async () => {
  const readiness = await awaitReadiness();
  if (!readiness.healthy) {
    console.error(JSON.stringify({ status: "FAIL", stage: "startup_readiness", attempts: readiness.attempts, last: readiness.last ?? { httpStatus: readiness.httpStatus, ready: readiness.ready, checks: readiness.checks } }));
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
  console.log(JSON.stringify({ status: "PASS", httpStatus: readiness.httpStatus, ready: true, checks: readiness.checks, startupAttempts: readiness.attempts, mobileOwnerAuthRoutes: routeChecks }));
};

run().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "readiness request failed" }));
  process.exitCode = 1;
});

module.exports = { REQUIRED_MOBILE_OWNER_AUTH_ROUTES };
