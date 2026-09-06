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

/**
 * Attach pointer + wheel handlers that mutate `state` in place.
 *
 * `claimed` lets an overlay take a pointerdown before the camera sees it: the
 * HUD canvas is pointer-events:none (so camera drags pass straight through to
 * here), which also means its own hit regions never receive the event. Without
 * this hook, dragging a HUD handle would spin the camera underneath it. A
 * claimed pointer is deliberately never tracked below, so dragging an inset's
 * grip with one finger and touching the canvas with another cannot be read as
 * a pinch.
 */
export function attachControls(
  canvas: HTMLCanvasElement,
  state: CameraState,
  claimed?: (e: PointerEvent) => boolean
): void {
  /** Every pointer the camera owns, by id: one orbits, two pinch. */
  const down = new Map<number, { x: number; y: number }>();
  let lastX = 0;
  let lastY = 0;
  /** Finger separation at the previous move; 0 while fewer than two are down. */
  let spread = 0;

  /** Separation of the first two pointers down, which are the ones that pinch. */
  const gap = (): number => {
    const [a, b] = [...down.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const zoom = (factor: number): void => {
    state.dist = Math.max(DIST_MIN, Math.min(DIST_MAX, state.dist * factor));
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (claimed?.(e)) return;
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastX = e.clientX;
    lastY = e.clientY;
    spread = down.size >= 2 ? gap() : 0;
    // Last, and it has to stay last: a synthetic pointerdown (the visual
    // harness dispatches its own) has no active pointer to capture, so this
    // throws there, and everything the gesture needs is already set above.
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = down.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (down.size >= 2) {
      // Fingers moving apart magnify the picture, and magnifying it is coming
      // closer — so the ratio divides. Orbiting is off entirely while two are
      // down: a pinch is never symmetric enough for the midpoint to hold still,
      // and the camera would swing under the gesture.
      const now = gap();
      if (spread > 0 && now > 0) zoom(spread / now);
      spread = now;
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.yaw -= dx * 0.005;
    state.pitch += dy * 0.005;
    const lim = Math.PI / 2 - 0.02;
    state.pitch = Math.max(-lim, Math.min(lim, state.pitch));
  });
  const lift = (e: PointerEvent): void => {
    if (!down.delete(e.pointerId)) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    spread = 0;
    // Re-anchor on whichever finger is still down. Without this, lifting one of
    // two leaves the anchor where the lifted one last was, and the next move
    // orbits by the whole gap between them in a single frame.
    const rest = down.values().next().value;
    if (rest) {
      lastX = rest.x;
      lastY = rest.y;
    }
  };
  canvas.addEventListener("pointerup", lift);
  // A touch the browser takes back (a system gesture, a lost context) sends
  // this and no pointerup; without it the camera stays in pinch mode forever.
  canvas.addEventListener("pointercancel", lift);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom(Math.exp(e.deltaY * 0.0012));
    },
    { passive: false }
  );
}
