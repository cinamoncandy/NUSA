import fs from "node:fs";

const payloadPath = process.argv[2];
if (!payloadPath) throw new Error("AUTOPILOT_PAYLOAD_PATH_REQUIRED");

const raw = fs.readFileSync(payloadPath, "utf8");
const payload = JSON.parse(raw);
const client = payload?.client_payload;
if (!client || typeof client !== "object") throw new Error("AUTOPILOT_CLIENT_PAYLOAD_REQUIRED");

const allowedKinds = new Set(["REPOSITORY_AUTOPILOT", "CI_RECOVERY"]);
if (!allowedKinds.has(client.kind)) throw new Error("AUTOPILOT_KIND_INVALID");
if (client.repository !== "cinamoncandy/NUSA") throw new Error("AUTOPILOT_REPOSITORY_NOT_ALLOWED");
if (typeof client.head_sha !== "string" || !/^[0-9a-f]{40}$/i.test(client.head_sha)) throw new Error("AUTOPILOT_HEAD_SHA_INVALID");
if (client.live_authority !== "NONE") throw new Error("AUTOPILOT_LIVE_AUTHORITY_INVALID");
if (client.production_mutation_allowed !== false) throw new Error("AUTOPILOT_PRODUCTION_MUTATION_INVALID");
if (client.ai_authority !== "ZERO_AUTHORITY") throw new Error("AUTOPILOT_AI_AUTHORITY_INVALID");
if (client.kind === "CI_RECOVERY" && (!Number.isSafeInteger(client.workflow_run_id) || client.workflow_run_id <= 0)) {
  throw new Error("AUTOPILOT_WORKFLOW_RUN_ID_REQUIRED");
}

const receipt = Object.freeze({
  schemaVersion: 1,
  accepted: true,
  kind: client.kind,
  repository: client.repository,
  headSha: client.head_sha.toLowerCase(),
  workflowRunId: client.workflow_run_id ?? null,
  reason: typeof client.reason === "string" ? client.reason : null,
  executionAuthority: "REPOSITORY_WORKFLOW_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

fs.mkdirSync("artifacts/autopilot", { recursive: true });
fs.writeFileSync("artifacts/autopilot/dispatch-receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
