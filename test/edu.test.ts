import { describe, expect, it } from "vitest";
import { cameraBasis } from "../src/camera";
import {
  buildStaticTetrad,
  circEL,
  horizonRadius,
  iscoRadius,
  ksRadius,
} from "../src/kerr";
import {
  circRate,
  embeddingProfile,
  embeddingZAt,
  photonOrbitRadius,
  projectToScreen,
  staticRate,
  vEff,
} from "../src/edu";
import type { V3 } from "../src/edu";

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
