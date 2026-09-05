import { describe, expect, it } from "vitest";
import {
  ACCUM_MAX,
  AUTO,
  DISPLAY_HZ_FLOOR,
  autoStep,
  budgetFps,
  displayHz,
  frameBudgetMs,
  jitterOffset,
  makeAutoState,
  quantizeScale,
  scaleFor,
  sceneBudgetMs,
} from "../src/adaptive";

describe("the refinement jitter", () => {
  it("starts at the pixel centre, so an unrefined frame is the plain one", () => {
    expect(jitterOffset(0, [0, 0])).toEqual([0, 0]);
  });

  it("stays inside the pixel for every sample that is ever averaged", () => {
    const o: [number, number] = [0, 0];
    for (let i = 0; i < ACCUM_MAX; i++) {
      jitterOffset(i, o);
      expect(o[0]).toBeGreaterThanOrEqual(-0.5);
      expect(o[0]).toBeLessThan(0.5);
      expect(o[1]).toBeGreaterThanOrEqual(-0.5);
      expect(o[1]).toBeLessThan(0.5);
    }
  });

  it("covers the pixel evenly: every quadrant gets its share of the first 32", () => {
    const o: [number, number] = [0, 0];
    const quad = [0, 0, 0, 0];
    for (let i = 0; i < ACCUM_MAX; i++) {
      jitterOffset(i, o);
      quad[(o[0] < 0 ? 0 : 1) + (o[1] < 0 ? 0 : 2)]++;
    }
    for (const n of quad) expect(n).toBeGreaterThanOrEqual(ACCUM_MAX / 4 - 2);
    // and the mean sits on the centre, so the average image is not shifted
    let sx = 0, sy = 0;
    for (let i = 0; i < ACCUM_MAX; i++) {
      jitterOffset(i, o);
      sx += o[0];
      sy += o[1];
    }
    expect(Math.abs(sx / ACCUM_MAX)).toBeLessThan(0.05);
    expect(Math.abs(sy / ACCUM_MAX)).toBeLessThan(0.05);
  });

  it("never repeats an offset within the averaged run", () => {
    const seen = new Set<string>();
    const o: [number, number] = [0, 0];
    for (let i = 0; i < ACCUM_MAX; i++) {
      jitterOffset(i, o);
      seen.add(`${o[0].toFixed(4)},${o[1].toFixed(4)}`);
    }
    expect(seen.size).toBe(ACCUM_MAX);
  });
});

describe("the scale grid", () => {
  it("snaps onto the step and into range", () => {
    expect(quantizeScale(0.73)).toBeCloseTo(0.75, 10);
    expect(quantizeScale(0.72)).toBeCloseTo(0.7, 10);
    expect(quantizeScale(2)).toBe(AUTO.max);
    expect(quantizeScale(0.01)).toBe(AUTO.min);
  });

  it("follows the square-root cost model, halfway", () => {
    // four times over budget wants half the scale; damped, it goes a quarter
    expect(scaleFor(1, 4, 1)).toBeCloseTo(0.75, 10);
    // on budget: nothing moves
    expect(scaleFor(0.8, 1, 1)).toBeCloseTo(0.8, 10);
  });
});

describe("the controller with a GPU timer", () => {
  // at 60 fps the scene's share is 13.3 ms
  const budget = sceneBudgetMs(60);
  const feed = (st: ReturnType<typeof makeAutoState>, cost: number, fps = 60, n: number = AUTO.window) => {
    let changed = false;
    for (let i = 0; i < n; i++) changed = autoStep(st, cost, fps, true) || changed;
    return changed;
  };

  it("does nothing until a whole window has been gathered", () => {
    const st = makeAutoState(1);
    for (let i = 0; i < AUTO.window - 1; i++) expect(autoStep(st, 100, 60, true)).toBe(false);
    expect(st.scale).toBe(1);
    expect(autoStep(st, 100, 60, true)).toBe(true);
    expect(st.scale).toBeLessThan(1);
  });

  it("converges onto a budget the cost model can meet, and then holds", () => {
    // a machine where full resolution costs 40 ms against the 13.3 ms budget:
    // the model says sqrt(13.3/40) = 0.58, which lands on the 0.55 step
    const st = makeAutoState(1);
    const costAt = (s: number) => 40 * s * s;
    for (let k = 0; k < 20; k++) feed(st, costAt(st.scale));
    expect(costAt(st.scale)).toBeLessThanOrEqual(budget);
    expect(costAt(st.scale)).toBeGreaterThan(AUTO.deadLow * budget);
    const settled = st.scale;
    for (let k = 0; k < 10; k++) expect(feed(st, costAt(st.scale))).toBe(false);
    expect(st.scale).toBe(settled);
  });

  it("cannot stall over budget where the damped step rounds to nothing", () => {
    // 0.6 costs 14.4 against 13.3: the model's half-step is 0.015, under the
    // quantum, and rounding it away used to leave the scale there for good
    const st = makeAutoState(0.6);
    feed(st, 14.4);
    expect(st.scale).toBeCloseTo(0.55, 10);
  });

  it("goes back up when the budget loosens", () => {
    const st = makeAutoState(0.5);
    for (let k = 0; k < 20; k++) feed(st, 2 * st.scale * st.scale);
    expect(st.scale).toBe(AUTO.max);
  });

  it("judges the window's minimum, so stalls cannot move it", () => {
    // fifteen readings that caught a frame-pacing stall and one that saw the
    // work alone: the one is the cost
    const st = makeAutoState(1);
    for (let i = 0; i < AUTO.window - 1; i++) autoStep(st, 16.7, 60, true);
    expect(autoStep(st, 5, 60, true)).toBe(false);
    expect(st.scale).toBe(1);
    // and a window with no clean reading at all is still over budget
    for (let i = 0; i < AUTO.window; i++) autoStep(st, 16.7, 60, true);
    expect(st.scale).toBeLessThan(1);
  });

  it("moves at most three steps down and two up in one decision", () => {
    // a window of stalls reads as a scene ten times over budget; the model
    // would answer with the bottom of the range, the cap with one dip
    const st = makeAutoState(1);
    feed(st, 130);
    expect(st.scale).toBeCloseTo(0.85, 10);
    const up = makeAutoState(0.5);
    feed(up, 0.1);
    expect(up.scale).toBeCloseTo(0.6, 10);
  });

  it("never leaves the grid or the range", () => {
    const st = makeAutoState(1);
    for (let k = 0; k < 30; k++) {
      feed(st, 1000, 240);
      expect(st.scale).toBeGreaterThanOrEqual(AUTO.min);
      expect(Math.abs(st.scale / AUTO.step - Math.round(st.scale / AUTO.step))).toBeLessThan(1e-9);
    }
    expect(st.scale).toBe(AUTO.min);
  });
});

describe("the controller without a GPU timer", () => {
  const period = frameBudgetMs(60);
  const feed = (st: ReturnType<typeof makeAutoState>, cost: number, n: number = AUTO.window) => {
    let changed = false;
    for (let i = 0; i < n; i++) changed = autoStep(st, cost, 60, false) || changed;
    return changed;
  };

  it("steps down when the frame period is clearly over the display's", () => {
    const st = makeAutoState(1);
    expect(feed(st, 3 * period)).toBe(true);
    expect(st.scale).toBeLessThan(1);
  });

  it("does not read a vsync-bound frame as headroom", () => {
    const st = makeAutoState(0.6);
    // a healthy period tells it nothing: no move for a long while
    feed(st, period, AUTO.probeFrames - AUTO.window);
    expect(st.scale).toBe(0.6);
  });

  it("probes up after enough healthy frames, keeps the step if it holds", () => {
    const st = makeAutoState(0.6);
    feed(st, period, AUTO.probeFrames);
    expect(st.scale).toBeCloseTo(0.65, 10);
    expect(st.probeFrom).toBeCloseTo(0.6, 10);
    feed(st, period);
    expect(Number.isNaN(st.probeFrom)).toBe(true);
    expect(st.scale).toBeCloseTo(0.65, 10);
    expect(st.probeAfter).toBe(AUTO.probeFrames);
  });

  it("backs off a probe that breaks the budget, and waits longer next time", () => {
    const st = makeAutoState(0.6);
    feed(st, period, AUTO.probeFrames);
    expect(st.scale).toBeCloseTo(0.65, 10);
    feed(st, 2 * period);
    expect(st.scale).toBeCloseTo(0.6, 10);
    expect(st.probeAfter).toBe(2 * AUTO.probeFrames);
    // the next probe needs twice the quiet
    feed(st, period, AUTO.probeFrames);
    expect(st.scale).toBeCloseTo(0.6, 10);
    feed(st, period, AUTO.probeFrames);
    expect(st.scale).toBeCloseTo(0.65, 10);
  });

  it("caps the back-off", () => {
    const st = makeAutoState(0.6);
    for (let k = 0; k < 12; k++) {
      feed(st, period, st.probeAfter);
      feed(st, 2 * period);
    }
    expect(st.probeAfter).toBe(AUTO.probeMax);
  });
});

describe("the budget", () => {
  it("leaves a fifth of the frame for everything that is not the march", () => {
    expect(frameBudgetMs(60)).toBeCloseTo(16.67, 1);
    expect(sceneBudgetMs(60)).toBeCloseTo(13.33, 1);
    expect(sceneBudgetMs(240)).toBeCloseTo(3.33, 1);
  });
});

describe("the rate the budget is taken from", () => {
  /** A ring of `n` intervals, all `ms` apart, as main.ts keeps them. */
  const ring = (ms: number, n = 32) => new Float64Array(n).fill(ms);

  it("says nothing until it has seen two frames", () => {
    expect(displayHz([])).toBe(Infinity);
    expect(displayHz([6.9])).toBe(Infinity);
    expect(displayHz([6.9, 6.9])).toBeCloseTo(145, 0);
  });

  it("ignores the empty slots of a ring that has not filled", () => {
    const r = new Float64Array(32).fill(NaN);
    r[0] = 6.9;
    r[1] = 6.9;
    expect(displayHz(r)).toBeCloseTo(145, 0);
  });

  it("reads a 144 Hz panel and a 60 Hz one from their intervals", () => {
    expect(displayHz(ring(1000 / 144))).toBeCloseTo(144, 0);
    expect(displayHz(ring(1000 / 60))).toBeCloseTo(60, 0);
  });

  it("survives one spurious short interval, which the minimum would not", () => {
    const r = ring(1000 / 144);
    r[7] = 0.9; // a doubled callback, or a resume
    expect(displayHz(r)).toBeCloseTo(144, 0);
  });

  it("never believes a slow machine's own frame rate is the display's", () => {
    // 40 ms frames are a slow GPU, not a 25 Hz monitor; believing the latter
    // would make every frame in budget and the scale would never fall.
    expect(displayHz(ring(40))).toBe(DISPLAY_HZ_FLOOR);
  });

  it("is a no-op while the user's limit is the thing pacing the frame", () => {
    // 60 fps asked for and 60 delivered on a 144 Hz panel: the drawn-frame
    // interval IS the limit's period, so the estimate hands the limit back.
    expect(budgetFps(60, ring(1000 / 60))).toBeCloseTo(60, 0);
    expect(budgetFps(30, ring(1000 / 30))).toBeCloseTo(30, 0);
    // and a limit under the floor is still the user's to set
    expect(budgetFps(15, ring(1000 / 15))).toBeCloseTo(15, 0);
  });

  it("clamps a limit the display cannot show, at the top of the slider or below", () => {
    const at144 = ring(1000 / 144);
    expect(budgetFps(240, at144)).toBeCloseTo(144, 0);
    expect(budgetFps(200, at144)).toBeCloseTo(144, 0);
    expect(budgetFps(240, ring(1000 / 60))).toBeCloseTo(60, 0);
  });

  it("leaves the limit alone until the ring has something in it", () => {
    expect(budgetFps(240, new Float64Array(32).fill(NaN))).toBe(240);
  });

  it("keeps a vsync-bound frame inside the fallback's budget, which is the bug", () => {
    // Before the clamp: a 144 Hz frame judged against a 240 fps limit read as
    // over budget every window however small the picture got, and the scale
    // walked to the bottom of the range and stayed.
    const period = 1000 / 144;
    const before = makeAutoState(1);
    for (let i = 0; i < 40 * AUTO.window; i++) autoStep(before, period, 240, false);
    expect(before.scale).toBe(AUTO.min);

    const after = makeAutoState(1);
    const r = ring(period);
    for (let i = 0; i < 40 * AUTO.window; i++)
      autoStep(after, period, budgetFps(240, r), false);
    expect(after.scale).toBe(1);
  });

  it("still steps down for a genuinely slow frame at the same limit", () => {
    const st = makeAutoState(1);
    const r = ring(50); // 50 ms frames: the GPU, not the panel
    for (let i = 0; i < AUTO.window; i++) autoStep(st, 50, budgetFps(240, r), false);
    expect(st.scale).toBeLessThan(1);
  });
});
