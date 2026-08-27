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
