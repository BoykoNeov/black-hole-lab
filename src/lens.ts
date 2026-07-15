/**
 * Schwarzschild null-geodesic integrator and lens-table baker.
 *
 * Units: geometrized, G = c = M = 1. All lengths are in units of the black
 * hole mass M (the Schwarzschild radius is r_s = 2).
 *
 * Photon orbits in Schwarzschild are planar, so lensing reduces to a scalar
 * function: for an observer at rest at radius r, a view ray making angle
 * `theta` with the direction TOWARD the hole either falls in (shadow) or
 * escapes to infinity at asymptotic position angle `psi` in the orbital
 * plane (angle measured around the hole from the observer's position).
 * Flat space would give psi = PI - theta; gravity gives more.
 *
 * We integrate the standard orbit equation for u(phi) = 1/r:
 *     u'' = 3u^2 - u
 * with RK4, and bake psi(r, theta) into a 2D table the GPU samples.
 */

/** Critical impact parameter for photon capture, b_c = 3*sqrt(3) M. */
export const B_CRIT = 3 * Math.sqrt(3);

/** Horizon radius in these units. */
export const R_HORIZON = 2;

/**
 * Impact parameter of a ray launched at local angle theta from the
 * radial direction, by an observer at rest at radius r (r > 2).
 */
export function impactParameter(r: number, theta: number): number {
  return (r * Math.sin(theta)) / Math.sqrt(1 - 2 / r);
}

/**
 * Shadow edge: view angles theta < thetaCrit(r) (aimed inward) are captured.
 * Valid for r > 3 (observer outside the photon sphere).
 */
export function thetaCrit(r: number): number {
  const s = (B_CRIT * Math.sqrt(1 - 2 / r)) / r;
  return Math.asin(Math.min(1, s));
}

export interface TraceResult {
  /** Asymptotic position angle of the escaped ray, or NaN if captured. */
  psi: number;
  captured: boolean;
}

/**
 * Trace one backward ray from an observer at rest at radius r0 (> 3),
 * launched at angle theta in [0, PI] from the direction toward the hole.
 * Returns the asymptotic position angle psi of the sky direction the ray
 * came from, measured in the orbital plane from the observer's position
 * angle (observer sits at phi = 0). Captured rays return { captured: true }.
 */
export function traceRay(
  r0: number,
  theta: number,
  h = 0.02,
  phiMax = 12 * Math.PI
): TraceResult {
  if (theta <= 0) return { psi: NaN, captured: true }; // straight at the hole
  if (theta >= Math.PI) return { psi: 0, captured: false }; // straight away

  const b = impactParameter(r0, theta);
  const inward = theta < Math.PI / 2;
  // Inward rays inside the critical impact parameter are captured; outward
  // rays from r0 > 3 always escape (they start outside the potential peak).
  if (inward && b < B_CRIT) return { psi: NaN, captured: true };

  let u = 1 / r0;
  // (du/dphi)^2 = 1/b^2 - u^2 (1 - 2u); sign: + when moving inward.
  const w2 = 1 / (b * b) - u * u * (1 - 2 * u);
  let w = (inward ? 1 : -1) * Math.sqrt(Math.max(0, w2));
  let phi = 0;

  const f = (uu: number) => 3 * uu * uu - uu; // u'' = 3u^2 - u

  while (phi < phiMax) {
    const uPrev = u;
    // RK4 on the system (u, w).
    const k1u = w;
    const k1w = f(u);
    const k2u = w + 0.5 * h * k1w;
    const k2w = f(u + 0.5 * h * k1u);
    const k3u = w + 0.5 * h * k2w;
    const k3w = f(u + 0.5 * h * k2u);
    const k4u = w + h * k3w;
    const k4w = f(u + h * k3u);
    u += (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    w += (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    phi += h;

    if (u <= 0) {
      // Escaped: interpolate phi at the u = 0 crossing.
      const frac = uPrev / (uPrev - u);
      return { psi: phi - h + h * frac, captured: false };
    }
    if (u >= 1 / R_HORIZON) return { psi: NaN, captured: true };
  }
  // Wound around too long — orbiting arbitrarily close to the photon
  // sphere; visually indistinguishable from captured.
  return { psi: NaN, captured: true };
}

export interface LensTable {
  rows: number; // radius samples
  cols: number; // angle samples
  rMin: number;
  rMax: number;
  /** RG pairs per texel: R = psi, G = 1 escaped / 0 captured. Row-major. */
  data: Float32Array;
}

/** Log-spaced observer radius for row i. */
export function rowRadius(i: number, rows: number, rMin: number, rMax: number): number {
  const t = rows === 1 ? 0 : i / (rows - 1);
  return Math.exp(Math.log(rMin) + t * (Math.log(rMax) - Math.log(rMin)));
}

/**
 * Column j maps to theta = thetaCrit + (PI - thetaCrit) * s^2 with
 * s = j/(cols-1): quadratic clustering of samples near the shadow edge,
 * where psi diverges logarithmically (photon ring, higher-order images).
 */
export function colTheta(j: number, cols: number, thc: number): number {
  const s = j / (cols - 1);
  return thc + (Math.PI - thc) * Math.max(s * s, 1e-9);
}

export function buildLensRow(
  r: number,
  cols: number,
  out: Float32Array,
  offset: number
): void {
  const thc = thetaCrit(r);
  for (let j = 0; j < cols; j++) {
    const theta = Math.min(colTheta(j, cols, thc), Math.PI);
    const res = traceRay(r, theta);
    out[offset + 2 * j] = res.captured ? 0 : res.psi;
    out[offset + 2 * j + 1] = res.captured ? 0 : 1;
  }
}

/** Synchronous full bake (used by tests; the app bakes rows chunked). */
export function buildLensTable(
  rows: number,
  cols: number,
  rMin: number,
  rMax: number
): LensTable {
  const data = new Float32Array(rows * cols * 2);
  for (let i = 0; i < rows; i++) {
    buildLensRow(rowRadius(i, rows, rMin, rMax), cols, data, i * cols * 2);
  }
  return { rows, cols, rMin, rMax, data };
}
