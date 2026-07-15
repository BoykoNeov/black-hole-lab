import { describe, it, expect } from "vitest";
import {
  B_CRIT,
  impactParameter,
  thetaCrit,
  traceRay,
  buildLensTable,
} from "../src/lens";

describe("Schwarzschild lensing", () => {
  it("reproduces the weak-field deflection 4M/b for a distant ray", () => {
    const r0 = 2000;
    const b = 50;
    const theta = Math.asin((b * Math.sqrt(1 - 2 / r0)) / r0);
    const res = traceRay(r0, theta);
    expect(res.captured).toBe(false);
    const flat = Math.PI - theta;
    const deflection = res.psi - flat;
    const expected = 4 / b;
    expect(deflection).toBeGreaterThan(expected * 0.85);
    expect(deflection).toBeLessThan(expected * 1.15);
  });

  it("captures rays inside the critical angle and not outside", () => {
    for (const r of [6, 10, 50, 200]) {
      const thc = thetaCrit(r);
      expect(traceRay(r, thc - 1e-3).captured).toBe(true);
      expect(traceRay(r, thc + 1e-3).captured).toBe(false);
    }
  });

  it("critical angle matches b = 3*sqrt(3) M", () => {
    const r = 25;
    const thc = thetaCrit(r);
    expect(impactParameter(r, thc)).toBeCloseTo(B_CRIT, 6);
  });

  it("psi diverges logarithmically at the shadow edge (photon ring)", () => {
    const r = 20;
    const thc = thetaCrit(r);
    const near = traceRay(r, thc + 1e-4).psi;
    const far = traceRay(r, thc + 0.1).psi;
    expect(near).toBeGreaterThan(far + 1.0);
    expect(near).toBeGreaterThan(2 * Math.PI); // winds at least once
  });

  it("psi decreases monotonically with view angle", () => {
    const r = 30;
    const thc = thetaCrit(r);
    let prev = Infinity;
    for (let k = 1; k <= 20; k++) {
      const theta = thc + ((Math.PI - thc) * k) / 21;
      const { psi, captured } = traceRay(r, theta);
      expect(captured).toBe(false);
      expect(psi).toBeLessThan(prev);
      prev = psi;
    }
  });

  it("a ray aimed straight away sees the sky directly behind", () => {
    const res = traceRay(100, Math.PI);
    expect(res.captured).toBe(false);
    expect(res.psi).toBeCloseTo(0, 6);
  });

  it("bakes a table with escaped flags consistent with thetaCrit", () => {
    const t = buildLensTable(4, 64, 5, 100);
    // Column 0 sits essentially at the shadow edge; the last column points
    // directly away from the hole and must always escape with small psi.
    for (let i = 0; i < t.rows; i++) {
      const lastFlag = t.data[(i * t.cols + t.cols - 1) * 2 + 1];
      expect(lastFlag).toBe(1);
      const lastPsi = t.data[(i * t.cols + t.cols - 1) * 2];
      expect(lastPsi).toBeLessThan(0.05);
    }
  });
});
