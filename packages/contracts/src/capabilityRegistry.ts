export type CapabilityFailureMode = "FAIL_CLOSED" | "DEGRADE" | "RETRY";

export interface CapabilitySchemaReference {
  readonly input: string;
  readonly output: string;
}

export interface CapabilityFailureSemantics {
  readonly mode: CapabilityFailureMode;
  readonly timeoutMs: number;
  readonly retryable: boolean;
  readonly unknownIsFailure: boolean;
}

export interface CapabilityEvidenceRequirements {
  readonly provenanceRequired: boolean;
  readonly implementationVersionRequired: boolean;
  readonly inputVersionRequired: boolean;
  readonly outputHashRequired: boolean;
}

export interface CapabilityContract {
  readonly capabilityId: string;
  readonly contractVersion: string;
  readonly schemas: CapabilitySchemaReference;
  readonly failure: CapabilityFailureSemantics;
  readonly permissions: readonly string[];
  readonly evidence: CapabilityEvidenceRequirements;
  readonly rollbackCompatibleWith: readonly string[];
}

export interface CapabilityImplementationBinding {
  readonly implementationId: string;
  readonly capabilityId: string;
  readonly contractVersion: string;
  readonly provider: string;
  readonly implementationVersion: string;
  readonly status: "CHALLENGER" | "APPROVED" | "RETIRED";
}

export interface CapabilityContractRegistry {
  readonly version: 1;
  readonly contracts: readonly CapabilityContract[];
  readonly implementations: readonly CapabilityImplementationBinding[];
}

export function capabilityContractKey(capabilityId: string, contractVersion: string): string {
  return `${capabilityId}@${contractVersion}`;
}

export function findCapabilityContract(
  registry: CapabilityContractRegistry,
  capabilityId: string,
  contractVersion: string,
): CapabilityContract | undefined {
  return registry.contracts.find(
    (contract) => contract.capabilityId === capabilityId && contract.contractVersion === contractVersion,
  );
}

export function bindingsForCapability(
  registry: CapabilityContractRegistry,
  capabilityId: string,
  contractVersion: string,
): readonly CapabilityImplementationBinding[] {
  return registry.implementations.filter(
    (binding) => binding.capabilityId === capabilityId && binding.contractVersion === contractVersion,
  );
}
