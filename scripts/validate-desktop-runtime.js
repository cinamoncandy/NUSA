"use strict";
/**
 * Static, GUI-free consistency check for everything Electron's Desktop bootstrap needs at
 * runtime: the canonical Cloud authority bootstrap, legacy Electron main, preload and
 * rendererPath modules exist; apps/desktop/package.json points at the canonical bootstrap;
 * the bootstrap activates Cloud PAPER authority and schedules the secure session IPC only
 * after Electron readiness before loading the legacy runtime; local renderer assets exist;
 * and the legacy main resolves the canonical renderer entry correctly.
 * Node built-ins only, no network, no Electron, no file writes. Run after `pnpm run build`.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const errors = [];
const fail = (message) => errors.push(message);

const compiledCloudMain = path.join(ROOT, "dist", "apps", "desktop", "src", "cloudMain.js");
const compiledLegacyMain = path.join(ROOT, "dist", "apps", "desktop", "src", "main.js");
const compiledPreload = path.join(ROOT, "dist", "apps", "desktop", "src", "preload.js");
const compiledRendererPathModule = path.join(ROOT, "dist", "apps", "desktop", "src", "rendererPath.js");
const cloudMainSourcePath = path.join(ROOT, "apps", "desktop", "src", "cloudMain.ts");
const rendererIndex = path.join(ROOT, "apps", "desktop", "renderer", "index-v2.html");
const rollbackRendererIndex = path.join(ROOT, "apps", "desktop", "renderer", "index.html");

function isFile(candidate) {
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
}

for (const [label, file] of [
  ["compiled canonical Cloud Electron main", compiledCloudMain],
  ["compiled legacy Electron main", compiledLegacyMain],
  ["compiled preload", compiledPreload],
  ["compiled renderer path module", compiledRendererPathModule],
  ["canonical Cloud Electron bootstrap source", cloudMainSourcePath]
]) {
  if (!isFile(file)) fail(`Missing ${label}: ${path.relative(ROOT, file)}`);
}

if (!isFile(rendererIndex)) fail(`Missing renderer entry: ${path.relative(ROOT, rendererIndex)}`);
if (!isFile(rollbackRendererIndex)) fail(`Missing legacy renderer rollback target: ${path.relative(ROOT, rollbackRendererIndex)}`);

const desktopPackagePath = path.join(ROOT, "apps", "desktop", "package.json");
let desktopPackage;
try {
  desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, "utf8"));
} catch (error) {
  fail(`Cannot read apps/desktop/package.json: ${error instanceof Error ? error.message : String(error)}`);
}
if (desktopPackage) {
  if (typeof desktopPackage.main !== "string" || desktopPackage.main.length === 0) {
    fail(`apps/desktop/package.json has no "main" field`);
  } else {
    const resolvedMain = path.resolve(path.dirname(desktopPackagePath), desktopPackage.main);
    if (resolvedMain !== compiledCloudMain) {
      fail(
        `Desktop package main resolves incorrectly:\n` +
          `  expected: ${path.relative(ROOT, compiledCloudMain)}\n` +
          `  actual:   ${path.relative(ROOT, resolvedMain)}`
      );
    }
  }
}

const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const desktopScript = rootPackage.scripts && rootPackage.scripts.desktop;
if (typeof desktopScript !== "string" || desktopScript.length === 0) {
  fail(`Root package.json has no scripts.desktop`);
} else {
  const steps = desktopScript
    .split("&&")
    .map((step) => step.replace(/\s+/g, " ").trim())
    .filter((step) => step.length > 0);
  const buildsFirst = steps.length >= 2 && /^pnpm run build$/.test(steps[0]);
  const launchesDesktopApp = steps.some((step) => /^electron\s+apps\/desktop$/.test(step));
  const hasUserSpecificPath = /[A-Za-z]:\\|\/(?:Users|home)\//.test(desktopScript);

  if (!buildsFirst) fail(`Root desktop script does not build before launching Electron: "${desktopScript}"`);
  if (!launchesDesktopApp) fail(`Root desktop script does not launch "electron apps/desktop": "${desktopScript}"`);
  if (hasUserSpecificPath) fail(`Root desktop script contains a user-specific absolute path: "${desktopScript}"`);
}

const expectedRootMain = "dist/apps/desktop/src/cloudMain.js";
if (rootPackage.main !== expectedRootMain || rootPackage.build?.extraMetadata?.main !== expectedRootMain) {
  fail(`Root Desktop package metadata must resolve to the canonical Cloud bootstrap: ${expectedRootMain}`);
}

if (isFile(cloudMainSourcePath)) {
  const cloudMainSource = fs.readFileSync(cloudMainSourcePath, "utf8");
  const activateIndex = cloudMainSource.indexOf("activateCloudCanonicalDesktopAuthority()");
  const readyIndex = cloudMainSource.indexOf("app.whenReady()");
  const registerIndex = cloudMainSource.indexOf("registerDesktopCloudPaperIpc(ipcMain, createDesktopCloudSessionClient())");
  const legacyImportIndex = cloudMainSource.indexOf('import("./main")');
  if (activateIndex < 0 || readyIndex <= activateIndex || registerIndex <= readyIndex || legacyImportIndex <= registerIndex) {
    fail(`Canonical Cloud Desktop bootstrap order must be authority -> ready secure-session IPC -> legacy runtime`);
  }
  if (/(?:private-api|privateApi|apiKey|secretKey)\s*[:=]\s*["'][^"']+["']/i.test(cloudMainSource)) {
    fail(`Canonical Cloud Desktop bootstrap contains a credential literal`);
  }
}

if (isFile(compiledCloudMain)) {
  const cloudMainCompiled = fs.readFileSync(compiledCloudMain, "utf8");
  if (!/desktopPaperAuthorityPolicy/.test(cloudMainCompiled)) fail(`Compiled cloudMain.js does not reference desktopPaperAuthorityPolicy`);
  if (!/desktopCloudPaperIpc/.test(cloudMainCompiled)) fail(`Compiled cloudMain.js does not reference desktopCloudPaperIpc`);
  if (!/desktopCloudSessionRuntime/.test(cloudMainCompiled)) fail(`Compiled cloudMain.js does not reference desktopCloudSessionRuntime`);
  if (!/whenReady/.test(cloudMainCompiled)) fail(`Compiled cloudMain.js does not defer secure session composition until Electron readiness`);
  if (!/(?:require|import).*\.\/main|import\(["']\.\/main["']\)/.test(cloudMainCompiled)) fail(`Compiled cloudMain.js does not load the legacy Desktop runtime`);
}

if (isFile(rendererIndex)) {
  const rendererDirectory = path.dirname(rendererIndex);
  const html = fs.readFileSync(rendererIndex, "utf8");
  const attributePattern = /<(?:script|link)\b[^>]*?(?:src|href)\s*=\s*"([^"]*)"[^>]*>/gi;
  const seen = new Set();
  let match;
  while ((match = attributePattern.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    if (/^(?:https?:|data:|blob:|#)/i.test(raw)) continue;
    const withoutQueryOrFragment = raw.split(/[?#]/)[0];
    if (!withoutQueryOrFragment || seen.has(withoutQueryOrFragment)) continue;
    seen.add(withoutQueryOrFragment);
    const resolvedAsset = path.resolve(rendererDirectory, withoutQueryOrFragment);
    if (!isFile(resolvedAsset)) {
      fail(`Renderer asset not found:\n  ${path.relative(ROOT, resolvedAsset)}\n  referenced by ${path.relative(ROOT, rendererIndex)}`);
    }
  }
}

if (isFile(compiledRendererPathModule)) {
  try {
    const rendererPathModule = require(compiledRendererPathModule);
    if (typeof rendererPathModule.resolveRendererIndexPath !== "function") {
      fail(`${path.relative(ROOT, compiledRendererPathModule)} does not export resolveRendererIndexPath`);
    } else {
      const compiledLegacyMainDirectory = path.dirname(compiledLegacyMain);
      const resolved = rendererPathModule.resolveRendererIndexPath(compiledLegacyMainDirectory);
      if (resolved !== rendererIndex) fail(`Renderer path resolution mismatch:\n  expected: ${rendererIndex}\n  actual:   ${resolved}`);
      const normalized = resolved.split(path.sep).join("/");
      if (normalized.includes("apps/desktop/apps/desktop")) fail(`Renderer path resolution contains a duplicated apps/desktop segment: ${resolved}`);
    }
  } catch (error) {
    fail(`Failed to evaluate renderer path resolution: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (isFile(compiledLegacyMain)) {
  const mainSource = fs.readFileSync(compiledLegacyMain, "utf8");
  const requiresRendererPathModule = /require\(["']\.\/rendererPath["']\)/.test(mainSource);
  const loadFileUsesResolvedPath = /loadFile\([^;]*resolveRendererIndexPath[^;]*__dirname[^;]*\)/.test(mainSource);
  const hasStaleDuplication = /getAppPath\(\)\s*,\s*["']apps\/desktop\/renderer\/index\.html["']/.test(mainSource);

  if (!requiresRendererPathModule) fail(`Compiled legacy main.js does not require the renderer path module (./rendererPath)`);
  if (!loadFileUsesResolvedPath) fail(`Compiled legacy main.js does not pass resolveRendererIndexPath(__dirname)'s result to loadFile()`);
  if (hasStaleDuplication) fail(`Compiled legacy main.js still contains the fixed app.getAppPath() + "apps/desktop/renderer/index.html" duplication (WO-0003 regression)`);
}

if (errors.length > 0) {
  console.error("Desktop runtime validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Desktop runtime validation passed:");
console.log("- Canonical Cloud Electron bootstrap found");
console.log("- Legacy Electron main found");
console.log("- Preload entry found");
console.log("- Canonical renderer entry found");
console.log("- Legacy renderer rollback target found");
console.log("- Local renderer assets found");
console.log("- Package entrypoints consistent");
console.log("- Cloud authority + ready-only secure session composition consistent");
console.log("- Renderer path resolution consistent");
process.exit(0);
