import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi } from 'lightweight-charts';
import { roundToStep } from '@/engine/num';
import { Icon } from '@/ui/icons';
import { cx } from '@/ui/primitives';
import type { ChartLine, LineTone } from './lines';

export type ToneColors = Record<LineTone, string> & { ink: string };

const STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.SparseDotted } as const;

/**
 * Interactive price levels over the chart. Lines and axis tags are drawn by the
 * chart (canvas); labels and drag handles are HTML so they stay accessible:
 * drag with a pointer, or focus a label and use ↑/↓ (Shift = ×10), Enter to commit.
 */
export function LineOverlay({
  lines,
  chart,
  series,
  tick,
  colors,
  onDrag,
}: {
  /** Changes with every quote so live P&L labels re-render. */
  pulse?: number;
  lines: ChartLine[];
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  tick: number;
  colors: ToneColors;
  onDrag: (d: { id: string; price: number } | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const priceLines = useRef(new Map<string, IPriceLine>());
  const drag = useRef<{ id: string; price: number; startY: number; moved: boolean; pointer: number | null } | null>(null);
  const [active, setActive] = useState<{ id: string; price: number } | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // Canvas price lines with axis tags.
  useEffect(() => {
    const made = new Map<string, IPriceLine>();
    for (const l of lines) {
      const c = colors[l.tone];
      made.set(
        l.id,
        series.createPriceLine({
          price: l.price,
          color: c,
          lineWidth: l.emphasis ? 2 : 1,
          lineStyle: STYLE[l.style],
          axisLabelVisible: true,
          title: l.axis,
          axisLabelColor: c,
          axisLabelTextColor: colors.ink,
        }),
      );
    }
    priceLines.current = made;
    return () => {
      try {
        for (const pl of made.values()) series.removePriceLine(pl);
      } catch {
        /* chart already disposed */
      }
    };
  }, [lines, series, colors]);

  // Keep HTML labels glued to their lines.
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      try {
        const paneH = chart.panes()[0]?.getHeight() ?? host.current?.clientHeight ?? 0;
        const visible: { el: HTMLDivElement; y: number }[] = [];
        for (const l of linesRef.current) {
          const el = rows.current.get(l.id);
          if (!el) continue;
          const price = drag.current?.id === l.id ? drag.current.price : l.price;
          const y = series.priceToCoordinate(price);
          if (y == null || y < -6 || y > paneH + 6) {
            el.style.visibility = 'hidden';
          } else {
            el.style.visibility = 'visible';
            el.style.transform = `translate3d(0, ${Math.round(y)}px, 0)`;
            visible.push({ el, y });
          }
        }
        // Labels on nearby levels slide sideways instead of stacking on top of each other.
        visible.sort((a, b) => a.y - b.y);
        const placed: { y: number; right: number }[] = [];
        for (const v of visible) {
          const pill = v.el.querySelector<HTMLElement>('.lo-pill');
          if (!pill) continue;
          let left = 8;
          for (const q of placed) if (Math.abs(q.y - v.y) < 22) left = Math.max(left, q.right + 6);
          pill.style.left = `${left}px`;
          placed.push({ y: v.y, right: left + pill.offsetWidth });
        }
        if (host.current) host.current.style.setProperty('--axis-w', `${chart.priceScale('right').width()}px`);
      } catch {
        return; // chart disposed
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [chart, series]);

  const preview = (l: ChartLine, price: number) => {
    const p = roundToStep(price, tick);
    if (!drag.current) drag.current = { id: l.id, price: p, startY: 0, moved: true, pointer: null };
    drag.current.price = p;
    priceLines.current.get(l.id)?.applyOptions({ price: p });
    setActive({ id: l.id, price: p });
    onDrag({ id: l.id, price: p });
    l.onPreview?.(p);
  };

  const finish = (l: ChartLine, commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    setActive(null);
    onDrag(null);
    if (!d) return;
    if (commit && d.moved && d.price !== l.price) l.onCommit?.(d.price);
    else priceLines.current.get(l.id)?.applyOptions({ price: l.price });
  };

  const onPointerDown = (l: ChartLine) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!l.draggable || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button[data-act]')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: l.id, price: l.price, startY: e.clientY, moved: false, pointer: e.pointerId };
  };
  const onPointerMove = (l: ChartLine) => (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== l.id || d.pointer !== e.pointerId || !host.current) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < 3) return;
    d.moved = true;
    const y = e.clientY - host.current.getBoundingClientRect().top;
    const price = series.coordinateToPrice(y);
    if (price != null && price > 0) preview(l, price);
  };
  const onPointerUp = (l: ChartLine) => (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointer !== e.pointerId) return;
    finish(l, true);
  };
  const onKey = (l: ChartLine) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!l.draggable) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = drag.current?.id === l.id ? drag.current.price : l.price;
      preview(l, cur + (e.key === 'ArrowUp' ? 1 : -1) * tick * (e.shiftKey ? 10 : 1));
    } else if (e.key === 'Enter' && drag.current?.id === l.id) {
      e.preventDefault();
      finish(l, true);
    } else if (e.key === 'Escape' && drag.current?.id === l.id) {
      e.preventDefault();
      finish(l, false);
    }
  };

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.current) return;
      const l = linesRef.current.find((x) => x.id === drag.current!.id);
      if (l) finish(l, false);
    };
    addEventListener('keydown', onEsc);
    return () => removeEventListener('keydown', onEsc);
  });

  return (
    <div ref={host} className="lo" aria-label="Price levels">
      {lines.map((l) => {
        const live = active?.id === l.id ? active.price : l.price;
        const det = l.detail?.(live);
        return (
          <div
            key={l.id}
            ref={(el) => {
              if (el) rows.current.set(l.id, el);
              else rows.current.delete(l.id);
            }}
            className={cx('lo-row', `lo-row--${l.tone}`, l.draggable && 'is-draggable', active?.id === l.id && 'is-dragging')}
            data-testid={l.testId}
          >
            {l.draggable && (
              <div
                className="lo-hit"
                onPointerDown={onPointerDown(l)}
                onPointerMove={onPointerMove(l)}
                onPointerUp={onPointerUp(l)}
                onPointerCancel={() => finish(l, false)}
              />
            )}
            <div
              className="lo-pill"
              tabIndex={l.draggable ? 0 : -1}
              role={l.draggable ? 'slider' : undefined}
              aria-label={l.draggable ? `${l.label}: drag or use arrow keys to move` : l.label}
              aria-valuenow={l.draggable ? live : undefined}
              onPointerDown={onPointerDown(l)}
              onPointerMove={onPointerMove(l)}
              onPointerUp={onPointerUp(l)}
              onPointerCancel={() => finish(l, false)}
              onKeyDown={onKey(l)}
              onBlur={() => drag.current?.id === l.id && drag.current.pointer == null && finish(l, false)}
            >
              {l.draggable && <span className="lo-grip" aria-hidden="true" />}
              <span className="lo-label">{l.label}</span>
              {det && <span className={cx('lo-detail num', det.tone)}>{det.text}</span>}
              {l.actions?.map((a) => (
                <button key={a.label} data-act type="button" className="lo-act" onClick={a.run} data-testid={a.testId}>
                  {a.label}
                </button>
              ))}
              {l.remove && (
                <button data-act type="button" className="lo-x" aria-label={l.remove.label} title={l.remove.label} onClick={l.remove.run}>
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
