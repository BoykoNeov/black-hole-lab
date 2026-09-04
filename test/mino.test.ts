import { describe, it, expect, beforeAll } from "vitest";
import { cameraBasis } from "../src/camera";
import {
  MARCH_MAX_STEPS,
  buildStaticTetrad,
  diskShift,
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
import { JET_FLARE, JET_WIDTH0, jetOffset } from "../src/matter";
import {
  MINO_AXIS_V,
  MINO_AZ_STEP,
  MINO_MAX_STEPS,
  MINO_STEP_SCALE,
  MINO_V_FALL,
  axisApproach,
  axisPassage,
  continueToEscape,
  covariantMomentum,
  minoDeriv,
  minoStateAt,
  minoStep,
  minoToCartesian,
  polarPotential,
  rayPotentials,
  type MinoSample,
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
 * How much of a path lies inside the jet — the functional slice 18's light
 * actually depends on, and the one thing about the volumetric emitters that can
 * be judged without the shader.
 *
 * Deliberately a tighter cone than the one that emits. The shader's envelope
 * ends at q^2 = JET_Q2_CUT and at |y| = JET_BASE and JET_TOP, and the emission
 * is already going to zero at all three: the gaussian core is exp(-8) at the
 * cut, and the along-axis fade is exactly 0 at either end of the span.
 * A functional evaluated on a boundary where the answer is zero measures the
 * boundary, not the path. CONE_Q, CONE_LO and CONE_HI put the test where the
 * jet is actually bright.
 *
 * Measured by MIDPOINT SAMPLING at 0.01 M rather than by testing the endpoints,
 * because the two paths being compared are sampled utterly differently — the
 * continuation takes chords up to 1.33 M, the refined march takes ~1e-3 M — and
 * an endpoints-in test would charge the coarser one for every boundary it
 * straddles. That artifact alone read 2-9% low before it was removed.
 */
const CONE_Q = 1.5;
const CONE_LO = 4;
const CONE_HI = 40;
const inJet = (p: V3) =>
  Math.abs(p[1]) > CONE_LO && Math.abs(p[1]) < CONE_HI && jetOffset(p) < CONE_Q;

function coneChord(A: V3, B: V3): number {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  if (L === 0) return 0;
  // Cheap reject first, or this is the slowest thing in the file: the refined
  // marches take millions of steps between them and almost none of those are
  // anywhere near the jet. Both bounds are padded by the chord's own length, so
  // a segment that only clips the cone survives to be sampled properly.
  const yHi = Math.max(Math.abs(A[1]), Math.abs(B[1]));
  const yLo = Math.min(Math.abs(A[1]), Math.abs(B[1]));
  if (yHi + L < CONE_LO || yLo - L > CONE_HI) return 0;
  const wide = CONE_Q * (JET_WIDTH0 + JET_FLARE * Math.min(yHi, CONE_HI)) + L;
  if (Math.hypot(A[0], A[2]) > wide && Math.hypot(B[0], B[2]) > wide) return 0;
  const n = Math.max(1, Math.ceil(L / 0.01));
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    if (inJet([A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1]), A[2] + f * (B[2] - A[2])]))
      inside++;
  }
  return (inside / n) * L;
}

const conePath = (pts: V3[]) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += coneChord(pts[i - 1], pts[i]);
  return s;
};

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
  const lam = p[2] * mv[0] - p[0] * mv[2];
  // Slice 13's oracle: the equatorial crossings this march makes, located and
  // shaded exactly as traceRayKerr locates and shades its own. Built here
  // rather than borrowed from traceRayKerr for the reason the whole function
  // exists — at 50x the step count these land where the crossings really are.
  const crossings: { r: number; pos: V3; g: number }[] = [];
  // Slice 18's oracle, accumulated rather than stored: the path this march
  // spends inside the jet. Keeping the polyline instead would be hundreds of
  // megabytes over the fixtures, and nothing needs the curve itself.
  let coneLen = 0;
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
    if (p[1] * next.p[1] < 0) {
      const fr = p[1] / (p[1] - next.p[1]);
      const pc: V3 = [p[0] + fr * (next.p[0] - p[0]), 0, p[2] + fr * (next.p[2] - p[2])];
      const rc2 = pc[0] * pc[0] + pc[2] * pc[2] - a * a;
      if (rc2 > 0) crossings.push({ r: Math.sqrt(rc2), pos: pc, g: diskShift(Math.sqrt(rc2), a, mt, lam) });
    }
    coneLen += coneChord(p, next.p);
    p = next.p;
    mv = next.mv;
    const rN = ksRadius(p, a);
    if (rN < rHor || !Number.isFinite(rN)) {
      return { escaped: false, dir: [0, 0, 0] as V3, winding: swept / Math.PI, steps, H: 0, crossings, coneLen };
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
    crossings,
    coneLen,
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
 * Slice 12 changed what the last few entries are for rather than replacing
 * them. The two `over the pole` rays used to be the ones the chart could not
 * follow at all; they are now ordinary members of the accuracy tests, which is
 * the whole claim of that slice. The two former guard-boundary rays sit at a
 * closest approach of 1.5e-5 and 1.0e-5, which is now well INSIDE the trigger
 * rather than a hair outside it, and they stay because they are the rays that
 * used to be integrated and are now handed to the closed form: if the passage
 * is worse than the stepping it replaced, they say so.
 *
 * `noPassage` marks the ray that must be REFUSED — it would reach the pole, but
 * it leaves first.
 */
const FIXTURES: {
  tag: string;
  a: number;
  pitch: number;
  sx: number;
  sy: number;
  noPassage?: boolean;
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
  // over the pole: lambda = 0 to four decimals, and 156 deg out before slice 12
  { tag: "a=0.9 over the pole", a: 0.9, pitch: 1.5707, sx: -0.447732144, sy: 0 },
  { tag: "a=0.9 over the pole, off-centre", a: 0.9, pitch: 1.5707, sx: 0.419617565, sy: 0.25 },
  // stepped before slice 12, handed to the closed form after it
  { tag: "a=0.9 just inside the trigger", a: 0.9, pitch: 1.5508, sx: -0.086317435, sy: 0.702128 },
  { tag: "a=0.998 just inside the trigger", a: 0.998, pitch: 1.5508, sx: 0.071305708, sy: -0.699625 },
  // bound for the pole (closest approach 4e-35) but escaping from r = 11.7
  // first: the passage must be refused, and is 14 deg wrong if it is not
  {
    tag: "a=0.9 leaves before the pole",
    a: 0.9,
    pitch: Math.PI / 2,
    sx: -0.047619048,
    sy: -0.714285714,
    noPassage: true,
  },
];

interface Case {
  tag: string;
  a: number;
  noPassage: boolean;
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
  /** The march's own (m_t, mv) AT the handoff point — what slice 13 rebuilds. */
  marchMt: number;
  marchMv: V3;
  /** Where the march stopped: slice 18's path has to start there and not near there. */
  marchPos: V3;
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
      noPassage: f.noPassage ?? false,
      C,
      handoff,
      rawR: radialPotential(r, C.lambda, C.q, f.a),
      rawU: polarPotential(short.pos[1] / r, C, f.a),
      marchWinding: short.winding,
      refOwn: marchRefined(pos, mRe, f.a),
      refOwnFine: marchRefined(pos, mRe, f.a, 0.005),
      refEnd: marchRefined(v.pos, m, f.a),
      mtRe: mRe[0],
      marchMt: short.mt,
      marchMv: short.mv,
      marchPos: short.pos,
    });
  }
}, 300_000);

/**
 * The passage, integrated the hard way, for slice 12's closed form to be
 * checked against.
 *
 * RK4 on (u, pu) alone at a tiny fixed step, carrying the SINGULAR azimuth
 * lambda/(1 - u^2) and the Mino time beside it, from the entry at v = ve
 * inbound until v comes back out to ve. It shares no code with axisPassage,
 * needs no radius and no metric — the polar pair is autonomous — and it carries
 * only the singular term, so the comparison is clean at every spin rather than
 * only at a = 0.
 *
 * It cannot reach small lambda, and that limitation IS hurdle H9: the peak in
 * lambda/(1 - u^2) is ~B/lambda tall and ~sqrt(vmin/sqrt(D)) wide, so below
 * lambda ~ 1e-2 no fixed step resolves it. The lambda -> 0 limit is checked
 * analytically instead, which is the only way it can be checked at all.
 */
function finePassage(C: RayPotentials, a: number, ve: number, h = 1e-6) {
  const a2 = a * a;
  const dpu = (u: number) => -2 * a2 * u * u * u + (a2 - C.q - C.lambda * C.lambda) * u;
  const dsing = (u: number) => C.lambda / (1 - u * u);
  let u = Math.sqrt(1 - ve);
  let pu = Math.sqrt(Math.max(polarPotential(u, C, a), 0)); // u rising: v falling
  let tau = 0;
  let sing = 0;
  let turned = false;
  for (let i = 0; i < 1_000_000; i++) {
    const k1u = pu, k1p = dpu(u), k1s = dsing(u);
    const k2u = pu + (h / 2) * k1p, k2p = dpu(u + (h / 2) * k1u), k2s = dsing(u + (h / 2) * k1u);
    const k3u = pu + (h / 2) * k2p, k3p = dpu(u + (h / 2) * k2u), k3s = dsing(u + (h / 2) * k2u);
    const k4u = pu + h * k3p, k4p = dpu(u + h * k3u), k4s = dsing(u + h * k3u);
    const uN = u + (h / 6) * (k1u + 2 * (k2u + k3u) + k4u);
    const puN = pu + (h / 6) * (k1p + 2 * (k2p + k3p) + k4p);
    sing += (h / 6) * (k1s + 2 * (k2s + k3s) + k4s);
    if (!turned && pu * puN <= 0) turned = true;
    u = uN;
    pu = puN;
    tau += h;
    if (turned && 1 - u * u >= ve) return { dtau: tau, dazSing: sing, u, pu };
  }
  throw new Error("finePassage did not come back");
}

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
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a);
      expect(res.escaped, `${c.tag}: continuation fell in`).toBe(true);
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
    for (const c of cases) {
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
   *
   * `R<0 handoff` is exempt from the ratio and gets an absolute bound instead.
   * That ray's radial potential is 1.7e-5 NEGATIVE where the march handed it
   * over, so minoStateAt clamps its pr to zero — a fixed perturbation that no
   * step scale can remove, and it plateaus at 3.2e-3 deg. That is not new and
   * not slice 12's: under slice 11's own settings the same ray runs
   * 8.5e-3, 5.1e-3, 3.1e-3, 3.2e-3, 3.2e-3 over the five scales below. It
   * showed up here only because slice 12's cap on the fall in 1 - u^2 improved
   * the COARSE end (to 3.6e-3), which a ratio reads as a failure to converge.
   */
  it("converges as MINO_STEP_SCALE shrinks", () => {
    for (const c of cases) {
      const errs = [0.2, 0.1, 0.05, 0.025].map((stepScale) =>
        angleDeg(
          continueToEscape(c.handoff, c.C, c.a, { stepScale, maxSteps: 200_000 }).dir,
          c.refOwn.dir
        )
      );
      if (c.tag.includes("R<0 handoff")) {
        for (const e of errs) expect(e, `${c.tag}: clamped handoff floor moved`).toBeLessThan(0.01);
        continue;
      }
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
          MINO_AZ_STEP / Math.max(Math.abs(c.C.lambda) / (1 - s.u * s.u), 1e-9),
          // the same bounds continueToEscape uses, including slice 12's; this
          // test deliberately steps THROUGH the near-axis region rather than
          // taking the passage, because the invariants below are a property of
          // the integrator and hold there too
          (MINO_V_FALL * (1 - s.u * s.u)) / Math.max(2 * Math.abs(s.u * s.pu), 1e-9)
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
   * Slice 12, test 1: the closed-form passage against a fine integration of the
   * same passage.
   *
   * The comparison with no trajectory in it and no oracle to get wrong. Twice
   * in slice 12's development an apparent error in the closed form was the code
   * around it — once a ray leaving before its swing finished, once a step
   * jumping over the trigger — so this is the check to reach for first.
   */
  it("axisPassage matches a fine integration of the same passage", () => {
    let worstT = 0;
    let worstA = 0;
    for (const a of [0, 0.5, 0.9, 0.998])
      for (const lambda of [1e-2, 5e-2, 0.2])
        for (const q of [1, 20])
          for (const ve of [MINO_AXIS_V, 1e-2]) {
            const C = rayPotentials(lambda, q, a);
            const P = axisPassage(C, a, ve);
            if (!(P.we > 0)) continue;
            const f = finePassage(C, a, ve);
            const tag = `a=${a} lambda=${lambda} q=${q} ve=${ve}`;
            // it really did come back to where it started, mirrored
            expect(1 - f.u * f.u, `${tag}: fine run did not return to ve`).toBeCloseTo(ve, 5);
            expect(f.pu, `${tag}: fine run did not reverse`).toBeLessThan(0);
            const rT = Math.abs(P.dtau - f.dtau) / f.dtau;
            const rA = Math.abs(P.dazSing - f.dazSing) / Math.abs(f.dazSing);
            expect(rT, `${tag}: Mino time`).toBeLessThan(1e-3);
            expect(rA, `${tag}: azimuth swing`).toBeLessThan(1e-3);
            worstT = Math.max(worstT, rT);
            worstA = Math.max(worstA, rA);
          }
    // measured 2.5e-4 and 5.5e-5; the bound above is not generous, it is 4x
    expect(worstT).toBeLessThan(1e-3);
    expect(worstA).toBeLessThan(1e-3);
  });

  /**
   * Slice 12, test 2: the half-turn, which is the whole of H9.
   *
   * As lambda -> 0 the swing tends to +-pi and at lambda = 0 exactly the
   * integrand is 0/0 — which is why no step size ever found it and why the
   * closed form has to be written so the limit survives. The two one-sided
   * limits differ by 2pi, so what is asserted is that they are the SAME
   * AZIMUTH, not that the function is continuous: it is not, and claiming it
   * were would be the wrong fix.
   */
  it("the swing over the pole is a half-turn, from both sides and at zero", () => {
    for (const a of [0, 0.9, 0.998])
      for (const q of [1, 23.4]) {
        const ve = MINO_AXIS_V;
        const plus = axisPassage(rayPotentials(1e-9, q, a), a, ve).dazSing;
        const minus = axisPassage(rayPotentials(-1e-9, q, a), a, ve).dazSing;
        const zero = axisPassage(rayPotentials(0, q, a), a, ve);
        expect(plus, `a=${a} q=${q}: limit from above`).toBeCloseTo(Math.PI, 6);
        expect(minus, `a=${a} q=${q}: limit from below`).toBeCloseTo(-Math.PI, 6);
        expect(plus - minus, `a=${a} q=${q}: the two limits are one azimuth`).toBeCloseTo(2 * Math.PI, 6);
        // and at lambda = 0, where a division by wc would be an infinity
        expect(zero.dazSing, `a=${a} q=${q}: at lambda = 0`).toBeCloseTo(Math.PI, 12);
        expect(zero.vmin, `a=${a} q=${q}: reaches the axis exactly`).toBe(0);
        expect(Number.isFinite(zero.dtau), `a=${a} q=${q}: finite Mino time`).toBe(true);
      }
  });

  /**
   * Slice 12, test 3: nothing divides by the spin.
   *
   * The roadmap's arcsin form for this integral carries a 1/a, and a = 0 is not
   * hypothetical — at zero spin the default camera still has 384 band pixels
   * and rays that cross the pole. So a = 0 must be no worse than a = 0.998.
   */
  it("axisPassage is finite and accurate at zero spin", () => {
    for (const [lambda, q] of [
      [1e-2, 1],
      [5e-2, 20],
      [0.2, 20],
    ] as const) {
      const C = rayPotentials(lambda, q, 0);
      const P = axisPassage(C, 0, 1e-2);
      const f = finePassage(C, 0, 1e-2);
      expect(Number.isFinite(P.dtau) && Number.isFinite(P.dazSing)).toBe(true);
      expect(Math.abs(P.dtau - f.dtau) / f.dtau, `a=0 lambda=${lambda}: Mino time`).toBeLessThan(1e-3);
      expect(
        Math.abs(P.dazSing - f.dazSing) / Math.abs(f.dazSing),
        `a=0 lambda=${lambda}: azimuth swing`
      ).toBeLessThan(1e-3);
    }
    expect(axisPassage(rayPotentials(0, 12, 0), 0, 1e-2).dazSing).toBeCloseTo(Math.PI, 12);
  });

  /**
   * Slice 12, test 4: the passage is refused for a ray that leaves first.
   *
   * `a=0.9 leaves before the pole` is inbound in u with a closest approach of
   * 4e-35 — it would reach the pole — but it is at r = 11.7 heading out and
   * crosses the escape radius at very nearly the same Mino time. Jumping it
   * through a crossing that never happens is 14 deg wrong, so the trial has to
   * refuse it. Asserted at a WIDE trigger, because that is the setting where
   * the situation is reachable at all; a guard that refused everything would
   * fail the companion assertion below.
   */
  it("refuses the passage for a ray that escapes before reaching the pole", () => {
    const wide = { axisV: 3e-2 };
    for (const c of cases.filter((x) => x.noPassage)) {
      const res = continueToEscape(c.handoff, c.C, c.a, wide);
      expect(axisApproach(c.C, c.a), `${c.tag}: fixture is not near-polar`).toBeLessThan(1e-4);
      expect(c.handoff.r, `${c.tag}: fixture is not far out`).toBeGreaterThan(8);
      expect(res.passages, `${c.tag}: took a passage it should have refused`).toBe(0);
      expect(angleDeg(res.dir, c.refOwn.dir), `${c.tag}: direction`).toBeLessThan(0.05);
    }
    // and the refusal is not blanket: the pole-crossers still take theirs
    for (const c of cases.filter((x) => x.tag.includes("over the pole"))) {
      expect(
        continueToEscape(c.handoff, c.C, c.a, wide).passages,
        `${c.tag}: refused a passage it needs`
      ).toBeGreaterThan(0);
    }
  });

  /**
   * Slice 12, test 5: the cap on how fast 1 - u^2 may fall is load-bearing.
   *
   * Without it a single step goes from above the trigger to past the turning
   * point, the trigger never fires, and the ray reflects without its half-turn.
   * A guard nobody can make fail is not a test, so this one relaxes it and
   * asserts the answer gets materially worse — measured 1.3e-5 deg against
   * 1.8e-2 on the a=0.9 fixture just inside the trigger, a factor of 1300.
   */
  it("gets materially worse when the cap on the fall in 1 - u^2 is relaxed", () => {
    let bestRatio = 0;
    for (const c of cases) {
      const capped = angleDeg(continueToEscape(c.handoff, c.C, c.a).dir, c.refOwn.dir);
      const loose = angleDeg(
        continueToEscape(c.handoff, c.C, c.a, { vFall: 1e9 }).dir,
        c.refOwn.dir
      );
      bestRatio = Math.max(bestRatio, loose / Math.max(capped, 1e-12));
    }
    expect(bestRatio, "relaxing the v-fall cap changed nothing — is it wired up?").toBeGreaterThan(100);
    expect(MINO_V_FALL).toBeLessThan(1);
  });

  /**
   * Slice 12, test 6: rays that never come near the axis are untouched.
   *
   * The passage is new code on a shared path, and the v-fall cap is a new bound
   * on EVERY step. Against the same run with the trigger switched off and the
   * cap removed, two claims, and they are deliberately different strengths
   * because the measurements are:
   *
   * - a ray whose closest approach exceeds 0.1 is **bit-identical** in step
   *   count and moves at most 1.2e-6 deg;
   * - a ray between the trigger and 0.1 comes near enough for the cap to bind,
   *   so it moves — by at most 4.4e-5 deg and 4 steps on the fixtures here,
   *   which is a hundred times smaller than the error it already carries.
   *
   * The wider version of the first claim: 1255 band rays at 48 cameras, worst
   * 4.0e-6 deg, no step count changing on any of them.
   */
  it("leaves rays away from the spin axis where they were", () => {
    let worst = 0;
    for (const c of cases) {
      const vmin = axisApproach(c.C, c.a);
      if (vmin < MINO_AXIS_V) continue;
      const now = continueToEscape(c.handoff, c.C, c.a);
      const before = continueToEscape(c.handoff, c.C, c.a, { axisV: 0, vFall: 1e9 });
      expect(now.passages, `${c.tag}: took a passage it cannot reach`).toBe(0);
      const d = angleDeg(now.dir, before.dir);
      expect(d, `${c.tag}: direction moved`).toBeLessThan(1e-4);
      if (vmin > 0.1) {
        expect(now.steps, `${c.tag}: step count moved`).toBe(before.steps);
        expect(d, `${c.tag}: moved despite being far from the axis`).toBeLessThan(1e-5);
      }
      worst = Math.max(worst, d);
    }
    expect(worst).toBeLessThan(1e-4);
  });

  /**
   * axisApproach is the turning point the passage is built around, so it is
   * checked against the potential it claims to describe, and against the copy
   * axisPassage derives from the same B and sqrt(D) it needs anyway.
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
      // axisPassage derives the same root from its own B and sqrt(D); the two
      // must not be allowed to drift apart
      expect(axisPassage(C, a, Math.min(2 * v, 0.5)).vmin, `a=${a}: passage disagrees`).toBeCloseTo(v, 14);
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
   * looking like a physics bug rather than a budget one. Slice 11 set it from a
   * sweep whose worst ray was 786; slice 12's wider sweep found an ordinary
   * deep-band ray needing 1053 and two pixels clipping at the old cap of 1024,
   * which is why the constant moved and why this asserts against 1053.
   */
  it("finishes well inside MINO_MAX_STEPS", () => {
    let worst = 0;
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a);
      expect(res.capped, `${c.tag}: continuation hit its cap`).toBe(false);
      worst = Math.max(worst, res.steps);
    }
    expect(worst).toBeLessThan(MINO_MAX_STEPS * 0.75);
    expect(MINO_MAX_STEPS).toBeGreaterThan(1053);
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

/**
 * Slice 13: the light a band ray collects after the march gives up.
 *
 * A ray still winding at the photon shell goes on crossing the equatorial
 * plane, and every one of those crossings is a pass through the accretion disk
 * that nothing was shading. Hurdle H1 predicted a divergent series that would
 * have to be summed in closed form; the measurements say otherwise, because
 * the hovering crossings land at the photon orbit and that is INSIDE the disk's
 * inner edge at low spin (r = 3 against an ISCO of 6 at a = 0). What actually
 * reaches the disk is a handful of outbound crossings — one, two or three per
 * pixel — which the loop already computes as the places `u` changes sign.
 *
 * So the claims here are not about a summation. They are that the crossings
 * are the SAME ones a converged march makes, at the same radii, with the same
 * shift factors, and that the covariant momentum rebuilt for them is the
 * march's own.
 */
describe("equatorial crossings during the continuation (slice 13)", () => {
  /**
   * The reconstruction, at the one state both sides know.
   *
   * `covariantMomentum` inverts a five-scalar separated state back into the
   * (m_t, mv) the shading wants, and the handoff is where that can be judged:
   * the march arrived there carrying its own mv. Agreement is expected at the
   * march's DRIFT, not to machine precision — `minoStateAt` deliberately
   * re-projects the momenta onto sqrt(R) and sqrt(U) with launch constants that
   * never drifted, so an exact match would mean the re-projection did nothing.
   * The rebuilt momentum being null to 1e-12 while the march's is not is the
   * same fact from the other side.
   */
  it("rebuilds the march's own covariant momentum at the handoff", () => {
    let worst = 0;
    for (const c of cases) {
      const { pos, mv } = covariantMomentum(c.handoff, c.C, c.a, c.marchMt);
      const mag = Math.hypot(c.marchMv[0], c.marchMv[1], c.marchMv[2]);
      const d = Math.hypot(mv[0] - c.marchMv[0], mv[1] - c.marchMv[1], mv[2] - c.marchMv[2]) / mag;
      expect(d, `${c.tag}: rebuilt mv`).toBeLessThan(3e-3);
      // and it is exactly null, which is what the march's drift costs it
      expect(Math.abs(hamiltonian(pos, c.a, c.marchMt, mv)), `${c.tag}: not null`).toBeLessThan(1e-12);
      worst = Math.max(worst, d);
    }
    // Measured 1.5e-4 over a full-frame sweep at a = 0.9 and a = 0.998. It is
    // asserted from BELOW as well: a reconstruction that agreed to machine
    // precision would mean minoStateAt's re-projection had stopped happening.
    expect(worst).toBeGreaterThan(1e-6);
  });

  /**
   * The slice's acceptance test: the crossings against a march 50x finer, run
   * from the SAME re-projected state, so the two lists are one-to-one with no
   * prefix to line up. `refOwn` is that march.
   *
   * Not one fixture gains or loses a crossing, over 22 of them: worst radius
   * 1.6e-4 of itself, worst shift factor 1.6e-5, worst world position 2.4e-3.
   * A brightness that goes as the fourth power of the shift moves by 1e-4 of
   * itself on that, which is four orders under the turbulence the same
   * crossing is multiplied by.
   *
   * The position tolerance is the loosest because most of that gap is
   * azimuthal — these rays have swept several turns by then — and the disk's
   * turbulence is the only thing that reads the azimuth.
   *
   * Against `traceRayKerr` at 400,000 steps the same comparison reads 2.1e-3
   * in radius, thirteen times worse. That is the COARSE march being wrong, not
   * the continuation: `marchRefined` exists because the renderer's own
   * stepLength does not converge on near-critical rays, and a slice measured
   * against it would have set its tolerances by the reference's error.
   */
  it("finds the same equatorial crossings a refined march does", () => {
    let seen = 0;
    let worstR = 0;
    let worstG = 0;
    let worstPos = 0;
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe });
      expect(res.crossings.length, `${c.tag}: crossing count`).toBe(c.refOwn.crossings.length);
      for (let i = 0; i < res.crossings.length; i++) {
        const got = res.crossings[i];
        const want = c.refOwn.crossings[i];
        seen++;
        worstR = Math.max(worstR, Math.abs(got.r - want.r) / want.r);
        worstG = Math.max(worstG, Math.abs(got.g - want.g) / Math.abs(want.g));
        worstPos = Math.max(
          worstPos,
          Math.hypot(got.pos[0] - want.pos[0], got.pos[1] - want.pos[1], got.pos[2] - want.pos[2])
        );
      }
    }
    expect(seen, "no fixture crossed the equator at all").toBeGreaterThan(20);
    expect(worstR, `worst dr/r ${worstR}`).toBeLessThan(1e-3);
    expect(worstG, `worst dg/g ${worstG}`).toBeLessThan(1e-4);
    expect(worstPos, `worst position gap ${worstPos}`).toBeLessThan(2e-2);
  });

  /**
   * A crossing is defined to be IN the plane, and the renderer's own radius
   * reconstruction has to agree. `u` is snapped to zero after the refinement
   * sub-step for exactly this: the disk shader recovers rc from the world
   * point as rc^2 = |pos.xz|^2 - a^2, and that must return the r the shift
   * factor was evaluated at, not nearly.
   */
  it("puts each crossing exactly in the equatorial plane", () => {
    for (const c of cases) {
      for (const x of continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe }).crossings) {
        expect(x.pos[1], `${c.tag}: off the plane`).toBe(0);
        const rc = Math.sqrt(x.pos[0] * x.pos[0] + x.pos[2] * x.pos[2] - c.a * c.a);
        expect(rc, `${c.tag}: radius round-trip`).toBeCloseTo(x.r, 9);
        expect(x.g, `${c.tag}: shift factor`).toBe(diskShift(x.r, c.a, c.mtRe, -c.C.lambda * c.mtRe));
      }
    }
  });

  /**
   * Slice 12 jumps the whole polar passage near the spin axis in closed form,
   * which is the one stretch of the continuation where `u` is not looked at
   * step by step. It cannot hide an equatorial crossing, and the reason is
   * structural rather than lucky: a passage fires only at 1 - u^2 < MINO_AXIS_V
   * and v only falls further inside it, so |u| stays above 0.998 throughout
   * while a crossing needs u = 0.
   *
   * Asserted rather than argued, on the fixtures that really take a passage —
   * and the count test above already runs on those same rays against a march
   * that steps through the pole rather than jumping it.
   */
  it("cannot hide a crossing inside an axis passage", () => {
    let poled = 0;
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe });
      if (res.passages === 0) continue;
      poled++;
      const vmin = axisApproach(c.C, c.a);
      expect(vmin, `${c.tag}: passage reaches below the trigger`).toBeLessThan(MINO_AXIS_V);
      // |u| = sqrt(1 - v) >= sqrt(1 - MINO_AXIS_V) for the whole jump
      expect(Math.sqrt(1 - MINO_AXIS_V)).toBeGreaterThan(0.998);
    }
    expect(poled, "no fixture took a passage; the claim is untested").toBeGreaterThan(0);
  });

  /**
   * Without the march's energy there is nothing to collect. The separated
   * system knows lambda and q, which are quotients — the normalization drops
   * out of them — so a shift factor built without m_t would be wrong by an
   * unknown constant. Silence is the honest answer, and it keeps every caller
   * that only wants a direction (the ladder's winding, band.mjs's hairline
   * scan) paying nothing for this slice.
   */
  it("collects nothing without the march's energy", () => {
    for (const c of cases) {
      expect(continueToEscape(c.handoff, c.C, c.a).crossings, `${c.tag}`).toEqual([]);
    }
  });

  /**
   * The refinement sub-step is charged against MINO_MAX_STEPS, so the budget
   * has to hold with crossings ON — which is how the renderer runs whenever the
   * disk is drawn. The ladder's magenta means "the continuation spent its
   * budget" and nothing else, and slice 12 was already bitten once by a cap
   * that clipped; a slice that quietly ate the headroom would resurrect that
   * band looking like a physics bug.
   */
  it("still finishes well inside MINO_MAX_STEPS with crossings on", () => {
    let worst = 0;
    let extra = 0;
    for (const c of cases) {
      const on = continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe });
      const off = continueToEscape(c.handoff, c.C, c.a);
      expect(on.capped, `${c.tag}: hit its cap`).toBe(false);
      // exactly one extra step per crossing, which is what makes the GLSL
      // mirror's budget predictable from the CPU's
      expect(on.steps - off.steps, `${c.tag}: unexpected extra steps`).toBe(on.crossings.length);
      worst = Math.max(worst, on.steps);
      extra = Math.max(extra, on.steps - off.steps);
    }
    expect(worst).toBeLessThan(MINO_MAX_STEPS * 0.75);
    expect(extra).toBeLessThan(8);
  });

  /**
   * The direction and the winding are the previous two slices' claims, and this
   * one must not move them: the crossings are read out of the trajectory, not
   * imposed on it. The refinement sub-step starts from the pre-step state and
   * its result is discarded, so this is a structural claim, asserted because a
   * future edit could easily make it false by stepping `s` through the
   * crossing instead.
   */
  it("does not move the ray it now reads the disk from", () => {
    for (const c of cases) {
      const on = continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe });
      const off = continueToEscape(c.handoff, c.C, c.a);
      expect(on.dir, `${c.tag}: direction`).toEqual(off.dir);
      expect(on.swept, `${c.tag}: winding`).toBe(off.swept);
      expect(on.passages, `${c.tag}: passages`).toBe(off.passages);
    }
  });
});

/**
 * Volumetric matter along the continuation (slice 18).
 *
 * The disk is shaded at CROSSINGS, which are events; the stars, the jet and the
 * TDE debris are shaded along SEGMENTS, because they are volumes with no
 * surface for a ray to cross. So what the renderer needs from the continuation
 * is not another event list but the path itself, and what these tests judge is
 * that path — where it goes, whether it is really this ray's, and whether a
 * straight chord between two of its samples is a fair stand-in for the curve
 * between them.
 *
 * The emitters themselves stay untested here, deliberately: they are fbm noise,
 * gaussian blobs and a beaming clamp, they exist only in GLSL, and
 * `npm run band` is what proves their light reaches the screen.
 */
describe("volumetric matter along the continuation (slice 18)", () => {
  const pathOf = (c: (typeof cases)[number]): MinoSample[] =>
    continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe, path: true }).path;

  /**
   * Both gates, for slice 13's reason: a path costs a `covariantMomentum` per
   * point, and the momentum on it only means anything in the march's energy
   * normalization. Handing back positions with momenta of an unknown scale
   * would beam every emitter by an unknown constant, which is worse than not
   * beaming them at all.
   */
  it("collects nothing unasked, and nothing without the march's energy", () => {
    for (const c of cases) {
      expect(continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe }).path).toHaveLength(0);
      expect(continueToEscape(c.handoff, c.C, c.a, { path: true }).path).toHaveLength(0);
      expect(pathOf(c).length, `${c.tag}: asked and got nothing`).toBeGreaterThan(20);
    }
  });

  /**
   * There is no seam at the handoff, and this is what says so.
   *
   * `minoStateAt` re-projects the MOMENTA onto sqrt(R) and sqrt(U) with launch
   * constants, but it reads r, u and az straight off the march's position, and
   * `minoToCartesian` inverts that map exactly. So the march's last segment ends
   * at the same point the first continuation segment begins at — measured
   * 4.2e-15 at worst — and neither a gap to bridge nor an overlap to
   * double-count exists. Asserted so that nobody later "fixes" a seam that is
   * not there.
   */
  it("starts exactly where the march stopped", () => {
    let worst = 0;
    for (const c of cases) {
      const p0 = pathOf(c)[0].pos;
      worst = Math.max(
        worst,
        Math.hypot(p0[0] - c.marchPos[0], p0[1] - c.marchPos[1], p0[2] - c.marchPos[2])
      );
    }
    expect(worst, `worst handoff gap ${worst}`).toBeLessThan(1e-12);
  });

  /**
   * Every sample is a point of THIS geodesic, momentum included.
   *
   * Cheap and strict: lambda and q are recovered from (pos, mv) alone, by the
   * same `rayConstants` the launch used, and they have to come back as the
   * constants the continuation was handed. A misplaced sample, a momentum
   * rebuilt on the wrong root of the null condition, or a scale lost in the
   * lowering all move them, and nothing about the emitters has to be involved
   * for it to bite.
   *
   * The axis-passage apexes are the one exclusion, and they are excluded
   * because they are the documented exception rather than to make this pass:
   * that sample deliberately carries the passage EXIT's momentum at the apex's
   * position, so (pos, mv) is not a matched pair there and this check reads
   * 0.115 on it. What they are instead is the closest approach to the spin
   * axis, and the test below asserts exactly that.
   */
  it("puts every sample on this ray, with this ray's momentum", () => {
    let worstC = 0;
    let worstH = 0;
    for (const c of cases) {
      for (const s of pathOf(c)) {
        if (s.axis) continue;
        const m: V4 = [c.mtRe, s.mv[0], s.mv[1], s.mv[2]];
        const rc = rayConstants(s.pos, m, c.a);
        const rel = (x: number, y: number) => Math.abs(x - y) / Math.max(Math.abs(y), 1e-3);
        worstC = Math.max(worstC, rel(rc.lambda, c.C.lambda), rel(rc.q, c.C.q));
        // Relative to |m|^2, which is the scale of the quadratic form being
        // evaluated: the momentum grows like r^2 on the way out, so an absolute
        // threshold would be a different test at r = 3 and at r = 64.
        worstH = Math.max(
          worstH,
          Math.abs(hamiltonian(s.pos, c.a, c.mtRe, s.mv)) /
            (c.mtRe * c.mtRe + s.mv[0] * s.mv[0] + s.mv[1] * s.mv[1] + s.mv[2] * s.mv[2])
        );
      }
    }
    expect(worstC, `worst constant drift ${worstC}`).toBeLessThan(1e-4);
    expect(worstH, `worst |H|/|m|^2 ${worstH}`).toBeLessThan(1e-12);
  });

  /**
   * The apexes: one per passage, each the closest approach to the spin axis.
   *
   * This is what replaces the constants check on those samples, and it is the
   * property that matters for light. Slice 12 jumps the whole polar passage in
   * closed form; the path across it is a straight line in the tangent plane at
   * the pole, so one chord from entry to exit is 1.1 sqrt(vmin) SHORT of the
   * two through the nearest point. The jet lives on that axis, so a passage
   * that cut the corner would cut it through the brightest structure in the
   * frame — the straight-line control below reads 0 against 5.9 on exactly
   * these rays.
   *
   * "Closest approach" is asserted against the neighbours the renderer actually
   * draws to: the sample before and the sample after.
   */
  it("puts one closest-approach point in each axis passage", () => {
    let seen = 0;
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe, path: true });
      const axis = (p: V3) => Math.hypot(p[0], p[2]);
      const marks = res.path.filter((s) => s.axis).length;
      expect(marks, `${c.tag}: apexes vs passages`).toBe(res.passages);
      for (let i = 0; i < res.path.length; i++) {
        if (!res.path[i].axis) continue;
        expect(i, `${c.tag}: apex with no chord into it`).toBeGreaterThan(0);
        expect(i + 1, `${c.tag}: apex with no chord out of it`).toBeLessThan(res.path.length);
        expect(axis(res.path[i].pos)).toBeLessThan(axis(res.path[i - 1].pos));
        expect(axis(res.path[i].pos)).toBeLessThan(axis(res.path[i + 1].pos));
        seen++;
      }
    }
    expect(seen, "no fixture took an axis passage").toBeGreaterThan(2);
  });

  /**
   * A chord is a fair stand-in for the curve, by the renderer's own standard.
   *
   * `matterSegment` treats each step as a straight segment, and above 2.2 M it
   * splits the jet into two samples rather than one because a single midpoint
   * sample aliases. The march's own steps reach 12 M; the continuation's never
   * reach 2.2, so every segment handed to the emitters is at least as well
   * resolved as the ones the march hands them. Worst measured 1.33 M.
   */
  it("never hands the emitters a longer chord than the march does", () => {
    let worst = 0;
    for (const c of cases) {
      const p = pathOf(c);
      for (let i = 1; i < p.length; i++)
        worst = Math.max(
          worst,
          Math.hypot(
            p[i].pos[0] - p[i - 1].pos[0],
            p[i].pos[1] - p[i - 1].pos[1],
            p[i].pos[2] - p[i - 1].pos[2]
          )
        );
    }
    expect(worst, `worst chord ${worst}`).toBeLessThan(2.2);
  });

  /**
   * Every equatorial crossing is IN the path, so the step it happened in is two
   * segments rather than one.
   *
   * This is compositing order, not geometry: the disk sheet absorbs, so matter
   * on the near side of it has to be added before it dims the light. Integrate
   * the step whole and the near half is painted as though it sat behind a sheet
   * it is in front of.
   */
  it("splits a step at the crossing it straddles", () => {
    let seen = 0;
    for (const c of cases) {
      const res = continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe, path: true });
      let at = 0;
      for (const x of res.crossings) {
        // in the path, and in the order the ray makes them
        const i = res.path.findIndex((s, j) => j >= at && s.pos === x.pos);
        expect(i, `${c.tag}: crossing missing from the path`).toBeGreaterThan(0);
        at = i + 1;
        seen++;
      }
    }
    expect(seen, "no fixture crossed the equator at all").toBeGreaterThan(20);
  });

  /**
   * The acceptance test: the path spends the same length inside the jet as a
   * march 50x finer does, run from the SAME re-projected state so there is no
   * prefix to line up.
   *
   * This is the slice's whole claim reduced to a number. The emitters read the
   * path and nothing else, so a path that goes where the ray goes lights what
   * the ray lights — and length inside the cone is sensitive to the shape of
   * the path AND to its phase along itself, which the direction and winding
   * tests cannot see.
   *
   * Measured over the five fixtures whose continuation reaches the jet at all:
   * 3.784 against 3.789, 5.884/5.884, 5.215/5.208, 1.685/1.683, 17.683/17.684 —
   * worst 1.4e-3 of itself. The other ten never enter the cone from either
   * side, which is its own agreement and is asserted as one.
   */
  it("spends the same length inside the jet as a refined march", () => {
    let lit = 0;
    let worst = 0;
    for (const c of cases) {
      const got = conePath(pathOf(c).map((s) => s.pos));
      const want = c.refOwn.coneLen;
      if (want === 0 && got === 0) continue;
      expect(want, `${c.tag}: only one side reaches the jet`).toBeGreaterThan(0);
      expect(got, `${c.tag}: only one side reaches the jet`).toBeGreaterThan(0);
      lit++;
      worst = Math.max(worst, Math.abs(got - want) / want);
    }
    expect(lit, "no fixture's continuation reaches the jet").toBeGreaterThanOrEqual(4);
    expect(worst, `worst cone length ${worst}`).toBeLessThan(5e-3);
  });

  /**
   * The control, and it is the behaviour this line of slices replaced: before
   * slice 11 an exhausted ray simply went straight on in whatever direction it
   * happened to be pointing. Run that line through the same functional and the
   * agreement above stops looking automatic — the two rays that pass over the
   * pole miss the jet ENTIRELY going straight (0 against 5.9 and 5.2), one
   * spends nine times too long inside it (15.9 against 1.7), and one is 28%
   * short.
   *
   * The fifth is not separated (17.5 against 17.7), and that is honest rather
   * than awkward: that fixture leaves for good almost immediately, so its true
   * path IS nearly straight. Hence a count of fixtures that separate rather
   * than a claim about all of them.
   */
  it("separates from a straight line through the same cone", () => {
    let separated = 0;
    for (const c of cases) {
      const want = c.refOwn.coneLen;
      if (want === 0) continue;
      const { pos, vel } = minoToCartesian(c.handoff, c.C, c.a);
      const n = Math.hypot(vel[0], vel[1], vel[2]) || 1;
      const line: V3[] = [];
      for (let k = 0; Math.hypot(pos[0], pos[1], pos[2]) + 0.05 * k < 64; k++)
        line.push([
          pos[0] + (0.05 * k * vel[0]) / n,
          pos[1] + (0.05 * k * vel[1]) / n,
          pos[2] + (0.05 * k * vel[2]) / n,
        ]);
      if (Math.abs(conePath(line) - want) / want > 0.1) separated++;
    }
    expect(separated, "a straight line reads the same jet as the geodesic").toBeGreaterThanOrEqual(3);
  });

  /**
   * Reading the path does not move the ray it is read from — slice 13's
   * requirement of its crossings, for the same reason: the direction and the
   * winding are what the sky and the ladder are drawn from, and a diagnostic
   * that perturbed them would be paid for in the picture.
   *
   * Exact equality, not a tolerance. `covariantMomentum` is a pure function of a
   * state; if collecting one changed a stepped value at all, that would be a
   * bug rather than a rounding.
   */
  it("does not move the ray it reads the path from", () => {
    for (const c of cases) {
      const off = continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe });
      const on = continueToEscape(c.handoff, c.C, c.a, { mt: c.mtRe, path: true });
      expect(on.steps, `${c.tag}: steps`).toBe(off.steps);
      expect(on.passages, `${c.tag}: passages`).toBe(off.passages);
      expect(on.swept, `${c.tag}: swept`).toBe(off.swept);
      expect(on.dir, `${c.tag}: dir`).toEqual(off.dir);
      expect(on.crossings.length, `${c.tag}: crossings`).toBe(off.crossings.length);
    }
  });
});
