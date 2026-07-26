"use strict";
/**
 * Static, GUI-free consistency check for everything Electron's `createWindow()` needs at
 * runtime: the compiled main/preload/rendererPath modules exist, apps/desktop/package.json's
 * main field and the root desktop script actually point at them, renderer/index.html's local
 * script/link assets all exist on disk, and the renderer path arithmetic (WO-0004) neither
 * regresses to the "apps/desktop/apps/desktop" duplication (WO-0003) nor silently stops being
 * wired into the compiled main.js. Node built-ins only, no network, no Electron, no file
 * writes -- run after `pnpm run build` so dist/ reflects the current source.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const errors = [];
const fail = (message) => errors.push(message);

const compiledMain = path.join(ROOT, "dist", "apps", "desktop", "src", "main.js");
const compiledPreload = path.join(ROOT, "dist", "apps", "desktop", "src", "preload.js");
const compiledRendererPathModule = path.join(ROOT, "dist", "apps", "desktop", "src", "rendererPath.js");
const rendererIndex = path.join(ROOT, "apps", "desktop", "renderer", "index.html");

function isFile(candidate) {
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
}

// A: build artifacts
for (const [label, file] of [
  ["compiled Electron main", compiledMain],
  ["compiled preload", compiledPreload],
  ["compiled renderer path module", compiledRendererPathModule]
]) {
  if (!isFile(file)) fail(`Missing ${label}: ${path.relative(ROOT, file)}`);
}

// B: renderer entry
if (!isFile(rendererIndex)) fail(`Missing renderer entry: ${path.relative(ROOT, rendererIndex)}`);

// C: apps/desktop/package.json main entrypoint, resolved (not string-compared)
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
    if (resolvedMain !== compiledMain) {
      fail(
        `Desktop package main resolves incorrectly:\n` +
          `  expected: ${path.relative(ROOT, compiledMain)}\n` +
          `  actual:   ${path.relative(ROOT, resolvedMain)}`
      );
    }
  }
}

// D: root package.json's desktop script -- build-first, targets apps/desktop, no user-specific path
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

// E: renderer's local <script src>/<link href> assets actually exist
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
      fail(
        `Renderer asset not found:\n` +
          `  ${path.relative(ROOT, resolvedAsset)}\n` +
          `  referenced by ${path.relative(ROOT, rendererIndex)}`
      );
    }
  }
}

// F: renderer path resolution -- real function call, real output, no duplicated segment
if (isFile(compiledRendererPathModule)) {
  try {
    const rendererPathModule = require(compiledRendererPathModule);
    if (typeof rendererPathModule.resolveRendererIndexPath !== "function") {
      fail(`${path.relative(ROOT, compiledRendererPathModule)} does not export resolveRendererIndexPath`);
    } else {
      const compiledMainDirectory = path.dirname(compiledMain);
      const resolved = rendererPathModule.resolveRendererIndexPath(compiledMainDirectory);
      if (resolved !== rendererIndex) {
        fail(`Renderer path resolution mismatch:\n  expected: ${rendererIndex}\n  actual:   ${resolved}`);
      }
      const normalized = resolved.split(path.sep).join("/");
      if (normalized.includes("apps/desktop/apps/desktop")) {
        fail(`Renderer path resolution contains a duplicated apps/desktop segment: ${resolved}`);
      }
    }
  } catch (error) {
    fail(`Failed to evaluate renderer path resolution: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// G: compiled main.js actually wires loadFile() through the renderer path module,
// and the fixed (WO-0003) direct app.getAppPath()-join duplication has not returned
if (isFile(compiledMain)) {
  const mainSource = fs.readFileSync(compiledMain, "utf8");
  const requiresRendererPathModule = /require\(["']\.\/rendererPath["']\)/.test(mainSource);
  const loadFileUsesResolvedPath = /loadFile\([^;]*resolveRendererIndexPath[^;]*__dirname[^;]*\)/.test(mainSource);
  const hasStaleDuplication = /getAppPath\(\)\s*,\s*["']apps\/desktop\/renderer\/index\.html["']/.test(mainSource);

  if (!requiresRendererPathModule) fail(`Compiled main.js does not require the renderer path module (./rendererPath)`);
  if (!loadFileUsesResolvedPath) fail(`Compiled main.js does not pass resolveRendererIndexPath(__dirname)'s result to loadFile()`);
  if (hasStaleDuplication) {
    fail(`Compiled main.js still contains the fixed app.getAppPath() + "apps/desktop/renderer/index.html" duplication (WO-0003 regression)`);
  }
}

if (errors.length > 0) {
  console.error("Desktop runtime validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Desktop runtime validation passed:");
console.log("- Electron main entry found");
console.log("- Preload entry found");
console.log("- Renderer entry found");
console.log("- Local renderer assets found");
console.log("- Package entrypoints consistent");
console.log("- Renderer path resolution consistent");
process.exit(0);
