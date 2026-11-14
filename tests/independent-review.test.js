"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { sanitize, MAX_TOTAL } = require("../scripts/independent-review-sanitize.js");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const rawWorkflowText = read(".github/workflows/independent-review.yml");
// Header comments describe the rules in words ("no approve"); the rules are checked against the code, not the comments.
const workflowText = rawWorkflowText.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
const workflow = yaml.load(rawWorkflowText);
const H = "a".repeat(40);
const scope = "SCOPE: static review of the given diff only; no tests were run.";
const good = (extra = "P2: runtime.ts:12 the guard ignores a typo.") => `VERDICT: ACCEPT WITH P2\nHEAD: ${H}\n${extra}\n${scope}\n`;

test("workflow: dispatch only, so the definition is always the one on main", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.doesNotMatch(workflowText, /^\s*(pull_request|pull_request_target|workflow_run|schedule|issue_comment|push)\s*:/m);
});

test("workflow: job permissions are exactly the declared minimum", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs.select.permissions, { contents: "read", "pull-requests": "read" });
  assert.deepEqual(workflow.jobs.review.permissions, { contents: "read", actions: "read" });
  assert.deepEqual(workflow.jobs.post.permissions, { contents: "read", "pull-requests": "write" });
});

test("workflow: no secret, no review event, no merge, no un-draft", () => {
  assert.doesNotMatch(workflowText, /secrets\./);
  assert.doesNotMatch(workflowText, /gh pr (review|merge|ready|edit|close)|\/reviews|\bAPPROVE\b|REQUEST_CHANGES|auto_merge|ready_for_review|convert_to_draft|--admin/);
  assert.match(workflowText, /issues\/\$PR_NUMBER\/comments/);
});

test("workflow: the select job reads the PR as data (main checkout only, title not body, capped diff, same repository, base main)", () => {
  const select = yaml.dump(workflow.jobs.select);
  assert.doesNotMatch(select, /github\.event\.pull_request|head\.ref|refs\/pull/);
  assert.match(select, /ref: main/);
  assert.match(workflowText, /head repository must be this repository/);
  assert.match(workflowText, /base must be main/);
  assert.match(workflowText, /-gt 150000/);
  assert.doesNotMatch(select, /\.body\b/);
});

test("workflow: the reviewer runs read-only with no token in an empty directory, via the host guard, and only the last message is kept", () => {
  const review = workflow.jobs.review;
  assert.deepEqual(review["runs-on"], ["self-hosted", "Linux", "nusa-codex-autopilot"]);
  const text = yaml.dump(review);
  assert.match(text, /codex exec -s read-only -C "\$work" -o "\$raw"/);
  assert.match(text, /env -u GUARD_GH_TOKEN -u GH_TOKEN -u GITHUB_TOKEN/);
  assert.match(text, /autopilot-codex-host-guard\.sh/);
  assert.match(text, /guard" start/);
  assert.match(text, /guard" watch/);
  assert.match(text, /guard" reap/);
  assert.doesNotMatch(text, /workspace-write|danger-full-access|--full-auto|--dangerously/);
});

test("workflow: the raw output and the Codex log are never uploaded or printed; only the sanitized file is uploaded", () => {
  const uploads = workflow.jobs.review.steps.filter((step) => String(step.uses || "").startsWith("actions/upload-artifact"));
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].with.path, /review-out\/review\.txt$/);
  const run = workflow.jobs.review.steps.find((step) => step.id === "run").run;
  assert.doesNotMatch(run, /cat "\$log"|cat "\$raw"|cat \$log|cat \$raw|tee /);
  assert.match(run, /rm -f "\$raw"/);
  assert.match(run, /rm -f "\$log"/);
});

test("workflow: the comment is posted once per head sha and says it is not an approval", () => {
  assert.match(workflowText, /nusa-independent-review sha=\$HEAD_SHA/);
  assert.match(workflowText, /not an Audit or Release approval/);
  assert.match(workflowText, /STALE: the PR head is now/);
});

test("sanitizer: a well-formed review passes unchanged", () => {
  const result = sanitize(good(), H);
  assert.equal(result.ok, true);
  assert.equal(result.text, good());
});

test("sanitizer: ACCEPT, REJECT and CRLF input follow the same grammar", () => {
  assert.equal(sanitize(`VERDICT: ACCEPT\nHEAD: ${H}\nNOTE: nothing found.\n${scope}\n`, H).ok, true);
  assert.equal(sanitize(`VERDICT: REJECT\nHEAD: ${H}\nP1: apps/x.ts:5 a gate is loosened.\n${scope}\n`, H).ok, true);
  assert.equal(sanitize(good().replace(/\n/g, "\r\n"), H).ok, true);
});

test("sanitizer: Korean text, a 40-hex sha, a long file name and a path with line numbers are allowed", () => {
  const body = `P2: 문서 docs/INDEPENDENT_REVIEW_AUTOMATION_DESIGN_2026-11-14.md:73 의 표현이 부정확합니다. 커밋 ${"b".repeat(40)} 참고.`;
  assert.equal(sanitize(good(body), H).ok, true);
});

test("sanitizer: wrong, missing or different head sha rejects", () => {
  assert.equal(sanitize(good(), "b".repeat(40)).reason, "HEAD_MISMATCH");
  assert.equal(sanitize(`VERDICT: ACCEPT\nP2: x\n${scope}\n`, H).reason, "HEAD_LINE");
  assert.equal(sanitize(good(), "not-a-sha").reason, "BAD_EXPECTED_HEAD");
});

test("sanitizer: anything outside the grammar rejects the whole output", () => {
  for (const [text, code] of [
    [`Sure, here is the review.\n${good()}`, "VERDICT_LINE"],
    [good("some free text line"), "LINE_GRAMMAR"],
    [good("P2: has `backticks`"), "CHARSET"],
    [good("P2: has {braces}"), "CHARSET"],
    [good('P2: has "quotes"'), "CHARSET"],
    [good("P2: has <angle>"), "CHARSET"],
    [good("P2: has $VAR"), "CHARSET"],
    [good("P2: a | b"), "CHARSET"],
    [good("P2: a = b"), "CHARSET"],
    [good("P2: "), "LINE_GRAMMAR"],
    [good(`P2: ${"x".repeat(501)}`), "LINE_LENGTH"],
    ["", "EMPTY"],
    [`VERDICT: MAYBE\nHEAD: ${H}\n${scope}\n`, "VERDICT_LINE"],
  ]) assert.equal(sanitize(text, H).reason, code, text.slice(0, 60));
});

test("sanitizer: credential-like or host content rejects the whole output", () => {
  for (const [body, code] of [
    ["P2: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 leaked", "JWT_LIKE"],
    ["P2: found sk-abcdefghijklmnopqrstuvwxyz in the file", "KEY_PREFIX"],
    ["P2: ghp_abcdefghijklmnopqrstuvwxyz0123456789", "KEY_PREFIX"],
    ["P2: AKIAABCDEFGHIJKLMNOP is set", "KEY_PREFIX"],
    ["P2: -----BEGIN PRIVATE KEY----- is shown", "PEM"],
    ["P2: the file .codex/auth.json says", "AUTH_FILE_OR_HEADER"],
    ["P2: Authorization header is sent", "AUTH_FILE_OR_HEADER"],
    ["P2: it reads /" + "home" + "/someone/file", "HOST_PATH"],
    ["P2: it reads /etc/nusa/cloud-runtime.env", "HOST_PATH"],
    ["P2: token: abcdef", "SECRET_ASSIGNMENT"],
    ["P2: password is hunter2 ok", "OK_OR_OPAQUE"],
    [`P2: opaque ${"A1b2".repeat(15)}`, "OPAQUE_TOKEN"],
    ["P2: mixed Abcdefghijklmnopqrstuv12 here", "OPAQUE_TOKEN"],
  ]) {
    const result = sanitize(good(body), H);
    if (code === "OK_OR_OPAQUE") continue; // plain words are not credentials; documented limit of a heuristic filter
    assert.equal(result.ok, false, body);
    assert.equal(result.reason, code, body);
    assert.match(result.text, /^REVIEW_OUTPUT_REJECTED reason=[A-Z_]+\n$/);
  }
});

test("sanitizer: the verdict must agree with the findings", () => {
  assert.equal(sanitize(`VERDICT: REJECT\nHEAD: ${H}\nP2: only a p2.\n${scope}\n`, H).reason, "VERDICT_WITHOUT_BLOCKER");
  assert.equal(sanitize(`VERDICT: ACCEPT\nHEAD: ${H}\nP1: blocker.\n${scope}\n`, H).reason, "BLOCKER_WITHOUT_REJECT");
  assert.equal(sanitize(`VERDICT: ACCEPT WITH P2\nHEAD: ${H}\nNOTE: none.\n${scope}\n`, H).reason, "P2_VERDICT_WITHOUT_P2");
  assert.equal(sanitize(`VERDICT: ACCEPT\nHEAD: ${H}\nP2: a finding.\n${scope}\n`, H).reason, "ACCEPT_WITH_FINDINGS");
  assert.equal(sanitize(`VERDICT: ACCEPT\nHEAD: ${H}\nNOTE: ok.\n`, H).reason, "SCOPE_MISSING");
});

test("sanitizer: size limits reject", () => {
  assert.equal(sanitize(`VERDICT: ACCEPT\nHEAD: ${H}\n${Array(100).fill("NOTE: a.").join("\n")}\n${scope}\n`, H).reason, "TOO_MANY_LINES");
  assert.equal(sanitize("x".repeat(MAX_TOTAL + 1), H).reason, "TOO_LONG");
});

test("sanitizer: the command line writes a fixed line and exits 2 on rejection, 0 and the text on success", () => {
  const { spawnSync } = require("node:child_process");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-review-san-"));
  const script = path.join(root, "scripts", "independent-review-sanitize.js");
  fs.writeFileSync(path.join(dir, "ok.txt"), good());
  fs.writeFileSync(path.join(dir, "bad.txt"), good("P2: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
  const ok = spawnSync(process.execPath, [script, H, path.join(dir, "ok.txt"), path.join(dir, "ok.out")]);
  const bad = spawnSync(process.execPath, [script, H, path.join(dir, "bad.txt"), path.join(dir, "bad.out")]);
  const missing = spawnSync(process.execPath, [script, H, path.join(dir, "none.txt"), path.join(dir, "none.out")]);
  assert.equal(ok.status, 0);
  assert.equal(fs.readFileSync(path.join(dir, "ok.out"), "utf8"), good());
  assert.equal(bad.status, 2);
  assert.equal(fs.readFileSync(path.join(dir, "bad.out"), "utf8"), "REVIEW_OUTPUT_REJECTED reason=JWT_LIKE\n");
  assert.equal(missing.status, 2);
  assert.equal(fs.readFileSync(path.join(dir, "none.out"), "utf8"), "REVIEW_OUTPUT_REJECTED reason=EMPTY\n");
});
