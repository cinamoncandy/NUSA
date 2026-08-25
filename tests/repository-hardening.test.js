const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");

const root = path.resolve(__dirname, "..");

test("package scripts are portable and declare the supported runtime", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.engines.node, ">=24.0.0");
  const scripts = JSON.stringify(pkg.scripts);
  assert.doesNotMatch(scripts, /[A-Za-z]:\\Users\\/);
  assert.doesNotMatch(scripts, /\.cache[\\/]codex/i);
  assert.doesNotMatch(JSON.stringify(pkg), /reconstructed/i);
});

test("repository portability validator passes", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "validate-repository-portability.js")], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("paper broker floors order quantities to the configured step", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { quantityStep: 0.001, dustThreshold: 0.0004 });
  const buy = broker.execute("BUY", 1.2349, 1000, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(buy.quantity, 1.234);
  assert.equal(broker.snapshot(1000).position.quantity, 1.234);
});

test("paper broker removes residual dust after a sell", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { quantityStep: 0.001, dustThreshold: 0.0005 });
  broker.execute("BUY", 1.234, 1000, new Date("2026-01-01T00:00:00.000Z"));
  broker.execute("SELL", 1.2344, 1000, new Date("2026-01-01T00:00:01.000Z"));
  const snapshot = broker.snapshot(1000);
  assert.equal(snapshot.position.quantity, 0);
  assert.equal(snapshot.position.averagePrice, 0);
});

test("paper broker rejects quantities below step or dust policy", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { quantityStep: 0.001, dustThreshold: 0.0005 });
  assert.throws(() => broker.execute("BUY", 0.0009, 1000), /below market step|dust/);
});
