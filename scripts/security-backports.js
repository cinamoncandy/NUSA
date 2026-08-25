"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, "node_modules", ".pnpm");

const EXPECTED = Object.freeze({
  imageSize: "1.2.1",
  nanoid: "3.3.18"
});

function resolvePackageRoots(name, version, store = STORE, rootNodeModules = path.join(ROOT, "node_modules")) {
  const candidates = [];
  if (fs.existsSync(store)) {
    const prefix = `${name}@${version}`;
    for (const entry of fs.readdirSync(store)) {
      if (!(entry === prefix || entry.startsWith(`${prefix}_`) || entry.startsWith(`${prefix}(`))) continue;
      const candidate = path.join(store, entry, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) candidates.push(candidate);
    }
  }
  const unique = new Map();
  for (const candidate of candidates) unique.set(fs.realpathSync(candidate), candidate);
  if (unique.size > 0) return [...unique.values()];
  const hoisted = path.join(rootNodeModules, name);
  if (fs.existsSync(path.join(hoisted, "package.json"))) return [hoisted];
  return [];
}

function packageRoot(name, version) {
  const roots = resolvePackageRoots(name, version);
  if (roots.length !== 1) throw new Error(`SECURITY_BACKPORT_PACKAGE_RESOLUTION:${name}@${version}:${roots.length}`);
  const root = roots[0];
  const metadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (metadata.name !== name || metadata.version !== version) throw new Error(`SECURITY_BACKPORT_VERSION_MISMATCH:${name}@${version}`);
  return root;
}

function patchExact(text, before, after, expectedCount, label) {
  if (text.includes(after)) {
    const count = text.split(after).length - 1;
    if (count === expectedCount) return { text, changed: false };
  }
  const count = text.split(before).length - 1;
  if (count !== expectedCount) throw new Error(`SECURITY_BACKPORT_SOURCE_SHAPE:${label}:${count}`);
  return { text: text.split(before).join(after), changed: true };
}

function patchImageSizeIcns(text) {
  const before = "imageOffset += imageHeader[1];";
  const after = "if (imageHeader[1] < 8) throw new TypeError('Invalid ICNS entry size');\n        imageOffset += imageHeader[1];";
  return patchExact(text, before, after, 2, "image-size/icns-offset");
}

// utils.js's findBox already guards its own internal box-skip loop against a zero-size box,
// but that guard only fires when the box it lands on doesn't match the requested name. It
// returns immediately on a name match, size included -- so a matching box with size 0 makes
// findBox return the same offset it was given. jxl.js's extractPartialStreams then advances
// its own scan offset by `jxlpBox.offset + jxlpBox.size`, which is unchanged when size is 0,
// so the next findBox call starts over at the same offset and finds the same zero-size box
// again: an unbounded loop pushing ever-larger buffers until the process runs out of memory
// (confirmed with a crafted JXL container). This is the part of GHSA-5p2g-fcmc-qvqq the
// upstream box-progress guard does not cover.
function patchImageSizeJxlPartialStreams(text) {
  const before = "offset = jxlpBox.offset + jxlpBox.size;";
  const after = "offset = jxlpBox.offset + (jxlpBox.size > 0 ? jxlpBox.size : 8);";
  return patchExact(text, before, after, 1, "image-size/jxl-partial-stream-offset");
}

function patchNanoidSync(text, label) {
  const before = "return (size = defaultSize) => {\n    let id = ''";
  const after = "return (size = defaultSize) => {\n    if (size <= 0) return ''\n    let id = ''";
  return patchExact(text, before, after, 1, label);
}

function patchNanoidAsyncBrowser(text, label) {
  const before = "return async (size = defaultSize) => {\n    let id = ''";
  const after = "return async (size = defaultSize) => {\n    if (size <= 0) return ''\n    let id = ''";
  return patchExact(text, before, after, 1, label);
}

function patchNanoidAsyncNode(text, label) {
  const before = "return size => tick('', size)";
  const after = "return (size = defaultSize) => {\n    if (size <= 0) return Promise.resolve('')\n    return tick('', size)\n  }";
  return patchExact(text, before, after, 1, label);
}

function writePatched(file, patcher) {
  const original = fs.readFileSync(file, "utf8");
  const result = patcher(original);
  if (result.changed) fs.writeFileSync(file, result.text, "utf8");
}

function applyBackports() {
  const imageRoot = packageRoot("image-size", EXPECTED.imageSize);
  const nanoidRoot = packageRoot("nanoid", EXPECTED.nanoid);

  writePatched(path.join(imageRoot, "dist", "types", "icns.js"), patchImageSizeIcns);
  writePatched(path.join(imageRoot, "dist", "types", "jxl.js"), patchImageSizeJxlPartialStreams);

  const sync = ["index.js", "index.cjs", "index.browser.js", "index.browser.cjs"];
  for (const relative of sync) writePatched(path.join(nanoidRoot, relative), (text) => patchNanoidSync(text, `nanoid/${relative}`));

  const asyncBrowser = ["async/index.browser.js", "async/index.browser.cjs"];
  for (const relative of asyncBrowser) writePatched(path.join(nanoidRoot, relative), (text) => patchNanoidAsyncBrowser(text, `nanoid/${relative}`));

  const asyncNode = ["async/index.js", "async/index.cjs"];
  for (const relative of asyncNode) writePatched(path.join(nanoidRoot, relative), (text) => patchNanoidAsyncNode(text, `nanoid/${relative}`));

  return verifyBackports();
}

function verifyBackports() {
  const findings = [];
  let imageRoot;
  let nanoidRoot;
  try { imageRoot = packageRoot("image-size", EXPECTED.imageSize); } catch (error) { findings.push(String(error.message)); }
  try { nanoidRoot = packageRoot("nanoid", EXPECTED.nanoid); } catch (error) { findings.push(String(error.message)); }

  if (imageRoot) {
    const icns = fs.readFileSync(path.join(imageRoot, "dist", "types", "icns.js"), "utf8");
    const guards = (icns.match(/if \(imageHeader\[1\] < 8\) throw new TypeError\('Invalid ICNS entry size'\);/g) || []).length;
    if (guards !== 2) findings.push(`IMAGE_SIZE_ICNS_GUARD:${guards}`);
    const utils = fs.readFileSync(path.join(imageRoot, "dist", "types", "utils.js"), "utf8");
    if (!utils.includes("offset += box.size > 0 ? box.size : 8;")) findings.push("IMAGE_SIZE_BOX_PROGRESS_GUARD_MISSING");
    const jxl = fs.readFileSync(path.join(imageRoot, "dist", "types", "jxl.js"), "utf8");
    if (!jxl.includes("offset = jxlpBox.offset + (jxlpBox.size > 0 ? jxlpBox.size : 8);")) findings.push("IMAGE_SIZE_JXL_PARTIAL_STREAM_GUARD_MISSING");
  }

  if (nanoidRoot) {
    const syncFiles = ["index.js", "index.cjs", "index.browser.js", "index.browser.cjs", "async/index.browser.js", "async/index.browser.cjs"];
    for (const relative of syncFiles) {
      const text = fs.readFileSync(path.join(nanoidRoot, relative), "utf8");
      if (!text.includes("if (size <= 0) return ''")) findings.push(`NANOID_ZERO_SIZE_GUARD_MISSING:${relative}`);
    }
    for (const relative of ["async/index.js", "async/index.cjs"]) {
      const text = fs.readFileSync(path.join(nanoidRoot, relative), "utf8");
      if (!text.includes("if (size <= 0) return Promise.resolve('')")) findings.push(`NANOID_ASYNC_ZERO_SIZE_GUARD_MISSING:${relative}`);
    }
  }

  return {
    status: findings.length === 0 ? "PASS" : "FAIL",
    findings,
    packages: { "image-size": EXPECTED.imageSize, nanoid: EXPECTED.nanoid },
    controls: {
      "GHSA-w3rx-r6r6-pgpr": findings.every((item) => !item.startsWith("IMAGE_SIZE_ICNS")),
      "GHSA-5p2g-fcmc-qvqq": findings.every((item) => !item.startsWith("IMAGE_SIZE_BOX") && !item.startsWith("IMAGE_SIZE_JXL")),
      "GHSA-2v37-7h3g-55p8": findings.every((item) => !item.startsWith("NANOID"))
    }
  };
}

module.exports = { EXPECTED, resolvePackageRoots, packageRoot, patchExact, patchImageSizeIcns, patchImageSizeJxlPartialStreams, patchNanoidSync, patchNanoidAsyncBrowser, patchNanoidAsyncNode, applyBackports, verifyBackports };
