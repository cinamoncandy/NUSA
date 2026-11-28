import type { PrimaryDestination } from "./navigationContract";
import { islandPalette } from "./designSystem";

const SPHERE = "M4 12A8 8 0 1 0 20 12A8 8 0 1 0 4 12";
/**
 * Tab icons in the lattice language (UI v8, owner 2026-11-27 "아이콘과 메뉴 디자인도 바꿔"): 1.6 px round line icons on a 24 grid,
 * each drawn on the outline of the sphere. The selected tab draws in the ice gradient; the others in the muted colour. Presentation only.
 */
export const TAB_ICON_PATHS: Readonly<Record<PrimaryDestination, readonly (readonly [string, number])[]>> = Object.freeze({
  // 지금: the lattice sphere itself (outline, equator, meridian).
  Home: [[SPHERE, 1], ["M4 12c0 2.2 3.6 4 8 4s8-1.8 8-4", 0.6], ["M12 4c-2.2 0-4 3.6-4 8s1.8 8 4 8", 0.6]],
  // Lab: a chain of lit nodes rising across the sphere.
  Paper: [[SPHERE, 0.4], ["M7 16l3.5-3 3 1.5L16 10", 1], ["M17 7.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8", 1]],
  // 실거래: a padlock inside the sphere (LIVE stays locked).
  Live: [[SPHERE, 0.4], ["M8.5 11.5h7v5h-7z", 1], ["M10 11.5v-1.5a2 2 0 0 1 4 0v1.5", 1]],
  // 선물: two-way arrows across the sphere.
  Futures: [[SPHERE, 0.35], ["M6 10h10l-2.5-2.5", 1], ["M18 14H8l2.5 2.5", 1]],
  // 기록: lines of a log, each led by a node.
  More: [["M9 7h10", 1], ["M9 12h10", 0.7], ["M9 17h7", 0.45], ["M5 6.2a0.8 0.8 0 1 0 0 1.6a0.8 0.8 0 1 0 0-1.6", 1], ["M5 11.2a0.8 0.8 0 1 0 0 1.6a0.8 0.8 0 1 0 0-1.6", 0.7], ["M5 16.2a0.8 0.8 0 1 0 0 1.6a0.8 0.8 0 1 0 0-1.6", 0.45]],
});

export const TAB_ICON_ACTIVE = [islandPalette.violet, islandPalette.cyan] as const;

