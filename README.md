# Black Hole Lab

Interactive black hole visualization in the browser (TypeScript + WebGL2, no engine).

Units are geometrized: G = c = M = 1, so all distances are in units of the
black hole mass M (Schwarzschild horizon at r = 2, photon sphere at r = 3;
with spin the horizon sits at r+ = 1 + √(1 − a²)).

This file is the entry point: what the lab does, how the renderer works, and
where the code is. For *why* the code is the way it is — the artistic knobs and
what they cost, the decisions behind compare mode — see
[`docs/DESIGN.md`](docs/DESIGN.md). Finished plans are kept in `docs/archive/`,
historical and not to be trusted over the code.

## Run

```
npm install
npm run dev     # dev server
npm test        # physics unit tests (geodesic integrator)
npm run build   # typecheck + production build
npm run shot    # visual harness smoke run (needs `npm run dev` up)
npm run pol     # slices 10 and 15: the drawn polarization ticks vs the CPU
                # oracle, in direction and in length
npm run band    # slices 11-14: the drawn photon-ring ladder vs the CPU oracle,
                # the disk light the continuation carries, and the exponents
                # printed around the ring
```

## Architecture

### Spacetime and the renderer

Since slice 4 the spacetime is **Kerr** (spin slider a ∈ [0, 0.998]). The
scene shader marches every pixel's null geodesic with adaptive RK4 in
Cartesian **Kerr–Schild** coordinates (`src/kerr.ts` is the tested CPU
mirror of the GLSL): horizon-penetrating, no polar-axis singularity (the
jets sit on the axis), and positions come out directly in world space. The
integrator evolves the covariant momentum m_μ of the time-reversed photon
under the Hamiltonian H = ½g^{μν}m_μm_ν, so m_t and the axial momentum
λ = z·m_x − x·m_z are conserved exactly.

Redshift/beaming is exact, not approximated: rays launch from a static
observer's orthonormal tetrad (metric Gram–Schmidt, built on the CPU), and
every emitter's shift is g = 1/(m_μ u^μ) with its true 4-velocity — the
disk's reduces to a closed form in (m_t, λ), stars and gas upload exact u^μ,
the jet normalizes its 0.85c stream in the local metric. Frame dragging,
the D-shaped shadow, and the spin-shifted photon ring all emerge from the
march; at a = 0 the picture reduces to the Schwarzschild renderer of slices
1–3 (`src/lens.ts` stays as that cross-checked reference).

Matter kinematics are Kerr-exact too: circular orbits at Ω = 1/(r^{3/2}+a),
inclined star orbits precess at the Lense–Thirring nodal rate, and gas that
crosses the (spin-dependent) ISCO switches to the true geodesic plunge with
the ISCO's conserved E, L — regular through the horizon in Kerr–Schild
time. The disk temperature profile's zero-torque inner edge follows the
ISCO as the spin changes.

### The accretion disk

The disk is a thin equatorial sheet: Novikov–Thorne temperature profile
(zero at the ISCO, peak at r = 49/6), blackbody colors, differentially
rotating fbm turbulence, and per-crossing Doppler + gravitational shift for
circular-orbit matter (toggleable — "Hollywood mode" turns it off, as the
Interstellar renders did).

### Matter in motion (slice 3)

All of it is sampled **along the same per-pixel geodesics** rather than as
unlensed billboards, so every piece of matter is gravitationally lensed for
free: a star passing behind the hole smears into an Einstein ring, and the
far-side jet base wraps around the shadow.

- **Orbiting stars** — gaussian blobs on inclined circular geodesics
  (exactly physical: spherical symmetry makes every plane equatorial), with
  Keplerian dφ/dt = r^(-3/2), blackbody colors, and per-star Doppler +
  gravitational shift. Integrated per march segment (point-to-segment
  distance), so no image-position solve is ever needed.
- **Infalling gas** — advected on the CPU (Keplerian azimuth + viscous inward
  drift steepening into a plunge inside the ISCO, respawning at the outer
  edge), shaded at the same analytic equatorial crossings as the disk, so it
  gets the doubled image too. Its shift factor fades to zero at the horizon.
  Each parcel is drawn not as a round blob but as the **arc it has been shorn
  into**: the shader sweeps it backward over a fixed window of coordinate time
  along the very rates matter.ts integrates it forward with (`gasRates`,
  finite-difference-checked against the stepper), and draws that track as a
  capsule with round caps. Fixing the window in *time* rather than angle is
  the point — the orbital rate runs from ~r^(-3/2) at the rim to a fast plunge
  at the ISCO, so one window smears an inner parcel across radians while an
  outer one barely moves. That spread is the differential rotation itself, and
  it is what shears real accretion flows into filaments. Kerr's axisymmetry
  earns the shading: rotating the parcel's uploaded 4-velocity about the spin
  axis gives *exactly* the 4-velocity of the same orbit further along the arc,
  so one uniform shades the whole tail with the far end correctly receding
  where the head approaches. The tail dims as 1/length (mass conservation,
  taken literally here rather than sqrt-softened as the TDE stream is).
- **Relativistic jets** — a bipolar volumetric emission cone integrated
  along each march step, with knots streaming outward at 0.85c and
  relativistic beaming: emission scales as g³ on the exact local shift, so a
  jet seen 45° off its axis really is ~65× its receding twin (~15× at 60°).
  The shift is clamped to g ≤ 1.6 before cubing — an artistic knob: nose-on
  the true ratio is ~1900×, which would white the frame out, and the clamp
  holds the drawn contrast near ~180×. The 6g jet callouts therefore describe
  the asymmetry in words rather than quoting a ratio: no single number tracks
  a clamped, per-pixel quantity that the pitch slider swings from 1× to ~180×.
- **Time controls** — simulation time runs in coordinate-time units of M
  (pause button + speed slider, 0–120 M per real second); disk turbulence,
  stars, gas, and jet knots all advance on the same clock.

### Physical scales (slice 5)

Slice 5 couples the picture to a chosen black-hole mass (10^5–10^11 M☉)
and accretion rate (Eddington units). The geometry is mass-invariant, but
the disk's peak temperature is not: T ∝ ṁ^(1/4) M^(-1/4) (isco/6)^(-3/4)
(Shakura–Sunyaev, 1.54e7 K for 1 M☉ at Eddington), so stellar-mass holes
are X-ray hot and only the most monstrous, starving quasars glow in
visible colors; spinning the hole up pulls the inner edge in and heats it.
Readouts translate the geometric units (horizon in km, one M of time in
seconds, Wien band of the peak).

"Throw a star at it" launches a tidal disruption event: a sun-like star on a
marginally bound orbit aimed to graze its tidal radius r_t = 4.7e5 (M/M☉)^(-2/3)
in units of M. Below ~10^8 M☉ the star is shredded at r_t into a debris stream
(half bound, half unbound); the bound tail loops out and falls back, feeding a
flare that lifts ṁ (and, with coupling on, the disk temperature) on the classic
Rees t^(-5/3) light curve. Above the Hills mass, r_t sits inside the horizon and
the star is swallowed whole — no flare, it just redshifts away. The star and all
32 debris elements move on exact timelike Kerr geodesics, so the stream's
stretch, the capture of the deepest debris and the horizon crossing all emerge
from the integration. The drawn stream carries several artistic knobs — the aim
floor, the widened energy spread, the 70/30 bound split, the capsule chain —
each documented in the code and argued in
[`docs/DESIGN.md`](docs/DESIGN.md#slice-5--tidal-disruption-events).

### Educational overlays (slice 6)

A 2D HUD canvas above the GL view: clocks showing gravitational and velocity
time dilation, an effective-potential inset, an embedding-diagram funnel with
live matter riding it, orbit trails, the traced shadow outline and photon-ring
annotation, and a "what am I looking at?" callout mode that names the frame from
its real geometry. Knob labels carry a badge saying whether they are physics or
artistic licence.

Both insets are drag-resizable from the corner facing the scene. The shadow-edge
callout's "how much wider than the hole" ratio is analytic and spin-dependent —
see [`docs/DESIGN.md`](docs/DESIGN.md#slice-6--the-shadow-edge-number).

### Compare mode (slice 7)

"Compare: Schwarzschild vs Kerr" splits the frame and renders a = 0 into the
left viewport and the slider's a into the right, from one camera, at one mass
and accretion rate, with the stars on identical orbital elements — so every
difference on screen is the spin's doing and nothing else's. Neither half is
faked or mirrored: the scene pass runs twice with a different a, so both are the
full per-pixel geodesic renderer, and it is close to free because the two
half-width draws cover the pixel count the single one did.

Each half gets its own traced shadow outline (7b), its own potential inset and
funnel at its own spin (7c), its own orbit trails (7d) — the left ring closes,
the right one walks — and its own shadow-edge label, reading 2.6× against 4.3×
at a = 0.998. What the mode cannot show honestly it hides rather than fakes: gas
and TDE debris are stateful and integrated at one spin, so they are dropped from
both halves, and the clocks and the rest of the callout layer stay off. The full
argument, and what the split deliberately does *not* hold constant, is in
[`docs/DESIGN.md`](docs/DESIGN.md#slice-7--schwarzschild-vs-kerr).

### The photon ring's ladder, and what it cost the renderer (slice 8)

The photon ring is a ladder of images — light that looped the hole once, twice,
forever — each thinner than the last by `e^(−γ)`, with γ the Lyapunov exponent
of the unstable photon orbit (`edu.ts`'s `photonOrbitLyapunov`). It is exactly
π at a = 0, and spin splits it hard and asymmetrically: 0.19 on the prograde
edge at a = 0.998 against 4.08 on the retrograde one.

Those two are the *equatorial* orbits, and since slice 14 they are what they
always were — bounds. Off the equator the light hovers on spherical photon
orbits with their own exponents, so `criticalLyapunov` computes γ from a ray's
own conserved (λ, q) and the ladder view prints it at six points on the shadow's
edge. Measured in half-turns swept, deliberately, and not in the literature's
half-librations in latitude: that exponent is exactly π on both edges at every
spin, and would erase the very asymmetry above.

The same γ said where the picture stopped being true. It sets how long light
lingers near the photon orbit, hence how many march steps a ray needs to resolve
as escaped — and the shader affords `MARCH_MAX_STEPS` of them, and used to leave
a spent ray as captured. Where γ is small, escaping light got painted black: at
a = 0.998, sky-lit, **the rendered black disk ran ~50 px past the true shadow
edge on the prograde edge** and 0 px on the retrograde one, so the render showed
a circle where the truth is a D.

No budget fixes that — settling a ray at offset δ from the edge costs
`~(1/γ) ln(1/δ)` half-orbits, which diverges — so the shader stopped asking the
march. A ray's fate is fixed by two conserved numbers, `λ = L_z/E` and Carter's
`q = Q/E²`: it plunges iff the radial potential has no turning point above the
horizon. `kerr.ts`'s `rayCaptured` reads them off the launch momentum and solves
a cubic; the shader mirrors it and consults it exactly when the budget runs out.
No steps, so no exponent. The prograde edge moves in 22 px at a = 0.9 and 53 px
at a = 0.998 (predicted: 23 and 53.5); a = 0 and both retrograde edges do not
move a pixel. **The rendered shadow at a = 0.998 is now a D.**

The fate is exact; the *colour* of the band it revealed was not, until slices
11–13 finished those rays in a separated chart instead of guessing at them. Why
the budget was the wrong lever rather than merely an expensive one, the
axis-regular form of Carter's Q, and the float32 cancellation that had to be
removed from the potential are in
[`docs/DESIGN.md`](docs/DESIGN.md#slice-8--what-gamma-costs-the-renderer).

### The ladder, drawn; the outline, exact (slice 9)

Three things fell out of slice 8's criterion once it existed.

The criterion was **blind to the launch direction**: it tested the radial
potential between the horizon and the camera, which is the whole story for a
ray moving inward, and called every *outward*-moving ray captured. From the
default camera that never showed — such rays escape by marching long before the
budget ends — but the orbit camera goes down to r = 3.2, which at high spin is
inside the retrograde photon orbit (r = 3.9 at a = 0.998). A ray launched
outward and retrograde from there can wind at that orbit, reflect, and fall in,
or squeeze past it and leave; only the sign of dr/dσ at launch tells the two
cases apart. `rayCaptured` and the GLSL now read it, pinned against long traces
over the whole sphere of launch directions from that camera.

The **6f outline asks that criterion** instead of marching 4000 steps per
sample. It is exact where it was ~0.6 px out, costs ~1000 cubic solves instead
of ~540 ms of tracing, samples 96 azimuths instead of 48, and follows the
camera live — the debounce, the time-slicing and the stale-outline fade are
gone with the cost that justified them. Outline and rendered shadow are now one
function of the view rather than two integrations that happen to agree.

And the **ladder is drawn**. "Photon-ring ladder" false-colours every pixel by
how many half-turns its ray's position direction swept around the hole
(`kerr.ts`'s `winding`, accumulated in the shader), with a hairline at each
whole turn and the scene's own luminance kept as brightness. The rungs crowd
geometrically toward the critical curve at `e^(−γ)` per half-turn — a few flat
bands at a = 0, a staircase on the prograde edge at a = 0.998. A legend names
the bands and quotes `e^(−γ)` per edge at the current spin. Rays still winding
when the budget ends were drawn as their own colour when the ladder landed;
since slices 11–13 they are finished in the separated chart instead — real
escape direction, real winding, and the disk light they collect on the way out —
so that colour survives only as a tripwire `npm run band` requires to read zero
pixels. What is still open, and how to close it, is in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

### Polarization (slice 10)

Light from the disk arrives with a direction of vibration, and Kerr turns that
direction on the way out. "Polarization ticks" draws it: a short mark per grid
cell, pointing along the arriving electric vector, its length the polarized
fraction.

Where the polarization *starts* is the disk's surface. Light escaping the
sheet scatters off free electrons, and scattering polarizes it parallel to the
surface — nothing face-on, up to 11.713% at grazing incidence, on
Chandrasekhar's own tabulated curve. Where it *ends*
is the camera, and everything between is the black hole turning the plane.

That turn costs nothing per march step, which is the only reason it is
affordable. A polarization parallel-transported along a null Kerr geodesic
carries a conserved complex number, the **Walker–Penrose constant**, so it can
be evaluated where the light leaves the disk and read where it arrives, with
no integration in between — after the axial momentum and Carter's constant,
the third thing this spacetime hands over for free. `src/polarization.ts` is
the tested oracle; the scene shader mirrors it.

Two details the textbooks do not cover. The usual screen formulas assume an
observer at infinity and the orbit camera goes to r = 3.2, so the camera's own
two sky legs are used as a basis instead — exact at any radius. And the
constant is written in Cartesian Kerr–Schild rather than Boyer–Lindquist,
where the `1/Δ` that blows up on the horizon cancels identically and the piece
that is singular on the spin axis expands to a polynomial: the same story
Carter's constant told in slice 8.

Each disk crossing is resolved and added separately, weighted by its own
brightness, so where two images of the disk overlap with their planes turned
differently the light genuinely depolarizes and the marks shorten. The
polarized fraction's curve is the slice's one fitted number — endpoints exact,
shape approximate, tick lengths only — and it is registered as
[`docs/ROADMAP.md`](docs/ROADMAP.md)'s H8. The rest, and why the constant was
worth the algebra, is in
[`docs/DESIGN.md`](docs/DESIGN.md#slice-10--polarization-and-what-it-does-not-cost).

## File map

### `src/`

- `src/kerr.ts` — Kerr physics oracle: closed forms (horizon, ISCO, circular
  E/L/Ω, plunge 4-velocity), Kerr–Schild metric (raise/lower), static
  tetrad, Hamiltonian geodesic RK4 (pure, tested; the GLSL mirrors it). Each
  trace reports its `winding` — the angle its position direction swept, in
  half-turns — which is how far around the hole the ray actually went, and the
  measure the photon-ring ladder is spaced in. Also owns `rayCaptured` — a ray's
  fate from its conserved `λ` and Carter `q` via the radial potential's turning
  points, exact and step-free, which is what the shader consults when its budget
  runs out rather than assuming the ray was swallowed (slice 8a) — and
  `MARCH_MAX_STEPS`, the shader's march budget: the GLSL interpolates it into
  its loop bound and `main.ts`'s quality presets spend it, so the three cannot
  drift apart. `radialDirection` reads the sign of dr/dσ at launch, which
  `rayCaptured` needs to tell an outward ray that reflects back down from one
  that leaves (slice 9a)
- `src/polarization.ts` — how the disk's light is polarized and what Kerr does
  to it on the way out (slice 10): the Walker–Penrose constant in Cartesian
  Kerr–Schild — conserved along a null geodesic, so the whole trip costs two
  closed forms and nothing per march step — the camera's own sky basis, which
  is what makes this exact at finite radius rather than only far away, Stokes
  bookkeeping over a ray's disk crossings, and the electron-scattering emitter
  (direction exact from a 4-cross product; polarized fraction exact too since
  slice 15, read off Chandrasekhar and Breen's 1947 table with a linear
  interpolation, and the shader's copy of it generated from this one).
  `pixelPolarization` runs the whole chain for one pixel and is the oracle
  `npm run pol` checks the shader against — including, since slice 13, the
  crossings a budget-exhausted ray makes in the separated continuation, because
  the shader shades those too (pure, tested)
- `src/mino.ts` — the separated continuation (slices 11–13): what happens to a
  ray still winding at the photon shell when the march's step budget runs out.
  In Mino time the radial and polar motions are independent 1-D polynomial
  problems, so a ray needing ~291,000 marched steps finishes here in a few
  hundred cheap ones — which is the only way to close it, since the step count
  DIVERGES at the critical curve. `axisPassage` takes the polar turning point
  near the spin axis in closed form instead of stepping into a 0/0, and
  `continueToEscape` returns the escape direction, the winding still to sweep,
  and (slice 13, given the march's own m_t) the equatorial crossings the ray
  makes on the way out — the disk light nothing used to shade.
  `covariantMomentum` rebuilds the (m_t, mv) the shading wants out of five
  scalars and no metric, taking V^t from the null condition because the linear
  constraint divides by 1 − f and f = 1 is the ergosphere (pure, tested against
  a step-refined march in different coordinates)
- `src/astro.ts` — physical scales: unit conversions, Shakura–Sunyaev peak
  temperature, tidal radius / Hills mass, t^(-5/3) fallback flare (pure,
  tested)
- `src/tde.ts` — TDE state machine: marginally bound star launch, timelike
  geodesic stepper (reuses the kerr.ts RK4), disruption into a debris
  stream, fallback/escape bookkeeping, capsule-chain stream intensity
  (pure, tested)
- `src/lens.ts` — Schwarzschild CPU integrator (pure, tested a = 0 reference)
- `src/disk.ts` — disk physics helpers mirrored by the shader (pure, tested)
- `src/matter.ts` — star orbits + gas inspiral/plunge state, and `gasRates`,
  the (daz/dt, dR/dt) the shader sweeps backward to draw the sheared gas arcs
  (pure, tested)
- `src/edu.ts` — educational-overlay math: unlensed world→screen projection
  matching the shader's ray construction, proper-time rates for the static
  camera and circular orbiters, equatorial Kerr effective potential, Bardeen
  photon-orbit radii and the impact parameters of those orbits (which bound
  the shadow's width, hence `shadowHorizonRatio` — how much wider than the
  hole the black disk is, the shadow-edge callout's number), the equatorial
  embedding profile z(r) — Flamm's paraboloid at a = 0, integrated with the
  rim's inverse-square-root singularity split off in closed form — `Trail`,
  the fixed-size ring buffer of (position, time) samples behind the orbit
  trails, `photonOrbitLyapunov` — how fast the photon orbit sheds light, which
  spaces the ring's ladder at `e^(−γ)` and *also* set where the shader's march
  budget used to run out and paint escaping light black — `criticalLyapunov`,
  the same exponent pointwise anywhere on the critical curve (slice 14: the
  spherical orbit's radius as the double root of the radial potential, then one
  substitution and a 16-node midpoint rule over the latitude swing, with no 1/a
  anywhere, so a = 0 needs no case), with `outlineLyapunov` evaluating it at
  every azimuth of an outline and `ringGammaLabels` placing the six that get
  printed — and the shadow-edge finder `findShadowEdge`: the exact capture boundary, located by bisecting
  rays launched exactly as the shader launches them and asking `rayCaptured`
  for each one's fate (no march, so no budget and no residual — slice 9b),
  plus the callout geometry: which disk lobe is beamed toward the camera (from the same
  prograde `uCircCart` the shader's disk shift is built on) and how nearly a
  star sits behind the hole (pure, tested)
- `src/compare.ts` — slice 7's split-screen layout math: the two equal
  viewports, their midpoint, and each side's name (pure, tested). Both halves
  get exactly the same width — the gutter absorbs the odd pixel — because
  unequal widths mean unequal aspect ratios, which would scale the two shadows
  differently and forge a difference the spin didn't make. The split starts
  clear of the control panel: splitting the whole frame puts the left half's
  hole at w/4, behind the panel on any window under ~1000 px.
  `splitViewports` is called twice per frame — once from main.ts in
  scene-target px for `gl.viewport`, and once from `insets.ts`'s `splitCss` in
  CSS px to place 7c's per-side insets. The insets re-derive their split rather
  than dividing the GL one back out by the render scale, which the 7b outline
  may *not* do: the outline traces the drawn disk and has to land on the pixels
  the shader marched, while an inset only has to sit inside a half
- `src/insets.ts` — where the two draggable insets sit and which one a pointer
  is over, and where the ladder legend goes (`legendBox`: the top-right of its
  strip, under the clock row when that is up): the panel sizes, each side's band, the boxes and their grip corners,
  the hit-test and the drag's scale (pure, tested). Pure in the frame's CSS
  size and the knobs' values, which is what lets the grip hit-test run from a
  pointer handler, outside the render loop. It owns the panel geometry rather
  than hud.ts, because the layout and the hit box must agree with what is drawn
  to the pixel — and that keeps it clear of the DOM-only module, so a test can
  import it
- `src/shaders.ts` — GLSL: per-pixel Kerr–Schild march, disk, matter, sky, bloom.
  Also `LADDER_RUNGS`, the ladder view's palette as data — the GLSL that paints
  the bands is generated from it and `hud.ts`'s legend reads it, so the two
  cannot disagree
- `src/main.ts` — GL pipeline, UI, render loop, matter state advance
  (`?dbg` URL flag scans render targets for NaN/Inf — one bad pixel smears
  black blocks through the bloom pyramid). Also the frame-rate cap and the
  quality presets: the scene shader integrates a geodesic per pixel of the
  HDR target, so **render scale** is the whole lever — cost falls with its
  square while the pixels that are drawn stay exactly as physical. The GL
  target scales; the HUD canvas keeps true DPR, so overlays stay sharp over
  a half-res scene. Only the low preset touches the march itself (shorter
  step budget, coarser arc length — a softer photon ring for a linear
  saving). The default preset is byte-identical to the pre-cap renderer
- `src/camera.ts` — orbit controls (plus the `claimed` hook that lets a HUD
  handle take a pointerdown before it becomes an orbit drag)
- `src/gl.ts` — WebGL boilerplate: program compilation, framebuffer objects
- `src/hud.ts` — 2D overlay canvas above the GL view (init/resize/clear,
  shared HUD style, clock faces, effective-potential inset, embedding-diagram
  funnel, orbit trails, dashed shadow outline, the ladder legend, γ printed
  around the ring (`drawRingGammaLabels`, which reports the boxes its text took
  so the callout layout can step around them), and the callout layer —
  leader-line labels laid out to stay clear of the control panel and of each
  other, with all copy in one `CALLOUT_COPY` table — every line of it fixed
  but the slider shadow's ratio, which `setShadowSpin` rewrites per spin;
  compare mode's a = 0 twin, `shadowSchw`, is fixed copy because a = 0 is what
  the mode holds constant. `drawCallouts` takes a floor rather than a height:
  the top of the insets where they are shown, since they are opaque and drawn
  over this layer. DOM-only, verified by eye). `drawTrails` takes the strip its
  paths belong to — the
  whole width normally, one half when comparing (7d) — projects at that
  strip's aspect and clips to it, so no side can draw a path across the
  divider. The insets' resize is one `ctx.scale` around the whole panel rather
  than a reflow, so the plots keep the proportions they were tuned at and only
  the grip itself is drawn at constant screen size. Both insets take their spin
  as an argument and draw one spacetime, which is what let 7c place a copy per
  side without either of them learning that compare mode exists — the
  placement and the per-side spin stay in main.ts, the layout and hit-testing
  in insets.ts. The HUD canvas is `pointer-events: none` so camera drags reach
  the GL canvas, which means the grips can never receive a pointer event
  themselves — main.ts hit-tests them and claims the pointerdown through
  `attachControls`' `claimed` hook

### `test/`

- `test/kerr.test.ts` — closed-form checks (horizon/ISCO/E/L identities),
  a = 0 deflection match against lens.ts, photons held on the a = 0.9
  prograde/retrograde circular photon orbits, frame-dragging capture
  asymmetry, conserved H/m_t/λ, exact face-on disk redshift √(1−3/r),
  rays aimed inside the shadow never misreported as escapes (the captured
  backward ray hugs the horizon with diverging covariant momentum — the
  integrator stops the runaway as a capture, as the GLSL's budget does),
  the analytic fate against traces — including the whole sphere of launch
  directions from r = 3.2 at a = 0.998, inside the retrograde photon orbit,
  where outward rays reflect back down or leave and only the launch direction
  tells which
- `test/polarization.test.ts` — drags a polarization down real geodesics with
  Christoffels central-differenced off the exported metric, deliberately NOT
  the analytic derivatives the integrator is built from, so a shared sign
  error cannot cancel itself: the Walker–Penrose constant holds to 2e-4 at
  a = 0, 0.5, 0.9 and 0.998, and a = 0 shows no gravitational Faraday rotation
  (a polarization normal to the orbital plane stays normal to it). The
  end-to-end check takes a real disk crossing and gets its emitted
  polarization to the camera two independent ways — along its conserved
  constant, and by dragging it there — since every sign convention in the
  slice sits between those two answers. Also: a view from below the disk
  mirrors one from above, a distant face-on view is almost unpolarized (almost,
  because the disk's own motion aberrates the emission direction), a grazing
  one an order of magnitude more so, the sky basis never degenerates, and two
  crossings 90 degrees apart depolarize exactly
- `test/lens.test.ts` — checks against closed-form GR results (weak-field
  deflection 4M/b, critical impact parameter 3√3 M, photon-ring divergence)
- `test/disk.test.ts` — checks orbit speed (ISCO at c/2), shift factor
  (face-on g = √(1−3/r)), temperature-profile peak/zeros incl. spun-down ISCO
- `test/matter.test.ts` — checks star orbits (radius/period/plane/4-velocity
  normalization, Lense–Thirring precession rate and plane, co-rotation with
  the disk pattern) and gas (Kerr circular rate, rate continuity across the
  ISCO, plunge + respawn cycle at a = 0 and 0.9, unit 4-velocities, and
  `gasRates` finite-difference-matched to the path stepGasBlob actually walks
  in both regimes — the trail is drawn from those rates, so a drift between
  them would hang each arc off the path its parcel never took)
- `test/astro.test.ts` — unit conversions against known values (Sgr A*
  horizon), T ∝ ṁ^(1/4) M^(-1/4) scalings, tidal-radius values and the
  ~1.1e8 M☉ Hills mass, flare rise/peak/t^(-5/3) decay
- `test/tde.test.ts` — timelike stepper holds a circular orbit at its exact
  period (norm conserved), raise∘lower = id, disruption at r_t with a
  bound/unbound energy spread, bound debris loops out and falls back while
  unbound escapes, swallowed-whole above the Hills mass, exact E
  conservation along debris geodesics
- `test/edu.test.ts` — screen projection against hand-built frustum points
  (center, top edge with y flip, behind-camera cull, aspect scaling), clock
  rates tied to the rendering tetrad's u^t, effective potential cross-checked
  against the circEL oracle (V_eff(r_c) = E with zero slope at every spin),
  Schwarzschild ISCO marginal stability, Bardeen photon-orbit radii, trail
  ring-buffer overflow/thinning/clear, shadow edge against the exact
  Schwarzschild angular radius (sin θ = 3√3·√(1−2/r)/r, circular to 1e-6,
  and at the app's widescreen aspect, to 1e-6 now that it is exact), the Kerr
  D-shape's x-offset with y-symmetry, the looks-away valid=false path, the
  march budget's cost against γ, and the outline landing on the analytic edge
  the march converges to while the old 4000-step outline stays ~0.6 px out
- `test/compare.test.ts` — checks the two viewports come out exactly equal in
  width across odd/even frames, gutters and offsets, that they fill the region
  and stay symmetric about its midpoint, that they are integers even after a
  fractional quality scale, and that both halves' centres clear the panel
  column at a narrow window (the regression the x0 offset exists for)
- `test/insets.test.ts` — checks neither half's inset band crosses the divider,
  that both insets stay bottom-anchored and grow inward at every scale, that
  the grip sits on the corner facing the middle of the screen and its halo
  forgives 5 px and not 6, that the funnel wins an overlapping grab because it
  is drawn last, that a hidden inset cannot be grabbed, and that the drag
  averages its two axes and clamps to the readable range. The widths at which
  the two insets touch are pinned as numbers: 1435 px while comparing, 852 px
  in single view. Also that the ladder legend sits in its strip's top-right
  corner, under the clocks, and inside each half while comparing

### `tools/`

Not part of the app, not run by `npm test` or `npm run build`. Plain `.mjs`
rather than TypeScript — these need node APIs, the repo has no `@types/node`,
and `tsconfig` covers `src` + `test`.

- `tools/find-server.mjs` — finds a dev server already serving *this* lab, by
  asking each port in 5173–5188 what its title is. The port alone can't say:
  vite climbs to the next free one, so whichever project started first owns
  5173. Used by both the harness and `Start Black Hole Lab.bat`, so the two
  can't disagree about which server is ours. Dependency-free — the launcher
  calls it before `npm install` is guaranteed to have run. Also a CLI: prints
  the URL, or exits 1.
- `tools/visual/harness.mjs` — drives the lab in headless chromium (playwright,
  already a devDependency) and measures what it drew. Captures the scene canvas,
  the HUD canvas and a composite of the two, all frozen from one frame, and
  offers the measurements that make an overlay claim checkable rather than
  eyeballed: `stripDiff` (compare mode's halves against each other) and `drift`
  (one strip against itself over time). Needs `npm run dev` already serving —
  it finds it by scanning 5173–5188 for the port answering as this lab, since
  vite climbs past whatever else is running, so no port is reliably ours
  (`LAB_URL` overrides). Writes PNGs outside the repo. `LAB_CHROMIUM` points it
  at a preinstalled browser where playwright's own pinned build is absent. See
  `docs/DESIGN.md` for why it measures instead of diffing against stored images.
- `tools/visual/polarization.mjs` — `npm run pol`. Slice 10's physics lives
  twice, in the tested TypeScript and in a GLSL copy of the same closed form,
  and a transcription error in either still draws something that looks like a
  polarization map. So this measures the marks the lab actually drew — fitting
  each tick's principal axis from the difference between a ticks-on and a
  ticks-off frame of a frozen scene — and recomputes every one on the CPU. It
  sweeps the spin, since three of the four places the spin enters the closed
  form vanish at a = 0: mean 0.34°, 0.35° and 0.30° at a = 0, 0.9 and
  0.998, worst 2.35° over ~450 ticks. Cells where the field turns faster than
  a couple of degrees per pixel are skipped — one tick does not stand for a
  single direction there. Reading the drawn ink rather than the buffer behind
  it also covers the projection and the tick pass. Since slice 15 it measures
  tick LENGTHS as well, which the directions are blind to: the drawn ink's
  spread should be a straight line in the CPU's polarized fraction, of a slope
  the tick pass's own geometry predicts (6.31 px), and it comes out 2-3% off at
  every spin where the fit slice 15 removed reads 13-24% off. It
  borrows vite's own module loader to reach the TypeScript oracle, rather than
  adding a TS runner as a dependency
- `tools/visual/band.mjs` — `npm run band`. The same problem as `npm run pol`,
  for the photon-ring ladder: `src/mino.ts` is tested and its GLSL copy is not.
  Five measurements at five views. The ladder's magenta means "the
  continuation spent its own budget" and must read zero pixels — it is a
  passing check, not dead UI, and it was reading two when slice 12 looked.
  Whole-turn crossings are matched against the CPU's own winding through the
  HAIRLINES the shader draws at each one, because a line's position is the
  winding and a local minimum survives a tonemap that a colour does not: worst
  offset 0.027 half-turns over 36 crossings, which is the float32 answer the
  CPU tests cannot reach. Slice 13's disk light is measured as a DIFFERENCE
  across the disk toggle, because bloom makes an absolute brightness meaningless
  at these pixels: band pixels the march leaves with no disk crossing of their
  own, split by whether the continuation finds them one, gain 0.10 of full
  luminance against 0.0000 for the ones it does not. And the frame rate, which
  sits on the display's
  ceiling either way — an upper bound on the cost, and the tool says so rather
  than dressing it up as a measurement
- `tools/visual/smoke.mjs` — `npm run shot`. Proves the harness can boot the
  lab, capture a non-blank composited frame and measure it, and doubles as the
  worked example of the intended shape: capture once, then measure that frame
  as many ways as you like.

## Roadmap

Thirteen slices have landed: the lensed sky, the disk, matter in motion, the
Kerr integrator, physical scales and TDEs, the educational overlays, compare
mode, the analytic capture criterion, the photon-ring ladder with the exact
outline, polarization, and the separated continuation that finishes a ray the
march cannot — over the spin axis, and carrying the disk light it collects. The
full list, the register of open scientific hurdles (what is approximate, by how
much, and the path to closing each) and the queued slices are in
[`docs/ROADMAP.md`](docs/ROADMAP.md). Next up there: γ around the ring rather
than per equatorial edge, and sourcing Chandrasekhar's table for the polarized
fraction.
