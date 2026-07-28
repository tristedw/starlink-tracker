/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type { IlluminationState } from '../../types';

const LABEL: Record<IlluminationState, { text: string; hint: string; cls: string }> = {
  sunlit: {
    text: 'In sunlight',
    hint: 'Reflecting sunlight, so potentially visible if your sky is dark.',
    cls: 'illum-sunlit',
  },
  penumbra: {
    text: 'In penumbra',
    hint: 'Partially shadowed by Earth, so dimmer and fading fast.',
    cls: 'illum-penumbra',
  },
  umbra: {
    text: "In Earth's shadow",
    hint: 'Fully eclipsed, invisible to the naked eye however dark your sky is.',
    cls: 'illum-umbra',
  },
};

/**
 * Lit or not is the one fact that decides whether you can see the thing, so it
 * gets its own badge instead of a row in a table.
 */
export default function IlluminationBadge({ state }: { state: IlluminationState }) {
  const info = LABEL[state];
  return (
    <div className={`illum-badge ${info.cls}`} title={info.hint}>
      <span className="illum-dot" aria-hidden />
      <div>
        <div className="illum-title">{info.text}</div>
        <div className="muted small">{info.hint}</div>
      </div>
    </div>
  );
}
