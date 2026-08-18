import { describe, expect, it } from "vitest";
import { MobileSessionClient } from "../apps/mobile/src/mobileSessionClient";

class MemorySecureStorage {
  value = null;
  async setSecret(_key, value) { this.value = new Uint8Array(value); }
  async getSecret(_key) { return this.value == null ? null : new Uint8Array(this.value); }
  async deleteSecret(_key) { this.value = null; }
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
describe("mobile production session boundary", () => {
  it("requires server evidence before ACTIVE and stores only refresh material", async () => {
    const storage = new MemorySecureStorage(); const calls = [];
    const client = new MobileSessionClient({ secureStorage: storage, baseUrl: "https://nusa-api.duckdns.org", fetcher: async (input) => { calls.push(String(input)); if (String(input).endsWith("/v1/mobile/bootstrap")) return response({ accessToken: "access", refreshToken: "refresh" }); return response({ userId: "u1", email: "owner@example.test", scopes: ["dashboard:read", "paper:trade"] }); } });
    const identity = await client.bootstrap("one-time-token");
    expect(identity.userId).toBe("u1"); expect(client.state).toBe("ACTIVE"); expect(new TextDecoder().decode(await storage.getSecret("nusa.mobile.refresh.v1"))).toBe("refresh"); expect(calls).toEqual(["https://nusa-api.duckdns.org/v1/mobile/bootstrap", "https://nusa-api.duckdns.org/v1/mobile/me"]);
  });
  it("rejects insecure production origins", () => { expect(() => new MobileSessionClient({ secureStorage: new MemorySecureStorage(), baseUrl: "http://127.0.0.1:41731" })).toThrow("INVALID_PRODUCTION_ORIGIN"); });
  it("fails closed on rejected bootstrap", async () => { const client = new MobileSessionClient({ secureStorage: new MemorySecureStorage(), fetcher: async () => response({ error: "rejected" }, 401) }); await expect(client.bootstrap("token")).rejects.toThrow("MOBILE_BOOTSTRAP_REJECTED"); expect(client.state).toBe("BLOCKED"); });
  it("rotates refresh material and keeps access token out of secure storage", async () => {
    const storage = new MemorySecureStorage(); let refreshCalls = 0;
    const client = new MobileSessionClient({ secureStorage: storage, fetcher: async (input) => { const url = String(input); if (url.endsWith("/bootstrap")) return response({ accessToken: "a1", refreshToken: "r1" }); if (url.endsWith("/refresh")) { refreshCalls += 1; return response({ accessToken: "a2", refreshToken: "r2" }); } return response({ userId: "u1", email: "u@example.test", scopes: ["dashboard:read"] }); } });
    await client.bootstrap("one-time"); await client.restore();
    expect(refreshCalls).toBe(1); expect(new TextDecoder().decode(await storage.getSecret("nusa.mobile.refresh.v1"))).toBe("r2"); expect(() => client.getAccessTokenForMainProcessOnly()).toThrow("ACCESS_TOKEN_NOT_EXPOSED_TO_UI");
  });
  it("revokes and clears the encrypted refresh material on logout", async () => {
    const storage = new MemorySecureStorage(); const calls = [];
    const client = new MobileSessionClient({ secureStorage: storage, fetcher: async (input) => { calls.push(String(input)); return String(input).endsWith("/bootstrap") ? response({ accessToken: "a1", refreshToken: "r1" }) : response({ userId: "u1", scopes: [] }); } });
    await expect(client.bootstrap("one-time")).rejects.toThrow("INVALID_IDENTITY_RESPONSE"); await client.logout(); expect(await storage.getSecret("nusa.mobile.refresh.v1")).toBeNull(); expect(client.state).toBe("SIGNED_OUT");
    expect(calls[0]).toContain("/bootstrap");
  });
  it("fails closed when secure storage is unavailable", async () => {
    const storage = { async setSecret() { throw new Error("SECURE_STORAGE_UNAVAILABLE"); }, async getSecret() { throw new Error("SECURE_STORAGE_UNAVAILABLE"); }, async deleteSecret() { throw new Error("SECURE_STORAGE_UNAVAILABLE"); } };
    const client = new MobileSessionClient({ secureStorage: storage, fetcher: async () => response({ accessToken: "a1", refreshToken: "r1" }) });
    await expect(client.bootstrap("one-time")).rejects.toThrow("SECURE_STORAGE_UNAVAILABLE"); expect(client.state).toBe("AUTHENTICATING");
  });
  it("rejects incomplete server identity and never activates locally", async () => {
    const client = new MobileSessionClient({ secureStorage: new MemorySecureStorage(), fetcher: async (input) => String(input).endsWith("/bootstrap") ? response({ accessToken: "a1", refreshToken: "r1" }) : response({ userId: "u1", scopes: ["paper:trade"] }) });
    await expect(client.bootstrap("one-time")).rejects.toThrow("INVALID_IDENTITY_RESPONSE"); expect(client.identity).toBeNull();
  });
});
