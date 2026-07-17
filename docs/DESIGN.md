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

One trap it cannot remove, only respect: 6f's outline is debounced 250 ms and
then traced across frames at ~3 ms each — a full one is ~540 ms of tracing at
a = 0.998, so about three seconds at 60 fps. `settle()` defaults above that.
Shoot early and you get a half-traced outline, which looks exactly like a broken
overlay and is the most convincing wrong answer in here.
