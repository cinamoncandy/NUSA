import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleEngineeringOperationsHttp } from "./engineeringOperationsHttp";
import { createNusaEngineeringOperatingReadModel } from "./engineeringOperatingReadModel";

const tokenVerifier = Object.freeze({
  verify: (token: string) => token === "ok"
    ? Object.freeze({ userId: "owner", email: "owner@example.test", scopes: ["dashboard:read"] })
    : undefined,
});

describe("Engineering OS read-only HTTP projection", () => {
  it("requires dashboard read authorization", () => {
    const response = handleEngineeringOperationsHttp({ method: "GET", headers: {} }, {
      tokenVerifier,
      loadSnapshot: () => createNusaEngineeringOperatingReadModel().getSnapshot(),
    });
    assert.equal(response.status, 401);
  });

  it("is GET-only and returns the fail-closed production model", () => {
    const dependencies = {
      tokenVerifier,
      loadSnapshot: () => createNusaEngineeringOperatingReadModel().getSnapshot(),
    };
    const post = handleEngineeringOperationsHttp({ method: "POST", headers: { authorization: "Bearer ok" } }, dependencies);
    assert.equal(post.status, 405);
    const get = handleEngineeringOperationsHttp({ method: "GET", headers: { authorization: "Bearer ok" } }, dependencies);
    assert.equal(get.status, 200);
    assert.equal((JSON.parse(get.body) as { status: string; scope: string }).status, "UNAVAILABLE");
    assert.equal((JSON.parse(get.body) as { scope: string }).scope, "ENGINEERING_OPERATIONS_READ_ONLY");
  });

  it("fails closed when a loader violates the authority contract", () => {
    const snapshot = createNusaEngineeringOperatingReadModel().getSnapshot();
    const response = handleEngineeringOperationsHttp({ method: "GET", headers: { authorization: "Bearer ok" } }, {
      tokenVerifier,
      loadSnapshot: () => ({ ...snapshot, authority: { ...snapshot.authority, liveAuthority: "LIVE" } } as never),
    });
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.body).error, "ENGINEERING_OPERATIONS_UNAVAILABLE");
  });
});
