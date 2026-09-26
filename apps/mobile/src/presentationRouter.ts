import type { MoreDestination, PrimaryDestination } from "./navigationContract";

export type PresentationDetail =
  | { readonly kind: "MORE"; readonly destination: MoreDestination }
  | { readonly kind: "PAPER_LEARNING" }
  | null;

export interface PresentationRoute {
  readonly primary: PrimaryDestination;
  readonly detail: PresentationDetail;
}

export const initialPresentationRoute = (): PresentationRoute =>
  Object.freeze({ primary: "Home", detail: null });

export function navigatePrimary(
  current: PresentationRoute,
  primary: PrimaryDestination,
): PresentationRoute {
  if (current.primary === primary && current.detail === null) return current;
  return Object.freeze({ primary, detail: null });
}

export function navigateMoreDetail(
  current: PresentationRoute,
  destination: MoreDestination,
): PresentationRoute {
  return Object.freeze({
    primary: current.primary === "More" ? current.primary : "More",
    detail: Object.freeze({ kind: "MORE", destination }),
  });
}

export function openPaperLearning(current: PresentationRoute): PresentationRoute {
  return Object.freeze({ primary: current.primary, detail: Object.freeze({ kind: "PAPER_LEARNING" }) });
}

export function closePresentationDetail(current: PresentationRoute): PresentationRoute {
  if (current.detail === null) return current;
  return Object.freeze({ primary: current.primary, detail: null });
}
