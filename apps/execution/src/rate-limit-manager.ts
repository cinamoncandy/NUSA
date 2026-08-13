export enum RateLimitDecisionType {
  ALLOW = "ALLOW",
  DELAY = "DELAY",
  BLOCK = "BLOCK"
}

export interface RateLimitBucketPolicy {
  readonly capacity: number;
  readonly refillTokens: number;
  readonly refillIntervalMs: number;
  readonly maximumQueueDelayMs: number;
  readonly maximumTrackedRequests?: number;
}

export interface RateLimitRequest {
  readonly requestId: string;
  readonly weight: number;
  readonly nowMs: number;
}

export interface RateLimitDecision {
  readonly type: RateLimitDecisionType;
  readonly requestId: string;
  readonly remainingTokens: number;
  readonly retryAtMs?: number;
  readonly reason?: string;
}

export interface RateLimitState {
  readonly availableTokens: number;
  readonly lastRefillAtMs: number;
}

function assertPolicy(policy: RateLimitBucketPolicy): void {
  if (!Number.isSafeInteger(policy.capacity) || policy.capacity <= 0) throw new Error("capacity must be a positive safe integer");
  if (!Number.isSafeInteger(policy.refillTokens) || policy.refillTokens <= 0) throw new Error("refillTokens must be a positive safe integer");
  if (!Number.isSafeInteger(policy.refillIntervalMs) || policy.refillIntervalMs <= 0) throw new Error("refillIntervalMs must be a positive safe integer");
  if (!Number.isSafeInteger(policy.maximumQueueDelayMs) || policy.maximumQueueDelayMs < 0) throw new Error("maximumQueueDelayMs must be a non-negative safe integer");
  if (policy.maximumTrackedRequests !== undefined && (!Number.isSafeInteger(policy.maximumTrackedRequests) || policy.maximumTrackedRequests <= 0)) throw new Error("maximumTrackedRequests must be a positive safe integer");
}

function refill(state: RateLimitState, policy: RateLimitBucketPolicy, nowMs: number): RateLimitState {
  if (!Number.isSafeInteger(nowMs) || nowMs < state.lastRefillAtMs) throw new Error("rate-limit clock moved backwards");
  const intervals = Math.floor((nowMs - state.lastRefillAtMs) / policy.refillIntervalMs);
  if (intervals === 0) return state;
  return Object.freeze({
    availableTokens: Math.min(policy.capacity, state.availableTokens + intervals * policy.refillTokens),
    lastRefillAtMs: state.lastRefillAtMs + intervals * policy.refillIntervalMs
  });
}

export class DeterministicRateLimitManager {
  private state: RateLimitState;
  private readonly decisions = new Map<string, RateLimitDecision>();

  public constructor(private readonly policy: RateLimitBucketPolicy, initialNowMs: number) {
    assertPolicy(policy);
    if (!Number.isSafeInteger(initialNowMs) || initialNowMs < 0) throw new Error("initialNowMs is invalid");
    this.state = Object.freeze({ availableTokens: policy.capacity, lastRefillAtMs: initialNowMs });
  }

  public evaluate(request: RateLimitRequest): RateLimitDecision {
    if (request.requestId.trim() === "") throw new Error("requestId is required");
    if (!Number.isSafeInteger(request.weight) || request.weight <= 0) throw new Error("weight must be a positive safe integer");
    const prior = this.decisions.get(request.requestId);
    if (prior != null) return prior;
    if (this.policy.maximumTrackedRequests !== undefined && this.decisions.size >= this.policy.maximumTrackedRequests) {
      return Object.freeze({ type: RateLimitDecisionType.BLOCK, requestId: request.requestId, remainingTokens: this.state.availableTokens, reason: "request tracking capacity exhausted" });
    }
    this.state = refill(this.state, this.policy, request.nowMs);

    let decision: RateLimitDecision;
    if (request.weight > this.policy.capacity) {
      decision = Object.freeze({ type: RateLimitDecisionType.BLOCK, requestId: request.requestId, remainingTokens: this.state.availableTokens, reason: "request weight exceeds bucket capacity" });
    } else if (request.weight <= this.state.availableTokens) {
      this.state = Object.freeze({ ...this.state, availableTokens: this.state.availableTokens - request.weight });
      decision = Object.freeze({ type: RateLimitDecisionType.ALLOW, requestId: request.requestId, remainingTokens: this.state.availableTokens });
    } else {
      const deficit = request.weight - this.state.availableTokens;
      const intervalsNeeded = Math.ceil(deficit / this.policy.refillTokens);
      const retryAtMs = this.state.lastRefillAtMs + intervalsNeeded * this.policy.refillIntervalMs;
      const delayMs = retryAtMs - request.nowMs;
      decision = delayMs <= this.policy.maximumQueueDelayMs
        ? Object.freeze({ type: RateLimitDecisionType.DELAY, requestId: request.requestId, remainingTokens: this.state.availableTokens, retryAtMs })
        : Object.freeze({ type: RateLimitDecisionType.BLOCK, requestId: request.requestId, remainingTokens: this.state.availableTokens, reason: "required delay exceeds policy" });
    }
    this.decisions.set(request.requestId, decision);
    return decision;
  }

  public snapshot(): RateLimitState { return this.state; }
}
