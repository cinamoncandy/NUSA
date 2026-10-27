import assert from "node:assert/strict";
import test from "node:test";
import { executeIndependentValidator, validateValidatorModelVerdict, validateValidatorRunnerRequest, type ValidatorRunnerRequest } from "./auditRunner";

const request: ValidatorRunnerRequest = Object.freeze({
  kind: "VALIDATOR_REQUEST", repository: "cinamoncandy/NUSA", prNumber: 2760, headSha: "a".repeat(40), baseSha: "b".repeat(40),
  workflowRunId: 123, executionId: "validator:test", dedupeKey: "validator:dedupe", mutationAllowed: false,
  liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY",
});

test("fresh VALIDATOR request is exact-head and zero-authority bound", () => {
  assert.deepEqual(validateValidatorRunnerRequest(request), request);
  assert.throws(() => validateValidatorRunnerRequest({ ...request, kind: "AUDIT_REQUEST" }), /VALIDATOR_RUNNER_KIND_INVALID/);
  assert.throws(() => validateValidatorRunnerRequest({ ...request, mutationAllowed: true }), /VALIDATOR_RUNNER_MUTATION_FORBIDDEN/);
  assert.throws(() => validateValidatorRunnerRequest({ ...request, headSha: "short" }), /VALIDATOR_RUNNER_HEAD_SHA_INVALID/);
});

test("VALIDATOR permits PASS or P2-only notes and classifies P0/P1 as blockers", () => {
  assert.equal(validateValidatorModelVerdict({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }).verdict, "PASS");
  assert.equal(validateValidatorModelVerdict({
    verdict: "PASS_WITH_NOTES", findings: [{ code: "P2_METADATA_NOTE", severity: "NOTE", message: "note", evidenceRef: null }],
    blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true,
  }).verdict, "PASS_WITH_NOTES");
  assert.equal(validateValidatorModelVerdict({
    verdict: "FAIL", findings: [{ code: "P1_RELEASE_BYPASS", severity: "BLOCKER", message: "bypass", evidenceRef: "x:+1" }],
    blockers: ["release bypass"], safetyInvariantResult: "FAIL", mergeAllowed: false,
  }).verdict, "FAIL");
});

test("VALIDATOR rejects missing priority prefixes and severity downgrades", () => {
  assert.throws(() => validateValidatorModelVerdict({
    verdict: "PASS_WITH_NOTES", findings: [{ code: "NOTE_ONLY", severity: "NOTE", message: "note", evidenceRef: null }], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true,
  }), /VALIDATOR_FINDING_PRIORITY_PREFIX_INVALID/);
  assert.throws(() => validateValidatorModelVerdict({
    verdict: "PASS_WITH_NOTES", findings: [{ code: "P1_BLOCKER_AS_NOTE", severity: "NOTE", message: "bad", evidenceRef: null }], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true,
  }), /VALIDATOR_BLOCKING_PRIORITY_SEVERITY_INVALID/);
  assert.throws(() => validateValidatorModelVerdict({
    verdict: "FAIL", findings: [{ code: "P2_NOTE_AS_BLOCKER", severity: "BLOCKER", message: "bad", evidenceRef: "x:+1" }], blockers: ["bad"], safetyInvariantResult: "FAIL", mergeAllowed: false,
  }), /VALIDATOR_NONBLOCKING_PRIORITY_SEVERITY_INVALID/);
});

const githubResponse = (status: number, payload: unknown, textValue?: string) => ({
  ok: status >= 200 && status < 300, status,
  async json() { return payload; },
  async text() { return textValue ?? JSON.stringify(payload); },
});

function validatorGithubFetch(options: { staleSecondPull?: boolean; unsafeImport?: boolean; aliasImport?: boolean; deletedSource?: boolean; mobileManifest?: boolean; directoryImport?: boolean; staticImports?: boolean; truncatedTree?: boolean; commonJs?: boolean; bareBuiltin?: boolean; changedJson?: boolean } = {}) {
  let pullReads = 0;
  const sourcePath = options.mobileManifest ? "apps/mobile/a.ts" : "a.ts";
  const diff = options.deletedSource
    ? "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-import { helper } from './helper';\n-helper();\n"
    : options.changedJson
      ? 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-import { old } from "./config.json";\n+import { feature } from "./config.json";\ndiff --git a/config.json b/config.json\n--- a/config.json\n+++ b/config.json\n@@ -1 +1 @@\n-{"old":true}\n+{"feature":true,"unchangedRequiredKey":"retained"}\n'
    : options.staticImports
      ? `diff --git a/${sourcePath} b/${sourcePath}\n--- a/${sourcePath}\n+++ b/${sourcePath}\n@@ -0,0 +1,3 @@\n+import "./register";\n+export * from "./guard";\n+helper();\n`
    : options.mobileManifest
      ? `diff --git a/${sourcePath} b/${sourcePath}\n--- a/${sourcePath}\n+++ b/${sourcePath}\n@@ -1,2 +1,2 @@\n import React from "react";\n-React.createElement("div");\n+React.createElement("span");\n`
    : "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+helper();\n";
  const protocol = "# NUSA /grill-me protocol\n" + "adversarial exact-head fail-closed independent validation. ".repeat(8);
  const blobPaths = ["package.json", ...(options.mobileManifest ? ["apps/mobile/package.json", sourcePath] : options.deletedSource ? [] : [sourcePath]), ...(options.directoryImport ? ["helper/index.ts"] : ["helper.ts"]), ...(options.staticImports ? ["register.ts", "guard.ts"] : []), ...(options.commonJs ? ["security-gate.js"] : []), ...(options.changedJson ? ["config.json"] : [])];
  const baseBlobPaths = options.deletedSource ? ["package.json", "a.ts", "helper.ts"] : ["package.json"];
  return (async (input: string) => {
    const url = String(input);
    if (url.includes(`/git/commits/${request.headSha}`)) return githubResponse(200, { tree: { sha: "d".repeat(40) } });
    if (url.includes(`/git/commits/${request.baseSha}`)) return githubResponse(200, { tree: { sha: "e".repeat(40) } });
    if (url.includes(`/git/trees/${"d".repeat(40)}?recursive=1`)) return githubResponse(200, { truncated: options.truncatedTree ?? false, tree: [...blobPaths.map((path) => ({ path, type: "blob" })), ...(options.directoryImport ? [{ path: "helper", type: "tree" }] : [])] });
    if (url.includes(`/git/trees/${"e".repeat(40)}?recursive=1`)) return githubResponse(200, { truncated: false, tree: baseBlobPaths.map((path) => ({ path, type: "blob" })) });
    if (url.includes(`/pulls/${request.prNumber}/files?`)) return githubResponse(200, options.changedJson ? [{ filename: "a.ts", status: "modified" }, { filename: "config.json", status: "modified" }] : [{ filename: options.mobileManifest ? sourcePath : "a.ts", status: options.deletedSource ? "removed" : "modified" }]);
    if (url.includes(`/pulls/${request.prNumber}`)) {
      pullReads += 1;
      return githubResponse(200, { state: "open", changed_files: options.changedJson ? 2 : 1, head: { sha: options.staleSecondPull && pullReads > 1 ? "c".repeat(40) : request.headSha, repo: { full_name: request.repository } }, base: { sha: request.baseSha, repo: { full_name: request.repository } } });
    }
    if (url.includes(`/actions/runs/${request.workflowRunId}`)) return githubResponse(200, { id: request.workflowRunId, name: "CI", event: "pull_request", status: "completed", conclusion: "success", head_sha: request.headSha, repository: { full_name: request.repository }, pull_requests: [{ number: request.prNumber }] });
    if (url.includes(`/compare/${request.baseSha}...${request.headSha}`)) return githubResponse(200, {}, diff);
    if (url.includes("/contents/docs/GRILL_ME_PROTOCOL.md?ref=")) return githubResponse(200, {}, protocol);
    if (url.includes(`/contents/package.json?ref=${request.headSha}`)) return githubResponse(200, {}, "{}\n");
    if (url.includes(`/contents/apps/mobile/package.json?ref=${request.headSha}`)) return githubResponse(200, {}, '{"dependencies":{"react":"^19.0.0"}}\n');
    if (options.deletedSource && url.includes(`/contents/a.ts?ref=${request.headSha}`)) return githubResponse(404, {});
    if (options.deletedSource && url.includes(`/contents/a.ts?ref=${request.baseSha}`)) return githubResponse(200, {}, "import { helper } from './helper';\nhelper();\n");
    if (options.deletedSource && url.includes(`/contents/helper.ts?ref=${request.baseSha}`)) return githubResponse(200, {}, 'export function helper() { return "base-helper"; }\n');
    if (options.changedJson && url.includes(`/contents/a.ts?ref=${request.headSha}`)) return githubResponse(200, {}, 'import { feature } from "./config.json";\nfeature();\n');
    if (options.changedJson && url.includes(`/contents/config.json?ref=${request.headSha}`)) return githubResponse(200, {}, '{"feature":true,"unchangedRequiredKey":"retained"}\n');
    if (url.includes(`/contents/${sourcePath}?ref=${request.headSha}`)) return githubResponse(200, {}, options.mobileManifest ? 'import React from "react";\nReact.createElement("span");' : options.unsafeImport ? 'import { helper } from "../../../escape";\nhelper();' : options.aliasImport ? 'import { helper } from "@/helper";\nhelper();' : options.staticImports ? 'import "./register";\nexport * from "./guard";\nhelper();' : options.commonJs ? 'const { scanText } = require("./security-gate.js");\nscanText();' : options.bareBuiltin ? 'const fs = require("fs");\nfs.readFileSync("x");' : 'import { helper } from "./helper";\nfunction unchangedHelper() { return "unchanged-source-definition"; }\nhelper();');
    if (url.includes(`/contents/helper.ts?ref=${request.headSha}`)) return githubResponse(200, {}, "export function helper() { return true; }\n");
    if (url.includes(`/contents/helper/index.ts?ref=${request.headSha}`)) return githubResponse(200, {}, 'export function helper() { return "directory-index"; }\n');
    if (url.includes(`/contents/register.ts?ref=${request.headSha}`)) return githubResponse(200, {}, 'registerSideEffect("canonical");\n');
    if (url.includes(`/contents/guard.ts?ref=${request.headSha}`)) return githubResponse(200, {}, 'export const guard = "canonical";\n');
    if (options.commonJs && url.includes(`/contents/security-gate.js?ref=${request.headSha}`)) return githubResponse(200, {}, 'exports.scanText = (text) => text.length;\n');
    if (url.includes(`/contents/helper?ref=${request.headSha}`) || url.includes(`/contents/helper/`)) return githubResponse(404, {});
    if (url.includes(`/contents/helper.`)) return githubResponse(404, {});
    throw new Error(`unexpected fetch ${url}`);
  }) as never;
}

test("fresh VALIDATOR independently reviews exact head using protected-base grill protocol", async () => {
  let prompt = "";
  const AI = { async run(_model: string, input: { prompt?: string }) { prompt = String(input.prompt || ""); return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch(), () => 999);
  assert.equal(result.status, "VALIDATOR_COMPLETED");
  assert.equal(result.auditAllowed, true);
  assert.equal(result.p0, 0);
  assert.equal(result.p1, 0);
  assert.equal(result.p2, 0);
  assert.equal(result.reviewedHeadSha, request.headSha);
  assert.equal(result.reviewedAt, 999);
  assert.match(prompt, /TRUSTED PROTECTED-BASE GRILL_ME_PROTOCOL/);
  assert.match(prompt, /NUSA \/grill-me protocol/);
  assert.match(prompt, /BEGIN BOUNDED EXACT-HEAD DEPENDENCY CONTEXT/);
  assert.match(prompt, /helper.ts @ a{40}/);
  assert.match(prompt, /export function helper\(\)/);
  assert.match(prompt, /BEGIN CHANGED SOURCE a\.ts @ HEAD a{40}/);
  assert.match(prompt, /unchanged-source-definition/);
  assert.ok(result.evidenceRefs.includes(`github:dependency/helper.ts@${request.headSha}`));
});

test("fresh VALIDATOR fails closed on a changed source import that escapes the repository", async () => {
  let aiCalled = false;
  const AI = { async run() { aiCalled = true; return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  await assert.rejects(executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ unsafeImport: true })), /VALIDATOR_DEPENDENCY_PATH_ESCAPE/);
  assert.equal(aiCalled, false);
});

test("fresh VALIDATOR fails closed when a changed line uses an unresolved repository alias", async () => {
  let aiCalled = false;
  const AI = { async run() { aiCalled = true; return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  await assert.rejects(executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ aliasImport: true })), /VALIDATOR_DEPENDENCY_IMPORT_UNCLASSIFIED/);
  assert.equal(aiCalled, false);
});

test("fresh VALIDATOR classifies dependencies from deterministic source workspace manifests", async () => {
  let prompt = "";
  const AI = { async run(_model: string, input: { prompt?: string }) { prompt = String(input.prompt || ""); return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ mobileManifest: true }), () => 1);
  assert.equal(result.verdict, "PASS");
  assert.match(prompt, /BEGIN CHANGED SOURCE apps\/mobile\/a\.ts/);
  assert.match(prompt, /React\.createElement\("span"\)/);
  assert.ok(result.evidenceRefs.includes(`github:dependency-manifest/apps/mobile/package.json@${request.headSha}`));
});

test("fresh VALIDATOR resolves a directory import to a bounded index file, never a listing", async () => {
  let prompt = "";
  const AI = { async run(_model: string, input: { prompt?: string }) { prompt = String(input.prompt || ""); return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ directoryImport: true }), () => 1);
  assert.equal(result.verdict, "PASS");
  assert.match(prompt, /EXACT-HEAD DEPENDENCY helper\/index\.ts/);
  assert.match(prompt, /directory-index/);
  assert.ok(result.evidenceRefs.includes(`github:dependency/helper/index.ts@${request.headSha}`));
});

test("fresh VALIDATOR includes full changed source and resolves side-effect and star imports", async () => {
  let prompt = "";
  const AI = { async run(_model: string, input: { prompt?: string }) { prompt = String(input.prompt || ""); return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ staticImports: true }), () => 1);
  assert.equal(result.verdict, "PASS");
  assert.match(prompt, /BEGIN CHANGED SOURCE a\.ts/);
  assert.match(prompt, /BEGIN EXACT-HEAD DEPENDENCY register\.ts/);
  assert.match(prompt, /registerSideEffect\("canonical"\)/);
  assert.match(prompt, /BEGIN EXACT-HEAD DEPENDENCY guard\.ts/);
  assert.match(prompt, /export const guard = "canonical"/);
  assert.ok(result.evidenceRefs.includes(`github:dependency/register.ts@${request.headSha}`));
  assert.ok(result.evidenceRefs.includes(`github:dependency/guard.ts@${request.headSha}`));
});

test("fresh VALIDATOR includes static CommonJS dependencies even when their bindings are destructured", async () => {
  let prompt = "";
  const AI = { async run(_model: string, input: { prompt?: string }) { prompt = String(input.prompt || ""); return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ commonJs: true }), () => 1);
  assert.equal(result.verdict, "PASS");
  assert.match(prompt, /EXACT-HEAD DEPENDENCY security-gate\.js/);
  assert.match(prompt, /exports\.scanText/);
  assert.ok(result.evidenceRefs.includes(`github:dependency/security-gate.js@${request.headSha}`));
});

test("fresh VALIDATOR recognizes bare Node built-ins without treating them as packages", async () => {
  let aiCalled = false;
  const AI = { async run() { aiCalled = true; return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ bareBuiltin: true }), () => 1);
  assert.equal(result.verdict, "PASS");
  assert.equal(aiCalled, true);
});

test("fresh VALIDATOR includes complete changed JSON modules referenced by changed source", async () => {
  let prompt = "";
  const AI = { async run(_model: string, input: { prompt?: string }) { prompt = String(input.prompt || ""); return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ changedJson: true }), () => 1);
  assert.equal(result.verdict, "PASS");
  assert.match(prompt, /EXACT-HEAD DEPENDENCY config\.json/);
  assert.match(prompt, /unchangedRequiredKey/);
  assert.ok(result.evidenceRefs.includes(`github:dependency/config.json@${request.headSha}`));
});

test("fresh VALIDATOR fails closed when the exact-head Git tree is truncated", async () => {
  let aiCalled = false;
  const AI = { async run() { aiCalled = true; return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  await assert.rejects(executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ truncatedTree: true })), /VALIDATOR_TREE_INCOMPLETE/);
  assert.equal(aiCalled, false);
});

test("fresh VALIDATOR inspects deleted changed source at the exact PR base", async () => {
  let prompt = "";
  const AI = { async run(_model: string, input: { prompt?: string }) { prompt = String(input.prompt || ""); return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ deletedSource: true }), () => 999);
  assert.equal(result.status, "VALIDATOR_COMPLETED");
  assert.match(prompt, /DELETED SOURCE a\.ts @ BASE b{40}/);
  assert.match(prompt, /import \{ helper \} from '\.\/helper'/);
  assert.ok(result.evidenceRefs.includes(`github:deleted-source/a.ts@${request.baseSha}`));
  assert.match(prompt, /EXACT-HEAD DEPENDENCY helper\.ts @ b{40}/);
  assert.match(prompt, /base-helper/);
  assert.ok(result.evidenceRefs.includes(`github:tree/${request.baseSha}`));
  assert.ok(result.evidenceRefs.includes(`github:dependency/helper.ts@${request.baseSha}`));
});

test("fresh VALIDATOR fails if the exact head changes during review", async () => {
  const AI = { async run() { return { response: JSON.stringify({ verdict: "PASS", findings: [], blockers: [], safetyInvariantResult: "PASS", mergeAllowed: true }) }; } };
  await assert.rejects(executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch({ staleSecondPull: true })), /AUDIT_PR_HEAD_MISMATCH|VALIDATOR_VERIFIED_HEAD_MISMATCH/);
});

test("P1 blocker never advances to Audit", async () => {
  const AI = { async run() { return { response: JSON.stringify({ verdict: "FAIL", findings: [{ code: "P1_RELEASE_BYPASS", severity: "BLOCKER", message: "bypass", evidenceRef: "a.ts:+1" }], blockers: ["release bypass"], safetyInvariantResult: "FAIL", mergeAllowed: false }) }; } };
  const result = await executeIndependentValidator(request, { AI, NUSA_AUDIT_GITHUB_TOKEN: "github-token" }, validatorGithubFetch());
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.auditAllowed, false);
  assert.equal(result.p1, 1);
});
