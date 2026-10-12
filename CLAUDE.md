# CLAUDE.md

This repository's rules for every agent are in [`AGENTS.md`](AGENTS.md). Read and follow it first; this file only adds
Claude Code specifics and cannot override it.

1. Start with the AIPOS recovery steps in `AGENTS.md` (`.aipos/aipos.yaml`, `.aipos/state.yaml`, the active work order).
   The repository, not the conversation, is the source of truth.
2. Read `docs/CLAUDE_HANDOFF_2026-10-12.md` for the current state and the next safe actions.
3. For autonomous engineering, CI/PR handling and deployment, follow `docs/NUSA_CORE_MASTER_INSTRUCTIONS.md`.
4. Safety is not negotiable: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`,
   `aiAuthority=ZERO_AUTHORITY`. Never merge or approve your own PR, never bypass Audit or Release, and never loosen
   risk limits, thresholds or capital.
5. One task is one branch and one PR. Search for an existing open PR first and continue it; do not open a duplicate.
   Run the relevant tests and `pnpm run preflight` (or the validators listed in the work order) before any push.
6. In the cloud sandbox, tests run from the compiled `dist/` output (`npx tsc -p tsconfig.json`, then
   `node -r ./tests/register-dist.cjs --test <file>`). `check-runtime` and `validate:full` need Node 24 and are left to CI.
   A stale `dist/**/*.test.js` file with no matching source is not a real failure.
7. Report what was and was not verified. If CI fails on a stale head or a transient GitHub 5xx, say so rather than
   changing code to fit it.
