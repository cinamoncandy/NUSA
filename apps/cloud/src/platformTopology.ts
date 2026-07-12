export type PlatformLayer = "CORE" | "CONTROL" | "OPERATIONS" | "PLUGIN" | "APPLICATION";

export type CoreStageName =
  | "MARKET"
  | "PROBABILITY"
  | "ALPHA"
  | "PORTFOLIO"
  | "RISK"
  | "EXECUTION"
  | "RUNTIME";

export type ControlTrigger =
  | "STRATEGY_REGISTERED"
  | "CHAMPION_PROMOTION_REQUESTED"
  | "RISK_LIMIT_CHANGE_REQUESTED"
  | "PAPER_TO_SHADOW_REQUESTED"
  | "POST_INCIDENT_RESUME_REQUESTED";

export interface PlatformModuleDefinition {
  readonly id: string;
  readonly layer: PlatformLayer;
  readonly realTime: boolean;
  readonly dependencies: readonly string[];
  readonly responsibilities: readonly string[];
}

export interface PlatformTopology {
  readonly corePipeline: readonly CoreStageName[];
  readonly controlTriggers: readonly ControlTrigger[];
  readonly modules: readonly PlatformModuleDefinition[];
}

const CORE_PIPELINE: readonly CoreStageName[] = Object.freeze([
  "MARKET",
  "PROBABILITY",
  "ALPHA",
  "PORTFOLIO",
  "RISK",
  "EXECUTION",
  "RUNTIME"
]);

const CONTROL_TRIGGERS: readonly ControlTrigger[] = Object.freeze([
  "STRATEGY_REGISTERED",
  "CHAMPION_PROMOTION_REQUESTED",
  "RISK_LIMIT_CHANGE_REQUESTED",
  "PAPER_TO_SHADOW_REQUESTED",
  "POST_INCIDENT_RESUME_REQUESTED"
]);

const ALLOWED_LAYER_DEPENDENCIES: Readonly<Record<PlatformLayer, readonly PlatformLayer[]>> = Object.freeze({
  CORE: Object.freeze(["CORE", "PLUGIN"]),
  CONTROL: Object.freeze(["CORE", "CONTROL", "OPERATIONS", "PLUGIN"]),
  OPERATIONS: Object.freeze(["CORE", "CONTROL", "OPERATIONS"]),
  PLUGIN: Object.freeze(["CORE", "PLUGIN"]),
  APPLICATION: Object.freeze(["CORE", "CONTROL", "OPERATIONS", "PLUGIN", "APPLICATION"])
});

const freezeTopology = (topology: PlatformTopology): PlatformTopology => {
  for (const module of topology.modules) {
    Object.freeze(module.dependencies);
    Object.freeze(module.responsibilities);
    Object.freeze(module);
  }
  Object.freeze(topology.modules);
  Object.freeze(topology.corePipeline);
  Object.freeze(topology.controlTriggers);
  return Object.freeze(topology);
};

export const createDefaultPlatformTopology = (): PlatformTopology => freezeTopology({
  corePipeline: [...CORE_PIPELINE],
  controlTriggers: [...CONTROL_TRIGGERS],
  modules: [
    { id: "market", layer: "CORE", realTime: true, dependencies: [], responsibilities: ["normalize market state"] },
    { id: "probability", layer: "CORE", realTime: true, dependencies: ["market"], responsibilities: ["fair probability", "calibration", "confidence"] },
    { id: "alpha", layer: "CORE", realTime: true, dependencies: ["probability"], responsibilities: ["edge", "spread", "signal"] },
    { id: "portfolio", layer: "CORE", realTime: true, dependencies: ["alpha"], responsibilities: ["capital allocation", "correlation", "exposure intent"] },
    { id: "risk", layer: "CORE", realTime: true, dependencies: ["market", "portfolio"], responsibilities: ["hard limits", "liquidity", "drawdown", "kill switch"] },
    { id: "execution", layer: "CORE", realTime: true, dependencies: ["market", "portfolio", "risk"], responsibilities: ["paper execution", "partial fill recovery", "rollback"] },
    { id: "runtime", layer: "CORE", realTime: true, dependencies: ["market", "probability", "alpha", "portfolio", "risk", "execution"], responsibilities: ["stage ordering", "fail closed", "snapshot publication"] },

    { id: "research", layer: "CONTROL", realTime: false, dependencies: ["market", "operations-recorder"], responsibilities: ["hypothesis", "backtest", "walk forward", "stress"] },
    { id: "validation", layer: "CONTROL", realTime: false, dependencies: ["research", "operations-replay"], responsibilities: ["paper evidence", "robustness gates"] },
    { id: "committee", layer: "CONTROL", realTime: false, dependencies: ["validation", "governance"], responsibilities: ["human review gate", "veto"] },
    { id: "governance", layer: "CONTROL", realTime: false, dependencies: ["validation", "operations-audit"], responsibilities: ["strategy lifecycle", "approval history", "rollback target"] },
    { id: "release", layer: "CONTROL", realTime: false, dependencies: ["governance", "operations-evidence"], responsibilities: ["release readiness", "paper validation"] },

    { id: "operations-recorder", layer: "OPERATIONS", realTime: false, dependencies: ["runtime"], responsibilities: ["append only records"] },
    { id: "operations-replay", layer: "OPERATIONS", realTime: false, dependencies: ["operations-recorder"], responsibilities: ["read only replay"] },
    { id: "operations-audit", layer: "OPERATIONS", realTime: false, dependencies: ["operations-recorder"], responsibilities: ["audit", "incident"] },
    { id: "operations-evidence", layer: "OPERATIONS", realTime: false, dependencies: ["operations-replay", "operations-audit"], responsibilities: ["evidence bundle", "compliance report"] },
    { id: "operations-monitoring", layer: "OPERATIONS", realTime: false, dependencies: ["runtime", "operations-recorder"], responsibilities: ["health", "latency", "freshness"] },

    { id: "funding-carry", layer: "PLUGIN", realTime: true, dependencies: ["market"], responsibilities: ["funding carry alpha"] },
    { id: "polymarket", layer: "PLUGIN", realTime: true, dependencies: ["market"], responsibilities: ["prediction market alpha"] },

    { id: "desktop", layer: "APPLICATION", realTime: false, dependencies: ["runtime", "operations-monitoring", "operations-evidence", "committee", "governance"], responsibilities: ["read only operator console"] },
    { id: "mobile", layer: "APPLICATION", realTime: false, dependencies: ["operations-monitoring", "operations-evidence"], responsibilities: ["read only status"] }
  ]
});

export const validatePlatformTopology = (topology: PlatformTopology): void => {
  if (topology.corePipeline.join(">") !== CORE_PIPELINE.join(">")) {
    throw new Error("core pipeline order must remain MARKET>PROBABILITY>ALPHA>PORTFOLIO>RISK>EXECUTION>RUNTIME");
  }

  const ids = topology.modules.map((module) => module.id);
  if (new Set(ids).size !== ids.length) throw new Error("platform module ids must be unique");
  const moduleMap = new Map(topology.modules.map((module) => [module.id, module] as const));

  for (const module of topology.modules) {
    if (!module.id.trim()) throw new Error("platform module id is required");
    if (module.responsibilities.length === 0) throw new Error(`${module.id} must declare at least one responsibility`);
    if (module.layer === "CONTROL" && module.realTime) throw new Error(`${module.id} control module cannot be in the real-time path`);
    if (module.layer === "OPERATIONS" && module.realTime) throw new Error(`${module.id} operations module cannot be in the real-time path`);
    if (module.layer === "APPLICATION" && module.realTime) throw new Error(`${module.id} application cannot be in the real-time path`);

    for (const dependencyId of module.dependencies) {
      const dependency = moduleMap.get(dependencyId);
      if (!dependency) throw new Error(`${module.id} references unknown dependency ${dependencyId}`);
      if (!ALLOWED_LAYER_DEPENDENCIES[module.layer].includes(dependency.layer)) {
        throw new Error(`${module.layer} module ${module.id} cannot depend on ${dependency.layer} module ${dependency.id}`);
      }
    }
  }

  const committee = moduleMap.get("committee");
  if (!committee || committee.layer !== "CONTROL" || committee.realTime) {
    throw new Error("committee must remain a non-real-time control module");
  }

  const runtime = moduleMap.get("runtime");
  if (!runtime || runtime.layer !== "CORE" || !runtime.realTime) {
    throw new Error("runtime must remain a real-time core module");
  }

  if (topology.controlTriggers.join(">") !== CONTROL_TRIGGERS.join(">")) {
    throw new Error("control trigger contract changed unexpectedly");
  }
};
