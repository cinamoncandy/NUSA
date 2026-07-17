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
