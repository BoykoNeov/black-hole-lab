/**
 * Slice 7: side-by-side comparison of two spacetimes.
 *
 * The lab renders one camera into two viewports of the same frame: the left
 * half at a = 0, the right at the spin slider's a. Everything else — camera,
 * mass, accretion rate, disk knobs, star orbital elements — is held identical,
 * so every difference on screen is the spin's doing and nothing else's.
 *
 * Only the layout math lives here (pure, so it is tested); the GL and HUD
 * wiring that consumes it stays in main.ts / hud.ts.
 */

/** The left view is always Schwarzschild — that is the mode's whole premise. */
export const COMPARE_SPIN_LEFT = 0;

/**
 * Gap between the two views, in CSS px. The bloom pyramid blurs the scene
 * target as one image and cannot be told about the seam, so a bright disk
 * lobe on one side always bleeds a little glow into the other; the gutter is
 * drawn over by the HUD's divider, which hides the worst of it.
 */
export const COMPARE_GUTTER = 3;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Split {
  left: Rect;
  right: Rect;
}

/**
 * Split the region [x0, x0 + w] of a frame into two equal viewports with a
 * gutter between them.
 *
 * Both halves get exactly the same width — the gutter absorbs the odd pixel
 * rather than the sides being 1 px different. Unequal widths would mean
 * unequal aspect ratios, which would scale the two shadows differently and
 * put a spin-independent size difference into the one image whose entire job
 * is to isolate what the spin does.
 *
 * x0 exists because the control panel is an opaque column lying on top of the
 * canvas: splitting the whole frame puts the left half's hole at w/4, which
 * is behind the panel on any window narrower than about 1000 px and has its
 * shadow clipped by it even on wide ones. Comparing two shapes only works if
 * both are on screen, so the split starts clear of the panel instead.
 *
 * Returned in the same coordinate space as the inputs, y = 0 at the bottom
 * (gl.viewport's convention — the HUD flips it). A region too narrow to hold
 * the gutter degrades to two zero-width viewports, which draw nothing.
 */
export function splitViewports(x0: number, w: number, h: number, gutter: number): Split {
  // Rounded here rather than at the call sites: these go straight to
  // gl.viewport, which takes integers, and the caller scales CSS px into the
  // render target by a fractional quality scale.
  const x = Math.round(x0);
  const g = Math.max(0, Math.round(gutter));
  const half = Math.max(0, Math.floor((Math.round(w) - g) / 2));
  return {
    left: { x, y: 0, w: half, h },
    right: { x: x + Math.round(w) - half, y: 0, w: half, h },
  };
}

/** Centre of the split region — where the divider goes. */
export function splitMidpoint(x0: number, w: number): number {
  return x0 + w / 2;
}

/** Names the spacetime a side is showing. */
export function sideLabel(a: number): string {
  return a === 0 ? "Schwarzschild · a = 0" : `Kerr · a = ${a.toFixed(3)}`;
}
