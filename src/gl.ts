/** Minimal WebGL2 helpers: program compilation and HDR framebuffers. */

export function compileProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string
): WebGLProgram {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error("Shader compile error: " + gl.getShaderInfoLog(sh));
    }
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("Program link error: " + gl.getProgramInfoLog(prog));
  }
  return prog;
}

export interface Fbo {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  /** Second colour attachment, when one was asked for (slice 10's Stokes target). */
  tex2?: WebGLTexture;
  w: number;
  h: number;
}

function createTex(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  halfFloat: boolean
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const internal = halfFloat ? gl.RGBA16F : gl.RGBA8;
  const type = halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * `extra` adds a second colour attachment and points the framebuffer's draw
 * buffers at both, so a shader that declares two outputs fills them in one
 * pass. That is how slice 10 gets its polarization for free: the scene pass
 * already marched the geodesic, and a second target costs no second march.
 * Draw-buffer state belongs to the framebuffer, so setting it here is enough
 * — the single-attachment targets keep their own default.
 */
export function createFbo(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  halfFloat: boolean,
  extra = false
): Fbo {
  const tex = createTex(gl, w, h, halfFloat);
  const tex2 = extra ? createTex(gl, w, h, halfFloat) : undefined;
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (tex2) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex2, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, tex2, w, h };
}

export function destroyFbo(gl: WebGL2RenderingContext, f: Fbo): void {
  gl.deleteFramebuffer(f.fb);
  gl.deleteTexture(f.tex);
  if (f.tex2) gl.deleteTexture(f.tex2);
}

/**
 * GPU time of a span of draw calls, via EXT_disjoint_timer_query_webgl2
 * (slice 19). The CPU cannot measure this: rAF paces on vsync, so a frame's
 * period reads the display whatever the shader cost until the GPU is the
 * slower of the two, and only the auto preset's fallback settles for that.
 *
 * Results arrive frames later, so queries are pooled and polled in order;
 * `poll` hands back the oldest finished span, or null. A disjoint event
 * (power state change, context switch) invalidates every query in flight,
 * and those are dropped rather than read.
 *
 * `available` is false where the browser withholds the extension (Firefox and
 * Safari at the time of writing), and every method is then a no-op.
 */
export class GpuTimer {
  readonly available: boolean;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pool: WebGLQuery[] = [];
  private readonly pending: { q: WebGLQuery; tag: number }[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.available = this.ext !== null;
  }

  /** `tag` rides with the span and comes back with its reading, since the
   *  reading lands frames after the span was drawn and the caller may need to
   *  know what kind of frame it was. */
  begin(tag = 0): void {
    if (!this.ext || this.active) return;
    const q = this.pool.pop() ?? this.gl.createQuery()!;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
    this.pendingTag = tag;
  }
  private pendingTag = 0;

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push({ q: this.active, tag: this.pendingTag });
    this.active = null;
  }

  /** Milliseconds of the oldest completed span and its tag, or null if none is ready. */
  poll(): { ms: number; tag: number } | null {
    if (!this.ext || this.pending.length === 0) return null;
    const gl = this.gl;
    if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      for (const p of this.pending) this.pool.push(p.q);
      this.pending.length = 0;
      return null;
    }
    const { q, tag } = this.pending[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return null;
    this.pending.shift();
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
    this.pool.push(q);
    return { ms: ns / 1e6, tag };
  }
}
