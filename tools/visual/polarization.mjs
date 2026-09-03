/**
 * Does the shader's polarization agree with the tested CPU oracle?
 *
 * Run with the dev server up:  npm run dev  (then)  npm run pol
 *
 * Slice 10's physics lives twice: `src/polarization.ts`, which
 * `test/polarization.test.ts` pins against an independent parallel transport,
 * and a GLSL transcription of the same closed form inside the scene shader.
 * Unit tests can reach the first and not the second, and a transcription error
 * — one flipped sign in the Levi-Civita components, one 1-form mistyped —
 * produces a picture that still looks like a polarization map. So this
 * measures the marks the lab actually drew and recomputes each one on the CPU.
 *
 * It reads the drawn ticks rather than the buffer behind them, which also
 * covers the projection and the tick pass: what is compared is the thing the
 * viewer sees. A tick is a straight segment, so its direction is the principal
 * axis of the ink it laid down (harness `tickField`), and the ink is the
 * difference between a ticks-on and a ticks-off frame of the same frozen
 * scene.
 *
 * It sweeps the spin rather than checking one value, because the spin enters
 * the closed form in four places and three of them vanish at a = 0. A wrong
 * sign in a term that stays small at a = 0.9 would sail past a single run.
 *
 * Only single-crossing pixels are compared. Where a ray pierces the disk more
 * than once the shader combines the two images weighted by their brightness,
 * and reproducing that weighting on the CPU would mean reproducing the disk's
 * turbulence too — a second transcription to get wrong, for no extra coverage
 * of the physics under test.
 *
 * Cells where the polarization field turns faster than a couple of degrees
 * PER PIXEL are skipped. At the disk's inner edge, and where its lensed image
 * folds over itself, the field is nearly discontinuous — one measured tick
 * does not stand for a single direction there, and the two sides differ by
 * how far apart their sampling points effectively are rather than by any
 * disagreement about the physics. Measured: the worst cells sit where the
 * answer moves 22 degrees across one pixel, and they differ by 5.
 *
 * The two sides are not integrating the same march: the CPU oracle runs 4000
 * steps where the shader spends MARCH_MAX_STEPS. Agreement is therefore
 * evidence that the crossing RADII have converged by the time the shader
 * stops, which is the useful claim — not that the two integrations are
 * identical, which they are not.
 *
 * Both sides do finish a budget-exhausted ray the same way, though: since
 * slice 13 `pixelPolarization` hands one to the separated continuation and
 * counts the disk crossings it makes, exactly as the shader does. Before that
 * the oracle simply stopped, and the two would have disagreed at band pixels
 * on the COUNT — which is what this tool filters on, so it could not have
 * reported the disagreement.
 */

import { createServer } from "vite";
import { openLab, OUT_DIR } from "./harness.mjs";

/**
 * The oracle is TypeScript and this file is not, so borrow the bundler the
 * repo already depends on rather than adding a TS runner. Middleware mode
 * takes no port — it is here to resolve and transform two modules, not to
 * serve anything; the lab itself is served by the `npm run dev` this tool
 * requires anyway.
 */
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { buildStaticTetrad } = await vite.ssrLoadModule("/src/kerr.ts");
const { pixelPolarization } = await vite.ssrLoadModule("/src/polarization.ts");

/** a = 0 collapses most of the spin's terms; a = 0.998 makes them largest. */
const SPINS = [0, 0.9, 0.998];
/** Ink shaped enough to have a direction worth reading. */
const MIN_ELONGATION = 0.75;
const MIN_INK = 2500;
/** Degrees. The tick is a few pixels of ink, so its measured axis is grainy. */
const TOLERANCE = 4;
/** Below this the CPU and GPU are comparing noise, not a direction. */
const MIN_DEGREE = 1e-4;
/** Fewer than this and the run proved nothing, whatever the angles said. */
const MIN_TICKS = 20;
/** Degrees per pixel above which one tick is not a single direction. */
const MAX_GRADIENT = 2;

let failed = false;

async function checkSpin(lab, spin) {
  await lab.set({ spin });
  await lab.settle(1500);
  const cells = await lab.tickField();
  const layout = await lab.page.evaluate(() => window.__layout);
  await lab.shot(`polarization-a${String(spin).replace(".", "")}.png`, { layer: "gl" });

  const cam = layout.cam;
  const { w: W, h: H } = layout.gl;
  const aspect = W / H;
  const tet = buildStaticTetrad(cam.pos, cam.spin, cam.right, cam.up, cam.fwd);

  /** Separation of two directors, in degrees: they wrap at 180, not 360. */
  const gap = (a, b) =>
    (Math.abs((((a - b) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2) * 180) / Math.PI;

  /** The CPU's angle at a pixel, or NaN where it sees no disk. */
  const angleAt = (x, y) => {
    const nd = [(x / W) * 2 - 1, (1 - y / H) * 2 - 1];
    const v = [nd[0] * cam.tanHalfFov * aspect, nd[1] * cam.tanHalfFov, 1];
    const L = Math.hypot(...v);
    const g = pixelPolarization(cam.pos, cam.spin, tet, [v[0] / L, v[1] / L, 1 / L], {
      rInner: cam.isco,
      rOuter: cam.diskOuter,
    });
    return g.crossings ? -Math.atan2(g.screen[1], g.screen[0]) : NaN;
  };

  const strong = cells.filter((c) => c.elong > MIN_ELONGATION && c.weight > MIN_INK);
  let n = 0;
  let steep = 0;
  let worst = 0;
  let sum = 0;
  let skipped = 0;
  for (const c of strong) {
    // The pixel's own launch direction, built exactly as the shader builds it.
    // The image's y runs down and the normalized device coordinate's runs up.
    const ndc = [(c.x / W) * 2 - 1, (1 - c.y / H) * 2 - 1];
    const nl = [ndc[0] * cam.tanHalfFov * aspect, ndc[1] * cam.tanHalfFov, 1];
    const ln = Math.hypot(...nl);
    const got = pixelPolarization(cam.pos, cam.spin, tet, [nl[0] / ln, nl[1] / ln, 1 / ln], {
      rInner: cam.isco,
      rOuter: cam.diskOuter,
    });
    if (got.crossings !== 1 || got.degree < MIN_DEGREE) {
      skipped++;
      continue;
    }
    // Both are directors, so the difference wraps at 180 degrees, not 360.
    const psi = -Math.atan2(got.screen[1], got.screen[0]); // back into image y
    if (Math.max(gap(psi, angleAt(c.x + 1, c.y)), gap(psi, angleAt(c.x, c.y + 1))) > MAX_GRADIENT) {
      steep++;
      continue;
    }
    const deg = gap(psi, c.angle);
    sum += deg;
    worst = Math.max(worst, deg);
    n++;
  }

  const mean = n ? sum / n : NaN;
  const ok = n >= MIN_TICKS && worst < TOLERANCE;
  if (!ok) failed = true;
  console.log(
    `a = ${spin.toFixed(3)}  ${cells.length} cells with ink, ${strong.length} readable, ` +
      `${n} compared (${skipped} with no single disk crossing, ${steep} where the field ` +
      `turns faster than ${MAX_GRADIENT} deg/px)`
  );
  console.log(
    `          mean ${mean.toFixed(2)}, worst ${worst.toFixed(2)} deg   ${ok ? "ok" : "FAIL"}`
  );
  if (n < MIN_TICKS) console.log(`          FAIL - only ${n} ticks; expected ${MIN_TICKS}`);
  if (!(worst < TOLERANCE))
    console.log(`          FAIL - worst tick ${worst.toFixed(2)} deg > ${TOLERANCE}`);
}

const lab = await openLab({
  // Frozen: this compares two separate frames, so anything still turning
  // between them would be read as ink.
  controls: { spin: SPINS[0], timespeed: 0 },
});
try {
  console.log(`lab found at ${lab.url}\n`);
  for (const spin of SPINS) await checkSpin(lab, spin);
} finally {
  await lab.close();
  await vite.close();
}

console.log(failed ? "\npolarization FAILED" : `\npolarization ok - shots in ${OUT_DIR}`);
process.exit(failed ? 1 : 0);
