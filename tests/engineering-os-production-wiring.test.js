const assert = require("node:assert/strict");
const { test } = require("node:test");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

test("production Cloud runtime exposes the canonical read-only Engineering OS accessor", async () => {
  const handle = startCloudRuntime({
    NUSA_CLOUD_DASHBOARD_PORT: "42986",
    NUSA_CLOUD_DASHBOARD_TOKEN: "engineering-os-production-wiring-token-0123456789",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
  });
  try {
    const snapshot = handle.getEngineeringOperatingSnapshot();
    assert.equal(snapshot.scope, "ENGINEERING_OPERATIONS_READ_ONLY");
    assert.equal(snapshot.status, "UNAVAILABLE");
    assert.equal(snapshot.authority.liveAuthority, "NONE");
    assert.equal(snapshot.authority.productionMutationAllowed, false);
    assert.equal(snapshot.authority.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(snapshot.queue.status, "UNAVAILABLE");
  } finally {
    await handle.stop();
  }
});
