/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
/** Physical and geodetic constants, in one place so nothing drifts. */

/** WGS-84 semi-major axis (equatorial radius), km. */
export const EARTH_RADIUS_EQ_KM = 6378.137;
/** WGS-84 semi-minor axis (polar radius), km. */
export const EARTH_RADIUS_POLAR_KM = 6356.7523142;
/** Mean (volumetric) Earth radius, km, used for great-circle distances. */
export const EARTH_RADIUS_MEAN_KM = 6371.0088;

/** Mean Earth-Sun distance, km. */
export const AU_KM = 149_597_870.7;
/** Solar radius, km, needed to distinguish umbra from penumbra. */
export const SUN_RADIUS_KM = 696_000;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TWO_PI = Math.PI * 2;

/** Julian date of the Unix epoch (1970-01-01T00:00:00Z). */
export const JD_UNIX_EPOCH = 2440587.5;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_MINUTE = 60_000;

/**
 * Civil twilight boundary. Below this solar elevation the sky is dark enough
 * that a sunlit satellite is naked-eye visible.
 */
export const TWILIGHT_SUN_ELEVATION_DEG = -6;

/**
 * Minimum elevation for a pass to count. Below about 10° you're looking through
 * buildings, trees and a lot of atmosphere.
 */
export const DEFAULT_MIN_PASS_ELEVATION_DEG = 10;

/**
 * Illumination codes packed into the per-frame `Uint8Array`. `INVALID` marks a
 * slot whose propagation failed this tick. The slot stays put so satellite
 * index doesn't shift between frames.
 */
export const ILLUM = {
  UMBRA: 0,
  PENUMBRA: 1,
  SUNLIT: 2,
  INVALID: 255,
} as const;
