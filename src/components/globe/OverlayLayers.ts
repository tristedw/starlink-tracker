/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import * as THREE from 'three';
import { GLOBE_RADIUS, altKmToRelative, circlePoints, footprintRadiusDeg, polar2Cartesian } from '../../lib/math/geo';
import type { GeoPoint } from '../../lib/math/geo';

/**
 * The non-instanced globe overlays: orbit path, coverage footprint and observer
 * marker. Small geometries that only get rebuilt when the selection changes, so
 * nothing clever needed here.
 */

export class OrbitPathLayer {
  readonly object = new THREE.Group();
  private line: THREE.Line | null = null;
  private marker: THREE.Mesh;

  constructor() {
    const geo = new THREE.SphereGeometry(1.4, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: '#ff6b5c' });
    this.marker = new THREE.Mesh(geo, mat);
    this.marker.visible = false;
    this.object.add(this.marker);
  }

  /** `path` is lat/lng/altKm triples, as produced by the propagation worker. */
  setPath(path: Float32Array | null): void {
    if (this.line) {
      this.object.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
      this.line = null;
    }
    if (!path || path.length < 6) return;

    const n = path.length / 3;
    const verts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = polar2Cartesian(path[i * 3]!, path[i * 3 + 1]!, altKmToRelative(path[i * 3 + 2]!));
      verts[i * 3] = p.x;
      verts[i * 3 + 1] = p.y;
      verts[i * 3 + 2] = p.z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    const material = new THREE.LineBasicMaterial({
      color: '#ff8f7a',
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    this.line = new THREE.Line(geometry, material);
    this.line.renderOrder = 9;
    this.object.add(this.line);
  }

  setMarker(lat: number, lng: number, altKm: number): void {
    const p = polar2Cartesian(lat, lng, altKmToRelative(altKm));
    this.marker.position.set(p.x, p.y, p.z);
    this.marker.visible = true;
  }

  hideMarker(): void {
    this.marker.visible = false;
  }

  dispose(): void {
    this.setPath(null);
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
  }
}

/**
 * The circle on the ground where the satellite is above the horizon. Clearest
 * possible answer to "can I see it from here".
 */
export class FootprintLayer {
  readonly object = new THREE.Group();
  private loop: THREE.LineLoop | null = null;

  update(centre: GeoPoint | null, altKm: number, minElevationDeg: number): void {
    this.clear();
    if (!centre) return;

    const radius = footprintRadiusDeg(altKm, minElevationDeg);
    if (radius <= 0) return;

    const pts = circlePoints(centre, radius, 96);
    const verts = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      // Lift the ring slightly off the surface or the globe z-fights it.
      const v = polar2Cartesian(p.lat, p.lng, 0.004);
      verts[i * 3] = v.x;
      verts[i * 3 + 1] = v.y;
      verts[i * 3 + 2] = v.z;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    const material = new THREE.LineBasicMaterial({
      color: '#ffd23f',
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    this.loop = new THREE.LineLoop(geometry, material);
    this.loop.renderOrder = 8;
    this.object.add(this.loop);
  }

  clear(): void {
    if (!this.loop) return;
    this.object.remove(this.loop);
    this.loop.geometry.dispose();
    (this.loop.material as THREE.Material).dispose();
    this.loop = null;
  }

  dispose(): void {
    this.clear();
  }
}

export class ObserverMarker {
  readonly object: THREE.Group;
  private pin: THREE.Mesh;
  private ring: THREE.Mesh;

  constructor() {
    this.object = new THREE.Group();
    this.pin = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#39ff6a' })
    );
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 2.6, 32),
      new THREE.MeshBasicMaterial({
        color: '#39ff6a',
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.object.add(this.pin, this.ring);
    this.object.visible = false;
    this.object.renderOrder = 11;
  }

  update(location: GeoPoint | null): void {
    if (!location) {
      this.object.visible = false;
      return;
    }
    const p = polar2Cartesian(location.lat, location.lng, 0.005);
    this.pin.position.set(p.x, p.y, p.z);
    this.ring.position.set(p.x, p.y, p.z);
    // Lay the ring flat against the sphere at that point.
    this.ring.lookAt(0, 0, 0);
    this.object.visible = true;
  }

  dispose(): void {
    this.pin.geometry.dispose();
    (this.pin.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}

export { GLOBE_RADIUS };
