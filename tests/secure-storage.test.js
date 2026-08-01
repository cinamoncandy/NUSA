const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FileSecureStorage } = require("../dist/apps/desktop/src/secureStorage.js");

function protector(keyId, prefix) {
  return { keyId, isAvailable: () => true, encrypt: value => `${prefix}:${Buffer.from(value).toString("base64")}`, decrypt: value => { assert.match(value, new RegExp(`^${prefix}:`)); return Buffer.from(value.slice(prefix.length + 1), "base64").toString(); } };
}

test("secure storage persists encrypted data in a separate directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-secure-"));
  const storage = new FileSecureStorage(root, protector("key-1", "native"));
  await storage.set("session", Uint8Array.from([1, 2, 3]));
  const raw = fs.readFileSync(path.join(root, "secure-storage", "session.json"), "utf8");
  assert.doesNotMatch(raw, /AQID|secret|session-token/i);
  const restarted = new FileSecureStorage(root, protector("key-1", "native"));
  assert.deepEqual([...await restarted.get("session")], [1, 2, 3]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("rotation re-encrypts existing values and old key cannot read them", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-secure-"));
  const storage = new FileSecureStorage(root, protector("key-1", "old"));
  await storage.set("api-token", Uint8Array.from([9, 8, 7]));
  await storage.rotate(protector("key-2", "new"));
  assert.deepEqual([...await storage.get("api-token")], [9, 8, 7]);
  await assert.rejects(() => new FileSecureStorage(root, protector("key-1", "old")).get("api-token"), /key mismatch/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("secure deletion and unavailable native storage fail closed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-secure-"));
  const storage = new FileSecureStorage(root, protector("key-1", "native"));
  await storage.set("secret", Uint8Array.from([1])); await storage.delete("secret"); assert.equal(await storage.get("secret"), null);
  const unavailable = new FileSecureStorage(root, { ...protector("key-1", "native"), isAvailable: () => false });
  await assert.rejects(() => unavailable.set("secret", Uint8Array.from([1])), /unavailable/);
  fs.rmSync(root, { recursive: true, force: true });
});
