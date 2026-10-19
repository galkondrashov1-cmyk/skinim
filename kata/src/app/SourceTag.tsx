import type { PriceSource } from '@/engine/types';
import { cx } from '@/ui/primitives';
import './source-tag.css';

export type TagKind = PriceSource | 'offline' | 'connecting';

const TEXT: Record<TagKind, string> = {
  live: 'Live',
  delayed: 'Delayed',
  simulated: 'Simulated',
  replay: 'Replayed',
  offline: 'No data',
  connecting: 'Connecting',
};

const TITLE: Record<TagKind, string> = {
  live: 'Real-time exchange data',
  delayed: 'Real exchange data, arriving late or by polling',
  simulated: 'Synthetic price — not market data',
  replay: 'Reconstructed from real historical candles while Kata was closed',
  offline: 'No market data — execution paused',
  connecting: 'Connecting to market data',
};

/** The honesty label. Every price surface in Kata carries one. */
export function SourceTag({ source, detail, compact }: { source: TagKind; detail?: string; compact?: boolean }) {
  return (
    <span className={cx('k-src', `k-src--${source}`, compact && 'k-src--compact')} title={detail ? `${TITLE[source]} · ${detail}` : TITLE[source]}>
      <span className="k-src-dot" aria-hidden="true" />
      {!compact && <span className="k-src-text">{TEXT[source]}</span>}
      {compact && <span className="sr-only">{TEXT[source]}</span>}
      {detail && !compact && <span className="k-src-detail num">{detail}</span>}
    </span>
  );
}
