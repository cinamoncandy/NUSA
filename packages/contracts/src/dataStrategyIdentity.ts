export interface TemporalIdentityContract {
  readonly eventTimeField: string;
  readonly receivedTimeField: string;
  readonly modelAvailableTimeField: string;
  readonly ordering: "EVENT_LE_RECEIVED_LE_MODEL_AVAILABLE";
}

export interface DatasetIdentity {
  readonly id: string;
  readonly version: string;
  readonly source: string;
  readonly schemaVersion: string;
  readonly provenance: readonly string[];
  readonly temporal: TemporalIdentityContract;
  readonly contentHash: string;
  readonly snapshotId: string;
  readonly canonicalHash: string;
}

export interface IdentityReference {
  readonly id: string;
  readonly version: string;
  readonly canonicalHash: string;
}

export interface FeatureDefinitionIdentity {
  readonly name: string;
  readonly version: string;
}

export interface FeatureSetIdentity {
  readonly id: string;
  readonly version: string;
  readonly definitions: readonly FeatureDefinitionIdentity[];
  readonly sourceDatasets: readonly IdentityReference[];
  readonly availabilitySemantics: "MODEL_AVAILABLE_TIME";
  readonly canonicalHash: string;
}

export interface CapabilityIdentityReference {
  readonly id: string;
  readonly contractVersion: string;
  readonly implementationId?: string;
}

export interface StrategyIdentity {
  readonly id: string;
  readonly version: string;
  readonly genome: Readonly<Record<string, unknown>>;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly featureSets: readonly IdentityReference[];
  readonly datasets: readonly IdentityReference[];
  readonly capabilities: readonly CapabilityIdentityReference[];
  readonly models: readonly string[];
  readonly tools: readonly string[];
  readonly objectivePolicyVersion: string;
  readonly canonicalHash: string;
}

export interface DataStrategyIdentityRegistry {
  readonly version: 1;
  readonly datasets: readonly DatasetIdentity[];
  readonly featureSets: readonly FeatureSetIdentity[];
  readonly strategies: readonly StrategyIdentity[];
}
