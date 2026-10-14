const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const yaml = require("js-yaml");

// Per-entry state files (.aipos/state.d/<key>.yaml) must stay unambiguous: one key per file, named after the file,
// and never also present in .aipos/state.yaml, so readers can treat state.yaml + state.d as one map.
test("every state.d file holds exactly its own key and no key duplicates state.yaml", () => {
  const dir = join(".aipos", "state.d");
  const stateKeys = new Set(Object.keys(yaml.load(readFileSync(join(".aipos", "state.yaml"), "utf8"))));
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*\.yaml$/, `unexpected file in state.d: ${name}`);
    const parsed = yaml.load(readFileSync(join(dir, name), "utf8"));
    const key = name.slice(0, -5);
    assert.deepEqual(Object.keys(parsed ?? {}), [key], `${name} must hold exactly the key ${key}`);
    assert.ok(!stateKeys.has(key), `${key} is in both state.yaml and state.d`);
  }
});
