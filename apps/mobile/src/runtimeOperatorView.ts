import type { RuntimeOperatorViewModel } from "../../desktop/src/cloud/runtimeOperatorView";

export interface MobileRuntimeOperatorCard {
  readonly status: RuntimeOperatorViewModel["status"];
  readonly score: number;
  readonly headline: string;
  readonly latestItems: readonly (RuntimeOperatorViewModel["timeline"][number])[];
  readonly readOnly: true;
}

export const buildMobileRuntimeOperatorCard = (
  view: RuntimeOperatorViewModel,
  maximumItems = 10
): MobileRuntimeOperatorCard => {
  if (!Number.isSafeInteger(maximumItems) || maximumItems <= 0) throw new Error("maximumItems must be a positive safe integer");
  return Object.freeze({
    status: view.status,
    score: view.score,
    headline: view.summary,
    latestItems: Object.freeze(view.timeline.slice(-maximumItems).map((item) => Object.freeze({ ...item }))),
    readOnly: true as const
  });
};
