// Keeps Autopilot PRs releasable: the deterministic Audit declines a PR whose base is not the current
// main ("NO_ACTION stale"). When an autopilot/* PR already passed exact-head CI and only fell behind main,
// this merges current main into that PR branch (a plain merge commit, never a rewrite) with the Autopilot
// identity so a fresh CI run starts and Audit can accept the new head. It never merges the PR itself,
// never touches Audit/Release, and never acts on non-autopilot, forked, draft, held or conflicting PRs.
export const MAX_MERGES_PER_RUN = 3;

const skip = (reason) => Object.freeze({ action: "SKIP", reason });

/** Pure decision: returns { action: "MERGE_MAIN" } or { action: "SKIP", reason }. */
export function decideReconverge({ pr, mainSha, repository, ciSuccessOnHead }) {
  if (pr?.state !== "open") return skip("NOT_OPEN");
  if (pr.draft === true) return skip("DRAFT");
  if (typeof pr.head?.ref !== "string" || !pr.head.ref.startsWith("autopilot/")) return skip("NOT_AUTOPILOT_BRANCH");
  if (pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository) return skip("FORK");
  if (pr.base?.ref !== "main") return skip("BASE_NOT_MAIN");
  if (!Array.isArray(pr.labels) || pr.labels.some((l) => typeof l?.name !== "string" || l.name.toLowerCase() === "hold")) return skip("HOLD_OR_INVALID_LABELS");
  if (!/^[0-9a-f]{40}$/i.test(mainSha ?? "")) return skip("MAIN_UNKNOWN");
  if (pr.base?.sha === mainSha) return skip("UP_TO_DATE");
  if (pr.mergeable === false) return skip("CONFLICT_NEEDS_HUMAN");
  if (ciSuccessOnHead !== true) return skip("HEAD_CI_NOT_SUCCESS");
  return Object.freeze({ action: "MERGE_MAIN" });
}

async function main() {
  const { GITHUB_REPOSITORY: repo, GH_TOKEN: token } = process.env;
  if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required");
  const api = async (path, init) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" } });
    return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) };
  };
  const mainSha = (await api("branches/main")).body?.commit?.sha;
  const list = (await api("pulls?state=open&per_page=100")).body ?? [];
  let merged = 0;
  for (const summary of list) {
    if (merged >= MAX_MERGES_PER_RUN) break;
    if (!summary.head?.ref?.startsWith("autopilot/")) continue;
    const pr = (await api(`pulls/${summary.number}`)).body;
    const runs = (await api(`actions/runs?head_sha=${pr.head.sha}&event=pull_request&per_page=100`)).body?.workflow_runs ?? [];
    const ciSuccessOnHead = runs.some((r) => r.name === "CI" && r.head_sha === pr.head.sha && r.status === "completed" && r.conclusion === "success");
    const decision = decideReconverge({ pr, mainSha, repository: repo, ciSuccessOnHead });
    if (decision.action !== "MERGE_MAIN") { console.log(`#${pr.number} SKIP ${decision.reason}`); continue; }
    const result = await api("merges", { method: "POST", body: JSON.stringify({ base: pr.head.ref, head: mainSha, commit_message: `merge main into ${pr.head.ref} (autopilot reconverge; PAPER only, liveAuthority=NONE)` }) });
    if (result.status === 201) { merged += 1; console.log(`#${pr.number} MERGED main ${mainSha.slice(0, 7)} into ${pr.head.ref}`); }
    else if (result.status === 204) console.log(`#${pr.number} NOTHING_TO_MERGE`);
    else console.log(`#${pr.number} MERGE_REFUSED status=${result.status} (${result.status === 409 ? "conflict, needs human" : "see API response"})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
