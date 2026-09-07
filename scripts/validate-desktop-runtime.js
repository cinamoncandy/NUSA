"use strict";
/** Static, GUI-free consistency check for the canonical Electron desktop runtime. */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const errors = [];
const fail = (message) => errors.push(message);
const isFile = (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile();

const compiledCloudMain = path.join(ROOT, "dist", "apps", "desktop", "src", "cloudMain.js");
const compiledLegacyMain = path.join(ROOT, "dist", "apps", "desktop", "src", "main.js");
const compiledPreload = path.join(ROOT, "dist", "apps", "desktop", "src", "preload.js");
const compiledRendererPathModule = path.join(ROOT, "dist", "apps", "desktop", "src", "rendererPath.js");
const cloudMainSourcePath = path.join(ROOT, "apps", "desktop", "src", "cloudMain.ts");
const rendererIndex = path.join(ROOT, "apps", "desktop", "renderer", "index.html");

for (const [label, file] of [
  ["compiled canonical Cloud Electron main", compiledCloudMain],
  ["compiled legacy Electron main", compiledLegacyMain],
  ["compiled preload", compiledPreload],
  ["compiled renderer path module", compiledRendererPathModule],
  ["canonical Cloud Electron bootstrap source", cloudMainSourcePath],
  ["canonical renderer entry", rendererIndex]
]) {
  if (!isFile(file)) fail(`Missing ${label}: ${path.relative(ROOT, file)}`);
}

const desktopPackagePath = path.join(ROOT, "apps", "desktop", "package.json");
let desktopPackage;
try { desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, "utf8")); }
catch (error) { fail(`Cannot read apps/desktop/package.json: ${error instanceof Error ? error.message : String(error)}`); }
if (desktopPackage) {
  if (typeof desktopPackage.main !== "string" || desktopPackage.main.length === 0) fail('apps/desktop/package.json has no "main" field');
  else if (path.resolve(path.dirname(desktopPackagePath), desktopPackage.main) !== compiledCloudMain) fail("Desktop package main does not resolve to the canonical Cloud bootstrap");
}

const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const desktopScript = rootPackage.scripts && rootPackage.scripts.desktop;
if (typeof desktopScript !== "string" || desktopScript.length === 0) fail("Root package.json has no scripts.desktop");
else {
  const steps = desktopScript.split("&&").map((step) => step.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!(steps.length >= 2 && /^pnpm run build$/.test(steps[0]))) fail(`Root desktop script does not build before launching Electron: "${desktopScript}"`);
  if (!steps.some((step) => /^electron\s+apps\/desktop$/.test(step))) fail(`Root desktop script does not launch "electron apps/desktop": "${desktopScript}"`);
  if (/[A-Za-z]:\\|\/(?:Users|home)\//.test(desktopScript)) fail(`Root desktop script contains a user-specific absolute path: "${desktopScript}"`);
}

const expectedRootMain = "dist/apps/desktop/src/cloudMain.js";
if (rootPackage.main !== expectedRootMain || rootPackage.build?.extraMetadata?.main !== expectedRootMain) fail(`Root Desktop package metadata must resolve to ${expectedRootMain}`);

if (isFile(cloudMainSourcePath)) {
  const source = fs.readFileSync(cloudMainSourcePath, "utf8");
  const activateIndex = source.indexOf("activateCloudCanonicalDesktopAuthority()");
  const readyIndex = source.indexOf("app.whenReady()");
  const registerIndex = source.indexOf("registerDesktopCloudPaperIpc(ipcMain, createDesktopCloudSessionClient())");
  const legacyImportIndex = source.indexOf('import("./main")');
  if (activateIndex < 0 || readyIndex <= activateIndex || registerIndex <= readyIndex || legacyImportIndex <= registerIndex) fail("Canonical Cloud Desktop bootstrap order must be authority -> ready secure-session IPC -> legacy runtime");
  if (/(?:private-api|privateApi|apiKey|secretKey)\s*[:=]\s*["'][^"']+["']/i.test(source)) fail("Canonical Cloud Desktop bootstrap contains a credential literal");
}

if (isFile(compiledCloudMain)) {
  const source = fs.readFileSync(compiledCloudMain, "utf8");
  if (!/desktopPaperAuthorityPolicy/.test(source)) fail("Compiled cloudMain.js does not reference desktopPaperAuthorityPolicy");
  if (!/desktopCloudPaperIpc/.test(source)) fail("Compiled cloudMain.js does not reference desktopCloudPaperIpc");
  if (!/desktopCloudSessionRuntime/.test(source)) fail("Compiled cloudMain.js does not reference desktopCloudSessionRuntime");
  if (!/whenReady/.test(source)) fail("Compiled cloudMain.js does not defer secure session composition until Electron readiness");
  if (!/(?:require|import).*\.\/main|import\(["']\.\/main["']\)/.test(source)) fail("Compiled cloudMain.js does not load the legacy Desktop runtime");
}

if (isFile(rendererIndex)) {
  const rendererDirectory = path.dirname(rendererIndex);
  const html = fs.readFileSync(rendererIndex, "utf8");
  if (!html.includes('data-runtime-owner="canonical"')) fail("Renderer entry does not declare canonical runtime ownership");
  if (html.includes('src="simple-ui.js"') || html.includes('href="simple-ui.css"')) fail("Canonical renderer still loads simple-ui compatibility assets");
  const attributePattern = /<(?:script|link)\b[^>]*?(?:src|href)\s*=\s*"([^"]*)"[^>]*>/gi;
  const seen = new Set();
  let match;
  while ((match = attributePattern.exec(html)) !== null) {
    const raw = match[1];
    if (!raw || /^(?:https?:|data:|blob:|#)/i.test(raw)) continue;
    const relative = raw.split(/[?#]/)[0];
    if (!relative || seen.has(relative)) continue;
    seen.add(relative);
    const resolvedAsset = path.resolve(rendererDirectory, relative);
    if (!isFile(resolvedAsset)) fail(`Renderer asset not found: ${path.relative(ROOT, resolvedAsset)}`);
  }
}

if (isFile(compiledRendererPathModule)) {
  try {
    const rendererPathModule = require(compiledRendererPathModule);
    if (typeof rendererPathModule.resolveRendererIndexPath !== "function") fail("rendererPath.js does not export resolveRendererIndexPath");
    else {
      const resolved = rendererPathModule.resolveRendererIndexPath(path.dirname(compiledLegacyMain));
      if (resolved !== rendererIndex) fail(`Renderer path resolution mismatch: expected ${rendererIndex}; actual ${resolved}`);
      if (resolved.split(path.sep).join("/").includes("apps/desktop/apps/desktop")) fail(`Renderer path contains duplicated apps/desktop: ${resolved}`);
    }
  } catch (error) { fail(`Failed to evaluate renderer path resolution: ${error instanceof Error ? error.message : String(error)}`); }
}

if (isFile(compiledLegacyMain)) {
  const source = fs.readFileSync(compiledLegacyMain, "utf8");
  if (!/require\(["']\.\/rendererPath["']\)/.test(source)) fail("Compiled legacy main.js does not require ./rendererPath");
  if (!/loadFile\([^;]*resolveRendererIndexPath[^;]*__dirname[^;]*\)/.test(source)) fail("Compiled legacy main.js does not load the resolved renderer path");
  if (/getAppPath\(\)\s*,\s*["']apps\/desktop\/renderer\/index\.html["']/.test(source)) fail("Compiled legacy main.js still contains stale renderer path duplication");
}

if (errors.length) {
  console.error("Desktop runtime validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("Desktop runtime validation passed: canonical renderer and runtime assets are consistent");
