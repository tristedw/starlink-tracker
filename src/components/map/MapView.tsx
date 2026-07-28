/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, LineString, Polygon, Position } from 'geojson';
import { CARTO_DARK_STYLE } from '../../lib/config';
import { circlePoints, footprintRadiusDeg, splitAtAntimeridian } from '../../lib/math/geo';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';
import type { GeoLocation } from '../../types';
import type { PointCloudStyle } from '../globe/SatellitePointCloud';
import { SatelliteGLLayer } from './SatelliteGLLayer';

interface Props {
  observer: GeoLocation | null;
  style: PointCloudStyle;
  showOrbit: boolean;
  showFootprint: boolean;
  onPickLocation: (loc: GeoLocation) => void;
}

const TRACK_SRC = 'ground-track';
const FOOTPRINT_SRC = 'footprint';
const OBSERVER_SRC = 'observer';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Re-sample the ground track every N ms of simulated time. */
const ORBIT_REFRESH_MS = 60_000;

/**
 * 2D map.
 *
 * Satellites go through a custom WebGL layer, see SatelliteGLLayer. Only the
 * one-off overlays (ground track, footprint, observer marker) use GeoJSON
 * sources, where the convenience is free.
 */
export default function MapView({
  observer,
  style,
  showOrbit,
  showFootprint,
  onPickLocation,
}: Props) {
  const engine = useEngine();
  const snapshot = useEngineSnapshot();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const layerRef = useRef<SatelliteGLLayer | null>(null);
  const readyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const framedRef = useRef(false);
  const orbitTokenRef = useRef(0);

  // --- map setup -----------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK_STYLE,
      center: [0, 20],
      zoom: 1.4,
      attributionControl: { compact: true },
      // The globe view covers 3D. Keeping this strictly planar means the
      // custom Mercator layer's maths is exact, not approximate.
      renderWorldCopies: true,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }),
      'bottom-left'
    );

    map.on('load', () => {
      map.addSource(TRACK_SRC, { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: `${TRACK_SRC}-line`,
        type: 'line',
        source: TRACK_SRC,
        paint: {
          'line-color': '#ff8f7a',
          'line-width': 1.8,
          'line-opacity': 0.85,
        },
      });

      map.addSource(FOOTPRINT_SRC, { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: `${FOOTPRINT_SRC}-fill`,
        type: 'fill',
        source: FOOTPRINT_SRC,
        paint: { 'fill-color': '#ffd23f', 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: `${FOOTPRINT_SRC}-line`,
        type: 'line',
        source: FOOTPRINT_SRC,
        paint: { 'line-color': '#ffd23f', 'line-width': 1.2, 'line-opacity': 0.6 },
      });

      map.addSource(OBSERVER_SRC, { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: `${OBSERVER_SRC}-halo`,
        type: 'circle',
        source: OBSERVER_SRC,
        paint: {
          'circle-radius': 14,
          'circle-color': '#39ff6a',
          'circle-opacity': 0.15,
        },
      });
      map.addLayer({
        id: `${OBSERVER_SRC}-dot`,
        type: 'circle',
        source: OBSERVER_SRC,
        paint: {
          'circle-radius': 5,
          'circle-color': '#39ff6a',
          'circle-stroke-color': '#04160a',
          'circle-stroke-width': 2,
        },
      });

      const layer = new SatelliteGLLayer(engine.frames, style);
      layerRef.current = layer;
      map.addLayer(layer);
      readyRef.current = true;
    });

    return () => {
      readyRef.current = false;
      layerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Mount once on purpose. The map is imperative, and rebuilding it on a
    // prop change throws away tiles, camera position and GL state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- animation loop ------------------------------------------------------
  useEffect(() => {
    const loop = () => {
      const layer = layerRef.current;
      const map = mapRef.current;
      if (layer && map && readyRef.current) {
        layer.sync(engine.clock.now());
        map.triggerRepaint();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [engine]);

  // --- click: pick a satellite, else pick a location -----------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const layer = layerRef.current;
      const hit = layer?.pick(e.point.x, e.point.y) ?? -1;
      if (hit >= 0) {
        const id = engine.frames.ids[hit];
        if (id !== undefined) {
          engine.select(id);
          return;
        }
      }
      onPickLocation({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [engine, onPickLocation]);

  // --- style / selection ---------------------------------------------------
  useEffect(() => {
    layerRef.current?.setStyle(style);
  }, [style]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setSelected(
      snapshot.selectedId !== null ? engine.frames.indexOf(snapshot.selectedId) : -1
    );
  }, [snapshot.selectedId, engine, snapshot.satelliteCount]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const indices: number[] = [];
    for (const n of snapshot.nearest) {
      const i = engine.frames.indexOf(n.noradId);
      if (i >= 0) indices.push(i);
    }
    layer.setNearest(indices);
  }, [snapshot.nearest, engine]);

  // --- ground track --------------------------------------------------------
  // Re-sample as sim time advances. It's a ground track, so the Earth turning
  // under it pulls a once-computed path away from the satellite. Bucketing on
  // sim time keeps it cheap at 1x and right at 300x.
  const orbitEpoch = Math.floor(snapshot.frameTimeMs / ORBIT_REFRESH_MS);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(TRACK_SRC) as GeoJSONSource | undefined;
    if (!src) return;

    if (snapshot.selectedId === null || !showOrbit) {
      src.setData(EMPTY);
      return;
    }

    const token = ++orbitTokenRef.current;
    engine.pool
      .getOrbit(snapshot.selectedId, engine.clock.now(), 1.05, 400)
      .then((result) => {
        if (token !== orbitTokenRef.current || !result) return;
        const pts: { lat: number; lng: number }[] = [];
        for (let i = 0; i < result.path.length; i += 3) {
          pts.push({ lat: result.path[i]!, lng: result.path[i + 1]! });
        }
        // A ground track always crosses the antimeridian. Unsplit, it draws
        // as a smear straight across the map.
        const features: Feature<LineString>[] = splitAtAntimeridian(pts).map((seg) => ({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: seg.map((p) => [p.lng, p.lat] as Position),
          },
        }));
        src.setData({ type: 'FeatureCollection', features });
      })
      .catch(() => undefined);
  }, [snapshot.selectedId, showOrbit, engine, orbitEpoch]);

  // --- footprint -----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(FOOTPRINT_SRC) as GeoJSONSource | undefined;
    if (!src) return;

    const detail = snapshot.selectedDetail;
    if (!detail || !showFootprint) {
      src.setData(EMPTY);
      return;
    }

    const radius = footprintRadiusDeg(detail.altKm, 0);
    const ring = circlePoints({ lat: detail.lat, lng: detail.lng }, radius, 128);
    const segments = splitAtAntimeridian(ring);

    // A footprint straddling the antimeridian can't be one GeoJSON polygon,
    // so draw the boundary as lines instead.
    const feature: Feature<Polygon> | null =
      segments.length === 1
        ? {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [ring.map((p) => [p.lng, p.lat] as Position)],
            },
          }
        : null;

    src.setData(
      feature
        ? { type: 'FeatureCollection', features: [feature] }
        : {
            type: 'FeatureCollection',
            features: segments.map<Feature<LineString>>((seg) => ({
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: seg.map((p) => [p.lng, p.lat] as Position),
              },
            })),
          }
    );
  }, [snapshot.selectedDetail, showFootprint]);

  // --- observer ------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(OBSERVER_SRC) as GeoJSONSource | undefined;
    if (!src) return;

    src.setData(
      observer
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: [observer.lng, observer.lat] },
              },
            ],
          }
        : EMPTY
    );

    if (observer && !framedRef.current) {
      framedRef.current = true;
      map.flyTo({ center: [observer.lng, observer.lat], zoom: 3.5, duration: 1200 });
    }
  }, [observer, snapshot.satelliteCount]);

  return <div ref={containerRef} className="map-host" />;
}
