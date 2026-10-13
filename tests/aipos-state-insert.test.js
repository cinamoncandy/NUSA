const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");
const { insertStateEntry } = require("../scripts/aipos-state-insert.js");

const base = [
  "version: 1",
  "current_alpha:",
  "  status: DONE",
  "",
  "current_kilo:",
  "  status: DONE",
  "",
  "current_tango:",
  "  status: DONE",
  "",
].join("\n");
const entry = (name) => `${name}:\n  status: READY_FOR_REVIEW\n  safety: PAPER_ONLY_LIVE_NONE_PRODUCTION_MUTATION_FALSE_AI_ZERO_AUTHORITY\n`;

/** Line ranges (in base coordinates) that an insertion replaced. */
function changedRange(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA -= 1; endB -= 1; }
  return [start, endA];
}

test("a new entry lands at its name-order position and keeps version first", () => {
  const result = insertStateEntry(base, entry("current_golf"));
  const keys = Object.keys(yaml.load(result));
  assert.deepEqual(keys, ["version", "current_alpha", "current_golf", "current_kilo", "current_tango"]);
  assert.deepEqual(Object.keys(yaml.load(insertStateEntry(base, entry("aaa_first")))).slice(0, 2), ["version", "aaa_first"]);
  assert.equal(Object.keys(yaml.load(insertStateEntry(base, entry("zulu_last")))).at(-1), "zulu_last");
});

test("two PRs adding differently named entries touch separate lines, so git merges them cleanly", () => {
  const golf = changedRange(base, insertStateEntry(base, entry("current_golf")));
  const papa = changedRange(base, insertStateEntry(base, entry("current_papa")));
  // Separated by at least one unchanged base line: no overlapping or adjacent hunks.
  assert.ok(golf[1] + 1 < papa[0] || papa[1] + 1 < golf[0], `${golf} vs ${papa}`);
});

test("rejects duplicates, several keys and invalid YAML", () => {
  assert.throws(() => insertStateEntry(base, entry("current_kilo")), /ENTRY_ALREADY_EXISTS/);
  assert.throws(() => insertStateEntry(base, `${entry("current_x")}current_y:\n  a: 1\n`), /ENTRY_MUST_BE_ONE_TOP_LEVEL_KEY/);
  assert.throws(() => insertStateEntry(base, "  indented: 1\n"), /ENTRY_MUST_BE_ONE_TOP_LEVEL_KEY/);
  assert.throws(() => insertStateEntry(base, "current_bad: [\n"), /./);
});

test("on an unsorted file, different names still go to different places", () => {
  const unsorted = ["version: 1", "current_zulu:", "  a: 1", "", "current_bravo:", "  a: 1", "", "current_mike:", "  a: 1", ""].join("\n");
  const charlie = insertStateEntry(unsorted, entry("current_charlie"));
  const november = insertStateEntry(unsorted, entry("current_november"));
  assert.ok(charlie.indexOf("current_charlie:") < charlie.indexOf("current_mike:"));
  assert.ok(november.indexOf("current_november:") < november.indexOf("current_zulu:") || november.indexOf("current_november:") > november.indexOf("current_mike:"));
  const a = changedRange(unsorted, charlie);
  const b = changedRange(unsorted, november);
  assert.ok(a[1] + 1 < b[0] || b[1] + 1 < a[0], `${a} vs ${b}`);
});

test("works on the real state file without reordering existing entries", () => {
  const real = readFileSync(".aipos/state.yaml", "utf8");
  const before = Object.keys(yaml.load(real));
  const after = Object.keys(yaml.load(insertStateEntry(real, entry("current_zz_state_insert_probe"))));
  assert.deepEqual(after.filter((key) => key !== "current_zz_state_insert_probe"), before);
  assert.equal(after.length, before.length + 1);
});
