import type { EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

type JsonObject = Record<string, unknown>;

type EligibleIssue = Readonly<{
  number: number;
  title: string;
  priority: 0 | 1;
  updatedAtMs: number;
}>;

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
    && body.includes("aiAuthority=ZERO_AUTHORITY")
    && !/liveAuthority\s*=\s*(?:LIVE|WRITE|FULL|ENABLED)/i.test(body)
    && !/productionMutationAllowed\s*=\s*true/i.test(body)
    && !/aiAuthority\s*=\s*(?!ZERO_AUTHORITY\b)[A-Z0-9_]+/i.test(body);
}

function isAutopilotScoped(title: string, body: string): boolean {
  return /\bAUTOPILOT\b/i.test(title)
    || /autonomous development control plane/i.test(title)
    || /\bapps\/autopilot\/src\b/i.test(body);
}

function eligibleIssue(value: unknown): EligibleIssue | null {
  const issue = object(value);
  if (!issue || text(issue.state)?.toLowerCase() !== "open" || object(issue.pull_request)) return null;
  if (text(issue.author_association)?.toUpperCase() !== "OWNER") return null;

  const number = positiveInteger(issue.number);
  const title = text(issue.title);
  const body = text(issue.body);
  if (!number || !title || !body) return null;

  const priority = priorityFromTitle(title);
  if (priority === null || !isAutopilotScoped(title, body) || !hasSafetyContract(body)) return null;

  const updatedAt = text(issue.updated_at);
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : 0;
  return Object.freeze({
    number,
    title,
    priority,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
  });
}

/**
 * Converts owner-authored, explicitly safety-bounded P0/P1 Autopilot issues into
 * read-only discovery signals. The source is deliberately narrow: arbitrary
 * issues, PR wrappers, lower-priority work, and issues without the exact ZERO
 * authority contract are ignored. At most one issue is surfaced per scheduler
 * pass so repository backlog discovery cannot create an unbounded work burst.
 */
export function deriveGithubIssueBacklogSignals(
  issues: readonly unknown[],
  observedAt: Date,
): readonly EvolutionDiscoverySignal[] {
  if (!Array.isArray(issues) || !(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    return Object.freeze([]);
  }

  const eligible = issues
    .map(eligibleIssue)
    .filter((issue): issue is EligibleIssue => issue !== null)
    .sort((left, right) => left.priority - right.priority
      || right.updatedAtMs - left.updatedAtMs
      || left.number - right.number)
    .slice(0, 1);

  return Object.freeze(eligible.map((issue) => Object.freeze({
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
  })));
}
