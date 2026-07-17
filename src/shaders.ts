/** All GLSL (WebGL2 / ES 3.0) shader sources for the slice-4 pipeline. */

import { MARCH_MAX_STEPS } from "./kerr";
import { GAS_COUNT, STAR_COUNT } from "./matter";
import { TDE_MAX } from "./tde";

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
uniform float uStepScale;    // > 1 coarsens the adaptive arc length (low preset)
uniform float uSpin;         // Kerr a in [0, 0.998]
uniform float uHorizon;      // r+ = 1 + sqrt(1 - a^2)
uniform float uIsco;         // prograde ISCO radius for the current spin
uniform float uTNorm;        // temperature-profile peak normalization
uniform vec4 uTetT;          // camera tetrad, covariant legs (t, x, y, z):
uniform vec4 uTetR;          //   m_mu = d.r*R + d.u*U + d.f*F - T
uniform vec4 uTetU;
uniform vec4 uTetF;
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

out vec4 outColor;

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
void shadeCrossing(float rc, vec3 pc, float mt, vec3 mv, float lam,
                   inout vec3 accum, inout float thru) {
  if (uGasOn > 0.5) {
    accum += thru * gasEmit(rc, pc, mt, mv);
  }
  if (uDiskOn > 0.5 && rc > uIsco) {
    float g = uDoppler > 0.5 ? diskG(rc, mt, lam) : 1.0;
    vec4 d = diskSample(rc, pc, g);
    accum += thru * d.rgb * d.a;
    thru *= 1.0 - d.a;
  }
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

  if (uLensing > 0.5) {
    // launch: local view direction in the camera's orthonormal frame
    vec3 nl = normalize(vec3(ndc.x * uTanHalfFov * aspect, ndc.y * uTanHalfFov, 1.0));
    vec4 mC = nl.x * uTetR + nl.y * uTetU + nl.z * uTetF - uTetT;
    float mt = mC.x;
    vec3 mv = mC.yzw;
    vec3 p = uCamPos;
    float lam = p.z * mv.x - p.x * mv.z; // conserved axial momentum
    float rStop = uHorizon + 0.02;
    bool crossings = uDiskOn > 0.5 || uGasOn > 0.5;

    bool escaped = false;
    haveSky = false;
    for (int i = 0; i < ${MARCH_MAX_STEPS}; i++) {
      if (i >= uMaxSteps) break; // budget spent = winding: falls through as captured
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
            shadeCrossing(rc, pc, mt, mix(mv, mvN, fr), lam, accum, thru);
          }
        }
      }

      // volumetric matter (stars, jet) along this step's path segment
      if (matterOn && min(length(p), length(pN)) < 50.0) {
        accum += thru * matterSegment(p, pN, mt, mv);
      }

      p = pN;
      mv = mvN;
      float rN = ksRadius(p);
      if (rN < rStop || isnan(rN)) break; // fell through the horizon: captured
      if (rN > 64.0 && dot(p, mv) > 0.0) {
        escaped = true;
        break;
      }
      if (thru < 0.012) break; // disk is opaque here anyway
    }
    // Loop exhaustion = winding at the photon shell: leave as captured. What
    // that costs is set by the photon orbit's Lyapunov exponent, and at high
    // spin it is not small: the prograde orbit's gamma falls to 0.19 at
    // a = 0.998, so its rays linger and blow this budget while still outside
    // the true shadow, painting ~50px of extra black on that edge in a
    // sky-lit view. See docs/DESIGN.md, "what gamma costs the renderer".

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

  vec3 col = accum + (haveSky ? thru * skyColor(normalize(sky)) : vec3(0.0));
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

export const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloomTex;
uniform float uBloom;
uniform float uExposure;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb + uBloom * texture(uBloomTex, vUv).rgb;
  c *= uExposure;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); // ACES approx
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}`;
