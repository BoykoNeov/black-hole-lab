import { describe, expect, it } from "vitest";
import { cameraBasis } from "../src/camera";
import { projectToScreen } from "../src/edu";
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
