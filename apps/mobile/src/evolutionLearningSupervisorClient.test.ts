import assert from "node:assert/strict";
import test from "node:test";
import { loadEvolutionLearningSupervisor } from "./evolutionLearningSupervisorClient";
import { clearConfiguredPaperEndpoint, markPaperConnectionVerified, setConfiguredPaperEndpoint } from "./paperConnectionSession";

const BASE = "https://nusa.example.test";
const snapshot = Object.freeze({
  schemaVersion: 1,
  scope: "EVOLUTION_LEARNING_EVIDENCE_ONLY",
  authority: "READ_ONLY",
  aiAuthority: "ZERO_AUTHORITY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  eventCount: 0,
  headHash: "0".repeat(64),
  latest: null,
});

function verified(): void {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(BASE);
  markPaperConnectionVerified(BASE);
}

test("loads validated evolution learning through the verified supervisor endpoint", async () => {
  verified();
  const result = await loadEvolutionLearningSupervisor({
    baseUrl: BASE,
    credentialProvider: async () => "session-token",
    request: async () => new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.snapshot.authority, "READ_ONLY");
    assert.equal(result.snapshot.aiAuthority, "ZERO_AUTHORITY");
  }
});

test("rejects authority-escalated evidence", async () => {
  verified();
  const result = await loadEvolutionLearningSupervisor({
    baseUrl: BASE,
    credentialProvider: async () => "session-token",
    request: async () => new Response(JSON.stringify({ ...snapshot, liveAuthority: "EXECUTE" }), { status: 200 }),
  });
  assert.equal(result.status, "UNAVAILABLE");
});

test("rejects a connection or credential change while evidence is in flight", async () => {
  verified();
  let reads = 0;
  const result = await loadEvolutionLearningSupervisor({
    baseUrl: BASE,
    credentialProvider: async () => (++reads === 1 ? "session-token" : "rotated-token"),
    request: async () => new Response(JSON.stringify(snapshot), { status: 200 }),
  });
  assert.equal(result.status, "UNAVAILABLE");
});
