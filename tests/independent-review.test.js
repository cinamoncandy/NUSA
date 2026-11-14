"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { check, render, parseChangedFiles, CATEGORIES, MAX_TOTAL, MAX_FINDINGS } = require("../scripts/independent-review-sanitize.js");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const rawWorkflowText = read(".github/workflows/independent-review.yml");
// Header comments describe the rules in words ("no approve"); the rules are checked against the code, not the comments.
const workflowText = rawWorkflowText.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
const workflow = yaml.load(rawWorkflowText);
const H = "a".repeat(40);
const FILES = new Set(["apps/cloud/src/runtime.ts", "docs/INDEPENDENT_REVIEW_AUTOMATION_DESIGN_2026-11-14.md", ".github/workflows/x.yml"]);
const record = (verdict, findings, coverage = "FULL") => `VERDICT: ${verdict}\nHEAD: ${H}\nCOVERAGE: ${coverage}\n${findings.map((f) => `FINDING: ${f}`).join("\n")}${findings.length ? "\n" : ""}`;
const good = () => record("ACCEPT WITH P2", ["P2 DOC_INACCURACY docs/INDEPENDENT_REVIEW_AUTOMATION_DESIGN_2026-11-14.md"]);

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
  assert.match(uploads[0].with.path, /review-out\/reduced\.txt$/);
  const run = workflow.jobs.review.steps.find((step) => step.id === "run").run;
  assert.doesNotMatch(run, /cat "\$log"|cat "\$raw"|cat \$log|cat \$raw|tee /);
  assert.match(run, /rm -f "\$raw"/);
  assert.match(run, /rm -f "\$log"/);
});

test("workflow: the post job validates again with the trusted script from main and posts only rendered fixed text", () => {
  const post = workflow.jobs.post;
  const text = yaml.dump(post);
  assert.match(text, /ref: main/);
  assert.match(text, /scripts\/independent-review-sanitize\.js render "\$HEAD_SHA" review-in\/changed-files\.txt review-out\/reduced\.txt rendered\.md/);
  assert.match(text, /cat rendered\.md/);
  assert.doesNotMatch(text, /cat review-out|cat "review-out|review\.txt/);
  const review = yaml.dump(workflow.jobs.review);
  assert.match(review, /sanitizer" check "\$EXPECTED_HEAD"/);
  assert.match(review, /timeout 1500 codex exec/);
});

test("workflow: the changed-file list comes from the GitHub API in the select job and is bounded", () => {
  const select = yaml.dump(workflow.jobs.select);
  assert.match(select, /pulls\/\$PR_NUMBER\/files/);
  assert.match(select, /-gt 300/);
  assert.match(select, /changed-files\.txt/);
});

test("workflow: the comment is posted once per head sha and says it is not an approval", () => {
  assert.match(workflowText, /nusa-independent-review sha=\$HEAD_SHA/);
  assert.match(workflowText, /not an Audit or Release approval/);
  assert.match(workflowText, /STALE: the PR head is now/);
});

test("review record: a well-formed record is accepted, reduced and rendered from fixed sentences", () => {
  const result = check(good(), H, FILES);
  assert.equal(result.ok, true);
  assert.equal(result.text, good());
  const md = render(result.text, H, FILES);
  assert.equal(md.ok, true);
  assert.match(md.text, /Verdict: \*\*ACCEPT WITH P2\*\*/);
  assert.match(md.text, new RegExp(CATEGORIES.DOC_INACCURACY.replace(/[()]/g, "\\$&")));
  assert.match(md.text, /Details need the manual review\./);
});

test("review record: ACCEPT, REJECT, CRLF and a PARTIAL coverage flag follow the same grammar", () => {
  assert.equal(check(record("ACCEPT", []), H, FILES).ok, true);
  assert.equal(check(record("REJECT", ["P1 CORRECTNESS_BUG apps/cloud/src/runtime.ts"], "PARTIAL"), H, FILES).ok, true);
  assert.equal(check(good().replace(/\n/g, "\r\n"), H, FILES).ok, true);
});

test("review record: free text, line numbers, quotes or any extra line rejects the whole output", () => {
  for (const [text, code] of [
    [`Sure, here you go.\n${good()}`, "VERDICT_LINE"],
    [`${good()}Some explanation of the problem.\n`, "FINDING_GRAMMAR"],
    [record("REJECT", ["P1 CORRECTNESS_BUG apps/cloud/src/runtime.ts:120"]), "FINDING_GRAMMAR"],
    [record("REJECT", ["P1 CORRECTNESS_BUG apps/cloud/src/runtime.ts because it is wrong"]), "FINDING_GRAMMAR"],
    [record("REJECT", ["P1 CORRECTNESS_BUG apps/cloud/src/runtime.ts eyJhbGciOiJIUzI1NiJ9"]), "FINDING_GRAMMAR"],
    [record("REJECT", ["P1 NOTE apps/cloud/src/runtime.ts"]), "CATEGORY"],
    [record("REJECT", ["P3 CORRECTNESS_BUG apps/cloud/src/runtime.ts"]), "FINDING_GRAMMAR"],
    ["", "EMPTY"],
    [`VERDICT: MAYBE\nHEAD: ${H}\nCOVERAGE: FULL\n`, "VERDICT_LINE"],
    [`VERDICT: ACCEPT\nHEAD: ${H}\n`, "LINE_COUNT"],
    [`VERDICT: ACCEPT\nHEAD: ${H}\nCOVERAGE: MAYBE\n`, "COVERAGE_LINE"],
  ]) assert.equal(check(text, H, FILES).reason, code, text.slice(0, 70));
});

test("review record: a path outside the PR's changed files, an absolute path or a traversal rejects (host content cannot be named)", () => {
  for (const file of ["apps/cloud/src/other.ts", "/etc/passwd", "../../etc/passwd", "/home/runner/.codex/auth.json", "apps/cloud/src/runtime.ts/../../../x"]) {
    const result = check(record("REJECT", [`P1 SECURITY_EXPOSURE ${file}`]), H, FILES);
    assert.equal(result.ok, false, file);
    assert.match(result.text, /^REVIEW_OUTPUT_REJECTED reason=[A-Z_]+\n$/);
  }
});

test("review record: the head must match, the changed-file set must exist, the verdict must agree with the findings", () => {
  assert.equal(check(good(), "b".repeat(40), FILES).reason, "HEAD_MISMATCH");
  assert.equal(check(good(), "not-a-sha", FILES).reason, "BAD_EXPECTED_HEAD");
  assert.equal(check(good(), H, new Set()).reason, "NO_CHANGED_FILES");
  assert.equal(check(record("REJECT", ["P2 DOC_INACCURACY .github/workflows/x.yml"]), H, FILES).reason, "VERDICT_WITHOUT_BLOCKER");
  assert.equal(check(record("ACCEPT", ["P1 CORRECTNESS_BUG .github/workflows/x.yml"]), H, FILES).reason, "BLOCKER_WITHOUT_REJECT");
  assert.equal(check(record("ACCEPT WITH P2", []), H, FILES).reason, "P2_VERDICT_WITHOUT_P2");
  assert.equal(check(record("ACCEPT", ["P2 DOC_INACCURACY .github/workflows/x.yml"]), H, FILES).reason, "ACCEPT_WITH_FINDINGS");
});

test("review record: findings are de-duplicated and sorted by the trusted code, so the reviewer's own ordering carries nothing", () => {
  const a = record("REJECT", ["P2 OTHER .github/workflows/x.yml", "P1 CORRECTNESS_BUG apps/cloud/src/runtime.ts", "P2 OTHER .github/workflows/x.yml"]);
  const b = record("REJECT", ["P1 CORRECTNESS_BUG apps/cloud/src/runtime.ts", "P2 OTHER .github/workflows/x.yml"]);
  assert.equal(check(a, H, FILES).text, check(b, H, FILES).text);
});

test("review record: more than the maximum number of finding lines or an oversized record rejects", () => {
  const many = Array.from({ length: MAX_FINDINGS + 1 }, () => "P2 OTHER .github/workflows/x.yml");
  assert.equal(check(record("ACCEPT WITH P2", many), H, FILES).reason, "LINE_COUNT");
  assert.equal(check("x".repeat(MAX_TOTAL + 1), H, FILES).reason, "TOO_LONG");
});

test("review record: whatever the reviewer prints, an accepted record only ever contains the fixed lines (fuzz)", () => {
  const alphabet = ["VERDICT: ", "ACCEPT", "REJECT", "HEAD: ", H, "COVERAGE: FULL", "FINDING: ", "P1 ", "P2 ", "OTHER ", "apps/cloud/src/runtime.ts", "\n", " ", "token", "eyJ", "/etc/x", "`", "{", "$"];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  let accepted = 0;
  for (let i = 0; i < 4000; i += 1) {
    let text = "";
    const n = 3 + (rnd() % 14);
    for (let j = 0; j < n; j += 1) text += alphabet[rnd() % alphabet.length];
    const result = check(text, H, FILES);
    if (!result.ok) { assert.match(result.text, /^REVIEW_OUTPUT_REJECTED reason=[A-Z_]+\n$/); continue; }
    accepted += 1;
    for (const line of result.text.trimEnd().split("\n")) assert.match(line, /^(VERDICT: (ACCEPT WITH P2|ACCEPT|REJECT)|HEAD: [0-9a-f]{40}|COVERAGE: (FULL|PARTIAL)|FINDING: P[012] [A-Z_]+ [A-Za-z0-9_./-]+)$/);
  }
  assert.ok(accepted >= 0);
});

test("changed-file list: only plain repository-relative paths are kept", () => {
  const files = parseChangedFiles("apps/a.ts\n/etc/passwd\n../x\na/../b.ts\n./c.ts\nhas space.md\n\ndocs/b.md\n.github/workflows/x.yml\n");
  assert.deepEqual([...files].sort(), [".github/workflows/x.yml", "apps/a.ts", "docs/b.md"]);
});

test("command line: check writes the reduced record, render writes markdown, both exit 2 with one fixed line on a bad input", () => {
  const { spawnSync } = require("node:child_process");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-review-san-"));
  const script = path.join(root, "scripts", "independent-review-sanitize.js");
  fs.writeFileSync(path.join(dir, "files.txt"), [...FILES].join("\n"));
  fs.writeFileSync(path.join(dir, "ok.txt"), good());
  fs.writeFileSync(path.join(dir, "bad.txt"), `${good()}free text\n`);
  const run = (...args) => spawnSync(process.execPath, [script, ...args]);
  assert.equal(run("check", H, path.join(dir, "files.txt"), path.join(dir, "ok.txt"), path.join(dir, "reduced.txt")).status, 0);
  assert.equal(fs.readFileSync(path.join(dir, "reduced.txt"), "utf8"), good());
  assert.equal(run("render", H, path.join(dir, "files.txt"), path.join(dir, "reduced.txt"), path.join(dir, "out.md")).status, 0);
  assert.match(fs.readFileSync(path.join(dir, "out.md"), "utf8"), /Verdict: \*\*ACCEPT WITH P2\*\*/);
  assert.equal(run("check", H, path.join(dir, "files.txt"), path.join(dir, "bad.txt"), path.join(dir, "bad.out")).status, 2);
  assert.equal(fs.readFileSync(path.join(dir, "bad.out"), "utf8"), "REVIEW_OUTPUT_REJECTED reason=FINDING_GRAMMAR\n");
  assert.equal(run("check", H, path.join(dir, "files.txt"), path.join(dir, "none.txt"), path.join(dir, "none.out")).status, 2);
  assert.equal(run("nope", H, path.join(dir, "files.txt"), path.join(dir, "ok.txt"), path.join(dir, "mode.out")).status, 2);
  assert.equal(fs.readFileSync(path.join(dir, "mode.out"), "utf8"), "REVIEW_OUTPUT_REJECTED reason=BAD_MODE\n");
});
