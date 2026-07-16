import { buildStaticTetrad, ksRadius, type V3 } from "./kerr";
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
import { compileProgram, createFbo, destroyFbo, type Fbo } from "./gl";
import {
  EMBED_GAS,
  EMBED_H,
  EMBED_STARS,
  EMBED_TDE,
  EMBED_W,
  GRIP_SIZE,
  INSET_SCALE_MAX,
  INSET_SCALE_MIN,
  POTENTIAL_H,
  POTENTIAL_W,
  clearHud,
  drawCallouts,
  drawClocks,
  drawEmbedding,
  drawPotential,
  drawResizeGrip,
  drawShadowOutline,
  drawTrails,
  initHud,
  resizeHud,
  type CalloutItem,
  type CalloutKey,
  type ClockEntry,
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
  findShadowEdgeIncremental,
  projectToScreen,
  shadowExtremes,
  staticRate,
  type Alignment,
  type EmbeddingProfile,
  type Projected,
  type ShadowEdge,
  type ShadowExtremes,
} from "./edu";
import { cameraBasis, attachControls, type CameraState } from "./camera";
import { VS_QUAD, FS_SCENE, FS_BRIGHT, FS_DOWN, FS_UP, FS_COMPOSITE } from "./shaders";
import {
  GAS_COUNT,
  STAR_COUNT,
  STAR_ORBITS,
  type GasBlob,
  gasPosXZ,
  gasU,
  makeSpinCtx,
  mulberry32,
  spawnGasBlob,
  starState,
  stepGasBlob,
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
type Quality = "low" | "medium" | "high";
const QUALITY: Record<Quality, { scale: number; maxSteps: number; stepScale: number }> = {
  low: { scale: 0.5, maxSteps: 160, stepScale: 1.6 },
  medium: { scale: 0.72, maxSteps: 320, stepScale: 1.0 },
  high: { scale: 1.0, maxSteps: 320, stepScale: 1.0 },
};

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

const U = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

// ---------- framebuffers ----------
let sceneFbo: Fbo | null = null;
let bloomFbos: Fbo[] = [];

function allocateTargets(w: number, h: number) {
  if (sceneFbo) destroyFbo(gl, sceneFbo);
  bloomFbos.forEach((f) => destroyFbo(gl, f));
  sceneFbo = createFbo(gl, w, h, hdr);
  bloomFbos = [];
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    const s = 2 << i; // 2, 4, 8, 16, 32
    bloomFbos.push(createFbo(gl, Math.max(1, Math.floor(w / s)), Math.max(1, Math.floor(h / s)), hdr));
  }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  // The render scale applies to the GL target only; CSS stretches it back to
  // full size. The HUD is its own canvas and keeps the true DPR, so overlay
  // text stays sharp even when the scene behind it is rendered at half res.
  const glScale = dpr * QUALITY[params.quality].scale;
  const w = Math.floor(canvas.clientWidth * glScale);
  const h = Math.floor(canvas.clientHeight * glScale);
  if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
    canvas.width = w;
    canvas.height = h;
    allocateTargets(w, h);
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
  fpsLimit: FPS_UNLIMITED, // redraw cap; FPS_UNLIMITED = don't limit
  // Learn overlays (slice 6) — bound in 6a, consumed by later sub-slices
  eduCallouts: false,
  eduShadow: false,
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
// The HUD canvas is pointer-events:none so that camera drags pass straight
// through it to #view — which also means the insets' own grips never receive a
// pointer event. So the hit-testing lives here, on the GL canvas, and claims
// the pointerdown before the camera turns it into an orbit drag.

const INSET_MARGIN = 12;
/** Left edge of the potential inset: clear of the opaque #panel column. */
const POT_X = 280;
/** Grab forgiveness outside the grip's corner, in CSS px. */
const GRIP_HALO = 5;

type InsetId = "pot" | "embed";
interface InsetSpec {
  /** Size at scale 1. */
  W: number;
  H: number;
  /** Signs pointing from the grip corner into the panel body. Both insets are
   *  bottom-anchored and grip the top corner facing the middle of the screen,
   *  so both grow up-and-inward. */
  inX: number;
  inY: number;
  cursor: string;
}
const INSET_SPEC: Record<InsetId, InsetSpec> = {
  pot: { W: POTENTIAL_W, H: POTENTIAL_H, inX: -1, inY: 1, cursor: "nesw-resize" },
  embed: { W: EMBED_W, H: EMBED_H, inX: 1, inY: 1, cursor: "nwse-resize" },
};

const insetScale = (id: InsetId) => (id === "pot" ? params.potScale : params.embedScale);

/** Top-left of an inset and the corner its grip sits on, in CSS px. */
function insetBox(id: InsetId): { x: number; y: number; gx: number; gy: number } {
  const s = INSET_SPEC[id];
  const w = s.W * insetScale(id);
  const h = s.H * insetScale(id);
  const x = id === "pot" ? POT_X : canvas.clientWidth - w - INSET_MARGIN;
  const y = canvas.clientHeight - h - INSET_MARGIN;
  return { x, y, gx: id === "pot" ? x + w : x, gy: y };
}

function insetShown(id: InsetId): boolean {
  return id === "pot" ? params.eduPotential : params.eduEmbed;
}

/** Which grip is under (px, py), if any. Embedding first: it is drawn last. */
function gripUnder(px: number, py: number): InsetId | null {
  for (const id of ["embed", "pot"] as InsetId[]) {
    if (!insetShown(id)) continue;
    const b = insetBox(id);
    const s = INSET_SPEC[id];
    const dx = (px - b.gx) * s.inX;
    const dy = (py - b.gy) * s.inY;
    if (dx >= -GRIP_HALO && dx <= GRIP_SIZE && dy >= -GRIP_HALO && dy <= GRIP_SIZE) {
      return id;
    }
  }
  return null;
}

let insetDrag: { id: InsetId; startScale: number; x0: number; y0: number } | null = null;
let gripHot: InsetId | null = null;

function insetClaim(e: PointerEvent): boolean {
  const id = gripUnder(e.clientX, e.clientY);
  if (!id) return false;
  insetDrag = { id, startScale: insetScale(id), x0: e.clientX, y0: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  return true;
}

canvas.addEventListener("pointermove", (e) => {
  if (!insetDrag) {
    gripHot = gripUnder(e.clientX, e.clientY);
    canvas.style.cursor = gripHot ? INSET_SPEC[gripHot].cursor : "";
    return;
  }
  const s = INSET_SPEC[insetDrag.id];
  // Away from the panel body along both axes grows it; average the two so the
  // aspect stays locked and the grip tracks the cursor's diagonal.
  const ds =
    0.5 *
    ((-s.inX * (e.clientX - insetDrag.x0)) / s.W +
      (-s.inY * (e.clientY - insetDrag.y0)) / s.H);
  const v = Math.min(INSET_SCALE_MAX, Math.max(INSET_SCALE_MIN, insetDrag.startScale + ds));
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
let embedProfile: EmbeddingProfile | null = null;
let embedA = NaN;
let embedRMax = NaN;
function embeddingFor(a: number, rMax: number): EmbeddingProfile {
  if (!embedProfile || a !== embedA || rMax !== embedRMax) {
    embedProfile = embeddingProfile(a, rMax, 400);
    embedA = a;
    embedRMax = rMax;
  }
  return embedProfile;
}

// Orbit trails (6e). Filled every frame whether or not the overlay is on — a
// few comparisons per body, and the history is already there the moment the
// user ticks the box. Declared above the bindSlider block below: binding the
// spin slider runs its callback immediately, and that callback clears these.
const starTrails: Trail[] = [];
for (let i = 0; i < STAR_COUNT; i++) starTrails.push(new Trail(TRAIL_CAP_STAR));
const gasTrails: Trail[] = [];
for (let i = 0; i < GAS_COUNT; i++) gasTrails.push(new Trail(TRAIL_CAP_GAS));
const tdeTrails: Trail[] = [];
for (let i = 0; i < TDE_MAX; i++) tdeTrails.push(new Trail(TRAIL_CAP_TDE));
const trailGroups: TrailGroup[] = [
  { trails: starTrails, group: EMBED_STARS, on: true },
  { trails: gasTrails, group: EMBED_GAS, on: true },
  { trails: tdeTrails, group: EMBED_TDE, on: true },
];
const trailScratch: V3 = [0, 0, 0];

// Shadow & photon-ring outline (6f). One outline is ~1000 CPU geodesic traces
// — tens of milliseconds, never affordable inside a frame. So it recomputes
// only when (spin, view, lens, aspect) changes, only once the camera has been
// still for the debounce window, and even then a few azimuths per frame; the
// previous outline stays up, faded, until the new one lands.
let shadowEdge: ShadowEdge | null = null;
let shadowGen: Generator<number, ShadowEdge> | null = null;
/** True while shadowEdge is the outline OF the current view (not mid-drag). */
let shadowFresh = false;
let shadowDeadline = 0; // performance.now() before which no recompute may start
let shadowSpin = NaN;
let shadowYaw = NaN;
let shadowPitch = NaN;
let shadowDist = NaN;
let shadowFov = NaN;
let shadowAspect = NaN;
const SHADOW_DEBOUNCE_MS = 250;
/**
 * Per-frame tracing budget. The generator yields per geodesic trace, because
 * that is the atomic unit of work: a near-critical ray at a = 0.998 can wind
 * thousands of RK4 steps (milliseconds by itself), so any fixed count of
 * azimuths — or even of traces — per frame would blow the HUD's ~3 ms rule
 * exactly where the outline is most interesting. A full outline is ~66 ms of
 * tracing at a = 0 and ~540 ms at a = 0.998, spread across frames.
 *
 * The budget scales with the measured frame interval (floor 3 ms, cap 30 ms):
 * at 60 fps that is the strict 3 ms rule, while on a machine already crawling
 * at software-rendering speeds a fixed 3 ms would stretch one outline over
 * minutes of wall time — there, a slice that is still ≤ ~6% of the frame it
 * rides on hitches nothing and finishes in seconds.
 */
const SHADOW_MS_FLOOR = 3;
const SHADOW_MS_CAP = 30;
const SHADOW_FRAME_FRACTION = 0.15;

// Callout mode (6g). Every anchor here is a straight-line projection of where
// a thing IS; the lensed image the label names sits near it, not on it (the
// checkbox tooltip and the ISCO copy both say so). All of it is cheap math
// recomputed per frame, except the shadow-derived anchors, which ride 6f's
// debounced outline and fade with it while it is stale.
const CALLOUT_MAX = 10;
const calloutItems: CalloutItem[] = [];
for (let i = 0; i < CALLOUT_MAX; i++)
  calloutItems.push({ key: "shadow", ax: 0, ay: 0, dx: 0, dy: 0, alpha: 1 });
const calloutExt: ShadowExtremes = {
  leftX: 0, leftY: 0, rightX: 0, rightY: 0, topX: 0, topY: 0, bottomX: 0, bottomY: 0,
};
const calloutProj: Projected = { x: 0, y: 0, z: 0, visible: false };
const calloutAlign: Alignment = { angle: 0, behind: false };
const calloutQ: V3 = [0, 0, 0];
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
bindCheckbox("edu-callouts", (v) => (params.eduCallouts = v));
bindCheckbox("edu-shadow", (v) => (params.eduShadow = v));
bindCheckbox("edu-trails", (v) => (params.eduTrails = v));
bindCheckbox("edu-clocks", (v) => (params.eduClocks = v));
bindCheckbox("edu-potential", (v) => (params.eduPotential = v));
bindCheckbox("edu-embed", (v) => (params.eduEmbed = v));

bindNumField("fpslimit", (v) => (params.fpsLimit = v));
// No reallocation needed here: resize() runs at the top of every frame and
// picks the new render scale up on its own.
const qualitySel = document.getElementById("quality") as HTMLSelectElement;
const applyQuality = () => (params.quality = qualitySel.value as Quality);
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

  // advance simulation time and the gas blobs
  const now0 = performance.now();
  const dtReal = Math.min((now0 - lastFrameT) * 0.001, 0.1);
  lastFrameT = now0;
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
  const flare =
    tde && tde.tDisrupt !== null
      ? flareMdotEdd(simT - tde.tDisrupt, FALLBACK_T0, flarePeakEdd(massMsun))
      : 0;
  const mdotTot = mdotBase + flare;
  // T ∝ mdot^(1/4) M^(-1/4) (isco)^(-3/4); luminosity ∝ mdot (display-capped)
  const effTempK = params.coupleT
    ? peakTempK(massMsun, mdotTot, spinCtx.isco)
    : params.diskTempK;
  // flare brightness is sqrt-compressed for display (the true bolometric
  // jump is ~mdot and would clip the whole frame to white); the readout
  // reports the physical ratio
  const effBright = params.diskBright * Math.min(Math.sqrt(mdotTot / mdotBase), 8);

  // star + gas uniforms for this frame (positions plus exact 4-velocities)
  for (let i = 0; i < STAR_COUNT; i++) {
    const s = starState(STAR_ORBITS[i], simT, params.spin);
    starPosArr.set(s.pos, i * 4);
    starPosArr[i * 4 + 3] = STAR_ORBITS[i].radius;
    starUArr.set(s.u, i * 4);
    starTempArr[i] = STAR_ORBITS[i].tempK;
    if (stepped) starTrails[i].push(s.pos, simT);
  }
  for (let i = 0; i < GAS_COUNT; i++) {
    const b = gasBlobs[i];
    const [gx, gz] = gasPosXZ(b, spinCtx);
    gasArr[i * 4] = gx;
    gasArr[i * 4 + 1] = gz;
    gasArr[i * 4 + 2] = b.size;
    gasArr[i * 4 + 3] = b.bright;
    gasUArr.set(gasU(b, spinCtx), i * 4);
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

  // static-observer tetrad at the camera (covariant legs for the shader)
  const tet = buildStaticTetrad(basis.pos, params.spin, basis.right, basis.up, basis.fwd);

  // 6f shadow outline: debounced, then traced a few azimuths per frame so the
  // GL loop never waits on it. Callout mode (6g) shares the computed edge.
  const shadowOn = params.eduShadow || params.eduCallouts;
  if (shadowOn) {
    const aspect = canvas.clientWidth / canvas.clientHeight;
    if (
      params.spin !== shadowSpin ||
      camera.yaw !== shadowYaw ||
      camera.pitch !== shadowPitch ||
      camera.dist !== shadowDist ||
      camera.fovDeg !== shadowFov ||
      aspect !== shadowAspect
    ) {
      shadowSpin = params.spin;
      shadowYaw = camera.yaw;
      shadowPitch = camera.pitch;
      shadowDist = camera.dist;
      shadowFov = camera.fovDeg;
      shadowAspect = aspect;
      shadowGen = null; // any in-flight outline belongs to a stale view
      shadowFresh = false;
      // a drag changes the view every frame, pushing the deadline ahead of
      // itself — tracing starts once the camera has been still this long
      shadowDeadline = now0 + SHADOW_DEBOUNCE_MS;
    }
    if (!shadowGen && !shadowFresh && now0 >= shadowDeadline) {
      shadowGen = findShadowEdgeIncremental(basis.pos, tet, params.spin, tanHalfFov, aspect);
    }
    if (shadowGen) {
      const budget = Math.min(
        Math.max(dtReal * 1000 * SHADOW_FRAME_FRACTION, SHADOW_MS_FLOOR),
        SHADOW_MS_CAP
      );
      // at least one trace per frame so even a very slow machine progresses
      const t0 = performance.now();
      for (;;) {
        const step = shadowGen.next();
        if (step.done) {
          shadowEdge = step.value;
          shadowGen = null;
          shadowFresh = true;
          break;
        }
        if (performance.now() - t0 >= budget) break;
      }
    }
  }

  // Scene -> HDR target
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo.fb);
  gl.viewport(0, 0, sceneFbo.w, sceneFbo.h);
  gl.useProgram(progScene);
  gl.uniform2f(U(progScene, "uResolution"), sceneFbo.w, sceneFbo.h);
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
  gl.uniform1f(U(progScene, "uDiskTempK"), effTempK);
  gl.uniform1f(U(progScene, "uDiskOuter"), params.diskOuter);
  gl.uniform1f(U(progScene, "uStarsOn"), params.stars ? 1 : 0);
  gl.uniform1f(U(progScene, "uGasOn"), params.gas ? 1 : 0);
  gl.uniform1f(U(progScene, "uJetsOn"), params.jets ? 1 : 0);
  gl.uniform1f(U(progScene, "uJetPower"), params.jetPower);
  gl.uniform1i(U(progScene, "uMaxSteps"), QUALITY[params.quality].maxSteps);
  gl.uniform1f(U(progScene, "uStepScale"), QUALITY[params.quality].stepScale);
  gl.uniform1f(U(progScene, "uSpin"), params.spin);
  gl.uniform1f(U(progScene, "uHorizon"), spinCtx.rHor);
  gl.uniform1f(U(progScene, "uIsco"), spinCtx.isco);
  gl.uniform1f(U(progScene, "uTNorm"), tempNorm(spinCtx.isco));
  gl.uniform4fv(U(progScene, "uTetT"), tet.uCov);
  gl.uniform4fv(U(progScene, "uTetR"), tet.rightCov);
  gl.uniform4fv(U(progScene, "uTetU"), tet.upCov);
  gl.uniform4fv(U(progScene, "uTetF"), tet.fwdCov);
  gl.uniform4fv(U(progScene, "uStarPos"), starPosArr);
  gl.uniform4fv(U(progScene, "uStarU"), starUArr);
  gl.uniform1fv(U(progScene, "uStarTemp"), starTempArr);
  gl.uniform4fv(U(progScene, "uGas"), gasArr);
  gl.uniform4fv(U(progScene, "uGasU"), gasUArr);
  gl.uniform1i(U(progScene, "uTdeN"), tdeN);
  gl.uniform4fv(U(progScene, "uTdePos"), tdePosArr);
  gl.uniform4fv(U(progScene, "uTdeU"), tdeUArr);
  gl.uniform4fv(U(progScene, "uTdeInfo"), tdeInfoArr);
  drawQuad();

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
  gl.uniform1f(U(progComposite, "uBloom"), params.bloom);
  gl.uniform1f(U(progComposite, "uExposure"), params.exposure);
  drawQuad();
  gl.activeTexture(gl.TEXTURE0);

  // HUD overlay (2D canvas above the GL frame; more overlays arrive in 6f–6g)
  clearHud(hudCtx, canvas.clientWidth, canvas.clientHeight);

  if (params.eduTrails) {
    // Drawn first: the insets below are opaque panels and should cover them.
    // A group's trails go away with its matter, so the overlay never shows a
    // path for something the frame behind it isn't drawing.
    trailGroups[0].on = params.stars;
    trailGroups[1].on = params.gas;
    trailGroups[2].on = tde !== null;
    drawTrails(
      hudCtx,
      trailGroups,
      basis,
      tanHalfFov,
      canvas.clientWidth,
      canvas.clientHeight,
      simT
    );
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
  // ndc -> CSS px, the same map drawShadowOutline strokes the outline with
  const ndcPxX = (x: number) => ((x + 1) / 2) * cw;
  const ndcPxY = (y: number) => ((1 - y) / 2) * ch;

  const haveEdge = shadowOn && shadowEdge !== null && shadowEdge.valid;
  // Faded while stale: the view moved on and the replacement outline is still
  // being traced, so every anchor taken off it is a moment out of date.
  const edgeAlpha = shadowFresh ? 1 : 0.35;
  if (haveEdge) {
    // valid=false (camera not aimed at the hole — unreachable with the orbit
    // camera) degrades to drawing nothing.
    drawShadowOutline(hudCtx, shadowEdge!, cw, ch, edgeAlpha);
    shadowExtremes(shadowEdge!, calloutExt);
    // Emitted first, so that with only the 6f overlay on they keep the exact
    // positions they had before 6g gave them neighbours to make room for.
    emit("shadow", ndcPxX(calloutExt.leftX), ndcPxY(calloutExt.leftY), -30, 46, edgeAlpha);
    // The photon ring converges onto the shadow edge from OUTSIDE (its last
    // subring IS the boundary), so its anchor sits just off the outline.
    emit(
      "photonRing",
      ndcPxX(calloutExt.topX),
      ndcPxY(calloutExt.topY) - 5,
      48,
      -46,
      edgeAlpha
    );
  }

  if (params.eduCallouts) {
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
        edgeAlpha
      );
      emit(
        "doubledBottom",
        ndcPxX(calloutExt.bottomX * DOUBLED_NDC_SCALE),
        ndcPxY(calloutExt.bottomY * DOUBLED_NDC_SCALE),
        44,
        34,
        edgeAlpha
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
            edgeAlpha
          );
          break; // one ring at a time is enough
        }
      }
    }
  }

  if (nCallouts > 0) drawCallouts(hudCtx, calloutItems, nCallouts, cw, ch);

  if (params.eduClocks) {
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

  if (params.eduPotential) {
    // E = -m_t is the conserved energy the geodesic integrator carries, so
    // the dots are exact — they can only slide along r.
    const nMark = Math.min(tdeBodies.length, POT_MARK_MAX);
    for (let i = 0; i < nMark; i++) {
      potMarkR[i] = ksRadius(tdeBodies[i].p, params.spin);
      potMarkE[i] = -tdeBodies[i].mt;
    }
    const box = insetBox("pot");
    drawPotential(
      hudCtx,
      box.x,
      box.y,
      {
        a: params.spin,
        L: params.eduL,
        rHor: spinCtx.rHor,
        isco: spinCtx.isco,
        markR: potMarkR,
        markE: potMarkE,
        markN: nMark,
      },
      params.potScale
    );
    const spec = INSET_SPEC.pot;
    drawResizeGrip(hudCtx, box.gx, box.gy, spec.inX, spec.inY, gripHot === "pot");
  }

  if (params.eduEmbed) {
    // Only bodies the renderer is actually showing get a dot, so the funnel
    // never disagrees with the frame behind it.
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
        push(
          ksRadius(embedScratch, params.spin),
          Math.atan2(embedScratch[2], embedScratch[0]),
          EMBED_STARS
        );
      }
    }
    if (params.gas) {
      for (const b of gasBlobs) push(b.r, b.az, EMBED_GAS);
    }
    for (const b of tdeBodies) {
      push(ksRadius(b.p, params.spin), Math.atan2(b.p[2], b.p[0]), EMBED_TDE);
    }
    const box = insetBox("embed");
    drawEmbedding(
      hudCtx,
      box.x,
      box.y,
      {
        profile: embeddingFor(params.spin, params.diskOuter),
        isco: spinCtx.isco,
        yaw: camera.yaw,
        dotR: embedDotR,
        dotAz: embedDotAz,
        dotGroup: embedDotGroup,
        dotN: nDots,
      },
      params.embedScale
    );
    const spec = INSET_SPEC.embed;
    drawResizeGrip(hudCtx, box.gx, box.gy, spec.inX, spec.inY, gripHot === "embed");
  }

  if (dbgScan) {
    dbgReport("scene", sceneFbo);
    bloomFbos.forEach((f, i) => dbgReport(`bloom${i}`, f));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // dev hook: __wantShot captures the canvas synchronously before the
  // drawing buffer is cleared (headless screenshots miss slow WebGL frames)
  const w = window as unknown as { __wantShot?: boolean; __shot?: string };
  if (w.__wantShot) {
    w.__wantShot = false;
    w.__shot = canvas.toDataURL("image/png");
  }

  if (firstFrame) {
    firstFrame = false;
    overlay.style.display = "none";
  }

  // readouts
  distReadout.textContent =
    `r = ${camera.dist.toFixed(1)} M   r+ = ${spinCtx.rHor.toFixed(2)} M   ` +
    `ISCO ${spinCtx.isco.toFixed(2)} M   t = ${simT.toFixed(0)} M`;
  physReadout.textContent =
    `r+ = ${fmtSci(spinCtx.rHor * lengthKm(massMsun))} km   ` +
    `1 M of time = ${fmtSci(timeSec(massMsun))} s   ` +
    `T peak ${fmtSci(effTempK)} K (${bandLabel(effTempK)})`;
  const hills = hillsMassMsun(spinCtx.rHor);
  let tdeText =
    `sun-like star: r_t = ${tidalRadiusM(massMsun).toFixed(1)} M   ` +
    `Hills mass ${fmtSci(hills)} M☉`;
  if (tde) {
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
  tdeReadout.textContent = tdeText;
  frames++;
  const now = performance.now();
  if (now - fpsT0 > 500) {
    fpsReadout.textContent = `${((frames * 1000) / (now - fpsT0)).toFixed(0)} fps`;
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
