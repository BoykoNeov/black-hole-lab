import { describe, it, expect, beforeAll } from "vitest";
import { cameraBasis } from "../src/camera";
import {
  MARCH_MAX_STEPS,
  buildStaticTetrad,
  gDot,
  hamiltonian,
  horizonRadius,
  ksRadius,
  lower,
  radialPotential,
  raise,
  rayCaptured,
  rayConstants,
  rk4Step,
  stepLength,
  traceRayKerr,
  type V3,
  type V4,
} from "../src/kerr";
import {
  MINO_AXIS_EPS,
  MINO_AZ_STEP,
  MINO_MAX_STEPS,
  MINO_STEP_SCALE,
  axisApproach,
  continueToEscape,
  minoDeriv,
  minoStateAt,
  minoStep,
  minoToCartesian,
  polarPotential,
  rayPotentials,
  type MinoState,
  type RayPotentials,
} from "../src/mino";

const ASPECT = 1280 / 800;
const TAN_HALF_FOV = Math.tan((30 * Math.PI) / 360);

/** Camera and launch momentum for a normalized screen coordinate. */
function view(a: number, pitch: number, dist = 25) {
  const cam = cameraBasis({ yaw: 0.6, pitch, dist, fovDeg: 30 });
  const tet = buildStaticTetrad(cam.pos, a, cam.right, cam.up, cam.fwd);
  return {
    pos: cam.pos,
    launch(sx: number, sy: number): V4 {
      const vx = sx * TAN_HALF_FOV * ASPECT;
      const vy = sy * TAN_HALF_FOV;
      const inv = 1 / Math.hypot(vx, vy, 1);
      const m: V4 = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        m[i] = vx * inv * tet.rightCov[i] + vy * inv * tet.upCov[i] + inv * tet.fwdCov[i] - tet.uCov[i];
      }
      return m;
    },
  };
}

/**
 * The oracle: the same Cartesian Kerr-Schild rk4Step the renderer marches with,
 * but with its arc-length target scaled down 50x.
 *
 * traceRayKerr with a huge maxSteps is NOT a converged reference — it still
 * uses the renderer's own stepLength, and on these near-critical rays that is
 * 0.23-0.97 deg away from a step-refined march, which is larger than the error
 * being measured. Three times in this slice's development an apparent failure of
 * the continuation turned out to be the reference: once the coarse march, once
 * the sqrt(R) Mino scale, and once a "converged" run of the continuation itself
 * used to check the continuation. Hence a march, in different coordinates,
 * sharing no code with what it is judging — and its Hamiltonian asserted, so a
 * future change to stepLength cannot silently un-converge it.
 */
function marchRefined(p0: V3, mCov: V4, a: number, fine = 0.02, maxSteps = 8_000_000) {
  const mt = mCov[0];
  let p: V3 = [...p0];
  let mv: V3 = [mCov[1], mCov[2], mCov[3]];
  const rHor = horizonRadius(a) + 0.01;
  let swept = 0;
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const V = raise(p, a, [mt, mv[0], mv[1], mv[2]]);
    const h = (fine * stepLength(ksRadius(p, a))) / Math.max(Math.hypot(V[1], V[2], V[3]), 1e-9);
    const next = rk4Step(p, mv, a, mt, h);
    const cx = p[1] * next.p[2] - p[2] * next.p[1];
    const cy = p[2] * next.p[0] - p[0] * next.p[2];
    const cz = p[0] * next.p[1] - p[1] * next.p[0];
    swept += Math.atan2(Math.hypot(cx, cy, cz), p[0] * next.p[0] + p[1] * next.p[1] + p[2] * next.p[2]);
    p = next.p;
    mv = next.mv;
    const rN = ksRadius(p, a);
    if (rN < rHor || !Number.isFinite(rN)) {
      return { escaped: false, dir: [0, 0, 0] as V3, winding: swept / Math.PI, steps, H: 0 };
    }
    if (rN > 64 && p[0] * mv[0] + p[1] * mv[1] + p[2] * mv[2] > 0) break;
  }
  const V = raise(p, a, [mt, mv[0], mv[1], mv[2]]);
  const n = Math.hypot(V[1], V[2], V[3]) || 1;
  return {
    escaped: true,
    dir: [V[1] / n, V[2] / n, V[3] / n] as V3,
    winding: swept / Math.PI,
    steps,
    H: hamiltonian(p, a, mt, mv),
  };
}

/**
 * Covariant momentum of a null ray at p travelling along spatial direction
 * `vel` — the bridge that lets the march start from exactly the state the
 * continuation starts from.
 *
 * The null condition g(P, P) = 0 is a quadratic in P^t with two roots, one
 * future- and one past-directed; the march carries the time-reversed tangent,
 * so `mtSign` picks the branch that matches the ray it came from. Getting that
 * wrong yields a different geodesic through the same point, which is why the
 * caller checks that lambda and q come back unchanged.
 */
function mCovFromVel(p: V3, a: number, vel: V3, mtSign: number): V4 {
  const T: V4 = [1, 0, 0, 0];
  const V: V4 = [0, vel[0], vel[1], vel[2]];
  const gtt = gDot(p, a, T, T);
  const gtv = gDot(p, a, T, V);
  const gvv = gDot(p, a, V, V);
  const disc = Math.sqrt(Math.max(gtv * gtv - gtt * gvv, 0));
  for (const Pt of [(-gtv + disc) / gtt, (-gtv - disc) / gtt]) {
    const m = lower(p, a, [Pt, vel[0], vel[1], vel[2]]);
    if (Math.sign(m[0]) === mtSign) return m;
  }
  return lower(p, a, [(-gtv + disc) / gtt, vel[0], vel[1], vel[2]]);
}

const angleDeg = (u: V3, v: V3) =>
  (Math.acos(Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * 180) / Math.PI;

/**
 * Rays the 320-step march genuinely leaves unresolved, found by bisecting the
 * capture boundary rather than by scanning: the deep band is a fraction of a
 * screen pixel wide at a = 0.998 and a grid fine enough to land in it costs
 * more than every test in this file put together. Pinning the coordinates also
 * pins WHICH rays are being claimed about.
 *
 * `flagged` is what the near-axis guard should say. Both answers are
 * represented on purpose: the last two entries sit a hair OUTSIDE the guard
 * (closest approach 1.5e-5 and 1.0e-5 against a threshold of 1e-5) and must
 * both pass the guard and be accurate, so the threshold is pinned from below as
 * well as above. Without them, a guard that flagged everything would still make
 * every other test in this file pass.
 */
const FIXTURES: {
  tag: string;
  a: number;
  pitch: number;
  sx: number;
  sy: number;
  flagged?: boolean;
}[] = [
  // prograde edge, edge-on-ish camera: the deep band, where gamma is smallest
  { tag: "a=0.998 prograde, deepest", a: 0.998, pitch: 0.15, sx: -0.199515028, sy: 0 },
  { tag: "a=0.998 prograde, mid", a: 0.998, pitch: 0.15, sx: -0.256135537, sy: 0 },
  { tag: "a=0.998 prograde, off-equator", a: 0.998, pitch: 0.15, sx: -0.140682879, sy: 0.5 },
  { tag: "a=0.9 prograde, deep", a: 0.9, pitch: 0.15, sx: -0.265096256, sy: 0 },
  { tag: "a=0.9 prograde, off-equator", a: 0.9, pitch: 0.15, sx: -0.245013723, sy: -0.25 },
  // retrograde edge, where gamma is 20x larger and the band is a hair wide
  { tag: "a=0.998 retrograde", a: 0.998, pitch: 0.15, sx: 0.639091764, sy: 0 },
  { tag: "a=0.9 retrograde", a: 0.9, pitch: 0.15, sx: 0.623815981, sy: 0 },
  // near-face-on: large Carter q, fast polar swing — where a flat step cap failed
  { tag: "a=0.998 near-face-on, tiny R", a: 0.998, pitch: 1.45, sx: -0.412893915, sy: 0 },
  { tag: "a=0.998 near-face-on, R<0 handoff", a: 0.998, pitch: 1.45, sx: -0.282696927, sy: 0.5 },
  { tag: "a=0.998 near-face-on, retrograde", a: 0.998, pitch: 1.45, sx: 0.465561373, sy: 0 },
  // over the pole: lambda = 0 to four decimals, the case the guard exists for
  { tag: "a=0.9 over the pole", a: 0.9, pitch: 1.5707, sx: -0.447732144, sy: 0, flagged: true },
  { tag: "a=0.9 over the pole, off-centre", a: 0.9, pitch: 1.5707, sx: 0.419617565, sy: 0.25, flagged: true },
  // just outside the guard, at the camera's own pitch clamp: must NOT be flagged
  { tag: "a=0.9 guard boundary", a: 0.9, pitch: 1.5508, sx: -0.086317435, sy: 0.702128 },
  { tag: "a=0.998 guard boundary", a: 0.998, pitch: 1.5508, sx: 0.071305708, sy: -0.699625 },
];

interface Case {
  tag: string;
  a: number;
  flagged: boolean;
  C: RayPotentials;
  handoff: MinoState;
  /** R and U at the handoff, before minoStateAt's clamp at zero. */
  rawR: number;
  rawU: number;
  marchWinding: number;
  /** March from the re-projected handoff state: judges the continuation alone. */
  refOwn: ReturnType<typeof marchRefined>;
  /** The same, four times finer, so the oracle can be shown to be converged. */
  refOwnFine: ReturnType<typeof marchRefined>;
  /** Energy of the re-launched ray: the Hamiltonian's natural scale. */
  mtRe: number;
  /** March from the camera: judges the march prefix and continuation together. */
  refEnd: ReturnType<typeof marchRefined>;
}

const cases: Case[] = [];

beforeAll(() => {
  for (const f of FIXTURES) {
    const v = view(f.a, f.pitch);
    const m = v.launch(f.sx, f.sy);
    const short = traceRayKerr(v.pos, m, f.a, { rEscape: 64, maxSteps: MARCH_MAX_STEPS });
    // Only rays that SPENT the budget. The march also breaks early through the
    // horizon or on a non-finite radius, and those states are garbage (|mv| of
    // 4e4, a Hamiltonian of 3.8e8) that must never reach the continuation.
    expect(short.escaped, `${f.tag}: fixture escaped within budget`).toBe(false);
    expect(short.steps, `${f.tag}: fixture did not spend the budget`).toBe(MARCH_MAX_STEPS);
    expect(rayCaptured(v.pos, m, f.a), `${f.tag}: fixture is captured`).toBe(false);

    const rc = rayConstants(v.pos, m, f.a);
    const C = rayPotentials(rc.lambda, rc.q, f.a);
    const mCov: V4 = [short.mt, short.mv[0], short.mv[1], short.mv[2]];
    const r = ksRadius(short.pos, f.a);
    const handoff = minoStateAt(short.pos, mCov, f.a, C);

    // the same state the continuation will start from, handed to the march
    const { pos, vel } = minoToCartesian(handoff, C, f.a);
    const mRe = mCovFromVel(pos, f.a, vel, Math.sign(short.mt));
    const rcRe = rayConstants(pos, mRe, f.a);
    // A wrong root of the null condition is a different geodesic, so this says
    // so loudly. Relative, because the one fixture whose handoff U is clamped
    // moves q by 4e-7 of itself — a wrong root moves it by order one.
    const rel = (x: number, y: number) => Math.abs(x - y) / Math.max(Math.abs(y), 1e-6);
    expect(rel(rcRe.lambda, C.lambda), `${f.tag}: re-launch changed lambda`).toBeLessThan(1e-5);
    expect(rel(rcRe.q, C.q), `${f.tag}: re-launch changed q`).toBeLessThan(1e-5);

    cases.push({
      tag: f.tag,
      a: f.a,
      flagged: f.flagged ?? false,
      C,
      handoff,
      rawR: radialPotential(r, C.lambda, C.q, f.a),
      rawU: polarPotential(short.pos[1] / r, C, f.a),
      marchWinding: short.winding,
      refOwn: marchRefined(pos, mRe, f.a),
      refOwnFine: marchRefined(pos, mRe, f.a, 0.005),
      refEnd: marchRefined(v.pos, m, f.a),
      mtRe: mRe[0],
    });
  }
}, 300_000);

/** The fixtures the continuation actually claims to get right. */
const resolvable = () => cases.filter((c) => !c.flagged);

describe("separated continuation (slice 11)", () => {
  /**
   * Everything below is measured against these marches, so they are checked
   * first, two ways.
   *
   * The Hamiltonian is scaled by the ray's energy because it is quadratic in
   * the momentum, and the re-launched rays do not share a normalization: one
   * fixture comes back with |m_t| of 1740 and an absolute drift of 3e-9, which
   * is 1e-15 of its own scale and better than every other fixture. An absolute
   * threshold there would be comparing rulers, not lengths. The refinement
   * check is the one that needs no interpretation at all.
   */
  it("both oracles are actually converged", () => {
    for (const c of cases) {
      expect(c.refOwn.escaped, `${c.tag}: own-state reference did not escape`).toBe(true);
      expect(c.refEnd.escaped, `${c.tag}: end-to-end reference did not escape`).toBe(true);
      expect(Math.abs(c.refOwn.H) / (c.mtRe * c.mtRe), `${c.tag}: own-state reference drifted`).toBeLessThan(1e-11);
      expect(Math.abs(c.refEnd.H), `${c.tag}: end-to-end reference drifted`).toBeLessThan(1e-11);
      // and it does not move when refined four times further
      expect(
        angleDeg(c.refOwn.dir, c.refOwnFine.dir),
        `${c.tag}: own-state reference still moving under refinement`
      ).toBeLessThan(1e-4);
    }
  });

  /**
   * Test 1: the azimuth rate, against the march's own. This one assertion pins
   * all three sign decisions in minoDeriv at once, and it is unfoolable — the
   * wrong twist sign gives 2.13 where the march says 10.33, and the mirror sign
   * gives the negative of that.
   */
  it("daz/dtau matches the march's own azimuth rate", () => {
    const f = FIXTURES[0];
    const a = f.a;
    const v = view(a, f.pitch);
    const m = v.launch(f.sx, f.sy);
    const short = traceRayKerr(v.pos, m, a, { rEscape: 64, maxSteps: MARCH_MAX_STEPS });
    const p = short.pos;
    const mCov: V4 = [short.mt, short.mv[0], short.mv[1], short.mv[2]];
    const V = raise(p, a, mCov);
    const r = ksRadius(p, a);
    // dtau = dsigma / Sigma, with Sigma = r^2 + a^2 cos^2(theta), which in these
    // coordinates is (r^4 + a^2 y^2) / r^2. Dividing by the conserved energy
    // removes the march's own normalization.
    const Sigma = (r ** 4 + a * a * p[1] * p[1]) / (r * r);
    const dazMarch =
      ((Sigma / Math.abs(short.mt)) * (p[0] * V[3] - p[2] * V[1])) / (p[0] * p[0] + p[2] * p[2]);

    const rc = rayConstants(v.pos, m, a);
    const C = rayPotentials(rc.lambda, rc.q, a);
    const s = minoStateAt(p, mCov, a, C);
    const daz = minoDeriv(s, C, a).az;
    expect(Math.abs((daz - dazMarch) / dazMarch)).toBeLessThan(1e-5);

    // the two sign errors it exists to catch are nowhere near, and the mirror
    // one is not merely wrong but backwards
    const twist = (2 * a * r) / ((r * r - 2 * r + a * a) * (r * r + a * a));
    const dazBL = daz + twist * s.pr;
    expect(Math.abs((dazBL + twist * s.pr - dazMarch) / dazMarch)).toBeGreaterThan(0.1);
    expect((-dazBL - twist * s.pr) / dazMarch).toBeLessThan(0);
  });

  /**
   * Test 2: what the continuation itself controls — direction and swept angle
   * from a given handoff state, against a march from that same state.
   *
   * This is the comparison that means something. Against a march from the
   * CAMERA the floor is 0.3-0.7 deg no matter how fine anything gets, because
   * the re-projection onto the launch constants deliberately moves the state
   * off the drifted one the march reached; see the end-to-end test below.
   */
  it("integrates as accurately as a Cartesian march from the same state", () => {
    let worstAngle = 0;
    let worstWind = 0;
    for (const c of resolvable()) {
      const res = continueToEscape(c.handoff, c.C, c.a);
      expect(res.escaped, `${c.tag}: continuation fell in`).toBe(true);
      expect(res.nearAxis, `${c.tag}: unexpectedly flagged near-axis`).toBe(false);
      const ang = angleDeg(res.dir, c.refOwn.dir);
      const dw = Math.abs(res.swept - c.refOwn.winding);
      expect(ang, `${c.tag}: direction`).toBeLessThan(0.05);
      expect(dw, `${c.tag}: winding`).toBeLessThan(0.001);
      worstAngle = Math.max(worstAngle, ang);
      worstWind = Math.max(worstWind, dw);
    }
    expect(worstAngle).toBeLessThan(0.05);
    expect(worstWind).toBeLessThan(0.001);
  });

  /**
   * Test 2b: end to end, and deliberately loose.
   *
   * These rays are exponentially sensitive to their own state — that is what
   * gamma means — so by the time the march has spent 320 steps its trajectory
   * has already diverged from a converged one, and no continuation can undo
   * that. On the retrograde edge, where gamma is 4.08 against 0.19, the same
   * ray comes out 7 deg from a converged march purely on the prefix. The
   * assertion is two-sided on purpose: the upper bound catches a real
   * regression, and the LOWER bound records that this drift exists and is
   * large, so nobody later reads the loose upper bound as sloppiness.
   */
  it("end to end, prefix drift dominates and is bounded", () => {
    let worst = 0;
    for (const c of resolvable()) {
      const res = continueToEscape(c.handoff, c.C, c.a);
      const ang = angleDeg(res.dir, c.refEnd.dir);
      expect(ang, `${c.tag}: end-to-end direction`).toBeLessThan(15);
      expect(
        Math.abs(c.marchWinding + res.swept - c.refEnd.winding),
        `${c.tag}: end-to-end winding`
      ).toBeLessThan(0.05);
      worst = Math.max(worst, ang);
    }
    expect(worst, "prefix drift has vanished — check the march, not this test").toBeGreaterThan(1);
  });

  /**
   * Test 3: the error must FALL as the step scale shrinks, measured against the
   * same-state oracle.
   *
   * An absolute threshold alone is not enough. Taking the constants from the
   * exhausted state rather than the launch passes one and then plateaus,
   * because the drifted constants become the error floor; and against the
   * camera-launched oracle EVERY variant plateaus, at the re-projection offset,
   * which is a false plateau that cost a whole experiment to see through.
   */
  it("converges as MINO_STEP_SCALE shrinks", () => {
    for (const c of resolvable()) {
      const errs = [0.2, 0.1, 0.05, 0.025].map((stepScale) =>
        angleDeg(
          continueToEscape(c.handoff, c.C, c.a, { stepScale, maxSteps: 200_000 }).dir,
          c.refOwn.dir
        )
      );
      expect(errs[3], `${c.tag}: 0.025 not better than 0.2`).toBeLessThan(errs[0] * 0.5 + 1e-4);
      expect(errs[2], `${c.tag}: 0.05 not better than 0.1`).toBeLessThan(errs[1] + 1e-4);
    }
  });

  /**
   * Test 4: the invariants the whole scheme rests on. Squaring the first-order
   * equations is what removed the turning-point sign bookkeeping, and the price
   * is that pr^2 = R and pu^2 = U are no longer enforced — they are conserved
   * only as well as the integrator conserves them. Needs no oracle at all.
   *
   * The budget is measured from the handoff rather than from zero: minoStateAt
   * clamps a handoff that lands a rounding error outside the allowed region, and
   * that clamp is a real (small) initial residual on one fixture. What this test
   * asserts is that the INTEGRATION adds nothing to it.
   */
  it("holds pr^2 = R(r) and pu^2 = U(u) along the whole continuation", () => {
    for (const c of cases) {
      const rel = (p: number, pot: number) => Math.abs(p * p - pot) / Math.max(Math.abs(pot), 1);
      const startR = rel(c.handoff.pr, radialPotential(c.handoff.r, c.C.lambda, c.C.q, c.a));
      const startU = rel(c.handoff.pu, polarPotential(c.handoff.u, c.C, c.a));
      let s = c.handoff;
      let worstR = 0;
      let worstU = 0;
      const a2 = c.a * c.a;
      const wuConst = c.C.q + c.C.lambda * c.C.lambda - a2;
      for (let i = 0; i < MINO_MAX_STEPS && !(s.r > 64 && s.pr > 0); i++) {
        const wu = Math.sqrt(Math.abs(6 * a2 * s.u * s.u + wuConst));
        const wr = Math.sqrt(Math.abs(6 * s.r * s.r + c.C.c2));
        const h = Math.min(
          MINO_STEP_SCALE / Math.max(wu, wr, 1e-9),
          (0.08 * Math.max(s.r, 1)) / Math.max(Math.abs(s.pr), 1e-9),
          0.08 / Math.max(Math.abs(s.pu), 1e-9),
          MINO_AZ_STEP / Math.max(Math.abs(c.C.lambda) / (1 - s.u * s.u), 1e-9)
        );
        s = minoStep(s, c.C, c.a, h);
        worstR = Math.max(worstR, rel(s.pr, radialPotential(s.r, c.C.lambda, c.C.q, c.a)));
        worstU = Math.max(worstU, rel(s.pu, polarPotential(s.u, c.C, c.a)));
      }
      expect(worstR - startR, `${c.tag}: integration drift in pr^2 - R`).toBeLessThan(1e-6);
      expect(worstU - startU, `${c.tag}: integration drift in pu^2 - U`).toBeLessThan(1e-6);
    }
  });

  /**
   * Test 5: the winding check cannot stand in for the direction check.
   *
   * Winding is the angle swept by the position direction, and that is invariant
   * under every orthogonal transform — so the mirror image of a trajectory has
   * winding identical to the last bit and a reflected sky direction. That is
   * exactly what a sign error in the azimuth convention produces (it cost a
   * debugging round in this slice's development), and it is why no test in this
   * file may assert on winding alone. Reflecting z is only a real test on a ray
   * whose direction actually has a z component, so that is asserted first
   * rather than assumed.
   */
  it("a mirrored trajectory passes the winding check and fails the direction check", () => {
    const c = cases[0];
    const res = continueToEscape(c.handoff, c.C, c.a);
    expect(Math.abs(c.refOwn.dir[2]), "mirror test ray is nearly in the y-x plane").toBeGreaterThan(0.5);

    const mirrored: V3 = [res.dir[0], res.dir[1], -res.dir[2]];
    expect(Math.abs(res.swept - c.refOwn.winding)).toBeLessThan(0.001);
    expect(angleDeg(mirrored, c.refOwn.dir)).toBeGreaterThan(5);
    expect(angleDeg(res.dir, c.refOwn.dir)).toBeLessThan(0.05);
  });

  /**
   * Test 6: winding rises monotonically as the screen coordinate walks in
   * toward the critical curve. Hundreds of rays for the price of no oracle at
   * all, and it is the invariant a phase error breaks — the ladder view colours
   * by winding, so a discontinuity here is a visible seam there.
   */
  it("winding stays monotonic walking in toward the critical curve", () => {
    for (const a of [0.9, 0.998]) {
      const v = view(a, 0.15);
      const windingAt = (sx: number): number | null => {
        const m = v.launch(sx, 0);
        if (rayCaptured(v.pos, m, a)) return null;
        const short = traceRayKerr(v.pos, m, a, { rEscape: 64, maxSteps: MARCH_MAX_STEPS });
        if (short.escaped) return short.winding;
        if (short.steps < MARCH_MAX_STEPS) return null;
        const rc = rayConstants(v.pos, m, a);
        const C = rayPotentials(rc.lambda, rc.q, a);
        const mCov: V4 = [short.mt, short.mv[0], short.mv[1], short.mv[2]];
        const res = continueToEscape(minoStateAt(short.pos, mCov, a, C), C, a);
        return short.winding + res.swept;
      };
      // bisect the prograde shadow edge, then walk out from it
      const captured = (s: number) => rayCaptured(v.pos, v.launch(-s, 0), a);
      let lo = 0;
      let hi = 0.05;
      while (hi <= 3 && captured(hi)) {
        lo = hi;
        hi *= 1.5;
      }
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        if (captured(mid)) lo = mid;
        else hi = mid;
      }
      let prev = -Infinity;
      let samples = 0;
      let deepest = 0;
      for (let k = 60; k >= 1; k--) {
        const w = windingAt(-(hi + 0.05 * Math.pow(0.82, 60 - k)));
        if (w === null) continue;
        expect(w, `a=${a}: winding fell at sample ${k}`).toBeGreaterThan(prev - 1e-6);
        prev = w;
        deepest = Math.max(deepest, w);
        samples++;
      }
      expect(samples, `a=${a}: too few samples`).toBeGreaterThan(40);
      expect(deepest, `a=${a}: band not deep enough to be a test`).toBeGreaterThan(5);
    }
  });

  /**
   * Test 7: the near-axis guard, pinned from BOTH sides.
   *
   * A ray that crosses the spin axis must swing its azimuth by very nearly pi,
   * packed into a Mino interval of order lambda/(a^2+q) — 2e-5 for the fixtures
   * that fail — and at lambda exactly zero the term is 0/0, so the crossing
   * degenerates into a reflection no matter how fine the step. The guard says
   * so rather than guessing. Flagging everything would satisfy the positive
   * half alone, which is what the boundary fixtures are for: they sit at 1.5e-5
   * and 1.0e-5 against a threshold of 1e-5 and must come through both unflagged
   * AND accurate.
   */
  it("flags rays that cross the spin axis, and only those", () => {
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a);
      expect(res.nearAxis, `${c.tag}: guard verdict`).toBe(c.flagged);
      expect(axisApproach(c.C, c.a) < MINO_AXIS_EPS, `${c.tag}: guard disagrees with its own criterion`).toBe(
        c.flagged
      );
    }
    const boundary = cases.filter((c) => c.tag.includes("guard boundary"));
    expect(boundary.length).toBe(2);
    for (const c of boundary) {
      const v = axisApproach(c.C, c.a);
      expect(v, `${c.tag}: fixture drifted inside the guard`).toBeGreaterThan(MINO_AXIS_EPS);
      expect(v, `${c.tag}: fixture is no longer near the axis at all`).toBeLessThan(1e-4);
      expect(angleDeg(continueToEscape(c.handoff, c.C, c.a).dir, c.refOwn.dir)).toBeLessThan(0.05);
    }
    // and the flagged ones really are the pole-crossers
    for (const c of cases.filter((x) => x.flagged)) {
      expect(Math.abs(c.C.lambda), `${c.tag}: flagged but not near-polar`).toBeLessThan(1e-2);
    }
  });

  /**
   * axisApproach is the guard's whole content, so it is checked against the
   * potential it claims to describe rather than only through the guard.
   */
  it("axisApproach is where the polar potential vanishes", () => {
    for (const [a, lambda, q] of [
      [0.998, 2.1, 0.08],
      [0.9, 0.05, 23.4],
      [0.5, 1.4, 3.2],
      [0, 0.7, 5.0],
    ] as const) {
      const C = rayPotentials(lambda, q, a);
      const v = axisApproach(C, a);
      expect(v, `a=${a}: outside (0, 1]`).toBeGreaterThan(0);
      // U vanishes there, u^2 = 1 - v
      expect(polarPotential(Math.sqrt(1 - v), C, a)).toBeCloseTo(0, 9);
      // and is positive just inside, so this really is the closest approach
      expect(polarPotential(Math.sqrt(Math.max(1 - 2 * v, 0)), C, a)).toBeGreaterThan(0);
    }
    // lambda = 0 reaches the axis exactly, with no epsilon and no cancellation
    expect(axisApproach(rayPotentials(0, 12, 0.9), 0.9)).toBe(0);
  });

  /** Test 8: fate never contradicts rayCaptured, which stays the authority. */
  it("never disagrees with rayCaptured about the ray's fate", () => {
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a);
      expect(res.escaped, `${c.tag}: continuation says captured, rayCaptured says escaped`).toBe(true);
    }
  });

  /**
   * MINO_MAX_STEPS must have real headroom over what the band costs: a cap that
   * clips resurrects the magenta band this slice exists to remove, and does it
   * looking like a physics bug rather than a budget one. The constant was set
   * from a full pixel-grid sweep whose worst ray is 786 steps.
   */
  it("finishes well inside MINO_MAX_STEPS", () => {
    let worst = 0;
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a);
      expect(res.capped, `${c.tag}: continuation hit its cap`).toBe(false);
      worst = Math.max(worst, res.steps);
    }
    expect(worst).toBeLessThan(MINO_MAX_STEPS * 0.75);
    expect(MINO_MAX_STEPS).toBeGreaterThan(786);
  });

  /**
   * minoStateAt clamps R and U at zero, which is honest only while the handoff
   * lands a rounding error outside the allowed region. Measured worst is
   * R = -1.7e-5 on a near-face-on ray whose turning point the march overshot;
   * anything larger means the handoff itself is wrong and the clamp is hiding
   * it, so the size is asserted rather than trusted.
   */
  it("hands off without the clamps hiding a bad state", () => {
    for (const c of cases) {
      expect(c.rawR, `${c.tag}: R at handoff`).toBeGreaterThan(-1e-3);
      expect(c.rawU, `${c.tag}: U at handoff`).toBeGreaterThan(-1e-3);
    }
  });

  it("polarPotential is the polar partner of radialPotential", () => {
    const a = 0.7;
    const C = rayPotentials(2.1, 3.4, a);
    // U(+-1) = -lambda^2: the spin axis is reachable only for a purely polar ray
    expect(polarPotential(1, C, a)).toBeCloseTo(-C.lambda * C.lambda, 12);
    expect(polarPotential(-1, C, a)).toBeCloseTo(-C.lambda * C.lambda, 12);
    // U(0) = q, and U is even
    expect(polarPotential(0, C, a)).toBeCloseTo(C.q, 12);
    expect(polarPotential(0.37, C, a)).toBeCloseTo(polarPotential(-0.37, C, a), 12);
    // and radialPotential's own coefficients are the ones cached here
    expect(radialPotential(3.3, C.lambda, C.q, a)).toBeCloseTo(
      ((3.3 * 3.3 + C.c2) * 3.3 + 2 * C.k) * 3.3 - a * a * C.q,
      10
    );
  });

  it("minoToCartesian inverts the Kerr-Schild radius", () => {
    const a = 0.6;
    const C = rayPotentials(1.2, 4.5, a);
    for (const s of [
      { r: 5.5, pr: 0.3, u: 0.4, pu: -0.2, az: 1.1 },
      { r: 2.1, pr: -1.7, u: -0.9, pu: 0.05, az: -2.6 },
      { r: 40, pr: 12, u: 0.02, pu: 0.3, az: 0.0 },
    ]) {
      const { pos } = minoToCartesian(s, C, a);
      expect(ksRadius(pos, a)).toBeCloseTo(s.r, 9);
      expect(pos[1] / s.r).toBeCloseTo(s.u, 9);
      expect(Math.atan2(pos[2], pos[0])).toBeCloseTo(s.az, 9);
    }
  });
});
