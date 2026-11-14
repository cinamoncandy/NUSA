# Independent review automation: design (2026-11-14)

Status: DESIGN. Owner decisions 2026-11-14: automate the independent review; use the API key variant after two reviews rejected the Codex-runner variant; an automatic verdict may later
count as the non-author review (R4). The workflow itself is PR 3126. An automatic review is never an Audit or Release approval and never merges, approves or un-drafts anything.
Safety stays: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

## 1. Today

The non-author review is done by Codex on a ChatGPT account; the owner copies the PR text into it and pastes the answer back (2 to 5 round trips per PR). The review is static, runs no tests, and names its head SHA.

## 2. Why the first design was dropped (reviews of PR 3126, both REJECT)

The first design ran a tool-using Codex process (`codex exec -s read-only`) on the self-hosted runner `nusa-codex-autopilot`, which also holds the owner's ChatGPT login, and posted a filtered review as a public comment. The repository is PUBLIC. The reviews found, and this note agrees:

- `-s read-only` and an empty working directory do not hide the runner's files from the process, and nothing proved the process has no outward network. A prompt-injected reviewer could try to print what it can read.
- A regex filter over free text cannot prove nothing is smuggled out. A fixed record (verdict, categories, changed-file paths) narrows the channel but is still a selection channel (about 16 bytes per run with 300 changed files).
- So the risk is the combination "a tool-using agent + credentials on its runner + a public output". The fix is to remove the first two, not to filter the third.

## 3. The design now

The reviewer is ONE model API completion call from a GitHub-hosted job (`scripts/independent-review-call.js`): no tools, no files, nothing stored (`store: false`), and the API key only in that process's
environment and its `Authorization` header, never in the prompt. The job has nothing for the model to read except the public diff. The workflow is `workflow_dispatch` only, so a PR cannot start it and the
workflow definition is always the one on `main`.

| Threat | Rule |
| --- | --- |
| A PR contains text that steers the reviewer (prompt injection) | The prompt and protocol come from `main`; the PR is data below a marker; the reviewer has no tool, no file and no credential, so the worst case is a misleading text, which a human reads as advice and the comment says is not an approval |
| The API key leaks | It is used in exactly one step, as that step's environment; never echoed, never in the prompt, an artifact, a log or a comment; every failure code in the call script is checked to be free of the key; tests pin all of this |
| The model's text breaks the comment markup or pings people | The text is checked (line grammar, expected head sha, verdict consistent with findings, no backtick or angle bracket, no control or bidirectional character, length caps) in the review job and AGAIN in the post job with the trusted script from `main`, and is posted inside a five-backtick fence it cannot close |
| The post job approves, merges or un-drafts | It only calls the issue comment API: one comment per (PR, head sha); no review event, no merge, no draft change, no issue creation; tests pin this |
| A stale review is read as current | The comment names the head sha and carries a STALE note if the head moved; nothing acts on the verdict automatically |
| A PR edits the review workflow to weaken it | Dispatch only, definition from `main`; a PR that changes the review workflow or its prompt is reviewed by the previous version plus the owner |
| Cost | Manual dispatch only; diff over 150 kB refused (no partial review); 4000 output tokens |

## 4. Trigger

`workflow_dispatch` with a PR number. A label trigger (R3) comes only after the owner judged at least 3 automatic reviews equal to the manual ones.

## 5. What the owner provides

A repository secret `NUSA_REVIEW_API_KEY` (an OpenAI API key; calls are billed) and a repository variable `NUSA_REVIEW_MODEL`. Until both exist the review job reports `NOT_CONFIGURED`.
The first run is a manual dispatch on a docs-only PR, watched by the owner.

## 6. Phases

| Phase | Change | Needs |
| --- | --- | --- |
| R1 | This design | none |
| R2 | The workflow (PR 3126) | non-author review (workflow with a secret: needed), owner creates the secret and variable, first watched run |
| R3 | Optional label trigger | owner decision after at least 3 reviews were judged equal to the manual ones |
| R4 | Optional: treat the automatic review as the non-author review in the draft rule of `CLAUDE.md` | owner decision (already answered "인정한다" in principle); governed instruction change; independent review |

## 7. Owner answers

- 2026-11-14 "인정한다": an automatic verdict may count as the non-author review (R4 intent; not switched on).
- 2026-11-14 "1 2도 허용": use of the dedicated ChatGPT account and runner and the comment-only `pull-requests: write`. The runner part is superseded by the API key variant below; the comment-only permission stays.
- 2026-11-14 "API 키 방식": use the API key variant.
- 2026-11-14 "독립 리뷰가 꼭 필요하지 않다면 생략해": independent review is skipped for changes that cannot affect safety (documentation, records and tests only, with CI green) and kept for code, workflows, secrets, permissions and governed instruction files. This is the agent's reading of the owner's sentence; the owner may narrow or widen it.

## 8. Not claimed

The reviewer is a model: it can miss defects or be steered into a misleading text. It has no CI or runtime result. The API endpoint, request body and response shape were written from knowledge of the Responses API and have not been called.
Nothing here reduces a safety check.
