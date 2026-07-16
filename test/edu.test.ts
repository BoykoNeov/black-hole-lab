import { describe, expect, it } from "vitest";
import { cameraBasis } from "../src/camera";
import { buildStaticTetrad, iscoRadius, ksRadius } from "../src/kerr";
import { circRate, projectToScreen, staticRate } from "../src/edu";
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
