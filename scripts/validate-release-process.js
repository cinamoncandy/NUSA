"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const failures = [];
const requireFile = (file) => { if (!fs.existsSync(path.join(root, file))) failures.push(`missing ${file}`); };
const requiredDocs = [
  "docs/release/installation-guide.md",
  "docs/release/operator-manual.md",
  "docs/release/recovery-manual.md",
  "docs/release/rollback-guide.md",
  "docs/release/release-checklist.md",
  "docs/release/release-notes.md"
];
requiredDocs.forEach(requireFile);
if (pkg.build?.win?.target !== "nsis") failures.push("Windows target must remain nsis");
if (pkg.build?.asar !== true) failures.push("asar must remain enabled");
if (pkg.build?.win?.icon !== "build/nusa-a4p.ico") failures.push("A4P icon must remain configured");
if (pkg.build?.win?.signAndEditExecutable !== false) failures.push("signing must be explicit and non-mutating by default");
if (pkg.build?.nsis?.deleteAppDataOnUninstall !== false) failures.push("uninstall must preserve user data for recovery");
const expectedDesktopMain = "dist/apps/desktop/src/cloudMain.js";
if (pkg.main !== expectedDesktopMain) failures.push("root main must use the Cloud canonical Desktop bootstrap");
if (pkg.build?.extraMetadata?.main !== expectedDesktopMain) failures.push("compiled Cloud canonical Desktop bootstrap must remain packaged");
if (!fs.existsSync(path.join(root, "electron-builder.portable.yml"))) failures.push("portable builder configuration missing");

const cloudMainPath = path.join(root, "apps/desktop/src/cloudMain.ts");
if (!fs.existsSync(cloudMainPath)) {
  failures.push("Cloud canonical Desktop bootstrap source missing");
} else {
  const cloudMain = fs.readFileSync(cloudMainPath, "utf8");
  const activateIndex = cloudMain.indexOf("activateCloudCanonicalDesktopAuthority()");
  const readyIndex = cloudMain.indexOf("app.whenReady()");
  const registerIndex = cloudMain.indexOf("registerDesktopCloudPaperIpc(ipcMain, createDesktopCloudSessionClient())");
  const legacyImportIndex = cloudMain.indexOf('import("./main")');
  if (activateIndex < 0 || readyIndex <= activateIndex || registerIndex <= readyIndex || legacyImportIndex <= registerIndex) {
    failures.push("Cloud Desktop bootstrap must activate authority, schedule ready-only secure Cloud PAPER IPC, then load legacy runtime in order");
  }
}

const safetySources = [
  "apps/desktop/src/cloudMain.ts",
  "apps/desktop/src/paper/desktopPaperAuthorityPolicy.ts",
  "apps/desktop/src/cloud/desktopCloudPaperIpc.ts",
  "apps/desktop/src/cloud/desktopCloudSessionClient.ts",
  "apps/desktop/src/cloud/desktopCloudSessionStore.ts",
  "apps/desktop/src/main.ts",
  "apps/execution/src/production-readiness.ts",
  "apps/execution/src/live-operations.ts"
]
  .filter((file) => fs.existsSync(path.join(root, file)))
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
if (!/productionMutationAllowed/.test(safetySources) || !/productionMutationAllowed:\s*false/.test(safetySources)) failures.push("production mutation safety boundary missing");
if (/enableLiveTrading\s*[:=]\s*true/.test(safetySources)) failures.push("live trading enabled in release sources");
if (!/NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN/.test(safetySources)) failures.push("Desktop one-time Cloud PAPER bootstrap contract missing");
if (!/access-token injection is prohibited/i.test(safetySources)) failures.push("legacy Desktop stable access-token injection must remain prohibited");
const secureDesktopSession = /NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN/.test(safetySources) && /access-token injection is prohibited/i.test(safetySources);
console.log(JSON.stringify({
  status: failures.length ? "FAIL" : "PASS",
  checks: {
    docs: requiredDocs.length,
    target: pkg.build?.win?.target,
    asar: pkg.build?.asar,
    desktopMain: pkg.main,
    secureDesktopSession,
    userDataPreserved: pkg.build?.nsis?.deleteAppDataOnUninstall === false
  },
  failures
}, null, 2));
if (failures.length) process.exitCode = 1;
