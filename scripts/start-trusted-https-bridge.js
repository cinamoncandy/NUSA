#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");

const PORT_ENV = "NUSA_CLOUD_DASHBOARD_PORT";
const CLOUDFLARED_BIN_ENV = "NUSA_CLOUDFLARED_BIN";

function parsePort(raw) {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error(`${PORT_ENV} is required`);
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${PORT_ENV} must be an integer in [1024, 65535]`);
  }
  return port;
}

function resolveCloudflaredBinary(env) {
  const configured = env[CLOUDFLARED_BIN_ENV]?.trim();
  return configured || "cloudflared";
}

function buildCloudflaredArgs(port) {
  return Object.freeze([
    "tunnel",
    "--no-autoupdate",
    "--url",
    `http://127.0.0.1:${port}`
  ]);
}

function startBridge(env = process.env, spawnImpl = spawn) {
  const port = parsePort(env[PORT_ENV]);
  const binary = resolveCloudflaredBinary(env);
  const args = buildCloudflaredArgs(port);
  const child = spawnImpl(binary, args, {
    stdio: "inherit",
    windowsHide: true,
    shell: false,
    env: { ...env }
  });
  child.on?.("error", (error) => {
    console.error(`Trusted HTTPS bridge failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  return child;
}

if (require.main === module) startBridge();

module.exports = {
  buildCloudflaredArgs,
  parsePort,
  resolveCloudflaredBinary,
  startBridge
};
