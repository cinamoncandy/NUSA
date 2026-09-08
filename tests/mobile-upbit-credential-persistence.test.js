const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const SECURE_STORAGE_PATH = require.resolve("../dist/apps/mobile/src/androidSecureStorage.js");
const CREDENTIAL_PATH = require.resolve("../dist/apps/mobile/src/upbitCredentialSession.js");
const TOKEN = ["upbit", "bridge", "credential", "fixture", "1234567890"].join("-");

// The real port is backed by the Android Keystore native module, which does not exist under
// node. This stub keeps the port contract (Uint8Array in, Uint8Array out) so the session's
// own persistence logic is what is under test.
function withStubbedSecureStorage(run, { failWrites = false } = {}) {
  const store = new Map();
  const port = {
    async setSecret(key, value) {
      if (failWrites) throw new Error("secure storage unavailable");
      assert.ok(value instanceof Uint8Array, "a secret must be written as bytes");
      store.set(key, Uint8Array.from(value));
    },
    async getSecret(key) { return store.get(key) ?? null; },
    async deleteSecret(key) { store.delete(key); }
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    const resolved = (() => { try { return Module._resolveFilename(request, parent, isMain); } catch { return null; } })();
    if (resolved === SECURE_STORAGE_PATH) return { createMobileSecureStorage: () => port };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[CREDENTIAL_PATH];
  try {
    const loaded = require(CREDENTIAL_PATH);
    return run(loaded, store);
  } finally {
    Module._load = originalLoad;
    delete require.cache[CREDENTIAL_PATH];
  }
}

test("a connected credential is written to secure storage as bytes", async () => {
  await withStubbedSecureStorage(async ({ InMemoryUpbitCredentialSession }, store) => {
    const session = new InMemoryUpbitCredentialSession();
    session.connect(TOKEN);
    assert.equal(session.isConfigured(), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(store.size, 1, "the credential is persisted");
    const [key] = [...store.keys()];
    assert.match(key, /upbit/, "the storage key names the Upbit bridge");
    assert.equal(Buffer.from(store.get(key)).toString("ascii"), TOKEN);
  });
});

// This is the reported symptom: authentication succeeded, then the connection dropped itself
// on the next launch because the credential lived only in the dead process's memory.
test("a credential survives a process restart", async () => {
  const store = new Map();
  const port = {
    async setSecret(key, value) { store.set(key, Uint8Array.from(value)); },
    async getSecret(key) { return store.get(key) ?? null; },
    async deleteSecret(key) { store.delete(key); }
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    const resolved = (() => { try { return Module._resolveFilename(request, parent, isMain); } catch { return null; } })();
    if (resolved === SECURE_STORAGE_PATH) return { createMobileSecureStorage: () => port };
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[CREDENTIAL_PATH];
    const first = require(CREDENTIAL_PATH);
    new first.InMemoryUpbitCredentialSession().connect(TOKEN);
    await new Promise((resolve) => setImmediate(resolve));

    // A fresh module registry stands in for the relaunched process: memory is empty and only
    // what reached secure storage can come back.
    delete require.cache[CREDENTIAL_PATH];
    const relaunched = require(CREDENTIAL_PATH);
    const session = new relaunched.InMemoryUpbitCredentialSession();
    assert.equal(session.isConfigured(), false, "memory starts empty after a restart");
    assert.equal(await session.credentialProvider(), TOKEN, "the credential is restored");
    assert.equal(session.isConfigured(), true);
  } finally {
    Module._load = originalLoad;
    delete require.cache[CREDENTIAL_PATH];
  }
});

test("disconnecting removes the credential from the device", async () => {
  await withStubbedSecureStorage(async ({ InMemoryUpbitCredentialSession }, store) => {
    const session = new InMemoryUpbitCredentialSession();
    session.connect(TOKEN);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(store.size, 1);
    session.clear();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.isConfigured(), false);
    assert.equal(store.size, 0, "an explicit disconnect must not leave a credential behind");
    assert.equal(await session.credentialProvider(), null);
  });
});

test("a runtime without secure storage still connects for the session", async () => {
  await withStubbedSecureStorage(async ({ InMemoryUpbitCredentialSession }) => {
    const session = new InMemoryUpbitCredentialSession();
    session.connect(TOKEN);
    assert.equal(session.isConfigured(), true, "a failed write must not refuse the credential");
    assert.equal(await session.credentialProvider(), TOKEN);
  }, { failWrites: true });
});

test("an invalid token is refused and never persisted", async () => {
  await withStubbedSecureStorage(async ({ InMemoryUpbitCredentialSession }, store) => {
    const session = new InMemoryUpbitCredentialSession();
    assert.throws(() => session.connect("short"), /invalid/i);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(store.size, 0);
    assert.equal(session.isConfigured(), false);
  });
});
