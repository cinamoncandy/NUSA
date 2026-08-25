import assert from "node:assert/strict";
import test from "node:test";
import {
  LiveMutationDisabledError,
  UpbitLiveReadOnlyAdapter,
} from "./upbitLiveReadOnlyAdapter";

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("authenticated account reads use Bearer JWT without exposing credentials", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const adapter = new UpbitLiveReadOnlyAdapter({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        authorization: headers.get("authorization"),
      });
      return createJsonResponse([
        {
          currency: "KRW",
          balance: "100000",
          locked: "0",
          avg_buy_price: "0",
          avg_buy_price_modified: false,
          unit_currency: "KRW",
        },
      ]);
    },
  });

  const accounts = await adapter.getAccounts();

  assert.equal(accounts[0]?.currency, "KRW");
  assert.equal(calls[0]?.url, "https://api.upbit.com/v1/accounts");
  assert.match(calls[0]?.authorization ?? "", /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  assert.equal(calls[0]?.authorization?.includes("access-key"), false);
  assert.equal(calls[0]?.authorization?.includes("secret-key"), false);
});

test("open-order reads include market and wait-state query", async () => {
  let requestedUrl = "";
  const adapter = new UpbitLiveReadOnlyAdapter({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return createJsonResponse([]);
    },
  });

  await adapter.getOpenOrders("KRW-BTC");

  const parsed = new URL(requestedUrl);
  assert.equal(parsed.pathname, "/v1/orders");
  assert.equal(parsed.searchParams.get("state"), "wait");
  assert.equal(parsed.searchParams.get("market"), "KRW-BTC");
});

test("every live mutation remains fail-closed", async () => {
  const adapter = new UpbitLiveReadOnlyAdapter({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    fetchImpl: async () => createJsonResponse({}),
  });

  await assert.rejects(adapter.submitOrder(), LiveMutationDisabledError);
  await assert.rejects(adapter.cancelOrder(), LiveMutationDisabledError);
  await assert.rejects(adapter.withdraw(), LiveMutationDisabledError);
});

test("provider errors preserve a safe read failure", async () => {
  const adapter = new UpbitLiveReadOnlyAdapter({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    fetchImpl: async () =>
      createJsonResponse(
        { error: { name: "no_authorization_ip", message: "허용되지 않은 IP 주소입니다." } },
        401,
      ),
  });

  await assert.rejects(
    adapter.getAccounts(),
    /Upbit read request failed \(401\): 허용되지 않은 IP 주소입니다\./,
  );
});
