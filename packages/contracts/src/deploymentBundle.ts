export type DeploymentBundleStatus = "CANDIDATE" | "VERIFIED" | "RETIRED";

export interface DeploymentArtifactRef {
  readonly artifactId: string;
  readonly sha256: string;
}

export interface CapabilityDeploymentBundle {
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly capabilityId: string;
  readonly contractVersion: string;
  readonly implementationId: string;
  readonly implementationVersion: string;
  readonly strategyIdentity?: string;
  readonly datasetIdentities: readonly string[];
  readonly featureSetIdentities: readonly string[];
  readonly modelRefs: readonly string[];
  readonly promptRefs: readonly string[];
  readonly toolRefs: readonly string[];
  readonly policyRefs: readonly string[];
  readonly configHash: string;
  readonly artifact: DeploymentArtifactRef;
  readonly rollbackBundleId?: string;
  readonly compatibility: {
    readonly rollbackReady: boolean;
    readonly compatibleWith: readonly string[];
  };
  readonly status: DeploymentBundleStatus;
}

export interface DeploymentPromotionRecord {
  readonly bundleId: string;
  readonly promotionArtifactSha256: string;
  readonly runtimeArtifactSha256: string;
  readonly recommendation: "PROMOTE" | "HOLD" | "ROLLBACK";
  readonly productionMutationAuthorized: false;
}

export interface DeploymentBundleRegistry {
  readonly schema: "nusa.deployment-bundle-registry/v1";
  readonly bundles: readonly CapabilityDeploymentBundle[];
  readonly promotions: readonly DeploymentPromotionRecord[];
}
