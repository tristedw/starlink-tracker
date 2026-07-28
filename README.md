# Starlink Tracker - By TristEdw

Made by Tristan Edwards ([TristEdw](https://github.com/tristedw))

A 3D globe and 2D map showing where every Starlink satellite is right now.

I've had Starlink for a while and got curious about which of the things
overhead I was actually talking to. Turns out nobody had built quite what I
wanted, so here it is. It answers three questions: what's above me, can I see
any of it, and when's the next one.

Live at https://tristedw.github.io/starlink-tracker/

## What it does

The globe draws the whole constellation in a single GPU call, with the Earth's
shadow, orbit paths and coverage footprints. The map view is the same data on a
CARTO dark basemap, with ground tracks split properly at the antimeridian
instead of smeared across the screen.

Give it a location and it ranks the nearest satellites, splitting the ones
actually above your horizon from the ones that only look close on a map.
Azimuth is shown as a compass bearing, so you can turn and look rather than do
arithmetic.

Pass prediction searches the whole constellation and pins rise, peak and set to
sub-second accuracy. There's a naked-eye filter, which is the one I actually
use: sunlit satellite, dark sky where you're standing.

The time scrubber plays, pauses, rewinds and runs up to 300x. It isn't
replaying a recording. The constellation gets re-derived at whatever instant
you land on, so backwards works exactly as well as forwards.

The last element set is cached in IndexedDB, so coming back a second time draws
before the network has even resolved.

Location is optional. If you'd rather not hand over geolocation, click anywhere
on the globe or map to drop a pin.

## How it works

Positions come from SGP4 propagation of Celestrak's Starlink element set.
There's no backend. A GitHub Actions cron pulls the elements every 2 hours and
rebuilds the site, so the data ships as a static file next to the bundle and
visitors only ever hit GitHub's CDN.

Most of the client design falls out of one number: propagating ~11,000 SGP4
objects costs roughly 70 ms on a desktop core, and several times that on a
phone. So the work is sharded across a pool of web workers, each owning a
strided slice of the catalogue. Frames come back as transferable typed arrays
and the buffers get handed straight back for reuse, so steady state allocates
nothing.

Positions never touch React. They live in typed arrays the renderers read
directly, and only the slow-moving stuff (counts, nearest list, selection) gets
published to React a few times a second. Each view draws in one call: the globe
is a single `THREE.Points` with a custom shader, the map is a custom MapLibre
WebGL layer. Neither rebuilds scene-graph objects or re-parses GeoJSON as things
move. SGP4 itself only runs about once a second and the renderers interpolate
between the two most recent frames.

## Layout

```
src/
  lib/math/     SGP4 wrappers, geodesy, solar geometry, pass search
  lib/store/    simulation clock, frame store, app engine
  lib/api/      data loader with retry, ETag and cache fallback
  workers/      propagation shard workers and pool manager
  components/   globe/, map/, panels/, controls/, layout/
  test/         unit and integration tests, no browser needed
scripts/
  fetch-tle.mjs downloads and validates the element set at build time
```

## Running it

```bash
npm install
npm run dev
```

That's it. `npm run dev` grabs the element set first if there isn't a recent
copy in `public/data/`, then starts Vite on 5173.

```bash
npm test                  # unit and integration tests
npm run verify            # typecheck + tests + production build
npm run data -- --force   # force a fresh element download
```

`public/data/` is gitignored. It's build output, not source.

## Deploying

Push to `main`. The workflow in `.github/workflows/deploy.yml` typechecks, runs
the tests, downloads a fresh element set, builds and publishes to Pages. It also
fires on a 2 hour cron so the deployed data doesn't go stale, and you can kick
it off by hand from the Actions tab.

On a fork you need Settings > Pages > Source set to **GitHub Actions**, then a
push to `main`. The base path comes from the repo name at build time, so any
fork name works without editing anything. If you're hosting at the root of a
user site instead, set `BASE_PATH: /` in the build step.

One gotcha: GitHub disables scheduled workflows on a repo that's had no activity
for 60 days. If the data ever looks frozen, that's usually why.

Pages can't set response headers, so the CSP lives in a
`<meta http-equiv="Content-Security-Policy">` tag in `index.html`. It's
`default-src 'self'` with one hole for the CARTO basemap.

## Data and limitations

Worth a read before you trust anything on screen.

Elements come from [Celestrak's](https://celestrak.org) Starlink group,
refreshed every 2 hours. Celestrak asks for one download per update window,
rate limits repeat hits on the big groups, and sends no CORS headers, which is
why that download happens once in CI and not in your browser.

Positions are predictions, not measurements. SGP4 is good to about a kilometre
near the element epoch and drifts to several kilometres after a few days. The UI
shows element age and warns you when it's getting old.

The constellation isn't one shell, which trips up a lot of trackers.
Inclinations of 43, 53, 53.2, 70 and 97.6 degrees are all flying, and altitudes
run from about 330 km (Direct-to-Cell, named `STARLINK-nnnnn [DTC]`) up to about
570 km. Altitude, inclination and period are derived per satellite from the
element set here, never assumed.

Visibility uses a conical umbra/penumbra shadow model and a -6 degree civil
twilight threshold at the observer. It doesn't model satellite brightness, so a
pass marked visible can still be too faint to actually pick out.

There's no archive. Scrubbing back a week shows where SGP4 says the satellites
were, not where anyone observed them, and accuracy drops off the further you go.

Globe textures are self-hosted in `public/textures/` (NASA Visible Earth
imagery, out of the `three-globe` package) rather than hotlinked off a package
CDN. The CARTO basemap is the only external thing left at runtime.

Not affiliated with SpaceX or Starlink. Just a fan project.

## Licence

MIT, see [LICENSE](./LICENSE).
