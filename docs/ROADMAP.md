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

**Status: not started.** The EHT's ring polarization pattern is the most
physically loaded thing a Kerr renderer could add, and the parallel transport
of a polarization vector along the marched geodesic is a conserved quantity
(the Walker–Penrose constant) in Kerr, so it costs no extra integration — one
complex constant per ray, read at the disk crossing. A natural slice 10.

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

- **Slice 10 — polarization** (H5). Walker–Penrose constant per ray, EVPA
  ticks on the disk, a toggle beside the ladder view.
- **Slice 11 — closing the band** (H1). Escape-direction table over the
  critical curve; the ladder view's magenta band is the acceptance test — it
  should shrink to nothing without the budget moving.
- **γ around the ring** (H2). Small; could ride with either.
