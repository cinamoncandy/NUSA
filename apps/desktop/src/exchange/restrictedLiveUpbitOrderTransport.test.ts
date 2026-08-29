import assert from "node:assert/strict";
import test from "node:test";
import { RestrictedLiveUpbitOrderTransport } from "./restrictedLiveUpbitOrderTransport";

function orderPayload(): Record<string, unknown> {
  return {
    uuid: "order-1",
    side: "bid",
    ord_type: "price",
    price: "10000",
    state: "wait",
    market: "KRW-BTC",
    created_at: "2026-08-29T00:00:00Z",
    volume: null,
    remaining_volume: null,
    reserved_fee: "0",
    remaining_fee: "0",
    paid_fee: "0",
    locked: "10000",
    executed_volume: "0",
    trades_count: 0,
  };
}

test("market buy sends authenticated POST only when under the configured cap", async () => {
  const calls: Array<{ url: string; method: string | undefined; body: string | null | undefined; authorization: string | null }> = [];
  const transport = new RestrictedLiveUpbitOrderTransport({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    maxOrderAmountKrw: 10_000,
    nonce: () => "nonce-1",
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), method: init?.method, body: init?.body?.toString(), authorization: headers.get("authorization") });
      return new Response(JSON.stringify(orderPayload()), { status: 201, headers: { "content-type": "application/json" } });
    },
  });

  await transport.submitOrder({ market: "KRW-BTC", side: "bid", ord_type: "price", price: "10000", identifier: "test-order" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.upbit.com/v1/orders");
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[0]?.authorization ?? "", /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  assert.match(calls[0]?.body ?? "", /"identifier":"test-order"/);
});

test("order above the configured cap is rejected before network I/O", async () => {
  let calls = 0;
  const transport = new RestrictedLiveUpbitOrderTransport({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    maxOrderAmountKrw: 10_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(orderPayload()), { status: 201 });
    },
  });

  await assert.rejects(
    transport.submitOrder({ market: "KRW-BTC", side: "bid", ord_type: "price", price: "10001" }),
    /exceeds Restricted-LIVE cap/,
  );
  assert.equal(calls, 0);
});

test("non-KRW and best orders fail closed", async () => {
  const transport = new RestrictedLiveUpbitOrderTransport({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    maxOrderAmountKrw: 10_000,
    fetchImpl: async () => new Response(JSON.stringify(orderPayload()), { status: 201 }),
  });

  await assert.rejects(
    transport.submitOrder({ market: "USDT-BTC", side: "bid", ord_type: "price", price: "10" }),
    /KRW markets only/,
  );
  await assert.rejects(
    transport.submitOrder({ market: "KRW-BTC", side: "bid", ord_type: "best", price: "10000" }),
    /best orders are disabled/,
  );
});

test("cancel-all enumerates open orders then cancels each UUID", async () => {
  const methods: string[] = [];
  const transport = new RestrictedLiveUpbitOrderTransport({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    maxOrderAmountKrw: 10_000,
    fetchImpl: async (_input, init) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "DELETE") return new Response(JSON.stringify(orderPayload()), { status: 200 });
      return new Response(JSON.stringify([{ ...orderPayload(), uuid: "one" }, { ...orderPayload(), uuid: "two" }]), { status: 200 });
    },
  });

  const cancelled = await transport.cancelAllOpenOrders("KRW-BTC");
  assert.equal(cancelled.length, 2);
  assert.deepEqual(methods, ["GET", "DELETE", "DELETE"]);
});
