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
  segIntensity,
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

/** The app's default disk outer edge (index.html "disksize"). */
const DISK_OUTER = 19;

/** Run a launched event forward in fixed chunks until a predicate holds. */
function runUntil(
  st: TdeState,
  a: number,
  dt: number,
  maxT: number,
  done: (st: TdeState, t: number) => boolean,
  diskOuter = DISK_OUTER
): number {
  const rand = mulberry32(0xbeef);
  let t = 0;
  while (t < maxT) {
    stepTde(st, dt, a, t, rand, diskOuter);
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

  it("the whole bound tail comes back to be eaten, not just the most-bound few", () => {
    // Spreading the bound elements by fallback period (rather than uniformly
    // in energy, where apocenter ~ 1/(1-E) strands most of them on ~1e3 M
    // orbits) is the only reason these return inside the watch window. A
    // uniform-energy spread scored 5/32 here, and read on screen as the whole
    // stream flying away and never being eaten.
    const a = 0.7;
    const st = launchTde(10 ** 6.5, a);
    const eaten = new Set<number>();
    runUntil(st, a, 1, 4 * FALLBACK_T0, () => {
      st.bodies.forEach((b, i) => {
        if (b.alive && b.wentOut && -b.mt < 1 && ksRadius(b.p, a) < DISK_OUTER) eaten.add(i);
      });
      return false;
    });
    expect(eaten.size).toBeGreaterThanOrEqual(0.85 * BOUND_FRAC * DEBRIS_COUNT);
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
    stepTde(st, 0.5, a, 0, rand, DISK_OUTER);
    expect(st.phase).toBe("debris");
  });

  it("low-mass debris stays lit out on its loop, where nothing can eat it", () => {
    // Regression: the disk-eat fade was keyed on r < st.rt. r_t belongs to the
    // STAR and scales as M^(-2/3), so at 1e5 M☉ it is 219 M — larger than the
    // whole scene — and every bound element began dissolving the instant it
    // passed apocenter, tens of M from anything that could eat it. The stream
    // evaporated in open space and never fell back, which read on screen as
    // the star simply vanishing. The DISK does the eating, so the disk's edge
    // is the radius that decides.
    const a = 0.7;
    const st = launchTde(1e5, a);
    expect(st.rt).toBeGreaterThan(3 * DISK_OUTER); // r_t engulfs the scene

    runUntil(st, a, 1, 800, () => false); // out past apocenter
    const looping = st.bodies.filter(
      (b) =>
        b.alive &&
        b.wentOut &&
        -b.mt < 1 && // bound
        ksRadius(b.p, a) > 1.5 * DISK_OUTER && // well outside the disk...
        ksRadius(b.p, a) < 55 // ...but not yet "left the scene"
    );
    expect(looping.length).toBeGreaterThan(0);
    // spawn brightness is 0.5..1 and nothing out here should have dimmed it
    for (const b of looping) expect(b.bright).toBeGreaterThan(0.45);
  });

  it("low-mass debris survives long enough to fall back into the disk", () => {
    // The payoff of keying the fade on the disk: the bound tail completes its
    // loop and reaches the disk body, which is the part worth watching.
    const a = 0.7;
    const st = launchTde(1e5, a);
    let reachedDisk = false;
    runUntil(st, a, 1, 2000, () => {
      if (st.bodies.some((b) => b.alive && b.wentOut && ksRadius(b.p, a) < DISK_OUTER)) {
        reachedDisk = true;
      }
      return reachedDisk;
    });
    expect(reachedDisk).toBe(true);
  });

  it("stream capsules draw at the endpoint-average brightness until stretched", () => {
    // degenerate capsule (the intact star) and short segments: no dimming
    expect(segIntensity(1, 1, 0)).toBeCloseTo(1, 10);
    expect(segIntensity(0.8, 0.4, 0.5)).toBeCloseTo(0.6, 10);
    // stretching dims monotonically (spaghettification pulls the stream thin)
    let prev = Infinity;
    for (const len of [1.5, 3, 6, 12, 20, 28, 33]) {
      const v = segIntensity(1, 1, len);
      expect(v).toBeLessThan(prev);
      expect(v).toBeGreaterThan(0);
      prev = v;
    }
    // past the fade the chord no longer tracks the physical stream: culled
    expect(segIntensity(1, 1, 40)).toBe(0);
  });

  it("debris kicks are collinear, so the drawn stream is a smooth curve", () => {
    // spawnDebris scales the star's velocity without transverse scatter;
    // right after disruption every element sits at the star's position and
    // the stream stays a 1-D curve as it stretches (thickness is rendering)
    const a = 0;
    const st = launchTde(1e7, a);
    runUntil(st, a, 1, 1500, (s) => s.phase === "debris");
    const p0 = st.bodies[0].p;
    for (const b of st.bodies) {
      expect(Math.hypot(b.p[0] - p0[0], b.p[1] - p0[1], b.p[2] - p0[2])).toBeLessThan(1e-9);
    }
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
