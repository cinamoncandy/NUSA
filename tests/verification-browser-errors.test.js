const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { observeBrowserErrors } = require("./e2e/browser-error-guard");
const fs = require("node:fs");
const path = require("node:path");

test("browser guard fails on runtime/console errors without exposing their values", () => {
  for (const category of ["pageerror", "console"]) {
    const page = new EventEmitter();
    const guard = observeBrowserErrors(page);
    page.emit(category, category === "console" ? { type: () => "error", text: () => "PRIVATE_TEST_VALUE" } : new Error("PRIVATE_TEST_VALUE"));
    assert.throws(() => guard.assertClean(), error => /BROWSER_ERRORS_DETECTED/.test(error.message) && !error.message.includes("PRIVATE_TEST_VALUE"));
    guard.dispose();
    assert.equal(page.listenerCount(category), 0);
  }
});

test("browser guard accepts warnings, caps diagnostics, and detaches listeners", () => {
  const page = new EventEmitter();
  const guard = observeBrowserErrors(page);
  page.emit("console", { type: () => "warning" });
  assert.doesNotThrow(() => guard.assertClean());
  for (let i = 0; i < 100; i++) page.emit("pageerror", new Error("private"));
  assert.throws(() => guard.assertClean(), error => error.message.split("PAGE_ERROR").length - 1 === 20);
  guard.dispose();
  assert.equal(page.listenerCount("pageerror"), 0);
  assert.equal(page.listenerCount("console"), 0);
});

test("every canonical browser spec opts into the mandatory verification fixture", () => {
  const directory = path.join(__dirname, "e2e");
  const specs = fs.readdirSync(directory).filter(file => file.endsWith(".spec.js"));
  assert.ok(specs.length > 0);
  for (const spec of specs) {
    const source = fs.readFileSync(path.join(directory, spec), "utf8");
    assert.match(source, /require\(["']\.\/fixtures["']\)/, `${spec} must use the guarded fixture`);
    assert.doesNotMatch(source, /require\(["']@playwright\/test["']\)/, `${spec} cannot bypass the guard`);
  }
});
