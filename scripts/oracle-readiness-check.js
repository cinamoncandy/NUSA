"use strict";
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const { spawnSync } = require("node:child_process");

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
const startupWaitMs = Number(process.env.NUSA_READY_STARTUP_WAIT_MS || 300_000);
const routeProofWaitMs = Number(process.env.NUSA_READY_ROUTE_PROOF_WAIT_MS || 30_000);
const retryDelayMs = Number(process.env.NUSA_READY_RETRY_DELAY_MS || 1_000);
if (!Number.isSafeInteger(startupWaitMs) || startupWaitMs < 0 || startupWaitMs > 300_000) throw new Error("NUSA_READY_STARTUP_WAIT_MS must be an integer in [0, 300000]");
if (!Number.isSafeInteger(routeProofWaitMs) || routeProofWaitMs < 1 || routeProofWaitMs > 30_000) throw new Error("NUSA_READY_ROUTE_PROOF_WAIT_MS must be an integer in [1, 30000]");
if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 5_000) throw new Error("NUSA_READY_RETRY_DELAY_MS must be an integer in [1, 5000]");
const requestStatus = (path, headers = {}, deadline = Number.POSITIVE_INFINITY) => new Promise((resolve, reject) => {
  const configuredTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000;
  const remainingMs = Number.isFinite(deadline) ? Math.max(1, deadline - Date.now()) : configuredTimeoutMs;
  const req = http.request({
    host,
    port,
    method: "GET",
    path,
    headers,
    timeout: Math.min(configuredTimeoutMs, remainingMs)
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
 * startup window so a healthy-but-still-booting release is not rolled back.\n * The production 1 GB Oracle host has demonstrated >60 s cold-start readiness even for the\n * known-good rollback release, and on 2026-10-13 two activations of 3098387b7 exceeded 180 s and were rolled back\n * onto a release that could not open the migrated database, so the default budget is the 300 s maximum, still bounded/fail-closed.
 * This only delays acceptance: a missing, malformed, or unhealthy readiness
 * response still fails closed once the deadline expires.
 */
const awaitReadiness = async (deadline) => {
  let attempts = 0;
  let last = { kind: "transport", message: "readiness request was not attempted" };
  for (;;) {
    attempts += 1;
    try {
      const response = await requestStatus("/ready", { authorization: `Bearer ${token}` }, deadline);
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


const awaitExpectedStatus = async (path, expectedStatus, deadline) => {
  let attempts = 0;
  let last = { kind: "transport", message: "route probe was not attempted" };
  for (;;) {
    attempts += 1;
    try {
      const response = await requestStatus(path, {}, deadline);
      if (response.statusCode === expectedStatus) return { ok: true, statusCode: response.statusCode, attempts };
      // A concrete HTTP response proves the listener handled this route. A wrong status is a real
      // contract failure (404 previously shipped to mobile), not a transport stall, so fail fast.
      return { ok: false, attempts, last: { kind: "response", actualStatus: response.statusCode } };
    } catch (error) {
      last = { kind: "transport", message: error instanceof Error ? error.message : "route probe failed" };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, attempts, last };
    await pause(Math.min(retryDelayMs, remaining));
  }
};

// A failed startup used to report only "ECONNREFUSED" and roll back, leaving no evidence of why
// the runtime never listened. Emit the service journal tail so the release run itself carries the
// cause. Secret-shaped values are redacted; a missing journalctl never changes the verdict.
const SECRET_LINE = /(token|secret|password|authorization|bearer|api[_-]?key|private)\s*[=:]\s*\S+/gi;
function redactJournalLine(line) {
  return line.replace(SECRET_LINE, (match) => `${match.split(/[=:]/)[0]}=[redacted]`);
}
function journalTail(unit = process.env.NUSA_READINESS_JOURNAL_UNIT || "nusa", lines = 80, run = spawnSync) {
  try {
    const args = ["-u", unit, "-n", String(lines), "--no-pager", "-o", "cat"];
    // Test seam only: a Node script standing in for journalctl, so the evidence path is verified on
    // every CI platform. Production never sets it and always reads the real systemd journal.
    const stub = process.env.NUSA_READINESS_JOURNAL_STUB;
    const result = stub ? run(process.execPath, [stub, ...args], { encoding: "utf8", timeout: 10_000 }) : run("journalctl", args, { encoding: "utf8", timeout: 10_000 });
    if (result.status !== 0 || typeof result.stdout !== "string") return [];
    return result.stdout.split(/\r?\n/).filter(Boolean).map(redactJournalLine);
  } catch {
    return [];
  }
}

// systemd returning from a restart only proves the launcher was spawned. A release whose writer
// lease blocks startup keeps the unit "active" while port 41731 stays unbound, and that looks
// identical -- as a bare ECONNREFUSED -- to a runtime that is merely still booting. Classify both
// states on every startup timeout so the release run names the actual broken transition instead of
// a transport error. Both probes are bounded and read-only; neither can change the verdict.
const ACTIVE_UNIT_STATES = Object.freeze(new Set(["active", "activating", "reloading"]));
function supervisorUnitState(unit = process.env.NUSA_READINESS_SYSTEMD_UNIT || "nusa", run = spawnSync) {
  try {
    const args = ["is-active", unit];
    // Test seam only: a Node script standing in for systemctl, mirroring NUSA_READINESS_JOURNAL_STUB.
    const stub = process.env.NUSA_READINESS_SYSTEMD_STUB;
    const result = stub
      ? run(process.execPath, [stub, ...args], { encoding: "utf8", timeout: 5_000 })
      : run("systemctl", args, { encoding: "utf8", timeout: 5_000 });
    if (result.status === null || typeof result.stdout !== "string") return "unknown";
    const state = result.stdout.trim().split(/\s+/)[0];
    return state && /^[a-z-]+$/.test(state) ? state : "unknown";
  } catch {
    return "unknown";
  }
}

/** True only when something accepts a TCP connection on the dashboard port. Bounded to 2 s. */
function probeListener(targetHost, targetPort, connect = (options, onConnect) => net.connect(options, onConnect)) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (listening) => { if (!settled) { settled = true; resolve(listening); } };
    try {
      const socket = connect({ host: targetHost, port: targetPort }, () => { socket.destroy(); finish(true); });
      socket.setTimeout(2_000, () => { socket.destroy(); finish(false); });
      socket.on("error", () => { socket.destroy(); finish(false); });
    } catch {
      finish(false);
    }
  });
}

function classifyStartupPhase(supervisor, listening) {
  const unitState = ACTIVE_UNIT_STATES.has(supervisor) ? "SUPERVISOR_ACTIVE"
    : supervisor === "unknown" ? "SUPERVISOR_STATE_UNKNOWN" : "SUPERVISOR_INACTIVE";
  return `${unitState}_${listening ? "LISTENER_BOUND" : "LISTENER_ABSENT"}`;
}

const run = async () => {
  // The long startup deadline is exclusively for authenticated /ready.  Once /ready is healthy,
  // route existence is a separate, bounded non-mutating proof.  Sharing one deadline caused a
  // real post-activation false rollback when /ready consumed most of a short soak budget and the
  // first owner-route probe hit one transient transport timeout.
  const deadline = Date.now() + startupWaitMs;
  const readiness = await awaitReadiness(deadline);
  if (!readiness.healthy) {
    const supervisor = supervisorUnitState();
    const listening = await probeListener(host, port);
    console.error(JSON.stringify({ status: "FAIL", stage: "startup_readiness", phase: classifyStartupPhase(supervisor, listening), supervisor, listening, attempts: readiness.attempts, last: readiness.last ?? { httpStatus: readiness.httpStatus, ready: readiness.ready, checks: readiness.checks } }));
    for (const line of journalTail()) console.error(`[journal] ${line}`);
    process.exitCode = 1;
    return;
  }

  const routeChecks = [];
  const routeDeadline = Date.now() + routeProofWaitMs;
  for (const path of REQUIRED_MOBILE_OWNER_AUTH_ROUTES) {
    // GET is intentionally used as a non-mutating route-presence probe. The canonical handlers
    // reject it with 405; 404 means this release is stale and cannot serve the mobile client.
    // Both routes share one short route-proof deadline, independent of the startup deadline, so
    // transient event-loop stalls can retry without extending the proof indefinitely.
    const probe = await awaitExpectedStatus(path, 405, routeDeadline);
    if (!probe.ok) {
      console.error(JSON.stringify({ status: "FAIL", stage: "mobile_owner_route", route: path, expectedStatus: 405, attempts: probe.attempts, last: probe.last }));
      process.exitCode = 1;
      return;
    }
    routeChecks.push({ path, status: probe.statusCode });
  }
  console.log(JSON.stringify({ status: "PASS", httpStatus: readiness.httpStatus, ready: true, checks: readiness.checks, startupAttempts: readiness.attempts, mobileOwnerAuthRoutes: routeChecks }));
};

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "readiness request failed" }));
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_MOBILE_OWNER_AUTH_ROUTES,
  classifyStartupPhase,
  journalTail,
  probeListener,
  redactJournalLine,
  supervisorUnitState,
};
