import { describe, it, expect } from "vitest";
import {
  buildStaticTetrad,
  circEL,
  circUt,
  diskShift,
  gDot,
  hamiltonian,
  horizonRadius,
  iscoConstants,
  iscoRadius,
  ksMetric,
  ksRadius,
  lower,
  omegaCirc,
  plungeRates,
  plungeUBL,
  plungeUKS,
  rk4Step,
  traceRayKerr,
  uCircCart,
  uPlungeCart,
  type V3,
  type V4,
} from "../src/kerr";
import { thetaCrit, traceRay } from "../src/lens";

/** Equatorial world position at BL radius r, world azimuth az. */
function eqPos(r: number, az: number, a: number): V3 {
  const R = Math.sqrt(r * r + a * a);
  return [R * Math.cos(az), 0, R * Math.sin(az)];
}

/** Launch momentum for a local view direction d (in tetrad components). */
function launchM(t: ReturnType<typeof buildStaticTetrad>, d: V3): V4 {
  const n = Math.hypot(d[0], d[1], d[2]);
  const [dr, du, df] = [d[0] / n, d[1] / n, d[2] / n];
  const m: V4 = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    m[i] = dr * t.rightCov[i] + du * t.upCov[i] + df * t.fwdCov[i] - t.uCov[i];
  }
  return m;
}

describe("Kerr closed-form orbit physics", () => {
  it("horizon radius: 2 at a=0, 1.8 at a=0.6, 1 at a=1", () => {
    expect(horizonRadius(0)).toBeCloseTo(2, 12);
    expect(horizonRadius(0.6)).toBeCloseTo(1.8, 12);
    expect(horizonRadius(1)).toBeCloseTo(1, 12);
  });

  it("ISCO radius matches Bardeen–Press–Teukolsky values", () => {
    expect(iscoRadius(0)).toBeCloseTo(6, 10);
    expect(iscoRadius(0.5)).toBeCloseTo(4.233, 3);
    expect(iscoRadius(0.998)).toBeCloseTo(1.237, 3);
    let prev = iscoRadius(0);
    for (const a of [0.2, 0.4, 0.6, 0.8, 0.95]) {
      const r = iscoRadius(a);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it("Schwarzschild ISCO constants: E = 2*sqrt(2)/3, L = 2*sqrt(3)", () => {
    const { E, L, r } = iscoConstants(0);
    expect(r).toBeCloseTo(6, 10);
    expect(E).toBeCloseTo((2 * Math.SQRT2) / 3, 10);
    expect(L).toBeCloseTo(2 * Math.sqrt(3), 10);
  });

  it("circular-orbit u^t and Omega reduce to Schwarzschild at a=0", () => {
    for (const r of [6, 8, 15]) {
      expect(circUt(r, 0)).toBeCloseTo(1 / Math.sqrt(1 - 3 / r), 10);
      expect(omegaCirc(r, 0)).toBeCloseTo(Math.pow(r, -1.5), 12);
    }
  });

  it("plunge velocity: u^r = 0 at the ISCO, inward and normalized inside", () => {
    for (const a of [0, 0.6, 0.9]) {
      const { E, L, r: risco } = iscoConstants(a);
      expect(Math.abs(plungeUBL(risco, a, E, L).ur)).toBeLessThan(1e-5);
      const rHor = horizonRadius(a);
      for (const fr of [0.9, 0.6, 0.3]) {
        const r = rHor + 0.05 + (risco - rHor - 0.05) * fr;
        const { ur } = plungeUBL(r, a, E, L);
        expect(ur).toBeLessThan(0);
      }
    }
  });

  it("Schwarzschild plunge u^r matches the closed form", () => {
    const { E, L } = iscoConstants(0);
    const r = 4;
    const expected = -Math.sqrt(E * E - (1 - 2 / r) * (1 + (L * L) / (r * r)));
    expect(plungeUBL(r, 0, E, L).ur).toBeCloseTo(expected, 10);
  });

  it("Kerr–Schild plunge velocity stays regular at the horizon", () => {
    for (const a of [0, 0.9]) {
      const { E, L } = iscoConstants(a);
      const r = horizonRadius(a) + 1e-3;
      const { ut, ur, uphi } = plungeUKS(r, a, E, L);
      expect(Number.isFinite(ut)).toBe(true);
      expect(Math.abs(ut)).toBeLessThan(100);
      expect(ur).toBeLessThan(0);
      expect(Number.isFinite(uphi)).toBe(true);
    }
  });

  it("plunging gas keeps falling and keeps co-rotating (world az decreasing)", () => {
    const a = 0.9;
    const { E, L, r: risco } = iscoConstants(a);
    for (const r of [risco - 0.05, 1.9, horizonRadius(a) + 0.05]) {
      const { drdt, dazdt } = plungeRates(r, a, E, L);
      expect(drdt).toBeLessThan(0);
      expect(dazdt).toBeLessThan(0);
    }
  });
});

describe("Kerr–Schild metric machinery", () => {
  it("BL radius: equator, axis, and the defining quartic", () => {
    const a = 0.9;
    expect(ksRadius([5, 0, 0], a)).toBeCloseTo(Math.sqrt(25 - a * a), 12);
    expect(ksRadius([0, 7, 0], a)).toBeCloseTo(7, 12);
    const p: V3 = [3.1, -2.2, 1.7];
    const r = ksRadius(p, a);
    const rho2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
    const quartic = r ** 4 - r * r * (rho2 - a * a) - a * a * p[1] * p[1];
    expect(Math.abs(quartic)).toBeLessThan(1e-9);
  });

  it("the Kerr–Schild null vector l is null in the full metric", () => {
    for (const a of [0, 0.5, 0.95]) {
      for (const p of [[6, 1, -3], [2, 2, 2], [0.5, 3, 0]] as V3[]) {
        const { l } = ksMetric(p, a);
        // contravariant l^mu = (-1, l): g(l, l) must vanish
        const L4: V4 = [-1, l[0], l[1], l[2]];
        expect(Math.abs(gDot(p, a, L4, L4))).toBeLessThan(1e-10);
      }
    }
  });

  it("circular and plunge 4-velocities are unit timelike in KS coordinates", () => {
    for (const a of [0, 0.6, 0.9]) {
      for (const az of [0, 0.7, 2.9]) {
        for (const r of [6, 9, 14]) {
          const u = uCircCart(r, az, a);
          expect(gDot(eqPos(r, az, a), a, u, u)).toBeCloseTo(-1, 8);
        }
        const { r: risco } = iscoConstants(a);
        const rHor = horizonRadius(a);
        for (const fr of [0.95, 0.5, 0.15]) {
          const r = rHor + 0.05 + (risco - rHor - 0.05) * fr;
          const u = uPlungeCart(r, az, a);
          expect(gDot(eqPos(r, az, a), a, u, u)).toBeCloseTo(-1, 6);
        }
      }
    }
  });

  it("static tetrad is orthonormal and view rays are null", () => {
    const a = 0.95;
    const p: V3 = [10, 3, -7];
    const t = buildStaticTetrad(p, a, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const legs = [t.u, t.right, t.up, t.fwd];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const expected = i === j ? (i === 0 ? -1 : 1) : 0;
        expect(gDot(p, a, legs[i], legs[j])).toBeCloseTo(expected, 9);
      }
    }
    const m = launchM(t, [0.3, -0.2, 0.93]);
    expect(Math.abs(hamiltonian(p, a, m[0], [m[1], m[2], m[3]]))).toBeLessThan(1e-10);
  });
});

describe("Kerr geodesic integrator", () => {
  it("a = 0 deflection matches the Schwarzschild orbit-equation reference", () => {
    const r0 = 25;
    const t = buildStaticTetrad([r0, 0, 0], 0, [0, 0, 1], [0, 1, 0], [-1, 0, 0]);
    for (const theta of [0.8, 1.2, 2.0]) {
      const ref = traceRay(r0, theta);
      expect(ref.captured).toBe(false);
      const m = launchM(t, [Math.sin(theta), 0, Math.cos(theta)]);
      const res = traceRayKerr([r0, 0, 0], m, 0, { rEscape: 2000 });
      expect(res.escaped).toBe(true);
      // asymptotic position angle = direction of the final velocity,
      // measured from the observer's radial direction e1 = +x toward the
      // initial transverse direction e2 = +z
      const psi = Math.atan2(res.dir[2], res.dir[0]);
      expect(Math.abs(psi - ref.psi)).toBeLessThan(0.01);
    }
  });

  it("a = 0 shadow edge sits at the Schwarzschild critical angle", () => {
    const r0 = 25;
    const t = buildStaticTetrad([r0, 0, 0], 0, [0, 0, 1], [0, 1, 0], [-1, 0, 0]);
    const thc = thetaCrit(r0);
    const inside = launchM(t, [Math.sin(thc - 0.01), 0, Math.cos(thc - 0.01)]);
    const outside = launchM(t, [Math.sin(thc + 0.01), 0, Math.cos(thc + 0.01)]);
    expect(traceRayKerr([r0, 0, 0], inside, 0).escaped).toBe(false);
    expect(traceRayKerr([r0, 0, 0], outside, 0, { rEscape: 2000 }).escaped).toBe(true);
  });

  it("holds photons on the prograde and retrograde circular photon orbits", () => {
    const a = 0.9;
    const cases = [
      { rph: 2 * (1 + Math.cos((2 / 3) * Math.acos(-a))), sign: +1 }, // prograde
      { rph: 2 * (1 + Math.cos((2 / 3) * Math.acos(a))), sign: -1 }, // retrograde
    ];
    for (const { rph, sign } of cases) {
      const om = sign / (Math.pow(rph, 1.5) + sign * a);
      const R = Math.sqrt(rph * rph + a * a);
      const pos: V3 = [R, 0, 0];
      // prograde coordinate velocity is Omega * (z, 0, -x)
      const V: V4 = [1, 0, 0, -om * R];
      expect(Math.abs(gDot(pos, a, V, V))).toBeLessThan(1e-9); // null at r_ph
      const mCov = lower(pos, a, V);
      let p: V3 = [...pos];
      let mv: V3 = [mCov[1], mCov[2], mCov[3]];
      let az = 0;
      let prevAz = Math.atan2(p[2], p[0]);
      let maxDev = 0;
      for (let i = 0; i < 3000; i++) {
        ({ p, mv } = rk4Step(p, mv, a, mCov[0], 0.005));
        const cur = Math.atan2(p[2], p[0]);
        let d = cur - prevAz;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        az += d;
        prevAz = cur;
        maxDev = Math.max(maxDev, Math.abs(ksRadius(p, a) - rph));
        if (Math.abs(az) > Math.PI / 2) break;
      }
      expect(Math.abs(az)).toBeGreaterThan(Math.PI / 2 - 0.01); // actually moved
      expect(maxDev).toBeLessThan(0.002 * rph);
      // prograde photons circulate in the disk sense (world az decreasing)
      expect(Math.sign(az)).toBe(-sign);
    }
  });

  it("conserves the Hamiltonian and the axial momentum along a bent ray", () => {
    const a = 0.9;
    const camPos: V3 = [18, 6, -12];
    const fwd = [-18, -6, 12].map((v) => v / Math.hypot(18, 6, 12)) as V3;
    const t = buildStaticTetrad(camPos, a, [0, 0, 1], [0, 1, 0], fwd);
    const m = launchM(t, [0.22, 0.1, 0.97]);
    const res = traceRayKerr(camPos, m, a, { rEscape: 300 });
    expect(res.escaped).toBe(true);
    expect(Math.abs(res.H)).toBeLessThan(1e-7);
    const lamEnd = res.pos[2] * res.mv[0] - res.pos[0] * res.mv[2];
    expect(lamEnd).toBeCloseTo(res.lam, 6);
  });

  it("frame dragging: prograde photons escape where retrograde are captured", () => {
    const a = 0.9;
    const r0 = 25;
    const t = buildStaticTetrad([r0, 0, 0], a, [0, 0, 1], [0, 1, 0], [-1, 0, 0]);
    // aim just inside the Schwarzschild critical angle, on both sides.
    // The march runs backward, so the PHYSICAL photon of the +theta launch
    // (march toward +z) moves toward -z: world az decreasing, prograde.
    const theta = thetaCrit(r0) * 0.82;
    const pro = launchM(t, [Math.sin(theta), 0, Math.cos(theta)]);
    const retro = launchM(t, [-Math.sin(theta), 0, Math.cos(theta)]);
    expect(traceRayKerr([r0, 0, 0], pro, a, { rEscape: 2000 }).escaped).toBe(true);
    expect(traceRayKerr([r0, 0, 0], retro, a, { rEscape: 2000 }).escaped).toBe(false);
  });

  it("face-on disk redshift matches 1/u^t (sqrt(1 - 3/r) at a = 0)", () => {
    for (const a of [0, 0.9]) {
      const cam: V3 = [0, 3000, 0];
      const t = buildStaticTetrad(cam, a, [1, 0, 0], [0, 0, 1], [0, -1, 0]);
      const m = launchM(t, [8.2 / 3000, 0, 1]);
      const res = traceRayKerr(cam, m, a, { rEscape: 4000 });
      expect(res.crossings.length).toBeGreaterThan(0);
      const c = res.crossings[0];
      expect(c.r).toBeGreaterThan(4);
      expect(c.r).toBeLessThan(14);
      expect(c.g).toBeCloseTo(1 / circUt(c.r, a), 3);
      if (a === 0) {
        expect(c.g).toBeCloseTo(Math.sqrt(1 - 3 / c.r), 3);
      }
    }
  });

  it("disk shift factor is blue on the approaching side, red on the receding", () => {
    // camera in the equatorial-ish plane; the approaching side of a
    // prograde disk (world az decreasing) at camera azimuth 0 is +z... left
    // to the trace: compare the two crossings of mirrored rays
    const a = 0.7;
    const r0 = 30;
    const cam: V3 = [r0, 6, 0];
    const fwd = [-r0, -6, 0].map((v) => v / Math.hypot(r0, 6, 0)) as V3;
    const t = buildStaticTetrad(cam, a, [0, 0, 1], [0, 1, 0], fwd);
    const off = 0.28;
    const left = traceRayKerr(cam, launchM(t, [-off, 0, 1]), a, { rEscape: 200 });
    const right = traceRayKerr(cam, launchM(t, [off, 0, 1]), a, { rEscape: 200 });
    const gLeft = left.crossings[0]?.g;
    const gRight = right.crossings[0]?.g;
    expect(gLeft).toBeDefined();
    expect(gRight).toBeDefined();
    // matter at world az ~ -90deg (z < 0) moves toward +...: with az
    // decreasing, velocity at (0,0,-R) points along -x (away from camera on
    // +x): that side is receding; the +z side approaches.
    expect(gRight).toBeGreaterThan(1.0); // +z side: approaching, blueshifted
    expect(gLeft).toBeLessThan(1.0); // -z side: receding, redshifted
  });

  it("never reports escape for rays aimed inside the shadow", () => {
    // Regression: a captured backward ray belongs to the outgoing family,
    // which ingoing Kerr–Schild does not regularize — it hugs the horizon
    // from outside with diverging covariant momentum. The runaway used to
    // let some of these wander back out past rEscape as fake escapes,
    // visible as spikes on the 6f shadow outline. Shadow angular radius from
    // r = 25 is ~11.5 deg at a = 0 (asin(3√3·√(1−2/r)/r)); the prograde side
    // shrinks with spin, so the spinning case stays within 4 deg.
    const pos: V3 = [
      25 * Math.cos(0.15) * Math.sin(0.6),
      25 * Math.sin(0.15),
      25 * Math.cos(0.15) * Math.cos(0.6),
    ];
    const fwd = pos.map((v) => -v / 25) as V3;
    const rn = Math.hypot(fwd[2], fwd[0]);
    const right: V3 = [-fwd[2] / rn, 0, fwd[0] / rn]; // cross(fwd, +y), unit
    const up: V3 = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];
    for (const [a, thetas] of [
      [0, [0.02, 0.06, 0.1, 0.16]],
      [0.9, [0.02, 0.04, 0.07]],
    ] as Array<[number, number[]]>) {
      const tet = buildStaticTetrad(pos, a, right, up, fwd);
      for (const th of thetas) {
        for (let k = 0; k < 8; k++) {
          const psi = (k / 8) * Math.PI * 2 + 0.13; // off the symmetry planes
          const d: V3 = [
            Math.sin(th) * Math.cos(psi),
            Math.sin(th) * Math.sin(psi),
            Math.cos(th),
          ];
          const res = traceRayKerr(pos, launchM(tet, d), a, { rEscape: 65 });
          expect(res.escaped).toBe(false);
        }
      }
    }
  });
});

describe("exact shift helpers", () => {
  it("diskShift with lam = 0 equals 1/u^t (pure time dilation)", () => {
    for (const a of [0, 0.8]) {
      for (const r of [6, 10]) {
        expect(diskShift(r, a, 1, 0)).toBeCloseTo(1 / circUt(r, a), 12);
      }
    }
  });

  it("circular E, L satisfy u_t = -E and u_phi = L (BL identities)", () => {
    // Cross-check circEL against the BL metric identities
    // u_t = -(E), u_phi = L for the circular orbit 4-velocity
    // u^mu = u^t (1, 0, 0, Omega):
    // u_t = g_tt u^t + g_tphi u^phi, u_phi = g_tphi u^t + g_phiphi u^phi
    for (const a of [0.3, 0.9]) {
      for (const r of [5, 9]) {
        const { E, L } = circEL(r, a);
        const ut = circUt(r, a);
        const om = omegaCirc(r, a);
        const gtt = -(1 - 2 / r);
        const gtp = (-2 * a) / r;
        const gpp = r * r + a * a + (2 * a * a) / r;
        expect(gtt * ut + gtp * ut * om).toBeCloseTo(-E, 10);
        expect(gtp * ut + gpp * ut * om).toBeCloseTo(L, 10);
      }
    }
  });
});
