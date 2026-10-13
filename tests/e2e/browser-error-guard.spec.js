const { test, expect } = require("./fixtures");
const { observeBrowserErrors } = require("./browser-error-guard");

for (const category of ["console", "pageerror"]) {
  test(`real Chromium reports synthetic ${category} through the verification guard`, async ({ context, browserErrors }) => {
    // Separate synthetic probe: expected errors must not pollute the application-page guard.
    const probe = await context.newPage();
    browserErrors.expectOn(probe, [category === "console" ? "CONSOLE_ERROR" : "PAGE_ERROR"]);
    const guard = observeBrowserErrors(probe);
    try {
      await probe.goto("/component-preview.html");
      guard.assertClean();
      await probe.evaluate(kind => {
        if (kind === "console") console.error("SYNTHETIC_VERIFICATION_PROBE");
        else setTimeout(() => { throw new Error("SYNTHETIC_VERIFICATION_PROBE"); }, 0);
      }, category);
      await expect.poll(() => {
        try { guard.assertClean(); return false; }
        catch (error) { return error.message.includes(category === "console" ? "CONSOLE_ERROR" : "PAGE_ERROR"); }
      }).toBe(true);
    } finally { guard.dispose(); await probe.close(); }
  });
}
