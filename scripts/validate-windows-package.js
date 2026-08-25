const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const build = packageJson.build;
const failures = [];
const required = (condition, message) => { if (!condition) failures.push(message); };
const exists = (relative) => fs.existsSync(path.join(root, relative));

const expectedDesktopMain = "dist/apps/desktop/src/cloudMain.js";
required(packageJson.main === expectedDesktopMain, "root main must point at the Cloud canonical Desktop bootstrap");
required(build?.extraMetadata?.main === expectedDesktopMain, "packaged extraMetadata main must match the Cloud canonical Desktop bootstrap");
required(packageJson.dependencies?.ws === "8.21.0", "runtime WebSocket dependency must be production-scoped and pinned");
required(build?.appId === "com.nusa.trader", "appId is missing or changed");
required(build?.productName === "NUSA", "productName is missing or changed");
required(build?.asar === true, "asar must be enabled");
required(build?.directories?.output === "release", "Windows output must use release/");
required(build?.win?.target === "nsis", "Windows target must be NSIS");
required(build?.win?.icon === "build/nusa-a4p.ico" && exists("build/nusa-a4p.ico"), "Windows icon must be build/nusa-a4p.ico");
required(build?.win?.artifactName === "NUSA-${version}-Windows-Setup.${ext}", "installer artifact name is not deterministic");
required(build?.nsis?.oneClick === false, "installer must use explicit install flow");

const files = build?.files ?? [];
required(files.includes("dist/**/*"), "compiled dist files must be packaged");
required(files.includes("apps/desktop/renderer/**/*"), "renderer files must be packaged");
required(files.some((entry) => String(entry).includes("*.ts")), "TypeScript source must be excluded from the package");
required(files.some((entry) => String(entry).includes("tests")), "tests must be excluded from the package");
required(exists("apps/desktop/renderer/index.html"), "renderer entrypoint is missing");

const mainSource = fs.readFileSync(path.join(root, "apps/desktop/src/main.ts"), "utf8");
required(/contextIsolation:\s*true/.test(mainSource), "contextIsolation must remain enabled");
required(/nodeIntegration:\s*false/.test(mainSource), "nodeIntegration must remain disabled");
required(/sandbox:\s*true/.test(mainSource), "preload sandbox must remain enabled");
required(/RISK_GATE_NOT_CONFIGURED/.test(mainSource), "paper risk gate must fail closed when unconfigured");
required(!/(?:private-api|privateApi|apiKey|secretKey)\s*[:=]\s*["'][^"']+["']/i.test(mainSource), "main source must not hardcode a private credential or API key literal");

const cloudMainPath = path.join(root, "apps/desktop/src/cloudMain.ts");
required(fs.existsSync(cloudMainPath), "Cloud canonical Desktop bootstrap source is missing");
if (fs.existsSync(cloudMainPath)) {
  const cloudMainSource = fs.readFileSync(cloudMainPath, "utf8");
  const activateIndex = cloudMainSource.indexOf("activateCloudCanonicalDesktopAuthority()");
  const readyIndex = cloudMainSource.indexOf("app.whenReady()");
  const registerIndex = cloudMainSource.indexOf("registerDesktopCloudPaperIpc(ipcMain, createDesktopCloudSessionClient())");
  const legacyImportIndex = cloudMainSource.indexOf('import("./main")');
  required(activateIndex >= 0, "Cloud Desktop bootstrap must activate canonical authority");
  required(readyIndex > activateIndex, "secure Cloud PAPER session composition must be scheduled after authority activation");
  required(registerIndex > readyIndex, "Cloud PAPER IPC must use the production secure session factory after Electron readiness");
  required(legacyImportIndex > registerIndex, "legacy Desktop runtime source must load only after secure IPC composition is scheduled");
  required(!/(?:private-api|privateApi|apiKey|secretKey)\s*[:=]\s*["'][^"']+["']/i.test(cloudMainSource), "Cloud Desktop bootstrap must not hardcode a private credential or API key literal");
}

required(exists("apps/desktop/src/cloud/desktopCloudSessionRuntime.ts"), "Desktop safeStorage session runtime is missing");
required(exists("apps/desktop/src/cloud/desktopCloudSessionStore.ts"), "Desktop secure session store is missing");

const result = Object.freeze({
  status: failures.length === 0 ? "PASS" : "FAIL",
  appId: build?.appId ?? null,
  productName: build?.productName ?? null,
  main: packageJson.main,
  target: build?.win?.target ?? null,
  asar: build?.asar ?? false,
  outputDirectory: build?.directories?.output ?? null,
  runtimeDependencies: Object.keys(packageJson.dependencies ?? {}),
  failures: Object.freeze(failures)
});
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exitCode = 1;
