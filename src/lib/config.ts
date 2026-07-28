/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
/**
 * Where the static data files live. `import.meta.env.BASE_URL` is whatever Vite
 * built with, which on a Pages project site is `/<repo>/`. Deriving from it
 * means this works at the root or under a subpath without touching anything.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const DATA_BASE = `${BASE}/data`;

/** How often to re-check for a newer element set. */
export const META_POLL_MS = 10 * 60 * 1000;

/** Cached elements older than this are refused. Better no data than wrong data. */
export const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Element sets go off. SGP4 is good to about a kilometre near epoch and drifts
 * to several after a few days, so say so rather than quietly showing positions
 * that are wrong.
 */
export const EPOCH_WARN_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** Keyless CARTO basemap: labels and coastlines, no signup, no API key. */
export const CARTO_DARK_STYLE =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * Globe textures, served from our own origin.
 *
 * These used to come off unpkg. Hotlinking a package CDN for 2 MB of imagery
 * on every visit means their outage is my outage, and it hands every visitor
 * to a third party. Copied into `public/textures/` from the `three-globe`
 * package (NASA Visible Earth imagery, public domain).
 */
export const GLOBE_TEXTURES = {
  earth: `${BASE}/textures/earth-night.jpg`,
  bump: `${BASE}/textures/earth-topology.png`,
  sky: `${BASE}/textures/night-sky.png`,
};
