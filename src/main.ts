import { MARCH_MAX_STEPS, buildStaticTetrad, ksRadius, type V3 } from "./kerr";
import { tempNorm } from "./disk";
import {
  bandLabel,
  flareMdotEdd,
  flarePeakEdd,
  hillsMassMsun,
  lengthKm,
  peakTempK,
  tidalRadiusM,
  timeSec,
} from "./astro";
import {
  FALLBACK_T0,
  TDE_MAX,
  aliveBodies,
  bodyU,
  launchTde,
  segIntensity,
  stepTde,
  type TdeState,
} from "./tde";
import { GpuTimer, compileProgram, createFbo, destroyFbo, type Fbo } from "./gl";
import {
  ACCUM_MAX,
  FRAME_RING,
  autoStep,
  budgetFps,
  jitterOffset,
  makeAutoState,
  quantizeScale,
} from "./adaptive";
import {
  COMPARE_GUTTER,
  COMPARE_SPIN_LEFT,
  sideLabel,
  splitViewports,
  type Rect,
} from "./compare";
import {
  EMBED_GAS,
  EMBED_STARS,
  EMBED_TDE,
  clearHud,
  drawCallouts,
  CLOCKS_BLOCK_H,
  drawClocks,
  drawCompareDivider,
  drawEmbedding,
  drawLadderLegend,
  drawPolarizationLegend,
  drawPotential,
  drawResizeGrip,
  drawRingGammaLabels,
  drawShadowOutline,
  drawTrails,
  initHud,
  resizeHud,
  setShadowSpin,
  type CalloutItem,
  type CalloutKey,
  type ClockEntry,
  type HudBox,
  type TrailGroup,
} from "./hud";
import {
  DOPPLER_R,
  EINSTEIN_ANGLE,
  TRAIL_CAP_GAS,
  TRAIL_CAP_STAR,
  TRAIL_CAP_TDE,
  Trail,
  alignmentAngle,
  approachingSign,
  circRate,
  embeddingProfile,
  equatorialPoint,
  findShadowEdge,
  outlineLyapunov,
  projectToScreen,
  ringGammaLabels,
  shadowExtremes,
  staticRate,
  type Alignment,
  type EmbeddingProfile,
  type Projected,
  type RingGammaLabel,
  type ShadowEdge,
  type ShadowExtremes,
} from "./edu";
import {
  INSET_MARGIN,
  INSET_SPEC,
  dragScale,
  gripUnder,
  insetBox,
  insetSides,
  legendBox,
  polLegendBox,
  sameGrip,
  type Grip,
  type InsetId,
  type InsetSide,
  type InsetView,
} from "./insets";
import { cameraBasis, attachControls, type CameraState } from "./camera";
import {
  VS_QUAD,
  FS_SCENE,
  FS_BRIGHT,
  FS_DOWN,
  FS_UP,
  FS_COMPOSITE,
  TICK_PITCH,
} from "./shaders";
import {
  GAS_COUNT,
  STAR_COUNT,
  STAR_ORBITS,
  type GasBlob,
  gasPosXZ,
  gasRates,
  gasU,
  makeSpinCtx,
  mulberry32,
  spawnGasBlob,
  starState,
  stepGasBlob,
  type SpinCtx,
} from "./matter";

const BLOOM_LEVELS = 5;
const MAX_DPR = 1.5;

// Quality presets. Render scale is the real lever: the scene shader integrates
// a whole geodesic per pixel of the HDR target, so cost falls with the square
// of the scale while every pixel that IS drawn stays exactly as physical as
// before. Only "low" touches the march itself — a shorter step budget and a
// coarser adaptive arc length trade photon-ring sharpness for a linear saving,
// which is worth it only when halving the resolution wasn't enough. The bloom
// pyramid is left alone at every tier: it runs on quarter-res and down, so it
// is not where the time goes.
//
// "auto" (slice 19) has no fixed scale: it is whatever adaptive.ts's controller
// has settled on to keep the scene pass inside its share of the frame-rate
// limit, measured by GPU timer where the browser has one — and full
// resolution whenever the picture is still, since a still picture is being
// refined and nobody is waiting on it.
type Quality = "low" | "medium" | "high" | "auto";
// medium/high spend the shader's whole march budget; only low shortens it, and
// MARCH_MAX_STEPS is the loop's own bound, so raising these past it does
// nothing. They share the constant rather than repeating 320 for that reason.
const QUALITY: Record<Quality, { scale: number; maxSteps: number; stepScale: number }> = {
  low: { scale: 0.5, maxSteps: MARCH_MAX_STEPS / 2, stepScale: 1.6 },
  medium: { scale: 0.72, maxSteps: MARCH_MAX_STEPS, stepScale: 1.0 },
  high: { scale: 1.0, maxSteps: MARCH_MAX_STEPS, stepScale: 1.0 },
  auto: { scale: NaN, maxSteps: MARCH_MAX_STEPS, stepScale: 1.0 },
};

/**
 * Frames a picture has to stay unchanged before it counts as still. One would
 * do for the refinement itself — every change resets it anyway — but the auto
 * preset also lifts a still picture to full resolution, and that reallocates
 * the render target, which should not happen between two frames of a slider
 * drag.
 */
const STILL_FRAMES = 4;

// rAF is already vsync-capped, so a limit at or above the refresh rate is a
// no-op; the top of the slider means "don't limit" without a magic sentinel.
const FPS_UNLIMITED = 240;

const canvas = document.getElementById("view") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const overlayText = document.getElementById("overlay-text") as HTMLDivElement;

const glMaybe = canvas.getContext("webgl2", { antialias: false });
if (!glMaybe) {
  overlayText.textContent = "WebGL2 is not available in this browser.";
  throw new Error("WebGL2 unavailable");
}
const gl: WebGL2RenderingContext = glMaybe;
const hudCtx = initHud();
const hdr = gl.getExtension("EXT_color_buffer_float") !== null;
if (!hdr) {
  console.warn("EXT_color_buffer_float missing - falling back to LDR bloom");
}

// ---------- programs ----------
const progScene = compileProgram(gl, VS_QUAD, FS_SCENE);
const progBright = compileProgram(gl, VS_QUAD, FS_BRIGHT);
const progDown = compileProgram(gl, VS_QUAD, FS_DOWN);
const progUp = compileProgram(gl, VS_QUAD, FS_UP);
const progComposite = compileProgram(gl, VS_QUAD, FS_COMPOSITE);
const quadVao = gl.createVertexArray()!;

function drawQuad() {
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// Uniform locations are looked up by name once per program and kept: the
// scene pass sets ~45 of them per draw, twice per frame while comparing, and
// each lookup is a string search through the driver for an answer that never
// changes.
const uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
const U = (p: WebGLProgram, n: string) => {
  let m = uniformCache.get(p);
  if (!m) uniformCache.set(p, (m = new Map()));
  let loc = m.get(n);
  if (loc === undefined) m.set(n, (loc = gl.getUniformLocation(p, n)));
  return loc;
};

const gpuTimer = new GpuTimer(gl);

// ---------- framebuffers ----------
let sceneFbo: Fbo | null = null;
let bloomFbos: Fbo[] = [];

function allocateTargets(w: number, h: number) {
  if (sceneFbo) destroyFbo(gl, sceneFbo);
  bloomFbos.forEach((f) => destroyFbo(gl, f));
  // The scene target carries a second attachment for slice 10's Stokes pair:
  // the polarization falls out of the march the scene pass already ran, so it
  // rides along rather than paying for a second one.
  sceneFbo = createFbo(gl, w, h, hdr, true);
  accumN = 0; // a fresh target holds nothing worth averaging into
  allocGen++;
  bloomFbos = [];
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    const s = 2 << i; // 2, 4, 8, 16, 32
    bloomFbos.push(createFbo(gl, Math.max(1, Math.floor(w / s)), Math.max(1, Math.floor(h / s)), hdr));
  }
}

// ---------- adaptive scale and still-picture refinement (slice 19) ----------
const autoState = makeAutoState(1);
/** Frames the scene has drawn the same picture; see STILL_FRAMES. */
let stillFrames = 0;
/** What the last frame's scene pass depended on; a change resets refinement. */
let lastSceneKey = "";
/**
 * Samples averaged into the scene target so far: 1 after an ordinary frame.
 * Above ACCUM_MAX the picture is converged and the march is skipped entirely,
 * which is also what lets a paused lab idle at nearly no GPU cost.
 */
let accumN = 0;
/**
 * The GPU's recent readings of the scene pass, for the readout, which shows
 * the smallest of them: the span stalls on frame pacing some frames and then
 * reads the whole frame period, and a stall is not a cost. See AUTO.window.
 */
const sceneMsRing = new Float64Array(16).fill(NaN);
let sceneMsAt = 0;
let sceneMs = NaN;
/**
 * The last reading as the GPU gave it, before the ring's minimum hides it, and
 * a count of readings so far. The minimum is what the readout and the
 * controller want; the raw sequence is what a study of the stalls needs, and it
 * cannot be recovered from the minimum — a run of stalls shorter than the ring
 * never shows there at all. The count exists because `poll` returns null on
 * most frames: without it a per-frame sampler cannot tell a fresh reading from
 * the previous one still standing.
 */
let rawMs = NaN;
let rawTag = -1;
let rawN = 0;
/**
 * Intervals between DRAWN frames, for the display-rate estimate the controller
 * budgets against (see budgetFps). Skipped frames leave lastFrameT alone, so
 * these are the cadence the renderer actually achieved, which is the limit's
 * own period whenever the limit is what paces it and the display's period
 * whenever it is not.
 */
const frameMsRing = new Float64Array(FRAME_RING).fill(NaN);
let frameMsAt = 0;
/**
 * Counts render-target reallocations. A timer reading is tagged with the
 * generation it was drawn in and lands frames later; only readings from the
 * CURRENT target feed the controller, since the others measured a different
 * scale, and after a step up they would read cheaper than the new one is.
 */
let allocGen = 0;
const jitter: [number, number] = [0, 0];

/** The render scale the current preset asks for this frame. */
function sceneScale(): number {
  if (params.quality !== "auto") return QUALITY[params.quality].scale;
  // A still picture is being refined, not waited on: give it every pixel.
  return stillFrames >= STILL_FRAMES ? 1 : autoState.scale;
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  // The canvas is always the frame's own size: the composite pass runs at full
  // resolution and resamples the scene target up itself (see FS_COMPOSITE's
  // sceneAt), which is what keeps the medium and low presets sharp — before
  // slice 19 the canvas was the scene's size and the browser stretched it. The
  // render scale applies to the scene target alone. The HUD is its own canvas
  // at the same DPR, so overlay text is sharp at every setting.
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
    canvas.width = w;
    canvas.height = h;
  }
  const sw = Math.floor(canvas.clientWidth * dpr * sceneScale());
  const sh = Math.floor(canvas.clientHeight * dpr * sceneScale());
  if (sw > 0 && sh > 0 && (!sceneFbo || sceneFbo.w !== sw || sceneFbo.h !== sh)) {
    allocateTargets(sw, sh);
  }
  resizeHud(hudCtx.canvas, canvas.clientWidth, canvas.clientHeight, dpr);
}
window.addEventListener("resize", resize);

// ---------- UI ----------
const camera: CameraState = { yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60 };
// insetClaim is a hoisted declaration below: it has to lose the race to the
// camera's own pointerdown, so it is wired in here at construction.
attachControls(canvas, camera, insetClaim);

const params = {
  lensing: true,
  exposure: 1.0,
  bloom: 0.7,
  threshold: 1.0,
  starDensity: 1.0,
  sky: true,
  disk: true,
  doppler: true,
  diskTempK: 8000,
  diskBright: 1.0,
  diskOuter: 19,
  stars: true,
  gas: true,
  jets: true,
  jetPower: 1.0,
  timeSpeed: 30, // coordinate time (M) per real second
  spin: 0.7, // Kerr a (must match the slider default in index.html)
  massExp: 6.5, // log10 of the hole mass in solar masses
  mdotExp: -1, // log10 of the accretion rate in Eddington units
  coupleT: true, // disk temperature/brightness follow mass & mdot
  quality: "high" as Quality, // must match the selected <option> in index.html
  fpsLimit: 60, // redraw cap; must match index.html's #fpslimit value
  refine: true, // average jittered frames while the picture is still (slice 19)
  // Split-screen a = 0 vs a = spin (slice 7)
  compare: false,
  // Learn overlays (slice 6) — bound in 6a, consumed by later sub-slices
  eduCallouts: false,
  eduShadow: false,
  eduLadder: false,
  eduPolarization: false,
  eduTrails: false,
  eduClocks: false,
  eduPotential: false,
  eduEmbed: false,
  eduL: 3.4641, // test-particle L for the potential inset (Schwarzschild ISCO: 2√3)
  // Uniform scale of each draggable inset (1 = the size it was designed at).
  potScale: 1,
  embedScale: 1,
};

// ---------- resizable insets ----------
// The layout and hit-test math is insets.ts; this is the DOM half of it.
//
// The HUD canvas is pointer-events:none so that camera drags pass straight
// through it to #view — which also means the insets' own grips never receive a
// pointer event. So the hit-testing lives here, on the GL canvas, and claims
// the pointerdown before the camera turns it into an orbit drag.

/**
 * Left edge of compare mode's split region, in CSS px — clear of the opaque
 * #panel column, so neither half's hole ends up behind it. Measured once
 * rather than hardcoded like insets.ts's POT_X: #panel is position:fixed at a
 * fixed width, so its right edge never moves with the window, and reading it
 * keeps this honest if the panel's CSS width ever changes.
 */
const COMPARE_X0 =
  Math.ceil(
    (document.getElementById("panel") as HTMLDivElement).getBoundingClientRect().right
  ) + INSET_MARGIN;

// One long-lived view rather than a fresh object per call: insetBox runs per
// inset per side every frame, and everything else the insets redraw is
// preallocated for the same reason.
const insetView: InsetView = {
  width: 0,
  height: 0,
  x0: COMPARE_X0,
  compare: false,
  scale: { pot: 1, embed: 1 },
  shown: { pot: false, embed: false },
};

/**
 * How far down a callout's text may reach on one side, in CSS px.
 *
 * The insets are bottom-anchored, opaque, and drawn after the callout layer,
 * so a label reaching into their band is not merely crowded — it is overdrawn
 * by a wireframe. Only compare mode hangs a label below the disk (see
 * SHADOW_LABEL_DY), and only there can that band be reached: single view's
 * shadow label rides at the disk's mid-height, a long way clear, so it keeps
 * the full canvas and this cannot move a label the split didn't put there.
 *
 * The higher of the two tops when both are shown: they are different heights
 * and the label is centred between them, so the taller one is the bound.
 */
function calloutFloorY(side: InsetSide | null): number {
  const ch = canvas.clientHeight;
  if (!params.compare) return ch;
  const iv = viewNow();
  let floorY = ch;
  for (const id of ["pot", "embed"] as InsetId[]) {
    if (iv.shown[id]) floorY = Math.min(floorY, insetBox(iv, id, side).y);
  }
  return floorY;
}

/** insetView, refreshed from the canvas and the knobs it follows. */
function viewNow(): InsetView {
  insetView.width = canvas.clientWidth;
  insetView.height = canvas.clientHeight;
  insetView.compare = params.compare;
  insetView.scale.pot = params.potScale;
  insetView.scale.embed = params.embedScale;
  insetView.shown.pot = params.eduPotential;
  insetView.shown.embed = params.eduEmbed;
  return insetView;
}

/** The spin a side is showing, and the radii already derived from it. */
const sideSpin = (side: InsetSide | null) =>
  side === "left" ? COMPARE_SPIN_LEFT : params.spin;
const sideCtx = (side: InsetSide | null) => (side === "left" ? spinCtxSchw : spinCtx);

let insetDrag: { id: InsetId; startScale: number; x0: number; y0: number } | null = null;
let gripHot: Grip | null = null;

function insetClaim(e: PointerEvent): boolean {
  const hit = gripUnder(viewNow(), e.clientX, e.clientY);
  if (!hit) return false;
  insetDrag = {
    id: hit.id,
    startScale: insetView.scale[hit.id],
    x0: e.clientX,
    y0: e.clientY,
  };
  canvas.setPointerCapture(e.pointerId);
  return true;
}

canvas.addEventListener("pointermove", (e) => {
  if (!insetDrag) {
    gripHot = gripUnder(viewNow(), e.clientX, e.clientY);
    canvas.style.cursor = gripHot ? INSET_SPEC[gripHot.id].cursor : "";
    return;
  }
  const v = dragScale(
    insetDrag.id,
    insetDrag.startScale,
    e.clientX - insetDrag.x0,
    e.clientY - insetDrag.y0
  );
  if (insetDrag.id === "pot") params.potScale = v;
  else params.embedScale = v;
});

canvas.addEventListener("pointerup", (e) => {
  if (!insetDrag) return;
  insetDrag = null;
  // The camera's own pointerup runs first and releases the capture we took,
  // so this would otherwise throw on an already-released pointer.
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
});

// ---------- matter state ----------
let simT = 0; // simulation (coordinate) time in M
let paused = false;
let spinCtx = makeSpinCtx(params.spin);
// Compare mode's left half never moves off a = 0, so its context is built once.
const spinCtxSchw = makeSpinCtx(COMPARE_SPIN_LEFT);
let tde: TdeState | null = null;

// Proper time carried by each clock in the 6b overlay. The far-away
// observer's proper time IS simT, so it needs no accumulator.
let tauCam = 0;
let tauIsco = 0;
let tauStar = 0;
// preallocated: drawClocks runs every frame and must not allocate
const clockEntries: ClockEntry[] = [
  { label: "far away", tau: 0, rate: 1, gone: false },
  { label: "camera", tau: 0, rate: 1, gone: false },
  { label: "ISCO", tau: 0, rate: 1, gone: false },
  { label: "the star", tau: 0, rate: 1, gone: false },
];

// TDE bodies plotted on the 6c potential inset — capped at 4 so the curve
// stays readable. Preallocated: the inset redraws every frame.
const POT_MARK_MAX = 4;
const potMarkR = new Float64Array(POT_MARK_MAX);
const potMarkE = new Float64Array(POT_MARK_MAX);

// Matter riding the 6d funnel — every body that can be on screen at once.
// Preallocated: the inset redraws every frame.
const EMBED_DOT_MAX = STAR_COUNT + GAS_COUNT + TDE_MAX;
const embedDotR = new Float64Array(EMBED_DOT_MAX);
const embedDotAz = new Float64Array(EMBED_DOT_MAX);
const embedDotGroup = new Uint8Array(EMBED_DOT_MAX);
const embedScratch: V3 = [0, 0, 0];

// The funnel's shape depends on nothing but (a, rMax), and integrating it is
// ~400 steps of quadrature — so it is cached on exactly those two and rebuilt
// only when the spin or disk-size slider actually moves.
//
// Two slots, because compare mode (7c) asks for a = 0 and the slider's a in
// the same frame: one slot would miss on both calls and re-integrate both
// profiles every frame, turning a cache into a per-frame cost. Which slot a
// spin lands in is only ever a hit-rate question — the (a, rMax) check below
// is what makes the answer correct, so a slot can never serve a stale profile.
interface EmbedSlot {
  profile: EmbeddingProfile | null;
  a: number;
  rMax: number;
}
const embedSlots: Record<"schw" | "slider", EmbedSlot> = {
  schw: { profile: null, a: NaN, rMax: NaN },
  slider: { profile: null, a: NaN, rMax: NaN },
};
function embeddingFor(a: number, rMax: number): EmbeddingProfile {
  const slot = embedSlots[a === COMPARE_SPIN_LEFT ? "schw" : "slider"];
  if (!slot.profile || a !== slot.a || rMax !== slot.rMax) {
    slot.profile = embeddingProfile(a, rMax, 400);
    slot.a = a;
    slot.rMax = rMax;
  }
  return slot.profile;
}

// Orbit trails (6e). Filled every frame whether or not the overlay is on — a
// few comparisons per body, and the history is already there the moment the
// user ticks the box. Declared above the bindSlider block below: binding the
// spin slider runs its callback immediately, and that callback clears these.
const starTrails: Trail[] = [];
for (let i = 0; i < STAR_COUNT; i++) starTrails.push(new Trail(TRAIL_CAP_STAR));
// The a = 0 half's own history (7d). A trail is the one thing about a star
// that compare mode cannot refill from the other side's spin: starState is
// closed form in (t, a), but a PATH is the record of where the star has been,
// and the Schwarzschild half's path is not the slider half's evaluated
// differently — it is a different orbit, which is the whole point of drawing
// it. So the two spins each keep a set, recorded side by side every frame.
const starTrailsSchw: Trail[] = [];
for (let i = 0; i < STAR_COUNT; i++) starTrailsSchw.push(new Trail(TRAIL_CAP_STAR));
const gasTrails: Trail[] = [];
for (let i = 0; i < GAS_COUNT; i++) gasTrails.push(new Trail(TRAIL_CAP_GAS));
const tdeTrails: Trail[] = [];
for (let i = 0; i < TDE_MAX; i++) tdeTrails.push(new Trail(TRAIL_CAP_TDE));
const trailGroups: TrailGroup[] = [
  { trails: starTrails, group: EMBED_STARS, on: true },
  { trails: gasTrails, group: EMBED_GAS, on: true },
  { trails: tdeTrails, group: EMBED_TDE, on: true },
];
// One group list per compare half (7d), holding stars and nothing else: gas and
// TDE debris are stateful and drawn on neither half, so their trails go with
// them — the same cut the funnel's dots make. Preallocated beside trailGroups
// because drawTrails runs every frame and the trail path never touches the heap.
const trailGroupsSchw: TrailGroup[] = [
  { trails: starTrailsSchw, group: EMBED_STARS, on: true },
];
const trailGroupsSlider: TrailGroup[] = [
  { trails: starTrails, group: EMBED_STARS, on: true },
];
const trailScratch: V3 = [0, 0, 0];

// Shadow & photon-ring outline (6f). Each sample of it is a cubic solve
// (kerr.ts rayCaptured), not a geodesic march, so a whole outline costs well
// under a millisecond and is simply recomputed whenever (spin, view, lens,
// aspect) changes — live under a drag, never stale, never faded. It used to be
// ~1000 traces and ~540 ms at a = 0.998, debounced and time-sliced across
// frames; see docs/DESIGN.md, slice 9.
interface ShadowTrace {
  edge: ShadowEdge | null;
  // The ladder's exponent at each of the outline's azimuths (H2). Computed
  // with the edge and keyed by the same view: it is a tenth of the outline's
  // own cost (0.05 ms against 0.56 at a = 0.998), so there is nothing to gain
  // by computing only the six that get printed.
  gammas: Float64Array | null;
  // The view this outline was computed for; any change recomputes it. NaN so
  // that the first frame always misses.
  spin: number;
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
  aspect: number;
}
const makeShadowTrace = (): ShadowTrace => ({
  edge: null,
  gammas: null,
  spin: NaN,
  yaw: NaN,
  pitch: NaN,
  dist: NaN,
  fov: NaN,
  aspect: NaN,
});
/**
 * Two outlines, because compare mode (7b) shows two spacetimes at once and an
 * outline is only ever the boundary of ONE of them. Each carries its own view
 * key: the halves differ in spin AND in aspect, so neither can be shared. In
 * single view only the slider's is used, and shadowSchw stays untouched.
 */
const shadowSlider = makeShadowTrace();
const shadowSchw = makeShadowTrace();
/** The exponents the legend may quote: only ever ones an outline measured. */
const drawnGammas = (st: ShadowTrace): Float64Array | null =>
  st.edge !== null && st.edge.valid ? st.gammas : null;

// Callout mode (6g). Every anchor here is a straight-line projection of where
// a thing IS; the lensed image the label names sits near it, not on it (the
// checkbox tooltip and the ISCO copy both say so). All of it is cheap math
// recomputed per frame.
const CALLOUT_MAX = 10;
const calloutItems: CalloutItem[] = [];
for (let i = 0; i < CALLOUT_MAX; i++)
  calloutItems.push({ key: "shadow", ax: 0, ay: 0, dx: 0, dy: 0, alpha: 1 });
const calloutExt: ShadowExtremes = {
  leftX: 0, leftY: 0, rightX: 0, rightY: 0, topX: 0, topY: 0, bottomX: 0, bottomY: 0,
};
// The printed exponents (H2), one buffer per strip for the same reason the
// extremes are: both halves are live at once while comparing, and each one's
// numbers belong to its own spin.
const ringLabels: RingGammaLabel[] = [];
const ringLabelsSchw: RingGammaLabel[] = [];
// and the boxes they took, so 6g's callouts can step around them
const ringBoxes: HudBox[] = [];
const ringBoxesSchw: HudBox[] = [];

// The a = 0 half's shadow label (compare only) lays out in its own strip, so
// it gets its own extremes and its own one-item list rather than sharing the
// buffers above — those hold the slider side's, and both are live at once.
const calloutExtSchw: ShadowExtremes = {
  leftX: 0, leftY: 0, rightX: 0, rightY: 0, topX: 0, topY: 0, bottomX: 0, bottomY: 0,
};
const calloutItemsSchw: CalloutItem[] = [
  { key: "shadowSchw", ax: 0, ay: 0, dx: 0, dy: 0, alpha: 1 },
];
const calloutProj: Projected = { x: 0, y: 0, z: 0, visible: false };
const calloutAlign: Alignment = { angle: 0, behind: false };
const calloutQ: V3 = [0, 0, 0];

/**
 * How far below the shadow's bottom edge its label hangs in compare mode.
 *
 * Single view hangs it off the shadow's LEFT edge; a half-width strip has no
 * room for that. The block is ~190 px and a half leaves only ~130 px of sky
 * left of the disk, so the layout's clamp would flip it back over the black
 * disk — hiding the circle-vs-D shape the split exists to show. Below, there
 * is room on both halves: the photon ring already anchors upward, and the two
 * bottom extremes share a y (one camera, one frame), so the two ratios land
 * level with each other across the divider, which is the comparison.
 */
const SHADOW_LABEL_DY = 46;
/** Height at which the jet labels tap the beam: past the shader's fade-in at
 *  |y| = 2.6 and well short of its fade-out at 46. */
const JET_MARK_Y = 14;
/** Beyond this pitch the disk is open enough that its far side no longer
 *  arcs over the pole, and the doubled-image labels would name nothing. */
const DOUBLED_MAX_PITCH = 0.45;
/** How far outside the shadow's edge the doubled image is marked. The outline
 *  is centred on ndc (0,0) by construction, so scaling an extreme's ndc walks
 *  straight out along that radius. */
const DOUBLED_NDC_SCALE = 1.35;

const rng = mulberry32(0x5eed);
const gasBlobs: GasBlob[] = [];
for (let i = 0; i < GAS_COUNT; i++) gasBlobs.push(spawnGasBlob(rng, params.diskOuter));
// pre-scatter the blobs through the disk so t = 0 doesn't start with a ring
for (const b of gasBlobs) stepGasBlob(b, 400 * rng(), params.diskOuter, rng, spinCtx);

const starPosArr = new Float32Array(STAR_COUNT * 4);
const starUArr = new Float32Array(STAR_COUNT * 4);
const starTempArr = new Float32Array(STAR_COUNT);
const gasArr = new Float32Array(GAS_COUNT * 4);
const gasUArr = new Float32Array(GAS_COUNT * 4);
const gasArcArr = new Float32Array(GAS_COUNT * 4);
const tdePosArr = new Float32Array(TDE_MAX * 4);
const tdeUArr = new Float32Array(TDE_MAX * 4);
const tdeInfoArr = new Float32Array(TDE_MAX * 4);

function bindSlider(id: string, apply: (v: number) => void, fmt?: (v: number) => string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const show = document.getElementById(id + "-val");
  const update = () => {
    const v = parseFloat(el.value);
    apply(v);
    if (show) show.textContent = fmt ? fmt(v) : el.value;
  };
  el.addEventListener("input", update);
  update();
}
function bindCheckbox(id: string, apply: (v: boolean) => void) {
  const el = document.getElementById(id) as HTMLInputElement;
  el.addEventListener("change", () => apply(el.checked));
  apply(el.checked);
}
/**
 * Slider + number field as two views of one value, each writing the other
 * back. The field is never rewritten while it is the one being typed in —
 * clamping "1" to the minimum mid-keystroke would make "150" untypable — so
 * it re-clamps on commit (blur/Enter) instead.
 */
function bindNumField(id: string, apply: (v: number) => void) {
  const range = document.getElementById(id) as HTMLInputElement;
  const num = document.getElementById(id + "-num") as HTMLInputElement;
  const lo = parseFloat(range.min);
  const hi = parseFloat(range.max);
  const push = (raw: number, typing: boolean) => {
    if (!Number.isFinite(raw)) return; // empty/partial field: keep the last value
    const v = Math.min(hi, Math.max(lo, raw));
    range.value = String(v);
    if (!typing) num.value = String(v);
    apply(v);
  };
  range.addEventListener("input", () => push(parseFloat(range.value), false));
  num.addEventListener("input", () => push(parseFloat(num.value), true));
  num.addEventListener("change", () => push(parseFloat(num.value), false));
  push(parseFloat(range.value), false);
}

bindSlider("fov", (v) => (camera.fovDeg = v));
bindSlider("exposure", (v) => (params.exposure = v));
bindSlider("bloom", (v) => (params.bloom = v));
bindSlider("stars", (v) => (params.starDensity = v));
bindSlider("disktemp", (v) => (params.diskTempK = v));
bindSlider("diskbright", (v) => (params.diskBright = v));
bindSlider("disksize", (v) => (params.diskOuter = v));
bindSlider("timespeed", (v) => (params.timeSpeed = v));
bindSlider("jetpower", (v) => (params.jetPower = v));
bindSlider("edul", (v) => (params.eduL = v), (v) => v.toFixed(2));
bindSlider("spin", (v) => {
  params.spin = v;
  spinCtx = makeSpinCtx(v);
  // starState is a closed form in (t, a), so a new spin teleports every star
  // onto its new orbit — the old samples are a path through a spacetime that
  // no longer exists, and joining them to the new ones would draw a jump.
  // Gas and debris carry their own state and move continuously instead.
  // starTrailsSchw is deliberately spared: this slider is not its spin, and its
  // ring survives a drag precisely because a = 0 is what compare holds fixed.
  for (const t of starTrails) t.clear();
});
const fmtSci = (x: number) => {
  const e = Math.floor(Math.log10(x));
  return `${(x / 10 ** e).toFixed(1)}×10^${e}`;
};
bindSlider("mass", (v) => (params.massExp = v), (v) => fmtSci(10 ** v));
bindSlider("mdot", (v) => (params.mdotExp = v), (v) => (10 ** v).toPrecision(2));
bindCheckbox("couple", (v) => {
  params.coupleT = v;
  (document.getElementById("disktemp") as HTMLInputElement).disabled = v;
});
bindCheckbox("lensing", (v) => (params.lensing = v));
bindCheckbox("disk", (v) => (params.disk = v));
bindCheckbox("doppler", (v) => (params.doppler = v));
bindCheckbox("stars-on", (v) => (params.stars = v));
bindCheckbox("gas-on", (v) => (params.gas = v));
bindCheckbox("jets-on", (v) => (params.jets = v));
bindCheckbox("sky-on", (v) => {
  params.sky = v;
  // Star density only has a sky to populate (same pattern as couple/disktemp).
  (document.getElementById("stars") as HTMLInputElement).disabled = !v;
});
bindCheckbox("compare", (v) => {
  params.compare = v;
  // Nothing to throw a star into while comparing: the debris is single-spin
  // and hidden, so the button would look broken (same pattern as couple
  // disabling the disk-temperature slider it overrides).
  (document.getElementById("tde") as HTMLButtonElement).disabled = v;
});
bindCheckbox("edu-callouts", (v) => (params.eduCallouts = v));
bindCheckbox("edu-shadow", (v) => (params.eduShadow = v));
bindCheckbox("edu-ladder", (v) => (params.eduLadder = v));
bindCheckbox("edu-polarization", (v) => (params.eduPolarization = v));
bindCheckbox("edu-trails", (v) => (params.eduTrails = v));
bindCheckbox("edu-clocks", (v) => (params.eduClocks = v));
bindCheckbox("edu-potential", (v) => (params.eduPotential = v));
bindCheckbox("edu-embed", (v) => (params.eduEmbed = v));

bindNumField("fpslimit", (v) => (params.fpsLimit = v));
bindCheckbox("refine", (v) => (params.refine = v));
// No reallocation needed here: resize() runs at the top of every frame and
// picks the new render scale up on its own.
const qualitySel = document.getElementById("quality") as HTMLSelectElement;
const applyQuality = () => {
  const was = params.quality;
  params.quality = qualitySel.value as Quality;
  // Auto starts from where the fixed preset left it rather than from full
  // resolution: a user switching from low is asking for the frame rate low
  // gave them, and the controller only ever moves one step per window.
  if (params.quality === "auto" && was !== "auto")
    autoState.scale = quantizeScale(QUALITY[was].scale);
};
qualitySel.addEventListener("change", applyQuality);
applyQuality();

const pauseBtn = document.getElementById("pause") as HTMLButtonElement;
pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
});

const tdeBtn = document.getElementById("tde") as HTMLButtonElement;
tdeBtn.addEventListener("click", () => {
  tde = launchTde(10 ** params.massExp, params.spin);
  tauStar = 0;
  for (const t of tdeTrails) t.clear();
});

const distReadout = document.getElementById("dist-readout")!;
const physReadout = document.getElementById("phys-readout")!;
const tdeReadout = document.getElementById("tde-readout")!;
const fpsReadout = document.getElementById("fps-readout")!;
const setText = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};

// ---------- render loop ----------
let frames = 0;
let fpsT0 = performance.now();
let firstFrame = true;
let lastFrameT = performance.now();
let nextFrameT = performance.now();

function render() {
  // Frame-rate gate. Skipped frames return before the simulation advance and
  // leave lastFrameT alone, so dt simply accumulates into the next drawn frame
  // and sim time stays tied to the real clock at any limit.
  const nowGate = performance.now();
  if (params.fpsLimit < FPS_UNLIMITED) {
    // 1 ms of slack: without it, vsync jitter halves a cap set near the
    // display's own refresh rate.
    if (nowGate < nextFrameT - 1) {
      requestAnimationFrame(render);
      return;
    }
    // Advance on the ideal cadence so the average rate is exact, but snap
    // forward when we are already slower than the cap — otherwise a stall
    // banks missed frames and pays them back as a burst.
    nextFrameT = Math.max(nextFrameT + 1000 / params.fpsLimit, nowGate);
  } else {
    nextFrameT = nowGate; // keep it fresh so re-enabling the limit starts clean
  }

  resize();
  if (!sceneFbo) {
    requestAnimationFrame(render);
    return;
  }
  const basis = cameraBasis(camera);
  const tanHalfFov = Math.tan((camera.fovDeg * Math.PI) / 360);

  // Compare mode's two viewports, in scene-target px. Everything about the
  // split is declared in CSS px and scaled into the target by the same
  // factor, so the HUD's divider lands exactly over the gap the scene pass
  // leaves. The region starts clear of the control panel (see COMPARE_X0).
  const glScaleX = sceneFbo.w / Math.max(canvas.clientWidth, 1);
  const compareW = Math.max(canvas.clientWidth - COMPARE_X0, 0);
  const split = splitViewports(
    COMPARE_X0 * glScaleX,
    compareW * glScaleX,
    sceneFbo.h,
    COMPARE_GUTTER * glScaleX
  );
  // The viewport the slider's spin is rendered into: the whole target
  // normally, the right half when comparing. Named because 6f's outline has
  // to be traced at the aspect this rect gives the shader and drawn back over
  // this rect, and in compare mode that is no longer the frame.
  const viewSlider: Rect = params.compare
    ? split.right
    : { x: 0, y: 0, w: sceneFbo.w, h: sceneFbo.h };
  /** A scene viewport mapped back into the CSS px the HUD draws in. Taken off
   *  the GL rect rather than re-split in CSS: an independent CSS split rounds
   *  differently and would sit up to a pixel off the disk it traces. */
  const hudX = (v: Rect) => v.x / glScaleX;
  const hudW = (v: Rect) => v.w / glScaleX;

  // advance simulation time and the gas blobs
  const now0 = performance.now();
  const frameBefore = lastFrameT; // the fallback cost reading below wants the raw period
  const dtReal = Math.min((now0 - lastFrameT) * 0.001, 0.1);
  lastFrameT = now0;
  frameMsRing[frameMsAt++ % frameMsRing.length] = now0 - frameBefore;
  // gates the trail pushes below, which happen in the loops that build the
  // uniforms — those run every frame, but a frozen clock has no path to record
  let stepped = false;
  if (!paused && params.timeSpeed > 0) {
    const dtSim = dtReal * params.timeSpeed;
    simT += dtSim;
    stepped = true;
    // Clock rates are re-evaluated every frame rather than cached: the
    // camera's depth changes as it orbits and the ISCO moves with spin.
    tauCam += dtSim * staticRate(basis.pos, params.spin);
    tauIsco += dtSim * circRate(spinCtx.isco, params.spin);
    const star = tde ? tde.bodies[0] : null;
    if (star && star.alive) tauStar += dtSim / bodyU(star, params.spin)[0];
    // Star trails are recorded here rather than inside fillStars, which the
    // scene pass and the funnel share: fillStars writes starPosArr, and asking
    // it for a second spin purely to feed a trail would leave that scratch at a
    // spin its next reader never asked for (single view's funnel dots read it
    // without refilling). Both sets are recorded whichever mode is on, for the
    // reason the trails are recorded with the overlay off at all: a half has to
    // have a ring to show the moment compare is ticked, not an orbit later.
    for (let i = 0; i < STAR_COUNT; i++) {
      starTrails[i].push(starState(STAR_ORBITS[i], simT, params.spin).pos, simT);
      starTrailsSchw[i].push(starState(STAR_ORBITS[i], simT, COMPARE_SPIN_LEFT).pos, simT);
    }
    for (let i = 0; i < GAS_COUNT; i++) {
      const b = gasBlobs[i];
      const rWas = b.r;
      stepGasBlob(b, dtSim, params.diskOuter, rng, spinCtx);
      // Blobs only ever drift inward, so a radius that jumped outward means
      // stepGasBlob re-randomized this one at the disk's edge: the trail
      // belongs to a blob that has been eaten.
      if (b.r > rWas + 2) gasTrails[i].clear();
    }
    if (tde) {
      stepTde(tde, dtSim, params.spin, simT, rng, params.diskOuter);
      // Indexed by slot in tde.bodies, NOT by the aliveBodies() ordering the
      // uniforms use — that array is filtered, so its indices shift as debris
      // is eaten and surviving strands would inherit a neighbour's history.
      // Slot 0 deliberately carries straight through disruption: spawnDebris
      // starts every element at the star's position, so element 0's path
      // really does continue the star's.
      for (let i = 0; i < tde.bodies.length && i < TDE_MAX; i++) {
        const b = tde.bodies[i];
        if (b.alive) tdeTrails[i].push(b.p, simT);
      }
    }
  }

  // ---- mass -> temperature coupling and the TDE flare ----
  const massMsun = 10 ** params.massExp;
  const mdotBase = 10 ** params.mdotExp;
  // Compare mode drops the flare with the debris that causes it. Keeping it
  // would not break the comparison — mdot is one of the quantities held
  // identical, so both halves would flare together — but it would light both
  // disks by up to 8x from an event neither half is drawing, which reads as
  // the spin doing something absurd. The event itself keeps running; turning
  // compare off rejoins it wherever it has got to.
  const flare =
    tde && tde.tDisrupt !== null && !params.compare
      ? flareMdotEdd(simT - tde.tDisrupt, FALLBACK_T0, flarePeakEdd(massMsun))
      : 0;
  const mdotTot = mdotBase + flare;
  // T ∝ mdot^(1/4) M^(-1/4) (isco)^(-3/4); luminosity ∝ mdot (display-capped).
  // Per side in compare mode, and not merely for tidiness: the ISCO is where
  // the spin enters the temperature profile, so the two halves of the frame
  // are genuinely at different peak temperatures. Forcing the Schwarzschild
  // side to the Kerr side's temperature would hide the coupling that slice 5
  // exists to show — the hotter inner edge IS part of what spin does.
  const effTempFor = (ctx: SpinCtx) =>
    params.coupleT ? peakTempK(massMsun, mdotTot, ctx.isco) : params.diskTempK;
  const effTempK = effTempFor(spinCtx);
  // flare brightness is sqrt-compressed for display (the true bolometric
  // jump is ~mdot and would clip the whole frame to white); the readout
  // reports the physical ratio
  const effBright = params.diskBright * Math.min(Math.sqrt(mdotTot / mdotBase), 8);

  // star uniforms for this frame (positions plus exact 4-velocities).
  // starState is a closed form in (t, a), so compare mode just fills the same
  // scratch arrays again at the other spin between the two draws — no second
  // copy of the star state has to exist anywhere. Called per side from the
  // scene pass below, and again per side by the funnel, which reads the scratch
  // this leaves: whoever calls it last owns starPosArr, so nothing may call it
  // for a spin it is not about to draw.
  const fillStars = (spin: number) => {
    for (let i = 0; i < STAR_COUNT; i++) {
      const s = starState(STAR_ORBITS[i], simT, spin);
      starPosArr.set(s.pos, i * 4);
      starPosArr[i * 4 + 3] = STAR_ORBITS[i].radius;
      starUArr.set(s.u, i * 4);
      starTempArr[i] = STAR_ORBITS[i].tempK;
    }
  };
  for (let i = 0; i < GAS_COUNT; i++) {
    const b = gasBlobs[i];
    const [gx, gz] = gasPosXZ(b, spinCtx);
    gasArr[i * 4] = gx;
    gasArr[i * 4 + 1] = gz;
    gasArr[i * 4 + 2] = b.size;
    gasArr[i * 4 + 3] = b.bright;
    gasUArr.set(gasU(b, spinCtx), i * 4);
    // the shader sweeps each blob backward along these to draw its sheared arc
    const rates = gasRates(b, spinCtx);
    gasArcArr[i * 4] = b.az;
    gasArcArr[i * 4 + 1] = rates.dazdt;
    gasArcArr[i * 4 + 2] = rates.dRdt;
    gasArcArr[i * 4 + 3] = Math.hypot(gx, gz); // draw radius, for its radial reject
    if (stepped) {
      // the blobs live in the disk plane; Trail copies, so one scratch does
      trailScratch[0] = gx;
      trailScratch[1] = 0;
      trailScratch[2] = gz;
      gasTrails[i].push(trailScratch, simT);
    }
  }

  // TDE star / debris uniforms (exact geodesic positions + 4-velocities).
  // The shader draws capsules between consecutive elements, so the intact
  // star is duplicated into a degenerate (zero-length) capsule, and each
  // element's info.z carries the intensity of the capsule it starts.
  const tdeBodies = tde ? aliveBodies(tde) : [];
  let tdeN = Math.min(tdeBodies.length, TDE_MAX);
  for (let i = 0; i < tdeN; i++) {
    const b = tdeBodies[i];
    tdePosArr.set(b.p, i * 4);
    tdePosArr[i * 4 + 3] = b.size;
    tdeUArr.set(bodyU(b, params.spin), i * 4);
    tdeInfoArr[i * 4] = b.tempK;
    tdeInfoArr[i * 4 + 1] = b.bright;
  }
  if (tdeN === 1) {
    tdePosArr.copyWithin(4, 0, 4);
    tdeUArr.copyWithin(4, 0, 4);
    tdeInfoArr.copyWithin(4, 0, 4);
    tdeN = 2;
  }
  for (let i = 0; i + 1 < tdeN; i++) {
    const len = Math.hypot(
      tdePosArr[(i + 1) * 4] - tdePosArr[i * 4],
      tdePosArr[(i + 1) * 4 + 1] - tdePosArr[i * 4 + 1],
      tdePosArr[(i + 1) * 4 + 2] - tdePosArr[i * 4 + 2]
    );
    tdeInfoArr[i * 4 + 2] = segIntensity(
      tdeInfoArr[i * 4 + 1],
      tdeInfoArr[(i + 1) * 4 + 1],
      len
    );
  }
  if (tdeN > 0) tdeInfoArr[(tdeN - 1) * 4 + 2] = 0;

  // 6f shadow outline, exact and cheap: recomputed whenever its view changes.
  // Callout mode (6g) shares the computed edge. The 6g layer is suppressed
  // while comparing, so there it is the shadow checkbox alone that asks for
  // an outline.
  const shadowOn = params.eduShadow || (params.eduCallouts && !params.compare);

  /**
   * Bring one side's outline up to date with the view.
   *
   * The aspect must be the one the SHADER used (uResolution's w/h for this
   * side's viewport), not the canvas's — in compare mode a half is far from
   * the frame's shape, and an outline computed at the wrong aspect would be a
   * perfectly-computed boundary of a view nobody is looking at.
   */
  const updateShadow = (st: ShadowTrace, spin: number, view: Rect) => {
    const aspect = view.w / view.h;
    if (
      spin === st.spin &&
      camera.yaw === st.yaw &&
      camera.pitch === st.pitch &&
      camera.dist === st.dist &&
      camera.fovDeg === st.fov &&
      aspect === st.aspect
    ) {
      return;
    }
    st.spin = spin;
    st.yaw = camera.yaw;
    st.pitch = camera.pitch;
    st.dist = camera.dist;
    st.fov = camera.fovDeg;
    st.aspect = aspect;
    // the static tetrad is spin-dependent, so each side launches its rays
    // from its own — this is the camera as ITS spacetime sees it
    const tet = buildStaticTetrad(basis.pos, spin, basis.right, basis.up, basis.fwd);
    st.edge = findShadowEdge(basis.pos, tet, spin, tanHalfFov, aspect);
    st.gammas = outlineLyapunov(
      basis.pos,
      tet,
      spin,
      tanHalfFov,
      aspect,
      st.edge,
      st.gammas ?? undefined
    );
  };

  const outlineOn = shadowOn || params.eduLadder;
  if (outlineOn) {
    if (params.compare) updateShadow(shadowSchw, COMPARE_SPIN_LEFT, split.left);
    updateShadow(shadowSlider, params.spin, viewSlider);
  }

  // ---- is the picture still? (slice 19) ----
  // Everything the scene pass reads, as one string: a change in any of it is
  // a new picture, and the frames of a new picture cannot be averaged with the
  // old one's. Bloom, exposure and the HUD overlays are deliberately absent —
  // they are applied downstream of the scene target, so they can move without
  // throwing the samples away. Nor is the target's size in here: the auto
  // preset changes it BECAUSE the picture went still, and a key that noticed
  // would call that a change and undo it every other frame.
  const sceneKey =
    `${camera.yaw},${camera.pitch},${camera.dist},${camera.fovDeg},${simT},` +
    `${params.lensing},${params.starDensity},${params.sky},${params.disk},` +
    `${params.doppler},${effTempK},${effBright},${params.diskOuter},${params.stars},` +
    `${params.gas},${params.jets},${params.jetPower},${params.spin},${params.compare},` +
    `${params.eduLadder},${params.eduPolarization},${tdeN}`;
  if (sceneKey === lastSceneKey) stillFrames++;
  else {
    stillFrames = 0;
    lastSceneKey = sceneKey;
  }
  // The sample this frame contributes: 1 is a plain frame and overwrites the
  // target; higher ones are jittered and blended in at 1/n, so the target is
  // the running mean. Past ACCUM_MAX the mean is converged and the march is
  // not run at all — the bloom and composite below read the target as it is.
  if (!(params.refine && stillFrames > 0)) accumN = 0;
  const converged = accumN >= ACCUM_MAX;
  if (!converged) accumN++;
  jitterOffset(accumN - 1, jitter);

  // The GPU's reading of a scene pass from a few frames back. Only the auto
  // preset's ADAPTIVE frames feed the controller: a still frame drawn at full
  // resolution for refinement costs more by design, and judging the scale on
  // it would pull the scale down for the frames that are not still. Without
  // a timer, the frame period stands in, which the controller knows to trust
  // in one direction only.
  const timed = gpuTimer.poll();
  if (timed !== null) {
    rawMs = timed.ms;
    rawTag = timed.tag;
    rawN++;
    sceneMsRing[sceneMsAt++ % sceneMsRing.length] = timed.ms;
    sceneMs = Infinity;
    for (const v of sceneMsRing) if (v < sceneMs) sceneMs = v;
  }
  const adaptive = params.quality === "auto" && stillFrames < STILL_FRAMES;
  if (adaptive && !converged) {
    // Not params.fpsLimit: a limit above the display's refresh rate is one the
    // renderer already ignores, and budgeting for it shrinks the picture to buy
    // frames that are never shown. See budgetFps.
    const target = budgetFps(params.fpsLimit, frameMsRing);
    if (gpuTimer.available) {
      if (timed !== null && timed.tag === allocGen)
        autoStep(autoState, timed.ms, target, true);
    } else {
      autoStep(autoState, now0 - frameBefore, target, false);
    }
  }

  // Scene -> HDR target
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo.fb);
  gl.useProgram(progScene);

  /**
   * One spacetime into one viewport. Called once normally, twice in compare
   * mode (a = 0 into the left half, the slider's a into the right) — the
   * whole per-pixel march is per-side, so nothing about the geometry has to
   * be faked: each half is the renderer the lab has always been, aimed at a
   * different a. Splitting halves each viewport's width, so the two draws
   * cover the same pixel count as the single one and cost the same.
   *
   * Gas and the TDE are stateful (advected and integrated frame to frame at
   * one spin), so they cannot honestly appear on a side whose spin they were
   * not stepped in — compare mode turns them off on BOTH halves rather than
   * show one side matter the other cannot have.
   */
  const drawSide = (view: Rect, spin: number, ctx: SpinCtx) => {
    fillStars(spin);
    const tet = buildStaticTetrad(basis.pos, spin, basis.right, basis.up, basis.fwd);
    const matterOn = !params.compare;
    gl.viewport(view.x, view.y, view.w, view.h);
    gl.uniform2f(U(progScene, "uResolution"), view.w, view.h);
    gl.uniform2f(U(progScene, "uViewOrigin"), view.x, view.y);
    gl.uniform2f(U(progScene, "uJitter"), jitter[0], jitter[1]);
    gl.uniform1f(U(progScene, "uPixAng"), (2 * tanHalfFov) / view.h);
    gl.uniform3fv(U(progScene, "uCamPos"), basis.pos);
    gl.uniform3fv(U(progScene, "uCamRight"), basis.right);
    gl.uniform3fv(U(progScene, "uCamUp"), basis.up);
    gl.uniform3fv(U(progScene, "uCamFwd"), basis.fwd);
    gl.uniform1f(U(progScene, "uTanHalfFov"), tanHalfFov);
    gl.uniform1f(U(progScene, "uLensing"), params.lensing ? 1 : 0);
    gl.uniform1f(U(progScene, "uStarDensity"), params.starDensity);
    gl.uniform1f(U(progScene, "uSkyOn"), params.sky ? 1 : 0);
    gl.uniform1f(U(progScene, "uSimT"), simT);
    gl.uniform1f(U(progScene, "uDiskOn"), params.disk ? 1 : 0);
    gl.uniform1f(U(progScene, "uDoppler"), params.doppler ? 1 : 0);
    gl.uniform1f(U(progScene, "uDiskBright"), effBright);
    gl.uniform1f(U(progScene, "uDiskTempK"), effTempFor(ctx));
    gl.uniform1f(U(progScene, "uDiskOuter"), params.diskOuter);
    gl.uniform1f(U(progScene, "uStarsOn"), params.stars ? 1 : 0);
    gl.uniform1f(U(progScene, "uGasOn"), params.gas && matterOn ? 1 : 0);
    gl.uniform1f(U(progScene, "uJetsOn"), params.jets ? 1 : 0);
    gl.uniform1f(U(progScene, "uJetPower"), params.jetPower);
    gl.uniform1i(U(progScene, "uMaxSteps"), QUALITY[params.quality].maxSteps);
    gl.uniform1f(U(progScene, "uLadder"), params.eduLadder ? 1 : 0);
    gl.uniform1f(U(progScene, "uPolarization"), params.eduPolarization ? 1 : 0);
    gl.uniform1f(U(progScene, "uStepScale"), QUALITY[params.quality].stepScale);
    gl.uniform1f(U(progScene, "uSpin"), spin);
    gl.uniform1f(U(progScene, "uHorizon"), ctx.rHor);
    gl.uniform1f(U(progScene, "uIsco"), ctx.isco);
    gl.uniform1f(U(progScene, "uTNorm"), tempNorm(ctx.isco));
    gl.uniform4fv(U(progScene, "uTetT"), tet.uCov);
    gl.uniform4fv(U(progScene, "uTetR"), tet.rightCov);
    gl.uniform4fv(U(progScene, "uTetU"), tet.upCov);
    gl.uniform4fv(U(progScene, "uTetF"), tet.fwdCov);
    gl.uniform4fv(U(progScene, "uTetTv"), tet.u);
    gl.uniform4fv(U(progScene, "uTetRv"), tet.right);
    gl.uniform4fv(U(progScene, "uTetUv"), tet.up);
    gl.uniform4fv(U(progScene, "uTetFv"), tet.fwd);
    gl.uniform4fv(U(progScene, "uStarPos"), starPosArr);
    gl.uniform4fv(U(progScene, "uStarU"), starUArr);
    gl.uniform1fv(U(progScene, "uStarTemp"), starTempArr);
    gl.uniform4fv(U(progScene, "uGas"), gasArr);
    gl.uniform4fv(U(progScene, "uGasU"), gasUArr);
    gl.uniform4fv(U(progScene, "uGasArc"), gasArcArr);
    gl.uniform1i(U(progScene, "uTdeN"), matterOn ? tdeN : 0);
    gl.uniform4fv(U(progScene, "uTdePos"), tdePosArr);
    gl.uniform4fv(U(progScene, "uTdeU"), tdeUArr);
    gl.uniform4fv(U(progScene, "uTdeInfo"), tdeInfoArr);
    drawQuad();
  };

  if (!converged) {
    // Sample n > 1 is blended in at 1/n, which makes the target the running
    // mean of every sample so far. Sample 1 overwrites: a plain replace, and
    // not the blend at alpha 1, because the latter still multiplies whatever
    // the target held by zero, and a fresh texture or a NaN in it would poison
    // the mean rather than be discarded.
    if (accumN > 1) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, 1 / accumN);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    }
    gpuTimer.begin(adaptive ? allocGen : -1);
    if (params.compare) {
      // Neither viewport covers the gutter, so without this it would keep
      // whatever the last frame left there. Clears the whole target (clear is
      // bounded by the scissor box, not the viewport) before the two draws
      // overwrite everything either side of the gap. Only on a plain frame:
      // clearing would throw a refinement's running mean away, and the gutter
      // is already black from the plain frame the refinement started on.
      if (accumN === 1) {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      drawSide(split.left, COMPARE_SPIN_LEFT, spinCtxSchw);
    }
    drawSide(viewSlider, params.spin, spinCtx);
    gpuTimer.end();
    gl.disable(gl.BLEND);
  }

  // dev diagnostics (?dbg): scan render targets for NaN/Inf/negatives —
  // a single bad scene pixel smears black blocks through the bloom pyramid
  const dbgScan = location.search.includes("dbg") && frames === 0;
  const dbgReport = (label: string, f: Fbo) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    const buf = new Float32Array(f.w * f.h * 4);
    gl.readPixels(0, 0, f.w, f.h, gl.RGBA, gl.FLOAT, buf);
    let nan = 0, inf = 0, neg = 0, mx = 0;
    for (let k = 0; k < buf.length; k += 4) {
      for (let c = 0; c < 3; c++) {
        const v = buf[k + c];
        if (Number.isNaN(v)) nan++;
        else if (!Number.isFinite(v)) inf++;
        else if (v < 0) neg++;
        else if (v > mx) mx = v;
      }
    }
    console.log(`dbg ${label}: ${f.w}x${f.h} nan=${nan} inf=${inf} neg=${neg} max=${mx.toFixed(1)}`);
  };

  // Bright pass -> bloom level 0
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbos[0].fb);
  gl.viewport(0, 0, bloomFbos[0].w, bloomFbos[0].h);
  gl.useProgram(progBright);
  gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
  gl.uniform1i(U(progBright, "uTex"), 0);
  gl.uniform1f(U(progBright, "uThreshold"), params.threshold);
  drawQuad();

  // Downsample chain
  gl.useProgram(progDown);
  gl.uniform1i(U(progDown, "uTex"), 0);
  for (let i = 1; i < BLOOM_LEVELS; i++) {
    const src = bloomFbos[i - 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbos[i].fb);
    gl.viewport(0, 0, bloomFbos[i].w, bloomFbos[i].h);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(U(progDown, "uTexel"), 1 / src.w, 1 / src.h);
    drawQuad();
  }

  // Upsample chain, additive
  gl.useProgram(progUp);
  gl.uniform1i(U(progUp, "uTex"), 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
    const src = bloomFbos[i + 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbos[i].fb);
    gl.viewport(0, 0, bloomFbos[i].w, bloomFbos[i].h);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(U(progUp, "uTexel"), 1 / src.w, 1 / src.h);
    drawQuad();
  }
  gl.disable(gl.BLEND);

  // Composite -> canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(progComposite);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
  gl.uniform1i(U(progComposite, "uScene"), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, bloomFbos[0].tex);
  gl.uniform1i(U(progComposite, "uBloomTex"), 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex2!);
  gl.uniform1i(U(progComposite, "uPolTex"), 2);
  gl.uniform1f(U(progComposite, "uBloom"), params.bloom);
  gl.uniform1f(U(progComposite, "uExposure"), params.exposure);
  gl.uniform1f(U(progComposite, "uTicks"), params.eduPolarization ? 1 : 0);
  gl.uniform2f(U(progComposite, "uFrame"), canvas.width, canvas.height);
  gl.uniform2f(U(progComposite, "uSceneSize"), sceneFbo.w, sceneFbo.h);
  gl.uniform1f(U(progComposite, "uUpscale"), sceneFbo.w < canvas.width ? 1 : 0);
  gl.uniform1f(U(progComposite, "uTickPitch"), TICK_PITCH * (canvas.width / Math.max(canvas.clientWidth, 1)));
  // The ticks are drawn in device pixels over the whole frame, so compare
  // mode has to say where its divider is: a mark whose centre was traced on
  // one side must not reach across into the other spacetime.
  gl.uniform1f(
    U(progComposite, "uSplitX"),
    params.compare
      ? (COMPARE_X0 + compareW / 2) * (canvas.width / Math.max(canvas.clientWidth, 1))
      : -1
  );
  drawQuad();
  gl.activeTexture(gl.TEXTURE0);

  // HUD overlay (2D canvas above the GL frame; more overlays arrive in 6f–6g)
  clearHud(hudCtx, canvas.clientWidth, canvas.clientHeight);

  if (params.compare) {
    drawCompareDivider(
      hudCtx,
      COMPARE_X0,
      compareW,
      canvas.clientHeight,
      COMPARE_GUTTER,
      sideLabel(COMPARE_SPIN_LEFT),
      sideLabel(params.spin)
    );
  }

  // Drawn first: the insets below are opaque panels and should cover them.
  // A group's trails go away with its matter, so the overlay never shows a
  // path for something the frame behind it isn't drawing.
  if (params.eduTrails) {
    if (params.compare) {
      // 7d, and the reason the whole slice is worth drawing: the nodal
      // precession that keeps an inclined ring from closing is proportional to
      // a, so it is exactly zero on the left. The left ring closes on itself
      // and the right one walks — side by side, from one camera, at one mass.
      // Each half is projected at its OWN viewport's aspect and clipped to its
      // own strip, so neither can draw a path across the divider.
      trailGroupsSchw[0].on = params.stars;
      trailGroupsSlider[0].on = params.stars;
      drawTrails(hudCtx, trailGroupsSchw, basis, tanHalfFov,
        hudX(split.left), hudW(split.left), canvas.clientHeight, simT);
      drawTrails(hudCtx, trailGroupsSlider, basis, tanHalfFov,
        hudX(viewSlider), hudW(viewSlider), canvas.clientHeight, simT);
    } else {
      trailGroups[0].on = params.stars;
      trailGroups[1].on = params.gas;
      trailGroups[2].on = tde !== null;
      drawTrails(hudCtx, trailGroups, basis, tanHalfFov,
        0, canvas.clientWidth, canvas.clientHeight, simT);
    }
  }

  // ---- shadow outline (6f) + the callout layer (6f labels + 6g) ----
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  let nCallouts = 0;
  const emit = (
    key: CalloutKey,
    ax: number,
    ay: number,
    dx: number,
    dy: number,
    alpha: number
  ) => {
    if (nCallouts >= CALLOUT_MAX) return;
    const it = calloutItems[nCallouts++];
    it.key = key;
    it.ax = ax;
    it.ay = ay;
    it.dx = dx;
    it.dy = dy;
    it.alpha = alpha;
  };
  // ndc -> CSS px within one side's strip, the same map drawShadowOutline
  // strokes that side's outline with
  const sliderX0 = hudX(viewSlider);
  const sliderW = hudW(viewSlider);
  const ndcPxX = (x: number) => sliderX0 + ((x + 1) / 2) * sliderW;
  const ndcPxY = (y: number) => ((1 - y) / 2) * ch;

  // The Schwarzschild half's outline (7b), and its own ratio label with it.
  // The label was worth nothing while the copy quoted 2.6× at every spin —
  // two labels word-for-word alike, crowding the shape they sat on. Now that
  // the ratio is read per spin, the pair says 2.6× here against 4.3× across
  // the divider: the same contrast the circle and the D draw, as a number.
  if (outlineOn && params.compare && shadowSchw.edge && shadowSchw.edge.valid) {
    const schwX0 = hudX(split.left);
    const schwW = hudW(split.left);
    drawShadowOutline(hudCtx, shadowSchw.edge, schwX0, schwW, ch, 1);
    if (params.eduLadder && shadowSchw.gammas) {
      // Six identical readings of pi on this half, deliberately: the a = 0
      // side is the control, and watching the slider's numbers spread away
      // from a ring that stays uniform IS the comparison.
      drawRingGammaLabels(
        hudCtx,
        ringGammaLabels(shadowSchw.edge, shadowSchw.gammas, schwX0, schwW, ch, ringLabelsSchw),
        ringBoxesSchw
      );
    }

    // The two labels the outline has always carried are the shadow
    // checkbox's, not the ladder's — turning the ladder on brings the curve
    // and its exponents, and nothing else moves.
    if (shadowOn) {
      shadowExtremes(shadowSchw.edge, calloutExtSchw);
      const it = calloutItemsSchw[0];
      it.ax = schwX0 + ((calloutExtSchw.bottomX + 1) / 2) * schwW;
      it.ay = ((1 - calloutExtSchw.bottomY) / 2) * ch;
      it.dy = SHADOW_LABEL_DY;
      it.alpha = 1;
      // Laid out in the left strip, so it cannot slide across the divider and
      // caption the spin it is here to be the control for. Its own call rather
      // than an entry in the list below: that list is bounded to the slider's
      // strip, and the two are disjoint, so neither needs to know about the
      // other's blocks.
      drawCallouts(
        hudCtx,
        calloutItemsSchw,
        1,
        schwX0,
        schwW,
        calloutFloorY("left"),
        params.eduLadder ? ringBoxesSchw : []
      );
    }
  }

  const shadowEdge = shadowSlider.edge;
  // valid=false (camera not aimed at the hole — unreachable with the orbit
  // camera) degrades to drawing nothing.
  const edgeReady = outlineOn && shadowEdge !== null && shadowEdge.valid;
  const haveEdge = shadowOn && edgeReady;
  if (edgeReady) {
    drawShadowOutline(hudCtx, shadowEdge!, sliderX0, sliderW, ch, 1);
    shadowExtremes(shadowEdge!, calloutExt);
    if (params.eduLadder && shadowSlider.gammas) {
      drawRingGammaLabels(
        hudCtx,
        ringGammaLabels(shadowEdge!, shadowSlider.gammas, sliderX0, sliderW, ch, ringLabels),
        ringBoxes
      );
    }
  }
  if (haveEdge) {
    // Emitted first, so that with only the 6f overlay on they keep the exact
    // positions they had before 6g gave them neighbours to make room for.
    setShadowSpin(params.spin);
    if (params.compare) {
      // Below the disk, not off its left edge — see SHADOW_LABEL_DY. The a = 0
      // half's twin is emitted above, into its own strip.
      emit(
        "shadow",
        ndcPxX(calloutExt.bottomX),
        ndcPxY(calloutExt.bottomY),
        0,
        SHADOW_LABEL_DY,
        1
      );
    } else {
      emit("shadow", ndcPxX(calloutExt.leftX), ndcPxY(calloutExt.leftY), -30, 46, 1);
    }
    // The photon ring converges onto the shadow edge from OUTSIDE (its last
    // subring IS the boundary), so its anchor sits just off the outline.
    emit(
      "photonRing",
      ndcPxX(calloutExt.topX),
      ndcPxY(calloutExt.topY) - 5,
      48,
      -46,
      1
    );
  }

  if (params.eduCallouts && !params.compare) {
    // Which way round the disk's beaming runs, from the same prograde
    // convention the scene shader's disk shift is built on.
    const azRight = Math.atan2(basis.right[2], basis.right[0]);
    const azApproach =
      approachingSign(basis.pos, basis.right, params.spin) > 0
        ? azRight
        : azRight + Math.PI;
    const projEq = (r: number, az: number) =>
      projectToScreen(
        equatorialPoint(r, az, params.spin, calloutQ),
        basis,
        tanHalfFov,
        cw,
        ch,
        calloutProj
      );
    // labels lean away from the busy middle of the frame
    const outward = (x: number) => (x < cw / 2 ? -46 : 46);

    if (params.disk) {
      // projEq hands back the one shared Projected, so read it out before the
      // next call overwrites it
      const app = projEq(DOPPLER_R, azApproach);
      const appX = app.x;
      const appY = app.y;
      const appVis = app.visible;
      if (params.doppler) {
        if (appVis) emit("approaching", appX, appY, outward(appX), -40, 1);
        const rec = projEq(DOPPLER_R, azApproach + Math.PI);
        if (rec.visible) emit("receding", rec.x, rec.y, outward(rec.x), -40, 1);
      } else if (appVis) {
        // With Doppler off the two sides are identical, so one label about the
        // missing asymmetry replaces the pair naming it.
        emit("hollywood", appX, appY, outward(appX), -40, 1);
      }
    }

    if (params.disk && haveEdge && Math.abs(camera.pitch) < DOUBLED_MAX_PITCH) {
      emit(
        "doubledTop",
        ndcPxX(calloutExt.topX * DOUBLED_NDC_SCALE),
        ndcPxY(calloutExt.topY * DOUBLED_NDC_SCALE),
        44,
        -34,
        1
      );
      emit(
        "doubledBottom",
        ndcPxX(calloutExt.bottomX * DOUBLED_NDC_SCALE),
        ndcPxY(calloutExt.bottomY * DOUBLED_NDC_SCALE),
        44,
        34,
        1
      );
    }

    if (params.jets) {
      // The jet streaming toward the camera is the one on the camera's own
      // side of the disk plane; since the camera always looks at the origin,
      // that is also the one that projects nearer.
      const nearY = basis.pos[1] >= 0 ? JET_MARK_Y : -JET_MARK_Y;
      calloutQ[0] = 0;
      calloutQ[2] = 0;
      calloutQ[1] = nearY;
      const near = projectToScreen(calloutQ, basis, tanHalfFov, cw, ch, calloutProj);
      const nearX = near.x;
      const nearYPx = near.y;
      const nearVis = near.visible;
      calloutQ[1] = -nearY;
      const far = projectToScreen(calloutQ, basis, tanHalfFov, cw, ch, calloutProj);
      if (params.doppler) {
        if (nearVis) emit("jet", nearX, nearYPx, 54, 0, 1);
        if (far.visible) emit("counterJet", far.x, far.y, 54, 0, 1);
      } else if (nearVis) {
        // Doppler off takes the jet's beaming with it (the shader gates both
        // on uDoppler), so the twins are identical and only one gets named.
        emit("jetSymmetric", nearX, nearYPx, 54, 0, 1);
      }
    }

    if (params.disk) {
      // marked on the approaching side, the one beamed toward you
      const p = projEq(spinCtx.isco, azApproach);
      if (p.visible) emit("isco", p.x, p.y, outward(p.x), 54, 1);
    }

    if (params.stars && haveEdge) {
      for (let i = 0; i < STAR_COUNT; i++) {
        calloutQ[0] = starPosArr[i * 4];
        calloutQ[1] = starPosArr[i * 4 + 1];
        calloutQ[2] = starPosArr[i * 4 + 2];
        alignmentAngle(basis.pos, calloutQ, calloutAlign);
        if (calloutAlign.behind && calloutAlign.angle < EINSTEIN_ANGLE) {
          // the ring wraps the shadow, so shout from its right edge
          emit(
            "einstein",
            ndcPxX(calloutExt.rightX),
            ndcPxY(calloutExt.rightY),
            44,
            -50,
            1
          );
          break; // one ring at a time is enough
        }
      }
    }
  }

  // Every callout emitted above describes the slider's spacetime, so they are
  // laid out within that side's strip — the whole canvas in single view, the
  // right half when comparing. Without the bound the layout would happily
  // slide a label across the divider onto the a = 0 half, which it does not
  // describe.
  if (nCallouts > 0)
    drawCallouts(
      hudCtx,
      calloutItems,
      nCallouts,
      sliderX0,
      sliderW,
      calloutFloorY(params.compare ? "right" : null),
      params.eduLadder ? ringBoxes : []
    );

  // Also single-spin: every rate below is evaluated at params.spin, which is
  // only the right half's story.
  if (params.eduClocks && !params.compare) {
    clockEntries[0].tau = simT;
    clockEntries[1].tau = tauCam;
    clockEntries[1].rate = staticRate(basis.pos, params.spin);
    clockEntries[2].tau = tauIsco;
    clockEntries[2].rate = circRate(spinCtx.isco, params.spin);
    let nClocks = 3;
    const star = tde ? tde.bodies[0] : null;
    if (star) {
      // In Kerr–Schild u^t stays finite through the horizon, so the star's
      // own clock keeps ticking across it — only the far-away observer sees
      // it freeze. It stops here only when the body is culled from the sim.
      clockEntries[3].tau = tauStar;
      clockEntries[3].gone = !star.alive;
      clockEntries[3].rate = star.alive ? 1 / bodyU(star, params.spin)[0] : 0;
      nClocks = 4;
    }
    drawClocks(hudCtx, clockEntries, nClocks, canvas.clientWidth - 12, 12);
  }

  const iv = viewNow();

  // The ladder view's legend (slice 9): one per strip, since the gammas it
  // quotes are per spin. Under the clock row when that is up, which it can
  // only be in single view.
  const legendTop = params.eduClocks && !params.compare ? CLOCKS_BLOCK_H : 0;
  if (params.eduLadder) {
    if (params.compare) {
      const l = legendBox(iv, "left", 0);
      drawLadderLegend(hudCtx, l.x, l.y, COMPARE_SPIN_LEFT, drawnGammas(shadowSchw));
      const r = legendBox(iv, "right", 0);
      drawLadderLegend(hudCtx, r.x, r.y, params.spin, drawnGammas(shadowSlider));
    } else {
      const b = legendBox(iv, null, legendTop);
      drawLadderLegend(hudCtx, b.x, b.y, params.spin, drawnGammas(shadowSlider));
    }
  }

  // Slice 10's legend stacks under the ladder's in the same column. One copy
  // even while comparing, unlike the ladder's: what it explains is the tick
  // scale, which is the same on both halves — only the drawn field differs,
  // and that is the thing the two sides are there to be compared on.
  if (params.eduPolarization) {
    const b = polLegendBox(
      iv,
      params.compare ? "right" : null,
      params.compare ? 0 : legendTop,
      params.eduLadder
    );
    drawPolarizationLegend(hudCtx, b.x, b.y);
  }

  if (iv.shown.pot) {
    // The TDE is stateful and compare mode draws it on neither half, so its
    // marks go with it: a dot riding a curve for a spacetime it was never
    // stepped in is exactly the kind of borrowed matter the mode refuses.
    let nMark = 0;
    if (!params.compare) {
      // E = -m_t is the conserved energy the geodesic integrator carries, so
      // the dots are exact — they can only slide along r.
      nMark = Math.min(tdeBodies.length, POT_MARK_MAX);
      for (let i = 0; i < nMark; i++) {
        potMarkR[i] = ksRadius(tdeBodies[i].p, params.spin);
        potMarkE[i] = -tdeBodies[i].mt;
      }
    }
    // One curve per side, each captioning the spacetime drawn behind it (7c).
    // The axis window is a fixed constant, so the two panels are directly
    // comparable by eye — no per-side rescaling can forge a difference the
    // spin did not make, which is the same bargain the equal-width split makes.
    for (const side of insetSides(iv.compare)) {
      const sctx = sideCtx(side);
      const box = insetBox(iv, "pot", side);
      drawPotential(
        hudCtx,
        box.x,
        box.y,
        {
          a: sideSpin(side),
          L: params.eduL, // one L across both: only a differs, so only a can move the curve
          rHor: sctx.rHor,
          isco: sctx.isco,
          markR: potMarkR,
          markE: potMarkE,
          markN: nMark,
        },
        params.potScale
      );
      const spec = INSET_SPEC.pot;
      drawResizeGrip(
        hudCtx,
        box.gx,
        box.gy,
        spec.inX,
        spec.inY,
        sameGrip(gripHot, "pot", side)
      );
    }
  }

  if (iv.shown.embed) {
    // One funnel per side (7c). Two of these cannot be overlaid into a single
    // panel the way two V_eff curves could — a wireframe surface drawn twice
    // over itself is a mesh nobody can read — so per-side is what carries both
    // spins here, and the potential inset follows it rather than splitting the
    // two overlays' conventions.
    for (const side of insetSides(iv.compare)) {
      const a = sideSpin(side);
      const sctx = sideCtx(side);
      // Only bodies the renderer is actually showing get a dot, so the funnel
      // never disagrees with the frame behind it — and while comparing, that
      // rule cuts differently per group. The stars are drawn on both halves
      // (starState is closed-form in (t, a)), so they are refilled at this
      // side's spin, reusing the same scratch the scene pass refills between
      // its own two draws; gas and TDE debris are stateful, drawn on neither
      // half, and so get no dots on either.
      if (params.compare) fillStars(a);
      let nDots = 0;
      const push = (r: number, az: number, group: number) => {
        if (nDots >= EMBED_DOT_MAX) return;
        embedDotR[nDots] = r;
        embedDotAz[nDots] = az;
        embedDotGroup[nDots] = group;
        nDots++;
      };
      if (params.stars) {
        for (let i = 0; i < STAR_COUNT; i++) {
          // the funnel is indexed by BL radius, not the world distance
          embedScratch[0] = starPosArr[i * 4];
          embedScratch[1] = starPosArr[i * 4 + 1];
          embedScratch[2] = starPosArr[i * 4 + 2];
          push(ksRadius(embedScratch, a), Math.atan2(embedScratch[2], embedScratch[0]), EMBED_STARS);
        }
      }
      if (!params.compare) {
        if (params.gas) {
          for (const b of gasBlobs) push(b.r, b.az, EMBED_GAS);
        }
        for (const b of tdeBodies) {
          push(ksRadius(b.p, params.spin), Math.atan2(b.p[2], b.p[0]), EMBED_TDE);
        }
      }
      const box = insetBox(iv, "embed", side);
      drawEmbedding(
        hudCtx,
        box.x,
        box.y,
        {
          profile: embeddingFor(a, params.diskOuter),
          isco: sctx.isco,
          yaw: camera.yaw,
          dotR: embedDotR,
          dotAz: embedDotAz,
          dotGroup: embedDotGroup,
          dotN: nDots,
        },
        params.embedScale
      );
      const spec = INSET_SPEC.embed;
      drawResizeGrip(
        hudCtx,
        box.gx,
        box.gy,
        spec.inX,
        spec.inY,
        sameGrip(gripHot, "embed", side)
      );
    }
  }

  if (dbgScan) {
    dbgReport("scene", sceneFbo);
    bloomFbos.forEach((f, i) => dbgReport(`bloom${i}`, f));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // dev hook: __wantShot captures the canvas synchronously before the
  // drawing buffer is cleared (headless screenshots miss slow WebGL frames)
  const w = window as unknown as {
    __wantShot?: boolean;
    __shot?: string;
    __shotHud?: string;
    __layout?: unknown;
    __frames?: number;
    __sceneMs?: number;
    __sceneMsRaw?: number;
    __sceneMsTag?: number;
    __sceneMsN?: number;
    __sceneScale?: number;
  };
  // dev hook: the GPU's latest reading of the scene pass and the scale in
  // force, so a harness can watch the auto preset settle instead of reading
  // the readout's half-second samples of it
  w.__sceneMs = sceneMs;
  // dev hook: the same readings unsmoothed, with the target generation they
  // measured and a count to deduplicate on (see rawMs)
  w.__sceneMsRaw = rawMs;
  w.__sceneMsTag = rawTag;
  w.__sceneMsN = rawN;
  w.__sceneScale = sceneFbo.w / Math.max(1, Math.floor(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, MAX_DPR)));
  // dev hook: a monotonic count of frames actually DRAWN, so a headless
  // harness can wait for the renderer instead of for the clock — under
  // software GL a frame costs seconds, and any fixed millisecond wait is then
  // either a stall on a GPU or a timeout without one. Deliberately not the
  // `frames` counter above, which is zeroed twice a second for the fps readout.
  w.__frames = (w.__frames ?? 0) + 1;
  if (w.__wantShot) {
    w.__wantShot = false;
    w.__shot = canvas.toDataURL("image/png");
    // The HUD is taken in the same frame as the scene, not read live from
    // outside: it is cleared and redrawn every frame, so a reader that grabbed
    // it afterwards would pair overlays with a scene from an earlier one, and
    // any measurement across the two would be reading the time between them.
    w.__shotHud = hudCtx.canvas.toDataURL("image/png");
    // Published with the shot rather than re-derived outside: COMPARE_X0 is
    // measured from the panel's rect at runtime and the quality scale between
    // CSS and target px is local to this module, so anything reading these
    // numbers from a distance would be copying two things that move.
    w.__layout = {
      compare: params.compare,
      gl: { w: canvas.width, h: canvas.height },
      hud: { w: hudCtx.canvas.width, h: hudCtx.canvas.height },
      css: { w: canvas.clientWidth, h: canvas.clientHeight },
      // The target the march ran on, which since slice 19 is the canvas's size
      // only at scale 1; the split below is in ITS pixels.
      scene: { w: sceneFbo.w, h: sceneFbo.h },
      // How many jittered frames this one averages: 1 is a plain frame.
      samples: accumN,
      split, // scene-target px, x/w only — y is gl.viewport's, which the HUD flips
      // What a ray needs to be re-launched outside the page: the camera the
      // frame was drawn with and the spin it was drawn at. Published rather
      // than reconstructed, so a check that recomputes a pixel on the CPU is
      // aiming at the same view the GPU marched and not a near miss.
      cam: {
        pos: [...basis.pos],
        right: [...basis.right],
        up: [...basis.up],
        fwd: [...basis.fwd],
        tanHalfFov,
        spin: params.spin,
        isco: spinCtx.isco,
        diskOuter: params.diskOuter,
      },
    };
  }

  if (firstFrame) {
    firstFrame = false;
    overlay.style.display = "none";
  }

  // readouts — written only when the text changes: replacing a text node
  // every frame invalidates the panel's layout every frame, for a string that
  // is usually the same one
  setText(
    distReadout,
    `r = ${camera.dist.toFixed(1)} M   r+ = ${spinCtx.rHor.toFixed(2)} M   ` +
      `ISCO ${spinCtx.isco.toFixed(2)} M   t = ${simT.toFixed(0)} M`
  );
  setText(
    physReadout,
    `r+ = ${fmtSci(spinCtx.rHor * lengthKm(massMsun))} km   ` +
      `1 M of time = ${fmtSci(timeSec(massMsun))} s   ` +
      `T peak ${fmtSci(effTempK)} K (${bandLabel(effTempK)})`
  );
  const hills = hillsMassMsun(spinCtx.rHor);
  let tdeText =
    `sun-like star: r_t = ${tidalRadiusM(massMsun).toFixed(1)} M   ` +
    `Hills mass ${fmtSci(hills)} M☉`;
  if (params.compare && tde) {
    // Don't narrate a flare the frame is neither drawing nor lit by.
    tdeText = `TDE hidden while comparing — debris is stepped at one spin`;
  } else if (tde) {
    if (tde.phase === "infall") {
      tdeText = `star infalling: r = ${ksRadius(tde.bodies[0].p, params.spin).toFixed(1)} M, r_t = ${tde.rt.toFixed(1)} M`;
    } else if (tde.phase === "swallowed") {
      tdeText = `swallowed whole — r_t inside the horizon, no flare (M > Hills mass)`;
    } else {
      tdeText =
        `disrupted at r_t = ${tde.rt.toFixed(1)} M — ` +
        (mdotTot > 1.5 * mdotBase
          ? `flare ${(mdotTot / mdotBase).toFixed(1)}× (${fmtSci(mdotTot)} Edd, decaying t^-5/3)`
          : `debris stream spreading, flare peak in ${Math.max(0, tde.tDisrupt! + FALLBACK_T0 - simT).toFixed(0)} M`);
    }
  }
  setText(tdeReadout, tdeText);
  frames++;
  const now = performance.now();
  if (now - fpsT0 > 500) {
    // What the frame is costing and at what size, beside the rate: the rate
    // alone sits on the display's ceiling on any machine with headroom and
    // says nothing about how much of it there is. The sample count shows the
    // refinement working, and "converged" that the march has stopped.
    let text = `${((frames * 1000) / (now - fpsT0)).toFixed(0)} fps`;
    if (accumN >= ACCUM_MAX) text += ` · still, converged (${ACCUM_MAX} samples)`;
    else {
      if (Number.isFinite(sceneMs)) text += ` · scene ${sceneMs.toFixed(1)} ms`;
      text += ` · ${sceneFbo.w}×${sceneFbo.h}`;
      if (accumN > 1) text += ` · refining ${accumN}/${ACCUM_MAX}`;
    }
    setText(fpsReadout, text);
    frames = 0;
    fpsT0 = now;
  }

  requestAnimationFrame(render);
}

// ---------- boot ----------
// The geodesics are now integrated per pixel on the GPU (no CPU bake);
// the overlay covers shader compilation, hidden after the first frame.
overlayText.textContent = "Compiling geodesic integrator…";
resize();
requestAnimationFrame(render);
