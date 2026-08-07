# WO-0038 Restricted LIVE State Machine Governance

This slice defines governance state semantics only. It does not connect execution transport, resolve execution credentials, expose order mutation, or authorize real-money execution.

Canonical states: `DISABLED -> ARMED -> AUTHORIZED -> ACTIVE -> COOLDOWN`, with `HALT` fail-closed escape semantics. Under current NUSA policy, `ACTIVE` is structurally non-enterable because real-money execution, execution transport, and execution credential use remain prohibited.

Human authorization is bounded, two-approver, single-use, expiring, and secret-free. AI, Meta-AI, automation, strategies, and provider adapters receive no authority to self-authorize or bypass HALT.
