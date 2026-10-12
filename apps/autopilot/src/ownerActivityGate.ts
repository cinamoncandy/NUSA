/**
 * Owner-activity gate (docs/AUTOPILOT_OWNER_ACTIVITY_GATE_DESIGN.md): Autopilot starts NEW coding work only after the
 * watched (main Claude side) GitHub account has been quiet, and never while an owner `/autopilot pause` is in force.
 * The gate only ever withholds work. It grants no authority, and every uncertainty closes it.
 */
export type OwnerActivityEventType = "PushEvent" | "PullRequestEvent" | "PullRequestReviewEvent" | "PullRequestReviewCommentEvent" | "IssueCommentEvent";

export interface OwnerActivityEvent {
  readonly type: OwnerActivityEventType;
  readonly actorLogin: string;
  readonly createdAtMs: number;
}

export interface OwnerCommentEvent {
  readonly authorLogin: string;
  readonly createdAtMs: number;
  readonly body: string;
}

export interface OwnerActivityPolicy {
  readonly ownerLogin: string;
  readonly quietMs: number;
}

export type OwnerCommand = Readonly<{ kind: "pause"; hours: number }> | Readonly<{ kind: "resume" }>;

export type OwnerGateDecision =
  | Readonly<{ open: true; reason: "OWNER_QUIET" }>
  | Readonly<{ open: false; reason: "OWNER_ACTIVE" | "OWNER_PAUSED" | "OWNER_ACTIVITY_UNAVAILABLE" | "OWNER_GATE_MISCONFIGURED" | "OWNER_CLOCK_ANOMALY" }>;

export const MAX_PAUSE_HOURS = 24;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const HOUR_MS = 3_600_000;
const PAUSE = /^\/autopilot pause ([1-9]|1[0-9]|2[0-4])h$/;
const RESUME = /^\/autopilot resume$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const closed = (reason: Exclude<OwnerGateDecision, { open: true }>["reason"]): OwnerGateDecision => Object.freeze({ open: false, reason });

/** Strict: the whole comment must be exactly the command, otherwise it is not a command. */
export function parseOwnerCommand(body: string): OwnerCommand | null {
  const text = body.trim();
  const pause = PAUSE.exec(text);
  if (pause) return Object.freeze({ kind: "pause" as const, hours: Number(pause[1]) });
  if (RESUME.test(text)) return Object.freeze({ kind: "resume" as const });
  return null;
}

export function validOwnerActivityPolicy(policy: OwnerActivityPolicy): boolean {
  return LOGIN.test(policy.ownerLogin) && Number.isSafeInteger(policy.quietMs) && policy.quietMs >= 60_000 && policy.quietMs <= 24 * HOUR_MS;
}

/**
 * `events` is null when the activity or comment lookup failed or may be incomplete; that closes the gate.
 */
export function decideOwnerActivityGate(
  input: Readonly<{ activity: readonly OwnerActivityEvent[] | null; comments: readonly OwnerCommentEvent[] | null; nowMs: number }>,
  policy: OwnerActivityPolicy,
): OwnerGateDecision {
  if (!validOwnerActivityPolicy(policy) || !Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) return closed("OWNER_GATE_MISCONFIGURED");
  if (input.activity === null || input.comments === null) return closed("OWNER_ACTIVITY_UNAVAILABLE");
  const owner = policy.ownerLogin.toLowerCase();
  const now = input.nowMs;

  for (const event of input.activity) {
    if (event.actorLogin.toLowerCase() !== owner) continue;
    if (event.createdAtMs > now + CLOCK_SKEW_MS) return closed("OWNER_CLOCK_ANOMALY");
    if (now - event.createdAtMs < policy.quietMs) return closed("OWNER_ACTIVE");
  }

  let latest: { createdAtMs: number; command: OwnerCommand } | null = null;
  for (const comment of input.comments) {
    if (comment.authorLogin.toLowerCase() !== owner) continue;
    const command = parseOwnerCommand(comment.body);
    if (command === null) continue;
    if (comment.createdAtMs > now + CLOCK_SKEW_MS) return closed("OWNER_CLOCK_ANOMALY");
    if (latest === null || comment.createdAtMs >= latest.createdAtMs) latest = { createdAtMs: comment.createdAtMs, command };
  }
  if (latest !== null && latest.command.kind === "pause" && latest.createdAtMs + latest.command.hours * HOUR_MS > now) return closed("OWNER_PAUSED");

  return Object.freeze({ open: true as const, reason: "OWNER_QUIET" as const });
}

export interface OwnerGateConfig {
  readonly enabled: boolean;
  readonly ownerLogin: string;
  readonly quietMs: number;
}

/** The gate is off unless explicitly enabled; once enabled, an invalid configuration closes it. */
export function readOwnerGateConfig(env: Readonly<{
  NUSA_AUTOPILOT_OWNER_GATE_ENABLED?: string;
  NUSA_AUTOPILOT_OWNER_LOGIN?: string;
  NUSA_AUTOPILOT_OWNER_QUIET_MINUTES?: string;
}>): OwnerGateConfig {
  const enabled = env.NUSA_AUTOPILOT_OWNER_GATE_ENABLED?.trim().toLowerCase() === "true";
  const minutes = env.NUSA_AUTOPILOT_OWNER_QUIET_MINUTES === undefined ? 60 : Number(env.NUSA_AUTOPILOT_OWNER_QUIET_MINUTES.trim());
  return Object.freeze({
    enabled,
    ownerLogin: env.NUSA_AUTOPILOT_OWNER_LOGIN?.trim() ?? "",
    quietMs: Number.isFinite(minutes) ? Math.round(minutes * 60_000) : Number.NaN,
  });
}

type FetchImpl = typeof fetch;
const ACTIVITY_TYPES = new Set<string>(["PushEvent", "PullRequestEvent", "PullRequestReviewEvent", "PullRequestReviewCommentEvent", "IssueCommentEvent"]);
const PAGE_SIZE = 100;
const MAX_EVENT_PAGES = 3;
const MAX_COMMENT_PAGES = 5;

async function githubGet(base: string, path: string, token: string, fetchImpl: FetchImpl): Promise<unknown> {
  const response = await fetchImpl(`${base}${path}`, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "nusa-autopilot" },
  });
  if (!response.ok) throw new Error(`OWNER_GATE_GITHUB_${response.status}`);
  return response.json();
}

/**
 * Reads recent activity and pause comments. Returns null for any part that is unreadable or whose window may be truncated,
 * so the caller closes the gate. The token's own account must not be the watched account (misconfiguration).
 */
export async function readOwnerActivity(
  config: Readonly<{ token?: string; repository: string; apiBaseUrl?: string }>,
  policy: OwnerActivityPolicy,
  nowMs: number,
  fetchImpl: FetchImpl = fetch,
): Promise<Readonly<{ activity: readonly OwnerActivityEvent[] | null; comments: readonly OwnerCommentEvent[] | null; tokenIsOwner: boolean | null }>> {
  const token = config.token?.trim();
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) return { activity: null, comments: null, tokenIsOwner: null };
  const base = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const repo = config.repository;
  const owner = policy.ownerLogin.toLowerCase();

  let tokenIsOwner: boolean | null = null;
  try {
    const me = await githubGet(base, "/user", token, fetchImpl) as { login?: unknown };
    tokenIsOwner = typeof me.login === "string" ? me.login.toLowerCase() === owner : null;
  } catch {
    tokenIsOwner = null;
  }

  let activity: OwnerActivityEvent[] | null = null;
  try {
    const found: OwnerActivityEvent[] = [];
    let covered = false;
    for (let page = 1; page <= MAX_EVENT_PAGES && !covered; page += 1) {
      const body = await githubGet(base, `/repos/${repo}/events?per_page=${PAGE_SIZE}&page=${page}`, token, fetchImpl);
      if (!Array.isArray(body)) throw new Error("OWNER_GATE_EVENTS_INVALID");
      let oldest = Number.POSITIVE_INFINITY;
      for (const item of body as Array<Record<string, unknown>>) {
        const createdAtMs = Date.parse(String(item.created_at));
        const actor = (item.actor as { login?: unknown } | null)?.login;
        if (!Number.isFinite(createdAtMs) || typeof actor !== "string") throw new Error("OWNER_GATE_EVENT_INVALID");
        oldest = Math.min(oldest, createdAtMs);
        if (ACTIVITY_TYPES.has(String(item.type))) found.push({ type: item.type as OwnerActivityEventType, actorLogin: actor, createdAtMs });
      }
      // The window is covered once this page reaches back past it, or the listing ends before a full page.
      if (oldest < nowMs - policy.quietMs || body.length < PAGE_SIZE) covered = true;
    }
    activity = covered ? found : null;
  } catch {
    activity = null;
  }

  let comments: OwnerCommentEvent[] | null = null;
  try {
    const since = new Date(nowMs - MAX_PAUSE_HOURS * HOUR_MS).toISOString();
    const found: OwnerCommentEvent[] = [];
    let complete = false;
    for (let page = 1; page <= MAX_COMMENT_PAGES && !complete; page += 1) {
      const body = await githubGet(base, `/repos/${repo}/issues/comments?since=${encodeURIComponent(since)}&per_page=${PAGE_SIZE}&page=${page}`, token, fetchImpl);
      if (!Array.isArray(body)) throw new Error("OWNER_GATE_COMMENTS_INVALID");
      for (const item of body as Array<Record<string, unknown>>) {
        const createdAtMs = Date.parse(String(item.created_at));
        const login = (item.user as { login?: unknown } | null)?.login;
        if (!Number.isFinite(createdAtMs) || typeof login !== "string" || typeof item.body !== "string") throw new Error("OWNER_GATE_COMMENT_INVALID");
        found.push({ authorLogin: login, createdAtMs, body: item.body });
      }
      if (body.length < PAGE_SIZE) complete = true;
    }
    comments = complete ? found : null;
  } catch {
    comments = null;
  }
  return Object.freeze({ activity, comments, tokenIsOwner });
}

/**
 * Evaluates the gate from the environment. Returns null when the gate is off or open, otherwise the closing decision.
 */
export async function evaluateOwnerGateForEnv(
  env: Readonly<{ NUSA_AUTOPILOT_OWNER_GATE_ENABLED?: string; NUSA_AUTOPILOT_OWNER_LOGIN?: string; NUSA_AUTOPILOT_OWNER_QUIET_MINUTES?: string; NUSA_GITHUB_TOKEN?: string }>,
  repository: string,
  nowMs: number,
  fetchImpl: FetchImpl = fetch,
): Promise<Extract<OwnerGateDecision, { open: false }> | null> {
  const config = readOwnerGateConfig(env);
  if (!config.enabled) return null;
  const policy: OwnerActivityPolicy = { ownerLogin: config.ownerLogin, quietMs: config.quietMs };
  if (!validOwnerActivityPolicy(policy)) return closed("OWNER_GATE_MISCONFIGURED") as Extract<OwnerGateDecision, { open: false }>;
  const observed = await readOwnerActivity({ token: env.NUSA_GITHUB_TOKEN, repository }, policy, nowMs, fetchImpl);
  if (observed.tokenIsOwner !== false) return closed("OWNER_GATE_MISCONFIGURED") as Extract<OwnerGateDecision, { open: false }>;
  const decision = decideOwnerActivityGate({ activity: observed.activity, comments: observed.comments, nowMs }, policy);
  return decision.open ? null : decision;
}
