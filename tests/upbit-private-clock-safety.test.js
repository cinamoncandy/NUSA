const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluatePrivateRequestClockEligibility,
} = require("../dist/apps/desktop/src/exchange/privateRequestClockSafety.js");
const {
  UpbitReadOnlyService,
} = require("../dist/apps/desktop/src/exchange/upbitReadOnlyService.js");

function credentialsProvider(onLoad = () => {}) {
  return {
    status: async () => ({ configured: true }),
    loadForReadOnlyUse: async () => {
      onLoad();
      return { accessKey: "access-key", secretKey: "secret-key" };
    },
  };
}

function snapshot() {
  return Object.freeze({
    observedAt: "2026-08-09T00:00:00.000Z",
    accounts: Object.freeze([]),
    openOrders: Object.freeze([]),
  });
}

test("unsafe, unknown, and excessive clock offset block private-request eligibility", () => {
  const safe = evaluatePrivateRequestClockEligibility({ state: "SAFE", offsetMs: 25, maxAbsoluteOffsetMs: 1_000 });
  assert.equal(safe.eligible, true);
  assert.deepEqual(safe.reasonCodes, []);

  const unsafe = evaluatePrivateRequestClockEligibility({ state: "UNSAFE", offsetMs: 25, maxAbsoluteOffsetMs: 1_000 });
  assert.equal(unsafe.eligible, false);
  assert.ok(unsafe.reasonCodes.includes("CLOCK_STATE_UNSAFE"));

  const unknown = evaluatePrivateRequestClockEligibility({ state: "UNKNOWN", offsetMs: null, maxAbsoluteOffsetMs: 1_000 });
  assert.equal(unknown.eligible, false);
  assert.ok(unknown.reasonCodes.includes("CLOCK_STATE_UNKNOWN"));
  assert.ok(unknown.reasonCodes.includes("CLOCK_OFFSET_UNKNOWN"));

  const skewed = evaluatePrivateRequestClockEligibility({ state: "SAFE", offsetMs: 1_001, maxAbsoluteOffsetMs: 1_000 });
  assert.equal(skewed.eligible, false);
  assert.ok(skewed.reasonCodes.includes("CLOCK_OFFSET_EXCEEDED"));
});

test("unsafe clock evidence blocks signed/private broker path before credentials or adapter creation", async () => {
  let credentialLoads = 0;
  let adapterCreations = 0;
  const service = new UpbitReadOnlyService(
    credentialsProvider(() => { credentialLoads += 1; }),
    () => {
      adapterCreations += 1;
      throw new Error("adapter must not be created while clock evidence is unsafe");
    },
    () => ({ state: "UNSAFE", offsetMs: 2_500, maxAbsoluteOffsetMs: 1_000 }),
  );

  const result = await service.testConnection();
  assert.equal(result.ok, false);
  assert.equal(result.code, "CLOCK_UNSAFE");
  assert.match(result.message, /CLOCK_STATE_UNSAFE|CLOCK_OFFSET_EXCEEDED/);
  assert.equal(credentialLoads, 0);
  assert.equal(adapterCreations, 0);
});

test("safe clock evidence preserves authenticated read-only path", async () => {
  let adapterCreations = 0;
  const service = new UpbitReadOnlyService(
    credentialsProvider(),
    () => {
      adapterCreations += 1;
      return {
        captureSnapshot: async () => snapshot(),
      };
    },
    () => ({ state: "SAFE", offsetMs: 10, maxAbsoluteOffsetMs: 1_000 }),
  );

  const result = await service.testConnection();
  assert.equal(result.ok, true);
  assert.equal(result.code, "CONNECTED");
  assert.equal(adapterCreations, 1);
});
