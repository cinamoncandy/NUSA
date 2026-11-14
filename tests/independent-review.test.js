"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");
const { check, render, MAX_TOTAL, MAX_LINE, MAX_LINES } = require("../scripts/independent-review-sanitize.js");
const { callReview, extractText, ENDPOINT, MAX_PROMPT_BYTES, MAX_OUTPUT_TOKENS } = require("../scripts/independent-review-call.js");

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
  assert.deepEqual(workflow.jobs.review.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs.post.permissions, { contents: "read", "pull-requests": "write" });
});

test("workflow: every job runs on a GitHub-hosted runner, with no Codex, no self-hosted runner and no host guard", () => {
  for (const job of Object.values(workflow.jobs)) assert.equal(job["runs-on"], "ubuntu-latest");
  assert.doesNotMatch(workflowText, /self-hosted|nusa-codex|codex|host-guard|\.codex/i);
});

test("workflow: the API key is used in exactly one step of one job, only as that step's environment, and is never echoed", () => {
  const usesOfSecrets = [];
  for (const [jobName, job] of Object.entries(workflow.jobs)) for (const step of job.steps) if (yaml.dump(step).includes("secrets.")) usesOfSecrets.push(`${jobName}:${step.name}`);
  assert.deepEqual(usesOfSecrets, ["review:Call the reviewer and check its text"]);
  const step = workflow.jobs.review.steps.find((candidate) => candidate.id === "run");
  assert.equal(step.env.NUSA_REVIEW_API_KEY, "${{ secrets.NUSA_REVIEW_API_KEY }}");
  assert.doesNotMatch(step.run, /NUSA_REVIEW_API_KEY|set -x|xtrace|printenv|\benv\b|\bset\b -[a-z]*x/);
  assert.doesNotMatch(workflowText, /secrets\.(?!NUSA_REVIEW_API_KEY)/);
  assert.match(workflowText, /node scripts\/independent-review-call\.js review-in\/prompt\.txt review-raw\.txt/);
});

test("workflow: no review event, no merge, no un-draft, no issue creation", () => {
  assert.doesNotMatch(workflowText, /gh pr (review|merge|ready|edit|close)|\/reviews|\bAPPROVE\b|REQUEST_CHANGES|auto_merge|ready_for_review|convert_to_draft|--admin|gh issue/);
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

test("workflow: the raw model text is deleted and never uploaded or printed; only the checked file is uploaded", () => {
  const uploads = workflow.jobs.review.steps.filter((step) => String(step.uses || "").startsWith("actions/upload-artifact"));
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].with.path, /review-out\/checked\.txt$/);
  const run = workflow.jobs.review.steps.find((step) => step.id === "run").run;
  assert.doesNotMatch(run, /cat review-raw|cat "review-raw|tee /);
  assert.match(run, /rm -f review-raw\.txt/);
});

test("workflow: the post job checks again with the trusted script from main and posts only the rendered fenced text", () => {
  const text = yaml.dump(workflow.jobs.post);
  assert.match(text, /ref: main/);
  assert.match(text, /scripts\/independent-review-sanitize\.js render "\$HEAD_SHA" review-out\/checked\.txt rendered\.md/);
  assert.match(text, /cat rendered\.md/);
  assert.doesNotMatch(text, /cat review-out|cat "review-out/);
  assert.match(workflowText, /nusa-independent-review sha=\$HEAD_SHA/);
  assert.match(workflowText, /not an Audit or Release approval/);
  assert.match(workflowText, /STALE: the PR head is now/);
});

test("checker: a well-formed review is accepted and rendered in a five-backtick fence", () => {
  const result = check(good(), H);
  assert.equal(result.ok, true);
  assert.equal(result.text, good());
  const md = render(good(), H);
  assert.equal(md.ok, true);
  assert.equal(md.text, `\`\`\`\`\`text\n${good()}\`\`\`\`\`\n`);
});

test("checker: ACCEPT, REJECT, CRLF and Korean text follow the same grammar", () => {
  assert.equal(check(`VERDICT: ACCEPT\nHEAD: ${H}\nNOTE: nothing found.\n${scope}\n`, H).ok, true);
  assert.equal(check(`VERDICT: REJECT\nHEAD: ${H}\nP1: apps/x.ts:5 a gate is loosened.\n${scope}\n`, H).ok, true);
  assert.equal(check(good().replace(/\n/g, "\r\n"), H).ok, true);
  assert.equal(check(good("P2: 문서 docs/a.md:73 의 표현이 부정확합니다."), H).ok, true);
});

test("checker: free lines, backticks, angle brackets, control and bidirectional characters reject the whole output", () => {
  for (const [text, code] of [
    [`Sure, here you go.\n${good()}`, "VERDICT_LINE"],
    [good("some free text line"), "LINE_GRAMMAR"],
    [good("P2: has `backticks`"), "FORBIDDEN_CHAR"],
    [good("P2: has ```fence"), "FORBIDDEN_CHAR"],
    [good("P2: has <img src=x>"), "FORBIDDEN_CHAR"],
    [good("P2: has \u0007 bell"), "FORBIDDEN_CHAR"],
    [good("P2: has \u202e reversed"), "FORBIDDEN_CHAR"],
    [good("P2: has \u2028 separator"), "LINE_GRAMMAR"],
    ["", "EMPTY"],
    [`VERDICT: MAYBE\nHEAD: ${H}\n${scope}\n`, "VERDICT_LINE"],
    [`VERDICT: ACCEPT\nHEAD: ${H}\n`, "LINE_COUNT"],
  ]) assert.equal(check(text, H).reason, code, text.slice(0, 70));
});

test("checker: the head must match and the verdict must agree with the findings", () => {
  assert.equal(check(good(), "b".repeat(40)).reason, "HEAD_MISMATCH");
  assert.equal(check(`VERDICT: ACCEPT\nP2: x\n${scope}\n`, H).reason, "HEAD_LINE");
  assert.equal(check(good(), "not-a-sha").reason, "BAD_EXPECTED_HEAD");
  assert.equal(check(`VERDICT: REJECT\nHEAD: ${H}\nP2: only a p2.\n${scope}\n`, H).reason, "VERDICT_WITHOUT_BLOCKER");
  assert.equal(check(`VERDICT: ACCEPT\nHEAD: ${H}\nP1: blocker.\n${scope}\n`, H).reason, "BLOCKER_WITHOUT_REJECT");
  assert.equal(check(`VERDICT: ACCEPT WITH P2\nHEAD: ${H}\nNOTE: none.\n${scope}\n`, H).reason, "P2_VERDICT_WITHOUT_P2");
  assert.equal(check(`VERDICT: ACCEPT\nHEAD: ${H}\nP2: a finding.\n${scope}\n`, H).reason, "ACCEPT_WITH_FINDINGS");
  assert.equal(check(`VERDICT: ACCEPT\nHEAD: ${H}\nNOTE: ok.\n`, H).reason, "SCOPE_MISSING");
});

test("checker: size limits reject", () => {
  assert.equal(check(good(`P2: ${"x".repeat(MAX_LINE + 1)}`), H).reason, "LINE_LENGTH");
  assert.equal(check(`VERDICT: ACCEPT\nHEAD: ${H}\n${Array(MAX_LINES).fill("NOTE: a.").join("\n")}\n${scope}\n`, H).reason, "LINE_COUNT");
  assert.equal(check("x".repeat(MAX_TOTAL + 1), H).reason, "TOO_LONG");
});

test("checker: render re-checks its input, so an unchecked file cannot reach the comment", () => {
  assert.equal(render(`${good()}<script>`, H).reason, "LINE_GRAMMAR");
  assert.equal(render(good("P2: x `y`"), H).reason, "FORBIDDEN_CHAR");
  assert.equal(render(good(), "c".repeat(40)).reason, "HEAD_MISMATCH");
});

test("checker command line: writes the checked text or one fixed line, exit 0 or 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-review-san-"));
  const script = path.join(root, "scripts", "independent-review-sanitize.js");
  fs.writeFileSync(path.join(dir, "ok.txt"), good());
  fs.writeFileSync(path.join(dir, "bad.txt"), good("P2: has `x`"));
  const run = (...args) => spawnSync(process.execPath, [script, ...args]);
  assert.equal(run("check", H, path.join(dir, "ok.txt"), path.join(dir, "c.txt")).status, 0);
  assert.equal(fs.readFileSync(path.join(dir, "c.txt"), "utf8"), good());
  assert.equal(run("render", H, path.join(dir, "c.txt"), path.join(dir, "r.md")).status, 0);
  assert.match(fs.readFileSync(path.join(dir, "r.md"), "utf8"), /^`````text\n/);
  assert.equal(run("check", H, path.join(dir, "bad.txt"), path.join(dir, "b.txt")).status, 2);
  assert.equal(fs.readFileSync(path.join(dir, "b.txt"), "utf8"), "REVIEW_OUTPUT_REJECTED reason=FORBIDDEN_CHAR\n");
  assert.equal(run("check", H, path.join(dir, "none.txt"), path.join(dir, "n.txt")).status, 2);
  assert.equal(run("nope", H, path.join(dir, "ok.txt"), path.join(dir, "m.txt")).status, 2);
  assert.equal(fs.readFileSync(path.join(dir, "m.txt"), "utf8"), "REVIEW_OUTPUT_REJECTED reason=BAD_MODE\n");
});

const KEY = "test-key-should-never-leak-0123456789";
const okResponse = (text) => ({ ok: true, status: 200, json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }) });

test("API call: one POST to the fixed endpoint, the key only in the Authorization header, no tools and nothing stored", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return okResponse("VERDICT: ACCEPT"); };
  const result = await callReview({ apiKey: KEY, model: "some-model-1", prompt: "PROMPT TEXT", fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.text, "VERDICT: ACCEPT");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(ENDPOINT, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ["input", "max_output_tokens", "model", "store"]);
  assert.equal(body.store, false);
  assert.equal(body.input, "PROMPT TEXT");
  assert.equal(body.max_output_tokens, MAX_OUTPUT_TOKENS);
  assert.doesNotMatch(calls[0].init.body, new RegExp(KEY));
  for (const forbidden of ["tools", "tool_choice", "previous_response_id", "stream", "background"]) assert.equal(forbidden in body, false, forbidden);
});

test("API call: every failure gives a short code and none of them contains the key", async () => {
  const cases = [
    [{ apiKey: "", model: "m", prompt: "p" }, "NO_API_KEY"],
    [{ apiKey: KEY, model: "", prompt: "p" }, "NO_MODEL"],
    [{ apiKey: KEY, model: "bad model; rm", prompt: "p" }, "BAD_MODEL"],
    [{ apiKey: KEY, model: "m", prompt: "x".repeat(MAX_PROMPT_BYTES + 1) }, "PROMPT_TOO_LARGE"],
    [{ apiKey: KEY, model: "m", prompt: "p", fetchImpl: async () => { throw new Error(`boom ${KEY}`); } }, "NETWORK"],
    [{ apiKey: KEY, model: "m", prompt: "p", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: KEY }) }) }, "HTTP_401"],
    [{ apiKey: KEY, model: "m", prompt: "p", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ output: [] }) }) }, "NO_TEXT"],
    [{ apiKey: KEY, model: "m", prompt: "p", fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }) }, "NO_TEXT"],
  ];
  for (const [input, reason] of cases) {
    const result = await callReview(input);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
  }
});

test("API call: only message output text is read, tool items and other content types are ignored", () => {
  assert.equal(extractText({ output: [{ type: "reasoning", content: [{ type: "output_text", text: "hidden" }] }, { type: "message", content: [{ type: "output_text", text: "A" }, { type: "refusal", text: "R" }, { type: "output_text", text: "B" }] }] }), "A\nB");
  assert.equal(extractText(null), "");
  assert.equal(extractText({ output: "x" }), "");
});

test("API call command line: with no key it makes no request, writes an empty file, prints one code and exits 3", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-review-call-"));
  fs.writeFileSync(path.join(dir, "prompt.txt"), "prompt");
  const env = { ...process.env };
  delete env.NUSA_REVIEW_API_KEY; delete env.NUSA_REVIEW_MODEL;
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "independent-review-call.js"), path.join(dir, "prompt.txt"), path.join(dir, "out.txt")], { env, encoding: "utf8" });
  assert.equal(run.status, 3);
  assert.equal(run.stdout, "NO_API_KEY\n");
  assert.equal(fs.readFileSync(path.join(dir, "out.txt"), "utf8"), "");
});
