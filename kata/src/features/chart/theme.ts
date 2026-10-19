import { useEffect, useState } from 'react';

export interface ChartTheme {
  bg: string;
  panel: string;
  grid: string;
  line: string;
  line2: string;
  fg0: string;
  fg1: string;
  fg2: string;
  fg3: string;
  up: string;
  down: string;
  order: string;
  liq: string;
  warn: string;
  sim: string;
  ink: string;
  dark: boolean;
  /** Indicator hues, kept clear of the semantic up/down/order colours. */
  ind: [string, string, string, string];
}

function read(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const dark = document.documentElement.dataset.theme !== 'light';
  return {
    bg: v('--ink-0'),
    panel: v('--ink-1'),
    grid: dark ? 'rgba(236, 231, 220, 0.045)' : 'rgba(21, 23, 27, 0.06)',
    line: v('--line'),
    line2: v('--line-2'),
    fg0: v('--fg-0'),
    fg1: v('--fg-1'),
    fg2: v('--fg-2'),
    fg3: v('--fg-3'),
    up: v('--up'),
    down: v('--down'),
    order: v('--order'),
    liq: v('--liq'),
    warn: v('--warn'),
    sim: v('--sim'),
    ink: v('--ink-0'),
    dark,
    // Validated all-pairs (OKLab CVD ΔE ≥ 6.5, normal ≥ 15) against each surface.
    ind: dark ? ['#c48225', '#139cb6', '#8264c8', '#c25485'] : ['#a57710', '#237fa4', '#5d4099', '#b24866'],
  };
}

/** Resolved design tokens for canvas drawing; follows theme and palette switches. */
export function useChartTheme(): ChartTheme {
  const [t, setT] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setT(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
    return () => mo.disconnect();
  }, []);
  return t;
}

export function rgba(hex: string, a: number): string {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
