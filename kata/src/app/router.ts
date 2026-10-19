import { useSyncExternalStore } from 'react';

export type View = 'trade' | 'journal' | 'performance' | 'settings';

export interface Route {
  view: View;
  param: string | null;
  query: URLSearchParams;
}

const VIEWS: View[] = ['trade', 'journal', 'performance', 'settings'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [view, param] = path.split('/');
  return {
    view: VIEWS.includes(view as View) ? (view as View) : 'trade',
    param: param ? decodeURIComponent(param) : null,
    query: new URLSearchParams(qs),
  };
}

let current = parseHash(typeof location !== 'undefined' ? location.hash : '');
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  addEventListener('hashchange', () => {
    current = parseHash(location.hash);
    for (const l of listeners) l();
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const hash = to.startsWith('#') ? to : `#${to.startsWith('/') ? to : `/${to}`}`;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    current = parseHash(hash);
    for (const l of listeners) l();
  } else location.hash = hash;
}

export const inspectHref = (positionId: string) => `#/trade?inspect=${encodeURIComponent(positionId)}`;
