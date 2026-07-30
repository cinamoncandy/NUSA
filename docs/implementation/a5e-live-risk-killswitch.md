# A5E Live Risk Gateway and Kill Switch

All prospective submissions are evaluated before queue admission. The gateway is fail-closed and checks daily loss, position size, global exposure, open orders, consecutive losses, order size, symbol allowlist, session, market/exchange/API health, reconciliation, warmup, unknown submissions, and balance matching.

Any emergency condition triggers the independent Kill Switch. The switch records its reason, drains the submission queue, emits Evidence, and remains active across snapshot/restore until an identified reviewer approves release. Release does not enable production mutation; the capability descriptor remains `productionMutationAllowed=false`.

The current implementation is a safe pre-submission boundary. It does not connect an Upbit mutation endpoint, accept credentials, or enable live trading. The existing execution orchestration must call `evaluate` and `assertApproved` immediately before any future submit integration.
