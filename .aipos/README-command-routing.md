# AIPOS command routing

CORE directives are recorded under `.aipos/commands/` and interpreted through `.aipos/command-routing.yaml`.

Execution agents must:

1. read `.aipos/aipos.yaml` and `.aipos/AI_HANDOFF_CONTRACT.md`;
2. read `.aipos/command-routing.yaml`;
3. select the highest-priority READY command for their active role;
4. reuse the canonical owner/branch/PR when one already exists;
5. write durable evidence and update status before handoff;
6. preserve author/non-author validation separation.

Provider identity is not canonical ownership. Codex, Claude Code, MiMo, or another capable model may execute a role when available, but role boundaries and evidence requirements remain unchanged.
