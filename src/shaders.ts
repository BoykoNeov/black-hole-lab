/** All GLSL (WebGL2 / ES 3.0) shader sources for the slice-4 pipeline. */

import { MARCH_MAX_STEPS } from "./kerr";
import { GAS_COUNT, STAR_COUNT } from "./matter";
import { TDE_MAX } from "./tde";

/**
 * The ladder view's colours (slice 9), one per half-turn of winding, in one
 * place so the shader that paints them and the HUD legend that names them
 * cannot disagree: the GLSL below is generated from this table. Linear RGB,
 * pre-tonemap — the composite's ACES curve desaturates them a little.
 */
export interface LadderRung {
  /** Legend caption. */
  label: string;
  rgb: [number, number, number];
}
export const LADDER_RUNGS: readonly LadderRung[] = [
  { label: "0–1  direct view", rgb: [0.3, 0.34, 0.42] },
  { label: "1–2  once past the far side", rgb: [0.2, 0.55, 0.95] },
  { label: "2–3  first full loop", rgb: [0.25, 0.85, 0.55] },
  { label: "3–4", rgb: [0.98, 0.85, 0.25] },
  { label: "4–5", rgb: [0.98, 0.5, 0.2] },
  { label: "5+", rgb: [0.95, 0.25, 0.35] },
];
/** Rays still winding when the march budget ended: fate exact, colour not. */
export const LADDER_UNRESOLVED: LadderRung = {
  label: "budget spent — fate exact, colour not",
  rgb: [0.85, 0.3, 0.95],
};
const vec3 = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(2)).join(", ")})`;

export const VS_QUAD = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * Scene pass. Per pixel, integrate the Kerr null geodesic in Cartesian
 * Kerr–Schild coordinates (Hamiltonian form, RK4) — the same system as the
 * CPU reference in kerr.ts, which stays the tested oracle. The march
 * carries the covariant photon momentum m_mu (time-reversed, camera-frame
 * energy 1), so every emitter's exact shift factor is g = 1/(m_mu u^mu):
 *  - the disk sheet uses the closed form 1/(u^t (m_t + Omega L_z)) with
 *    the ray's conserved axial momentum L_z;
 *  - stars and gas blobs use 4-velocities uploaded from the CPU (true
 *    ISCO-plunge kinematics inside the ISCO);
 *  - the jet normalizes its 0.85c streaming velocity in the local metric.
 * Equatorial crossings are found by sign change of y between steps (they
 * are no longer at fixed angles once frame dragging bends the orbit out of
 * a plane). Escaped rays land on the procedural starfield / Milky Way.
 * Time is Kerr–Schild coordinate time in units of M (uSimT).
 * Outputs HDR linear radiance.
 */
export const FS_SCENE = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uResolution;    // size of the viewport being drawn, NOT the frame
uniform vec2 uViewOrigin;    // its lower-left corner; (0,0) unless comparing
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalfFov;
uniform float uLensing;      // 1 = real lensing, 0 = flat-space bypass
uniform float uStarDensity;  // ~0.2 .. 2
uniform float uSkyOn;        // 1 = draw the background sky (stars + Milky Way)
uniform float uSimT;         // simulation (coordinate) time in M
uniform float uDiskOn;       // 1 = draw accretion disk
uniform float uDoppler;      // 1 = Doppler + gravitational shift, 0 = Hollywood
uniform float uDiskBright;   // ~0 .. 3
uniform float uDiskTempK;    // peak disk temperature in kelvin
uniform float uDiskOuter;    // disk outer radius in M
uniform float uStarsOn;      // 1 = draw orbiting stars
uniform float uGasOn;        // 1 = draw infalling gas blobs
uniform float uJetsOn;       // 1 = draw the bipolar jet
uniform float uJetPower;     // ~0 .. 2
uniform int uMaxSteps;       // march step budget; < 320 only on the low preset
uniform float uLadder;       // 1 = false-colour each pixel by how far its ray wound (slice 9)
uniform float uStepScale;    // > 1 coarsens the adaptive arc length (low preset)
uniform float uSpin;         // Kerr a in [0, 0.998]
uniform float uHorizon;      // r+ = 1 + sqrt(1 - a^2)
uniform float uIsco;         // prograde ISCO radius for the current spin
uniform float uTNorm;        // temperature-profile peak normalization
uniform vec4 uTetT;          // camera tetrad, covariant legs (t, x, y, z):
uniform vec4 uTetR;          //   m_mu = d.r*R + d.u*U + d.f*F - T
uniform vec4 uTetU;
uniform vec4 uTetF;
uniform vec4 uTetTv;         // the same legs CONTRAVARIANT. Slice 10 needs the
uniform vec4 uTetRv;         //   ray's tangent and its two sky polarizations as
uniform vec4 uTetUv;         //   vectors, not covectors, and uploading them is
uniform vec4 uTetFv;         //   free next to raising three covectors per pixel
uniform float uPolarization; // 1 = also work out how the disk's light is polarized
uniform vec4 uStarPos[${STAR_COUNT}];  // xyz world position, w gaussian radius
uniform vec4 uStarU[${STAR_COUNT}];    // contravariant 4-velocity (t, x, y, z)
uniform float uStarTemp[${STAR_COUNT}];
uniform vec4 uGas[${GAS_COUNT}];       // xy disk-plane position, z size, w brightness
uniform vec4 uGasU[${GAS_COUNT}];      // contravariant 4-velocity (t, x, y, z)
uniform vec4 uGasArc[${GAS_COUNT}];    // x azimuth, y daz/dt, z dR/dt (matter.ts gasRates), w draw radius
uniform int uTdeN;                     // live TDE bodies (0 = no event)
uniform vec4 uTdePos[${TDE_MAX}];      // xyz world position, w gaussian radius
uniform vec4 uTdeU[${TDE_MAX}];        // contravariant 4-velocity (t, x, y, z)
uniform vec4 uTdeInfo[${TDE_MAX}];     // x temperature K, y brightness, z capsule intensity to next element

const float PI = 3.14159265358979;

layout(location = 0) out vec4 outColor;
// (Q, U, I, hit) of the disk light this pixel receives — the polarization
// target slice 10's tick overlay reads. Q and U are the SCREEN-basis Stokes
// pair, already projected, so a filtered read of this texture averages
// something that adds linearly; an angle in here would wrap and smear.
layout(location = 1) out vec4 outPol;

// ---------- hash & noise ----------
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0,0,0)), n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.13; a *= 0.5; }
  return s;
}

// ---------- sky ----------
vec3 starfield(vec3 d) {
  vec3 col = vec3(0.0);
  float sc = 70.0;
  for (int l = 0; l < 3; l++) {
    vec3 p = d * sc;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    vec3 h = hash33(id);
    vec3 off = (h - 0.5) * 0.72;
    float dist = length(f - off);
    float m = hash13(id + 17.0);
    float cut = 1.0 - 0.32 * uStarDensity;
    if (m > cut) {
      float q = (m - cut) / max(1.0 - cut, 1e-3);
      float bright = pow(q, 5.0) * 60.0 + 0.4;
      float size = 0.045 + 0.05 * hash13(id + 9.0);
      float g = exp(-dist * dist / (size * size));
      float ct = hash13(id + 3.0);
      vec3 tint = ct < 0.35 ? mix(vec3(1.0), vec3(0.62, 0.72, 1.0), (0.35 - ct) * 2.0)
                            : mix(vec3(1.0), vec3(1.0, 0.75, 0.55), (ct - 0.35) * 1.1);
      col += bright * g * tint;
    }
    sc *= 2.3;
  }
  return col;
}

vec3 milkyway(vec3 d) {
  vec3 n = normalize(vec3(0.25, 1.0, 0.12));
  float band = exp(-pow(dot(d, n) * 3.6, 2.0));
  float clouds = fbm(d * 3.0);
  float dust = fbm(d * 7.0 + 13.0);
  float g = band * (0.5 * clouds + 0.18);
  g *= 0.25 + 0.75 * smoothstep(0.62, 0.30, dust * band);
  vec3 warm = vec3(1.0, 0.86, 0.72), cool = vec3(0.60, 0.68, 1.0);
  vec3 tint = mix(warm, cool, vnoise(d * 2.0 + 5.0));
  return g * tint * 0.8 + vec3(0.004, 0.005, 0.009);
}

// Killing the sky leaves the escaped rays black, which is what isolates the
// emission from the hole itself — without a backdrop there is nothing for the
// lensing to distort, so the disk/jet/matter read on their own.
vec3 skyColor(vec3 d) {
  if (uSkyOn < 0.5) return vec3(0.0);
  return starfield(d) + milkyway(d);
}

// ---------- Kerr–Schild metric (world frame: spin along +y) ----------

// Boyer–Lindquist radius of a world point.
float ksRadius(vec3 p) {
  float rho2 = dot(p, p);
  float q = rho2 - uSpin * uSpin;
  return sqrt(0.5 * (q + sqrt(q * q + 4.0 * uSpin * uSpin * p.y * p.y)));
}

// ---------- analytic capture: the fate the march cannot afford ----------
// Mirrors kerr.ts rayConstants/radialPotential/rayCaptured; keep them in sync.
// The oracle there is the tested one, and test/edu.test.ts pins this criterion
// as the edge the march CONVERGES to as its budget grows.

// Carter's q = Q/E^2. The textbook form divides by sin^2(theta), which a
// face-on camera sits exactly on; the Lagrange identity cancels it away and
// leaves this polynomial, regular everywhere. See kerr.ts for the derivation.
float carterQ(vec3 p, vec3 mv, float mt) {
  float r2 = ksRadius(p) * ksRadius(p);
  float a2 = uSpin * uSpin;
  float qE2 = (p.y * p.y / r2) * ((r2 + a2) * (mv.x * mv.x + mv.z * mv.z) - a2 * mt * mt)
            - 2.0 * p.y * mv.y * (p.x * mv.x + p.z * mv.z)
            + (r2 - p.y * p.y) * mv.y * mv.y;
  return qE2 / (mt * mt);
}

// R(r)/E^2 = r^4 + c2 r^2 + 2k r - a^2 q. The constant term is -a^2 q in
// closed form; assembling it as (a^2-a*lambda)^2 - a^2 k instead would cancel
// away three of float32's seven digits right at the critical curve.
float radialPotential(float r, float lambda, float q) {
  float a = uSpin;
  float k = (lambda - a) * (lambda - a) + q;
  float c2 = 2.0 * a * a - 2.0 * a * lambda - k;
  return ((r * r + c2) * r + 2.0 * k) * r - a * a * q;
}

float cbrt1(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }

// Does this ray end on the horizon? Exactly, and without a single step.
//
// A ray needs ~(1/gamma) ln(1/delta) half-orbits to settle its fate at offset
// delta from the critical curve, so the march NEVER resolves the edge — the
// steps diverge there, whatever the budget. But fate is not an integration
// result: lambda and q fix it. The ray plunges iff R stays positive from the
// camera down to r+. R(r+) >= 0 and R(camera) > 0, so a turning point can only
// show up as a dip through a local minimum, and the minima are the roots of
// R'/4 = r^3 + (c2/2) r + k/2.
//
// outward is the launch direction: a ray leaving the camera to larger r
// reaches the horizon only if it first reflects off a negative minimum ABOVE
// the camera and then finds none below. That case is real here — the orbit
// camera goes down to r = 3.2, inside the retrograde photon orbit at high
// spin, and a ray launched outward can wind at that orbit and fall back.
bool capturedByConstants(float lambda, float q, float rCam, bool outward) {
  float a = uSpin;
  float k = (lambda - a) * (lambda - a) + q;
  float pc = 0.5 * (2.0 * a * a - 2.0 * a * lambda - k);
  float sc = 0.5 * k;

  float roots[3];
  int n = 1;
  float disc = 0.25 * sc * sc + (pc * pc * pc) / 27.0;
  if (pc >= 0.0 || disc > 0.0) {
    float rt = sqrt(max(disc, 0.0));
    roots[0] = cbrt1(-0.5 * sc + rt) + cbrt1(-0.5 * sc - rt);
    roots[1] = roots[0];
    roots[2] = roots[0];
  } else {
    float m = 2.0 * sqrt(-pc / 3.0);
    float th = acos(clamp((3.0 * sc) / (pc * m), -1.0, 1.0)) / 3.0;
    roots[0] = m * cos(th);
    roots[1] = m * cos(th - 2.0943951023931953);
    roots[2] = m * cos(th - 4.1887902047863905);
    n = 3;
  }
  bool turnsAbove = false;
  for (int i = 0; i < 3; i++) {
    if (i >= n) break;
    if (radialPotential(roots[i], lambda, q) >= 0.0) continue;
    if (roots[i] > uHorizon && roots[i] < rCam) return false;
    if (roots[i] > rCam) turnsAbove = true;
  }
  return !outward || turnsAbove;
}

// f = 2r^3/(r^4 + a^2 y^2) and the spatial null vector l (l_t = 1).
void ksFL(vec3 p, out float f, out vec3 l) {
  float a = uSpin;
  float r = ksRadius(p);
  float r2 = r * r;
  f = 2.0 * r2 * r / (r2 * r2 + a * a * p.y * p.y);
  float D = r2 + a * a;
  l = vec3((r * p.x - a * p.z) / D, p.y / r, (r * p.z + a * p.x) / D);
}

// Hamiltonian flow of H = 1/2 (-mt^2 + |mv|^2 - f P^2), P = -mt + l.mv:
// dp/ds = mv - f P l,  dm_i/ds = 1/2 df_i P^2 + f P (dl_j/dx_i) m_j.
// Mirrors kerr.ts derivs(); keep the two in sync.
void geoDeriv(vec3 p, vec3 mv, float mt, out vec3 dp, out vec3 dm) {
  float a = uSpin;
  float x = p.x, y = p.y, z = p.z;
  float r = ksRadius(p);
  float r2 = r * r;
  float sig = r2 * r2 + a * a * y * y;
  float f = 2.0 * r2 * r / sig;
  float D = r2 + a * a;
  float nx = r * x - a * z;
  float nz = r * z + a * x;
  vec3 l = vec3(nx / D, y / r, nz / D);

  vec3 dr = (r / sig) * vec3(r2 * x, y * D, r2 * z);
  float fs = 6.0 * r2 / sig;
  float fq = 2.0 * r2 * r / (sig * sig);
  vec3 df = fs * dr - fq * (4.0 * r2 * r * dr + vec3(0.0, 2.0 * a * a * y, 0.0));

  float D2 = D * D;
  float tr = 2.0 * r;
  vec3 dlx = vec3((dr.x * x + r) * D - nx * tr * dr.x,
                  (dr.y * x) * D - nx * tr * dr.y,
                  (dr.z * x - a) * D - nx * tr * dr.z) / D2;
  vec3 dlz = vec3((dr.x * z + a) * D - nz * tr * dr.x,
                  (dr.y * z) * D - nz * tr * dr.y,
                  (dr.z * z + r) * D - nz * tr * dr.z) / D2;
  vec3 dly = vec3(-y * dr.x, r - y * dr.y, -y * dr.z) / r2;

  float P = -mt + dot(l, mv);
  float fP = f * P;
  dp = mv - fP * l;
  dm = 0.5 * df * P * P
     + fP * vec3(dlx.x * mv.x + dly.x * mv.y + dlz.x * mv.z,
                 dlx.y * mv.x + dly.y * mv.y + dlz.y * mv.z,
                 dlx.z * mv.x + dly.z * mv.y + dlz.z * mv.z);
}

// ---------- exact shift factors ----------

// u^t of a prograde circular equatorial orbit at BL radius r.
float circUt(float r) {
  float sr = sqrt(r);
  return (r * sr + uSpin)
       / (pow(r, 0.75) * sqrt(max(r * sr - 3.0 * sr + 2.0 * uSpin, 1e-6)));
}

// Disk shift: g = 1/(u^t (m_t + Omega * lam)), lam = z m_x - x m_z conserved.
// The denominator is strictly positive for physical rays; the floor only
// caps the extreme blueshift tail so g^4 emission can't overflow the
// float16 render target (Inf here would NaN-poison the bloom pyramid).
float diskG(float rc, float mt, float lam) {
  float om = 1.0 / (pow(rc, 1.5) + uSpin);
  return 1.0 / max(circUt(rc) * (mt + om * lam), 0.2);
}

// Shift for an uploaded 4-velocity: g = 1/(m_mu u^mu), same overflow floor
// (gas emission scales like g^6, so cap harder: g <= 3).
float uShift(float mt, vec3 mv, vec4 u) {
  return 1.0 / max(mt * u.x + dot(mv, u.yzw), 0.3333);
}

// ---------- accretion disk ----------

// Planckian-locus RGB fit (Tanner Helland), squared to approximate linear.
vec3 bbColor(float T) {
  float t = clamp(T, 1200.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 1.0
          : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0)
          : clamp(1.1298909 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0
          : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962540, 0.0, 1.0));
  vec3 c = vec3(r, g, b);
  return c * c;
}

// Thin-disk temperature profile, zero-torque at the (spin-dependent) ISCO.
float tprof(float r) {
  if (r <= uIsco) return 0.0;
  return pow(r, -0.75) * pow(max(1.0 - sqrt(uIsco / r), 0.0), 0.25) / uTNorm;
}

// Turbulent streaks in material coordinates: each annulus rotates at the
// Kerr circular rate Omega = 1/(r^{3/2} + a) (world azimuth decreasing).
float diskTurb(float r, float az) {
  float lr = log(r);
  float am = az + uSimT / (pow(r, 1.5) + uSpin);
  vec2 c = vec2(cos(am), sin(am));
  float n1 = fbm(vec3(c * 2.4, lr * 5.0));
  float n2 = fbm(vec3(c * 7.0 + 19.0, lr * 12.0 + 7.0));
  return (0.40 + 1.0 * n1) * (0.55 + 0.85 * n2);
}

// Emission + opacity of one equatorial crossing at world point pc.
// Blackbody: observed T scales by g, bolometric intensity by g^4 — both
// come from evaluating the blackbody at g*T.
vec4 diskSample(float rc, vec3 pc, float g) {
  float az = atan(pc.z, pc.x);
  float turb = diskTurb(rc, az);
  float Tn = tprof(rc);
  float outer = smoothstep(uDiskOuter, uDiskOuter * 0.55, rc);
  float inner = smoothstep(uIsco, uIsco + 0.4, rc);
  float dens = outer * inner * clamp(turb, 0.0, 1.6);
  float alpha = 1.0 - exp(-dens * 1.9);
  float Tobs = uDiskTempK * Tn * g;
  float I = pow(max(Tn * g, 0.0), 4.0) * (0.30 + 0.70 * turb) * uDiskBright * 5.5;
  return vec4(bbColor(Tobs) * I * outer * inner, alpha);
}

// ---------- matter: gas blobs, stars, jet ----------

// How far back along its own track a blob is drawn, in coordinate time M.
// Fixed in TIME, not in angle, which is the whole point: the orbital rate runs
// from ~1/(r^1.5) at the rim to a fast plunge at the ISCO, so one fixed window
// smears an inner blob across radians while an outer one barely moves. That
// spread IS the differential rotation, and it is what shears real accretion
// flows into filaments instead of leaving them as tidy round clumps.
const float GAS_TAIL_T = 26.0;
// ...but a blob deep in the plunge would otherwise wrap the arc into a closed
// ring and read as a solid annulus, so cap the swept angle. Artistic.
const float GAS_TAIL_MAX_AZ = 1.6;
// Arc length at which a tail still draws at full brightness. Past it the same
// gas is spread thinner and dims as 1/length — mass conservation, taken
// literally rather than sqrt-softened the way the TDE stream is (tde.ts
// segIntensity). The TDE needed softening because its returning tail went
// invisible; the gas has the opposite problem, since a blob smeared down a
// ~7 M arc at the old normalization pushes several times its own light into
// the frame and blooms into a solid white band.
const float GAS_STRETCH_REF = 2.0;

// Rotate a 4-velocity about the spin axis. Kerr is axisymmetric, so this is
// EXACTLY the 4-velocity of the same orbit at a shifted azimuth — which is
// what lets one uploaded u shade the whole arc: the far end of a tail is
// receding where the head approaches, and that is most of the Doppler swing
// across it. Only the tail's slow radial drift is left unmodelled.
vec4 rotAz(vec4 u, float c, float s) {
  return vec4(u.x, u.y * c - u.w * s, u.z, u.w * c + u.y * s);
}

// Additive emission of the gas at an equatorial crossing. Each blob is drawn
// as the arc it has just been sheared into — swept backward along the exact
// rates matter.ts integrates it forward with — with a round cap at each end,
// shaded with the true 4-velocity at each point of the arc.
vec3 gasEmit(float rc, vec3 pc, float mt, vec3 mv) {
  vec3 e = vec3(0.0);
  float outer = smoothstep(uDiskOuter, uDiskOuter * 0.8, rc);
  if (outer <= 0.0) return e;
  float rp = length(pc.xz);
  float azp = atan(pc.z, pc.x);
  for (int i = 0; i < ${GAS_COUNT}; i++) {
    float size = uGas[i].z;
    float rb = uGasArc[i].w;
    float om = uGasArc[i].y;      // daz/dt, negative: the disk's sense
    float dRdt = uGasArc[i].z;
    float aom = max(abs(om), 1e-5);
    float tailT = min(GAS_TAIL_T, GAS_TAIL_MAX_AZ / aom);

    // The arc only ever drifts outward from the head, so it lives in a thin
    // radial band. Reject on that first: it costs a subtract and saves the
    // azimuth wrap for the 15 of 16 blobs a given pixel is nowhere near.
    if (abs(rp - rb) > 3.2 * size + abs(dRdt) * tailT) continue;

    // Azimuth of the sample point behind the blob, wrapped to (-pi, pi].
    float daz = azp - uGasArc[i].x;
    daz -= 2.0 * PI * floor((daz + PI) / (2.0 * PI));
    // tau > 0 is time BEHIND the blob: where it was, hence where its tail is.
    float tau = -daz / om;
    float along = clamp(tau, 0.0, tailT);
    // Past the arc's ends, close it off with round caps rather than a cut.
    float over = (tau - along) * rb * aom;
    float dR = rp - (rb - dRdt * along);
    float d2 = (dR * dR + over * over) / (size * size);
    if (d2 < 10.0) {
      float dazArc = -om * along;
      vec4 u = rotAz(uGasU[i], cos(dazArc), sin(dazArc));
      float g = uDoppler > 0.5 ? uShift(mt, mv, u) : 1.0;
      float g2 = g * g;
      float stretch = min(1.0, GAS_STRETCH_REF * size / max(rb * aom * tailT, 1e-4));
      float taper = 1.0 - 0.7 * (along / tailT); // brightest at the head
      e += bbColor(15000.0 * g)
         * (uGas[i].w * exp(-d2) * g2 * g2 * 6.0 * outer * stretch * taper);
    }
  }
  return e;
}

// Shift for jet matter streaming at 0.85c along +/-y: the coordinate
// velocity (1, 0, +/-0.85, 0) normalized exactly in the local metric.
float jetShift(vec3 p, float mt, vec3 mv, float bs) {
  float f; vec3 l;
  ksFL(p, f, l);
  float n2 = 1.0 - 0.7225 - f * (1.0 + bs * l.y) * (1.0 + bs * l.y);
  float N = inversesqrt(max(n2, 1e-4));
  // same overflow floor as the other shifts: the denominator is positive
  // for physical rays; near-critical captured rays would otherwise flip it
  // through zero and inject huge negative g^3 emission
  return 1.0 / max(N * (mt + bs * mv.y), 0.3);
}

// Emission per unit length of the bipolar jet at world point p. Knots
// stream outward at beta_j = 0.85 in coordinate time; with Doppler shading
// on, relativistic beaming brightens the jet aimed toward the camera.
vec3 jetEmit(vec3 p, float mt, vec3 mv) {
  float ay = abs(p.y);
  if (ay < 0.7 || ay > 46.0) return vec3(0.0);
  float wj = 0.45 + 0.17 * ay;
  float q2 = dot(p.xz, p.xz) / (wj * wj);
  if (q2 > 5.0) return vec3(0.0);
  float side = p.y > 0.0 ? 0.0 : 19.7;
  // transverse noise coordinate: scaled position, NOT azimuth — atan(z,x) is
  // singular on the axis and paints pinwheel artifacts where rays cross it
  vec2 c = p.xz / wj;
  float m = ay - 0.85 * uSimT; // comoving pattern coordinate
  float n = 0.65 * vnoise(vec3(c * 1.4, m * 0.22 + side))
          + 0.35 * vnoise(vec3(c * 3.1 + 7.0, m * 0.55 + side));
  float knots = smoothstep(0.30, 0.80, n);
  float pulse = 0.5 + 0.5 * sin(m * 0.5 + side);
  pulse *= pulse;
  float core = exp(-q2 * 1.6);
  float fade = smoothstep(0.7, 2.6, ay) * smoothstep(46.0, 30.0, ay)
             / (1.0 + 0.004 * ay * ay);
  float I = core * fade * (0.10 + 0.85 * knots) * (0.35 + 0.90 * pulse) * uJetPower;
  if (uDoppler > 0.5) {
    float g = jetShift(p, mt, mv, 0.85 * sign(p.y));
    g = min(g, 1.6); // artistic clamp: full beaming would white out the frame
    I *= 6.8 * g * g * g;
  }
  vec3 col = mix(vec3(0.35, 0.55, 1.0), vec3(0.85, 0.92, 1.0),
                 min(core + 0.3 * knots, 1.0));
  return col * (I * 0.55);
}

// Line-integrated emission of the orbiting stars across segment a->b
// (gaussian blobs; the line-integral normalization is folded into the
// intensity, which scales as (T/8000K)^2 — a softened luminosity law).
vec3 starSegment(vec3 a, vec3 b, float mt, vec3 mv) {
  vec3 e = vec3(0.0);
  vec3 d = b - a;
  float len2 = max(dot(d, d), 1e-8);
  for (int i = 0; i < ${STAR_COUNT}; i++) {
    vec3 sp = uStarPos[i].xyz;
    float t = clamp(dot(sp - a, d) / len2, 0.0, 1.0);
    vec3 q = a + t * d - sp;
    float sig = uStarPos[i].w;
    float d2 = dot(q, q) / (sig * sig);
    if (d2 < 12.0) {
      float Tk = uStarTemp[i];
      float g = uDoppler > 0.5 ? uShift(mt, mv, uStarU[i]) : 1.0;
      float Tn = Tk * 0.000125;
      float g2 = g * g;
      e += bbColor(Tk * g) * (12.0 * Tn * sqrt(Tn) * g2 * g2 * exp(-d2));
    }
  }
  return e;
}

// Line-integrated emission of the TDE star / debris stream. Consecutive
// debris elements (energy-ordered = stream-ordered) are joined into gaussian
// capsules, so the star spaghettifies into one continuous stream that
// stretches as the elements separate — the closest-point pair between the
// march step and each capsule is found with the standard two-segment
// algorithm, and radius, temperature, and 4-velocity are interpolated along
// the capsule. Per-capsule intensity comes precomputed from the CPU
// (tde.ts segIntensity: eaten/leaving fades plus stretch dimming). Capsules
// combine by strongest contribution, NOT by sum — at every joint two
// capsules touch at full gaussian weight, and summing painted a 2x-bright
// bead on each debris element instead of a smooth filament. Each element
// carries its exact geodesic 4-velocity, so the plunging star's redshift as
// it approaches the horizon (the swallowed-whole case) and the stream
// head's beaming come out of the same g = 1/(m.u) as everything else.

// Cheap erf (tanh fit, ~2% max error) for the along-ray gaussian window.
float erfA(float x) {
  float e = exp(-2.4052 * clamp(x, -4.0, 4.0));
  return 2.0 / (1.0 + e) - 1.0;
}

vec3 tdeSegment(vec3 a, vec3 b, float mt, vec3 mv) {
  vec3 d1 = b - a;
  float aa = max(dot(d1, d1), 1e-8);
  float score = 0.0;
  int win = -1;
  float wt = 0.0;
  for (int i = 0; i < ${TDE_MAX} - 1; i++) {
    if (i >= uTdeN - 1) break;
    float inten = uTdeInfo[i].z;
    if (inten < 1e-4) continue;
    vec3 A = uTdePos[i].xyz;
    vec3 d2 = uTdePos[i + 1].xyz - A;
    vec3 rv = a - A;
    float ee = max(dot(d2, d2), 1e-8);
    float bb = dot(d1, d2);
    float den = aa * ee - bb * bb;
    float s = den > 1e-7 ? clamp((bb * dot(d2, rv) - dot(d1, rv) * ee) / den, 0.0, 1.0) : 0.0;
    float t = clamp((bb * s + dot(d2, rv)) / ee, 0.0, 1.0);
    s = clamp((bb * t - dot(d1, rv)) / aa, 0.0, 1.0);
    vec3 q = (a + s * d1) - (A + t * d2);
    float sig = mix(uTdePos[i].w, uTdePos[i + 1].w, t);
    float q2 = dot(q, q) / (sig * sig);
    if (q2 < 12.0) {
      // Analytic gaussian integral along the step, not a point sample: when
      // the stream runs nearly along the ray, exp(-q2) once per step makes
      // brightness jump with the discrete number of steps inside the tube,
      // which banded the foreshortened stream like a washboard. Distance to
      // the capsule axis is quadratic in the step parameter, so the integral
      // is an erf window of width sigma/sin(theta) centred on the closest
      // approach, normalized so a broadside crossing matches the old point
      // sample.
      float sinT = sqrt(max(den, 0.0) / (aa * ee));
      float w = sig / max(sinT, 0.02);
      float sLin = (bb * t - dot(d1, rv)) / aa;
      float L1 = sqrt(aa);
      float c = inten * exp(-q2) * (w / sig)
              * 0.5 * (erfA((1.0 - sLin) * L1 / w) - erfA(-sLin * L1 / w));
      if (c > score) { score = c; win = i; wt = t; }
    }
  }
  if (win < 0) return vec3(0.0);
  float g = uDoppler > 0.5 ? uShift(mt, mv, mix(uTdeU[win], uTdeU[win + 1], wt)) : 1.0;
  float Tk = mix(uTdeInfo[win].x, uTdeInfo[win + 1].x, wt);
  float Tn = Tk * 0.000125;
  float g2 = g * g;
  return bbColor(Tk * g) * (12.0 * Tn * sqrt(Tn) * score * g2 * g2);
}

// Stars + jet + TDE debris along one march segment, using the current ray momentum.
vec3 matterSegment(vec3 a, vec3 b, float mt, vec3 mv) {
  vec3 e = vec3(0.0);
  if (uJetsOn > 0.5) {
    float ds = distance(a, b);
    if (ds > 2.2) { // long far-field steps: two jet samples to limit aliasing
      e += (jetEmit(mix(a, b, 0.25), mt, mv) + jetEmit(mix(a, b, 0.75), mt, mv)) * (0.5 * ds);
    } else {
      e += jetEmit(mix(a, b, 0.5), mt, mv) * ds;
    }
  }
  if (uStarsOn > 0.5) e += starSegment(a, b, mt, mv);
  if (uTdeN > 0) e += tdeSegment(a, b, mt, mv);
  return e;
}

// Composite one equatorial crossing: gas blobs (additive, they ride on the
// disk surface) then the disk sheet itself (absorbing).
// Returns how much light the DISK SHEET added, which is the weight slice 10
// gives this crossing's polarization. The gas is deliberately not counted:
// nothing in this lab models how an infalling blob polarizes, so its light is
// carried as unpolarized rather than assigned a direction it has not earned.
float shadeCrossing(float rc, vec3 pc, float mt, vec3 mv, float lam,
                    inout vec3 accum, inout float thru) {
  if (uGasOn > 0.5) {
    accum += thru * gasEmit(rc, pc, mt, mv);
  }
  float wgt = 0.0;
  if (uDiskOn > 0.5 && rc > uIsco) {
    float g = uDoppler > 0.5 ? diskG(rc, mt, lam) : 1.0;
    vec4 d = diskSample(rc, pc, g);
    vec3 add = thru * d.rgb * d.a;
    accum += add;
    wgt = dot(add, vec3(0.2126, 0.7152, 0.0722));
    thru *= 1.0 - d.a;
  }
  return wgt;
}

// ---------- polarization (slice 10) ----------
// Mirrors src/polarization.ts, which is the tested oracle; keep the two in
// step. Every line below runs at most a few times per pixel (once per disk
// crossing), never per march step — the whole point of carrying the light's
// polarization on a conserved constant instead of dragging it along the ray.

float gDot4(vec3 p, vec4 A, vec4 B) {
  float f; vec3 l; ksFL(p, f, l);
  return -A.x * B.x + dot(A.yzw, B.yzw)
       + f * (A.x + dot(l, A.yzw)) * (B.x + dot(l, B.yzw));
}

vec4 lower4(vec3 p, vec4 V) {
  float f; vec3 l; ksFL(p, f, l);
  float lv = V.x + dot(l, V.yzw);
  return vec4(-V.x + f * lv, V.yzw + f * lv * l);
}

// eps^{mu nu rho sigma} B_nu C_rho D_sigma: orthogonal to all three. Cheap in
// Kerr-Schild, where det(g) = -1 exactly, so the Levi-Civita tensor is the
// bare permutation symbol. The alternating signs are the whole content.
vec4 cross4(vec3 p, vec4 B, vec4 C, vec4 D) {
  vec4 b = lower4(p, B), c = lower4(p, C), d = lower4(p, D);
  float m123 = b.y*(c.z*d.w - c.w*d.z) - b.z*(c.y*d.w - c.w*d.y) + b.w*(c.y*d.z - c.z*d.y);
  float m023 = b.x*(c.z*d.w - c.w*d.z) - b.z*(c.x*d.w - c.w*d.x) + b.w*(c.x*d.z - c.z*d.x);
  float m013 = b.x*(c.y*d.w - c.w*d.y) - b.y*(c.x*d.w - c.w*d.x) + b.w*(c.x*d.y - c.y*d.x);
  float m012 = b.x*(c.y*d.z - c.z*d.y) - b.y*(c.x*d.z - c.z*d.x) + b.z*(c.x*d.y - c.y*d.x);
  return vec4(-m123, m023, -m013, m012);
}

// The Walker-Penrose constant of the pair (P, F): conserved along the ray, so
// two evaluations settle the whole trip. Written straight in Kerr-Schild —
// the 1/Delta that Boyer-Lindquist would carry cancels before it is used, and
// the azimuth's singularity on the spin axis expands away. See
// src/polarization.ts for why neither survives.
vec2 wpConst(vec3 pos, vec4 P, vec4 F) {
  float x = pos.x, y = pos.y, z = pos.z;
  float r = ksRadius(pos);
  float r2 = r * r;
  float a2 = uSpin * uSpin;
  float D = r2 + a2;
  float ku = r * r2 / (r2 * r2 + a2 * y * y);

  float drP = ku * (x * P.y + z * P.w + (D * y / r2) * P.z);
  float drF = ku * (x * F.y + z * F.w + (D * y / r2) * F.z);
  float wAP = P.x - (uSpin / D) * (z * P.y - x * P.w);
  float wAF = F.x - (uSpin / D) * (z * F.y - x * F.w);
  float A = drP * wAF - drF * wAP;

  float s2r2 = r2 * (x * x + z * z) / D;
  float kb = ku / r2;
  float wBP = kb * (y * (x * P.y + z * P.w) - s2r2 * P.z);
  float wBF = kb * (y * (x * F.y + z * F.w) - s2r2 * F.z);
  float om = y * D * (P.y * F.w - P.w * F.y)
           + r2 * (P.z * (z * F.y - x * F.w) - (z * P.y - x * P.w) * F.z);
  float B = -kb * om - uSpin * (wBP * F.x - wBF * P.x);

  float ct = uSpin * y / r;
  return vec2(r * A - ct * B, -(ct * A + r * B));
}

// Polarized fraction of light leaving a scattering atmosphere at |cos| = mu to
// its normal. Endpoints exact (0 face-on, 11.7% grazing); the curve between
// them is a fit, and it scales tick LENGTHS only. See polarization.ts.
float scatDegree(float mu) {
  float m = min(1.0, abs(mu));
  return 0.117 * (1.0 - m) / (1.0 + m);
}

// A world direction as the unit spatial direction an emitter with 4-velocity u
// sees.
vec4 frameDir(vec3 p, vec4 u, vec4 d) {
  vec4 s = d + gDot4(p, d, u) * u;
  return s * inversesqrt(max(gDot4(p, s, s), 1e-12));
}

// One crossing's arriving polarization, as its components (c1, c2) on the
// camera's sky basis plus the polarized fraction. Returns zero where the light
// leaves along the disk normal: the scattering plane is undefined there and
// the light is genuinely unpolarized, not polarized along whatever direction a
// normalization would have invented.
vec3 crossingPol(float rc, vec3 pc, float mt, vec3 mv, vec2 kH, vec2 kV, float det) {
  float f; vec3 l; ksFL(pc, f, l);
  float Pl = -mt + dot(l, mv);
  vec4 P = vec4(-mt + f * Pl, mv - f * Pl * l);
  float ut = circUt(rc);
  float om = 1.0 / (pow(rc, 1.5) + uSpin);
  vec4 u = vec4(ut, ut * om * pc.z, 0.0, -ut * om * pc.x); // daz/dt = -Omega
  vec4 nrm = frameDir(pc, u, vec4(0.0, 0.0, 1.0, 0.0));
  float E = -gDot4(pc, P, u);
  vec4 k = P / E - u;
  vec4 w = cross4(pc, u, nrm, k);
  float n2 = gDot4(pc, w, w);
  if (n2 < 1e-10) return vec3(0.0);
  vec2 ke = wpConst(pc, P, w * inversesqrt(n2));
  return vec3((ke.x * kV.y - ke.y * kV.x) / det,
              (kH.x * ke.y - kH.y * ke.x) / det,
              scatDegree(gDot4(pc, nrm, k)));
}

// ---------- the photon ring's ladder (slice 9) ----------
// False colour by winding: how many half-turns the ray's position direction
// swept on its way from the camera — 0..1 is the direct view, 1..2 has been
// bent past the antipode once (the first rung of the ring), and so on. Each
// integer boundary is an Einstein ring of the point behind the hole (odd) or
// behind the camera (even), and successive rungs are e^-gamma thinner, which
// is the ladder this view exists to show: a few flat bands at a = 0, a whole
// staircase on the prograde edge at a = 0.998.
//
// The hue is the rung; the scene's own luminance survives as brightness so the
// disk's crossings and the sky still read through it, Reinhard-squashed to
// keep an HDR disk from whiting the band out. Captured pixels stay black.
// unresolved marks rays still winding when the budget ended — their fate is
// exact (lambda and q), their colour in the normal view is not, and this is
// the one place that band is drawn as what it is rather than as sky.
// A hairline at every integer is drawn constant-width from the derivative,
// so the rungs stay countable where they crowd toward the critical curve.
vec3 ladderColor(vec3 scene, float w, bool escaped, bool unresolved) {
  if (!escaped) return vec3(0.0);
  float l = max(scene.r, max(scene.g, scene.b));
  float bright = 0.35 + 0.65 * l / (1.0 + l);
  vec3 hue;
  if (unresolved) hue = ${vec3(LADDER_UNRESOLVED.rgb)};
${LADDER_RUNGS.map((r, i) =>
    i < LADDER_RUNGS.length - 1
      ? `  else if (w < ${(i + 1).toFixed(1)}) hue = ${vec3(r.rgb)};`
      : `  else hue = ${vec3(r.rgb)};`
  ).join("\n")}
  float toEdge = min(fract(w), 1.0 - fract(w));
  float line = 1.0 - smoothstep(0.0, 1.5 * max(fwidth(w), 1e-4), toEdge);
  return hue * bright * (1.0 - 0.7 * line);
}

// Flat-space (bypass) disk-plane crossing at world point p along ray v.
void flatCrossing(vec3 p, vec3 v, inout vec3 accum, inout float thru) {
  float rc2 = dot(p.xz, p.xz) - uSpin * uSpin;
  if (rc2 <= 0.0) return;
  float rc = sqrt(rc2);
  if (rc < uHorizon || rc > uDiskOuter) return;
  float lam = p.z * v.x - p.x * v.z;
  shadeCrossing(rc, vec3(p.x, 0.0, p.z), 1.0, v, lam, accum, thru);
}

void main() {
  // Relative to the viewport, not the window: compare mode draws this pass
  // twice into one target, and gl_FragCoord stays in window coordinates.
  vec2 ndc = ((gl_FragCoord.xy - uViewOrigin) / uResolution) * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  vec3 v = normalize(uCamFwd
                     + ndc.x * uTanHalfFov * aspect * uCamRight
                     + ndc.y * uTanHalfFov * uCamUp);

  vec3 accum = vec3(0.0); // emission composited front-to-back
  float thru = 1.0;       // remaining transmittance toward the sky
  vec3 sky = v;
  bool haveSky = true;    // false = captured by the hole (or occluded)
  bool matterOn = uStarsOn > 0.5 || uJetsOn > 0.5 || uTdeN > 0;
  float swept = 0.0;      // ladder view: position angle swept, radians
  bool unresolved = false; // ladder view: the budget ran out before a verdict
  // slice 10: Stokes of the disk light, accumulated in the camera's sky basis
  vec3 eH = vec3(0.0), eV = vec3(0.0);
  vec2 kH = vec2(0.0), kV = vec2(0.0);
  float polDet = 0.0, polI = 0.0, polQ = 0.0, polU = 0.0;

  // Local view direction in the camera's orthonormal frame. Hoisted out of
  // the lensing branch because the polarization tail projects its director
  // back onto the screen through exactly this vector — the gnomonic chart the
  // ray was launched in.
  vec3 nl = normalize(vec3(ndc.x * uTanHalfFov * aspect, ndc.y * uTanHalfFov, 1.0));

  if (uLensing > 0.5) {
    vec4 mC = nl.x * uTetR + nl.y * uTetU + nl.z * uTetF - uTetT;
    float mt = mC.x;
    vec3 mv = mC.yzw;
    vec3 p = uCamPos;
    float lam = p.z * mv.x - p.x * mv.z; // conserved axial momentum
    // The launch is where the constants are exact — nothing has drifted yet.
    float lambdaC = -lam / mt;
    float qC = carterQ(p, mv, mt);
    float rCam = ksRadius(p);
    float rStop = uHorizon + 0.02;
    bool crossings = uDiskOn > 0.5 || uGasOn > 0.5;
    // Launch direction, for the fate test: dr/dsigma = grad(r) . dx/dsigma with
    // grad(r) = (r/Sigma)(r^2 x, (r^2+a^2) y, r^2 z) — kerr.ts radialDirection.
    // The camera's two sky legs are themselves polarizations: spatial in the
    // static frame and perpendicular to the view direction, hence orthogonal
    // to the ray. Their constants form the basis every crossing is read
    // against, which is what makes this exact at the orbit camera's r = 3.2
    // instead of only far away. eH cannot degenerate: nl always points
    // forward, so it never aligns with the tetrad's right leg.
    if (uPolarization > 0.5) {
      eH = normalize(vec3(1.0, 0.0, 0.0) - nl * nl.x);
      eV = cross(nl, eH);
      vec4 Pc = nl.x * uTetRv + nl.y * uTetUv + nl.z * uTetFv - uTetTv;
      kH = wpConst(p, Pc, eH.x * uTetRv + eH.y * uTetUv + eH.z * uTetFv);
      kV = wpConst(p, Pc, eV.x * uTetRv + eV.y * uTetUv + eV.z * uTetFv);
      polDet = kH.x * kV.y - kH.y * kV.x;
    }

    bool outward;
    {
      vec3 dp0, dm0;
      geoDeriv(p, mv, mt, dp0, dm0);
      float r2 = rCam * rCam;
      outward = dot(vec3(r2 * p.x, (r2 + uSpin * uSpin) * p.y, r2 * p.z), dp0) >= 0.0;
    }

    bool escaped = false;
    bool settled = false; // the march reached a verdict of its own
    haveSky = false;
    for (int i = 0; i < ${MARCH_MAX_STEPS}; i++) {
      if (i >= uMaxSteps) break; // budget spent — the analytic fate decides below
      float r = ksRadius(p);
      vec3 dp1, dm1;
      geoDeriv(p, mv, mt, dp1, dm1);
      // adaptive arc length: fine near the photon shell, coarse far away
      float ds = clamp(0.16 * uStepScale * r * r / (r + 14.0), 0.02, 12.0);
      float h = ds / max(length(dp1), 1e-9);

      vec3 dp2, dm2, dp3, dm3, dp4, dm4;
      geoDeriv(p + 0.5 * h * dp1, mv + 0.5 * h * dm1, mt, dp2, dm2);
      geoDeriv(p + 0.5 * h * dp2, mv + 0.5 * h * dm2, mt, dp3, dm3);
      geoDeriv(p + h * dp3, mv + h * dm3, mt, dp4, dm4);
      float w = h / 6.0;
      vec3 pN = p + w * (dp1 + 2.0 * (dp2 + dp3) + dp4);
      vec3 mvN = mv + w * (dm1 + 2.0 * (dm2 + dm3) + dm4);

      // shade the disk-plane crossing passed during this step, if any
      if (crossings && p.y * pN.y < 0.0) {
        float fr = p.y / (p.y - pN.y);
        vec3 pc = vec3(mix(p.x, pN.x, fr), 0.0, mix(p.z, pN.z, fr));
        float rc2 = dot(pc.xz, pc.xz) - uSpin * uSpin;
        if (rc2 > 0.0) {
          float rc = sqrt(rc2);
          if (rc > uHorizon && rc < uDiskOuter) {
            vec3 mvc = mix(mv, mvN, fr);
            float wgt = shadeCrossing(rc, pc, mt, mvc, lam, accum, thru);
            // Each crossing is resolved BEFORE it is added: two images of the
            // disk overlap with their planes turned differently, and where
            // they do the light really is depolarized. Summing the conserved
            // constants instead would look valid — they are linear — but
            // Stokes parameters are quadratic in the polarization.
            if (uPolarization > 0.5 && wgt > 0.0 && abs(polDet) > 1e-20) {
              vec3 cd = crossingPol(rc, pc, mt, mvc, kH, kV, polDet);
              polI += wgt;
              polQ += wgt * cd.z * (cd.x * cd.x - cd.y * cd.y);
              polU += wgt * cd.z * 2.0 * cd.x * cd.y;
            }
          }
        }
      }

      // volumetric matter (stars, jet) along this step's path segment
      if (matterOn && min(length(p), length(pN)) < 50.0) {
        accum += thru * matterSegment(p, pN, mt, mv);
      }

      // The ladder view's coordinate: the angle the position direction has
      // swept, summed step by step exactly as kerr.ts's winding is. Off the
      // hot path unless asked for — atan per step is not free.
      if (uLadder > 0.5) swept += atan(length(cross(p, pN)), dot(p, pN));

      p = pN;
      mv = mvN;
      float rN = ksRadius(p);
      if (rN < rStop || isnan(rN)) { settled = true; break; } // through the horizon
      if (rN > 64.0 && dot(p, mv) > 0.0) {
        escaped = true;
        settled = true;
        break;
      }
      if (thru < 0.012) { settled = true; break; } // disk is opaque here anyway
    }

    // Loop exhaustion means the ray was still winding at the photon shell — it
    // is NOT evidence of capture, and taking it as such is what painted ~50px
    // of escaping light black on the a = 0.998 prograde edge. No budget can fix
    // that: reaching a verdict by marching costs ~(1/gamma) ln(1/delta)
    // half-orbits, which diverges at the edge, and gamma there is 0.19. So do
    // not ask the march. lambda and q already know, and cost nothing.
    // See docs/DESIGN.md, "what gamma costs the renderer".
    if (!settled) {
      unresolved = true; // still winding when the budget ended
      if (!capturedByConstants(lambdaC, qC, rCam, outward)) escaped = true;
    }

    if (escaped) {
      vec3 dpF, dmF;
      geoDeriv(p, mv, mt, dpF, dmF);
      sky = dpF;
      haveSky = true;
    }
  } else {
    // flat-space bypass: straight rays, opaque (oblate) horizon surface,
    // thin disk, and the same matter without light bending.
    float rHole = sqrt(uHorizon * uHorizon + uSpin * uSpin);
    float bq = dot(uCamPos, v);
    float cq = dot(uCamPos, uCamPos) - rHole * rHole;
    float disc = bq * bq - cq;
    float tHole = 1e30;
    if (disc > 0.0) {
      float th = -bq - sqrt(disc);
      if (th > 0.0) tHole = th;
    }
    float tDisk = 1e30;
    if (abs(v.y) > 1e-6) {
      float t = -uCamPos.y / v.y;
      if (t > 0.0 && t < tHole) tDisk = t;
    }
    float discM = bq * bq - (dot(uCamPos, uCamPos) - 2500.0); // matter inside r < 50
    if (matterOn && discM > 0.0) {
      float tA = max(-bq - sqrt(discM), 0.0);
      float tB = min(-bq + sqrt(discM), tHole);
      float ta = tA;
      for (int i = 1; i <= 64; i++) {
        float tb = mix(tA, tB, float(i) / 64.0);
        if (tDisk >= ta && tDisk < tb)
          flatCrossing(uCamPos + tDisk * v, v, accum, thru);
        accum += thru * matterSegment(uCamPos + ta * v, uCamPos + tb * v, 1.0, v);
        ta = tb;
      }
      if (tDisk < 1e29 && (tDisk < tA || tDisk >= tB))
        flatCrossing(uCamPos + tDisk * v, v, accum, thru);
    } else if (tDisk < 1e29) {
      flatCrossing(uCamPos + tDisk * v, v, accum, thru);
    }
    if (tHole < 1e29) haveSky = false;
  }

  // Resolve the accumulated Stokes and project the director onto the screen.
  // Resolving first and projecting once is the right order: the projection is
  // a perspective map, not a rotation, so combining the crossings inside it
  // would bend the angles it is meant only to draw.
  vec2 polOut = vec2(0.0);
  if (polI > 0.0) {
    float pmag = length(vec2(polQ, polU));
    if (pmag > 0.0) {
      float chi = 0.5 * atan(polU, polQ);
      vec3 e = cos(chi) * eH + sin(chi) * eV;
      vec2 sv = e.xy - nl.xy * (e.z / nl.z);
      float psi = atan(sv.y, sv.x);
      polOut = pmag * vec2(cos(2.0 * psi), sin(2.0 * psi));
    }
  }
  outPol = vec4(polOut, polI, polI > 0.0 ? 1.0 : 0.0);

  vec3 col = accum + (haveSky ? thru * skyColor(normalize(sky)) : vec3(0.0));
  if (uLadder > 0.5) col = ladderColor(col, swept / PI, haveSky, unresolved);
  // float16 fence: one Inf/NaN/negative pixel would smear black blocks
  // through the bloom chain, so clamp and zero anything non-finite
  col = clamp(col, vec3(0.0), vec3(4096.0));
  if (any(isnan(col))) col = vec3(0.0);
  outColor = vec4(col, 1.0);
}`;

export const FS_BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uThreshold;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0);
  k = k * k / (k + 0.5); // soft knee
  outColor = vec4(c * (k / max(l, 1e-4)), 1.0);
}`;

export const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 4.0;
  c += texture(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  outColor = vec4(c / 8.0, 1.0);
}`;

export const FS_UP = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = vec3(0.0);
  c += texture(uTex, vUv + uTexel * vec2(-2.0,  0.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2( 2.0,  0.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2( 0.0,  2.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2( 0.0, -2.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 2.0;
  c += texture(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 2.0;
  c += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
  c += texture(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 2.0;
  outColor = vec4(c / 12.0, 1.0);
}`;

/**
 * How long the longest tick is drawn, as a fraction of the grid pitch. Short
 * of half, so a fully polarized cell's tick still stops clear of its
 * neighbour's and the two read as separate marks rather than a solid line.
 */
export const TICK_MAX_LENGTH = 0.42;
/** Tick spacing in CSS pixels. */
export const TICK_PITCH = 26;

export const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloomTex;
uniform sampler2D uPolTex;
uniform float uBloom;
uniform float uExposure;
uniform float uTicks;      // 1 = draw slice 10's polarization ticks
uniform vec2 uFrame;       // frame size in device pixels
uniform float uTickPitch;  // tick spacing, device pixels
uniform float uSplitX;     // compare mode's divider in device pixels, else -1
in vec2 vUv;
out vec4 outColor;

/**
 * Polarization ticks, drawn after the tone curve so the disk's brightness
 * cannot wash them out and the bloom cannot smear them.
 *
 * Each tick is sampled AT ITS OWN CELL CENTRE — one fetch, so its direction is
 * the polarization of the ray through that point rather than a per-fragment
 * value that would bend the mark. What is stored there is the screen-basis
 * (Q, U) pair, not an angle: angles wrap, and the scene renders below native
 * resolution, so this texture is filtered on the way in and only a linear
 * quantity survives that.
 *
 * Length carries the polarized fraction, so a face-on disk shows almost
 * nothing and a grazing one shows the full mark. Direction is the electric
 * vector as it arrives — the thing the black hole has turned.
 *
 * A mark also fades with the light it describes. The polarized FRACTION says
 * nothing about brightness, so without this the disk's invisible outer fringe
 * — where its opacity has faded to a millionth but not to zero — would carry
 * ticks as bold as the inner ring's, and the overlay would claim a disk out
 * to the corners of the frame. The fade runs on the disk's own tone-mapped
 * contribution, so the ticks stop exactly where the disk does.
 */
vec3 ticks(vec3 c, vec2 pix) {
  vec2 ctr = (floor(pix / uTickPitch) + 0.5) * uTickPitch;
  vec4 pol = texture(uPolTex, ctr / uFrame);
  if (pol.w < 0.5 || pol.z <= 0.0) return c;
  // Through the same exposure and tone curve the frame itself went through, so
  // "bright enough to carry a tick" means what the eye sees, not what the
  // linear buffer holds.
  float lit = pol.z * uExposure;
  lit = (lit * (2.51 * lit + 0.03)) / (lit * (2.43 * lit + 0.59) + 0.14);
  float vis = smoothstep(0.03, 0.18, lit);
  if (vis <= 0.0) return c;
  // not "half": that is a reserved word in GLSL ES
  float halfLen = uTickPitch * ${TICK_MAX_LENGTH.toFixed(2)} * clamp(length(pol.xy) / (pol.z * 0.117), 0.0, 1.0);
  // A tick belongs to the half its centre was traced in; one that would reach
  // across compare mode's divider is dropped rather than drawn over a
  // spacetime it does not describe.
  if (uSplitX >= 0.0 && abs(ctr.x - uSplitX) < halfLen + 2.0) return c;
  if (halfLen < 1.0) return c;
  float psi = 0.5 * atan(pol.y, pol.x);
  vec2 dir = vec2(cos(psi), sin(psi));
  vec2 d = pix - ctr;
  float t = clamp(dot(d, dir), -halfLen, halfLen);
  float dist = length(d - t * dir);
  float ink = 1.0 - smoothstep(0.7, 1.6, dist);
  // The disk runs from near-black at its rim to blown-out white at the inner
  // ring, and one tick colour cannot be read against both. Flip the mark
  // instead of picking a compromise nobody can see.
  vec3 shade = dot(c, vec3(0.2126, 0.7152, 0.0722)) > 0.45
             ? vec3(0.05, 0.06, 0.10)
             : vec3(0.97, 0.98, 1.0);
  return mix(c, shade, 0.85 * ink * vis);
}

void main() {
  vec3 c = texture(uScene, vUv).rgb + uBloom * texture(uBloomTex, vUv).rgb;
  c *= uExposure;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); // ACES approx
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  if (uTicks > 0.5) c = ticks(c, vUv * uFrame);
  outColor = vec4(c, 1.0);
}`;
