# Temporal Binary Hedge Planner v0.1

## Purpose

This research-only planner models a short-horizon binary market workflow where one outcome is accumulated first and the opposite outcome is added later only when the quantity-weighted complete-set cost remains below the protected payout after fees.

It is inspired by temporal arbitrage and hedged directional inventory management. It does not reproduce or validate any third-party profit claim.

## Core rules

- Track UP and DOWN quantity and cost separately.
- Protected quantity is `min(upQuantity, downQuantity)`.
- Complete-set cost is the sum of quantity-weighted average UP and DOWN acquisition costs.
- A hedge is accepted only when `1 - completeSetCost` meets the configured minimum locked edge.
- Low-price entries use a smaller configurable multiplier.
- One-sided inventory is capped by `maxUnhedgedCapital`.
- Future fills, invalid prices, malformed timestamps, and non-finite values fail closed.

## Safety boundaries

- Paper/Research only.
- No Polymarket API integration.
- No wallet, credential, signing, settlement, or live order path.
- No latency-arbitrage or resolution-sniping implementation.
- Profitability is not asserted; fill quality, queue position, fees, settlement rules, and source-price discrepancies remain material risks.
