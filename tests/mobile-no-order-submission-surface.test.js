const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const mobileRoot = path.join(repoRoot, "apps", "mobile");

function collectFiles(dir, predicate, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, predicate, found);
    else if (entry.isFile() && predicate(full)) found.push(full);
  }
  return found;
}

const renderedSurfaces = collectFiles(mobileRoot, (file) => file.endsWith(".tsx"));

test("the mobile concept board has no order submission surface", async (t) => {
  await t.test("no rendered surface reaches the PAPER order client", () => {
    assert.ok(renderedSurfaces.length > 0, "expected to find rendered .tsx surfaces to check");
    const importers = renderedSurfaces.filter((file) =>
      /personalPaperOrderClient/.test(fs.readFileSync(file, "utf8")),
    );
    assert.deepEqual(
      importers.map((file) => path.relative(repoRoot, file)),
      [],
      "no rendered surface may reach the PAPER order client: the board has no ORDER destination",
    );
  });

  await t.test("the removed order and legacy trading views stay removed", () => {
    for (const removed of ["paperOrderView.tsx", "tradingView.tsx", "tradingViewLegacy.tsx"]) {
      assert.equal(
        fs.existsSync(path.join(mobileRoot, "src", removed)),
        false,
        `apps/mobile/src/${removed} was removed with the ORDER destination and must not return`,
      );
    }
  });

  await t.test("App.tsx wires no submission entry point", () => {
    const app = fs.readFileSync(path.join(mobileRoot, "App.tsx"), "utf8");
    for (const forbidden of ["onSubmit=", "runtimeCanSubmit", "<PaperOrderView", "<TradingView"]) {
      assert.equal(
        app.includes(forbidden),
        false,
        `App.tsx must not wire ${forbidden}: there is no order submission destination`,
      );
    }
  });
});

test("removing the screen did not remove the tested order domain logic", async (t) => {
  await t.test("the order client module is still present", () => {
    assert.ok(
      fs.existsSync(path.join(mobileRoot, "src", "personalPaperOrderClient.ts")),
      "personalPaperOrderClient.ts carries retry identity and idempotency contracts and must remain",
    );
  });

  await t.test("its dedicated suites are still present", () => {
    const suites = collectFiles(path.join(repoRoot, "tests"), (file) => file.endsWith(".test.js")).filter(
      (file) =>
        path.relative(repoRoot, file) !== path.join("tests", "mobile-no-order-submission-surface.test.js") &&
        /personalPaperOrderClient/.test(fs.readFileSync(file, "utf8")),
    );
    assert.ok(
      suites.length >= 5,
      `expected at least 5 suites covering the order client, found ${suites.length}: ${suites
        .map((file) => path.relative(repoRoot, file))
        .join(", ")}`,
    );
  });
});
