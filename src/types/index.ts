/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type { IlluminationState } from '../lib/math/sun';

export type { IlluminationState };

/** A raw Two-Line Element set. */
export interface TleRecord {
  name: string;
  noradId: number;
  line1: string;
  line2: string;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  /** Metres above sea level, when the browser supplies it. */
  altitudeM?: number;
  /** Reported horizontal accuracy in metres. */
  accuracyM?: number;
}

export type ViewMode = 'globe' | 'map';

/**
 * Per-satellite state for a single instant, as a struct-of-arrays.
 *
 * Everything about the render path is built around this shape. Positions for
 * ~11,000 satellites arrive from the propagation workers as transferable typed
 * arrays and are handed straight to the GPU. They are never turned into
 * JavaScript objects and never enter React state, because doing either at 1 Hz
 * is what makes trackers like this stutter.
 */
export interface PositionFrame {
  /** Simulated time this frame represents, epoch ms. */
  timeMs: number;
  /** Number of valid entries. */
  count: number;
  /** NORAD ids, length `count`. */
  ids: Int32Array;
  /** lat, lng, altKm triples, length `count * 3`. */
  lla: Float32Array;
  /** Speed in km/s, length `count`. */
  speed: Float32Array;
  /** 0 = umbra, 1 = penumbra, 2 = sunlit. Length `count`. */
  illum: Uint8Array;
}

/** A satellite as seen from the observer right now. */
export interface LookAngle {
  noradId: number;
  name: string;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  groundDistanceKm: number;
  altKm: number;
  illumination: IlluminationState;
}

export interface PassPrediction {
  noradId: number;
  name: string;
  riseTimeMs: number;
  riseAzimuthDeg: number;
  peakTimeMs: number;
  peakElevationDeg: number;
  peakAzimuthDeg: number;
  peakRangeKm: number;
  setTimeMs: number;
  setAzimuthDeg: number;
  durationMs: number;
  illumination: IlluminationState;
  /** Sun elevation at the observer at peak. Below -6 degrees means a dark sky. */
  observerSunElevationDeg: number;
  /** Sunlit satellite + dark sky = naked-eye visible. */
  visible: boolean;
  /** True when the pass was still in progress at the end of the search window. */
  truncated: boolean;
}

/** Static, per-satellite metadata derived once at load. */
export interface SatelliteInfo {
  noradId: number;
  name: string;
  inclinationDeg: number;
  periodMinutes: number;
  /** Element-set epoch, i.e. how old the orbit data for this object is. */
  epochMs: number;
  /** Rough launch-batch grouping parsed from the name. */
  block: string | null;
}

export interface SatelliteDetail extends SatelliteInfo {
  lat: number;
  lng: number;
  altKm: number;
  speedKmS: number;
  illumination: IlluminationState;
  look: {
    azimuthDeg: number;
    elevationDeg: number;
    rangeKm: number;
    groundDistanceKm: number;
  } | null;
}

/** Contents of `public/data/meta.json`, written by scripts/fetch-tle.mjs. */
export interface DataMeta {
  ok: boolean;
  satelliteCount: number;
  fetchedAt: number | null;
  hash: string | null;
  source: string;
}
