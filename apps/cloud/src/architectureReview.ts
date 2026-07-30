export interface ArchitectureComponent {
  readonly componentId: string;
  readonly dependencies: readonly string[];
  readonly capabilities: readonly string[];
  readonly productionMutationAllowed: boolean;
  readonly credentialAccessAllowed: boolean;
}

export interface ArchitectureReviewResult {
  readonly status: "PASS" | "BLOCKED";
  readonly findings: readonly string[];
  readonly componentCount: number;
}

export const reviewArchitecture = (components: readonly ArchitectureComponent[]): ArchitectureReviewResult => {
  const ids = new Set<string>();
  const findings: string[] = [];
  for (const component of components) {
    if (!component.componentId.trim() || ids.has(component.componentId)) throw new Error("component ids must be unique");
    ids.add(component.componentId);
    if (component.productionMutationAllowed) findings.push(`PRODUCTION_MUTATION:${component.componentId}`);
    if (component.credentialAccessAllowed) findings.push(`CREDENTIAL_ACCESS:${component.componentId}`);
    for (const dependency of component.dependencies) if (!dependency.trim()) throw new Error("component dependency is required");
  }
  return Object.freeze({ status: findings.length === 0 ? "PASS" : "BLOCKED", findings: Object.freeze(findings), componentCount: components.length });
};
