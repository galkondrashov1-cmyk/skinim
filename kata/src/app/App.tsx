import { useEffect, useRef } from 'react';
import { useApp } from '@/store/app';
import { boot } from '@/store/runtime';
import { useUI } from '@/store/ui';
import { Shell } from './Shell';
import { Welcome } from './Welcome';
import { Blocked, BootError } from './Gates';

const STEPS = ['Loading', 'Claiming this window', 'Opening your books', 'Connecting to market data', 'Reconciling time away'];

/** Drive the inline launch screen from boot progress, then retire it. */
function useSplash() {
  const phase = useApp((s) => s.phase);
  const step = useApp((s) => s.bootStep);
  const shownAt = useRef(performance.now());
  useEffect(() => {
    const el = document.getElementById('splash-step');
    const bar = document.getElementById('splash-bar');
    if (el) el.textContent = step;
    const i = Math.max(1, STEPS.indexOf(step));
    bar?.style.setProperty('--p', String(Math.min(0.92, (i + 1) / (STEPS.length + 1))));
  }, [step]);
  useEffect(() => {
    if (phase === 'booting') return;
    const splash = document.getElementById('splash');
    if (!splash) return;
    document.getElementById('splash-bar')?.style.setProperty('--p', '1');
    // Let the mark finish drawing on fast boots; never hold a slow one.
    const wait = Math.max(0, 1100 - (performance.now() - shownAt.current));
    const t = setTimeout(() => {
      splash.classList.add('out');
      setTimeout(() => splash.remove(), 400);
    }, wait);
    return () => clearTimeout(t);
  }, [phase]);
}

function useTheme() {
  const theme = useUI((s) => s.theme);
  const palette = useUI((s) => s.palette);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = t;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#EFECE5' : '#0C0E11');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    if (palette === 'colorblind') document.documentElement.dataset.palette = 'colorblind';
    else delete document.documentElement.dataset.palette;
  }, [palette]);
}

export function App() {
  const phase = useApp((s) => s.phase);
  useSplash();
  useTheme();
  useEffect(() => {
    void boot();
  }, []);

  switch (phase) {
    case 'booting':
      return null;
    case 'blocked':
      return <Blocked />;
    case 'error':
      return <BootError />;
    case 'welcome':
      return <Welcome />;
    default:
      return <Shell />;
  }
}
