import assert from "node:assert/strict";
import test from "node:test";
import { executeIndependentAudit, type AuditRunnerRequest } from "./auditRunner";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const request: AuditRunnerRequest = Object.freeze({
  kind: "AUDIT_REQUEST",
  repository: "cinamoncandy/NUSA",
  prNumber: 1437,
  headSha: HEAD,
  baseSha: BASE,
  workflowRunId: 33568450693,
  executionId: "audit:1437:33568450693",
  dedupeKey: `audit:1437:${HEAD}`,
  mutationAllowed: false,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

function response(status: number, payload: unknown, textValue?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return textValue ?? JSON.stringify(payload); },
  };
}

function fetchSequence() {
  const pull = {
    state: "open",
    changed_files: 1,
    head: { sha: HEAD, repo: { full_name: "cinamoncandy/NUSA" } },
    base: { sha: BASE, repo: { full_name: "cinamoncandy/NUSA" } },
  };
  const run = {
    id: request.workflowRunId,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: HEAD,
    repository: { full_name: "cinamoncandy/NUSA" },
    pull_requests: [{ number: request.prNumber }],
  };
  const queue = [
    response(200, pull),
    response(200, run),
    response(200, {}, "diff --git a/a.ts b/a.ts\n+const safe = true;\n"),
    response(200, pull),
    response(200, run),
  ];
  return async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  };
}

test("Workers AI response schema makes verdict invariants structurally expressible", async () => {
  let captured: Record<string, unknown> | undefined;
  const AI = {
    async run(_model: string, modelRequest: Record<string, unknown>) {
      captured = modelRequest;
      return { response: { verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS" } };
    },
  };

  const result = await executeIndependentAudit(
    request,
    { AI, NUSA_GITHUB_TOKEN: "github-token" },
    fetchSequence() as never,
  );
  assert.equal(result.verdict, "PASS");

  const responseFormat = captured?.response_format as {
    type?: unknown;
    json_schema?: { anyOf?: readonly Record<string, unknown>[] };
  } | undefined;
  assert.equal(responseFormat?.type, "json_schema");
  const variants = responseFormat?.json_schema?.anyOf;
  assert.equal(variants?.length, 3);

  const byVerdict = new Map<string, Record<string, unknown>>();
  for (const variant of variants ?? []) {
    const properties = variant.properties as Record<string, { enum?: readonly string[] }>;
    const verdict = properties.verdict?.enum?.[0];
    if (verdict) byVerdict.set(verdict, properties as Record<string, unknown>);
  }

  const pass = byVerdict.get("PASS") as Record<string, { maxItems?: number; enum?: readonly string[] }>;
  assert.equal(pass.findings.maxItems, 0);
  assert.equal(pass.blockers.maxItems, 0);
  assert.deepEqual(pass.safetyInvariantResult.enum, ["PASS"]);

  const notes = byVerdict.get("PASS_WITH_NOTES") as Record<string, {
    minItems?: number;
    maxItems?: number;
    items?: { properties?: { severity?: { enum?: readonly string[] } } };
  }>;
  assert.equal(notes.findings.minItems, 1);
  assert.equal(notes.blockers.maxItems, 0);
  assert.deepEqual(notes.findings.items?.properties?.severity?.enum, ["NOTE"]);

  const fail = byVerdict.get("FAIL") as Record<string, { minItems?: number }>;
  assert.equal(fail.blockers.minItems, 1);
});
