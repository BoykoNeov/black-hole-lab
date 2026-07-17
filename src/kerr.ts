/**
 * Kerr spacetime reference: closed-form orbit physics and a Kerr–Schild
 * null-geodesic integrator (slice 4).
 *
 * Units: geometrized, G = c = M = 1; the spin parameter a = J/M is in
 * [0, 1). World frame: the spin axis is +y (the disk lives in y = 0) and
 * prograde matter moves with world azimuth az = atan2(z, x) DECREASING in
 * coordinate time — the sense the disk has used since slice 2.
 *
 * Coordinates are Cartesian Kerr–Schild (horizon-penetrating, regular on
 * the spin axis — rays cross the poles and the horizon without coordinate
 * trouble):
 *     g_munu = eta_munu + f l_mu l_nu,
 *     f = 2 r^3 / (r^4 + a^2 y^2),        l_mu = (1, lvec),
 *     lvec = ((r x - a z)/(r^2+a^2), y/r, (r z + a x)/(r^2+a^2)),
 * where r is the Boyer–Lindquist radius, the positive root of
 *     r^4 - r^2 (rho^2 - a^2) - a^2 y^2 = 0,   rho^2 = x^2+y^2+z^2.
 *
 * Rays are traced backward from the camera: the integrated covariant
 * momentum m_mu is the time-reversed tangent (m = n - u_cam at launch, with
 * n the unit spatial view direction in the camera's frame), normalized so
 * the camera-frame energy is 1. The exact shift factor for any emitter with
 * 4-velocity u^mu is then simply
 *     g = nu_obs / nu_em = 1 / (m_mu u^mu),
 * which needs no metric at the emission point. The GLSL in shaders.ts
 * mirrors the integrator and these formulas; this module is the tested
 * oracle (as lens.ts is for the Schwarzschild orbit equation).
 */

export type V3 = [number, number, number];
/** Contravariant or covariant 4-vector, ordered (t, x, y, z). */
export type V4 = [number, number, number, number];

// ---------- closed-form Kerr orbit physics (equatorial, prograde) ----------

/** Outer horizon radius r+ = 1 + sqrt(1 - a^2). */
export function horizonRadius(a: number): number {
  return 1 + Math.sqrt(Math.max(1 - a * a, 0));
}

/** Prograde ISCO radius (Bardeen–Press–Teukolsky 1972). a = 0 gives 6. */
export function iscoRadius(a: number): number {
  const z1 =
    1 +
    Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

/**
 * Coordinate angular velocity dphi/dt of a prograde circular equatorial
 * geodesic (phi in the prograde sense; world azimuth runs opposite).
 */
export function omegaCirc(r: number, a: number): number {
  return 1 / (Math.pow(r, 1.5) + a);
}

/** u^t of a prograde circular equatorial geodesic. a = 0: 1/sqrt(1-3/r). */
export function circUt(r: number, a: number): number {
  const sr = Math.sqrt(r);
  return (r * sr + a) / (Math.pow(r, 0.75) * Math.sqrt(r * sr - 3 * sr + 2 * a));
}

/** Conserved E and L (per unit mass) of a prograde circular orbit at r. */
export function circEL(r: number, a: number): { E: number; L: number } {
  const sr = Math.sqrt(r);
  const den = Math.pow(r, 0.75) * Math.sqrt(r * sr - 3 * sr + 2 * a);
  return {
    E: (r * sr - 2 * sr + a) / den,
    L: (r * r - 2 * a * sr + a * a) / den,
  };
}

/** E and L of the marginally stable (ISCO) orbit — the plunge constants. */
export function iscoConstants(a: number): { E: number; L: number; r: number } {
  const r = iscoRadius(a);
  return { ...circEL(r, a), r };
}

/**
 * Equatorial plunge 4-velocity inside the ISCO in Boyer–Lindquist
 * components, for matter that fell from the ISCO conserving its E and L.
 * u^r = 0 at the ISCO itself; returns u^r <= 0.
 */
export function plungeUBL(
  r: number,
  a: number,
  E: number,
  L: number
): { ut: number; ur: number; uphi: number } {
  const delta = r * r - 2 * r + a * a;
  const ur2 =
    E * E -
    1 +
    2 / r +
    (a * a * (E * E - 1) - L * L) / (r * r) +
    (2 * (L - a * E) * (L - a * E)) / (r * r * r);
  const ur = -Math.sqrt(Math.max(ur2, 0));
  return {
    ut: ((r * r + a * a + (2 * a * a) / r) * E - ((2 * a) / r) * L) / delta,
    ur,
    uphi: ((1 - 2 / r) * L + ((2 * a) / r) * E) / delta,
  };
}

/**
 * Same plunge velocity in Kerr–Schild time and azimuth (regular at the
 * horizon): t~ = t + int 2r/Delta dr, phi~ = phi + int a/Delta dr.
 */
export function plungeUKS(
  r: number,
  a: number,
  E: number,
  L: number
): { ut: number; ur: number; uphi: number } {
  const { ut, ur, uphi } = plungeUBL(r, a, E, L);
  const delta = r * r - 2 * r + a * a;
  return { ut: ut + (2 * r * ur) / delta, ur, uphi: uphi + (a * ur) / delta };
}

// ---------- Kerr–Schild metric machinery (world frame, spin along +y) ----------

/** Boyer–Lindquist radius of the world point p. */
export function ksRadius(p: V3, a: number): number {
  const rho2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  const q = rho2 - a * a;
  return Math.sqrt(0.5 * (q + Math.sqrt(q * q + 4 * a * a * p[1] * p[1])));
}

export interface KSMetric {
  r: number;
  f: number;
  l: V3; // spatial part of l_mu (l_t = 1)
}

export function ksMetric(p: V3, a: number): KSMetric {
  const r = ksRadius(p, a);
  const f = (2 * r * r * r) / (r * r * r * r + a * a * p[1] * p[1]);
  const D = r * r + a * a;
  return {
    r,
    f,
    l: [(r * p[0] - a * p[2]) / D, p[1] / r, (r * p[2] + a * p[0]) / D],
  };
}

/** g_munu A^mu B^nu for contravariant A, B at world point p. */
export function gDot(p: V3, a: number, A: V4, B: V4): number {
  const { f, l } = ksMetric(p, a);
  const eta = -A[0] * B[0] + A[1] * B[1] + A[2] * B[2] + A[3] * B[3];
  const la = A[0] + l[0] * A[1] + l[1] * A[2] + l[2] * A[3]; // l_mu A^mu
  const lb = B[0] + l[0] * B[1] + l[1] * B[2] + l[2] * B[3];
  return eta + f * la * lb;
}

/** Lower a contravariant 4-vector at p: (g V)_mu. */
export function lower(p: V3, a: number, V: V4): V4 {
  const { f, l } = ksMetric(p, a);
  const lv = V[0] + l[0] * V[1] + l[1] * V[2] + l[2] * V[3];
  return [
    -V[0] + f * lv,
    V[1] + f * lv * l[0],
    V[2] + f * lv * l[1],
    V[3] + f * lv * l[2],
  ];
}

/**
 * Raise a covariant 4-vector at p: V^mu = g^munu m_nu. The Kerr–Schild
 * inverse is exact: g^munu = eta^munu - f l^mu l^nu with l^mu = (-1, lvec),
 * so with P = l^mu m_mu = -m_t + lvec.mvec:
 *   V^t = -m_t + f P,   V^i = m_i - f P l_i.
 * For a marched momentum this yields the contravariant tangent dx^mu/dsigma
 * (the spatial part is exactly the integrator's dp/dsigma).
 */
export function raise(p: V3, a: number, m: V4): V4 {
  const { f, l } = ksMetric(p, a);
  const P = -m[0] + l[0] * m[1] + l[1] * m[2] + l[2] * m[3];
  return [
    -m[0] + f * P,
    m[1] - f * P * l[0],
    m[2] - f * P * l[1],
    m[3] - f * P * l[2],
  ];
}

/**
 * Normalize a coordinate velocity (1, v) into a 4-velocity u^mu (u.u = -1).
 * Valid while (1, v) is timelike.
 */
export function normalizeVel(p: V3, a: number, v: V3): V4 {
  const V: V4 = [1, v[0], v[1], v[2]];
  const n2 = -gDot(p, a, V, V);
  const s = 1 / Math.sqrt(Math.max(n2, 1e-12));
  return [s, s * v[0], s * v[1], s * v[2]];
}

/**
 * Exact shift factor nu_obs/nu_em for an emitter with contravariant
 * 4-velocity u, given the ray's covariant marched momentum (mt, mv)
 * (camera-frame energy normalized to 1 at launch).
 */
export function shiftFactor(mt: number, mv: V3, u: V4): number {
  return 1 / (mt * u[0] + mv[0] * u[1] + mv[1] * u[2] + mv[2] * u[3]);
}

// ---------- equatorial 4-velocities in world Cartesian components ----------

/**
 * 4-velocity (t, x, y, z) of prograde circular-orbit matter at BL radius r,
 * world azimuth az (the point sits at sqrt(r^2+a^2) * (cos az, 0, sin az)).
 */
export function uCircCart(r: number, az: number, a: number): V4 {
  const ut = circUt(r, a);
  const om = omegaCirc(r, a);
  const R = Math.sqrt(r * r + a * a);
  // daz/dt = -Omega (prograde sense): velocity = ut * Omega * (z, 0, -x)
  return [ut, ut * om * R * Math.sin(az), 0, -ut * om * R * Math.cos(az)];
}

/**
 * 4-velocity of matter plunging from the ISCO, at BL radius r and world
 * azimuth az. Uses Kerr–Schild time, so it stays regular through the
 * horizon. The Cartesian azimuth twist phi_c = phi~ + arctan(a/r) is
 * accounted for.
 */
export function uPlungeCart(r: number, az: number, a: number): V4 {
  const { E, L } = iscoConstants(a);
  const { ut, ur, uphi } = plungeUKS(r, a, E, L);
  const D = r * r + a * a;
  const R = Math.sqrt(D);
  const dR = (r / R) * ur; // dR/dlambda
  const dphic = uphi - (a / D) * ur; // d(cartesian prograde angle)/dlambda
  const daz = -dphic;
  const c = Math.cos(az);
  const s = Math.sin(az);
  return [ut, dR * c - R * s * daz, 0, dR * s + R * c * daz];
}

/**
 * World-azimuth drift rates of a plunging blob per unit KS coordinate
 * time: { drdt, dazdt }. Used by the CPU gas stepper (matter.ts).
 */
export function plungeRates(
  r: number,
  a: number,
  E: number,
  L: number
): { drdt: number; dazdt: number } {
  const { ut, ur, uphi } = plungeUKS(r, a, E, L);
  const dphic = uphi - (a / (r * r + a * a)) * ur;
  return { drdt: ur / ut, dazdt: -dphic / ut };
}

/**
 * Exact shift factor for the disk sheet: circular-orbit emitter at BL
 * radius rc, using only conserved ray quantities — mt = m_t and
 * lam = z m_x - x m_z (the world-frame axial momentum, conserved by
 * axisymmetry). Derivation: m.u = u^t (m_t + Omega lam).
 */
export function diskShift(rc: number, a: number, mt: number, lam: number): number {
  return 1 / (circUt(rc, a) * (mt + omegaCirc(rc, a) * lam));
}

// ---------- static-observer camera tetrad ----------

export interface Tetrad {
  /** Contravariant legs (u = the static camera's 4-velocity). */
  u: V4;
  right: V4;
  up: V4;
  fwd: V4;
  /** Covariant legs for building m_mu = sum d_i e_i - u (all lowered). */
  uCov: V4;
  rightCov: V4;
  upCov: V4;
  fwdCov: V4;
}

/**
 * Orthonormal frame of a static observer at p whose spatial legs are the
 * Gram–Schmidt projections of the world right/up/fwd directions. Requires
 * p outside the ergosphere (true for the camera's allowed range).
 */
export function buildStaticTetrad(
  p: V3,
  a: number,
  right: V3,
  up: V3,
  fwd: V3
): Tetrad {
  const { f } = ksMetric(p, a);
  const u: V4 = [1 / Math.sqrt(Math.max(1 - f, 1e-9)), 0, 0, 0];
  const legs: V4[] = [];
  for (const d of [right, up, fwd]) {
    let e: V4 = [0, d[0], d[1], d[2]];
    // project out the time leg (u.u = -1) and previous spatial legs
    const eu = gDot(p, a, e, u);
    e = [e[0] + eu * u[0], e[1] + eu * u[1], e[2] + eu * u[2], e[3] + eu * u[3]];
    for (const prev of legs) {
      const ep = gDot(p, a, e, prev);
      e = [
        e[0] - ep * prev[0],
        e[1] - ep * prev[1],
        e[2] - ep * prev[2],
        e[3] - ep * prev[3],
      ];
    }
    const n = 1 / Math.sqrt(gDot(p, a, e, e));
    legs.push([e[0] * n, e[1] * n, e[2] * n, e[3] * n]);
  }
  return {
    u,
    right: legs[0],
    up: legs[1],
    fwd: legs[2],
    uCov: lower(p, a, u),
    rightCov: lower(p, a, legs[0]),
    upCov: lower(p, a, legs[1]),
    fwdCov: lower(p, a, legs[2]),
  };
}

// ---------- Hamiltonian null-geodesic integrator ----------

/**
 * H = 1/2 g^munu m_mu m_nu = 1/2 (-mt^2 + |mv|^2 - f P^2), P = -mt + l.mv.
 * Zero along a null ray; used by tests as a conservation check.
 */
export function hamiltonian(p: V3, a: number, mt: number, mv: V3): number {
  const { f, l } = ksMetric(p, a);
  const P = -mt + l[0] * mv[0] + l[1] * mv[1] + l[2] * mv[2];
  return 0.5 * (-mt * mt + mv[0] * mv[0] + mv[1] * mv[1] + mv[2] * mv[2] - f * P * P);
}

interface Deriv {
  dp: V3; // dx/dsigma = mv - f P l
  dm: V3; // dm_i/dsigma = 1/2 df_i P^2 + f P (dl_j/dx_i m_j)
}

function derivs(p: V3, a: number, mt: number, mv: V3): Deriv {
  const x = p[0], y = p[1], z = p[2];
  const r = ksRadius(p, a);
  const r2 = r * r;
  const sig = r2 * r2 + a * a * y * y;
  const f = (2 * r2 * r) / sig;
  const D = r2 + a * a;
  const lx = (r * x - a * z) / D;
  const ly = y / r;
  const lz = (r * z + a * x) / D;

  // gradient of r: (r/sig) * (r^2 x, y D, r^2 z)
  const rs = r / sig;
  const drx = rs * r2 * x;
  const dry = rs * y * D;
  const drz = rs * r2 * z;

  // gradient of f = 2 r^3 / sig
  const fs = (6 * r2) / sig;
  const fq = (2 * r2 * r) / (sig * sig);
  const dfx = fs * drx - fq * (4 * r2 * r * drx);
  const dfy = fs * dry - fq * (4 * r2 * r * dry + 2 * a * a * y);
  const dfz = fs * drz - fq * (4 * r2 * r * drz);

  // gradients of the spatial l components
  const D2 = D * D;
  const nx = r * x - a * z;
  const nz = r * z + a * x;
  const tr = 2 * r;
  const dlx_x = ((drx * x + r) * D - nx * tr * drx) / D2;
  const dlx_y = (dry * x * D - nx * tr * dry) / D2;
  const dlx_z = ((drz * x - a) * D - nx * tr * drz) / D2;
  const dlz_x = ((drx * z + a) * D - nz * tr * drx) / D2;
  const dlz_y = (dry * z * D - nz * tr * dry) / D2;
  const dlz_z = ((drz * z + r) * D - nz * tr * drz) / D2;
  const dly_x = -(y * drx) / r2;
  const dly_y = 1 / r - (y * dry) / r2;
  const dly_z = -(y * drz) / r2;

  const P = -mt + lx * mv[0] + ly * mv[1] + lz * mv[2];
  const fP = f * P;
  return {
    dp: [mv[0] - fP * lx, mv[1] - fP * ly, mv[2] - fP * lz],
    dm: [
      0.5 * dfx * P * P + fP * (dlx_x * mv[0] + dly_x * mv[1] + dlz_x * mv[2]),
      0.5 * dfy * P * P + fP * (dlx_y * mv[0] + dly_y * mv[1] + dlz_y * mv[2]),
      0.5 * dfz * P * P + fP * (dlx_z * mv[0] + dly_z * mv[1] + dlz_z * mv[2]),
    ],
  };
}

/** One RK4 step of size h in the affine parameter. Mutates nothing. */
export function rk4Step(
  p: V3,
  mv: V3,
  a: number,
  mt: number,
  h: number
): { p: V3; mv: V3 } {
  const k1 = derivs(p, a, mt, mv);
  const p2: V3 = [p[0] + 0.5 * h * k1.dp[0], p[1] + 0.5 * h * k1.dp[1], p[2] + 0.5 * h * k1.dp[2]];
  const m2: V3 = [mv[0] + 0.5 * h * k1.dm[0], mv[1] + 0.5 * h * k1.dm[1], mv[2] + 0.5 * h * k1.dm[2]];
  const k2 = derivs(p2, a, mt, m2);
  const p3: V3 = [p[0] + 0.5 * h * k2.dp[0], p[1] + 0.5 * h * k2.dp[1], p[2] + 0.5 * h * k2.dp[2]];
  const m3: V3 = [mv[0] + 0.5 * h * k2.dm[0], mv[1] + 0.5 * h * k2.dm[1], mv[2] + 0.5 * h * k2.dm[2]];
  const k3 = derivs(p3, a, mt, m3);
  const p4: V3 = [p[0] + h * k3.dp[0], p[1] + h * k3.dp[1], p[2] + h * k3.dp[2]];
  const m4: V3 = [mv[0] + h * k3.dm[0], mv[1] + h * k3.dm[1], mv[2] + h * k3.dm[2]];
  const k4 = derivs(p4, a, mt, m4);
  const w = h / 6;
  return {
    p: [
      p[0] + w * (k1.dp[0] + 2 * k2.dp[0] + 2 * k3.dp[0] + k4.dp[0]),
      p[1] + w * (k1.dp[1] + 2 * k2.dp[1] + 2 * k3.dp[1] + k4.dp[1]),
      p[2] + w * (k1.dp[2] + 2 * k2.dp[2] + 2 * k3.dp[2] + k4.dp[2]),
    ],
    mv: [
      mv[0] + w * (k1.dm[0] + 2 * k2.dm[0] + 2 * k3.dm[0] + k4.dm[0]),
      mv[1] + w * (k1.dm[1] + 2 * k2.dm[1] + 2 * k3.dm[1] + k4.dm[1]),
      mv[2] + w * (k1.dm[2] + 2 * k2.dm[2] + 2 * k3.dm[2] + k4.dm[2]),
    ],
  };
}

/** Adaptive arc-length target, mirrored by the shader. */
export function stepLength(r: number): number {
  return Math.min(Math.max((0.16 * r * r) / (r + 14), 0.02), 4);
}

/**
 * The scene shader's march budget: the hard cap on its per-pixel RK4 loop, and
 * the step count the medium/high quality presets spend. Lives here so the GLSL
 * (which interpolates it into its loop bound), main.ts's presets and the tests
 * cannot drift apart — the number is only meaningful if all three agree.
 *
 * A ray that spends it is left as captured rather than escaping, which is not
 * free: see the shadow-edge budget test in test/edu.test.ts and the DESIGN.md
 * section on what gamma costs the renderer. Raising it is a real (and at high
 * spin, badly-paying) performance trade, not a bug fix.
 */
export const MARCH_MAX_STEPS = 320;

export interface KerrCrossing {
  /** BL radius of the equatorial crossing. */
  r: number;
  pos: V3;
  /** Exact circular-orbit disk shift factor at this crossing. */
  g: number;
}

export interface KerrTraceResult {
  escaped: boolean;
  /** Unit final travel direction (valid when escaped). */
  dir: V3;
  crossings: KerrCrossing[];
  /**
   * Total angle swept by the position direction over the whole trace, in
   * half-turns (pi rad each) — how far around the hole the ray actually went.
   *
   * This is the winding the photon-ring ladder is measured in, and the
   * definition is load-bearing rather than a matter of taste. The two
   * alternatives both fail on geometry the lab really renders: counting
   * equatorial (y) crossings is degenerate for an edge-on camera's in-plane
   * rays, which never cross and are exactly where the equatorial Lyapunov
   * exponent lives; accumulating azimuth about the spin axis breaks for rays
   * that swing near the axis, where the azimuth is ill-defined. The swept
   * position angle is frame-independent and needs neither a plane nor an axis.
   * At a = 0, where spherical symmetry means every view must return the same
   * exponent, only this one does: an edge-on and a face-on fit agree to five
   * decimals (3.14570 both, against pi = 3.14159 — the ~0.1% high bias is the
   * stepper's discretization, systematic across every spin and both edges).
   * See test/kerr.test.ts and the Lyapunov cross-check in test/edu.test.ts.
   */
  winding: number;
  steps: number;
  /** Final position and covariant spatial momentum (for diagnostics). */
  pos: V3;
  mv: V3;
  /** Conserved quantities for diagnostics. */
  mt: number;
  lam: number;
  /** Final Hamiltonian (should stay ~0). */
  H: number;
}

/**
 * Trace one backward ray. mCov is the full covariant launch momentum
 * (t, x, y, z), e.g. built from a Tetrad as
 *   m = dx*rightCov + dy*upCov + dz*fwdCov - uCov.
 */
export function traceRayKerr(
  camPos: V3,
  mCov: V4,
  a: number,
  opts: { rEscape?: number; maxSteps?: number } = {}
): KerrTraceResult {
  const rEscape = opts.rEscape ?? 64;
  const maxSteps = opts.maxSteps ?? 4000;
  const rHor = horizonRadius(a) + 0.01;
  const mt = mCov[0];
  let p: V3 = [...camPos];
  let mv: V3 = [mCov[1], mCov[2], mCov[3]];
  const lam = p[2] * mv[0] - p[0] * mv[2]; // z m_x - x m_z, conserved
  const crossings: KerrCrossing[] = [];

  let escaped = false;
  let steps = 0;
  let swept = 0;
  for (; steps < maxSteps; steps++) {
    const r = ksRadius(p, a);
    const d = derivs(p, a, mt, mv);
    const speed = Math.hypot(d.dp[0], d.dp[1], d.dp[2]);
    const h = stepLength(r) / Math.max(speed, 1e-9);
    const next = rk4Step(p, mv, a, mt, h);

    // Angle between successive position vectors, via atan2(|cross|, dot): the
    // steps are small, and acos of a dot product loses half its digits there.
    const cx = p[1] * next.p[2] - p[2] * next.p[1];
    const cy = p[2] * next.p[0] - p[0] * next.p[2];
    const cz = p[0] * next.p[1] - p[1] * next.p[0];
    swept += Math.atan2(
      Math.hypot(cx, cy, cz),
      p[0] * next.p[0] + p[1] * next.p[1] + p[2] * next.p[2]
    );

    if (p[1] * next.p[1] < 0) {
      const fr = p[1] / (p[1] - next.p[1]);
      const pc: V3 = [
        p[0] + fr * (next.p[0] - p[0]),
        0,
        p[2] + fr * (next.p[2] - p[2]),
      ];
      const rc2 = pc[0] * pc[0] + pc[2] * pc[2] - a * a;
      if (rc2 > 0) {
        const rc = Math.sqrt(rc2);
        crossings.push({ r: rc, pos: pc, g: diskShift(rc, a, mt, lam) });
      }
    }

    p = next.p;
    mv = next.mv;
    const rNew = ksRadius(p, a);
    if (rNew < rHor) break; // fell through the horizon
    // A captured backward ray belongs to the outgoing family, which ingoing
    // Kerr–Schild does not regularize: it approaches the horizon from outside
    // with covariant |mv| diverging like 1/(r - r+). RK4 eventually can't
    // follow that; mv runs away just above the cull radius and the garbage
    // trajectory can wander out past rEscape as a fake escape. Healthy rays
    // keep |mv| below ~50 even winding at the a = 0.998 photon orbit, so a
    // runaway this far past that can only be a captured ray — stop it as one,
    // the job the GLSL's isnan/step-budget breaks do on the GPU. The negated
    // comparison also catches NaN momenta.
    if (!(mv[0] * mv[0] + mv[1] * mv[1] + mv[2] * mv[2] < 1e8) || !Number.isFinite(rNew)) {
      break;
    }
    if (rNew > rEscape) {
      const out = p[0] * mv[0] + p[1] * mv[1] + p[2] * mv[2];
      if (out > 0) {
        escaped = true;
        break;
      }
    }
  }

  const d = derivs(p, a, mt, mv);
  const sp = Math.hypot(d.dp[0], d.dp[1], d.dp[2]) || 1;
  return {
    escaped,
    dir: [d.dp[0] / sp, d.dp[1] / sp, d.dp[2] / sp],
    crossings,
    winding: swept / Math.PI,
    steps,
    pos: p,
    mv,
    mt,
    lam,
    H: hamiltonian(p, a, mt, mv),
  };
}

// ---------- analytic capture: the fate a march cannot afford ----------

/**
 * A ray's two conserved impact parameters, the pair that fixes its fate.
 *
 * lambda = L_z/E is prograde-positive (the hole spins about +y, and prograde
 * is world azimuth DECREASING, so the axial Killing vector d/dphi contributes
 * +lam = z m_x - x m_z). q = Q/E^2 is Carter's constant. Both are quotients,
 * so the overall sign of m drops out and it does not matter that m is the
 * TIME-REVERSED tangent: E = nu*m_t and L_z = -nu*m_phi flip together.
 */
export interface RayConstants {
  lambda: number;
  q: number;
}

/**
 * lambda and q from a launch point and covariant momentum.
 *
 * The textbook Q = p_theta^2 + cos^2(th) (L_z^2/sin^2(th) - a^2 E^2) is
 * singular on the spin axis, which a face-on camera sits exactly on. It need
 * not be. Kerr-Schild shares r and theta with Boyer-Lindquist and mixes only
 * t and phi with r, so p_theta is the same covector in both, and the Cartesian
 * map x,z = (coeffs in r,phi)*sin(th), y = r cos(th) gives it directly:
 *     p_theta = cot(th) (x m_x + z m_z) - r sin(th) m_y.
 * Squaring that and adding cot^2(th) m_phi^2 lets the Lagrange identity
 *     (x m_x + z m_z)^2 + (z m_x - x m_z)^2 = (x^2 + z^2)(m_x^2 + m_z^2)
 * collect the two cot^2 terms, and x^2 + z^2 = (r^2+a^2) sin^2(th) cancels the
 * sin^2 out of the denominator for good. What is left is a polynomial, regular
 * everywhere outside r = 0 — no axis case, no epsilon.
 */
export function rayConstants(pos: V3, mCov: V4, a: number): RayConstants {
  const [x, y, z] = pos;
  const [mt, mx, my, mz] = mCov;
  const r = ksRadius(pos, a);
  const r2 = r * r;
  const a2 = a * a;
  const qE2 =
    ((y * y) / r2) * ((r2 + a2) * (mx * mx + mz * mz) - a2 * mt * mt) -
    2 * y * my * (x * mx + z * mz) +
    (r2 - y * y) * my * my;
  return { lambda: -(z * mx - x * mz) / mt, q: qE2 / (mt * mt) };
}

/**
 * The Kerr radial potential R(r)/E^2 = (r^2+a^2-a*lambda)^2 - Delta*k, with
 * k = (lambda-a)^2 + q. Sigma^2 (dr/dlambda)^2 = R, so a ray only lives where
 * R >= 0 and turns around where it vanishes. Expanded, it is a quartic with no
 * cubic term: r^4 + c2 r^2 + 2k r - a^2 q.
 *
 * That constant term is worth the algebra it took. Expanding the square gives
 * it as (a^2 - a*lambda)^2 - a^2 k, which near the critical curve is a
 * difference of two nearly equal numbers — at a = 0.998 it is 1.188 - 1.185,
 * three of float32's seven digits gone exactly where the shader needs them. It
 * cancels in closed form: a^2(a-lambda)^2 - a^2[(lambda-a)^2 + q] = -a^2 q.
 *
 * Even in the overall sign of the momentum, so the backward ray the lab traces
 * and the forward photon it stands for share one potential.
 */
export function radialPotential(r: number, lambda: number, q: number, a: number): number {
  const k = (lambda - a) * (lambda - a) + q;
  const c2 = 2 * a * a - 2 * a * lambda - k;
  return ((r * r + c2) * r + 2 * k) * r - a * a * q;
}

/** Real roots of the depressed cubic t^3 + p t + s. */
function cubicRealRoots(p: number, s: number): number[] {
  const disc = (s * s) / 4 + (p * p * p) / 27;
  if (p >= 0 || disc > 0) {
    const rt = Math.sqrt(Math.max(disc, 0));
    return [Math.cbrt(-s / 2 + rt) + Math.cbrt(-s / 2 - rt)];
  }
  const m = 2 * Math.sqrt(-p / 3);
  const th = Math.acos(Math.min(1, Math.max(-1, (3 * s) / (p * m)))) / 3;
  return [0, 1, 2].map((j) => m * Math.cos(th - (2 * Math.PI * j) / 3));
}

/**
 * Whether a ray launched inward from camPos ends on the horizon — exactly, and
 * without integrating a single step.
 *
 * This is what the march budget cannot buy. A ray near the photon shell needs
 * ~(1/gamma) ln(1/delta) half-orbits to resolve its fate at offset delta from
 * the critical curve, so the steps needed DIVERGE at the edge and no finite
 * budget (or step rule) ever reaches it. But fate is not an integration
 * result: it is fixed by lambda and q alone. The ray plunges iff R stays
 * positive all the way down — one turning point above the horizon and it
 * reflects and escapes instead.
 *
 * R(r+) = (r+^2 + a^2 - a*lambda)^2 >= 0 and R(rCam) > 0 (the ray is there),
 * so any roots between them come in pairs and R must dip through a local
 * minimum to reach them. Testing the sign of R at its interior critical points
 * therefore settles it, and the critical points are the roots of the cubic
 * R'/4 = r^3 + (c2/2) r + k/2.
 */
export function rayCaptured(camPos: V3, mCov: V4, a: number): boolean {
  const { lambda, q } = rayConstants(camPos, mCov, a);
  const k = (lambda - a) * (lambda - a) + q;
  const c2 = 2 * a * a - 2 * a * lambda - k;
  const rCam = ksRadius(camPos, a);
  const rPlus = horizonRadius(a);
  for (const rc of cubicRealRoots(c2 / 2, k / 2)) {
    if (rc > rPlus && rc < rCam && radialPotential(rc, lambda, q, a) < 0) return false;
  }
  return true;
}
