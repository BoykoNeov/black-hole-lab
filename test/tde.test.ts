import { describe, it, expect } from "vitest";
import {
  gDot,
  hamiltonian,
  horizonRadius,
  ksRadius,
  lower,
  omegaCirc,
  raise,
  uCircCart,
  type V3,
  type V4,
} from "../src/kerr";
import { mulberry32 } from "../src/matter";
import { tidalRadiusM } from "../src/astro";
import {
  BOUND_FRAC,
  DEBRIS_COUNT,
  FALLBACK_T0,
  aliveBodies,
  bodyU,
  launchTde,
  stepBody,
  stepTde,
  type TdeBody,
  type TdeState,
} from "../src/tde";

/** Build a TdeBody from a position and an exact 4-velocity. */
function bodyFromU(p: V3, u: V4, a: number): TdeBody {
  const m = lower(p, a, u);
  return {
    p: [...p],
    mv: [m[1], m[2], m[3]],
    mt: m[0],
    size: 0.2,
    bright: 1,
    tempK: 5000,
    alive: true,
    prevR: ksRadius(p, a),
    movedOut: false,
    wentOut: false,
  };
}

/** Run a launched event forward in fixed chunks until a predicate holds. */
function runUntil(
  st: TdeState,
  a: number,
  dt: number,
  maxT: number,
  done: (st: TdeState, t: number) => boolean
): number {
  const rand = mulberry32(0xbeef);
  let t = 0;
  while (t < maxT) {
    stepTde(st, dt, a, t, rand);
    t += dt;
    if (done(st, t)) return t;
  }
  return t;
}

describe("timelike Kerr geodesic stepper", () => {
  it("holds a circular orbit at its exact period and conserves the norm", () => {
    const a = 0.7;
    const r = 8;
    const R = Math.sqrt(r * r + a * a);
    const b = bodyFromU([R, 0, 0], uCircCart(r, 0, a), a);
    const period = (2 * Math.PI) / omegaCirc(r, a);

    let az = 0;
    let prevAz = 0;
    const steps = 200;
    for (let i = 0; i < steps; i++) {
      stepBody(b, period / steps, a, horizonRadius(a));
      const cur = Math.atan2(b.p[2], b.p[0]);
      let d = cur - prevAz;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      az += d;
      prevAz = cur;
      expect(ksRadius(b.p, a)).toBeCloseTo(r, 3);
    }
    // one full prograde revolution (world azimuth decreasing)
    expect(az).toBeCloseTo(-2 * Math.PI, 1);
    // still a unit timelike momentum: 2H = g^munu m_mu m_nu = -1
    expect(2 * hamiltonian(b.p, a, b.mt, b.mv)).toBeCloseTo(-1, 6);
    // and the raised momentum is a unit 4-velocity
    const u = bodyU(b, a);
    expect(gDot(b.p, a, u, u)).toBeCloseTo(-1, 6);
  });

  it("raise inverts lower", () => {
    const a = 0.9;
    const p: V3 = [3.2, -1.1, 2.4];
    const V: V4 = [1.3, 0.2, -0.5, 0.7];
    const back = raise(p, a, lower(p, a, V));
    for (let i = 0; i < 4; i++) expect(back[i]).toBeCloseTo(V[i], 10);
  });
});

describe("tidal disruption event", () => {
  it("launches a marginally bound star (E ~ 1) that falls inward", () => {
    const st = launchTde(1e7, 0.7);
    const star = st.bodies[0];
    expect(-star.mt).toBeGreaterThan(0.99);
    expect(-star.mt).toBeLessThan(1.01);
    const r0 = ksRadius(star.p, 0.7);
    stepBody(star, 30, 0.7, horizonRadius(0.7));
    expect(ksRadius(star.p, 0.7)).toBeLessThan(r0 - 1);
  });

  it("disrupts at the tidal radius into bound and unbound debris", () => {
    const a = 0;
    const st = launchTde(1e7, a);
    const rt = tidalRadiusM(1e7);
    expect(st.rt).toBeCloseTo(rt, 10);

    runUntil(st, a, 1, 1500, (s) => s.phase === "debris");
    expect(st.phase).toBe("debris");
    expect(st.tDisrupt).not.toBeNull();
    expect(st.bodies.length).toBe(DEBRIS_COUNT);
    // debris spawns where the star crossed r_t (within one step + jitter)
    const rSpawn = ksRadius(st.bodies[0].p, a);
    expect(Math.abs(rSpawn - rt)).toBeLessThan(1.0);
    // conserved energies straddle E = 1: a bound tail and an unbound tail
    const Es = st.bodies.map((b) => -b.mt);
    expect(Math.min(...Es)).toBeLessThan(0.99);
    expect(Math.max(...Es)).toBeGreaterThan(1.01);
  });

  it("biases the split toward the bound tail rather than the physical 50/50", () => {
    const a = 0;
    const st = launchTde(1e7, a);
    runUntil(st, a, 1, 1500, (s) => s.phase === "debris");
    const frac = st.bodies.filter((b) => -b.mt < 1).length / DEBRIS_COUNT;
    expect(frac).toBeGreaterThan(0.55); // the bias is real, not the physical 50/50
    // The star's own E lands within O(1/r0^2) of 1 rather than exactly on it,
    // sliding the E = 1 crossing a couple of elements off the geometric split.
    // BOUND_FRAC is a display choice, so bracket it rather than pin a count.
    expect(Math.abs(frac - BOUND_FRAC)).toBeLessThan(0.12);
  });

  it("bound debris loops out and falls back while unbound debris escapes", () => {
    // moderate mass: r_t = 22.6 M, an encounter comfortably clear of the
    // relativistic capture threshold, so the bound tail must come back
    const a = 0;
    const st = launchTde(3e6, a);
    runUntil(st, a, 1, 1500, (s) => s.phase === "debris");

    const Es = st.bodies.map((b) => -b.mt);
    const iBound = Es.indexOf(Math.min(...Es));
    const iUnbound = Es.indexOf(Math.max(...Es));
    const bound = st.bodies[iBound];
    const unbound = st.bodies[iUnbound];

    let rMax = 0;
    let cameBack = false;
    runUntil(st, a, 1, 2.5 * FALLBACK_T0, () => {
      if (bound.alive) {
        const r = ksRadius(bound.p, a);
        rMax = Math.max(rMax, r);
        if (rMax > st.rt * 1.15 && r < 0.8 * rMax) cameBack = true;
      }
      return cameBack && ksRadius(unbound.p, a) > 50;
    });
    expect(rMax).toBeGreaterThan(st.rt * 1.15); // looped outward
    expect(cameBack).toBe(true); // ...and fell back (the flare's fuel)
    expect(ksRadius(unbound.p, a)).toBeGreaterThan(50); // escaped
  });

  it("above the Hills mass the star is swallowed whole - no debris, no flare", () => {
    const a = 0;
    const st = launchTde(1e9, a); // r_t = 0.47 M, inside the horizon
    expect(st.rt).toBeLessThan(horizonRadius(a));
    runUntil(st, a, 1, 2000, (s) => s.phase !== "infall");
    expect(st.phase).toBe("swallowed");
    expect(st.tDisrupt).toBeNull();
    expect(st.bodies[0].alive).toBe(false);
    expect(aliveBodies(st).length).toBe(0);
  });

  it("a star spawned inside its own tidal radius is disrupted immediately", () => {
    const a = 0;
    const st = launchTde(1e5, a); // r_t = 218 M >> the 30 M spawn radius
    expect(st.rt).toBeGreaterThan(30);
    const rand = mulberry32(1);
    stepTde(st, 0.5, a, 0, rand);
    expect(st.phase).toBe("debris");
  });

  it("debris elements stay on exact geodesics: E and the norm are conserved", () => {
    const a = 0.7;
    const st = launchTde(1e7, a);
    runUntil(st, a, 1, 1500, (s) => s.phase === "debris");
    const E0 = st.bodies.map((b) => -b.mt);
    runUntil(st, a, 2, 400, () => false);
    st.bodies.forEach((b, i) => {
      expect(-b.mt).toBeCloseTo(E0[i], 12); // mt never touched
      if (b.alive) {
        expect(2 * hamiltonian(b.p, a, b.mt, b.mv)).toBeCloseTo(-1, 4);
      }
    });
  });
});
