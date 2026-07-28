/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import * as THREE from 'three';
import { ILLUM } from '../../lib/math/constants';
import { GLOBE_RADIUS, altKmToRelative, polar2CartesianInto } from '../../lib/math/geo';
import type { FrameStore } from '../../lib/store/frameStore';

/**
 * The whole constellation as one `THREE.Points` draw call.
 *
 * The first version of this handed react-globe.gl one datum per satellite. That
 * builds a mesh each: 11,000 objects, 11,000 draw calls and a scene-graph
 * rebuild every time anything moved. Slideshow on a phone. Three typed-array
 * attributes and a single draw call later, it's 60 fps.
 *
 * Positions get interpolated on the CPU between the two most recent propagation
 * frames, so motion stays smooth while SGP4 only runs about once a second.
 */

export interface PointCloudStyle {
  /** Multiplier on the base point size. */
  sizeScale: number;
  /** Render every Nth satellite. 1 = all. */
  stride: number;
  /** Dim satellites in Earth's shadow, since they can't be seen from the ground. */
  dimEclipsed: boolean;
  /** Hide eclipsed satellites entirely. */
  sunlitOnly: boolean;
}

export const DEFAULT_STYLE: PointCloudStyle = {
  sizeScale: 1,
  stride: 1,
  dimEclipsed: true,
  sunlitOnly: false,
};

const COLOR_SUNLIT = new THREE.Color('#5ad1ff');
const COLOR_PENUMBRA = new THREE.Color('#3f9fc4');
const COLOR_UMBRA = new THREE.Color('#2c4b63');
const COLOR_NEAREST = new THREE.Color('#ffd23f');
const COLOR_SELECTED = new THREE.Color('#ff6b5c');

const VERTEX_SHADER = /* glsl */ `
  attribute float size;
  attribute vec3 pointColor;
  varying vec3 vColor;
  void main() {
    vColor = pointColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Perspective size attenuation, clamped so far satellites fade to a haze
    // instead of disappearing sub-pixel.
    gl_PointSize = clamp(size * (420.0 / -mv.z), 1.0, 24.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    // Round, soft-edged sprite. Cheaper and crisper than a texture lookup.
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.12, d);
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class SatellitePointCloud {
  readonly object: THREE.Points;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  /** Cartesian positions for the two frames we interpolate between. */
  private prevXyz: Float32Array;
  private curXyz: Float32Array;

  /** Draw slot -> satellite index, for stride/LOD and picking. */
  private slotToSat: Int32Array;
  private satToSlot: Int32Array;

  private capacity = 0;
  private drawCount = 0;
  private lastSeq = -1;
  private style: PointCloudStyle = { ...DEFAULT_STYLE };
  private selectedIndex = -1;
  private nearestIndices = new Set<number>();

  constructor() {
    this.positions = new Float32Array(0);
    this.colors = new Float32Array(0);
    this.sizes = new Float32Array(0);
    this.prevXyz = new Float32Array(0);
    this.curXyz = new Float32Array(0);
    this.slotToSat = new Int32Array(0);
    this.satToSlot = new Int32Array(0);

    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      // Additive blending makes the freshly launched trains read as bright
      // streaks, which is what they look like from the ground anyway.
      blending: THREE.AdditiveBlending,
      // Depth test on so the globe hides the far side, depth write off so
      // overlapping sprites blend instead of z-fighting.
      depthTest: true,
      depthWrite: false,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
  }

  get visibleCount(): number {
    return this.drawCount;
  }

  setStyle(style: Partial<PointCloudStyle>): void {
    const next = { ...this.style, ...style };
    const strideChanged = next.stride !== this.style.stride;
    this.style = next;
    if (strideChanged) this.rebuildSlots();
    this.lastSeq = -1; // force a colour/size refresh
  }

  setSelected(index: number): void {
    this.selectedIndex = index;
    this.lastSeq = -1;
  }

  setNearest(indices: Iterable<number>): void {
    this.nearestIndices = new Set(indices);
    this.lastSeq = -1;
  }

  /** Map a raycast hit back to a satellite index. */
  slotToSatellite(slot: number): number {
    return slot >= 0 && slot < this.drawCount ? (this.slotToSat[slot] ?? -1) : -1;
  }

  private allocate(count: number): void {
    this.capacity = count;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.prevXyz = new Float32Array(count * 3);
    this.curXyz = new Float32Array(count * 3);
    this.satToSlot = new Int32Array(count).fill(-1);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('pointColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.rebuildSlots();
  }

  private rebuildSlots(): void {
    const stride = Math.max(1, Math.floor(this.style.stride));
    const n = Math.ceil(this.capacity / stride);
    this.slotToSat = new Int32Array(n);
    this.satToSlot.fill(-1);
    let slot = 0;
    for (let i = 0; i < this.capacity; i += stride) {
      this.slotToSat[slot] = i;
      this.satToSlot[i] = slot;
      slot++;
    }
    this.drawCount = slot;
    this.geometry.setDrawRange(0, this.drawCount);
  }

  /**
   * Called once per animation frame.
   *
   * Two rates in here. Cartesian conversion and colouring only run when a new
   * propagation frame lands (`frames.seq` changes); the position lerp runs
   * every frame. That split is what keeps per-frame cost down to three
   * multiply-adds per satellite.
   */
  update(frames: FrameStore, atMs: number): void {
    if (frames.count === 0) return;
    if (frames.count !== this.capacity) this.allocate(frames.count);

    if (frames.seq !== this.lastSeq) {
      this.lastSeq = frames.seq;
      this.deriveCartesian(frames);
      this.refreshAppearance(frames);
    }

    const alpha = frames.alpha(atMs);
    const pos = this.positions;
    const a = this.prevXyz;
    const b = this.curXyz;
    const slots = this.slotToSat;

    for (let s = 0; s < this.drawCount; s++) {
      const i3 = slots[s]! * 3;
      const o3 = s * 3;
      // Straight line over a ~1 s arc. The chord is under a metre off the true
      // orbit at LEO speeds, nowhere near a screen pixel.
      pos[o3] = a[i3]! + (b[i3]! - a[i3]!) * alpha;
      pos[o3 + 1] = a[i3 + 1]! + (b[i3 + 1]! - a[i3 + 1]!) * alpha;
      pos[o3 + 2] = a[i3 + 2]! + (b[i3 + 2]! - a[i3 + 2]!) * alpha;
    }

    const attr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  private deriveCartesian(frames: FrameStore): void {
    const prev = frames.previous;
    const cur = frames.current;
    const n = frames.count;

    // Last tick's "current" is this tick's "previous", and it's already been
    // converted. Reuse it rather than redo 11,000 trig calls.
    const tmp = this.prevXyz;
    this.prevXyz = this.curXyz;
    this.curXyz = tmp;

    // On the first tick there is nothing to reuse, so convert both. From then
    // on the swap above has already put the right data in `prevXyz`.
    if (!prev.valid || this.lastSeq <= 1) convertAll(prev.lla, this.prevXyz, n);
    convertAll(cur.lla, this.curXyz, n);
  }

  private refreshAppearance(frames: FrameStore): void {
    const illum = frames.current.illum;
    const colors = this.colors;
    const sizes = this.sizes;
    const slots = this.slotToSat;
    const { sizeScale, dimEclipsed, sunlitOnly } = this.style;

    for (let s = 0; s < this.drawCount; s++) {
      const i = slots[s]!;
      const code = illum[i]!;
      const o3 = s * 3;

      let colour = COLOR_SUNLIT;
      let size = 1.5 * sizeScale;

      if (code === ILLUM.INVALID) {
        sizes[s] = 0;
        colors[o3] = colors[o3 + 1] = colors[o3 + 2] = 0;
        continue;
      }
      if (sunlitOnly && code !== ILLUM.SUNLIT) {
        sizes[s] = 0;
        colors[o3] = colors[o3 + 1] = colors[o3 + 2] = 0;
        continue;
      }

      if (dimEclipsed && code === ILLUM.UMBRA) {
        colour = COLOR_UMBRA;
        size *= 0.75;
      } else if (dimEclipsed && code === ILLUM.PENUMBRA) {
        colour = COLOR_PENUMBRA;
      }

      if (this.nearestIndices.has(i)) {
        colour = COLOR_NEAREST;
        size = 3.2 * sizeScale;
      }
      if (i === this.selectedIndex) {
        colour = COLOR_SELECTED;
        size = 5 * sizeScale;
      }

      colors[o3] = colour.r;
      colors[o3 + 1] = colour.g;
      colors[o3 + 2] = colour.b;
      sizes[s] = size;
    }

    (this.geometry.getAttribute('pointColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function convertAll(lla: Float32Array, out: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    polar2CartesianInto(out, i3, lla[i3]!, lla[i3 + 1]!, altKmToRelative(lla[i3 + 2]!));
  }
}

export { GLOBE_RADIUS };
