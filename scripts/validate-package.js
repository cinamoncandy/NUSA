#!/usr/bin/env node
"use strict";

/**
 * Pre-packaging validation (WO-0034-A4O).
 *
 * Runs BEFORE electron-builder, and checks the things that are cheap to verify here and
 * expensive to discover after an installer has shipped:
 *
 *   - the packaged file list actually contains what the app needs to start;
 *   - no source map is included, so the installer is not a copy of the source;
 *   - the productization modules are present and compiled;
 *   - the renderer honours the strict CSP it declares;
 *   - nothing in the shipped surface offers an API key field, a live-trading toggle,
 *     or an auto-updater.
 *
 * It reports EVERY failure rather than stopping at the first: someone about to cut a release
 * should see the whole list in one run, not discover them one build at a time.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const problems = [];
const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, status: "PASS", detail: detail ?? null });
  } catch (error) {
    checks.push({ name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    problems.push(name);
  }
}

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts));

check("package metadata declares an app id, product name, and Windows target", () => {
  const pkg = JSON.parse(read("package.json"));
  if (!pkg.build || !pkg.build.appId) throw new Error("build.appId is missing");
  if (!pkg.build.productName) throw new Error("build.productName is missing");
  if (!pkg.build.win || pkg.build.win.target !== "nsis") throw new Error("build.win.target must be nsis");
  if (!pkg.version) throw new Error("version is missing");
  return `${pkg.build.productName} ${pkg.version} (${pkg.build.appId})`;
});

check("the compiled main, preload, and renderer entry points exist", () => {
  const required = [
    ["dist", "apps", "desktop", "src", "main.js"],
    ["dist", "apps", "desktop", "src", "preload.js"],
    ["apps", "desktop", "renderer", "index.html"],
    ["apps", "desktop", "renderer", "renderer.js"],
    ["apps", "desktop", "renderer", "product-screens.js"],
    ["apps", "desktop", "renderer", "product-screens.css"]
  ];
  const missing = required.filter((parts) => !exists(...parts)).map((parts) => parts.join("/"));
  if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")}`);
  return `${required.length} entry points present`;
});

check("the productization modules are compiled into dist", () => {
  const modules = [
    "userDataLayout", "appSettingsStore", "firstRunNotice", "appLogger",
    "diagnosticsExport", "zipArchive", "aboutInfo", "productionHardening",
    "updateChannel", "shutdownSequence", "ipc/productIpcValidation"
  ];
  const missing = modules.filter((name) => !exists("dist", "apps", "desktop", "src", ...name.split("/").slice(0, -1), `${name.split("/").pop()}.js`));
  if (missing.length > 0) throw new Error(`not compiled: ${missing.join(", ")}`);
  return `${modules.length} modules compiled`;
});

check("no source map is shipped inside the packaged file set", () => {
  const packaged = path.join(ROOT, "dist");
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".map")) found.push(path.relative(ROOT, full));
    }
  };
  if (fs.existsSync(packaged)) walk(packaged);
  if (found.length > 0) throw new Error(`source maps present: ${found.slice(0, 5).join(", ")}`);
  return "none";
});

check("the renderer declares a strict CSP and uses no inline script or style", () => {
  const html = read("apps", "desktop", "renderer", "index.html");
  if (!/Content-Security-Policy/.test(html)) throw new Error("index.html declares no CSP");
  if (!/default-src 'self'/.test(html)) throw new Error("CSP does not default to 'self'");
  if (/'unsafe-inline'|'unsafe-eval'/.test(html)) throw new Error("CSP relaxes inline script or eval");
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html)) throw new Error("index.html contains an inline script");
  if (/\sstyle="/.test(html)) throw new Error("index.html contains an inline style attribute");
  return "strict";
});

check("no shipped surface offers a credential field, a live-trading toggle, or an updater", () => {
  const rendererDirectory = path.join(ROOT, "apps", "desktop", "renderer");
  const files = fs.readdirSync(rendererDirectory).filter((name) => name.endsWith(".js") || name.endsWith(".html"));
  const forbidden = [
    [/type\s*=\s*["']password["']/i, "a password input"],
    [/\b(api[-_]?key|secret[-_]?key|access[-_]?key)\b\s*[:=]/i, "a credential field"],
    [/enableLiveTrading|liveTradingEnabled\s*[:=]\s*true/, "a live-trading toggle"],
    [/autoUpdater|electron-updater/, "an auto-updater"]
  ];
  const hits = [];
  for (const name of files) {
    const source = fs.readFileSync(path.join(rendererDirectory, name), "utf8");
    for (const [pattern, description] of forbidden) {
      if (pattern.test(source)) hits.push(`${name}: ${description}`);
    }
  }
  if (hits.length > 0) throw new Error(hits.join("; "));
  return `${files.length} renderer files clean`;
});

check("the release documentation is present", () => {
  const doc = read("docs", "operations", "release-productization.md");
  const required = ["첫 실행", "설정 초기화", "진단", "정상 종료", "출시 전 체크리스트"];
  const missing = required.filter((needle) => !doc.includes(needle));
  if (missing.length > 0) throw new Error(`sections missing: ${missing.join(", ")}`);
  return `${doc.length} bytes`;
});

const summary = {
  status: problems.length === 0 ? "PACKAGE_VALIDATION_PASS" : "PACKAGE_VALIDATION_FAIL",
  checked: checks.length,
  failed: problems.length,
  checks
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = problems.length === 0 ? 0 : 1;
