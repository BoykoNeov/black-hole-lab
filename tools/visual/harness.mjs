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

/** Set to skip discovery and use one server. Otherwise the ports are scanned. */
export const LAB_URL = process.env.LAB_URL ?? null;

/**
 * Vite's default, and the fifteen it climbs through when the default is busy.
 *
 * Scanning rather than assuming 5173, because the port says nothing about
 * which project answers on it: vite takes the next free one, so whichever
 * project was started first owns 5173 and this lab lands wherever it lands.
 * A machine running three of these has no fixed port for any of them.
 */
const PORTS = Array.from({ length: 16 }, (_, i) => 5173 + i);

const TITLE = "Black Hole Lab";

/**
 * The first port serving this lab. Any of them will do — vite transforms from
 * disk per request, so even a server left running for days serves current code.
 */
async function discover() {
  const found = await Promise.all(
    PORTS.map(async (port) => {
      try {
        const res = await fetch(`http://localhost:${port}/`, {
          signal: AbortSignal.timeout(2000),
        });
        return new RegExp(`<title>${TITLE}</title>`).test(await res.text()) ? port : null;
      } catch {
        return null; // nothing listening, or not http — either way, not us
      }
    })
  );
  const port = found.find((p) => p !== null);
  if (!port)
    throw new Error(
      `no ${TITLE} dev server found on ports ${PORTS[0]}-${PORTS[PORTS.length - 1]} — ` +
        `start one with \`npm run dev\` (this harness does not start a server), ` +
        `or set LAB_URL if it is somewhere else`
    );
  return `http://localhost:${port}`;
}

/** Global rule: temp artifacts live outside the repo, never in the git tree. */
export const OUT_DIR = process.env.LAB_OUT ?? "M:/claud_projects/temp/blackhole-shots";

/**
 * SwiftShader via ANGLE. Without these the geodesic shader gets no GL2 context
 * headlessly and every frame comes back blank.
 *
 * Deliberately no `channel: "chrome"` and no `userDataDir`: both would drive
 * the real Chrome install and its profile instead of playwright's own bundled
 * chromium. Keep it that way — close() must never be able to touch a browser
 * a person is using.
 */
const LAUNCH_ARGS = ["--use-gl=angle", "--use-angle=gl", "--enable-unsafe-swiftshader"];

/** Wide enough that both compare halves clear the panel (see COMPARE_X0). */
const VIEWPORT = { width: 1280, height: 800 };

/** 0-255 luma; above this a pixel counts as lit. Dim enough for HUD hairlines. */
const LIT = 16;

/** Trails need this to span an orbit — at the default 30 rings come out as arcs. */
export const TRAIL_TIMESPEED = 120;

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
    const s = canvas.width / L.gl.w;
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
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(installLab);

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
  // first paint rather than merely "loaded".
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById("overlay")).display === "none",
    null,
    { timeout: 60_000 }
  );

  // Pinned, not assumed: at quality "high" the scene target and the HUD are the
  // same size, which keeps every measurement below in one coordinate space.
  // It is already the default — setting it means a leaked state or a changed
  // default cannot quietly reintroduce the mismatch.
  await page.evaluate(setControlsIn, Object.entries({ quality: "high", ...controls }));

  const lab = {
    page,
    url: base,

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
      await page.evaluate(() => {
        window.__shot = undefined;
        window.__shotHud = undefined;
        window.__layout = undefined;
        window.__wantShot = true;
      });
      await page.waitForFunction(
        () => window.__shot && window.__shotHud && window.__layout,
        null,
        { timeout: 15_000 }
      );
      return page.evaluate(() => window.__layout);
    },

    /** Change controls after boot. Camera-moving knobs want a settle() after. */
    async set(next) {
      await page.evaluate(setControlsIn, Object.entries(next));
    },

    /**
     * Let the debounced overlays catch up before shooting.
     *
     * The default covers 6f's worst case, which is much slower than it looks:
     * a 250 ms debounce, and then a full outline is ~540 ms of tracing at
     * a = 0.998 (~66 ms at a = 0) time-sliced at ~3 ms per frame — about 180
     * frames, or ~3 s at 60 fps. Shoot before that and you get a half-traced
     * outline or none at all, which reads exactly like a broken overlay.
     */
    async settle(ms = 4000) {
      await page.waitForTimeout(ms);
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
     * Read this comparatively, never against zero. The residual is never 0
     * even for a ring that closes: the trail is a rolling buffer and the outer
     * stars' periods exceed its span, so a closed ring still repaints. The
     * floor also moves with the machine — measured 0.41 for a = 0 headless
     * here, against a ~0.2 noted on a real GPU — while a walking node sits
     * near 0.94 in both. It is the gap that carries the meaning, so sample the
     * thing you are comparing against in the same run rather than trusting a
     * number written down in a previous one.
     */
    async drift({ layer = "hud", half = null, seconds = 15, threshold = LIT } = {}) {
      await lab.capture();
      await lab.snapshot("__t0", { layer, half, threshold });
      await page.waitForTimeout(seconds * 1000);
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
