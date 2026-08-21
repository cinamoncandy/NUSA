const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const expectedDesktopMain = "dist/apps/desktop/src/cloudMain.js";
const required = [
  expectedDesktopMain,
  "dist/apps/desktop/src/main.js",
  "dist/apps/desktop/src/preload.js",
  "dist/apps/desktop/src/cloud/desktopCloudSessionRuntime.js",
  "apps/desktop/renderer/index.html",
  "apps/desktop/src/cloudMain.ts"
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Release readiness failed: missing ${missing.join(", ")}`);
  process.exit(1);
}

const byteSize = (file) => fs.statSync(path.join(root, file)).size;
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (
  packageJson.private !== true ||
  packageJson.main !== expectedDesktopMain ||
  packageJson.build?.extraMetadata?.main !== expectedDesktopMain ||
  packageJson.build?.win?.target !== "nsis" ||
  packageJson.build?.win?.signAndEditExecutable !== false
) {
  console.error("Release readiness failed: Windows NSIS package contract changed");
  process.exit(1);
}

const cloudMainSource = fs.readFileSync(path.join(root, "apps/desktop/src/cloudMain.ts"), "utf8");
const activateIndex = cloudMainSource.indexOf("activateCloudCanonicalDesktopAuthority()");
const readyIndex = cloudMainSource.indexOf("app.whenReady()");
const registerIndex = cloudMainSource.indexOf("registerDesktopCloudPaperIpc(ipcMain, createDesktopCloudSessionClient())");
const legacyImportIndex = cloudMainSource.indexOf('import("./main")');
if (
  activateIndex < 0 ||
  readyIndex <= activateIndex ||
  registerIndex <= readyIndex ||
  legacyImportIndex <= registerIndex
) {
  console.error("Release readiness failed: Cloud Desktop authority/secure-session bootstrap order changed");
  process.exit(1);
}

if (/(?:private-api|privateApi|apiKey|secretKey)\s*[:=]\s*["'][^"']+["']/i.test(cloudMainSource)) {
  console.error("Release readiness failed: Cloud Desktop bootstrap contains a credential literal");
  process.exit(1);
}

if (JSON.stringify(packageJson).includes("electron-updater")) {
  console.error("Release readiness failed: auto-update dependency is not permitted");
  process.exit(1);
}

console.log(JSON.stringify({
  status: "TECHNICAL_CHECKS_PASS",
  canonicalMain: expectedDesktopMain,
  canonicalMainBundleBytes: byteSize(expectedDesktopMain),
  legacyMainBundleBytes: byteSize("dist/apps/desktop/src/main.js"),
  preloadBundleBytes: byteSize("dist/apps/desktop/src/preload.js"),
  rendererHtmlBytes: byteSize("apps/desktop/renderer/index.html"),
  bootstrapOrder: "AUTHORITY_THEN_READY_SECURE_SESSION_IPC_THEN_LEGACY_RUNTIME",
  packageTarget: "nsis",
  autoUpdate: "DISABLED",
  runtimeMetrics: "NOT_EVALUATED"
}, null, 2));
