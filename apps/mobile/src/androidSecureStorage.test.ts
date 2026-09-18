import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AndroidKeystoreSecureStorage, MobileSecureStorageAuthenticationRequiredError } from "./androidSecureStorage";

describe("Android Keystore secure storage", () => {
  it("preserves the distinction between a locked device and corrupt secret data", async () => {
    const native = {
      async setSecret(): Promise<void> {},
      async getSecret(): Promise<string | null> {
        throw Object.assign(new Error("locked"), { code: "E_NUSA_SECURE_STORAGE_AUTH_REQUIRED" });
      },
      async deleteSecret(): Promise<void> {}
    };
    const storage = new AndroidKeystoreSecureStorage(native);
    await assert.rejects(() => storage.getSecret("nusa.mobile.approved-session.v2"), MobileSecureStorageAuthenticationRequiredError);
  });
});
