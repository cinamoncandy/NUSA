const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = ["dist/apps/desktop/src/main.js", "dist/apps/desktop/src/preload.js", "apps/desktop/renderer/index.html"];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Release readiness failed: missing ${missing.join(", ")}`);
  process.exit(1);
}

const byteSize = (file) => fs.statSync(path.join(root, file)).size;
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.private !== true || packageJson.main !== "dist/apps/desktop/src/main.js" || packageJson.build?.win?.target !== "nsis" || packageJson.build?.win?.signAndEditExecutable !== false) {
  console.error("Release readiness failed: Windows NSIS package contract changed");
  process.exit(1);
}
if (JSON.stringify(packageJson).includes("electron-updater")) {
  console.error("Release readiness failed: auto-update dependency is not permitted");
  process.exit(1);
}

console.log(JSON.stringify({
  status: "TECHNICAL_CHECKS_PASS",
  mainBundleBytes: byteSize("dist/apps/desktop/src/main.js"),
  preloadBundleBytes: byteSize("dist/apps/desktop/src/preload.js"),
  rendererHtmlBytes: byteSize("apps/desktop/renderer/index.html"),
  packageTarget: "nsis",
  autoUpdate: "DISABLED",
  runtimeMetrics: "NOT_EVALUATED"
}, null, 2));
