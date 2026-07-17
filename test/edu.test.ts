import { describe, expect, it } from "vitest";
import { cameraBasis } from "../src/camera";
import {
  buildStaticTetrad,
  circEL,
  horizonRadius,
  iscoRadius,
  ksRadius,
  uCircCart,
} from "../src/kerr";
import {
  DOPPLER_R,
  TRAIL_MIN_DT,
  Trail,
  alignmentAngle,
  approachingSign,
  circRate,
  embeddingProfile,
  embeddingZAt,
  equatorialPoint,
  findShadowEdge,
  findShadowEdgeIncremental,
  photonImpactParameter,
  photonOrbitRadius,
  projectToScreen,
  shadowExtremes,
  shadowHorizonRatio,
  staticRate,
  vEff,
} from "../src/edu";
import type { ShadowEdge, V3 } from "../src/edu";

const T = Math.tan((60 * Math.PI) / 360); // tan(fov/2) at fov = 60°

const add = (basis: { pos: V3 }, ...terms: Array<[V3, number]>): V3 => {
  const q: V3 = [...basis.pos];
  for (const [v, s] of terms) {
    q[0] += v[0] * s;
    q[1] += v[1] * s;
    q[2] += v[2] * s;
  }
  return q;
};

describe("projectToScreen", () => {
  // camera on the +z axis looking at the origin: fwd = -z, right = +x, up = +y
  const basis = cameraBasis({ yaw: 0, pitch: 0, dist: 25, fovDeg: 60 });

  it("projects the origin to the exact screen center", () => {
    const p = projectToScreen([0, 0, 0], basis, T, 640, 480);
    expect(p.x).toBeCloseTo(320, 9);
    expect(p.y).toBeCloseTo(240, 9);
    expect(p.visible).toBe(true);
    expect(p.z).toBeCloseTo(25, 9);
  });

  it("maps the top of the view frustum to y = 0 (canvas y flip)", () => {
    const q = add(basis, [basis.fwd, 1], [basis.up, T]);
    const p = projectToScreen(q, basis, T, 640, 480);
    expect(p.x).toBeCloseTo(320, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.visible).toBe(true);
  });

  it("marks points behind the camera as not visible", () => {
    const q = add(basis, [basis.fwd, -1]);
    const p = projectToScreen(q, basis, T, 640, 480);
    expect(p.visible).toBe(false);
    expect(p.z).toBeLessThan(0);
  });

  it("scales the horizontal half-angle by the aspect ratio", () => {
    // at aspect 2 the horizontal frustum edge sits at 2·T off-axis
    const q = add(basis, [basis.fwd, 1], [basis.right, T * 2]);
    const p = projectToScreen(q, basis, T, 200, 100);
    expect(p.x).toBeCloseTo(200, 9);
    expect(p.y).toBeCloseTo(50, 9);
  });

  it("reuses the out parameter without allocating", () => {
    const out = { x: 0, y: 0, z: 0, visible: false };
    const p = projectToScreen([0, 0, 0], basis, T, 640, 480, out);
    expect(p).toBe(out);
    expect(out.x).toBeCloseTo(320, 9);
  });
});

describe("staticRate", () => {
  it("reduces to sqrt(1 - 2/r) in Schwarzschild", () => {
    expect(staticRate([0, 0, 10], 0)).toBeCloseTo(Math.sqrt(1 - 2 / 10), 12);
  });

  it("is the reciprocal of the rendering tetrad's u^t", () => {
    // ties the clock to the same static observer the shader renders from
    for (const [p, a] of [
      [[0, 0, 25], 0],
      [[0, 0, 25], 0.9],
      [[12, 4, -7], 0.5],
    ] as Array<[V3, number]>) {
      const tet = buildStaticTetrad(p, a, [1, 0, 0], [0, 1, 0], [0, 0, -1]);
      expect(staticRate(p, a)).toBeCloseTo(1 / tet.u[0], 12);
    }
  });

  it("slows monotonically toward the hole", () => {
    const r20 = staticRate([20, 0, 0], 0.7);
    const r10 = staticRate([10, 0, 0], 0.7);
    const r5 = staticRate([5, 0, 0], 0.7);
    expect(r20).toBeGreaterThan(r10);
    expect(r10).toBeGreaterThan(r5);
    expect(r5).toBeGreaterThan(0);
  });

  it("returns 0 inside the ergosphere, where no static observer exists", () => {
    // a = 0.9: r+ = 1.436, equatorial ergosphere reaches r = 2. This point
    // has BL r = 1.8 (outside the horizon, dragged), so 1 - f = 1 - 2/1.8
    // is negative and must clamp to 0 rather than produce NaN.
    const p: V3 = [Math.sqrt(1.8 * 1.8 + 0.81), 0, 0];
    expect(ksRadius(p, 0.9)).toBeCloseTo(1.8, 12);
    expect(staticRate(p, 0.9)).toBe(0);
  });
});

describe("circRate", () => {
  it("reduces to sqrt(1 - 3/r) in Schwarzschild", () => {
    expect(circRate(6, 0)).toBeCloseTo(Math.sqrt(0.5), 12);
    expect(circRate(12, 0)).toBeCloseTo(Math.sqrt(1 - 3 / 12), 12);
  });

  it("runs slower than a static clock at the same radius", () => {
    // the orbiter pays velocity dilation on top of the gravitational part
    for (const a of [0, 0.9]) {
      const orbit = circRate(8, a);
      expect(orbit).toBeGreaterThan(0);
      expect(orbit).toBeLessThan(staticRate([8, 0, 0], a));
    }
  });

  it("is finite and sub-luminal at the ISCO", () => {
    for (const a of [0, 0.7, 0.9]) {
      const rate = circRate(iscoRadius(a), a);
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThan(1);
    }
  });
});

describe("vEff", () => {
  it("reduces to the textbook Schwarzschild potential at a = 0", () => {
    for (const r of [4, 6, 10, 20]) {
      for (const L of [2, 3.4641, 4.5]) {
        expect(vEff(r, L, 0)).toBeCloseTo(
          Math.sqrt((1 - 2 / r) * (1 + (L * L) / (r * r))),
          12
        );
      }
    }
  });

  it("puts a circular orbit at a stationary point with its own E and L", () => {
    // the oracle test: circEL is the independent closed form, so agreement
    // pins both the potential's value and its shape at every spin
    const h = 1e-5;
    for (const a of [0, 0.7, 0.9]) {
      for (const rc of [iscoRadius(a), 8, 12]) {
        const { E, L } = circEL(rc, a);
        expect(vEff(rc, L, a)).toBeCloseTo(E, 8);
        const slope = (vEff(rc + h, L, a) - vEff(rc - h, L, a)) / (2 * h);
        expect(slope).toBeCloseTo(0, 5);
      }
    }
  });

  it("makes the Schwarzschild ISCO marginally stable", () => {
    const L = 2 * Math.sqrt(3); // Schwarzschild ISCO angular momentum
    expect(vEff(6, L, 0)).toBeCloseTo(Math.sqrt(8 / 9), 9);
    // the minimum and maximum merge at r = 6: V'' = 0 as well as V' = 0
    const h = 1e-3;
    const d2 = (vEff(6 + h, L, 0) - 2 * vEff(6, L, 0) + vEff(6 - h, L, 0)) / (h * h);
    expect(d2).toBeCloseTo(0, 6);
  });
});

describe("photonOrbitRadius", () => {
  it("matches the known closed-form values", () => {
    expect(photonOrbitRadius(0, true)).toBeCloseTo(3, 12);
    expect(photonOrbitRadius(0, false)).toBeCloseTo(3, 12);
    expect(photonOrbitRadius(1, true)).toBeCloseTo(1, 12);
    expect(photonOrbitRadius(1, false)).toBeCloseTo(4, 12);
    expect(photonOrbitRadius(0.9, true)).toBeCloseTo(1.5578, 3);
  });

  it("is dragged inward when prograde and outward when retrograde", () => {
    expect(photonOrbitRadius(0.5, true)).toBeLessThan(3);
    expect(photonOrbitRadius(0.5, false)).toBeGreaterThan(3);
  });
});

describe("photonImpactParameter", () => {
  it("matches the known closed-form values", () => {
    // a = 0: both orbits sit at r = 3 with the Schwarzschild b_c = 3√3
    expect(photonImpactParameter(0, true)).toBeCloseTo(3 * Math.sqrt(3), 12);
    expect(photonImpactParameter(0, false)).toBeCloseTo(-3 * Math.sqrt(3), 12);
    // a = 1: the extremal limits, +2 prograde and -7 retrograde
    expect(photonImpactParameter(1, true)).toBeCloseTo(2, 12);
    expect(photonImpactParameter(1, false)).toBeCloseTo(-7, 12);
  });

  it("stays finite where the prograde orbit crosses r = 2", () => {
    // At a = 1/√2 the prograde orbit sits exactly at r = 2, where the
    // unrationalized b = (r√Δ − 2a)/(r − 2) is 0/0. b = 5/√2 there.
    const a = 1 / Math.sqrt(2);
    expect(photonOrbitRadius(a, true)).toBeCloseTo(2, 12);
    expect(photonImpactParameter(a, true)).toBeCloseTo(5 / Math.sqrt(2), 12);
  });

  it("squeezes the prograde side harder than it pushes the retrograde out", () => {
    // The asymmetry that makes the shadow a D rather than an offset circle:
    // measured off the a = 0 value, the prograde side comes in ~1.7x further
    // than the retrograde side goes out.
    const bc = 3 * Math.sqrt(3);
    const bp = photonImpactParameter(0.998, true);
    const br = photonImpactParameter(0.998, false);
    expect(bc - bp).toBeGreaterThan(1.5 * (Math.abs(br) - bc));
  });
});

describe("shadowHorizonRatio", () => {
  it("is 1.5√3 at a = 0 and 4.5 at a = 1", () => {
    // a = 0: width 6√3 over the horizon's diameter 4 — the textbook 2.6×
    expect(shadowHorizonRatio(0)).toBeCloseTo(1.5 * Math.sqrt(3), 12);
    expect(shadowHorizonRatio(0)).toBeCloseTo(2.598, 3);
    // a = 1: width (2 + 7) over 2
    expect(shadowHorizonRatio(1)).toBeCloseTo(4.5, 12);
  });

  it("climbs monotonically with spin", () => {
    let prev = -Infinity;
    for (let k = 0; k <= 40; k++) {
      const ratio = shadowHorizonRatio(k / 40);
      expect(ratio).toBeGreaterThan(prev);
      prev = ratio;
    }
  });

  it("runs away from the flat 2.6 the callout used to quote", () => {
    // The bug this function exists to fix: one number for every spin. It is
    // right at a = 0 and stays right for a while (out to a ≈ 0.3 the shadow
    // and the horizon both barely move, which is why it went unnoticed), but
    // the horizon then shrinks with spin while the shadow does not.
    expect(shadowHorizonRatio(0.9)).toBeGreaterThan(3.3);
    expect(shadowHorizonRatio(0.998)).toBeGreaterThan(4.2);
  });
});

/** z at the profile sample closest to a target radius. */
function nearest(p: { r: Float64Array; z: Float64Array }, target: number): number {
  let best = 0;
  for (let i = 0; i < p.r.length; i++) {
    if (Math.abs(p.r[i] - target) < Math.abs(p.r[best] - target)) best = i;
  }
  return p.z[best];
}

describe("embeddingProfile", () => {
  it("reproduces Flamm's paraboloid at a = 0", () => {
    const p = embeddingProfile(0, 20, 800);
    // g(r) = sqrt(2) is constant at a = 0, so splitting the (r-r+)^(-1/2)
    // factor off makes the quadrature exact — every sample, not just a spot
    // check, must land on sqrt(8(r-2)).
    for (let i = 0; i < p.r.length; i++) {
      expect(p.z[i]).toBeCloseTo(Math.sqrt(8 * (p.r[i] - 2)), 10);
    }
    // spot checks on the plan's grid: what is left at 800 samples is where
    // the sample sits (r = 4.005, not 4), not how well it is integrated
    expect(Math.abs(nearest(p, 4) - 4)).toBeLessThan(0.01);
    expect(Math.abs(nearest(p, 10) - 8)).toBeLessThan(0.01);
  });

  it("starts exactly at the rim", () => {
    for (const a of [0, 0.5, 0.9, 0.998]) {
      const p = embeddingProfile(a, 20, 400);
      expect(p.r[0]).toBeCloseTo(horizonRadius(a), 12);
      expect(p.z[0]).toBe(0);
      expect(p.r[p.r.length - 1]).toBeCloseTo(20, 12);
    }
  });

  it("rises strictly with r at every spin", () => {
    for (const a of [0, 0.9]) {
      const p = embeddingProfile(a, 20, 400);
      for (let i = 1; i < p.z.length; i++) {
        expect(p.z[i]).toBeGreaterThan(p.z[i - 1]);
      }
    }
  });

  it("makes the throat locally gentler but deeper as spin rises", () => {
    // PLAN-slice-6.md's 6d prose has this backwards ("spin flattens the
    // throat: z at r = 6 for a = 0.9 < z at r = 6 for a = 0"). It conflates
    // slope with height. Both halves below are the same formula the plan
    // gives, and they disagree with its conclusion: the wall at r = 6 does
    // get shallower with spin, but r+ falls from 2 to 1.436, adding range
    // exactly where the integrand diverges — so the funnel reaches deeper.
    const slope = (r: number, a: number) =>
      Math.sqrt((2 * r - a * a) / (r * r - 2 * r + a * a));
    expect(slope(6, 0.9)).toBeLessThan(slope(6, 0));

    const flat = embeddingProfile(0, 20, 800);
    const spun = embeddingProfile(0.9, 20, 800);
    expect(nearest(spun, 6)).toBeGreaterThan(nearest(flat, 6));
  });
});

describe("embeddingZAt", () => {
  const p = embeddingProfile(0, 20, 800);

  it("hits the samples it interpolates between", () => {
    for (const i of [0, 1, 400, 799]) {
      expect(embeddingZAt(p, p.r[i])).toBeCloseTo(p.z[i], 9);
    }
  });

  it("tracks the closed form between samples", () => {
    // linear chords undershoot the sqrt curve, badly only in the first
    // interval where it is vertical — away from the rim it is display-exact
    for (const r of [4.011, 7.3, 12.77, 19.5]) {
      expect(embeddingZAt(p, r)).toBeCloseTo(Math.sqrt(8 * (r - 2)), 3);
    }
  });

  it("clamps outside the sampled range", () => {
    expect(embeddingZAt(p, 1)).toBe(p.z[0]);
    expect(embeddingZAt(p, 1e6)).toBe(p.z[p.z.length - 1]);
  });
});

describe("findShadowEdge", () => {
  it("matches the exact Schwarzschild shadow angle and stays circular", () => {
    // camera exactly as main.ts builds it, generic (off-axis) orientation
    const b = cameraBasis({ yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60 });
    const tet = buildStaticTetrad(b.pos, 0, b.right, b.up, b.fwd);
    const edge = findShadowEdge(b.pos, tet, 0, T, 1, 8);
    expect(edge.valid).toBe(true);
    // For a static observer at r in Schwarzschild the shadow's angular radius
    // obeys sin θ = 3√3 √(1 − 2/r) / r — exact GR, no approximation — and the
    // launch map ties θ to ndc radius s by tan θ = s·tan(fov/2) at aspect 1.
    const sinTh = (3 * Math.sqrt(3) * Math.sqrt(1 - 2 / 25)) / 25;
    const sExp = Math.tan(Math.asin(sinTh)) / T;
    const radii: number[] = [];
    for (let k = 0; k < 8; k++) {
      radii.push(Math.hypot(edge.pts[2 * k], edge.pts[2 * k + 1]));
    }
    for (const s of radii) expect(Math.abs(s - sExp)).toBeLessThan(1e-3);
    // Circularity: the spacetime is spherically symmetric, so any azimuthal
    // spread is numerical — a skewed tetrad or a wrong aspect/ndc map.
    for (const s of radii) expect(Math.abs(s - radii[0])).toBeLessThan(1e-6);
  });

  it("keeps the true angular size at a widescreen aspect", () => {
    // Regression for the app's actual aspect: the outline is an ellipse in
    // ndc (x is squeezed by 1/aspect) but the launch ANGLE at each azimuth is
    // fixed by tan θ = tanHalfFov · hypot(ndcX·aspect, ndcY). Before the
    // integrator's runaway guard, azimuths off the symmetry planes collapsed
    // to spurious inner "escapes" and the outline grew spikes.
    const b = cameraBasis({ yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60 });
    const tet = buildStaticTetrad(b.pos, 0, b.right, b.up, b.fwd);
    const aspect = 1.6;
    const nAz = 48;
    const edge = findShadowEdge(b.pos, tet, 0, T, aspect, nAz);
    expect(edge.valid).toBe(true);
    const sinTh = (3 * Math.sqrt(3) * Math.sqrt(1 - 2 / 25)) / 25;
    const sExp = Math.tan(Math.asin(sinTh)) / T;
    for (let k = 0; k < nAz; k++) {
      const q = Math.hypot(edge.pts[2 * k] * aspect, edge.pts[2 * k + 1]);
      expect(Math.abs(q - sExp)).toBeLessThan(1e-3);
    }
  });

  it("shows the Kerr D-shape: offset in x, still symmetric in y", () => {
    const nAz = 24;
    const b = cameraBasis({ yaw: 0.6, pitch: 0, dist: 25, fovDeg: 60 });
    const tet = buildStaticTetrad(b.pos, 0.9, b.right, b.up, b.fwd);
    const edge = findShadowEdge(b.pos, tet, 0.9, T, 1, nAz);
    expect(edge.valid).toBe(true);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let mean = 0;
    for (let k = 0; k < nAz; k++) {
      const x = edge.pts[2 * k];
      const y = edge.pts[2 * k + 1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      mean += Math.hypot(x, y) / nAz;
    }
    // Frame dragging squeezes the prograde side toward the hole and pushes
    // the retrograde side out, sliding the whole outline off screen center...
    expect(Math.abs(Math.abs(minX) - Math.abs(maxX))).toBeGreaterThan(0.1 * mean);
    // ...while an equatorial view keeps it mirror-symmetric top-to-bottom.
    expect(Math.abs(maxY + minY)).toBeLessThan(0.02 * mean);
  });

  it("degrades to valid=false when the camera looks away from the hole", () => {
    const b = cameraBasis({ yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60 });
    const back: V3 = [-b.fwd[0], -b.fwd[1], -b.fwd[2]];
    const tet = buildStaticTetrad(b.pos, 0.5, b.right, b.up, back);
    const edge = findShadowEdge(b.pos, tet, 0.5, T, 1, 8);
    expect(edge.valid).toBe(false);
  });

  it("computes the same outline incrementally as in one shot", () => {
    // findShadowEdge drains the generator today, but this pins the contract:
    // main.ts's sliced path and the tests must never diverge
    const b = cameraBasis({ yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60 });
    const tet = buildStaticTetrad(b.pos, 0.7, b.right, b.up, b.fwd);
    const oneShot = findShadowEdge(b.pos, tet, 0.7, T, 1, 8);
    const gen = findShadowEdgeIncremental(b.pos, tet, 0.7, T, 1, 8);
    let yields = 0;
    let r = gen.next();
    while (!r.done) {
      yields++;
      r = gen.next();
    }
    // one yield per trace — the slicing granularity main.ts's budget relies
    // on: at least the 16 bisection traces for each of the 8 azimuths
    expect(yields).toBeGreaterThan(8 * 16);
    expect(r.value.valid).toBe(true);
    expect(Array.from(r.value.pts)).toEqual(Array.from(oneShot.pts));
  });

  it("puts its equatorial extremes where photonImpactParameter says", () => {
    // What ties the shadow-edge callout's ratio to the picture: the ratio is
    // analytic (photon-orbit impact parameters), the outline is traced ray by
    // ray, and they have to be the same shadow. b = L/E is conserved along a
    // null geodesic, so a distant camera reads it off the launch angle alone,
    // b = r sinθ/√(1 − 2/r); at r = 300 the frame-dragging correction this
    // drops is O(a/r²) ≈ 1e-5.
    const a = 0.9;
    const dist = 300;
    const b = cameraBasis({ yaw: 0.6, pitch: 0, dist, fovDeg: 60 });
    const tet = buildStaticTetrad(b.pos, a, b.right, b.up, b.fwd);
    // nAz = 4 lands on ψ = 0 and ψ = π exactly. Pitch 0 puts the screen's x
    // axis in the equatorial plane, and the outline's mirror symmetry about
    // that axis puts its x extremes right there.
    const edge = findShadowEdge(b.pos, tet, a, T, 1, 4);
    expect(edge.valid).toBe(true);
    const bOf = (s: number) => (dist * Math.sin(Math.atan(s * T))) / Math.sqrt(1 - 2 / dist);
    const asc = (p: number, q: number) => p - q;
    const traced = [bOf(Math.abs(edge.pts[0])), bOf(Math.abs(edge.pts[4]))].sort(asc);
    // Compared as a set: which screen side is prograde is the D-shape test's
    // business, not this one's.
    const want = [
      photonImpactParameter(a, true),
      Math.abs(photonImpactParameter(a, false)),
    ].sort(asc);
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(traced[i] - want[i]) / want[i]).toBeLessThan(0.01);
    }
  });
});

describe("Trail", () => {
  const out: V3 = [0, 0, 0];
  /** Every sample's t, oldest first. */
  const times = (tr: Trail): number[] => {
    const ts: number[] = [];
    for (let i = 0; i < tr.length; i++) ts.push(tr.at(i, out));
    return ts;
  };

  it("keeps the newest samples and drops the oldest when full", () => {
    const tr = new Trail(4);
    for (let t = 0; t < 6; t++) tr.push([t, 2 * t, 3 * t], t);
    expect(tr.length).toBe(4);
    expect(times(tr)).toEqual([2, 3, 4, 5]);
    // and the positions ride along with their times, in the same order
    expect(tr.at(0, out)).toBe(2);
    expect([...out]).toEqual([2, 4, 6]);
    expect(tr.at(3, out)).toBe(5);
    expect([...out]).toEqual([5, 10, 15]);
    expect(tr.oldestT).toBe(2);
    expect(tr.newestT).toBe(5);
  });

  it("thins samples that arrive closer together than TRAIL_MIN_DT", () => {
    const tr = new Trail(8);
    for (const t of [0, 0.2, 0.4, 0.6]) tr.push([t, 0, 0], t);
    expect(TRAIL_MIN_DT).toBe(0.5);
    expect(times(tr)).toEqual([0, 0.6]);
  });

  it("forgets everything on clear, and takes the next push whenever it comes", () => {
    const tr = new Trail(4);
    for (let t = 0; t < 3; t++) tr.push([t, 0, 0], t);
    tr.clear();
    expect(tr.length).toBe(0);
    expect(tr.newestT).toBe(-Infinity);
    // the thinning clock resets too: a respawned blob's first sample must not
    // be swallowed just because the body it replaced was pushed a moment ago
    tr.push([9, 0, 0], 2.1);
    expect(tr.length).toBe(1);
    expect(tr.at(0, out)).toBe(2.1);
    expect(out[0]).toBe(9);
  });

  it("holds at capacity under sustained pushing", () => {
    const tr = new Trail(128);
    for (let i = 0; i < 10_000; i++) tr.push([i, 0, 0], i);
    expect(tr.length).toBe(128);
    expect(tr.newestT).toBe(9999);
    expect(tr.oldestT).toBe(9999 - 127);
  });

  it("has no span to fade over until it holds two samples", () => {
    // drawTrails normalizes sample age by this span, so an empty or
    // single-sample trail must be recognizable rather than divide by zero
    const tr = new Trail(4);
    expect(tr.newestT - tr.oldestT).toBeNaN(); // -Inf - -Inf, empty
    tr.push([0, 0, 0], 3);
    expect(tr.newestT - tr.oldestT).toBe(0);
    tr.push([1, 0, 0], 4);
    expect(tr.newestT - tr.oldestT).toBe(1);
  });
});

describe("equatorialPoint", () => {
  it("lands where the renderer puts equatorial matter of that BL radius", () => {
    // the oracle: ksRadius is what the shader and every overlay index matter
    // by, so the map r -> world point must invert it exactly
    for (const a of [0, 0.5, 0.998]) {
      for (const r of [2.5, 8, 19]) {
        for (const az of [0, 1.3, -2.2, Math.PI]) {
          expect(ksRadius(equatorialPoint(r, az, a), a)).toBeCloseTo(r, 10);
        }
      }
    }
  });

  it("puts the BL circle at Cartesian radius sqrt(r^2 + a^2), in the disk plane", () => {
    const q = equatorialPoint(8, 0.4, 0.9);
    expect(Math.hypot(q[0], q[1], q[2])).toBeCloseTo(Math.sqrt(64 + 0.81), 12);
    expect(q[1]).toBe(0);
    expect(Math.atan2(q[2], q[0])).toBeCloseTo(0.4, 12);
  });

  it("writes through the out param without allocating", () => {
    const out: V3 = [9, 9, 9];
    expect(equatorialPoint(6, 0, 0, out)).toBe(out);
    expect(out[0]).toBeCloseTo(6, 12);
  });
});

describe("approachingSign", () => {
  /** The expected sign, re-derived from the same oracle at another radius:
   *  the sense of rotation is a property of the spacetime, not of where you
   *  sample it. */
  const fromOracle = (camPos: V3, right: V3, a: number, r: number): number => {
    const az = Math.atan2(right[2], right[0]);
    const q = equatorialPoint(r, az, a);
    const u = uCircCart(r, az, a);
    return Math.sign(
      u[1] * (camPos[0] - q[0]) + u[2] * (camPos[1] - q[1]) + u[3] * (camPos[2] - q[2])
    );
  };

  it("agrees with the oracle sampled at a different radius", () => {
    for (const a of [0, 0.7, 0.998]) {
      for (const yaw of [0, 0.6, 2.5, 4.9]) {
        const b = cameraBasis({ yaw, pitch: 0.15, dist: 25, fovDeg: 60 });
        expect(approachingSign(b.pos, b.right, a)).toBe(fromOracle(b.pos, b.right, a, 10));
        expect(DOPPLER_R).not.toBe(10); // or the check above is vacuous
      }
    }
  });

  it("says the screen's right-hand side recedes, at every camera the app allows", () => {
    // Hand-derived at the canonical camera: at [0,0,25] the basis gives
    // right = +x, and uCircCart runs world azimuth DECREASING, so matter at
    // +x moves toward -z — away from a camera sitting at +z. The bright,
    // beamed lobe is therefore on the LEFT of the screen.
    //
    // That holds for the whole orbit camera, which is the surprise worth
    // pinning: cameraBasis builds right = cross(fwd, +y), giving
    // right = (cos yaw, 0, -sin yaw) at ANY pitch, and the dot product then
    // collapses to -dist·cos(pitch)·u^t·Omega·R < 0. Orbiting to the far side
    // moves camPos and right together, so the two cancel; crossing under the
    // disk re-points `up` instead. (PLAN-slice-6.md's 6g expects a flip at
    // yaw + pi — it does not happen, and physically must not: walking around
    // a carousel never reverses its sense while your head stays aligned with
    // its axis.)
    for (const a of [0, 0.3, 0.9, 0.998]) {
      for (const yaw of [0, 0.6, Math.PI / 2, Math.PI, 3.7, 5.9]) {
        for (const pitch of [0, 0.15, -0.5, 1.2, -1.2]) {
          const b = cameraBasis({ yaw, pitch, dist: 25, fovDeg: 60 });
          expect(approachingSign(b.pos, b.right, a)).toBe(-1);
        }
      }
    }
  });

  it("flips for the opposite side of the disk, and is never 0 in between", () => {
    // The two sides must disagree — mirroring `right` asks about the far one.
    for (const a of [0, 0.9]) {
      const b = cameraBasis({ yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60 });
      const mirrored: V3 = [-b.right[0], -b.right[1], -b.right[2]];
      const s = approachingSign(b.pos, b.right, a);
      expect(Math.abs(s)).toBe(1);
      expect(approachingSign(b.pos, mirrored, a)).toBe(-s);
    }
  });
});

describe("alignmentAngle", () => {
  const cam: V3 = [0, 0, 25];

  it("sees a star dead behind the hole as perfectly aligned", () => {
    const al = alignmentAngle(cam, [0, 0, -10]);
    expect(al.behind).toBe(true);
    expect(al.angle).toBeCloseTo(0, 12);
  });

  it("does not count a star between the camera and the hole", () => {
    // same axis, perfect on-screen alignment, but it lenses nothing
    expect(alignmentAngle(cam, [0, 0, 10]).behind).toBe(false);
  });

  it("measures the miss angle at the camera", () => {
    const al = alignmentAngle(cam, [5, 0, -10]);
    expect(al.behind).toBe(true);
    expect(al.angle).toBeCloseTo(Math.atan(5 / 35), 6);
  });

  it("stays under the ring threshold only while the star is nearly behind", () => {
    // EINSTEIN_ANGLE is 0.06 rad: at 35 M away that is a ~2.1 M miss
    expect(alignmentAngle(cam, [2, 0, -10]).angle).toBeLessThan(0.06);
    expect(alignmentAngle(cam, [2.5, 0, -10]).angle).toBeGreaterThan(0.06);
  });

  it("writes through the out param", () => {
    const out = { angle: 9, behind: false };
    expect(alignmentAngle(cam, [0, 0, -10], out)).toBe(out);
    expect(out.behind).toBe(true);
  });
});

describe("shadowExtremes", () => {
  it("picks out the four extreme samples verbatim", () => {
    const edge: ShadowEdge = {
      pts: Float64Array.from([0.3, 0.1, 0.05, 0.2, -0.5, -0.02, 0.01, -0.4]),
      valid: true,
    };
    const e = shadowExtremes(edge);
    expect([e.leftX, e.leftY]).toEqual([-0.5, -0.02]);
    expect([e.rightX, e.rightY]).toEqual([0.3, 0.1]);
    expect([e.topX, e.topY]).toEqual([0.05, 0.2]);
    expect([e.bottomX, e.bottomY]).toEqual([0.01, -0.4]);
  });

  it("is symmetric on a Schwarzschild outline", () => {
    const b = cameraBasis({ yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60 });
    const tet = buildStaticTetrad(b.pos, 0, b.right, b.up, b.fwd);
    const e = shadowExtremes(findShadowEdge(b.pos, tet, 0, T, 1, 8));
    // no spin, no D-shape: the extremes sit on a circle about ndc (0,0), the
    // centre the callouts scale their anchors out from
    expect(-e.leftX).toBeCloseTo(e.rightX, 6);
    expect(-e.bottomY).toBeCloseTo(e.topY, 6);
    expect(e.rightX).toBeCloseTo(e.topY, 6);
  });

  it("survives an empty outline rather than reading off the end", () => {
    const e = shadowExtremes({ pts: new Float64Array(0), valid: false });
    expect(e.leftX).toBe(0);
    expect(e.topY).toBe(0);
  });
});
