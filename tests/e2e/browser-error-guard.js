// Test-only diagnostics: preserve error categories, never raw console/credential values.
function observeBrowserErrors(page) {
  const errors = [];
  const record = category => { if (errors.length < 20) errors.push(category); };
  const onPageError = () => record("PAGE_ERROR");
  const onConsole = message => { if (message.type() === "error") record("CONSOLE_ERROR"); };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  return {
    categories() { return [...errors]; },
    assertClean() { if (errors.length > 0) throw new Error(`BROWSER_ERRORS_DETECTED:${errors.join(",")}`); },
    dispose() { page.off("pageerror", onPageError); page.off("console", onConsole); },
  };
}
module.exports = { observeBrowserErrors };
