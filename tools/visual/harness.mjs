/**
 * Visual-check harness: drive the lab in a headless browser, capture what it
 * drew, and measure it.
 *
 * This is a *capture-and-measure* harness, deliberately not a golden-image
 * regression suite. WebGL output is not bit-exact across drivers and the scene
 * animates on its own, so stored reference images would fail for reasons that
 * have nothing to do with the code. Everything here instead compares pixels
 * against other pixels from the same run — see stripDiff and drift, which are
 * the actual checks; the screenshotting is plumbing for them.
 *
 * Plain .mjs, not .ts: this needs node APIs, the repo has no @types/node, and
 * tsconfig covers src + test. A .ts file here would either break `npm run
 * build` or need a new dependency to earn nothing.
 *
 * Not run by `npm test` (vitest globs *.test.ts) and not typechecked by
 * `npm run build`. Assumes `npm run dev` is already serving; it will not start
 * or stop a server.
 *
 * Usage:
 *   const lab = await openLab({ controls: { spin: 0.9, "edu-trails": true } });
 *   await lab.shot("kerr.png");
 *   await lab.close();
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PORTS, TITLE, findServer } from "../find-server.mjs";

/**
 * Tick spacing, mirrored from src/shaders.ts. Plain .mjs cannot import the TS
 * module, so this is the one number the harness restates — and tickField's
 * caller can override it if it ever moves.
 */
export const TICK_PITCH = 26;

/**
 * How far from a cell centre a tick's own ink can reach, as a fraction of the
 * pitch: the shader's longest half-tick (TICK_MAX_LENGTH) plus a little for
 * the antialiased end. Ink beyond it belongs to a neighbouring mark.
 */
export const TICK_REACH = 0.47;

/** Set to skip discovery and use one server. Otherwise the ports are scanned. */
export const LAB_URL = process.env.LAB_URL ?? null;

/** Shared with the launcher, so the two cannot disagree about which server is ours. */
async function discover() {
  const url = await findServer();
  if (!url)
    throw new Error(
      `no ${TITLE} dev server found on ports ${PORTS[0]}-${PORTS[PORTS.length - 1]} — ` +
        `start one with \`npm run dev\` (this harness does not start a server), ` +
        `or set LAB_URL if it is somewhere else`
    );
  return url;
}

/**
 * A chromium to drive instead of the one playwright's own version wants to
 * download. Playwright pins a browser build per release and refuses any other,
 * so on a machine with a preinstalled chromium (a CI image, a sandbox with no
 * network) this is the difference between measuring and "run npx playwright
 * install". Still headless, still not anyone's real Chrome profile.
 */
export const LAB_CHROMIUM = process.env.LAB_CHROMIUM ?? null;

/** Global rule: temp artifacts live outside the repo, never in the git tree. */
export const OUT_DIR = process.env.LAB_OUT ?? "M:/claud_projects/temp/blackhole-shots";

/**
 * Force ANGLE's software rasterizer even where a GPU is available.
 *
 * This is how the no-GPU claim gets tested on a machine that has one. The
 * default `--use-angle=gl` reaches the real driver, so a run here says nothing
 * about a CI image or a sandbox; `LAB_SOFTWARE_GL=1` puts the same frames
 * through SwiftShader, where one costs seconds instead of milliseconds and
 * every wait in here has to survive it. Slow on purpose — not for routine use.
 */
export const LAB_SOFTWARE_GL = process.env.LAB_SOFTWARE_GL === "1";

/**
 * Open a real window instead of drawing headlessly.
 *
 * Headless chromium paces frames on a timer of its own, not on a display's
 * vsync, and slice 19's whole picture of what the GPU timer reads — the true
 * cost most frames, the frame period on the rest — came from that pacing. The
 * only way to know whether a monitor behaves the same is to put the same
 * measurement in front of one. Nothing else changes: still playwright's own
 * chromium, still its own throwaway profile, so close() still cannot reach a
 * browser a person is using.
 *
 * The window is subject to the desktop it opens on. A viewport taller than the
 * screen minus the window chrome is silently shrunk, and an occluded or
 * unfocused window has its frame callbacks throttled — a measurement taken
 * through one is fiction that looks like data. Anything measuring here should
 * report the size and the frame period it actually saw.
 */
export const LAB_HEADED = process.env.LAB_HEADED === "1";

/**
 * Hide the GPU timer extension from the page, so the auto preset falls back to
 * judging the frame period.
 *
 * That branch is what Firefox and Safari get, and it had only ever been unit
 * tested — a browser without the extension is also a browser with a different
 * driver, a different compositor and a different GPU, so a run there could not
 * say which of those the fallback was answering. Withholding the extension in
 * the same chromium on the same machine leaves exactly one variable changed.
 */
export const LAB_NO_TIMER = process.env.LAB_NO_TIMER === "1";

/** The page-side half of LAB_NO_TIMER; must run before any GL context exists. */
function hideTimerExtension() {
  const real = WebGL2RenderingContext.prototype.getExtension;
  WebGL2RenderingContext.prototype.getExtension = function (name) {
    return name === "EXT_disjoint_timer_query_webgl2" ? null : real.call(this, name);
  };
}

/**
 * SwiftShader via ANGLE. Without these the geodesic shader gets no GL2 context
 * headlessly and every frame comes back blank.
 *
 * Deliberately no `channel: "chrome"` and no `userDataDir`: both would drive
 * the real Chrome install and its profile instead of playwright's own bundled
 * chromium. Keep it that way — close() must never be able to touch a browser
 * a person is using.
 */
const LAUNCH_ARGS = [
  "--use-gl=angle",
  LAB_SOFTWARE_GL ? "--use-angle=swiftshader" : "--use-angle=gl",
  "--enable-unsafe-swiftshader",
];

/**
 * The single untuned number in here: how long ONE frame may take before the
 * machine counts as dead rather than merely slow. A GPU frame measured 15-24 ms
 * across runs and a 1280x800 SwiftShader frame 132-258 ms, so three minutes is
 * not a budget, it is a floor under "nothing is happening at all".
 */
const FRAME_CAP_MS = 180_000;

/** Frames timed at boot for the report. Enough to average out one hitch. */
const PERIOD_FRAMES = 4;

/**
 * The ceiling for the ONE frame a capture rides on, which is not an ordinary
 * frame: the renderer's hook runs toDataURL on both canvases inside it, and
 * reading a WebGL drawing buffer back and PNG encoding it is CPU work with no
 * relation to how fast the shader ran. One run here measured 15.3 ms per frame
 * against 51 ms per capture on the GPU; one run under SwiftShader measured
 * 157.8 ms against 74,245 ms. The frame got ten times slower and the capture
 * roughly a thousand — one boot sample of each, so read that second ratio as an
 * order of magnitude. No factor connects them, and the frame ceiling alone
 * cannot cover both.
 *
 * So the boot measurement RAISES the ceiling where the machine says a capture
 * is expensive; it never lowers it. It is not a predicted budget for work of
 * unknown length — that is the thing this slice exists to stop doing.
 */
const captureCeiling = (capturePeriodMs) =>
  Math.max(FRAME_CAP_MS, Math.ceil(8 * capturePeriodMs));

/** How far the renderer has got. Monotonic; see main.ts on why not `frames`. */
const frameCount = (page) => page.evaluate(() => window.__frames ?? 0);

/**
 * Wait until n more frames have been DRAWN, not until a clock says they should
 * have.
 *
 * Waits on PROGRESS, not on a total: the loop asks only for the next frame,
 * and only that one frame is on a timeout. So n frames may cost anything at
 * all and the wait still returns, while a renderer that has genuinely stopped
 * still fails within FRAME_CAP_MS. A budget for the whole run of n cannot do
 * both, and it does not need to be far wrong to be useless — measured, a boot
 * calibration under SwiftShader mispredicted a later 64-frame wait by more
 * than 8x, because by then compare mode was on and every frame was drawing the
 * scene twice.
 */
async function waitFrames(page, n, ceilingMs = FRAME_CAP_MS) {
  const target = (await frameCount(page)) + n;
  for (let seen = -1; seen < target; ) {
    await page.waitForFunction(
      (last) => (window.__frames ?? 0) > last,
      seen,
      { timeout: ceilingMs }
    );
    seen = await frameCount(page);
  }
}

/**
 * Freeze one frame and return the layout it was drawn with. Hoisted out of the
 * lab so that boot can time one before the lab exists — see capturePeriod.
 *
 * This waits on the frame counter like everything else, rather than polling for
 * the data URLs to appear, and that is exact rather than a convenience:
 * main.ts increments the counter immediately ABOVE the shot hook and inside the
 * same synchronous render call (both of render's early returns sit above the
 * increment, so a frame that counts is a frame that reaches the hook). A
 * predicate polled from outside can only run BETWEEN render calls, so seeing
 * the counter move after the flag is set is proof the encode already finished.
 * The capture is therefore one frame's progress — an expensive frame, hence
 * its own ceiling, but not an unbounded wait needing a guessed budget.
 */
async function captureFrame(page, ceilingMs) {
  await page.evaluate(() => {
    window.__shot = undefined;
    window.__shotHud = undefined;
    window.__layout = undefined;
    window.__wantShot = true;
  });
  await waitFrames(page, 1, ceilingMs);
  return page.evaluate(() => window.__layout);
}

/** Wide enough that both compare halves clear the panel (see COMPARE_X0). */
const VIEWPORT = { width: 1280, height: 800 };

/** 0-255 luma; above this a pixel counts as lit. Dim enough for HUD hairlines. */
const LIT = 16;

/** Trails need this to span an orbit — at the default 30 rings come out as arcs. */
export const TRAIL_TIMESPEED = 120;

/**
 * Frames to let a trail fill, which is the honest unit for it: a Trail records
 * at most one sample per frame (TRAIL_MIN_DT gates on simulation time, and at
 * TRAIL_TIMESPEED even a 16 ms frame clears it), so a buffer's fill is a frame
 * count and never a duration. Half of TRAIL_CAP_STAR — enough that a star's
 * trail is an arc rather than a dot, without paying for a full buffer on a
 * machine where a frame costs seconds.
 */
export const TRAIL_FRAMES = 64;

/**
 * In-page half of the harness. Defined here and injected once, so the pixel
 * math runs where the pixels are: shipping ImageData to node would mean
 * decoding PNGs there, and that would mean a new dependency for what is
 * twenty lines of loop.
 *
 * Lit-pixel sets stay in the page for the same reason — a Set of 10^6 indices
 * does not want to cross the bridge. Only counts and ratios come back.
 */
function installLab() {
  const lab = {};

  const decode = async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return img;
  };

  const draw = (w, h, paint) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    paint(c.getContext("2d", { willReadFrequently: true }), c);
    return c;
  };

  /**
   * A layer as a 2D canvas: "gl" (scene), "hud" (overlays), "composite".
   *
   * All three come out of the same frozen frame, so any two of them are
   * comparable to each other — that is the whole point of the renderer taking
   * both canvases at once rather than this reading #hud live.
   */
  lab.layer = async (name) => {
    if (!window.__shot || !window.__shotHud) throw new Error("no frame — capture() first");
    const scene = await decode(window.__shot);
    const hud = await decode(window.__shotHud);

    if (name === "gl") return draw(scene.width, scene.height, (ctx) => ctx.drawImage(scene, 0, 0));
    if (name === "hud") return draw(hud.width, hud.height, (ctx) => ctx.drawImage(hud, 0, 0));
    // Composite at the HUD's size: it carries the true dpr while the scene may
    // be rendered smaller, so scaling the scene up keeps overlay text sharp.
    return draw(hud.width, hud.height, (ctx, c) => {
      ctx.drawImage(scene, 0, 0, c.width, c.height);
      ctx.drawImage(hud, 0, 0);
    });
  };

  /**
   * The x-span of one compare half in a layer's own pixels, from the layout the
   * renderer published. Scaled off __layout.gl because a layer may be a
   * different size than the scene target; x/w only, since the split's y is
   * gl.viewport's bottom-up convention and these strips are full height anyway.
   */
  lab.strip = (canvas, half) => {
    if (!half) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
    const L = window.__layout;
    if (!L) throw new Error("no __layout — capture() first");
    if (!L.compare) throw new Error("strips need compare mode on");
    const r = L.split[half];
    // The split is in the scene target's pixels, which since slice 19 is the
    // canvas's size only at scale 1 — the composite resamples it to the frame.
    const s = canvas.width / (L.scene ?? L.gl).w;
    return { x: Math.round(r.x * s), y: 0, w: Math.round(r.w * s), h: canvas.height };
  };

  /**
   * Pixels that differ between two layers of the same frame. Unlike litSet
   * this is not a threshold on brightness, so it still sees an overlay drawn
   * over bright sky — which lit-set comparisons cannot (see litSet's note).
   */
  lab.pixelDiff = async (aName, bName, half, tol) => {
    const [ca, cb] = [await lab.layer(aName), await lab.layer(bName)];
    if (ca.width !== cb.width || ca.height !== cb.height)
      throw new Error(`layers differ in size: ${aName} vs ${bName}`);
    const r = lab.strip(ca, half);
    const px = (c) =>
      c.getContext("2d", { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h).data;
    const [da, db] = [px(ca), px(cb)];
    let n = 0;
    for (let i = 0, len = r.w * r.h; i < len; i++) {
      const o = i * 4;
      if (
        Math.abs(da[o] - db[o]) > tol ||
        Math.abs(da[o + 1] - db[o + 1]) > tol ||
        Math.abs(da[o + 2] - db[o + 2]) > tol
      )
        n++;
    }
    return n;
  };

  /**
   * Indices of lit pixels, packed relative to the strip's own origin so that
   * two different strips are comparable to each other.
   *
   * Note the sky is a bloomed nebula, not black: on the "gl" layer nearly
   * every pixel clears a low threshold, so a lit set there is close to "all of
   * them" and says little. This is meant for the "hud" layer, which is
   * transparent except where an overlay actually drew.
   */
  lab.litSet = async (layerName, half, threshold) => {
    const c = await lab.layer(layerName);
    const r = lab.strip(c, half);
    const d = c.getContext("2d", { willReadFrequently: true })
      .getImageData(r.x, r.y, r.w, r.h).data;
    const set = new Set();
    for (let i = 0, n = r.w * r.h; i < n; i++) {
      const o = i * 4;
      const a = d[o + 3];
      if (a === 0) continue; // the HUD is mostly transparent
      const lum = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) * (a / 255);
      if (lum >= threshold) set.add(i);
    }
    return set;
  };

  /**
   * Orientation of each drawn polarization tick (slice 10), from the
   * DIFFERENCE between a ticks-on and a ticks-off frame of the same frozen
   * scene — so what is measured is the mark the viewer sees, not a buffer
   * behind it.
   *
   * A tick is a straight segment, so its direction is the principal axis of
   * the ink it laid down: second moments about the cell centre, then a
   * half-angle. `elong` says how line-like the ink was, which is what
   * separates a real tick from a stray pixel or two.
   *
   * Angles come back in IMAGE coordinates, where y grows downward — the
   * opposite of the screen convention the shader projects into, so a caller
   * comparing against the CPU has a sign to flip.
   *
   * The rows are counted from the BOTTOM, because that is where GL's origin
   * is and therefore where the shader's tick grid starts. Counting them from
   * the top instead puts every cell boundary half a tick out whenever the
   * frame height is not a multiple of the pitch, and each measured cell then
   * straddles two real marks and reports the average of their directions.
   */
  lab.tickField = async (onUrl, offUrl, pitch, floor, reach) => {
    const [ia, ib] = [await decode(onUrl), await decode(offUrl)];
    const px = (img) =>
      draw(img.width, img.height, (ctx) => ctx.drawImage(img, 0, 0))
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, img.width, img.height).data;
    const [da, db] = [px(ia), px(ib)];
    const W = ia.width;
    const cells = [];
    for (let cy = 0; cy * pitch < ia.height; cy++) {
      for (let cx = 0; cx * pitch < W; cx++) {
        const ox = (cx + 0.5) * pitch;
        const oy = ia.height - (cy + 0.5) * pitch; // GL counts rows upward
        let sxx = 0, syy = 0, sxy = 0, wsum = 0;
        const x1 = Math.min(W, Math.ceil((cx + 1) * pitch));
        const y1 = Math.min(ia.height, Math.ceil(ia.height - cy * pitch));
        for (let y = Math.max(0, Math.floor(ia.height - (cy + 1) * pitch)); y < y1; y++) {
          for (let x = Math.floor(cx * pitch); x < x1; x++) {
            const o = (y * W + x) * 4;
            const w =
              Math.abs(da[o] - db[o]) +
              Math.abs(da[o + 1] - db[o + 1]) +
              Math.abs(da[o + 2] - db[o + 2]);
            if (w < floor) continue;
            const dx = x + 0.5 - ox;
            const dy = y + 0.5 - oy;
            // A disc, not the whole square cell. The longest tick spans most
            // of the pitch, so its antialiased ends spill past the boundary
            // into the neighbour — and in a second-moment fit that foreign
            // ink sits at the largest lever arm there is, which is where it
            // does the most damage. The radius is the longest half-tick plus
            // a pixel of feathering.
            if (dx * dx + dy * dy > reach * reach) continue;
            sxx += w * dx * dx;
            syy += w * dy * dy;
            sxy += w * dx * dy;
            wsum += w;
          }
        }
        if (wsum <= 0) continue;
        const tr = sxx + syy;
        const disc = Math.sqrt(Math.max((tr * tr) / 4 - (sxx * syy - sxy * sxy), 0));
        const l1 = tr / 2 + disc;
        const l2 = tr / 2 - disc;
        cells.push({
          cx,
          cy,
          x: ox,
          y: oy,
          angle: 0.5 * Math.atan2(2 * sxy, sxx - syy),
          weight: wsum,
          elong: l1 > 0 ? (l1 - l2) / (l1 + l2) : 0,
          // Ink spread along the tick's own axis. A straight segment of half
          // length L has second moment L^2/3 about its centre, so sqrt(3)*rms
          // is that half length — up to a fixed widening from the mark's own
          // 1.6 px of feathered edge, which is why callers compare rms across
          // cells rather than trusting it as an absolute pixel count.
          rms: Math.sqrt(l1 / wsum),
        });
      }
    }
    return cells;
  };

  lab.snap = async (name, layerName, half, threshold) => {
    const s = await lab.litSet(layerName, half, threshold);
    (window.__snaps ??= {})[name] = s;
    return s.size;
  };

  /** 1 - |A∩B|/|A∪B|. 0 = identical pixels, 1 = nothing in common. */
  lab.jaccard = (a, b) => {
    const A = (window.__snaps ?? {})[a];
    const B = (window.__snaps ?? {})[b];
    if (!A || !B) throw new Error(`missing snapshot: ${a} / ${b}`);
    let inter = 0;
    for (const v of A) if (B.has(v)) inter++;
    const union = A.size + B.size - inter;
    return union === 0 ? 0 : 1 - inter / union;
  };

  window.__lab = lab;
}

function setControlsIn(entries) {
  for (const [id, value] of entries) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`no control #${id}`);
    // Each branch fires the event main.ts actually listens for.
    if (el.tagName === "BUTTON") {
      if (value) el.click();
    } else if (el.type === "checkbox") {
      if (el.checked === Boolean(value)) continue;
      el.checked = Boolean(value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.tagName === "SELECT") {
      el.value = String(value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}

/** Write a dataURL out under OUT_DIR. Returns the path written. */
export function savePng(dataUrl, name) {
  const file = resolve(OUT_DIR, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  return file;
}

/**
 * Boot a page onto the running dev server and hand back a driver for it.
 *
 * One lab is one page, by design: camera zoom/orbit state leaks between shots
 * on a reused page, so a second viewpoint means a second lab.
 */
export async function openLab({ controls = {}, viewport = VIEWPORT } = {}) {
  const base = LAB_URL ?? (await discover());
  const browser = await chromium.launch({
    headless: !LAB_HEADED,
    args: LAUNCH_ARGS,
    ...(LAB_CHROMIUM ? { executablePath: LAB_CHROMIUM } : {}),
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(installLab);
  if (LAB_NO_TIMER) await page.addInitScript(hideTimerExtension);

  try {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch (err) {
    await browser.close();
    throw new Error(
      `cannot reach the lab at ${base} — start it with \`npm run dev\` ` +
        `(this harness does not start a server). Cause: ${err.message}`
    );
  }

  // Discovery already matched on this, so this only bites an explicit LAB_URL
  // pointed at the wrong project — which is the case worth a real message,
  // since otherwise the first failure is "getComputedStyle: parameter 1 is not
  // of type 'Element'" out of the first-paint wait below, and that reads as a
  // bug in here rather than as measuring somebody else's page.
  const title = await page.title();
  if (title !== TITLE) {
    await browser.close();
    throw new Error(
      `${base} is serving "${title}", not ${TITLE} — another vite project has ` +
        `this port. Point LAB_URL at the right one, or unset it to scan.`
    );
  }

  // The overlay hides until the shader has compiled and drawn once, so this is
  // first paint rather than merely "loaded". Given the single-frame cap and not
  // a minute: this covers compiling the geodesic integrator AND drawing with
  // it once, and under software GL either half alone can outlast a minute.
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById("overlay")).display === "none",
    null,
    { timeout: FRAME_CAP_MS }
  );

  // Pinned, not assumed: at quality "high" the scene target and the HUD are the
  // same size, which keeps every measurement below in one coordinate space.
  // It is already the default — setting it means a leaked state or a changed
  // default cannot quietly reintroduce the mismatch.
  //
  // Refinement (slice 19) is pinned OFF for the same reason in the other
  // direction: a still scene would otherwise be averaging jittered frames under
  // every capture, and a measurement that differences two captures would then
  // read how far each had converged. The checks here want the plain frame the
  // march draws; smoke.mjs turns refinement on deliberately, to check it.
  await page.evaluate(
    setControlsIn,
    Object.entries({ quality: "high", refine: false, ...controls })
  );

  // What one frame costs HERE, and what one capture costs, which are not the
  // same quantity. Measured after the controls are set, so they are the cost
  // of the scene actually being measured rather than of whatever the defaults
  // draw. Both are reported rather than relied on: every wait below watches
  // the frame counter, and the capture number only raises that wait's ceiling
  // on a machine where a capture is expensive.
  const t0 = Date.now();
  await waitFrames(page, PERIOD_FRAMES);
  const framePeriod = (Date.now() - t0) / PERIOD_FRAMES;
  const t1 = Date.now();
  await captureFrame(page, FRAME_CAP_MS);
  const capturePeriod = Date.now() - t1;

  // Which rasterizer actually answered. Read from a throwaway context rather
  // than the lab's own, and reported rather than asserted on: a run that
  // claims to be testing the no-GPU path should have to show that it was.
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "no webgl2";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  });

  const lab = {
    page,
    url: base,
    /**
     * Measured ms per drawn frame at boot. Reported, not relied on: the waits
     * below watch the frame counter instead, because this number is measured
     * on one scene and the run goes on to draw harder ones.
     */
    framePeriod,
    /** Measured ms per capture, which is readback and PNG, not shading. */
    capturePeriod,
    /** The GL renderer string, so "software GL" is a reading and not a claim. */
    renderer,

    /**
     * Freeze one frame — scene, overlays and the geometry they were drawn
     * with, all from the same render pass — and return its layout.
     *
     * Every reader below works off the last capture and none of them take
     * their own, so two measurements can be compared without the time between
     * them leaking into the answer. Anything that should compare frames (see
     * drift) captures twice, deliberately.
     */
    async capture() {
      return captureFrame(page, captureCeiling(capturePeriod));
    },

    /** Change controls after boot. Camera-moving knobs want a settle() after. */
    async set(next) {
      await page.evaluate(setControlsIn, Object.entries(next));
    },

    /**
     * Let the renderer catch up with the controls before shooting — counted
     * in FRAMES DRAWN, not in milliseconds.
     *
     * The 6f outline used to be the reason for this (debounced, then ~540 ms
     * of tracing time-sliced across ~180 frames); since slice 9 it is exact
     * and immediate, and nothing in the app defers work off the render loop
     * any more. So the default is simply "the frame after the change, and one
     * more" — what a control change actually needs.
     *
     * Trails are the one thing that wants more, and they want frames too, not
     * time: a trail records at most one sample per frame, and simulation time
     * advances by min(real dt, 0.1)*timeSpeed per frame, so on a slow machine
     * a wall-clock wait buys neither samples nor sim time. Those call sites
     * ask for a count and say why.
     */
    async settle(frames = 2) {
      await waitFrames(page, frames);
    },

    /** Render the last capture's layer to a PNG dataURL. */
    async dataUrl({ layer = "composite" } = {}) {
      return page.evaluate(
        (l) => window.__lab.layer(l).then((c) => c.toDataURL("image/png")),
        layer
      );
    },

    /** Write the last capture's layer out as a PNG. Returns its path. */
    async shot(name, { layer = "composite" } = {}) {
      return savePng(await lab.dataUrl({ layer }), name);
    },

    /** Count lit pixels in the last capture; remember the set for jaccard(). */
    async snapshot(name, { layer = "composite", half = null, threshold = LIT } = {}) {
      return page.evaluate(
        ({ name, layer, half, threshold }) => window.__lab.snap(name, layer, half, threshold),
        { name, layer, half, threshold }
      );
    },

    /** Pixels differing between two layers of the last capture. */
    async pixelDiff(a, b, { half = null, tol = 2 } = {}) {
      return page.evaluate(
        ({ a, b, half, tol }) => window.__lab.pixelDiff(a, b, half, tol),
        { a, b, half, tol }
      );
    },

    /**
     * Measure the polarization ticks the lab actually drew.
     *
     * Freeze the clock first (`timespeed: 0`) — this compares two separate
     * frames, so anything still moving between them would be read as ink.
     * Leaves the toggle on.
     */
    async tickField({ pitch, floor = 10, reach } = {}) {
      await lab.set({ "edu-polarization": true });
      const layout = await lab.capture();
      const on = await lab.dataUrl({ layer: "gl" });
      await lab.set({ "edu-polarization": false });
      await lab.capture();
      const off = await lab.dataUrl({ layer: "gl" });
      await lab.set({ "edu-polarization": true });
      const p = pitch ?? TICK_PITCH * (layout.gl.w / layout.css.w);
      const r = reach ?? p * TICK_REACH;
      return page.evaluate(
        ([on, off, p, floor, r]) => window.__lab.tickField(on, off, p, floor, r),
        [on, off, p, floor, r]
      );
    },

    async jaccard(a, b) {
      return page.evaluate(([a, b]) => window.__lab.jaccard(a, b), [a, b]);
    },

    /**
     * Compare mode's two halves share one camera and are exactly equal in
     * width, so their projections are identical and the only thing that can
     * differ between them is the spin. A non-zero distance is proof a per-side
     * overlay is really two renders and not one buffer drawn twice.
     */
    async stripDiff({ layer = "hud", threshold = LIT } = {}) {
      await lab.capture(); // both halves out of one frame, or this measures time
      const left = await lab.snapshot("__left", { layer, half: "left", threshold });
      const right = await lab.snapshot("__right", { layer, half: "right", threshold });
      return { left, right, distance: await lab.jaccard("__left", "__right") };
    },

    /**
     * A closed orbit retraces the same pixels forever; a precessing one keeps
     * moving onto new ones. Sample the same strip twice and measure how far the
     * lit set moved.
     *
     * The gap between the samples is counted in frames because that is what
     * the trail is drawn from: one sample per frame at any speed, and the
     * simulation advancing min(real dt, 0.1) per frame. Fifteen seconds meant
     * ~900 frames on a GPU and one or two on software GL — the same request
     * asking for two completely different measurements. The default is that
     * same ~900, so the residuals recorded below still refer to the gap they
     * were measured across.
     *
     * Read this comparatively, never against zero. The residual is never 0
     * even for a ring that closes: the trail is a rolling buffer and the outer
     * stars' periods exceed its span, so a closed ring still repaints. The
     * floor also moves with the machine — measured 0.41 for a = 0 headless
     * here, against a ~0.2 noted on a real GPU — while a walking node sits
     * near 0.94 in both. It is the gap that carries the meaning, so sample the
     * thing you are comparing against in the same run rather than trusting a
     * number written down in a previous one.
     */
    async drift({ layer = "hud", half = null, frames = 900, threshold = LIT } = {}) {
      await lab.capture();
      await lab.snapshot("__t0", { layer, half, threshold });
      await waitFrames(page, frames);
      await lab.capture(); // the one place two frames is the point, not a bug
      await lab.snapshot("__t1", { layer, half, threshold });
      return lab.jaccard("__t0", "__t1");
    },

    async close() {
      await browser.close();
    },
  };

  return lab;
}
