import { useEffect, useRef, useState } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { formatDuration } from '../lib/format';
import { isNative } from '../lib/platform';
import { startRecording, type RecorderHandle } from '../lib/recorder';
import { getMeeting, saveMeeting } from '../lib/store';
import type { Meeting } from '../types';
import { Mic, Stop } from '../ui/icons';
import { Sheet } from '../ui/primitives';

interface Props {
  meetingId: string;
  onStopped: (meeting: Meeting) => void;
  onCancelled: () => void;
}

export function Record({ meetingId, onStopped, onCancelled }: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'stop' | 'discard' | null>(null);
  const [stopping, setStopping] = useState(false);
  const handle = useRef<RecorderHandle | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await getMeeting(meetingId);
      if (!m || cancelled) return;
      setMeeting(m);
      try {
        handle.current = await startRecording(meetingId);
        try {
          await KeepAwake.keepAwake();
        } catch {
          /* optional */
        }
        Haptics.impact({ style: ImpactStyle.Medium }).catch(() => undefined);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /PERMISSION|NotAllowed|denied/i.test(msg)
            ? 'אין הרשאה למיקרופון. אפשר הרשאת מיקרופון לאפליקציה בהגדרות הטלפון ונסה שוב.'
            : `ההקלטה לא התחילה: ${msg}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    const t = setInterval(() => {
      const h = handle.current;
      if (!h) return;
      setElapsed(Date.now() - h.startedAt);
      if (!isNative) setLevel(h.level());
    }, 200);
    return () => clearInterval(t);
  }, []);

  const finish = async () => {
    if (!handle.current || !meeting) return;
    setStopping(true);
    setConfirm(null);
    try {
      const res = await handle.current.stop();
      handle.current = null;
      try {
        await KeepAwake.allowSleep();
      } catch {
        /* optional */
      }
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => undefined);
      const m = (await getMeeting(meetingId)) || meeting;
      m.audioPath = res.path;
      m.audioMime = res.mime;
      m.durationMs = res.durationMs;
      m.notes = notesRef.current?.value || '';
      m.status = 'recorded';
      await saveMeeting(m);
      onStopped(m);
    } catch (e) {
      setStopping(false);
      setError(`שמירת ההקלטה נכשלה: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const discard = async () => {
    setConfirm(null);
    try {
      if (handle.current) await handle.current.stop().catch(() => undefined);
      handle.current = null;
      await KeepAwake.allowSleep().catch(() => undefined);
    } finally {
      onCancelled();
    }
  };

  const scale = 1 + level * 0.35;

  return (
    <div className="screen">
      <header className="topbar">
        <h1>
          {meeting?.title || 'הקלטה'}
          {meeting?.client && <span className="sub">{meeting.client}</span>}
        </h1>
      </header>

      <div className="rec-screen">
        {error ? (
          <>
            <div className="banner err" style={{ width: '100%', marginTop: 24 }}>
              {error}
            </div>
            <div className="rec-actions">
              <button className="btn block" onClick={onCancelled}>
                חזרה
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rec-timer" aria-live="off">
              {formatDuration(elapsed)}
            </div>
            <div className="rec-status">
              <span className="dot" /> מקליט
            </div>

            <div className="rec-orb" aria-hidden>
              <span className="ring" />
              <span className="ring" />
              <span className="ring" />
              <div className="core" style={{ transform: `scale(${scale})` }}>
                <Mic />
              </div>
            </div>

            <p className="muted small">
              {isNative ? 'אפשר לכבות את המסך, ההקלטה ממשיכה ברקע.' : 'השאר את הכרטיסייה פתוחה בזמן ההקלטה.'}
            </p>

            <label className="field rec-notes">
              <span>הערות תוך כדי (לא חובה)</span>
              <textarea ref={notesRef} className="input" placeholder="נקודות שחשוב לך שייכנסו לסיכום..." rows={3} />
            </label>

            <div className="rec-actions">
              <button className="btn danger block" style={{ minHeight: 60, fontSize: 18 }} disabled={stopping || !handle.current} onClick={() => setConfirm('stop')}>
                {stopping ? <span className="spinner" /> : <Stop />}
                {stopping ? 'שומר...' : 'סיים פגישה'}
              </button>
              <button className="btn ghost block" disabled={stopping} onClick={() => setConfirm('discard')}>
                בטל ומחק הקלטה
              </button>
            </div>
          </>
        )}
      </div>

      <Sheet open={confirm === 'stop'} onClose={() => setConfirm(null)} title="לסיים את הפגישה?">
        <p className="muted">ההקלטה תישמר ותעבור לתמלול ולסיכום. זה לוקח בדרך כלל כמה דקות.</p>
        <div className="row mt">
          <button className="btn grow" onClick={() => setConfirm(null)}>
            המשך להקליט
          </button>
          <button className="btn primary grow" onClick={finish}>
            סיים ועבד
          </button>
        </div>
      </Sheet>

      <Sheet open={confirm === 'discard'} onClose={() => setConfirm(null)} title="למחוק את ההקלטה?">
        <p className="muted">ההקלטה תימחק לצמיתות ולא ניתן יהיה לשחזר אותה.</p>
        <div className="row mt">
          <button className="btn grow" onClick={() => setConfirm(null)}>
            חזרה
          </button>
          <button className="btn danger grow" onClick={discard}>
            מחק
          </button>
        </div>
      </Sheet>
    </div>
  );
}
