import assert from "node:assert/strict";
import test from "node:test";
import { UpbitExecutionRestClient } from "./upbitExecutionRestClient";
import { LiveMutationDisabledError } from "./upbitRestAdapter";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("explicit execution transport can submit a normalized Upbit order", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined; authorization: string | null }> = [];
  const client = new UpbitExecutionRestClient({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    nonce: () => "00000000-0000-4000-8000-000000000001",
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
        authorization: headers.get("authorization"),
      });
      return response({ uuid: "order-1", market: "KRW-BTC", side: "bid", ord_type: "price", state: "wait" });
    },
  });

  const result = await client.submitOrder({ market: "KRW-BTC", side: "bid", ord_type: "price", price: "10000", identifier: "decision-1" });

  assert.equal(result.uuid, "order-1");
  assert.equal(calls[0]?.url, "https://api.upbit.com/v1/orders");
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
    market: "KRW-BTC",
    side: "bid",
    ord_type: "price",
    price: "10000",
    identifier: "decision-1",
  });
  assert.match(calls[0]?.authorization ?? "", /^Bearer [^.]+\.[^.]+\.[^.]+$/);
});

test("explicit execution transport can cancel an order by uuid", async () => {
  let request: { url: string; method: string } | undefined;
  const client = new UpbitExecutionRestClient({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetchImpl: async (input, init) => {
      request = { url: String(input), method: init?.method ?? "GET" };
      return response({ uuid: "order-1", market: "KRW-BTC", state: "cancel" });
    },
  });

  const result = await client.cancelOrder("order-1");

  assert.equal(result.uuid, "order-1");
  assert.equal(request?.method, "DELETE");
  const url = new URL(request?.url ?? "https://invalid.local");
  assert.equal(url.pathname, "/v1/order");
  assert.equal(url.searchParams.get("uuid"), "order-1");
});

test("withdrawal remains unavailable even on the explicit execution transport", async () => {
  const client = new UpbitExecutionRestClient({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    fetchImpl: async () => response({}),
  });

  await assert.rejects(client.withdraw(), LiveMutationDisabledError);
});
