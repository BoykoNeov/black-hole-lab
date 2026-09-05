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
 * 2. What frame rate to budget for: the user's limit, or the display's own
 *    refresh, whichever is lower. A limit above the refresh rate asks for
 *    frames no display can show, and the controller answered by shrinking the
 *    picture for them.
 *
 * 3. Adaptive render scale. Cost is proportional to the number of pixels
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
 *  the composite, the HUD and the browser's own compositing take the rest.
 *  The rate passed in should be `budgetFps`, not the slider's own value. */
export const frameBudgetMs = (fpsLimit: number): number => 1000 / fpsLimit;
export const sceneBudgetMs = (fpsLimit: number): number => 0.8 * frameBudgetMs(fpsLimit);

/**
 * Drawn-frame intervals kept for the display estimate below. Short on purpose:
 * the estimate has to be armed before the controller's first decision, which
 * arrives after AUTO.window frames, or the frames before it are judged against
 * a rate the display cannot show and the scale is already falling by the time
 * the clamp exists.
 */
export const FRAME_RING = 32;

/** No display shows fewer frames than this; see displayHz. */
export const DISPLAY_HZ_FLOOR = 60;

/**
 * How many frames a second the display can actually show, from the intervals
 * between drawn frames.
 *
 * The SECOND smallest, not the smallest: one spurious short interval — a
 * doubled callback, a resume after the tab was hidden — would otherwise read
 * as a 1000 Hz display and quietly switch the clamp off, and the symptom of
 * that is the old collapse coming back now and then rather than an error.
 *
 * Floored at 60 because the estimate is only trustworthy in one direction. An
 * interval longer than the display's period can mean a slow GPU as easily as a
 * slow panel, and believing a slow GPU's own frame rate is the display's is a
 * deadlock: the frame is over budget only against a budget the frame itself
 * set, so nothing is ever over budget and the scale never falls. Nothing sold
 * this century refreshes below 60, so the floor costs nothing real.
 *
 * Infinity when there is not enough history yet, which leaves the caller's own
 * limit standing.
 */
export function displayHz(intervalsMs: ArrayLike<number>): number {
  let first = Infinity;
  let second = Infinity;
  for (let i = 0; i < intervalsMs.length; i++) {
    const v = intervalsMs[i];
    if (!(v > 0) || !Number.isFinite(v)) continue;
    if (v < first) {
      second = first;
      first = v;
    } else if (v < second) second = v;
  }
  if (!Number.isFinite(second)) return Infinity;
  return Math.max(DISPLAY_HZ_FLOOR, 1000 / second);
}

/**
 * The frame rate the controller should budget for: the user's limit, or what
 * the display can show, whichever is lower.
 *
 * rAF is vsync-paced, so a limit above the refresh rate is already a no-op for
 * the renderer — main.ts's own frame gate says so, and turns itself off at the
 * top of the slider. The controller was not told, and judged frames against a
 * period no display could deliver: every frame read as over budget however
 * small the picture got, because shrinking the render cannot shorten a frame
 * that is waiting for vsync. Without a GPU timer that walked the scale to the
 * bottom of the range and held it there; with one it merely gave away a step
 * or two. Neither bought a single frame.
 *
 * When the limit DOES bind, the drawn-frame interval is the limit's own period,
 * so the estimate comes back equal to the limit and this returns it unchanged.
 * The clamp only bites where the limit was never the thing pacing the frame.
 */
export const budgetFps = (fpsLimit: number, intervalsMs: ArrayLike<number>): number =>
  Math.min(fpsLimit, displayHz(intervalsMs));

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
