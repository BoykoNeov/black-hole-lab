# Slice 11 plan — closing the budget-exhausted band

Closes the **first half of hurdle H1** (`docs/ROADMAP.md`): rays still winding at
the photon shell when `MARCH_MAX_STEPS` runs out currently take *the sky at
whatever direction they happened to be pointing when the budget ended*, which is
nothing like where they actually go. Slice 9c drew that band magenta so its
extent would be on screen rather than passed off as sky. This slice earns the
right to stop drawing it.

**The budget does not move.** `MARCH_MAX_STEPS` stays at 320. If this slice
worked by raising it, it would not have worked at all — the point of slice 8 was
that no finite budget reaches the edge.

---

## What was measured before this plan was written

Unlike the slice 6 plan, the physics below is not prose. Every number came out of
a CPU experiment run against `traceRayKerr` before the plan was written. Default
camera (yaw 0.6, pitch 0.15, dist 25, fov 30) at 1280x800 unless stated.

**The band is real, and one-sided.**

| edge | gamma | band width, 320 steps vs converged |
| --- | --- | --- |
| prograde (a = 0.998) | 0.19 | **54.1 px** at the equator, 39.0 px at ndc y = 0.25, 22.7 px at y = -0.4 |
| retrograde (a = 0.998) | 4.08 | 0.00 px |

**The worst ray in it is far past anything a march can buy.** Deepest sampled
prograde ray: 19.45 half-turns still to sweep at exhaustion, at r = 1.44 (horizon
1.063). The coarse march needs 4604 more steps; a march fine enough to hold the
Hamiltonian at 1e-12 needs **167,657**.

**A separated 1-D continuation finishes it in a few hundred cheap steps.** Over a
sweep of 105 genuinely budget-exhausted rays across a in {0, 0.5, 0.7, 0.9, 0.95,
0.998}, camera distance {3.2, 8, 12, 25, 380} and inclinations from edge-on to
exactly face-on:

| step scale (see below) | worst steps | worst direction error | worst winding error |
| --- | --- | --- | --- |
| 0.10 | 167 | 11.3 deg | 0.0026 half-turns |
| **0.05** | **325** | **1.04 deg** | 0.0066 half-turns |
| 0.025 | 651 | 1.19 deg — *no better* | 0.0070 half-turns |

The plateau below 0.05 is **not the continuation**; see "the oracle has to be
refined" under 11a. Against a properly refined reference the same rays come in at
0.01–0.3 deg, and on the deep-band ray the continuation lands at **0.012 deg**
where the coarse march it replaces is 0.036 deg out. On the rays that need it,
this is not merely cheaper than marching — it is more accurate, because it holds
the constants exactly instead of accumulating them.

**Winding stays monotonic.** Walking ndc inward toward the critical curve, 60
samples at each of a = 0.9 and a = 0.998: zero non-monotonic steps, reaching 56.2
half-turns at the deepest sample. This is the invariant a phase error breaks, and
it is the cheapest instrument in the slice.

**The spin axis is not a hazard.** A ray reaches `u = +-1` only if `lambda = 0`
exactly (the polar potential there is `-lambda^2`), and the `lambda/(1-u^2)` term
vanishes with it. Zero blow-ups over the sweep, including an exactly face-on
camera.

---

## The mechanism

Away from the march, a Kerr null geodesic **separates**. In Mino time
(`dtau = dsigma / Sigma`) the radial and polar motions are independent 1-D
problems, and with `u = cos(theta)` both potentials are polynomials. Squaring the
usual first-order equations once removes the square roots *and* all the
turning-point sign bookkeeping — the classic place these implementations break:

```
dr /dtau = pr    dpr/dtau = R'(r)/2 = 2 r^3 + c2 r + k
du /dtau = pu    dpu/dtau = U'(u)/2 = -2 a^2 u^3 + (a^2 - q - lambda^2) u
daz/dtau = dazBL - twist * pr
   dazBL = (a/Delta)(r^2 + a^2 - a lambda) - a + lambda/(1 - u^2)
   twist = 2 a r / (Delta (r^2 + a^2))
```

with `R = r^4 + c2 r^2 + 2 k r - a^2 q` (exactly `kerr.ts`'s `radialPotential`,
constant term and all) and `U = (1 - u^2) Theta = -a^2 u^4 + (a^2 - q -
lambda^2) u^2 + q`. Five scalars of state; no metric, no metric gradients, no
Kerr-Schild `f` and `l`. A step costs a small fraction of an RK4 march step,
which is where 167,657-to-325 comes from.

### The azimuth line — read this twice

Three sign decisions live in `daz/dtau`, and getting any of them wrong produces a
trajectory with **identical winding** and a wrong sky direction. Derive it in this
order:

1. **The Kerr-Schild twist is positive.** The Cartesian *prograde* azimuth is
   `phi_c = phi_BL + integral(a/Delta dr) + arctan(a/r)`, so
   `d(phi_c)/dr = a/Delta - a/(r^2+a^2) = +2 a r / (Delta (r^2 + a^2)) = +twist`.
   It is a function of position alone, so it is **odd in `dr`**: it flips with the
   radial direction and with nothing else.
2. **The world azimuth runs the other way.** `az = atan2(z, x)`, and prograde is
   `az` DECREASING (the convention `kerr.ts` has used since slice 2), so
   `az = -phi_c`. Both terms flip.
3. **The march carries the time-reversed tangent.** Everything odd in the
   traversal direction flips again: `dazBL` flips a second time (returning to its
   textbook sign), and so does `dr` — but `pr` is *already* the march's own
   radial rate, so the twist term keeps the single flip from step 2.

Net: `daz/dtau = dazBL - twist * pr`. Do not re-derive this from prose — assert
it. At the a = 0.998 prograde exhaustion state, the march's own
`daz/dsigma * Sigma / |m_t|` is **10.294255** and `dazBL - twist*pr` is
**10.294269**. That check is unfoolable and it is what settled the question;
11a's test 1 reproduces it. Getting the twist sign wrong is a ~30% error in the
azimuth rate at r = 1.4; getting step 2 wrong builds the mirror-image trajectory,
which passes every winding test there is.

### Where each input comes from — and why not from where it looks like it should

The continuation starts from the exhausted march, but takes **only its phase**:
`r`, `u`, `az` and the two signs `sign(pr)`, `sign(pu)`. Everything else comes
from the launch:

- **`lambda` and `q` come from the camera**, where nothing has drifted. The
  shader already computes them there (`lambdaC`, `qC`) for the capture test, so
  this is free.
- **`pr` and `pu` are re-projected** onto `sign * sqrt(R(r))` and
  `sign * sqrt(U(u))` with those exact constants, clamped at 0. This puts the
  continued ray back exactly on the null cone.
- **The Mino scale is `|m_t|`** — the conserved energy — never
  `Sigma |dr/dsigma| / sqrt(R)`. The second is algebraically equal and
  numerically a trap: near a turning point `sqrt(R)` is tiny and the drifted
  march makes the quotient garbage. Using it produced a 4.9 deg error on an
  a = 0.7 ray that vanished the moment it was replaced by `|m_t|`.

Taking the constants from the exhausted state instead costs an order of magnitude
where it matters most: on the deep-band ray, **0.68 deg against 0.00024 deg**, and
it *plateaus* — refining the step does not help, because the drifted constants are
the error floor. By 320 steps the march has drifted the Hamiltonian to 3.6e-6,
which near a turning point is a percent of the radial potential, and that shifts
the phase exponentially.

### Step control follows the oscillators, not the clock

```
h = min( STEP_SCALE / max(omega_u, omega_r),
         0.08 * max(r,1) / |pr|,
         0.08 / |pu| )
omega_u = sqrt(|6 a^2 u^2 + q + lambda^2 - a^2|)
omega_r = sqrt(|6 r^2 + c2|)
```

**A flat step cap is wrong and the plan originally had one.** It gets tuned to
whatever rays you happened to sample. The near-equatorial band rays have small
Carter `q`; off the equator `q` reaches 20-25 and the polar swing runs 2-3x
faster. A cap that gave 0.012 deg on the first set gave **129.7 deg** on the
second — and converged cleanly to 0.23 deg when the step was cut, so it was never
a bug, only a badly chosen control. The two `omega` are just
`|d(acceleration)/d(coordinate)|` for each oscillator; the other two bounds stop
overshoot at large `r`, where `pr` grows like `r^2`.

---

## Scope

**In:** the escape direction, and the remaining swept angle, for rays the march
leaves unresolved.

Both, not just the first. The ladder view (9c) colours by winding, and an
exhausted ray's winding is truncated exactly as its direction is. Fixing only the
direction would turn magenta pixels into pixels of the *wrong rung* — the band
would vanish from the legend while the view went on lying, in a colour that no
longer announces itself. The continuation produces both from one integration.

**Out, and stays in the roadmap as H1's second half:** *ladder-aware disk
lighting*. An exhausted ray also misses the equatorial crossings its later
half-orbits would have made, so the ring's inner rungs stay under-lit. Separate
defect, separate oracle; bundling it would let the acceptance test pass while the
second half was wrong. Note for whoever picks it up: the continuation crosses the
disk exactly where `u` changes sign, so it already knows where those crossings
are — what is missing is the shift factor and the compositing order, not the
geometry.

**Also out:** H2 (gamma around the ring) and H8 (Chandrasekhar's table). The
roadmap suggests H2 could ride along; it should not. It touches the same legend
this slice is about to change, and two independent claims landing in one legend
is how a wrong one gets through.

---

## 11a — `src/mino.ts`, the continuation and its oracle

New tested module, mirrored by `test/mino.test.ts`. Pure math, so it belongs in a
module, not in `main.ts` (`CLAUDE.md`).

**Files:** `src/mino.ts` (new), `test/mino.test.ts` (new), `src/kerr.ts` (read
only — `raise`, `rayConstants`, `radialPotential`, `ksRadius`, `horizonRadius`
are all already exported; nothing new needs exporting).

**Exports:**

- `MinoState` — `{ r, pr, u, pu, az }`.
- `RayPotentials` — `{ lambda, q, k, c2 }`, built once per ray.
- `polarPotential(u, C, a)` — `U(u)`, the polar partner of `radialPotential`.
- `minoStateAt(pos, mCov, a, C)` — phase from a marched state, momenta
  re-projected against `C`.
- `minoStep(state, C, a, h)` — one RK4 step of the five-scalar system.
- `continueToEscape(state, C, a)` — `{ escaped, capped, dir, swept, steps }`,
  running to `r > 64` outgoing (the shader's own escape radius) or the horizon.
- `MINO_STEP_SCALE = 0.05` and `MINO_MAX_STEPS = 512`, here for the same reason
  `MARCH_MAX_STEPS` lives in `kerr.ts`: the GLSL interpolates them and the tests
  assert against them, and the numbers only mean anything if all three agree.
  512 is the measured worst case (325) with headroom, not a guess; a cap that
  clips at some spin nobody sampled resurrects the magenta band and looks like a
  physics bug. If 11c's frame-time measurement objects, relax `MINO_STEP_SCALE`
  to 0.1 (167 steps) before touching anything else.

### The oracle has to be refined, not just long

`traceRayKerr` with `maxSteps: 400000` is **not** a converged reference. It still
uses the renderer's own `stepLength`, so on near-critical rays it is 0.23-0.97 deg
out from a step-refined march — which is exactly the size of the residual the
continuation was being blamed for. Chasing that plateau by shrinking
`MINO_STEP_SCALE` cost a whole experiment and moved nothing.

So the test oracle is a march with the arc-length target **scaled down 50x**
(`hamiltonian` ~1e-13 at the end, against ~1e-6 for the coarse one), run from the
camera. It still shares no code with the continuation — it is `rk4Step` in
Cartesian Kerr-Schild, the same discipline as slice 10's central-differenced
transport check. Assert `hamiltonian` on the reference in the test itself, so a
future change to `stepLength` cannot silently un-converge the oracle.

**Tests:**

1. **The azimuth-rate identity.** At the a = 0.998 exhaustion state, the march's
   own `daz` and `dazBL - twist*pr` agree to 1e-5 relative. One assertion, and it
   pins all three sign decisions at once.
2. **Direction and winding against the refined oracle.** Sample the band at
   a = 0.9 and a = 0.998; per ray compare both the escape direction and
   `short.winding + swept`. Worst direction error < 0.5 deg, worst winding error
   < 0.01 half-turns.
3. **Convergence in `MINO_STEP_SCALE`.** The error must *fall* as it shrinks.
   This is what caught the constants-source problem: the wrong variant passed an
   absolute threshold and then plateaued.
4. **The invariants it is built on.** Along the whole continuation,
   `pr^2 = R(r)` and `pu^2 = U(u)` to a relative 1e-6 (measured: 1.2e-7 at
   scale 0.05). Needs no march at all.
5. **The direction check is not redundant with the winding check.** Deliberately
   negate the reconstructed `z` component and assert that the winding test still
   passes while the direction test fails. This pins the mirror blind spot as a
   property of the suite, at the same fixed spin, with no new code paths. (Do
   *not* test this by running `a -> -a`: nothing in this codebase runs negative
   spin, and a failure would be ambiguous between the continuation and
   `kerr.ts`.)
6. **Monotonic winding across the band.** At a = 0.9 and a = 0.998, walk ndc
   inward toward the critical curve and assert `short.winding + swept` never
   decreases, over ~60 samples reaching >50 half-turns. Hundreds of rays for the
   price of no oracle at all, and it is the invariant a phase error breaks.
7. **Off-equator and on-axis.** Exactly face-on (`lambda = 0` rays) and
   near-face-on must both come back finite under the same bound. The
   near-face-on rays are where the flat step cap failed; they must stay in the
   suite.
8. **Fate never disagrees with `rayCaptured`.** A cross-check, not the source of
   truth — see 11b.

---

## 11b — the GLSL mirror, and the wiring

**Files:** `src/shaders.ts`.

The shader already has `carterQ`, `radialPotential`, `ksRadius`, and
`lambdaC`/`qC` at launch. Add `polarPotential`, the five-scalar RK4 and the
Cartesian reconstruction beside them, generated from the same constants as 11a so
the two cannot drift.

Wire it into the one place that currently guesses — the `if (!settled)` branch:

```
if (!settled) {
  if (capturedByConstants(lambdaC, qC, rCam, outward)) { /* black, as now */ }
  else {
    continue the ray;  sky = its direction;  swept += its swept
    unresolved = the continuation also hit its cap
  }
}
```

Three rules for that branch:

- **`rayCaptured` stays the sole authority on fate.** The continuation supplies
  colour and winding only. If they ever disagree, the capture criterion wins: it
  is exact and closed-form, the continuation is an integration.
- **Run it only when the march spent its budget.** The march also breaks early —
  through the horizon, or on a non-finite radius. Those states are garbage
  (measured: `|mv|` of 4e4 and a Hamiltonian of 3.8e8 on rays the capture
  criterion correctly calls captured) and must never be fed to the continuation.
  `settled` already distinguishes them; keep it that way. The CPU sweep that
  ignored this counted 5295 "unresolved" rays where there were 105.
- **Keep `unresolved`, and relabel it.** It should now mean "the *continuation*
  hit its own cap". Change `LADDER_UNRESOLVED.label` with it — "budget spent —
  fate exact, colour not" becomes false the moment this lands. It becomes a
  tripwire rather than a feature: at every reachable setting it should be zero
  pixels, and the legend row should say so ("continuation capped — should never
  appear"). That is a deliberate choice over deleting it: the colour is the
  instrument this slice is measured with, and an instrument that reads zero is
  not dead UI, it is a passing check. Say which it is in `DESIGN.md`.

**Cost:** a second loop, entered by roughly 50 px of a 1280x800 frame. The band is
spatially coherent, so whole wavefronts either take it or skip it. Measure it
anyway — 11c.

---

## 11c — the measurement, and the docs

**Files:** `tools/visual/harness.mjs` (read), new `tools/visual/band.mjs` driven
by `npm run band` (mirroring `npm run pol`), `docs/ROADMAP.md`, `docs/DESIGN.md`,
`README.md`, `package.json`.

Test 6 above already covers phase continuity on the CPU, over far more rays than
a scanline. What only the renderer can answer is float32 and frame time:

1. **Extent.** In ladder view at a = 0.998 from the default camera, count pixels
   matching `LADDER_UNRESOLVED`. Before: ~50 px at the prograde edge. After:
   zero, with `uMaxSteps` unchanged at 320.
2. **Rung continuity on the rendered frame.** Scan horizontally across the old
   band boundary and check the rung index rises monotonically with no jump where
   the continuation takes over. On the CPU this is exact (measured: zero
   non-monotonic steps); on the GPU a break means **float32**, which is the one
   question the CPU tests cannot reach.
3. **Frame time**, before and after, at the default view and at a = 0.998 — the
   band is where the cost is.

**Docs when it lands:** `docs/DESIGN.md` gets the rationale — why separated and
not a table over the critical curve (the roadmap's suggestion is under-specified:
the escape direction is not a function of `(lambda, q)` alone, because where the
photon freezes depends on the remaining Mino time and so on the phase at
exhaustion); why the constants come from the launch; why the step control follows
`omega`; and what the mirror and flat-cap mistakes cost. `docs/ROADMAP.md` gets
slice 11 in the landed list and H1 rewritten down to its second half.
`README.md`'s file map gets `src/mino.ts` and `npm run band`.

**One thing DESIGN.md must say plainly.** The rays this slice fixes are
exponentially sensitive to their own state — that is what `gamma` *means*. The
320-step prefix has already drifted before the continuation starts, so a given
band pixel is not guaranteed to show the star an exact computation would put
there. What is guaranteed is that it shows a correct member of the right
ensemble: a real escape direction of a real null geodesic with this ray's exact
constants, rather than a frozen mid-orbit snapshot. That region of sky is a
chaotic scattering region holding exponentially compressed copies of the whole
sky, and the point of the slice is that it now *looks* like one. Claiming
pixel-exactness there would be claiming something no method can deliver.

---

## Risks

- **float32 in the shader.** The radial acceleration `2 r^3 + c2 r + k` is a
  near-cancellation close to a double root, and the error is amplified by
  `e^(gamma * winding)` — ~36x over 19 half-turns at a = 0.998. H6 measured the
  existing float32 slop at 1e-4 px and found it harmless; this path is more
  exposed. It is measurable: 11c's rendered continuity check turns it into a
  broken staircase rather than an argument. If it bites, evaluate the radial
  acceleration in the shifted variable `(r - r_turn)`.
- **Divergence cost on the GPU.** If the second loop costs more than a few
  percent at the default view, relax `MINO_STEP_SCALE` to 0.1 and let the magenta
  band come back at reduced width — honest, and still a large improvement. Do not
  buy it back by raising `MARCH_MAX_STEPS`.
- **The mirror class of bug.** Winding is invariant under reflection and under
  several sign errors that wreck the direction. No test in 11a may assert on
  winding alone — test 5 exists to enforce that.
- **A badly chosen oracle.** Twice in this investigation an apparent error in the
  continuation was the reference being wrong: once the coarse-step march, once
  the `sqrt(R)` Mino scale. Before believing a failure, refine the oracle and
  check the error *moves*.
