export type FeatureCategory =
  | "MARKET_STATE"
  | "FUNDING"
  | "BASIS"
  | "OPEN_INTEREST"
  | "ORDER_BOOK"
  | "LIQUIDATION"
  | "VOLATILITY"
  | "TREND";

export type FeatureLifecycle = "DRAFT" | "VALIDATED" | "ACTIVE" | "DEPRECATED" | "RETIRED";
export type MissingDataPolicy = "REJECT" | "SKIP" | "ZERO";
export type LatencyClass = "REALTIME" | "NEAR_REALTIME" | "BATCH";

export interface FeatureSchemaField {
  readonly name: string;
  readonly type: "number" | "string" | "boolean" | "timestamp";
  readonly required: boolean;
}

export interface FeatureDefinition {
  readonly featureId: string;
  readonly version: number;
  readonly owner: string;
  readonly category: FeatureCategory;
  readonly description: string;
  readonly inputSchema: readonly FeatureSchemaField[];
  readonly outputSchema: readonly FeatureSchemaField[];
  readonly lookbackMs: number;
  readonly updateFrequencyMs: number;
  readonly latencyClass: LatencyClass;
  readonly freshnessRequirementMs: number;
  readonly missingDataPolicy: MissingDataPolicy;
  readonly provenance: readonly string[];
  readonly validationStatus: "UNVALIDATED" | "VALIDATED";
  readonly lifecycleStatus: FeatureLifecycle;
  readonly dependencies: readonly string[];
  readonly createdAt: number;
  readonly retiredAt?: number;
}

export interface FeatureCalculationRecord {
  readonly featureId: string;
  readonly featureVersion: number;
  readonly engineVersion: string;
  readonly inputSnapshotId: string;
  readonly generatedAt: number;
  readonly source: string;
  readonly value: number;
}

const keyOf = (featureId: string, version: number): string => `${featureId}@${version}`;

const deepFreezeDefinition = (definition: FeatureDefinition): FeatureDefinition => {
  for (const field of definition.inputSchema) Object.freeze(field);
  for (const field of definition.outputSchema) Object.freeze(field);
  Object.freeze(definition.inputSchema);
  Object.freeze(definition.outputSchema);
  Object.freeze(definition.provenance);
  Object.freeze(definition.dependencies);
  return Object.freeze(definition);
};

const validateDefinition = (definition: FeatureDefinition): void => {
  if (!definition.featureId.trim()) throw new Error("featureId is required");
  if (!Number.isInteger(definition.version) || definition.version < 1) throw new Error("feature version must be a positive integer");
  if (!definition.owner.trim()) throw new Error("feature owner is required");
  if (!definition.description.trim()) throw new Error("feature description is required");
  if (definition.inputSchema.length === 0) throw new Error("input schema is required");
  if (definition.outputSchema.length === 0) throw new Error("output schema is required");
  if (!Number.isFinite(definition.lookbackMs) || definition.lookbackMs < 0) throw new Error("lookbackMs must be non-negative");
  if (!Number.isFinite(definition.updateFrequencyMs) || definition.updateFrequencyMs <= 0) throw new Error("updateFrequencyMs must be positive");
  if (!Number.isFinite(definition.freshnessRequirementMs) || definition.freshnessRequirementMs <= 0) throw new Error("freshnessRequirementMs must be positive");
  if (!Number.isFinite(definition.createdAt) || definition.createdAt <= 0) throw new Error("createdAt must be positive");
  if (definition.retiredAt !== undefined && definition.retiredAt < definition.createdAt) throw new Error("retiredAt cannot precede createdAt");
  if (definition.lifecycleStatus === "RETIRED" && definition.retiredAt === undefined) throw new Error("retired feature requires retiredAt");
  if (definition.lifecycleStatus !== "RETIRED" && definition.retiredAt !== undefined) throw new Error("only retired feature may include retiredAt");
  if (new Set(definition.dependencies).size !== definition.dependencies.length) throw new Error("feature dependencies must be unique");
};

export class FeatureRegistry {
  private readonly definitions = new Map<string, FeatureDefinition>();

  register(definition: FeatureDefinition): FeatureDefinition {
    validateDefinition(definition);
    const key = keyOf(definition.featureId, definition.version);
    if (this.definitions.has(key)) throw new Error(`feature definition already exists: ${key}`);
    for (const dependency of definition.dependencies) {
      if (!this.definitions.has(dependency)) throw new Error(`unknown feature dependency: ${dependency}`);
    }
    const frozen = deepFreezeDefinition({
      ...definition,
      inputSchema: definition.inputSchema.map((field) => ({ ...field })),
      outputSchema: definition.outputSchema.map((field) => ({ ...field })),
      provenance: [...definition.provenance],
      dependencies: [...definition.dependencies]
    });
    this.definitions.set(key, frozen);
    this.assertAcyclic();
    return frozen;
  }

  get(featureId: string, version: number): FeatureDefinition {
    const definition = this.definitions.get(keyOf(featureId, version));
    if (!definition) throw new Error(`feature definition not found: ${featureId}@${version}`);
    return definition;
  }

  list(): readonly FeatureDefinition[] {
    return Object.freeze([...this.definitions.values()]);
  }

  search(query: string): readonly FeatureDefinition[] {
    const normalized = query.trim().toLowerCase();
    return Object.freeze(this.list().filter((definition) =>
      definition.featureId.toLowerCase().includes(normalized)
      || definition.description.toLowerCase().includes(normalized)
      || definition.category.toLowerCase().includes(normalized)));
  }

  compare(featureId: string, leftVersion: number, rightVersion: number): Readonly<{ left: FeatureDefinition; right: FeatureDefinition }> {
    return Object.freeze({ left: this.get(featureId, leftVersion), right: this.get(featureId, rightVersion) });
  }

  deriveLifecycleVersion(featureId: string, version: number, lifecycleStatus: FeatureLifecycle, changedAt: number): FeatureDefinition {
    const current = this.get(featureId, version);
    const nextVersion = Math.max(...this.list().filter((item) => item.featureId === featureId).map((item) => item.version)) + 1;
    return this.register({
      ...current,
      version: nextVersion,
      lifecycleStatus,
      validationStatus: lifecycleStatus === "VALIDATED" || lifecycleStatus === "ACTIVE" ? "VALIDATED" : current.validationStatus,
      createdAt: changedAt,
      retiredAt: lifecycleStatus === "RETIRED" ? changedAt : undefined
    });
  }

  private assertAcyclic(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string): void => {
      if (visiting.has(key)) throw new Error(`feature dependency cycle detected at ${key}`);
      if (visited.has(key)) return;
      visiting.add(key);
      const definition = this.definitions.get(key);
      for (const dependency of definition?.dependencies ?? []) visit(dependency);
      visiting.delete(key);
      visited.add(key);
    };
    for (const key of this.definitions.keys()) visit(key);
  }
}

export const validateFeatureCalculation = (
  registry: FeatureRegistry,
  record: FeatureCalculationRecord,
  now: number
): void => {
  const definition = registry.get(record.featureId, record.featureVersion);
  if (definition.lifecycleStatus !== "ACTIVE" && definition.lifecycleStatus !== "VALIDATED") {
    throw new Error("feature calculation requires validated or active definition");
  }
  if (!record.engineVersion.trim()) throw new Error("engineVersion is required");
  if (!record.inputSnapshotId.trim()) throw new Error("inputSnapshotId is required");
  if (!record.source.trim()) throw new Error("source is required");
  if (!Number.isFinite(record.value)) throw new Error("feature value must be finite");
  if (!Number.isFinite(record.generatedAt) || record.generatedAt > now) throw new Error("feature calculation cannot use future time");
  if (now - record.generatedAt > definition.freshnessRequirementMs) throw new Error("feature calculation is stale");
};

const numberField = (name: string): FeatureSchemaField => Object.freeze({ name, type: "number", required: true });

export const createInitialFeatureDefinitions = (createdAt: number): readonly FeatureDefinition[] => Object.freeze([
  { featureId: "funding-z-score", version: 1, owner: "research", category: "FUNDING", description: "Normalized funding-rate deviation", inputSchema: [numberField("fundingRate"), numberField("mean"), numberField("stdDev")], outputSchema: [numberField("value")], lookbackMs: 86_400_000, updateFrequencyMs: 60_000, latencyClass: "NEAR_REALTIME", freshnessRequirementMs: 120_000, missingDataPolicy: "REJECT", provenance: ["funding-rate"], validationStatus: "VALIDATED", lifecycleStatus: "ACTIVE", dependencies: [], createdAt },
  { featureId: "basis", version: 1, owner: "research", category: "BASIS", description: "Perpetual minus spot basis", inputSchema: [numberField("perpPrice"), numberField("spotPrice")], outputSchema: [numberField("value")], lookbackMs: 0, updateFrequencyMs: 1_000, latencyClass: "REALTIME", freshnessRequirementMs: 5_000, missingDataPolicy: "REJECT", provenance: ["spot", "perpetual"], validationStatus: "VALIDATED", lifecycleStatus: "ACTIVE", dependencies: [], createdAt },
  { featureId: "open-interest-delta", version: 1, owner: "research", category: "OPEN_INTEREST", description: "Change in open interest", inputSchema: [numberField("current"), numberField("previous")], outputSchema: [numberField("value")], lookbackMs: 300_000, updateFrequencyMs: 5_000, latencyClass: "NEAR_REALTIME", freshnessRequirementMs: 15_000, missingDataPolicy: "REJECT", provenance: ["open-interest"], validationStatus: "VALIDATED", lifecycleStatus: "ACTIVE", dependencies: [], createdAt },
  { featureId: "order-book-imbalance", version: 1, owner: "research", category: "ORDER_BOOK", description: "Bid versus ask depth imbalance", inputSchema: [numberField("bidDepth"), numberField("askDepth")], outputSchema: [numberField("value")], lookbackMs: 0, updateFrequencyMs: 250, latencyClass: "REALTIME", freshnessRequirementMs: 2_000, missingDataPolicy: "REJECT", provenance: ["order-book"], validationStatus: "VALIDATED", lifecycleStatus: "ACTIVE", dependencies: [], createdAt },
  { featureId: "microprice", version: 1, owner: "research", category: "ORDER_BOOK", description: "Size-weighted top-of-book microprice", inputSchema: [numberField("bidPrice"), numberField("askPrice"), numberField("bidSize"), numberField("askSize")], outputSchema: [numberField("value")], lookbackMs: 0, updateFrequencyMs: 250, latencyClass: "REALTIME", freshnessRequirementMs: 2_000, missingDataPolicy: "REJECT", provenance: ["order-book"], validationStatus: "VALIDATED", lifecycleStatus: "ACTIVE", dependencies: [], createdAt },
  { featureId: "spread-velocity", version: 1, owner: "research", category: "ORDER_BOOK", description: "Rate of spread change", inputSchema: [numberField("currentSpread"), numberField("previousSpread")], outputSchema: [numberField("value")], lookbackMs: 60_000, updateFrequencyMs: 1_000, latencyClass: "REALTIME", freshnessRequirementMs: 5_000, missingDataPolicy: "REJECT", provenance: ["order-book"], validationStatus: "VALIDATED", lifecycleStatus: "ACTIVE", dependencies: [], createdAt },
  { featureId: "realized-volatility", version: 1, owner: "research", category: "VOLATILITY", description: "Rolling realized volatility", inputSchema: [numberField("returns")], outputSchema: [numberField("value")], lookbackMs: 3_600_000, updateFrequencyMs: 60_000, latencyClass: "NEAR_REALTIME", freshnessRequirementMs: 120_000, missingDataPolicy: "REJECT", provenance: ["completed-candles"], validationStatus: "VALIDATED", lifecycleStatus: "ACTIVE", dependencies: [], createdAt },
  { featureId: "liquidation-intensity", version: 1, owner: "research", category: "LIQUIDATION", description: "Liquidation notional per unit time", inputSchema: [numberField("notional"), numberField("windowMs")], outputSchema: [numberField("value")], lookbackMs: 300_000, updateFrequencyMs: 5_000, latencyClass: "NEAR_REALTIME", freshnessRequirementMs: 15_000, missingDataPolicy: "REJECT", provenance: ["liquidation-feed"], validationStatus: "VALIDATED", lifecycleStatus: "ACTIVE", dependencies: [], createdAt }
]);