import { PAPER_FUTURES_OWNER_LIMITS } from "../../../packages/contracts/src/paperFutures";
import { buildFuturesSafetyRows, type SafetyRow } from "./safetyScreenModel";

/** Mobile-local adapter: the "안전" futures rows built from the futures gate's single source of limits. */
export function futuresSafetyRows(): readonly SafetyRow[] {
  return buildFuturesSafetyRows(PAPER_FUTURES_OWNER_LIMITS);
}
