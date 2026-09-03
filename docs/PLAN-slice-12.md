# Slice 12 plan — the pole the continuation cannot cross

Closes **hurdle H9** (`docs/ROADMAP.md`), which slice 11a registered rather than
guessed. `src/mino.ts` continues a budget-exhausted ray in the separated
(r, theta, phi) system, and that chart is singular on the spin axis: a ray that
passes over the pole must swing its azimuth by very nearly pi inside a Mino
interval of order 2e-5, and at `lambda` exactly zero the term `lambda/(1 - u^2)`
is 0/0, so the crossing degenerates into a *reflection* no matter how fine the
step. `continueToEscape` therefore returns `nearAxis` and the ladder view paints
those pixels their own colour — honest, and 115 of 14,147 band pixels over
fifteen cameras.

The roadmap recorded the shape of the fix in one paragraph. This plan is what the
measurements turned it into, and it is **closed form**: no quadrature, no extra
steps, and nothing that divides by the spin.

---

## What was measured before this plan was written

Every number below came out of a CPU experiment run against `traceRayKerr` and a
step-refined march before the plan was written.

**The defect, against a converged oracle.** 43 genuinely budget-exhausted band
rays whose closest approach to the axis is under 1e-2, collected over 60 cameras
(a in {0, 0.5, 0.9, 0.998} x pitch in {pi/2, 1.57, 1.5508, 1.5, 1.45} x distance
in {25, 8, 3.2}):

| | worst direction error | worst winding error |
| --- | --- | --- |
| today (`continueToEscape`, ignoring its own `nearAxis` flag) | **156.197 deg** | 1.7e-2 half-turns |
| with the passage below | **1.27e-4 deg** | 5.0e-4 half-turns |

**Rays that never come near the axis do not move.** 1255 band rays with closest
approach above 1e-2, at 48 cameras: worst direction change **4.0e-6 deg**, worst
winding change 6.2e-5 half-turns, and the step count changes on **no ray at
all**.

**The closed form against brute force.** The two passage integrals, evaluated by
Simpson at N = 2e6 in the regularized variable, over 4 spins x 6 `lambda` x 2 `q`
x 4 entry thresholds: relative error 3.5e-10 at an entry of 1e-4, 1e-6 at 1e-2,
2.5e-5 at 3e-2. At `lambda = 0` the brute-force integral is 0/0 and returns zero;
the closed form returns pi, which is the answer the geometry demands.

**The passage in isolation.** From an entry state at v = v_e inbound, the plain
five-scalar system stepped at h <= 1e-6 until v returns to v_e outbound, against
what the closed form claims: Mino time to 1e-5 relative, and at a = 0 (where the
regular part of the azimuth vanishes identically, so the comparison is clean) the
azimuth swing to 2e-6 absolute out of 3.14.

---

## The mechanism

With `v = 1 - u^2` the polar potential is a quadratic,

```
U = -lambda^2 + B v - a^2 v^2        B = a^2 + q + lambda^2
```

so the polar motion is confined between its two roots, and the small one is how
near the axis the ray can ever come — that is already `axisApproach`, and
`v_min = 2 lambda^2 / (B + sqrt(D))` with `D = B^2 - 4 a^2 lambda^2`.

The passage from `v_e` down to `v_min` and back out to `v_e` costs exactly

```
dtau      = integral(v_min..v_e)  dv / (sqrt(1-v) sqrt(U))
dazSing   = integral(v_min..v_e)  lambda dv / (v sqrt(1-v) sqrt(U))
```

and those already count **both legs**: substituting `du = -dv/(2u)` halves each
integral and the two symmetric legs double it.

### The substitution that makes it elementary

Put `v = v_min + sqrt(D) w^2`. Then

```
sqrt(U) = sqrt(D) w sqrt(1 - a^2 w^2)        dv / sqrt(U) = 2 dw / sqrt(1 - a^2 w^2)
```

The turning point's `1/sqrt(U)` singularity cancels identically, and — the part
that matters — **no `1/a` appears anywhere**, so the same expression holds at
`a = 0`, where the quadratic degenerates and every textbook form of this integral
divides by the spin. To leading order, with `w_c = sqrt(v_min/sqrt(D))` and
`w_e = sqrt((v_e - v_min)/sqrt(D))`:

```
dtau     = 2 w_e
dazSing  = 2 sgn sqrt((B + sqrt(D)) / (2 sqrt(D))) * atan(w_e / w_c)
```

and the O(v) corrections, which are what let the trigger sit at a threshold cheap
enough to reach:

```
dtau    += (a^2 + sqrt(D)) w_e^3 / 3 + v_min w_e
dazSing += lambda (w_e + (a^2/sqrt(D)) (w_e - w_c atan(w_e/w_c)))
```

That correction takes the Mino time from 1.7e-3 relative to 7.5e-6 at an entry of
1e-2. Nothing else is neglected above O(v^2), which is 1e-8 at the threshold this
slice uses.

### Why it is exactly pi, and why lambda = 0 is not a special case

`theta^2 ~ v = v_min + sqrt(D) w^2` and the azimuth swings as `2 atan(w/w_c)`: in
the tangent plane at the pole the passage is **a straight line at distance
`theta_min = sqrt(v_min)` from the pole**. So the full swing is pi in the limit,
and the swept angle over the passage is the length of that straight line — which
is why entry -> closest approach -> exit as two chords is *exact* here rather
than an approximation, and why the closest-approach point has to be included in
the swept accumulation rather than the endpoints alone.

The prefactor is `sgn * sqrt((B + sqrt(D))/(2 sqrt(D)))`, which is `sgn` exactly
at `lambda = 0`, and `atan(w_e/w_c)` is pi/2 there because `w_c` vanishes — so
write it `atan2(w_e, w_c)` and take `sgn = +1` at `lambda = 0`. The apparent
discontinuity between `+pi` and `-pi` is not one: **they are the same azimuth.**
The whole of H9 is that this limit exists and the ODE cannot see it.

### The passage is separable from the rest of the trajectory

Reflecting `pu` and jumping is exact, not an approximation, because:

- the polar motion is autonomous and **symmetric about its turning point**, so
  the ray leaves at the same `v_e` it entered with `pu` reversed;
- `dr/dtau` and `dpr/dtau` do not contain `u` at all — that is what separation
  means — and neither does the regular part of the azimuth,
  `(a/Delta)(r^2+a^2-a lambda) - a - twist*pr`.

So the radial pair and the regular azimuth are advanced over `dtau` by ordinary
RK4 (in two halves, because the closest-approach point is needed anyway), and the
singular azimuth is added in closed form. The only errors are the O(v^2)
truncation and RK4 on a two-scalar system over a Mino interval of ~0.02.

---

## The two guards measurement insisted on, and reasoning did not

**A ray may leave before the polar swing finishes.** Rays at r = 11 to 31 heading
out, with `v` dipping below the trigger on the way, are inbound in `u` and would
reach the pole — but they cross the escape radius first, at very nearly the same
Mino time. Jumping them through a crossing that never happens is worth
**14 deg**. So the passage is trialled first and **refused** if the radial
advance leaves the escape radius outgoing, after which the ray is stepped out the
ordinary way and the trial is not repeated: `pr > 0` past the escape radius is
monotone, so it cannot come back.

**A step may jump clean over the trigger window.** With no cap on how fast `v`
may fall, a single step goes from above the trigger to below the turning point,
the trigger never fires, and the ray reflects without its half-turn — **155 deg**
at a narrow trigger, 2.2e-2 deg at a wide one. A per-step cap on the *fractional*
fall in `v` fixes it and converges:

| cap on the fall in v per step | worst deg | worst steps |
| --- | --- | --- |
| none | 2.2e-2 | 551 |
| 0.6 | 2.1e-3 | 551 |
| 0.3 | 2.1e-4 | 551 |
| **0.15** | **1.3e-4** | **566** |
| 0.05 | 1.2e-4 | 804 |

**Slice 11's azimuth step bound is still load-bearing.** It is tempting to delete
`MINO_AZ_STEP` now that the sharp part is analytic; it watches the approach to
the trigger, not only the crossing. Worst error with the passage in place:
1.3e-4 deg at 0.025 (566 steps), 6.3e-4 at 0.1 (391), 5.8e-2 with the bound
removed (377). It stays at 0.025.

### The trigger threshold

The passage is exact at any threshold, so this is a pure cost/accuracy trade:

| trigger on 1 - u^2 below | worst deg | worst steps |
| --- | --- | --- |
| 1e-1 | 6.1 (fails) | 361 |
| 3e-2 | 4.8e-3 | 331 |
| 1e-2 | 1.0e-3 | 370 |
| **3e-3** | **1.3e-4** | **566** |

1e-1 fails for a reason worth recording: the passage's Mino time is then long
enough that `r` makes a large excursion during it, and neither the closed form's
O(v^2) truncation nor a 64-substep radial advance covers that. 3e-3 costs 566
steps against an ordinary deep-band ray's 1053 (below), so the step budget is not
what decides this, and the most accurate threshold is free.

---

## Scope

**In:** the escape direction and the swept angle for rays that pass over the spin
axis, and the removal of `nearAxis` — the flag, its constant, its ladder colour
and its legend row — because there is no longer a class of ray the chart cannot
follow.

**Also in, and it is not H9:** `MINO_MAX_STEPS` is 29 steps too small. Over a
full 1280x800 grid at fifteen cameras (57,104 band pixels), the worst ordinary
band ray — a = 0.998, pitch 0.15, distance 25, no pole passage anywhere in it —
needs **1053** steps against the cap of 1024, and two pixels there hit it. It is
pre-existing, it predates this slice, and it is in scope anyway because slice
11b's tripwire is the instrument this slice's acceptance test reads: a magenta
pixel has to mean "the continuation spent its budget" and nothing else. Raise the
cap to 1536 with the measurement recorded, do not touch `MARCH_MAX_STEPS`.

**Out:** H1's second half (ladder-aware disk lighting), H2 (gamma around the
ring), H8 (Chandrasekhar's table). Same reasoning as slice 11's plan.

---

## 12a — `src/mino.ts` and its oracle

**Files:** `src/mino.ts`, `test/mino.test.ts`.

**Exports:**

- `axisPassage(C, a, ve)` — `{ dtau, dazSing, vmin, we, wc }`, the closed form
  above. `axisApproach` stays: it is `vmin`, and the passage calls it.
- `MINO_AXIS_V = 3e-3` — the trigger, replacing `MINO_AXIS_EPS`. Different
  meaning as well as different value: the old constant was "below this we give
  up", the new one is "below this we switch to the closed form".
- `MINO_V_FALL = 0.15` — the per-step cap on the fractional fall in `1 - u^2`.
- `MINO_MAX_STEPS = 1536`.
- `MinoResult` loses `nearAxis` and gains `passages` (how many pole crossings
  were taken analytically), which the tests assert on so a passage that silently
  stops firing is a failure rather than a slow drift.

**Tests.** Keep all nine existing ones; the two `over the pole` fixtures stop
being `flagged` and join the accuracy assertions, and the two `guard boundary`
fixtures stay exactly where they are — they now pin that a ray *just* outside the
trigger and one just inside agree.

New:

1. **The closed form against a fine integration of the same passage.** Not
   against a formula rearranged by hand — against `minoStep` at h <= 1e-6 run
   from an entry state until `v` comes back, over a grid of (a, lambda, q, v_e)
   including a = 0. Mino time to 1e-4 relative; azimuth swing to 1e-4 at a = 0,
   where the regular part vanishes and the comparison is unambiguous.
2. **The pi limit, from both sides and at zero.** `dazSing -> +pi` as
   `lambda -> 0+`, `-pi` as `lambda -> 0-`, and exactly `+pi` at `lambda = 0`;
   assert that the two limits are the same azimuth (differ by 2pi) rather than
   asserting continuity, which is false.
3. **No 1/a.** `axisPassage` at a = 0 must be finite and match the fine
   integration to the same tolerance as at a = 0.998. This is the case every
   textbook form of the integral divides by zero on.
4. **The escape guard.** A fixture at r ~ 12 outgoing whose `v` dips below the
   trigger: assert that no passage is taken (`passages === 0`) and the direction
   is right. Without the guard this ray is 14 deg out, so it fails loudly.
5. **The v-fall cap.** Same ray set, run with the cap relaxed; assert the error
   gets *worse*. A guard nobody can make fail is not a test.
6. **Rays away from the axis are untouched.** A handful of ordinary band
   fixtures: direction change under 1e-4 deg and identical step count against the
   same code with the trigger set to zero.
7. **The step budget has headroom.** Worst fixture steps under
   `MINO_MAX_STEPS * 0.75`, and `MINO_MAX_STEPS > 1053`.

Test 5 of slice 11 — the mirrored trajectory that passes the winding check and
fails the direction check — matters more here, not less: a pole crossing is where
a sign error in the azimuth is easiest to make and hardest to see. It stays, and
the new fixtures go through it too.

## 12b — the GLSL mirror

**Files:** `src/shaders.ts`, `src/hud.ts`, `src/insets.ts`.

Mirror `axisPassage` and the passage branch beside the existing `minoStep` loop,
with the constants interpolated from `mino.ts` as they already are. Then delete
`LADDER_NEAR_AXIS`, its legend row and the `nearAxis` plumbing, and shrink the
legend panel by the row it grew in 11b.

Two things to get right in the mirror:

- `atan2(we, wc)` for the arctangent, not `atan(we/wc)`: `wc` is zero on the
  exactly-polar ray and float32 division by it is an infinity, not a limit.
- The radial advance is a bounded loop with its own step control. It must keep
  the horizon and escape-radius checks, because the refusal above depends on
  them.

## 12c — the measurement, and the docs

**Files:** new `tools/visual/band.mjs` driven by `npm run band`, `package.json`,
`docs/ROADMAP.md`, `docs/DESIGN.md`, `README.md`.

This is also slice **11c**, which never landed: the instrument slice 11's plan
asked for is the instrument that checks this slice, so it is built once and
checks both.

1. **Extent.** In ladder view, count pixels of the budget-spent colour and of the
   near-axis colour. Before: ~50 px of budget-spent at the a = 0.998 prograde
   edge before slice 11b, and 115 near-axis pixels over fifteen cameras. After:
   zero of each, with `uMaxSteps` unchanged at 320.
2. **Rung continuity on the rendered frame.** Scan across the old band boundary
   and across a near-axis pixel run, and check the rung index rises
   monotonically. On the CPU this is exact; on the GPU a break means float32,
   which is the one question the CPU tests cannot reach.
3. **Frame time**, before and after, at the default view and at the pitch clamp
   where the pole crossings live.

**Docs when it lands.** `docs/DESIGN.md`: why the substitution rather than the
roadmap's `arcsin` form (it divides by the spin; this one does not, and a = 0 has
band rays and pole crossings — measured, 384 band pixels and a passage at
a = 0); why the closest-approach point is in the swept sum; and what the two
guards cost when they are absent, because both were found by measurement after
the reasoning had already concluded. `docs/ROADMAP.md`: slice 11 and slice 12 in
the landed list, H9 closed, H1 rewritten down to its second half. `README.md`:
`npm run band`.

---

## Risks

- **float32 on the arctangent's argument.** `w_e/w_c` reaches 1e17 on the
  exactly-polar ray. `atan2` handles it; a division does not. 12c's rendered
  continuity check is what turns this into an observation rather than an
  argument.
- **The refusal could refuse too much.** If the escape trial rejects passages
  that should have been taken, the symptom is a near-axis ray drawn at the wrong
  rung with no colour announcing it — precisely the failure mode this slice
  removes. Test 4 pins the ray that must be refused; tests 1 and the fixture
  sweep pin the ones that must not.
- **A badly chosen oracle**, again. Three times in slice 11 an apparent error in
  the continuation was the reference. Twice more here: the 14 deg escape failure
  and the 155 deg overshoot both looked like the closed form being wrong, and
  both were the code around it. Before believing the closed form is wrong, check
  it against the fine integration of the passage alone — that comparison has no
  trajectory in it and no oracle to get wrong.
