/**
 * Slice 19: the two pure pieces of "render only what the frame needs".
 *
 * 1. Progressive refinement. The scene shader integrates one geodesic per
 *    pixel per frame, sampled at the pixel's centre, so a frame is a single
 *    sample per pixel and the photon ring's sub-rings — thinner than a pixel
 *    by e^(-gamma) each — alias. While the picture is changing nothing better is
 *    affordable, but a STILL picture (paused, or the clock stopped, and the
 *    camera at rest) can be refined: shift every ray by a sub-pixel offset and
 *    average the frames. `jitterOffset` is the offset sequence.
 *
 * 2. Adaptive render scale. Cost is proportional to the number of pixels
 *    marched, hence to the square of the render scale, so the scale that meets
 *    a frame budget is scale * sqrt(budget / cost). `autoStep` is that
 *    controller with the damping, quantization and hysteresis that keep it
 *    from hunting — and the fallback for a browser that cannot time the GPU,
 *    where a frame period says "over budget" reliably and "under budget"
 *    not at all, because a vsync-bound frame reads the display's period
 *    whatever the GPU cost.
 *
 * Pure, so tested; main.ts owns the GL and DOM halves.
 */

/**
 * Frames averaged before a still picture counts as converged and the march
 * stops. 32 samples per pixel is past what the eye can tell from more, and the
 * running average is kept in float16, whose ten-bit mantissa starts to lose a
 * 1/n contribution well before n reaches the hundreds.
 */
export const ACCUM_MAX = 32;

/**
 * Sub-pixel offset of sample i, in pixels, each component in [-0.5, 0.5).
 *
 * The R2 sequence (the 2-D generalization of the golden ratio: powers of the
 * plastic constant) — a low-discrepancy sequence, so the first n offsets are
 * spread evenly over the pixel for every n, and the average after any number of
 * frames is as good as that number allows. Sample 0 is the pixel centre, so a
 * single unrefined frame is exactly the frame the renderer always drew.
 */
export function jitterOffset(i: number, out: [number, number]): [number, number] {
  const g = 1.324717957244746; // plastic constant: g^3 = g + 1
  const a1 = 1 / g;
  const a2 = 1 / (g * g);
  const fr = (x: number) => x - Math.floor(x);
  out[0] = fr(0.5 + i * a1) - 0.5;
  out[1] = fr(0.5 + i * a2) - 0.5;
  return out;
}

/** Bounds and steps of the adaptive scale. */
export const AUTO = {
  /** The lowest scale worth drawing: below it the disk's structure is gone. */
  min: 0.35,
  max: 1.0,
  /** Scales are quantized to this so the render target is not reallocated
   *  every frame — each change costs a texture allocation. */
  step: 0.05,
  /**
   * Frames of cost gathered before the scale is reconsidered. The MINIMUM of
   * them is what is judged, not the median: measured on an RTX 5090 in
   * headless chromium, the scene span reads its true 1-5 ms most frames and
   * the whole 16.7 ms frame period on the rest, in runs of up to eight, because
   * the GPU stalls on frame pacing inside the span. A stall can only add time,
   * so the smallest reading in a window is the one that saw the work alone; a
   * median took the runs of stalls as cost and hunted the scale up and down.
   */
  window: 16,
  /** Below this fraction of the budget the scale is raised, above one it is
   *  lowered; between the two nothing moves. The band exists because cost is
   *  noisy and a target sitting exactly on a step boundary would otherwise
   *  alternate between two scales forever. */
  deadLow: 0.7,
  /** Without a GPU timer, how many healthy frames earn one tentative step up
   *  (a whole number of windows, since that is how they are counted). */
  probeFrames: 128,
  /** ...and how many more after a probe that failed, doubling each time. */
  probeMax: 2048,
  /** A frame period this far over the budget means the GPU, not vsync, set it. */
  overFactor: 1.2,
  /**
   * The most one decision may move the scale, in steps, down and up. A window
   * with no clean reading in it at all still happens — a run of stalls longer
   * than the window was seen once in a minute — and reads as a scene several
   * times over budget, which the cost model would answer with a plunge to the
   * bottom of the range. Capped, that costs one dip the next window undoes.
   * Down is allowed further than up: a genuinely slow machine wants the
   * landing fast, and a probe past the budget is what up has to fear.
   */
  maxDown: 3,
  maxUp: 2,
} as const;

export interface AutoState {
  /** The scale in force. */
  scale: number;
  /** Costs gathered for the next decision; cleared when one is made. */
  costs: number[];
  /** Fallback only: healthy frames since the last change. */
  quiet: number;
  /** Fallback only: healthy frames a step up currently requires. */
  probeAfter: number;
  /** Fallback only: the scale to fall back to if the current probe fails. */
  probeFrom: number;
}

export const makeAutoState = (scale = 1): AutoState => ({
  scale,
  costs: [],
  quiet: 0,
  probeAfter: AUTO.probeFrames,
  probeFrom: NaN,
});

/** Snap a scale onto the step grid and into range. */
export function quantizeScale(s: number): number {
  const q = Math.round(s / AUTO.step) * AUTO.step;
  return Math.min(AUTO.max, Math.max(AUTO.min, Math.round(q * 1000) / 1000));
}

const minimum = (xs: number[]): number => {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return m;
};

/**
 * The scale the cost model predicts will meet the budget from here, damped
 * halfway so a noisy reading cannot swing it across the whole range at once.
 */
export function scaleFor(scale: number, costMs: number, budgetMs: number): number {
  const ideal = scale * Math.sqrt(budgetMs / Math.max(costMs, 1e-3));
  return quantizeScale(scale + 0.5 * (ideal - scale));
}

/** One frame at the limit, and the scene pass's share of it: the bloom chain,
 *  the composite, the HUD and the browser's own compositing take the rest. */
export const frameBudgetMs = (fpsLimit: number): number => 1000 / fpsLimit;
export const sceneBudgetMs = (fpsLimit: number): number => 0.8 * frameBudgetMs(fpsLimit);

/**
 * Feed one frame's cost. Returns true when `st.scale` changed.
 *
 * `measured` says what `costMs` is: the GPU's own time for the scene pass,
 * judged against the scene's share of the frame — or, when the browser offers
 * no timer, the whole frame's period as seen from the CPU, judged against the
 * whole frame. The first is trusted both ways. The second is trusted only when
 * it exceeds the budget — a frame that took longer than the display allows was
 * held up by the GPU — and otherwise the controller probes: after enough
 * healthy frames it tries one step up, and if that step pushes the period over
 * budget it steps back and waits twice as long before trying again.
 *
 * A move is never smaller than one grid step. The damped model step can be
 * smaller than the quantum, and rounding it away would leave an over-budget
 * scale exactly where it was, forever.
 */
export function autoStep(
  st: AutoState,
  costMs: number,
  fpsLimit: number,
  measured: boolean
): boolean {
  st.costs.push(costMs);
  if (st.costs.length < AUTO.window) return false;
  const cost = minimum(st.costs);
  st.costs.length = 0;
  const before = st.scale;
  const down = (budget: number) =>
    Math.max(
      Math.min(scaleFor(st.scale, cost, budget), quantizeScale(st.scale - AUTO.step)),
      quantizeScale(st.scale - AUTO.maxDown * AUTO.step)
    );
  const up = (budget: number) =>
    Math.min(
      Math.max(scaleFor(st.scale, cost, budget), quantizeScale(st.scale + AUTO.step)),
      quantizeScale(st.scale + AUTO.maxUp * AUTO.step)
    );

  if (measured) {
    const budget = sceneBudgetMs(fpsLimit);
    if (cost > budget) st.scale = down(budget);
    else if (cost < AUTO.deadLow * budget) st.scale = up(budget);
    return st.scale !== before;
  }

  const budget = frameBudgetMs(fpsLimit);
  if (cost > AUTO.overFactor * budget) {
    if (!Number.isNaN(st.probeFrom)) {
      // the probe is what broke it: back off and ask less often
      st.scale = st.probeFrom;
      st.probeFrom = NaN;
      st.probeAfter = Math.min(AUTO.probeMax, st.probeAfter * 2);
    } else {
      st.scale = down(budget);
    }
    st.quiet = 0;
    return st.scale !== before;
  }

  st.quiet += AUTO.window;
  if (!Number.isNaN(st.probeFrom)) {
    // the probe held for a whole window: it is the new floor
    st.probeFrom = NaN;
    st.probeAfter = AUTO.probeFrames;
  }
  if (st.quiet >= st.probeAfter && st.scale < AUTO.max) {
    st.probeFrom = st.scale;
    st.scale = quantizeScale(st.scale + AUTO.step);
    st.quiet = 0;
  }
  return st.scale !== before;
}
