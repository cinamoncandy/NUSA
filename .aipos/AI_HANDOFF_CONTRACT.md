# AIPOS AI Handoff Contract

## Purpose

AIPOS must allow any capable AI or agent to continue NUSA work from repository state without depending on the memory, hidden context, or conversation history of the previous AI.

This contract applies to ChatGPT, Codex, Claude, Gemini, Cursor, Windsurf, Kimi, and future AI systems.

## Source-of-Truth Hierarchy

1. NUSA Constitution and core architecture documents define architectural authority and safety constraints.
2. `.aipos/` defines machine-readable execution state, work orders, dependencies, decisions, and handoff context.
3. Git commits, pull requests, CI, deployment evidence, and audit evidence prove implementation state.
4. Conversation history and model memory are advisory only and must never be required to recover the project.

## Mandatory Recovery Protocol

Every AI taking over NUSA work must, before changing implementation:

1. Read `.aipos/aipos.yaml`.
2. Read `.aipos/state.yaml`.
3. Read `.aipos/architecture.md` and the current core architecture documents referenced by AIPOS.
4. Read the active work order and its dependencies.
5. Read relevant durable decisions and evidence references.
6. Verify repository branch, commit, pull-request, and CI state when those facts affect the next action.
7. Determine the single next permitted action from repository evidence rather than remembered conversation context.

## Mandatory Handoff State

Before an AI stops or transfers work, AIPOS must contain enough durable information for another AI to continue without asking the previous AI for explanation. Where applicable this includes:

- architecture version or architecture reference;
- current objective and phase;
- active work order;
- work-order status;
- dependency state;
- branch and base branch;
- current commit and relevant merge commit;
- pull-request number and state;
- acceptance criteria;
- verification commands and results;
- known failures or blockers;
- evidence references;
- safety constraints and prohibited actions;
- decisions made and their rationale;
- the next permitted action.

## No-Guess Rule

An AI must not infer completion merely because code exists or a previous conversation claims success. Completion requires the evidence defined by the active work order and AIPOS policy.

Missing, stale, contradictory, or unverifiable state must be treated as unresolved and recovered from repository evidence before proceeding.

## Architecture Synchronization Rule

When an approved NUSA architecture change materially affects capabilities, dependencies, safety boundaries, interfaces, validation requirements, or implementation order, AIPOS must be synchronized.

The synchronization must identify, where applicable:

- affected capabilities;
- affected work orders;
- new work orders required by architecture gaps;
- superseded or obsolete work orders;
- dependency-graph changes;
- priority changes;
- changed acceptance criteria;
- required migration or compatibility work;
- architecture version/reference associated with each affected work order.

Architecture is the design source of truth. AIPOS is the execution-plan and execution-state source of truth. AIPOS may propose architecture changes, but it must not silently redefine approved architecture.

## AI-Agnostic Execution Rule

Work orders must describe goals, contracts, acceptance criteria, constraints, evidence, and dependencies without requiring a specific AI vendor or proprietary hidden state unless the work order explicitly concerns that provider.

The same ready work order should be executable by different capable AI systems and should produce equivalent compliance evidence even when their internal reasoning differs.

## Handoff Integrity Requirements

A handoff is valid only when:

- the repository can be recovered deterministically enough to identify the same active objective;
- the next AI can identify the next permitted action without prior chat history;
- safety and architecture constraints are explicit;
- unresolved uncertainty is recorded rather than hidden;
- evidence references are durable and inspectable;
- no secret, password, hidden chain-of-thought, or provider-private memory is required for continuity.

## Permanent Principle

AIPOS exists so that NUSA development itself is replaceable and evolvable across AI systems.

A better future AI should be able to take over NUSA work by reading the repository contract, continue from verified state, and improve the system without forcing the project to reconstruct prior conversations or redesign its workflow.