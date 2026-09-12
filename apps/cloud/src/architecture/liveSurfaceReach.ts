/**
 * The LIVE-path modules that nothing reaches, recorded rather than removed.
 *
 * Twenty-seven modules in `apps/cloud/src` are named `live*`, in a repository whose premise is
 * that live trading is disabled: `liveAuthority=NONE`, `productionMutationAllowed=false`. Six of
 * them have no importer anywhere outside their own tests -- not in cloud, desktop, execution,
 * scripts or services. They compile, they carry tests, and they run for nobody.
 *
 * That is not a defect. Machinery for an authority that has never been granted *should* be
 * unreachable, and deleting it would throw away work that a future owner-approved LIVE path would
 * need. The defect would be forgetting which of the two situations applies: a `live*` module with
 * no callers reads exactly like one that lost its caller in a refactor, and exactly like one whose
 * absence from the wiring is an oversight rather than the design.
 *
 * So the list is the record. `tests/live-surface-reach.test.js` fails when a module here gains a
 * caller -- which would mean something now reaches LIVE machinery and deserves a hard look -- and
 * when a module here disappears, and when a `live*` module outside this list loses its last
 * caller. Moving these files into a directory would say the same thing more plainly, and cannot
 * be done cheaply: over two hundred open branches touch these six paths.
 */

export interface UnreachedLiveModule {
  readonly module: string;
  /** What it would do if an owner-approved LIVE path ever existed. */
  readonly purpose: string;
}

export const UNREACHED_LIVE_MODULES: readonly UnreachedLiveModule[] = Object.freeze([
  Object.freeze({ module: "liveExecutionBoundary", purpose: "the boundary a LIVE order would have to cross" }),
  Object.freeze({ module: "liveBrokerTransportAdapter", purpose: "transport to a real broker" }),
  Object.freeze({ module: "liveSessionBrokerAdapterBoundary", purpose: "binds a broker adapter to an authorized session" }),
  Object.freeze({ module: "liveRuntimeSessionCommands", purpose: "commands that would mutate a LIVE runtime session" }),
  Object.freeze({ module: "liveHumanApprovalDurableConsumptionStore", purpose: "durable single-use record of a human approval" }),
  Object.freeze({ module: "liveExecutionAuditEvidence", purpose: "audit evidence a LIVE execution would emit" })
]);

/** Files that name these modules as strings without calling them. Declarations, not callers. */
export const LIVE_REACH_DECLARATION_PREFIX = "apps/cloud/src/architecture/";
