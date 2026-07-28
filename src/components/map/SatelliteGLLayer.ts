/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type { CustomLayerInterface, CustomRenderMethod, Map as MlMap } from 'maplibre-gl';
import { ILLUM } from '../../lib/math/constants';
import { lngLatToMercator } from '../../lib/math/geo';
import type { FrameStore } from '../../lib/store/frameStore';
import type { PointCloudStyle } from '../globe/SatellitePointCloud';

/**
 * The constellation on the 2D map, one WebGL draw call.
 *
 * The obvious alternative is a GeoJSON source you `setData` every tick. That's
 * a full parse plus tile re-index of 11,000 features per update: tens of
 * milliseconds of main-thread jank on a mid-range phone, and the map can never
 * animate faster than the propagation rate. This uploads two floats per
 * satellite and lets the GPU do the interpolation instead.
 */

const VERTEX_SRC = `
  precision highp float;
  attribute vec2 a_prev;
  attribute vec2 a_cur;
  attribute vec3 a_color;
  attribute float a_size;
  uniform mat4 u_matrix;
  uniform float u_alpha;
  uniform float u_worldOffset;
  varying vec3 v_color;
  void main() {
    v_color = a_color;
    vec2 pos = mix(a_prev, a_cur, u_alpha);
    gl_Position = u_matrix * vec4(pos.x + u_worldOffset, pos.y, 0.0, 1.0);
    gl_PointSize = a_size;
  }
`;

const FRAGMENT_SRC = `
  precision mediump float;
  varying vec3 v_color;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(v_color, alpha);
  }
`;

const COLOURS = {
  sunlit: [0.35, 0.82, 1.0],
  penumbra: [0.25, 0.62, 0.77],
  umbra: [0.17, 0.29, 0.39],
  nearest: [1.0, 0.82, 0.25],
  selected: [1.0, 0.42, 0.36],
} as const;

export class SatelliteGLLayer implements CustomLayerInterface {
  readonly id = 'starlink-satellites';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private map: MlMap | null = null;
  private program: WebGLProgram | null = null;

  private buffers: {
    prev: WebGLBuffer | null;
    cur: WebGLBuffer | null;
    color: WebGLBuffer | null;
    size: WebGLBuffer | null;
  } = { prev: null, cur: null, color: null, size: null };

  private attribs = { prev: -1, cur: -1, color: -1, size: -1 };
  private uniforms: {
    matrix: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
    worldOffset: WebGLUniformLocation | null;
  } = { matrix: null, alpha: null, worldOffset: null };

  private prevMerc = new Float32Array(0);
  private curMerc = new Float32Array(0);
  private colors = new Float32Array(0);
  private sizes = new Float32Array(0);

  private count = 0;
  private drawCount = 0;
  private slotToSat = new Int32Array(0);
  private lastSeq = -1;
  private alpha = 1;
  private needsUpload = false;
  private appearanceDirty = true;

  private style: PointCloudStyle;
  private selectedIndex = -1;
  private nearestIndices = new Set<number>();
  private devicePixelRatio = 1;

  constructor(
    private frames: FrameStore,
    style: PointCloudStyle
  ) {
    this.style = { ...style };
  }

  // --- lifecycle -----------------------------------------------------------

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;

    this.devicePixelRatio = Math.min(2, window.devicePixelRatio || 1);

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram();
    if (!program || !vs || !fs) return;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('satellite layer link failed:', gl.getProgramInfoLog(program));
      return;
    }
    this.program = program;

    this.attribs.prev = gl.getAttribLocation(program, 'a_prev');
    this.attribs.cur = gl.getAttribLocation(program, 'a_cur');
    this.attribs.color = gl.getAttribLocation(program, 'a_color');
    this.attribs.size = gl.getAttribLocation(program, 'a_size');
    this.uniforms.matrix = gl.getUniformLocation(program, 'u_matrix');
    this.uniforms.alpha = gl.getUniformLocation(program, 'u_alpha');
    this.uniforms.worldOffset = gl.getUniformLocation(program, 'u_worldOffset');

    this.buffers.prev = gl.createBuffer();
    this.buffers.cur = gl.createBuffer();
    this.buffers.color = gl.createBuffer();
    this.buffers.size = gl.createBuffer();
  }

  onRemove(_map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    for (const b of Object.values(this.buffers)) if (b) gl.deleteBuffer(b);
    if (this.program) gl.deleteProgram(this.program);
    this.program = null;

    this.map = null;
  }

  // --- public API ----------------------------------------------------------

  setStyle(style: PointCloudStyle): void {
    const strideChanged = style.stride !== this.style.stride;
    this.style = { ...style };
    if (strideChanged) this.rebuildSlots();
    this.appearanceDirty = true;
  }

  setSelected(index: number): void {
    this.selectedIndex = index;
    this.appearanceDirty = true;
  }

  setNearest(indices: Iterable<number>): void {
    this.nearestIndices = new Set(indices);
    this.appearanceDirty = true;
  }

  /** Called from the app's animation loop before `map.triggerRepaint()`. */
  sync(atMs: number): void {
    const frames = this.frames;
    if (frames.count === 0) return;
    if (frames.count !== this.count) this.allocate(frames.count);

    if (frames.seq !== this.lastSeq) {
      this.lastSeq = frames.seq;
      this.deriveMercator();
      this.appearanceDirty = true;
      this.needsUpload = true;
    }
    if (this.appearanceDirty) {
      this.refreshAppearance();
      this.appearanceDirty = false;
      this.needsUpload = true;
    }
    this.alpha = frames.alpha(atMs);
  }

  /** Map a screen point to the nearest satellite within `radiusPx`. */
  pick(screenX: number, screenY: number, radiusPx = 12): number {
    const map = this.map;
    if (!map || this.drawCount === 0) return -1;

    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    let best = -1;
    let bestDist = radiusPx * radiusPx;

    for (let s = 0; s < this.drawCount; s++) {
      if (this.sizes[s] === 0) continue;
      const i = this.slotToSat[s]!;
      const lat = this.frames.current.lla[i * 3]!;
      const lng = this.frames.current.lla[i * 3 + 1]!;
      // Cheap reject before the costly projection call.
      if (lng < west - 5 || lng > east + 5) continue;

      const p = map.project([lng, lat]);
      const dx = p.x - screenX;
      const dy = p.y - screenY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = i;
      }
    }
    return best;
  }

  // --- rendering -----------------------------------------------------------

  render: CustomRenderMethod = (gl, matrix) => {
    if (!this.program || this.drawCount === 0) return;

    gl.useProgram(this.program);
    if (this.needsUpload) {
      this.upload(gl);
      this.needsUpload = false;
    }

    bind(gl, this.buffers.prev, this.attribs.prev, 2);
    bind(gl, this.buffers.cur, this.attribs.cur, 2);
    bind(gl, this.buffers.color, this.attribs.color, 3);
    bind(gl, this.buffers.size, this.attribs.size, 1);

    gl.uniformMatrix4fv(this.uniforms.matrix, false, matrix);
    gl.uniform1f(this.uniforms.alpha, this.alpha);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    // Draw the wrapped copies, or satellites vanish when you pan past the
    // antimeridian.
    const copies = this.map?.getRenderWorldCopies?.() ? [-1, 0, 1] : [0];
    for (const offset of copies) {
      gl.uniform1f(this.uniforms.worldOffset, offset);
      gl.drawArrays(gl.POINTS, 0, this.drawCount);
    }
  };

  // --- internals -----------------------------------------------------------

  private allocate(count: number): void {
    this.count = count;
    this.prevMerc = new Float32Array(count * 2);
    this.curMerc = new Float32Array(count * 2);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.rebuildSlots();
    this.lastSeq = -1;
  }

  private rebuildSlots(): void {
    const stride = Math.max(1, Math.floor(this.style.stride));
    const n = Math.ceil(this.count / stride);
    this.slotToSat = new Int32Array(n);
    let slot = 0;
    for (let i = 0; i < this.count; i += stride) this.slotToSat[slot++] = i;
    this.drawCount = slot;
  }

  private deriveMercator(): void {
    const prevSrc = this.frames.previous;
    const curSrc = this.frames.current;
    const slots = this.slotToSat;

    // Last tick's "current" becomes this tick's "previous". Satellite index is
    // stable across frames, so the arrays line up.
    const tmp = this.prevMerc;
    this.prevMerc = this.curMerc;
    this.curMerc = tmp;

    if (!prevSrc.valid || this.lastSeq <= 1) {
      fillMercator(prevSrc.lla, this.prevMerc, slots, this.drawCount);
    }
    fillMercator(curSrc.lla, this.curMerc, slots, this.drawCount);

    // Unwrap. Cross the antimeridian between two frames and normalised x jumps
    // by ~1.0, so a naive lerp sends the satellite sliding backwards across the
    // whole map.
    const prev = this.prevMerc;
    const cur = this.curMerc;
    for (let s = 0; s < this.drawCount; s++) {
      const o = s * 2;
      const dx = cur[o]! - prev[o]!;
      if (dx > 0.5) cur[o] = cur[o]! - 1;
      else if (dx < -0.5) cur[o] = cur[o]! + 1;
    }
  }

  private refreshAppearance(): void {
    const illum = this.frames.current.illum;
    const { sizeScale, dimEclipsed, sunlitOnly } = this.style;
    const dpr = this.devicePixelRatio;

    for (let s = 0; s < this.drawCount; s++) {
      const i = this.slotToSat[s]!;
      const code = illum[i]!;
      const o3 = s * 3;

      if (code === ILLUM.INVALID || (sunlitOnly && code !== ILLUM.SUNLIT)) {
        this.sizes[s] = 0;
        continue;
      }

      let colour: readonly number[] = COLOURS.sunlit;
      let size = 3.2 * sizeScale;

      if (dimEclipsed && code === ILLUM.UMBRA) {
        colour = COLOURS.umbra;
        size *= 0.8;
      } else if (dimEclipsed && code === ILLUM.PENUMBRA) {
        colour = COLOURS.penumbra;
      }
      if (this.nearestIndices.has(i)) {
        colour = COLOURS.nearest;
        size = 6 * sizeScale;
      }
      if (i === this.selectedIndex) {
        colour = COLOURS.selected;
        size = 9 * sizeScale;
      }

      this.colors[o3] = colour[0]!;
      this.colors[o3 + 1] = colour[1]!;
      this.colors[o3 + 2] = colour[2]!;
      this.sizes[s] = size * dpr;
    }
  }

  private upload(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    upload(gl, this.buffers.prev, this.prevMerc.subarray(0, this.drawCount * 2));
    upload(gl, this.buffers.cur, this.curMerc.subarray(0, this.drawCount * 2));
    upload(gl, this.buffers.color, this.colors.subarray(0, this.drawCount * 3));
    upload(gl, this.buffers.size, this.sizes.subarray(0, this.drawCount));
  }
}

function fillMercator(
  lla: Float32Array,
  out: Float32Array,
  slots: Int32Array,
  drawCount: number
): void {
  for (let s = 0; s < drawCount; s++) {
    const i3 = slots[s]! * 3;
    const m = lngLatToMercator(lla[i3 + 1]!, lla[i3]!);
    out[s * 2] = m.x;
    out[s * 2 + 1] = m.y;
  }
}

function compile(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('satellite layer shader error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function upload(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  buffer: WebGLBuffer | null,
  data: Float32Array
): void {
  if (!buffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
}

function bind(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  buffer: WebGLBuffer | null,
  location: number,
  size: number
): void {
  if (!buffer || location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}
