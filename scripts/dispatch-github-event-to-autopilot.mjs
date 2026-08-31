import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_WEBHOOK_URL = "https://nusa-autopilot.desporin12.workers.dev/github/webhook";
const SUPPORTED_EVENTS = new Set(["push", "pull_request", "workflow_run", "ping"]);
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 20_000;

function safeEventName(value) {
  const event = value === "pull_request_target" ? "pull_request" : value;
  return SUPPORTED_EVENTS.has(event) ? event : null;
}

function safeRunPart(value, name) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) throw new Error(`${name}_INVALID`);
  return String(value);
}

export function createDeliveryId({ repository, event, runId, runAttempt }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository ?? ""))) throw new Error("GITHUB_REPOSITORY_INVALID");
  const normalizedEvent = safeEventName(event);
  if (!normalizedEvent) throw new Error("GITHUB_EVENT_UNSUPPORTED");
  return `nusa-bridge:${repository}:${normalizedEvent}:${safeRunPart(runId, "GITHUB_RUN_ID")}:${safeRunPart(runAttempt, "GITHUB_RUN_ATTEMPT")}`;
}

export function createGithubSignature(secret, body) {
  if (typeof secret !== "string" || secret.trim().length === 0) throw new Error("WEBHOOK_SECRET_REQUIRED");
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function responseClass(status) {
  if (status >= 200 && status < 300) return "SUCCESS";
  if (status === 401 || status === 403) return "AUTH_REJECTED";
  if (TRANSIENT_STATUSES.has(status)) return "TRANSIENT_FAILURE";
  return "PERMANENT_FAILURE";
}

async function responseSafety(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("WEBHOOK_RESPONSE_INVALID");
  }
  if (!payload || payload.accepted !== true) throw new Error("WEBHOOK_RESPONSE_NOT_ACCEPTED");
  if (payload.liveAuthority !== "NONE") throw new Error("WEBHOOK_RESPONSE_LIVE_AUTHORITY_INVALID");
  if (payload.productionMutationAllowed !== false) throw new Error("WEBHOOK_RESPONSE_PRODUCTION_MUTATION_INVALID");
  if (payload.aiAuthority !== "ZERO_AUTHORITY") throw new Error("WEBHOOK_RESPONSE_AI_AUTHORITY_INVALID");
  return payload;
}

export async function dispatchGithubEvent({
  secret,
  body,
  event,
  repository,
  runId,
  runAttempt,
  webhookUrl = DEFAULT_WEBHOOK_URL,
  fetchImpl = fetch,
  retryDelayMs = 200,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const normalizedEvent = safeEventName(event);
  if (!normalizedEvent) throw new Error("GITHUB_EVENT_UNSUPPORTED");
  if (!(body instanceof Uint8Array)) throw new Error("GITHUB_EVENT_BODY_INVALID");
  const deliveryId = createDeliveryId({ repository, event: normalizedEvent, runId, runAttempt });
  if (typeof secret !== "string" || secret.trim().length === 0) {
    return Object.freeze({ status: "INTERFACE_READY", event: normalizedEvent, deliveryId, attempts: 0, responseStatus: null });
  }
  if (typeof webhookUrl !== "string" || !/^https:\/\//.test(webhookUrl)) throw new Error("WEBHOOK_URL_INVALID");

  const signature = createGithubSignature(secret, body);
  let attempts = 0;
  let response;
  for (; attempts < MAX_ATTEMPTS; attempts += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": deliveryId,
          "x-github-event": normalizedEvent,
          "x-hub-signature-256": signature,
          "user-agent": "nusa-github-event-bridge",
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (attempts + 1 >= MAX_ATTEMPTS) throw new Error(error?.name === "AbortError" ? "WEBHOOK_REQUEST_TIMEOUT" : "WEBHOOK_REQUEST_FAILED");
      response = null;
    } finally {
      clearTimeout(timeout);
    }
    if (!response) {
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    const classification = responseClass(response.status);
    if (classification === "SUCCESS") {
      await responseSafety(response);
      return Object.freeze({ status: "DELIVERED", event: normalizedEvent, deliveryId, attempts: attempts + 1, responseStatus: response.status });
    }
    if (classification !== "TRANSIENT_FAILURE" || attempts + 1 >= MAX_ATTEMPTS) {
      throw new Error(`WEBHOOK_HTTP_${response.status}`);
    }
    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error("WEBHOOK_REQUEST_FAILED");
}

function summaryLine(result) {
  return [
    "## NUSA Autopilot GitHub Event Bridge",
    "",
    `- status: ${result.status}`,
    `- event: ${result.event}`,
    `- delivery: ${result.deliveryId}`,
    `- attempts: ${result.attempts}`,
    `- response: ${result.responseStatus ?? "none"}`,
    "- liveAuthority: NONE",
    "- productionMutationAllowed: false",
    "- AI authority: ZERO_AUTHORITY",
  ].join("\n");
}

function writeSummary(result) {
  const destination = process.env.GITHUB_STEP_SUMMARY;
  if (destination) fs.appendFileSync(destination, `${summaryLine(result)}\n`);
}

async function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  const bodyPath = process.env.GITHUB_EVENT_PATH;
  if (!bodyPath) throw new Error("GITHUB_EVENT_PATH_REQUIRED");
  const body = fs.readFileSync(bodyPath);
  const result = await dispatchGithubEvent({
    secret: process.env.NUSA_WEBHOOK_SECRET,
    body,
    event,
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    webhookUrl: process.env.NUSA_AUTOPILOT_WEBHOOK_URL || DEFAULT_WEBHOOK_URL,
  });
  writeSummary(result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    const safeError = error instanceof Error ? error.message : "WEBHOOK_BRIDGE_FAILED";
    console.error(JSON.stringify({ status: "FAILED_CLOSED", reason: safeError, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }));
    process.exitCode = 1;
  }
}
