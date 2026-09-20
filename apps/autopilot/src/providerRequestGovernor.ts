export interface ProviderResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers?: Pick<Headers, "get">;
}

export interface ProviderRateLimitPolicy {
  readonly maxConcurrent: number;
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
}

export interface ProviderGovernorSnapshot {
  readonly providerId: string;
  readonly inFlight: number;
  readonly queued: number;
  readonly consecutiveRateLimits: number;
  readonly cooldownUntilMs: number;
}

export interface ProviderGovernorOptions {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly policies?: Readonly<Record<string, Partial<ProviderRateLimitPolicy>>>;
}

const DEFAULT_POLICY: ProviderRateLimitPolicy = Object.freeze({
  maxConcurrent: 2,
  maxAttempts: 3,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
});

const PROVIDER_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const MAX_CONCURRENT = 16;
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 5 * 60_000;

type ProviderState = {
  inFlight: number;
  queued: number;
  consecutiveRateLimits: number;
  cooldownUntilMs: number;
  waiters: Array<() => void>;
};

const finiteInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

function normalizePolicy(value?: Partial<ProviderRateLimitPolicy>): ProviderRateLimitPolicy {
  return Object.freeze({
    maxConcurrent: finiteInteger(value?.maxConcurrent, DEFAULT_POLICY.maxConcurrent, 1, MAX_CONCURRENT),
    maxAttempts: finiteInteger(value?.maxAttempts, DEFAULT_POLICY.maxAttempts, 1, MAX_ATTEMPTS),
    baseBackoffMs: finiteInteger(value?.baseBackoffMs, DEFAULT_POLICY.baseBackoffMs, 0, MAX_BACKOFF_MS),
    maxBackoffMs: finiteInteger(value?.maxBackoffMs, DEFAULT_POLICY.maxBackoffMs, 1, MAX_BACKOFF_MS),
  });
}

function parseRetryAfter(headers: ProviderResponseLike["headers"], nowMs: number): number | null {
  if (!headers) return null;
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_BACKOFF_MS, Math.ceil(seconds * 1_000));
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(MAX_BACKOFF_MS, Math.max(0, at - nowMs));
  }
  const reset = headers.get("x-ratelimit-reset");
  if (reset) {
    const epochSeconds = Number(reset);
    if (Number.isFinite(epochSeconds) && epochSeconds >= 0) {
      return Math.min(MAX_BACKOFF_MS, Math.max(0, Math.ceil(epochSeconds * 1_000 - nowMs)));
    }
  }
  return null;
}

function boundedBackoff(policy: ProviderRateLimitPolicy, attempt: number, random: () => number): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * (2 ** exponent));
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * Math.max(1, Math.floor(raw * 0.25)));
  return Math.min(policy.maxBackoffMs, raw + jitter);
}

export class ProviderRequestGovernor {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly policies: Readonly<Record<string, Partial<ProviderRateLimitPolicy>>>;
  private readonly states = new Map<string, ProviderState>();

  constructor(options: ProviderGovernorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.policies = options.policies ?? {};
  }

  private policy(providerId: string): ProviderRateLimitPolicy {
    return normalizePolicy(this.policies[providerId]);
  }

  private state(providerId: string): ProviderState {
    const existing = this.states.get(providerId);
    if (existing) return existing;
    const state: ProviderState = { inFlight: 0, queued: 0, consecutiveRateLimits: 0, cooldownUntilMs: 0, waiters: [] };
    this.states.set(providerId, state);
    return state;
  }

  snapshot(providerId: string): ProviderGovernorSnapshot {
    if (!PROVIDER_ID.test(providerId)) throw new Error("PROVIDER_ID_INVALID");
    const state = this.state(providerId);
    return Object.freeze({
      providerId,
      inFlight: state.inFlight,
      queued: state.queued,
      consecutiveRateLimits: state.consecutiveRateLimits,
      cooldownUntilMs: state.cooldownUntilMs,
    });
  }

  private async acquire(providerId: string): Promise<void> {
    const policy = this.policy(providerId);
    const state = this.state(providerId);
    if (state.inFlight < policy.maxConcurrent) {
      state.inFlight += 1;
      return;
    }
    state.queued += 1;
    await new Promise<void>((resolve) => state.waiters.push(resolve));
    state.queued -= 1;
    state.inFlight += 1;
  }

  private release(providerId: string): void {
    const state = this.state(providerId);
    state.inFlight = Math.max(0, state.inFlight - 1);
    const next = state.waiters.shift();
    if (next) next();
  }

  private async waitForCooldown(providerId: string): Promise<void> {
    const state = this.state(providerId);
    const waitMs = Math.max(0, state.cooldownUntilMs - this.now());
    if (waitMs > 0) await this.sleep(waitMs);
  }

  async execute<T extends ProviderResponseLike>(
    providerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!PROVIDER_ID.test(providerId)) throw new Error("PROVIDER_ID_INVALID");
    const policy = this.policy(providerId);
    await this.acquire(providerId);
    try {
      let lastResponse: T | null = null;
      for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
        await this.waitForCooldown(providerId);
        const response = await operation();
        lastResponse = response;
        const state = this.state(providerId);
        if (response.status !== 429) {
          state.consecutiveRateLimits = 0;
          state.cooldownUntilMs = 0;
          return response;
        }

        state.consecutiveRateLimits += 1;
        const headerDelay = parseRetryAfter(response.headers, this.now());
        const delay = headerDelay ?? boundedBackoff(policy, attempt, this.random);
        state.cooldownUntilMs = Math.max(state.cooldownUntilMs, this.now() + delay);

        if (attempt >= policy.maxAttempts) return response;
        await this.sleep(delay);
      }
      if (lastResponse) return lastResponse;
      throw new Error("PROVIDER_REQUEST_GOVERNOR_UNREACHABLE");
    } finally {
      this.release(providerId);
    }
  }
}

export const providerRequestGovernor = new ProviderRequestGovernor();

export function providerRateLimitRetryDelay(response: ProviderResponseLike, nowMs = Date.now()): number | null {
  return response.status === 429 ? parseRetryAfter(response.headers, nowMs) : null;
}
