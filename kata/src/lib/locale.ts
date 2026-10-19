/** A BCP-47 locale the Intl APIs accept (some environments report e.g. "en-US@posix"). */
export function safeLocale(): string {
  const candidates = [typeof navigator !== 'undefined' ? navigator.language : '', 'en-US'];
  for (const c of candidates) {
    const tag = (c || '').split('@')[0].replace('_', '-');
    try {
      if (tag && Intl.NumberFormat.supportedLocalesOf([tag]).length) return tag;
    } catch {
      /* invalid tag */
    }
  }
  return 'en-US';
}

/** Detach a chart safely: stop auto-sizing first so no resize callback paints a disposed canvas. */
export function disposeChart(chart: { applyOptions: (o: { autoSize: boolean }) => void; remove: () => void }) {
  try {
    chart.applyOptions({ autoSize: false });
  } catch {
    /* already gone */
  }
  chart.remove();
}
