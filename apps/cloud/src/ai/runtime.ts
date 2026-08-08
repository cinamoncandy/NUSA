import type { ModelProvider } from "../../../../packages/contracts/src/aiInference";
import { createModelProviderFromEnvironment } from "./modelProvider";
import { MultiAgentOrchestrator } from "./multiAgentOrchestrator";

export interface CloudAiRuntime {
  readonly enabled: boolean;
  readonly orchestrator: MultiAgentOrchestrator;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export function createCloudAiRuntime(env: NodeJS.ProcessEnv = process.env, provider: ModelProvider = createModelProviderFromEnvironment(env)): CloudAiRuntime {
  const enabled = env.NUSA_AI_ENABLED?.trim().toLowerCase() === "true";
  return Object.freeze({ enabled, orchestrator: new MultiAgentOrchestrator(provider, { enabled }), liveAuthority: "NONE", productionMutationAllowed: false });
}
