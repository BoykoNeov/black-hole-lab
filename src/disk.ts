/**
 * Thin accretion-disk physics helpers (geometrized units, G = c = M = 1).
 *
 * These mirror the GLSL implementations in shaders.ts so the formulas can
 * be unit-tested against closed-form GR results. Keep the two in sync.
 */

/** Innermost stable circular orbit for Schwarzschild. */
export const R_ISCO = 6;

/** Peak of the temperature profile: r = 49/6, where d/dr [r^-3 (1 - sqrt(6/r))] = 0. */
export const R_T_PEAK = 49 / 6;

/** The profile peak scales with the inner edge: r_peak = (49/36) * isco. */
export function tempPeakRadius(isco: number): number {
  return (49 / 36) * isco;
}

/** Normalization so the profile peaks at 1; 1 - sqrt(36/49) = 1/7 exactly. */
export function tempNorm(isco: number): number {
  return Math.pow(tempPeakRadius(isco), -0.75) * Math.pow(1 / 7, 0.25);
}

/**
 * Locally measured orbital speed (fraction of c) of matter on a circular
 * geodesic at radius r, relative to a static observer: beta = sqrt(M/(r-2M)).
 * ISCO matter moves at exactly c/2.
 */
export function orbitBeta(r: number): number {
  return 1 / Math.sqrt(r - 2);
}

/**
 * Combined shift factor g = nu_observed / nu_emitted for a photon emitted
 * by circular-orbit matter at radius r and received at infinity, where
 * cosXi is the cosine of the angle between the photon's direction of travel
 * and the matter's velocity (both in the local frame; we approximate with
 * coordinate directions in the shader). Gravitational redshift times
 * special-relativistic Doppler; face-on (cosXi = 0) this is exactly
 * sqrt(1 - 3/r), the textbook circular-orbit result.
 */
export function gFactor(r: number, cosXi: number): number {
  const beta = orbitBeta(r);
  return (
    (Math.sqrt(1 - 2 / r) * Math.sqrt(1 - beta * beta)) / (1 - beta * cosXi)
  );
}

/**
 * Novikov–Thorne-style thin-disk temperature profile,
 * T(r) ∝ r^(-3/4) (1 - sqrt(isco/r))^(1/4), normalized to peak at 1.
 * Zero at the inner edge (zero-torque boundary), peak at (49/36) * isco.
 * Since slice 4 the inner edge follows the Kerr ISCO of the current spin.
 */
export function diskTempProfile(r: number, isco = R_ISCO): number {
  if (r <= isco) return 0;
  return (
    (Math.pow(r, -0.75) * Math.pow(1 - Math.sqrt(isco / r), 0.25)) /
    tempNorm(isco)
  );
}
