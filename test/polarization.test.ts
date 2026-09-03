import { describe, it, expect } from "vitest";
import {
  buildStaticTetrad,
  gDot,
  ksMetric,
  ksRadius,
  raise,
  rk4Step,
  uCircCart,
  type V3,
  type V4,
} from "../src/kerr";
import {
  cross4,
  diskPolarization,
  emitterPolarization,
  frameDirection,
  photonDirInFrame,
  pixelPolarization,
  scatteringDegree,
  SCATTERING_DEGREE_MAX,
  skyBasis,
  skyLeg,
  skyToScreen,
  solveSky,
  walkerPenrose,
  addCrossing,
  resolveStokes,
  ZERO_STOKES,
} from "../src/polarization";

// ---------------------------------------------------------------------------
// An independent parallel-transport oracle.
//
// The point of this file is to check a CLOSED FORM (the Walker-Penrose
// constant) against actually dragging a vector along a geodesic. So the
// transport must not reuse the analytic metric derivatives kerr.ts's derivs()
// is built from, or a sign error shared by both would cancel and the test
// would pass on a broken formula. These Christoffels come from central
// differences of the exported ksMetric instead: slower, cruder, and
// independent, which is the whole point.
// ---------------------------------------------------------------------------

/** Full covariant metric g_munu at p, from the exported Kerr-Schild pieces. */
function metric4(p: V3, a: number): number[][] {
  const { f, l } = ksMetric(p, a);
  const lc = [1, l[0], l[1], l[2]];
  const eta = [-1, 1, 1, 1];
  const g: number[][] = [];
  for (let i = 0; i < 4; i++) {
    g.push([]);
    for (let j = 0; j < 4; j++) {
      g[i].push((i === j ? eta[i] : 0) + f * lc[i] * lc[j]);
    }
  }
  return g;
}

/** g^munu at p: the exact Kerr-Schild inverse, g^munu = eta^munu - f l^mu l^nu. */
function metricInv4(p: V3, a: number): number[][] {
  const { f, l } = ksMetric(p, a);
  const lu = [-1, l[0], l[1], l[2]];
  const eta = [-1, 1, 1, 1];
  const g: number[][] = [];
  for (let i = 0; i < 4; i++) {
    g.push([]);
    for (let j = 0; j < 4; j++) {
      g[i].push((i === j ? eta[i] : 0) - f * lu[i] * lu[j]);
    }
  }
  return g;
}

/** Christoffels at p by central-differencing metric4 (d/dt vanishes). */
function christoffel(p: V3, a: number): number[][][] {
  const h = 1e-5;
  // dg[lambda][mu][nu]; the metric is stationary, so the t slice is zero
  const dg: number[][][] = [
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [],
    [],
    [],
  ];
  for (let k = 0; k < 3; k++) {
    const pp: V3 = [...p];
    const pm: V3 = [...p];
    pp[k] += h;
    pm[k] -= h;
    const gp = metric4(pp, a);
    const gm = metric4(pm, a);
    const d: number[][] = [];
    for (let mu = 0; mu < 4; mu++) {
      d.push([]);
      for (let nu = 0; nu < 4; nu++) d[mu].push((gp[mu][nu] - gm[mu][nu]) / (2 * h));
    }
    dg[k + 1] = d;
  }
  const gi = metricInv4(p, a);
  const G: number[][][] = [];
  for (let m = 0; m < 4; m++) {
    G.push([]);
    for (let al = 0; al < 4; al++) {
      G[m].push([]);
      for (let be = 0; be < 4; be++) {
        let s = 0;
        for (let nu = 0; nu < 4; nu++) {
          s += gi[m][nu] * (dg[al][nu][be] + dg[be][nu][al] - dg[nu][al][be]);
        }
        G[m][al].push(0.5 * s);
      }
    }
  }
  return G;
}

/** dV^mu/dsigma = -Gamma^mu_ab V^a P^b for a parallel-transported vector. */
function transportDeriv(p: V3, a: number, V: V4, P: V4): V4 {
  const G = christoffel(p, a);
  const out: V4 = [0, 0, 0, 0];
  for (let m = 0; m < 4; m++) {
    let s = 0;
    for (let al = 0; al < 4; al++) {
      for (let be = 0; be < 4; be++) s += G[m][al][be] * V[al] * P[be];
    }
    out[m] = -s;
  }
  return out;
}

interface TransportState {
  p: V3;
  mv: V3;
  V: V4;
  sigma: number;
}

/**
 * March a ray and drag V along it. RK4 on V, with the geodesic's own state at
 * the half step and the full step taken from kerr.ts's rk4Step, so the two
 * integrations advance on the same trajectory.
 */
function transportStep(
  st: TransportState,
  a: number,
  mt: number,
  h: number
): TransportState {
  const tangent = (p: V3, mv: V3): V4 => raise(p, a, [mt, mv[0], mv[1], mv[2]]);
  const half = rk4Step(st.p, st.mv, a, mt, h / 2);
  const full = rk4Step(st.p, st.mv, a, mt, h);

  const k1 = transportDeriv(st.p, a, st.V, tangent(st.p, st.mv));
  const V2 = st.V.map((v, i) => v + (h / 2) * k1[i]) as V4;
  const Pm = tangent(half.p, half.mv);
  const k2 = transportDeriv(half.p, a, V2, Pm);
  const V3v = st.V.map((v, i) => v + (h / 2) * k2[i]) as V4;
  const k3 = transportDeriv(half.p, a, V3v, Pm);
  const V4v = st.V.map((v, i) => v + h * k3[i]) as V4;
  const k4 = transportDeriv(full.p, a, V4v, tangent(full.p, full.mv));

  return {
    p: full.p,
    mv: full.mv,
    V: st.V.map(
      (v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
    ) as V4,
    sigma: st.sigma + h,
  };
}

/** Launch momentum and tetrad for a pixel direction n at a camera position. */
function launch(camPos: V3, a: number, n: V3) {
  const fwd: V3 = [-camPos[0], -camPos[1], -camPos[2]];
  const fn = Math.hypot(fwd[0], fwd[1], fwd[2]);
  const f: V3 = [fwd[0] / fn, fwd[1] / fn, fwd[2] / fn];
  // right = up_world x fwd; swap the reference up when the camera looks along
  // the spin axis, which the on-axis test does exactly
  const upW: V3 = Math.abs(f[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const rgt: V3 = [
    upW[1] * f[2] - upW[2] * f[1],
    upW[2] * f[0] - upW[0] * f[2],
    upW[0] * f[1] - upW[1] * f[0],
  ];
  const rn = Math.hypot(rgt[0], rgt[1], rgt[2]) || 1;
  const r: V3 = [rgt[0] / rn, rgt[1] / rn, rgt[2] / rn];
  const up: V3 = [
    f[1] * r[2] - f[2] * r[1],
    f[2] * r[0] - f[0] * r[2],
    f[0] * r[1] - f[1] * r[0],
  ];
  const tet = buildStaticTetrad(camPos, a, r, up, f);
  const mCov: V4 = [0, 1, 2, 3].map(
    (i) =>
      n[0] * tet.rightCov[i] + n[1] * tet.upCov[i] + n[2] * tet.fwdCov[i] - tet.uCov[i]
  ) as V4;
  return { tet, mCov };
}

/** A 4-vector scaled to unit spacelike norm. */
const unit4 = (pos: V3, a: number, v: V4): V4 => {
  const n = 1 / Math.sqrt(gDot(pos, a, v, v));
  return [v[0] * n, v[1] * n, v[2] * n, v[3] * n];
};

const unit = (v: V3): V3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};

describe("Walker-Penrose constant", () => {
  it("is blind to the gauge freedom f -> f + c P", () => {
    const camPos: V3 = [0, 3.0, 12];
    const a = 0.7;
    const { tet, mCov } = launch(camPos, a, unit([0.06, -0.02, 1]));
    const P = raise(camPos, a, mCov);
    const b = skyBasis(camPos, a, tet, unit([0.06, -0.02, 1]));
    const F = skyLeg(tet, b.eH);
    const k0 = walkerPenrose(camPos, a, P, F);
    for (const c of [-3.1, 0.4, 17]) {
      const Fg: V4 = [
        F[0] + c * P[0],
        F[1] + c * P[1],
        F[2] + c * P[2],
        F[3] + c * P[3],
      ];
      const k = walkerPenrose(camPos, a, P, Fg);
      expect(k.k1).toBeCloseTo(k0.k1, 10);
      expect(k.k2).toBeCloseTo(k0.k2, 10);
    }
  });

  it("is bilinear, so the time-reversed tangent only rescales it", () => {
    const camPos: V3 = [1.5, 2.0, 9];
    const a = 0.5;
    const { tet, mCov } = launch(camPos, a, unit([-0.1, 0.05, 1]));
    const P = raise(camPos, a, mCov);
    const Pn: V4 = [-P[0], -P[1], -P[2], -P[3]];
    const F = skyLeg(tet, skyBasis(camPos, a, tet, unit([-0.1, 0.05, 1])).eV);
    const kp = walkerPenrose(camPos, a, P, F);
    const kn = walkerPenrose(camPos, a, Pn, F);
    expect(kn.k1).toBeCloseTo(-kp.k1, 10);
    expect(kn.k2).toBeCloseTo(-kp.k2, 10);
  });

  // The load-bearing check: drag a polarization along a real geodesic with an
  // independently built transport and watch kappa refuse to move.
  it.each([
    { a: 0, label: "a = 0" },
    { a: 0.5, label: "a = 0.5" },
    { a: 0.9, label: "a = 0.9" },
    { a: 0.998, label: "a = 0.998" },
  ])("is conserved along a traced geodesic ($label)", ({ a }) => {
    const camPos: V3 = [0, 4, 14];
    for (const n of [
      unit([0.52, 0.08, 1]),
      unit([-0.61, 0.2, 1]),
      unit([0.15, -0.58, 1]),
    ]) {
      const { tet, mCov } = launch(camPos, a, n);
      const mt = mCov[0];
      let st: TransportState = {
        p: [...camPos],
        mv: [mCov[1], mCov[2], mCov[3]],
        V: skyLeg(tet, skyBasis(camPos, a, tet, n).eH),
        sigma: 0,
      };
      const k0 = walkerPenrose(
        st.p,
        a,
        raise(st.p, a, [mt, ...st.mv] as V4),
        st.V
      );
      const scale = Math.hypot(k0.k1, k0.k2);
      for (let i = 0; i < 1600; i++) {
        const r = ksRadius(st.p, a);
        if (r > 40) break;
        st = transportStep(st, a, mt, 0.05);
      }
      // it actually went somewhere
      expect(st.sigma).toBeGreaterThan(1);
      const P = raise(st.p, a, [mt, ...st.mv] as V4);
      const k = walkerPenrose(st.p, a, P, st.V);
      expect(Math.abs(k.k1 - k0.k1) / scale).toBeLessThan(2e-4);
      expect(Math.abs(k.k2 - k0.k2) / scale).toBeLessThan(2e-4);
      // the transport is an isometry: |V| and V.P are held too
      expect(gDot(st.p, a, st.V, st.V)).toBeCloseTo(1, 3);
      expect(gDot(st.p, a, st.V, P) / Math.hypot(...P)).toBeCloseTo(0, 3);
    }
  });

  it("stays finite for a camera sitting exactly on the spin axis", () => {
    const a = 0.9;
    const camPos: V3 = [0, 15, 0];
    const { tet } = launch(camPos, a, unit([0.44, 0.11, 1]));
    const b = skyBasis(camPos, a, tet, unit([0.44, 0.11, 1]));
    for (const k of [b.kH, b.kV]) {
      expect(Number.isFinite(k.k1)).toBe(true);
      expect(Number.isFinite(k.k2)).toBe(true);
    }
    expect(Math.abs(b.det)).toBeGreaterThan(1e-6);
  });
});

describe("no gravitational Faraday rotation at a = 0", () => {
  // Schwarzschild is static and spherically symmetric: a null geodesic lies in
  // a plane, and a polarization launched normal to that plane stays normal to
  // it. Nothing about the Walker-Penrose machinery is used here — this pins
  // the transport oracle itself, so the conservation test above cannot pass by
  // both halves being wrong the same way.
  it("keeps a polarization normal to the orbital plane", () => {
    const camPos: V3 = [0, 0, 16];
    const n = unit([0.42, 0.0, 1]);
    const { mCov } = launch(camPos, 0, n);
    const mt = mCov[0];
    const P0 = raise(camPos, 0, mCov);
    // plane normal: x cross P (spatial), conserved for a = 0
    const N = unit([
      camPos[1] * P0[3] - camPos[2] * P0[2],
      camPos[2] * P0[1] - camPos[0] * P0[3],
      camPos[0] * P0[2] - camPos[1] * P0[1],
    ]);
    let st: TransportState = {
      p: [...camPos],
      mv: [mCov[1], mCov[2], mCov[3]],
      V: [0, N[0], N[1], N[2]],
      sigma: 0,
    };
    for (let i = 0; i < 1600; i++) {
      if (ksRadius(st.p, 0) > 40) break;
      st = transportStep(st, 0, mt, 0.05);
    }
    const Vs = unit([st.V[1], st.V[2], st.V[3]]);
    expect(Math.abs(st.V[0])).toBeLessThan(1e-6);
    expect(Math.abs(Math.abs(Vs[0] * N[0] + Vs[1] * N[1] + Vs[2] * N[2]) - 1)).toBeLessThan(
      1e-5
    );
  });

  it("keeps a polarization in the orbital plane in it", () => {
    const camPos: V3 = [0, 0, 16];
    const n = unit([0.42, 0.0, 1]);
    const { mCov } = launch(camPos, 0, n);
    const mt = mCov[0];
    const P0 = raise(camPos, 0, mCov);
    const N = unit([
      camPos[1] * P0[3] - camPos[2] * P0[2],
      camPos[2] * P0[1] - camPos[0] * P0[3],
      camPos[0] * P0[2] - camPos[1] * P0[1],
    ]);
    // an in-plane polarization: N x khat, spatial and orthogonal to the ray
    const Ps = unit([P0[1], P0[2], P0[3]]);
    const inPlane = unit([
      N[1] * Ps[2] - N[2] * Ps[1],
      N[2] * Ps[0] - N[0] * Ps[2],
      N[0] * Ps[1] - N[1] * Ps[0],
    ]);
    let st: TransportState = {
      p: [...camPos],
      mv: [mCov[1], mCov[2], mCov[3]],
      V: [0, inPlane[0], inPlane[1], inPlane[2]],
      sigma: 0,
    };
    for (let i = 0; i < 1600; i++) {
      if (ksRadius(st.p, 0) > 40) break;
      st = transportStep(st, 0, mt, 0.05);
    }
    const Vs = unit([st.V[1], st.V[2], st.V[3]]);
    expect(Math.abs(Vs[0] * N[0] + Vs[1] * N[1] + Vs[2] * N[2])).toBeLessThan(1e-5);
  });
});

describe("resolving an emitted polarization on the camera's sky", () => {
  // The end-to-end round trip: a polarization launched at the camera, dragged
  // down the geodesic, read back through its conserved kappa. Recovering the
  // launch components is what makes the closed form safe to mirror in GLSL.
  it.each([
    { a: 0, label: "a = 0" },
    { a: 0.9, label: "a = 0.9" },
  ])("recovers the launch components after a round trip ($label)", ({ a }) => {
    const camPos: V3 = [0, 3, 13];
    const n = unit([0.47, -0.12, 1]);
    const { tet, mCov } = launch(camPos, a, n);
    const mt = mCov[0];
    const basis = skyBasis(camPos, a, tet, n);
    // an arbitrary polarization at the camera, 33 degrees off the H leg
    const c1 = Math.cos(0.5763);
    const c2 = Math.sin(0.5763);
    const F0: V4 = [0, 1, 2, 3].map(
      (i) => c1 * skyLeg(tet, basis.eH)[i] + c2 * skyLeg(tet, basis.eV)[i]
    ) as V4;
    let st: TransportState = {
      p: [...camPos],
      mv: [mCov[1], mCov[2], mCov[3]],
      V: F0,
      sigma: 0,
    };
    for (let i = 0; i < 1600; i++) {
      if (ksRadius(st.p, a) > 40) break;
      st = transportStep(st, a, mt, 0.05);
    }
    const P = raise(st.p, a, [mt, ...st.mv] as V4);
    const k = walkerPenrose(st.p, a, P, st.V);
    const got = solveSky(basis, k);
    expect(got.c1).toBeCloseTo(c1, 3);
    expect(got.c2).toBeCloseTo(c2, 3);
  });

  // c1^2 + c2^2 = 1 is not imposed anywhere: it holds because the map from
  // polarizations to kappa is a similarity at every point, with the same scale
  // at both ends of a geodesic (a unit polarization keeps its length, and
  // kappa keeps its value). Checking it every step is the cheapest statement
  // that the closed form, the basis and the tangent all agree.
  it("returns a unit sky vector for any unit emitted polarization", () => {
    const a = 0.8;
    const camPos: V3 = [0, 2.5, 11];
    const n = unit([-0.75, 0.25, 1]);
    const { tet, mCov } = launch(camPos, a, n);
    const mt = mCov[0];
    const basis = skyBasis(camPos, a, tet, n);
    let st: TransportState = {
      p: [...camPos],
      mv: [mCov[1], mCov[2], mCov[3]],
      V: skyLeg(tet, basis.eV),
      sigma: 0,
    };
    for (let i = 0; i < 2600; i++) {
      if (ksRadius(st.p, a) > 40) break;
      st = transportStep(st, a, mt, 0.02);
      const P = raise(st.p, a, [mt, ...st.mv] as V4);
      const { c1, c2 } = solveSky(basis, walkerPenrose(st.p, a, P, st.V));
      expect(c1 * c1 + c2 * c2).toBeCloseTo(1, 3);
    }
  });
});

describe("emitter-frame helpers", () => {
  // A null tangent AT pos, built the way the emitter sees it: a static frame
  // there, plus a unit spatial direction in that frame.
  function nullAt(pos: V3, a: number, dir: V3) {
    const tet = buildStaticTetrad(pos, a, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const P = [0, 1, 2, 3].map(
      (i) =>
        dir[0] * tet.right[i] + dir[1] * tet.up[i] + dir[2] * tet.fwd[i] + tet.u[i]
    ) as V4;
    return { u: tet.u, P };
  }

  it("splits the photon into u + khat with khat a unit spatial vector", () => {
    const a = 0.6;
    const pos: V3 = [7, 0, 2];
    const { u, P } = nullAt(pos, a, unit([0.3, 0.5, -0.8]));
    expect(gDot(pos, a, P, P)).toBeCloseTo(0, 9);
    const k = photonDirInFrame(pos, a, u, P);
    expect(gDot(pos, a, k, k)).toBeCloseTo(1, 9);
    expect(gDot(pos, a, k, u)).toBeCloseTo(0, 9);
  });

  it("makes a direction transverse to the ray and unit", () => {
    const a = 0.6;
    const pos: V3 = [7, 0, 2];
    const { u, P } = nullAt(pos, a, unit([0.3, 0.5, -0.8]));
    // the disk normal as the emitter sees it: world +y with u projected out
    const d = emitterPolarization(pos, a, u, P, [0, 0, 1, 0])!;
    expect(d).not.toBeNull();
    expect(gDot(pos, a, d, d)).toBeCloseTo(1, 9);
    expect(gDot(pos, a, d, P)).toBeCloseTo(0, 9);
    expect(gDot(pos, a, d, u)).toBeCloseTo(0, 9);
  });

  it("reports a line-of-sight direction as unpolarized rather than inventing one", () => {
    const a = 0.4;
    const pos: V3 = [9, 0, 0];
    const dir = unit([0, 1, 0]);
    const { u, P } = nullAt(pos, a, dir);
    const k = photonDirInFrame(pos, a, u, P);
    // ask to polarize along the line of sight itself: nothing survives
    expect(emitterPolarization(pos, a, u, P, k)).toBeNull();
  });
});

describe("screen projection and Stokes bookkeeping", () => {
  it("projects an on-axis sky vector straight through", () => {
    const n: V3 = [0, 0, 1];
    expect(skyToScreen(n, [1, 0, 0])).toEqual([1, 0]);
    expect(skyToScreen(n, [0, 1, 0])).toEqual([0, 1]);
  });

  it("foreshortens a sky vector tilted toward the camera", () => {
    const n = unit([0.5, 0, 1]);
    const along = unit([1, 0, -0.5]); // perpendicular to n, tilted in depth
    const [dx, dy] = skyToScreen(n, along);
    expect(dy).toBeCloseTo(0, 12);
    // the gnomonic chart stretches the component in the tilt direction
    expect(Math.abs(dx)).toBeGreaterThan(1);
  });

  it("depolarizes two crossings whose planes are 90 degrees apart", () => {
    let s = ZERO_STOKES;
    s = addCrossing(s, 1, 1, 1, 0);
    s = addCrossing(s, 1, 1, 0, 1);
    const basis = {
      eH: [1, 0, 0] as V3,
      eV: [0, 1, 0] as V3,
      kH: { k1: 1, k2: 0 },
      kV: { k1: 0, k2: 1 },
      det: 1,
    };
    expect(resolveStokes(s, basis).degree).toBeCloseTo(0, 12);
  });

  it("keeps the full degree when two crossings agree, and the direction with it", () => {
    let s = ZERO_STOKES;
    const c1 = Math.cos(0.4);
    const c2 = Math.sin(0.4);
    s = addCrossing(s, 2, 0.11, c1, c2);
    s = addCrossing(s, 5, 0.11, c1, c2);
    const basis = {
      eH: [1, 0, 0] as V3,
      eV: [0, 1, 0] as V3,
      kH: { k1: 1, k2: 0 },
      kV: { k1: 0, k2: 1 },
      det: 1,
    };
    const { degree, dir } = resolveStokes(s, basis);
    expect(degree).toBeCloseTo(0.11, 12);
    expect(Math.abs(dir[0] * c1 + dir[1] * c2)).toBeCloseTo(1, 12);
  });

  it("weights a bright crossing over a faint one", () => {
    let s = ZERO_STOKES;
    s = addCrossing(s, 9, 1, 1, 0);
    s = addCrossing(s, 1, 1, 0, 1);
    const basis = {
      eH: [1, 0, 0] as V3,
      eV: [0, 1, 0] as V3,
      kH: { k1: 1, k2: 0 },
      kV: { k1: 0, k2: 1 },
      det: 1,
    };
    const { degree, dir } = resolveStokes(s, basis);
    expect(degree).toBeCloseTo(0.8, 12);
    expect(Math.abs(dir[0])).toBeCloseTo(1, 12);
  });
});

describe("the disk's own polarization (electron scattering)", () => {
  // A photon leaving the sheet at BL radius rc, in the direction dirLocal of
  // the orbiting matter's own frame (built from the disk normal and a leg
  // lying in the surface).
  function nullAtDisk(pos: V3, a: number, rc: number, dirLocal: V3) {
    const az = Math.atan2(pos[2], pos[0]);
    const u = uCircCart(rc, az, a);
    const nrm = frameDirection(pos, a, u, [0, 0, 1, 0]);
    const e1 = frameDirection(pos, a, u, [0, 1, 0, 0]);
    const e2 = unit4(pos, a, cross4(pos, a, u, nrm, e1));
    const k = [0, 1, 2, 3].map(
      (i) => dirLocal[0] * e1[i] + dirLocal[1] * nrm[i] + dirLocal[2] * e2[i]
    ) as V4;
    return { u, k, P: [0, 1, 2, 3].map((i) => u[i] + k[i]) as V4 };
  }

  it("is unpolarized face-on and 11.7% at grazing incidence", () => {
    expect(scatteringDegree(1)).toBeCloseTo(0, 12);
    expect(scatteringDegree(0)).toBeCloseTo(SCATTERING_DEGREE_MAX, 12);
    expect(scatteringDegree(-1)).toBeCloseTo(0, 12); // the sheet's two faces agree
  });

  it("rises monotonically as the view grazes the surface", () => {
    let prev = -1;
    for (let mu = 1; mu >= 0; mu -= 0.05) {
      const d = scatteringDegree(mu);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  it("polarizes parallel to the disk surface, and transverse to the ray", () => {
    const a = 0.7;
    const rc = 9;
    const az = 0.8;
    const R = Math.sqrt(rc * rc + a * a);
    const pos: V3 = [R * Math.cos(az), 0, R * Math.sin(az)];
    // a photon leaving the sheet well off the normal
    const { P } = nullAtDisk(pos, a, rc, unit([0.3, 0.85, -0.43]));
    const got = diskPolarization(pos, a, rc, P)!;
    expect(got).not.toBeNull();
    const u = uCircCart(rc, az, a);
    expect(gDot(pos, a, got.f, got.f)).toBeCloseTo(1, 9);
    expect(gDot(pos, a, got.f, P)).toBeCloseTo(0, 9);
    expect(gDot(pos, a, got.f, u)).toBeCloseTo(0, 9);
    // parallel to the surface: orthogonal to the disk normal as the orbiting
    // matter sees it
    const nrm = frameDirection(pos, a, u, [0, 0, 1, 0]);
    expect(gDot(pos, a, got.f, nrm)).toBeCloseTo(0, 9);
  });

  it("reports light leaving along the normal as unpolarized", () => {
    const a = 0.5;
    const rc = 12;
    const R = Math.sqrt(rc * rc + a * a);
    const pos: V3 = [R, 0, 0];
    const u = uCircCart(rc, 0, a);
    const nrm = frameDirection(pos, a, u, [0, 0, 1, 0]);
    const P: V4 = [
      u[0] + nrm[0],
      u[1] + nrm[1],
      u[2] + nrm[2],
      u[3] + nrm[3],
    ];
    expect(diskPolarization(pos, a, rc, P)).toBeNull();
  });

  it("gives a nearly grazing ray nearly the full 11.7%", () => {
    const a = 0.3;
    const rc = 14;
    const R = Math.sqrt(rc * rc + a * a);
    const pos: V3 = [R, 0, 0];
    const u = uCircCart(rc, 0, a);
    const nrm = frameDirection(pos, a, u, [0, 0, 1, 0]);
    // a direction in the surface, orthogonal to the normal and to u
    const along = frameDirection(pos, a, u, [0, 1, 0, 0]);
    const inSurf = unit4(pos, a, cross4(pos, a, u, nrm, along));
    const k: V4 = [0, 1, 2, 3].map(
      (i) => 0.02 * nrm[i] + Math.sqrt(1 - 0.0004) * inSurf[i]
    ) as V4;
    const P: V4 = [0, 1, 2, 3].map((i) => u[i] + k[i]) as V4;
    const got = diskPolarization(pos, a, rc, P)!;
    expect(got.degree).toBeGreaterThan(0.11);
    expect(got.degree).toBeLessThan(SCATTERING_DEGREE_MAX);
  });
});

describe("one pixel, launch to screen", () => {
  /** Tetrad and pixel launch for a camera at camPos looking at the origin. */
  function view(camPos: V3, a: number) {
    const f = unit([-camPos[0], -camPos[1], -camPos[2]]);
    // a face-on camera looks straight down the spin axis, where the world up
    // is no use as a reference
    const upW: V3 = Math.abs(f[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    const rgt = unit([
      upW[1] * f[2] - upW[2] * f[1],
      upW[2] * f[0] - upW[0] * f[2],
      upW[0] * f[1] - upW[1] * f[0],
    ]);
    const up: V3 = [
      f[1] * rgt[2] - f[2] * rgt[1],
      f[2] * rgt[0] - f[0] * rgt[2],
      f[0] * rgt[1] - f[1] * rgt[0],
    ];
    return buildStaticTetrad(camPos, a, rgt, up, f);
  }

  // THE end-to-end check. Take a real disk crossing, ask it how it emits, and
  // get that polarization to the camera two independent ways: along its
  // conserved kappa, and by dragging it there with the finite-difference
  // transport. Every sign convention in the chain — the azimuth's sense, the
  // Levi-Civita components, the 1-forms, the backward tangent — sits between
  // those two answers, and only the right ones make them agree.
  it.each([
    { a: 0, label: "a = 0" },
    { a: 0.9, label: "a = 0.9" },
  ])("agrees with dragging the polarization to the camera ($label)", ({ a }) => {
    const camPos: V3 = [0, 5, 15];
    const n = unit([0.11, -0.16, 1]);
    const tet = view(camPos, a);
    const mCov: V4 = [0, 1, 2, 3].map(
      (i) =>
        n[0] * tet.rightCov[i] + n[1] * tet.upCov[i] + n[2] * tet.fwdCov[i] - tet.uCov[i]
    ) as V4;
    const mt = mCov[0];
    const basis = skyBasis(camPos, a, tet, n);

    // march to the first equatorial crossing, dragging both sky legs
    const legs = [skyLeg(tet, basis.eH), skyLeg(tet, basis.eV)];
    const carried: V4[] = [];
    let cross: { p: V3; mv: V3 } | null = null;
    for (const leg of legs) {
      let st: TransportState = {
        p: [...camPos],
        mv: [mCov[1], mCov[2], mCov[3]],
        V: leg,
        sigma: 0,
      };
      for (let i = 0; i < 4000; i++) {
        const nxt = transportStep(st, a, mt, 0.01);
        if (st.p[1] * nxt.p[1] < 0) {
          st = nxt;
          break;
        }
        st = nxt;
        if (ksRadius(st.p, a) > 40) break;
      }
      carried.push(st.V);
      cross = { p: st.p, mv: st.mv };
    }
    expect(cross).not.toBeNull();
    const pc = cross!.p;
    const rc = Math.sqrt(Math.max(pc[0] * pc[0] + pc[2] * pc[2] - a * a, 0));
    expect(rc).toBeGreaterThan(3); // it really landed on the disk, not the hole
    const P = raise(pc, a, [mt, cross!.mv[0], cross!.mv[1], cross!.mv[2]]);
    const pol = diskPolarization(pc, a, rc, P)!;
    expect(pol).not.toBeNull();

    // route 1: project the emitted polarization onto the dragged legs
    const byTransport = [
      gDot(pc, a, pol.f, carried[0]),
      gDot(pc, a, pol.f, carried[1]),
    ];
    // route 2: its conserved kappa, resolved on the camera's sky basis
    const k = walkerPenrose(pc, a, P, pol.f);
    const byKappa = solveSky(basis, k);

    // a director: the two routes may disagree by an overall sign
    const sgn = Math.sign(
      byTransport[0] * byKappa.c1 + byTransport[1] * byKappa.c2
    );
    expect(sgn * byKappa.c1).toBeCloseTo(byTransport[0], 3);
    expect(sgn * byKappa.c2).toBeCloseTo(byTransport[1], 3);
  });

  it("leaves a distant face-on view almost unpolarized", () => {
    const a = 0.5;
    const camPos: V3 = [0, 260, 0];
    const tet = view(camPos, a);
    let worst = 0;
    for (const n of [unit([0.04, 0, 1]), unit([0, 0.05, 1]), unit([-0.03, 0.03, 1])]) {
      const got = pixelPolarization(camPos, a, tet, n, { rInner: 6, rOuter: 24 });
      expect(got.crossings).toBeGreaterThan(0);
      worst = Math.max(worst, got.degree);
    }
    // Face-on, light leaves along the disk normal and scattering has no
    // direction to prefer. Not exactly zero, and the residue is physical: the
    // disk's own orbital motion aberrates the emission direction by ~19
    // degrees at these radii, so the matter does not see the ray leaving
    // quite along its normal even when the distant camera does.
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.01);
  });

  it("polarizes a grazing view far more than a face-on one", () => {
    const a = 0.5;
    const n = unit([0.06, 0.0, 1]);
    const faceOn = pixelPolarization(camPos0(260, 0.02), a, view(camPos0(260, 0.02), a), n, {
      rInner: 6,
      rOuter: 24,
    });
    const edgeOn = pixelPolarization(camPos0(260, 1.45), a, view(camPos0(260, 1.45), a), n, {
      rInner: 6,
      rOuter: 24,
    });
    expect(edgeOn.crossings).toBeGreaterThan(0);
    expect(edgeOn.degree).toBeGreaterThan(8 * faceOn.degree);
    expect(edgeOn.degree).toBeLessThan(SCATTERING_DEGREE_MAX);
  });

  /** Camera at distance d, inclination incl from the spin axis. */
  function camPos0(d: number, incl: number): V3 {
    return [0, d * Math.cos(incl), d * Math.sin(incl)];
  }

  // Kerr is symmetric under reflection in its own equatorial plane, and the
  // disk and its rotation are too (the angular velocity is an axial vector, so
  // it survives the reflection). A camera below the disk must therefore see
  // the mirror image of what one above sees — with the vertical flipped, since
  // that reflection turns the camera's up leg over.
  it("mirrors the tick field between a view from above and one from below", () => {
    const a = 0.7;
    const above: V3 = [0, 6, 15];
    const below: V3 = [0, -6, 15];
    const tA = view(above, a);
    const tB = view(below, a);
    let compared = 0;
    for (const [nx, ny] of [
      [0.42, 0.26],
      [-0.51, 0.19],
      [0.24, -0.44],
    ]) {
      const nA = unit([nx, ny, 1]);
      const nB = unit([nx, -ny, 1]);
      const pA = pixelPolarization(above, a, tA, nA, { rInner: 3.5, rOuter: 40 });
      const pB = pixelPolarization(below, a, tB, nB, { rInner: 3.5, rOuter: 40 });
      if (pA.crossings === 0 || pB.crossings === 0) continue;
      compared++;
      expect(pB.degree).toBeCloseTo(pA.degree, 6);
      // the drawn tick is a director, so compare |cos| of the angle between
      // the mirrored screen directions
      const mA: [number, number] = [pA.screen[0], -pA.screen[1]];
      const dot =
        (mA[0] * pB.screen[0] + mA[1] * pB.screen[1]) /
        (Math.hypot(...mA) * Math.hypot(...pB.screen));
      expect(Math.abs(dot)).toBeCloseTo(1, 5);
    }
    expect(compared).toBeGreaterThan(1);
  });

  it("never reports the sky basis as degenerate, the similarity guaranteeing it", () => {
    for (const a of [0, 0.6, 0.998]) {
      for (const camPos of [[0, 12, 0], [0, 0, 12], [0, 9, 9]] as V3[]) {
        const tet = view(camPos, a);
        for (const n of [unit([0.3, 0.2, 1]), unit([-0.4, 0.5, 1])]) {
          const got = pixelPolarization(camPos, a, tet, n, { rInner: 6, rOuter: 24 });
          expect(got.degenerate).toBe(false);
        }
      }
    }
  });
});
