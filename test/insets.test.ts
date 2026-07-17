import { describe, expect, it } from "vitest";
import {
  EMBED_W,
  INSET_MARGIN,
  INSET_SCALE_MAX,
  INSET_SCALE_MIN,
  POTENTIAL_W,
  POT_X,
  dragScale,
  gripUnder,
  insetBand,
  insetBox,
  insetSides,
  sameGrip,
  splitCss,
  type InsetView,
} from "../src/insets";

/** The app's own frame: 1600×900, split starting clear of the 252 px panel. */
const view = (over: Partial<InsetView> = {}): InsetView => ({
  width: 1600,
  height: 900,
  x0: 264,
  compare: false,
  scale: { pot: 1, embed: 1 },
  shown: { pot: true, embed: true },
  ...over,
});

describe("insetBand", () => {
  it("anchors the potential left and the funnel right of the whole frame", () => {
    const b = insetBand(view(), null);
    expect(b.left).toBe(POT_X);
    expect(b.right).toBe(1600 - INSET_MARGIN);
  });

  it("gives each half its own band while comparing, inside that half", () => {
    // 7c's premise: a half reads as a small copy of the whole frame's layout,
    // so each side's insets anchor to that side's viewport and not the window.
    const v = view({ compare: true });
    const { left, right } = splitCss(v);
    const bl = insetBand(v, "left");
    const br = insetBand(v, "right");
    expect(bl.left).toBeGreaterThanOrEqual(left.x);
    expect(bl.right).toBeLessThanOrEqual(left.x + left.w);
    expect(br.left).toBeGreaterThanOrEqual(right.x);
    expect(br.right).toBeLessThanOrEqual(right.x + right.w);
  });

  it("never lets a band cross the divider into the other spacetime", () => {
    const v = view({ compare: true });
    const { left, right } = splitCss(v);
    expect(insetBand(v, "left").right).toBeLessThan(right.x);
    expect(insetBand(v, "right").left).toBeGreaterThan(left.x + left.w);
  });
});

describe("insetBox", () => {
  it("keeps both insets bottom-anchored at every scale", () => {
    // The grip is on the top corner, so the bottom edge is what must not move
    // — an inset that walked down the screen as it grew would fall off it.
    for (const s of [INSET_SCALE_MIN, 1, 1.7, INSET_SCALE_MAX]) {
      const v = view({ scale: { pot: s, embed: s } });
      expect(insetBox(v, "pot", null).y + 182 * s).toBeCloseTo(900 - INSET_MARGIN, 10);
      expect(insetBox(v, "embed", null).y + 200 * s).toBeCloseTo(900 - INSET_MARGIN, 10);
    }
  });

  it("grows each inset inward, away from the edge it is anchored to", () => {
    // Both grip the corner facing the middle of the screen, so the potential's
    // left edge and the funnel's right edge are the fixed ones.
    for (const s of [INSET_SCALE_MIN, 1, INSET_SCALE_MAX]) {
      const v = view({ scale: { pot: s, embed: s } });
      expect(insetBox(v, "pot", null).x).toBe(POT_X);
      expect(insetBox(v, "embed", null).x + EMBED_W * s).toBe(1600 - INSET_MARGIN);
    }
  });

  it("puts the grip on the corner that faces the middle of the screen", () => {
    const v = view();
    const pot = insetBox(v, "pot", null);
    const embed = insetBox(v, "embed", null);
    expect(pot.gx).toBe(pot.x + POTENTIAL_W); // top-right of the left-hand panel
    expect(pot.gy).toBe(pot.y);
    expect(embed.gx).toBe(embed.x); // top-left of the right-hand panel
    expect(embed.gy).toBe(embed.y);
  });

  it("keeps each half's pair inside its own viewport at the documented width", () => {
    // The split halves the room each pair has. 1435 px is where the two just
    // touch: each half gets (w − 264 − 3) / 2 and the pair needs
    // POTENTIAL_W + EMBED_W + two margins = 584 of it.
    const v = view({ width: 1435, compare: true });
    const pot = insetBox(v, "pot", "left");
    const embed = insetBox(v, "embed", "left");
    expect(pot.x + POTENTIAL_W).toBe(embed.x);
    const narrow = view({ width: 1434, compare: true });
    expect(insetBox(narrow, "pot", "left").x + POTENTIAL_W).toBeGreaterThan(
      insetBox(narrow, "embed", "left").x
    );
  });

  it("overlaps in single view only below 852 px", () => {
    // Same touch condition without the split: POT_X + POTENTIAL_W against the
    // funnel's right-anchored edge. Single view has far more room than a half.
    const v = view({ width: 852 });
    expect(insetBox(v, "pot", null).x + POTENTIAL_W).toBe(insetBox(v, "embed", null).x);
    const narrow = view({ width: 851 });
    expect(insetBox(narrow, "pot", null).x + POTENTIAL_W).toBeGreaterThan(
      insetBox(narrow, "embed", null).x
    );
  });
});

describe("gripUnder", () => {
  it("hits the grip where it is drawn", () => {
    const v = view();
    const box = insetBox(v, "pot", null);
    expect(gripUnder(v, box.gx, box.gy)).toEqual({ id: "pot", side: null });
  });

  it("forgives a grab just outside the corner but not far outside", () => {
    // The halo exists because the grip is 15 px of line art on a dark scene;
    // without it the panel is only resizable by pixel-hunting.
    const v = view();
    const box = insetBox(v, "pot", null);
    expect(gripUnder(v, box.gx + 5, box.gy)).not.toBeNull();
    expect(gripUnder(v, box.gx + 6, box.gy)).toBeNull();
  });

  it("ignores an inset that is switched off", () => {
    const v = view({ shown: { pot: false, embed: true } });
    const box = insetBox(v, "pot", null);
    expect(gripUnder(v, box.gx, box.gy)).toBeNull();
  });

  it("gives the funnel the overlap, because it is drawn on top", () => {
    // At 852 px the two panels touch, and their grips' hit boxes overlap. The
    // one you can see is the one drawn last, so that is the one you must grab.
    const v = view({ width: 852 });
    const pot = insetBox(v, "pot", null);
    expect(gripUnder(v, pot.gx, pot.gy - 4)).toEqual({ id: "embed", side: null });
    const potOnly = view({ width: 852, shown: { pot: true, embed: false } });
    expect(gripUnder(potOnly, pot.gx, pot.gy - 4)).toEqual({ id: "pot", side: null });
  });

  it("names the side it hit while comparing", () => {
    const v = view({ compare: true });
    for (const side of ["left", "right"] as const) {
      const box = insetBox(v, "pot", side);
      expect(gripUnder(v, box.gx, box.gy)).toEqual({ id: "pot", side });
    }
  });

  it("tracks the grip as its inset is resized", () => {
    // The hit box is derived from the same box the grip is drawn at, so a
    // resize can never leave the two disagreeing.
    const v = view({ scale: { pot: 2, embed: 1 } });
    const box = insetBox(v, "pot", null);
    expect(gripUnder(v, box.gx, box.gy)).toEqual({ id: "pot", side: null });
    expect(gripUnder(view(), box.gx, box.gy)).toBeNull();
  });
});

describe("insetSides", () => {
  it("draws one copy per spacetime on screen", () => {
    expect(insetSides(false)).toEqual([null]);
    expect(insetSides(true)).toEqual(["left", "right"]);
  });
});

describe("sameGrip", () => {
  it("tells one side's grip from the other's", () => {
    // Both halves draw a grip; only the hovered one should light up.
    expect(sameGrip({ id: "pot", side: "left" }, "pot", "left")).toBe(true);
    expect(sameGrip({ id: "pot", side: "left" }, "pot", "right")).toBe(false);
    expect(sameGrip({ id: "pot", side: null }, "embed", null)).toBe(false);
    expect(sameGrip(null, "pot", null)).toBe(false);
  });
});

describe("dragScale", () => {
  it("grows each inset when dragged away from its panel body", () => {
    // The potential grips its top-right corner, the funnel its top-left, so
    // "away" is a different direction for each — but both grow up.
    expect(dragScale("pot", 1, 60, -60)).toBeGreaterThan(1);
    expect(dragScale("pot", 1, -60, 60)).toBeLessThan(1);
    expect(dragScale("embed", 1, -60, -60)).toBeGreaterThan(1);
    expect(dragScale("embed", 1, 60, 60)).toBeLessThan(1);
  });

  it("averages the two axes so the aspect stays locked", () => {
    // One number drives both dimensions; a diagonal drag is the mean of what
    // each axis alone would ask for, which is what keeps the grip under the
    // cursor on the diagonal.
    const x = dragScale("pot", 1, 60, 0);
    const y = dragScale("pot", 1, 0, -60);
    expect(dragScale("pot", 1, 60, -60) - 1).toBeCloseTo(x - 1 + (y - 1), 10);
    expect(x - 1).toBeCloseTo(0.5 * (60 / POTENTIAL_W), 10);
  });

  it("clamps to the readable range whatever the drag asks for", () => {
    expect(dragScale("pot", 1, 1e4, -1e4)).toBe(INSET_SCALE_MAX);
    expect(dragScale("pot", 1, -1e4, 1e4)).toBe(INSET_SCALE_MIN);
    expect(dragScale("embed", 1, -1e4, -1e4)).toBe(INSET_SCALE_MAX);
  });

  it("measures from the scale the drag started at, not the current one", () => {
    // The drag is absolute in the pointer's travel, so a round trip returns
    // exactly where it began rather than accumulating drift.
    expect(dragScale("pot", 1.5, 40, -40)).toBeGreaterThan(1.5);
    expect(dragScale("pot", 1.5, 0, 0)).toBe(1.5);
  });
});
