import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiCallUsage, logAiCall } from "./aiCallTelemetry";

describe("AI call telemetry", () => {
  it("reads Workers AI token usage and tolerates responses without it", () => {
    assert.deepEqual(aiCallUsage({ response: "x", usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280 } }), { promptTokens: 1200, completionTokens: 80 });
    assert.deepEqual(aiCallUsage({ response: "x" }), { promptTokens: null, completionTokens: null });
    assert.deepEqual(aiCallUsage("raw string"), { promptTokens: null, completionTokens: null });
    assert.deepEqual(aiCallUsage({ usage: { prompt_tokens: -1, completion_tokens: "80" } }), { promptTokens: null, completionTokens: null });
  });

  it("logs one numeric line per call and never the prompt or response body", () => {
    const lines: string[] = [];
    logAiCall({ caller: "C2_AUDIT", model: "@cf/model", attempt: 2, promptChars: 5000, response: { response: "SECRET-BODY", usage: { prompt_tokens: 1500, completion_tokens: 40 } } }, (line) => lines.push(line));
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0]!, /SECRET-BODY/);
    const event = JSON.parse(lines[0]!);
    assert.deepEqual(event, { event: "NUSA_AI_CALL", caller: "C2_AUDIT", model: "@cf/model", attempt: 2, promptChars: 5000, promptTokens: 1500, completionTokens: 40, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
  });

  it("never throws into the call it observes", () => {
    assert.doesNotThrow(() => logAiCall({ caller: "C1_CODING", model: "m", attempt: 1, promptChars: 1, response: {} }, () => { throw new Error("log sink down"); }));
  });
});
