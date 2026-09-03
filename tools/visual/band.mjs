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
 * Three things only the renderer can answer:
 *
 * 1. **The tripwire.** Since slice 11b the ladder's magenta means one thing:
 *    the continuation spent MINO_MAX_STEPS. It is supposed to read ZERO
 *    everywhere, so counting it is a passing check rather than dead UI. It did
 *    not read zero when slice 12 looked: two pixels at a = 0.998 from the
 *    default camera were clipping a cap 29 steps too small.
 *
 * 2. **Where the rungs fall, against the CPU's own winding.** This is the
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
 * 3. **What the second loop costs**, at the default view and at the pitch
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
 * The scan runs with the disk off: the ladder keeps the scene's own luminance
 * as brightness, and a bright disk pixel leaves no room for a hairline to dip
 * into.
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
const { LADDER_RUNGS, LADDER_UNRESOLVED } = await vite.ssrLoadModule("/src/shaders.ts");

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

/** The CPU's own winding at a pixel, in half-turns, or null where captured. */
function windingAt(cam, tet, W, H, x, y) {
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
  if (rayCaptured(cam.pos, m, cam.spin)) return null;
  const short = traceRayKerr(cam.pos, m, cam.spin, { rEscape: 64, maxSteps: MARCH_MAX_STEPS });
  if (short.escaped) return { w: short.winding, band: false, passages: 0, capped: false };
  // The march's other exits leave garbage the continuation must never be fed.
  if (short.steps < MARCH_MAX_STEPS) return null;
  const rc = rayConstants(cam.pos, m, cam.spin);
  const C = rayPotentials(rc.lambda, rc.q, cam.spin);
  const res = continueToEscape(
    minoStateAt(short.pos, [short.mt, ...short.mv], cam.spin, C),
    C,
    cam.spin
  );
  return { w: short.winding + res.swept, band: true, passages: res.passages, capped: res.capped };
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

  // 2. the hairlines, against the CPU's own winding, on a dim frame
  await lab.set({ disk: false });
  await lab.settle(1200);
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

  await lab.set({ disk: true });
  await lab.settle(1200);
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
 */
async function frameTime(lab, label) {
  await lab.set({ fpslimit: 240 });
  await lab.settle(4000);
  const text = await lab.page.evaluate(() => document.getElementById("fps-readout").textContent);
  console.log(`${label}: ${text.trim()}`);
}

const lab = await openLab({ controls: { spin: SPINS[0], timespeed: 0, "edu-ladder": true } });
try {
  console.log(`lab found at ${lab.url}\n`);
  for (const spin of SPINS) {
    await lab.set({ spin });
    await lab.settle(1500);
    await checkView(lab, "default camera");
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
  await lab.settle(1500);
  for (const spin of [0.9, 0.998]) {
    await lab.set({ spin });
    await lab.settle(1500);
    await checkView(lab, "pitch clamp");
  }
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
