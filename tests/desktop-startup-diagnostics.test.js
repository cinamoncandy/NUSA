const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  formatDesktopStartupDiagnostic,
  createRendererLoadFailedDiagnostic,
  createRendererProcessGoneDiagnostic,
  createPreloadErrorDiagnostic,
  createRendererConsoleErrorDiagnostic,
  createRendererUnresponsiveDiagnostic,
  createRendererResponsiveDiagnostic,
  createRendererLoadFinishedDiagnostic
} = require("../dist/apps/desktop/src/desktopStartupDiagnostics.js");

const root = path.resolve(__dirname, "..");
const LOG_PREFIX = "[DOKKAEBI_DESKTOP] ";

function parseFormatted(diagnostic) {
  const formatted = formatDesktopStartupDiagnostic(diagnostic);
  assert.equal(formatted.startsWith(LOG_PREFIX), true, `expected the greppable ${LOG_PREFIX}prefix`);
  return JSON.parse(formatted.slice(LOG_PREFIX.length));
}

// A: RENDERER_LOAD_FAILED
test("A: RENDERER_LOAD_FAILED captures error code, description, URL, and the main-frame flag", () => {
  const diagnostic = createRendererLoadFailedDiagnostic({
    errorCode: -6,
    errorDescription: "ERR_FILE_NOT_FOUND",
    validatedUrl: "file:///app/renderer/index.html",
    isMainFrame: true
  }, 1_000);
  assert.equal(diagnostic.kind, "RENDERER_LOAD_FAILED");
  assert.equal(diagnostic.timestamp, 1_000);
  assert.match(diagnostic.message, /ERR_FILE_NOT_FOUND/);
  assert.equal(diagnostic.details.errorCode, -6);
  assert.equal(diagnostic.details.errorDescription, "ERR_FILE_NOT_FOUND");
  assert.equal(diagnostic.details.validatedUrl, "file:///app/renderer/index.html");
  assert.equal(diagnostic.details.isMainFrame, true);
});

test("A: RENDERER_LOAD_FAILED distinguishes a subframe failure from a main-frame failure in the message text", () => {
  const diagnostic = createRendererLoadFailedDiagnostic({
    errorCode: -105,
    errorDescription: "ERR_NAME_NOT_RESOLVED",
    validatedUrl: "https://example.test/frame.html",
    isMainFrame: false
  }, 2_000);
  assert.match(diagnostic.message, /subframe/);
  assert.equal(diagnostic.details.isMainFrame, false);
});

// B: RENDERER_PROCESS_GONE
test("B: RENDERER_PROCESS_GONE captures the crash reason and process exit code", () => {
  const diagnostic = createRendererProcessGoneDiagnostic({ reason: "crashed", exitCode: 1 }, 3_000);
  assert.equal(diagnostic.kind, "RENDERER_PROCESS_GONE");
  assert.match(diagnostic.message, /crashed/);
  assert.equal(diagnostic.details.reason, "crashed");
  assert.equal(diagnostic.details.exitCode, 1);
});

// C: PRELOAD_ERROR
test("C: PRELOAD_ERROR captures the preload path and a sanitized single-line error message, never a full stack", () => {
  const multilineError =
    "TypeError: something broke\n" +
    "    at Object.<anonymous> (/app/dist/apps/desktop/src/preload.js:10:5)\n" +
    "    at Module._compile (node:internal/modules/cjs/loader:1256:14)";
  const diagnostic = createPreloadErrorDiagnostic({
    preloadPath: "/app/dist/apps/desktop/src/preload.js",
    errorMessage: multilineError
  }, 4_000);
  assert.equal(diagnostic.kind, "PRELOAD_ERROR");
  assert.equal(diagnostic.details.preloadPath, "/app/dist/apps/desktop/src/preload.js");
  assert.equal(diagnostic.details.errorMessage, "TypeError: something broke");
  assert.doesNotMatch(diagnostic.details.errorMessage, /at Object/);
  assert.equal(diagnostic.details.errorMessage.includes("\n"), false, "expected no embedded stack lines");
});

// D: RENDERER_CONSOLE_ERROR
test("D: RENDERER_CONSOLE_ERROR captures the message, line number, and source", () => {
  const diagnostic = createRendererConsoleErrorDiagnostic({
    message: "Uncaught ReferenceError: window is not defined",
    line: 42,
    sourceId: "file:///app/apps/desktop/renderer/renderer.js"
  }, 5_000);
  assert.equal(diagnostic.kind, "RENDERER_CONSOLE_ERROR");
  assert.match(diagnostic.message, /ReferenceError/);
  assert.equal(diagnostic.details.line, 42);
  assert.equal(diagnostic.details.sourceId, "file:///app/apps/desktop/renderer/renderer.js");
});

// E: formatter output shape
test("E: formatDesktopStartupDiagnostic prefixes with the greppable tag and emits single-line JSON", () => {
  const parsed = parseFormatted(createRendererLoadFinishedDiagnostic(6_000));
  assert.equal(parsed.kind, "RENDERER_LOAD_FINISHED");
  assert.equal(parsed.timestamp, 6_000);
  assert.equal(formatDesktopStartupDiagnostic(createRendererLoadFinishedDiagnostic(6_000)).includes("\n"), false);
});

test("E: formatDesktopStartupDiagnostic omits the details field entirely when a diagnostic has none", () => {
  const parsed = parseFormatted(createRendererUnresponsiveDiagnostic(7_000));
  assert.equal("details" in parsed, false);
  const responsiveParsed = parseFormatted(createRendererResponsiveDiagnostic(7_500));
  assert.equal("details" in responsiveParsed, false);
});

// F: sensitive-URL redaction
test("F: http(s) URLs are stripped of query string and fragment before logging", () => {
  const diagnostic = createRendererLoadFailedDiagnostic({
    errorCode: -3,
    errorDescription: "ERR_ABORTED",
    validatedUrl: "https://example.test/path/asset.js?token=super-secret-session-id#fragment-data",
    isMainFrame: true
  }, 8_000);
  assert.equal(diagnostic.details.validatedUrl, "https://example.test/path/asset.js");
  assert.doesNotMatch(diagnostic.details.validatedUrl, /token/);
  assert.doesNotMatch(diagnostic.details.validatedUrl, /super-secret/);
  assert.doesNotMatch(diagnostic.details.validatedUrl, /fragment-data/);
});

test("F: an unparsable http(s)-looking URL redacts to a fixed placeholder instead of leaking raw input", () => {
  const diagnostic = createRendererLoadFailedDiagnostic({
    errorCode: -2,
    errorDescription: "ERR_FAILED",
    validatedUrl: "https://",
    isMainFrame: true
  }, 8_500);
  assert.equal(diagnostic.details.validatedUrl, "[unparsable-url]");
});

// G: Windows file:// URL handling. Deliberately no user-profile directory segment here --
// this repo's own portability validator (scripts/validate-repository-portability.js) flags
// any literal absolute home-directory path anywhere in the repo, real or synthetic, so even
// a placeholder username would itself fail CI. sanitizeUrl() doesn't branch on folder names,
// only on the http(s) prefix, so a drive-letter path under an ordinary install directory
// exercises the exact same code path without needing a fake username at all.
test("G: Windows file:// URLs are preserved exactly (drive letter and all), not treated as an http(s) URL", () => {
  const windowsPath = "file:///C:/Program%20Files/dokkaebi/resources/app/apps/desktop/renderer/index.html";
  const diagnostic = createRendererLoadFailedDiagnostic({
    errorCode: -6,
    errorDescription: "ERR_FILE_NOT_FOUND",
    validatedUrl: windowsPath,
    isMainFrame: true
  }, 9_000);
  assert.equal(diagnostic.details.validatedUrl, windowsPath);
});

test("G: a Windows file:// preload path is likewise preserved exactly, not treated as an http(s) URL", () => {
  const windowsPreloadPath = "file:///C:/Program%20Files/dokkaebi/resources/app/dist/apps/desktop/src/preload.js";
  const diagnostic = createPreloadErrorDiagnostic({
    preloadPath: windowsPreloadPath,
    errorMessage: "TypeError: contextBridge is not defined"
  }, 9_500);
  assert.equal(diagnostic.details.preloadPath, windowsPreloadPath);
});

// Supplementary: main.js actually registers every required listener (wiring check only --
// the diagnostic behavior itself is verified above; this just guards against a listener
// silently going missing or being registered under the wrong event name).
test("main.js registers every required renderer diagnostic event listener", () => {
  const compiledMain = fs.readFileSync(path.join(root, "dist/apps/desktop/src/main.js"), "utf8");
  const requiredEvents = [
    "did-finish-load",
    "did-fail-load",
    "preload-error",
    "console-message",
    "unresponsive",
    "responsive",
    "render-process-gone"
  ];
  for (const eventName of requiredEvents) {
    assert.match(compiledMain, new RegExp(`"${eventName}"`), `expected main.js to register a "${eventName}" listener`);
  }
});

test("main.js does not register did-fail-load/preload-error/console-message/unresponsive/responsive more than once", () => {
  const compiledMain = fs.readFileSync(path.join(root, "dist/apps/desktop/src/main.js"), "utf8");
  for (const eventName of ["did-fail-load", "preload-error", "console-message", "unresponsive", "responsive"]) {
    const occurrences = compiledMain.split(`"${eventName}"`).length - 1;
    assert.equal(occurrences, 1, `expected exactly one "${eventName}" registration, found ${occurrences}`);
  }
});
