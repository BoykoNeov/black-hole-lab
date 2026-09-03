# Roadmap and open hurdles

What has been built, slice by slice; what is known to be approximate, exact,
or wrong, and by how much; and what is queued. `README.md` says what the lab
does and where the code is, `docs/DESIGN.md` says why each slice is the way it
is. This file is the plan. Update it when a slice lands or a hurdle moves.

Units are geometrized (G = c = M = 1) throughout.

## Slices landed

1. **Lensed sky** — shadow, photon ring, Einstein-ring star warping, HDR bloom ✅
2. **Accretion disk** — temperature colors, doubled image, Doppler asymmetry ✅
3. **Matter in motion** — orbiting stars, infalling gas, relativistic jets,
   time controls ✅
4. **Real physics upgrade** — Kerr per-pixel integrator, exact
   beaming/redshift, true plunge kinematics inside the ISCO ✅
5. **Physics-coupled behavior** — mass & accretion-rate sliders drive the
   disk temperature, physical-unit readouts, tidal disruption events with
   geodesic debris streams and a t^(-5/3) flare ✅
6. **Educational overlays** — clocks, potentials, physical-vs-artistic knob
   labels, embedding diagram, orbit trails, shadow/photon-ring annotation,
   callout mode (6a–6g) ✅
7. **Schwarzschild vs Kerr** — split-screen at a = 0 against the slider's a
   from one camera; per-side outline, insets, trails and shadow-edge label
   (7a–7e) ✅
8. **The photon ring's ladder, part one** — γ, the photon orbit's Lyapunov
   exponent, and the discovery that the same γ set where the march budget ran
   out and painted escaping light black (~50 px on the a = 0.998 prograde
   edge). 8a settles a ray's fate from its conserved λ and Carter q instead of
   from the march: exact, step-free, and the rendered shadow is finally a D ✅
9. **The ladder, drawn; the outline, exact** ✅
   - 9a the capture criterion was blind to the launch direction: it called
     every outward-moving ray captured. Harmless from the default camera,
     wrong from r = 3.2 at high spin, where the camera sits inside the
     retrograde photon orbit and an outward ray can wind at it and fall
     back — or squeeze past. `rayCaptured` and the GLSL now read the sign of
     dr/dσ at launch; pinned against 20000-step traces over the whole sphere
     of launch directions from that camera ✅
   - 9b 6f's outline asks `rayCaptured` instead of marching 4000 steps per
     sample: exact where it was ~0.6 px out, ~1000 cubic solves instead of
     ~540 ms of tracing, 96 azimuths instead of 48, and it follows the camera
     live — the debounce, the time-slicing and the stale-outline fade are
     gone with the cost that justified them ✅
   - 9c the ladder view: a shader mode that false-colours every pixel by the
     half-turns its ray swept around the hole (kerr.ts's `winding`), with a
     hairline at each whole turn and the scene's own luminance kept as
     brightness. The rungs crowd geometrically toward the critical curve at
     e^(−γ) per half-turn, which is the ladder made visible; the band of rays
     still winding when the budget ends is drawn as what it is (fate exact,
     colour not) rather than passed off as sky. A HUD legend names the bands
     and quotes e^(−γ) per edge at the current spin ✅

10. **Polarization** — the disk's light carries a direction of vibration,
    and Kerr turns it ✅
    - 10a the Walker–Penrose constant, which a polarization dragged along a
      null geodesic keeps. So the whole trip from the disk to the camera
      costs two closed forms and nothing per march step — transporting the
      vector instead would have roughly doubled the hot loop. Written in
      Cartesian Kerr–Schild rather than Boyer–Lindquist: the `1/Delta` that
      blows up on the horizon cancels identically, and the piece that is
      singular on the spin axis expands to a polynomial. The camera is at
      finite r, so the textbook screen formulas do not apply; its own two sky
      legs are used as a basis instead, which is exact at any radius. Pinned
      against a parallel transport built from central-differenced metric
      derivatives — deliberately not the analytic ones the integrator uses,
      so a shared sign error cannot cancel itself ✅
    - 10b the emitter: electron scattering in the disk's surface, which
      polarizes parallel to that surface. The direction is exact geometry (a
      4-cross product, and a director, so no handedness is left to get
      wrong); only the polarized fraction is fitted — see H8. Each disk
      crossing is resolved and added as Stokes parameters weighted by its own
      brightness, so two images overlapping with their planes turned
      differently genuinely depolarize ✅
    - 10c the ticks: a second attachment on the scene target carrying the
      screen-basis Stokes pair (not an angle — the target is filtered, and
      only a linear quantity survives that), and a composite pass drawing one
      mark per grid cell, sampled at its own centre. Length is the polarized
      fraction; marks fade with the disk's own light. `npm run pol` measures
      the marks actually drawn and recomputes each on the CPU: mean 0.24°,
      worst 1.20° ✅

11. **Closing the band** — a ray still winding when the march's budget ends
    no longer takes the sky at whatever direction it happened to be pointing ✅
    - 11a `src/mino.ts`: the continuation, in the separated system where the
      radial and polar motions are independent 1-D polynomial problems. The
      deepest band ray needs 291,419 steps of a converged march and finishes
      here in 786. The constants come from the LAUNCH, not from the drifted
      exhausted state — worth 0.68° against 0.00024° on that ray, and the
      difference plateaus rather than shrinking, which is what a convergence
      test catches and an absolute threshold does not ✅
    - 11b the GLSL mirror, wired into the one place the renderer still guessed.
      The magenta rung stops meaning "budget spent" and becomes a tripwire for
      the continuation spending its OWN budget ✅
    - 11c `npm run band` — landed with slice 12, which needed the same
      instrument ✅

12. **The pole the continuation could not cross** — hurdle H9, closed ✅
    - 12a `axisPassage`: the whole polar passage near the spin axis in closed
      form, so the half-turn of azimuth that no step size can find is not
      integrated at all. The substitution v = v_min + √D·w² cancels the turning
      point identically and leaves no 1/a anywhere, so it holds at zero spin
      too — where the band and its pole crossings are real (384 band pixels at
      a = 0 from the default camera). 43 near-axis band rays at 60 cameras go
      from a worst 156.197° to 1.27e-4°, and 1255 rays away from the axis do
      not move (worst 4.0e-6°, no step count changing). Two guards the
      measurement insisted on: a ray may LEAVE before its swing finishes (14°
      if jumped anyway) and a step may leap the trigger window (155°) ✅
    - 12b the GLSL mirror, and the near-axis legend row removed — there is no
      longer a class of ray the chart cannot follow ✅
    - 12c `npm run band`: the tripwire reads zero at five views, and 36
      whole-turn crossings match the CPU's own winding to 0.027 half-turns,
      which is the float32 answer the unit tests cannot reach ✅

13. **The light the continuation was already carrying** — hurdle H1's second
    half, closed ✅
    - 13a a ray still winding when the march's budget ends goes on crossing the
      equatorial plane, and those crossings are passes through the disk that
      nothing shaded. `continueToEscape` collects them, given the march's own
      m_t — the one thing the separated system cannot recover, since lambda and
      q are quotients and the normalization drops out. Rebuilding the covariant
      momentum from five scalars and no metric is the one place a sign or a
      scale could go wrong: V^t comes from the null condition, NOT from the
      linear constraint m_t = g_(t mu) V^mu, which divides by 1 - f and f = 1 is
      the ergosphere these rays cross. Pinned at the handoff against the march's
      own mv (1.4e-4, the march's drift) and, over 22 crossings of a 50x-refined
      march, not one gained or lost: radius 1.6e-4 of itself, shift 1.6e-5 ✅
    - 13b the GLSL mirror, calling the same `shadeCrossing` — so the gas blobs
      and slice 10's polarization come with it rather than needing a second
      shading path. The refinement sub-step is charged against the budget on
      both sides, deliberately: the ladder's magenta means one thing ✅
    - 13c `npm run band`: band pixels the march leaves with no disk light of
      their own, split by whether the continuation finds them any, differenced
      across the disk toggle. Bloom makes an absolute brightness meaningless
      here; the two groups sit a few pixels apart in the same bloom and separate
      by two orders — 0.10 of full luminance against 0.0000 at a = 0.9 ✅

## Open hurdles

Each entry: what is approximate, how big the error is, and the concrete path
to closing it. Ordered by how much of the picture they touch.

### H1 — the ring's inner rungs were under-lit

**Status: closed — the first half by slices 11 and 12, the second by slice 13.**
A budget-exhausted ray no longer takes the sky at whatever direction it happened
to be pointing (11, 12), and it no longer loses the disk light it collects on
the way out (13).

**This entry used to predict the wrong fix, and the correction is worth keeping.**
It said the remaining crossings had to be summed analytically, from the
near-critical expansion, because they keep coming as the ray winds and the step
count diverges. The series is real and it is invisible: those crossings converge
on the photon orbit, and at low spin the photon orbit is INSIDE the disk's inner
edge — r = 3 against an ISCO of 6 at a = 0, so the whole tail emits nothing.
What a band ray actually misses is the handful of crossings on its OUTBOUND leg,
one to three per pixel, and only at high spin does any of the hovering itself
reach the disk (the ISCO drops below the retrograde photon orbit at r ~ 4). No
series, no expansion: detect the sign change of `u` in the loop already tracking
`u`, and shade it. The sentence the entry got right is the one that turned out
to be the whole answer — *they are exactly where `u` changes sign, which it
computes anyway.*

Measured before the slice was written, at the default camera: at a = 0.9, 116 of
248 band pixels gain disk light and 98 of those had none at all; at a = 0.998,
325 of 510, roughly doubling what the march saw. At a = 0 nothing changes, which
is why this looked cosmetic for so long — the default screenshot is a slow spin.

Matter along the continuation path (stars, jets, TDE debris) is still not
integrated; those are volumetric emitters sampled per march step rather than per
crossing. See `docs/DESIGN.md` for the derivation, for why V^t comes from the
null condition rather than the linear constraint, and for what a rendered frame
can prove about any of it.

### H9 — the continuation could not follow a ray over the spin axis

**Status: closed by slice 12.** The separated chart is singular on the spin
axis, and a ray crossing the pole has to swing its azimuth by very nearly π
inside a Mino interval of order 2e-5 — at λ exactly zero the term λ/(1 − u²) is
0/0, so the crossing degenerated into a *reflection* at any step size. Slice
11a flagged those rays rather than guessing; slice 12 takes the whole passage
in closed form instead of stepping through it.

The fix is not the arcsin form this entry used to record. That one divides by
the spin, and a = 0 has band rays and pole crossings of its own. Substituting
v = v_min + √D·w² cancels the turning point's 1/√U identically and leaves no
1/a anywhere; in that variable the passage is a straight line in the tangent
plane at the pole, so an arctangent is the whole answer and the π falls out as
a limit that survives λ = 0. See `docs/DESIGN.md` for the derivation and for
the two guards measurement added around it.

Measured: worst direction error over 43 near-axis band rays at 60 cameras,
156.197° → 1.27e-4°, with rays away from the axis unmoved to 4.0e-6°.

### H2 — γ is quoted per equatorial edge, not around the ring

**Status: open, labelled honestly.** `photonOrbitLyapunov` is the exponent of
the two *equatorial* circular photon orbits. Off the equator the critical
curve is made of Carter-Q spherical orbits with their own exponents, so the
legend's two numbers bound the ring's spacing rather than give it pointwise.
Path: the Lyapunov exponent of a spherical photon orbit at radius r̃ is a
closed form in (r̃, a) (Johnson et al. 2020, eq. for γ(r̃)); parameterize the
critical curve by r̃, map each outline azimuth to its r̃ through (λ, q), and
draw γ along the dashed outline. Pure math, belongs in `edu.ts`.

### H3 — the Kerr embedding uses r as the circumferential radius

**Status: open, documented in the code.** `embeddingProfile` takes the
Boyer–Lindquist r as the circle's radius; the true equatorial proper
circumference is 2π√(r² + a² + 2a²/r). Exact at a = 0; the stricter embedding
does not exist in Euclidean 3-space over parts of a fast-spinning throat.
Path: plot with the true circumferential radius where the embedding exists and
mark the segment where it does not, rather than silently switching to r.

### H4 — the disk is a zero-thickness, zero-torque Novikov–Thorne sheet

**Status: by design, artistic knobs documented.** No vertical structure, no
self-shadowing, no radiative transfer; the turbulence is fbm. This is the
standard educational picture and every emitter's shift is still exact. A
thick-disk or slim-disk model is out of scope for a per-pixel geodesic
raymarcher without a radiative-transfer pass; not queued.

### H5 — no polarization

**Status: closed by slice 10.** The transport is exact and costs nothing per
march step, as predicted. What the slice does NOT deliver is the EHT's own
picture: that ring pattern is synchrotron from a magnetized flow, and this
disk is a zero-torque Novikov–Thorne sheet with no magnetic field in it. A
toroidal-field synchrotron emitter would be an artistic knob dressed as
physics on this disk, so it was not built; if it ever is, it belongs beside
the scattering model with a badge, not instead of it. What is left of this
hurdle is H8.

### H8 — the polarized fraction is a fit between two exact endpoints

**Status: open, labelled, and it moves lengths only.** How strongly a
scattering surface polarizes the light leaving it at angle mu to its normal is
Chandrasekhar's 1960 Table XXIV. The endpoints the lab uses are the real ones
— exactly 0 face-on, 11.7% grazing, the number the accretion-disk literature
quotes from that table — but the table itself was not obtainable from any
secondary source, so the curve between them is a `(1-mu)/(1+mu)` shape scaled
to meet them. Its worst plausible error is a couple of percentage points in
the middle of the range.

This is confined to tick LENGTHS. Every tick DIRECTION comes from the
4-cross product of the emitter's 4-velocity, the disk normal and the photon
direction, which is exact and carries no fitted number. Path: source Table
XXIV, drop it into `scatteringDegree` as data with an interpolation, keep the
two endpoint tests. Nothing else in the slice changes.

### H6 — float32 in the shader near the critical curve

**Status: measured, not a problem.** Slice 8 removed the cancellation in the
radial potential's constant term and measured the remaining float32 slop at
1e-4 px on the soft (prograde) edge. Nothing queued; this is a note so nobody
re-suspects it.

### H7 — the visual harness cannot run where playwright's pinned browser is not

**Status: worked around.** Playwright refuses any chromium build but the one
its release pins, which a sandbox or CI image may not have. `LAB_CHROMIUM`
points the harness at a preinstalled binary. Under software GL a frame is
tens of seconds, so the smoke test's fixed waits are tuned for a GPU; a
frame-count-based wait would make it portable.

## Queued

- **γ around the ring** (H2). Small. It touches the ladder legend, so it should
  not ride along with anything else that changes the same legend.
- **Chandrasekhar's table** (H8). Smaller still: source twenty numbers and
  replace a fitted curve with them. Tick directions do not change.
