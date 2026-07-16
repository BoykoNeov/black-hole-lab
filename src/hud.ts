/**
 * 2D overlay canvas for the educational HUD (slice 6). DOM/canvas only,
 * deliberately not unit-tested (verified by eye) — all math it will draw
 * comes from edu.ts. The canvas sits above the GL view with
 * pointer-events: none so camera drag/zoom pass straight through.
 */

/** Shared look for every HUD element — matches the control-panel CSS. */
export const HUD_STYLE = {
  font: '12px "Segoe UI", system-ui, sans-serif',
  stroke: "rgba(205,214,244,0.8)",
  accent: "#ffb35c",
} as const;

export function initHud(): CanvasRenderingContext2D {
  const canvas = document.getElementById("hud") as HTMLCanvasElement;
  return canvas.getContext("2d")!;
}

/**
 * Back the canvas at css × dpr but keep all drawing code in CSS pixels via
 * the transform. Safe to call every frame — no-ops unless the size changed
 * (setting canvas.width clears the canvas and resets the transform).
 */
export function resizeHud(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  dpr: number
): void {
  const w = Math.floor(cssW * dpr);
  const h = Math.floor(cssH * dpr);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function clearHud(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number
): void {
  ctx.clearRect(0, 0, cssW, cssH);
}
