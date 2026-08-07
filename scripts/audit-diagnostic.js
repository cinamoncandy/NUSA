"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const out = path.join(root, "docs", "audits", `dependency-audit-details-${date}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
let raw = "";
try {
  if (os.platform() === "win32") raw = execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm audit --json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  else raw = execFileSync("pnpm", ["audit", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) { raw = String(error.stdout ?? ""); }
const start = raw.indexOf("{");
if (start < 0) { fs.writeFileSync(out, JSON.stringify({ diagnostic: "audit-json-unavailable" }, null, 2)); process.exit(0); }
let depth = 0, end = -1;
for (let i = start; i < raw.length; i += 1) { if (raw[i] === "{") depth += 1; else if (raw[i] === "}" && --depth === 0) { end = i; break; } }
let value;
try { value = JSON.parse(raw.slice(start, end + 1)); } catch { value = { diagnostic: "audit-json-parse-failed" }; }
const advisories = value.advisories ?? {};
const sanitized = {
  metadata: value.metadata ?? null,
  advisories: Object.fromEntries(Object.entries(advisories).map(([id, a]) => [id, {
    id: a.id ?? id,
    module_name: a.module_name ?? null,
    severity: a.severity ?? null,
    vulnerable_versions: a.vulnerable_versions ?? null,
    patched_versions: a.patched_versions ?? null,
    recommendation: a.recommendation ?? null,
    url: a.url ?? null,
    findings: Array.isArray(a.findings) ? a.findings.map((f) => ({ version: f.version ?? null, paths: f.paths ?? [] })) : []
  }]))
};
fs.writeFileSync(out, JSON.stringify(sanitized, null, 2));
console.log(`[audit-diagnostic] wrote ${Object.keys(sanitized.advisories).length} advisory records`);
