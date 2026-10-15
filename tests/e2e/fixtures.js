const { test: base, expect } = require("@playwright/test");
const { observeBrowserErrors } = require("./browser-error-guard");

const test = base.extend({
  browserErrors: [async ({ page, context }, use) => {
    const guards = new Map();
    const expected = new Map();
    const watch = target => { if (!guards.has(target)) guards.set(target, observeBrowserErrors(target)); };
    context.on("page", watch);
    context.pages().forEach(watch);
    try {
      await use({
        expectOn(target, categories) {
          if (target === page || !guards.has(target) || expected.has(target) || !Array.isArray(categories) || categories.length < 1 || categories.length > 2 || categories.some(category => !["PAGE_ERROR", "CONSOLE_ERROR"].includes(category))) throw new Error("INVALID_SYNTHETIC_ERROR_EXPECTATION");
          expected.set(target, [...categories].sort());
        },
      });
      for (const [target, guard] of guards) {
        if (expected.has(target)) expect(guard.categories().sort()).toEqual(expected.get(target));
        else guard.assertClean();
      }
    } finally { context.off("page", watch); for (const guard of guards.values()) guard.dispose(); }
  }, { auto: true }],
});
module.exports = { test, expect };
