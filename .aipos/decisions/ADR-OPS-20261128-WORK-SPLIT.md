# ADR-OPS-20261128: work split between Claude (CORE) and ChatGPT/Codex (implementer)

Status: **ACCEPTED by the owner in chat, 2026-11-28** ("챗지피티는 구현도 할거야 너는 설계와 디자인 그리고 핵심기능을 맡을거야"). Safety is unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. Neither AI merges or approves its own PR; merges go through the release path or the owner.

## Ownership
| Area | Owner | Paths (indicative) |
|---|---|---|
| Design: architecture, Alpha Lab design, pre-registrations, work orders, specs | Claude | `docs/**`, `.aipos/**` |
| Visual and UX design of the phone app, the sphere and its motion | Claude | `apps/mobile/src/**` presentation files, `designSystem.ts`, launcher icons |
| Core functions: PAPER runtime, lease, risk gate, kill switch, order path, Alpha Lab test engine (registry, e-process, admission), health projections that report safety state | Claude | `apps/cloud/src/**` runtime, risk, lease, learning/Alpha Lab core |
| Implementation of specified, non-core work | ChatGPT/Codex | offline research tools `scripts/alpha-lab/**`, data fetch and recorder workflows from a written spec, test additions, tooling, non-design app logic named in a work order |

## Rules
1. Every task starts from a work order in `.aipos/work-orders/` that names the owner, the allowed paths and the acceptance checks. Claude writes the work orders for ChatGPT tasks.
2. One task, one branch (`codex/<topic>-<date>`), one draft PR. No edits outside the paths the work order allows.
3. Cross-review: Claude reviews ChatGPT/Codex PRs; ChatGPT (or an independent review session) reviews Claude's PRs.
4. A change that touches a core path, a gate, a threshold, a limit, capital or authority is Claude's and needs the owner where the rules already say so.
5. The repository (AIPOS) is the hand-off, not the chat.
