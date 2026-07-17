/**
 * Pure math for the educational overlays (slice 6). No DOM, no WebGL —
 * everything here is unit-tested in test/edu.test.ts. Drawing lives in
 * hud.ts, wiring in main.ts.
 */

import { circUt, horizonRadius, ksMetric, traceRayKerr, uCircCart } from "./kerr";
import type { Tetrad, V3, V4 } from "./kerr";
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
 * NOTE: docs/archive/PLAN-slice-6.md's 6c prose drops the a^2/r^2 term from
 * gamma. That
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

/**
 * Impact parameter b = L/E of the equatorial circular photon orbit, signed
 * with the prograde sense positive. Setting R(r) = R'(r) = 0 for equatorial
 * null geodesics gives b = (±r√Δ − 2a)/(r − 2), which is 0/0 at r = 2 — a
 * radius the prograde orbit really does cross, at a = 1/√2 — so we use the
 * form rationalized against (r√Δ ± 2a), finite for every a. a = 0 gives ±3√3
 * (the Schwarzschild b_c); a = 1 gives +2 prograde and −7 retrograde.
 */
export function photonImpactParameter(a: number, prograde: boolean): number {
  const r = photonOrbitRadius(a, prograde);
  // Δ = 0 at the a = 1 prograde orbit, where r+ and r_ph both reach 1
  const rtD = r * Math.sqrt(Math.max(r * r - 2 * r + a * a, 0));
  const num = r * r * r + a * a * (r + 2);
  return prograde ? num / (rtD + 2 * a) : -num / (rtD - 2 * a);
}

/**
 * Lyapunov exponent of the equatorial circular photon orbit, per half-orbit
 * (Delta phi = pi) — the rate at which that orbit sheds light, and so the
 * ladder spacing of the photon ring: a ray passing the critical impact
 * parameter b_c by db swings ~(1/gamma) ln(1/db) extra half-turns before it
 * leaves, and each successive subring is thinner than the last by e^(-gamma).
 *
 * Near the double root r~ of the radial potential R(r) = (r^2+a^2-ab)^2 -
 * Delta (b-a)^2, R ~ 1/2 R''(r~) (r-r~)^2, so with r^2 dr/dlambda = sqrt(R)
 * and r^2 dphi/dlambda = Phi(r) the r^2 cancels and the deviation grows in
 * azimuth at rate sqrt(R''/2)/|Phi|. One half-orbit is Delta phi = pi, hence
 *
 *     gamma = pi sqrt(R''(r~)/2) / |Phi(r~)|,
 *     R''  = 12 r~^2 + 4a^2 - 4ab - 2(b-a)^2,
 *     Phi  = (b - a) + (a/Delta)(r~^2 + a^2 - ab).
 *
 * Phi is written below in a rationalized form. R(r~) = 0 is exactly what
 * defines the orbit, so r~^2 + a^2 - ab = +sqrt(Delta)|b - a| (the sign
 * verified at a = 0 and both senses at a = 0.9), giving
 *
 *     Phi = (b - a) + a |b - a| / sqrt(Delta),
 *
 * which needs no special case as the prograde orbit merges with the horizon:
 * Delta -> 0 sends |Phi| -> Inf and gamma -> 0 rather than through 0/0.
 *
 * a = 0 gives exactly pi either sense (the textbook e^(-pi) ~ 1/23 per
 * half-orbit). Spin splits it hard — 1.22 prograde against 4.00 retrograde at
 * a = 0.9, 0.19 against 4.08 at a = 0.998 — so at high spin the prograde edge
 * of the ring barely fades between subrings while the retrograde edge collapses
 * them below a pixel. This is a per-edge equatorial number, NOT one value
 * around the whole ring: off the equatorial plane the orbits are Carter-Q
 * spherical ones with their own exponents, so callers must say which edge they
 * are quoting. Confirmed against ray-traced winding fits in edu.test.ts.
 */
export function photonOrbitLyapunov(a: number, prograde: boolean): number {
  const r = photonOrbitRadius(a, prograde);
  const b = photonImpactParameter(a, prograde);
  const delta = r * r - 2 * r + a * a;
  const rpp = 12 * r * r + 4 * a * a - 4 * a * b - 2 * (b - a) * (b - a);
  const phi = b - a + (a * Math.abs(b - a)) / Math.sqrt(Math.max(delta, 0));
  return (Math.PI * Math.sqrt(Math.max(rpp, 0) / 2)) / Math.abs(phi);
}

/**
 * How much wider the black disk is than the hole: the shadow's width across
 * the equatorial plane over the horizon's diameter 2 r+. The two equatorial
 * photon orbits bound that width — their impact parameters are the shadow's
 * extremes in the plane, and frame dragging pulls the prograde one in far
 * more than it pushes the retrograde one out (2.11 vs 7.00 at a = 0.998),
 * which is what flattens the D.
 *
 * 2.60 at a = 0, rising to 4.5 at a = 1 — the horizon shrinks with spin while
 * the shadow barely does. Measured edge-on, and the callout quoting it says
 * "about": tilting toward the pole rounds the shadow out and widens this by
 * up to ~6% at extreme spin, far less than the spread across spin itself.
 */
export function shadowHorizonRatio(a: number): number {
  const width = photonImpactParameter(a, true) - photonImpactParameter(a, false);
  return width / (2 * horizonRadius(a));
}

/** Uniformly spaced samples of the equatorial embedding surface, z(r[0]) = 0. */
export interface EmbeddingProfile {
  /** Boyer–Lindquist radius, r[0] = r+ and r[n-1] = rMax. */
  r: Float64Array;
  /** Height of the embedding surface above the rim, same units (M). */
  z: Float64Array;
}

/**
 * The funnel: the equatorial slice of Kerr lifted into flat 3-space as a
 * surface of revolution. The slice's radial metric is g_rr = r^2/Delta with
 * Delta = r^2 - 2r + a^2 = (r - r+)(r - r-), and a surface of revolution of
 * radius r whose arc length matches it obeys
 *
 *     dz/dr = sqrt(g_rr - 1) = sqrt((2r - a^2) / Delta).
 *
 * At a = 0 that integrates in closed form to Flamm's paraboloid,
 * z = sqrt(8(r - 2)).
 *
 * APPROXIMATION at a != 0: this takes r itself as the circumferential radius,
 * while the true proper circumference of the Kerr equatorial circle is
 * 2 pi sqrt(r^2 + a^2 + 2a^2/r). Using that instead is the stricter embedding,
 * but it does not exist in Euclidean 3-space over parts of a fast-spinning
 * throat. This is the standard picture; it is exact at a = 0 and everywhere
 * shows the radial stretching honestly.
 *
 * The integrand diverges like (r - r+)^(-1/2) at the rim — integrable, but
 * fatal for plain quadrature. Splitting the singular factor off exactly,
 *
 *     dz/dr = g(r) / sqrt(r - r+),   g(r) = sqrt((2r - a^2) / (r - r-)),
 *
 * leaves g smooth across the whole range (the spin slider caps at 0.998, so
 * r+ - r- >= 0.126 and g never blows up). Each step then integrates the
 * singularity in closed form and samples the smooth part only at the
 * midpoint, which needs no special case for the first interval. At a = 0,
 * g = sqrt(2) is constant and the result is exact to machine precision.
 */
export function embeddingProfile(
  a: number,
  rMax: number,
  n: number
): EmbeddingProfile {
  const rPlus = horizonRadius(a);
  const rMinus = 1 - Math.sqrt(Math.max(1 - a * a, 0));
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const h = (rMax - rPlus) / (n - 1);
  r[0] = rPlus;
  z[0] = 0;
  let sPrev = 0; // sqrt(r[i-1] - r+), exactly 0 at the rim
  for (let i = 1; i < n; i++) {
    const ri = rPlus + i * h;
    const mid = ri - h / 2;
    const g = Math.sqrt((2 * mid - a * a) / (mid - rMinus));
    const s = Math.sqrt(ri - rPlus);
    r[i] = ri;
    z[i] = z[i - 1] + g * 2 * (s - sPrev); // ∫ dr/sqrt(r-r+) = 2 sqrt(r-r+)
    sPrev = s;
  }
  return { r, z };
}

/**
 * Sample spacing of the orbit trails (6e), in coordinate time. It only bites
 * at the slow end of the time-speed slider: past ~30 M/s a frame already
 * advances more than this, so every frame lands a sample and the real spacing
 * is the frame's own dt. That makes a buffer's time span a property of the
 * time speed, not a constant — which is why drawTrails fades by each trail's
 * own span rather than a fixed window.
 */
export const TRAIL_MIN_DT = 0.5;

/**
 * Trail lengths, in samples. Gas is short (its spiral is slow and local),
 * TDE debris long enough to hold a whole fallback loop. Kept here beside
 * Trail so main.ts (which owns the buffers) and hud.ts (which sizes its
 * projection scratch off the largest) agree without either importing the
 * other.
 */
export const TRAIL_CAP_STAR = 128;
export const TRAIL_CAP_GAS = 96;
export const TRAIL_CAP_TDE = 192;

/**
 * Where one body has been: a ring buffer of (x, y, z, t) samples thinned to
 * TRAIL_MIN_DT spacing, oldest dropped when full. Allocates once, in the
 * constructor — main.ts pushes into ~50 of these every frame and hud.ts walks
 * them all again to draw, so nothing here may touch the heap afterwards.
 */
export class Trail {
  private readonly buf: Float64Array;
  private readonly cap: number;
  /** Ring index of the oldest live sample. */
  private head = 0;
  private n = 0;
  private lastT = -Infinity;

  constructor(capacity: number) {
    this.cap = capacity;
    this.buf = new Float64Array(capacity * 4);
  }

  get length(): number {
    return this.n;
  }

  /** Coordinate time of the oldest sample; -Infinity when empty. */
  get oldestT(): number {
    return this.n === 0 ? -Infinity : this.buf[this.head * 4 + 3];
  }

  /** Coordinate time of the newest sample; -Infinity when empty. */
  get newestT(): number {
    return this.n === 0 ? -Infinity : this.buf[(((this.head + this.n - 1) % this.cap) * 4) + 3];
  }

  /** Append p at time t, or ignore it if the last sample is too recent. */
  push(p: V3, t: number): void {
    if (t - this.lastT < TRAIL_MIN_DT) return;
    this.lastT = t;
    const o = ((this.head + this.n) % this.cap) * 4;
    this.buf[o] = p[0];
    this.buf[o + 1] = p[1];
    this.buf[o + 2] = p[2];
    this.buf[o + 3] = t;
    if (this.n < this.cap) this.n++;
    else this.head = (this.head + 1) % this.cap;
  }

  /** Forget the history — the body it belonged to is gone or has jumped. */
  clear(): void {
    this.head = 0;
    this.n = 0;
    this.lastT = -Infinity; // so the next push lands whatever the clock says
  }

  /** Sample i counted oldest (0) to newest, written into out; returns its t. */
  at(i: number, out: V3): number {
    const o = ((this.head + i) % this.cap) * 4;
    out[0] = this.buf[o];
    out[1] = this.buf[o + 1];
    out[2] = this.buf[o + 2];
    return this.buf[o + 3];
  }
}

/**
 * z at an arbitrary radius, by linear interpolation into a profile (whose
 * samples are uniform in r) and clamped to its ends. Display-grade: near the
 * rim the true z goes like sqrt(r - r+), so a chord across the first interval
 * sits slightly low.
 */
export function embeddingZAt(p: EmbeddingProfile, r: number): number {
  const n = p.r.length;
  const dr = (p.r[n - 1] - p.r[0]) / (n - 1);
  const t = (r - p.r[0]) / dr;
  if (t <= 0) return p.z[0];
  if (t >= n - 1) return p.z[n - 1];
  const i = Math.floor(t);
  return p.z[i] + (p.z[i + 1] - p.z[i]) * (t - i);
}

// ---------- shadow & photon-ring outline (6f) ----------

/** The shadow's screen outline: where captured rays give way to escaping ones. */
export interface ShadowEdge {
  /** NDC (ndcX, ndcY) pairs at nAz equally spaced screen azimuths — a closed loop. */
  pts: Float64Array;
  /** False when the center ray isn't captured (the camera isn't aimed at the hole). */
  valid: boolean;
}

/**
 * The exact shadow edge for the current camera, spin and lens, one screen
 * azimuth per yield. Rays launch precisely as the scene shader launches them
 * (same static tetrad, same ndc → direction map) — no far-field or small-angle
 * approximation, and the Kerr D-shape comes out for free. Along each azimuth
 * the capture/escape transition is bracketed by geometric growth from ndc
 * radius 0.05 and bisected 16 times, pinning it to a few 1e-6 in ndc.
 *
 * This is the TRUE edge, which at high spin is not the one on screen. The
 * launch geometry is shared with the shader, but the integration is not: this
 * traces to maxSteps 4000 while the shader stops at MARCH_MAX_STEPS and leaves
 * a spent ray as captured. Near the prograde photon orbit at a = 0.998 the
 * Lyapunov exponent falls to 0.19, so light lingers there and blows that budget
 * while still outside the true shadow — and the renderer paints it black. The
 * outline then runs ~50px INSIDE the rendered disk on that edge (0px at a = 0,
 * 0px retrograde at any spin; measured on the frame with the harness and pinned
 * in edu.test.ts). Where they differ, this is right and the picture is wrong;
 * see docs/DESIGN.md, "what gamma costs the renderer".
 *
 * Cost is ~20 traces per azimuth, ~1000 per outline — and a single trace is
 * the atomic unit of work, from ~0.1 ms in the easy cases to milliseconds for
 * a near-critical ray winding thousands of RK4 steps at high spin (a full
 * 48-azimuth outline measures ~66 ms at a = 0 and ~540 ms at a = 0.998).
 * Hence the generator, yielding after every trace: main.ts drains it against
 * a per-frame time budget; findShadowEdge drains it whole for tests and
 * non-interactive callers, so both run the same code path. The yielded value
 * is the azimuth in progress.
 */
export function* findShadowEdgeIncremental(
  camPos: V3,
  tet: Tetrad,
  a: number,
  tanHalfFov: number,
  aspect: number,
  nAz = 48,
  opts: { camDist?: number } = {}
): Generator<number, ShadowEdge> {
  const camDist = opts.camDist ?? Math.hypot(camPos[0], camPos[1], camPos[2]);
  const pts = new Float64Array(2 * nAz);
  const m: V4 = [0, 0, 0, 0];
  // An escaping ray must at least clear the camera's own radius; +40 keeps
  // the verdict cheap without misreading a wide photon loop as an escape
  // (traceRayKerr also demands outward motion at the escape radius).
  const rEscape = camDist + 40;

  const captured = (ndcX: number, ndcY: number): boolean => {
    const vx = ndcX * tanHalfFov * aspect;
    const vy = ndcY * tanHalfFov;
    const inv = 1 / Math.hypot(vx, vy, 1);
    for (let i = 0; i < 4; i++) {
      m[i] =
        vx * inv * tet.rightCov[i] +
        vy * inv * tet.upCov[i] +
        inv * tet.fwdCov[i] -
        tet.uCov[i];
    }
    return !traceRayKerr(camPos, m, a, { rEscape }).escaped;
  };

  // The camera always looks at the origin in this app, so the center ray must
  // fall in. If someone changes the camera model, degrade to "draw nothing"
  // rather than bisecting azimuths that have no transition to find.
  if (!captured(0, 0)) return { pts, valid: false };
  yield 0;

  // Fallback when an azimuth never escapes within s = 3 (the whole screen is
  // shadow — possible right up against the hole with a narrow lens): reuse
  // the neighbouring azimuth's radius, or the cap itself for the first one.
  let sPrev = 3;
  for (let k = 0; k < nAz; k++) {
    const psi = (k / nAz) * Math.PI * 2;
    const c = Math.cos(psi);
    const sn = Math.sin(psi);
    let lo = 0;
    let hi = 0.05;
    let bracketed = false;
    while (hi <= 3) {
      const cap = captured(hi * c, hi * sn);
      yield k;
      if (cap) {
        lo = hi;
        hi *= 1.6;
      } else {
        bracketed = true;
        break;
      }
    }
    let s = sPrev;
    if (bracketed) {
      for (let i = 0; i < 16; i++) {
        const mid = 0.5 * (lo + hi);
        const cap = captured(mid * c, mid * sn);
        yield k;
        if (cap) lo = mid;
        else hi = mid;
      }
      s = 0.5 * (lo + hi);
    }
    sPrev = s;
    pts[2 * k] = s * c;
    pts[2 * k + 1] = s * sn;
  }
  return { pts, valid: true };
}

/** The outline's extreme points, in NDC — the anchors the callouts hang off. */
export interface ShadowExtremes {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  topX: number;
  topY: number;
  bottomX: number;
  bottomY: number;
}

/**
 * The four screen extremes of a shadow outline: the points of least/greatest
 * ndcX and ndcY. Labels anchor to these rather than to a fitted circle,
 * because at high spin with an edge-on camera the shadow is D-shaped and the
 * flattened side is exactly what a label about it should point at. Returns
 * outline samples verbatim — no interpolation, so an anchor always lands on
 * the drawn dashes.
 *
 * The outline is built as s(psi)·(cos psi, sin psi) from NDC (0, 0), so that
 * origin is the shadow's own centre by construction: callers wanting a point
 * just outside the edge can scale an extreme's ndc directly.
 */
export function shadowExtremes(edge: ShadowEdge, out?: ShadowExtremes): ShadowExtremes {
  const o =
    out ??
    { leftX: 0, leftY: 0, rightX: 0, rightY: 0, topX: 0, topY: 0, bottomX: 0, bottomY: 0 };
  const n = edge.pts.length / 2;
  if (n === 0) return o;
  let iL = 0;
  let iR = 0;
  let iT = 0;
  let iB = 0;
  for (let k = 1; k < n; k++) {
    if (edge.pts[k * 2] < edge.pts[iL * 2]) iL = k;
    if (edge.pts[k * 2] > edge.pts[iR * 2]) iR = k;
    if (edge.pts[k * 2 + 1] > edge.pts[iT * 2 + 1]) iT = k;
    if (edge.pts[k * 2 + 1] < edge.pts[iB * 2 + 1]) iB = k;
  }
  o.leftX = edge.pts[iL * 2];
  o.leftY = edge.pts[iL * 2 + 1];
  o.rightX = edge.pts[iR * 2];
  o.rightY = edge.pts[iR * 2 + 1];
  o.topX = edge.pts[iT * 2];
  o.topY = edge.pts[iT * 2 + 1];
  o.bottomX = edge.pts[iB * 2];
  o.bottomY = edge.pts[iB * 2 + 1];
  return o;
}

// ---------- "what am I looking at?" callout geometry (6g) ----------

/**
 * Where the Doppler callouts sample the disk. Inside it at every setting of
 * the size slider (which bottoms out at 8) and outside every ISCO (which tops
 * out at 6), and deep enough that the orbital speed really is the ~0.4-0.5c
 * the copy claims. The approaching SIDE doesn't depend on this choice —
 * prograde is prograde at every radius — so it only fixes where the anchor
 * dot lands.
 */
export const DOPPLER_R = 8;

/**
 * World point of equatorial matter at Boyer–Lindquist radius r and world
 * azimuth az. In Kerr–Schild the equatorial BL circle of radius r sits at
 * Cartesian radius sqrt(r^2 + a^2) — the same map matter.ts's gasPosXZ and
 * kerr.ts's uCircCart use — so a marker placed here sits where the renderer
 * really put that matter (lensing then moves its IMAGE elsewhere).
 */
export function equatorialPoint(r: number, az: number, a: number, out?: V3): V3 {
  const q = out ?? ([0, 0, 0] as V3);
  const R = Math.sqrt(r * r + a * a);
  q[0] = R * Math.cos(az);
  q[1] = 0;
  q[2] = R * Math.sin(az);
  return q;
}

/**
 * +1 when the disk matter on the camera's right-hand side is moving toward the
 * camera — i.e. the beamed, brighter lobe is on the right of the screen; -1
 * when the right side is the receding one.
 *
 * Built from uCircCart, the same prograde circular 4-velocity the scene
 * shader's disk shift encodes (both run world azimuth *decreasing*, see
 * kerr.ts and FS_SCENE's diskG/diskTurb). That shared convention is what makes
 * the label land on the lobe the renderer actually brightens, so it must not
 * drift from the shader's.
 *
 * Returns 0 only for a camera exactly on the spin axis, where the disk sweeps
 * across the line of sight and genuinely no side approaches. The pitch clamp
 * keeps the camera off the axis, so this never fires in the app.
 */
export function approachingSign(camPos: V3, right: V3, a: number): number {
  // the camera's right vector, projected into the disk plane, as a world
  // azimuth (atan2 is scale-free, so no need to normalize first)
  const az = Math.atan2(right[2], right[0]);
  const q = equatorialPoint(DOPPLER_R, az, a);
  const u = uCircCart(DOPPLER_R, az, a);
  const dx = camPos[0] - q[0];
  const dy = camPos[1] - q[1];
  const dz = camPos[2] - q[2];
  // u^t > 0 scales all three spatial components alike, so it cannot flip this
  return Math.sign(u[1] * dx + u[2] * dy + u[3] * dz);
}

/** How well a star lines up with the hole, as seen from the camera. */
export interface Alignment {
  /** Angle at the camera between the hole and the star (radians). */
  angle: number;
  /** True when the star is on the far side of the hole. */
  behind: boolean;
}

/**
 * Below this misalignment, a star behind the hole is called an Einstein ring.
 *
 * `angle` is the source's unlensed angular offset — beta in the thin-lens
 * picture — and a ring is complete only at beta = 0, degrading into two
 * unequal images as beta grows past the Einstein radius. For a star at r = 10
 * seen from the default 25 M, theta_E = sqrt(4 M D_ls / (D_l D_s)) ~ 0.21 rad,
 * so 0.06 fires only around a quarter of the way out: a genuinely strong,
 * near-complete ring rather than every mild arc. (Thin-lens is a guide here,
 * not the truth — the render's rays are traced exactly.)
 */
export const EINSTEIN_ANGLE = 0.06;

/**
 * A star's angular miss from the exact anti-camera axis, plus whether it is
 * the far side of the hole at all. Both together are the ring condition: light
 * from a source directly behind the lens reaches the camera around every side
 * at once. A star in FRONT can be perfectly aligned on screen and does nothing.
 */
export function alignmentAngle(camPos: V3, starPos: V3, out?: Alignment): Alignment {
  const o = out ?? { angle: 0, behind: false };
  const d = Math.hypot(camPos[0], camPos[1], camPos[2]);
  // the half-space beyond the hole, split by the plane through it normal to
  // the view axis: dot(starPos, camera->hole direction) > 0
  o.behind =
    -(starPos[0] * camPos[0] + starPos[1] * camPos[1] + starPos[2] * camPos[2]) > 0;
  const sx = starPos[0] - camPos[0];
  const sy = starPos[1] - camPos[1];
  const sz = starPos[2] - camPos[2];
  const ls = Math.hypot(sx, sy, sz);
  if (d === 0 || ls === 0) {
    o.angle = 0;
    return o;
  }
  // angle at the camera between (camera -> hole) and (camera -> star)
  const c = -(camPos[0] * sx + camPos[1] * sy + camPos[2] * sz) / (d * ls);
  o.angle = Math.acos(Math.min(Math.max(c, -1), 1));
  return o;
}

/** One-shot edge finder: drains the incremental generator to completion. */
export function findShadowEdge(
  camPos: V3,
  tet: Tetrad,
  a: number,
  tanHalfFov: number,
  aspect: number,
  nAz = 48,
  opts: { camDist?: number } = {}
): ShadowEdge {
  const gen = findShadowEdgeIncremental(camPos, tet, a, tanHalfFov, aspect, nAz, opts);
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}
