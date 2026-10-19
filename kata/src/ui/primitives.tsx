import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';
import { ceilToStep, floorToStep, roundToStep, stepDecimals } from '@/engine/num';
import { parseNum } from '@/lib/format';
import './ui.css';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

// ───────────────────────────────────────────────────────────── Button ──

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'long' | 'short';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; block?: boolean }
>(function Button({ variant = 'secondary', size = 'md', icon, block, className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx('k-btn', `k-btn--${variant}`, `k-btn--${size}`, block && 'k-btn--block', className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: 'sm' | 'md'; active?: boolean }
>(function IconButton({ icon, label, size = 'md', active, className, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx('k-iconbtn', `k-iconbtn--${size}`, active && 'is-active', className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
});

// ────────────────────────────────────────────────────────── Segmented ──

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; tone?: 'up' | 'down' }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md' | 'lg';
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('k-seg', `k-seg--${size}`, className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={cx('k-seg-item', o.value === value && 'is-on', o.tone && `k-seg-item--${o.tone}`)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Fields ──

export function Field({ label, hint, error, children, htmlFor, aside }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; aside?: ReactNode }) {
  return (
    <div className={cx('k-field', error && 'has-error')}>
      <div className="k-field-head">
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? <div className="k-field-error">{error}</div> : hint ? <div className="k-field-hint">{hint}</div> : null}
    </div>
  );
}

/**
 * Numeric input built for prices and sizes: mono digits, tick-aware stepping
 * (↑/↓, Shift ×10), and +/− nudge buttons. The value stays a string so users
 * can type freely; parent decides how to interpret it.
 */
export function NumberInput({
  value,
  onChange,
  step,
  min = 0,
  suffix,
  prefix,
  placeholder,
  id,
  ariaLabel,
  disabled,
  invalid,
  onCommit,
  nudge = true,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  min?: number;
  suffix?: ReactNode;
  prefix?: ReactNode;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  onCommit?: () => void;
  nudge?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix' | 'step' | 'min'>) {
  const d = stepDecimals(step);
  const bump = (dir: 1 | -1, mult = 1) => {
    const cur = parseNum(value);
    const base = Number.isFinite(cur) ? cur : 0;
    const s = step * mult;
    let next = dir > 0 ? floorToStep(base, s) + s : ceilToStep(base, s) - s;
    if (Math.abs(next - base) < 1e-12) next = base + dir * s;
    next = Math.max(min, roundToStep(next, step));
    onChange(next.toFixed(d));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
    } else if (e.key === 'Enter') onCommit?.();
  };
  return (
    <div className={cx('k-num', disabled && 'is-disabled', invalid && 'is-invalid')}>
      {prefix && <span className="k-num-affix">{prefix}</span>}
      <input
        id={id}
        className="num"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => onCommit?.()}
        onFocus={(e) => e.currentTarget.select()}
        {...rest}
      />
      {suffix && <span className="k-num-affix k-num-affix--end">{suffix}</span>}
      {nudge && !disabled && (
        <span className="k-num-nudge">
          <button type="button" tabIndex={-1} aria-label="Decrease" onClick={() => bump(-1)}>
            <Icon name="minus" size={12} />
          </button>
          <button type="button" tabIndex={-1} aria-label="Increase" onClick={() => bump(1)}>
            <Icon name="plus" size={12} />
          </button>
        </span>
      )}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('k-text', props.className)} />;
}

export function Switch({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx('k-switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="k-switch-knob" />
    </button>
  );
}

// ───────────────────────────────────────────────────────────── Dialog ──

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 420,
  sheet = 'auto',
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** On narrow screens present as a bottom sheet. */
  sheet?: 'auto' | 'never';
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={cx('k-dialog-layer', sheet === 'auto' && 'k-dialog-layer--sheet')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="k-dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? tid} style={{ ['--w' as string]: `${width}px` }}>
        <header className="k-dialog-head">
          <h2 id={tid}>{title}</h2>
          <IconButton icon="close" label="Close" size="sm" onClick={onClose} data-close />
        </header>
        <div className="k-dialog-body">{children}</div>
        {footer && <footer className="k-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────── Menu ──

export function Menu({
  trigger,
  children,
  align = 'start',
  width,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu'; ref: (el: HTMLElement | null) => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const w = width ?? panel.current?.offsetWidth ?? 200;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    const below = innerHeight - r.bottom - 12;
    setPos({ top: r.bottom + 4, left, maxH: Math.max(160, below) });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemcheckbox"]') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[n]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu', ref: (el) => (anchor.current = el) })}
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            className="k-menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxHeight: pos?.maxH }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  checked,
  danger,
  hint,
  disabled,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: IconName;
  checked?: boolean;
  danger?: boolean;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      disabled={disabled}
      className={cx('k-menu-item', danger && 'is-danger')}
      onClick={onSelect}
    >
      <span className="k-menu-check">{checked ? <Icon name="check" size={14} /> : icon ? <Icon name={icon} size={14} /> : null}</span>
      <span className="k-menu-label">{children}</span>
      {hint && <span className="k-menu-hint">{hint}</span>}
    </button>
  );
}

export function MenuSep({ label }: { label?: string }) {
  return label ? <div className="k-menu-sep label">{label}</div> : <div className="k-menu-rule" role="separator" />;
}

// ─────────────────────────────────────────────────────────────── Tabs ──

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('k-tabs', className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={t.value === value} className={cx('k-tab', t.value === value && 'is-on')} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count != null && t.count > 0 && <span className="k-tab-count num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── Misc ──

export function Empty({ icon, title, body, action }: { icon?: IconName; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="k-empty">
      {icon && (
        <span className="k-empty-icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className="k-empty-title">{title}</div>
      {body && <div className="k-empty-body">{body}</div>}
      {action}
    </div>
  );
}

export function Stat({ label, children, tone, sub, title }: { label: ReactNode; children: ReactNode; tone?: string; sub?: ReactNode; title?: string }) {
  return (
    <div className="k-stat" title={title}>
      <span className="label">{label}</span>
      <span className={cx('k-stat-value num', tone)}>{children}</span>
      {sub && <span className="k-stat-sub num">{sub}</span>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="k-kbd">{children}</kbd>;
}

export function Skeleton({ w = '100%', h = 12 }: { w?: number | string; h?: number }) {
  return <span className="k-skel" style={{ width: w, height: h }} />;
}

/** A number that briefly washes green/red when it changes. */
export function Ticking({ value, children, className }: { value: number | undefined; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<'' | 'up' | 'down'>('');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setDir(value > prev.current ? 'up' : 'down');
      setN((x) => x + 1);
    }
    prev.current = value;
  }, [value]);
  return (
    <span key={n} className={cx(className, dir && `flash-${dir}`)}>
      {children}
    </span>
  );
}
