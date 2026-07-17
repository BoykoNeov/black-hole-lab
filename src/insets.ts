/**
 * Slice 6/7: where the two draggable overlay insets sit, and which one a
 * pointer is over — 6c's effective-potential panel and 6d's embedding funnel.
 *
 * Only the layout math lives here (pure, so it is tested); the DOM reads that
 * feed it, the pointer plumbing and the drawing itself stay in main.ts /
 * hud.ts. That is the bargain compare.ts makes, and this module has a second
 * reason for it: the grip hit-test is called from a pointer handler, outside
 * the render loop, so it must not depend on anything the render loop owns.
 *
 * The panel sizes live here rather than beside the drawing code because the
 * layout and the hit box have to agree with what is drawn to the pixel — a
 * grip you cannot grab where you can see it is the failure mode — so one
 * module owns the geometry and hud.ts draws at it.
 */

import { COMPARE_GUTTER, splitViewports, type Split } from "./compare";

export type InsetId = "pot" | "embed";

/** Which half of compare mode an inset belongs to; null = the single view. */
export type InsetSide = "left" | "right";

export const POTENTIAL_W = 300;
export const POTENTIAL_H = 182;
export const EMBED_W = 260;
export const EMBED_H = 200;

/** Side of the corner grip's hit box, in CSS px. */
export const GRIP_SIZE = 15;

/**
 * Uniform scale bounds for the draggable insets. The floor is where the 9px
 * axis labels stop being readable; the ceiling is roughly a third of a 1080p
 * height, past which an inset stops being an inset.
 */
export const INSET_SCALE_MIN = 0.6;
export const INSET_SCALE_MAX = 2.4;

/** Breathing room between an inset and the edge of the band it sits in. */
export const INSET_MARGIN = 12;

/** Left edge of the potential inset in single view: clear of the #panel column. */
export const POT_X = 280;

/** Grab forgiveness outside the grip's corner, in CSS px. */
const GRIP_HALO = 5;

export interface InsetSpec {
  /** Size at scale 1. */
  W: number;
  H: number;
  /** Signs pointing from the grip corner into the panel body. Both insets are
   *  bottom-anchored and grip the top corner facing the middle of the screen,
   *  so both grow up-and-inward. */
  inX: number;
  inY: number;
  cursor: string;
}

export const INSET_SPEC: Record<InsetId, InsetSpec> = {
  pot: { W: POTENTIAL_W, H: POTENTIAL_H, inX: -1, inY: 1, cursor: "nesw-resize" },
  embed: { W: EMBED_W, H: EMBED_H, inX: 1, inY: 1, cursor: "nwse-resize" },
};

/** Everything about the frame the insets lay out in, in CSS px. */
export interface InsetView {
  /** The GL canvas's CSS size. */
  width: number;
  height: number;
  /** Left edge of compare mode's split region — clear of the #panel column. */
  x0: number;
  compare: boolean;
  scale: Record<InsetId, number>;
  shown: Record<InsetId, boolean>;
}

export interface Grip {
  id: InsetId;
  side: InsetSide | null;
}

/**
 * Compare mode's two halves in CSS px. The render loop builds its own copy in
 * scene-target px to hand to gl.viewport; this one is re-derived from the CSS
 * width rather than divided back out of it, which the 7b outline may not do —
 * that traces the drawn disk and has to land on the very pixels the shader
 * marched. An inset only has to sit *inside* a half, so a rounding pixel
 * either way is invisible.
 */
export function splitCss(view: InsetView): Split {
  const w = Math.max(view.width - view.x0, 0);
  return splitViewports(view.x0, w, view.height, COMPARE_GUTTER);
}

/** The sides an inset draws on: both halves while comparing, else one frame. */
export function insetSides(compare: boolean): (InsetSide | null)[] {
  return compare ? ["left", "right"] : [null];
}

/**
 * The horizontal band an inset anchors in: the frame at large, or in compare
 * mode the one viewport whose spacetime it plots (7c). Both insets keep the
 * single view's convention inside that band — potential against the left edge,
 * funnel against the right — so a half reads like a small copy of the whole.
 */
export function insetBand(
  view: InsetView,
  side: InsetSide | null
): { left: number; right: number } {
  if (side === null) return { left: POT_X, right: view.width - INSET_MARGIN };
  const r = splitCss(view)[side];
  return { left: r.x + INSET_MARGIN, right: r.x + r.w - INSET_MARGIN };
}

/** Top-left of an inset and the corner its grip sits on, in CSS px. */
export function insetBox(
  view: InsetView,
  id: InsetId,
  side: InsetSide | null
): { x: number; y: number; gx: number; gy: number } {
  const s = INSET_SPEC[id];
  const w = s.W * view.scale[id];
  const h = s.H * view.scale[id];
  const band = insetBand(view, side);
  const x = id === "pot" ? band.left : band.right - w;
  const y = view.height - h - INSET_MARGIN;
  return { x, y, gx: id === "pot" ? x + w : x, gy: y };
}

/** Which grip is under (px, py), if any. Embedding first: it is drawn last. */
export function gripUnder(view: InsetView, px: number, py: number): Grip | null {
  for (const id of ["embed", "pot"] as InsetId[]) {
    if (!view.shown[id]) continue;
    for (const side of insetSides(view.compare)) {
      const b = insetBox(view, id, side);
      const s = INSET_SPEC[id];
      const dx = (px - b.gx) * s.inX;
      const dy = (py - b.gy) * s.inY;
      if (dx >= -GRIP_HALO && dx <= GRIP_SIZE && dy >= -GRIP_HALO && dy <= GRIP_SIZE) {
        return { id, side };
      }
    }
  }
  return null;
}

export function sameGrip(g: Grip | null, id: InsetId, side: InsetSide | null): boolean {
  return g !== null && g.id === id && g.side === side;
}

/**
 * The scale a drag of (dx, dy) from the grab point asks for, clamped.
 *
 * Away from the panel body along both axes grows it; the two axes are averaged
 * so the aspect stays locked and the grip tracks the cursor's diagonal. The
 * result is per inset, NOT per side: either grip resizes both halves' copies
 * together. Letting the sides be sized apart would put a difference into the
 * one picture whose whole job is to isolate what the spin does — the same
 * reason splitViewports hands both viewports exactly equal widths.
 */
export function dragScale(id: InsetId, startScale: number, dx: number, dy: number): number {
  const s = INSET_SPEC[id];
  const ds = 0.5 * ((-s.inX * dx) / s.W + (-s.inY * dy) / s.H);
  return Math.min(INSET_SCALE_MAX, Math.max(INSET_SCALE_MIN, startScale + ds));
}
