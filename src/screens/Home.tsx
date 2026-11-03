import { useEffect, useMemo, useState } from 'react';
import { formatDayLabel, formatDuration, formatTime } from '../lib/format';
import { onProgress } from '../lib/pipeline';
import { listMeetings } from '../lib/store';
import type { MeetingIndexEntry, Settings } from '../types';
import { Mic, Search, Settings as SettingsIcon, Alert } from '../ui/icons';
import { Field, Sheet, StatusChip } from '../ui/primitives';

interface Props {
  settings: Settings;
  onOpen: (id: string) => void;
  onSettings: () => void;
  onStart: (draft: { title: string; client: string; participants: string }) => void;
  refreshKey: number;
}

export function Home({ settings, onOpen, onSettings, onStart, refreshKey }: Props) {
  const [items, setItems] = useState<MeetingIndexEntry[] | null>(null);
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', client: '', participants: '' });

  const reload = () => listMeetings().then(setItems);
  useEffect(() => {
    reload();
  }, [refreshKey]);
  useEffect(() => onProgress(() => reload()), []);

  const missingKeys = !settings.elevenLabsKey || !settings.anthropicKey;

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((m) => `${m.title} ${m.client ?? ''}`.toLowerCase().includes(s));
  }, [items, q]);

  const groups = useMemo(() => {
    const map = new Map<string, MeetingIndexEntry[]>();
    for (const m of filtered) {
      const k = formatDayLabel(m.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return [...map.entries()];
  }, [filtered]);

  const totalMinutes = items ? Math.round(items.reduce((a, m) => a + m.durationMs, 0) / 60000) : 0;
  const openTasks = items ? items.reduce((a, m) => a + (m.taskCount ?? 0), 0) : 0;

  return (
    <div className="screen">
      <header className="topbar">
        <h1>
          הפגישות שלי
          <span className="sub">{settings.lawyerName || 'סיכומי פגישות אוטומטיים'}</span>
        </h1>
        <button className="icon-btn" aria-label="הגדרות" onClick={onSettings}>
          <SettingsIcon />
        </button>
      </header>

      <div className="scroll with-fab">
        {missingKeys && (
          <button className="banner warn" style={{ width: '100%', textAlign: 'start' }} onClick={onSettings}>
            <Alert style={{ width: 20, height: 20, flexShrink: 0 }} />
            <span>
              <b>חסרים מפתחות API.</b> כדי לתמלל ולסכם צריך להזין מפתח ElevenLabs ומפתח Anthropic בהגדרות.
            </span>
          </button>
        )}

        {items && items.length > 0 && (
          <>
            <div className="hero-stat">
              <div className="card">
                <div className="n">{items.length}</div>
                <div className="l">פגישות</div>
              </div>
              <div className="card">
                <div className="n">{totalMinutes}</div>
                <div className="l">דקות הוקלטו</div>
              </div>
              <div className="card">
                <div className="n">{openTasks}</div>
                <div className="l">משימות</div>
              </div>
            </div>
            <div className="search">
              <Search />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם פגישה או לקוח" aria-label="חיפוש" />
            </div>
          </>
        )}

        {items && items.length === 0 && (
          <div className="empty">
            <div className="big">🎙️</div>
            <h2>עדיין אין פגישות</h2>
            <p>לחץ על "הקלטת פגישה", הנח את הטלפון על השולחן, ובסיום תקבל סיכום, משימות ומסמך Word.</p>
          </div>
        )}

        {items && items.length > 0 && filtered.length === 0 && (
          <div className="empty">
            <p>לא נמצאו פגישות שמתאימות לחיפוש.</p>
          </div>
        )}

        {groups.map(([label, list]) => (
          <section key={label}>
            <div className="section-title">{label}</div>
            {list.map((m) => (
              <button key={m.id} className="meeting-item" onClick={() => onOpen(m.id)}>
                <div className="avatar" aria-hidden>
                  {(m.client || m.title || '?').trim().charAt(0)}
                </div>
                <div className="body">
                  <div className="title">{m.title}</div>
                  <div className="meta">
                    {m.client && <span>{m.client} ·</span>}
                    <span>{formatTime(m.createdAt)}</span>
                    <span>·</span>
                    <span dir="ltr">{formatDuration(m.durationMs)}</span>
                    {m.status === 'ready' && m.taskCount ? <span>· {m.taskCount} משימות</span> : null}
                  </div>
                </div>
                <StatusChip status={m.status} />
              </button>
            ))}
          </section>
        ))}
      </div>

      <div className="fab-wrap">
        <button className="fab" onClick={() => setNewOpen(true)}>
          <Mic />
          הקלטת פגישה
        </button>
      </div>

      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="פגישה חדשה">
        <Field label="נושא הפגישה" hint="אפשר להשאיר ריק. Claude ייתן כותרת לפי התוכן.">
          <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder='למשל: פגישת היכרות, דיון בהסדר חוב' />
        </Field>
        <Field label="לקוח / תיק">
          <input className="input" value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })} placeholder="שם הלקוח או מספר התיק" />
        </Field>
        <Field label="משתתפים" hint="עוזר ל-Claude לשייך משימות לאנשים הנכונים.">
          <input className="input" value={draft.participants} onChange={(e) => setDraft({ ...draft, participants: e.target.value })} placeholder="למשל: ירין, דני כהן, רו״ח לוי" />
        </Field>
        <button
          className="btn danger block"
          style={{ minHeight: 56, fontSize: 17 }}
          onClick={() => {
            setNewOpen(false);
            onStart(draft);
            setDraft({ title: '', client: '', participants: '' });
          }}
        >
          <Mic /> התחל הקלטה
        </button>
        <p className="muted small center mt">שים לב: מומלץ ליידע את המשתתפים שהפגישה מוקלטת.</p>
      </Sheet>
    </div>
  );
}
