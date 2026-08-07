"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
let raw = "";
try {
  if (os.platform() === "win32") raw = execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm audit --json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  else raw = execFileSync("pnpm", ["audit", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) { raw = String(error.stdout ?? ""); }
const start = raw.indexOf("{");
if (start < 0) { console.log("[audit-diagnostic] audit-json-unavailable"); process.exit(0); }
let depth = 0, end = -1;
for (let i = start; i < raw.length; i += 1) { if (raw[i] === "{") depth += 1; else if (raw[i] === "}" && --depth === 0) { end = i; break; } }
let value;
try { value = JSON.parse(raw.slice(start, end + 1)); } catch { console.log("[audit-diagnostic] audit-json-parse-failed"); process.exit(0); }
const advisories = value.advisories ?? {};
console.log(`[audit-diagnostic] advisory-records=${Object.keys(advisories).length}`);
for (const [id, a] of Object.entries(advisories)) {
  const versions = Array.isArray(a.findings) ? [...new Set(a.findings.map((f) => f.version).filter(Boolean))].join(",") : "";
  console.log(`[audit-diagnostic] id=${a.id ?? id} package=${a.module_name ?? "unknown"} severity=${a.severity ?? "unknown"} installed=${versions || "unknown"} vulnerable=${a.vulnerable_versions ?? "unknown"} patched=${a.patched_versions ?? "unknown"}`);
}
