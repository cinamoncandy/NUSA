import assert from "node:assert/strict";
import test from "node:test";
import { handleEvolutionLearningSupervisorHttp } from "./evolutionLearningSupervisorHttp";

const tokenVerifier = Object.freeze({
  verify: (token: string) => token === "ok"
    ? Object.freeze({ userId: "owner", email: "owner@example.test", scopes: ["dashboard:read"] })
    : undefined,
});

const snapshot = () => Object.freeze({
  schemaVersion: 1 as const,
  scope: "EVOLUTION_LEARNING_EVIDENCE_ONLY" as const,
  authority: "READ_ONLY" as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  eventCount: 1,
  headHash: "a".repeat(64),
  latest: Object.freeze({
    opportunityId: "op-1",
    problem: "Observed regression",
    hypothesis: "Bound the change",
    outcome: "SUCCESS" as const,
    validationStatus: "VERIFIED",
    evidenceReferences: Object.freeze(["evidence:1"]),
    changeReference: "commit:abc",
    failureReason: null,
    rollbackReference: null,
    reusable: true,
    recordedAt: "2026-08-29T12:00:00.000Z",
  }),
});

test("requires the existing dashboard read authorization", () => {
  assert.equal(handleEvolutionLearningSupervisorHttp({ method: "GET", headers: {} }, { tokenVerifier, loadSnapshot: snapshot }).status, 401);
});

test("returns validated evidence-only zero-authority learning snapshot", () => {
  const response = handleEvolutionLearningSupervisorHttp(
    { method: "GET", headers: { authorization: "Bearer ok" } },
    { tokenVerifier, loadSnapshot: snapshot },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.authority, "READ_ONLY");
  assert.equal(body.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(body.liveAuthority, "NONE");
  assert.equal(body.productionMutationAllowed, false);
});

test("fails closed when the source projection attempts authority escalation", () => {
  const response = handleEvolutionLearningSupervisorHttp(
    { method: "GET", headers: { authorization: "Bearer ok" } },
    { tokenVerifier, loadSnapshot: () => ({ ...snapshot(), aiAuthority: "EXECUTE" } as never) },
  );
  assert.equal(response.status, 503);
});
