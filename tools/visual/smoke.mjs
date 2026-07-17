/**
 * Proves the harness can drive the lab, capture a real frame, and measure it.
 *
 * Run with the dev server up:  npm run dev  (then)  npm run shot
 *
 * This is a smoke run, not a test suite: it checks that the plumbing works at
 * all, so a session doing real visual work starts from something known to be
 * alive. It deliberately does not assert over the control surface — those
 * assertions would be a maintenance tax and would rot with the UI.
 *
 * It also doubles as the worked example of the intended shape: capture once,
 * then measure that frame as many ways as you like.
 */

import { openLab, OUT_DIR, TRAIL_TIMESPEED } from "./harness.mjs";

const results = [];
let failed = false;

function check(name, ok, detail) {
  results.push(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

// Loose on purpose: this asks "did anything render", not "did the right thing
// render". The sky is a bloomed nebula, so a real frame clears this hugely.
const MIN_LIT = 5000;

const lab = await openLab({ controls: { spin: 0.9 } });
try {
  // Which server, not just which port: several vite projects share this range.
  console.log(`lab found at ${lab.url}\n`);
  const layout = await lab.capture();
  check(
    "renderer publishes its layout",
    layout?.gl?.w > 0 && layout?.hud?.w > 0,
    `gl ${layout?.gl?.w}x${layout?.gl?.h}, hud ${layout?.hud?.w}x${layout?.hud?.h}`
  );
  check(
    "scene and hud share one coordinate space at quality=high",
    layout.gl.w === layout.hud.w && layout.gl.h === layout.hud.h,
    `${layout.gl.w}x${layout.gl.h} vs ${layout.hud.w}x${layout.hud.h}`
  );

  const scene = await lab.snapshot("scene", { layer: "gl" });
  check("scene layer is not blank", scene > MIN_LIT, `${scene} lit px`);

  // The whole reason the composite exists: overlays live on their own canvas
  // and are invisible in a GL-only capture. Give 6f its outline first — it is
  // debounced and then traced across frames, so an eager shot shows nothing.
  await lab.set({ "edu-shadow": true });
  await lab.settle();

  await lab.capture();
  const hud = await lab.snapshot("hud", { layer: "hud" });
  check("hud layer carries the overlay", hud > 0, `${hud} lit px`);

  // Counting lit pixels cannot show this: the overlay is drawn over bright
  // sky, which was already above any sane threshold, so the lit set barely
  // moves. Compare the actual pixels of the two layers of this one frame.
  //
  // Bounded both ways, and both bounds mean something. At least `hud`, because
  // the overlay's antialiased edges change more pixels than clear the lit
  // threshold — drawn is always a superset of lit. Well under the frame,
  // because a composite that scaled or offset the layers against each other
  // would light up nearly all of it, and that is the failure worth catching.
  const frame = layout.gl.w * layout.gl.h;
  const overlaid = await lab.pixelDiff("composite", "gl");
  check(
    "composite really carries the hud over the scene",
    overlaid >= hud && overlaid < frame * 0.05,
    `${overlaid} px differ from the scene — hud drew ${hud}, frame is ${frame}`
  );
  check("composite png written", !!(await lab.shot("smoke-composite.png")));

  // Exercises the strip primitive end to end: two halves, one camera, and the
  // per-side overlays slice 7 draws separately for each.
  await lab.set({ compare: true, "edu-trails": true, timespeed: TRAIL_TIMESPEED });
  await lab.settle();
  const cmp = await lab.capture();
  check(
    "compare mode reports a split",
    cmp.compare && cmp.split.left.w > 0,
    `half ${cmp.split.left.w}px`
  );
  check(
    "halves are exactly equal in width",
    cmp.split.left.w === cmp.split.right.w,
    `${cmp.split.left.w} vs ${cmp.split.right.w}`
  );

  const diff = await lab.stripDiff({ layer: "hud" });
  check(
    "the two halves differ (per-side overlays, not one buffer twice)",
    diff.distance > 0.05,
    `jaccard ${diff.distance.toFixed(3)}, ${diff.left} vs ${diff.right} lit px`
  );
  await lab.shot("smoke-compare.png");
} finally {
  await lab.close();
}

console.log(results.join("\n"));
console.log(failed ? "\nsmoke FAILED" : `\nsmoke ok — shots in ${OUT_DIR}`);
process.exit(failed ? 1 : 0);
