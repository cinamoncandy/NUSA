# Paper Restart Recovery

Restart recovery begins with deployment and safety snapshot validation. Automatic
trading is always off after normal shutdown, process interruption, reconnect, a valid
approval restore, a cleared P0 alert, or successful reconciliation. Fresh market data
starts in `WARMING_UP`; no recovery action creates an order or fill.

`PAPER_CANARY` and `PAPER_EXTENDED` persisted modes are downgraded to `SHADOW` on
restart. Active kill switches and open or acknowledged P0 alerts remain blocking.
Reconciliation is required again on every restart and a failed reconciliation remains
a halt requiring owner review. Approval validity is evaluated as binding evidence only;
it never starts automation.

This is Paper-only safety behavior. It does not enable production trading, private
exchange APIs, credentials, or capital movement. Actual gateway-backed drills and the
final WO-0031 D-010 evidence integration remain WO-0032 phase 3 work.
