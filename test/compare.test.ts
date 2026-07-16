import { describe, expect, it } from "vitest";
import { COMPARE_SPIN_LEFT, sideLabel, splitMidpoint, splitViewports } from "../src/compare";

describe("splitViewports", () => {
  it("gives both sides exactly equal width", () => {
    // The comparison's whole premise is that only the spin differs, so a
    // side that is even 1 px wider — and therefore at a different aspect —
    // would scale its shadow differently and forge a difference spin didn't
    // make. Checked across odd/even widths, gutters and offsets.
    for (const w of [1280, 1281, 1600, 1601, 999]) {
      for (const g of [0, 3, 4]) {
        for (const x0 of [0, 264, 265]) {
          const { left, right } = splitViewports(x0, w, 720, g);
          expect(left.w).toBe(right.w);
        }
      }
    }
  });

  it("fills the region exactly, from x0 to x0 + w", () => {
    const { left, right } = splitViewports(264, 1016, 720, 3);
    expect(left.x).toBe(264);
    expect(right.x + right.w).toBe(264 + 1016);
  });

  it("keeps the halves symmetric about the region's midpoint", () => {
    const x0 = 264;
    const w = 1017; // odd, so the rounding has somewhere to go
    const { left, right } = splitViewports(x0, w, 720, 3);
    const mid = splitMidpoint(x0, w);
    expect(mid - (left.x + left.w)).toBeCloseTo(right.x - mid, 10);
  });

  it("leaves a gutter at least as wide as asked, absorbing the odd pixel", () => {
    for (const w of [1016, 1017]) {
      const { left, right } = splitViewports(264, w, 720, 3);
      expect(right.x - (left.x + left.w)).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns integer viewports even from fractional CSS-to-target scaling", () => {
    // gl.viewport takes integers; the caller scales CSS px by a fractional
    // quality scale (0.72 on medium), so the rounding has to happen in here.
    const { left, right } = splitViewports(264 * 0.72, 1016 * 0.72, 518, 3 * 0.72);
    for (const v of [left.x, left.w, right.x, right.w]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("passes the height through and anchors at y = 0", () => {
    const { left, right } = splitViewports(0, 1280, 721, 3);
    expect(left.h).toBe(721);
    expect(right.h).toBe(721);
    expect(left.y).toBe(0);
    expect(right.y).toBe(0);
  });

  it("degrades to empty viewports when the region cannot hold the gutter", () => {
    // Drawing nothing is the right failure: a negative width would be a GL error.
    const { left, right } = splitViewports(264, 2, 100, 8);
    expect(left.w).toBe(0);
    expect(right.w).toBe(0);
  });

  it("puts both holes clear of the panel column at a narrow window", () => {
    // The regression this offset exists for: splitting the FULL frame at
    // 1000 px puts the left viewport's centre at 250, behind a panel whose
    // right edge is 252 — the Schwarzschild hole would be invisible in the
    // one mode built to look at it.
    const panelRight = 252;
    const cssW = 1000;
    const { left, right } = splitViewports(264, cssW - 264, 720, 3);
    expect(left.x + left.w / 2).toBeGreaterThan(panelRight);
    expect(right.x + right.w / 2).toBeGreaterThan(panelRight);
    expect(right.x + right.w).toBeLessThanOrEqual(cssW);
  });
});

describe("sideLabel", () => {
  it("names the non-spinning side Schwarzschild", () => {
    expect(sideLabel(COMPARE_SPIN_LEFT)).toContain("Schwarzschild");
    expect(sideLabel(0)).not.toContain("Kerr");
  });

  it("names a spinning side Kerr and shows a at the slider's resolution", () => {
    // the spin slider steps by 0.002, so two decimals would collapse steps
    expect(sideLabel(0.7)).toBe("Kerr · a = 0.700");
    expect(sideLabel(0.998)).toContain("0.998");
  });
});
