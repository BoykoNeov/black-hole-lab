# Slice 13 plan — the light the continuation was already carrying

Closes the second half of **hurdle H1** (`docs/ROADMAP.md`). Slices 11 and 12
gave a budget-exhausted ray a real escape direction and a real winding; what
they did not give it is the *light* it collects after the march stops. The ray
keeps crossing the equatorial plane during the continuation, and every one of
those crossings is a pass through the accretion disk that nothing currently
shades.

**This plan contradicts the H1 entry it closes, and correcting that entry is
part of the slice.** H1 predicts a divergent series that has to be summed
analytically — "radius sequence from the near-critical expansion". The
measurements below say there is no series to sum: the crossings that reach the
disk are one, two or three per pixel, they are already computed by the loop
that is running, and the reason H1 expected otherwise is a radius it did not
check. Everything else in H1's paragraph is right, including the sentence that
turned out to be the whole answer: *"they are exactly where `u` changes sign,
which it computes anyway."*

---

## Why H1's series does not exist

A ray that hovers at the photon shell crosses the equator once per half-orbit,
at a radius converging geometrically to the photon orbit's. That is true, and
it is what H1 describes. It is also invisible, because **the photon orbit is
inside the disk's inner edge**:

| a | equatorial photon orbits (pro/retro) | ISCO = disk inner edge |
| --- | --- | --- |
| 0 | 3.000 / 3.000 | 6.000 |
| 0.9 | 1.558 / 4.330 | 2.321 |
| 0.998 | 1.074 / 4.000 | 1.237 |

At a = 0 every hovering crossing lands at r = 3 in a disk that starts at r = 6,
so the whole geometric tail emits exactly nothing. The disk light a band ray
really misses is the handful of crossings on the **outbound leg**, where r
climbs back out through the disk — an O(1) count, not a series. Only at high
spin does any of the hovering itself land on the disk, and then because the
ISCO has dropped below the retrograde photon orbit rather than because the
series converges more slowly.

## What was measured before this plan was written

Every number below came out of CPU experiments against `traceRayKerr` and the
existing `src/mino.ts`, at the default camera (yaw 0.6, pitch 0.15, r = 25,
60 deg) over a 1280x800 grid, before any code was changed.

**How many crossings the continuation makes on the disk**, sampled every 12th
row, every 2nd column:

| a | band px | equatorial crossings during the continuation | of those, on the disk | per-pixel gain |
| --- | --- | --- | --- | --- |
| 0 | 3 | 0 | 0 | all zero |
| 0.9 | 72 | 51 | 34 | 38 px gain 0, 34 gain 1 |
| 0.998 | 149 | 154 | 133 | 53 gain 0, 63 gain 1, 29 gain 2, 4 gain 3 |

The a = 0.998 crossings pile up at r ~ 1.5 against an ISCO of 1.237 — which is
where the temperature profile peaks (49/36 x ISCO = 1.68), so they are not a
faint tail, they are the hottest part of the disk seen through the most
winding.

**How much light that is**, as a bolometric proxy `sum (Tn(r) g)^4` over a
band pixel's crossings, sampled every 7th row:

| a | band px | gain disk light | *saw no disk crossing at all* in the march | added / already had (median) |
| --- | --- | --- | --- | --- |
| 0 | 6 | 0 | 4 | — |
| 0.9 | 248 | 116 | 98 | **1.77** |
| 0.998 | 510 | 325 | 47 | **0.92** |

So at a = 0.9 the continuation roughly triples the disk light on the pixels
that had any, and 98 band pixels currently render as sky that should be
carrying a disk image. At a = 0.998 it roughly doubles it. At a = 0 it changes
nothing at all, which is the honest headline and the reason this hurdle went
unnoticed for so long: the default screenshot is a slow spin.

**The covariant momentum can be rebuilt from a separated state.** The
continuation carries five scalars and no metric, so it does not have the
`mv` that `shadeCrossing` wants. Rebuilding it (mechanism below) and comparing
against the march's own `mv` at the handoff point, over band rays at the
default camera:

| a | handoffs | worst relative `mv` error | worst position gap | worst \|H\| |
| --- | --- | --- | --- | --- |
| 0.9 | 15 | 1.16e-4 | 4.0e-15 | 2.7e-15 |
| 0.998 | 31 | 1.49e-4 | 4.0e-15 | 1.1e-14 |

1e-4 is the march's own drift at 320 steps, not an error in the
reconstruction — the rebuilt momentum is null to 1e-14, i.e. exactly, which the
march's is not. Agreement any closer than 1e-4 would have been evidence of a
mistake.

**The crossings themselves, against a converged march.** For each band ray,
`traceRayKerr` at 400,000 steps produces the true crossing list; its entries
past the short march's exhaustion are what the continuation must reproduce:

| a | band rays | crossing count mismatches | worst dr/r | worst position gap | worst dg/g |
| --- | --- | --- | --- | --- | --- |
| 0.9 | 41 | **0** | 1.70e-3 | 1.0e-2 | 1.59e-3 |
| 0.998 | 78 | **0** | 2.11e-3 | 1.5e-2 | 4.57e-4 |

Not one ray gains or loses a crossing. The residual 2e-3 in radius is the
continuation's own step accuracy, and it is worth ~1% in a brightness that goes
as the fourth power — well under the turbulence the same crossing is multiplied
by.

**Locating the crossing inside a step needs nothing clever.** Linear
interpolation on `u` across the step, then one sub-step to that fraction,
lands with |u| residual 1.4e-6 to 2.7e-6. A quadratic fit through (u0, pu0, u1)
changes every number in the table above by less than its last printed digit.
Linear it is — and it is what the march does, so the two agree by construction
rather than by coincidence.

---

## The mechanism

### Where the crossing is

Inside `continueToEscape`'s loop, take the state before and after a step. If
`s.u` and `sN.u` straddle zero, the ray crossed the equatorial plane during
that step, at fraction `fr = s.u / (s.u - sN.u)`. Re-step from `s` by `h * fr`
and **snap `u` to exactly 0**: that is what a crossing is, and it makes the
reconstructed position lie in the plane exactly rather than nearly.

The Boyer-Lindquist radius of the crossing is then the state's own `r`, with no
inversion needed — `minoToCartesian` at `u = 0` gives

```
pc = (sqrt(r^2 + a^2) cos az, 0, sqrt(r^2 + a^2) sin az)
```

and the march's own reconstruction `rc^2 = |pc.xz|^2 - a^2` returns `r^2`
identically. So the two sides agree on what radius means without a second
formula.

### The covariant momentum

`shadeCrossing` wants `(mt, mv)`: `mt` is conserved and already in scope, and
`mv` is the covariant spatial momentum, which the separated system does not
carry. Rebuild it in three steps.

1. **Contravariant spatial part.** `minoToCartesian` returns `d(pos)/dtau`, and
   Mino time is `dtau = dsigma / Sigma`, so `V^i = vel^i / Sigma` with
   `Sigma = r^2 + a^2 u^2` is the affine tangent at the E = 1 normalization the
   potentials are written in.

2. **Time component, from the null condition.** With
   `L = l . V`, `V2 = |V|^2` and Kerr-Schild's `f`, `g_munu V^mu V^nu = 0` is a
   quadratic in `V^t`:

   ```
   (f - 1) T^2 + 2 f L T + (f L^2 + V2) = 0
   ```

   Two roots, one per time orientation; take the one whose lowered time
   component has the same sign as `mt`. Solved in the numerically stable form
   (`q = -(B + sign(B) sqrt(disc)) / 2`, roots `q/A` and `C/q`) because `A`
   passes through zero: `f = 1` is exactly the ergosphere, which these rays
   really do cross, and the naive formula divides by it.

   The obvious alternative — solving the *linear* constraint
   `m_t = g_(t mu) V^mu` for `V^t` — is the trap. It gives
   `P = (l.V - m_t) / (1 - f)`, singular on the same surface with no second
   root to fall back on. The null condition is what stays finite there.

3. **Lower and rescale.** `lower(pc, a, [T, V])` gives the covariant momentum
   at E = 1; multiply the spatial part by `mt / m_t` so it lands at the march's
   own normalization. Every shift factor in the lab is homogeneous of degree
   -1 in the momentum, so this scaling is exactly what makes the continuation's
   crossings shade identically to the march's.

That buys `shadeCrossing` **verbatim**: the disk sheet, the gas blobs riding on
it, and slice 10's polarization, with no second shading path to keep in step.

### The compositing order

The continuation runs from the march's exhausted state *outward along the same
ray*, so its crossings are strictly behind everything the march already
composited. Front-to-back accumulation therefore just continues: the same
`accum` and `thru`, in the same order, with no sorting and no re-entry.

---

## The sub-slices

### 13a — the crossings, on the CPU

`src/mino.ts`: `MinoResult` grows a `crossings: MinoCrossing[]` with the same
shape as `KerrCrossing` (`r`, `pos`, `g`, `mv`), collected when
`opts.mt` is supplied and skipped entirely when it is not — existing callers
pay nothing, and `mt` is the one thing the separated system genuinely cannot
know.

Tests (`test/mino.test.ts`):

- the rebuilt `mv` at the handoff state against the march's own, at a = 0.9 and
  a = 0.998, to the march's drift and no closer;
- the rebuilt momentum is null to float64;
- crossing count, radius, position and `g` against `traceRayKerr` at 400,000
  steps, on band rays past the short march's exhaustion — this is the slice's
  real acceptance test;
- `rc^2 = |pc.xz|^2 - a^2` round-trips to `r^2`;
- **no crossing hides inside an axis passage.** A passage fires only at
  `1 - u^2 < MINO_AXIS_V`, i.e. `|u| >= 0.9985`, and reflects `pu` with `u`
  untouched, so `u` cannot reach zero inside one. Assert it on the pitch-clamp
  cameras where passages actually fire, rather than reason it here;
- a = 0 gains nothing, and a = 0.9 / 0.998 gain what the table above says. A
  test that only sweeps a = 0 passes on a broken implementation.

### 13b — the GLSL mirror

The same detection and the same reconstruction inside the shader's continuation
loop, calling the existing `shadeCrossing` and the existing polarization block.
Two decisions to make deliberately and identically on both sides:

- **The refinement sub-step is charged against the budget.** The ladder's
  magenta means one thing — the continuation spent `MINO_MAX_STEPS` — and
  slice 12 was already bitten by a cap 29 steps too small. At most 3 extra
  steps against 1536 with 750 of headroom, so the risk is nil and the parity is
  worth more than the steps.
- **No early-out on low `thru`.** The sky direction and the winding are still
  wanted even when the disk has gone opaque; only the shading work is skipped.

### 13c — `npm run band`

The instrument H1 names. The existing hairline scan is unaffected (it runs with
the disk off), so this adds a disk-on check: at band pixels the CPU says gain
light, the drawn frame must actually be brighter than the sky it sits on, and
at the **band boundary** — where the march just barely finishes on one side and
just barely does not on the other — the seam must be gone. The boundary claim
is the sharp one, because the two sides receive the same crossings by
construction; measure the jump against the local gradient of the disk image
first, the lesson `MAX_GRADIENT` already encodes for hairlines, and fall back
to per-pixel luminance against the CPU crossing list if the seam is not
separable from the gradient.

---

## Scope, stated rather than silently taken

- **Matter along the continuation path** — orbiting stars, the jets, TDE debris
  — is not integrated. Those are volumetric emitters sampled per march step,
  not per crossing, and carrying them would mean running the whole matter
  sampler in the second loop. The disk is what H1 is about.
- **The march is unchanged.** Nothing here alters what a ray that finishes
  inside its budget sees, so every existing frame outside the band is
  bit-identical.
- **`rayCaptured` stays the sole authority on fate.** This slice adds light
  along a path whose ending was already decided; it does not get a vote.

## Acceptance

1. `npm test` — the 13a oracles above, anchored at a = 0.9 and a = 0.998.
2. `npm run band` — the tripwire still reads **zero** pixels of the
   continuation-capped colour at all five views, the hairlines still match, and
   the new disk-on check passes.
3. `npm run build` clean.
4. `docs/ROADMAP.md` H1 rewritten to what the measurements say, and marked
   closed; `docs/DESIGN.md` carries the numbers and the two rejected
   alternatives (the geometric series, and the linear constraint for `V^t`).
