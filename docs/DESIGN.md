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
recomputes every one on the CPU. 149 ticks, mean 0.24 degrees, worst 1.20.
Reading the drawn ink rather than the buffer behind it also covers the
projection and the tick pass, which is the point — what is compared is what
the viewer sees.

Two conventions it had to get right, both of which produce plausible-looking
nonsense when wrong. The tick grid is anchored where GL's origin is, at the
*bottom*; counting rows from the top instead puts every cell boundary half a
mark out whenever the frame height is not a multiple of the pitch, and each
measured cell then straddles two ticks and reports their average. And only
single-crossing pixels are compared, since reproducing the shader's brightness
weighting on the CPU would mean reproducing the disk's turbulence too — a
second transcription to get wrong, for no extra coverage.

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
here.

It also cannot run where playwright's pinned chromium is not. Playwright
refuses any build but the one its release wants, which a sandbox or a CI image
may not carry; `LAB_CHROMIUM` points it at a preinstalled one instead. That
build is still headless and still not anyone's profile, so the rule above
holds. Under software GL a frame is tens of seconds rather than tens of
milliseconds, and the smoke test's fixed waits are tuned for a GPU.

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
