/**
 * Does the rendered photon-ring ladder agree with the tested CPU oracle, and
 * does anything still fall off it?
 *
 * Run with the dev server up:  npm run dev  (then)  npm run band
 *
 * Slices 11 and 12 both claim something about pixels. Slice 11 claims that a
 * ray the march leaves winding gets a real escape direction and a real winding
 * out of `src/mino.ts` instead of the sky at whatever direction it happened to
 * be pointing. Slice 12 claims that this now includes rays passing over the
 * spin axis, which the separated chart could not follow at all. Both claims
 * live twice — once in a tested module and once transcribed into GLSL — and
 * `npm test` can only reach the first.
 *
 * Slice 13 adds a third claim about pixels: a band ray goes on crossing the
 * accretion disk after the march gives up, and those crossings are now shaded.
 * That one is measured by DIFFERENCE — the disk toggled off and on again over
 * the same pixels — because bloom makes an absolute brightness meaningless
 * here.
 *
 * Five things only the renderer can answer:
 *
 * 1. **The tripwire.** Since slice 11b the ladder's magenta means one thing:
 *    the continuation spent MINO_MAX_STEPS. It is supposed to read ZERO
 *    everywhere, so counting it is a passing check rather than dead UI. It did
 *    not read zero when slice 12 looked: two pixels at a = 0.998 from the
 *    default camera were clipping a cap 29 steps too small.
 *
 * 2. **Whether the exponents printed around the ring are printed where the
 *    layout puts them.** Slice 14 draws gamma at six azimuths on the dashed
 *    outline; the values are pinned on the CPU, so what is left for a frame is
 *    placement, measured as ink against control boxes at azimuths with no text
 *    on them.
 *
 * 3. **Where the rungs fall, against the CPU's own winding.** This is the
 *    float32 question, and the CPU tests cannot reach it: the radial
 *    acceleration near a double root is a cancellation and the error is
 *    amplified by e^(gamma * winding).
 *
 *    Measured through the HAIRLINES, not the rung colours. The shader draws a
 *    dark line at every whole turn, so a line's POSITION is where the winding
 *    crosses an integer — a claim about the physics, to sub-pixel precision,
 *    that survives any tonemap because it is a local minimum rather than a
 *    colour. Classifying the rungs by colour was tried first and does not
 *    work: the composite's ACES curve plus bloom desaturate a rung enough to
 *    land nearer its neighbour's chromaticity than its own (measured: the
 *    1-2 rung reads 0.196,0.357,0.447 against its own 0.118,0.324,0.559 and
 *    the 0-1 rung's 0.283,0.321,0.396). That is a true thing about the tonemap
 *    and a useless thing to measure the winding with.
 *
 * 4. **Whether the light slice 13 found is drawn.** Band pixels the march
 *    leaves with no disk crossing of their own, split by whether the
 *    continuation finds them one, differenced across the disk toggle. The
 *    pixels that gain a crossing and the ones that do not sit a few pixels
 *    apart in the same bloom, so the split separates where a brightness would
 *    not: 0.11 of full luminance against 0.0000 at a = 0.9.
 *
 * 5. **What the second loop costs**, at the default view and at the pitch
 *    clamp where the pole crossings live.
 *
 * What a rendered frame CANNOT check is slice 12's azimuth swing itself. The
 * half-turn over the pole moves where the ray lands on the SKY, and the
 * winding barely notices it — so the swing is pinned on the CPU, by
 * test/mino.test.ts against a fine integration of the same passage, and what
 * this tool adds is that the GLSL computes the same winding, that the passage
 * fires in the shader where the module says it should, and that nothing falls
 * off the ladder.
 *
 * The hairline scan runs with the disk off: the ladder keeps the scene's own
 * luminance as brightness, and a bright disk pixel leaves no room for a
 * hairline to dip into. That is also the dim half of slice 13's difference,
 * so the two share a frame rather than costing one each.
 */

import { createServer } from "vite";
import { openLab, OUT_DIR } from "./harness.mjs";

/**
 * The oracle is TypeScript and this file is not, so borrow the bundler the repo
 * already depends on rather than adding a TS runner — the same trick
 * tools/visual/polarization.mjs uses. Middleware mode serves nothing; the lab
 * itself comes from the `npm run dev` this tool requires anyway.
 */
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { MARCH_MAX_STEPS, buildStaticTetrad, rayCaptured, rayConstants, traceRayKerr } =
  await vite.ssrLoadModule("/src/kerr.ts");
const { continueToEscape, minoStateAt, rayPotentials } = await vite.ssrLoadModule("/src/mino.ts");
const { JET_BASE, JET_FLARE, JET_Q2_CUT, JET_TOP, JET_WIDTH0, jetProfile } =
  await vite.ssrLoadModule("/src/matter.ts");
const { LADDER_RUNGS, LADDER_UNRESOLVED } = await vite.ssrLoadModule("/src/shaders.ts");
const { findShadowEdge, outlineLyapunov, ringGammaLabels } =
  await vite.ssrLoadModule("/src/edu.ts");

/** Spins to sweep. a = 0 has a band and pole crossings too — 384 px of one. */
const SPINS = [0, 0.9, 0.998];
/** Luminance below which a pixel is captured (or nothing), not a rung. */
const BLACK = 0.02;
/**
 * Half-width of the window a hairline is looked for in, in pixels, and how
 * deep the dip has to be against the brightest pixel in that window. The
 * shader draws the line 1.5 * fwidth(w) wide and darkens by 70%, so a real one
 * is unmistakable; these only have to be loose enough for the antialiasing.
 */
const LINE_WINDOW = 4;
const LINE_DEPTH = 0.92;
/**
 * How far a drawn line may sit from where the CPU puts the crossing, in
 * WINDING rather than pixels: the ring's rungs crowd geometrically, so the same
 * pixel offset means wildly different things at different radii, and the claim
 * under test is about the winding.
 *
 * Measured worst 0.03 half-turns, i.e. 3% of a rung, at every camera and spin
 * sampled — and that is float32 in the 320-step march rather than anything the
 * continuation did: the offsets sit on the OUTER crossings, where no ray is
 * anywhere near the budget. 0.1 is three times the measurement.
 */
const MAX_OFFSET_W = 0.1;
/** Crossings closer together than this are where the rungs merge; skip them. */
const MIN_SPACING = 6;
/**
 * Half-turns per pixel above which a hairline is not a locatable feature.
 *
 * Toward the critical curve the rungs crowd geometrically — that is the whole
 * point of the view — and a crossing there is thinner than a pixel, so asking
 * where its line sits is asking a question the frame cannot answer: measured,
 * a crossing at 0.29 half-turns per pixel reads 1.25 half-turns "off" purely
 * because 4 px of it is more than a rung. This restricts the comparison to the
 * outer rungs, where a line is a line. The crowded ones are checked by the
 * tripwire (which is zero) and on the CPU.
 */
const MAX_GRADIENT = 0.05;
/** Fewer matched than this and the scan proved nothing. */
const MIN_LINES = 5;
/**
 * Slice 13's thresholds. Fewer than MIN_LIT pixels in a group and the medians
 * are noise, so the view reports and does not judge — a = 0 has no band worth
 * the name and nothing on the disk to find (the photon orbit is at r = 3 and
 * the disk starts at 6), which is a fact about the spin rather than a failure.
 *
 * Measured at the default camera: the disk adds 0.20-0.28 of full luminance to
 * a band pixel the continuation lights and 0.001-0.006 to one it does not, so
 * the two groups are two orders apart and these bounds are nowhere near either.
 */
const MIN_LIT = 4;
const MIN_LIT_GAIN = 0.02;
const LIT_MARGIN = 5;
/** How far either side of the shadow's edge the band is looked for, in px. */
const BAND_PAD = 70;
/**
 * Slice 14's thresholds: ink in a printed exponent's box, and ink in the
 * control box that is the same offset outside the same curve at an azimuth
 * with no text on it.
 *
 * "gamma 1.22" at 10 px is about 40 px wide and 8 tall; measured, a box lands
 * 30-60 lit pixels. The control catches the failure that matters — a label
 * laid out against the wrong strip, or pushed inward onto the ring — because
 * the outline's own dashes run just as close to it.
 */
/**
 * Slice 18 weighs the two legs of a ray against each other with the jet's own
 * emission profile, not with a path length.
 *
 * A length inside the cone is the wrong instrument, and it was measured being
 * wrong: the envelope is mostly dim skirt, so the group whose CONTINUATION runs
 * up the jet had 9.7 M of march inside it against the control's 13.1 M, and the
 * control came out BRIGHTER (0.186 against 0.165) on the strength of that
 * difference alone. `jetProfile` is the shape the shader actually emits with —
 * the gaussian core across the cone and the fade along it, with the noise, the
 * pulse and the beaming left out because a CPU cannot know them — and it lives
 * in src/matter.ts so the shader and this file cannot drift apart.
 *
 * So each band pixel carries two numbers: the profile integrated along the
 * march's path, and along the continuation's. A ray's jet light is proportional
 * to their SUM, up to the three factors left out.
 */
/** Ignore pixels the march barely lights: every ratio below divides by this. */
const JET_I_MIN = 0.05;
/** The continuation must carry at least this much of the march's own light. */
const JET_LIT = 0.7;
/** The control must carry at most this much of it. */
const JET_DARK = 0.05;
/** Every row is scanned: the lit pixels are a thin subset of an already thin band. */
const JET_ROW_STEP = 1;
/** How far a control may sit from the case it is read against, in px. */
const JET_NEAR = [80, 10];
const MIN_JET_PX = 6;
/**
 * How much of the extra light its continuation predicts a band pixel has to
 * receive, and how much it is allowed to receive. 1 is "drawn at exactly the
 * march's weight"; 0 is "never drawn".
 *
 * The window is wide because the prediction leaves out everything a CPU cannot
 * know — the fbm knots, the travelling pulse and the relativistic beaming — and
 * those are multiplicative noise of order one on each pixel. It is a window and
 * not a floor because a pixel receiving far MORE than its extra emission can
 * explain would mean something other than the jet had moved.
 *
 * Both ends are measured rather than chosen. As the renderer stands this reads
 * 118% at a = 0.998 and 148% at a = 0.9; with the one line that samples matter
 * along the continuation disabled in the shader, the same two views read 45%
 * and 24%. The null is not 0% because the cases are not the controls in
 * anything but the continuation — their marches run nearer the spin axis, and
 * the three factors jetProfile leaves out are not distributed the same way
 * there. The floor sits between a measured null and a measured signal, and the
 * a = 0.998 view is the tighter of the two.
 */
const JET_MIN_FRAC = 0.7;
const JET_MAX_FRAC = 2;
/** Controls averaged per point of the calibration curve, and the fewest usable. */
const JET_CURVE_K = 15;
const JET_CURVE_MIN = 30;
/**
 * The scene the jet is read off: everything but the jet switched off, no bloom,
 * the exposure slider at its floor and the jet turned right down.
 *
 * All of that is to stay off the top of the tone map. Measured on the scene as
 * it normally renders, these pixels read 1.0000 in both groups — the jet's own
 * march light saturates them outright, and no difference can be seen through a
 * clipped white. Both groups then "gained" exactly 0.1273 when the jet was
 * switched on, which is the tone map moving and not the jet.
 */
const JET_DIM = {
  // The ladder goes off with the rest of it. It false-colours every band pixel
  // by the rung its ray is on, which multiplies the luminance this measurement
  // reads — and a case and its control, within 80 px of each other, can sit on
  // different rungs and so on different multipliers.
  "edu-ladder": false,
  disk: false,
  "gas-on": false,
  "stars-on": false,
  "sky-on": false,
  bloom: 0,
  exposure: 0.2,
  jetpower: 0.05,
};
const JET_BRIGHT = {
  "edu-ladder": true,
  disk: true,
  "gas-on": true,
  "stars-on": true,
  "sky-on": true,
  bloom: 0.7,
  exposure: 1,
  jetpower: 1,
};

const MIN_LABEL_INK = 15;
const MAX_CONTROL_INK = 4;

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`          FAIL - ${msg}`);
};

/**
 * Count pixels painted the continuation-capped colour.
 *
 * By the DIRECTION of the chromaticity away from neutral, not by distance to
 * it. The shader scales the hue by the scene's luminance and again by the
 * hairline, both scalars, so chromaticity is the rung — but the composite's
 * tonemap and bloom then desaturate it, which slides a chromaticity toward
 * neutral along its own direction and leaves that direction alone.
 *
 * Measured, on the 5+ rung at a = 0.998: a distance test calls 48 of those
 * pixels magenta, because desaturation drags them 0.035 away from their own
 * reference and only 0.035 from the magenta. The same pixels score 0.99
 * against their own direction and 0.59 against the magenta. A tighter distance
 * cut would have hidden them and hidden a real magenta with them, which is the
 * failure that matters here — this counter is a tripwire, and a tripwire that
 * can miss is worse than none.
 */
async function countCapped(lab, palette, which) {
  return lab.page.evaluate(
    async ([pal, want]) => {
      const c = await window.__lab.layer("gl");
      const d = c.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, c.width, c.height).data;
      // direction of each palette entry away from neutral, normalized
      const dirs = pal.map(([r, g, b]) => {
        const s = r + g + b;
        const v = [r / s - 1 / 3, g / s - 1 / 3, b / s - 1 / 3];
        const L = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / L, v[1] / L, v[2] / L];
      });
      let hits = 0;
      let black = 0;
      let grey = 0;
      for (let i = 0, n = c.width * c.height; i < n; i++) {
        const o = i * 4;
        const r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
        const s = r + g + b;
        if (s < 3 * 0.02) {
          black++;
          continue;
        }
        const v = [r / s - 1 / 3, g / s - 1 / 3, b / s - 1 / 3];
        const L = Math.hypot(v[0], v[1], v[2]);
        // Too near neutral to have a direction at all. The 0-1 rung is itself
        // nearly neutral, so this is not "unclassified", it is "not magenta".
        if (L < 0.02) {
          grey++;
          continue;
        }
        let best = -1;
        let bestC = -Infinity;
        for (let k = 0; k < dirs.length; k++) {
          const cs = (v[0] * dirs[k][0] + v[1] * dirs[k][1] + v[2] * dirs[k][2]) / L;
          if (cs > bestC) {
            bestC = cs;
            best = k;
          }
        }
        if (best === want && bestC > 0.9) hits++;
      }
      return { hits, black, grey };
    },
    [palette, which]
  );
}

/** Luminance along one image row of the frozen scene. */
async function lumRow(lab, y) {
  return lab.page.evaluate(async (row) => {
    const c = await window.__lab.layer("gl");
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, row, c.width, 1).data;
    const out = new Array(c.width);
    for (let x = 0; x < c.width; x++) {
      const o = x * 4;
      out[x] = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
    }
    return out;
  }, y);
}

/**
 * The shadow's vertical extent, so the scan can cross the ring where it is
 * widest and the rungs are furthest apart — found from the drawn frame rather
 * than assumed, because the camera is dragged and the hole moves with it.
 */
async function shadowRows(lab) {
  return lab.page.evaluate(async (black) => {
    const c = await window.__lab.layer("gl");
    const d = c.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, c.width, c.height).data;
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const o = (y * c.width + x) * 4;
        const lum = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
        if (lum < black) {
          if (y < lo) lo = y;
          if (y > hi) hi = y;
          break;
        }
      }
    }
    return hi >= lo ? { lo, hi } : { lo: 0, hi: c.height - 1 };
  }, BLACK);
}

/** Covariant launch momentum for a pixel centre, in the frame's own basis. */
function launchAt(cam, tet, W, H, x, y) {
  const aspect = W / H;
  const ndc = [((x + 0.5) / W) * 2 - 1, 1 - ((y + 0.5) / H) * 2];
  const v = [ndc[0] * cam.tanHalfFov * aspect, ndc[1] * cam.tanHalfFov, 1];
  const L = Math.hypot(...v);
  const m = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    m[i] =
      (v[0] / L) * tet.rightCov[i] +
      (v[1] / L) * tet.upCov[i] +
      (1 / L) * tet.fwdCov[i] -
      tet.uCov[i];
  }
  return m;
}

/**
 * The x windows a band can be in on one row: the shadow's own edges, padded.
 *
 * Found with `rayCaptured`, which is closed form and costs nothing, rather than
 * from the drawn frame — the sky around the shadow is dark enough in places to
 * fool a luminance threshold, and the band is exactly where being wrong about
 * the edge would cost the samples this scan is made of.
 */
function bandWindows(cam, tet, W, H, y, pad) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = 0; x < W; x++) {
    if (!rayCaptured(cam.pos, launchAt(cam, tet, W, H, x, y), cam.spin)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (hi < lo) return [];
  const clamp = (v) => Math.max(0, Math.min(W - 1, v));
  if (hi - lo <= 2 * pad) return [[clamp(lo - pad), clamp(hi + pad)]];
  return [
    [clamp(lo - pad), clamp(lo + pad)],
    [clamp(hi - pad), clamp(hi + pad)],
  ];
}

/**
 * The jet's emission profile integrated along the chord A->B.
 *
 * Midpoint sampling rather than an endpoint rule, because the two paths being
 * compared are sampled quite differently — the march's steps run to 12 M out
 * here and the continuation's to 1.3 M — and anything evaluated at the ends
 * would charge the coarser one for whatever it straddles. The cheap reject in
 * front of it is what keeps a per-pixel scan of the whole frame affordable, and
 * its bounds are padded by the chord's own length so a segment that only clips
 * the cone is still sampled properly.
 */
function jetChord(A, B) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  if (L === 0) return 0;
  const yHi = Math.max(Math.abs(A[1]), Math.abs(B[1]));
  const yLo = Math.min(Math.abs(A[1]), Math.abs(B[1]));
  if (yHi + L < JET_BASE || yLo - L > JET_TOP) return 0;
  const wide = Math.sqrt(JET_Q2_CUT) * (JET_WIDTH0 + JET_FLARE * Math.min(yHi, JET_TOP)) + L;
  if (Math.hypot(A[0], A[2]) > wide && Math.hypot(B[0], B[2]) > wide) return 0;
  const n = Math.max(1, Math.ceil(L / 0.05));
  let s = 0;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    s += jetProfile([A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1]), A[2] + f * (B[2] - A[2])]);
  }
  return (s / n) * L;
}

function jetLight(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += jetChord(pts[i - 1], pts[i]);
  return s;
}

/**
 * Slice 18's classification of one pixel: the jet light the MARCH collected,
 * and the jet light the CONTINUATION collected after it, both as integrals of
 * the emitter's own profile.
 *
 * Kept apart from windingAt rather than folded into it because both halves cost
 * a collected path, and the slice-13 scan that calls windingAt does not want to
 * pay for one.
 *
 * Null unless this is a band pixel — the march spent its budget still winding —
 * since a ray the march resolves has no continuation to carry anything.
 */
function jetAt(cam, tet, W, H, x, y) {
  const m = launchAt(cam, tet, W, H, x, y);
  if (rayCaptured(cam.pos, m, cam.spin)) return null;
  const short = traceRayKerr(cam.pos, m, cam.spin, {
    rEscape: 64,
    maxSteps: MARCH_MAX_STEPS,
    path: true,
  });
  if (short.escaped || short.steps < MARCH_MAX_STEPS) return null;
  const rc = rayConstants(cam.pos, m, cam.spin);
  const C = rayPotentials(rc.lambda, rc.q, cam.spin);
  const res = continueToEscape(
    minoStateAt(short.pos, [short.mt, ...short.mv], cam.spin, C),
    C,
    cam.spin,
    { mt: short.mt, path: true }
  );
  return {
    march: jetLight(short.path),
    cont: jetLight(res.path.map((s) => s.pos)),
  };
}

/** The CPU's own winding and disk crossings at a pixel, or null where captured. */
function windingAt(cam, tet, W, H, x, y) {
  const m = launchAt(cam, tet, W, H, x, y);
  if (rayCaptured(cam.pos, m, cam.spin)) return null;
  const short = traceRayKerr(cam.pos, m, cam.spin, { rEscape: 64, maxSteps: MARCH_MAX_STEPS });
  const onDisk = (c) => c.r > cam.isco && c.r < cam.diskOuter;
  const marchDisk = short.crossings.filter(onDisk).length;
  if (short.escaped)
    return { w: short.winding, band: false, passages: 0, capped: false, marchDisk, contDisk: 0 };
  // The march's other exits leave garbage the continuation must never be fed.
  if (short.steps < MARCH_MAX_STEPS) return null;
  const rc = rayConstants(cam.pos, m, cam.spin);
  const C = rayPotentials(rc.lambda, rc.q, cam.spin);
  const res = continueToEscape(
    minoStateAt(short.pos, [short.mt, ...short.mv], cam.spin, C),
    C,
    cam.spin,
    // slice 13: the crossings the continuation makes are the light this scan
    // is about, and they need the march's own energy to be shaded at its scale
    { mt: short.mt }
  );
  return {
    w: short.winding + res.swept,
    band: true,
    passages: res.passages,
    capped: res.capped,
    marchDisk,
    contDisk: res.crossings.filter(onDisk).length,
  };
}

const PALETTE = [...LADDER_RUNGS.map((r) => r.rgb), LADDER_UNRESOLVED.rgb];
const CAPPED = PALETTE.length - 1;

/**
 * Match the hairlines drawn along one row against the whole-turn crossings the
 * CPU puts there.
 *
 * `w` is the CPU winding per pixel (null where captured), `lum` the drawn
 * luminance. A crossing is where floor(w) changes, located to sub-pixel by
 * interpolating w; a drawn line is the darkest pixel within LINE_WINDOW of it,
 * and it counts as a line at all only if it dips against the brightest pixel
 * in the same window.
 */
function scanRow(w, lum, W, y, notes) {
  const crossings = [];
  for (let x = 0; x + 1 < W; x++) {
    if (w[x] === null || w[x + 1] === null) continue;
    const a = Math.floor(w[x]);
    const b = Math.floor(w[x + 1]);
    if (a === b) continue;
    const k = Math.max(a, b);
    crossings.push(x + (k - w[x]) / (w[x + 1] - w[x]));
  }
  /** Local |dw/dx| in half-turns per pixel, from the CPU's own row. */
  const gradAt = (c) => {
    const i0 = Math.max(1, Math.min(W - 2, Math.round(c)));
    return w[i0 + 1] !== null && w[i0 - 1] !== null ? Math.abs(w[i0 + 1] - w[i0 - 1]) / 2 : NaN;
  };
  let crowded = 0;
  const isolated = crossings.filter((c, i) => {
    if (c <= LINE_WINDOW || c >= W - LINE_WINDOW) return false;
    if (i > 0 && c - crossings[i - 1] < MIN_SPACING) return false;
    if (i < crossings.length - 1 && crossings[i + 1] - c < MIN_SPACING) return false;
    if (!(gradAt(c) <= MAX_GRADIENT)) {
      crowded++;
      return false;
    }
    return true;
  });

  let matched = 0;
  let missing = 0;
  let worst = 0;
  for (const c of isolated) {
    const x0 = Math.max(0, Math.round(c) - LINE_WINDOW);
    const x1 = Math.min(W - 1, Math.round(c) + LINE_WINDOW);
    let lo = Infinity;
    let hi = -Infinity;
    let at = -1;
    for (let x = x0; x <= x1; x++) {
      if (lum[x] < lo) {
        lo = lum[x];
        at = x;
      }
      if (lum[x] > hi) hi = lum[x];
    }
    if (!(lo <= LINE_DEPTH * hi) || hi < BLACK) {
      missing++;
      if (notes.length < 6)
        notes.push(`row ${y}: no line at x=${c.toFixed(1)} (dip ${(lo / hi).toFixed(2)})`);
      continue;
    }
    matched++;
    const off = Math.abs(at - c) * gradAt(c);
    if (Number.isFinite(off)) worst = Math.max(worst, off);
    if (off > MAX_OFFSET_W && notes.length < 6)
      notes.push(
        `row ${y}: line at x=${at}, CPU crosses at ${c.toFixed(1)} — ` +
          `${off.toFixed(3)} half-turns apart`
      );
  }
  return { locatable: isolated.length, matched, missing, crowded, worst };
}

/**
 * Slice 14 (H2): are the pointwise exponents actually printed on the ring?
 *
 * The values themselves are pinned on the CPU, against traced rays, in
 * test/edu.test.ts — what only a frame can answer is whether the six numbers
 * land where the layout says, outside the curve and in the right strip. Glyphs
 * cannot be read back, so this measures INK against a control: the same boxes
 * at azimuths halfway between the labelled ones, built by handing
 * ringGammaLabels an outline rotated by half a label spacing, so the control
 * runs through the same layout code and sits the same distance outside the
 * same dashes. Text boxes full and control boxes empty is the claim.
 */
async function checkRingLabels(lab, cam, layout) {
  const { w: W, h: H } = layout.hud;
  const tet = buildStaticTetrad(cam.pos, cam.spin, cam.right, cam.up, cam.fwd);
  const edge = findShadowEdge(cam.pos, tet, cam.spin, cam.tanHalfFov, W / H);
  if (!edge.valid) {
    fail("no outline to print exponents on");
    return;
  }
  const gammas = outlineLyapunov(cam.pos, tet, cam.spin, cam.tanHalfFov, W / H, edge);
  const labels = ringGammaLabels(edge, gammas, 0, W, H);

  // the same layout, half a label spacing round — where nothing is printed
  const n = edge.pts.length / 2;
  const shift = Math.round(n / 12) * 2;
  const rotated = { valid: true, pts: new Float64Array(edge.pts.length) };
  for (let i = 0; i < edge.pts.length; i++) {
    rotated.pts[i] = edge.pts[(i + shift) % edge.pts.length];
  }
  const controls = ringGammaLabels(rotated, gammas, 0, W, H);

  const box = (l) => ({
    x0: l.align === "left" ? l.tx : l.align === "right" ? l.tx - 42 : l.tx - 21,
    y0: l.ty - 7,
    w: 42,
    h: 14,
  });
  const ink = await lab.page.evaluate(async (boxes) => {
    const c = await window.__lab.layer("hud");
    const d = c.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, c.width, c.height).data;
    return boxes.map((b) => {
      let lit = 0;
      for (let y = Math.round(b.y0); y < Math.round(b.y0 + b.h); y++) {
        for (let x = Math.round(b.x0); x < Math.round(b.x0 + b.w); x++) {
          if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
          if (d[((y * c.width + x) << 2) + 3] > 40) lit++;
        }
      }
      return lit;
    });
  }, [...labels.map(box), ...controls.map(box)]);

  const text = ink.slice(0, labels.length);
  const empty = ink.slice(labels.length);
  let lo = Infinity;
  let hi = -Infinity;
  for (const g of gammas) {
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  console.log(
    `          6 printed exponents: ${Math.min(...text)}-${Math.max(...text)} px of ink each ` +
      `(control boxes ${Math.min(...empty)}-${Math.max(...empty)}), ` +
      `gamma ${lo.toFixed(3)}..${hi.toFixed(3)} around this ring`
  );
  for (let i = 0; i < text.length; i++) {
    if (text[i] < MIN_LABEL_INK)
      fail(`the exponent at azimuth ${i} has ${text[i]} px of ink; it was not drawn`);
    if (empty[i] > MAX_CONTROL_INK)
      fail(`a control box carries ${empty[i]} px of ink; the labels are not where the layout puts them`);
  }
}

async function checkView(lab, label) {
  const layout = await lab.capture();
  const cam = layout.cam;
  const { w: W, h: H } = layout.gl;
  const tet = buildStaticTetrad(cam.pos, cam.spin, cam.right, cam.up, cam.fwd);

  // 1. the tripwire, on the scene as it really renders
  const cap = await countCapped(lab, PALETTE, CAPPED);
  console.log(
    `${label}  a = ${cam.spin.toFixed(3)}  ${W}x${H}: ` +
      `${cap.hits} px of "${LADDER_UNRESOLVED.label}", ${cap.black} captured, ` +
      `${cap.grey} too near neutral to have a hue`
  );
  if (cap.hits !== 0) fail(`${cap.hits} px of the continuation-capped colour; it must read zero`);

  // 2. slice 14: the exponents printed around the ring, on the same frame
  await checkRingLabels(lab, cam, layout);

  // 3. the hairlines, against the CPU's own winding, on a dim frame
  await lab.set({ disk: false });
  await lab.settle();
  await lab.capture();
  const span = await shadowRows(lab);
  await lab.shot(
    `ladder-${label.replace(/[^a-z0-9]+/gi, "-")}-a${String(cam.spin).replace(".", "")}.png`,
    { layer: "gl" }
  );

  // Three rows rather than one: a single row through the widest part of the
  // shadow yields only two or three crossings that a frame can locate at all
  // (see MAX_GRADIENT), and two comparisons is not a measurement.
  let banded = 0;
  let passaged = 0;
  let cappedPx = 0;
  let matched = 0;
  let missing = 0;
  let crowded = 0;
  let worst = 0;
  let locatable = 0;
  const notes = [];
  for (const f of [0.25, 0.5, 0.75]) {
    const y = Math.round(span.lo + f * (span.hi - span.lo));
    const lum = await lumRow(lab, y);
    const w = new Array(W).fill(null);
    for (let x = 0; x < W; x++) {
      const r = windingAt(cam, tet, W, H, x, y);
      if (!r) continue;
      w[x] = r.w;
      if (r.band) banded++;
      if (r.passages > 0) passaged++;
      if (r.capped) cappedPx++;
    }
    const seen = scanRow(w, lum, W, y, notes);
    locatable += seen.locatable;
    matched += seen.matched;
    missing += seen.missing;
    crowded += seen.crowded;
    worst = Math.max(worst, seen.worst);
  }

  console.log(
    `          3 rows across the shadow: ${banded} band px, ${passaged} taking a pole ` +
      `passage, ${cappedPx} capped on the CPU; ${locatable} locatable whole-turn crossings ` +
      `(${crowded} too crowded to locate), ${matched} drawn, ${missing} missing, ` +
      `worst offset ${worst.toFixed(4)} half-turns`
  );
  for (const n of notes) console.log(`            ${n}`);
  if (matched < MIN_LINES) fail(`only ${matched} hairlines matched; expected ${MIN_LINES}`);
  if (missing > matched) fail(`${missing} crossings have no drawn hairline`);
  if (worst > MAX_OFFSET_W)
    fail(`a hairline sits ${worst.toFixed(3)} half-turns from the CPU crossing`);

  // 4. slice 13: is the disk light the continuation carries actually drawn?
  // Sampled on its own rows, still on the dim frame, so the two states can be
  // differenced pixel for pixel.
  const lit = [];
  const dark = [];
  const rows = [];
  for (const f of [0.15, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85]) {
    const y = Math.round(span.lo + f * (span.hi - span.lo));
    if (rows.includes(y)) continue;
    rows.push(y);
    const lum = await lumRow(lab, y);
    for (const [x0, x1] of bandWindows(cam, tet, W, H, y, BAND_PAD)) {
      for (let x = x0; x <= x1; x++) {
        const r = windingAt(cam, tet, W, H, x, y);
        // Only band pixels the march left with no disk light of their own: the
        // claim is about light that was not there before, and a pixel the march
        // already lit would be bright either way.
        if (!r || !r.band || r.marchDisk !== 0) continue;
        (r.contDisk > 0 ? lit : dark).push({ x, y, off: lum[x] });
      }
    }
  }

  await lab.set({ disk: true });
  await lab.settle();
  await lab.capture();
  return checkDiskLight(lab, rows, lit, dark);
}

/**
 * Slice 13: is the disk light the continuation carries actually DRAWN?
 *
 * The claim is narrow on purpose. A band pixel whose 320-step march found no
 * equatorial crossing on the disk had, before this slice, no disk light at all
 * — it rendered as sky. If the continuation now finds it one, the pixel must
 * light up when the disk is switched on; if the continuation finds it none, it
 * must not.
 *
 * The disk toggle is the control, and it is what makes this measurable through
 * the composite. Bloom spreads light from the bright disk elsewhere in the
 * frame into every pixel here, so an absolute brightness would prove nothing;
 * the pixels that gained a crossing and the pixels that did not sit a few
 * pixels apart along the same rows, in the same bloom, so their DIFFERENCE
 * between the two frames separates cleanly. The dark group is the negative
 * control: without it, turning the disk on brightening everything would pass.
 */
async function checkDiskLight(lab, rows, lit, dark) {
  if (lit.length === 0 && dark.length === 0) {
    // Said out loud rather than skipped: a view that stops finding band pixels
    // the march leaves dark looks exactly like a view where the check passed.
    console.log(`          slice 13: no band px here the march leaves dark — nothing to check`);
    return { judged: 0, controlled: 0 };
  }
  const on = new Map();
  for (const y of rows) on.set(y, await lumRow(lab, y));
  const gain = (px) => on.get(px.y)[px.x] - px.off;
  const med = (A) => {
    const v = A.map(gain).sort((p, q) => p - q);
    return v.length ? v[v.length >> 1] : NaN;
  };
  const gLit = med(lit);
  const gDark = med(dark);
  console.log(
    `          slice 13: ${lit.length} band px the march left dark that the ` +
      `continuation lights, ${dark.length} it leaves dark; median luminance the ` +
      `disk adds ${lit.length ? gLit.toFixed(4) : "n/a"} vs ${dark.length ? gDark.toFixed(4) : "n/a"}`
  );
  const judged = lit.length >= MIN_LIT ? 1 : 0;
  const controlled = judged && dark.length >= MIN_LIT ? 1 : 0;
  if (judged) {
    if (!(gLit > MIN_LIT_GAIN))
      fail(`the disk adds only ${gLit.toFixed(4)} to band px the continuation says it lights`);
    if (controlled && !(gLit > LIT_MARGIN * gDark))
      fail(
        `band px the continuation lights gain ${gLit.toFixed(4)}, ones it does not ` +
          `gain ${gDark.toFixed(4)} — not separated`
      );
  }
  return { judged, controlled };
}


/**
 * Slice 18: is the JET light the continuation carries actually drawn, and drawn
 * at the same weight as the march's own?
 *
 * Slice 13's disk check had a clean control available and this one does not,
 * which is the whole design problem here. The disk is a surface, so a band
 * pixel either gains a crossing or it does not; the jet is a volume the march
 * samples step by step, so both legs of the ray collect some of it.
 *
 * THE OBVIOUS CONTROL DOES NOT EXIST, and it was measured not existing rather
 * than assumed. Over 1763 band pixels at a = 0.998 and 1528 at a = 0.9, not one
 * pixel whose continuation runs brightly up the jet has a march that misses the
 * jet entirely — at camera pitches from 0.15 to 1.2 and distances from 8 M to
 * 25 M. The reason is geometric and worth keeping: a ray that leaves up the
 * spin axis is a ray that came in near it, and the two legs of its path are
 * near mirror images. Near the axis it is worse — the camera is then inside the
 * jet's cone, so EVERY march starts in the jet. The stars are no substitute:
 * they are compact enough that over the same views only four band pixels have a
 * continuation passing within one gaussian radius of one while the march stays
 * clear of all six.
 *
 * So the controls are used to CALIBRATE rather than to compare against. Every
 * band pixel carries the jet's own emission profile integrated along the
 * march's path and along the continuation's. A pixel is a CONTROL if its
 * continuation carries at most JET_DARK of what its march carries — its light
 * is the march's alone — and a CASE if its continuation carries at least
 * JET_LIT of it. The controls, read against their own march emission, ARE the
 * curve from emission to screen luminance, tone map and all. Each case is then
 * asked one question:
 *
 *     it received g. The curve says a ray with only its march emission would
 *     have received base, and one with march + continuation would have received
 *     full. Where between the two does g fall?
 *
 * That fraction is 1 if the continuation's light is drawn at the march's own
 * weight and 0 if it never reached the screen, and it needs no assumption about
 * the tone map because the tone map is what the curve measured. Which matters:
 * the response here is strongly compressed, and a ratio of raw luminances reads
 * 1.4x where the emission ratio is 2.0x purely from the curvature.
 *
 * Three things this is built around, each measured going wrong first:
 *
 *  - THE FRAME MUST BE DIM, or there is no curve to fit. On the scene as it
 *    normally renders both groups read 1.0000 — the march's own jet light
 *    saturates these pixels and no difference survives a clipped white.
 *  - A PATH LENGTH IS THE WRONG INSTRUMENT. The jet's envelope is mostly dim
 *    skirt; measured in lengths, the group carrying continuation jet light had
 *    9.7 M inside the cone against the control's 13.1 M and came out DIMMER on
 *    the strength of that difference alone. `jetProfile` is the shape the
 *    shader emits with, and it lives in src/matter.ts so the two cannot drift.
 *  - THE CONTROLS MUST BE NEARBY. Not for bloom's sake, which is off here, but
 *    because the jet is a structure on screen and a control from the far side
 *    of the ring is looking at a different part of it.
 */
async function checkJetLight(lab, label) {
  const layout = await lab.capture();
  const cam = layout.cam;
  const { w: W, h: H } = layout.gl;
  const tet = buildStaticTetrad(cam.pos, cam.spin, cam.right, cam.up, cam.fwd);
  const pitch = Math.asin(cam.pos[1] / Math.hypot(...cam.pos));

  const all = { lit: [], dark: [] };
  let band = 0;
  let usable = 0;
  for (let y = 20; y < H - 20; y += JET_ROW_STEP) {
    for (const [x0, x1] of bandWindows(cam, tet, W, H, y, BAND_PAD)) {
      for (let x = x0; x <= x1; x++) {
        const j = jetAt(cam, tet, W, H, x, y);
        if (!j) continue;
        band++;
        // Pixels the march barely lights are excluded: the case/control split
        // below is a ratio against this number.
        if (j.march < JET_I_MIN) continue;
        usable++;
        const share = j.cont / j.march;
        if (share >= JET_LIT) all.lit.push({ x, y, ...j });
        else if (share <= JET_DARK) all.dark.push({ x, y, ...j });
      }
    }
  }
  const [nearX, nearY] = JET_NEAR;
  const near = (p, q) => Math.abs(p.x - q.x) <= nearX && Math.abs(p.y - q.y) <= nearY;
  const keptDark = new Map();
  const lit = all.lit.filter((p) => {
    const hits = all.dark.filter((q) => near(p, q));
    for (const q of hits) keptDark.set(q.x + "," + q.y, q);
    return hits.length > 0;
  });
  const dark = [...keptDark.values()];
  const rows = new Map();
  for (const p of [...lit, ...dark]) rows.set(p.y, null);
  const med = (A) => {
    const v = A.slice().sort((p, q) => p - q);
    return v.length ? v[v.length >> 1] : NaN;
  };
  console.log(
    label + "  a = " + cam.spin.toFixed(3) + "  pitch " + pitch.toFixed(2) + ": " + band +
      " band px, " + usable + " the march carries jet light to; " + all.lit.length +
      " of those have the continuation carrying " + JET_LIT + "x that or more (" + lit.length +
      " with a control nearby) and " + all.dark.length + " have " + JET_DARK + "x or less (" +
      dark.length + " used as the calibration), on " + rows.size + " rows"
  );
  if (lit.length < MIN_JET_PX || dark.length < JET_CURVE_MIN) {
    // Said out loud rather than skipped, for slice 13's reason: a view that
    // stops finding these looks exactly like a view where the check passed.
    console.log("          slice 18: too few band px to judge — nothing to check");
    return { judged: 0, controlled: 0 };
  }

  await lab.set({ ...JET_DIM, "jets-on": false });
  await lab.settle();
  await lab.capture();
  const off = new Map();
  for (const y of rows.keys()) off.set(y, await lumRow(lab, y));

  await lab.set({ "jets-on": true });
  await lab.settle();
  await lab.capture();
  const on = new Map();
  for (const y of rows.keys()) on.set(y, await lumRow(lab, y));
  await lab.set(JET_BRIGHT);
  await lab.settle();

  const gain = (p) => on.get(p.y)[p.x] - off.get(p.y)[p.x];
  // The curve, as the controls measured it: the median light received at a
  // given march emission, over the JET_CURVE_K controls nearest to it in
  // emission. A median rather than a fit — the knots, the pulse and the beaming
  // are all left out of jetProfile because a CPU cannot know them, and they are
  // multiplicative noise on every one of these points.
  const curveOf = dark.map((p) => ({ I: p.march, g: gain(p) })).sort((u, v) => u.I - v.I);
  const curve = (x) => {
    const by = curveOf.map((c) => ({ d: Math.abs(c.I - x), g: c.g })).sort((u, v) => u.d - v.d);
    return med(by.slice(0, JET_CURVE_K).map((c) => c.g));
  };
  const span = [curveOf[0].I, curveOf[curveOf.length - 1].I];
  // A case is only judgeable where the controls actually reach: extrapolating
  // the curve past the emission any control had would be inventing the tone
  // map rather than measuring it.
  const judged = lit.filter((p) => p.march + p.cont <= span[1] && p.march >= span[0]);
  const fracs = judged.map((p) => {
    const base = curve(p.march);
    const full = curve(p.march + p.cont);
    return (gain(p) - base) / (full - base);
  }).filter((f) => Number.isFinite(f));
  const got = med(fracs);
  console.log(
    "          slice 18: of the extra light its continuation's jet emission predicts, a band " +
      "px receives " + (100 * got).toFixed(0) + "% (median over " + fracs.length +
      " of " + lit.length + " cases inside the controls' own range " + span[0].toFixed(2) +
      "-" + span[1].toFixed(2) + "; 100% = drawn at the march's weight, 0% = never drawn)"
  );
  if (fracs.length < MIN_JET_PX) {
    console.log("          slice 18: too few cases inside that range — nothing to check");
    return { judged: 0, controlled: 0 };
  }
  if (!(got > JET_MIN_FRAC))
    fail(
      "band px receive only " + (100 * got).toFixed(0) + "% of the extra light their " +
        "continuation's jet emission predicts — it is not reaching the screen at the " +
        "march's weight"
    );
  if (!(got < JET_MAX_FRAC))
    fail(
      "band px receive " + (100 * got).toFixed(0) + "% of the extra light their " +
        "continuation's jet emission predicts — more than that emission can explain, so " +
        "something other than the jet moved"
    );
  return { judged: 1, controlled: 1 };
}

/**
 * Frames per second, from the lab's own readout after it has settled.
 *
 * The limiter is raised to its maximum first, or this measures the limiter. It
 * still cannot measure the second loop's cost: the browser drives the frame
 * from requestAnimationFrame, which will not run faster than the display, so
 * 60 is a CEILING and both readings sit on it. What that says is that the pole
 * passage does not eat the frame's headroom at 1280x800 — an upper bound on
 * the cost, not the cost. A real number would need a GPU timer query, which is
 * a change to the renderer rather than to this tool.
 *
 * The one wait left in here counted in milliseconds, and it has to be: the
 * readout averages over its own 500 ms window, so waiting for FRAMES would
 * measure whatever that window happened to contain. Four seconds of real time
 * is what makes the readout worth reading, on any machine.
 */
async function frameTime(lab, label) {
  await lab.set({ fpslimit: 240 });
  await lab.page.waitForTimeout(4000);
  const text = await lab.page.evaluate(() => document.getElementById("fps-readout").textContent);
  console.log(`${label}: ${text.trim()}`);
}

/**
 * Views where slice 13's disk-light check had enough pixels to judge, and — the
 * one that matters — where the NEGATIVE CONTROL ran as well.
 *
 * Counted separately because they come apart: at a = 0.998 from the default
 * camera every band pixel the march leaves dark gains a crossing, so the
 * control group is empty and only the absolute gain is checked there. A run
 * that never once evaluated the control would otherwise pass green, which is
 * the failure countCapped's own comment names — a check that can miss is worse
 * than none.
 */
let judged = 0;
let controlled = 0;
const tally = (r) => {
  judged += r.judged;
  controlled += r.controlled;
};
// Slice 18 keeps its own counter: a jet view that judged would otherwise
// satisfy the guard that says slice 13 was judged somewhere, and the two run
// at different cameras for different reasons.
let jetJudged = 0;
const jetTally = (r) => {
  jetJudged += r.judged;
};

const lab = await openLab({ controls: { spin: SPINS[0], timespeed: 0, "edu-ladder": true } });
try {
  console.log(`lab found at ${lab.url}`);
  console.log(`renderer: ${lab.renderer}`);
  console.log(`frame: ${lab.framePeriod.toFixed(1)} ms, capture: ${lab.capturePeriod} ms\n`);
  for (const spin of SPINS) {
    await lab.set({ spin });
    await lab.settle();
    tally(await checkView(lab, "default camera"));
  }
  // Slice 18, at the default camera and before anything drags it. This is the
  // camera the stratum was measured at, and it is the far side of the same
  // geometry that rules out the pitch clamp: near the axis the camera is inside
  // the jet's cone and every march starts in the jet, so there is nothing left
  // to match against. a = 0 is not asked — with no frame dragging the band is
  // thin and its rays stay near the equatorial plane, where the jet is not.
  for (const spin of [0.998, 0.9]) {
    await lab.set({ spin });
    await lab.settle();
    jetTally(await checkJetLight(lab, "jet, default camera"));
  }
  // and at the pitch clamp, which is where the pole crossings are. The camera
  // has no control to set — it is dragged, and the clamp is main.ts own — so
  // this drags well past it and reads back where it landed.
  const box = await lab.page.evaluate(() => {
    const r = document.getElementById("view").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await lab.page.mouse.move(box.x, box.y);
  await lab.page.mouse.down();
  await lab.page.mouse.move(box.x, box.y - 900, { steps: 20 });
  await lab.page.mouse.up();
  await lab.settle();
  for (const spin of [0.9, 0.998]) {
    await lab.set({ spin });
    await lab.settle();
    tally(await checkView(lab, "pitch clamp"));
  }
  if (judged === 0) fail("no view had enough band px to judge slice 13's disk light");
  if (controlled === 0)
    fail("slice 13's negative control never ran — every view was lit-only");
  if (jetJudged === 0)
    fail("no view had enough band px to judge slice 18's jet light");
  await lab.set({ "edu-ladder": false, timespeed: 1 });
  await frameTime(lab, "\nframe time at the pitch clamp, ladder off");
  await lab.set({ "edu-ladder": true });
  await frameTime(lab, "frame rate at the pitch clamp, ladder on (60 = the display's ceiling)");
} finally {
  await lab.close();
  await vite.close();
}

console.log(failed ? "\nband FAILED" : `\nband ok - shots in ${OUT_DIR}`);
process.exit(failed ? 1 : 0);
