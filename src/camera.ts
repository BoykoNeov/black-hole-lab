/** Orbit camera around the black hole (at the origin). Distances in M. */

export interface CameraState {
  yaw: number;
  pitch: number;
  dist: number;
  fovDeg: number;
}

export interface CameraBasis {
  pos: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  fwd: [number, number, number];
}

export const DIST_MIN = 3.2; // just outside the photon sphere (r = 3M)
export const DIST_MAX = 380;

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function cameraBasis(s: CameraState): CameraBasis {
  const cp = Math.cos(s.pitch);
  const pos: V3 = [
    s.dist * cp * Math.sin(s.yaw),
    s.dist * Math.sin(s.pitch),
    s.dist * cp * Math.cos(s.yaw),
  ];
  const fwd = norm([-pos[0], -pos[1], -pos[2]]);
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { pos, right, up, fwd };
}

/** Attach pointer + wheel handlers that mutate `state` in place. */
export function attachControls(canvas: HTMLCanvasElement, state: CameraState): void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.yaw -= dx * 0.005;
    state.pitch += dy * 0.005;
    const lim = Math.PI / 2 - 0.02;
    state.pitch = Math.max(-lim, Math.min(lim, state.pitch));
  });
  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      state.dist *= Math.exp(e.deltaY * 0.0012);
      state.dist = Math.max(DIST_MIN, Math.min(DIST_MAX, state.dist));
    },
    { passive: false }
  );
}
