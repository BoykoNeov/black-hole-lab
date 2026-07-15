/**
 * Physical-scale astrophysics (slice 5). The renderer works in geometrized
 * units (G = c = M = 1), where the picture is mass-independent; everything
 * that DOES depend on the black hole's mass in physical units lives here:
 *
 *  - unit conversions (one M of length/time for a hole of a given mass),
 *  - the thin-disk peak temperature, T ∝ mdot^(1/4) M^(-1/4) — big holes
 *    have COOLER disks, the counterintuitive classic,
 *  - tidal-disruption scales: the tidal radius of a sun-like star measured
 *    in M shrinks as M^(-2/3), so above the Hills mass it falls inside the
 *    horizon and stars are swallowed whole instead of shredded,
 *  - the Rees t^(-5/3) fallback flare that a disruption feeds the disk.
 *
 * Pure and unit-tested (test/astro.test.ts); main.ts feeds the results to
 * the shader as uniforms.
 */

/** Gravitational length GM/c^2 of one solar mass, in km. */
export const KM_PER_MSUN = 1.476625;

/** Gravitational time GM/c^3 of one solar mass, in seconds. */
export const SEC_PER_MSUN = 4.92549e-6;

/** Solar radius in km. */
export const RSUN_KM = 6.957e5;

/** One M of length, in km, for a hole of the given mass. */
export function lengthKm(massMsun: number): number {
  return KM_PER_MSUN * massMsun;
}

/** One M of time, in seconds, for a hole of the given mass. */
export function timeSec(massMsun: number): number {
  return SEC_PER_MSUN * massMsun;
}

/**
 * Shakura–Sunyaev peak effective temperature of a thin disk:
 * T_max = 0.488 (3 G M Mdot / (8 pi sigma R_in^3))^(1/4). Evaluated at
 * R_in = 6M for one solar mass accreting at the Eddington rate
 * (Mdot_Edd = L_Edd / 0.057 c^2, the Schwarzschild efficiency) this gives
 * 1.54e7 K, and scales as mdot^(1/4) M^(-1/4).
 */
export const T_PEAK_MSUN_EDD = 1.54e7;

/**
 * Peak disk temperature in kelvin for a hole of massMsun accreting at
 * mdotEdd Eddington units, with the inner edge at the given ISCO radius
 * (units of M). The (6/isco)^(3/4) factor is the r^(-3/4) temperature
 * envelope evaluated at the spin's inner edge: spinning the hole up pulls
 * the disk inward and makes it hotter.
 */
export function peakTempK(massMsun: number, mdotEdd: number, isco = 6): number {
  return (
    T_PEAK_MSUN_EDD *
    Math.pow(mdotEdd, 0.25) *
    Math.pow(massMsun, -0.25) *
    Math.pow(6 / isco, 0.75)
  );
}

/** Rough Wien-peak band of a blackbody at tempK (for the readout). */
export function bandLabel(tempK: number): string {
  if (tempK >= 3e5) return "X-ray";
  if (tempK >= 1e4) return "ultraviolet";
  if (tempK >= 3800) return "visible";
  return "infrared";
}

/**
 * Tidal radius of a sun-like star (M* = M☉, R* = R☉) in units of the
 * hole's M: r_t = R* (M/M*)^(1/3) / (GM/c^2) = (R☉/1.4766 km) m^(-2/3).
 * The coefficient is 4.71e5: huge for stellar-mass holes, ~10 M at 1e7 M☉,
 * and inside the horizon by ~1.1e8 M☉.
 */
export const RT_COEF = RSUN_KM / KM_PER_MSUN;

export function tidalRadiusM(massMsun: number): number {
  return RT_COEF * Math.pow(massMsun, -2 / 3);
}

/**
 * Hills mass: the hole mass (in M☉) above which the tidal radius of a
 * sun-like star sits inside the given horizon radius (units of M) — the
 * star crosses the horizon intact and there is no flare. ~1.1e8 M☉ for
 * a = 0; spin shrinks the horizon and raises it.
 */
export function hillsMassMsun(rHor: number): number {
  return Math.pow(RT_COEF / rHor, 1.5);
}

/**
 * Peak TDE fallback rate in Eddington units, ~133 (M/1e6 M☉)^(-3/2) for a
 * sun-like star: strongly super-Eddington around small holes, feeble around
 * big ones. Capped for display sanity.
 */
export function flarePeakEdd(massMsun: number): number {
  return Math.min(133 * Math.pow(massMsun / 1e6, -1.5), 30);
}

/**
 * Fallback accretion rate (Eddington units) at time t after disruption:
 * a smooth rise to the peak at t0 (the return time of the most-bound
 * debris), then the classic Rees t^(-5/3) decay.
 */
export function flareMdotEdd(t: number, t0: number, peak: number): number {
  if (t <= 0) return 0;
  const n = t / t0;
  if (n < 1) {
    const s = n * n * (3 - 2 * n);
    return peak * s * s;
  }
  return peak * Math.pow(n, -5 / 3);
}
