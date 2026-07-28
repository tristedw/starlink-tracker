/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoLocation } from '../types';

export type GeoStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'error'
  | 'manual';

const STORAGE_KEY = 'starlink-tracker:observer';

export interface GeolocationApi {
  status: GeoStatus;
  location: GeoLocation | null;
  errorMessage: string | null;
  /** True while a `watchPosition` subscription is active. */
  watching: boolean;
  request: () => void;
  setManual: (location: GeoLocation) => void;
  clear: () => void;
  toggleWatch: () => void;
}

/**
 * Observer position. The tracker is not much use without one, so there are
 * three ways to get it: the geolocation API, a manual pick on the map or globe,
 * and whatever was remembered from last time.
 *
 * That last one matters more than it sounds. Come back a second time and you
 * see what's overhead straight away, instead of a permission prompt before
 * anything interesting has happened.
 */
export function useGeolocation(): GeolocationApi {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as GeoLocation;
      if (Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lng)) {
        setLocation(parsed);
        setStatus('manual');
      }
    } catch {
      /* corrupted entry, start fresh */
    }
  }, []);

  const persist = useCallback((loc: GeoLocation | null) => {
    try {
      if (loc) localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage disabled, so the app works but won't remember */
    }
  }, []);

  const apply = useCallback(
    (pos: GeolocationPosition, nextStatus: GeoStatus) => {
      const loc: GeoLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        ...(pos.coords.altitude !== null ? { altitudeM: pos.coords.altitude } : {}),
        accuracyM: pos.coords.accuracy,
      };
      setLocation(loc);
      persist(loc);
      setStatus(nextStatus);
    },
    [persist]
  );

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus('requesting');
    setErrorMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => apply(pos, 'granted'),
      (err) => {
        setErrorMessage(err.message);
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 }
    );
  }, [apply]);

  const setManual = useCallback(
    (loc: GeoLocation) => {
      setLocation(loc);
      persist(loc);
      setStatus('manual');
      setErrorMessage(null);
    },
    [persist]
  );

  const clear = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setWatching(false);
    }
    setLocation(null);
    persist(null);
    setStatus('idle');
    setErrorMessage(null);
  }, [persist]);

  /** Continuous tracking, for actually walking around looking up. */
  const toggleWatch = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setWatching(false);
      return;
    }
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => apply(pos, 'granted'),
      (err) => {
        setErrorMessage(err.message);
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
    setWatching(true);
  }, [apply]);

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    []
  );

  return { status, location, errorMessage, watching, request, setManual, clear, toggleWatch };
}
