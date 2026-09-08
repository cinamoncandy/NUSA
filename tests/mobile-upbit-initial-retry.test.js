const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("Upbit initial outage retries in memory while auth rejection does not", async () => {
  for (const error of ["HTTP_503", "HTTP_429", "Network unavailable", "HTTP_401", "HTTP_403"]) {
    let token = null;
    let callback = null;
    let fail = true;
    const exports = {};
    class Session {
      connect(value) { token = value; }
      clear() { token = null; }
      isConfigured() { return token !== null; }
      credentialProvider = async () => token;
    }
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../dist/apps/mobile/src/upbitReadOnlyAccount.js"), "utf8"), {
      exports, Date, Error, setInterval: (fn) => { callback = fn; return 1; }, clearInterval: () => { callback = null; },
      require: (name) => {
        if (name === "react") return {};
        if (name === "./upbitCredentialSession") return { InMemoryUpbitCredentialSession: Session };
        if (name === "./upbitReadOnlyAccountModel") return { normalizeUpbitReadOnlySnapshot: (value) => value };
        if (name === "./upbitLiveClient") return { UPBIT_LIVE_BASE_URL: "https://example.com", loadUpbitLiveAccounts: async () => { if (fail) throw new Error(error); return { fetchedAt: Date.now() }; } };
        throw new Error("Unexpected dependency");
      }
    });
    const initial = await exports.connectUpbitReadOnlyAccount("test-input");
    assert.equal(initial.status, "ERROR");
    if (error === "HTTP_401" || error === "HTTP_403") {
      assert.equal(token, null);
      assert.equal(callback, null);
    } else {
      assert.notEqual(token, null);
      assert.equal(typeof callback, "function");
      fail = false;
      callback();
      assert.equal((await exports.refreshUpbitReadOnlyAccount()).status, "READY");
    }
    exports.resetUpbitReadOnlyState();
    assert.equal(callback, null);
    assert.equal(token, null);
  }
});
