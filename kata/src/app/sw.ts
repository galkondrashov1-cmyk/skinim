import { useEffect } from 'react';
import { pushToast } from '@/store/app';

let started = false;
let updater: ((reload?: boolean) => Promise<void>) | null = null;

export function applyUpdate() {
  void updater?.(true);
}

/** Register the service worker (production builds only) and surface updates. */
export function useServiceWorker() {
  useEffect(() => {
    if (started || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    started = true;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      updater = registerSW({
        immediate: true,
        onNeedRefresh() {
          pushToast({ level: 'info', title: 'Kata update ready', body: 'Open Settings → About to reload into the new version.' });
          window.dispatchEvent(new CustomEvent('kata:update'));
        },
        onOfflineReady() {
          pushToast({ level: 'success', title: 'Ready offline', body: 'Kata now opens without a connection. Live prices still need one.' });
        },
        onRegisteredSW(_url, reg) {
          if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
        },
      });
    });
  }, []);
}
