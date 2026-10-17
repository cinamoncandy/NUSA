const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");

const script = path.resolve(__dirname, "..", "scripts", "oracle-readiness-check.js");

test("Oracle readiness dry-run reads the secret from file without printing it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-"));
  const envFile = path.join(root, "cloud-runtime.env");
  const token = "z".repeat(32);
  fs.writeFileSync(envFile, `NUSA_CLOUD_DASHBOARD_PORT=41799\nNUSA_CLOUD_DASHBOARD_HOST=127.0.0.1\nNUSA_CLOUD_DASHBOARD_TOKEN=${token}\n`, { mode: 0o640 });
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, NUSA_DRY_RUN: "1", NUSA_ENV_FILE: envFile },
    encoding: "utf8"
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(token));
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "DRY_RUN",
      host: "127.0.0.1",
      port: 41799,
      path: "/ready",
      authenticated: true
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Oracle readiness refuses public binding and weak secrets before network access", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-"));
  const envFile = path.join(root, "cloud-runtime.env");
  try {
    fs.writeFileSync(envFile, "NUSA_CLOUD_DASHBOARD_PORT=41799\nNUSA_CLOUD_DASHBOARD_HOST=0.0.0.0\nNUSA_CLOUD_DASHBOARD_TOKEN=short\n");
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, NUSA_DRY_RUN: "1", NUSA_ENV_FILE: envFile },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /readiness host must be localhost|dashboard token must be at least 32 bytes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeReadinessEnv(root, port) {
  const envFile = path.join(root, "cloud-runtime.env");
  fs.writeFileSync(envFile, `NUSA_CLOUD_DASHBOARD_PORT=${port}\nNUSA_CLOUD_DASHBOARD_HOST=127.0.0.1\nNUSA_CLOUD_DASHBOARD_TOKEN=${"z".repeat(32)}\n`, { mode: 0o640 });
  return envFile;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function runReadiness(envFile, environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, NUSA_ENV_FILE: envFile, ...environment } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function reservePort() {
  const reservation = http.createServer();
  const port = await listen(reservation);
  await close(reservation);
  return port;
}

test("Oracle readiness waits a bounded interval for the supervised runtime to become ready", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-startup-"));
  let readinessCalls = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/ready") {
      readinessCalls += 1;
      if (readinessCalls === 1) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, checks: { database: false, migrations: false, dashboardPersistence: false, runtimeRecovery: false } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, checks: { database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true } }));
      return;
    }
    if (request.url === "/v1/mobile/session/password" || request.url === "/v1/mobile/session/password/change") {
      response.writeHead(405);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, { NUSA_READY_STARTUP_WAIT_MS: "3000", NUSA_READY_RETRY_DELAY_MS: "25" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).startupAttempts > 1);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Oracle readiness remains fail-closed after its bounded startup window", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-timeout-"));
  const port = await reservePort();
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, { NUSA_READY_STARTUP_WAIT_MS: "80", NUSA_READY_RETRY_DELAY_MS: "20" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /startup_readiness/);
    assert.match(result.stderr, /ECONNREFUSED/);
    assert.ok(JSON.parse(result.stderr.split("\n")[0]).attempts > 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Oracle readiness proves the mobile owner-auth routes exist in the deployed release", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-routes-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, checks: { database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true } }));
      return;
    }
    if (request.url === "/v1/mobile/session/password" || request.url === "/v1/mobile/session/password/change") {
      response.writeHead(405);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, { NUSA_READY_STARTUP_WAIT_MS: "300", NUSA_READY_RETRY_DELAY_MS: "20" });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.mobileOwnerAuthRoutes, [
      { path: "/v1/mobile/session/password", status: 405 },
      { path: "/v1/mobile/session/password/change", status: 405 },
    ]);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Oracle readiness rejects a stale release that serves health but omits a mobile owner-auth route", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-stale-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, checks: { database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true } }));
      return;
    }
    response.writeHead(request.url === "/v1/mobile/session/password" ? 405 : 404);
    response.end();
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, { NUSA_READY_STARTUP_WAIT_MS: "300", NUSA_READY_RETRY_DELAY_MS: "20" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mobile\/session\/password\/change/);
    assert.match(result.stderr, /expectedStatus.*405/);
    assert.match(result.stderr, /actualStatus.*404|readiness request timed out/);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});


  test("defaults Oracle startup readiness to the full bounded 300 second window", () => {
  const source = fs.readFileSync(script, "utf8");
    assert.match(source, /NUSA_READY_STARTUP_WAIT_MS \|\| 300_000/);
    assert.match(source, /startupWaitMs > 300_000/);
});


test("Oracle readiness separates the long startup deadline from a bounded owner-route proof deadline", () => {
  const source = fs.readFileSync(script, "utf8");
  assert.equal(source.split("Date.now() + startupWaitMs").length - 1, 1);
  assert.equal(source.split("Date.now() + routeProofWaitMs").length - 1, 1);
  assert.ok(source.includes("awaitReadiness(deadline)"));
  assert.ok(source.includes("awaitExpectedStatus(path, 405, routeDeadline)"));
  assert.match(source, /NUSA_READY_ROUTE_PROOF_WAIT_MS \|\| 15_000/);
  assert.match(source, /routeProofWaitMs > 30_000/);
  assert.ok(source.includes('requestStatus("/ready"'));
});

test("Oracle readiness retries a transiently blocked mobile owner route within the bounded startup window", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-route-retry-"));
  let passwordCalls = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, checks: { database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true } }));
      return;
    }
    if (request.url === "/v1/mobile/session/password") {
      passwordCalls += 1;
      if (passwordCalls === 1) return;
      response.writeHead(405);
      response.end();
      return;
    }
    if (request.url === "/v1/mobile/session/password/change") {
      response.writeHead(405);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, {
      NUSA_READY_TIMEOUT_MS: "30",
      NUSA_READY_STARTUP_WAIT_MS: "300",
      NUSA_READY_ROUTE_PROOF_WAIT_MS: "300",
      NUSA_READY_RETRY_DELAY_MS: "20",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(passwordCalls >= 2);
    assert.deepEqual(JSON.parse(result.stdout).mobileOwnerAuthRoutes, [
      { path: "/v1/mobile/session/password", status: 405 },
      { path: "/v1/mobile/session/password/change", status: 405 },
    ]);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("owner-route proof survives one timeout even when /ready consumed almost all startup budget", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-separate-route-budget-"));
  let passwordCalls = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/ready") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, checks: { database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true } }));
      }, 180);
      return;
    }
    if (request.url === "/v1/mobile/session/password") {
      passwordCalls += 1;
      if (passwordCalls === 1) return;
      response.writeHead(405);
      response.end();
      return;
    }
    if (request.url === "/v1/mobile/session/password/change") {
      response.writeHead(405);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, {
      NUSA_READY_TIMEOUT_MS: "220",
      NUSA_READY_STARTUP_WAIT_MS: "250",
      NUSA_READY_ROUTE_PROOF_WAIT_MS: "500",
      NUSA_READY_RETRY_DELAY_MS: "20",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(passwordCalls >= 2);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Oracle readiness still rejects a mobile owner route that never reaches 405", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-route-timeout-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, checks: { database: true, migrations: true, dashboardPersistence: true, runtimeRecovery: true } }));
      return;
    }
    if (request.url === "/v1/mobile/session/password") return;
    response.writeHead(405);
    response.end();
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, {
      NUSA_READY_TIMEOUT_MS: "25",
      NUSA_READY_STARTUP_WAIT_MS: "100",
      NUSA_READY_ROUTE_PROOF_WAIT_MS: "120",
      NUSA_READY_RETRY_DELAY_MS: "10",
    });
    assert.notEqual(result.status, 0);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.stage, "mobile_owner_route");
    assert.equal(failure.route, "/v1/mobile/session/password");
    assert.ok(failure.attempts > 1);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed startup carries the redacted service journal tail as release evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-journal-"));
  const stub = path.join(root, "journalctl-stub.js");
  const fixture = "q".repeat(24);
  fs.writeFileSync(stub, `console.log("Error: database contains unknown migration: 024_research_intelligence_memory");\nconsole.log("NUSA_CLOUD_DASHBOARD_TOKEN=${fixture}");\n`);
  const port = await reservePort();
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, { NUSA_READY_STARTUP_WAIT_MS: "80", NUSA_READY_RETRY_DELAY_MS: "20", NUSA_READINESS_JOURNAL_STUB: stub });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\[journal\] Error: database contains unknown migration/);
    assert.match(result.stderr, /\[journal\] NUSA_CLOUD_DASHBOARD_TOKEN=\[redacted\]/);
    assert.doesNotMatch(result.stderr, new RegExp(fixture));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- #2770 item 5: name the broken transition, not just the transport error -------------------

// The script is normally spawned; load it once as a module to unit-test the classifier. Its env
// file guard runs at load time, so point it at a throwaway file and restore the caller's value.
const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-module-"));
const moduleEnvFile = path.join(moduleRoot, "cloud-runtime.env");
fs.writeFileSync(moduleEnvFile, `NUSA_CLOUD_DASHBOARD_PORT=41799\nNUSA_CLOUD_DASHBOARD_HOST=127.0.0.1\nNUSA_CLOUD_DASHBOARD_TOKEN=${"z".repeat(32)}\n`);
const inheritedEnvFile = process.env.NUSA_ENV_FILE;
process.env.NUSA_ENV_FILE = moduleEnvFile;
const { classifyStartupPhase, probeListener, supervisorUnitState } = require(script);
if (inheritedEnvFile === undefined) delete process.env.NUSA_ENV_FILE; else process.env.NUSA_ENV_FILE = inheritedEnvFile;
fs.rmSync(moduleRoot, { recursive: true, force: true });

function systemctlStub(directory, state) {
  const stub = path.join(directory, `systemctl-${state}.js`);
  fs.writeFileSync(stub, `process.stdout.write(${JSON.stringify(`${state}\n`)});\nprocess.exitCode = ${state === "active" ? 0 : 3};\n`);
  return stub;
}

test("startup phase separates a running supervisor from a bound PAPER listener", () => {
  assert.equal(classifyStartupPhase("active", false), "SUPERVISOR_ACTIVE_LISTENER_ABSENT");
  assert.equal(classifyStartupPhase("active", true), "SUPERVISOR_ACTIVE_LISTENER_BOUND");
  assert.equal(classifyStartupPhase("activating", false), "SUPERVISOR_ACTIVE_LISTENER_ABSENT");
  assert.equal(classifyStartupPhase("inactive", false), "SUPERVISOR_INACTIVE_LISTENER_ABSENT");
  assert.equal(classifyStartupPhase("failed", true), "SUPERVISOR_INACTIVE_LISTENER_BOUND");
  assert.equal(classifyStartupPhase("unknown", false), "SUPERVISOR_STATE_UNKNOWN_LISTENER_ABSENT");
  // The lease-blocked startup that opened #2770 must be nameable as exactly one code.
  assert.equal(classifyStartupPhase(supervisorUnitState("nusa", () => ({ status: 0, stdout: "active\n" })), false), "SUPERVISOR_ACTIVE_LISTENER_ABSENT");
});

test("supervisor state is read from the unit, never inferred from a failed probe", () => {
  assert.equal(supervisorUnitState("nusa", () => ({ status: 0, stdout: "active\n" })), "active");
  assert.equal(supervisorUnitState("nusa", () => ({ status: 3, stdout: "inactive\n" })), "inactive");
  assert.equal(supervisorUnitState("nusa", () => ({ status: null, stdout: "", error: new Error("spawn systemctl ENOENT") })), "unknown");
  assert.equal(supervisorUnitState("nusa", () => { throw new Error("no systemd"); }), "unknown");
  assert.equal(supervisorUnitState("nusa", () => ({ status: 0, stdout: "   \n" })), "unknown");
});

test("the listener probe reports a bound port and an absent one without guessing", async () => {
  const server = http.createServer((_request, response) => response.end("{}"));
  const port = await listen(server);
  try {
    assert.equal(await probeListener("127.0.0.1", port), true);
    await close(server);
    assert.equal(await probeListener("127.0.0.1", port), false);
    assert.equal(await probeListener("127.0.0.1", port, () => { throw new Error("no socket"); }), false);
  } finally {
    await close(server).catch(() => {});
  }
});

test("a startup timeout whose unit is active but whose listener never bound is named precisely", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-phase-"));
  const stub = systemctlStub(root, "active");
  const port = await reservePort();
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, {
      NUSA_READY_STARTUP_WAIT_MS: "80",
      NUSA_READY_RETRY_DELAY_MS: "20",
      NUSA_READINESS_SYSTEMD_STUB: stub,
    });
    assert.notEqual(result.status, 0);
    // The first stderr line stays the machine-readable verdict the release step parses.
    const failure = JSON.parse(result.stderr.split("\n")[0]);
    assert.equal(failure.stage, "startup_readiness");
    assert.equal(failure.phase, "SUPERVISOR_ACTIVE_LISTENER_ABSENT");
    assert.equal(failure.supervisor, "active");
    assert.equal(failure.listening, false);
    assert.ok(failure.attempts > 1);
    assert.match(result.stderr, /ECONNREFUSED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a bound port that never becomes ready is reported as BOUND rather than as a missing listener", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-bound-"));
  const stub = systemctlStub(root, "active");
  const server = http.createServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, checks: { database: false } }));
  });
  const port = await listen(server);
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, {
      NUSA_READY_STARTUP_WAIT_MS: "80",
      NUSA_READY_RETRY_DELAY_MS: "20",
      NUSA_READINESS_SYSTEMD_STUB: stub,
    });
    assert.notEqual(result.status, 0);
    const failure = JSON.parse(result.stderr.split("\n")[0]);
    assert.equal(failure.stage, "startup_readiness");
    assert.equal(failure.phase, "SUPERVISOR_ACTIVE_LISTENER_BOUND");
    assert.equal(failure.supervisor, "active");
    assert.equal(failure.listening, true);
    // The phase must be decided by the unit state and the listener probe, not by how the last HTTP
    // attempt failed. A bound server can still surface a transport error on a loaded runner, and
    // that must not change the classification; the transport evidence is still reported.
    assert.ok(failure.last, "the last transport evidence must still be reported");
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an inactive unit distinguishes a stopped runtime from one that is still coming up", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-inactive-"));
  const stub = systemctlStub(root, "inactive");
  const port = await reservePort();
  const envFile = writeReadinessEnv(root, port);
  try {
    const result = await runReadiness(envFile, {
      NUSA_READY_STARTUP_WAIT_MS: "80",
      NUSA_READY_RETRY_DELAY_MS: "20",
      NUSA_READINESS_SYSTEMD_STUB: stub,
    });
    assert.notEqual(result.status, 0);
    const failure = JSON.parse(result.stderr.split("\n")[0]);
    assert.equal(failure.phase, "SUPERVISOR_INACTIVE_LISTENER_ABSENT");
    assert.equal(failure.supervisor, "inactive");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the startup phase never becomes the reason for a failure", () => {
  // Probes are evidence only: a missing systemctl or a probe error must not change the verdict.
  const source = fs.readFileSync(script, "utf8");
  assert.match(source, /phase: classifyStartupPhase\(supervisor, listening\)/);
  assert.equal(source.split("Date.now() + startupWaitMs").length - 1, 1);
  assert.ok(!/throw new Error\(.+listener/i.test(source));
});
