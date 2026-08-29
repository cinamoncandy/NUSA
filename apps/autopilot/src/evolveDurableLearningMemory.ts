import type {
  EvolutionLearningMemoryRepository,
  EvolutionLearningRecord,
} from "./evolveLearningMemory";

export interface EvolutionLearningMemoryStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

const MEMORY_KEY = "evolve-learning-memory-v1";
const MAX_RECORDS = 256;

function isRecord(value: unknown): value is EvolutionLearningRecord {
  if (value == null || typeof value !== "object") return false;
  const record = value as Partial<EvolutionLearningRecord>;
  return typeof record.opportunityId === "string"
    && typeof record.problem === "string"
    && Array.isArray(record.evidenceReferences)
    && typeof record.hypothesis === "string"
    && typeof record.changeReference === "string"
    && typeof record.validationStatus === "string"
    && typeof record.recordedAt === "string";
}

/**
 * Durable, bounded adapter for the existing Level 7 learning-memory contract.
 *
 * This adapter owns no executor, queue, scheduler, lifecycle, promotion,
 * deployment, or production mutation authority. Callers explicitly hydrate and
 * flush it through an injected persistent storage boundary.
 */
export class DurableEvolutionLearningMemory implements EvolutionLearningMemoryRepository {
  private readonly records: EvolutionLearningRecord[];

  private constructor(records: readonly EvolutionLearningRecord[]) {
    this.records = [...records].slice(-MAX_RECORDS);
  }

  static async hydrate(storage: EvolutionLearningMemoryStorage): Promise<DurableEvolutionLearningMemory> {
    const stored = await storage.get<unknown>(MEMORY_KEY);
    if (stored == null) return new DurableEvolutionLearningMemory([]);
    if (!Array.isArray(stored) || !stored.every(isRecord)) {
      throw new Error("EVOLVE_DURABLE_MEMORY_INVALID");
    }
    return new DurableEvolutionLearningMemory(stored);
  }

  append(record: EvolutionLearningRecord): void {
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records.splice(0, this.records.length - MAX_RECORDS);
    }
  }

  list(): readonly EvolutionLearningRecord[] {
    return Object.freeze([...this.records]);
  }

  async flush(storage: EvolutionLearningMemoryStorage): Promise<void> {
    try {
      await storage.put(MEMORY_KEY, Object.freeze([...this.records]));
    } catch {
      throw new Error("EVOLVE_DURABLE_MEMORY_PERSISTENCE_FAILED");
    }
  }
}
