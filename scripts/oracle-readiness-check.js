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

if (process.env.NUSA_DRY_RUN === "1") {
  console.log(JSON.stringify({ status: "DRY_RUN", host, port, path: "/ready", authenticated: true }));
  process.exit(0);
}

const timeoutMs = Number(process.env.NUSA_READY_TIMEOUT_MS || 5000);
const req = http.request({
  host,
  port,
  method: "GET",
  path: "/ready",
  headers: { authorization: `Bearer ${token}` },
  timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000
}, (res) => {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new Error("readiness response is not JSON"); }
    const checks = parsed && parsed.checks;
    const healthy = res.statusCode === 200 && parsed?.ok === true && checks && Object.values(checks).every((value) => value === true);
    if (!healthy) {
      console.error(JSON.stringify({ status: "FAIL", httpStatus: res.statusCode, ready: parsed?.ok === true, checks: checks ?? null }));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ status: "PASS", httpStatus: res.statusCode, ready: true, checks }));
  });
});
req.on("timeout", () => req.destroy(new Error("readiness request timed out")));
req.on("error", (error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "readiness request failed" }));
  process.exitCode = 1;
});
req.end();
