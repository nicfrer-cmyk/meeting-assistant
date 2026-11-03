import { useEffect, type ReactNode } from 'react';
import type { MeetingStatus } from '../types';

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function StatusChip({ status, error }: { status: MeetingStatus; error?: string }) {
  const map: Record<MeetingStatus, { label: string; cls: string }> = {
    recording: { label: 'מקליט', cls: 'err' },
    recorded: { label: 'ממתין לעיבוד', cls: 'warn' },
    transcribing: { label: 'מתמלל', cls: 'busy' },
    summarizing: { label: 'מסכם', cls: 'busy' },
    generating: { label: 'יוצר Word', cls: 'busy' },
    ready: { label: 'מוכן', cls: 'ok' },
    error: { label: 'שגיאה', cls: 'err' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`chip ${cls}`} title={error}>
      {(cls === 'busy' || status === 'recording') && <span className="dot" />}
      {label}
    </span>
  );
}

export function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className="switch">
      <div>
        <div className="label">{label}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}
