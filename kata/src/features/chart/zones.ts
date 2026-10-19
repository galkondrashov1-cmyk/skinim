import type {
  AutoscaleInfo,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { Candle } from '@/market/types';

export type ZoneTone = 'up' | 'down' | 'fg';

export interface Zone {
  /** ms timestamps; null = pane edge. */
  t1: number | null;
  t2: number | null;
  p1: number;
  p2: number;
  tone: ZoneTone;
  /** Bounded zones (inspected trades) get edges and a stronger wash. */
  bounded?: boolean;
}

export interface Segment {
  t1: number;
  p1: number;
  t2: number;
  p2: number;
  tone: ZoneTone;
  dash?: number[];
}

export type ZonePalette = Record<ZoneTone, string>;

function alpha(hex: string, a: number): string {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export interface ZoneScene {
  zones: Zone[];
  segments: Segment[];
  /** Prices that autoscale should keep in view (entries, stops, targets, orders). */
  levels: number[];
}

/**
 * Draws risk/reward zones and trade connectors under the candles, and widens
 * autoscale so protective levels are never silently off-screen.
 */
export class ZonesPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private request: (() => void) | null = null;
  private scene: ZoneScene = { zones: [], segments: [], levels: [] };
  private candles: Candle[] = [];
  private intervalMs = 60_000;
  private palette: ZonePalette = { up: '#3cc68a', down: '#ef5b57', fg: '#b3aea4' };
  private readonly views: IPrimitivePaneView[];

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: () => {},
      drawBackground: (target) => {
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => this.paint(ctx, mediaSize.width));
      },
    };
    this.views = [{ zOrder: () => 'bottom', renderer: () => renderer }];
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.request = p.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.request = null;
  }

  paneViews() {
    return this.views;
  }

  setData(candles: Candle[], intervalMs: number) {
    this.candles = candles;
    this.intervalMs = intervalMs;
    this.request?.();
  }

  setPalette(p: ZonePalette) {
    this.palette = p;
    this.request?.();
  }

  setScene(scene: ZoneScene) {
    this.scene = scene;
    this.request?.();
  }

  autoscaleInfo(): AutoscaleInfo | null {
    const lv = this.scene.levels.filter((x) => Number.isFinite(x));
    if (!lv.length || !this.series) return null;
    return { priceRange: { minValue: Math.min(...lv), maxValue: Math.max(...lv) } };
  }

  /** Fractional logical index for an arbitrary timestamp. */
  logicalAt(t: number): number {
    const cs = this.candles;
    if (!cs.length) return 0;
    let lo = 0;
    let hi = cs.length - 1;
    if (t < cs[0].time) return (t - cs[0].time) / this.intervalMs;
    if (t >= cs[hi].time) return hi + (t - cs[hi].time) / this.intervalMs;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cs[mid].time <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo + Math.min(1, (t - cs[lo].time) / this.intervalMs);
  }

  x(t: number | null, width: number, edge: 'left' | 'right'): number {
    if (t == null || !this.chart) return edge === 'left' ? 0 : width;
    // logicalToCoordinate only resolves whole bar indices, so interpolate between neighbours.
    const ts = this.chart.timeScale();
    const l = this.logicalAt(t);
    const i = Math.floor(l);
    const a = ts.logicalToCoordinate(i as Logical);
    const b = ts.logicalToCoordinate((i + 1) as Logical);
    if (a == null || b == null) return edge === 'left' ? 0 : width;
    return a + (l - i) * (b - a);
  }

  private paint(ctx: CanvasRenderingContext2D, width: number) {
    const s = this.series;
    if (!s) return;
    for (const z of this.scene.zones) {
      const y1 = s.priceToCoordinate(z.p1);
      const y2 = s.priceToCoordinate(z.p2);
      if (y1 == null || y2 == null) continue;
      const x1 = Math.max(0, this.x(z.t1, width, 'left'));
      const x2 = Math.min(width, this.x(z.t2, width, 'right'));
      if (x2 <= x1) continue;
      const c = this.palette[z.tone];
      ctx.fillStyle = alpha(c, z.bounded ? 0.13 : 0.075);
      ctx.fillRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));
      if (z.bounded) {
        ctx.fillStyle = alpha(c, 0.55);
        ctx.fillRect(x1, Math.min(y1, y2), 1, Math.abs(y2 - y1));
        ctx.fillRect(x2 - 1, Math.min(y1, y2), 1, Math.abs(y2 - y1));
      }
    }
    for (const seg of this.scene.segments) {
      const y1 = s.priceToCoordinate(seg.p1);
      const y2 = s.priceToCoordinate(seg.p2);
      if (y1 == null || y2 == null) continue;
      ctx.save();
      ctx.strokeStyle = this.palette[seg.tone];
      ctx.lineWidth = 1;
      ctx.setLineDash(seg.dash ?? []);
      ctx.beginPath();
      ctx.moveTo(this.x(seg.t1, width, 'left'), y1);
      ctx.lineTo(this.x(seg.t2, width, 'right'), y2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
