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
mass the bound tail loops out and fades as the disk eats it near r_t, while
at ~1e7.5 M☉ and low spin — r_t only a couple of M outside the horizon —
every element is captured and crosses. Spin the hole up at that mass and the
smaller horizon lets the same stream survive and loop instead.

Slice 3 adds matter in motion, all sampled **along the same per-pixel
geodesics** rather than as unlensed billboards, so every piece of matter is
gravitationally lensed for free (a star passing behind the hole smears into
an Einstein ring; the far-side jet base wraps around the shadow):

- **Orbiting stars** — gaussian blobs on inclined circular geodesics
  (exactly physical: spherical symmetry makes every plane equatorial), with
  Keplerian dφ/dt = r^(-3/2), blackbody colors, and per-star Doppler +
  gravitational shift. Integrated per march segment (point-to-segment
  distance), so no image-position solve is ever needed.
- **Infalling gas** — bright blobs advected on the CPU (Keplerian azimuth +
  viscous inward drift steepening into a plunge inside the ISCO, respawning
  at the outer edge), shaded at the same analytic equatorial crossings as
  the disk, so they get the doubled image too. Their shift factor fades to
  zero at the horizon.
- **Relativistic jets** — a bipolar volumetric emission cone integrated
  along each march step, with knots streaming outward at 0.85c and
  relativistic beaming (clamped for sanity; the jet aimed toward the camera
  really is ~16× brighter at 45°).
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
- `src/matter.ts` — star orbits + gas inspiral/plunge state (pure, tested)
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
- `src/camera.ts` — orbit controls
- `src/edu.ts` — educational-overlay math: unlensed world→screen projection
  matching the shader's ray construction, proper-time rates for the static
  camera and circular orbiters, equatorial Kerr effective potential and
  Bardeen photon-orbit radii, and the equatorial embedding profile z(r) —
  Flamm's paraboloid at a = 0, integrated with the rim's inverse-square-root
  singularity split off in closed form — and `Trail`, the fixed-size ring
  buffer of (position, time) samples behind the orbit trails (pure, tested)
- `src/hud.ts` — 2D overlay canvas above the GL view (init/resize/clear,
  shared HUD style, clock faces, effective-potential inset, embedding-diagram
  funnel, orbit trails; DOM-only, verified by eye)
- `test/kerr.test.ts` — closed-form checks (horizon/ISCO/E/L identities),
  a = 0 deflection match against lens.ts, photons held on the a = 0.9
  prograde/retrograde circular photon orbits, frame-dragging capture
  asymmetry, conserved H/m_t/λ, exact face-on disk redshift √(1−3/r)
- `test/lens.test.ts` — checks against closed-form GR results (weak-field
  deflection 4M/b, critical impact parameter 3√3 M, photon-ring divergence)
- `test/disk.test.ts` — checks orbit speed (ISCO at c/2), shift factor
  (face-on g = √(1−3/r)), temperature-profile peak/zeros incl. spun-down ISCO
- `test/matter.test.ts` — checks star orbits (radius/period/plane/4-velocity
  normalization, Lense–Thirring precession rate and plane, co-rotation with
  the disk pattern) and gas (Kerr circular rate, rate continuity across the
  ISCO, plunge + respawn cycle at a = 0 and 0.9, unit 4-velocities)
- `test/astro.test.ts` — unit conversions against known values (Sgr A*
  horizon), T ∝ ṁ^(1/4) M^(-1/4) scalings, tidal-radius values and the
  ~1.1e8 M☉ Hills mass, flare rise/peak/t^(-5/3) decay
- `test/edu.test.ts` — screen projection against hand-built frustum points
  (center, top edge with y flip, behind-camera cull, aspect scaling), clock
  rates tied to the rendering tetrad's u^t, effective potential cross-checked
  against the circEL oracle (V_eff(r_c) = E with zero slope at every spin),
  Schwarzschild ISCO marginal stability, Bardeen photon-orbit radii, trail
  ring-buffer overflow/thinning/clear
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
6. Educational overlays — clocks, potentials, physical-vs-artistic knob
   labels, embedding diagram, orbit trails, shadow/photon-ring annotation,
   callout mode (detailed sub-slice plan in `PLAN-slice-6.md`)
   - 6a HUD infrastructure + knob provenance badges ✅
   - 6b clocks — gravitational + velocity time dilation ✅
   - 6c effective-potential inset — barrier, ISCO minimum, live TDE energies ✅
   - 6d embedding diagram — the funnel, with live matter riding it ✅
   - 6e orbit trails — star rings that fail to close (Lense–Thirring), gas
     spirals, the TDE stream and its fallback loops ✅
