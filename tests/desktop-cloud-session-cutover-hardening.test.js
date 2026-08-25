const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopCloudSessionClient } = require("../dist/apps/desktop/src/cloud/desktopCloudSessionClient.js");
const { DesktopCloudSessionStore } = require("../dist/apps/desktop/src/cloud/desktopCloudSessionStore.js");

const safeStorage = Object.freeze({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "dpapi",
  encryptString: (value) => Buffer.from(`cipher:${Buffer.from(value).toString("base64")}`),
  decryptString: (value) => Buffer.from(value.toString().slice("cipher:".length), "base64").toString("utf8")
});

test("secure Desktop session store rejects non-root endpoint paths instead of silently normalizing them", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-desktop-session-cutover-"));
  const filePath = path.join(directory, "session.json");
  try {
    const store = new DesktopCloudSessionStore(safeStorage, filePath);
    assert.throws(() => store.save("https://paper.example.test/api", "r".repeat(48)), /server origin only/i);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("explicit re-bootstrap clears the previous persisted refresh before contacting Cloud and stays fail-closed on rejection", async () => {
  const prior = { endpoint: "https://old.example.test", refreshToken: "r".repeat(48) };
  const store = {
    value: prior,
    clearCount: 0,
    load() { return this.value; },
    save(endpoint, refreshToken) { this.value = { endpoint, refreshToken }; },
    clear() { this.clearCount += 1; this.value = undefined; }
  };
  let requests = 0;
  const client = new DesktopCloudSessionClient(store, async () => {
    requests += 1;
    return { ok: false, status: 401, json: async () => ({ error: "DESKTOP_BOOTSTRAP_REJECTED" }) };
  });

  await assert.rejects(
    () => client.bootstrap("https://paper.example.test", "b".repeat(48)),
    /bootstrap rejected/i
  );
  assert.equal(requests, 1);
  assert.equal(store.clearCount, 1);
  assert.equal(store.value, undefined);
  assert.deepEqual(client.snapshot(), { connected: false });
});

test("Desktop session client rejects non-root bootstrap endpoints before consuming one-time credential material", async () => {
  let requests = 0;
  const store = { load: () => undefined, save() {}, clear() {} };
  const client = new DesktopCloudSessionClient(store, async () => { requests += 1; throw new Error("must not call"); });
  await assert.rejects(
    () => client.bootstrap("https://paper.example.test/nested", "b".repeat(48)),
    /invalid desktop cloud endpoint/i
  );
  assert.equal(requests, 0);
});
