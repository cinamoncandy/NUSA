export interface LiveExecutionEnvelope {
  readonly authorizationFingerprintSha256: string;
  readonly expiresAt: number;
}

export interface ConsumeOnceResult {
  readonly consumed: boolean;
  readonly reason?: "ALREADY_CONSUMED" | "EXPIRED" | "INVALID";
}

export interface ConsumeOnceTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface ConsumeOnceStorage {
  transaction<T>(callback: (transaction: ConsumeOnceTransaction) => Promise<T>): Promise<T>;
}

/**
 * One-time LIVE execution envelope storage boundary.
 * The Durable Object supplies the transactional storage implementation,
 * making concurrent retries resolve to a single consumer.
 */
export class LiveExecutionConsumeOnce {
  public constructor(private readonly storage: ConsumeOnceStorage) {}

  public async consume(envelope: LiveExecutionEnvelope, now: number): Promise<ConsumeOnceResult> {
    if (!Number.isSafeInteger(now) || now < 0) return { consumed: false, reason: "INVALID" };
    if (!/^[a-f0-9]{64}$/.test(envelope.authorizationFingerprintSha256)) return { consumed: false, reason: "INVALID" };
    if (!Number.isSafeInteger(envelope.expiresAt) || envelope.expiresAt <= now) return { consumed: false, reason: "EXPIRED" };

    const key = `live-execution-consumed:${envelope.authorizationFingerprintSha256}`;
    return this.storage.transaction(async (transaction) => {
      const existing = await transaction.get<{ consumedAt: number }>(key);
      if (existing !== undefined) return { consumed: false, reason: "ALREADY_CONSUMED" as const };
      await transaction.put(key, Object.freeze({ consumedAt: now }));
      return { consumed: true } as const;
    });
  }
}
