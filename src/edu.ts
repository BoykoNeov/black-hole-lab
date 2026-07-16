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

/**
 * Equatorial Kerr effective potential: the energy E (per unit rest mass) at
 * which a particle of angular momentum L has a radial turning point at r.
 * The radial equation for equatorial timelike geodesics (M = 1) is
 *
 *     (dr/dtau)^2 = E^2 alpha(r) - E beta(r) - gamma(r),
 *     alpha = 1 + a^2/r^2 + 2 a^2/r^3,
 *     beta  = 4 a L / r^3,
 *     gamma = 1 - 2/r + (L^2 + a^2)/r^2 - 2 L^2/r^3,
 *
 * so V_eff is the positive root of alpha E^2 - beta E - gamma = 0. Frame
 * dragging makes it E-linear (beta), which is why this is a quadratic rather
 * than the textbook square root. At a = 0, beta = 0 and gamma factors, giving
 * back sqrt((1 - 2/r)(1 + L^2/r^2)).
 *
 * NOTE: PLAN-slice-6.md's 6c prose drops the a^2/r^2 term from gamma. That
 * version disagrees with the circEL oracle by ~1% at a = 0.9; the form above
 * reproduces circEL's E exactly (see test/edu.test.ts).
 */
export function vEff(r: number, L: number, a: number): number {
  const r2 = r * r;
  const r3 = r2 * r;
  const a2 = a * a;
  const alpha = 1 + a2 / r2 + (2 * a2) / r3;
  const beta = (4 * a * L) / r3;
  const gamma = 1 - 2 / r + (L * L + a2) / r2 - (2 * L * L) / r3;
  // the discriminant can dip a few ulps below zero near the horizon
  const disc = Math.max(beta * beta + 4 * alpha * gamma, 0);
  return (beta + Math.sqrt(disc)) / (2 * alpha);
}

/**
 * Radius of the unstable circular photon orbit in the equatorial plane
 * (Bardeen): r_ph = 2(1 + cos(2/3 arccos(-+a))), the minus sign prograde.
 * a = 0 gives 3 either way; at a = 1 the prograde orbit sits at r = 1 and the
 * retrograde one at r = 4.
 */
export function photonOrbitRadius(a: number, prograde: boolean): number {
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(prograde ? -a : a)));
}
