# Black Hole Lab

Interactive black hole visualization in the browser (TypeScript + WebGL2, no engine).

Units are geometrized: G = c = M = 1, so all distances are in units of the
black hole mass M (Schwarzschild horizon at r = 2, photon sphere at r = 3;
with spin the horizon sits at r+ = 1 + √(1 − a²)).

## Run

```
npm install
npm run dev     # dev server
npm test        # physics unit tests (geodesic integrator)
npm run build   # typecheck + production build
```

## Architecture

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
ISCO as the spin changes (pulled forward from slice 5).

The disk is a thin equatorial sheet: Novikov–Thorne temperature profile
(zero at the ISCO, peak at r = 49/6), blackbody colors, differentially
rotating fbm turbulence, and per-crossing Doppler + gravitational shift for
circular-orbit matter (toggleable — "Hollywood mode" turns it off, as the
Interstellar renders did).

Slice 5 couples the picture to a chosen black-hole mass (10^5–10^11 M☉)
and accretion rate (Eddington units). The geometry is mass-invariant, but
the disk's peak temperature is not: T ∝ ṁ^(1/4) M^(-1/4) (isco/6)^(-3/4)
(Shakura–Sunyaev, 1.54e7 K for 1 M☉ at Eddington), so stellar-mass holes
are X-ray hot and only the most monstrous, starving quasars glow in
visible colors; spinning the hole up pulls the inner edge in and heats it.
Readouts translate the geometric units (horizon in km, one M of time in
seconds, Wien band of the peak).

"Throw a star at it" launches a tidal disruption event: a sun-like star on
a marginally bound orbit aimed to graze its tidal radius r_t, which in
units of M is 4.7e5 (M/M☉)^(-2/3) — that scaling is the whole story. Below
~10^8 M☉ the star is shredded at r_t into a debris stream (half bound,
half unbound); the bound tail loops out and falls back, feeding a flare
that lifts ṁ (and, with coupling on, the disk temperature) on the classic
Rees t^(-5/3) light curve. Above the Hills mass, r_t sits inside the
horizon and the star is swallowed whole — no flare, it just redshifts away.
The aim is floored once that happens: "graze r_t" stops meaning anything when
r_t is inside the horizon (you cannot skim a radius you can only cross once),
and taken literally it aims the star at 0.02 M at the top of the slider — a
dead radial drop that reads as a bug rather than as the Hills-mass story. It
is aimed at a pericenter well inside the capture threshold instead (L = 1.73,
against a threshold running from 4 at a = 0 to ~2 prograde-extremal, so the
star is still certain to be taken at every spin — tested), which buys a
visibly curved approach and changes no outcome: capture turns on r_t < r+,
not on where it was aimed. Note that a TDE star never *orbits*: it is on a
marginally bound (parabolic) one-pass orbit by construction, so the arc to
watch is approach → shred → the debris tail's loop, not a closed orbit.
The star and all 32 debris elements move on exact timelike Kerr geodesics
integrated with the same Kerr–Schild Hamiltonian RK4 as the photons (only
the mass shell differs: m·m = -1, with E = -m_t conserved exactly), so the
stream's stretch, the relativistic capture of the deepest debris, and the
horizon crossing all emerge from the integration. The debris elements are
drawn as one continuous chain of gaussian capsules (energy order = stream
order), so the star visibly spaghettifies into a single stretching filament
rather than a cloud of blobs; capsules combine by strongest contribution
(summing would bead the joints) and dim as they stretch. The drawn stream
carries the artistic knobs, all documented in the code. The energy spread is widened
so first fallback takes ~600 M instead of months — Kepler ties that period to
how far the tail loops, so it also decides whether the stream stays in frame.
The split is biased ~70/30 toward bound rather than the physical 50/50, and
the bound elements are spread by fallback *period* rather than uniformly in
energy: the physical spread is what makes real fallback a t^(-5/3) tail, and
drawn literally it put 27 of 32 elements on ~1e3 M orbits that coast out of
frame and never visibly return. The flare's light curve is integrated
analytically and keeps the true t^(-5/3) shape regardless. Its display
brightness is sqrt-compressed (the readout reports the physical ratio).

What the debris does is the integrator's business, not ours: at the default
mass the bound tail loops out and fades as the disk eats it on the way back
in, while at ~1e7.5 M☉ and low spin — r_t only a couple of M outside the
horizon — every element is captured and crosses. Spin the hole up at that
mass and the smaller horizon lets the same stream survive and loop instead.
That fade is keyed on the *disk's* outer edge, not on r_t: r_t belongs to the
star and scales as M^(-2/3), so at the low end of the mass slider it runs to
hundreds of M — larger than the scene — and keying the fade there dissolved
the whole stream in open space, nowhere near anything that could eat it,
before it could ever fall back.

Slice 7 turns the spin slider into a controlled experiment. "Compare:
Schwarzschild vs Kerr" splits the frame and renders a = 0 into the left
viewport and the slider's a into the right, from one camera, at one mass and
accretion rate, with the stars on identical orbital elements — so every
difference on screen is the spin's doing and nothing else's. Neither half is
faked or mirrored: the scene pass simply runs twice with a different a, so
both are the full per-pixel geodesic renderer. It is close to free, because
splitting halves each viewport's width and the two draws cover the pixel count
the single one did — the cost is per pixel marched, not per draw. (The scene
shader takes ray directions from `gl_FragCoord` relative to `uViewOrigin`, not
the window, which is the only change the split needed.) The one thing NOT held
constant besides a is the disk's peak temperature, and deliberately: the ISCO
is where spin enters the temperature profile, so the two halves really are at
different temperatures, and at a = 0.998 the right-hand disk goes *dimmer* in
visible light because its hotter inner edge has moved into the X-ray.

What compare mode does not show, it hides rather than fakes. Gas and TDE
debris are stateful — advected and integrated frame to frame at one spin — so
they cannot honestly appear on a side whose spin they were never stepped in,
and they are dropped from both halves (with the TDE's flare, which would
otherwise light both disks up to 8× from an event neither half draws). Stars
survive the split because `starState` is a closed form in (t, a): the same
scratch arrays are simply refilled at the other spin between the two draws.
7b gives each half its own traced shadow outline, which is the slice's whole
argument in one picture: a circle on the left, and at high spin a flat-sided D
on the right, each hugging the black disk it belongs to. Nothing about the
tracer changed — `findShadowEdgeIncremental` already returned NDC and took an
aspect — so 7b is a cache per side plus getting the two mappings right. Both
matter. The aspect must be the one the *shader* used (its viewport's w/h, far
from the frame's shape once halved), or the outline is a perfectly-computed
boundary of a view nobody is looking at; and the strip it is drawn back into
is the GL rect divided by the render scale, not an independently re-rounded
CSS split, which would sit a pixel off the disk it claims to trace. The static
tetrad is spin-dependent, so each side launches its rays from its own. The two
outlines share ONE frame's tracing budget rather than each taking their own —
the a = 0 side goes first because it is far the cheaper (~66 ms of tracing
against ~540 ms at a = 0.998) and then yields the rest — so the HUD costs what
it always did.

The remaining slice-6 overlays stay off while comparing, in two groups: the
trails and the 6g callout layer project world points onto the *whole frame*
and would stripe across both halves at positions belonging to neither; the
clocks and the two insets each describe a single spacetime, and the potential
inset is anchored where it would sit on the Schwarzschild half while plotting
the Kerr side's curve. 7c brings the insets back per-side.

Two labels are deliberately not duplicated onto the a = 0 half. The photon-ring
callout is emitted once, against the slider's outline, and the callout layout
is now bounded to that side's strip so it cannot slide across the divider and
appear to caption the other spacetime. The shadow-edge callout is dropped in
compare mode outright, because its copy sizes the shadow against the horizon's
diameter and that ratio is a function of spin: measured off this repo's own
tracer at the default camera it is 2.49× at a = 0, 3.23× at a = 0.9 and 4.11×
at a = 0.998. The label's flat "about 2.6×" is a pre-existing single-view bug
(it is wrong at high spin with compare mode switched off); it is recorded here
rather than fixed inside slice 7.

Slice 3 adds matter in motion, all sampled **along the same per-pixel
geodesics** rather than as unlensed billboards, so every piece of matter is
gravitationally lensed for free (a star passing behind the hole smears into
an Einstein ring; the far-side jet base wraps around the shadow):

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
  taken literally here rather than sqrt-softened as the TDE stream is — the
  TDE's returning tail needed the help, whereas gas smeared down a ~7 M arc
  at the old blob normalization bloomed into a solid white band).
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

- `src/kerr.ts` — Kerr physics oracle: closed forms (horizon, ISCO, circular
  E/L/Ω, plunge 4-velocity), Kerr–Schild metric (raise/lower), static
  tetrad, Hamiltonian geodesic RK4 (pure, tested; the GLSL mirrors it)
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
- `src/compare.ts` — slice 7's split-screen layout math: the two equal
  viewports, their midpoint, and each side's name (pure, tested). Both halves
  get exactly the same width — the gutter absorbs the odd pixel — because
  unequal widths mean unequal aspect ratios, which would scale the two shadows
  differently and forge a difference the spin didn't make. The split starts
  clear of the control panel: splitting the whole frame puts the left half's
  hole at w/4, behind the panel on any window under ~1000 px
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
  saving). The default preset is byte-identical to the pre-cap renderer.
- `src/camera.ts` — orbit controls (plus the `claimed` hook that lets a HUD
  handle take a pointerdown before it becomes an orbit drag)
- `src/edu.ts` — educational-overlay math: unlensed world→screen projection
  matching the shader's ray construction, proper-time rates for the static
  camera and circular orbiters, equatorial Kerr effective potential and
  Bardeen photon-orbit radii, the equatorial embedding profile z(r) —
  Flamm's paraboloid at a = 0, integrated with the rim's inverse-square-root
  singularity split off in closed form — `Trail`, the fixed-size ring
  buffer of (position, time) samples behind the orbit trails, and the
  shadow-edge finder: the on-screen capture boundary, located by bisecting
  CPU rays launched exactly as the shader launches them, exposed as a
  generator yielding per trace so the render loop can drain it against a
  time budget, plus the callout geometry: which disk lobe is beamed toward
  the camera (from the same prograde `uCircCart` the shader's disk shift is
  built on) and how nearly a star sits behind the hole (pure, tested)
- `src/hud.ts` — 2D overlay canvas above the GL view (init/resize/clear,
  shared HUD style, clock faces, effective-potential inset, embedding-diagram
  funnel, orbit trails, dashed shadow outline, and the callout layer —
  leader-line labels laid out to stay clear of the control panel and of each
  other, with all copy in one `CALLOUT_COPY` table; DOM-only, verified by eye).
  The potential and embedding insets are drag-resizable from the corner facing
  the scene: the resize is one `ctx.scale` around the whole panel rather than a
  reflow, so the plots keep the proportions they were tuned at and only the
  grip itself is drawn at constant screen size. The HUD canvas is
  `pointer-events: none` so camera drags reach the GL canvas, which means the
  grips can never receive a pointer event themselves — main.ts hit-tests them
  and claims the pointerdown through `attachControls`' `claimed` hook
- `test/compare.test.ts` — checks the two viewports come out exactly equal in
  width across odd/even frames, gutters and offsets, that they fill the region
  and stay symmetric about its midpoint, that they are integers even after a
  fractional quality scale, and that both halves' centres clear the panel
  column at a narrow window (the regression the x0 offset exists for)
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
- `test/edu.test.ts` — screen projection against hand-built frustum points
  (center, top edge with y flip, behind-camera cull, aspect scaling), clock
  rates tied to the rendering tetrad's u^t, effective potential cross-checked
  against the circEL oracle (V_eff(r_c) = E with zero slope at every spin),
  Schwarzschild ISCO marginal stability, Bardeen photon-orbit radii, trail
  ring-buffer overflow/thinning/clear, shadow edge against the exact
  Schwarzschild angular radius (sin θ = 3√3·√(1−2/r)/r, circular to 1e-6,
  and at the app's widescreen aspect), the Kerr D-shape's x-offset with
  y-symmetry, the looks-away valid=false path, and incremental ≡ one-shot
- `test/tde.test.ts` — timelike stepper holds a circular orbit at its exact
  period (norm conserved), raise∘lower = id, disruption at r_t with a
  bound/unbound energy spread, bound debris loops out and falls back while
  unbound escapes, swallowed-whole above the Hills mass, exact E
  conservation along debris geodesics

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
   callout mode (detailed sub-slice plan in `PLAN-slice-6.md`) ✅
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
   contrast rather than by explanation
   - 7a split-screen scene: two viewports, one FBO, per-side spin ✅
   - 7b shadow outline traced per side (the circle vs the D-shape) ✅
   - 7c potential & embedding insets carrying both spins' curves — TODO
   - 7d orbit trails per side, which is what would make Lense–Thirring
     precession visible — TODO

Known bug, predating slice 7 and living in single view: the shadow-edge
callout says the shadow is "about 2.6× the horizon's diameter" at every spin.
That holds only at a = 0 — the horizon shrinks with spin while the shadow
barely does, so the true ratio climbs to ~4.1× at a = 0.998 (measured off
`findShadowEdge`; see the slice 7 notes above). The copy needs to either state
the ratio for the current spin or stop quoting a number.
