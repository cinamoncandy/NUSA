"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveCompiledSource(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (
      error == null ||
      error.code !== "MODULE_NOT_FOUND" ||
      typeof request !== "string" ||
      !request.startsWith(".") ||
      parent == null ||
      typeof parent.filename !== "string"
    ) {
      throw error;
    }

    const sourcePath = path.resolve(path.dirname(parent.filename), request);
    const relativePath = path.relative(process.cwd(), sourcePath);
    const isCompiledProjectSource =
      !relativePath.startsWith("..") &&
      (relativePath.startsWith(`apps${path.sep}`) || relativePath.startsWith(`packages${path.sep}`)) &&
      relativePath.includes(`${path.sep}src${path.sep}`);

    if (!isCompiledProjectSource) throw error;

    const compiledBase = path.join(process.cwd(), "dist", relativePath);
    const candidates = [compiledBase, `${compiledBase}.js`, path.join(compiledBase, "index.js")];
    const compiledPath = candidates.find((candidate) => fs.existsSync(candidate));

    if (compiledPath == null) throw error;
    return originalResolveFilename.call(this, compiledPath, parent, isMain, options);
  }
};

// The preload contract test intentionally executes the real compiled CLOUD_PAPER snapshot
// subscription inside a plain Node child process. In Electron, BrowserWindow owns preload
// lifetime; in the coverage harness, the repeating 2-second refresh timer can otherwise keep
// that child alive after every assertion and unsubscribe has completed. Unref only that exact
// background refresh timer, only for this one coverage-instrumented contract test. Retry
// timeout timers (3 seconds) remain referenced, so timeout/failure semantics are unchanged.
const isPreloadCoverageContract =
  typeof process.env.NODE_V8_COVERAGE === "string" &&
  process.argv.some((value) => value.endsWith("electron-preload-renderer-contract.test.js"));

if (isPreloadCoverageContract) {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = function coverageAwareSetTimeout(callback, delay, ...args) {
    const timer = originalSetTimeout(callback, delay, ...args);
    if (delay === 2_000 && timer != null && typeof timer.unref === "function") timer.unref();
    return timer;
  };
}
