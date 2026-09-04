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

10. **Polarization** — the disk's light carries a direction of vibration,
    and Kerr turns it ✅
    - 10a the Walker–Penrose constant, which a polarization dragged along a
      null geodesic keeps. So the whole trip from the disk to the camera
      costs two closed forms and nothing per march step — transporting the
      vector instead would have roughly doubled the hot loop. Written in
      Cartesian Kerr–Schild rather than Boyer–Lindquist: the `1/Delta` that
      blows up on the horizon cancels identically, and the piece that is
      singular on the spin axis expands to a polynomial. The camera is at
      finite r, so the textbook screen formulas do not apply; its own two sky
      legs are used as a basis instead, which is exact at any radius. Pinned
      against a parallel transport built from central-differenced metric
      derivatives — deliberately not the analytic ones the integrator uses,
      so a shared sign error cannot cancel itself ✅
    - 10b the emitter: electron scattering in the disk's surface, which
      polarizes parallel to that surface. The direction is exact geometry (a
      4-cross product, and a director, so no handedness is left to get
      wrong); only the polarized fraction is fitted — see H8. Each disk
      crossing is resolved and added as Stokes parameters weighted by its own
      brightness, so two images overlapping with their planes turned
      differently genuinely depolarize ✅
    - 10c the ticks: a second attachment on the scene target carrying the
      screen-basis Stokes pair (not an angle — the target is filtered, and
      only a linear quantity survives that), and a composite pass drawing one
      mark per grid cell, sampled at its own centre. Length is the polarized
      fraction; marks fade with the disk's own light. `npm run pol` measures
      the marks actually drawn and recomputes each on the CPU: mean 0.24°,
      worst 1.20° ✅

11. **Closing the band** — a ray still winding when the march's budget ends
    no longer takes the sky at whatever direction it happened to be pointing ✅
    - 11a `src/mino.ts`: the continuation, in the separated system where the
      radial and polar motions are independent 1-D polynomial problems. The
      deepest band ray needs 291,419 steps of a converged march and finishes
      here in 786. The constants come from the LAUNCH, not from the drifted
      exhausted state — worth 0.68° against 0.00024° on that ray, and the
      difference plateaus rather than shrinking, which is what a convergence
      test catches and an absolute threshold does not ✅
    - 11b the GLSL mirror, wired into the one place the renderer still guessed.
      The magenta rung stops meaning "budget spent" and becomes a tripwire for
      the continuation spending its OWN budget ✅
    - 11c `npm run band` — landed with slice 12, which needed the same
      instrument ✅

12. **The pole the continuation could not cross** — hurdle H9, closed ✅
    - 12a `axisPassage`: the whole polar passage near the spin axis in closed
      form, so the half-turn of azimuth that no step size can find is not
      integrated at all. The substitution v = v_min + √D·w² cancels the turning
      point identically and leaves no 1/a anywhere, so it holds at zero spin
      too — where the band and its pole crossings are real (384 band pixels at
      a = 0 from the default camera). 43 near-axis band rays at 60 cameras go
      from a worst 156.197° to 1.27e-4°, and 1255 rays away from the axis do
      not move (worst 4.0e-6°, no step count changing). Two guards the
      measurement insisted on: a ray may LEAVE before its swing finishes (14°
      if jumped anyway) and a step may leap the trigger window (155°) ✅
    - 12b the GLSL mirror, and the near-axis legend row removed — there is no
      longer a class of ray the chart cannot follow ✅
    - 12c `npm run band`: the tripwire reads zero at five views, and 36
      whole-turn crossings match the CPU's own winding to 0.027 half-turns,
      which is the float32 answer the unit tests cannot reach ✅

13. **The light the continuation was already carrying** — hurdle H1's second
    half, closed ✅
    - 13a a ray still winding when the march's budget ends goes on crossing the
      equatorial plane, and those crossings are passes through the disk that
      nothing shaded. `continueToEscape` collects them, given the march's own
      m_t — the one thing the separated system cannot recover, since lambda and
      q are quotients and the normalization drops out. Rebuilding the covariant
      momentum from five scalars and no metric is the one place a sign or a
      scale could go wrong: V^t comes from the null condition, NOT from the
      linear constraint m_t = g_(t mu) V^mu, which divides by 1 - f and f = 1 is
      the ergosphere these rays cross. Pinned at the handoff against the march's
      own mv (1.4e-4, the march's drift) and, over 22 crossings of a 50x-refined
      march, not one gained or lost: radius 1.6e-4 of itself, shift 1.6e-5 ✅
    - 13b the GLSL mirror, calling the same `shadeCrossing` — so the gas blobs
      and slice 10's polarization come with it rather than needing a second
      shading path. The refinement sub-step is charged against the budget on
      both sides, deliberately: the ladder's magenta means one thing ✅
    - 13c `npm run band`: band pixels the march leaves with no disk light of
      their own, split by whether the continuation finds them any, differenced
      across the disk toggle. Bloom makes an absolute brightness meaningless
      here; the two groups sit a few pixels apart in the same bloom and separate
      by two orders — 0.10 of full luminance against 0.0000 at a = 0.9 ✅

14. **γ around the ring** — hurdle H2, closed ✅
    - `criticalLyapunov`: the ladder's spacing at ONE point of the critical
      curve, from that ray's own lambda and q. Off the equator the light hovers
      on a spherical photon orbit that swings in latitude, and each such orbit
      sheds light at its own rate. Deviation grows at sqrt(R''/2) per unit Mino
      time exactly as on the equator; what is not the same is the clock, and
      the choice is forced. The literature counts e-folds per half-libration in
      latitude, but on ANY equatorial photon orbit kappa^2 = lambda^2 - a^2
      identically, so that exponent is exactly pi on both edges at EVERY spin —
      the one number that erases the 0.19-against-4.08 contrast the ladder view
      exists to show. The rungs are whole half-turns of the swept position
      angle, so that is the clock: q = 0 reduces to `photonOrbitLyapunov` to
      machine precision at every spin, and it is pinned off the equator against
      traced rays at six screen azimuths (+0.3% to +0.7%, the stepper's known
      one-sided bias) ✅
    - the entry's own path could not have worked: it parameterized the curve by
      the orbit radius through the textbook lambda(r~), q(r~), which divide by
      a — and at a = 0 every critical ray shares r~ = 3. Running the map
      backwards instead, from the (lambda, q) each outline sample already
      carries to r~ as the double root of the radial potential, needs no case
      at zero spin and shares `kerr.ts`'s cubic solver. The latitude integrals
      take one substitution and one 16-node midpoint rule, spectrally accurate
      because the integrand is even and pi-periodic: 6 nodes already land
      within 1e-13, so there is no elliptic integral and no new dependency ✅
    - drawn: six numbers on the dashed outline, which the ladder view now
      brings up whether or not the shadow checkbox is — and 6g's callouts slide
      down around them, since a number pinned to a point on the ring cannot
      move and a paragraph can. The legend's third line quotes the range the
      SAMPLES cover rather than the closed form's, because what a camera can
      see is its own business: edge-on the ring's extremes are the two
      equatorial orbits, from the spin axis symmetry forces lambda = 0 and the
      whole ring reads one number that is neither edge's (2.49-2.56 at a = 0.9).
      `npm run band` measures the ink at each label against control boxes at
      azimuths with no text on them: 234-272 px against 0 at five views ✅

15. **Chandrasekhar's table, sourced** — hurdle H8, closed ✅
    - the polarized fraction a scattering surface sends out at angle mu to its
      normal was the last fitted number in slice 10. The entry said to source
      Table XXIV and interpolate; the table is Chandrasekhar and Breen 1947
      (ApJ 105, 435), Table 6 on p. 439, which the 1960 book reprints, and the
      free ADS scan carries it. `scatteringDegree` is now those 21 numbers with
      a linear interpolation, and `SCATTERING_DEGREE_MAX` is the table's own
      0.11713 rather than the rounded 11.7% the literature quotes
    - the digits can be trusted off a scan because the table checks itself: it
      prints I_l/F and I_r/F beside the degree column, and all 21 rows reproduce
      (I_r - I_l)/(I_r + I_l) to 2.4e-5, the rounding those five-decimal columns
      carry. The test transcribes the intensity columns separately and asserts
      the identity, so the only pin on these numbers does not come from the
      module under test. Two things NOT used: the third approximation tabulated
      in the 1946 paper that precedes it (11.34% grazing against the exact
      11.713%, and 18% low mid-range), and the closed-form
      0.1171(1-mu)/(1+3.582mu) that the modern literature fits to the same
      table — a fit is what this hurdle existed to remove
    - the curve that was there was worse than the entry claimed. Its absolute
      error was indeed a couple of percentage points (worst 2.4e-2 at mu = 0.2),
      but that is half again too long a tick there and nearly double one near
      mu = 0.9. The interpolation left in its place is bounded by the table's own
      second differences at 1.5e-3, and only across the first interval
    - `npm run pol` could not have caught any of this: it measured tick
      DIRECTIONS, which this slice does not touch, and a tick drawn from the
      wrong fraction still points exactly where the oracle says. It now also
      fits the drawn ink's spread against the CPU's fraction — slope 6.31 px
      by the tick pass's own geometry, measured +2.3 to +3.4% at three spins.
      Control: the removed fit put back in the shader alone reads +13.2, +22.9,
      +23.9% while the angle check passes throughout ✅

16. **The funnel's radius is a measured length** — hurdle H3, closed ✅
    - the embedding diagram plotted the Boyer–Lindquist r as each ring's
      radius, which is a coordinate label. It is now drawn at
      `circumferentialRadius` — the ring's own proper circumference over 2π,
      √(r² + a² + 2a²/r) — and the height integral matches arc length against
      THAT, dz/dr = √(r²/Δ − ρ'²), so the surface is an exact isometric
      picture at every spin rather than only at a = 0
    - the payoff is one identity: Δ(r₊) = 0 forces r₊² + a² = 2r₊, so
      ρ(r₊)² = 2(r₊² + a²)/r₊ = 4 at EVERY spin. The horizon's equatorial
      circumference is 4πM whatever the hole is doing, while r₊ itself falls
      from 2 to 1.06 across the slider — so the old picture drew the mouth at
      72% of its size at a = 0.9 and 53% at a = 0.998, and showed a throat
      narrowing with spin that does not narrow. What does change is depth:
      12.51 → 12.91 at a = 0.9, 14.29 → 14.84 at a = 0.998. At a = 0 nothing
      moves, asserted rather than assumed — ρ(r) === r exactly, and Flamm's
      paraboloid still to 1.4e-14 over all 800 samples
    - **the entry's second half described a surface this diagram does not
      draw, and the correction is worth keeping.** It said to mark the part of
      a fast throat that cannot be embedded in Euclidean 3-space. There is no
      such part: ρ'² < 1 reduces to a²(1 + 4/r − a²/r⁴) > 0, true for every
      r ≥ 1, and r₊ ≥ 1 always, while r²/Δ ≥ 1 outside the horizon. The
      famous non-embeddability is Smarr's, about the horizon 2-sphere
      (r = r₊, θ, φ) for a > √3/2 — a different surface
    - checked by a route that cannot pass by agreeing with itself:
      central-difference the produced (ρ, z) and assert ρ'² + z'² = r²/Δ, which
      evaluates none of the arithmetic the profile was built from. 6.5e-7 at
      a = 0 to 1.1e-6 at a = 0.998, which is the differencing's own truncation.
      Its control runs in the same loop — the same heights drawn at radius r,
      which is what the diagram used to do, breaks the identity by 2.4e-2 to
      1.2e-1 ✅

17. **The harness runs where there is no GPU** — hurdle H7, closed ✅
    - tooling, not physics. Every wait that meant "let the renderer catch up"
      is counted in FRAMES DRAWN, off a monotonic counter `main.ts` publishes
      beside its screenshot hook (deliberately not the `frames` it already had,
      which is zeroed twice a second for the fps readout). The clock was the
      wrong unit for a reason that is not about patience: a trail records at
      most one sample per frame and the simulation advances min(real dt, 0.1)
      per frame, both capped PER FRAME, so four seconds bought 240 samples at
      the 16.7 ms of a GPU frame and 25 at the 157.8 ms measured under
      SwiftShader here — the same request asking for two different
      measurements
    - **a frame count with a GPU-tuned timeout is the same bug one level up**,
      and calibrating the timeout does not fix it either. Both were tried and
      both were measured failing: with the units fixed and the timeouts left
      alone the software run died in `capture()` at 15 s, and with four frames
      timed at boot and eight times that allowed per frame it died in a
      64-frame wait — 132 ms at boot, but by then compare mode was on and every
      frame drew the scene twice. The waits ask for PROGRESS now — has the
      counter moved — with only the single next frame under a ceiling, so n
      frames may cost anything and a stopped renderer still fails inside one
      frame's worth of time
    - a capture is one frame's progress too, exactly: the counter is
      incremented immediately above the shot hook in the same synchronous
      render call, and a predicate polled from outside can only run between
      render calls. It is an EXPENSIVE frame, so it gets its own ceiling from a
      boot measurement — and that measurement is the number worth keeping:
      15.3 ms per frame against 51 ms per capture on this GPU, 157.8 ms against
      74,245 ms under SwiftShader. Nothing connects them; a capture is a WebGL
      readback and a PNG encode, CPU work that does not care how fast the
      shader ran
    - and the claim is tested rather than argued: `LAB_SOFTWARE_GL=1` swaps
      ANGLE's `--use-angle=gl` for `--use-angle=swiftshader`, so the no-GPU
      path runs on a machine that has one. All three harnesses print the
      renderer string and both measured periods on their first line, so a run
      claiming to have tested it has to show it did
    - measured with the final code: `npm run shot` and `npm run pol` both pass
      under SwiftShader, in 1510 s and 1421 s of wall clock against 3 s and 4 s
      on the GPU, and every check reads what it reads with a GPU under it —
      `pol`'s worst tick angles are 2.29/2.37/0.86 degrees against
      2.30/2.38/0.86. The physics measurement did not move; only the clock did.
      `npm run band` was NOT run that way, and this says so rather than claiming
      all three: its waits are all `settle()` plus the deliberate millisecond
      one, both exercised by the other two, and it boots with the ladder
      already on, so a software run of it would measure runtime rather than
      wait logic ✅

## Open hurdles

Each entry: what is approximate, how big the error is, and the concrete path
to closing it. Ordered by how much of the picture they touch.

### H1 — the ring's inner rungs were under-lit

**Status: closed — the first half by slices 11 and 12, the second by slice 13.**
A budget-exhausted ray no longer takes the sky at whatever direction it happened
to be pointing (11, 12), and it no longer loses the disk light it collects on
the way out (13).

**This entry used to predict the wrong fix, and the correction is worth keeping.**
It said the remaining crossings had to be summed analytically, from the
near-critical expansion, because they keep coming as the ray winds and the step
count diverges. The series is real and it is invisible: those crossings converge
on the photon orbit, and at low spin the photon orbit is INSIDE the disk's inner
edge — r = 3 against an ISCO of 6 at a = 0, so the whole tail emits nothing.
What a band ray actually misses is the handful of crossings on its OUTBOUND leg,
one to three per pixel, and only at high spin does any of the hovering itself
reach the disk (the ISCO drops below the retrograde photon orbit at r ~ 4). No
series, no expansion: detect the sign change of `u` in the loop already tracking
`u`, and shade it. The sentence the entry got right is the one that turned out
to be the whole answer — *they are exactly where `u` changes sign, which it
computes anyway.*

Measured before the slice was written, at the default camera: at a = 0.9, 116 of
248 band pixels gain disk light and 98 of those had none at all; at a = 0.998,
325 of 510, roughly doubling what the march saw. At a = 0 nothing changes, which
is why this looked cosmetic for so long — the default screenshot is a slow spin.

Matter along the continuation path (stars, jets, TDE debris) is still not
integrated; those are volumetric emitters sampled per march step rather than per
crossing. See `docs/DESIGN.md` for the derivation, for why V^t comes from the
null condition rather than the linear constraint, and for what a rendered frame
can prove about any of it.

### H9 — the continuation could not follow a ray over the spin axis

**Status: closed by slice 12.** The separated chart is singular on the spin
axis, and a ray crossing the pole has to swing its azimuth by very nearly π
inside a Mino interval of order 2e-5 — at λ exactly zero the term λ/(1 − u²) is
0/0, so the crossing degenerated into a *reflection* at any step size. Slice
11a flagged those rays rather than guessing; slice 12 takes the whole passage
in closed form instead of stepping through it.

The fix is not the arcsin form this entry used to record. That one divides by
the spin, and a = 0 has band rays and pole crossings of its own. Substituting
v = v_min + √D·w² cancels the turning point's 1/√U identically and leaves no
1/a anywhere; in that variable the passage is a straight line in the tangent
plane at the pole, so an arctangent is the whole answer and the π falls out as
a limit that survives λ = 0. See `docs/DESIGN.md` for the derivation and for
the two guards measurement added around it.

Measured: worst direction error over 43 near-axis band rays at 60 cameras,
156.197° → 1.27e-4°, with rays away from the axis unmoved to 4.0e-6°.

### H2 — γ was quoted per equatorial edge, not around the ring

**Status: closed by slice 14.** `photonOrbitLyapunov` is the exponent of the two
*equatorial* circular photon orbits; off the equator the critical curve is made
of Carter-Q spherical orbits with their own exponents, so those two numbers
bound the ring's spacing rather than give it pointwise. `criticalLyapunov` gives
it pointwise, and the outline carries it.

**This entry's path was wrong twice, and both corrections are worth keeping.**
It said to take the closed form γ(r̃) from the literature and parameterize the
critical curve by r̃. That parameterization divides by a and collapses at a = 0,
where every critical ray shares r̃ = 3 — H9's degeneracy exactly, so the fix is
H9's too: run the map backwards, from the (λ, q) each outline sample already
carries. And the literature's γ is a different CLOCK: it counts e-folds per
half-libration in latitude, which on any equatorial photon orbit is exactly π at
every spin (κ² = λ² − a² identically there), while this lab's rungs are whole
half-turns of swept position angle. Porting that equation would have replaced an
incomplete legend with a uniformly wrong one. See `docs/DESIGN.md` for the
derivation, for the measured camera-dependence of the range, and for why the
labels displace the callouts rather than the other way round.

### H3 — the Kerr embedding used r as the circumferential radius

**Status: closed by slice 16.** `embeddingProfile` drew each ring at the
Boyer–Lindquist r, which is a coordinate label; it is now drawn at the ring's
own proper circumference over 2π, √(r² + a² + 2a²/r), with the height
integral matching arc length against that. The mouth stops shrinking with spin
— ρ(r₊) = 2 identically — and the throat deepens by 3–4% at high spin.

**The entry's second half was wrong, and the correction is worth keeping.** It
said the stricter embedding "does not exist in Euclidean 3-space over parts of
a fast-spinning throat", and asked for the failing segment to be marked. The
equatorial slice always embeds: ρ'² < 1 reduces to a²(1 + 4/r − a²/r⁴) > 0 for
every r ≥ 1, and r₊ ≥ 1 at every spin, while r²/Δ ≥ 1 outside the horizon.
The non-embeddability being remembered is Smarr's, and it belongs to the
horizon 2-sphere (r = r₊, θ, φ), whose Gaussian curvature turns negative near
the poles for a > √3/2. Building the marker would have meant drawing a
boundary that is not there. See `docs/DESIGN.md` for the derivation, for why
the integrand's leading terms are cancelled by hand, and for the control that
makes the isometry check bite.

### H4 — the disk is a zero-thickness, zero-torque Novikov–Thorne sheet

**Status: by design, artistic knobs documented.** No vertical structure, no
self-shadowing, no radiative transfer; the turbulence is fbm. This is the
standard educational picture and every emitter's shift is still exact. A
thick-disk or slim-disk model is out of scope for a per-pixel geodesic
raymarcher without a radiative-transfer pass; not queued.

### H5 — no polarization

**Status: closed by slice 10.** The transport is exact and costs nothing per
march step, as predicted. What the slice does NOT deliver is the EHT's own
picture: that ring pattern is synchrotron from a magnetized flow, and this
disk is a zero-torque Novikov–Thorne sheet with no magnetic field in it. A
toroidal-field synchrotron emitter would be an artistic knob dressed as
physics on this disk, so it was not built; if it ever is, it belongs beside
the scattering model with a badge, not instead of it. What was left of this
hurdle was H8, and slice 15 closed that.

### H8 — the polarized fraction was a fit between two exact endpoints

**Status: closed by slice 15.** The table was obtainable after all, just not
where the entry looked. Chandrasekhar's 1960 Table XXIV is a reprint of Table 6
in Chandrasekhar and Breen 1947 (ApJ 105, 435, p. 439), and ADS serves that
paper's scan freely — the book is the lending copy nobody could open, the
journal article is not. `scatteringDegree` now carries those 21 numbers with a
linear interpolation between them.

**The entry under-stated its own error, and the correction is worth keeping.**
"A couple of percentage points in the middle of the range" was right in
absolute terms — worst 2.4e-2, at mu = 0.2 — but that is the whole point
of the quantity: the fit read 0.078 where the truth is 0.054, so it drew ticks
half again too long there, and near mu = 0.9 nearly double. What replaced it is
bounded at 1.5e-3 by the table's own second differences, and only across the
first tabulated interval.

The rest of the entry held: this moved tick LENGTHS and nothing else. Every
tick DIRECTION still comes from the 4-cross product of the emitter's
4-velocity, the disk normal and the photon direction, exact and unchanged —
which is also why `npm run pol` had to grow a second measurement before the
slice could be called checked. See `docs/DESIGN.md` for the provenance, for why
neither the 1946 third approximation nor the literature's closed-form fit to
the same table was used, and for the control that shows the new measurement
bites.

### H6 — float32 in the shader near the critical curve

**Status: measured, not a problem.** Slice 8 removed the cancellation in the
radial potential's constant term and measured the remaining float32 slop at
1e-4 px on the soft (prograde) edge. Nothing queued; this is a note so nobody
re-suspects it.

### H7 — the visual harness could not run without a GPU

**Status: closed by slice 17.** Playwright refuses any chromium build but the
one its release pins, which a sandbox or CI image may not have; `LAB_CHROMIUM`
points the harness at a preinstalled binary, and that half was only ever a
workaround for a packaging problem. What was actually broken is that every wait
was a millisecond count tuned on a GPU — both the delays, which bought a
different number of frames on a different machine and so measured a different
thing, and the timeouts guarding them. Waits are counted in frames drawn now,
and they wait on the counter MOVING rather than on a predicted total.

**The entry's own path would not have finished the job, and the correction is
worth keeping.** "A frame-count-based wait would make it portable" leaves the
timeouts alone — `capture()` had 15 s and first paint had 60 s, both certain to
fire where a frame costs seconds, and the first software run died on exactly
that. Calibrating them at boot was tried next and measured failing too, because
a harness's job is to change the scene and a boot calibration describes the
scene at boot. See `docs/DESIGN.md` for both measurements, for the one wait
that must stay in milliseconds, and for why a capture's cost cannot be inferred
from a frame's.

## Queued

Nothing argued is outstanding, and for the first time nothing is queued either:
every entry in the register above is closed, by design, or measured and found
not to be a problem. The next slice is a new idea rather than a carried-over
one — so ask before starting one, rather than inferring it from this file.
