/**
 * Tidal disruption events (slice 5).
 *
 * A sun-like star is thrown at the hole on a marginally bound (parabolic)
 * orbit whose pericenter grazes its tidal radius r_t — the standard TDE
 * setup. Measured in the hole's own gravitational radii, r_t shrinks with
 * mass as M^(-2/3), which is the whole story:
 *
 *  - small hole:  r_t far outside the horizon — the star is shredded into
 *    a debris stream; the bound half falls back and flares the disk,
 *  - above the Hills mass (~1.1e8 M☉): r_t is inside the horizon — the
 *    star crosses it whole and simply vanishes, no flare.
 *
 * The star and every debris element move on EXACT timelike Kerr geodesics,
 * integrated with the same Kerr–Schild Hamiltonian RK4 as the photons
 * (kerr.ts rk4Step — the flow is identical, only the mass shell differs:
 * g^munu m_mu m_nu = -1 instead of 0). m_t is conserved exactly, so each
 * element's orbital energy E = -m_t is exact; the stream's stretch, the
 * bound tail's return, and capture across the horizon all emerge from the
 * integration.
 *
 * One knob is honestly artistic: the debris energy spread. The physical
 * spread dE = (Mstar/M)^(1/3) / r_t would put the most-bound debris on an orbit
 * of ~1e5-1e6 M — real TDE flares take months. We widen the spread so the
 * first fallback lands FALLBACK_T0 after disruption (minutes of wall clock
 * at the default time speed). Slice 6 will label such knobs explicitly.
 */

import {
  gDot,
  horizonRadius,
  ksRadius,
  lower,
  normalizeVel,
  raise,
  rk4Step,
  stepLength,
  type V3,
  type V4,
} from "./kerr";
import { tidalRadiusM } from "./astro";

export const DEBRIS_COUNT = 32;
/** Size of the shader's TDE uniform arrays (the intact star uses slot 0). */
export const TDE_MAX = DEBRIS_COUNT;
/**
 * Coordinate time from disruption to first fallback (the flare's peak).
 * This sets the compressed debris energy spread dE = (pi/T0)^(2/3) — much
 * wider than physical, but narrow enough that the bound tail keeps most of
 * its angular momentum and loops back instead of being captured outright
 * (speed-scaling the debris also scales L, and the relativistic capture
 * threshold for marginally bound orbits sits at L = 4).
 */
export const FALLBACK_T0 = 1600;
const STAR_TEMP_K = 5800;

export interface TdeBody {
  p: V3;
  /** Covariant spatial momentum of the unit-mass geodesic. */
  mv: V3;
  /** Conserved m_t = -E (orbital energy per unit rest mass). */
  mt: number;
  /** Gaussian emission radius in M (artistic — a real star is ~1e-5 r_t). */
  size: number;
  bright: number;
  tempK: number;
  alive: boolean;
  /** Radial bookkeeping for spotting the post-pericenter loop-out. */
  prevR: number;
  movedOut: boolean;
  /** True once the element has passed apocenter and is falling back. */
  wentOut: boolean;
}

export type TdePhase = "infall" | "debris" | "swallowed";

export interface TdeState {
  phase: TdePhase;
  massMsun: number;
  /** Tidal radius in M, frozen at launch. */
  rt: number;
  bodies: TdeBody[];
  /** Simulation time of disruption; stays null if the star is swallowed. */
  tDisrupt: number | null;
}

function makeBody(
  p: V3,
  vel: V3,
  a: number,
  size: number,
  bright: number,
  tempK: number
): TdeBody {
  const u = normalizeVel(p, a, vel);
  const m = lower(p, a, u);
  return {
    p: [...p],
    mv: [m[1], m[2], m[3]],
    mt: m[0],
    size,
    bright,
    tempK,
    alive: true,
    prevR: ksRadius(p, a),
    movedOut: false,
    wentOut: false,
  };
}

/** Contravariant 4-velocity of a body at its current position. */
export function bodyU(b: TdeBody, a: number): V4 {
  return raise(b.p, a, [b.mt, b.mv[0], b.mv[1], b.mv[2]]);
}

/**
 * Throw a sun-like star at the hole: marginally bound (Newtonian parabolic
 * initial data at r0 — E lands within O(1/r0^2) of 1), aimed so the
 * pericenter grazes the tidal radius, on a plane inclined to the disk.
 * If r_t is inside the horizon the same aim carries it straight through;
 * if r_t is beyond r0 the star spawns already inside its tidal radius and
 * is disrupted immediately (a sun-like star cannot exist that close).
 */
export function launchTde(
  massMsun: number,
  a: number,
  r0 = 30,
  inc = 0.35
): TdeState {
  const rt = tidalRadiusM(massMsun);
  const rp = Math.min(0.9 * rt, 0.55 * r0);
  const v = Math.sqrt(2 / r0);
  const vt = Math.sqrt(2 * rp) / r0; // from L = sqrt(2 rp)
  const vr = -Math.sqrt(Math.max(v * v - vt * vt, 0));
  // in the orbit plane: radial infall + prograde tangential motion
  // (world azimuth decreasing, the disk's sense)
  const phi0 = 1.0;
  const cp = Math.cos(phi0);
  const sp = Math.sin(phi0);
  const posEq: V3 = [r0 * cp, 0, r0 * sp];
  const velEq: V3 = [vr * cp + vt * sp, 0, vr * sp - vt * cp];
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const tilt = (w: V3): V3 => [w[0], -si * w[2], ci * w[2]];
  return {
    phase: "infall",
    massMsun,
    rt,
    bodies: [makeBody(tilt(posEq), tilt(velEq), a, 0.3, 1.0, STAR_TEMP_K)],
    tDisrupt: null,
  };
}

/**
 * Advance a body by dt of Kerr–Schild coordinate time along its exact
 * geodesic — adaptive affine substeps under the same arc-length control as
 * the photon march, with dt/dsigma = u^t from the raised momentum. Marks
 * the body dead once it crosses the horizon.
 */
export function stepBody(b: TdeBody, dt: number, a: number, rHor: number): void {
  if (!b.alive) return;
  let left = dt;
  for (let guard = 0; left > 1e-6 && guard < 4000; guard++) {
    const r = ksRadius(b.p, a);
    if (r < rHor + 0.02) {
      b.alive = false;
      return;
    }
    const u = bodyU(b, a);
    const sp = Math.hypot(u[1], u[2], u[3]);
    const hMax = stepLength(r) / Math.max(sp, 1e-9);
    const h = Math.min(left / u[0], hMax);
    const n = rk4Step(b.p, b.mv, a, b.mt, h);
    b.p = n.p;
    b.mv = n.mv;
    const u2 = bodyU(b, a);
    left -= 0.5 * h * (u[0] + u2[0]);
  }
  if (ksRadius(b.p, a) < rHor + 0.02) b.alive = false;
}

/**
 * Shred the star into DEBRIS_COUNT elements at its current position: same
 * velocity direction, speeds spread so the conserved energies straddle
 * E = 1 (half bound, half unbound), plus a little transverse scatter for
 * stream thickness. The spread is sized so the most-bound element's
 * Keplerian period is FALLBACK_T0 (see the header note on compression).
 */
export function spawnDebris(
  star: TdeBody,
  a: number,
  rand: () => number
): TdeBody[] {
  const u = bodyU(star, a);
  const v: V3 = [u[1] / u[0], u[2] / u[0], u[3] / u[0]];
  const v2 = Math.max(v[0] * v[0] + v[1] * v[1] + v[2] * v[2], 1e-6);
  const aMB = Math.pow(FALLBACK_T0 / (2 * Math.PI), 2 / 3);
  const dE = 1 / (2 * aMB); // most-bound element: E = 1 - dE
  const out: TdeBody[] = [];
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const s = -1 + (2 * i) / (DEBRIS_COUNT - 1);
    const scale = 1 + (s * dE) / v2; // dE_newt = v dv
    const vi: V3 = [
      v[0] * scale + 0.012 * (rand() - 0.5),
      v[1] * scale + 0.012 * (rand() - 0.5),
      v[2] * scale + 0.012 * (rand() - 0.5),
    ];
    // keep (1, v) safely timelike — the stream head is fast near pericenter
    for (let k = 0; k < 25; k++) {
      const V: V4 = [1, vi[0], vi[1], vi[2]];
      if (-gDot(star.p, a, V, V) > 0.02) break;
      for (let c = 0; c < 3; c++) vi[c] = v[c] + (vi[c] - v[c]) * 0.7;
    }
    const pos: V3 = [
      star.p[0] + 0.06 * (rand() - 0.5),
      star.p[1] + 0.06 * (rand() - 0.5),
      star.p[2] + 0.06 * (rand() - 0.5),
    ];
    out.push(
      makeBody(pos, vi, a, 0.15 + 0.08 * rand(), 0.5 + 0.5 * rand(), 4600 + 1400 * rand())
    );
  }
  return out;
}

/**
 * Advance the whole event by dt. Infall: integrate the star, disrupt when
 * it crosses r_t (or mark it swallowed at the horizon — the Hills-mass
 * outcome). Debris: integrate every element; bound elements that have
 * looped out past apocenter and fallen back are eaten by the disk (that
 * fallback is what powers the flare — main.ts drives it analytically from
 * tDisrupt), unbound ones fade once they leave the scene.
 */
export function stepTde(
  st: TdeState,
  dt: number,
  a: number,
  simT: number,
  rand: () => number
): void {
  const rHor = horizonRadius(a);
  if (st.phase === "infall") {
    const star = st.bodies[0];
    stepBody(star, dt, a, rHor);
    if (!star.alive) {
      st.phase = "swallowed";
      return;
    }
    if (ksRadius(star.p, a) < st.rt) {
      st.bodies = spawnDebris(star, a, rand);
      st.tDisrupt = simT;
      st.phase = "debris";
    }
    return;
  }
  if (st.phase !== "debris") return;
  for (const b of st.bodies) {
    if (!b.alive) continue;
    stepBody(b, dt, a, rHor);
    if (!b.alive) continue;
    const r = ksRadius(b.p, a);
    if (r > b.prevR + 1e-3) b.movedOut = true;
    else if (b.movedOut && r < b.prevR - 1e-3) b.wentOut = true;
    b.prevR = r;
    const E = -b.mt;
    if (b.wentOut && E < 1 && r < st.rt) {
      // fallen back inside the disruption site: eaten by the disk
      b.bright *= Math.exp(-dt / 80);
    } else if (E >= 1 && r > 45) {
      b.bright *= Math.exp(-dt / 150); // unbound: leaves the scene
    }
    if (b.bright < 0.02) b.alive = false;
    b.size = Math.min(b.size + 0.0006 * dt, 0.55); // the stream spreads
  }
}

/** Bodies currently worth uploading to the shader. */
export function aliveBodies(st: TdeState): TdeBody[] {
  return st.bodies.filter((b) => b.alive);
}
