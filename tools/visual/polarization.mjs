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
 * Only single-crossing pixels are compared. Where a ray pierces the disk more
 * than once the shader combines the two images weighted by their brightness,
 * and reproducing that weighting on the CPU would mean reproducing the disk's
 * turbulence too — a second transcription to get wrong, for no extra coverage
 * of the physics under test.
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

/** Ink shaped enough to have a direction worth reading. */
const MIN_ELONGATION = 0.75;
const MIN_INK = 2500;
/** Degrees. The tick is a few pixels of ink, so its measured axis is grainy. */
const TOLERANCE = 4;
/** Below this the CPU and GPU are comparing noise, not a direction. */
const MIN_DEGREE = 1e-4;

const lab = await openLab({
  // Frozen: this compares two separate frames, so anything still turning
  // between them would be read as ink.
  controls: { spin: 0.9, timespeed: 0 },
});

let failed = false;
try {
  console.log(`lab found at ${lab.url}\n`);
  const cells = await lab.tickField();
  const layout = await lab.page.evaluate(() => window.__layout);
  await lab.shot("polarization.png", { layer: "gl" });

  const cam = layout.cam;
  const { w: W, h: H } = layout.gl;
  const aspect = W / H;
  const tet = buildStaticTetrad(cam.pos, cam.spin, cam.right, cam.up, cam.fwd);

  const strong = cells.filter((c) => c.elong > MIN_ELONGATION && c.weight > MIN_INK);
  let n = 0;
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
    const d = Math.abs((((psi - c.angle) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2);
    const deg = (d * 180) / Math.PI;
    sum += deg;
    worst = Math.max(worst, deg);
    n++;
  }

  const mean = n ? sum / n : NaN;
  console.log(`cells with ink: ${cells.length}, line-like enough to read: ${strong.length}`);
  console.log(`compared ${n} ticks (${skipped} skipped: no single disk crossing there)`);
  console.log(`angle vs src/polarization.ts: mean ${mean.toFixed(2)}°, worst ${worst.toFixed(2)}°`);

  failed = !(n >= 20) || !(worst < TOLERANCE);
  if (n < 20) console.log(`\nFAIL — only ${n} ticks to compare; expected at least 20`);
  if (!(worst < TOLERANCE)) console.log(`\nFAIL — worst tick is ${worst.toFixed(2)}° off`);
} finally {
  await lab.close();
  await vite.close();
}

console.log(failed ? "\npolarization FAILED" : `\npolarization ok — shot in ${OUT_DIR}`);
process.exit(failed ? 1 : 0);
