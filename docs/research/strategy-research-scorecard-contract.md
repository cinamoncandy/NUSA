# Strategy Research Provenance Scorecard (WO-0031 compatibility facade)

The scorecard is a deterministic, read-only provenance and compatibility boundary for the eight required research evidence classes. It neither reruns research nor changes a strategy, submits an order, or grants authority. Every evidence record binds its strategy, dataset, execution, and risk-profile linkage to a canonical SHA-256 payload seal. Missing, unverified, synthetic, duplicate, and invalid evidence remains explicit.

This facade **does not issue a research promotion decision**. It reports only evidence `readiness` and names `strategy-research-promotion-gate-runner` as `canonicalPromotionAuthority`. `promotionAuthority` and `productionMutationAllowed` are always `false`.

The sole canonical WO-0031 promotion/deployability decision boundary is `scripts/lib/strategy-research-promotion-gate-runner.js` together with its independent verifier and evidence manifest. Only that path may emit `researchDecision`, including `PROMOTE_TO_EXTENDED_PAPER_REVIEW`. Synthetic or incomplete evidence remains non-promotable there, and owner review remains mandatory.
