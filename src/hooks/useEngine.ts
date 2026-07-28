/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { TrackerEngine, EngineSnapshot } from '../lib/store/engine';

export const EngineContext = createContext<TrackerEngine | null>(null);

export function useEngine(): TrackerEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine must be used inside <EngineContext.Provider>');
  return engine;
}

/**
 * Subscribe to the engine's cold state.
 *
 * `useSyncExternalStore` rather than context state, so the engine publishes at
 * its own few-hertz cadence regardless of React's render cycle, and so there's
 * an obvious place for per-frame data not to go.
 */
export function useEngineSnapshot(): EngineSnapshot {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}
