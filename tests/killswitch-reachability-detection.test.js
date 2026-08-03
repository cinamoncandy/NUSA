const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanCapabilities } = require("../scripts/build-deployment-descriptor.js");

function withTree(files, run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "killswitch-scan-"));
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, contents, "utf8");
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a status label mentioning a kill switch does not count as reachability", () => {
  // Regression: the patterns matched the words "kill switch" anywhere, so the renderer's
  // read-only status row was enough to report killSwitchReachable: true. A display string is
  // not a control.
  withTree({
    "apps/renderer.js": 'rows.push(["Kill Switch", state.killSwitchActive ? "ACTIVE" : "INACTIVE"]);\n',
    "apps/other.ts": 'export const label = "emergency stop";\n'
  }, (root) => {
    const scan = scanCapabilities(root);
    assert.equal(scan.killSwitchReachable, false, "a label alone must not read as a reachable switch");
  });
});

test("an actual activation path counts", () => {
  withTree({
    "apps/control.ts": 'if (event.type === "EMERGENCY_STOP") { killSwitchActive = true; }\n'
  }, (root) => {
    assert.equal(scanCapabilities(root).killSwitchReachable, true);
  });

  withTree({
    "apps/gateway.ts": 'this.killSwitch.trigger("MANUAL_STOP", now);\n'
  }, (root) => {
    assert.equal(scanCapabilities(root).killSwitchReachable, true);
  });

  withTree({
    "apps/main.ts": 'ipcMain.handle("control:kill-switch", async () => engage());\n'
  }, (root) => {
    assert.equal(scanCapabilities(root).killSwitchReachable, true);
  });
});

test("the shipping tree reports reachability from a real path, not from prose", () => {
  // The repository does have one: an accepted EMERGENCY_STOP control command sets the switch in
  // apps/cloud/src/controlAuditLedger.ts. The point of the stricter patterns is that this is now
  // what the flag is standing on.
  assert.equal(scanCapabilities().killSwitchReachable, true);
});
