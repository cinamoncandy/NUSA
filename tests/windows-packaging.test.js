const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("Windows packaging validation keeps the desktop runtime paper-only and sandboxed", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "validate-windows-package.js")], {
    cwd: root,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.runtimeDependencies, ["ws"]);
});

test("packaging metadata is deterministic and excludes development sources", () => {
  const build = packageJson.build;
  assert.equal(packageJson.main, "dist/apps/desktop/src/cloudMain.js");
  assert.equal(packageJson.dependencies.ws, "8.21.3");
  assert.equal(build.appId, "com.nusa.trader");
  assert.equal(build.productName, "NUSA");
  assert.equal(build.asar, true);
  assert.equal(build.directories.output, "release");
  assert.equal(build.win.target, "nsis");
  assert.equal(build.win.icon, "build/nusa-a4p.ico");
  assert.ok(fs.existsSync(path.join(root, "build", "nusa-a4p.ico")));
  assert.equal(build.win.artifactName, "NUSA-${version}-Windows-Setup.${ext}");
  assert.ok(build.files.includes("dist/**/*"));
  assert.ok(build.files.some((entry) => entry.includes("*.ts")));
  assert.ok(build.files.some((entry) => entry.includes("tests")));
  assert.equal(fs.existsSync(path.join(root, "package-lock.json")), false);
});

test("desktop production safety invariants remain enabled", () => {
  const mainSource = fs.readFileSync(path.join(root, "apps", "desktop", "src", "main.ts"), "utf8");
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /nusa-a4p-symbol\.svg/);
  assert.match(mainSource, /RISK_GATE_NOT_CONFIGURED/);
  assert.doesNotMatch(mainSource, /private-api|apiKey\s*[:=]\s*["'][^"']+["']|secretKey\s*[:=]\s*["'][^"']+["']/i);
});
