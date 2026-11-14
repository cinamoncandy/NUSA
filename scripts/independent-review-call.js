#!/usr/bin/env node
"use strict";
/**
 * One model API completion call for the automatic independent review. No tools, no files, no streaming, nothing stored.
 * The API key is read from the environment of THIS process only and goes only into the Authorization header; it is never in the prompt, never printed,
 * and an error message never contains it. The model name comes from a repository variable and is validated.
 *
 *   NUSA_REVIEW_API_KEY=... NUSA_REVIEW_MODEL=... node scripts/independent-review-call.js <prompt-file> <out-file>
 * exit 0: out-file holds the model's text. exit 3: out-file empty and one short reason code printed (NO_API_KEY, NO_MODEL, BAD_MODEL, HTTP_<status>, NETWORK, NO_TEXT, PROMPT_TOO_LARGE).
 */
const fs = require("node:fs");

const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_PROMPT_BYTES = 400000;
const MAX_OUTPUT_TOKENS = 4000;
const TIMEOUT_MS = 300000;

function extractText(body) {
  if (body === null || typeof body !== "object") return "";
  const parts = [];
  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (item === null || typeof item !== "object" || item.type !== "message") continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content !== null && typeof content === "object" && content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

async function callReview({ apiKey, model, prompt, fetchImpl = globalThis.fetch }) {
  if (typeof apiKey !== "string" || apiKey.trim() === "") return { ok: false, reason: "NO_API_KEY" };
  if (typeof model !== "string" || model.trim() === "") return { ok: false, reason: "NO_MODEL" };
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(model)) return { ok: false, reason: "BAD_MODEL" };
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) return { ok: false, reason: "PROMPT_TOO_LARGE" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    // No `tools`, no `tool_choice`, no `previous_response_id`, no `stream`; `store: false` keeps the diff out of stored responses.
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: MAX_OUTPUT_TOKENS, store: false }),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, reason: "NETWORK" };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return { ok: false, reason: `HTTP_${Number.isInteger(response.status) ? response.status : "UNKNOWN"}` };
  let body;
  try { body = await response.json(); } catch { return { ok: false, reason: "NO_TEXT" }; }
  const text = extractText(body);
  return text.trim() === "" ? { ok: false, reason: "NO_TEXT" } : { ok: true, text };
}

module.exports = { callReview, extractText, ENDPOINT, MAX_PROMPT_BYTES, MAX_OUTPUT_TOKENS };

if (require.main === module) {
  (async () => {
    const [promptFile, outFile] = process.argv.slice(2);
    let prompt = "";
    try { prompt = fs.readFileSync(promptFile, "utf8"); } catch { prompt = ""; }
    fs.writeFileSync(outFile, "");
    const result = await callReview({ apiKey: process.env.NUSA_REVIEW_API_KEY, model: process.env.NUSA_REVIEW_MODEL, prompt });
    if (!result.ok) { process.stdout.write(`${result.reason}\n`); process.exit(3); }
    fs.writeFileSync(outFile, result.text);
  })();
}
