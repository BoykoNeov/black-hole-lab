# Design notes

Why the code is the way it is. `README.md` says what the lab does, how the
renderer works and where the code lives; this file carries the per-slice
rationale behind it — the decisions that took an argument to reach, the places
where a physical quantity is deliberately not drawn literally, and what each of
those choices bought.

Read this before changing behaviour that a slice argued its way into. Most of
what follows exists because the obvious thing was tried first and looked wrong,
or read as a bug, or was true of the physics and false of the picture.

Units are geometrized (G = c = M = 1) throughout, as everywhere else.

---

## Slice 5 — tidal disruption events

"Throw a star at it" launches a sun-like star on a marginally bound orbit aimed
to graze its tidal radius r_t, which in units of M is 4.7e5 (M/M☉)^(-2/3) —
that scaling is the whole story. Below ~10^8 M☉ the star is shredded at r_t
into a debris stream; above the Hills mass, r_t sits inside the horizon and the
star is swallowed whole.

The star and all 32 debris elements move on exact timelike Kerr geodesics,
integrated with the same Kerr–Schild Hamiltonian RK4 as the photons (only the
mass shell differs: m·m = -1, with E = -m_t conserved exactly). So the stream's
stretch, the relativistic capture of the deepest debris, and the horizon
crossing all emerge from the integration rather than being staged. What the
debris does is the integrator's business, not ours: at the default mass the
bound tail loops out and fades as the disk eats it on the way back in, while at
~1e7.5 M☉ and low spin — r_t only a couple of M outside the horizon — every
element is captured and crosses. Spin the hole up at that mass and the smaller
horizon lets the same stream survive and loop instead.

Note that a TDE star never *orbits*: it is on a marginally bound (parabolic)
one-pass orbit by construction, so the arc to watch is approach → shred → the
debris tail's loop, not a closed orbit.

### Aiming the star

The aim is floored once the star is swallowed whole. "Graze r_t" stops meaning
anything when r_t is inside the horizon — you cannot skim a radius you can only
cross once — and taken literally it aims the star at 0.02 M at the top of the
mass slider: a dead radial drop that reads as a bug rather than as the
Hills-mass story.

It is aimed at a pericenter well inside the capture threshold instead
(L = 1.73, against a threshold running from 4 at a = 0 to ~2 prograde-extremal,
so the star is still certain to be taken at every spin — tested). That buys a
visibly curved approach and changes no outcome: capture turns on r_t < r+, not
on where the star was aimed.

### The energy spread

The energy spread is widened so first fallback takes ~600 M instead of months.
Kepler ties that period to how far the tail loops, so the same knob also decides
whether the stream stays in frame at all.

The split is biased ~70/30 toward bound rather than the physical 50/50, and the
bound elements are spread by fallback *period* rather than uniformly in energy.
The physical spread is what makes real fallback a t^(-5/3) tail — but drawn
literally it put 27 of 32 elements on ~1e3 M orbits that coast out of frame and
never visibly return. The flare's light curve is integrated analytically and
keeps the true t^(-5/3) shape regardless of how the 32 drawn elements are
spread; its display brightness is sqrt-compressed, and the readout reports the
physical ratio.

### Drawing the stream

The debris elements are drawn as one continuous chain of gaussian capsules
(energy order = stream order), so the star visibly spaghettifies into a single
stretching filament rather than a cloud of blobs. Capsules combine by strongest
contribution — summing would bead the joints — and dim as they stretch.

That dimming is sqrt-softened here, unlike the gas arcs, which take the 1/length
mass-conservation scaling literally. The TDE's returning tail needed the help;
the gas did not, and at the old blob normalization a parcel smeared down a ~7 M
arc bloomed into a solid white band.

### Where the debris fades

The fade is keyed on the *disk's* outer edge, not on r_t. r_t belongs to the
star and scales as M^(-2/3), so at the low end of the mass slider it runs to
hundreds of M — larger than the scene — and keying the fade there dissolved the
whole stream in open space, nowhere near anything that could eat it, before it
could ever fall back.

---

## Slice 6 — the shadow-edge number

The 6g callout quotes how much wider the black disk is than the hole, and that
ratio is a function of spin: the horizon shrinks as `a` climbs while the shadow
barely does. It had been fixed at "about 2.6×", which is right only at a = 0 —
a bug that predated slice 7 and lived in single view, fixed after it.
`edu.ts`'s `shadowHorizonRatio` now supplies it per spin, and `hud.ts`'s
`setShadowSpin` rewrites the line when the slider moves.

The ratio is analytic and spin-only, deliberately not measured off the traced
outline. The shadow's width across the equatorial plane is bounded by the two
equatorial photon orbits, whose impact parameters `photonImpactParameter` gives
in closed form; `b = L/E` is conserved along a null geodesic, so this is the
shadow's true size, free of the camera. Reading it off `findShadowEdge` instead
would have dragged in the camera's distance and pitch, and the number would
drift as the user zoomed.

The exact values are 2.598× at a = 0, 3.370× at a = 0.9 and 4.283× at
a = 0.998, reaching 4.5× at a = 1. (An earlier note quoted 2.49× / 3.23× /
4.11× "measured off the tracer at the default camera". Those came from a
flat-space `camDist·sinθ` that drops the `√(1 − 2/r)` redshift factor, so each
ran ~4% low.) `test/edu.test.ts` ties the quoted number to the drawn shape: at
a distant camera the traced outline's equatorial extremes match
`photonImpactParameter` to 0.2%, so they are the same shadow.

Two things the copy's "about" is carrying. The ratio is measured edge-on, and
tilting toward the pole rounds the shadow out and widens it by up to ~6% at
extreme spin — far less than the 2.6→4.5 spread across spin itself, and the
pitch limit is the only place it shows. The shadow is also a D at high spin, so
its "width" is the widest way across, not a diameter.

---

## Slice 7 — Schwarzschild vs Kerr

Slice 7 turns the spin slider into a controlled experiment. "Compare:
Schwarzschild vs Kerr" splits the frame and renders a = 0 into the left
viewport and the slider's a into the right, from one camera, at one mass and
accretion rate, with the stars on identical orbital elements — so every
difference on screen is the spin's doing and nothing else's.

Neither half is faked or mirrored: the scene pass simply runs twice with a
different a, so both are the full per-pixel geodesic renderer. It is close to
free, because splitting halves each viewport's width and the two draws cover
the pixel count the single one did — the cost is per pixel marched, not per
draw. (The scene shader takes ray directions from `gl_FragCoord` relative to
`uViewOrigin`, not the window, which is the only change the split needed.)

The one thing NOT held constant besides a is the disk's peak temperature, and
deliberately: the ISCO is where spin enters the temperature profile, so the two
halves really are at different temperatures. At a = 0.998 the right-hand disk
goes *dimmer* in visible light, because its hotter inner edge has moved into the
X-ray.

### What it hides rather than fakes

Gas and TDE debris are stateful — advected and integrated frame to frame at one
spin — so they cannot honestly appear on a side whose spin they were never
stepped in. They are dropped from both halves, along with the TDE's flare, which
would otherwise light both disks up to 8× from an event neither half draws.

Stars survive the split because `starState` is a closed form in (t, a): the same
scratch arrays are simply refilled at the other spin between the two draws.

The remaining slice-6 overlays stay off while comparing: the 6g callout layer
projects world points onto the *whole frame* and would stripe across both halves
at positions belonging to neither, and the clocks describe a single spacetime.

### 7b — the outline per side

Each half gets its own traced shadow outline, which is the slice's whole
argument in one picture: a circle on the left, and at high spin a flat-sided D
on the right, each hugging the black disk it belongs to.

Nothing about the tracer changed — `findShadowEdgeIncremental` already returned
NDC and took an aspect — so 7b is a cache per side plus getting the two mappings
right. Both matter:

- The aspect must be the one the *shader* used (its viewport's w/h, far from the
  frame's shape once halved), or the outline is a perfectly-computed boundary of
  a view nobody is looking at.
- The strip it is drawn back into is the GL rect divided by the render scale,
  not an independently re-rounded CSS split, which would sit a pixel off the
  disk it claims to trace.

The static tetrad is spin-dependent, so each side launches its rays from its
own. The two outlines share ONE frame's tracing budget rather than each taking
their own — the a = 0 side goes first because it is far the cheaper (~66 ms of
tracing against ~540 ms at a = 0.998) and then yields the rest — so the HUD
costs what it always did.

### 7c — the insets per side

Both insets are drawn one copy per side, each at the spin of the half behind it
— the potential inset against that half's left edge and the funnel against its
right, so a half reads as a small copy of the whole frame's layout.

Per-side rather than two curves overlaid in one panel, and the funnel is what
decides it: two wireframe surfaces of revolution drawn over each other are a
mesh nobody can read, and splitting the conventions — one inset comparing by
overlay, the other by position — would cost more than it bought. The potential
inset loses nothing by it, because its axis window is a fixed constant: two
panels of it are directly comparable by eye, with no per-side rescaling able to
forge a difference the spin didn't make. That is the same bargain
`splitViewports` makes when it hands both halves equal widths, and the inset
scale is shared across the sides for the same reason — either grip resizes both
copies together, so the halves can never be sized apart.

What the insets show follows the same rule the scene pass follows: only what the
renderer is actually drawing. That cuts per group. Stars are drawn on both
halves, so the funnel refills them at its own side's spin (`starState` is
closed-form in (t, a), so this is the same scratch the scene pass reuses between
its two draws); gas and TDE debris are stateful, drawn on neither half, and so
get no dots and no potential-curve marks on either. The funnel's profile cache
grew a second slot to match — a = 0 and the slider's a are now both asked for
every frame, and one slot would miss on both calls and re-integrate ~400 steps
of quadrature twice per frame, turning a cache into a per-frame cost.

**Why the left panel starts with no stable-orbit marker.** The default `eduL` is
2√3, which is exactly the Schwarzschild ISCO's angular momentum — so out of the
box the left panel shows *no* stable-orbit marker while the right one does. That
is the physics, not a gap: at a = 0 this L puts the trough exactly at the ISCO,
where the minimum and the barrier peak merge into an inflection and annihilate,
which is what the panel's own caption means by the minimum flattening away.

The contrast to read across the divider is the ISCO and photon-orbit markers,
which run 6.00 M and 3.00 M at a = 0 against 1.24 M and 1.07 M at a = 0.998. The
trough itself moves the *other* way (marginal at 6 M, against a real well at
~10.2 M): prograde frame dragging drops L_isco from 3.46 to 1.39, so the same L
now buys an orbit far outside the ISCO rather than sitting on it.

### 7d — the trails per side

7d is the sub-slice the mode was built for: nodal precession is proportional to
a, so the left ring *closes* and the right one walks, from one camera, at one
mass, on identical orbital elements. Measured off the running app at r = 8.5 M
and a = 0.998, over 15 s at 120 M/s, 90% of the pixels the right half's trails
light are new, against 22% on the left — and that 22% is not precession but the
rolling buffer's ends and sub-pixel jitter along a curve being retraced.

Only the stars carry trails here, the same cut the funnel's dots make: gas and
debris are stateful, drawn on neither half, so their paths go with them.

A trail is the one thing about a star that compare mode cannot refill from the
other side's spin. `starState` is closed form in (t, a), which is why the scene
pass and the insets can just re-evaluate the same scratch at the other a — but a
*path* is a record of where the star has been, and the a = 0 half's path is not
the slider half's evaluated differently. It is a different orbit, which is the
whole point of drawing it.

So each spin keeps its own set, recorded side by side every frame — in a pass of
their own, deliberately not inside `fillStars`: that fills the shared
`starPosArr` the scene pass and the funnel both read, and asking it for a second
spin purely to feed a trail would leave the scratch at a spin its next reader
never asked for. Both sets record whether or not the box is ticked, for the
reason 6e's did: a half has to have a ring to show the moment compare goes on,
not an orbit later. The spin slider clears the slider set (a new a teleports
every star, and joining the old samples to the new would draw a jump) and
deliberately spares the a = 0 set, whose ring survives a drag precisely because
a = 0 is what the mode holds fixed.

Each half projects at its *own* viewport's aspect and is clipped to its own
strip. The aspect is the same rule 7b's outline follows. The clip is not: an
orbit is a wide object, and `projectToScreen` calls a point visible out to
|ndc| 1.2 — a margin that exists so 6g's leader lines can anchor just off-screen,
and inside a half it is 10% of a half-width of trail hanging over the divider,
captioning the other spacetime with a path that is not its. In single view the
strip is the whole canvas, so the same clip is a no-op rather than a
compare-only branch.

### 7e — the ring labelled once, the shadow per side

The photon-ring callout is emitted once, against the slider's outline, and the
callout layout is bounded to that side's strip so it cannot slide across the
divider and appear to caption the other spacetime.

The shadow-edge callout is emitted twice, one per half, and that duplication is
the point: 2.6× on the left against 4.3× on the right at a = 0.998 is the same
contrast the circle and the D draw, said as a number. It could not be, while the
copy quoted a flat 2.6× at every spin — that was one number sizing the shadow
against a horizon at one spin, with two on screen, and two labels word-for-word
alike would only have crowded the shape they sat on. `shadowHorizonRatio(a)` is
what unlocked it.

The cost this section used to predict — a per-strip copy and width memo the
`CalloutKey`-keyed table has nowhere to put — never arrived, because a = 0 is
exactly what the mode holds fixed. The left half's ratio is therefore a
*constant*, so `shadowSchw` is ordinary fixed copy filed under a key of its own,
and a key already owns its own copy and its own memo. Only the slider's entry is
still rewritten per spin.

The pair is word-for-word identical but for the ratio, title included: the
number is then the only thing there is to read across the divider, which is the
same reason `splitViewports` hands both halves equal widths. The chips on the
divider already name the spacetimes. At a ≈ 0 both halves honestly read 2.6×,
because there both halves honestly *are* Schwarzschild.

**What the split did change is where the label hangs.** Single view puts it off
the shadow's left edge; a half has no room for that — the block is ~190 px
against ~130 px of sky between the strip's edge and the disk, so the layout's
clamp flips it back over the black disk whose shape the split exists to show.
Both halves hang it below the disk instead. The ring already anchors upward, so
below keeps the two apart; and the two bottom extremes share a y — one camera,
one frame — so the two ratios land level with each other, a divider apart.

### Known limitation: the insets need room

With both insets on at scale 1, compare mode needs a 1435 px window before the
funnel stops overlapping the potential panel's legend. The two just touch there:
the split leaves each half `(clientWidth − 264 − 3) / 2`, and the pair needs 584
of it (`POTENTIAL_W + EMBED_W` plus a margin each side). Single view has more
room and only overlaps below 852 px. Both thresholds are pinned in
`test/insets.test.ts`.

The grips are the remedy and already work per side. The panels are deliberately
not auto-shrunk to fit: a clamp that silently overrides a drag is worse than an
overlap the user can see and fix.

### Known limitation: so do the callout blocks

A label's text block is a fixed width — 176 px for the shadow's, 187 px for the
ring's — and a half is not. The layout slides text right to clear the control
panel before it bounds it to the strip, so once those two demands cross, the
block is pinned at the panel-clearance bound and the strip's end walks left past
it: below ~1005 px of window the shadow's block reaches the gutter, and the
ring's does from ~1049 px. Narrower still and a label overhangs the half it
describes, which is exactly what bounding it to the strip was meant to prevent.

Left as is, on two grounds. It is not 7e's: the ring's label has done this since
7b and gives way *first*, so the shadow's is the better-behaved of the pair, and
squaring it properly means teaching the layout a narrow mode — shorter copy, or
text under the disk rather than beside it — which is a change to every callout,
not to this one. And the window it needs is one compare mode does not have:
1435 px is already the asking price for the insets, and the split is unreadable
long before 1005 px regardless of what the labels do.

That bargain does not extend to the label 7e hangs below the disk, which lands
in the band the insets anchor in — and they are opaque and drawn *after* the
callout layer, so a label reaching into one is not crowded but overdrawn,
illegible under a wireframe rather than visibly in the way. At 1440×790 — an
ordinary laptop, with both insets on — it was. So `drawCallouts` takes a floor
instead of a height, and the caller passes the top of the shown insets on that
side; the `ty` clamp it already ran turns that into "no text below here" for
free. Below ~880 px the label rides up off its natural place and sits on the
black disk, which stays readable and is the honest signal that the window is out
of room. Single view passes the full canvas: its shadow label rides at the
disk's mid-height, nowhere near the panels, and bounding it would move labels
this change never touched.

## Slice 8 — what gamma costs the renderer

The photon ring is not one feature. It is a ladder: light that looped the hole
once, then twice, then forever, each image thinner than the last by a fixed
factor. That factor is `e^-gamma`, with gamma the Lyapunov exponent of the
unstable circular photon orbit — how fast the orbit sheds what it holds.
`edu.ts`'s `photonOrbitLyapunov` gives it in closed form, per half-orbit, and it
is exactly `pi` at a = 0: the textbook `e^-pi ~ 1/23`.

Spin splits it hard, and asymmetrically. Frame dragging makes the prograde orbit
long-lived — gamma falls to 1.22 at a = 0.9 and 0.19 at a = 0.998 — while the
retrograde orbit becomes *more* unstable than Schwarzschild's, 4.00 and 4.08.
So Schwarzschild's ladder is symmetric and collapses after one rung, and Kerr's
is lopsided: rungs that barely converge on one edge, gone instantly on the other.

The slice set out to draw that ladder. It found something better first.

### The same number says where the picture lies

Gamma does not only space the rings. It sets how long light lingers near the
photon orbit — and therefore how many RK4 steps a ray needs before it resolves
into "escaped" or "captured". The scene shader affords `MARCH_MAX_STEPS` of
them, and it *used to* leave a ray that spent them as captured. Where gamma is
large that is free: the light is gone long before the budget is. Where gamma is
small it is not, and the renderer painted escaping light black.

Measured on the frame with `tools/visual/harness.mjs`, at a = 0.998, sky-lit,
fov 30: the rendered black disk ran **51 px past the traced outline on the
prograde edge**, and 0 px on the retrograde one. At a = 0 the two agreed to a
pixel. The rendered shadow was circular there; the true one is a D. The step
budget filled in the D's flat side.

The rest of this section is the diagnosis, which stands. What was done about it
is below, and it is not what this slice first concluded.

That is a one-sided error, which is the whole tell — a projection bug would move
both edges. The cost tracks gamma and nothing else (these are the CPU tracer's
numbers, budget the only variable — the *prediction*, which the next section
reconciles against the 51 px measured off the rendered frame):

| edge | gamma | false shadow, predicted |
|---|---|---|
| a = 0, both | 3.14 | 0.2 px |
| a = 0.9 retrograde | 4.00 | 0.0 px |
| a = 0.998 retrograde | 4.08 | 0.0 px |
| a = 0.9 prograde | 1.22 | 23 px |
| a = 0.998 prograde | 0.19 | 53.5 px |

### It is the budget, not float32

The obvious second suspect is the shader's float32 against the oracle's float64,
and the first draft of this section blamed both. It is neither honest nor true:
the two were separated before the claim was written. Re-running the same
float64 tracer at `MARCH_MAX_STEPS` instead of 4000 — budget the only variable —
reproduces **53.5 px** against the 51 px measured on the rendered frame. There
is nothing left for precision to explain, and `test/edu.test.ts` pins it.

This matters for what you would do about it. A precision-limited edge would not
be fixed by a bigger budget; a budget-limited one would. But see below.

### Why the budget was the wrong lever

Raising it pays badly, and gamma is again the reason. The rungs sit at `e^-gamma`
of each other, so at a = 0.998 prograde (`e^-0.19 = 0.82`) they barely converge:
each extra rung buys ~18% off the error and costs ~280 more steps. Sub-pixel
would need thousands of steps — a global per-pixel cost, paid by every frame at
every spin, to fix one edge at a setting almost nobody visits.

But "pays badly" undersells it, and this section used to stop there and conclude
the error was a trade to live with. It is not a trade. A ray at offset `delta`
from the critical curve needs `~(1/gamma) ln(1/delta)` half-orbits to settle, so
the steps needed **diverge** as the edge is approached. No budget reaches it. Nor
does a cleverer step rule — the near-hole arc length is over-conservative and a
constant-steps-per-orbit rule would buy maybe 3-4x, which a divergence eats
without noticing. Both levers are the same lever, and it does not reach.

The budget stays at 320 anyway. It just no longer decides anything.

### The fate is not an integration result

Capture does not have to be discovered by watching. A Kerr null geodesic's fate
is fixed by two conserved numbers — `lambda = L_z/E` and Carter's `q = Q/E^2` —
through the radial potential

    R(r)/E^2 = (r^2 + a^2 - a*lambda)^2 - Delta*[(lambda-a)^2 + q]

`Sigma^2 (dr/dlambda)^2 = R`, so the ray lives where `R >= 0` and turns where it
vanishes: it plunges **iff** `R` stays positive from the camera down to `r+`. One
turning point above the horizon and it reflects and escapes instead.

`R(r+) = (r+^2 + a^2 - a*lambda)^2 >= 0`, and `R(camera) > 0` because the ray is
there. So roots between them come in pairs, and `R` has to dip through a local
minimum to reach them — testing `R`'s sign at its interior critical points
settles it, and those are the roots of the cubic `R'/4`. `kerr.ts`'s
`rayCaptured` does that; the shader mirrors it. Cost: no steps. So no exponent,
and nothing left for a budget to buy.

The claim worth making is not that this agrees with the 4000-step trace but that
it is the edge the march **converges to**. Spend more and the marched edge walks
monotonically inward and lands on it, never crossing: at a = 0.998 prograde,
54.1px → 14.0px → 0.61px → 0.00px for 320 → 1k → 4k → 20k steps. `edu.test.ts`
pins the sequence, not just the endpoint.

Two pieces of algebra earned their place. Carter's `Q` is usually written
`p_theta^2 + cos^2(th)(L_z^2/sin^2(th) - a^2 E^2)`, which divides by zero on the
spin axis — where a face-on camera sits. Kerr–Schild shares `r` and `theta` with
Boyer–Lindquist and mixes only `t` and `phi` with `r`, so `p_theta` is the same
covector in both and comes straight off the Cartesian map:
`p_theta = cot(th)(x m_x + z m_z) - r sin(th) m_y`. Then the Lagrange identity
`(x m_x + z m_z)^2 + (z m_x - x m_z)^2 = (x^2+z^2)(m_x^2+m_z^2)` collects the two
`cot^2` terms, and `x^2 + z^2 = (r^2+a^2) sin^2(th)` cancels the `sin^2` out of
the denominator for good. What is left is a polynomial, regular everywhere: no
axis case, no epsilon. Second, `R`'s constant term is `-a^2 q` in closed form.
Expanding the square instead gives `(a^2 - a*lambda)^2 - a^2 k`, which at
a = 0.998 near the critical curve is `1.188 - 1.185` — three of float32's seven
digits gone exactly where the shader needs them.

float32 is otherwise fine here, which is not obvious, because the sign test sits
at a double root where conditioning is worst. Measured: the prograde edge is the
soft one (`dRmin/ds = -1.04`, against the retrograde's `-949`), and float32's
slop in `R` moves it by `1e-4 px`.

### What changed on the frame

Measured with `tools/visual/harness.mjs` — sky-lit, fov 30, bloom off, the same
rows before and after — the prograde edge moves **in by 22px at a = 0.9 and 53px
at a = 0.998**, against the 23 and 53.5 the table above predicted. a = 0 and both
retrograde edges do not move by a single pixel: the one-sidedness that was the
tell is now the regression check. The rendered disk at a = 0.998 is a D.

Three scoping notes the copy has to carry.

The fate is exact; the **colour of the revealed band is not**. Those rays are
still winding when the budget ends, so they take the sky at their
direction-at-exhaustion, which is near-tangent to the photon shell and nothing
like their asymptotic direction. The band was measured for a seam and there is
none — it is lensed nebula on both sides, wiggling by the same ±20 luma inside
the band as outside — but "sky at an approximate direction" is the honest
description of it. It beats black, which was not approximate but the wrong
*fate*, and whether there is a hole in front of you is what the picture is for.
Sub-pixel truth in a chaotically lensed band is not reachable at one sample per
pixel anywhere near the ring, so nothing else was on offer.

The 51 px was a **sky-lit** number: a culled ray still keeps whatever disk light
it crossed on the way in, so with the disk on those pixels rendered as disk
rather than black and the D survived — the error was worst where there was
nothing else to fill it.

And gamma is a per-edge equatorial number, never one value around the ring: off
the equatorial plane the orbits are Carter-Q spherical ones with their own
exponents. The criterion above carries no such restriction — `q` is exactly what
it takes to handle the rest of the ring, which is why it needed computing.

### Now the outline is the one that is wrong

6f's traced D runs at 4000 steps, and this section used to call it the one that
is right. It was right *about the renderer*, and the orange D sitting inside the
black disk is what caught it. But it is not exact: 4000 steps still leave it
~0.6px outside the true edge at a = 0.998 prograde. That is a hundredth of the
shader's old error and invisible on the frame, but it is not zero, and
`edu.test.ts` pins it rather than rounding it away. The renderer is now the more
accurate of the two. Pointing `findShadowEdge` at `rayCaptured` would make the
outline exact and drop ~540 ms of tracing per outline; not done here — done in
slice 9, below.

The code-level claim that started all this stands corrected either way:
`findShadowEdgeIncremental` used to say the outline "matches the rendered black
disk by construction". It matches its *launch geometry* by construction. The
integration is where they parted — and now nothing integrates to decide it.

### The winding number is a definition, not a detail

Measuring any of this needs to know how far around a ray went, and the three
candidates are not interchangeable. Counting equatorial-plane crossings — which
`traceRayKerr` already did — is degenerate for an edge-on camera's in-plane
rays, which never cross, and those are exactly where the equatorial gamma lives.
Accumulating azimuth about the spin axis fails for rays that swing near that
axis, where azimuth is ill-defined. The angle swept by the position direction
needs neither a plane nor an axis, and at a = 0 — where spherical symmetry means
every view must agree — it is the only one that does: edge-on and face-on fits
return 3.14570 apiece, against azimuth's 3.14570 and 3.17941. So that is what
the tracer reports.

Quote gamma, or "each ring is `e^-gamma` of the last" — never an absolute
subring index. The winding is a swept angle measured from the camera, so it
carries a camera-distance offset: the rung the lab calls 1 is just lensing at
100 px out, not the literature's first subring. The *spacing* is invariant and
the offset is not, which is why the tests fit a slope and never an intercept.

### The fits sit high, and the tests say so

Recovering gamma from traced rays — fitting winding against `ln(offset)`, whose
slope is `-1/gamma` — lands a few tenths of a percent above the closed form,
every spin, both edges. That is the stepper: finite RK4 steps along a trajectory
whose deviation is growing exponentially overstate the growth. It is systematic
and one-sided, so `edu.test.ts` asserts the sign of the bias rather than hiding
it inside a symmetric tolerance. A fit that came in *low* would mean something
new, and the test is written to notice.

---

## Slice 9 — the ladder, drawn; the outline, exact

Slice 8 built a criterion and used it in one place. This slice found the
criterion had a hole, then used it in two more.

### The criterion was blind to the launch direction

`rayCaptured` asked whether the radial potential dips negative anywhere between
the horizon and the camera. For a ray moving inward that is the whole story:
the first negative minimum below it is a turning point, and it reflects. But
the test never looked at which way the ray was going, so a ray moving
*outward* with a clean potential below it was called captured — a ray pointed
straight away from the hole, λ = q = 0, R = r^4 > 0 everywhere, "captured".

From the default camera it never showed. Such rays escape by marching long
before the budget ends, so the shader never consulted the criterion for them,
and the outline's bracket never launches a ray more than ~50° off the hole.
But the orbit camera goes down to r = 3.2, and at a = 0.998 that is INSIDE the
retrograde photon orbit at r = 3.9. A ray launched outward and retrograde from
there climbs toward that orbit, and one of two things happens: R has a negative
minimum at ~3.9, the ray turns and falls back down into a potential with no
other turning point, and it is captured; or R stays positive there, and it
leaves. The old test could not tell these apart because it never looked above
the camera. Sweeping the sphere of launch directions from that position, the
verdict changes on ~30% of them (746 of 2520 at a = 0.998; 1033 at a = 0, where
r = 3.2 is just outside the photon sphere and nearly every outward ray leaves).

The fix is one more clause, and it is exact: an outward ray is captured iff
there is a negative minimum ABOVE the camera (R(∞) > 0 too, so a turning point
up there is again a dip through a minimum) and none below. The sign of dr/dσ at
launch is `grad(r) · dx/dσ` with the gradient `derivs` already differentiates
f and l with. `test/kerr.test.ts` holds both branches to 20000-step traces from
r = 3.2, and counts that both outcomes really occur. The shader mirrors it; the
budget-exhausted rays it consults the criterion for are the ones winding at
the retrograde orbit from inside, which is exactly the case that was wrong.

### The outline is the criterion

6f's outline traced 4000 RK4 steps per sample, ~1000 samples per outline, and
was ~0.6 px outside the true edge at a = 0.998 prograde (the march's residual,
pinned in `edu.test.ts` and kept pinned). Everything that made it expensive —
the debounce, the per-trace generator, the frame budget that scaled with the
measured frame interval, the faded stale outline, the harness's four-second
`settle()` — existed because of that cost.

It now asks `rayCaptured` per sample. A cubic solve instead of a march: the
whole outline is well under a millisecond, so it is recomputed whenever the
view changes and simply follows the camera under a drag. The sample count went
to 96 azimuths and 24 bisections (1e-8 in ndc) because both were free. The
generator, `findShadowEdgeIncremental`, the `fresh`/`deadline` state and the
three `SHADOW_*` budget constants are gone; the outline has no stale state to
fade. And the claim `findShadowEdgeIncremental` once made — "matches the
rendered black disk by construction" — is finally true: the shader's fate test
and the outline's are the same function of the launch geometry.

### Drawing the ladder

Slice 8 set out to draw the ladder and drew nothing. The ingredient it needed
was already defined: `traceRayKerr`'s `winding`, the angle the ray's position
direction sweeps, in half-turns. The shader now accumulates the same sum step
by step (`atan(|p × p'|, p · p')`, gated behind the mode's uniform so the
normal render pays nothing) and, in ladder mode, replaces the pixel's colour
with a band per whole half-turn.

Why the swept angle and not the equatorial crossing count is argued in slice 8
and holds here for the same reason: it needs no plane and no axis. What it
gives on screen is the honest version of the "n-th subring" picture. Band 0–1
is the direct view; the 0/1 boundary is the Einstein ring of the point behind
the hole; 1–2 is the far side seen once around; every further integer is
another Einstein ring of the point behind the hole (odd) or behind the camera
(even). Each band is `e^(−γ)` the width of the last, so the picture at a = 0
is three bands and a hairline, and the prograde edge at a = 0.998 is a
staircase with ~0.82 per step — that ratio is the whole point, and the legend
quotes it per edge from `photonOrbitLyapunov`.

Three choices in the colouring. The hue is the band but the *brightness* is the
scene's own luminance, Reinhard-squashed, so the disk's crossings and the sky
survive underneath and the view stays a view of the hole rather than a
diagram of it. The integer boundaries get a constant-width hairline from
`fwidth`, because the bands near the critical curve are sub-pixel and only the
lines make them countable. And the band of rays still winding when the budget
ends is its own colour, magenta, not a band number: their fate is exact and
their colour in the normal view is not (slice 8's last scoping note), and this
is the one place that band is drawn as what it is. On the frame it is the
~50 px on the a = 0.998 prograde edge that slice 8 measured, now visible
without a harness, and the acceptance test for whatever closes it
(`docs/ROADMAP.md`, H1).

The palette lives in `shaders.ts` as data, `LADDER_RUNGS`, and the GLSL is
generated from it. The legend in `hud.ts` reads the same table, so a swatch
cannot name a band the shader paints differently. The legend's own layout is
`insets.ts`'s `legendBox`, tested, because a panel drawn at a position nothing
checks is how the insets' grips ended up unreachable once already.

## Slice 10 — polarization, and what it does not cost

Light from the disk arrives polarized, and Kerr turns the plane of that
polarization on the way out. The obvious way to render that is the one this
slice does not take: carry a polarization vector alongside the momentum and
parallel-transport it every march step. That would add four components to the
hot loop and roughly double the most expensive shader in the lab, for a
quantity that is drawn once per pixel.

It is not necessary. A polarization dragged along a null geodesic in Kerr
carries a conserved complex number, the Walker–Penrose constant. Conserved
means it can be evaluated at the disk and read at the camera with nothing in
between — two closed forms per crossing, and no per-step cost at all. The
polarization is the third thing this spacetime hands over for free, after the
axial momentum and Carter's constant, and for the same reason: Kerr has more
symmetry than it looks like it has.

### The camera is not at infinity, so the textbook screen formulas do not apply

Every treatment of this writes the observed polarization angle in terms of the
impact parameters of an observer infinitely far away. The orbit camera goes
down to r = 3.2. So instead: the camera's own two sky legs — the tetrad
directions perpendicular to the pixel's ray — are themselves legitimate
polarizations, and their constants form a basis. The emitted constant is
resolved against that basis by a 2x2 solve, which is exact at any radius and
reduces to the textbook answer far away.

That basis turns out to be better than merely correct. The map from
polarizations to constants is a *similarity* — a rotation and a scale — and
the scale is the same at both ends of a geodesic, because a unit polarization
stays unit and the constant does not move. So a unit emitted polarization
comes back as a unit sky vector, exactly, and `test/polarization.test.ts`
checks that every step along a traced ray. It is the cheapest single statement
that the closed form, the basis and the tangent all agree.

### Boyer–Lindquist's singularities are the coordinates', not the geometry's

The constant is normally written in Boyer–Lindquist components. The lab
marches in Cartesian Kerr–Schild, so it needed rewriting there, and two of the
four 1-forms involved naively carry a `1/Delta` that blows up on the horizon,
while the azimuth is singular on the spin axis a face-on camera sits on.

Neither survives the algebra. The whole `dr` part of `(r^2+a^2) dphi - a dt`
cancels identically — its coefficient is `a - a*Delta/Delta` — and the `dr`
part of the other drops out of the wedge it appears in. The axis-singular
piece is only ever needed as a product that is the round sphere's area form in
disguise; expanded, a factor of `sin^2(theta)` cancels top and bottom and
leaves a polynomial. No epsilons, no special cases. This is the same story
`carterQ` told in slice 8, and the fact that the `1/Delta` cancels *exactly*
is itself evidence that the sign conventions cohere, since a single wrong sign
leaves a residue.

Kerr–Schild pays once more: `det(g) = -1` there exactly, so the Levi-Civita
tensor is the bare permutation symbol and the cross product the emitter model
needs costs no determinant and no square root. Its four components carry
alternating signs, and writing them alike — which is easy to do — silently
destroys the orthogonality the construction exists for. The tests caught that.

### The emitter is the one fitted thing, and it moves lengths only

Light escaping the Novikov–Thorne sheet passes through an atmosphere where
electron scattering dominates, and scattering polarizes: nothing face-on,
parallel to the surface at grazing incidence. The **direction** that fixes is
exact geometry — the 4-cross product of the orbiting matter's 4-velocity, the
disk normal and the photon direction — with no fitted number in it, and it is
a director, so there is no handedness left to get wrong.

The polarized **fraction** is fitted. Its endpoints are real: 0 face-on and
11.7% grazing, the value the accretion-disk literature quotes from
Chandrasekhar's 1960 Table XXIV. That table was not obtainable from any
secondary source, so the curve between the endpoints is a `(1-mu)/(1+mu)`
shape scaled to meet them. It is labelled as a fit, in the same class as the
jet's `g <= 1.6` clamp, and it moves tick *lengths* and nothing else.
`ROADMAP.md`'s H8 says how to close it.

Note that a face-on view is *almost* unpolarized rather than exactly so, and
the residue is physical rather than numerical: the disk's own orbital motion
aberrates the emission direction by ~19 degrees at these radii, so the matter
does not see the light leaving along its normal even when the distant camera
does.

### Each crossing is resolved before it is added

A ray pierces the disk more than once — that is the doubled image, and the
ring's rungs beyond it — and the two images arrive with their planes turned
differently. Where they overlap the light really is depolarized, and the ticks
really do shorten there. Getting that requires resolving each crossing onto
the sky basis *before* adding it, weighted by its own brightness.

The shortcut worth naming, because it looks valid: the constant is linear in
the polarization, so summing the constants and resolving once seems equivalent
and is much cheaper. It is wrong. Stokes parameters are quadratic in the
polarization, so a sum of constants describes the coherent sum of two waves,
not the incoherent overlap of two images.

### The overlay: what is stored, and where it is sampled

The scene target grows a second attachment. The polarization falls out of the
march the scene pass already ran, so it rides along rather than paying for a
second pass over the geometry.

What is stored there is the screen-basis `(Q, U)` pair and not an angle. The
scene renders below native resolution by design, so that texture is filtered
on the way into the composite, and an angle would wrap — averaging 179 and
-179 degrees gives 0, which is perpendicular to both. Stokes parameters
average correctly, which is what they are for.

Each tick is sampled at its own cell centre, one fetch, so its direction is
the polarization of the ray through that point. Reading the value per fragment
instead would bend every mark into a slight arc.

A tick fades with the light it describes, through the same exposure and tone
curve the frame went through. Without that the disk's invisible outer fringe —
where its opacity has faded to a millionth but not to zero — carried marks as
bold as the inner ring's, because the polarized *fraction* says nothing about
brightness, and the overlay claimed a disk out to the corners of the frame.
The ink flips dark over the bright disk and light over dark sky: the disk runs
from near-black at its rim to blown out at the inner ring, and no single tick
colour can be read against both.

### The physics now lives twice, so a tool checks the copy

`src/polarization.ts` is the tested oracle and the scene shader carries a GLSL
transcription of the same closed form. Unit tests reach the first and not the
second, and a transcription error — one flipped Levi-Civita sign, one 1-form
mistyped — still draws something that looks like a polarization map.

`npm run pol` (`tools/visual/polarization.mjs`) closes that gap by measuring
the marks the lab actually **drew**: it fits each tick's principal axis from
the difference between a ticks-on and a ticks-off frame of a frozen scene, and
recomputes every one on the CPU. It sweeps the spin rather than checking one
value, because the spin enters the closed form in four places and three of
them vanish at a = 0, so a wrong sign in a term that stays small at a = 0.9
would sail past a single run. Measured: mean 0.20, 0.24 and 0.23 degrees at
a = 0, 0.9 and 0.998, worst 2.09. Reading the drawn ink rather than the buffer
behind it also covers the projection and the tick pass, which is the point —
what is compared is what the viewer sees.

Three conventions it had to get right, all of which produce plausible-looking
nonsense when wrong. The tick grid is anchored where GL's origin is, at the
*bottom*; counting rows from the top instead puts every cell boundary half a
mark out whenever the frame height is not a multiple of the pitch, and each
measured cell then straddles two ticks and reports their average. Only
single-crossing pixels are compared, since reproducing the shader's brightness
weighting on the CPU would mean reproducing the disk's turbulence too — a
second transcription to get wrong, for no extra coverage. And cells where the
field turns faster than a couple of degrees *per pixel* are skipped: at the
disk's inner edge one tick does not stand for a single direction, and the two
sides then differ by how far apart their sampling points effectively are
rather than about any physics. That is not a fudge to make a number pass —
the excluded cells were measured, and they sit where the answer moves 22
degrees across one pixel while the two sides differ by 5. Three cells over the
whole sweep.

## Slices 11 and 12 — the band closed, and the pole crossed

Slice 8 established that no finite march budget reaches the critical curve:
settling a ray at offset δ from it takes ~(1/γ) ln(1/δ) half-orbits, so the
step count *diverges* at the edge. Slice 9c drew the rays that ran out as their
own colour rather than passing them off as sky. These two slices are what earns
the right to stop drawing that colour — and neither of them moves
`MARCH_MAX_STEPS`, because a slice that worked by raising it would not have
worked at all.

### Separated, not tabulated

`docs/ROADMAP.md` originally proposed a precomputed table over the critical
curve, looked up by a ray's conserved constants. That is under-specified, and
the reason is worth keeping: **the escape direction is not a function of
(λ, q) alone.** Where the photon freezes on the near-critical shell depends on
the remaining Mino time and therefore on the *phase* at exhaustion — two rays
with the same constants and different phases leave in different directions.

What works instead is that a Kerr null geodesic *separates*. In Mino time
(dτ = dσ/Σ) the radial and polar motions are independent one-dimensional
problems, and with u = cos θ both potentials are polynomials. Squaring the
usual first-order equations once removes the square roots and all the
turning-point sign bookkeeping — the classic place these implementations
break — leaving five scalars, no metric and no metric gradients. The deepest
sampled band ray needs 291,419 steps of a converged march and finishes here in
a few hundred. On the rays that need it this is not merely cheaper than
marching, it is *more accurate*, because it holds the constants exactly instead
of accumulating them.

### The constants come from the launch, not from the handoff

The continuation starts from the exhausted march but takes only its *phase*:
r, u, az and the two signs. λ and q come from the camera, where nothing has
drifted, and the momenta are re-projected onto ±√R and ±√U with those
constants — which puts the ray back exactly on the null cone.

Taking the constants from the exhausted state instead costs an order of
magnitude where it matters most: 0.68° against 0.00024° on the deep-band ray.
Worse, it *plateaus* — refining the step does not help, because the drifted
constants are the error floor. By 320 steps the march has drifted the
Hamiltonian to 3.6e-6, which near a turning point is a percent of the radial
potential, and γ turns that into an exponentially growing phase error. This is
why `test/mino.test.ts` insists the error *fall* with the step scale rather
than merely clear a threshold: the wrong variant passes an absolute bound and
then stops improving.

### The pole was registered, then closed

`src/mino.ts` works in the separated (r, θ, φ) chart, and that chart is
singular on the spin axis. A ray passing over the pole must swing its azimuth
by very nearly π inside a Mino interval of order 2e-5, and at λ exactly zero
the term λ/(1 − u²) is 0/0 — so the crossing degenerates into a *reflection* no
matter how fine the step. Slice 11a measured it (every ray whose closest
approach to the axis stayed above 1e-5 landed within 0.009°, the ones below
reached 126°), refused to guess, and registered it as H9.

Slice 12 closes it, and the shape of the fix is the interesting part. The
passage past the turning point costs two integrals, both counting *both* legs:

    dτ      = ∫ dv / (√(1−v) √U)
    dφ_sing = ∫ λ dv / (v √(1−v) √U)

with v = 1 − u², U = −λ² + Bv − a²v² and B = a² + q + λ². Substituting
v = v_min + √D·w² makes √U = √D·w·√(1 − a²w²), so the turning point's 1/√U
cancels identically — **and nothing divides by the spin.** The roadmap's
recorded arcsin form does, and a = 0 is not hypothetical: at zero spin the
default camera still has 384 band pixels and rays that cross the pole.

Geometrically, θ² ≈ v = v_min + √D·w² with the azimuth swinging as
2·arctan(w/w_c) is a *straight line at distance √v_min from the pole*, in the
tangent plane there. That is why the swing is π, why an arctangent is the whole
answer, and why the swept angle takes the closest-approach point rather than
the endpoints — for a straight line, two chords through its nearest point are
exact where one chord across is 1.1·√v_min short.

λ = 0 is then not a special case at all, provided it is written carefully:
`atan2` gives π/2 against a vanishing w_c where a division would give an
infinity, and the sign takes zero to +1. The apparent discontinuity between +π
and −π is not one — **they are the same azimuth.** The whole of H9 is that this
limit exists and the ODE cannot see it.

### Reflecting and jumping is exact, not a shortcut

Two facts make it so. The polar motion is autonomous and symmetric about its
turning point, so the ray leaves at the v it entered with pu reversed. And
dr/dτ, dpr/dτ and the *regular* part of the azimuth contain no u at all — that
is what separation means — so the radial pair can be advanced across the
passage without knowing where in the polar swing the ray is. What is left is an
O(v²) truncation and RK4 on a two-scalar system over a Mino interval of ~0.02.

### Two guards that reasoning did not produce and measurement did

Both were found after the derivation had already concluded, and both are large.

**A ray may leave before its polar swing finishes.** Rays at r = 11 to 31
heading out, inbound in u and bound for the pole, cross the escape radius first
at very nearly the same Mino time. Jumping one through a crossing that never
happens is worth **14°**. The passage is therefore trialled and refused, and
the trial is not repeated: pr > 0 outside the escape radius is monotone.

**A step may jump clean over the trigger window.** With no cap on how fast
1 − u² may fall, a single step goes from above the trigger to past the turning
point, the trigger never fires, and the ray reflects without its half-turn —
**155°**, which is the original H9 failure wearing a new hat. `MINO_V_FALL`
caps the *fractional* fall and converges: 2.2e-2, 2.1e-3, 2.1e-4, 1.3e-4 and
1.2e-4 degrees at no cap, 0.6, 0.3, 0.15 and 0.05.

Slice 11's azimuth step bound survives both, and that is measured too. It is
tempting to delete it once the sharp part is analytic, but it watches the
*approach* to the trigger, not only the crossing: removing it costs 5.8e-2°
against 1.3e-4° for 189 saved steps.

### What the magenta means now, and why it is not deleted

Slice 11b turned the off-ladder colour from a feature into a tripwire: it means
"the continuation spent `MINO_MAX_STEPS`", and it should read zero pixels at
every reachable setting. An instrument that reads zero is a passing check, not
dead UI — which is exactly why it earns its keep. It did *not* read zero when
slice 12 measured it: over a 1280×800 grid at fifteen cameras, an ordinary
deep-band ray at a = 0.998 from the default camera needs 1053 steps against a
cap of 1024, and two pixels were clipping. Nothing near the spin axis is
involved; slice 11's camera set simply missed it. The cap moved to 1536.

Slice 11b's *second* off-ladder colour is gone. It said "over the spin axis —
chart cannot follow", which is no longer true of any ray, and leaving it would
have left the tripwire sharing a frame with a colour meaning "expected".

### What the band shows, and what it does not claim

The rays these slices fix are exponentially sensitive to their own state — that
is what γ *means*. The 320-step prefix has already drifted before the
continuation starts, so a given band pixel is not guaranteed to show the star an
exact computation would put there. What is guaranteed is that it shows a
correct member of the right ensemble: a real escape direction of a real null
geodesic with this ray's exact constants, rather than a frozen mid-orbit
snapshot. That region of sky is a chaotic scattering region holding
exponentially compressed copies of the whole sky, and the point is that it now
*looks* like one. Claiming pixel-exactness there would be claiming something no
method can deliver.

### Reading a false-colour view is not reading its colours

`npm run band` checks the GLSL copy, and how it does that took two wrong turns
worth recording, because both are about the difference between the picture and
the quantity behind it.

Classifying each pixel by which rung colour it is nearest reported 36% of a row
on the wrong rung — and was measuring the tonemap. The composite's ACES curve
plus bloom desaturate a rung until it sits *nearer its neighbour's chromaticity
than its own*: the 1–2 rung reads 0.196, 0.357, 0.447 against its own 0.118,
0.324, 0.559 and the 0–1 rung's 0.283, 0.321, 0.396. So the check reads the
**hairlines** instead. The shader draws a dark line at every whole turn, so a
line's *position* is where the winding crosses an integer — a claim about the
physics, to sub-pixel precision, and a local minimum survives any monotone
curve that a colour does not.

The tripwire has the same problem and a different answer: it counts by the
*direction* of the chromaticity away from neutral rather than the distance to
it, because desaturation slides a colour along that direction and leaves it
alone. A distance test called 48 pixels of the 5+ rung magenta; those same
pixels score 0.99 against their own direction and 0.59 against the magenta.
Tightening the distance would have hidden them — and hidden a real magenta with
them, which for a tripwire is the failure that matters.

Crossings where the winding turns faster than 0.05 half-turns per pixel are not
compared at all. Toward the critical curve the rungs crowd geometrically — that
is the whole point of the view — and a line there is thinner than a pixel, so
asking where it sits reads 1.25 half-turns "off" purely because four pixels is
more than a rung. Those crossings are checked by the tripwire and on the CPU
instead. Over the ones a frame can locate, the shader and the oracle agree to
0.027 half-turns, and that is the float32 question the unit tests cannot reach.

## Slice 13 — the light the continuation was already carrying

Slices 11 and 12 gave a budget-exhausted ray a real escape direction and a real
winding. What they did not give it is the **light it collects on the way out**.
The ray goes on crossing the equatorial plane after the march stops, and every
one of those crossings is a pass through the accretion disk that nothing was
shading — so the photon ring's inner rungs rendered darker than they are, and
some of them rendered as empty sky.

### The hurdle predicted a series that does not exist

H1's paragraph said the fix was to sum the remaining crossings analytically:
each further half-orbit crosses the equator once more, at a radius converging
geometrically to the photon orbit's, so the tail is a geometric series to be
evaluated in closed form.

That series is real and it is **invisible**, for a reason the entry never
checked. The crossings converge on the photon orbit, and at low spin the photon
orbit is *inside the disk's inner edge*:

| a | photon orbits (prograde / retrograde) | ISCO = inner edge |
| --- | --- | --- |
| 0 | 3.000 / 3.000 | 6.000 |
| 0.9 | 1.558 / 4.330 | 2.321 |
| 0.998 | 1.074 / 4.000 | 1.237 |

At a = 0 every hovering crossing lands at r = 3 in a disk that starts at 6. The
whole tail emits nothing, and summing it would have added nothing to the frame.
What a band ray actually misses is the handful of crossings on its **outbound
leg**, where r climbs back out through the disk — one, two or three per pixel,
not a series. Only at high spin does any of the hovering itself reach the disk,
and then because the ISCO has dropped below the *retrograde* photon orbit at
r ≈ 4, not because the series converges more slowly.

So the slice is smaller than the hurdle: no closed form, no expansion. Detect
the sign change of `u` in the loop that is already tracking `u`, and shade it.

### What it is worth, measured before anything was written

At the default camera, over a 1280×800 grid, as a bolometric proxy
`Σ (T_n(r) g)⁴` over a band pixel's crossings:

| a | band px | gain disk light | *saw no disk crossing at all* in the march | added ÷ already had (median) |
| --- | --- | --- | --- | --- |
| 0 | 6 | 0 | 4 | — |
| 0.9 | 248 | 116 | 98 | **1.77** |
| 0.998 | 510 | 325 | 47 | **0.92** |

At a = 0.9 the continuation roughly triples the disk light on the band pixels
that had any, and 98 of them were rendering as sky with a disk image missing
from them entirely. At a = 0.998 it roughly doubles it, and those crossings pile
up at r ≈ 1.5 against an ISCO of 1.237 — which is where the temperature profile
peaks, so they are the hottest part of the disk seen through the most winding.

At a = 0 nothing changes. That is the honest headline and the reason the hurdle
sat open looking cosmetic: the screenshot everyone looks at is a slow spin.

### Rebuilding the momentum: the null condition, not the linear one

The separated system carries five scalars and no metric, which is exactly why it
is fast. `shadeCrossing` wants `(m_t, mv)` — the covariant momentum — for the
gas blobs and for slice 10's polarization, so the crossing has to be handed back
into the Kerr–Schild picture. Three steps, and only the middle one is dangerous.

`minoToCartesian` returns d(pos)/dτ, and Mino time is dτ = dσ/Σ, so
`V^i = vel^i / Σ` with Σ = r² + a²u² is the affine tangent at the E = 1
normalization the potentials are written in. Lowering it needs `V^t`, and there
are two ways to get it.

The tempting one is the **linear** constraint m_t = g_(tμ) V^μ, which solves in
one line: P = (l·V − m_t)/(1 − f). It is wrong, and not subtly: f = 1 is exactly
the **ergosphere**, a surface these rays really do cross, and there the
expression divides by zero with no second root to fall back on.

The one used is the **null condition**, which is a quadratic in V^t:

```
(f - 1) T² + 2 f L T + (f L² + |V|²) = 0,    L = l·V
```

Two roots, one per time orientation; the one whose lowered time component shares
the sign of `m_t` is the ray's. Written in the stable pairing (q/A and C/q)
because A = f − 1 passes through zero at the same ergosphere — there the
quadratic degenerates to a linear equation with one finite root, which the
stable form returns and the schoolbook formula turns into 0/0. Then lower,
m_i = V^i + f (V^t + l·V) l_i, and rescale so the time component is exactly
`m_t`: every shift factor in the lab is homogeneous of degree −1 in the
momentum, so that scaling is what makes these crossings shade *identically* to
the march's rather than merely similarly.

That is what buys `shadeCrossing` verbatim — disk sheet, gas blobs and
polarization, one shading path rather than two.

The reconstruction is pinned at the one state both sides know. Rebuilding `mv`
at the handoff and comparing with the march's own there gives 1.4e-4 relative,
and that is the **march's** drift at 320 steps rather than this function's
error: the rebuilt momentum is null to 1e-13 and the march's is not. The test
asserts the disagreement from below as well as above — an exact match would mean
`minoStateAt`'s re-projection onto √R and √U had quietly stopped happening.

### The crossings, against a march that is actually converged

The oracle is `marchRefined` — the renderer's own RK4 at a fiftieth of its arc
length — run from the *same* re-projected state the continuation starts from, so
the two crossing lists are one-to-one with no prefix to align. Over 22 crossings
on the pinned band fixtures: **not one gained or lost**, worst radius 1.6e-4 of
itself, worst shift factor 1.6e-5, worst world position 2.4e-3. A brightness
going as the fourth power of the shift moves by 1e-4 of itself on that, four
orders under the turbulence the same crossing is multiplied by.

Against `traceRayKerr` at 400,000 steps the same comparison reads 2.1e-3 in
radius — thirteen times worse, and it is the *reference* that is wrong.
`marchRefined` exists because the renderer's own `stepLength` does not converge
on near-critical rays; a slice measured against the coarse march would have set
its tolerances by the oracle's error and called that its own.

Locating the crossing inside a step needs nothing clever: `u` is interpolated
linearly, which is what the march does to its own y, so the two agree by
construction rather than by coincidence. The |u| left over is 1.4e-6 to 2.7e-6,
and a quadratic fit through (u₀, pu₀, u₁) changes nothing at the precision the
radius is checked to. `u` is then **snapped to zero**, because that is what a
crossing is: it puts the reconstructed position exactly in the plane, so the
shader's own rc² = |pos.xz|² − a² returns the r the shift factor was evaluated
at instead of nearly.

### Two things decided deliberately rather than by default

**The refinement sub-step is charged against the budget**, on both sides. The
ladder's magenta means one thing — the continuation spent `MINO_MAX_STEPS` — and
slice 12 was already bitten by a cap 29 steps too small. At most three extra
steps against 1536 with 900 of headroom, so the parity is worth more than the
steps, and the CPU test asserts the extra is exactly one per crossing so the
GLSL budget stays predictable from the oracle's.

**The march is not touched.** The continuation runs outward along the same ray,
so its crossings sit behind everything already composited and front-to-back
accumulation simply continues — no sorting, no re-entry, and every frame outside
the band is unchanged. `rayCaptured` also keeps the last word on fate: this
slice adds light along a path whose ending was already decided, and does not get
a vote on it.

Matter along the continuation — orbiting stars, the jets, TDE debris — is *not*
integrated. Those are volumetric emitters sampled per march step rather than per
crossing, so carrying them would mean running the whole matter sampler in the
second loop. The disk is what the hurdle was about.

### What a frame can prove about it, and how

Bloom makes an absolute brightness meaningless at these pixels: the disk
elsewhere in the frame spills into them regardless of what they receive. So
`npm run band` measures a **difference** instead, across the disk toggle it
already flips for the hairline scan.

The claim is deliberately narrow. A band pixel whose 320-step march found no
equatorial crossing on the disk had, before this slice, no disk light at all. If
the continuation now finds it one, switching the disk on must light it; if the
continuation finds it none, it must not. Both groups sit a few pixels apart
along the same rows in the same bloom, so their difference separates where a
brightness would not: 0.11 of full luminance against 0.0000 at a = 0.9. The
second group is the point — without a negative control, "turning the disk on
brightens everything" would pass.

The band pixels are found from `rayCaptured`, which is closed form and free,
rather than from the drawn frame: the sky around the shadow is dark enough in
places to fool a luminance threshold, and the band is precisely where being
wrong about the shadow's edge would cost the samples the check is made of.

The negative control's presence is itself asserted. At a = 0.998 from the
default camera *every* band pixel the march leaves dark gains a crossing, so
there is no control group at that view and only the absolute gain is checked;
counting only the views that had enough lit pixels would let a run pass green
with the control never once evaluated. `npm run band` counts the two separately
and fails if the control never ran — the same reasoning as the tripwire's, that
a check which can silently miss is worse than no check.

### The polarization oracle had to learn the same thing

Adding these crossings to the shader's Stokes sum quietly broke the rule slice
10 set up: the physics lives twice and a tool checks the copy. `npm run pol`
compares the shader against `pixelPolarization`, which stopped where the march
stopped — so at band pixels the shader and its own oracle now modelled different
rays, and the tool could not have said so, because it filters on the crossing
COUNT and a band pixel gaining one is exactly where the counts stop matching.
A passing run would have proved nothing: at a = 0 there are no continuation
crossings on the disk to disagree about, and at a = 0.998 only 45 of 84 cells
are compared at all, one mark per grid cell sampled at its centre.

So `pixelPolarization` hands a budget-exhausted ray to the continuation too, and
counts the crossings it makes. The two sides still do not integrate the same
march — the oracle runs 4000 steps where the shader spends 320, deliberately, so
that agreement means the crossing radii have converged by the time the shader
stops — but they now finish the same way, which is the part that was a
transcription rather than a convergence claim.

## Slice 14 — γ around the ring

The ladder legend has quoted two numbers since slice 9: how fast the rungs thin
on the prograde edge of the ring and on the retrograde one. Those are the two
*equatorial* photon orbits. Everywhere else on the critical curve the light
hovers on a **spherical** photon orbit — one that swings in latitude while it
winds — with its own exponent, so the pair bounded the ring's spacing without
giving it anywhere. This slice computes it pointwise and prints it on the ring.

### The clock is forced, and it is not the literature's

The published exponent counts e-folds per half-*libration in latitude*: one more
crossing of the equatorial plane, one more subring. This lab's rungs are whole
half-turns of the **swept position angle**, which is what `kerr.ts`'s `winding`
accumulates and what the ladder view false-colours. In Kerr the two clocks are
genuinely different — near the a = 0.9 prograde orbit the light advances 2.6
half-turns of azimuth per half-libration — and for this picture the published one
is not merely different but useless:

> On any equatorial photon orbit, κ² = λ² − a² identically, where κ = √(R″(r̃)/2)
> is the growth rate per unit Mino time. The half-libration takes Mino time
> π/√(λ² − a²). So the libration exponent is **exactly π on both edges at every
> spin.**

That is the one number that erases the contrast the ladder exists to draw: 0.19
against 4.08 at a = 0.998. Porting the paper's γ(r̃) would have replaced a
legend that was merely incomplete with one that was uniformly wrong. The
identity is worth keeping written down — it also says the near-equatorial
vertical oscillation and the radial instability run at the same rate, which is
why Schwarzschild's π is π at all.

So γ here is κ times the Mino time of a half libration, divided by the position
angle swept over that same interval, scaled to one half-turn. On the equator it
reduces to the old `photonOrbitLyapunov` identically — machine precision at
every spin, which is the first test.

### The hurdle's own path had slice 12's bug in it

H2 said to parameterize the critical curve by the spherical orbit's radius r̃,
using the textbook λ(r̃), q(r̃). Both divide by a, and at a = 0 every critical
ray shares r̃ = 3, so the parameterization collapses exactly where the lab has a
real picture to draw. That is H9's degeneracy again, and H9's entry had to be
corrected for the same reason.

The fix is to run the map backwards. Every outline sample already *is* a
critical ray, bisected to ~1e-8 in screen coordinates, so its conserved (λ, q)
come straight from `rayConstants` and r̃ is the double root of the radial
potential for that pair — the largest real root of R′(r) = 0, a cubic with no
quadratic term, which is `kerr.ts`'s existing depressed solver. No 1/a, no case
at zero spin, and the outline and the exponent drawn along it now solve one
cubic between them rather than two.

### One substitution, one quadrature

Both integrals run over the latitude swing, and cos θ = √u₊ sin ψ cancels the
turning point identically:

    dλ_Mino/dψ = 1 / √(a² u₊ sin²ψ − a² u₋)

with a² u₊ = 2a²q/(S + B), −a² u₋ = (S + B)/2, B = q + λ² − a², S = √(B² + 4a²q).
Nothing divides by a. The swept angle rides the same parameter, so one loop
returns both — and because the integrand is even and π-periodic in ψ, the
midpoint rule is *spectrally* accurate rather than second order: six nodes land
within 1e-13 of the converged value at every spin and azimuth measured,
near-polar rays included. Sixteen is margin. No elliptic integral, no new
dependency.

One detail that is easy to get wrong: the swept angle is the arc the position
*direction* traces on the unit sphere, so it is taken on the Kerr–Schild
ellipsoid (polar angle atan2(√(r̃²+a²) sin θ, r̃ cos θ)) rather than from θ. That
is the same quantity `winding` measures, which is the whole point of choosing
this clock.

### What a camera can see is not what the spacetime has

The two equatorial exponents bound γ over the spacetime, but which part of that
range reaches a given observer is a fact about the observer. Measured, over the
drawn outline:

| spin | camera in the disk plane | 30° up | 60° up | on the axis |
|------|--------------------------|--------|--------|-------------|
| 0    | 3.142 – 3.142            | same   | same   | same        |
| 0.9  | 1.216 – 4.004            | 1.28 – 3.84 | 1.66 – 3.34 | 2.493 – 2.555 |
| 0.998| 0.194 – 4.080            | 0.20 – 3.90 | 0.82 – 3.32 | 2.242 – 2.328 |

Edge-on, the ring's extremes *are* the two equatorial orbits, so the drawn range
is exactly the pair the legend has always quoted. From the spin axis symmetry
forces every critical ray to carry λ = 0, so the whole ring reads one number and
it is neither edge's. That is why the legend's third line reads the samples
actually drawn rather than the closed form: quoting 0.19–4.08 over a pole-on
frame whose ring is uniform at 2.28 would be a true sentence about the
spacetime and a false one about the picture under it.

### What it is worth, measured

The pointwise exponent against `fitLyapunov`'s method generalized to any screen
azimuth — the slope of winding against ln(offset from the critical curve), on
rays the integrator really followed:

- a = 0, six azimuths: every fit +0.31% of π, the stepper's known one-sided bias.
- a = 0.9: +0.27% on the retrograde edge, +0.29% at 45°, +0.46% at the top and
  bottom of the ring, +0.69% at 135°, +0.57% on the prograde edge.
- a = 0.998: +0.27% to +0.57% over most of the ring, rising to +3.0% on the
  prograde edge and +6.8% beside it — where γ is 0.19 and a ray hovers for so
  much winding that the stepper's overstatement compounds. The bias is one-sided
  everywhere, which is what the test asserts; a fit coming in LOW would mean
  something new.

Cost: 0.051 ms for all 96 azimuths at a = 0.998, against 0.563 ms for the
outline it decorates. There was no reason to compute only the six that get
printed.

### The one approximation, and where it bites

Off the equator γ is an average over the whole libration, while the rungs are
drawn at whole half-turns wherever they happen to fall. On the equator the two
coincide and each rung really is e^(−γ) of the last; near a polar azimuth it is
the asymptotic ratio rather than the exact one. It is labelled in the code
rather than left for someone to discover.

Nothing in the shader changed. The ladder still colours by winding; this slice
is arithmetic and a HUD layer, which is why it has no GLSL half and no mirror
to keep in step.

### The numbers are pinned to the ring, so the prose moves

Six labels hang off the outline, pushed straight out of the shadow — in pixels,
not in screen coordinates, because a half of compare mode is nothing like the
frame's shape and a radial offset taken in the wrong space leans into the
shadow on one axis. Turning the ladder view on now draws the dashed outline
whether or not the shadow checkbox is up: the numbers need a curve to sit on.
What it deliberately does *not* bring is the two callouts the shadow checkbox
carries — turning on the ladder brings the curve and its exponents, and nothing
else moves.

Where they collide with 6g's callouts, the callouts give way. `drawCallouts`
already slides blocks down to clear each other, so the exponents' measured text
boxes are seeded into that layout as already-placed: a number is pinned to a
point on the ring and cannot move, a paragraph can. Measured on a frame with
every overlay up, "approaching side" now sits below γ 1.22 instead of across it.

At a = 0 the six labels all read 3.14, and in compare mode the a = 0 half shows
six of them against the slider half's spread. That is not redundancy, it is the
control: the ring that stays uniform is what makes the other one's sweep mean
something.

## Slice 15 — Chandrasekhar's table, sourced

### The hurdle was looking in the wrong place

H8 said Table XXIV "was not obtainable from any secondary source", and left a
`(1-mu)/(1+mu)` curve scaled to its two endpoints in `scatteringDegree`. The
table exists in the open. Chandrasekhar's 1960 book is a lending copy that no
API will serve, but the book reprints it: the numbers are Table 6 of
Chandrasekhar and Breen 1947, *On the radiative equilibrium of a stellar
atmosphere. XVI*, ApJ 105, 435, on p. 439, headed "the exact laws of darkening
in the two states of polarization for an electron-scattering atmosphere; degree
of polarization of the emergent radiation". ADS serves that paper's scan to
anyone. The lesson generalizes past this slice: when a monograph collects a
result, the journal paper it collects is often reachable when the monograph is
not.

### The table checks itself, which is why a scan is enough

Reading twenty-one five-decimal numbers off a 1947 scan is exactly the kind of
step that fails silently, and no amount of care makes a transcription
self-evident. This table does not ask for care on faith. It prints three
columns — I_l/F, I_r/F, and the degree — related by
delta = (I_r - I_l)/(I_r + I_l). Transcribing all three and testing the identity
turns a reading into a measurement: every one of the 21 rows closes to 2.4e-5,
which is precisely the rounding the five-decimal intensity columns carry, and
I_l + I_r reproduces the printed I/F to 1e-5 besides.

`test/polarization.test.ts` carries the two intensity columns separately from
the module's degree table and asserts that identity. That matters more than it
looks: the endpoint test standing before compared `scatteringDegree(0)` to
`SCATTERING_DEGREE_MAX`, which passes for whatever value the constant happens
to hold. It pinned nothing. The intensity columns are the only numbers in the
file that do not come from the module under test.

### Two curves deliberately not used

The 1946 paper immediately before this one (ApJ 103, 351) tabulates the same
quantity in its *third approximation*, and it is the easier one to reach first.
It reads 11.34% at grazing incidence against the exact 11.713%, and is 18% low
in the middle of the range — close enough to look right, wrong enough to
matter.

The modern literature rarely quotes the table either. It quotes a fit to it:
`0.1171 (1-mu)/(1+3.582mu)`, which Poutanen's review states as eq. 1.1 and
which several accretion-disk papers repeat. It is a good fit — 4.6e-3 worst,
a fifth of the error of the curve that was here — and it is still a fit. This
hurdle existed to remove a fitted curve, so replacing it with a better fitted
curve would have been the wrong shape of answer even though the numbers would
have improved.

### The fit that was here was worse than the entry said

H8 estimated "a couple of percentage points in the middle of the range". In
absolute terms that was right: worst 2.4e-2, at mu = 0.2. But this quantity is
a length multiplier, so the absolute error is not what the viewer sees. At
mu = 0.2 the fit read 0.078 where the truth is 0.054 — a tick half again too
long. Near mu = 0.9 it read nearly double. The mistake in the estimate was
quoting an absolute error for a quantity only ever used as a ratio.

### Linear between the points, and why that is enough

The table is on a uniform 0.05 grid, so the index is arithmetic rather than a
search, which is also what lets the shader mirror the lookup in four lines. The
interpolation error is bounded by the data itself: h^2/8 times the largest
second difference is 1.5e-3, and only across the first interval, where the curve
turns hardest; past mu = 0.1 it is under 5e-4. That is a sixteenth of the error
being removed, in a quantity that sets tick lengths only, so a monotone spline
would have bought a residual already far below the width of a drawn mark.

The GLSL copy is generated from the TypeScript table by `shaders.ts`, the way
the ladder's colours already are, rather than transcribed a second time. There
is one set of digits in the repo. The second hard-coded `0.117` on the tick
pass's own length line — the normalizer, which is a different appearance of
the same endpoint — is now interpolated from the same constant; it had been
sitting next to a `TICK_MAX_LENGTH` that already was.

### The harness was measuring the one thing that did not change

`npm run pol` compared tick DIRECTIONS. This slice changes only LENGTHS, and
the two are independent: a mark drawn from the wrong polarized fraction still
points exactly where the oracle says it should. So the tool that exists to stop
a GLSL transcription error would have passed a shader with a mistyped table
— and did, which the control below shows rather than argues.

The tick pass draws a half-length of `pitch * TICK_MAX_LENGTH` times the
clamped fraction, and a straight segment of half-length L has second moment
L^2/3 about its centre. So the ink's rms spread along its own axis should be a
straight line in the CPU's fraction, of slope
`pitch * TICK_MAX_LENGTH / sqrt(3)` = 6.31 px, plus a small intercept for the
mark's feathered ends that no oracle predicts. That slope is predicted by the
tick pass's geometry and measured off the pixels, which makes it a comparison
rather than a self-consistency check — and it is predicted from the shader
module's own exported constants, loaded through vite the way the oracle already
is, so the prediction cannot go stale if the tick pass is retuned. Measured: +2.3%, +2.4%, +3.4% at the
three spins, worst residual 0.7 px.

The control is what makes those numbers mean anything. Putting the removed fit
back into the shader ALONE, oracle still on the table, reads +13.2%, +22.9% and
+23.9% — while the angle check passes at all three spins. The tolerance is
6%: clear of one, well under the other.

### The angle residuals moved, and it is the readout, not the physics

Slice 10's numbers were mean 0.24° and worst 1.20°. They now read up to
0.35° and 2.35°, which looks like a regression and is not — the
direction code is untouched by this slice. The exact table draws mid-range ticks
shorter than the fit did, and a shorter mark has less ink to fit an axis
through. Measured over 455 compared ticks: marks of 1-2 px rms average
0.80° of angle error, 2-3 px average 0.37°, 3-4 px average 0.31°,
past 4 px average 0.25°. Every run's worst tick comes from the shortest bin.
The 4° tolerance is unchanged and still has margin.

This is worth writing down because the alternative reading — that the new
table made the transport worse — is available, wrong, and would send the next
person hunting a sign error that is not there.

## Slice 16 — the funnel's radius is a measured length

### The hurdle's own path was half wrong: there is nothing to mark

H3 asked for two things: plot the true proper circumference where the
embedding exists, and mark the segment of a fast-spinning throat that cannot be
embedded in Euclidean 3-space at all. The first half is right and is what
landed. The second half describes a surface this diagram does not draw.

A surface of revolution with cylindrical radius ρ(r) and height z(r) has
induced metric (ρ'² + z'²) dr², so it is an isometric picture of the equatorial
slice exactly when ρ'² + z'² = g_rr = r²/Δ. That has a real solution wherever
ρ'² ≤ r²/Δ. On the equator ρ² = g_φφ = r² + a² + 2a²/r, so

    ρ' = (r − a²/r²)/ρ,   and   ρ'² < 1  ⟺  a²(1 + 4/r − a²/r⁴) > 0,

which holds for every r ≥ 1 — while r₊ = 1 + √(1−a²) ≥ 1 at every spin, and
r²/Δ ≥ 1 outside the horizon because Δ ≤ r² there. The radicand is therefore
positive over the whole drawn range at every spin the slider can reach, and at
every spin it cannot. There is no segment to mark. Scanned at 200,000 radii per
spin out to r = 40 before any of this was written, and the closed-form argument
came after: neither found a failure.

What the register was remembering is Smarr's result, and it is about a
*different* surface — the horizon 2-sphere (r = r₊, θ, φ), whose Gaussian
curvature turns negative near the poles for a > √3/2 ≈ 0.866, so that surface
has no isometric embedding in Euclidean 3-space. That is a genuinely famous
fact about fast Kerr holes, and it is not a fact about the equatorial slice.
Both `embeddingProfile`'s comment and the hurdle register now say which surface
the sentence belongs to, because a caveat that quietly vanishes reads as an
oversight rather than as a finding.

### ρ(r₊) = 2, at every spin — which is the visible payoff

The reason this was worth doing is one identity. Δ(r₊) = 0 forces
r₊² + a² = 2r₊, so

    ρ(r₊)² = r₊² + a² + 2a²/r₊ = 2(r₊² + a²)/r₊ = 4r₊/r₊ = 4

identically. The horizon's equatorial circumference is 4πM whatever the hole is
doing. Meanwhile r₊ itself falls from 2 to 1.06 across the spin slider, so the
old diagram drew the mouth at 72% of its true size at a = 0.9 and 53% at
a = 0.998, and told the viewer the throat narrows as the hole spins up. It does
not. What actually happens is that the funnel gets *deeper* — total height over
r₊ ≤ r ≤ 20 goes 12.51 → 12.91 at a = 0.9 and 14.29 → 14.84 at a = 0.998, a
3–4% correction on top of the depth the old profile already had — while the
mouth stays exactly where it is. The tapering mouth was an artifact of plotting
a coordinate label as if it were a length, in the one overlay whose whole claim
is "drawn 1:1".

At a = 0 nothing moves at all, and that is asserted rather than assumed:
ρ(r) = r there identically, `circumferentialRadius(r, 0) === r` exactly (not to
within a tolerance), and the profile still reproduces Flamm's paraboloid
z = √(8(r−2)) to 1.4e-14 over all 800 samples.

### The exact singularity split survives, with one cancellation removed by hand

dz/dr still diverges like (r − r₊)^(−1/2) at the rim, and the quadrature still
splits that factor off in closed form and samples the smooth remainder at the
midpoint. Only the smooth part changed:

    dz/dr = g(r)/√(r − r₊),   g(r) = √( N(r) / (ρ² (r − r₋)) ),
    N(r)  = r²ρ² − Δ (r − a²/r²)².

Written like that, N is a difference of two quantities that agree in their
first two terms (r⁴ and a²r²), so evaluating it directly throws away about a
factor r/2 of precision near the outer edge for nothing, and it stops being
identically 2r³ at a = 0. Expanded by hand,

    N(r) = 2r³ + 4a²r − 4a² + a⁴(2/r − 1/r² + 2/r³) − a⁶/r⁴,

which needs no cancellation at all, and at a = 0 collapses to 2r³ against
ρ² = r², leaving g = √2 exactly — the same constant the old integrand had, so
the a = 0 profile is not merely close to what it was but produced by the same
arithmetic. The expanded form was checked against the direct one over
2,000 radii at eight spins: 7.1e-15 worst relative difference, which is the
cancellation it removes.

g is also finite at the rim rather than merely integrable there:
N(r₊) = r₊²ρ(r₊)² = 4r₊² since Δ(r₊) = 0, so g(r₊) = r₊/√(r₊ − r₋) — the same
value the old integrand had, because the ρ' term is multiplied by Δ.

### The check that cannot pass by agreeing with itself

The obvious test — recompute the integrand and compare — proves only that the
module can evaluate its own formula twice. The one that bites differentiates
the drawn surface instead: central-difference the produced (ρ, z) and ask
whether its own arc length reproduces the slice's radial metric,
ρ'² + z'² = r²/Δ. Nothing in that touches the expression the profile was built
from.

Worst relative residual over 20,000 samples, away from the rim: 6.5e-7 at
a = 0 rising to 1.1e-6 at a = 0.998 — which is the central difference's own
truncation at that spacing, not the surface. The rim is excluded and the reason
is not a fudge: z goes like √(r − r₊) there, so a central difference across a
vertical tangent measures the differencing.

The test carries its own control, in the same loop: pair the same heights with
radius r — which is exactly what the diagram used to do — and the residual goes
to 2.4e-2 at a = 0.5, 9.2e-2 at a = 0.9, 1.2e-1 at a = 0.998. Five orders of
magnitude, at every spin but zero, where it is identically zero because there
is nothing to correct. Without that control the isometry assertion would pass
on a threshold loose enough to be meaningless and nobody would know.

### Everything is still indexed by r; only the drawing moved

`embeddingRhoAt` is a closed form, not a table — there is nothing to integrate
— and it clamps to the profile's own range so that radius and height stop
together at both ends rather than the wireframe running outward at a radius
whose height no longer follows it. The `EmbeddingProfile` carries the spin it
was built for so that the drawing side needs no second source for `a`.

In `hud.ts` the two projection helpers take a Boyer–Lindquist r and convert,
rather than being handed ρ. Every caller has a physical radius in hand — the
ISCO, the rim, where a star is right now — and none of them has any use for the
drawn one. That keeps the disk/plunge shading, the dot placement and the ring
labels reading in r, and confines the change to the two lines that turn a
radius into a pixel. Both of them: ρ appears in the horizontal projection *and*
in the tilt term of the vertical one, since that term is the same cylindrical
radius seen at an angle, and correcting only the first would have tilted the
surface into a shape that is not a surface of revolution at all.

## The visual harness — measuring instead of remembering

`tools/visual/` exists because every visual check before it was rebuilt from
scratch. Playwright had been a devDependency for a while with nothing using it,
so each session that wanted to see the thing rediscovered the same handful of
traps — and rediscovered them by hitting them.

### Why it does not diff against stored images

The obvious harness stores reference PNGs and compares. It would fail
constantly and teach us to ignore it. WebGL output is not bit-exact across
drivers, and the scene animates on its own: stars orbit, gas spirals, the trail
buffer rolls. Two runs are never the same frame, so a pixel-golden diff reports
the clock as often as a regression.

Every check here instead compares pixels against other pixels *from the same
run*, which is exactly what the overlay claims need anyway. `stripDiff` leans on
compare mode's premise — the halves share one camera and are exactly equal in
width, so their projections are identical and the only thing that can differ is
the spin; a non-zero distance is proof a per-side overlay is two renders and not
one buffer drawn twice. `drift` leans on orbits — a closed one retraces its
pixels forever, a precessing one keeps finding new ones. Neither needs a
reference image, so neither can rot into one.

The residual in `drift` is never zero and the floor is not portable: a = 0
measures 0.41 headless here against a ~0.2 noted on a real GPU, while a walking
node sits near 0.94 in both. Read the gap, sampled in the same run — a number
copied out of a previous one is measuring a different machine.

### Both canvases, frozen in the same frame

The renderer's `__wantShot` hook takes the HUD alongside the scene, and that
pairing is the point. The HUD is cleared and redrawn every frame, so a reader
that grabbed it from outside afterwards would pair overlays against a scene from
an earlier frame — and then every measurement across the two would be reading
the time between them rather than the thing it named. The first draft did
exactly that: `stripDiff` read its two halves from different frames and returned
0.883 where one frame gives 0.931, the difference being the scene moving.

The hook also publishes the layout it drew with, rather than the harness
re-deriving it. `COMPARE_X0` is measured from the panel's rect at runtime and
the CSS-to-target quality scale is local to `main.ts`; anything computing those
from a distance is copying two numbers that move. The harness pins quality to
`high` for the same reason in reverse — there the scene target and the HUD are
the same size, so every measurement lives in one coordinate space instead of
reconciling two.

### What it deliberately does not do

It does not start or stop the dev server: killing a process tree on Windows is
fiddly enough that it would be the first thing to break, and a clear error
beats a flaky teardown. It does not assert across the control surface — those
assertions would rot with the UI and pay for nothing. It never uses playwright's
`channel: "chrome"` or a real `userDataDir`, so `close()` can never reach a
browser a person is actually using.

It does find its own server, and that is not the same as taking a port on
faith. Vite takes the next free port when its default is busy, so whichever
project starts first owns 5173 and every later one climbs; on a machine running
three vite projects this lab has no fixed port at all, and a hardcoded 5173 is
a coin flip about whose app gets measured. So the harness scans 5173–5188 for
the one whose title is this lab's, and any match will do — vite transforms from
disk per request, so even a server left up for days serves current code.

Measuring the wrong app is a silent, expensive failure. Before the check the
first symptom was `getComputedStyle: parameter 1 is not of type 'Element'`
thrown out of the first-paint wait, which reads as a bug in the harness rather
than as pointing at someone else's page. The title check survives as the guard
on an explicit `LAB_URL`, which is the only way left to aim at the wrong thing.
Both were found on a machine with two other labs up, holding 5173 while this
one had climbed to 5174 — which is the ordinary case here, not a strange one.

Its own pixel math runs in the page rather than in node, which is what keeps
`pngjs`/`pixelmatch` off the dependency list: shipping ImageData to node would
mean decoding PNGs there, and that is a dependency bought for twenty lines of
loop.

One trap it used to have to respect: 6f's outline was debounced 250 ms and
then traced across frames at ~3 ms each — a full one was ~540 ms of tracing at
a = 0.998, so about three seconds at 60 fps, and `settle()` defaulted above
that. Since slice 9 the outline is exact and immediate, so `settle()` is only
about the things that still take time: trails filling in, and the frame after a
control change. Shoot too early and you get the frame before the change, which
looks exactly like a broken control and is the most convincing wrong answer in
here. It counts those in frames rather than milliseconds now — see below for
why that is a different thing to wait for and not merely a more patient one.

It also cannot run where playwright's pinned chromium is not. Playwright
refuses any build but the one its release wants, which a sandbox or a CI image
may not carry; `LAB_CHROMIUM` points it at a preinstalled one instead. That
build is still headless and still not anyone's profile, so the rule above
holds.

### The waits were counted in milliseconds, on a machine with a GPU

H7 recorded this as "the smoke test's fixed waits are tuned for a GPU" and
proposed a frame-count wait. That is the right direction and it is not the
whole of it.

The clock is the wrong unit here for a reason that is not about patience. A
`Trail` records at most one sample per frame, and the simulation advances by
min(real dt, 0.1)·timeSpeed per frame — both capped *per frame*, neither per
second. So a four-second wait buys 240 trail samples at the 16.7 ms of a GPU
frame and 25 at the 157.8 ms measured here under a software rasterizer, and the
same request is asking for two different measurements. Waiting four seconds is
not a slower way of waiting 240 frames; it is a different thing to wait for.

So every wait that meant "let the renderer catch up" is now counted in frames
drawn, off a monotonic counter `main.ts` publishes beside its existing
screenshot hook. Deliberately not the `frames` counter that was already there:
that one is zeroed twice a second to compute the fps readout, so a harness
watching it would see it run backwards.

One wait stays in milliseconds, and it is the one that proves the rule.
`npm run band`'s frame-rate reading averages over that same 500 ms readout
window, so waiting for frames there would measure whatever the window happened
to contain. Four seconds of real time is what makes that readout worth reading,
on any machine.

### A frame count with a GPU-tuned timeout is the same bug one level up

Counting frames is not enough on its own, because every wait also carries a
timeout, and a timeout is a millisecond number. `capture()` had 15 s and the
first-paint wait had 60 s — both fine at 17 ms a frame, both a certain failure
at a hundred times that. Fixing the units and leaving those in place moves the
bug rather than closing it, and the measured first attempt at this hit exactly
that: the software run got past first paint and died in `capture()` at 15 s.

The next attempt was to calibrate — time four frames at boot, then allow some
multiple of n times that for an n-frame wait. It fails too, and it fails in a
way worth recording. Measured under SwiftShader: a boot period of 132 ms, and
then a 64-frame wait blowing an eight-times budget, because by then compare
mode was on and every frame was drawing the scene twice. A boot calibration
describes the scene at boot, and a harness's whole job is to change the scene.

What replaced it asks for progress rather than predicting a total. `waitFrames`
loops on "has the counter moved", and only that single step carries a timeout.
n frames may then cost anything at all and the wait still returns, while a
renderer that has genuinely stopped still fails inside one frame's ceiling.
That ceiling — three minutes — is the one untuned number left, and it does not
want tuning: it is not a budget, it is a floor under "nothing is happening".

### A capture is one frame's progress, and an expensive one

`capture()` looks like the exception, because it sets a flag and then waits for
two data URLs to appear, which is not obviously a frame. It is one, exactly:
`main.ts` increments the counter immediately above the shot hook and inside the
same synchronous render call, and both of `render`'s early returns sit above
the increment — so a frame that counts is a frame that reached the hook. A
predicate polled from outside the page can only run *between* render calls.
Seeing the counter move after the flag is set is therefore proof the encode
already finished, and the capture waits on the same counter as everything else.

What it does need is its own ceiling, because that frame is not an ordinary
one. Measured in a single run on this GPU: 15.3 ms per frame against
51 ms per capture. In a single run under SwiftShader on the same
machine: 157.8 ms against 74,245 ms. The frame got ten
times slower and the capture about a thousand times slower, so no factor connects
them — a capture is a WebGL readback and a PNG encode of two 1280x800 canvases,
CPU work that does not care how fast the shader ran. So the boot measurement
*raises* the frame ceiling where the machine says a capture is expensive, and
never lowers it. It is a ceiling, not a predicted budget for work of unknown
length, which is the thing this whole section exists to stop doing.

### Testing the no-GPU claim on a machine that has one

H7 was closed once already as "worked around", on an argument rather than a
run, and the fixed waits it left behind are what this entry is about. So the
switch that makes the claim testable landed with the fix: `LAB_SOFTWARE_GL=1`
swaps ANGLE's `--use-angle=gl` for `--use-angle=swiftshader` and puts the same
frames through a software rasterizer on a machine with a 5090 in it. All three
harnesses print the renderer string and both measured periods on their first
line, so a run claiming to have tested the software path has to show it did —
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader
driver)` against `ANGLE (NVIDIA ... RTX 5090 ...)`.

Measured, and the wall clock is half the claim: `npm run shot` and `npm run pol`
both pass under SwiftShader, in 1510 s and 1421 s against 3 s and 4 s on the
GPU, with every check reading what it reads with a GPU under it — `pol`'s worst
tick angle is 2.29°, 2.37°, 0.86° at the three spins against 2.30°, 2.38°,
0.86°. The physics measurement did not change; only the clock did, which is
the whole point.

`npm run band` was NOT run that way, and this says so rather than claiming all
three. Every wait in it is a `settle()` or the deliberate millisecond one, both
exercised by the two runs above, and it opens the lab with the ladder already
on, so its own boot measurement sits on the expensive path from the start. What
a software run of it would measure is runtime, not wait logic — two of the three
are portable by measurement, and the third by argument.

One thing the change buys that a merely longer wait would not: under SwiftShader
`settle(TRAIL_FRAMES)` produced MORE trail than on the GPU, not less — 16785 and
29189 lit HUD pixels per compare half against 8975 and 10610. Simulation time
advances min(real dt, 0.1) per frame, so a slow frame banks the whole cap.
Sixty-four frames is sixty-four trail samples on any machine; sixty-four frames'
worth of simulated time is not, and the check wanted the samples.

### The launcher reuses rather than stacks

`Start Black Hole Lab.bat` ran `npm run dev -- --open` unconditionally, and
that is how a machine ends up with sixteen dev servers. Vite does not fail on a
busy port, it climbs to the next free one — so every double-click quietly
started another server and opened another tab, and nothing ever stopped the old
ones. Each survivor holds a full geodesic raymarcher live in any tab still
pointed at it, which is not a cost worth paying for a launcher that was asked to
do nothing at all.

So it looks first, and it asks the right question. "Is something on 5173" is the
wrong one — the port is not proof of identity, and on this machine 5173 is
usually a different project entirely. `tools/find-server.mjs` asks each port
what it is *serving* and matches only this lab, which is the same question the
visual harness has to answer, so they share the module rather than each keeping
their own idea of which server is ours.

Reusing an old server is safe rather than a bet on its age: vite transforms from
disk on every request, so a server left up for days serves the code as it is
now. The launcher says so, and says how to start fresh anyway — that is a real
need when `vite.config` changes, which a running server would not pick up.

The detection is dependency-free for a reason: the launcher's whole point is to
work on a machine where nothing has been set up yet, and it runs before the
`node_modules` check. It also cannot use `AbortSignal.timeout` for the per-port
deadline. Sixteen of those left armed keep the loop alive past the answer, and
exiting out from under them trips a libuv assertion on Windows
(`UV_HANDLE_CLOSING`) rather than exiting — so the timers are owned and cleared,
and the CLI sets `exitCode` instead of calling `exit`.

## The frame limit defaults to 60, not to uncapped

The redraw cap shipped at the top of its own slider, which `FPS_UNLIMITED`
spells as "don't limit" — rAF is vsync-capped anyway, so any limit at or above
the panel's refresh does nothing, and on a 60 Hz display that was already the
whole story.

It is not the whole story on a faster one. Uncapped means "as fast as the panel
asks", so a 144 Hz display buys two or three geodesic marches per 60 Hz worth of
animation. Nothing in the scene reads better for them — the disk and the stars
are not moving that fast — and this is a per-pixel raymarcher, so each of those
frames costs the whole GPU rather than a slice of it. The physics is indifferent
either way: simulation time is measured off the real clock, so the hole evolves
at the same rate at any limit, and the slider is a `display` knob for exactly
that reason.

So 60 gives back what a fast display was silently spending, and changes nothing
for anyone on 60 Hz. Raise it for a high-refresh pan, which is the one place the
extra frames are the point.

The value lives in `index.html` and is mirrored in `main.ts`'s `params`, which
looks redundant and is not: `bindNumField` seeds `params` from the control's
value at startup, so the markup wins and the TS initializer is a transient. The
`quality` field above it carries the same "must match index.html" note for the
same reason.
