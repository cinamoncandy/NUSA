const test = require("node:test");
const assert = require("node:assert/strict");
const { VersionedJsonStore } = require("../dist/apps/mobile/src/mobilePersistence.js");

const storage = (seed = {}) => ({ values: { ...seed }, async getItem(key) { return this.values[key] ?? null; }, async setItem(key, value) { this.values[key] = value; } });

/**
 * WO audit finding: save() used to promote whatever was CURRENTLY in the primary slot into
 * the backup slot unconditionally -- including a corrupted primary. That poisons the one
 * copy load() falls back to. If a crash or corruption event hits the primary, the very next
 * ordinary save() call (nothing special, just a normal app action) would overwrite the last
 * known-good backup with the corrupted blob, and a second interrupted write after that would
 * leave both copies unreadable -- exactly the scenario a backup exists to prevent.
 */

test("a corrupted primary is never promoted into the backup slot on the next save", async () => {
  const s = storage();
  const store = new VersionedJsonStore(s, "portfolio", 1, (value) => { if (!value || typeof value !== "object") throw new Error("invalid"); return value; });

  await store.save({ equity: 100 }); // first save: no prior primary, backup stays unset
  s.values.portfolio = "not-json-garbage"; // simulate a crash/bit-rot corrupting the primary
  await store.save({ equity: 200 }); // an ordinary, unrelated save happens later

  assert.equal(s.values["portfolio:backup"], undefined, "corrupted content must not be copied into the backup slot");
});

test("a known-good backup survives a corruption event across a subsequent save", async () => {
  const s = storage();
  const store = new VersionedJsonStore(s, "portfolio", 1, (value) => { if (!value || typeof value !== "object") throw new Error("invalid"); return value; });

  await store.save({ equity: 100 }); // primary: 100, backup: (none yet)
  await store.save({ equity: 110 }); // primary: 110, backup: 100 (110's predecessor was valid)
  s.values.portfolio = "not-json-garbage"; // corrupt the primary (110) in place
  await store.save({ equity: 120 }); // an ordinary save happens before anyone notices

  // The backup must still be the last known-good value (100), not the corrupted blob
  // that was sitting in the primary slot when this save ran.
  const backup = JSON.parse(s.values["portfolio:backup"]);
  assert.deepEqual(backup.value, { equity: 100 });

  // And recovery still works if the NEW primary (120) also turns out to be bad.
  s.values.portfolio = "still-garbage";
  assert.deepEqual(await store.load(), { equity: 100 });
});

test("a self-consistent (uncorrupted) current primary is still rotated into the backup slot as before", async () => {
  const s = storage();
  const store = new VersionedJsonStore(s, "portfolio", 1, (value) => { if (!value || typeof value !== "object") throw new Error("invalid"); return value; });

  await store.save({ equity: 100 });
  await store.save({ equity: 110 });

  const backup = JSON.parse(s.values["portfolio:backup"]);
  assert.deepEqual(backup.value, { equity: 100 }, "ordinary backup rotation must be unaffected by this fix");
});

test("a corrupted backup fails with a named error instead of a raw SyntaxError", async () => {
  const s = storage();
  const store = new VersionedJsonStore(s, "portfolio", 1, (value) => { if (!value || typeof value !== "object") throw new Error("invalid"); return value; });

  s.values.portfolio = "not-json-garbage";
  s.values["portfolio:backup"] = "also-not-json{{{";
  await assert.rejects(() => store.load(), /backup data is invalid/);

  s.values["portfolio:backup"] = JSON.stringify({ version: 1, value: { equity: 50 }, checksum: "wrong" });
  await assert.rejects(() => store.load(), /backup data is invalid/);
});
