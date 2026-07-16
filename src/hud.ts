/**
 * 2D overlay canvas for the educational HUD (slice 6). DOM/canvas only,
 * deliberately not unit-tested (verified by eye) — all math it will draw
 * comes from edu.ts. The canvas sits above the GL view with
 * pointer-events: none so camera drag/zoom pass straight through.
 */

import {
  TRAIL_CAP_GAS,
  TRAIL_CAP_STAR,
  TRAIL_CAP_TDE,
  embeddingZAt,
  photonOrbitRadius,
  projectToScreen,
  vEff,
} from "./edu";
import type { EmbeddingProfile, Projected, ShadowEdge, Trail, V3 } from "./edu";
import type { CameraBasis } from "./camera";

/** Shared look for every HUD element — matches the control-panel CSS. */
export const HUD_STYLE = {
  font: '12px "Segoe UI", system-ui, sans-serif',
  small: '10px "Segoe UI", system-ui, sans-serif',
  tiny: '9px "Segoe UI", system-ui, sans-serif',
  stroke: "rgba(205,214,244,0.8)",
  faint: "rgba(205,214,244,0.55)",
  accent: "#ffb35c",
  panelBg: "rgba(10,12,20,0.78)",
  panelBorder: "rgba(120,140,200,0.25)",
} as const;

/** roundRect isn't in every TS DOM lib we build against — trace it by hand. */
function panelPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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
  "× = tick rate vs a far-away clock · deeper gravity and faster motion both make a clock tick slower";

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

// ---------- effective-potential inset (6c) ----------

export const POTENTIAL_W = 300;
export const POTENTIAL_H = 182;
/** r window of the plot. 0 (not r+) so the horizon band is visible. */
const POT_RMAX = 20;
/** V_eff window — fixed, so sliding L visibly raises and lowers the curve. */
const POT_VMIN = 0.88;
const POT_VMAX = 1.08;
const POT_N = 140;
/** Sampled once per frame while the inset is on; never reallocated. */
const potV = new Float32Array(POT_N);

export interface PotentialOpts {
  a: number;
  /** Test-particle angular momentum (params.eduL). */
  L: number;
  rHor: number;
  isco: number;
  /** Live TDE bodies: BL radius and conserved E of the first markN entries. */
  markR: Float64Array;
  markE: Float64Array;
  markN: number;
}

/**
 * The "why is there an innermost stable orbit" picture: V_eff(r) for one test
 * particle's L, with the horizon, photon orbit, ISCO and any live TDE bodies
 * marked. Everything plotted is exact Kerr (edu.ts vEff / photonOrbitRadius);
 * only the fixed axis window is a display choice. Drawn with its top-left at
 * (x, y).
 */
export function drawPotential(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  o: PotentialOpts
): void {
  const W = POTENTIAL_W;
  const H = POTENTIAL_H;
  // plot box inside the panel
  const px = x + 34;
  const py = y + 12;
  const pw = W - 34 - 10;
  const ph = 100;
  const rx = (r: number) => px + (r / POT_RMAX) * pw;
  const vy = (v: number) => py + ph - ((v - POT_VMIN) / (POT_VMAX - POT_VMIN)) * ph;
  const clampY = (v: number) => Math.min(Math.max(vy(v), py), py + ph);

  ctx.save();
  ctx.fillStyle = HUD_STYLE.panelBg;
  ctx.strokeStyle = HUD_STYLE.panelBorder;
  ctx.lineWidth = 1;
  panelPath(ctx, x, y, W, H, 10);
  ctx.fill();
  ctx.stroke();

  // clip the curve and markers to the plot box; the axes/labels draw after
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();

  // region inside the horizon: no orbits, no V_eff — it moves in as a rises
  ctx.fillStyle = "rgba(120,140,200,0.14)";
  ctx.fillRect(px, py, rx(o.rHor) - px, ph);

  // E = 1 — above this a particle is unbound and can escape to infinity
  ctx.strokeStyle = "rgba(205,214,244,0.35)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(px, vy(1));
  ctx.lineTo(px + pw, vy(1));
  ctx.stroke();
  ctx.setLineDash([]);

  // V_eff is only defined outside the horizon, so sample [r+, POT_RMAX]
  const r0 = o.rHor;
  const dr = (POT_RMAX - r0) / (POT_N - 1);
  for (let i = 0; i < POT_N; i++) potV[i] = vEff(r0 + i * dr, o.L, o.a);
  ctx.strokeStyle = HUD_STYLE.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < POT_N; i++) ctx.lineTo(rx(r0 + i * dr), clampY(potV[i]));
  ctx.stroke();
  ctx.lineWidth = 1;

  // Local extrema straight off the sampled curve: the barrier peak and the
  // stable-orbit trough. Both vanish below L_isco — that IS the lesson, so
  // find them by slope sign changes rather than assuming they exist.
  let minR = -1;
  let minV = 0;
  let maxR = -1;
  let maxV = 0;
  for (let i = 1; i < POT_N - 1; i++) {
    const before = potV[i] - potV[i - 1];
    const after = potV[i + 1] - potV[i];
    if (before < 0 && after > 0) {
      minR = r0 + i * dr;
      minV = potV[i];
    } else if (before > 0 && after < 0) {
      maxR = r0 + i * dr;
      maxV = potV[i];
    }
  }
  if (maxR > 0) {
    ctx.strokeStyle = HUD_STYLE.accent;
    ctx.beginPath();
    ctx.arc(rx(maxR), clampY(maxV), 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (minR > 0) {
    const my = clampY(minV);
    ctx.fillStyle = HUD_STYLE.accent;
    ctx.beginPath();
    ctx.arc(rx(minR), my, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = HUD_STYLE.tiny;
    ctx.textAlign = "center";
    // The trough wanders with L: near the floor at low L, out against the
    // right edge at high L. Flip/slide the label so the clip rect never eats
    // it, while the dot itself stays exactly on the minimum.
    const below = my + 15 < py + ph;
    ctx.textBaseline = below ? "top" : "bottom";
    const label = "stable orbit";
    const half = ctx.measureText(label).width / 2 + 2;
    const lx = Math.min(Math.max(rx(minR), px + half), px + pw - half);
    ctx.fillText(label, lx, my + (below ? 6 : -6));
  }

  // Live TDE bodies. r changes, E is exactly conserved (E = -m_t, integrated
  // by tde.ts), so each dot may only slide horizontally.
  ctx.fillStyle = "#ffffff";
  let shown = 0;
  for (let i = 0; i < o.markN; i++) {
    const r = o.markR[i];
    if (r > POT_RMAX) continue; // still outside the plot window
    shown++;
    ctx.beginPath();
    ctx.arc(rx(r), clampY(o.markE[i]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore(); // un-clip

  // axes
  ctx.strokeStyle = "rgba(205,214,244,0.4)";
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py + ph);
  ctx.lineTo(px + pw, py + ph);
  ctx.stroke();

  ctx.font = HUD_STYLE.tiny;
  ctx.fillStyle = HUD_STYLE.faint;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(POT_VMAX.toFixed(2), px - 4, py);
  ctx.fillText("E = 1", px - 4, vy(1));
  ctx.fillText(POT_VMIN.toFixed(2), px - 4, py + ph);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const r of [0, 5, 10, 15, 20]) ctx.fillText(`${r}`, rx(r), py + ph + 3);
  ctx.fillText("r (M)", px + pw / 2, py + ph + 14);

  // Vertical markers. At high spin the photon orbit and the ISCO close to
  // within a few px of each other and both ride up against the steep inner
  // wall of the curve, so the lines are keyed to a legend in the empty
  // top-right of the plot rather than labelled where they stand.
  const rPh = photonOrbitRadius(o.a, true);
  const phColor = "rgba(205,214,244,0.5)";
  const iscoColor = "rgba(159,208,255,0.8)";
  ctx.strokeStyle = phColor;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(rx(rPh), py);
  ctx.lineTo(rx(rPh), py + ph);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = iscoColor;
  ctx.beginPath();
  ctx.moveTo(rx(o.isco), py);
  ctx.lineTo(rx(o.isco), py + ph);
  ctx.stroke();

  const legend: Array<[string, string, boolean]> = [
    [`photon orbit  r = ${rPh.toFixed(2)}`, phColor, true],
    [`ISCO  r = ${o.isco.toFixed(2)}`, iscoColor, false],
  ];
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i < legend.length; i++) {
    const [text, color, dashed] = legend[i];
    const ly = py + 6 + i * 11;
    ctx.fillStyle = color;
    ctx.fillText(text, px + pw - 4, ly);
    ctx.strokeStyle = color;
    if (dashed) ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(px + pw - 4 - ctx.measureText(text).width - 12, ly);
    ctx.lineTo(px + pw - 4 - ctx.measureText(text).width - 2, ly);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = HUD_STYLE.faint;
  ctx.fillText("unbound above", px + pw - 4, vy(1) - 6);

  ctx.save();
  ctx.translate(px + 6, py + ph - 4);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "left";
  ctx.fillStyle = HUD_STYLE.faint;
  ctx.fillText("inside horizon", 0, 0);
  ctx.restore();

  ctx.font = HUD_STYLE.small;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = HUD_STYLE.faint;
  ctx.fillText(
    "orbits oscillate where E < V_eff walls; below the ISCO the",
    x + 10,
    y + H - 36
  );
  ctx.fillText(
    "minimum flattens away — nothing left to hold you up.",
    x + 10,
    y + H - 25
  );
  ctx.fillText(
    shown > 0
      ? "energy is conserved: the dot moves only sideways."
      : "throw a star in to watch a real body move on this curve.",
    x + 10,
    y + H - 14
  );
  ctx.restore();
}

// ---------- embedding diagram, "the funnel" (6d) ----------

export const EMBED_W = 260;
export const EMBED_H = 200;

/**
 * Fixed viewing tilt, as a rigid rotation of the surface about the screen's
 * horizontal axis (sin/cos of ~20.5°, hence sin^2 + cos^2 = 1 exactly). The
 * funnel is therefore drawn at true 1:1 proportions — r and z are both in M
 * and share one scale, with no vertical exaggeration to explain away. Only
 * the overall fit-to-panel scale is a display choice.
 */
const EMB_SIN = 0.35;
const EMB_COS = Math.sqrt(1 - EMB_SIN * EMB_SIN);
const EMB_RINGS = 9;
const EMB_AZ = 48;
const EMB_SPOKES = 12;
const EMB_SPOKE_PTS = 44;

/** Ring radii: geometric from r+ to rMax, so samples crowd into the throat
 * where the curvature is and thin out across the flat outskirts. */
const embRing = new Float64Array(EMB_RINGS);

/** Matter group index — shared by the funnel's dots and 6e's trails, so a
 * body reads as the same thing in both overlays. */
export const EMBED_STARS = 0;
export const EMBED_GAS = 1;
export const EMBED_TDE = 2;
const MATTER_COLORS = ["#9fd0ff", "#ffb35c", "#ffffff"];

export interface EmbedOpts {
  profile: EmbeddingProfile;
  isco: number;
  /** Camera yaw: the funnel turns with the view (rings are symmetric, so only
   * the spokes and the dots actually move). */
  yaw: number;
  /** Live matter: BL radius, world azimuth, and group index, first dotN used. */
  dotR: Float64Array;
  dotAz: Float64Array;
  dotGroup: Uint8Array;
  dotN: number;
}

const RIM_COLOR = "rgba(159,208,255,0.75)";
const DISK_COLOR = "rgba(255,179,92,0.30)";
const THROAT_COLOR = "rgba(205,214,244,0.28)";
/** The ring alphas are tuned for a mesh of overlapping lines; text needs its
 * own, or the legend reads as a smudge. */
const DISK_LABEL = "rgba(255,179,92,0.85)";

/**
 * The equatorial slice as a surface of revolution, drawn as a wireframe from
 * a fixed tilt with the camera's yaw. Geometry is entirely edu.ts's
 * embeddingProfile (exact Flamm at a = 0; see its comment for the a != 0
 * caveat). Drawn with its top-left at (x, y).
 */
export function drawEmbedding(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  o: EmbedOpts
): void {
  const p = o.profile;
  const n = p.r.length;
  const rHor = p.r[0];
  const rMax = p.r[n - 1];

  const ratio = Math.pow(rMax / rHor, 1 / (EMB_RINGS - 1));
  for (let i = 0; i < EMB_RINGS; i++) embRing[i] = rHor * Math.pow(ratio, i);
  embRing[EMB_RINGS - 1] = rMax; // no rounding drift at the outer edge

  // Fit the surface to the panel from its own extents, so the inset reframes
  // itself as spin deepens the throat and the disk-size slider moves rMax.
  // Screen height of a ring runs z·cos ± r·sin (its back and front lips).
  let vMin = 0;
  let vMax = 0;
  for (let i = 0; i < EMB_RINGS; i++) {
    const h = embeddingZAt(p, embRing[i]) * EMB_COS;
    const t = embRing[i] * EMB_SIN;
    if (h + t > vMax) vMax = h + t;
    if (h - t < vMin) vMin = h - t;
  }
  const boxX = x + 8;
  const boxY = y + 8;
  const boxW = EMBED_W - 16;
  const boxH = EMBED_H - 8 - 34; // caption sits below
  const s = Math.min(boxW / (2 * rMax), boxH / Math.max(vMax - vMin, 1e-6));
  const cx = boxX + boxW / 2;
  const cy = boxY + boxH / 2 + (s * (vMax + vMin)) / 2;

  // The main view's right vector is (cos yaw, 0, -sin yaw), so a world point
  // at azimuth az lands at screen-x ∝ r·cos(az + yaw) and approaches the
  // camera as sin(az + yaw) grows — yaw is a plain azimuth offset here, and
  // nearer matter correctly draws lower under the downward tilt.
  const ex = (r: number, ang: number) => cx + s * r * Math.cos(ang);
  const ey = (r: number, ang: number, z: number) =>
    cy - s * (z * EMB_COS - r * Math.sin(ang) * EMB_SIN);

  ctx.save();
  ctx.fillStyle = HUD_STYLE.panelBg;
  ctx.strokeStyle = HUD_STYLE.panelBorder;
  ctx.lineWidth = 1;
  panelPath(ctx, x, y, EMBED_W, EMBED_H, 10);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, y + 1, EMBED_W - 2, EMBED_H - 2);
  ctx.clip();

  // Meridians: the funnel's profile, and the only lines that show the yaw.
  for (let j = 0; j < EMB_SPOKES; j++) {
    const ang = (j / EMB_SPOKES) * Math.PI * 2 + o.yaw;
    ctx.strokeStyle = THROAT_COLOR;
    ctx.beginPath();
    for (let k = 0; k < EMB_SPOKE_PTS; k++) {
      // geometric in r as well: the wall is near-vertical at the rim
      const r = rHor * Math.pow(rMax / rHor, k / (EMB_SPOKE_PTS - 1));
      ctx.lineTo(ex(r, ang), ey(r, ang, embeddingZAt(p, r)));
    }
    ctx.stroke();
  }

  // Rings. Warm inside the disk's span (isco → rMax), cool through the
  // plunging region below it — the shading IS the disk extent.
  for (let i = 0; i < EMB_RINGS; i++) {
    const r = embRing[i];
    const z = embeddingZAt(p, r);
    ctx.strokeStyle = r >= o.isco ? DISK_COLOR : THROAT_COLOR;
    ctx.beginPath();
    for (let k = 0; k <= EMB_AZ; k++) {
      const ang = (k / EMB_AZ) * Math.PI * 2;
      ctx.lineTo(ex(r, ang), ey(r, ang, z));
    }
    ctx.stroke();
  }

  const ring = (r: number, color: string, width: number) => {
    const z = embeddingZAt(p, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let k = 0; k <= EMB_AZ; k++) {
      const ang = (k / EMB_AZ) * Math.PI * 2;
      ctx.lineTo(ex(r, ang), ey(r, ang, z));
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  };
  ring(rHor, RIM_COLOR, 1.5); // the horizon: the rim at the bottom
  ring(o.isco, HUD_STYLE.accent, 1.5); // last stable orbit — the disk's inner edge

  // Live matter riding the surface. Stars sit on inclined orbits, so plotting
  // them at their (r, azimuth) drops their height out of the disk plane —
  // they are shown where they are radially, not where they are vertically.
  for (let i = 0; i < o.dotN; i++) {
    const r = o.dotR[i];
    if (r < rHor || r > rMax) continue; // off the diagram entirely
    const ang = o.dotAz[i] + o.yaw;
    ctx.fillStyle = MATTER_COLORS[o.dotGroup[i]];
    ctx.beginPath();
    ctx.arc(ex(r, ang), ey(r, ang, embeddingZAt(p, r)), 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore(); // un-clip

  // Legend, in the bottom-left: the funnel narrows away from that corner.
  const legend: Array<[string, string, string]> = [
    ["horizon rim", RIM_COLOR, RIM_COLOR],
    ["ISCO", HUD_STYLE.accent, HUD_STYLE.accent],
    ["disk", DISK_COLOR, DISK_LABEL],
  ];
  ctx.font = HUD_STYLE.tiny;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let i = 0; i < legend.length; i++) {
    const [text, lineColor, textColor] = legend[i];
    const ly = boxY + boxH - 24 + i * 11;
    ctx.strokeStyle = lineColor;
    ctx.beginPath();
    ctx.moveTo(boxX + 2, ly);
    ctx.lineTo(boxX + 12, ly);
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.fillText(text, boxX + 16, ly);
  }

  ctx.font = HUD_STYLE.small;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = HUD_STYLE.faint;
  ctx.fillText("space on the disk plane, stretched for real and", x + 10, y + EMBED_H - 27);
  ctx.fillText("drawn 1:1 — the horizon is the rim at the bottom.", x + 10, y + EMBED_H - 16);
  ctx.restore();
}

// ---------- orbit trails (6e) ----------

export interface TrailGroup {
  trails: Trail[];
  /** EMBED_STARS / EMBED_GAS / EMBED_TDE — indexes MATTER_COLORS. */
  group: number;
  /** False when the matter itself isn't drawn: its trails go with it. */
  on: boolean;
}

/** Alpha ramp along a trail, oldest to newest. */
const TRAIL_ALPHA_OLD = 0.05;
const TRAIL_ALPHA_NEW = 0.55;
/** Alpha steps per trail. One stroke() each — per-segment strokes would put
 *  ~8000 draw calls a frame in front of the render loop. */
const TRAIL_BUCKETS = 6;

/** Projected once per trail per frame, then stroked TRAIL_BUCKETS times from
 *  here. Sized to the longest trail there can be; never reallocated. */
const TRAIL_MAX = Math.max(TRAIL_CAP_STAR, TRAIL_CAP_GAS, TRAIL_CAP_TDE);
const trailPx = new Float32Array(TRAIL_MAX * 2);
const trailVis = new Uint8Array(TRAIL_MAX);
/** Sample age as a fraction of the trail's own span: 0 newest, 1 oldest. */
const trailAge = new Float64Array(TRAIL_MAX);
const trailP: V3 = [0, 0, 0];
const trailProj: Projected = { x: 0, y: 0, z: 0, visible: false };

function drawOneTrail(
  ctx: CanvasRenderingContext2D,
  tr: Trail,
  basis: CameraBasis,
  tanHalfFov: number,
  w: number,
  h: number,
  simT: number
): void {
  const n = tr.length;
  if (n < 2) return;
  // Age is measured against the trail's own span rather than a fixed window,
  // because the sample spacing is the frame's dt once the time-speed slider is
  // past ~30 M/s — a constant window would fade most of the buffer away at
  // exactly the speeds where a precessing ring becomes visible. It also
  // retires abandoned trails for free: a body that stops being pushed (eaten
  // debris) has all its samples slide to the faint end within one span.
  const span = tr.newestT - tr.oldestT;
  if (!(span > 0)) return;

  for (let i = 0; i < n; i++) {
    const t = tr.at(i, trailP);
    projectToScreen(trailP, basis, tanHalfFov, w, h, trailProj);
    trailPx[i * 2] = trailProj.x;
    trailPx[i * 2 + 1] = trailProj.y;
    trailVis[i] = trailProj.visible ? 1 : 0;
    trailAge[i] = (simT - t) / span;
  }

  for (let k = 0; k < TRAIL_BUCKETS; k++) {
    const i0 = Math.floor((k * (n - 1)) / TRAIL_BUCKETS);
    const i1 = Math.floor(((k + 1) * (n - 1)) / TRAIL_BUCKETS);
    if (i1 <= i0) continue; // fewer samples than buckets: some hold no segment
    const age = Math.min(Math.max(trailAge[(i0 + i1) >> 1], 0), 1);
    ctx.globalAlpha = TRAIL_ALPHA_NEW + (TRAIL_ALPHA_OLD - TRAIL_ALPHA_NEW) * age;
    ctx.beginPath();
    // Buckets share their end samples, so the polyline stays continuous
    // across the alpha steps; a sample behind the camera breaks the chain.
    let pen = false;
    for (let i = i0; i <= i1; i++) {
      if (!trailVis[i]) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(trailPx[i * 2], trailPx[i * 2 + 1]);
      else {
        ctx.moveTo(trailPx[i * 2], trailPx[i * 2 + 1]);
        pen = true;
      }
    }
    ctx.stroke();
  }
}

/**
 * Where the matter has actually been. These are TRUE SPATIAL PATHS drawn with
 * a straight-ray projection (edu.ts projectToScreen), not lensed images: a
 * trail marks where its body is, while the glow the renderer puts on screen
 * for it arrived along a bent geodesic and can sit somewhere else entirely —
 * on the far side of the shadow, or doubled. The UI copy says so too.
 */
// ---------- shadow & photon-ring annotation (6f) ----------

/**
 * Every callout label (6f, extended by 6g) in one place, so copy edits never
 * touch drawing code. Bodies are pre-wrapped into lines by hand: the HUD
 * redraws each frame, and runtime word-wrap would measure and allocate.
 */
export const CALLOUT_COPY = {
  shadow: {
    title: "shadow edge",
    body: [
      "no light from inside ever reaches you —",
      "about 2.6× the horizon's diameter",
    ],
  },
  photonRing: {
    title: "photon ring",
    body: [
      "light that orbited the hole before escaping",
      "piles up in ever-thinner subrings",
      "converging on this edge",
    ],
  },
  approaching: {
    title: "approaching side",
    body: [
      "matter here comes at you at ~half light",
      "speed — relativistic beaming makes it",
      "brighter and bluer",
    ],
  },
  receding: {
    title: "receding side",
    body: ["same disk, moving away — beamed out of", "your view, dimmer and redder"],
  },
  hollywood: {
    title: "Hollywood mode",
    body: ["true brightness asymmetry hidden — this", "is the symmetric movie look"],
  },
  doubledTop: {
    title: "the far side, seen over the top",
    body: [
      "light from disk behind the hole is bent",
      "over the pole and reaches you — the disk",
      "wraps its own image around the shadow",
    ],
  },
  doubledBottom: {
    title: "…and under the bottom",
    body: ["the same far side, bent under —", "a second, fainter image"],
  },
  // No beaming ratio in this copy on purpose. The shader's jet brightness is
  // 6.8·min(g, 1.6)^3 on a per-pixel shift along the traced ray: the clamp and
  // the metric make the on-screen contrast something no single number tracks,
  // and the honest idealization (delta^3, ~12× nose-on) swings to 1× edge-on —
  // a fixed figure for a quantity the pitch slider moves would contradict the
  // picture exactly where someone bothered to check it.
  jet: {
    title: "jet — pointed near you",
    body: [
      "knots stream at 0.85c; beaming toward you",
      "makes this one much brighter and bluer",
    ],
  },
  counterJet: {
    title: "counter-jet",
    body: [
      "identical, but beamed away — for real it",
      "would be all but invisible; the render",
      "caps the contrast to keep it on screen",
    ],
  },
  // The shader gates the jet's beaming on the same uDoppler as the disk's, so
  // with it off the two jets really are drawn alike and the pair above would
  // be describing an asymmetry that is not on screen.
  jetSymmetric: {
    title: "jet",
    body: [
      "knots stream at 0.85c — but with Doppler",
      "off, both jets are drawn alike; the real",
      "pair is wildly lopsided",
    ],
  },
  isco: {
    title: "inner edge — the ISCO",
    body: [
      "inside the innermost stable circular orbit",
      "there are no orbits to shine from; matter",
      "plunges in a few laps. Spin the hole up",
      "and watch this edge chase the shadow.",
      "(marker approximate — unlensed)",
    ],
  },
  einstein: {
    title: "Einstein ring!",
    body: [
      "a star is passing almost exactly behind",
      "the hole — its light reaches you around",
      "every side at once, smearing it to a ring",
    ],
  },
} as const;

export type CalloutKey = keyof typeof CALLOUT_COPY;

/**
 * Leader-line label: a dot on the subject, a line out to a title + body text
 * block at (tx, ty). The block grows away from the anchor horizontally (text
 * is right-aligned when it sits left of its anchor) and downward from the
 * title, so callers place ty above the anchor for labels that must sit
 * outside what they point at. Shared by 6f and the 6g callout mode.
 */
export function drawCallout(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  title: string,
  body: readonly string[]
): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = HUD_STYLE.faint;
  ctx.fillStyle = HUD_STYLE.accent;
  ctx.beginPath();
  ctx.arc(ax, ay, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  const rightward = tx >= ax;
  ctx.textAlign = rightward ? "left" : "right";
  ctx.textBaseline = "middle";
  const ox = rightward ? 5 : -5;
  // Unlike the insets, a callout floats straight over the scene — and the
  // things worth labelling are exactly the bright ones, where pale text on
  // a near-white disk disappears. Halo each line rather than box it in, so
  // the label stays legible without hiding what it points at. (A stroked
  // halo, not shadowBlur: same result, no per-glyph blur every frame.)
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.72)";
  ctx.font = HUD_STYLE.font;
  ctx.strokeText(title, tx + ox, ty);
  ctx.fillText(title, tx + ox, ty);
  ctx.font = HUD_STYLE.small;
  ctx.fillStyle = HUD_STYLE.stroke;
  for (let i = 0; i < body.length; i++) {
    ctx.strokeText(body[i], tx + ox, ty + 14 + i * 12);
    ctx.fillText(body[i], tx + ox, ty + 14 + i * 12);
  }
  ctx.restore();
}

/**
 * The 6f outline: edu.ts's bisected capture boundary, so it hugs the rendered
 * black disk exactly. Its two labels are emitted by main.ts into the shared
 * callout layer below rather than drawn here, so that they take part in the
 * same layout pass as 6g's — with the disk annotated too, the shadow-edge
 * label and the near Doppler label land on top of each other otherwise.
 *
 * alpha < 1 marks a stale outline: the view moved and a replacement is being
 * traced a few azimuths per frame.
 */
export function drawShadowOutline(
  ctx: CanvasRenderingContext2D,
  edge: ShadowEdge,
  w: number,
  h: number,
  alpha: number
): void {
  const n = edge.pts.length / 2;
  if (!edge.valid || n < 3) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = HUD_STYLE.accent;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  for (let k = 0; k <= n; k++) {
    const i = (k % n) * 2;
    const x = ((edge.pts[i] + 1) / 2) * w;
    const y = ((1 - edge.pts[i + 1]) / 2) * h;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------- the callout layer (6g) ----------

export interface CalloutItem {
  key: CalloutKey;
  /** Anchor: the thing on screen being labelled, in CSS px. */
  ax: number;
  ay: number;
  /** Preferred offset of the text block from the anchor. The layout slides it
   *  to keep the block on screen and off the control panel, stretching the
   *  leader line rather than moving the anchor. */
  dx: number;
  dy: number;
  /** Fades a callout hanging off a stale anchor (6f's outline mid-retrace). */
  alpha: number;
}

/** The control panel is opaque, sits above the HUD and is 240 px wide at
 *  left: 12 — text may not slide under it. */
const CALLOUT_SAFE_X = 270;
const CALLOUT_EDGE_PAD = 8;
/** Breathing room left between two blocks the push-down has separated. */
const CALLOUT_GAP = 6;
/** Ceiling on one frame's callouts; main.ts can emit at most ten. */
const CALLOUT_MAX_ITEMS = 12;

// Bounds of the blocks placed so far this frame, for the overlap check.
// Preallocated: the layout runs every frame the overlay is on.
const laidL = new Float64Array(CALLOUT_MAX_ITEMS);
const laidR = new Float64Array(CALLOUT_MAX_ITEMS);
const laidT = new Float64Array(CALLOUT_MAX_ITEMS);
const laidB = new Float64Array(CALLOUT_MAX_ITEMS);

/**
 * Width of a callout's widest line, measured once per key and kept. The copy
 * is fixed and so are the fonts, so measuring per frame would do nothing but
 * drop a TextMetrics object per label in front of the render loop.
 */
const calloutW = new Map<CalloutKey, number>();
function calloutWidth(ctx: CanvasRenderingContext2D, key: CalloutKey): number {
  const memo = calloutW.get(key);
  if (memo !== undefined) return memo;
  const c = CALLOUT_COPY[key];
  ctx.font = HUD_STYLE.font;
  let w = ctx.measureText(c.title).width;
  ctx.font = HUD_STYLE.small;
  for (const line of c.body) w = Math.max(w, ctx.measureText(line).width);
  calloutW.set(key, w);
  return w;
}

/**
 * The callout layer: leader-line labels laid out to stay on screen, clear of
 * the control panel, and off each other. Blocks only ever move DOWN to resolve
 * an overlap, so `items` is a priority order — emit the labels that most need
 * their natural position first.
 */
export function drawCallouts(
  ctx: CanvasRenderingContext2D,
  items: CalloutItem[],
  n: number,
  w: number,
  h: number
): void {
  ctx.save();
  let placed = 0;
  for (let i = 0; i < n && placed < CALLOUT_MAX_ITEMS; i++) {
    const it = items[i];
    const c = CALLOUT_COPY[it.key];
    const bw = calloutWidth(ctx, it.key);
    // drawCallout centres the title on ty and stacks the body 12 px apart below
    const bh = 14 + 12 * (c.body.length - 1);

    // Slide the text horizontally into the free strip. The bounds allow for
    // the block hanging off either side of tx, because drawCallout picks the
    // side back off tx vs ax and the slide itself can cross the anchor.
    const lo = CALLOUT_SAFE_X + bw + 5;
    const hi = w - CALLOUT_EDGE_PAD - bw - 5;
    const tx = Math.min(Math.max(it.ax + it.dx, lo), Math.max(hi, lo));
    const bl = tx >= it.ax ? tx + 5 : tx - 5 - bw;

    let ty = Math.min(
      Math.max(it.ay + it.dy, 14),
      Math.max(h - bh - CALLOUT_EDGE_PAD, 14)
    );
    for (let j = 0; j < placed; j++) {
      if (bl >= laidR[j] || bl + bw <= laidL[j]) continue; // no horizontal overlap
      if (ty - 7 < laidB[j] && ty + bh + 6 > laidT[j]) ty = laidB[j] + CALLOUT_GAP + 7;
    }

    laidL[placed] = bl;
    laidR[placed] = bl + bw;
    laidT[placed] = ty - 7;
    laidB[placed] = ty + bh + 6;
    placed++;

    ctx.globalAlpha = it.alpha;
    drawCallout(ctx, it.ax, it.ay, tx, ty, c.title, c.body);
  }
  ctx.restore();
}

export function drawTrails(
  ctx: CanvasRenderingContext2D,
  groups: TrailGroup[],
  basis: CameraBasis,
  tanHalfFov: number,
  w: number,
  h: number,
  simT: number
): void {
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    if (!grp.on) continue;
    ctx.strokeStyle = MATTER_COLORS[grp.group];
    for (let i = 0; i < grp.trails.length; i++) {
      drawOneTrail(ctx, grp.trails[i], basis, tanHalfFov, w, h, simT);
    }
  }
  ctx.restore();
}
