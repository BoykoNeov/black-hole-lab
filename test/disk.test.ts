import { describe, expect, it } from "vitest";
import {
  R_ISCO,
  R_T_PEAK,
  diskTempProfile,
  gFactor,
  orbitBeta,
  tempPeakRadius,
} from "../src/disk";

describe("circular-orbit kinematics", () => {
  it("ISCO matter moves at exactly half the speed of light", () => {
    expect(orbitBeta(6)).toBeCloseTo(0.5, 12);
  });

  it("orbital speed decreases outward and stays subluminal", () => {
    let prev = orbitBeta(6);
    for (const r of [8, 12, 20, 50, 200]) {
      const b = orbitBeta(r);
      expect(b).toBeLessThan(prev);
      expect(b).toBeGreaterThan(0);
      prev = b;
    }
    expect(orbitBeta(6)).toBeLessThan(1);
  });
});

describe("shift factor g", () => {
  it("face-on emission reproduces the exact result sqrt(1 - 3/r)", () => {
    for (const r of [6, 49 / 6, 10, 25, 100]) {
      expect(gFactor(r, 0)).toBeCloseTo(Math.sqrt(1 - 3 / r), 12);
    }
  });

  it("approaching matter is blueshifted relative to receding matter", () => {
    for (const r of [6, 8, 15]) {
      expect(gFactor(r, 0.7)).toBeGreaterThan(gFactor(r, 0));
      expect(gFactor(r, -0.7)).toBeLessThan(gFactor(r, 0));
    }
  });

  it("edge-on approaching emission at the ISCO beats gravity (net blueshift)", () => {
    // beta = 0.5 at r = 6: Doppler boost outweighs gravitational redshift
    expect(gFactor(6, 1)).toBeGreaterThan(1);
  });
});

describe("disk temperature profile", () => {
  it("is zero at and inside the ISCO (zero-torque boundary)", () => {
    expect(diskTempProfile(R_ISCO)).toBe(0);
    expect(diskTempProfile(4)).toBe(0);
  });

  it("peaks at r = 49/6 with normalized value 1", () => {
    expect(diskTempProfile(R_T_PEAK)).toBeCloseTo(1, 12);
    expect(diskTempProfile(R_T_PEAK)).toBeGreaterThan(diskTempProfile(7.2));
    expect(diskTempProfile(R_T_PEAK)).toBeGreaterThan(diskTempProfile(9.5));
  });

  it("falls off monotonically outside the peak", () => {
    let prev = diskTempProfile(R_T_PEAK);
    for (const r of [10, 14, 20, 40]) {
      const t = diskTempProfile(r);
      expect(t).toBeLessThan(prev);
      prev = t;
    }
  });

  it("follows a spun-down inner edge: zero at the Kerr ISCO, peak at 49/36 isco", () => {
    const isco = 2.32; // a ~ 0.9
    expect(diskTempProfile(isco, isco)).toBe(0);
    expect(diskTempProfile(isco * 0.9, isco)).toBe(0);
    expect(diskTempProfile(tempPeakRadius(isco), isco)).toBeCloseTo(1, 12);
    expect(diskTempProfile(tempPeakRadius(isco) * 0.8, isco)).toBeLessThan(1);
    expect(diskTempProfile(tempPeakRadius(isco) * 1.3, isco)).toBeLessThan(1);
  });
});
