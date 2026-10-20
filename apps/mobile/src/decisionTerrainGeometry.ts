/**
 * Pure geometry for the decision terrain: a small perspective camera, row smoothing and easing. World units: x across the hour
 * (-1..1), y up (heights 0..~0.6), z into the screen (the current hour at z = 0, older hours further away).
 */
export const TERRAIN_ROW_DZ = 0.2;
export const TERRAIN_POINTS = 48;
export const TERRAIN_HEIGHT = 0.55;

export interface TerrainCamera { readonly yaw: number; readonly pitch: number; readonly ty: number; readonly tz: number; readonly dist: number; readonly f: number; readonly cx: number; readonly cy: number }

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
export const easeOutExpo = (x: number): number => (x >= 1 ? 1 : x <= 0 ? 0 : 1 - Math.pow(2, -10 * x));
export const easeOutBack = (x: number): number => { const t = Math.min(1, Math.max(0, x)), c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/** The entrance turns a flat top-down grid into the tilted terrain over `intro` (0..1). */
export function terrainCamera(width: number, height: number, yaw: number, intro: number): TerrainCamera {
  const e = easeOutExpo(intro);
  const flat = Math.PI / 2;
  return { yaw: yaw * e, pitch: flat - (flat - 0.5) * e, ty: 0.12, tz: 1.15, dist: 3.35 - 0.3 * e, f: width * 0.86, cx: width / 2, cy: height * 0.52 };
}

export function projectTerrain(x: number, y: number, z: number, cam: TerrainCamera): { readonly x: number; readonly y: number } {
  const py = y - cam.ty, pz = z - cam.tz;
  const cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw);
  const x1 = x * cyaw - pz * syaw, z1 = x * syaw + pz * cyaw;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const y2 = py * cp + z1 * sp, z2 = -py * sp + z1 * cp;
  const depth = Math.max(0.2, z2 + cam.dist);
  return { x: cam.cx + (cam.f * x1) / depth, y: cam.cy - (cam.f * y2) / depth };
}

/** z of row k (0 = oldest) when there are `count` rows; `shift` slides everything one row forward while a new hour arrives. */
export const terrainRowZ = (k: number, count: number, shift = 0): number => (count - 1 - k) * TERRAIN_ROW_DZ - shift * TERRAIN_ROW_DZ;

/** Catmull-Rom through the 12 bucket heights; unobserved buckets are ground (0) and flagged so they can be drawn faint. */
export function smoothTerrainRow(values: readonly (number | null)[], points = TERRAIN_POINTS): readonly { readonly h: number; readonly seen: boolean }[] {
  const n = values.length;
  if (n === 0) return Array.from({ length: points }, () => ({ h: 0, seen: false }));
  const v = (i: number): number => values[Math.min(n - 1, Math.max(0, i))] ?? 0;
  const out: { h: number; seen: boolean }[] = [];
  for (let p = 0; p < points; p += 1) {
    const u = (p / (points - 1)) * (n - 1), i = Math.floor(u), t = u - i;
    const p0 = v(i - 1), p1 = v(i), p2 = v(i + 1), p3 = v(i + 2);
    const h = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    out.push({ h: Math.max(0, Math.min(1.2, h)), seen: values[Math.min(n - 1, Math.round(u))] != null });
  }
  return out;
}
