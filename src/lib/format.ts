/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
export function formatKm(km: number, digits = 0): string {
  if (!Number.isFinite(km)) return 'n/a';
  return `${km.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })} km`;
}

export function formatSpeed(kmS: number): string {
  if (!Number.isFinite(kmS)) return 'n/a';
  return `${kmS.toFixed(2)} km/s`;
}

export function formatDeg(deg: number, digits = 1): string {
  if (!Number.isFinite(deg)) return 'n/a';
  return `${deg.toFixed(digits)}°`;
}

export function formatClockTime(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Time until a future instant, or "now" once it has passed. */
export function formatCountdown(targetMs: number, nowMs = Date.now()): string {
  const diff = targetMs - nowMs;
  if (diff <= 0) return 'now';
  return formatDuration(diff);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Human-readable age, e.g. "2h 4m ago". */
export function formatAge(ms: number): string {
  const age = Date.now() - ms;
  if (!Number.isFinite(age)) return 'unknown';
  if (age < 60_000) return 'just now';
  return `${formatDuration(age)} ago`;
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** Azimuth in degrees to a 16-point compass label, far easier to act on. */
export function compassPoint(azimuthDeg: number): string {
  if (!Number.isFinite(azimuthDeg)) return 'n/a';
  const idx = Math.round((((azimuthDeg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[idx]!;
}

export function formatAzimuth(azimuthDeg: number): string {
  if (!Number.isFinite(azimuthDeg)) return 'n/a';
  return `${compassPoint(azimuthDeg)} ${Math.round(azimuthDeg)}°`;
}

export function formatCoords(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'n/a';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}°${ns}, ${Math.abs(lng).toFixed(3)}°${ew}`;
}
