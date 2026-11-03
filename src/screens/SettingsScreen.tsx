import { useState } from 'react';
import { validateAnthropicKey } from '../lib/claude';
import { validateElevenLabsKey } from '../lib/elevenlabs';
import { saveSettings } from '../lib/store';
import { MODEL_OPTIONS, type Settings } from '../types';
import { Back, External, Key } from '../ui/icons';
import { Field, Toggle } from '../ui/primitives';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onBack: () => void;
  toast: (m: string) => void;
}

export function SettingsScreen({ settings, onChange, onBack, toast }: Props) {
  const [s, setS] = useState<Settings>(settings);
  const [checking, setChecking] = useState<'el' | 'an' | null>(null);
  const [result, setResult] = useState<{ el?: string; an?: string }>({});

  const update = (patch: Partial<Settings>) => setS((p) => ({ ...p, ...patch }));

  const save = async () => {
    const clean = { ...s, elevenLabsKey: s.elevenLabsKey.trim(), anthropicKey: s.anthropicKey.trim() };
    await saveSettings(clean);
    onChange(clean);
    toast('ההגדרות נשמרו');
    onBack();
  };

  const check = async (which: 'el' | 'an') => {
    setChecking(which);
    const r = which === 'el' ? await validateElevenLabsKey(s.elevenLabsKey.trim()) : await validateAnthropicKey(s.anthropicKey.trim());
    setResult((p) => ({ ...p, [which]: `${r.ok ? '✅' : '❌'} ${r.message}` }));
    setChecking(null);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label="חזרה" onClick={onBack}>
          <Back />
        </button>
        <h1>הגדרות</h1>
      </header>

      <div className="scroll">
        <div className="card">
          <h3>
            <Key style={{ width: 16, height: 16, verticalAlign: -3 }} /> מפתחות API
          </h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            המפתחות נשמרים רק בטלפון הזה ונשלחים ישירות ל-ElevenLabs ול-Anthropic.
          </p>

          <Field label="מפתח ElevenLabs (תמלול)">
            <input className="input mono" value={s.elevenLabsKey} onChange={(e) => update({ elevenLabsKey: e.target.value })} placeholder="sk_..." autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <div className="row mt">
              <button className="btn sm" disabled={!s.elevenLabsKey || checking !== null} onClick={() => check('el')}>
                {checking === 'el' ? <span className="spinner" /> : 'בדוק מפתח'}
              </button>
              <a className="btn sm ghost" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">
                <External /> לקבלת מפתח
              </a>
            </div>
            {result.el && <div className="hint">{result.el}</div>}
          </Field>

          <Field label="מפתח Anthropic (סיכום)">
            <input className="input mono" value={s.anthropicKey} onChange={(e) => update({ anthropicKey: e.target.value })} placeholder="sk-ant-..." autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <div className="row mt">
              <button className="btn sm" disabled={!s.anthropicKey || checking !== null} onClick={() => check('an')}>
                {checking === 'an' ? <span className="spinner" /> : 'בדוק מפתח'}
              </button>
              <a className="btn sm ghost" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                <External /> לקבלת מפתח
              </a>
            </div>
            {result.an && <div className="hint">{result.an}</div>}
          </Field>

          <Field label="מודל לסיכום">
            <select className="input" value={s.model} onChange={(e) => update({ model: e.target.value })}>
              {MODEL_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} · {o.hint}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="card">
          <h3>המסמך</h3>
          <Field label="שם עורך הדין" hint="מופיע במסמך בשורה 'נערך על ידי'.">
            <input className="input" value={s.lawyerName} onChange={(e) => update({ lawyerName: e.target.value })} />
          </Field>
          <Field label="שם המשרד (לכותרת העליונה)">
            <input className="input" value={s.firmName} onChange={(e) => update({ firmName: e.target.value })} placeholder="לא חובה" />
          </Field>
          <Field label="הנחיות נוספות ל-Claude" hint="למשל: 'הדגש סכומים ומועדי תשלום', 'פנה ללקוח בשמו'. חל על כל הסיכומים.">
            <textarea className="input" value={s.extraInstructions} onChange={(e) => update({ extraInstructions: e.target.value })} rows={3} />
          </Field>
        </div>

        <div className="card">
          <h3>אחסון</h3>
          <Toggle on={s.deleteAudioAfter} onChange={(v) => update({ deleteAudioAfter: v })} label="מחק את ההקלטה אחרי שהסיכום מוכן" desc="חוסך מקום בטלפון. התמלול והמסמך נשמרים. לא ניתן יהיה לתמלל מחדש." />
        </div>

        <button className="btn primary block mt" style={{ minHeight: 54 }} onClick={save}>
          שמור הגדרות
        </button>
        <p className="muted small center mt">גרסה 1.0 · הנתונים נשמרים רק במכשיר זה</p>
      </div>
    </div>
  );
}
