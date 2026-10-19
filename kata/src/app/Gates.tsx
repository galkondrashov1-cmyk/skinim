import { Mark } from '@/brand/Brand';
import { useApp } from '@/store/app';
import { takeOver } from '@/store/runtime';
import { Button } from '@/ui/primitives';
import './welcome.css';

/** Shown when Kata is already running in another tab: one engine, one tape. */
export function Blocked() {
  return (
    <div className="gate">
      <div className="gate-card">
        <Mark size={36} />
        <h1>Kata is open in another window</h1>
        <p>
          Only one window runs the trading engine at a time, so orders are never executed twice. Switch to the other window,
          or continue here.
        </p>
        <Button variant="primary" onClick={takeOver}>
          Use Kata here
        </Button>
      </div>
    </div>
  );
}

export function BootError() {
  const error = useApp((s) => s.error);
  return (
    <div className="gate">
      <div className="gate-card">
        <Mark size={36} />
        <h1>Kata couldn’t start</h1>
        <p>Your browser refused local storage, which Kata needs to keep your accounts. Private windows and some storage settings can cause this.</p>
        {error && <code>{error}</code>}
        <Button variant="primary" onClick={() => location.reload()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
