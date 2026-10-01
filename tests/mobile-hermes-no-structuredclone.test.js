const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Hermes on the Android app has no structuredClone. A contract validator that calls it throws
// "Property 'structuredClone' doesn't exist" on-device (owner screenshot, LIVE tab 2026-10-01)
// while every Node test passes. Shared contracts and mobile sources must use a portable clone.
const roots = ["packages/contracts/src", "apps/mobile/src", "apps/mobile/App.tsx"];

function files(entry) {
  const full = path.join(__dirname, "..", entry);
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? files(path.join(entry, d.name)) : /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [path.join(full, d.name)] : []);
}

test("mobile-reachable sources never call structuredClone", () => {
  const offenders = roots.flatMap(files).filter((file) => /\bstructuredClone\s*\(/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(path.join(__dirname, ".."), f)), []);
});
