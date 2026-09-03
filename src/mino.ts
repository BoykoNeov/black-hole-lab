/**
 * The separated continuation (slice 11).
 *
 * A ray that is still winding at the photon shell when the march's step budget
 * runs out currently takes the sky at whatever direction it happened to be
 * pointing when the budget ended, which is nothing like where it actually
 * goes. Slice 9c painted that band magenta rather than pass it off as sky; this
 * module is what earns the right to stop drawing it. Raising MARCH_MAX_STEPS
 * would not have worked: settling a ray at offset delta from the critical curve
 * takes ~(1/gamma) ln(1/delta) half-orbits, so the step count DIVERGES at the
 * edge. The deepest sampled band ray needs 291,419 steps of a converged march
 * and finishes here in a few hundred.
 *
 * The trick is that a Kerr null geodesic SEPARATES. In Mino time
 * (dtau = dsigma / Sigma) the radial and polar motions become independent 1-D
 * problems, and with u = cos(theta) both potentials are polynomials. Squaring
 * the usual first-order equations once removes the square roots AND all the
 * turning-point sign bookkeeping — the classic place these implementations
 * break:
 *
 *     dr /dtau = pr    dpr/dtau = R'(r)/2 = 2 r^3 + c2 r + k
 *     du /dtau = pu    dpu/dtau = U'(u)/2 = -2 a^2 u^3 + (a^2 - q - lambda^2) u
 *
 * Five scalars of state; no metric, no metric gradients, no Kerr-Schild f and
 * l. A step costs a small fraction of an RK4 march step, which is where the
 * 291,419-to-a-few-hundred comes from.
 *
 * This is only valid where nothing but gravity acts on the ray, which is why it
 * runs from the EXHAUSTED state outward and never replaces the march: the march
 * is what samples the disk, the matter and the crossings.
 */

import {
  horizonRadius,
  ksRadius,
  radialPotential,
  raise,
  type V3,
  type V4,
} from "./kerr.js";

/**
 * Position and conjugate momenta in the separated system. `pr` and `pu` are
 * dr/dtau and du/dtau, and `az` is the WORLD azimuth atan2(z, x) — not the
 * Boyer-Lindquist one, which differs by the Kerr-Schild twist and runs the
 * other way. See minoDeriv on why that matters more than it looks.
 */
export interface MinoState {
  r: number;
  /** dr/dtau. Its square is R(r) exactly; the sign is the only free part. */
  pr: number;
  /** cos(theta), the polar coordinate the potential is a polynomial in. */
  u: number;
  /** du/dtau, likewise signed sqrt(U(u)). */
  pu: number;
  /** World azimuth atan2(z, x). */
  az: number;
}

/**
 * A ray's conserved quantities, with the two combinations the potentials are
 * written in cached alongside. Built once per ray: k and c2 are pure functions
 * of (lambda, q, a) and recomputing them inside the derivative — which runs
 * four times per RK4 step — is the whole cost of the step twice over.
 */
export interface RayPotentials {
  /** L_z/E, prograde-positive. */
  lambda: number;
  /** Carter's Q/E^2. */
  q: number;
  /** (lambda - a)^2 + q. */
  k: number;
  /** 2a^2 - 2a*lambda - k, the quadratic coefficient of R. */
  c2: number;
}

/** Pack lambda and q into the form both potentials are evaluated in. */
export function rayPotentials(lambda: number, q: number, a: number): RayPotentials {
  const k = (lambda - a) * (lambda - a) + q;
  return { lambda, q, k, c2: 2 * a * a - 2 * a * lambda - k };
}

/**
 * The polar potential U(u) = (1 - u^2) Theta, partner to kerr.ts's
 * radialPotential: (du/dtau)^2 = U.
 *
 * Written in u = cos(theta) rather than theta for the same reason the radial
 * side is written in r: it is then a polynomial, so it has no trigonometry in
 * the shader's hot loop and no coordinate singularity on the spin axis. The
 * textbook Theta(theta) = q + a^2 cos^2 - cot^2 sin^-2 ... form has both.
 */
export function polarPotential(u: number, C: RayPotentials, a: number): number {
  const u2 = u * u;
  return ((-a * a * u2 + (a * a - C.q - C.lambda * C.lambda)) * u2 + C.q);
}

/**
 * The five-scalar derivative. Everything about this function that can go wrong
 * goes wrong in `daz`, so it is derived here rather than trusted.
 *
 * Three sign decisions live in it, and getting any of them wrong produces a
 * trajectory with IDENTICAL winding and a wrong sky direction — which is why
 * test/mino.test.ts asserts the rate numerically against the march instead of
 * re-deriving it in prose:
 *
 *  1. The Kerr-Schild twist is POSITIVE. The Cartesian prograde azimuth is
 *     phi_c = phi_BL + integral(a/Delta dr) + arctan(a/r), so
 *     d(phi_c)/dr = a/Delta - a/(r^2+a^2) = +2ar/(Delta (r^2+a^2)). It is a
 *     function of position alone, so it is ODD in dr: it flips with the radial
 *     direction and with nothing else.
 *  2. The world azimuth runs the OTHER WAY. az = atan2(z, x), and prograde is
 *     az DECREASING (kerr.ts's convention since slice 2), so az = -phi_c and
 *     both terms flip.
 *  3. The march carries the TIME-REVERSED tangent, so everything odd in the
 *     traversal direction flips again: dazBL returns to its textbook sign, and
 *     so would dr — but `pr` is already the march's own radial rate, so the
 *     twist term keeps the single flip from step 2.
 *
 * Net: dazBL - twist * pr. Getting the twist sign wrong is a ~30% error in the
 * azimuth rate at r = 1.4; getting step 2 wrong builds the MIRROR-IMAGE
 * trajectory, which passes every winding test there is.
 *
 * `1 - u*u` is left as written, deliberately, even though it is a difference of
 * nearly equal numbers when the ray runs near the spin axis and the shader will
 * evaluate it in float32. Carrying sn2 = 1 - u^2 as a sixth state variable with
 * d(sn2)/dtau = -2 u pu removes the cancellation and is WORSE: on the ray that
 * comes closest to the axis without being flagged (1 - u^2 down to 1.5e-5) the
 * plain form costs 0.018 deg in float64 and 0.031 in float32, while the carried
 * variable costs 0.26, because it then drifts away from u instead of being
 * defined by it. Measured, not assumed — do not "fix" this in the GLSL mirror.
 */
export function minoDeriv(s: MinoState, C: RayPotentials, a: number): MinoState {
  const a2 = a * a;
  const r2 = s.r * s.r;
  const Delta = r2 - 2 * s.r + a2;
  const twist = (2 * a * s.r) / (Delta * (r2 + a2));
  const dazBL = (a / Delta) * (r2 + a2 - a * C.lambda) - a + C.lambda / (1 - s.u * s.u);
  return {
    r: s.pr,
    pr: 2 * s.r * r2 + C.c2 * s.r + C.k,
    u: s.pu,
    pu: -2 * a2 * s.u * s.u * s.u + (a2 - C.q - C.lambda * C.lambda) * s.u,
    az: dazBL - twist * s.pr,
  };
}

const axpy = (s: MinoState, d: MinoState, h: number): MinoState => ({
  r: s.r + h * d.r,
  pr: s.pr + h * d.pr,
  u: s.u + h * d.u,
  pu: s.pu + h * d.pu,
  az: s.az + h * d.az,
});

/** One RK4 step of the separated system, by Mino time h. */
export function minoStep(s: MinoState, C: RayPotentials, a: number, h: number): MinoState {
  const k1 = minoDeriv(s, C, a);
  const k2 = minoDeriv(axpy(s, k1, h / 2), C, a);
  const k3 = minoDeriv(axpy(s, k2, h / 2), C, a);
  const k4 = minoDeriv(axpy(s, k3, h), C, a);
  const w = h / 6;
  return {
    r: s.r + w * (k1.r + 2 * k2.r + 2 * k3.r + k4.r),
    pr: s.pr + w * (k1.pr + 2 * k2.pr + 2 * k3.pr + k4.pr),
    u: s.u + w * (k1.u + 2 * k2.u + 2 * k3.u + k4.u),
    pu: s.pu + w * (k1.pu + 2 * k2.pu + 2 * k3.pu + k4.pu),
    az: s.az + w * (k1.az + 2 * k2.az + 2 * k3.az + k4.az),
  };
}

/**
 * Back to the Cartesian Kerr-Schild the rest of the lab works in: the same map
 * kerr.ts's ksRadius inverts, x, z = sqrt(r^2+a^2) sin(theta) (cos, sin)(az)
 * and y = r cos(theta), differentiated once for the travel direction.
 *
 * Exported because the tests need to build a deliberately mirrored direction
 * from a state (a reflection leaves winding untouched, so only a direction
 * check can catch it) and because the GLSL mirror reconstructs the same way.
 */
export function minoToCartesian(
  s: MinoState,
  C: RayPotentials,
  a: number
): { pos: V3; vel: V3 } {
  const Rr = Math.sqrt(s.r * s.r + a * a);
  const sn = Math.sqrt(Math.max(1 - s.u * s.u, 0));
  const cf = Math.cos(s.az);
  const sf = Math.sin(s.az);
  const daz = minoDeriv(s, C, a).az;
  const dRr = (s.r * s.pr) / Rr;
  // On the spin axis sn vanishes with pu (U(+-1) = -lambda^2 forces lambda = 0
  // there), so the quotient is 0/0 rather than a pole; the guard only keeps
  // float arithmetic out of it.
  const dsn = sn > 1e-12 ? (-s.u * s.pu) / sn : 0;
  return {
    pos: [Rr * sn * cf, s.r * s.u, Rr * sn * sf],
    vel: [
      dRr * sn * cf + Rr * dsn * cf - Rr * sn * sf * daz,
      s.pr * s.u + s.r * s.pu,
      dRr * sn * sf + Rr * dsn * sf + Rr * sn * cf * daz,
    ],
  };
}

/**
 * The handoff: separated state at a marched position, taking only the march's
 * PHASE and re-deriving everything else from constants that never drifted.
 *
 * `C` must come from the LAUNCH point, not from here. By 320 steps the march
 * has drifted the Hamiltonian to ~3.6e-6, which near a turning point is a
 * percent of the radial potential, and gamma turns that into an exponentially
 * growing phase error: taking the constants from the exhausted state costs
 * 0.68 deg against 0.00024 deg on the deep band ray, and it PLATEAUS — refining
 * the step does not help, because the drifted constants are the error floor.
 *
 * So only r, u, az and the two signs sign(pr), sign(pu) are read from the
 * march; the magnitudes are re-projected onto sqrt(R) and sqrt(U) with the
 * launch constants, which puts the ray back exactly on the null cone. That
 * projection also fixes the Mino scale to the conserved energy, which is the
 * point: deriving it instead as Sigma |dr/dsigma| / sqrt(R) is algebraically
 * equal and numerically a trap — near a turning point sqrt(R) is tiny and the
 * drifted march makes the quotient garbage, worth 4.9 deg on an a = 0.7 ray.
 *
 * The clamps at zero are for a handoff that lands just outside the allowed
 * region (measured: R = -1.7e-5 on a near-face-on ray whose turning point the
 * march overshot). They are safe at that size and a lie at any other, so the
 * tests assert on how negative the potentials actually get.
 */
export function minoStateAt(
  pos: V3,
  mCov: V4,
  a: number,
  C: RayPotentials
): MinoState {
  const a2 = a * a;
  const r = ksRadius(pos, a);
  const V = raise(pos, a, mCov);
  const r2 = r * r;
  // dr/dsigma up to the positive factor r/Sigma^2 — only its sign is used.
  const Sq = r2 * r2 + a2 * pos[1] * pos[1];
  const drds = (r / Sq) * (r2 * pos[0] * V[1] + (r2 + a2) * pos[1] * V[2] + r2 * pos[2] * V[3]);
  const u = pos[1] / r;
  const duds = (V[2] * r - pos[1] * drds) / r2;
  return {
    r,
    u,
    az: Math.atan2(pos[2], pos[0]),
    pr: (drds >= 0 ? 1 : -1) * Math.sqrt(Math.max(radialPotential(r, C.lambda, C.q, a), 0)),
    pu: (duds >= 0 ? 1 : -1) * Math.sqrt(Math.max(polarPotential(u, C, a), 0)),
  };
}

/**
 * Mino-time step scale. The continuation's accuracy knob, mirrored by the GLSL
 * and asserted against by the tests, for the same reason MARCH_MAX_STEPS lives
 * in kerr.ts: the number only means anything if all three agree.
 *
 * At 0.05 the worst direction error over a sweep of 105 budget-exhausted rays
 * across six spins, five camera distances and inclinations from edge-on to
 * exactly face-on is ~0.3 deg against a converged reference — better than the
 * marching it replaces, which is 0.036 deg out on the deep band ray where the
 * continuation is 0.012 deg out. Relaxing it to 0.1 costs ~11 deg and halves
 * the step count; that is the knob to reach for first if the GPU objects.
 */
export const MINO_STEP_SCALE = 0.05;

/**
 * Hard cap on the continuation's own step count.
 *
 * Measured, not guessed: over the full 1280-wide pixel grid at fifteen cameras
 * spanning a = 0 to 0.998, distances 3.2 to 380 and inclinations from edge-on
 * to the pitch clamp, the worst ray costs 786 steps, one pixel in 14,147
 * exceeds 768, and none exceeds 1024. A cap that clips at some spin nobody
 * sampled resurrects the band this slice exists to remove, and does it looking
 * like a physics bug rather than a budget one — so the headroom is deliberate
 * and the tests assert the margin rather than the cap.
 */
export const MINO_MAX_STEPS = 1024;

/**
 * Cap on how much world azimuth one step may advance, in radians.
 *
 * The two omega above watch the radial and polar oscillators; NOTHING in them
 * watches the azimuth, and the azimuth is where this system's only genuinely
 * sharp feature lives. Near the spin axis daz carries lambda/(1 - u^2), and a
 * ray that reaches its polar turning point there passes over the pole with an
 * azimuth rate up to 5e4 concentrated in a Mino interval ~1e-4 wide: the ray
 * swings through half a turn of azimuth almost instantaneously. The same term
 * spikes on the other side too, where a/Delta grows close to the horizon —
 * measured 0.66 rad of azimuth in a single step on the deep band ray.
 *
 * Without this bound those rays did not merely lose accuracy, they FAILED TO
 * CONVERGE: refining the step scale took a near-axis ray from 1.8 deg to 5.5
 * deg to 50.8 deg, because a partially resolved spike is worse than an
 * unresolved one. This is the measurement that a plateau test catches and an
 * absolute threshold does not.
 *
 * It bounds only the SINGULAR part lambda/(1 - u^2), not the whole azimuth
 * rate. Bounding all of daz also catches the a/Delta term, which grows near the
 * horizon but is perfectly smooth there — that cost 1543 steps on a deep
 * equatorial ray to buy an improvement from 0.03 deg to 0.0004 deg, i.e.
 * nothing anyone can see, while doing no better near the axis. Watching the
 * singular term alone gives 722 steps and a BETTER near-axis result.
 *
 * 0.025 rather than 0.05 because the near-axis measurement pays for it: over
 * the rays just outside the guard below, 0.05 leaves 0.07 deg where 0.025
 * leaves 0.009, and it is that margin that lets the guard's threshold sit an
 * order of magnitude clear of the rays it must not flag.
 */
export const MINO_AZ_STEP = 0.025;

/**
 * Closest approach to the spin axis, as sin^2(theta), from the constants alone.
 *
 * U >= 0 confines the polar motion between the roots of a^2 v^2 - B v +
 * lambda^2 with v = 1 - u^2 and B = a^2 + q + lambda^2, so the SMALL root is
 * how near the axis this ray can ever come. Written as 2c/(b + sqrt(b^2 - 4ac))
 * rather than the usual quadratic formula: the two differ only in floating
 * point, and the usual one is a difference of nearly equal numbers exactly when
 * the root is small, which is the only regime this function is asked about.
 * Same cancellation kerr.ts's radialPotential rewrites its constant term to
 * avoid. This form also makes the lambda -> 0 limit exact rather than nearly.
 */
export function axisApproach(C: RayPotentials, a: number): number {
  const lam2 = C.lambda * C.lambda;
  const B = a * a + C.q + lam2;
  const disc = Math.sqrt(Math.max(B * B - 4 * a * a * lam2, 0));
  return (2 * lam2) / Math.max(B + disc, 1e-300);
}

/**
 * Below this closest approach, the continuation cannot resolve the ray and says
 * so instead of guessing.
 *
 * A ray that passes over the pole must swing its azimuth by very nearly pi, and
 * in the limit lambda -> 0 by exactly pi — the whole swing packed into a Mino
 * interval of order lambda/(a^2+q), which is 2e-5 for the rays that fail. That
 * is a genuine feature of the (r, theta, phi) chart rather than a step-size
 * problem: at lambda exactly zero the term is 0/0 and the integration misses
 * the jump entirely no matter how fine the step, turning the pole CROSSING into
 * a reflection. The Cartesian march the rest of the lab uses has no such
 * trouble, which is why it is the oracle here.
 *
 * 1e-5 is not a taste: measured against that march over 379 band rays at eight
 * cameras, every ray above it lands within 0.009 deg and the ones below reach
 * 126 deg, with three clear orders of magnitude between the two groups. It
 * flags 30 of those 379 — all at near-face-on cameras, none at any camera
 * within half a radian of the equator. See docs/ROADMAP.md for the closed form
 * that would fix them.
 */
export const MINO_AXIS_EPS = 1e-5;

export interface MinoResult {
  /** False only if the continuation reached the horizon. rayCaptured remains
   *  the authority on fate; this is a cross-check, never the source of truth. */
  escaped: boolean;
  /** The continuation spent its own budget. Should never happen in practice —
   *  it is the tripwire the ladder's magenta now stands for. */
  capped: boolean;
  /**
   * The ray passes too close to the spin axis for this chart to follow it (see
   * MINO_AXIS_EPS). `dir` and `swept` are then not to be believed.
   *
   * Deliberately NOT folded into `capped`: one means the step budget ran out
   * and the other means the physics is out of reach, and a caller that cannot
   * tell them apart cannot tell a budget regression from a chart problem.
   */
  nearAxis: boolean;
  /** Unit travel direction at escape. */
  dir: V3;
  /** Angle swept by the position direction over the continuation, in
   *  half-turns — the same measure and units as KerrTraceResult.winding, so
   *  the caller adds the two. */
  swept: number;
  steps: number;
  /** Final separated state, for diagnostics and for the tests' invariants. */
  state: MinoState;
}

/**
 * Run the separated system from a handoff state until the ray escapes or falls
 * through the horizon.
 *
 * Step control follows the two oscillators' own local frequencies rather than a
 * flat cap on h. A flat cap gets tuned to whatever rays you happened to sample:
 * the near-equatorial band rays have small Carter q, but off the equator q
 * reaches 20-25 and the polar swing runs 2-3x faster, and the cap that gave
 * 0.012 deg on the first set was 129.7 deg out on the second — converging
 * cleanly when cut, so it was never a bug, only a badly chosen control. Each
 * omega^2 is |d(acceleration)/d(coordinate)| for its oscillator. The other two
 * bounds stop overshoot in the coordinates themselves, which matters at large r
 * where pr grows like r^2.
 */
export function continueToEscape(
  s0: MinoState,
  C: RayPotentials,
  a: number,
  opts: { stepScale?: number; maxSteps?: number; rEscape?: number; azStep?: number } = {}
): MinoResult {
  const stepScale = opts.stepScale ?? MINO_STEP_SCALE;
  const maxSteps = opts.maxSteps ?? MINO_MAX_STEPS;
  const rEscape = opts.rEscape ?? 64;
  const azStep = opts.azStep ?? MINO_AZ_STEP;
  const rHor = horizonRadius(a) + 0.01;
  const a2 = a * a;
  const wuConst = C.q + C.lambda * C.lambda - a2;

  const nearAxis = axisApproach(C, a) < MINO_AXIS_EPS;
  let s = s0;
  let prev = minoToCartesian(s, C, a).pos;
  let swept = 0;
  let steps = 0;
  let capped = false;
  let hit = false;
  for (;;) {
    if (steps >= maxSteps) {
      capped = true;
      break;
    }
    const wu = Math.sqrt(Math.abs(6 * a2 * s.u * s.u + wuConst));
    const wr = Math.sqrt(Math.abs(6 * s.r * s.r + C.c2));
    const h = Math.min(
      stepScale / Math.max(wu, wr, 1e-9),
      (0.08 * Math.max(s.r, 1)) / Math.max(Math.abs(s.pr), 1e-9),
      0.08 / Math.max(Math.abs(s.pu), 1e-9),
      azStep / Math.max(Math.abs(C.lambda) / (1 - s.u * s.u), 1e-9)
    );
    s = minoStep(s, C, a, h);
    steps++;

    const cur = minoToCartesian(s, C, a).pos;
    const cx = prev[1] * cur[2] - prev[2] * cur[1];
    const cy = prev[2] * cur[0] - prev[0] * cur[2];
    const cz = prev[0] * cur[1] - prev[1] * cur[0];
    swept += Math.atan2(
      Math.hypot(cx, cy, cz),
      prev[0] * cur[0] + prev[1] * cur[1] + prev[2] * cur[2]
    );
    prev = cur;

    if (!Number.isFinite(s.r) || s.r < rHor) {
      hit = true;
      break;
    }
    if (s.r > rEscape && s.pr > 0) break;
  }
  const { vel } = minoToCartesian(s, C, a);
  const n = Math.hypot(vel[0], vel[1], vel[2]) || 1;
  return {
    escaped: !hit,
    capped,
    nearAxis,
    dir: [vel[0] / n, vel[1] / n, vel[2] / n],
    swept: swept / Math.PI,
    steps,
    state: s,
  };
}
