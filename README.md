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

The fate is exact; the colour of the band it revealed is approximate — those
rays are still winding when the budget ends. That, why the budget was the wrong
lever rather than merely an expensive one, the axis-regular form of Carter's Q,
and the float32 cancellation that had to be removed from the potential are in
[`docs/DESIGN.md`](docs/DESIGN.md#slice-8--what-gamma-costs-the-renderer).

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
  drift apart
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
  budget used to run out and paint escaping light black — and the shadow-edge
  finder: the true capture boundary, located by bisecting CPU rays launched
  exactly as the shader launches them but integrated far past its budget,
  exposed as a generator yielding per trace so the render loop can drain it
  against a time budget (still marched, so still ~0.6 px out at a = 0.998
  prograde where the shader now is not — see slice 8), plus the
  callout geometry: which disk lobe is beamed toward the camera (from the same
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
  is over: the panel sizes, each side's band, the boxes and their grip corners,
  the hit-test and the drag's scale (pure, tested). Pure in the frame's CSS
  size and the knobs' values, which is what lets the grip hit-test run from a
  pointer handler, outside the render loop. It owns the panel geometry rather
  than hud.ts, because the layout and the hit box must agree with what is drawn
  to the pixel — and that keeps it clear of the DOM-only module, so a test can
  import it
- `src/shaders.ts` — GLSL: per-pixel Kerr–Schild march, disk, matter, sky, bloom
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
  funnel, orbit trails, dashed shadow outline, and the callout layer —
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
  integrator stops the runaway as a capture, as the GLSL's budget does)
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
  and at the app's widescreen aspect), the Kerr D-shape's x-offset with
  y-symmetry, the looks-away valid=false path, and incremental ≡ one-shot
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
  in single view

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
  (`LAB_URL` overrides). Writes PNGs outside the repo. See `docs/DESIGN.md` for
  why it measures instead of diffing against stored images.
- `tools/visual/smoke.mjs` — `npm run shot`. Proves the harness can boot the
  lab, capture a non-blank composited frame and measure it, and doubles as the
  worked example of the intended shape: capture once, then measure that frame
  as many ways as you like.

## Slice roadmap

1. **Lensed sky** — shadow, photon ring, Einstein-ring star warping, HDR bloom ✅
2. **Accretion disk** — temperature colors, doubled image, Doppler asymmetry ✅
3. **Matter in motion** — orbiting stars, infalling gas, relativistic jets,
   time controls ✅
4. **Real physics upgrade** — Kerr per-pixel integrator, exact
   beaming/redshift, true plunge kinematics inside the ISCO (ISCO-follows-
   spin pulled forward from slice 5) ✅
5. **Physics-coupled behavior** — mass & accretion-rate sliders drive the
   disk temperature, physical-unit readouts, tidal disruption events with
   geodesic debris streams and a t^(-5/3) flare ✅
6. **Educational overlays** — clocks, potentials, physical-vs-artistic knob
   labels, embedding diagram, orbit trails, shadow/photon-ring annotation,
   callout mode ✅
   - 6a HUD infrastructure + knob provenance badges ✅
   - 6b clocks — gravitational + velocity time dilation ✅
   - 6c effective-potential inset — barrier, ISCO minimum, live TDE energies ✅
   - 6d embedding diagram — the funnel, with live matter riding it ✅
   - 6e orbit trails — star rings that fail to close (Lense–Thirring), gas
     spirals, the TDE stream and its fallback loops ✅
   - 6f shadow & photon-ring annotation — the exact on-screen capture
     boundary (bisected CPU geodesics launched as the shader launches them,
     debounced and time-sliced across frames), labelled at its own computed
     extremes so the D-shape carries its labels with it ✅
   - 6g "what am I looking at?" callout mode — one toggle that names the
     frame from its real geometry: shadow and photon ring (6f's outline),
     the beamed and receding disk lobes, the far side wrapped over the pole,
     the jets, the ISCO edge, and an Einstein-ring detector that fires when a
     star passes nearly behind the hole ✅
7. **Schwarzschild vs Kerr** — a split-screen mode that renders a = 0 and the
   spin slider's a side by side from one camera, so frame dragging shows up by
   contrast rather than by explanation ✅
   - 7a split-screen scene: two viewports, one FBO, per-side spin ✅
   - 7b shadow outline traced per side (the circle vs the D-shape) ✅
   - 7c potential & embedding insets per side, each at its half's spin ✅
   - 7d orbit trails per side — the left ring closes, the right one walks ✅
   - 7e shadow-edge label per side — 2.6× against 4.3×, the outlines' contrast
     as a number ✅
8. **The photon ring's ladder** — γ, the unstable photon orbit's Lyapunov
   exponent: the `e^(−γ)` spacing of the ring's nested images, π at a = 0 and
   split 0.19/4.08 across the two edges at a = 0.998. Set out to draw the
   ladder; found that the same γ sets how many march steps a ray needs, so
   where it is small the shader's budget ran out and painted escaping light as
   shadow (~50 px of it on the prograde edge at a = 0.998, sky-lit; 0 px at
   a = 0). No new overlay — 6f's outline already showed it, against docs that
   claimed the two agreed ✅
   - 8a the march is the wrong oracle: fate is fixed by `λ` and Carter's `q`
     through the radial potential, not discovered by stepping. `rayCaptured`
     settles it exactly, at any budget; the prograde edge moves in 53 px at
     a = 0.998 and the rendered shadow is finally a D ✅

The roadmap is complete. There is no slice 9 queued.

Known and pinned, not queued: 6f's traced outline runs at 4000 steps, which
leaves it ~0.6 px outside the true edge at a = 0.998 prograde — the renderer is
now the more accurate of the two. Pointing `findShadowEdge` at `rayCaptured`
would make it exact and drop ~540 ms of tracing per outline.
