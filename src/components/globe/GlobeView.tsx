/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Globe from 'react-globe.gl';
import { GLOBE_TEXTURES } from '../../lib/config';
import { GLOBE_RADIUS } from '../../lib/math/geo';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery';
import type { GeoLocation } from '../../types';
import { DEFAULT_STYLE, SatellitePointCloud, type PointCloudStyle } from './SatellitePointCloud';
import { FootprintLayer, ObserverMarker, OrbitPathLayer } from './OverlayLayers';

/** Re-sample the ground track every N ms of simulated time. */
const ORBIT_REFRESH_MS = 60_000;

interface Props {
  observer: GeoLocation | null;
  style: PointCloudStyle;
  showOrbit: boolean;
  showFootprint: boolean;
  onPickLocation: (loc: GeoLocation) => void;
}

/**
 * 3D globe.
 *
 * react-globe.gl gives us the sphere, textures, atmosphere and camera controls.
 * Everything satellite-shaped is our own Three.js object dropped into its
 * scene. Keeps the nice parts of the library and skips its per-datum object
 * model, which falls over well before 11,000 points.
 */
export default function GlobeView({
  observer,
  style,
  showOrbit,
  showFootprint,
  onPickLocation,
}: Props) {
  const engine = useEngine();
  const snapshot = useEngineSnapshot();
  const reducedMotion = usePrefersReducedMotion();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globeRef = useRef<any>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // react-globe.gl sizes its canvas to the window, not the parent. Left alone
  // it overflows this pane and paints over the side panel. Measure the host
  // and feed it that.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box) return;
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    ro.observe(host);
    setSize({ width: host.clientWidth, height: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  const cloudRef = useRef<SatellitePointCloud | null>(null);
  const orbitRef = useRef<OrbitPathLayer | null>(null);
  const footprintRef = useRef<FootprintLayer | null>(null);
  const observerRef = useRef<ObserverMarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const framedRef = useRef(false);
  const orbitTokenRef = useRef(0);

  const raycaster = useMemo(() => {
    const r = new THREE.Raycaster();
    // Points need an explicit pick radius in world units. About 2 at
    // GLOBE_RADIUS 100 is a finger-sized target on mobile.
    r.params.Points = { threshold: 2 };
    return r;
  }, []);

  // --- scene setup ---------------------------------------------------------
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const scene: THREE.Scene = globe.scene();

    const cloud = new SatellitePointCloud();
    const orbit = new OrbitPathLayer();
    const footprint = new FootprintLayer();
    const marker = new ObserverMarker();

    scene.add(cloud.object, orbit.object, footprint.object, marker.object);
    cloudRef.current = cloud;
    orbitRef.current = orbit;
    footprintRef.current = footprint;
    observerRef.current = marker;

    return () => {
      scene.remove(cloud.object, orbit.object, footprint.object, marker.object);
      cloud.dispose();
      orbit.dispose();
      footprint.dispose();
      marker.dispose();
      cloudRef.current = null;
      orbitRef.current = null;
      footprintRef.current = null;
      observerRef.current = null;
    };
  }, []);

  // --- animation loop ------------------------------------------------------
  useEffect(() => {
    const loop = () => {
      const cloud = cloudRef.current;
      if (cloud) cloud.update(engine.frames, engine.clock.now());

      // Keep the selected-satellite marker glued to the interpolated position.
      const orbit = orbitRef.current;
      const selected = engine.getSnapshot().selectedId;
      if (orbit && selected !== null) {
        const idx = engine.frames.indexOf(selected);
        if (idx >= 0 && engine.frames.isValid(idx)) {
          const cur = engine.frames.current;
          orbit.setMarker(cur.lla[idx * 3]!, cur.lla[idx * 3 + 1]!, cur.lla[idx * 3 + 2]!);
        }
      } else if (orbit) {
        orbit.hideMarker();
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [engine]);

  // --- style ---------------------------------------------------------------
  useEffect(() => {
    cloudRef.current?.setStyle(style);
  }, [style]);

  // --- selection highlighting ---------------------------------------------
  useEffect(() => {
    const cloud = cloudRef.current;
    if (!cloud) return;
    const idx = snapshot.selectedId !== null ? engine.frames.indexOf(snapshot.selectedId) : -1;
    cloud.setSelected(idx);
  }, [snapshot.selectedId, engine, snapshot.satelliteCount]);

  useEffect(() => {
    const cloud = cloudRef.current;
    if (!cloud) return;
    const indices: number[] = [];
    for (const n of snapshot.nearest) {
      const i = engine.frames.indexOf(n.noradId);
      if (i >= 0) indices.push(i);
    }
    cloud.setNearest(indices);
  }, [snapshot.nearest, engine]);

  // --- orbit path for the selection ---------------------------------------
  // Re-sample as sim time advances. It's a ground track, so the Earth turning
  // under it pulls a once-computed path away from the satellite. Bucketing on
  // sim time keeps it cheap at 1x and right at 300x.
  const orbitEpoch = Math.floor(snapshot.frameTimeMs / ORBIT_REFRESH_MS);

  useEffect(() => {
    const orbit = orbitRef.current;
    if (!orbit) return;
    if (snapshot.selectedId === null || !showOrbit) {
      orbit.setPath(null);
      return;
    }
    const token = ++orbitTokenRef.current;
    engine.pool
      .getOrbit(snapshot.selectedId, engine.clock.now(), 1.05, 220)
      .then((result) => {
        if (token !== orbitTokenRef.current) return;
        orbit.setPath(result?.path ?? null);
      })
      .catch(() => undefined);
  }, [snapshot.selectedId, showOrbit, engine, orbitEpoch]);

  // --- footprint -----------------------------------------------------------
  useEffect(() => {
    const layer = footprintRef.current;
    if (!layer) return;
    const detail = snapshot.selectedDetail;
    if (!detail || !showFootprint) {
      layer.clear();
      return;
    }
    layer.update({ lat: detail.lat, lng: detail.lng }, detail.altKm, 0);
  }, [snapshot.selectedDetail, showFootprint]);

  // --- observer ------------------------------------------------------------
  useEffect(() => {
    observerRef.current?.update(observer);
  }, [observer]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls?.();
    if (controls) {
      controls.autoRotate = !observer && !reducedMotion;
      controls.autoRotateSpeed = 0.3;
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.minDistance = GLOBE_RADIUS * 1.05;
      controls.maxDistance = GLOBE_RADIUS * 6;
    }
    if (observer && !framedRef.current) {
      framedRef.current = true;
      globe.pointOfView?.(
        { lat: observer.lat, lng: observer.lng, altitude: 1.8 },
        reducedMotion ? 0 : 1200
      );
    }
  }, [observer, reducedMotion]);

  // --- picking -------------------------------------------------------------
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const globe = globeRef.current;
      const cloud = cloudRef.current;
      if (!globe || !cloud) return;

      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, globe.camera());
      const hits = raycaster.intersectObject(cloud.object, false);

      if (hits.length > 0 && hits[0]!.index !== undefined) {
        const satIndex = cloud.slotToSatellite(hits[0]!.index);
        const id = satIndex >= 0 ? engine.frames.ids[satIndex] : undefined;
        if (id !== undefined) {
          engine.select(id);
          return;
        }
      }
      // Missed every satellite, so treat it as picking a spot on the Earth.
      const coords = globe.toGlobeCoords?.(event.clientX - rect.left, event.clientY - rect.top);
      if (coords) onPickLocation({ lat: coords.lat, lng: coords.lng });
    },
    [engine, onPickLocation, raycaster]
  );

  return (
    <div className="globe-host" ref={hostRef} onClick={handleClick}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={GLOBE_TEXTURES.earth}
        bumpImageUrl={GLOBE_TEXTURES.bump}
        backgroundImageUrl={GLOBE_TEXTURES.sky}
        showAtmosphere
        atmosphereColor="#4aa8ff"
        atmosphereAltitude={0.16}
        animateIn={false}
      />
    </div>
  );
}

export { DEFAULT_STYLE };
export type { PointCloudStyle };
