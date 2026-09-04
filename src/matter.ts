/**
 * Matter around the hole: stars on circular orbits and gas blobs spiraling
 * in through the disk (slice 3, upgraded to Kerr in slice 4).
 *
 * Geometrized units (G = c = M = 1); times are Kerr–Schild coordinate time
 * in units of M. Pure and unit-tested; main.ts advances this state on the
 * CPU each frame and uploads positions plus exact 4-velocities to the
 * scene shader, which renders the matter along the same per-pixel
 * geodesics as everything else.
 */

import {
  horizonRadius,
  iscoConstants,
  normalizeVel,
  omegaCirc,
  plungeRates,
  uCircCart,
  uPlungeCart,
  type V3,
  type V4,
} from "./kerr";

export type { V3, V4 };

/** Everything spin-dependent the matter stepping needs, built once per a. */
export interface SpinCtx {
  a: number;
  isco: number;
  rHor: number;
  /** Conserved E, L of the ISCO orbit — the plunge constants. */
  E: number;
  L: number;
}

export function makeSpinCtx(a: number): SpinCtx {
  const { E, L, r } = iscoConstants(a);
  return { a, isco: r, rHor: horizonRadius(a), E, L };
}

// ---------- orbiting stars ----------

export interface StarOrbit {
  /** Orbit radius in M (comfortably outside the ISCO for any spin). */
  a: number;
  /** Inclination of the orbit plane to the disk plane, radians. */
  inc: number;
  /** Azimuth of the line of nodes at t = 0, radians. */
  node: number;
  /** In-plane orbital phase (from the node line) at t = 0. */
  phase0: number;
  /** Surface temperature in kelvin (drives color and luminosity). */
  tempK: number;
  /** Gaussian emission radius in M (visual size). */
  radius: number;
}

export const STAR_ORBITS: StarOrbit[] = [
  { a: 8.5, inc: 0.55, node: 1.0, phase0: 0.0, tempK: 12000, radius: 0.2 },
  { a: 11.0, inc: -0.35, node: 2.6, phase0: 2.1, tempK: 4300, radius: 0.3 },
  { a: 13.5, inc: 0.95, node: 4.4, phase0: 4.4, tempK: 7000, radius: 0.24 },
  { a: 16.5, inc: 0.18, node: 0.3, phase0: 1.2, tempK: 9500, radius: 0.26 },
  { a: 20.0, inc: -0.7, node: 3.5, phase0: 3.3, tempK: 3400, radius: 0.45 },
  { a: 23.5, inc: 0.4, node: 5.6, phase0: 5.5, tempK: 15000, radius: 0.22 },
];
export const STAR_COUNT = STAR_ORBITS.length;

/**
 * Orbital-plane rate for inclined near-circular Kerr orbits: the vertical
 * (theta) frequency Omega_theta = Omega sqrt(1 - 4a/r^{3/2} + 3a^2/r^2).
 * The node precesses at Omega - Omega_theta (Lense–Thirring dragging,
 * ~2a/r^3 in the weak field), so equatorial orbits advance at exactly
 * Omega and co-rotate with the disk pattern.
 */
export function nodalRate(r: number, aSpin: number): number {
  const om = omegaCirc(r, aSpin);
  const q = 1 - (4 * aSpin) / Math.pow(r, 1.5) + (3 * aSpin * aSpin) / (r * r);
  return om * (1 - Math.sqrt(Math.max(q, 0)));
}

export interface StarState {
  pos: V3;
  /** Coordinate velocity d(pos)/dt. */
  vel: V3;
  /** Exact 4-velocity (t, x, y, z) in Kerr–Schild coordinates. */
  u: V4;
}

/**
 * Star on a circular orbit of radius o.a, inclined by o.inc, with its line
 * of nodes precessing at the Lense–Thirring rate. Both the in-plane phase
 * and the node advance in the disk's sense (world azimuth decreasing).
 */
export function starState(o: StarOrbit, t: number, aSpin = 0): StarState {
  const nodRate = nodalRate(o.a, aSpin);
  const omTheta = omegaCirc(o.a, aSpin) - nodRate;
  const psi = o.phase0 - omTheta * t; // in-plane phase from the node line
  const n = o.node - nodRate * t; // node azimuth

  const ci = Math.cos(o.inc);
  const si = Math.sin(o.inc);
  const cp = Math.cos(psi);
  const sp = Math.sin(psi);
  const cn = Math.cos(n);
  const sn = Math.sin(n);

  // orbit circle tilted about the node line (local x), then swung to node
  // azimuth n: pos = rotY(Rx(q, inc), n), q = a (cos psi, 0, sin psi)
  const qx = o.a * cp;
  const qy = -o.a * sp * si;
  const qz = o.a * sp * ci;
  const pos: V3 = [qx * cn - qz * sn, qy, qx * sn + qz * cn];

  // d/dt of the above: in-plane motion plus the node swing
  const dpsi = -omTheta;
  const dx = -o.a * sp * dpsi;
  const dy = -o.a * cp * si * dpsi;
  const dz = o.a * cp * ci * dpsi;
  const dn = -nodRate;
  const vel: V3 = [
    dx * cn - dz * sn - dn * pos[2],
    dy,
    dx * sn + dz * cn + dn * pos[0],
  ];

  return { pos, vel, u: normalizeVel(pos, aSpin, vel) };
}

// ---------- the jet's envelope ----------

/**
 * Where the bipolar jet is, as opposed to what it looks like.
 *
 * The jet's emission model lives in the shader and stays there — it is fbm
 * noise for the knots, a travelling pulse, and a beaming clamp, all artistic
 * (see docs/DESIGN.md). Its ENVELOPE is not artistic in the same sense: it is
 * the geometry that decides whether a given point on a ray is inside the jet at
 * all, and since slice 18 two things outside the shader need to agree with the
 * shader about it — the visual harness, which has to predict which band pixels
 * the continuation now carries jet light to, and the tests behind it.
 *
 * So the numbers live here and the shader interpolates them, rather than each
 * side carrying its own copy of a cone.
 */
export const JET_BASE = 0.7;
/** Height at which the jet is cut off, M. */
export const JET_TOP = 46;
/** Half-width at the base and its flare per unit height: w(y) = W0 + FLARE|y|. */
export const JET_WIDTH0 = 0.45;
export const JET_FLARE = 0.17;
/**
 * The gaussian core is exp(-1.6 q^2) in q = (transverse distance)/w, cut off at
 * q^2 = JET_Q2_CUT. That cut is the envelope: outside it the shader returns
 * exactly zero rather than something small.
 */
export const JET_Q2_CUT = 5;

/**
 * Transverse distance from the jet axis at `p`, in units of the local
 * half-width — the shader's q, whose square it compares against JET_Q2_CUT.
 *
 * Infinite outside the vertical span, where the jet emits nothing at all. Note
 * that being inside is necessary but not sufficient for light: the along-axis
 * fade goes to zero at both ends of the span, and the gaussian core falls to
 * exp(-8) at the cut. A caller that wants "brightly inside" has to ask for a
 * smaller q and a height away from the ends — see tools/visual/band.mjs.
 */
export function jetOffset(p: V3): number {
  const ay = Math.abs(p[1]);
  if (ay < JET_BASE || ay > JET_TOP) return Infinity;
  return Math.hypot(p[0], p[2]) / (JET_WIDTH0 + JET_FLARE * ay);
}

/** Gaussian core across the cone: exp(-JET_CORE q^2) in q = jetOffset. */
export const JET_CORE = 1.6;
/** The along-axis fade's two knees, and the inverse-square-ish tail with it. */
export const JET_FADE_IN = 2.6;
export const JET_FADE_OUT = 30;
export const JET_TAIL = 0.004;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The jet's emission profile at `p`, with everything unpredictable left out.
 *
 * What is in it is geometry: the gaussian core across the cone and the fade
 * along it. What is NOT in it is every part of the shader's jetEmit that a CPU
 * cannot know — the fbm knots, the travelling pulse, and the relativistic
 * beaming, which needs the ray's momentum and not just its position.
 *
 * That makes this a shape rather than a brightness, and it is exactly the shape
 * slice 18's harness needs. A ray's jet light is proportional to the integral of
 * this along its path, up to those three factors; comparing the integral over
 * the MARCH's path with the integral over the CONTINUATION's is what lets the
 * harness say the two legs of one ray contribute in the same proportion. A path
 * LENGTH inside the cone will not do that job — the envelope is mostly dim
 * skirt, and two paths of equal length through it can differ several-fold in
 * light.
 */
export function jetProfile(p: V3): number {
  const ay = Math.abs(p[1]);
  const q = jetOffset(p);
  const q2 = q * q;
  if (!(q2 <= JET_Q2_CUT)) return 0;
  return (
    (Math.exp(-JET_CORE * q2) *
      smoothstep(JET_BASE, JET_FADE_IN, ay) *
      smoothstep(JET_TOP, JET_FADE_OUT, ay)) /
    (1 + JET_TAIL * ay * ay)
  );
}

// ---------- infalling gas blobs ----------

export const GAS_COUNT = 16;

export interface GasBlob {
  /** Boyer–Lindquist radius, M. */
  r: number;
  /** World (Cartesian Kerr–Schild) azimuth, radians. */
  az: number;
  /** Gaussian radius in M. */
  size: number;
  /** Brightness multiplier. */
  bright: number;
}

/**
 * Viscous inspiral rate dr/dt (< 0) through the disk body. Inside the
 * ISCO the true geodesic plunge (plungeRates) takes over.
 */
export function gasDrift(r: number, isco: number): number {
  return -0.05 * Math.sqrt(isco / r);
}

export function spawnGasBlob(rand: () => number, outer: number): GasBlob {
  return {
    r: outer * (0.82 + 0.13 * rand()),
    az: rand() * 2 * Math.PI,
    size: 0.35 + 0.55 * rand(),
    bright: 0.5 + 1.0 * rand(),
  };
}

const TWO_PI = 2 * Math.PI;

/**
 * Advance a blob by dt (Kerr–Schild time): Keplerian azimuth plus viscous
 * drift outside the ISCO; the exact ISCO-constant geodesic plunge inside
 * (regular through the horizon). Respawns at the outer edge once it falls
 * to the horizon. Substeps keep the plunge stable at high time speeds.
 */
export function stepGasBlob(
  b: GasBlob,
  dt: number,
  outer: number,
  rand: () => number,
  ctx: SpinCtx
): void {
  let left = dt;
  while (left > 0) {
    const h = Math.min(left, b.r < ctx.isco + 0.5 ? 0.25 : 1.5);
    left -= h;
    if (b.r <= ctx.isco) {
      const { drdt, dazdt } = plungeRates(b.r, ctx.a, ctx.E, ctx.L);
      b.az = (b.az + dazdt * h) % TWO_PI;
      // viscosity still nudges it across the marginally-stable boundary
      b.r += Math.min(drdt, gasDrift(b.r, ctx.isco)) * h;
    } else {
      b.az = (b.az - omegaCirc(b.r, ctx.a) * h) % TWO_PI;
      b.r += gasDrift(b.r, ctx.isco) * h;
    }
    if (b.r < ctx.rHor + 0.02) Object.assign(b, spawnGasBlob(rand, outer));
  }
}

/** World xz draw position (Cartesian radius sqrt(r^2 + a^2)). */
export function gasPosXZ(b: GasBlob, ctx: SpinCtx): [number, number] {
  const R = Math.sqrt(b.r * b.r + ctx.a * ctx.a);
  return [R * Math.cos(b.az), R * Math.sin(b.az)];
}

/**
 * The blob's coordinate rates: d(azimuth)/dt and d(draw radius)/dt, taking the
 * same two branches stepGasBlob integrates (circular + viscous drift outside
 * the ISCO, the exact geodesic plunge inside). The renderer sweeps each blob
 * backward along these to draw the arc it has just been shorn into, so they
 * have to agree with the stepper exactly or the trail would not lie on the
 * path the blob actually took.
 *
 * dRdt is in the DRAWN cylindrical radius R = sqrt(r^2 + a^2), not BL r, since
 * that is the radius the shader measures its trail against.
 */
export function gasRates(b: GasBlob, ctx: SpinCtx): { dazdt: number; dRdt: number } {
  let dazdt: number;
  let drdt: number;
  if (b.r <= ctx.isco) {
    const p = plungeRates(b.r, ctx.a, ctx.E, ctx.L);
    dazdt = p.dazdt;
    drdt = Math.min(p.drdt, gasDrift(b.r, ctx.isco));
  } else {
    dazdt = -omegaCirc(b.r, ctx.a);
    drdt = gasDrift(b.r, ctx.isco);
  }
  const R = Math.sqrt(b.r * b.r + ctx.a * ctx.a);
  return { dazdt, dRdt: (b.r / Math.max(R, 1e-9)) * drdt };
}

/** Exact 4-velocity of a blob: circular outside the ISCO, plunge inside. */
export function gasU(b: GasBlob, ctx: SpinCtx): V4 {
  return b.r <= ctx.isco
    ? uPlungeCart(b.r, b.az, ctx.a)
    : uCircCart(b.r, b.az, ctx.a);
}

/** Deterministic PRNG so the matter layout is reproducible (and testable). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
