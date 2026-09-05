# Plan — slice 20: rendering follow-ups from slice 19

Written at the end of slice 19 (2026-09-05) for whoever picks the next slice
up, model or person. Each item says what to change, which files, what to
measure, and what "done" reads as. Do them in order; each one is independent
of the ones after it, so stopping after any item leaves the lab consistent.

Read first: `CLAUDE.md` (conventions), `README.md`'s "Still pictures refined,
moving ones scaled" section, and `docs/DESIGN.md`'s slice 19 section. The
rules that bite here:

- Pure math goes in a tested module (`src/*.ts` with `test/*.test.ts`); only
  DOM and WebGL wiring goes in `src/main.ts`, `src/hud.ts`, `src/gl.ts`.
- Never eyeball an overlay or a rendering claim. Measure it with
  `tools/visual/harness.mjs`, in the same run, against pixels from that run.
- No new npm dependencies without asking.
- Comments say WHY, never what the next line does.
- After each item: `npm test`, `npm run build`, and with `npm run dev` up,
  `npm run shot`, `npm run pol`, `npm run band` (band takes ~3 minutes). All
  three must stay green. Then update `docs/ROADMAP.md`, `README.md`'s file
  map, and put the rationale in `docs/DESIGN.md`. Commit and push.
- Temp files go under `M:\claud_projects\temp\`, never in the repo.

Numbers to keep in mind, all measured in headless chromium on an RTX 5090 at
1920×1080: the scene pass costs 4.5 ms at full resolution and 1.1 ms at half;
at 1280×800 it is 2.6 ms. The frame-rate limit defaults to 60, so on this
machine nothing below is about frame rate here — it is about weaker machines
and about idle cost.

---

## Item 1 — the sky as a cubemap

**Done, and rejected on its own measurement (2026-09-05).** It was built as
written below — a bake pass over the six faces, the shared GLSL both shaders
include, 4×4 sub-samples a texel, RGBA16F at 1024 a face, an explicit mip
level from the pixel's angle — and then reverted, because the cost is not
where this item assumed. With lensing off, so that nothing hides it, the WHOLE
procedural sky costs 0.11 ms at 1920×1080 and the cubemap draws it in 0.07 ms:
0.04 ms is the ceiling, against a 4.2 ms frame. The two other reasons inverted
as well — the star floor moves rather than retires, and the mip chain caps the
sky's sharpness below what the floor draws now. `docs/ROADMAP.md` carries the
numbers and `docs/DESIGN.md` the floor argument; the implementation is kept as
`M:\claud_projects\temp\blackhole-perf\
slice20-item1-cubemap.patch`. Do not start it fresh.

### Why

Every ray that escapes the hole evaluates `skyColor` once: three octaves of
hashed stars (`starfield`) and two fbm fields plus a value-noise tint
(`milkyway`), in `src/shaders.ts`. That is roughly 30 hash evaluations and 64
more inside the fbm calls, per escaped pixel, per frame, for a sky that never
changes. Baking it once into a cubemap and sampling that:

- takes the cost off every frame (measure how much — it is the point);
- makes the sky resolution-independent through mipmaps, which retires the
  `STAR_MIN_PX` floor slice 19 added, since a mipmapped texture is already
  the sky's average over the pixel;
- lets the sky be higher quality than the shader affords per frame (more
  octaves, a finer nebula), because the bake runs once.

### What to build

1. **A bake pass.** A new fragment shader `FS_SKY` in `src/shaders.ts` that
   takes a face index and draws `skyColor(dir)` for that cube face — move
   `starfield`, `milkyway`, `skyColor` and the hashes they use into a shared
   GLSL string that both `FS_SCENE` (during the transition) and `FS_SKY`
   include, so the two cannot drift. Face size: 1024 per face at first; test
   2048. RGBA16F, because the stars are HDR (`bright` reaches ~60).
2. **A cubemap texture** in `src/gl.ts` beside `createFbo`: `createCubemap(gl,
   size, halfFloat)` with `TEXTURE_MIN_FILTER = LINEAR_MIPMAP_LINEAR`, then
   `generateMipmap` after the six faces are drawn. Rebuild it only when
   `uStarDensity` changes (the one knob the sky reads) — cache on that value in
   `main.ts` the way `embeddingFor` caches on (a, rMax).
3. **Sample it** in `FS_SCENE`: `skyColor(d)` becomes
   `texture(uSky, d).rgb` (a `samplerCube`), still gated on `uSkyOn`. Bind it
   on texture unit 0 for the scene pass; the bloom and composite passes bind
   their own units already.
4. **Mip level from the pixel's angle.** Hardware mip selection needs screen
   derivatives of the sample direction, and a lensed direction's derivative is
   wrong wherever neighbouring rays diverge (the critical curve) and undefined
   in a branch some neighbours did not take. Use `textureLod` with an explicit
   level instead: `lod = log2(uPixAng * size / (2 / faceAngular))` — i.e. the
   level at which one texel subtends one pixel's angle at the frame's centre,
   with `uPixAng` already a uniform (slice 19). Near the ring the true
   magnification is larger, so this is a floor, exactly as the star floor was.
5. **Remove `STAR_MIN_PX`** and its comment once the cubemap is in: the floor
   was doing by hand what the mip chain does properly.

### What to measure

- **Cost:** `npm run band` prints "scene X ms" at the pitch clamp. Record it
  before and after, and also from a dedicated script (copy the pattern in
  `M:\claud_projects\temp\blackhole-perf\timer-stream.mjs` if it still exists;
  otherwise: sample `window.__sceneMs` every frame for 180 frames and print the
  minimum) at the default camera, with the disk and matter OFF so escaped rays
  dominate. Expect a fall of 10-25% of the scene pass with everything off;
  report what it actually is.
- **Same picture:** with refinement ON (`refine: true` in `lab.set`), a
  converged frame before the change against a converged frame after, mean |d|
  over the sky region (the upper-left quarter at the default camera is sky).
  The refined frame is the ground truth on both sides; they should agree to a
  few codes. A larger difference means the bake's colour or brightness differs
  from the shader's — the tone map is downstream, so compare in the "gl" layer.
- **`npm run pol` and `npm run band` unchanged.** Neither reads the sky
  except as background luminance; the ladder classifier has a grey cutoff and
  the tick fit differences frames. Both should pass as-is. If band's tripwire
  count moves from zero, the sky is not the cause — look at what else changed.

### Done reads as

A scene-pass cost reduction you can quote, the star floor gone, the three
harnesses green, and a DESIGN.md subsection that says what the bake costs (one
frame at startup and one per density change) and why `textureLod` rather than
the hardware's level.

---

## Item 2 — the hard seam in the disk right of the shadow

**Chased and closed with no code change (2026-09-06).** The line is the
critical curve — the boundary between captured rays and escaping ones. The
sky's own contribution, measured as a sky-on frame differenced against a
sky-off one, is exactly zero for every column inside it, so no sky reaches the
camera there; a sharp edge at that boundary is the correct picture. It reads as
a seam because brightness is continuous across it and only texture steps (1.0
to 12 in four pixels). It is an arc, not a line: x 1082 at y 300, 1210 at
y 540, 1045 at y 780, and the crop that found it happened to sit on the flat
top. None of the candidates below survived — see `docs/ROADMAP.md` for what
each toggle showed and `docs/DESIGN.md` for why the first measurement missed
it. **Do not apply the fix drafted below**; `gasEmit` has nothing to do with
this. The candidate list is kept as written for the record.

### What was seen

At the default camera (spin 0.9, 1920×1080, sim running), a 3× crop of the
region x 1060-1360, y 380-580 showed a vertical discontinuity in the disk's
texture, about 150 px right of the shadow's edge, running most of the crop's
height: the disk pattern on either side of it does not match. It was in the
scene ("gl") layer, at quality high, so it is in the march's own pixels, not in
the composite's resampling (which is bypassed at scale 1) or the dither (a
per-pixel hash, no lines).

### Candidates, in order of likelihood

1. **A gas tail's end.** `gasEmit` in `src/shaders.ts` sweeps each blob
   backward over `tailT` of coordinate time and closes the arc with round caps
   via `over`, but the emission is only added where `d2 < 10`, and the tail is
   dimmed by `taper` and `stretch`. A radial reject (`abs(rp - rb) > ...`)
   comes before any of it. If the seam is where a blob's tail ENDS (along =
   tailT) the cap geometry should hide it — unless the tail is long enough that
   `taper` reaches 0.3 while the cap's gaussian is still bright. Check by
   turning "Infalling gas" off: if the seam goes, it is this.
2. **The disk turbulence's material coordinate.** `diskTurb` wraps `am = az +
   t/(r^1.5 + a)` into `cos, sin`, so it is continuous in azimuth — but if the
   seam is radial (constant azimuth) rather than vertical on screen, look here
   anyway.
3. **A TDE debris capsule** — only if a TDE was launched; the harness does not
   launch one.

### How to find it

Write a temp script on the harness (see `tools/visual/smoke.mjs` for the
shape): default camera, `timespeed: 0` so the frame is frozen, capture the "gl"
layer, and take the horizontal gradient of luminance along a few rows through
the region. A seam is a column where |d luminance| spikes on many rows at the
same x. Then toggle `gas-on`, `disk`, `stars-on` one at a time, re-capture, and
see which toggle removes the spike. That names the emitter.

### The fix

Depends on the emitter; for a gas tail the fix is to fade the tail's end over
the last ~15% of `along` (multiply the emission by `smoothstep(tailT,
0.85*tailT, along)`) so the cap ends in a fade rather than a cut. Keep the
comment about mass conservation — this is a display softening and should say
so. If it is not the gas, stop and write down what it is rather than guessing.

### What to measure

The same gradient spike, before and after: it should fall to the level of the
rows around it. And `npm run pol` — the gas is counted as unpolarized, so the
tick fit must not move.

---

## Item 3 — the auto preset on a real display

### Why

Everything slice 19 measured about the GPU timer came from headless chromium,
whose frame pacing is not a monitor's. The frame-pacing stalls that shaped the
controller (readings of the whole 16.7 ms frame period at low quality, in runs
of up to eight) may be shorter, longer, or absent under a real compositor with
a real vsync, and the controller's constants (`AUTO.window` = 16, `maxDown` =
3, `maxUp` = 2 in `src/adaptive.ts`) were tuned to what headless showed.

### What to do

This needs a person at a screen, or a browser driven in headed mode. Two
measurements, each a script on the harness with `headless: false` (add an
option to `openLab` for it — `LAB_HEADED=1` in the environment is the pattern
the other options use):

1. **Stream the timer at a fixed preset**, exactly as
   `timer-stream.mjs` did: 180 readings of `window.__sceneMs` at high, at low,
   and across a switch between them. Print min / p25 / median / p75 / max and
   the first 40 readings. The question is whether the frame-period readings
   appear, how long the runs are, and whether they ever exceed the 16-frame
   window.
2. **Watch the preset settle**: quality auto, fps limit 240 (a 3.3 ms scene
   budget the full-resolution pass cannot meet), print `window.__sceneScale`
   and the readout once a second for 15 s. It should step down and hold; note
   any dip and its size.

### What to change, if anything

- Runs of stalls longer than 16: raise `AUTO.window` (the cost is slower
  reaction: at 10 fps a 32-frame window is 3 s per step).
- No stalls at all in a real window: nothing to change, but say so in
  DESIGN.md, since the minimum-of-window judgement is then a precaution rather
  than a fix.
- Dips larger than one decision's cap: the cap is doing its job; consider
  requiring two consecutive over-budget windows before a downward move of more
  than one step.

Also worth trying, since it is a one-line change per browser: Firefox and
Safari, which withhold the timer extension, exercise the fallback path in
`autoStep` (the `measured === false` branch). It is unit-tested and has never
run in a browser. Watch the same two things.

### Done reads as

A table of real-display readings in DESIGN.md beside the headless ones, and
either unchanged constants with a sentence saying the headless behaviour was
the worse case, or changed ones with the measurement that changed them.

---

## Item 4 — idle the whole frame once converged

### Why

When a still picture has converged, `main.ts` skips the scene pass, which is
most of the cost, but the bloom chain (five levels down and up), the composite
and the HUD still redraw every frame. On a laptop that is a fan that never
stops for a picture that never changes.

### What to build

In `render()`, after the still-picture bookkeeping: if `converged` and nothing
downstream of the scene target has changed since the last frame — bloom,
threshold, exposure, the tick toggle, the compare split, the canvas size, and
every HUD input (the overlays' toggles, the inset scales, the callout inputs,
the trails, the clocks, `simT`, the grip hover state) — then skip the bloom,
composite and HUD and return early. Build a second key string for "everything
downstream" the way `sceneKey` is built for the scene, and compare.

Three things must keep working:

- `window.__frames` must still increment on every `render()` call, or the
  harness's waits hang. Increment it before the early return.
- The `__wantShot` hook must still be honoured: a capture request forces a
  full frame.
- The readout should say "idle" so the user knows the frame is not being
  redrawn, and the fps number should stop being reported as 60 when nothing
  is drawn — either freeze the readout or show "idle".

### What to measure

`npm run shot`'s refinement checks must stay green (they capture a converged
frame, which forces a full draw). Add one check: after convergence, 60 frames
of `settle()` with no change must not change the composite layer at all —
`pixelDiff` between two captures 60 frames apart, tolerance 0, must read zero.
That is the check that the early return draws nothing different from a full
frame. Then add the HUD case: toggle the clocks on, and the next frame must
carry them (pixelDiff against the previous capture > 0).

---

## Item 5 — pinch to zoom

### Why

`src/camera.ts` zooms on the wheel only. On a touch screen the lab orbits but
cannot zoom, and `touch-action: none` on the canvas means the browser's own
pinch is suppressed too.

### What to build

In `attachControls`, track active pointers by id in a Map (pointerdown adds,
pointerup and pointercancel remove). With two pointers down, the distance
between them on each pointermove against the distance at the previous move
gives a ratio; apply `state.dist /= ratio` (clamped to `DIST_MIN`/`DIST_MAX`
like the wheel), and do NOT orbit while two pointers are down. With one
pointer, behave exactly as now. `claimed` still runs first on the first
pointerdown.

Keep it pure where it can be: `pinchRatio(prevA, prevB, a, b)` is a one-line
pure function, but it is not worth a module; a test would only test hypot.
This item is DOM wiring and stays untested, per the conventions — say so in
the commit.

### What to measure

Playwright can synthesize touch: `page.touchscreen` handles taps only, so use
`page.evaluate` to dispatch two `pointerdown` events with distinct
`pointerId`s and `pointerType: "touch"` on `#view`, then `pointermove`s that
spread them apart, then read `camera.dist` through a dev hook (add
`window.__cameraDist` beside `__sceneScale` in `main.ts`). Before: unchanged.
After: smaller. That is the whole check, in `smoke.mjs`.

---

## Not planned, and why

- **Temporal anti-aliasing while moving.** Needs a motion vector per pixel;
  a lensed image has no useful one (a point of sky moves in a direction that
  depends on how many times its ray wound). Slice 19's DESIGN.md says so.
- **A thicker or slim disk (H4).** Out of scope for a per-pixel raymarcher
  without a radiative-transfer pass, and by design.
- **Dropping the polarization attachment when ticks are off.** The scene
  target always carries two attachments and the pass always writes both. A
  second FBO variant would save one 16F write per pixel; measure first with
  the timer (toggle `edu-polarization` and stream `__sceneMs`) — if the
  difference is under 5% of the pass, it is not worth two code paths.
