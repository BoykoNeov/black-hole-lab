import { buildStaticTetrad, ksRadius } from "./kerr";
import { tempNorm } from "./disk";
import {
  bandLabel,
  flareMdotEdd,
  flarePeakEdd,
  hillsMassMsun,
  lengthKm,
  peakTempK,
  tidalRadiusM,
  timeSec,
} from "./astro";
import {
  FALLBACK_T0,
  TDE_MAX,
  aliveBodies,
  bodyU,
  launchTde,
  stepTde,
  type TdeState,
} from "./tde";
import { compileProgram, createFbo, destroyFbo, type Fbo } from "./gl";
import { clearHud, initHud, resizeHud } from "./hud";
import { cameraBasis, attachControls, type CameraState } from "./camera";
import { VS_QUAD, FS_SCENE, FS_BRIGHT, FS_DOWN, FS_UP, FS_COMPOSITE } from "./shaders";
import {
  GAS_COUNT,
  STAR_COUNT,
  STAR_ORBITS,
  type GasBlob,
  gasPosXZ,
  gasU,
  makeSpinCtx,
  mulberry32,
  spawnGasBlob,
  starState,
  stepGasBlob,
} from "./matter";

const BLOOM_LEVELS = 5;
const MAX_DPR = 1.5;

const canvas = document.getElementById("view") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const overlayText = document.getElementById("overlay-text") as HTMLDivElement;

const glMaybe = canvas.getContext("webgl2", { antialias: false });
if (!glMaybe) {
  overlayText.textContent = "WebGL2 is not available in this browser.";
  throw new Error("WebGL2 unavailable");
}
const gl: WebGL2RenderingContext = glMaybe;
const hudCtx = initHud();
const hdr = gl.getExtension("EXT_color_buffer_float") !== null;
if (!hdr) {
  console.warn("EXT_color_buffer_float missing - falling back to LDR bloom");
}

// ---------- programs ----------
const progScene = compileProgram(gl, VS_QUAD, FS_SCENE);
const progBright = compileProgram(gl, VS_QUAD, FS_BRIGHT);
const progDown = compileProgram(gl, VS_QUAD, FS_DOWN);
const progUp = compileProgram(gl, VS_QUAD, FS_UP);
const progComposite = compileProgram(gl, VS_QUAD, FS_COMPOSITE);
const quadVao = gl.createVertexArray()!;

function drawQuad() {
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

const U = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

// ---------- framebuffers ----------
let sceneFbo: Fbo | null = null;
let bloomFbos: Fbo[] = [];

function allocateTargets(w: number, h: number) {
  if (sceneFbo) destroyFbo(gl, sceneFbo);
  bloomFbos.forEach((f) => destroyFbo(gl, f));
  sceneFbo = createFbo(gl, w, h, hdr);
  bloomFbos = [];
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    const s = 2 << i; // 2, 4, 8, 16, 32
    bloomFbos.push(createFbo(gl, Math.max(1, Math.floor(w / s)), Math.max(1, Math.floor(h / s)), hdr));
  }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
    canvas.width = w;
    canvas.height = h;
    allocateTargets(w, h);
  }
  resizeHud(hudCtx.canvas, canvas.clientWidth, canvas.clientHeight, dpr);
}
window.addEventListener("resize", resize);

// ---------- UI ----------
const camera: CameraState = { yaw: 0.6, pitch: 0.15, dist: 25, fovDeg: 60 };
attachControls(canvas, camera);

const params = {
  lensing: true,
  exposure: 1.0,
  bloom: 0.7,
  threshold: 1.0,
  starDensity: 1.0,
  disk: true,
  doppler: true,
  diskTempK: 8000,
  diskBright: 1.0,
  diskOuter: 19,
  stars: true,
  gas: true,
  jets: true,
  jetPower: 1.0,
  timeSpeed: 30, // coordinate time (M) per real second
  spin: 0.7, // Kerr a (must match the slider default in index.html)
  massExp: 6.5, // log10 of the hole mass in solar masses
  mdotExp: -1, // log10 of the accretion rate in Eddington units
  coupleT: true, // disk temperature/brightness follow mass & mdot
  // Learn overlays (slice 6) — bound in 6a, consumed by later sub-slices
  eduCallouts: false,
  eduTrails: false,
  eduClocks: false,
  eduPotential: false,
  eduEmbed: false,
};

// ---------- matter state ----------
let simT = 0; // simulation (coordinate) time in M
let paused = false;
let spinCtx = makeSpinCtx(params.spin);
let tde: TdeState | null = null;

const rng = mulberry32(0x5eed);
const gasBlobs: GasBlob[] = [];
for (let i = 0; i < GAS_COUNT; i++) gasBlobs.push(spawnGasBlob(rng, params.diskOuter));
// pre-scatter the blobs through the disk so t = 0 doesn't start with a ring
for (const b of gasBlobs) stepGasBlob(b, 400 * rng(), params.diskOuter, rng, spinCtx);

const starPosArr = new Float32Array(STAR_COUNT * 4);
const starUArr = new Float32Array(STAR_COUNT * 4);
const starTempArr = new Float32Array(STAR_COUNT);
const gasArr = new Float32Array(GAS_COUNT * 4);
const gasUArr = new Float32Array(GAS_COUNT * 4);
const tdePosArr = new Float32Array(TDE_MAX * 4);
const tdeUArr = new Float32Array(TDE_MAX * 4);
const tdeInfoArr = new Float32Array(TDE_MAX * 4);

function bindSlider(id: string, apply: (v: number) => void, fmt?: (v: number) => string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const show = document.getElementById(id + "-val");
  const update = () => {
    const v = parseFloat(el.value);
    apply(v);
    if (show) show.textContent = fmt ? fmt(v) : el.value;
  };
  el.addEventListener("input", update);
  update();
}
function bindCheckbox(id: string, apply: (v: boolean) => void) {
  const el = document.getElementById(id) as HTMLInputElement;
  el.addEventListener("change", () => apply(el.checked));
  apply(el.checked);
}

bindSlider("fov", (v) => (camera.fovDeg = v));
bindSlider("exposure", (v) => (params.exposure = v));
bindSlider("bloom", (v) => (params.bloom = v));
bindSlider("stars", (v) => (params.starDensity = v));
bindSlider("disktemp", (v) => (params.diskTempK = v));
bindSlider("diskbright", (v) => (params.diskBright = v));
bindSlider("disksize", (v) => (params.diskOuter = v));
bindSlider("timespeed", (v) => (params.timeSpeed = v));
bindSlider("jetpower", (v) => (params.jetPower = v));
bindSlider("spin", (v) => {
  params.spin = v;
  spinCtx = makeSpinCtx(v);
});
const fmtSci = (x: number) => {
  const e = Math.floor(Math.log10(x));
  return `${(x / 10 ** e).toFixed(1)}×10^${e}`;
};
bindSlider("mass", (v) => (params.massExp = v), (v) => fmtSci(10 ** v));
bindSlider("mdot", (v) => (params.mdotExp = v), (v) => (10 ** v).toPrecision(2));
bindCheckbox("couple", (v) => {
  params.coupleT = v;
  (document.getElementById("disktemp") as HTMLInputElement).disabled = v;
});
bindCheckbox("lensing", (v) => (params.lensing = v));
bindCheckbox("disk", (v) => (params.disk = v));
bindCheckbox("doppler", (v) => (params.doppler = v));
bindCheckbox("stars-on", (v) => (params.stars = v));
bindCheckbox("gas-on", (v) => (params.gas = v));
bindCheckbox("jets-on", (v) => (params.jets = v));
bindCheckbox("edu-callouts", (v) => (params.eduCallouts = v));
bindCheckbox("edu-trails", (v) => (params.eduTrails = v));
bindCheckbox("edu-clocks", (v) => (params.eduClocks = v));
bindCheckbox("edu-potential", (v) => (params.eduPotential = v));
bindCheckbox("edu-embed", (v) => (params.eduEmbed = v));

const pauseBtn = document.getElementById("pause") as HTMLButtonElement;
pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
});

const tdeBtn = document.getElementById("tde") as HTMLButtonElement;
tdeBtn.addEventListener("click", () => {
  tde = launchTde(10 ** params.massExp, params.spin);
});

const distReadout = document.getElementById("dist-readout")!;
const physReadout = document.getElementById("phys-readout")!;
const tdeReadout = document.getElementById("tde-readout")!;
const fpsReadout = document.getElementById("fps-readout")!;

// ---------- render loop ----------
let frames = 0;
let fpsT0 = performance.now();
let firstFrame = true;
let lastFrameT = performance.now();

function render() {
  resize();
  if (!sceneFbo) {
    requestAnimationFrame(render);
    return;
  }
  const basis = cameraBasis(camera);

  // advance simulation time and the gas blobs
  const now0 = performance.now();
  const dtReal = Math.min((now0 - lastFrameT) * 0.001, 0.1);
  lastFrameT = now0;
  if (!paused && params.timeSpeed > 0) {
    const dtSim = dtReal * params.timeSpeed;
    simT += dtSim;
    for (const b of gasBlobs) stepGasBlob(b, dtSim, params.diskOuter, rng, spinCtx);
    if (tde) stepTde(tde, dtSim, params.spin, simT, rng);
  }

  // ---- mass -> temperature coupling and the TDE flare ----
  const massMsun = 10 ** params.massExp;
  const mdotBase = 10 ** params.mdotExp;
  const flare =
    tde && tde.tDisrupt !== null
      ? flareMdotEdd(simT - tde.tDisrupt, FALLBACK_T0, flarePeakEdd(massMsun))
      : 0;
  const mdotTot = mdotBase + flare;
  // T ∝ mdot^(1/4) M^(-1/4) (isco)^(-3/4); luminosity ∝ mdot (display-capped)
  const effTempK = params.coupleT
    ? peakTempK(massMsun, mdotTot, spinCtx.isco)
    : params.diskTempK;
  // flare brightness is sqrt-compressed for display (the true bolometric
  // jump is ~mdot and would clip the whole frame to white); the readout
  // reports the physical ratio
  const effBright = params.diskBright * Math.min(Math.sqrt(mdotTot / mdotBase), 8);

  // star + gas uniforms for this frame (positions plus exact 4-velocities)
  for (let i = 0; i < STAR_COUNT; i++) {
    const s = starState(STAR_ORBITS[i], simT, params.spin);
    starPosArr.set(s.pos, i * 4);
    starPosArr[i * 4 + 3] = STAR_ORBITS[i].radius;
    starUArr.set(s.u, i * 4);
    starTempArr[i] = STAR_ORBITS[i].tempK;
  }
  for (let i = 0; i < GAS_COUNT; i++) {
    const b = gasBlobs[i];
    const [gx, gz] = gasPosXZ(b, spinCtx);
    gasArr[i * 4] = gx;
    gasArr[i * 4 + 1] = gz;
    gasArr[i * 4 + 2] = b.size;
    gasArr[i * 4 + 3] = b.bright;
    gasUArr.set(gasU(b, spinCtx), i * 4);
  }

  // TDE star / debris uniforms (exact geodesic positions + 4-velocities)
  const tdeBodies = tde ? aliveBodies(tde) : [];
  const tdeN = Math.min(tdeBodies.length, TDE_MAX);
  for (let i = 0; i < tdeN; i++) {
    const b = tdeBodies[i];
    tdePosArr.set(b.p, i * 4);
    tdePosArr[i * 4 + 3] = b.size;
    tdeUArr.set(bodyU(b, params.spin), i * 4);
    tdeInfoArr[i * 4] = b.tempK;
    tdeInfoArr[i * 4 + 1] = b.bright;
  }

  // static-observer tetrad at the camera (covariant legs for the shader)
  const tet = buildStaticTetrad(basis.pos, params.spin, basis.right, basis.up, basis.fwd);

  // Scene -> HDR target
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo.fb);
  gl.viewport(0, 0, sceneFbo.w, sceneFbo.h);
  gl.useProgram(progScene);
  gl.uniform2f(U(progScene, "uResolution"), sceneFbo.w, sceneFbo.h);
  gl.uniform3fv(U(progScene, "uCamPos"), basis.pos);
  gl.uniform3fv(U(progScene, "uCamRight"), basis.right);
  gl.uniform3fv(U(progScene, "uCamUp"), basis.up);
  gl.uniform3fv(U(progScene, "uCamFwd"), basis.fwd);
  gl.uniform1f(U(progScene, "uTanHalfFov"), Math.tan((camera.fovDeg * Math.PI) / 360));
  gl.uniform1f(U(progScene, "uLensing"), params.lensing ? 1 : 0);
  gl.uniform1f(U(progScene, "uStarDensity"), params.starDensity);
  gl.uniform1f(U(progScene, "uSimT"), simT);
  gl.uniform1f(U(progScene, "uDiskOn"), params.disk ? 1 : 0);
  gl.uniform1f(U(progScene, "uDoppler"), params.doppler ? 1 : 0);
  gl.uniform1f(U(progScene, "uDiskBright"), effBright);
  gl.uniform1f(U(progScene, "uDiskTempK"), effTempK);
  gl.uniform1f(U(progScene, "uDiskOuter"), params.diskOuter);
  gl.uniform1f(U(progScene, "uStarsOn"), params.stars ? 1 : 0);
  gl.uniform1f(U(progScene, "uGasOn"), params.gas ? 1 : 0);
  gl.uniform1f(U(progScene, "uJetsOn"), params.jets ? 1 : 0);
  gl.uniform1f(U(progScene, "uJetPower"), params.jetPower);
  gl.uniform1f(U(progScene, "uSpin"), params.spin);
  gl.uniform1f(U(progScene, "uHorizon"), spinCtx.rHor);
  gl.uniform1f(U(progScene, "uIsco"), spinCtx.isco);
  gl.uniform1f(U(progScene, "uTNorm"), tempNorm(spinCtx.isco));
  gl.uniform4fv(U(progScene, "uTetT"), tet.uCov);
  gl.uniform4fv(U(progScene, "uTetR"), tet.rightCov);
  gl.uniform4fv(U(progScene, "uTetU"), tet.upCov);
  gl.uniform4fv(U(progScene, "uTetF"), tet.fwdCov);
  gl.uniform4fv(U(progScene, "uStarPos"), starPosArr);
  gl.uniform4fv(U(progScene, "uStarU"), starUArr);
  gl.uniform1fv(U(progScene, "uStarTemp"), starTempArr);
  gl.uniform4fv(U(progScene, "uGas"), gasArr);
  gl.uniform4fv(U(progScene, "uGasU"), gasUArr);
  gl.uniform1i(U(progScene, "uTdeN"), tdeN);
  gl.uniform4fv(U(progScene, "uTdePos"), tdePosArr);
  gl.uniform4fv(U(progScene, "uTdeU"), tdeUArr);
  gl.uniform4fv(U(progScene, "uTdeInfo"), tdeInfoArr);
  drawQuad();

  // dev diagnostics (?dbg): scan render targets for NaN/Inf/negatives —
  // a single bad scene pixel smears black blocks through the bloom pyramid
  const dbgScan = location.search.includes("dbg") && frames === 0;
  const dbgReport = (label: string, f: Fbo) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    const buf = new Float32Array(f.w * f.h * 4);
    gl.readPixels(0, 0, f.w, f.h, gl.RGBA, gl.FLOAT, buf);
    let nan = 0, inf = 0, neg = 0, mx = 0;
    for (let k = 0; k < buf.length; k += 4) {
      for (let c = 0; c < 3; c++) {
        const v = buf[k + c];
        if (Number.isNaN(v)) nan++;
        else if (!Number.isFinite(v)) inf++;
        else if (v < 0) neg++;
        else if (v > mx) mx = v;
      }
    }
    console.log(`dbg ${label}: ${f.w}x${f.h} nan=${nan} inf=${inf} neg=${neg} max=${mx.toFixed(1)}`);
  };

  // Bright pass -> bloom level 0
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbos[0].fb);
  gl.viewport(0, 0, bloomFbos[0].w, bloomFbos[0].h);
  gl.useProgram(progBright);
  gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
  gl.uniform1i(U(progBright, "uTex"), 0);
  gl.uniform1f(U(progBright, "uThreshold"), params.threshold);
  drawQuad();

  // Downsample chain
  gl.useProgram(progDown);
  gl.uniform1i(U(progDown, "uTex"), 0);
  for (let i = 1; i < BLOOM_LEVELS; i++) {
    const src = bloomFbos[i - 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbos[i].fb);
    gl.viewport(0, 0, bloomFbos[i].w, bloomFbos[i].h);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(U(progDown, "uTexel"), 1 / src.w, 1 / src.h);
    drawQuad();
  }

  // Upsample chain, additive
  gl.useProgram(progUp);
  gl.uniform1i(U(progUp, "uTex"), 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
    const src = bloomFbos[i + 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbos[i].fb);
    gl.viewport(0, 0, bloomFbos[i].w, bloomFbos[i].h);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(U(progUp, "uTexel"), 1 / src.w, 1 / src.h);
    drawQuad();
  }
  gl.disable(gl.BLEND);

  // Composite -> canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(progComposite);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
  gl.uniform1i(U(progComposite, "uScene"), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, bloomFbos[0].tex);
  gl.uniform1i(U(progComposite, "uBloomTex"), 1);
  gl.uniform1f(U(progComposite, "uBloom"), params.bloom);
  gl.uniform1f(U(progComposite, "uExposure"), params.exposure);
  drawQuad();
  gl.activeTexture(gl.TEXTURE0);

  // HUD overlay (2D canvas above the GL frame; overlays arrive in 6b–6g)
  clearHud(hudCtx, canvas.clientWidth, canvas.clientHeight);

  if (dbgScan) {
    dbgReport("scene", sceneFbo);
    bloomFbos.forEach((f, i) => dbgReport(`bloom${i}`, f));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // dev hook: __wantShot captures the canvas synchronously before the
  // drawing buffer is cleared (headless screenshots miss slow WebGL frames)
  const w = window as unknown as { __wantShot?: boolean; __shot?: string };
  if (w.__wantShot) {
    w.__wantShot = false;
    w.__shot = canvas.toDataURL("image/png");
  }

  if (firstFrame) {
    firstFrame = false;
    overlay.style.display = "none";
  }

  // readouts
  distReadout.textContent =
    `r = ${camera.dist.toFixed(1)} M   r+ = ${spinCtx.rHor.toFixed(2)} M   ` +
    `ISCO ${spinCtx.isco.toFixed(2)} M   t = ${simT.toFixed(0)} M`;
  physReadout.textContent =
    `r+ = ${fmtSci(spinCtx.rHor * lengthKm(massMsun))} km   ` +
    `1 M of time = ${fmtSci(timeSec(massMsun))} s   ` +
    `T peak ${fmtSci(effTempK)} K (${bandLabel(effTempK)})`;
  const hills = hillsMassMsun(spinCtx.rHor);
  let tdeText =
    `sun-like star: r_t = ${tidalRadiusM(massMsun).toFixed(1)} M   ` +
    `Hills mass ${fmtSci(hills)} M☉`;
  if (tde) {
    if (tde.phase === "infall") {
      tdeText = `star infalling: r = ${ksRadius(tde.bodies[0].p, params.spin).toFixed(1)} M, r_t = ${tde.rt.toFixed(1)} M`;
    } else if (tde.phase === "swallowed") {
      tdeText = `swallowed whole — r_t inside the horizon, no flare (M > Hills mass)`;
    } else {
      tdeText =
        `disrupted at r_t = ${tde.rt.toFixed(1)} M — ` +
        (mdotTot > 1.5 * mdotBase
          ? `flare ${(mdotTot / mdotBase).toFixed(1)}× (${fmtSci(mdotTot)} Edd, decaying t^-5/3)`
          : `debris stream spreading, flare peak in ${Math.max(0, tde.tDisrupt! + FALLBACK_T0 - simT).toFixed(0)} M`);
    }
  }
  tdeReadout.textContent = tdeText;
  frames++;
  const now = performance.now();
  if (now - fpsT0 > 500) {
    fpsReadout.textContent = `${((frames * 1000) / (now - fpsT0)).toFixed(0)} fps`;
    frames = 0;
    fpsT0 = now;
  }

  requestAnimationFrame(render);
}

// ---------- boot ----------
// The geodesics are now integrated per pixel on the GPU (no CPU bake);
// the overlay covers shader compilation, hidden after the first frame.
overlayText.textContent = "Compiling geodesic integrator…";
resize();
requestAnimationFrame(render);
