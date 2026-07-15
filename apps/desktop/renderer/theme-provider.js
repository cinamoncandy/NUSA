(function attachThemeProvider(global) {
  "use strict";

  const storageKey = "dokkaebi.theme";
  const validThemes = new Set(["dark", "contrast"]);

  function resolveTheme(theme) {
    return validThemes.has(theme) ? theme : "dark";
  }

  function applyTheme(theme) {
    const resolvedTheme = resolveTheme(theme);
    document.documentElement.dataset.theme = resolvedTheme;
    return resolvedTheme;
  }

  function getTheme() {
    return resolveTheme(document.documentElement.dataset.theme);
  }

  function setTheme(theme) {
    const resolvedTheme = applyTheme(theme);
    try {
      global.localStorage.setItem(storageKey, resolvedTheme);
    } catch {
      // A restricted desktop session still receives the safe dark theme.
    }
    return resolvedTheme;
  }

  function initialize() {
    let storedTheme = "dark";
    try {
      storedTheme = global.localStorage.getItem(storageKey) || storedTheme;
    } catch {
      // Storage availability is not required for a deterministic initial theme.
    }
    return applyTheme(storedTheme);
  }

  global.DokkaebiTheme = Object.freeze({ getTheme, initialize, setTheme });
  initialize();
})(window);
