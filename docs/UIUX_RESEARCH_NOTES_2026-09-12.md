# NUSA UI/UX Research Notes — 2026-09-12

Status: design rationale for draft PR #1850
Owner: UI/UX
Scope: product UX/UI only; no trading/runtime authority

## Why this research exists

NUSA must not become a generic portfolio app with an AI badge. It also must not simulate intelligence through neon, particles, or decorative dashboards. The target is an AI-native trading-intelligence interface whose visual hierarchy makes evidence, uncertainty, operational truth, and human attention legible.

## 2026 reference findings

### Human-centered AI decision support

Recent 2026 work on agentic financial decision-support interfaces consistently emphasizes layered information presentation, plain-language explanation, confidence meaning/provenance, and meaningful user control. NUSA adopts the hierarchy principle, not decorative confidence meters.

Source: https://zenodo.org/records/19133230

### Explainable AI in financial decisions

2026 human-centered XAI research in finance evaluates explanations on usefulness, clarity, and actionability. It highlights explicit neutral/uncertain/high-risk semantics and warns against visual encodings that imply approval when the result is actually neutral or uncertain.

Source: https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2026.1668029/full

### AI-native financial workflow

Current AI-native finance discussion distinguishes intelligence embedded into the workflow from AI-assisted features layered on top. The useful pattern is contextual coordination plus explicit escalation when human judgement is necessary.

NUSA implication: AI is the intelligence layer across the product. The user job is `판단`, not a generic destination named `AI`.

### Current premium trading UI references

Recent Behance AI-trading work shows strong demand for high-density dark-premium data surfaces and predictive-analytics presentation across mobile and desktop.

Source: https://www.behance.net/gallery/247153215/AI-Trading-Dashboard-Fintech-SaaS-Landing-Page

NUSA adopts the quality bar: composition precision, density control, hierarchy, responsive polish. It explicitly rejects the common electric-cyan/neon implementation language.

### Fintech UX anti-patterns

Current 2026 fintech UX commentary highlights the gap between polished concept work and real in-product experience. NUSA treats mockup-to-device parity as an acceptance gate rather than allowing the approved design to degrade during implementation.

Source: https://merge.rocks/blog/fintech-ux-anti-trends-of-2026

## Adopted NUSA patterns

1. **One dominant AI-trading object per first viewport.**
   Current observation/judgement receives hierarchy; raw price, portfolio totals and diagnostics are subordinate.

2. **Evidence over theatre.**
   Thesis, evidence, counter-evidence, uncertainty, calibration provenance, data freshness and operational status communicate intelligence.

3. **Neutral uncertainty.**
   Unknown/incomplete/uncalibrated states use neutral explicit treatment. Green is never used to mean “probably good” without semantic evidence.

4. **Progressive explanation.**
   First viewport answers what matters now. Deeper evidence/calibration/diagnostics remain one transition away rather than competing for attention.

5. **Human-attention escalation.**
   BLOCKED/HUMAN_ONLY/FAILED/STARVATION must explain what needs attention and why. Observation failure is never NO_WORK.

6. **Mobile-native composition.**
   390px is the canonical composition; 360/430 are acceptance widths. Mobile is not a compressed desktop dashboard.

7. **Dark Glass with functional depth.**
   Glass is used only to express layering and focus. Dense tables/charts remain optically stable and are not blurred.

8. **Implementation parity.**
   Approved composition, type hierarchy, spacing, state semantics and content order become implementation contract. Real device screenshots are compared before merge.

## Rejected patterns

- neon / electric-cyan identity
- cyberpunk / terminal cosplay
- glowing AI orb, orbit, particle field, scan beam
- rainbow AI gradients
- fake calibrated confidence
- account-balance-first universal hierarchy
- generic news feed as primary Home content
- bento grids of equally important cards on phone
- green treatment for unknown/neutral state
- raw AI probability presented as validated success probability
- invented `what changed`, invalidation, stance, risk, or portfolio-impact data
- manual PAPER order UX on the production supervision route when capability does not exist

## NUSA visual thesis

`quiet intelligence, visible evidence, controlled depth`

The surface should feel computational without looking theatrical:

- near-black neutral canvas
- smoked translucent panels
- soft material separation rather than glow
- one cool desaturated intelligence accent
- warm amber only for attention/stale/human action
- semantic green/red only for verified state/outcome meaning
- strong typographic contrast
- tabular financial numerals
- compact evidence rows
- precise micro-dividers
- motion only for state transition and content continuity

## Mockup gate

Every implementation-ready mobile mockup must show at minimum:

- NUSA identity
- PAPER_ONLY authority truth
- system/data/PAPER/risk first-glance state
- one dominant observation/judgement surface
- evidence provenance or explicit unavailable state
- uncertainty / calibration meaning
- one safe next action where supported
- bottom navigation
- no invented runtime state

After approval, implementation is compared at 360 / 390 / 430 widths and on the canonical Android acceptance device. Visual similarity without semantic/state parity is FAIL; semantic correctness with major visual drift is also FAIL.
