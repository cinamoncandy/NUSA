# Claude-centered operating model (PROPOSED)

Status: PROPOSED, awaiting owner decisions. Owner request 2026-10-13: move from a ChatGPT/Codex-centered process to a Claude-centered one and redesign the whole operating model while recording it in AIPOS.

Decision proposed: keep every safety invariant, the deterministic control plane ("rules decide, AI repairs"), independent Audit and the release bot unchanged, and reassign the AI roles: a main Claude (owner's main Claude account) for design and larger implementation, an assistant Claude (this session's account) for verification, operations, research, AIPOS records, small changes and independent review of the main Claude's PRs, and Autopilot for bounded light repairs (150 changed lines, one file) gated by owner activity. Author and reviewer must be different sessions and different GitHub accounts. Work is claimed in `state.yaml` (`claimed_by`) to stop parallel duplicate PRs.

Required before adoption: separate GitHub identities for the main side and the assistant/automation side; stop Autopilot from re-dispatching repairs for failures of its own engine workflows; keep the Autopilot engine on free Workers AI unless the owner approves a paid Claude engine with a cap.

Rationale: the Codex coding workflow failed repeatedly and caused notification floods, the Codex review bot hit its usage limit, and duplicate work appeared when two engines touched the same task. Details, migration phases P0-P5 and the six owner decisions: `docs/CLAUDE_CENTERED_OPERATING_MODEL.md`.

Not changed: PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY, risk limits (consecutive-loss limit 3), Audit and Release authority, AIPOS vendor neutrality.
