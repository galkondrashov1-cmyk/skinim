/** Numeric helpers. Money is kept as IEEE doubles rounded to 1e-8 after every operation. */

const MONEY_SCALE = 1e8;

export function money(x: number): number {
  if (!Number.isFinite(x)) return x;
  const r = Math.round(x * MONEY_SCALE) / MONEY_SCALE;
  return r === 0 ? 0 : r; // normalise −0
}

/** Number of decimals implied by a step such as 0.001 or 1e-5. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 8;
  const s = step.toString();
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function fix(x: number, step: number): number {
  return Number(x.toFixed(Math.min(12, stepDecimals(step))));
}

/** Round to the nearest multiple of step. */
export function roundToStep(x: number, step: number): number {
  if (!step) return x;
  return fix(Math.round(x / step + 1e-9) * step, step);
}

/** Round down to a multiple of step (used for quantities: never size up). */
export function floorToStep(x: number, step: number): number {
  if (!step) return x;
  return fix(Math.floor(x / step + 1e-9) * step, step);
}

export function ceilToStep(x: number, step: number): number {
  if (!step) return x;
  return fix(Math.ceil(x / step - 1e-9) * step, step);
}

export function isMultipleOf(x: number, step: number): boolean {
  if (!step) return true;
  const q = x / step;
  return Math.abs(q - Math.round(q)) < 1e-6;
}

export function approxEq(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function nextUtcMidnight(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

let counter = 0;
/** Short, sortable, collision-resistant id. */
export function uid(): string {
  counter = (counter + 1) % 1679616;
  const rand = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return Date.now().toString(36) + counter.toString(36).padStart(4, '0') + rand;
}
