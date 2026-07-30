const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ElectronSafeStorageCredentialProvider } = require("../dist/apps/desktop/src/upbitCredentialProvider.js");

const port = () => ({ isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() });

test("safe storage credential provider round trips without plaintext payload", async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "dokkaebi-cred-")), "credentials.json");
  const provider = new ElectronSafeStorageCredentialProvider(file, port());
  await provider.saveCredentials({ accessKey: "access-key", secretKey: "secret-key" });
  assert.equal(await provider.hasCredentials(), true);
  assert.deepEqual(await provider.loadCredentials(), { accessKey: "access-key", secretKey: "secret-key" });
  assert.doesNotMatch(readFileSync(file, "utf8"), /secret-key/);
  await provider.deleteCredentials();
  assert.equal(await provider.hasCredentials(), false);
});

test("credential provider fails closed when encryption is unavailable", async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "dokkaebi-cred-")), "credentials.json");
  const provider = new ElectronSafeStorageCredentialProvider(file, { ...port(), isEncryptionAvailable: () => false });
  await assert.rejects(provider.saveCredentials({ accessKey: "a", secretKey: "b" }), /encryption unavailable/);
});
