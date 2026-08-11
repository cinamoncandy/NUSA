import {
  type CoreStageName,
  type PlatformLayer,
  type PlatformModuleDefinition,
  type PlatformTopology,
  validatePlatformTopology
} from "./platformTopology";

export type ArchitectureFindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface ArchitectureFinding {
  readonly id: string;
  readonly severity: ArchitectureFindingSeverity;
  readonly moduleId: string | null;
  readonly message: string;
  readonly remediation: string;
}

export interface ArchitectureAuditReport {
  readonly status: "PASS" | "FAIL";
  readonly generatedAt: number;
  readonly findings: readonly ArchitectureFinding[];
  readonly criticalCount: number;
  readonly highCount: number;
  readonly automaticRemediationAllowed: false;
}

const CORE_STAGE_BY_MODULE: Readonly<Record<string, CoreStageName>> = Object.freeze({
  market: "MARKET",
  probability: "PROBABILITY",
  alpha: "ALPHA",
  portfolio: "PORTFOLIO",
  risk: "RISK",
  execution: "EXECUTION",
  runtime: "RUNTIME"
});

const REQUIRED_MODULES = Object.freeze([
  "data-knowledge",
  "market",
  "probability",
  "alpha",
  "portfolio",
  "risk",
  "execution",
  "runtime",
  "research",
  "validation",
  "learning",
  "meta-ai",
  "committee",
  "governance",
  "release",
  "operations-recorder",
  "operations-replay",
  "operations-audit",
  "operations-evidence",
  "operations-monitoring",
  "desktop",
  "mobile"
]);

const REQUIRED_SAFETY_RESPONSIBILITIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "data-knowledge": Object.freeze(["trusted data provenance", "temporal integrity"]),
  risk: Object.freeze(["independent runtime veto", "kill switch"]),
  execution: Object.freeze(["single governed execution boundary"]),
  runtime: Object.freeze(["fail closed"]),
  release: Object.freeze(["independent deployment veto"]),
  "operations-recorder": Object.freeze(["append only records"]),
  "operations-replay": Object.freeze(["read only replay"]),
  committee: Object.freeze(["human review gate"]),
  learning: Object.freeze(["no in-place production mutation"]),
  "meta-ai": Object.freeze(["no self-promotion"])
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

const finding = (
  id: string,
  severity: ArchitectureFindingSeverity,
  moduleId: string | null,
  message: string,
  remediation: string
): ArchitectureFinding => ({ id, severity, moduleId, message, remediation });

const hasResponsibility = (module: PlatformModuleDefinition, expected: string): boolean =>
  module.responsibilities.some((responsibility) => responsibility.toLowerCase().includes(expected.toLowerCase()));

const layerAllowsRealTime = (layer: PlatformLayer): boolean => layer === "CORE" || layer === "PLUGIN";

export function auditPlatformArchitecture(topology: PlatformTopology, generatedAt: number): ArchitectureAuditReport {
  if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) {
    throw new Error("generatedAt must be a non-negative safe integer");
  }

  const findings: ArchitectureFinding[] = [];
  try {
    validatePlatformTopology(topology);
  } catch (error) {
    findings.push(finding(
      "TOPOLOGY_CONTRACT_INVALID",
      "CRITICAL",
      null,
      error instanceof Error ? error.message : "platform topology validation failed",
      "Restore the approved topology contract before running or releasing the platform"
    ));
  }

  const moduleMap = new Map(topology.modules.map((module) => [module.id, module] as const));
  const pipelineIndex = new Map(topology.corePipeline.map((stage, index) => [stage, index] as const));

  for (const requiredId of REQUIRED_MODULES) {
    if (!moduleMap.has(requiredId)) {
      findings.push(finding(
        `REQUIRED_MODULE_MISSING:${requiredId}`,
        "CRITICAL",
        requiredId,
        `required platform module ${requiredId} is missing`,
        "Restore the module and its validated contract; do not substitute an implicit implementation"
      ));
    }
  }

  for (const module of topology.modules) {
    if (module.realTime && !layerAllowsRealTime(module.layer)) {
      findings.push(finding(
        `REAL_TIME_LAYER_VIOLATION:${module.id}`,
        "CRITICAL",
        module.id,
        `${module.layer} module ${module.id} is present in the real-time path`,
        "Move the module out of the per-tick path and expose an explicit non-real-time contract"
      ));
    }

    // Only modules in the canonical seven-stage real-time plane are required to map
    // one-to-one to CoreStageName. Other CORE compatibility-layer modules (for example
    // the governed Data/Knowledge fabric) are intentionally outside the fast path.
    if (module.layer === "CORE" && module.plane === "REALTIME_DECISION_EXECUTION" && module.id !== "runtime") {
      const stage = CORE_STAGE_BY_MODULE[module.id];
      const stageIndex = stage == null ? undefined : pipelineIndex.get(stage);
      if (stageIndex == null) {
        findings.push(finding(
          `UNKNOWN_CORE_STAGE:${module.id}`,
          "HIGH",
          module.id,
          `real-time core module ${module.id} is not represented in the approved pipeline`,
          "Register it through an approved architecture change or move it outside the real-time decision/execution plane"
        ));
      } else {
        for (const dependencyId of module.dependencies) {
          const dependencyStage = CORE_STAGE_BY_MODULE[dependencyId];
          const dependencyIndex = dependencyStage == null ? undefined : pipelineIndex.get(dependencyStage);
          if (dependencyIndex != null && dependencyIndex >= stageIndex) {
            findings.push(finding(
              `CORE_DIRECTION_VIOLATION:${module.id}:${dependencyId}`,
              "CRITICAL",
              module.id,
              `${module.id} depends on same-stage or downstream core module ${dependencyId}`,
              "Reverse the dependency or introduce an upstream immutable contract"
            ));
          }
        }
      }
    }

    if (module.layer === "PLUGIN") {
      for (const dependencyId of module.dependencies) {
        if (["portfolio", "risk", "execution", "runtime"].includes(dependencyId)) {
          findings.push(finding(
            `PLUGIN_BYPASS_RISK:${module.id}:${dependencyId}`,
            "CRITICAL",
            module.id,
            `plugin ${module.id} directly depends on protected downstream module ${dependencyId}`,
            "Emit a validated Alpha contract and allow Portfolio and Risk to control downstream execution"
          ));
        }
      }
    }

    if (module.layer === "APPLICATION") {
      const unsafeResponsibility = module.responsibilities.find((responsibility) =>
        /submit order|release kill|enable live|promote strategy|private api/i.test(responsibility)
      );
      if (unsafeResponsibility) {
        findings.push(finding(
          `APPLICATION_MUTATION_SURFACE:${module.id}`,
          "CRITICAL",
          module.id,
          `application ${module.id} exposes unsafe responsibility: ${unsafeResponsibility}`,
          "Keep operator applications read-only or use a separately approved command contract"
        ));
      }
    }
  }

  for (const [moduleId, expectedResponsibilities] of Object.entries(REQUIRED_SAFETY_RESPONSIBILITIES)) {
    const module = moduleMap.get(moduleId);
    if (!module) continue;
    for (const expected of expectedResponsibilities) {
      if (!hasResponsibility(module, expected)) {
        findings.push(finding(
          `SAFETY_RESPONSIBILITY_MISSING:${moduleId}:${expected}`,
          "HIGH",
          moduleId,
          `${moduleId} does not declare required safety responsibility ${expected}`,
          "Restore the explicit responsibility and its regression tests"
        ));
      }
    }
  }

  const uniqueFindings = [...new Map(findings.map((item) => [item.id, item] as const)).values()];
  const criticalCount = uniqueFindings.filter((item) => item.severity === "CRITICAL").length;
  const highCount = uniqueFindings.filter((item) => item.severity === "HIGH").length;

  return deepFreeze({
    status: criticalCount > 0 || highCount > 0 ? "FAIL" : "PASS",
    generatedAt,
    findings: uniqueFindings,
    criticalCount,
    highCount,
    automaticRemediationAllowed: false as const
  });
}
