/**
 * Polarization transport (slice 10).
 *
 * Light from the disk arrives polarized, and Kerr rotates the plane of that
 * polarization on the way out. The rotation is not an integration result: a
 * polarization vector f parallel-transported along a null geodesic with
 * tangent P carries a CONSERVED complex number, the Walker–Penrose constant
 *
 *     kappa = (A - i B) (r - i a cos(theta)),
 *
 * built from the Killing–Yano tensor of Kerr. So the whole trip from emitter
 * to camera costs two evaluations of one closed form — nothing per step. That
 * is the entire reason this module exists; carrying f along the march instead
 * would add four components to the shader's hot loop and roughly double it.
 *
 * Two departures from the textbook treatment, both forced by this lab:
 *
 *  - The camera is at FINITE r (the orbit camera goes to r = 3.2), so the
 *    usual screen formulas for kappa in terms of the impact parameters
 *    (alpha, beta) of an observer at infinity do not apply. Instead the two
 *    sky legs of the camera's own tetrad are themselves polarizations: their
 *    kappas form a basis, and the emitted kappa is resolved against it. Exact
 *    at any radius, and it reduces to the textbook result far away.
 *
 *  - The formula is written in Cartesian Kerr–Schild, not Boyer–Lindquist,
 *    because that is what the integrator marches in. Only four 1-forms are
 *    needed, and two of them naively carry a 1/Delta that diverges on the
 *    horizon — but the whole dr part of (r^2+a^2) dphi - a dt cancels
 *    identically (its coefficient is a - a*Delta/Delta), and dr's own part of
 *    dt - a sin^2(theta) dphi drops out of the wedge dr ^ (...). Nothing
 *    diverges, and nothing needs an epsilon. Same story as carterQ's axis:
 *    the singular pieces were the coordinates', not the geometry's.
 */

import { gDot, ksRadius, type Tetrad, type V3, type V4 } from "./kerr.js";

/**
 * The Walker–Penrose constant, as its real and imaginary parts.
 *
 * Only ratios of kappas are ever used (the emitted one is resolved against
 * the camera's two), so the overall sign convention is free — this module
 * uses the one that falls out of the Killing–Yano wedge, which is minus the
 * Connors–Stark sign. For the same reason it does not matter that the lab
 * marches the TIME-REVERSED tangent: kappa is bilinear in (P, f), so
 * flipping P scales every kappa alike and cancels in the solve.
 */
export interface WPConstant {
  k1: number;
  k2: number;
}

/**
 * Walker–Penrose constant of a photon with contravariant tangent P and
 * polarization F at world point pos. F must satisfy F.P = 0; F is defined
 * only modulo P, and kappa is automatically blind to that gauge (the wedge
 * P ^ P vanishes), which test/polarization.test.ts pins.
 *
 * The four 1-forms, in Kerr–Schild Cartesian components at pos, with
 * Sigma_KS = r^4 + a^2 y^2 and ku = r^3 / Sigma_KS:
 *
 *   dr        . X = ku [ x X^x + z X^z + (r^2+a^2) y X^y / r^2 ]
 *   omega_A   . X = X^t - a (z X^x - x X^z) / (r^2+a^2)     [= dt - a sin^2th dphi, mod dr]
 *   omega_B   . X = (ku/r^2) [ y (x X^x + z X^z) - r^2 sin^2(th) X^y ]  [= sin(th) dth]
 *
 * and omega_C = (r^2+a^2) dphi - a dt, whose singular-on-the-axis dphi is
 * only ever needed wedged with omega_B. That product is the round area form
 * in disguise, so it is regular; expanding it drops a factor sin^2(theta)
 * from numerator and denominator alike and leaves the polynomial 2-form
 *
 *   Omega = y (r^2+a^2) dx ^ dz + r^2 dy ^ (z dx - x dz).
 *
 * The spin axis (x = z = 0) is an ordinary point of every line below.
 */
export function walkerPenrose(pos: V3, a: number, P: V4, F: V4): WPConstant {
  const [x, y, z] = pos;
  const r = ksRadius(pos, a);
  const r2 = r * r;
  const a2 = a * a;
  const D = r2 + a2;
  const ku = (r * r2) / (r2 * r2 + a2 * y * y);

  const drP = ku * (x * P[1] + z * P[3] + ((D * y) / r2) * P[2]);
  const drF = ku * (x * F[1] + z * F[3] + ((D * y) / r2) * F[2]);
  const wAP = P[0] - (a / D) * (z * P[1] - x * P[3]);
  const wAF = F[0] - (a / D) * (z * F[1] - x * F[3]);
  const A = drP * wAF - drF * wAP;

  const s2r2 = (r2 * (x * x + z * z)) / D; // r^2 sin^2(theta)
  const kb = ku / r2;
  const wBP = kb * (y * (x * P[1] + z * P[3]) - s2r2 * P[2]);
  const wBF = kb * (y * (x * F[1] + z * F[3]) - s2r2 * F[2]);
  const omega =
    y * D * (P[1] * F[3] - P[3] * F[1]) +
    r2 * (P[2] * (z * F[1] - x * F[3]) - (z * P[1] - x * P[3]) * F[2]);
  const B = -kb * omega - a * (wBP * F[0] - wBF * P[0]);

  const ct = (a * y) / r; // a cos(theta)
  return { k1: r * A - ct * B, k2: -(ct * A + r * B) };
}

/**
 * The camera's two sky legs for one pixel, and their Walker–Penrose
 * constants — the basis every emitted polarization is read against.
 *
 * eH and eV are unit 3-vectors in the tetrad's own orthonormal components,
 * both perpendicular to the view direction n, so they are legitimate
 * polarizations without further work: a vector spatial in the static frame
 * and perpendicular to n is automatically orthogonal to the ray, whose
 * tangent is a combination of u and n alone.
 *
 * eH is the tetrad's right leg with n projected out. That is well defined for
 * every pixel of a forward-facing camera (n always has a positive forward
 * component, so it can never align with right), which is why this needs no
 * degenerate case.
 */
export interface SkyBasis {
  eH: V3;
  eV: V3;
  kH: WPConstant;
  kV: WPConstant;
  /** kH x kV. Vanishing would mean the two legs carry the same kappa. */
  det: number;
}

export function skyBasis(camPos: V3, a: number, tet: Tetrad, n: V3): SkyBasis {
  const h: V3 = [1 - n[0] * n[0], -n[1] * n[0], -n[2] * n[0]];
  const hn = 1 / Math.hypot(h[0], h[1], h[2]);
  const eH: V3 = [h[0] * hn, h[1] * hn, h[2] * hn];
  const eV: V3 = [
    n[1] * eH[2] - n[2] * eH[1],
    n[2] * eH[0] - n[0] * eH[2],
    n[0] * eH[1] - n[1] * eH[0],
  ];
  // The ray's own contravariant tangent, built from the same legs the shader
  // launches with: n - u, which is the BACKWARD-traced tangent (the photon
  // itself arrives travelling along -n, so its forward tangent is u - n).
  // Which of the two signs is used does not matter, kappa being bilinear —
  // but u + n is a different null vector entirely and would silently give a
  // basis for the wrong ray.
  const P: V4 = [
    n[0] * tet.right[0] + n[1] * tet.up[0] + n[2] * tet.fwd[0] - tet.u[0],
    n[0] * tet.right[1] + n[1] * tet.up[1] + n[2] * tet.fwd[1] - tet.u[1],
    n[0] * tet.right[2] + n[1] * tet.up[2] + n[2] * tet.fwd[2] - tet.u[2],
    n[0] * tet.right[3] + n[1] * tet.up[3] + n[2] * tet.fwd[3] - tet.u[3],
  ];
  const kH = walkerPenrose(camPos, a, P, skyLeg(tet, eH));
  const kV = walkerPenrose(camPos, a, P, skyLeg(tet, eV));
  return { eH, eV, kH, kV, det: kH.k1 * kV.k2 - kH.k2 * kV.k1 };
}

/** A tetrad-component 3-vector as a world 4-vector (purely spatial in the frame). */
export function skyLeg(tet: Tetrad, e: V3): V4 {
  return [0, 1, 2, 3].map(
    (i) => e[0] * tet.right[i] + e[1] * tet.up[i] + e[2] * tet.fwd[i]
  ) as V4;
}

/**
 * Resolve an emitted kappa onto the camera's sky basis: the components of the
 * arriving polarization along (eH, eV).
 *
 * The transport is an isometry and both legs are unit and orthogonal to the
 * ray, so c1^2 + c2^2 = 1 for any unit emitted polarization — not imposed
 * here, but checked in the tests, where it is the sharpest single statement
 * that the whole chain is right.
 */
export function solveSky(
  basis: SkyBasis,
  k: WPConstant
): { c1: number; c2: number } {
  const { kH, kV, det } = basis;
  return {
    c1: (k.k1 * kV.k2 - k.k2 * kV.k1) / det,
    c2: (kH.k1 * k.k2 - kH.k2 * k.k1) / det,
  };
}

/**
 * Where a sky direction points on screen, in pixels, at the pixel whose view
 * direction is n (both in tetrad components).
 *
 * The camera's chart is gnomonic — the shader builds n by normalizing
 * (sx, sy, 1) — so a sky direction maps to the screen by the same
 * perspective divide, not by dropping its third component. The returned
 * vector is a direction only; its length carries the foreshortening and is
 * not meaningful. Off-axis this genuinely matters: a polarization tilted
 * toward the camera draws shorter and rotated, exactly as the projection of a
 * real sky vector does.
 */
export function skyToScreen(n: V3, e: V3): [number, number] {
  const s = e[2] / n[2];
  return [e[0] - n[0] * s, e[1] - n[1] * s];
}

/**
 * Accumulated linear polarization over a ray's disk crossings.
 *
 * Stokes parameters, in the camera's (eH, eV) sky basis and NOT in screen
 * coordinates: the sky basis is orthonormal, so Q and U add there; the screen
 * is a distorted chart of it and adding in the chart would bend the angles.
 * The projection to screen happens once, at the very end, on the resolved
 * direction.
 *
 * Adding per crossing is the physics, not an approximation of it: a ray that
 * pierces the disk twice carries two images whose planes have been rotated
 * differently, and where they overlap the light really is depolarized. The
 * tempting shortcut — kappa is linear, so sum the kappas — is wrong, because
 * Q and U are quadratic in the polarization; each crossing must be resolved
 * before it is added.
 */
export interface Stokes {
  I: number;
  Q: number;
  U: number;
}

export const ZERO_STOKES: Stokes = { I: 0, Q: 0, U: 0 };

/**
 * Add one crossing: weight w (its contribution to the pixel's brightness),
 * polarized fraction deg, and the sky components (c1, c2) of its arriving
 * polarization. Uses the double-angle identities directly — with
 * c1^2 + c2^2 = 1 there is no trigonometry to do.
 */
export function addCrossing(
  s: Stokes,
  w: number,
  deg: number,
  c1: number,
  c2: number
): Stokes {
  return {
    I: s.I + w,
    Q: s.Q + w * deg * (c1 * c1 - c2 * c2),
    U: s.U + w * deg * 2 * c1 * c2,
  };
}

/**
 * Resolve accumulated Stokes into a polarized fraction and a sky direction.
 * The direction is a DIRECTOR — f and -f are the same polarization — so the
 * half-angle's branch is free and the returned vector is one of the two.
 */
export function resolveStokes(
  s: Stokes,
  basis: SkyBasis
): { degree: number; dir: V3 } {
  const p = Math.hypot(s.Q, s.U);
  const chi = 0.5 * Math.atan2(s.U, s.Q);
  const c = Math.cos(chi);
  const sn = Math.sin(chi);
  return {
    degree: s.I > 0 ? p / s.I : 0,
    dir: [
      c * basis.eH[0] + sn * basis.eV[0],
      c * basis.eH[1] + sn * basis.eV[1],
      c * basis.eH[2] + sn * basis.eV[2],
    ],
  };
}

/**
 * The photon's spatial direction in an emitter's rest frame: khat, the unit
 * 3-direction such that P is proportional to u + khat. Every emitter model
 * needs it — the polarized fraction of scattered light depends on the angle
 * between khat and the surface normal, and synchrotron's does on the angle to
 * the field.
 */
export function photonDirInFrame(pos: V3, a: number, u: V4, P: V4): V4 {
  const E = -gDot(pos, a, P, u); // emitted energy, positive for a future P
  return [P[0] / E - u[0], P[1] / E - u[1], P[2] / E - u[2], P[3] / E - u[3]];
}

/**
 * A unit polarization for an emitter: the direction d, as seen in the frame
 * of an emitter with 4-velocity u, made transverse to the photon and
 * normalized.
 *
 * d is expected orthogonal to u (a direction in the emitter's own rest
 * space). Removing its component along khat leaves a vector orthogonal to
 * both u and khat, hence to P — which is what a polarization must be. Returns
 * null when d is parallel to the line of sight: nothing transverse survives,
 * and that light is unpolarized rather than polarized along some arbitrary
 * direction the normalization would invent.
 */
export function emitterPolarization(
  pos: V3,
  a: number,
  u: V4,
  P: V4,
  d: V4
): V4 | null {
  const k = photonDirInFrame(pos, a, u, P);
  const dk = gDot(pos, a, d, k);
  const f: V4 = [
    d[0] - dk * k[0],
    d[1] - dk * k[1],
    d[2] - dk * k[2],
    d[3] - dk * k[3],
  ];
  const n2 = gDot(pos, a, f, f);
  if (!(n2 > 1e-10)) return null;
  const n = 1 / Math.sqrt(n2);
  return [f[0] * n, f[1] * n, f[2] * n, f[3] * n];
}
