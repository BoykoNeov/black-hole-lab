/**
 * Pure math for the educational overlays (slice 6). No DOM, no WebGL —
 * everything here is unit-tested in test/edu.test.ts. Drawing lives in
 * hud.ts, wiring in main.ts.
 */

import { circUt, ksMetric } from "./kerr";
import type { V3 } from "./kerr";
import type { CameraBasis } from "./camera";

export type { V3 } from "./kerr";

export interface Projected {
  x: number;
  y: number;
  /** Camera-space depth along fwd (world units); <= 0 means behind. */
  z: number;
  visible: boolean;
}

/**
 * World point -> HUD-canvas pixel, the exact inverse of the scene shader's
 * ray construction (dir = fwd + ndcX·T·aspect·right + ndcY·T·up, T =
 * tan(fov/2)). This is a flat-space (unlensed) projection: it marks where an
 * object *is*, not where its lensed image appears — callers must say so in
 * their UI copy. The 2D canvas y axis points down, hence the flip.
 */
export function projectToScreen(
  q: V3,
  basis: CameraBasis,
  tanHalfFov: number,
  width: number,
  height: number,
  out?: Projected
): Projected {
  const o = out ?? { x: 0, y: 0, z: 0, visible: false };
  const dx = q[0] - basis.pos[0];
  const dy = q[1] - basis.pos[1];
  const dz = q[2] - basis.pos[2];
  const xc = dx * basis.right[0] + dy * basis.right[1] + dz * basis.right[2];
  const yc = dx * basis.up[0] + dy * basis.up[1] + dz * basis.up[2];
  const zc = dx * basis.fwd[0] + dy * basis.fwd[1] + dz * basis.fwd[2];
  o.z = zc;
  if (zc <= 0) {
    o.x = 0;
    o.y = 0;
    o.visible = false;
    return o;
  }
  const aspect = width / height;
  const ndcX = xc / (zc * tanHalfFov * aspect);
  const ndcY = yc / (zc * tanHalfFov);
  o.x = ((ndcX + 1) / 2) * width;
  o.y = ((1 - ndcY) / 2) * height;
  // small margin past the edges so leader lines can anchor just off-screen
  o.visible = Math.abs(ndcX) <= 1.2 && Math.abs(ndcY) <= 1.2;
  return o;
}

/**
 * dtau/dt of a static observer at p — the tick rate of a clock held at rest
 * relative to infinity, as a fraction of the far-away rate. In Kerr–Schild
 * this is sqrt(1 - f); it is the reciprocal of the u^t that
 * buildStaticTetrad gives the camera, so this is the rendering camera's own
 * clock. At a = 0, f = 2/r recovers the textbook sqrt(1 - 2/r).
 *
 * Returns 0 inside the ergosphere (1 - f <= 0), where no static observer
 * exists: the function must stay total even though the camera never goes
 * there.
 */
export function staticRate(p: V3, a: number): number {
  return Math.sqrt(Math.max(1 - ksMetric(p, a).f, 0));
}

/**
 * dtau/dt of a prograde circular equatorial orbiter at Boyer–Lindquist r.
 * 1/u^t folds in BOTH dilations at once — gravitational (depth) and
 * velocity (orbital speed) — so it always runs slower than a static clock
 * at the same radius. At a = 0 this is sqrt(1 - 3/r).
 */
export function circRate(r: number, a: number): number {
  return 1 / circUt(r, a);
}
