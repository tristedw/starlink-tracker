/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import {
  AU_KM,
  DEG2RAD,
  EARTH_RADIUS_MEAN_KM,
  RAD2DEG,
  SUN_RADIUS_KM,
  SUN_RADIUS_KM as R_SUN,
} from './constants';
import type { GeoPoint, Vec3 } from './geo';
import { normaliseLng } from './geo';
import { gmstFromMs, msToJulian } from './time';

/**
 * Solar geometry.
 *
 * This is the part that makes pass predictions worth having. A Starlink is only
 * naked-eye visible when it's in sunlight and you're in the dark. Everything
 * here exists to answer that.
 */

export interface SunState {
  /** Geocentric equatorial position, km. Good to ~0.01°, far better than the
   *  ~0.5° angular radius of the Sun, so shadow tests are not the weak link. */
  eci: Vec3;
  /** Distance to the Sun, km. */
  distanceKm: number;
  /** Right ascension, radians. */
  raRad: number;
  /** Declination, radians. */
  decRad: number;
  /** Greenwich Mean Sidereal Time at this instant, radians. */
  gmstRad: number;
}

/**
 * Low-precision solar position from the Astronomical Almanac (the "Sun's
 * position to 0.01 degree" algorithm). Accurate 1950 to 2050.
 */
export function sunState(ms: number): SunState {
  const n = msToJulian(ms) - 2451545.0;

  const meanLongDeg = (280.46 + 0.9856474 * n) % 360;
  const meanAnomRad = (((357.528 + 0.9856003 * n) % 360) + 360) % 360 * DEG2RAD;

  const eclipticLongRad =
    (meanLongDeg + 1.915 * Math.sin(meanAnomRad) + 0.02 * Math.sin(2 * meanAnomRad)) * DEG2RAD;
  const obliquityRad = (23.439 - 0.0000004 * n) * DEG2RAD;
  const distanceAu =
    1.00014 - 0.01671 * Math.cos(meanAnomRad) - 0.00014 * Math.cos(2 * meanAnomRad);
  const distanceKm = distanceAu * AU_KM;

  const sinLambda = Math.sin(eclipticLongRad);
  const cosLambda = Math.cos(eclipticLongRad);
  const sinEps = Math.sin(obliquityRad);
  const cosEps = Math.cos(obliquityRad);

  return {
    eci: {
      x: distanceKm * cosLambda,
      y: distanceKm * cosEps * sinLambda,
      z: distanceKm * sinEps * sinLambda,
    },
    distanceKm,
    raRad: Math.atan2(cosEps * sinLambda, cosLambda),
    decRad: Math.asin(sinEps * sinLambda),
    gmstRad: gmstFromMs(ms),
  };
}

/** The point on Earth where the Sun is directly overhead. */
export function subsolarPoint(sun: SunState): GeoPoint {
  return {
    lat: sun.decRad * RAD2DEG,
    lng: normaliseLng((sun.raRad - sun.gmstRad) * RAD2DEG),
  };
}

/**
 * Sun elevation above the observer's horizon, degrees.
 * Negative means the Sun has set; below -6° is civil twilight or darker.
 */
export function sunElevationDeg(observer: GeoPoint, sun: SunState): number {
  const latRad = observer.lat * DEG2RAD;
  const hourAngle = sun.gmstRad + observer.lng * DEG2RAD - sun.raRad;
  const sinEl =
    Math.sin(latRad) * Math.sin(sun.decRad) +
    Math.cos(latRad) * Math.cos(sun.decRad) * Math.cos(hourAngle);
  return Math.asin(Math.min(1, Math.max(-1, sinEl))) * RAD2DEG;
}

export type IlluminationState = 'sunlit' | 'penumbra' | 'umbra';

/**
 * Conical Earth-shadow test (Vallado, Fundamentals of Astrodynamics, section
 * 5.3).
 *
 * The cheap version treats Earth's shadow as a cylinder, which gets satellites
 * near the terminator wrong, and those are the ones that matter for visible
 * passes. Umbra and penumbra cones cost a few more trig calls and get it right.
 */
export function illuminationState(satEci: Vec3, sun: SunState): IlluminationState {
  const rMag = Math.hypot(satEci.x, satEci.y, satEci.z);
  if (rMag === 0) return 'umbra';

  const sx = sun.eci.x / sun.distanceKm;
  const sy = sun.eci.y / sun.distanceKm;
  const sz = sun.eci.z / sun.distanceKm;

  const dot = satEci.x * sx + satEci.y * sy + satEci.z * sz;
  // Sunward hemisphere: unconditionally lit.
  if (dot >= 0) return 'sunlit';

  // Angle between the anti-sun direction and the satellite.
  const cosZeta = Math.min(1, Math.max(-1, -dot / rMag));
  const zeta = Math.acos(cosZeta);
  const satHoriz = rMag * Math.cos(zeta);
  const satVert = rMag * Math.sin(zeta);

  const alphaPen = Math.asin((R_SUN + EARTH_RADIUS_MEAN_KM) / sun.distanceKm);
  const penX = EARTH_RADIUS_MEAN_KM / Math.sin(alphaPen);
  const penVert = Math.tan(alphaPen) * (penX + satHoriz);
  if (satVert > penVert) return 'sunlit';

  const alphaUmb = Math.asin((SUN_RADIUS_KM - EARTH_RADIUS_MEAN_KM) / sun.distanceKm);
  const umbX = EARTH_RADIUS_MEAN_KM / Math.sin(alphaUmb);
  const umbVert = Math.tan(alphaUmb) * (umbX - satHoriz);
  return satVert <= umbVert ? 'umbra' : 'penumbra';
}

/** True when the satellite is lit brightly enough to be seen. */
export function isIlluminated(state: IlluminationState): boolean {
  return state !== 'umbra';
}
