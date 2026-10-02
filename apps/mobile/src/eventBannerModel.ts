/**
 * In-app banner for new PAPER fills and halts, shown on every tab while the app is open. Import-free
 * so tests can transpile it alone. Read-only: it only describes events the server already sent.
 */
export interface BannerEntry { readonly id: string; readonly at: number; readonly kind: string; readonly title: string; readonly detail: string }
export interface Banner { readonly id: string; readonly tone: "fill" | "halt"; readonly title: string; readonly detail: string }

/** Newest event time, used as the baseline when the first data arrives so old events never banner. */
export function bannerBaseline(entries: readonly BannerEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.at), 0);
}

/** The newest fill or halt strictly after `sinceAt`, or null. A halt wins over a fill at the same time. */
export function pickBanner(entries: readonly BannerEntry[], sinceAt: number): Banner | null {
  let best: BannerEntry | null = null;
  for (const entry of entries) {
    if ((entry.kind !== "fill" && entry.kind !== "halt") || entry.at <= sinceAt) continue;
    if (best == null || entry.at > best.at || (entry.at === best.at && entry.kind === "halt")) best = entry;
  }
  return best == null ? null : Object.freeze({ id: best.id, tone: best.kind === "halt" ? "halt" as const : "fill" as const, title: best.title, detail: best.detail });
}
