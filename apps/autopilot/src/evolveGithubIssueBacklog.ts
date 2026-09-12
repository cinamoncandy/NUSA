import type { EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

type JsonObject = Record<string, unknown>;

type EligibleIssue = Readonly<{
  number: number;
  title: string;
  priority: 0 | 1;
  updatedAtMs: number;
}>;

export interface GithubIssueBacklogReadiness {
  readonly eligibleIssueCount: number;
  readonly signals: readonly EvolutionDiscoverySignal[];
}

const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const positiveInteger = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;

function priorityFromTitle(title: string): 0 | 1 | null {
  const match = title.match(/^\s*\[?P([01])\]?(?:\s*[:\]-]|\s+)/i);
  if (!match) return null;
  return match[1] === "0" ? 0 : 1;
}

function hasSafetyContract(body: string): boolean {
  return body.includes("liveAuthority=NONE")
    && body.includes("productionMutationAllowed=false")
    && /aiAuthority\s*=\s*ZERO_AUTHORITY/i.test(body)
    && !/liveAuthority\s*=\s*(?:LIVE|WRITE|FULL|ENABLED)/i.test(body)
    && !/productionMutationAllowed\s*=\s*true/i.test(body)
    && !/aiAuthority\s*=\s*(?!ZERO_AUTHORITY\b)[A-Z0-9_]+/i.test(body);
}

function isAutopilotScoped(title: string, body: string): boolean {
  return /\bAUTOPILOT\b/i.test(title)
    || /autonomous development control plane/i.test(title)
    || /\bapps\/autopilot\/src\b/i.test(body);
}

function labelNames(issue: JsonObject): readonly string[] {
  if (!Array.isArray(issue.labels)) return Object.freeze([]);
  return Object.freeze(issue.labels.flatMap((entry) => {
    if (typeof entry === "string") return [entry.toLowerCase()];
    const item = object(entry);
    const name = text(item?.name);
    return name ? [name.toLowerCase()] : [];
  }));
}

function isExplicitlyBlocked(issue: JsonObject): boolean {
  const labels = labelNames(issue);
  return labels.some((label) => /(?:^|[-_ ])(?:hold|blocked|human[_ -]?only|rework)(?:$|[-_ ])/i.test(label));
}

function linkedIssueNumbers(openPulls: readonly unknown[]): ReadonlySet<number> {
  const linked = new Set<number>();
  for (const value of openPulls) {
    const pull = object(value);
    if (!pull) continue;
    const haystack = `${text(pull.title) ?? ""}\n${text(pull.body) ?? ""}`;
    const matcher = /(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|related(?:\s+to)?|for|issue)\s*:?[\s#]*(\d+)/gi;
    for (const match of haystack.matchAll(matcher)) {
      const issueNumber = Number(match[1]);
      if (Number.isSafeInteger(issueNumber) && issueNumber > 0) linked.add(issueNumber);
    }
  }
  return linked;
}

function eligibleIssue(value: unknown, linked: ReadonlySet<number>): EligibleIssue | null {
  const issue = object(value);
  if (!issue || text(issue.state)?.toLowerCase() !== "open" || object(issue.pull_request)) return null;
  if (text(issue.author_association)?.toUpperCase() !== "OWNER" || isExplicitlyBlocked(issue)) return null;

  const number = positiveInteger(issue.number);
  const title = text(issue.title);
  const body = text(issue.body);
  if (!number || !title || !body || linked.has(number)) return null;

  const priority = priorityFromTitle(title);
  if (priority === null || !isAutopilotScoped(title, body) || !hasSafetyContract(body)) return null;

  const updatedAt = text(issue.updated_at);
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : 0;
  return Object.freeze({ number, title, priority, updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0 });
}

/**
 * Read-only adapter from canonical GitHub backlog evidence into the existing
 * #903/#905 discovery path. It does not claim work or mutate GitHub. Only
 * owner-authored, safety-bounded P0/P1 Autopilot issues with no blocking label
 * and no linked open PR become READY candidates. Dispatch remains bounded to
 * one signal per scheduler pass; the full eligible count remains observable.
 */
export function deriveGithubIssueBacklogReadiness(
  issues: readonly unknown[],
  openPulls: readonly unknown[],
  observedAt: Date,
): GithubIssueBacklogReadiness {
  if (!Array.isArray(issues) || !Array.isArray(openPulls) || !(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    return Object.freeze({ eligibleIssueCount: 0, signals: Object.freeze([]) });
  }

  const linked = linkedIssueNumbers(openPulls);
  const eligible = issues
    .map((issue) => eligibleIssue(issue, linked))
    .filter((issue): issue is EligibleIssue => issue !== null)
    .sort((left, right) => left.priority - right.priority || right.updatedAtMs - left.updatedAtMs || left.number - right.number);

  const signals = eligible.slice(0, 1).map((issue) => Object.freeze({
    id: `github-issue-${issue.number}`,
    source: "github-issue-backlog",
    reference: `github://issue/${issue.number}`,
    problem: `GitHub issue #${issue.number}: ${issue.title}. Implement only the next smallest verifiable apps/autopilot/src control-plane increment while preserving PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, and aiAuthority=ZERO_AUTHORITY.`,
    observedAt: observedAt.toISOString(),
    evidenceQuality: 0.95,
    impact: issue.priority === 0 ? 0.95 : 0.85,
    confidence: 0.85,
    risk: 0.2,
    reversibility: 0.9,
  } satisfies EvolutionDiscoverySignal));

  return Object.freeze({ eligibleIssueCount: eligible.length, signals: Object.freeze(signals) });
}

export function deriveGithubIssueBacklogSignals(
  issues: readonly unknown[],
  openPulls: readonly unknown[],
  observedAt: Date,
): readonly EvolutionDiscoverySignal[] {
  return deriveGithubIssueBacklogReadiness(issues, openPulls, observedAt).signals;
}
