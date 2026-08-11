export type PlatformLayer = "CORE" | "CONTROL" | "OPERATIONS" | "PLUGIN" | "APPLICATION";

/**
 * Canonical whole-system planes from docs/architecture/NUSA_CANONICAL_ARCHITECTURE_V2.md.
 * `layer` remains as a compatibility classification while migration is in progress;
 * `plane` is the authoritative architecture classification for new work.
 */
export type PlatformPlane =
  | "REALTIME_DECISION_EXECUTION"
  | "DATA_KNOWLEDGE"
  | "RESEARCH_AI_LEARNING"
  | "EVIDENCE_OPERATIONS"
  | "CONTROL_RELEASE"
  | "APPLICATIONS";

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
  readonly plane: PlatformPlane;
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

const layers = (...values: PlatformLayer[]): readonly PlatformLayer[] => Object.freeze(values);

const ALLOWED_LAYER_DEPENDENCIES: Readonly<Record<PlatformLayer, readonly PlatformLayer[]>> = Object.freeze({
  CORE: layers("CORE", "PLUGIN"),
  CONTROL: layers("CORE", "CONTROL", "OPERATIONS", "PLUGIN"),
  OPERATIONS: layers("CORE", "CONTROL", "OPERATIONS"),
  PLUGIN: layers("CORE", "PLUGIN"),
  APPLICATION: layers("CORE", "CONTROL", "OPERATIONS", "PLUGIN", "APPLICATION")
});

const CANONICAL_PLANES: readonly PlatformPlane[] = Object.freeze([
  "REALTIME_DECISION_EXECUTION",
  "DATA_KNOWLEDGE",
  "RESEARCH_AI_LEARNING",
  "EVIDENCE_OPERATIONS",
  "CONTROL_RELEASE",
  "APPLICATIONS"
]);

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
    { id: "data-knowledge", layer: "CORE", plane: "DATA_KNOWLEDGE", realTime: false, dependencies: [], responsibilities: ["trusted data provenance", "point-in-time knowledge", "temporal integrity"] },

    { id: "market", layer: "CORE", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["data-knowledge"], responsibilities: ["normalize market state"] },
    { id: "probability", layer: "CORE", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["market"], responsibilities: ["fair probability", "calibration", "confidence"] },
    { id: "alpha", layer: "CORE", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["probability"], responsibilities: ["execute approved alpha capabilities", "edge", "spread", "signal"] },
    { id: "portfolio", layer: "CORE", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["alpha"], responsibilities: ["apply approved capital budgets", "correlation", "exposure intent"] },
    { id: "risk", layer: "CORE", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["market", "portfolio"], responsibilities: ["independent runtime veto", "hard limits", "liquidity", "drawdown", "kill switch"] },
    { id: "execution", layer: "CORE", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["market", "portfolio", "risk"], responsibilities: ["single governed execution boundary", "paper execution", "partial fill recovery", "rollback"] },
    { id: "runtime", layer: "CORE", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["market", "probability", "alpha", "portfolio", "risk", "execution"], responsibilities: ["stage ordering", "fail closed", "snapshot publication"] },

    { id: "research", layer: "CONTROL", plane: "RESEARCH_AI_LEARNING", realTime: false, dependencies: ["market", "operations-recorder"], responsibilities: ["hypothesis", "strategy discovery", "backtest", "walk forward", "stress"] },
    { id: "validation", layer: "CONTROL", plane: "RESEARCH_AI_LEARNING", realTime: false, dependencies: ["research", "operations-replay"], responsibilities: ["independent evaluation", "paper evidence", "robustness gates"] },
    { id: "learning", layer: "CONTROL", plane: "RESEARCH_AI_LEARNING", realTime: false, dependencies: ["validation", "operations-evidence"], responsibilities: ["candidate generation", "attribution", "drift analysis", "no in-place production mutation"] },
    { id: "meta-ai", layer: "CONTROL", plane: "RESEARCH_AI_LEARNING", realTime: false, dependencies: ["validation", "learning"], responsibilities: ["challenger recommendation", "benchmark orchestration", "no self-promotion"] },

    { id: "committee", layer: "CONTROL", plane: "CONTROL_RELEASE", realTime: false, dependencies: ["validation", "governance"], responsibilities: ["human review gate", "veto"] },
    { id: "governance", layer: "CONTROL", plane: "CONTROL_RELEASE", realTime: false, dependencies: ["validation", "operations-audit"], responsibilities: ["strategy lifecycle", "approval history", "rollback target"] },
    { id: "release", layer: "CONTROL", plane: "CONTROL_RELEASE", realTime: false, dependencies: ["governance", "operations-evidence"], responsibilities: ["independent deployment veto", "release readiness", "paper validation"] },

    { id: "operations-recorder", layer: "OPERATIONS", plane: "EVIDENCE_OPERATIONS", realTime: false, dependencies: ["runtime"], responsibilities: ["append only records"] },
    { id: "operations-replay", layer: "OPERATIONS", plane: "EVIDENCE_OPERATIONS", realTime: false, dependencies: ["operations-recorder"], responsibilities: ["read only replay"] },
    { id: "operations-audit", layer: "OPERATIONS", plane: "EVIDENCE_OPERATIONS", realTime: false, dependencies: ["operations-recorder"], responsibilities: ["audit", "incident"] },
    { id: "operations-evidence", layer: "OPERATIONS", plane: "EVIDENCE_OPERATIONS", realTime: false, dependencies: ["operations-replay", "operations-audit"], responsibilities: ["evidence bundle", "compliance report"] },
    { id: "operations-monitoring", layer: "OPERATIONS", plane: "EVIDENCE_OPERATIONS", realTime: false, dependencies: ["runtime", "operations-recorder"], responsibilities: ["health", "latency", "freshness"] },

    { id: "funding-carry", layer: "PLUGIN", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["market"], responsibilities: ["approved funding carry alpha capability"] },
    { id: "polymarket", layer: "PLUGIN", plane: "REALTIME_DECISION_EXECUTION", realTime: true, dependencies: ["market"], responsibilities: ["approved prediction market alpha capability"] },

    { id: "desktop", layer: "APPLICATION", plane: "APPLICATIONS", realTime: false, dependencies: ["runtime", "operations-monitoring", "operations-evidence", "committee", "governance"], responsibilities: ["operator console", "governed action requests only"] },
    { id: "mobile", layer: "APPLICATION", plane: "APPLICATIONS", realTime: false, dependencies: ["operations-monitoring", "operations-evidence"], responsibilities: ["operator status", "governed action requests only"] }
  ]
});

export const validatePlatformTopology = (topology: PlatformTopology): void => {
  if (topology.corePipeline.join(">") !== CORE_PIPELINE.join(">")) {
    throw new Error("core pipeline order must remain MARKET>PROBABILITY>ALPHA>PORTFOLIO>RISK>EXECUTION>RUNTIME");
  }

  const ids = topology.modules.map((module) => module.id);
  if (new Set(ids).size !== ids.length) throw new Error("platform module ids must be unique");
  const moduleMap = new Map(topology.modules.map((module) => [module.id, module] as const));

  const representedPlanes = new Set(topology.modules.map((module) => module.plane));
  for (const plane of CANONICAL_PLANES) {
    if (!representedPlanes.has(plane)) throw new Error(`canonical plane ${plane} must be represented`);
  }

  for (const module of topology.modules) {
    if (!module.id.trim()) throw new Error("platform module id is required");
    if (module.responsibilities.length === 0) throw new Error(`${module.id} must declare at least one responsibility`);
    if (module.layer === "CONTROL" && module.realTime) throw new Error(`${module.id} control module cannot be in the real-time path`);
    if (module.layer === "OPERATIONS" && module.realTime) throw new Error(`${module.id} operations module cannot be in the real-time path`);
    if (module.layer === "APPLICATION" && module.realTime) throw new Error(`${module.id} application cannot be in the real-time path`);
    if (module.plane === "RESEARCH_AI_LEARNING" && module.realTime) throw new Error(`${module.id} research/AI/learning module cannot be in the real-time path`);
    if (module.plane === "CONTROL_RELEASE" && module.realTime) throw new Error(`${module.id} control/release module cannot be in the real-time path`);
    if (module.plane === "EVIDENCE_OPERATIONS" && module.realTime) throw new Error(`${module.id} evidence/operations module cannot be in the real-time path`);
    if (module.plane === "APPLICATIONS" && module.realTime) throw new Error(`${module.id} application-plane module cannot be in the real-time path`);

    for (const dependencyId of module.dependencies) {
      const dependency = moduleMap.get(dependencyId);
      if (!dependency) throw new Error(`${module.id} references unknown dependency ${dependencyId}`);
      if (!ALLOWED_LAYER_DEPENDENCIES[module.layer].includes(dependency.layer)) {
        throw new Error(`${module.layer} module ${module.id} cannot depend on ${dependency.layer} module ${dependency.id}`);
      }
    }
  }

  const committee = moduleMap.get("committee");
  if (!committee || committee.plane !== "CONTROL_RELEASE" || committee.realTime) {
    throw new Error("committee must remain a non-real-time control/release module");
  }

  const risk = moduleMap.get("risk");
  if (!risk || risk.plane !== "REALTIME_DECISION_EXECUTION" || !risk.realTime) {
    throw new Error("risk must remain an independent real-time veto stage");
  }

  const execution = moduleMap.get("execution");
  if (!execution || execution.plane !== "REALTIME_DECISION_EXECUTION" || !execution.realTime) {
    throw new Error("execution must remain the governed real-time execution boundary");
  }

  const release = moduleMap.get("release");
  if (!release || release.plane !== "CONTROL_RELEASE" || release.realTime) {
    throw new Error("release must remain an independent non-real-time deployment authority");
  }

  const runtime = moduleMap.get("runtime");
  if (!runtime || runtime.layer !== "CORE" || runtime.plane !== "REALTIME_DECISION_EXECUTION" || !runtime.realTime) {
    throw new Error("runtime must remain a real-time core module");
  }

  const metaAi = moduleMap.get("meta-ai");
  if (!metaAi || metaAi.plane !== "RESEARCH_AI_LEARNING" || metaAi.realTime) {
    throw new Error("meta-ai must remain a non-real-time research/AI/learning module");
  }

  if (topology.controlTriggers.join(">") !== CONTROL_TRIGGERS.join(">")) {
    throw new Error("control trigger contract changed unexpectedly");
  }
};
