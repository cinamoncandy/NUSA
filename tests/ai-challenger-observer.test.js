const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildChallengerSignalPrompt,
  createAnthropicChallengerClient,
  AiChallengerObserver,
  verifyAiChallengerEvents
} = require("../dist/apps/desktop/src/ai/aiChallengerObserver.js");

function championSignal(overrides = {}) {
  return { type: "BUY", reason: "short-SMA crossed above long-SMA", ...overrides };
}

test("buildChallengerSignalPrompt includes market, prices, and regime, and asks for JSON only", () => {
  const prompt = buildChallengerSignalPrompt({ market: "KRW-BTC", recentPrices: [100, 101, 102], regime: "TRENDING" });
  assert.ok(prompt.includes("KRW-BTC"));
  assert.ok(prompt.includes("100, 101, 102"));
  assert.ok(prompt.includes("Regime: TRENDING"));
  assert.ok(prompt.includes("PAPER-TRADING"));
  assert.ok(prompt.includes("JSON"));
});

test("AiChallengerObserver skips when no client is configured", async () => {
  const observer = new AiChallengerObserver(undefined);
  const result = observer.observe({ market: "KRW-BTC", championSignal: championSignal(), recentPrices: [100] });
  assert.equal(result, undefined);
  assert.equal(observer.getLatestObservation(), undefined);
});

test("AiChallengerObserver only calls the client on a champion signal transition", async () => {
  let calls = 0;
  const client = { generateSignal: async () => { calls += 1; return { type: "BUY", reason: "테스트", confidence: 0.5 }; } };
  const observer = new AiChallengerObserver(client, () => 1000);
  const first = observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "HOLD" }), recentPrices: [100] });
  await first;
  assert.equal(calls, 1, "first observation is always a transition from undefined");
  const second = observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "HOLD" }), recentPrices: [100] });
  assert.equal(second, undefined, "no transition, no call");
  assert.equal(calls, 1);
  const third = observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100] });
  await third;
  assert.equal(calls, 2, "HOLD -> BUY is a transition");
});

test("AiChallengerObserver records an observation with agreement flag and hash-chained events", async () => {
  const client = { generateSignal: async () => ({ type: "BUY", reason: "추세 상승", confidence: 0.7 }) };
  const observer = new AiChallengerObserver(client, () => 5000);
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100, 101] });
  const observation = observer.getLatestObservation();
  assert.equal(observation.agreesWithChampion, true);
  assert.equal(observation.aiSignal.type, "BUY");
  assert.equal(observation.timestamp, 5000);
  const events = observer.eventLog();
  assert.equal(events.length, 1);
  assert.deepEqual(verifyAiChallengerEvents(events), []);
});

test("AiChallengerObserver records disagreement when the AI signal differs from the champion", async () => {
  const client = { generateSignal: async () => ({ type: "SELL", reason: "하락 압력", confidence: 0.6 }) };
  const observer = new AiChallengerObserver(client, () => 5000);
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100] });
  assert.equal(observer.getLatestObservation().agreesWithChampion, false);
});

test("AiChallengerObserver never overlaps concurrent calls", async () => {
  let resolveFirst;
  let calls = 0;
  const client = {
    generateSignal: async () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = () => resolve({ type: "BUY", reason: "느린 응답", confidence: 0.5 }); });
      return { type: "SELL", reason: "빠른 응답", confidence: 0.5 };
    }
  };
  const observer = new AiChallengerObserver(client, () => 1);
  const pending = observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100] });
  const duringFlight = observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "SELL" }), recentPrices: [100] });
  assert.equal(duringFlight, undefined, "a call already in flight blocks a new one even on a real transition");
  resolveFirst();
  await pending;
  assert.equal(calls, 1);
});

test("AiChallengerObserver retries a transition that was only skipped due to an in-flight call", async () => {
  let resolveFirst;
  let calls = 0;
  const client = {
    generateSignal: async () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = () => resolve({ type: "BUY", reason: "느린 응답", confidence: 0.5 }); });
      return { type: "SELL", reason: "빠른 응답", confidence: 0.5 };
    }
  };
  const observer = new AiChallengerObserver(client, () => 1);
  const pending = observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100] });
  const droppedDuringFlight = observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "SELL" }), recentPrices: [100] });
  assert.equal(droppedDuringFlight, undefined);
  resolveFirst();
  await pending;
  const retried = observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "SELL" }), recentPrices: [100] });
  assert.notEqual(retried, undefined, "the SELL transition must still be observable once the first call clears");
  await retried;
  assert.equal(calls, 2);
  assert.equal(observer.getLatestObservation().championSignal.type, "SELL");
});

test("AiChallengerObserver silently skips a failed AI call without throwing", async () => {
  const client = { generateSignal: async () => { throw new Error("network down"); } };
  const observer = new AiChallengerObserver(client, () => 1);
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100] });
  assert.equal(observer.getLatestObservation(), undefined);
  assert.equal(observer.eventLog().length, 0);
});

test("verifyAiChallengerEvents detects a tampered event", async () => {
  const client = { generateSignal: async () => ({ type: "BUY", reason: "추세", confidence: 0.5 }) };
  const observer = new AiChallengerObserver(client, () => 1);
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100] });
  const tampered = observer.eventLog().map((event) => ({ ...event, agreesWithChampion: !event.agreesWithChampion }));
  assert.ok(verifyAiChallengerEvents(tampered).includes("EVENT_HASH_MISMATCH"));
});

test("createAnthropicChallengerClient parses a valid JSON response", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: '{"type": "SELL", "reason": "하락 추세", "confidence": 0.42}' }] })
  });
  const client = createAnthropicChallengerClient({ apiKey: "hunter2hunter2", fetchImpl });
  const signal = await client.generateSignal({ market: "KRW-BTC", recentPrices: [100] });
  assert.deepEqual(signal, { type: "SELL", reason: "하락 추세", confidence: 0.42 });
});

test("createAnthropicChallengerClient rejects a malformed JSON response", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: '{"type": "MAYBE", "reason": "x", "confidence": 0.5}' }] })
  });
  const client = createAnthropicChallengerClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.generateSignal({ market: "KRW-BTC", recentPrices: [100] }));
});

test("createAnthropicChallengerClient rejects an out-of-range confidence", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: '{"type": "BUY", "reason": "x", "confidence": 1.5}' }] })
  });
  const client = createAnthropicChallengerClient({ apiKey: "hunter2hunter2", fetchImpl });
  await assert.rejects(() => client.generateSignal({ market: "KRW-BTC", recentPrices: [100] }));
});

test("getStats reports a null rate (not zero) when there are no observations yet", () => {
  const observer = new AiChallengerObserver(undefined);
  const stats = observer.getStats();
  assert.deepEqual(stats, { totalObservations: 0, agreementCount: 0, agreementRate: null });
});

test("getStats computes the agreement rate across recorded observations", async () => {
  const responses = [
    { type: "BUY", reason: "일치1", confidence: 0.5 },
    { type: "SELL", reason: "불일치", confidence: 0.5 },
    { type: "SELL", reason: "일치2", confidence: 0.5 }
  ];
  let call = 0;
  const client = { generateSignal: async () => responses[call++] };
  const observer = new AiChallengerObserver(client, () => 1);
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100] });
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "HOLD" }), recentPrices: [100] });
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "SELL" }), recentPrices: [100] });
  const stats = observer.getStats();
  assert.equal(stats.totalObservations, 3);
  assert.equal(stats.agreementCount, 2);
  assert.ok(Math.abs(stats.agreementRate - 2 / 3) < 1e-9);
});

test("getHistory returns observations newest-first without hash-chain bookkeeping fields", async () => {
  let seen = 0;
  const timestamps = [100, 200, 300];
  const client = { generateSignal: async () => ({ type: "BUY", reason: `응답${seen}`, confidence: 0.5 }) };
  const observer = new AiChallengerObserver(client, () => timestamps[seen++]);
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "BUY" }), recentPrices: [100] });
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "HOLD" }), recentPrices: [100] });
  await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type: "SELL" }), recentPrices: [100] });
  const history = observer.getHistory();
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((entry) => entry.timestamp), [300, 200, 100]);
  for (const entry of history) {
    assert.equal(Object.hasOwn(entry, "sequence"), false);
    assert.equal(Object.hasOwn(entry, "eventSha256"), false);
    assert.equal(Object.hasOwn(entry, "previousEventSha256"), false);
  }
});

test("getHistory respects the limit and keeps only the most recent entries", async () => {
  let call = 0;
  const client = { generateSignal: async () => ({ type: "BUY", reason: `응답${call}`, confidence: 0.5 }) };
  const observer = new AiChallengerObserver(client, () => call);
  const types = ["BUY", "SELL", "HOLD", "BUY", "SELL"];
  for (const type of types) {
    call += 1;
    await observer.observe({ market: "KRW-BTC", championSignal: championSignal({ type }), recentPrices: [100] });
  }
  const limited = observer.getHistory(2);
  assert.equal(limited.length, 2);
  assert.deepEqual(limited.map((entry) => entry.timestamp), [5, 4]);
});

test("getHistory returns an empty array when there are no observations yet", () => {
  const observer = new AiChallengerObserver(undefined);
  assert.deepEqual(observer.getHistory(), []);
});
