/**
 * AI Request Governor: Rate limiting + input caching for AI channels.
 *
 * NUSA AI operates at ZERO_AUTHORITY:
 *   - Can read market data, analysis, evidence
 *   - Cannot execute orders, modify state, or gate decisions
 *   - Rate-limited to prevent resource exhaustion
 *   - Cached to prevent redundant computation
 *
 * Configuration:
 *   - 6 calls per 60-second window (default)
 *   - 30-second cache TTL per unique input hash
 *   - SHA-256 input digest for cache key
 */

import crypto from 'crypto';

export interface AiRequestGovernorConfig {
  readonly maxCallsPerWindow: number;
  readonly windowMs: number;
  readonly cacheTtlMs: number;
}

export class AiRequestLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiRequestLimitExceededError';
  }
}

export interface AiRequestDecision {
  readonly status: 'CACHED' | 'CACHE_HIT' | 'BLOCKED';
  readonly cachedResult?: unknown;
  readonly message?: string;
}

export class AiRequestGovernor {
  private callTimestamps: number[] = [];
  private cache: Map<string, { result: unknown; expiresAt: number }> = new Map();

  readonly maxCallsPerWindow: number;
  readonly windowMs: number;
  readonly cacheTtlMs: number;

  constructor(config: Partial<AiRequestGovernorConfig> = {}) {
    this.maxCallsPerWindow = config.maxCallsPerWindow ?? 6;
    this.windowMs = config.windowMs ?? 60_000;
    this.cacheTtlMs = config.cacheTtlMs ?? 30_000;
  }

  private inputHash(input: unknown): string {
    const json = typeof input === 'string' ? input : JSON.stringify(input);
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  private isRateLimited(): boolean {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(ts => now - ts < this.windowMs);
    return this.callTimestamps.length >= this.maxCallsPerWindow;
  }

  evaluate(input: unknown): AiRequestDecision {
    const hash = this.inputHash(input);
    this.cleanExpiredCache();

    // Check cache first
    const cached = this.cache.get(hash);
    if (cached && cached.expiresAt > Date.now()) {
      return { status: 'CACHE_HIT', cachedResult: cached.result };
    }

    // Check rate limit
    if (this.isRateLimited()) {
      throw new AiRequestLimitExceededError(
        `Rate limit exceeded: ${this.maxCallsPerWindow} calls per ${this.windowMs}ms`
      );
    }

    // Record call
    this.callTimestamps.push(Date.now());
    return { status: 'CACHED' };
  }

  cache(input: unknown, result: unknown): void {
    const hash = this.inputHash(input);
    this.cache.set(hash, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs
    });
  }

  reset(): void {
    this.callTimestamps = [];
    this.cache.clear();
  }
}
