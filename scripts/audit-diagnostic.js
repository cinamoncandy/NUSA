"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function run(command) {
  try {
    if (os.platform() === "win32") return execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return execFileSync("sh", ["-lc", command], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) { return String(error.stdout ?? "").trim(); }
}
const raw = run("pnpm audit --json");
const start = raw.indexOf("{");
if (start >= 0) {
  let depth = 0, end = -1;
  for (let i = start; i < raw.length; i += 1) { if (raw[i] === "{") depth += 1; else if (raw[i] === "}" && --depth === 0) { end = i; break; } }
  try {
    const value = JSON.parse(raw.slice(start, end + 1)); const advisories = value.advisories ?? {};
    console.log(`[audit-diagnostic] advisory-records=${Object.keys(advisories).length}`);
    for (const [id, a] of Object.entries(advisories)) {
      const versions = Array.isArray(a.findings) ? [...new Set(a.findings.map((f) => f.version).filter(Boolean))].join(",") : "";
      console.log(`[audit-diagnostic] id=${a.id ?? id} package=${a.module_name ?? "unknown"} severity=${a.severity ?? "unknown"} installed=${versions || "unknown"} vulnerable=${a.vulnerable_versions ?? "unknown"} patched=${a.patched_versions ?? "unknown"}`);
    }
  } catch { console.log("[audit-diagnostic] audit-json-parse-failed"); }
}
console.log(`[registry-diagnostic] nanoid@3.3.17 integrity=${run("pnpm view nanoid@3.3.17 dist.integrity")}`);
const packageRoot = path.dirname(require.resolve("image-size/package.json"));
for (const relative of ["dist/types/icns.js", "dist/types/utils.js", "dist/types/heif.js", "dist/types/jxl.js"]) {
  const file = path.join(packageRoot, relative);
  console.log(`[image-size-file] ${relative} exists=${fs.existsSync(file)}`);
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    console.log(`[image-size-file-content:${relative}]\n${text}\n[/image-size-file-content:${relative}]`);
  }
}
