# Slice 6 plan — Educational overlays

This plan breaks slice 6 ("educational overlays") into seven small sub-slices,
**6a–6g**, each independently shippable. It is written to be executed by an AI
model working one sub-slice at a time. Do them in order: 6a is infrastructure
that all the others build on; 6b–6e are independent of each other; 6f is
needed by 6g.

Read this whole file once before starting any sub-slice. Then, per sub-slice,
read only the files listed under its **Files** heading.

---

## Ground rules (apply to every sub-slice)

1. **Units are geometrized**: G = c = M = 1. All radii/times in units of the
   hole mass M. Horizon r+ = 1 + √(1 − a²), a ∈ [0, 0.998]. The equatorial
   (disk) plane is **y = 0**; the spin/jet axis is **+y**. The hole is at the
   origin.
2. **Pure physics goes in testable modules, DOM goes in untested modules.**
   New pure math lives in `src/edu.ts` (create it in 6a) and is tested in
   `test/edu.test.ts`. New DOM/canvas drawing lives in `src/hud.ts` and is
   NOT unit-tested (verified by eye). `main.ts` only wires them together.
   Pure modules must not touch `document`, `window`, or WebGL.
3. **No new npm dependencies.** The stack is vite + typescript + vitest
   (+ playwright as a dev screenshot harness). Everything here is vanilla
   TS, HTML, CSS, and 2D canvas.
4. **Every sub-slice must end with all of these passing:**
   - `npm test` (all existing tests still green + your new ones)
   - `npm run build` (tsc strict + vite build, zero errors)
   - `npm run dev` → open the page, toggle your new feature on and off,
     drag the camera, move the spin/mass sliders, hit ⏸ Pause, and confirm
     nothing breaks and the frame rate readout stays close to what it was.
5. **Performance guardrails:** the render loop runs every frame at up to
   ~2 megapixels of per-pixel geodesic integration; the HUD must stay cheap.
   No allocations inside per-frame HUD code (reuse arrays/objects); the 2D
   canvas redraw per frame is fine at this complexity. Anything expensive
   (the slice-6f CPU ray tracing) must be debounced and spread across
   frames, never blocking a single frame for more than ~3 ms.
6. **Existing look is the default.** Every new overlay ships OFF by default
   (except the knob badges of 6a, which are always visible). With all new
   toggles off, the rendered frame must be pixel-identical to today.
7. **Comment style:** the codebase explains physics choices in comments
   (see `src/kerr.ts`, `src/tde.ts`). Follow that: state the formula and
   the convention, not what the next line does. Anywhere the overlay is an
   *approximation* (e.g. unlensed trail projection), say so in a comment
   AND in the UI copy.
8. **After each sub-slice, update `README.md`:** extend the slice-6 roadmap
   line with a ✅-marked sub-item (e.g. "6a knob provenance ✅") and add a
   one-liner to the architecture file list if you created a file.
9. Manual visual verification: run `npm run dev`, then in the browser
   console `window.__wantShot = true`, wait one frame, and `window.__shot`
   holds a PNG data URL (this hook already exists in `main.ts`). If you use
   playwright to screenshot headlessly, write outputs under
   `M:\claud_projects\temp\slice6\` — never into the repo.

---

## Shared reference (read once, used by several sub-slices)

### Repo map (files you will touch or mirror)

- `src/kerr.ts` — Kerr oracle: `horizonRadius(a)`, `iscoRadius(a)`,
  `omegaCirc(r,a)`, `circUt(r,a)`, `circEL(r,a)` → `{E,L}`,
  `ksMetric(p,a)` → `{f,...}`, `ksRadius(p,a)`, `lower/raise`,
  `uCircCart(r,az,a)`, `buildStaticTetrad(p,a,right,up,fwd)` → `Tetrad`
  (contravariant `u/right/up/fwd` + covariant `uCov/rightCov/upCov/fwdCov`),
  `traceRayKerr(camPos, mCov, a, opts)` → `{escaped, dir, crossings, ...}`.
- `src/camera.ts` — `CameraState {yaw,pitch,dist,fovDeg}`,
  `cameraBasis(state)` → `{pos,right,up,fwd}` (world-space unit vectors).
- `src/matter.ts` — `SpinCtx {rHor, isco, ...}` via `makeSpinCtx(a)`,
  `STAR_ORBITS`, `starState(orbit,t,a)` → `{pos,u}`, `GAS_COUNT`,
  `gasPosXZ(blob,ctx)`, `gasU(blob,ctx)`.
- `src/tde.ts` — `TdeState`, `TdeBody`, `aliveBodies(st)`, `bodyU(b,a)`
  (contravariant 4-velocity; `[0]` is u^t = dt/dτ).
- `src/astro.ts` — unit conversions `lengthKm(massMsun)`, `timeSec(massMsun)`.
- `src/main.ts` — UI bindings (`bindSlider`/`bindCheckbox` helpers), the
  `params` object, `resize()`, the render loop (`render()`), readouts.
- `index.html` — control panel markup + all CSS (single `<style>` block).
- `src/shaders.ts` — GLSL. **You should not need to edit this in slice 6.**

### Screen projection (world point → 2D canvas pixel)

The scene shader builds rays as (see `FS_SCENE` around the `main()`):

```
ndc  = (fragCoord / resolution) * 2 - 1        // ndc.y is +up (GL convention)
aspect = resolution.x / resolution.y
dir  = normalize(fwd + ndc.x * T * aspect * right + ndc.y * T * up)
T    = tan(fovDeg/2)
```

So the exact inverse, for HUD drawing on a 2D canvas (whose y axis points
**down**), for a world point `q` and `CameraBasis` `{pos,right,up,fwd}`:

```
d   = q - pos
xc  = dot(d, right);  yc = dot(d, up);  zc = dot(d, fwd)
if zc <= 0: not visible (behind camera)
ndcX = xc / (zc * T * aspect)
ndcY = yc / (zc * T)
x = (ndcX + 1) / 2 * width          // CSS-pixel canvas coords
y = (1 - ndcY) / 2 * height         // note the y flip
visible also requires |ndcX| <= ~1.2 and |ndcY| <= ~1.2 (small margin)
```

This is a **flat-space (unlensed) projection**. It does not match where the
lensed *image* of an object appears — that's fine for trails and diagram
insets, and every place that uses it must say so (rule 7).

### Launching a CPU ray exactly like the shader (needed in 6f)

The GLSL launch (mirrored by `traceRayKerr`'s doc comment):

```
nl = normalize([ndcX * T * aspect, ndcY * T, 1])           // local frame
m  = nl.x * tet.rightCov + nl.y * tet.upCov + nl.z * tet.fwdCov - tet.uCov
res = traceRayKerr(camPos, m, a)                            // V4 add, componentwise
```

where `tet = buildStaticTetrad(camPos, a, basis.right, basis.up, basis.fwd)`.
`res.escaped === false` means the ray fell through the horizon (a "shadow"
pixel — assuming maxSteps wasn't the reason; use default opts, they're
generous).

### Angular size of the Schwarzschild shadow (needed for 6f tests)

For a static observer at radius r in Schwarzschild (a = 0), the shadow's
angular radius θ obeys **sin θ = b_c · √(1 − 2/r) / r** with b_c = 3√3
(exact GR result, no approximation). The launch angle in the tetrad frame
relates to NDC as `tan θ = |(ndcX·T·aspect, ndcY·T)|`.

---

## Sub-slice 6a — HUD infrastructure + physical-vs-artistic knob labels

The foundation: a 2D overlay canvas, a projection helper, a "Learn" panel
section, and provenance badges on every existing control.

**Files:** create `src/edu.ts`, `src/hud.ts`, `test/edu.test.ts`;
edit `index.html`, `src/main.ts`, `README.md`.

### Steps

1. **HUD canvas.** In `index.html`, add directly after the `#view` canvas:
   `<canvas id="hud"></canvas>` with CSS:
   `#hud { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; }`
   (`pointer-events: none` is critical — camera drag/zoom must keep working;
   the control panel already floats above at default stacking, give `#panel`
   `z-index: 6` to be explicit.)

2. **`src/hud.ts`.** Exports:
   - `initHud(): CanvasRenderingContext2D` — grabs `#hud`, returns its 2D ctx.
   - `resizeHud(canvas, cssW, cssH, dpr): void` — sets
     `canvas.width/height = css * dpr` and
     `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` so all drawing code works in
     CSS pixels. Call it from `main.ts`'s existing `resize()` (same
     `MAX_DPR = 1.5` clamp).
   - `clearHud(ctx, cssW, cssH): void`.
   - A tiny shared style object (font `12px "Segoe UI", system-ui`, stroke
     `rgba(205,214,244,0.8)`, accent `#ffb35c` — matches the panel CSS).

3. **Projection helper in `src/edu.ts`** (pure, tested):
   ```ts
   export interface Projected { x: number; y: number; z: number; visible: boolean }
   export function projectToScreen(
     q: V3, basis: CameraBasis, tanHalfFov: number,
     width: number, height: number, out?: Projected
   ): Projected
   ```
   Implement exactly the math in "Screen projection" above (aspect =
   width/height, `out` param so per-frame callers can avoid allocation).
   Re-export `V3` from kerr, import `CameraBasis` from camera.ts (it is a
   type-only import; camera.ts has no DOM at module scope, so this keeps
   edu.ts node-safe — verify vitest runs it).

4. **"Learn" panel section.** In `index.html`, below the jets checkbox and
   above the TDE button, add a divider heading
   (`<div class="sub" style="margin-top:12px">Learn</div>`) and five
   checkboxes, all unchecked, with ids: `edu-callouts` ("What am I looking
   at?"), `edu-trails` ("Orbit trails"), `edu-clocks` ("Clocks — time
   dilation"), `edu-potential` ("Effective potential"), `edu-embed`
   ("Embedding diagram"). In `main.ts`, add to `params`:
   `eduCallouts/eduTrails/eduClocks/eduPotential/eduEmbed: false` and bind
   with the existing `bindCheckbox`. (The checkboxes do nothing yet beyond
   setting params — later sub-slices consume them. This is intentional:
   land the UI shell first.)

5. **Provenance badges.** Add CSS:
   ```css
   #panel .badge { font-size: 9px; padding: 0 5px; border-radius: 4px; margin-left: 6px; vertical-align: 1px; }
   .badge.phys { background: rgba(80,160,110,0.25); color: #9fdcb8; border: 1px solid rgba(120,200,150,0.35); }
   .badge.disp { background: rgba(90,110,170,0.25); color: #aebcf0; border: 1px solid rgba(120,140,200,0.35); }
   .badge.art  { background: rgba(190,120,70,0.25); color: #f0c39e; border: 1px solid rgba(220,150,90,0.4); }
   ```
   Tag every control's `<label>` with a badge `<span>` and a `title`
   tooltip. Classification (badge / tooltip text):

   | Control | Badge | Tooltip |
   |---|---|---|
   | spin | `phys` "physics" | Kerr spin parameter a. The shadow shape, frame dragging, ISCO and horizon all follow exactly. |
   | mass | `phys` | Sets the physical scale: km per M, seconds per M, disk temperature via T ∝ M^(-1/4). |
   | accretion rate | `phys` | Eddington-relative accretion rate; disk temperature follows T ∝ ṁ^(1/4). |
   | couple checkbox | `phys` | On: disk temperature computed from mass & ṁ (Shakura–Sunyaev). Off: you set the temperature by hand. |
   | fov | `disp` "display" | Camera lens only — no physics. |
   | exposure | `disp` | Tone-mapping brightness — no physics. |
   | bloom | `disp` | Glow post-process — no physics. |
   | star density | `art` "artistic" | The background sky is procedural, not a catalog. |
   | disk temperature | `art` | Manual override, only active when coupling is off. |
   | disk brightness | `disp` | Display gain on the disk emission. |
   | disk size | `art` | Real disk outer radii vary hugely; this is for looks. |
   | time speed | `disp` | Simulation clock rate (coordinate time per real second). |
   | jet power | `art` | Jet emission model is illustrative; the 0.85c knot kinematics and beaming are physical. |
   | lensing checkbox | `phys` | Off = straight-ray bypass for comparison (not physical). |
   | doppler checkbox | `phys` | Off = "Hollywood mode": hides the true brightness asymmetry, as the Interstellar renders did. |
   | stars/gas/jets toggles | `disp` | Content on/off. |

   Add a hint line at the bottom of the panel:
   `physics = exact GR · display = camera/rendering · artistic = illustrative`.
   On the TDE button, set a `title` documenting the two artistic knobs
   already noted in code/README: "Physics: exact Kerr geodesics for star &
   debris, r_t and Hills-mass scalings, t^(-5/3) flare. Artistic: debris
   energy spread widened so fallback takes ~800 M (not months); flare
   display brightness is √-compressed (readout reports the true ratio)."

6. **Panel subtitle**: change `Slice 5 — …` to
   `Slice 6 — educational overlays`.

### Tests (`test/edu.test.ts`, mirror the style of `test/disk.test.ts`)

- `projectToScreen`: camera at `[0,0,25]` via `cameraBasis({yaw:0,pitch:0,dist:25,fovDeg:60})`
  (fwd = −z). (a) `q=[0,0,0]` → exactly `(width/2, height/2)`, visible.
  (b) `q = pos + fwd + up·tan(30°)` → `(width/2, 0)` (top edge, y flip
  correct). (c) `q = pos + fwd·(-1)` (behind) → `visible === false`.
  (d) aspect: width 200, height 100, `q = pos + fwd + right·tan(30°)·2` →
  x = 200 (right edge), because horizontal half-angle scales by aspect.
  Use closeTo with 1e-9 tolerances.

### Acceptance

- Badges and tooltips on every control; Learn section present; all five new
  checkboxes bound to params but visually inert.
- HUD canvas exists, resizes with the window and DPR, never intercepts
  mouse input (drag/zoom over the whole screen still orbits the camera).
- Frame identical to before when nothing is enabled. Tests + build green.

### Gotchas

- Don't recreate the HUD context in `resize()` — resize the same canvas.
- `canvas.clientWidth` for the `#view` canvas is what `resize()` uses; the
  HUD spans the same full window, use the same numbers.

---

## Sub-slice 6b — Clocks: gravitational + velocity time dilation

Three-to-four small clock faces (top-right corner of the HUD) whose hands
turn at each observer's **proper-time** rate, driven by the same simulation
clock: a far-away observer, the camera (static observer at its r), matter
at the ISCO, and — when a TDE is running — the infalling/disrupted star.

**Files:** edit `src/edu.ts`, `src/hud.ts`, `src/main.ts`, `test/edu.test.ts`, `README.md`.

### Physics (put these in `src/edu.ts`, pure)

- `export function staticRate(p: V3, a: number): number` — dτ/dt of a
  static observer at position p: `sqrt(max(1 - ksMetric(p, a).f, 0))`.
  (Matches `buildStaticTetrad`, whose u^t is `1/sqrt(1-f)`. In the a = 0
  equatorial case f = 2/r so this is √(1 − 2/r).) Return 0 inside the
  ergosphere/horizon where 1 − f ≤ 0 (a static observer can't exist there;
  the camera range never reaches it, but the function must be total).
- `export function circRate(r: number, a: number): number` — dτ/dt of a
  circular equatorial orbiter: `1 / circUt(r, a)`. This includes BOTH
  gravitational and velocity dilation.
- TDE body rate: no new function needed — `1 / bodyU(b, a)[0]` (u^t is
  dt/dτ). Note near/inside the horizon in Kerr–Schild coordinates u^t stays
  finite (horizon-penetrating), so this clock keeps ticking through the
  plunge — that's the educational point: label it "the star's own clock
  never freezes; only the far observer sees it slow."

### State & wiring (`main.ts`)

Keep accumulated proper times, advanced only when not paused (right where
`simT += dtSim` happens):

```ts
tauCam  += dtSim * staticRate(basis.pos, params.spin);
tauIsco += dtSim * circRate(spinCtx.isco, params.spin);
tauStar += tde && starAlive ? dtSim / bodyU(tde.bodies[0], params.spin)[0] : 0;
// far-away observer's proper time IS simT
```

Reset `tauStar` when a new TDE launches. Note dependencies: `staticRate`
changes as the camera moves and `circRate` as spin changes — evaluating
them per frame (as above) handles that automatically; do not cache.

### Drawing (`src/hud.ts`)

`drawClocks(ctx, entries, x, y)` where each entry is
`{label: string, tau: number, rate: number}`. For each: a ~34 px circle,
one hand at angle `(tau / 60) * 2π` (one revolution per 60 M of proper
time), the label under it, and `rate.toFixed(3)` + "× far-away rate"
beneath. Layout them in a row anchored top-right (12 px margin), below any
future overlays. Skip the TDE clock when there's no TDE. When
`params.eduClocks` is false, draw nothing.

Add a one-line caption under the row: "each clock ticks at its own proper
time; deeper + faster = slower".

### Tests

- `staticRate([0,0,10], 0)` ≈ `Math.sqrt(1 - 2/10)` = 0.894427 (1e-12).
- `staticRate` at r = 25 equals `1 / buildStaticTetrad(...).u[0]` (1e-12) —
  ties the clock to the tetrad actually used for rendering.
- `circRate(6, 0)` ≈ `Math.sqrt(0.5)` = 0.7071067 (Schwarzschild ISCO:
  1/u^t = √(1 − 3/r)).
- `circRate(iscoRadius(0.9), 0.9)` is finite, in (0, 1), and smaller than
  `staticRate` at the same radius... actually just assert
  `0 < circRate(r,a) < staticRate([r,0,0], a)` for r = 8, a = 0 and a = 0.9
  (the orbiter is slower than the static observer — velocity dilation on
  top of gravity). For the a=0.9 case put the point on the x axis:
  `staticRate([8,0,0], 0.9)`.
- Rates decrease monotonically toward the hole: staticRate at r = 20 >
  at r = 10 > at r = 5 (a = 0.7, point on x-axis).

### Acceptance

- Toggle on: clocks visibly tick at different speeds; zooming the camera
  in makes the camera clock slow down; raising spin (ISCO moves in) makes
  the ISCO clock slower. Launch a TDE → star clock appears, keeps ticking
  smoothly as the star crosses the horizon (readout freezes it as "gone"
  once the body is culled — reuse `aliveBodies`).
- Pause stops all hands. Toggle off: HUD area empty again.

---

## Sub-slice 6c — Effective-potential inset

An inset plot (bottom-left) of the Kerr equatorial effective potential
V_eff(r) for a test particle with angular momentum L, with the horizon,
photon orbits, ISCO, and the live TDE star marked on it. This is the "why
is there an innermost stable orbit at all" picture.

**Files:** edit `src/edu.ts`, `src/hud.ts`, `src/main.ts`, `index.html`,
`test/edu.test.ts`, `README.md`.

### Physics (in `src/edu.ts`)

For equatorial Kerr (M = 1), the radial equation for a particle with
conserved E, L is

```
(dr/dτ)² = E²·α(r) − E·β(r) − γ(r)
α = 1 + a²/r² + 2a²/r³
β = 4·a·L/r³
γ = 1 − 2/r + L²/r² − 2L²/r³
```

Define the effective potential as the E that makes dr/dτ = 0 (the standard
Kerr generalization; for a = 0 it reduces to the textbook
√((1 − 2/r)(1 + L²/r²)) because β = 0 and γ factors):

```ts
export function vEff(r: number, L: number, a: number): number {
  // positive root of α E² − β E − γ = 0
  return (β + Math.sqrt(β * β + 4 * α * γ)) / (2 * α);
}
```

Also add the Bardeen closed form for equatorial photon-orbit radii:

```ts
/** Unstable circular photon orbit; prograde: 2(1+cos(2/3·acos(−a))), retrograde with +a. */
export function photonOrbitRadius(a: number, prograde: boolean): number
```

### UI

- New slider in the Learn section (index.html):
  `Test-particle L <span id="edul-val"></span>` id `edul`, min 2, max 5,
  step 0.02, default 3.4641 (≈ Schwarzschild ISCO L = 2√3). Bind to
  `params.eduL`. Give it a `phys` badge. Only meaningful when the potential
  inset is on, but it can always be bound.
- Inset drawn by `drawPotential(ctx, opts)` in hud.ts when
  `params.eduPotential` is true: a ~300×170 px panel, bottom-left, same
  background style as `#panel` (dark rounded rect). Contents:
  - x axis: r from `rHor` to 20 M (linear). y axis: V_eff from 0.88 to 1.08
    (fixed window works for the L slider range; clamp the curve).
  - Shaded band r < rHor labeled "inside horizon".
  - The V_eff(r; L, a) curve for the current spin and `params.eduL`.
  - Vertical ticks: r_ph (prograde, dashed, label "photon orbit"), ISCO
    (label "ISCO"), and the potential's local max/min if present (find them
    numerically by scanning the sampled curve for sign changes of the
    discrete slope; mark min with a dot — "stable circular orbit lives
    here").
  - Horizontal line at E = 1 labeled "unbound".
  - **Live TDE marker:** when a TDE star/debris body is alive, a bright dot
    at (its current r via `ksRadius(b.p, a)`, its conserved E). `TdeBody`
    stores its energy — check `src/tde.ts` for the field (it's used for
    fallback bookkeeping); if it isn't exposed, compute
    `E = -lower(b.p, a, bodyU(b, a))[0]`... note `lower` takes a
    contravariant V4 — verify the call signature in kerr.ts. Cap at the
    first 4 bodies to keep it readable. The dot slides along horizontally —
    r changes, E is exactly conserved — which is the whole lesson; caption:
    "energy is conserved: the dot moves only sideways".
  - One-line caption: "orbits oscillate where E < V_eff walls; below the
    ISCO minimum flattens away — nothing left to hold you up".

### Tests

- a = 0 reduction: `vEff(r, L, 0)` equals
  `Math.sqrt((1 - 2/r) * (1 + L*L/(r*r)))` for r ∈ {4, 6, 10, 20},
  L ∈ {2, 3.4641, 4.5} (1e-12).
- Circular-orbit consistency (the key oracle test): for a ∈ {0, 0.7, 0.9}
  and r_c ∈ {isco, 8, 12}: `const {E, L} = circEL(r_c, a)`, then
  `vEff(r_c, L, a)` ≈ E (1e-8), and the numerical derivative
  `(vEff(r_c + h) - vEff(r_c - h)) / 2h` ≈ 0 (h = 1e-5, tol 1e-5) — a
  circular orbit sits at a stationary point of the potential with its own L.
- ISCO is marginally stable: for a = 0, second derivative of
  `vEff(r, L_isco, 0)` at r = 6 ≈ 0 (central differences, h = 1e-3,
  tol 1e-6), and Schwarzschild ISCO energy: `vEff(6, 2*Math.sqrt(3), 0)` ≈
  `Math.sqrt(8/9)` = 0.9428090 (1e-9).
- `photonOrbitRadius(0, true)` = 3 exactly; `(1, true)` → 1;
  `(1, false)` → 4; `(0.9, true)` ≈ 1.5578 (compute once by hand from the
  formula and pin to 1e-3); prograde < 3 < retrograde for a = 0.5.

### Acceptance

- Slide L: the centrifugal barrier grows/shrinks; below L ≈ 2√3 (a = 0) the
  minimum disappears — visible flattening. Slide spin: photon-orbit and
  ISCO markers move inward (prograde). Launch a TDE: dot appears far right
  near E ≈ 1, slides left, dives into the shaded horizon band (or bounces
  and returns — that's the bound-debris fallback).

### Gotchas

- β² + 4αγ can go slightly negative from rounding near the horizon —
  clamp to 0 before sqrt.
- Sample the curve at ~140 points once per frame only when the inset is on;
  reuse a preallocated Float32Array.

---

## Sub-slice 6d — Embedding diagram ("the funnel")

The classic curved-space funnel: the equatorial slice's embedding surface,
as a small rotating wireframe inset (bottom-right), with the disk extent
shaded and live matter dots sliding on it.

**Files:** edit `src/edu.ts`, `src/hud.ts`, `src/main.ts`,
`test/edu.test.ts`, `README.md`.

### Physics (in `src/edu.ts`)

The equatorial slice of Kerr (Boyer–Lindquist) has
g_rr = r²/Δ with Δ = r² − 2r + a² = (r − r+)(r − r−), r± = 1 ± √(1 − a²).
Embedding in flat 3-space: z(r) with

```
dz/dr = sqrt(g_rr − 1) = sqrt((2r − a²) / Δ)
```

valid for r ≥ r+ (Δ > 0 there and 2r > a² always holds since r+ ≥ 1 ≥ a²).
At a = 0 this integrates in closed form to **z(r) = √(8(r − 2))**.

```ts
/** Embedding height z(r), z(r+) = 0. Returns samples for r+..rMax. */
export function embeddingProfile(a: number, rMax: number, n: number):
  { r: Float64Array; z: Float64Array }
```

The integrand diverges like (r − r+)^(−1/2) at the horizon — integrable,
but naive trapezoid loses accuracy. Handle the first interval analytically:
near r+, `dz/dr ≈ sqrt(c / (r − r+))` with `c = (2·r+ − a²)/(r+ − r−)`
(and for a = 1, r+ = r− = 1, the formula degenerates — the slider caps at
0.998 so `r+ − r−` ≥ ~0.126, no special case needed), which integrates to
`z ≈ 2·sqrt(c·(r − r+))`. Use that closed form for the first step (r+ →
r+ + h), then midpoint-rule the rest with n ~ 400 uniform steps to rMax.

### Drawing (`src/hud.ts`)

`drawEmbedding(ctx, profile, opts)` in a ~260×200 px inset panel,
bottom-right, when `params.eduEmbed` is on:

- Surface of revolution: for each of ~9 rings (r = r+, isco, t-peak, and
  log-spaced out to `params.diskOuter`), plot the circle
  `(r·cosφ, z(r)·kz, r·sinφ)` and 12 radial spokes, projected
  orthographically with a fixed tilt and the **camera's yaw** so the funnel
  turns as the user orbits: `sx = X·cos(yaw) − Z·sin(yaw)` rotated, then
  `px = cx + s·sx`, `py = cy − s·(Y·0.9 − szDepth·0.35)` — i.e. simple
  rotate-then-tilt; kz ≈ 0.35 vertical exaggeration factor (state it in the
  caption: "vertical scale compressed").
- Highlight the ISCO ring in the accent color; shade the disk band
  (isco → diskOuter) faintly.
- Live dots: stars (`starState(...).pos` → use `ksRadius` for r, azimuth
  `atan2(pos[2], pos[0])`), gas blobs, TDE bodies — same projection as the
  rings; skip anything with r < r+ or r > rMax.
- Caption: "the funnel is the true stretching of space on the disk plane —
  the horizon is the rim at the bottom".

### Tests

- a = 0 closed form: `embeddingProfile(0, 20, 800)` → z at the sample
  nearest r = 4 ≈ 4.0, r = 10 ≈ 8.0 (√(8(r−2)); tol 0.01 — the horizon
  singularity is handled, so accuracy should be much better; if you miss
  0.01, your first-step handling is wrong).
- Monotonic: z strictly increasing in r for a = 0 and a = 0.9.
- Spin flattens the throat: z at r = 6 for a = 0.9 < z at r = 6 for a = 0
  (r+ is smaller and Δ larger — pin the inequality, not values).
- First sample: r[0] === r+ (within 1e-12 of `horizonRadius(a)`) and
  z[0] === 0.

### Acceptance

- Funnel visible, rotates with camera yaw, ISCO ring and disk band move
  when the spin/disk-size sliders move (recompute the profile only when
  spin or rMax changes — cache keyed on `(a, rMax)`, NOT per frame).
- Gas dots spiral inward and drop off the rim; a TDE star dives in from
  outside the frame's rMax (clamp entry).

---

## Sub-slice 6e — Orbit trails

Fading polylines tracing where matter actually moved — stars (showing
Lense–Thirring precession as non-closing rings), gas (inspiral), and TDE
debris (the stretched stream and fallback loops).

**Files:** edit `src/edu.ts` (trail buffer, pure), `src/hud.ts`,
`src/main.ts`, `test/edu.test.ts`, `README.md`.

### Trail buffer (in `src/edu.ts`, pure — this is the tested part)

```ts
export class Trail {
  constructor(capacity: number)        // ring buffer of [x,y,z,t] samples
  push(p: V3, t: number): void         // append if t - lastT >= minDt (0.5 M)
  clear(): void
  get length(): number
  /** Iterate samples oldest→newest: cb(x, y, z, t, i). */
  forEach(cb: (x,y,z,t,i) => void): void
}
```

Ring buffer over a preallocated Float64Array(capacity·4); `push` drops the
oldest when full. `minDt` = 0.5 (simulation-M) spacing keeps ~128 samples ≈
64 M of history. No allocation after construction.

### Wiring (`main.ts`)

- Own the trails in main.ts: `starTrails: Trail[]` (STAR_COUNT × cap 128),
  `gasTrails: Trail[]` (GAS_COUNT × cap 96), `tdeTrails: Trail[]`
  (TDE_MAX × cap 192).
- Push inside the existing sim-advance block (only when not paused), using
  positions already computed for the uniforms — do it in the same loops
  that fill `starPosArr` / `gasArr` / `tdePosArr` (gas positions are
  `[gx, 0, gz]`). Push regardless of the toggle so history exists when the
  user turns it on (it's cheap: a few comparisons per body per frame).
- Clear a gas trail when its blob respawns: `stepGasBlob` re-randomizes on
  respawn — detect it in main.ts by radius jumping outward
  (`newR > oldR + 2`) and `clear()` that trail. Clear all `tdeTrails` when
  a new TDE launches. Reset star trails when spin changes (orbit planes
  change: `bindSlider("spin", ...)` already exists — hook there).
- When `params.eduTrails` is on, draw via hud.ts:
  `drawTrails(ctx, trails, colorsPerGroup, basis, tanHalfFov, w, h, simT)`.
  For each trail, walk samples with `projectToScreen` (reuse one `out`
  object), `lineTo` chains broken whenever a sample is `!visible`; stroke
  with alpha ramping from 0.05 (oldest) to 0.55 (newest) in ~6 alpha
  buckets (one `stroke()` per bucket per trail, not per segment). Colors:
  stars `#9fd0ff`, gas `#ffb35c`, TDE `#ffffff`.

### Honesty caveat (required)

Trails are **true spatial paths** projected with straight rays — they will
NOT line up with the lensed images of the objects (which can appear on the
other side of the hole). Put this in the checkbox tooltip: "true paths in
space (straight-line projection) — the glowing images are lensed and won't
sit on the lines" and as a code comment at the draw call.

### Tests

- `Trail` push/overflow: cap 4, push 6 samples at t = 0, 1, 2, ... →
  length 4, `forEach` yields t = 2, 3, 4, 5 in order.
- minDt thinning: push at t = 0, 0.2, 0.4, 0.6 → length 2 (t = 0 and 0.6).
- `clear()` → length 0; push after clear works.
- No-allocation sanity: `push` 10_000 times into cap 128 completes and
  length stays 128.

### Acceptance

- Stars leave rings that visibly precess at high spin (turn spin to 0.998,
  time speed up, watch an inclined star's ring tilt walk around — that IS
  Lense–Thirring). Gas leaves inward spirals ending at the horizon. A TDE
  leaves the money shot: a stretched multi-strand stream with bound strands
  looping back. FPS unaffected with all trails on (if it drops, your draw
  loop allocates or strokes per-segment — fix that, don't reduce capacity).

---

## Sub-slice 6f — Shadow & photon-ring annotation

Compute the **actual** shadow outline on screen (exact for the current
camera and spin, matching the renderer by construction) by bisecting
captured-vs-escaped CPU rays, and draw it with labels. This also produces
the anchor geometry that 6g's callouts use.

**Files:** edit `src/edu.ts`, `src/hud.ts`, `src/main.ts`,
`test/edu.test.ts`, `README.md`.

### Edge finder (in `src/edu.ts`, pure)

```ts
export interface ShadowEdge {
  /** ndc-space outline points (ndcX, ndcY), one per azimuth, closed loop. */
  pts: Float64Array;      // 2 * nAz
  valid: boolean;         // false if the center ray isn't captured
}
export function findShadowEdge(
  camPos: V3, tet: Tetrad, a: number,
  tanHalfFov: number, aspect: number,
  nAz?: number,           // default 48
  opts?: { camDist?: number }
): ShadowEdge
```

For each azimuth ψ_k = 2πk/nAz, search along the NDC ray
`(s·cosψ, s·sinψ)` for the capture→escape transition:

1. Helper `captured(ndcX, ndcY)`: build the launch momentum exactly as in
   "Launching a CPU ray" above (from `tet`'s covariant legs), call
   `traceRayKerr(camPos, m, a, { rEscape: camDist + 40 })`, return
   `!res.escaped`.
2. Verify `captured(0, 0)` (camera always looks at the origin in this app);
   if not, return `valid: false` (can happen only if someone changes the
   camera model — degrade gracefully, draw nothing).
3. Bracket: s_lo = 0; grow s_hi from 0.05 by ×1.6 until `!captured` or
   s_hi > 3 (give up on that azimuth → reuse the previous azimuth's s as a
   fallback).
4. Bisect 16 times → s precise to ~1e-5 ndc. Store
   `(s·cosψ, s·sinψ)`.

Cost: ~48 azimuths × ~20 traces ≈ 1000 traces. At ~25 M camera distance a
trace is a few hundred RK4 steps — this is tens of milliseconds total, so
it must NOT run on the render thread in one gulp:

### Scheduling (`main.ts`)

- Recompute only when `(spin, yaw, pitch, dist, fovDeg, aspect)` changes,
  debounced 250 ms after the last change, and only while
  `params.eduCallouts || params.eduShadow` is on.
- Run it in slices: keep a tiny state machine that computes ~6 azimuths per
  `requestAnimationFrame` tick before the GL draw (≈1–2 ms), accumulating
  into the ShadowEdge; draw the previous complete outline (slightly faded)
  until the new one finishes. Simplest structure: a generator function in
  edu.ts (`findShadowEdgeIncremental` yielding after every azimuth) driven
  by main.ts — implement `findShadowEdge` as "drain the generator" so tests
  use the same code path.
- New Learn checkbox `edu-shadow` ("Shadow & photon ring") in index.html,
  `params.eduShadow`, placed with the others (this was not in 6a's list —
  add it now).

### Drawing (`hud.ts`)

- Convert ndc pts → canvas px (`x = (ndcX+1)/2·W`, `y = (1−ndcY)/2·H`) and
  stroke a dashed closed loop (accent color, 1.5 px, `setLineDash([6,5])`).
- Label with leader lines (reuse a `drawCallout(ctx, x, y, tx, ty, title, body)`
  helper you'll also use in 6g — build it here):
  - anchored at the outline's leftmost point: **"shadow edge"** / "no light
    from inside ever reaches you — about 2.6× the horizon's diameter";
  - anchored at the top point, offset just outside: **"photon ring"** /
    "light that orbited the hole before escaping piles up in ever-thinner
    subrings converging on this edge".
- At high spin with an edge-on camera the outline goes D-shaped — the
  labels must follow the actual points, so anchor to computed extremes, not
  to a circle.

### Tests

All in vitest, no DOM. Camera at r = 25, `cameraBasis({yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60})`,
`tet = buildStaticTetrad(...)` exactly as main.ts does.

- **Schwarzschild angular size (quantitative):** a = 0, aspect = 1,
  nAz = 8. Every outline point should sit at ndc radius
  `s = tan(asin(3√3·√(1−2/25)/25)) / tan(30°)` — compute the expected value
  in the test (≈ 0.352) and assert each `hypot(ndcX, ndcY)` matches to
  1e-3, and that the 8 radii agree with each other to 1e-6 (circularity —
  also implicitly validates that the tetrad Gram–Schmidt didn't skew
  anything).
- **Kerr asymmetry (qualitative):** a = 0.9, pitch = 0 (equatorial view),
  yaw = 0.6, aspect = 1: the outline's horizontal extent is asymmetric
  about 0 — `|min ndcX| ≠ |max ndcX|` by more than 10% of the mean radius —
  and total width < total width at a = 0 on the prograde side (just assert
  asymmetry + that min/max ndcY stay within 2% of symmetric — the D-shape
  flattens one side in x, barely changes y).
- `valid === false` path: point the tetrad away — build basis for a camera
  at dist 25 but pass `fwd` reversed; expect `valid: false` (and no throw).
- Generator/drain equivalence: incremental version drained fully equals the
  one-shot call (same Float64Array values).

### Acceptance

- Outline hugs the rendered black disk edge at every spin/pitch/fov you try
  (this is the strongest end-to-end check in the whole slice — if it's
  offset, your ndc/aspect handling differs from the shader's; re-read the
  Shared reference section). Photon ring label sits just outside. No frame
  hitches while dragging (watch the fps readout; the debounce + slicing
  must keep the GL loop smooth).

---

## Sub-slice 6g — "What am I looking at?" callout mode

The capstone: one toggle that labels everything on screen with leader-line
callouts, driven by real geometry — shadow (from 6f), Doppler sides, the
doubled disk image, jets, ISCO gap, and an Einstein-ring moment detector.

**Files:** edit `src/edu.ts`, `src/hud.ts`, `src/main.ts`,
`test/edu.test.ts`, `README.md`.

### Geometry helpers (in `src/edu.ts`, pure, tested)

- ```ts
  /** +1 if disk matter on the camera-right side moves toward the camera. */
  export function approachingSign(camPos: V3, right: V3, a: number): number
  ```
  Take the equatorial point q on the camera's right at r = 8: project
  `right` into the disk plane (`rp = normalize([right[0], 0, right[2]])`),
  `q = 8·rp`. Get the orbiter's 4-velocity `u = uCircCart(8, az, a)` with
  `az = atan2(q[2], q[0])` — check `uCircCart`'s azimuth convention in
  kerr.ts before writing this (read the function; if its `az` means
  something else, adapt). Spatial velocity `v = [u[1], u[2], u[3]]`;
  return `Math.sign(dot(v, normalize(camPos − q)))`.
- ```ts
  /** Angular offset (rad) of a star from the exact anti-camera axis, and whether it's behind the hole. */
  export function alignmentAngle(camPos: V3, starPos: V3): { angle: number; behind: boolean }
  ```
  `behind`: `dot(starPos, normalize(-camPos)) > 0` (star on far side of the
  origin plane ⊥ to the view axis). `angle`: angle between `-camPos`
  direction and `starPos` direction seen from the camera... simplest
  correct version: angle at the camera between (origin − camPos) and
  (starPos − camPos). An Einstein ring forms when the star is behind AND
  this angle is small.

### Callouts (in `main.ts` + `hud.ts`, active when `params.eduCallouts`)

Reuse `drawCallout` from 6f. Each callout below lists its anchor and its
exact copy (title / body). Only draw a callout when its subject is enabled
and on screen; recompute anchors per frame (cheap math only).

1. **Shadow + photon ring** — exactly the 6f outline + its two labels
   (enabling callouts implies the shadow overlay; share the computed edge).
2. **Doppler sides** (needs disk + doppler on): anchors at the projected
   equatorial points `±8·rp` (the same construction as `approachingSign`),
   using `projectToScreen`. On the approaching side:
   **"approaching side"** / "matter here comes at you at ~half light speed —
   relativistic beaming makes it brighter and bluer". Receding side:
   **"receding side"** / "same disk, moving away — beamed out of your view,
   dimmer and redder". If doppler is OFF, replace both with one label:
   **"Hollywood mode"** / "true brightness asymmetry hidden — this is the
   symmetric movie look".
3. **Doubled disk image** (disk on, and `|pitch| < 0.45` so the view is
   near edge-on): anchor above the shadow top at 1.35× the shadow's ndc
   top-extent (from the 6f edge): **"the far side, seen over the top"** /
   "light from disk behind the hole is bent over the pole and reaches you —
   the disk wraps its own image around the shadow". Mirror below:
   **"…and under the bottom"** / "the same far side, bent under — a second,
   fainter image".
4. **Jets** (jets on): anchor at `projectToScreen` of `[0, ±14, 0]`.
   Toward-you jet (pick by which of ±y·14 projects with smaller `z` —
   nearer): **"jet — pointed near you"** / "knots stream at 0.85c;
   relativistic beaming makes this one ~16× brighter than its twin".
   The other: **"counter-jet"** / "identical, but beamed away — nearly
   invisible for real (here it's clamped for visibility)". (That clamp is
   an artistic knob — say it.)
5. **ISCO gap** (disk on): anchor at projected equatorial point at
   r = `spinCtx.isco` on the approaching side: **"inner edge — the ISCO"** /
   "inside the innermost stable circular orbit there are no orbits to shine
   from; matter plunges in a few laps. Spin the hole up and watch this edge
   chase the shadow." Note: the anchor is an unlensed projection, so it
   lands near-but-not-on the image's inner edge — acceptable; append
   "(marker approximate)" to the body copy.
6. **Einstein ring moment** (stars on): each frame, run `alignmentAngle`
   over `starPosArr` (positions already computed); if any star has
   `behind && angle < 0.06 rad`, show at the shadow's right edge:
   **"Einstein ring!"** / "a star is passing almost exactly behind the
   hole — its light reaches you around every side at once, smearing it into
   a ring". Keep it up for the frames the condition holds (it will flicker
   on/off across ~seconds of orbit — that's fine and eye-catching).

Layout guard: callouts must never overlap the control panel (x > 270 px)
and should nudge each other vertically if two anchors project within 20 px
(simple one-pass push-down; don't over-engineer).

### Tests

- `approachingSign`: a = 0. Prograde orbits have a definite sense; instead
  of hand-deriving it, tie it to the oracle: compute u = `uCircCart(8, az, 0)`
  for `az` of the +x point with camera at `[0, 5, 25]`, right ≈ +x... the
  test should assert (a) the sign is ±1 (never 0), (b) it flips when the
  camera moves to the mirrored azimuth (yaw + π), and (c) it is consistent
  with a direct dot product you compute inline in the test from
  `uCircCart` — i.e. the test re-derives the expected sign from the same
  oracle at a *different* radius (r = 10) and expects agreement (the sense
  of rotation doesn't depend on r).
- `alignmentAngle`: camera at `[0,0,25]`: star at `[0,0,-10]` →
  behind = true, angle ≈ 0. Star at `[0,0,10]` (between camera and hole,
  same axis) → behind = false. Star at `[5,0,-10]` → behind = true,
  angle = `atan(5/35)` ≈ 0.1419 (1e-6).
- Copy-free zone: no test for the drawing; keep all label strings in one
  exported `CALLOUT_COPY` const in hud.ts so future edits touch one place.

### Acceptance

- Turn everything on at spin 0.9, pitch near 0: labels correctly identify
  the bright side (compare with the actual rendered asymmetry — the label
  must sit on the visibly brighter lobe; if it's mirrored, your azimuth
  convention in `approachingSign` is flipped — fix the code, not the label).
- Doubled-image labels appear only near edge-on. Jet labels swap when you
  orbit to the other side. Watch a star lap the hole → "Einstein ring!"
  fires exactly when a smeared arc/ring is visible in the render (this is a
  genuine end-to-end validation that alignment detection works).
- With the toggle off, zero per-frame cost besides the boolean check.

---

## Suggested order & why

| # | Sub-slice | Depends on | Size feel |
|---|---|---|---|
| 1 | 6a HUD + badges | — | small |
| 2 | 6b clocks | 6a | small |
| 3 | 6c potential | 6a | medium |
| 4 | 6d embedding | 6a | medium |
| 5 | 6e trails | 6a | medium |
| 6 | 6f shadow edge | 6a | medium-hard (the only one touching ray tracing) |
| 7 | 6g callouts | 6a, 6f | medium |

6b–6e can be reordered freely. Do 6f before 6g (6g consumes its outline).

## Definition of done for slice 6

- All seven sub-slices merged; `npm test` and `npm run build` green.
- README: slice 6 marked ✅ in the roadmap, `src/edu.ts` / `src/hud.ts` and
  `test/edu.test.ts` listed in the architecture section with one-liners.
- With every Learn toggle off, output is pixel-identical to slice 5.
- With everything on, the fps readout stays within ~10% of the
  toggles-off value at 1080p.
