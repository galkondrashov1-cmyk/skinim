import geometry from './geometry.json';
import { WORDMARK } from './wordmark-paths';
import './brand.css';

const pts = (a: number[][]) => a.map(([x, y]) => `${x},${y}`).join(' ');
const g = geometry;

/** The Kata mark: a candlestick stem carrying a bracket order — target above, stop below. */
export function Mark({ size = 20, className = '', title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={`k-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <line className="k-mark-wick" x1={g.wick.x} y1={g.wick.y1} x2={g.wick.x} y2={g.wick.y2} />
      <rect className="k-mark-body" x={g.body.x} y={g.body.y} width={g.body.w} height={g.body.h} />
      <polyline className="k-mark-tp" points={pts(g.target)} />
      <polyline className="k-mark-sl" points={pts(g.stop)} />
    </svg>
  );
}

export function Wordmark({ height = 11, className = '' }: { height?: number; className?: string }) {
  const b = WORDMARK.box;
  const w = ((b.x2 - b.x1) / (b.y2 - b.y1)) * height;
  return (
    <svg className={`k-word ${className}`} width={w} height={height} viewBox={`${b.x1} ${b.y1} ${b.x2 - b.x1} ${b.y2 - b.y1}`} role="img" aria-label="Kata">
      <path d={WORDMARK.d} />
    </svg>
  );
}

export function Lockup({ size = 20 }: { size?: number }) {
  return (
    <span className="k-lockup">
      <Mark size={size} />
      <Wordmark height={Math.round(size * 0.5)} />
    </span>
  );
}

/**
 * Branded loading indicator: the mark's bracket order drawing itself, on repeat.
 * Used wherever the app is genuinely waiting (chart data, reconciliation).
 */
export function Loader({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <span className="k-loader" role="status" aria-live="polite">
      <Mark size={size} className="k-mark--loading" />
      {label && <span className="k-loader-label label">{label}</span>}
    </span>
  );
}
