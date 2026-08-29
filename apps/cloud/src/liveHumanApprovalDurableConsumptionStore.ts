import type {
  LiveHumanApprovalConsumptionStore,
  LiveHumanApprovalConsumptionStoreResult,
} from "./liveHumanApprovalConsumptionGate";

export interface DurableApprovalConsumptionTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface DurableApprovalConsumptionStorage extends DurableApprovalConsumptionTransaction {
  transaction<T>(
    closure: (transaction: DurableApprovalConsumptionTransaction) => Promise<T>,
  ): Promise<T>;
}

const CONSUMPTION_KEY_PREFIX = "live-human-approval-consumed:v1:";
const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Durable Object storage adapter for one-time human approval consumption.
 *
 * The transaction is the replay-prevention boundary. A receipt is consumed only when the
 * durable marker is absent and the marker write commits successfully. Corrupt state, invalid
 * keys, transaction failures, and storage uncertainty all fail closed.
 */
export class DurableObjectLiveHumanApprovalConsumptionStore
  implements LiveHumanApprovalConsumptionStore
{
  constructor(private readonly storage: DurableApprovalConsumptionStorage) {}

  async consumeOnce(
    consumptionKeySha256: string,
  ): Promise<LiveHumanApprovalConsumptionStoreResult> {
    if (!SHA256_HEX.test(consumptionKeySha256)) return "FAILED";

    const durableKey = `${CONSUMPTION_KEY_PREFIX}${consumptionKeySha256}`;
    try {
      return await this.storage.transaction(async (transaction) => {
        const existing = await transaction.get<boolean>(durableKey);
        if (existing === true) return "ALREADY_CONSUMED";
        if (existing !== undefined) return "FAILED";

        await transaction.put(durableKey, true);
        return "CONSUMED";
      });
    } catch {
      return "FAILED";
    }
  }
}
