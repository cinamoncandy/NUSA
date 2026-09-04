const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AndroidKeystoreSecureStorage,
  createMobileSecureStorage,
} = require("../dist/apps/mobile/src/androidSecureStorage.js");

function memoryNative() {
  const values = new Map();
  return {
    values,
    async setSecret(key, valueBase64) { values.set(key, valueBase64); },
    async getSecret(key) { return values.has(key) ? values.get(key) : null; },
    async deleteSecret(key) { values.delete(key); },
  };
}

test("round-trips arbitrary bytes through base64 without corruption", async () => {
  const native = memoryNative();
  const storage = new AndroidKeystoreSecureStorage(native);
  const vectors = [
    new Uint8Array([0]),
    new Uint8Array([1, 2]),
    new Uint8Array([1, 2, 3]),
    new Uint8Array([255, 0, 255, 16, 32, 64, 128]),
    Uint8Array.from({ length: 256 }, (_, index) => index),
  ];
  for (const expected of vectors) {
    await storage.setSecret("k", expected);
    assert.deepEqual(await storage.getSecret("k"), expected);
  }
  const stored = native.values.get("k");
  assert.match(stored, /^[A-Za-z0-9+/]*={0,2}$/);
  assert.equal(Buffer.from(stored, "base64").length, 256);
});

test("rejects empty values before touching the native module", async () => {
  const native = memoryNative();
  const storage = new AndroidKeystoreSecureStorage(native);
  await assert.rejects(() => storage.setSecret("k", new Uint8Array(0)), /must not be empty/);
  await assert.rejects(() => storage.setSecret("k", "not-bytes"), /must not be empty/);
  assert.equal(native.values.has("k"), false);
});

test("missing keys read as null and deletes delegate", async () => {
  const native = memoryNative();
  const storage = new AndroidKeystoreSecureStorage(native);
  assert.equal(await storage.getSecret("absent"), null);
  await storage.setSecret("k", new Uint8Array([9]));
  await storage.deleteSecret("k");
  assert.equal(await storage.getSecret("k"), null);
});

test("corrupt native payloads fail closed instead of returning bytes", async () => {
  const native = memoryNative();
  const storage = new AndroidKeystoreSecureStorage(native);
  native.values.set("k", "!!!not-base64!!!");
  await assert.rejects(() => storage.getSecret("k"), /payload is invalid/);
  native.values.set("k", "abc");
  await assert.rejects(() => storage.getSecret("k"), /payload is invalid/);
});

test("factory returns null outside a React Native Android runtime", () => {
  assert.equal(createMobileSecureStorage(), null);
});
