# ADR-0002: Investment Knowledge and Financial Reasoning as a First-Class Architecture Layer

## Status

Accepted on `docs/nusa-ai-evolution-principle`.

## Context

NUSA is designed to improve investment capabilities over time, but continual learning alone is not a sufficient foundation for investment intelligence. A system that begins financially blank can overfit to recent observations, confuse linguistic confidence with economic confidence, or allow learned behavior to rewrite core financial and model-risk principles.

NUSA also requires AI-provider independence. Investment knowledge therefore cannot exist only inside one model's weights, private memory, or ad-hoc prompts.

## Decision

NUSA adopts `docs/NUSA_INVESTMENT_KNOWLEDGE_PRINCIPLE.md` as a normative architecture principle.

Investment knowledge is divided into three governed classes:

1. Foundational Knowledge — durable financial, economic, market-structure, statistical, and model-risk knowledge.
2. Market Knowledge — time-sensitive market facts, rules, data, and context.
3. Learned Knowledge — evidence-backed conclusions produced by NUSA research and operation.

The following constraints apply:

- Foundational Knowledge exists before autonomous learning and is not silently rewritten by recent P&L.
- Market Knowledge requires provenance and temporal semantics.
- Learned Knowledge remains challengeable, versioned, attributable, and reversible.
- Financial knowledge is not trading authority.
- Risk Governor, Deployment Gate, hard capital limits, kill switch, and LIVE authority remain independent of learned investment intelligence.
- Point-in-time correctness is a model-risk requirement.
- Investment knowledge must be recoverable across capable AI providers without requiring conversation memory or provider-private state.
- User-facing UI must hide unnecessary internal complexity and use progressive disclosure for advanced reasoning and evidence.

## Architecture Impact

Future investment-related Work Orders should identify which knowledge class they consume or produce and should preserve provenance, temporal integrity, rollback, safety authority, and provider-independent capability boundaries.

Target capability families include:

- `FOUNDATIONAL_INVESTMENT_KNOWLEDGE`
- `MARKET_KNOWLEDGE`
- `FINANCIAL_REASONING`
- `TEMPORAL_INTEGRITY`
- `KNOWLEDGE_PROVENANCE`
- `LEARNED_INVESTMENT_KNOWLEDGE`

## Consequences

NUSA gains a durable financial reasoning foundation while keeping learning evolvable. Future AI models may be replaced without resetting the project's financial semantics, and empirical learning can improve investment intelligence without becoming a sovereign safety or production authority.
