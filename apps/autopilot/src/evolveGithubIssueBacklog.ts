import type { EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

type JsonObject = Record<string, unknown>;

type EligibleIssue = Readonly<{
  number: number;
  title: string;
  priority: 0 | 1;
  updatedAtMs: number;
  capability: GithubIssueCapability;
}>;

export type GithubIssueCapability = "AUTOPILOT_TYPESCRIPT" | "RESEARCH" | "GENERAL" | "UNKNOWN";

export interface GithubIssueBacklogReadiness {
  readonly eligibleIssueCount: number;
  readonly capabilityBlockedIssueCount: number;
  readonly capabilityBlockedCapabilities: Readonly<Record<Exclude<GithubIssueCapability, "AUTOPILOT_TYPESCRIPT">, number>>;
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

/**
 * Explicit, allowlisted capability routing for the existing CodingRunner.
 * Unknown or unsupported domains remain observable but never become READY.
 */
function capabilityForIssue(title: string, body: string): GithubIssueCapability {
  const textValue = `${title}\n${body}`;
  if (/\bapps\/autopilot\/src\b/i.test(body)
    || /\bautopilot\b/i.test(title)
    || /autonomous development control plane/i.test(title)) {
    return "AUTOPILOT_TYPESCRIPT";
  }
  if (/\b(?:research|market intelligence|oos|walk[- ]forward|league|allocation|regime|paper evidence)\b/i.test(textValue)) {
    return "RESEARCH";
  }
  if (/\b(?:mobile|android|ios|ui|ux|cloudflare|deployment|release|website|desktop)\b/i.test(textValue)) {
    return "GENERAL";
  }
  return "UNKNOWN";
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
    for (const match of haystack.matchAll(/#(\d+)/g)) {
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
  if (priority === null || !hasSafetyContract(body)) return null;

  const updatedAt = text(issue.updated_at);
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : 0;
  return Object.freeze({
    number,
    title,
    priority,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
    capability: capabilityForIssue(title, body),
  });
}

export function deriveGithubIssueBacklogReadiness(
  issues: readonly unknown[],
  openPulls: readonly unknown[],
  observedAt: Date,
): GithubIssueBacklogReadiness {
  if (!Array.isArray(issues) || !Array.isArray(openPulls) || !(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    return Object.freeze({
      eligibleIssueCount: 0,
      capabilityBlockedIssueCount: 0,
      capabilityBlockedCapabilities: Object.freeze({ RESEARCH: 0, GENERAL: 0, UNKNOWN: 0 }),
      signals: Object.freeze([]),
    });
  }

  const linked = linkedIssueNumbers(openPulls);
  const candidates = issues
    .map((issue) => eligibleIssue(issue, linked))
    .filter((issue): issue is EligibleIssue => issue !== null)
    .sort((left, right) => left.priority - right.priority || right.updatedAtMs - left.updatedAtMs || left.number - right.number);

  const capabilityBlockedCapabilities = { RESEARCH: 0, GENERAL: 0, UNKNOWN: 0 } as Record<Exclude<GithubIssueCapability, "AUTOPILOT_TYPESCRIPT">, number>;
  for (const candidate of candidates) {
    if (candidate.capability !== "AUTOPILOT_TYPESCRIPT") capabilityBlockedCapabilities[candidate.capability] += 1;
  }
  const eligible = candidates.filter((candidate) => candidate.capability === "AUTOPILOT_TYPESCRIPT");

  const signals = eligible.map((issue) => Object.freeze({
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
    canonicalOwner: "autopilot.control-plane",
    conflictKeys: ["module:apps/autopilot/src"],
  } satisfies EvolutionDiscoverySignal));

  return Object.freeze({
    eligibleIssueCount: eligible.length,
    capabilityBlockedIssueCount: candidates.length - eligible.length,
    capabilityBlockedCapabilities: Object.freeze({ ...capabilityBlockedCapabilities }),
    signals: Object.freeze(signals),
  });
}

export function deriveGithubIssueBacklogSignals(
  issues: readonly unknown[],
  openPulls: readonly unknown[],
  observedAt: Date,
): readonly EvolutionDiscoverySignal[] {
  return deriveGithubIssueBacklogReadiness(issues, openPulls, observedAt).signals;
}
