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

## Open hurdles

Each entry: what is approximate, how big the error is, and the concrete path
to closing it. Ordered by how much of the picture they touch.

### H1 — the colour of the budget-exhausted band

**Status: open, now visible.** Rays near the critical curve are still winding
when `MARCH_MAX_STEPS` ends. Their *fate* is exact (slice 8a); their *colour*
is the sky at the direction they had when the budget ran out, which is nothing
like their asymptotic direction. With the disk on, they also miss the disk
crossings later half-orbits would have added — so the photon ring's inner
rungs are under-lit exactly where γ is small. The ladder view (9c) paints the
band magenta so its extent is on screen: ~50 px on the a = 0.998 prograde
edge at fov 30, sub-pixel at a = 0.

The march cannot fix it (steps diverge as ~(1/γ) ln(1/δ)). Two honest paths:

- **Analytic continuation for the sky.** For a ray that has settled onto the
  near-critical shell, the remaining trajectory is the unstable manifold of
  the spherical photon orbit at its (λ, q). Its asymptotic direction is a
  function of (λ, q, side) plus the *phase* at exhaustion, expressible via
  the Kerr elliptic integrals (Gralla–Lupsasca 2020 give closed forms). A
  small precomputed table over the critical curve, looked up by the ray's
  constants, would replace "direction at exhaustion" with the true escape
  direction for the dominant rung.
- **Ladder-aware disk lighting.** Each further half-orbit crosses the
  equatorial plane once more, at a radius that converges geometrically to the
  photon orbit's. Summing the remaining crossings analytically (radius
  sequence from the near-critical expansion, shift from `diskShift`) would
  restore the ring's brightness without stepping.

Both are a slice's worth of work with a testable CPU oracle each.

### H9 — the continuation cannot follow a ray over the spin axis

**Status: open, flagged rather than guessed (slice 11a).** `src/mino.ts`
continues an exhausted ray in the separated (r, θ, φ) system, and that chart is
singular on the spin axis. A ray that crosses the pole must swing its azimuth by
very nearly π, packed into a Mino interval of order λ/(a²+q) — about 2e-5 for
the rays that fail — and at λ exactly zero the term λ/(1−u²) is 0/0, so the
crossing degenerates into a *reflection* no matter how fine the step. The
Cartesian march has no such trouble, which is why it is the module's oracle.

Measured against that march over 379 band rays at eight cameras, the closest
approach to the axis separates the two groups by three orders of magnitude:
every ray whose sin²θ stays above 1e-5 lands within 0.009°, and the ones below
reach 126°. `axisApproach` computes that closest approach in closed form from
(λ, q, a) alone, and `continueToEscape` returns `nearAxis` rather than a
direction it cannot justify. Over a full 1280-wide grid at fifteen cameras this
flags **115 of 14,147 band pixels (0.81%)** — all of them at cameras within
0.12 rad of face-on, none at any camera within half a radian of the equator.

Path, and it is a closed form rather than more steps: the singular part of the
azimuth across the turning point is ∫λ dτ/(1−u²), which in v = 1−u² is
∫λ dv/(v·√U) with U = −λ² + Bv − a²v² and B = a²+q+λ². That is the standard
∫dv/(v√(c+bv+av²)) with c = −λ² < 0, giving (1/|λ|)·arcsin((Bv−2λ²)/(v√(B²−4a²λ²)))
— so the whole passage contributes sign(λ)·π in the limit, exactly as the
geometry demands. Switching to that form inside a v-threshold and resuming with
the flipped `pu` sign would close it. Needs its own oracle and its own sign
work, which is why slice 11 registered it instead of bundling it.

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

- **Slice 11 — closing the band** (H1). Escape-direction table over the
  critical curve; the ladder view's magenta band is the acceptance test — it
  should shrink to nothing without the budget moving.
- **γ around the ring** (H2). Small; could ride with slice 11.
- **Chandrasekhar's table** (H8). Smaller still: source twenty numbers and
  replace a fitted curve with them. Tick directions do not change.
