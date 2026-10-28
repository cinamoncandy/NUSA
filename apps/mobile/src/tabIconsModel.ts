import type { PrimaryDestination } from "./navigationContract";
import { islandPalette } from "./designSystem";

/**
 * Tab icons in the island style (owner-approved mockup 2026-10-28): 1.6 px round line icons on a 24 grid. The selected tab draws in
 * the island gradient (violet to cyan); the others in the muted colour. Presentation only.
 */
export const TAB_ICON_PATHS: Readonly<Record<PrimaryDestination, readonly (readonly [string, number])[]>> = Object.freeze({
  // 지금: the island over the sea.
  Home: [["M4 15c3 0 4-8 8-8s5 8 8 8", 1], ["M3 18h18", 0.7], ["M7 21h10", 0.4]],
  // 학습: a rising line.
  Paper: [["M4 19h16", 1], ["M5 16c2-1 3-5 5-5s2 3 4 2 3-6 5-7", 1], ["M16 6h3v3", 1]],
  // 실거래: a padlock (LIVE stays locked).
  Live: [["M7.5 11h9a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5v-4A2.5 2.5 0 0 1 7.5 11z", 1], ["M8 11V8a4 4 0 0 1 8 0v3", 1], ["M8.5 16h7", 0.5]],
  // 선물: two-way arrows.
  Futures: [["M4 9h13l-3-3", 1], ["M20 15H7l3 3", 1]],
  // 기록: a list.
  More: [["M5 6h14", 1], ["M5 12h14", 0.7], ["M5 18h9", 0.45]],
});

export const TAB_ICON_ACTIVE = [islandPalette.violet, islandPalette.cyan] as const;

