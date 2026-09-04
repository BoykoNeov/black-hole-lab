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
 * It never replaces the march — it runs from the EXHAUSTED state outward — but
 * it does now carry every emitter the march carries, in two shapes.
 *
 * The DISK, since slice 13: a ray still winding when the budget ends goes on
 * crossing the equatorial plane, and those crossings are passes through the
 * disk that nothing was shading (116 of 248 band pixels at a = 0.9 gain disk
 * light, 98 of them from nothing at all). They are exactly where `u` changes
 * sign, which the loop computes anyway — see `MinoCrossing`.
 *
 * The VOLUMETRIC matter — stars, the jet, TDE debris — since slice 18. Those
 * have no crossing to be located at: the march integrates them along each step
 * it takes, so the continuation has to hand back the path it took rather than
 * only the events on it. See `MinoSample`.
 */

import {
  diskShift,
  horizonRadius,
  ksMetric,
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
 * Measured, not guessed, and measured twice: slice 11's sweep found a worst of
 * 786 and set the cap at 1024. A wider sweep for slice 12 — the full 1280x800
 * grid at fifteen cameras, 57,104 band pixels — found an ordinary deep-band ray
 * at a = 0.998, pitch 0.15, distance 25 needing **1053**, with two pixels there
 * clipping at 1024 and eight more between 896 and 1023. Nothing near the spin
 * axis is involved; slice 11's camera set simply missed it.
 *
 * That matters more than the 29 steps, because the cap is what the ladder's
 * magenta rung now means: it has to read zero everywhere or it stops being a
 * tripwire. 1536 puts the measured worst at 69% of the cap, and the tests assert
 * the margin rather than the cap.
 */
export const MINO_MAX_STEPS = 1536;

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
 * The polar turning point's whole passage, in closed form (slice 12).
 *
 * A ray heading for a turning point near the axis has to swing its azimuth by
 * very nearly pi — exactly pi in the limit lambda -> 0 — inside a Mino interval
 * of order lambda/(a^2+q), which is 2e-5 for the rays that need this. Stepping
 * cannot find that swing: at lambda exactly zero the term lambda/(1 - u^2) is
 * 0/0, so the pole CROSSING degenerates into a reflection no matter how fine
 * the step. That was hurdle H9, and this is what closes it.
 *
 * Returns the Mino time and the SINGULAR part of the azimuth for the whole
 * passage — from v_e = 1 - u^2 down to the turning point and back out to v_e,
 * both legs — leaving the regular part, which depends on r alone, to be
 * integrated over the same dtau by the caller.
 *
 *     dtau    = integral(vmin..ve)  dv / (sqrt(1-v) sqrt(U))
 *     dazSing = integral(vmin..ve)  lambda dv / (v sqrt(1-v) sqrt(U))
 *
 * Both already count both legs: du = -dv/(2u) halves each integral and the two
 * symmetric legs double it again.
 *
 * The substitution is the whole trick. With v = vmin + sqrt(D) w^2,
 *
 *     sqrt(U) = sqrt(D) w sqrt(1 - a^2 w^2)     dv/sqrt(U) = 2 dw/sqrt(1-a^2 w^2)
 *
 * the turning point's 1/sqrt(U) cancels identically AND — the part that decides
 * it — nothing divides by the spin. The roadmap's arcsin form does, and a = 0
 * is not a hypothetical: at zero spin the default camera still has 384 band
 * pixels and rays that cross the pole.
 *
 * Geometrically, theta^2 ~ v = vmin + sqrt(D) w^2 with the azimuth swinging as
 * 2 atan(w/w_c) is a STRAIGHT LINE at distance sqrt(vmin) from the pole, in the
 * tangent plane there. That is why the swing is pi, why an arctangent is the
 * whole answer, and why continueToEscape adds the closest-approach point to the
 * swept angle instead of just the endpoints — for a straight line, two chords
 * through the nearest point are exact where the chord alone is not.
 *
 * lambda = 0 is not a special case if it is written carefully: the prefactor is
 * sgn exactly, atan2 gives pi/2 against a vanishing w_c where a division would
 * give an infinity, and sgn takes lambda = 0 to +1. The +pi and -pi that the
 * two sides of lambda = 0 produce are THE SAME AZIMUTH, so the discontinuity is
 * only apparent.
 *
 * The two O(v) corrections are not polish: without the first, the Mino time is
 * 1.7e-3 out at an entry of 1e-2 instead of 7.5e-6, and r is advanced over it.
 * What is left is O(v^2), i.e. 1e-8 at MINO_AXIS_V.
 */
export function axisPassage(
  C: RayPotentials,
  a: number,
  ve: number
): { dtau: number; dazSing: number; vmin: number; we: number; wc: number } {
  const a2 = a * a;
  const lam2 = C.lambda * C.lambda;
  const B = a2 + C.q + lam2;
  // (|lambda| - a)^2 + q >= 0 makes this non-negative, with equality only for an
  // equatorial q = 0 ray, which never comes near the axis to begin with.
  const sD = Math.sqrt(Math.max(B * B - 4 * a2 * lam2, 1e-300));
  const vmin = (2 * lam2) / Math.max(B + sD, 1e-300); // axisApproach, same form
  const wc = Math.sqrt(vmin / sD);
  const we = Math.sqrt(Math.max((ve - vmin) / sD, 0));
  const A = Math.atan2(we, wc);
  const sgn = C.lambda >= 0 ? 1 : -1;
  const pref = Math.sqrt((B + sD) / (2 * sD));
  return {
    dtau: 2 * we + ((a2 + sD) * we * we * we) / 3 + vmin * we,
    dazSing: 2 * sgn * pref * A + C.lambda * (we + (a2 / sD) * (we - wc * A)),
    vmin,
    we,
    wc,
  };
}

/**
 * Below this sin^2(theta), a ray heading for its polar turning point is handed
 * to axisPassage instead of stepped.
 *
 * It replaces slice 11's MINO_AXIS_EPS, and it means the opposite thing: that
 * constant was "closer than this and we give up", this one is "closer than this
 * and we switch to the closed form". The passage is exact at any threshold, so
 * this is a pure cost/accuracy trade, measured over 43 near-axis band rays at
 * 60 cameras against a step-refined march: 1.3e-4 deg at 3e-3 (worst 566
 * steps), 1.0e-3 at 1e-2 (370), 4.8e-3 at 3e-2 (331).
 *
 * 1e-1 fails outright at 6 deg, and the reason is worth keeping: the passage's
 * Mino time is then long enough for r to make a large excursion during it, and
 * neither the O(v^2) truncation above nor a bounded radial advance covers that.
 * 3e-3 is the most accurate threshold that is also cheap, and it is cheap
 * because an ordinary deep-band ray already costs 1053 steps.
 */
export const MINO_AXIS_V = 3e-3;

/**
 * The most a single step may let 1 - u^2 fall, as a fraction of itself.
 *
 * Nothing else in the step control watches this, and without it a step goes
 * from above MINO_AXIS_V straight past the turning point: the trigger never
 * fires, the ray reflects without its half-turn of azimuth, and the answer is
 * the same wrong one H9 described — measured at 155 deg. It is the bound that
 * makes the trigger window unmissable rather than likely.
 *
 * It converges, which is how it was chosen rather than guessed: worst error
 * 2.2e-2 deg with no cap, 2.1e-3 at 0.6, 2.1e-4 at 0.3, 1.3e-4 at 0.15, and
 * 1.2e-4 at 0.05 for 804 steps against 566. 0.15 is where the improvement
 * stops paying for itself.
 */
export const MINO_V_FALL = 0.15;

/**
 * An equatorial crossing made after the march gave up — the same shape as
 * kerr.ts's `KerrCrossing`, and deliberately so: the renderer composites the
 * two with one function, and the tests compare them entry for entry against a
 * converged march.
 */
export interface MinoCrossing {
  /** Boyer-Lindquist radius. It is the state's own `r`: at u = 0 the world
   *  position reconstructs with |pos.xz|^2 - a^2 = r^2 identically. */
  r: number;
  pos: V3;
  /** Exact circular-orbit disk shift factor, from the conserved constants. */
  g: number;
  /** Covariant spatial momentum, rescaled to the march's own normalization —
   *  every shift factor in the lab is homogeneous of degree -1 in it. */
  mv: V3;
}

/**
 * One point on the continuation's path, with the momentum the segment LEAVING
 * it is shaded with (slice 18).
 *
 * The march samples stars, jets and TDE debris per STEP — they are volumetric
 * emitters with no crossing to be located at — so the continuation has to hand
 * back the path itself, not just the events on it. The points are the step
 * boundaries, plus the two the geometry demands: the equatorial crossing that
 * splits a step (the disk sheet absorbs, so matter in FRONT of it may not be
 * composited behind it) and the closest-approach point of an axis passage (one
 * chord across it is short by 1.1 sqrt(vmin), and the jet is exactly there).
 *
 * `mv` is the momentum the segment STARTING here is shaded with, and at every
 * ordinary sample that is the momentum at this point — the same convention the
 * march uses for its own steps, so a ray's two halves are beamed the same way.
 *
 * The apex of an axis passage is the one place it cannot be, and `axis` marks
 * it. A polar turning point has pu = 0 by definition, and on a ray that goes
 * over the pole itself 1 - u^2 vanishes with it, so the azimuth rate
 * lambda/(1 - u^2) is 0/0 there and the velocity — hence the momentum — is not
 * defined by the chart. That sample carries the momentum at the passage's EXIT.
 * It is not a fudge: the passage is a Mino interval of order 2e-5, and the only
 * thing the momentum really does across it is flip the sign of pu, which the
 * exit carries exactly. It does mean `pos` and `mv` are not a matched pair on
 * that one sample, which is why it is flagged rather than left to be noticed.
 */
export interface MinoSample {
  pos: V3;
  /** Covariant spatial momentum, in the march's own normalization. */
  mv: V3;
  /** The closest-approach point of an axis passage: `mv` is the exit's. */
  axis?: true;
}

export interface MinoResult {
  /** False only if the continuation reached the horizon. rayCaptured remains
   *  the authority on fate; this is a cross-check, never the source of truth. */
  escaped: boolean;
  /** The continuation spent its own budget. Should never happen in practice —
   *  it is the tripwire the ladder's magenta now stands for. */
  capped: boolean;
  /**
   * How many polar turning points near the axis were taken in closed form
   * (slice 12). Reported rather than kept private because a passage that
   * silently stops firing looks exactly like nothing being wrong: the tests
   * assert this is non-zero on the rays that must use it and zero on the ray
   * that must not.
   */
  passages: number;
  /** Unit travel direction at escape. */
  dir: V3;
  /** Angle swept by the position direction over the continuation, in
   *  half-turns — the same measure and units as KerrTraceResult.winding, so
   *  the caller adds the two. */
  swept: number;
  /**
   * Equatorial crossings made during the continuation, in the order the ray
   * makes them — which is also the order they composite in, since the
   * continuation runs outward along the same ray and everything it finds sits
   * behind everything the march already shaded.
   *
   * Empty unless `opts.mt` is given. The separated system carries five scalars
   * and no metric, so it cannot know the march's energy normalization; without
   * it a shift factor would be off by an unknown constant, which is worse than
   * no shift factor at all.
   */
  crossings: MinoCrossing[];
  /**
   * The path the continuation took, in the order it was travelled (slice 18).
   *
   * Empty unless BOTH `opts.path` and `opts.mt` are given: the momentum on
   * each sample only means anything in the march's energy normalization, which
   * the separated system cannot recover on its own, and a path without it
   * would beam every emitter by an unknown constant.
   */
  path: MinoSample[];
  steps: number;
  /** Final separated state, for diagnostics and for the tests' invariants. */
  state: MinoState;
}

/**
 * The radial pair on its own, with the REGULAR part of the azimuth rate beside
 * it — everything in minoDeriv that does not mention u.
 *
 * That such a subsystem exists is what makes the pole passage a jump rather
 * than an approximation: dr/dtau and dpr/dtau contain no u at all (that is what
 * separation means), and neither does (a/Delta)(r^2+a^2-a lambda) - a - twist*pr.
 * So the radial motion during the passage can be advanced without knowing where
 * in the polar swing the ray is.
 */
function radialDeriv(
  r: number,
  pr: number,
  C: RayPotentials,
  a: number
): { dr: number; dpr: number; daz: number } {
  const a2 = a * a;
  const r2 = r * r;
  const Delta = r2 - 2 * r + a2;
  const twist = (2 * a * r) / (Delta * (r2 + a2));
  return {
    dr: pr,
    dpr: 2 * r * r2 + C.c2 * r + C.k,
    daz: (a / Delta) * (r2 + a2 - a * C.lambda) - a - twist * pr,
  };
}

/**
 * RK4 the radial pair over a fixed Mino interval, accumulating the regular
 * azimuth.
 *
 * `gone` is the load-bearing return value. A ray can be inbound in u — so bound
 * for the pole eventually — and still cross the escape radius first, at very
 * nearly the same Mino time: measured on rays at r = 11 to 31 heading out whose
 * 1 - u^2 dips below the trigger on the way. Jumping such a ray through a pole
 * crossing that never happens costs 14 deg, so the caller trials the passage
 * and refuses it when this comes back set.
 */
function radialAdvance(
  r: number,
  pr: number,
  C: RayPotentials,
  a: number,
  dtau: number,
  stepScale: number,
  rHor: number,
  rEscape: number
): { r: number; pr: number; az: number; steps: number; dead: boolean; gone: boolean } {
  let az = 0;
  let t = 0;
  let steps = 0;
  for (; steps < 64 && t < dtau; steps++) {
    const h = Math.min(
      stepScale / Math.max(Math.sqrt(Math.abs(6 * r * r + C.c2)), 1e-9),
      (0.08 * Math.max(r, 1)) / Math.max(Math.abs(pr), 1e-9),
      dtau - t
    );
    const k1 = radialDeriv(r, pr, C, a);
    const k2 = radialDeriv(r + (h / 2) * k1.dr, pr + (h / 2) * k1.dpr, C, a);
    const k3 = radialDeriv(r + (h / 2) * k2.dr, pr + (h / 2) * k2.dpr, C, a);
    const k4 = radialDeriv(r + h * k3.dr, pr + h * k3.dpr, C, a);
    az += (h / 6) * (k1.daz + 2 * (k2.daz + k3.daz) + k4.daz);
    const rNext = r + (h / 6) * (k1.dr + 2 * (k2.dr + k3.dr) + k4.dr);
    pr += (h / 6) * (k1.dpr + 2 * (k2.dpr + k3.dpr) + k4.dpr);
    r = rNext;
    t += h;
    if (!Number.isFinite(r) || r < rHor) return { r, pr, az, steps: steps + 1, dead: true, gone: false };
    if (r > rEscape && pr > 0) return { r, pr, az, steps: steps + 1, dead: false, gone: true };
  }
  return { r, pr, az, steps, dead: false, gone: false };
}

/**
 * The covariant momentum the shading wants, rebuilt from a separated state
 * (slice 13).
 *
 * The continuation carries five scalars and no metric, but `shadeCrossing`
 * needs `mv` — the same covariant spatial momentum the march hands it — for
 * the gas blobs and for slice 10's polarization. Three steps, and the middle
 * one is the only place this can go wrong:
 *
 *  1. `minoToCartesian` returns d(pos)/dtau and Mino time is
 *     dtau = dsigma / Sigma, so V^i = vel^i / Sigma is the affine tangent at
 *     the E = 1 normalization the potentials are written in.
 *
 *  2. V^t comes from the NULL CONDITION, which is a quadratic in it:
 *     (f - 1) T^2 + 2 f L T + (f L^2 + |V|^2) = 0, with L = l.V. Two roots,
 *     one per time orientation; the one whose lowered time component shares
 *     the sign of `mt` is the ray's.
 *
 *     Solving the LINEAR constraint m_t = g_(t mu) V^mu instead looks simpler
 *     and is a trap: it gives P = (l.V - m_t)/(1 - f), and f = 1 is exactly
 *     the ergosphere — a surface these rays really do cross — where it has no
 *     second root to fall back on. The quadratic passes through A = 0 there
 *     with one finite root, which is why it is written in the stable form
 *     (q = -(B + sign(B) sqrt(disc))/2, roots q/A and C/q) rather than the
 *     schoolbook one.
 *
 *  3. Lower — m_i = V^i + f (V^t + l.V) l_i, written out rather than borrowed
 *     so the GLSL mirror transcribes it — then rescale so the time component
 *     is exactly `mt`. Every shift factor in the lab is homogeneous of degree -1 in the
 *     momentum, so that scaling is what makes these crossings shade
 *     identically to the march's.
 *
 * Exported for that pinning and for nothing else: it is the one step in slice
 * 13 where a sign or a scale can go wrong silently, and it is checkable
 * against the march at a state the march also knows.
 *
 * Pinned by rebuilding `mv` at the HANDOFF state and comparing with the
 * march's own there: 1.5e-4 relative, which is the march's drift at 320 steps
 * and not this function's error — the rebuilt momentum is null to 1e-14, and
 * the march's is not. Agreement closer than 1e-4 would be evidence of a bug.
 */
export function covariantMomentum(
  s: MinoState,
  C: RayPotentials,
  a: number,
  mt: number
): { pos: V3; mv: V3 } {
  const { pos, vel } = minoToCartesian(s, C, a);
  const Sigma = s.r * s.r + a * a * s.u * s.u;
  const V: V3 = [vel[0] / Sigma, vel[1] / Sigma, vel[2] / Sigma];
  const { f, l } = ksMetric(pos, a);
  const L = l[0] * V[0] + l[1] * V[1] + l[2] * V[2];
  const V2 = V[0] * V[0] + V[1] * V[1] + V[2] * V[2];
  const A = f - 1;
  const B = 2 * f * L;
  const Cq = f * L * L + V2;
  const disc = Math.sqrt(Math.max(B * B - 4 * A * Cq, 0));
  const qq = -0.5 * (B + (B >= 0 ? 1 : -1) * disc);
  let T = Math.abs(A) > 1e-12 ? qq / A : Cq / qq;
  let lv = T + L;
  let mtr = -T + f * lv;
  if (mtr * mt <= 0) {
    T = Math.abs(qq) > 1e-30 ? Cq / qq : -Cq / B;
    lv = T + L;
    mtr = -T + f * lv;
  }
  // Written out rather than calling kerr.ts's `lower` so the GLSL mirror is a
  // transcription rather than a re-derivation: m_i = V^i + f (V^t + l.V) l_i.
  // Neither root having the right sign needs V to be non-null, which the
  // potentials forbid; the guard keeps a division by zero out of the shading
  // rather than fixing anything real.
  const k = Math.abs(mtr) > 1e-12 ? mt / mtr : 1;
  return {
    pos,
    mv: [k * (V[0] + f * lv * l[0]), k * (V[1] + f * lv * l[1]), k * (V[2] + f * lv * l[2])],
  };
}

/**
 * The crossing a step straddled, located and shaded (slice 13).
 *
 * `u` is interpolated LINEARLY across the step, which is what the march does
 * to its own y — so the two agree by construction rather than by coincidence —
 * and then the state is re-stepped to that fraction. Measured, the |u| left
 * over is 1.4e-6 to 2.7e-6, and fitting a quadratic through (u0, pu0, u1)
 * changes nothing at the precision the crossing radius is checked to (2e-3
 * relative against a 400,000-step march).
 *
 * `u` is then SNAPPED to zero. That is what a crossing is, and it puts the
 * reconstructed position exactly in the plane, so kerr.ts's own
 * rc^2 = |pos.xz|^2 - a^2 returns r^2 identically instead of nearly.
 */
function crossingAt(
  s: MinoState,
  C: RayPotentials,
  a: number,
  h: number,
  uNext: number,
  mt: number
): MinoCrossing {
  const stepped = minoStep(s, C, a, (h * s.u) / (s.u - uNext));
  const at: MinoState = { ...stepped, u: 0 };
  const { pos, mv } = covariantMomentum(at, C, a, mt);
  return {
    r: at.r,
    pos,
    // lam = z m_x - x m_z is the world-frame axial momentum the march carries;
    // in the continuation's normalized constants it is exactly -lambda * m_t.
    g: diskShift(at.r, a, mt, -C.lambda * mt),
    mv,
  };
}

/** Position alone, for the swept angle — the same map minoToCartesian uses. */
function positionAt(r: number, u: number, az: number, a: number): V3 {
  const Rr = Math.sqrt(r * r + a * a);
  const sn = Math.sqrt(Math.max(1 - u * u, 0));
  return [Rr * sn * Math.cos(az), r * u, Rr * sn * Math.sin(az)];
}

/** Angle between two position directions — the winding measure, per step. */
function sweptBetween(p: V3, c: V3): number {
  const cx = p[1] * c[2] - p[2] * c[1];
  const cy = p[2] * c[0] - p[0] * c[2];
  const cz = p[0] * c[1] - p[1] * c[0];
  return Math.atan2(Math.hypot(cx, cy, cz), p[0] * c[0] + p[1] * c[1] + p[2] * c[2]);
}

/**
 * Run the separated system from a handoff state until the ray escapes or falls
 * through the horizon.
 *
 * With `opts.mt` it also collects the equatorial crossings it makes on the way
 * out (slice 13). Those are real passes through the disk — at a = 0.9, 116 of
 * 248 band pixels gain light from them and 98 of those had none at all — and
 * they cost nothing extra to find, being where `u` changes sign in a loop that
 * is tracking `u` anyway.
 *
 * One event is not stepped at all: a polar turning point near the spin axis,
 * where the azimuth's swing is a half-turn packed into nothing and the chart is
 * 0/0 on the axis itself. axisPassage supplies that in closed form and the
 * radial pair is advanced across it separately — see both for why that is exact
 * rather than a shortcut, and MINO_V_FALL for why the trigger window has to be
 * unmissable.
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
  opts: {
    stepScale?: number;
    maxSteps?: number;
    rEscape?: number;
    azStep?: number;
    axisV?: number;
    vFall?: number;
    /**
     * The march's conserved m_t. Supplying it turns on equatorial crossing
     * collection (slice 13) — the energy normalization is the one thing the
     * separated system cannot recover on its own, and without it a shift
     * factor would be off by an unknown constant.
     */
    mt?: number;
    /**
     * Collect the path itself (slice 18), for the volumetric emitters that have
     * no crossing to be found at. Off by default because it costs a
     * `covariantMomentum` per point, which the direction and the winding do
     * not need.
     */
    path?: boolean;
  } = {}
): MinoResult {
  const stepScale = opts.stepScale ?? MINO_STEP_SCALE;
  const maxSteps = opts.maxSteps ?? MINO_MAX_STEPS;
  const rEscape = opts.rEscape ?? 64;
  const azStep = opts.azStep ?? MINO_AZ_STEP;
  const axisV = opts.axisV ?? MINO_AXIS_V;
  const vFall = opts.vFall ?? MINO_V_FALL;
  const mt = opts.mt;
  const crossings: MinoCrossing[] = [];
  const path: MinoSample[] = [];
  const wantPath = (opts.path ?? false) && mt !== undefined;
  const sample = (st: MinoState) => {
    const { pos, mv } = covariantMomentum(st, C, a, mt as number);
    path.push({ pos, mv });
  };
  const rHor = horizonRadius(a) + 0.01;
  const a2 = a * a;
  const wuConst = C.q + C.lambda * C.lambda - a2;

  let s = s0;
  let prev = minoToCartesian(s, C, a).pos;
  // The path starts where the march stopped, with no seam and nothing to
  // bridge. minoStateAt re-projects the MOMENTA onto sqrt(R) and sqrt(U), but
  // it reads r, u and az straight off the march's position and the map back is
  // exact — measured 4.2e-15 over the fixtures. So the march's last segment
  // ends exactly where the first segment here begins, and neither a gap nor an
  // overlap has to be accounted for.
  if (wantPath) sample(s);
  let swept = 0;
  let steps = 0;
  let passages = 0;
  let capped = false;
  let hit = false;
  // Set once the escape trial below refuses a passage. pr > 0 outside rEscape
  // is monotone (dpr/dtau > 0 there), so a ray that would leave during its
  // passage cannot come back and there is no point paying for the trial twice.
  let leaving = false;
  for (;;) {
    if (steps >= maxSteps) {
      capped = true;
      break;
    }
    const v = 1 - s.u * s.u;

    // Heading for a polar turning point near the axis: take the whole passage
    // in closed form rather than stepping into a 0/0.
    if (v < axisV && s.u * s.pu > 0 && !leaving) {
      const P = axisPassage(C, a, v);
      const half = P.dtau / 2;
      const h1 = radialAdvance(s.r, s.pr, C, a, half, stepScale, rHor, rEscape);
      const done = h1.dead || h1.gone;
      const h2 = done ? h1 : radialAdvance(h1.r, h1.pr, C, a, half, stepScale, rHor, rEscape);
      // The trial is charged at what it actually cost, and the second half did
      // not run when the first already settled it. Charging h1 twice there
      // would put this out of step with the GLSL mirror, which counts the two
      // halves separately — and the budget is what the ladder's tripwire means.
      steps += h1.steps + (done ? 0 : h2.steps);
      if (h1.gone || h2.gone) {
        leaving = true;
        continue;
      }
      if (h1.dead || h2.dead) {
        hit = true;
        break;
      }
      // The polar motion is autonomous and symmetric about its turning point,
      // so the ray leaves at the v it entered with pu reversed and u untouched.
      const uApex = (s.u >= 0 ? 1 : -1) * Math.sqrt(Math.max(1 - P.vmin, 0));
      const azApex = s.az + h1.az + P.dazSing / 2;
      // The closest-approach point, not just the endpoints: near the pole the
      // path is a straight line in the tangent plane, and two chords through
      // its nearest point are exact where one chord across is 1.1 sqrt(vmin)
      // short.
      const apex = positionAt(h1.r, uApex, azApex, a);
      swept += sweptBetween(prev, apex);
      s = {
        r: h2.r,
        pr: h2.pr,
        u: s.u,
        pu: -s.pu,
        az: azApex + h2.az + P.dazSing / 2,
      };
      const out = positionAt(s.r, s.u, s.az, a);
      swept += sweptBetween(apex, out);
      if (wantPath) {
        // Both chords of the passage go into the path, for the reason the
        // winding takes two rather than one: near the pole the path is a
        // straight line in the tangent plane, and one chord across is
        // 1.1 sqrt(vmin) short of two. The jet sits on this axis, so a passage
        // that cut the corner would cut it through the brightest thing in the
        // frame.
        //
        // The chord INTO the apex is shaded by the sample before it, which is
        // the ordinary rule; the chord out of it is shaded from the exit — see
        // MinoSample for why the apex has no momentum of its own. The passage
        // cannot straddle
        // the disk plane: it fires only at 1 - u^2 < MINO_AXIS_V and v falls
        // further inside it, so |u| stays above 0.998 throughout, the same
        // structural fact slice 13's crossings lean on.
        const exit = covariantMomentum(s, C, a, mt as number);
        path.push({ pos: apex, mv: exit.mv, axis: true }, exit);
      }
      prev = out;
      passages++;
      if (s.r > rEscape && s.pr > 0) break;
      continue;
    }

    const wu = Math.sqrt(Math.abs(6 * a2 * s.u * s.u + wuConst));
    const wr = Math.sqrt(Math.abs(6 * s.r * s.r + C.c2));
    const h = Math.min(
      stepScale / Math.max(wu, wr, 1e-9),
      (0.08 * Math.max(s.r, 1)) / Math.max(Math.abs(s.pr), 1e-9),
      0.08 / Math.max(Math.abs(s.pu), 1e-9),
      azStep / Math.max(Math.abs(C.lambda) / v, 1e-9),
      // and v itself may not fall by more than MINO_V_FALL of itself, or a
      // single step jumps clean over the trigger window above
      (vFall * v) / Math.max(2 * Math.abs(s.u * s.pu), 1e-9)
    );
    const sNext = minoStep(s, C, a, h);
    // The equatorial plane passed during this step, if any. The refinement
    // sub-step is charged against the budget like any other step: the ladder's
    // magenta means "the continuation spent MINO_MAX_STEPS" and nothing else,
    // and the GLSL mirror counts it the same way.
    if (mt !== undefined && s.u * sNext.u < 0) {
      const x = crossingAt(s, C, a, h, sNext.u, mt);
      crossings.push(x);
      // The crossing point enters the path too, so the step becomes two
      // segments rather than one: the disk sheet absorbs, and matter on the
      // near side of it has to be composited before it dims the light.
      if (wantPath) path.push({ pos: x.pos, mv: x.mv });
      steps++;
    }
    s = sNext;
    steps++;

    if (wantPath) sample(s);
    const cur = minoToCartesian(s, C, a).pos;
    swept += sweptBetween(prev, cur);
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
    passages,
    dir: [vel[0] / n, vel[1] / n, vel[2] / n],
    swept: swept / Math.PI,
    crossings,
    path,
    steps,
    state: s,
  };
}
