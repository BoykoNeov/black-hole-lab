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

export interface ClockEntry {
  label: string;
  /** Accumulated proper time in M. */
  tau: number;
  /** dtau/dt, as a fraction of the far-away observer's rate. */
  rate: number;
  /** Body culled — freeze the hand and say so instead of showing a rate. */
  gone: boolean;
}

const CLOCK_R = 17;
const CLOCK_SLOT = 78; // horizontal pitch, wide enough for the rate caption
/** One hand revolution per 60 M of proper time. */
const CLOCK_PERIOD = 60;
const CLOCK_CAPTION =
  "× = rate vs the far-away observer · each clock ticks at its own proper time; deeper + faster = slower";

/**
 * Row of clock faces anchored with its right edge at x, top at y. Draws the
 * first `n` of `entries` so callers can keep one preallocated array and vary
 * the count (the TDE clock comes and goes) without touching the heap.
 */
export function drawClocks(
  ctx: CanvasRenderingContext2D,
  entries: ClockEntry[],
  n: number,
  x: number,
  y: number
): void {
  if (n <= 0) return;
  ctx.save();
  ctx.font = HUD_STYLE.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 1;
  const left = x - n * CLOCK_SLOT;
  const cy = y + CLOCK_R;
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    const cx = left + (i + 0.5) * CLOCK_SLOT;

    ctx.strokeStyle = HUD_STYLE.stroke;
    ctx.beginPath();
    ctx.arc(cx, cy, CLOCK_R, 0, Math.PI * 2);
    ctx.stroke();

    // 12 o'clock mark, so a stopped hand is readable as stopped
    ctx.beginPath();
    ctx.moveTo(cx, cy - CLOCK_R);
    ctx.lineTo(cx, cy - CLOCK_R + 4);
    ctx.stroke();

    const ang = (e.tau / CLOCK_PERIOD) * Math.PI * 2;
    ctx.strokeStyle = e.gone ? "rgba(205,214,244,0.35)" : HUD_STYLE.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(ang) * CLOCK_R * 0.78, cy - Math.cos(ang) * CLOCK_R * 0.78);
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.fillStyle = HUD_STYLE.stroke;
    ctx.fillText(e.label, cx, cy + CLOCK_R + 13);
    ctx.fillStyle = "rgba(205,214,244,0.55)";
    ctx.fillText(
      e.gone ? "gone" : `${e.rate.toFixed(3)}×`,
      cx,
      cy + CLOCK_R + 26
    );
  }
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(205,214,244,0.55)";
  ctx.fillText(CLOCK_CAPTION, x, cy + CLOCK_R + 44);
  ctx.restore();
}
