import { useCallback, useEffect, useState } from 'react';
import { Share } from '@capacitor/share';
import { speakerLabel } from '../lib/elevenlabs';
import { clockFromSeconds, formatDate, formatDurationWords, formatTime } from '../lib/format';
import { isNative } from '../lib/platform';
import { docxFileName, getProgress, onProgress, processMeeting, regenerateDocx, removeAudio } from '../lib/pipeline';
import { deleteMeeting, exportToDocuments, getFileUri, getMeeting, saveMeeting } from '../lib/store';
import type { Meeting, ProcessingStage } from '../types';
import { Back, Check, Doc, Download, Edit, More, Refresh, Share as ShareIcon, Trash, Users } from '../ui/icons';
import { Field, Sheet, StatusChip } from '../ui/primitives';

interface Props {
  meetingId: string;
  onBack: () => void;
  toast: (msg: string) => void;
}

type Tab = 'summary' | 'tasks' | 'transcript';

const STAGES: { key: ProcessingStage; label: string }[] = [
  { key: 'transcribe', label: 'תמלול ההקלטה בעברית' },
  { key: 'summarize', label: 'סיכום וחילוץ משימות' },
  { key: 'docx', label: 'יצירת מסמך Word' },
];

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function MeetingView({ meetingId, onBack, toast }: Props) {
  const [m, setM] = useState<Meeting | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [stage, setStage] = useState<ProcessingStage | null>(null);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState(false);
  const [renameSpeaker, setRenameSpeaker] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const mm = await getMeeting(meetingId);
    setM(mm);
    setStage(getProgress(meetingId)?.stage ?? null);
  }, [meetingId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(
    () =>
      onProgress((id, p) => {
        if (id !== meetingId) return;
        setStage(p?.stage ?? null);
        reload();
      }),
    [meetingId, reload],
  );

  const run = async (force?: 'transcribe' | 'summarize') => {
    setMenu(false);
    try {
      await processMeeting(meetingId, { force });
      toast('הסיכום מוכן');
    } catch (e) {
      /* error is persisted on the meeting */
    } finally {
      reload();
    }
  };

  const share = async () => {
    if (!m?.docxPath) return;
    setMenu(false);
    try {
      const uri = await getFileUri(m.docxPath, DOCX_MIME);
      if (isNative) {
        await Share.share({ title: docxFileName(m), files: [uri], dialogTitle: 'שיתוף סיכום הפגישה' });
      } else {
        const a = document.createElement('a');
        a.href = uri;
        a.download = docxFileName(m);
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(uri);
        }, 1000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) toast(`השיתוף נכשל: ${msg}`);
    }
  };

  const saveToDocuments = async () => {
    if (!m?.docxPath) return;
    setMenu(false);
    try {
      await exportToDocuments(m.docxPath, docxFileName(m));
      toast('נשמר בתיקייה Documents/פגישות');
    } catch (e) {
      toast('השמירה לתיקיית המסמכים נכשלה. נסה "שתף" במקום.');
    }
  };

  const toggleTask = async (i: number) => {
    if (!m?.summary) return;
    const next = { ...m, summary: { ...m.summary, tasks: m.summary.tasks.map((t, j) => (j === i ? { ...t, done: !t.done } : t)) } };
    setM(next);
    await saveMeeting(next);
  };

  const saveEdit = async (title: string, client: string, participants: string) => {
    if (!m) return;
    const next = { ...m, title: title.trim() || m.title, client: client.trim() || undefined, participants: participants.trim() || undefined };
    setEdit(false);
    setM(next);
    await saveMeeting(next);
    if (next.docxPath) {
      setBusy(true);
      await regenerateDocx(next).catch(() => undefined);
      setBusy(false);
      reload();
    }
  };

  const saveSpeaker = async (id: string, name: string) => {
    if (!m) return;
    const names = { ...(m.speakerNames || {}) };
    if (name.trim()) names[id] = name.trim();
    else delete names[id];
    const next = { ...m, speakerNames: names };
    setRenameSpeaker(null);
    setM(next);
    await saveMeeting(next);
    if (next.docxPath) {
      setBusy(true);
      await regenerateDocx(next).catch(() => undefined);
      setBusy(false);
      reload();
    }
  };

  const doDelete = async () => {
    await deleteMeeting(meetingId);
    onBack();
  };

  if (!m) {
    return (
      <div className="screen">
        <header className="topbar">
          <button className="icon-btn" aria-label="חזרה" onClick={onBack}>
            <Back />
          </button>
        </header>
        <div className="empty">
          <span className="spinner" />
        </div>
      </div>
    );
  }

  const processing = stage !== null || ['transcribing', 'summarizing', 'generating'].includes(m.status);
  const speakers = [...new Set(m.transcript?.segments.map((s) => s.speaker) ?? [])];
  const doneTasks = m.summary?.tasks.filter((t) => t.done).length ?? 0;

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label="חזרה" onClick={onBack}>
          <Back />
        </button>
        <h1>
          {m.title}
          <span className="sub">
            {formatDate(m.createdAt)}, {formatTime(m.createdAt)} · {formatDurationWords(m.durationMs)}
          </span>
        </h1>
        <button className="icon-btn" aria-label="פעולות נוספות" onClick={() => setMenu(true)}>
          <More />
        </button>
      </header>

      <div className="scroll">
        <div className="row wrap mb">
          <StatusChip status={m.status} error={m.error} />
          {m.client && <span className="chip">{m.client}</span>}
          {m.audioDeleted && <span className="chip">האודיו נמחק</span>}
        </div>

        {processing && (
          <div className="card mb">
            <h3>מעבד את הפגישה</h3>
            <div className="steps">
              {STAGES.map((s, i) => {
                const idx = STAGES.findIndex((x) => x.key === stage);
                const cur = stage ? idx : m.status === 'transcribing' ? 0 : m.status === 'summarizing' ? 1 : 2;
                const cls = i < cur ? 'done' : i === cur ? 'active' : '';
                return (
                  <div key={s.key} className={`step ${cls}`}>
                    <span className="ico">{cls === 'done' ? <Check style={{ width: 14, height: 14 }} /> : cls === 'active' ? <span className="spinner" /> : i + 1}</span>
                    <span>{s.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              אפשר לעבור למסך אחר, העיבוד ממשיך ברקע כל עוד האפליקציה פתוחה.
            </p>
          </div>
        )}

        {!processing && m.status === 'error' && (
          <div className="card mb">
            <div className="banner err" style={{ marginBottom: 10 }}>
              {m.error || 'אירעה שגיאה'}
            </div>
            <div className="row">
              <button className="btn primary grow" onClick={() => run()}>
                <Refresh /> נסה שוב
              </button>
            </div>
          </div>
        )}

        {!processing && m.status === 'recorded' && (
          <div className="card mb">
            <h3>ההקלטה נשמרה</h3>
            <p style={{ margin: '0 0 12px' }}>לחץ כדי לתמלל, לסכם וליצור מסמך Word.</p>
            <button className="btn primary block" onClick={() => run()}>
              עבד את הפגישה
            </button>
          </div>
        )}

        {(m.summary || m.transcript) && (
          <>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>
                סיכום
              </button>
              <button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
                משימות{m.summary?.tasks.length ? ` (${doneTasks}/${m.summary.tasks.length})` : ''}
              </button>
              <button role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>
                תמלול
              </button>
            </div>

            {tab === 'summary' && m.summary && (
              <>
                <div className="card prose">
                  <h3>תמצית</h3>
                  <p style={{ margin: 0 }}>{m.summary.overview}</p>
                </div>
                {m.summary.keyPoints.length > 0 && (
                  <div className="card">
                    <h3>עיקרי הדברים</h3>
                    <ul className="list">
                      {m.summary.keyPoints.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="card">
                  <h3>החלטות</h3>
                  {m.summary.decisions.length ? (
                    <ul className="list numbered">
                      {m.summary.decisions.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      לא התקבלו החלטות בפגישה זו.
                    </p>
                  )}
                </div>
                {m.summary.openQuestions.length > 0 && (
                  <div className="card">
                    <h3>שאלות פתוחות</h3>
                    <ul className="list">
                      {m.summary.openQuestions.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.summary.nextMeeting && (
                  <div className="card">
                    <h3>פגישת המשך</h3>
                    <p style={{ margin: 0 }}>{m.summary.nextMeeting}</p>
                  </div>
                )}
                {m.notes && (
                  <div className="card">
                    <h3>ההערות שלך</h3>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.notes}</p>
                  </div>
                )}
              </>
            )}

            {tab === 'summary' && !m.summary && (
              <div className="empty">
                <p>עדיין אין סיכום.</p>
              </div>
            )}

            {tab === 'tasks' && (
              <div className="card">
                {m.summary?.tasks.length ? (
                  m.summary.tasks.map((t, i) => (
                    <div key={i} className={`task ${t.done ? 'done' : ''}`}>
                      <button className={`check ${t.done ? 'on' : ''}`} aria-label={t.done ? 'סמן כלא בוצע' : 'סמן כבוצע'} onClick={() => toggleTask(i)}>
                        {t.done && <Check />}
                      </button>
                      <div>
                        <div className="t">{t.title}</div>
                        {(t.owner || t.due) && (
                          <div className="m">
                            {t.owner && <span>👤 {t.owner}</span>}
                            {t.due && <span>📅 {t.due}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    לא זוהו משימות להמשך.
                  </p>
                )}
              </div>
            )}

            {tab === 'transcript' && m.transcript && (
              <>
                {speakers.length > 1 && (
                  <div className="banner info">
                    <Users style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <span>לחץ על שם דובר כדי לתת לו שם אמיתי. השם יתעדכן גם במסמך ה-Word.</span>
                  </div>
                )}
                <div className="card">
                  {m.transcript.segments.map((s, i) => (
                    <div key={i} className="seg">
                      <div className="who">
                        <button onClick={() => setRenameSpeaker(s.speaker)}>{speakerLabel(s.speaker, m.speakerNames)}</button>
                        <span className="time">{clockFromSeconds(s.start)}</span>
                      </div>
                      <div className="txt">{s.text}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {m.status === 'ready' && m.docxPath && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="row">
              <Doc style={{ width: 28, height: 28, color: 'var(--accent)' }} />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{docxFileName(m)}</div>
                <div className="muted small">מסמך Word, גופן David 12</div>
              </div>
            </div>
            <div className="row mt">
              <button className="btn primary grow" onClick={share} disabled={busy}>
                <ShareIcon /> {isNative ? 'שתף / פתח' : 'הורד'}
              </button>
              {isNative && (
                <button className="btn grow" onClick={saveToDocuments} disabled={busy}>
                  <Download /> שמור במסמכים
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="actions-list">
          <button
            onClick={() => {
              setMenu(false);
              setEdit(true);
            }}
          >
            <Edit /> עריכת שם, לקוח ומשתתפים
          </button>
          {m.docxPath && (
            <button onClick={share}>
              <ShareIcon /> שתף את מסמך ה-Word
            </button>
          )}
          {m.transcript && !processing && (
            <button onClick={() => run('summarize')}>
              <Refresh /> סכם מחדש עם Claude
            </button>
          )}
          {m.audioPath && !m.audioDeleted && !processing && (
            <button onClick={() => run('transcribe')}>
              <Refresh /> תמלל מחדש מההקלטה
            </button>
          )}
          {m.audioPath && !m.audioDeleted && (
            <button
              onClick={async () => {
                setMenu(false);
                await removeAudio(m);
                reload();
                toast('קובץ האודיו נמחק');
              }}
            >
              <Trash /> מחק את קובץ האודיו בלבד
            </button>
          )}
          <button
            className="danger"
            onClick={() => {
              setMenu(false);
              setConfirmDelete(true);
            }}
          >
            <Trash /> מחק את הפגישה
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="למחוק את הפגישה?">
        <p className="muted">ההקלטה, התמלול, הסיכום ומסמך ה-Word יימחקו לצמיתות.</p>
        <div className="row mt">
          <button className="btn grow" onClick={() => setConfirmDelete(false)}>
            ביטול
          </button>
          <button className="btn danger grow" onClick={doDelete}>
            מחק
          </button>
        </div>
      </Sheet>

      {edit && <EditSheet m={m} onClose={() => setEdit(false)} onSave={saveEdit} />}
      {renameSpeaker && (
        <SpeakerSheet
          id={renameSpeaker}
          current={m.speakerNames?.[renameSpeaker] || ''}
          sample={m.transcript?.segments.find((s) => s.speaker === renameSpeaker)?.text || ''}
          onClose={() => setRenameSpeaker(null)}
          onSave={saveSpeaker}
        />
      )}
    </div>
  );
}

function EditSheet({ m, onClose, onSave }: { m: Meeting; onClose: () => void; onSave: (t: string, c: string, p: string) => void }) {
  const [title, setTitle] = useState(m.title);
  const [client, setClient] = useState(m.client || '');
  const [participants, setParticipants] = useState(m.participants || '');
  return (
    <Sheet open onClose={onClose} title="עריכת פרטי הפגישה">
      <Field label="נושא הפגישה">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="לקוח / תיק">
        <input className="input" value={client} onChange={(e) => setClient(e.target.value)} />
      </Field>
      <Field label="משתתפים">
        <input className="input" value={participants} onChange={(e) => setParticipants(e.target.value)} />
      </Field>
      <button className="btn primary block" onClick={() => onSave(title, client, participants)}>
        שמור
      </button>
    </Sheet>
  );
}

function SpeakerSheet({ id, current, sample, onClose, onSave }: { id: string; current: string; sample: string; onClose: () => void; onSave: (id: string, name: string) => void }) {
  const [name, setName] = useState(current);
  return (
    <Sheet open onClose={onClose} title={`מי זה ${speakerLabel(id)}?`}>
      {sample && (
        <p className="muted small" style={{ marginTop: 0 }}>
          "{sample.slice(0, 120)}
          {sample.length > 120 ? '...' : ''}"
        </p>
      )}
      <Field label="שם הדובר">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: ירין, הלקוח, רו״ח לוי" autoFocus />
      </Field>
      <div className="row">
        {current && (
          <button className="btn grow" onClick={() => onSave(id, '')}>
            אפס
          </button>
        )}
        <button className="btn primary grow" onClick={() => onSave(id, name)}>
          שמור
        </button>
      </div>
    </Sheet>
  );
}
