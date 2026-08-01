# Recovery Context

## Human intent

The human is building NUSA. AIPOS exists so NUSA can be continued by ChatGPT, Claude, Gemini, Codex, Cursor, Windsurf, Kimi, or another capable AI without reconstructing prior conversations.

## Required first action

Read, in order:

1. `.aipos/aipos.yaml`
2. `.aipos/state.yaml`
3. `.aipos/architecture.md`
4. the active work order referenced by state
5. relevant decisions under `.aipos/decisions/`
6. implementation and tests referenced by the work order

## Operating protocol

1. Recover repository state.
2. Analyze only the active objective and constraints.
3. Select the highest-priority ready work order.
4. Implement the smallest complete change satisfying its acceptance criteria.
5. Run the recorded verification commands.
6. Update work order status and `.aipos/state.yaml` with evidence.
7. Stop. Do not invent the next objective.

## Current product context

NUSA currently contains a Windows Electron paper-trading and deterministic research platform. The codebase is TypeScript and uses pnpm. A lifecycle-aware runtime foundation already exists in `packages/core/src`.

The current AIPOS package is intentionally narrow. It supports NUSA's immediate continuity needs: project state, work orders, decisions, semantic validation, deterministic recovery, and runtime integration.

## Non-negotiable boundaries

- Repository state outranks remembered conversation state.
- Do not enable live trading mutation.
- Do not weaken fail-closed behavior.
- Do not create speculative infrastructure not required by an accepted work order.
- Do not silently change architecture; record a decision first.
- Do not mark work complete without verification evidence.
