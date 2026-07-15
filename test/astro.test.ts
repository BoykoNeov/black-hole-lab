import { describe, it, expect } from "vitest";
import {
  KM_PER_MSUN,
  RT_COEF,
  SEC_PER_MSUN,
  bandLabel,
  flareMdotEdd,
  flarePeakEdd,
  hillsMassMsun,
  lengthKm,
  peakTempK,
  tidalRadiusM,
  timeSec,
} from "../src/astro";
import { horizonRadius, iscoRadius } from "../src/kerr";

describe("geometrized-unit conversions", () => {
  it("one solar mass is 1.4766 km and 4.925 microseconds", () => {
    expect(KM_PER_MSUN).toBeCloseTo(1.4766, 3);
    expect(SEC_PER_MSUN * 1e6).toBeCloseTo(4.925, 2);
  });

  it("Sgr A* (4.3e6 Msun) horizon diameter is ~2.5e7 km, M87*'s ~250x bigger", () => {
    const sgra = 2 * 2 * lengthKm(4.3e6); // diameter of r+ = 2M
    expect(sgra / 1e7).toBeCloseTo(2.54, 1);
    expect((2 * 2 * lengthKm(6.5e9)) / sgra).toBeCloseTo(6.5e9 / 4.3e6, 6);
    expect(timeSec(4.3e6)).toBeCloseTo(21.2, 0); // one M of time ~ 21 s
  });
});

describe("mass-coupled disk temperature", () => {
  it("one solar mass at Eddington peaks at ~1.5e7 K (X-ray)", () => {
    expect(peakTempK(1, 1, 6) / 1e7).toBeCloseTo(1.54, 2);
    expect(bandLabel(peakTempK(1, 1, 6))).toBe("X-ray");
  });

  it("scales as M^(-1/4) and mdot^(1/4)", () => {
    const t0 = peakTempK(1e7, 0.1, 6);
    expect(peakTempK(1e11, 0.1, 6) / t0).toBeCloseTo(Math.pow(10, -1), 10);
    expect(peakTempK(1e7, 1, 6) / t0).toBeCloseTo(Math.pow(10, 0.25), 10);
  });

  it("spinning the hole up (smaller ISCO) makes the disk hotter", () => {
    const slow = peakTempK(1e7, 0.1, iscoRadius(0));
    const fast = peakTempK(1e7, 0.1, iscoRadius(0.9));
    expect(fast).toBeGreaterThan(slow * 1.5);
  });

  it("only monster holes glow in the visible: 6.6e10 Msun at 1e-3 Edd", () => {
    const t = peakTempK(6.6e10, 1e-3, 6); // TON 618-scale, starving
    expect(bandLabel(t)).toBe("visible");
    expect(bandLabel(peakTempK(10, 0.1, 6))).toBe("X-ray"); // stellar-mass
  });
});

describe("tidal radius and Hills mass", () => {
  it("r_t of a sun-like star: 4.7e5 M at 1 Msun, ~10 M at 1e7, ~2.2 M at 1e8", () => {
    expect(tidalRadiusM(1)).toBeCloseTo(RT_COEF, 6);
    expect(RT_COEF / 1e5).toBeCloseTo(4.71, 2);
    expect(tidalRadiusM(1e7)).toBeCloseTo(10.15, 1);
    expect(tidalRadiusM(1e8)).toBeCloseTo(2.19, 1);
  });

  it("scales as M^(-2/3)", () => {
    expect(tidalRadiusM(1e9) / tidalRadiusM(1e6)).toBeCloseTo(1e-2, 10);
  });

  it("Hills mass: r_t equals the horizon at ~1.1e8 Msun for a = 0", () => {
    const mh = hillsMassMsun(horizonRadius(0));
    expect(tidalRadiusM(mh)).toBeCloseTo(horizonRadius(0), 8);
    expect(mh / 1e8).toBeCloseTo(1.14, 1);
  });

  it("spin shrinks the horizon and raises the Hills mass", () => {
    const mh0 = hillsMassMsun(horizonRadius(0));
    const mh998 = hillsMassMsun(horizonRadius(0.998));
    expect(mh998).toBeGreaterThan(2 * mh0);
  });
});

describe("TDE fallback flare", () => {
  it("is zero before disruption and rises monotonically to the peak at t0", () => {
    expect(flareMdotEdd(0, 300, 5)).toBe(0);
    expect(flareMdotEdd(-10, 300, 5)).toBe(0);
    let prev = 0;
    for (const t of [30, 90, 150, 210, 270, 300]) {
      const f = flareMdotEdd(t, 300, 5);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(flareMdotEdd(300, 300, 5)).toBeCloseTo(5, 10);
  });

  it("decays as t^(-5/3) after the peak", () => {
    const p = flareMdotEdd(300, 300, 5);
    expect(flareMdotEdd(600, 300, 5) / p).toBeCloseTo(Math.pow(2, -5 / 3), 10);
    expect(flareMdotEdd(3000, 300, 5) / p).toBeCloseTo(Math.pow(10, -5 / 3), 10);
  });

  it("peaks super-Eddington around small holes, feeble around big ones", () => {
    expect(flarePeakEdd(1e6)).toBeGreaterThan(1);
    expect(flarePeakEdd(1e8)).toBeLessThan(1);
    expect(flarePeakEdd(1e6)).toBeGreaterThan(flarePeakEdd(1e7));
  });
});

describe("Wien band labels", () => {
  it("maps temperature to the expected band", () => {
    expect(bandLabel(5e6)).toBe("X-ray");
    expect(bandLabel(5e4)).toBe("ultraviolet");
    expect(bandLabel(6000)).toBe("visible");
    expect(bandLabel(2000)).toBe("infrared");
  });
});
