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
