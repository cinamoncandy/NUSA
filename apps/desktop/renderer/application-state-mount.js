window.NUSAApplicationState.mount(document, window);

// Keep the Shadow signal-risk verdict distinct from the final execution Risk Gateway.
// The latter remains fail-closed; this only corrects operator-facing semantics.
const shadowRiskStage = window.NUSAControlRoom?.STAGES?.find((stage) => stage.key === "riskGateway");
if (shadowRiskStage) shadowRiskStage.name = "신호 리스크 판단";

// renderer.js mounts the Control Room before this script runs, so correct the already-rendered
// first frame as well. Subsequent refreshes use the canonical STAGES object above.
for (const label of document.querySelectorAll(".cr-stage__name")) {
  if (label.textContent === "Risk Gateway") label.textContent = "신호 리스크 판단";
}

// Presentation-only decision continuity layer. Some semantic test harnesses intentionally
// provide a minimal document without querySelector/createElement/body; skip presentation
// mounting there while retaining the production browser path.
if (
  typeof document.querySelector === "function" &&
  typeof document.createElement === "function" &&
  document.body &&
  !document.querySelector('script[src="decision-flow-rail.js"]')
) {
  const decisionFlowScript = document.createElement("script");
  decisionFlowScript.src = "decision-flow-rail.js";
  document.body.append(decisionFlowScript);
}
