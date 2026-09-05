/**
 * Confirmatory-versus-exploratory labeling and selection history for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "immutable evaluation-
 * family identity covering every inspected provider/model/prompt/calibration/regime/horizon/
 * threshold/benchmark/metric candidate" and "frozen confirmatory-versus-exploratory semantics ...
 * and selection history" requirements. A result is confirmatory only if its candidate was
 * declared as THE evaluation's primary hypothesis before any outcome was inspected, and no other
 * candidate in the same evaluation family was also pre-declared confirmatory (post-hoc-selected
 * "the one that worked best" among many inspected candidates is exploratory, however good it
 * looks, and must be labeled as such -- never presented as confirmatory). Composes with
 * aiEvaluationFrozenSelection.ts's frozen-before-outcome pattern and
 * aiEvaluationRegimeDegradationMonitoring.ts's append-only-history pattern.
 */

export interface SelectionHistoryEntry {
  readonly entryId: string;
  readonly evaluationFamilyId: string;
  /** Identifies the inspected candidate, e.g. "provider=openai;model=v3;prompt=v7;regime=bull". */
  readonly candidateKey: string;
  readonly declaredConfirmatory: boolean;
  readonly declaredAt: number;
}

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function entryIsWellFormed(entry: SelectionHistoryEntry): boolean {
  return typeof entry.entryId === "string" && entry.entryId.trim().length > 0
    && typeof entry.evaluationFamilyId === "string" && entry.evaluationFamilyId.trim().length > 0
    && typeof entry.candidateKey === "string" && entry.candidateKey.trim().length > 0
    && isTimestamp(entry.declaredAt);
}

/**
 * True only when `candidateHistory` is a valid append-only extension of `previousHistory` --
 * every prior entry (by entryId) survives unchanged in the candidate. Selection history must
 * never be edited after the fact: a post-hoc edit to an entry's declaredConfirmatory flag would
 * defeat the entire purpose of pre-registration.
 */
export function isAppendOnlySelectionHistory(
  previousHistory: readonly SelectionHistoryEntry[],
  candidateHistory: readonly SelectionHistoryEntry[],
): boolean {
  const candidateById = new Map(candidateHistory.map((entry) => [entry.entryId, entry]));
  return previousHistory.every((previousEntry) => {
    const candidateEntry = candidateById.get(previousEntry.entryId);
    if (candidateEntry === undefined) return false;
    return candidateEntry.evaluationFamilyId === previousEntry.evaluationFamilyId
      && candidateEntry.candidateKey === previousEntry.candidateKey
      && candidateEntry.declaredConfirmatory === previousEntry.declaredConfirmatory
      && candidateEntry.declaredAt === previousEntry.declaredAt;
  });
}

export type ConfirmatoryLabel = "CONFIRMATORY" | "EXPLORATORY";

export type CandidateLabelResult =
  | { readonly resolved: true; readonly label: ConfirmatoryLabel }
  | { readonly resolved: false; readonly reason: "CANDIDATE_NOT_IN_HISTORY" | "MALFORMED_HISTORY" };

/**
 * Labels `candidateEntryId`'s claim as CONFIRMATORY only if all of the following hold, otherwise
 * EXPLORATORY: the entry declared itself confirmatory; it was declared strictly before
 * `earliestOutcomeObservedAt`; and it is the ONLY entry in its evaluationFamilyId that was
 * declared confirmatory before that same moment. A second pre-declared-confirmatory candidate in
 * the same family is a contradiction in the family's own pre-registration -- both such entries
 * are downgraded to EXPLORATORY rather than arbitrarily picking one as the "real" confirmatory
 * claim. Fails closed (resolved: false) if the candidate is absent or the history is malformed.
 */
export function labelSelectionCandidate(
  candidateEntryId: string,
  history: readonly SelectionHistoryEntry[],
  earliestOutcomeObservedAt: number,
): CandidateLabelResult {
  if (!isTimestamp(earliestOutcomeObservedAt) || !history.every(entryIsWellFormed)) {
    return { resolved: false, reason: "MALFORMED_HISTORY" };
  }
  const candidate = history.find((entry) => entry.entryId === candidateEntryId);
  if (candidate === undefined) return { resolved: false, reason: "CANDIDATE_NOT_IN_HISTORY" };

  if (!candidate.declaredConfirmatory || candidate.declaredAt >= earliestOutcomeObservedAt) {
    return { resolved: true, label: "EXPLORATORY" };
  }

  const otherPreDeclaredConfirmatory = history.some((entry) =>
    entry.entryId !== candidate.entryId
    && entry.evaluationFamilyId === candidate.evaluationFamilyId
    && entry.declaredConfirmatory
    && entry.declaredAt < earliestOutcomeObservedAt);

  return { resolved: true, label: otherPreDeclaredConfirmatory ? "EXPLORATORY" : "CONFIRMATORY" };
}
