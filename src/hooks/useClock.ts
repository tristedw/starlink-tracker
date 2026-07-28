/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useEffect, useState } from 'react';
import type { ClockState } from '../lib/clock';
import { useEngine } from './useEngine';

/**
 * Clock state for the UI. Polls at 4 Hz, not every frame. The scrubber and the
 * readout only need to look live, and re-rendering the control bar 60 times a
 * second for a ticking timestamp is a waste.
 */
export function useClockState(pollMs = 250): ClockState {
  const engine = useEngine();
  const [state, setState] = useState<ClockState>(() => engine.clock.state);

  useEffect(() => {
    const unsub = engine.clock.subscribe(setState);
    const timer = setInterval(() => setState(engine.clock.state), pollMs);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [engine, pollMs]);

  return state;
}
