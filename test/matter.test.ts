import { describe, expect, it } from "vitest";
import { gDot, iscoRadius, omegaCirc } from "../src/kerr";
import {
  GAS_COUNT,
  STAR_COUNT,
  STAR_ORBITS,
  type GasBlob,
  gasDrift,
  gasPosXZ,
  gasRates,
  gasU,
  makeSpinCtx,
  mulberry32,
  nodalRate,
  spawnGasBlob,
  starState,
  stepGasBlob,
} from "../src/matter";

type V3 = [number, number, number];
const len = (v: V3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

describe("star orbits", () => {
  it("all configured orbits sit outside the ISCO for any spin", () => {
    expect(STAR_COUNT).toBe(STAR_ORBITS.length);
    for (const o of STAR_ORBITS) expect(o.a).toBeGreaterThan(6);
  });

  it("stays at its orbital radius for all times and spins", () => {
    for (const o of STAR_ORBITS) {
      for (const a of [0, 0.9]) {
        for (const t of [0, 137.5, 1234.75, 99999]) {
          expect(len(starState(o, t, a).pos)).toBeCloseTo(o.a, 9);
        }
      }
    }
  });

  it("returns to the starting point after one period at a = 0", () => {
    for (const o of STAR_ORBITS) {
      const T = (2 * Math.PI) / omegaCirc(o.a, 0);
      const p0 = starState(o, 0).pos;
      const p1 = starState(o, T).pos;
      for (let i = 0; i < 3; i++) expect(p1[i]).toBeCloseTo(p0[i], 6);
    }
  });

  it("analytic velocity matches finite differences, including precession", () => {
    const aSpin = 0.9;
    for (const o of STAR_ORBITS) {
      const t0 = 41.7;
      const s = starState(o, t0, aSpin);
      const h = 1e-4;
      const p1 = starState(o, t0 + h, aSpin).pos;
      for (let i = 0; i < 3; i++) {
        expect((p1[i] - s.pos[i]) / h).toBeCloseTo(s.vel[i], 5);
      }
      expect(dot(s.pos, s.vel)).toBeCloseTo(0, 8); // circular
    }
  });

  it("4-velocity is exactly unit timelike in the Kerr metric", () => {
    for (const aSpin of [0, 0.7, 0.95]) {
      for (const o of STAR_ORBITS) {
        const s = starState(o, 63.2, aSpin);
        expect(gDot(s.pos, aSpin, s.u, s.u)).toBeCloseTo(-1, 9);
      }
    }
  });

  it("keeps a fixed orbit plane at a = 0", () => {
    for (const o of STAR_ORBITS) {
      let first: V3 | null = null;
      for (const t of [0, 55, 210]) {
        const s = starState(o, t);
        const n = cross(s.pos, s.vel);
        const nn: V3 = [n[0] / len(n), n[1] / len(n), n[2] / len(n)];
        expect(Math.abs(nn[1])).toBeCloseTo(Math.cos(o.inc), 9);
        if (first) {
          expect(Math.abs(dot(nn, first))).toBeCloseTo(1, 9);
        } else {
          first = nn;
        }
      }
    }
  });

  it("Lense–Thirring: the orbit plane precesses at the nodal rate", () => {
    const aSpin = 0.9;
    const o = { a: 9, inc: 0.6, node: 0.4, phase0: 0.9, tempK: 8000, radius: 0.3 };
    const rate = nodalRate(o.a, aSpin);
    expect(rate).toBeGreaterThan(0);
    // 2a/r^3 is the leading weak-field Lense–Thirring term; at r = 9 the
    // exact rate carries O(a/r^{3/2}) corrections, so allow 25%
    const lt = (2 * aSpin) / Math.pow(o.a, 3);
    expect(rate).toBeGreaterThan(lt * 0.75);
    expect(rate).toBeLessThan(lt * 1.25);
    // the geometric plane normal at time t is rotY([0, cos inc, sin inc],
    // node - rate*t); every position must stay in that precessing plane
    const planeNormal = (t: number): V3 => {
      const n = o.node - rate * t;
      const si = Math.sin(o.inc);
      return [-si * Math.sin(n), Math.cos(o.inc), si * Math.cos(n)];
    };
    let awayFromFixed = 0;
    for (const t of [0, 130, 470, 1100, 2600]) {
      const p = starState(o, t, aSpin).pos;
      expect(Math.abs(dot(p, planeNormal(t)))).toBeLessThan(1e-9);
      awayFromFixed = Math.max(awayFromFixed, Math.abs(dot(p, planeNormal(0))));
    }
    // ... and that plane genuinely moves away from the t = 0 plane
    expect(awayFromFixed).toBeGreaterThan(0.5);
  });

  it("equatorial stars co-rotate with the disk pattern at any spin", () => {
    for (const aSpin of [0, 0.7]) {
      const o = { a: 10, inc: 0, node: 0, phase0: 1.3, tempK: 8000, radius: 0.3 };
      const az = (t: number) => {
        const p = starState(o, t, aSpin).pos;
        return Math.atan2(p[2], p[0]);
      };
      const m1 = az(0.5) + 0.5 * omegaCirc(10, aSpin);
      expect(wrap(m1 - az(0))).toBeCloseTo(0, 9);
    }
  });
});

describe("infalling gas", () => {
  it("viscous drift is inward everywhere and weakens outward", () => {
    for (const isco of [6, 2.32]) {
      let prev = -Infinity;
      for (const r of [isco + 0.1, 6.5, 9, 15, 30]) {
        const d = gasDrift(r, isco);
        expect(d).toBeLessThan(0);
        expect(Math.abs(d)).toBeLessThan(Math.abs(prev) || Infinity);
        prev = d;
      }
    }
  });

  it("spawns inside the disk and orbits at the Kerr circular rate", () => {
    const ctx = makeSpinCtx(0.9);
    const rng = mulberry32(1);
    const b = spawnGasBlob(rng, 19);
    expect(b.r).toBeGreaterThan(0.8 * 19);
    expect(b.r).toBeLessThan(0.96 * 19);
    const r0 = b.r;
    const az0 = b.az;
    stepGasBlob(b, 0.01, 19, rng, ctx);
    expect(b.az).toBeCloseTo((az0 - omegaCirc(r0, 0.9) * 0.01) % (2 * Math.PI), 10);
    expect(b.r).toBeLessThan(r0);
  });

  it("azimuthal rate is continuous across the ISCO (plunge takeover)", () => {
    const ctx = makeSpinCtx(0.6);
    const mk = (r: number): GasBlob => ({ r, az: 1, size: 0.5, bright: 1 });
    const rateAt = (r: number) => {
      const b = mk(r);
      const az0 = b.az;
      stepGasBlob(b, 0.01, 19, mulberry32(3), ctx);
      return (b.az - az0) / 0.01;
    };
    const outside = rateAt(ctx.isco + 1e-3);
    const inside = rateAt(ctx.isco - 1e-3);
    expect(inside).toBeLessThan(0);
    expect(Math.abs(inside - outside) / Math.abs(outside)).toBeLessThan(0.01);
  });

  it("long evolution: blobs fall through the ISCO, plunge, and respawn", () => {
    for (const a of [0, 0.9]) {
      const ctx = makeSpinCtx(a);
      const rng = mulberry32(7);
      const b: GasBlob = spawnGasBlob(rng, 19);
      let respawns = 0;
      let sawPlunge = false;
      let prevR = b.r;
      for (let i = 0; i < 2500; i++) {
        stepGasBlob(b, 2, 19, rng, ctx);
        expect(b.r).toBeGreaterThan(ctx.rHor + 0.019);
        expect(b.r).toBeLessThanOrEqual(0.96 * 19);
        if (b.r < ctx.isco) sawPlunge = true;
        if (b.r > prevR + 1) respawns++;
        prevR = b.r;
      }
      expect(sawPlunge).toBe(true);
      expect(respawns).toBeGreaterThan(2);
    }
  });

  it("uploaded 4-velocities are unit timelike in both regimes", () => {
    const ctx = makeSpinCtx(0.9);
    for (const r of [ctx.isco + 3, ctx.isco - 0.3, ctx.rHor + 0.1]) {
      const b: GasBlob = { r, az: 2.2, size: 0.5, bright: 1 };
      const [x, z] = gasPosXZ(b, ctx);
      const u = gasU(b, ctx);
      expect(gDot([x, 0, z], ctx.a, u, u)).toBeCloseTo(-1, 6);
    }
  });

  it("spin context matches the Kerr closed forms", () => {
    const ctx = makeSpinCtx(0.998);
    expect(ctx.isco).toBeCloseTo(iscoRadius(0.998), 12);
    expect(ctx.rHor).toBeCloseTo(1 + Math.sqrt(1 - 0.998 ** 2), 12);
  });

  it("gasRates are the derivative of the path stepGasBlob actually walks", () => {
    // The renderer draws each blob's trail by sweeping BACKWARD along these
    // rates, so if they ever drifted from the stepper's own branches the arc
    // would not lie on the path the blob came in on. Check both regimes
    // against a finite difference of the stepper itself.
    const ctx = makeSpinCtx(0.7);
    const rand = mulberry32(7);
    const h = 0.02;
    for (const r of [17, 10, ctx.isco + 0.4, ctx.isco - 0.25]) {
      const b: GasBlob = { r, az: 1.1, size: 0.5, bright: 1 };
      const rates = gasRates(b, ctx);
      const after: GasBlob = { ...b };
      stepGasBlob(after, h, 19, rand, ctx);

      const R = (x: number) => Math.sqrt(x * x + ctx.a * ctx.a);
      expect(wrap(after.az - b.az) / h).toBeCloseTo(rates.dazdt, 4);
      expect((R(after.r) - R(b.r)) / h).toBeCloseTo(rates.dRdt, 4);
    }
  });

  it("gas sweeps in the disk's sense and always drifts inward", () => {
    // The shader relies on both signs: it wraps time backward as -daz/dazdt
    // and expects the tail to sit at larger radius than the head.
    const ctx = makeSpinCtx(0.5);
    for (const r of [18, 8, ctx.isco - 0.2]) {
      const { dazdt, dRdt } = gasRates({ r, az: 0, size: 0.4, bright: 1 }, ctx);
      expect(dazdt).toBeLessThan(0); // world azimuth decreasing
      expect(dRdt).toBeLessThan(0); // never orbits back outward
    }
  });
});

describe("mulberry32", () => {
  it("is deterministic and uniform on [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(GAS_COUNT).toBeGreaterThan(0);
  });
});
