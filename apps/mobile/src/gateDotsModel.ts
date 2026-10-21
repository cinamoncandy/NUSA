import type { LiveGateState } from "./liveGateModel";

/** How one readiness gate is drawn: filled (passed), hollow (still checking) or blocked (amber, breathing). Display only. */
export type GateDotKind = "PASSED" | "CHECKING" | "BLOCKED";

export function gateDotKind(state: LiveGateState): GateDotKind {
  if (state === "PASS") return "PASSED";
  if (state === "CHECKING") return "CHECKING";
  return "BLOCKED";
}
