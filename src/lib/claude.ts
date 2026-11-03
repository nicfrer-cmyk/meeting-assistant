import type { Meeting, Summary, Transcript } from '../types';
import { speakerLabel } from './elevenlabs';

const API = 'https://api.anthropic.com/v1/messages';

const SUMMARY_TOOL = {
  name: 'save_meeting_summary',
  description: 'שומר סיכום מובנה של פגישה.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'כותרת קצרה וממוקדת לפגישה, עד 8 מילים' },
      overview: {
        type: 'string',
        description: 'סיכום הפגישה בפסקה אחת עד שתיים: מי נפגש, על מה דובר, מה המצב. בעברית תקנית, ללא נקודות תבליט.',
      },
      keyPoints: {
        type: 'array',
        items: { type: 'string' },
        description: 'הנקודות המרכזיות שעלו בפגישה, כל אחת משפט אחד או שניים, כולל סכומים, תאריכים ושמות שהוזכרו.',
      },
      decisions: {
        type: 'array',
        items: { type: 'string' },
        description: 'החלטות שהתקבלו בפועל בפגישה. אם לא התקבלו החלטות, מערך ריק.',
      },
      tasks: {
        type: 'array',
        description: 'משימות להמשך שעלו בפגישה.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'תיאור המשימה, ממוקד ומעשי' },
            owner: { type: 'string', description: 'מי אחראי. אם לא ברור, להשאיר ריק.' },
            due: { type: 'string', description: 'מועד יעד כפי שנאמר (למשל "עד יום חמישי", "תוך שבוע"). אם לא נאמר, להשאיר ריק.' },
          },
          required: ['title'],
        },
      },
      openQuestions: {
        type: 'array',
        items: { type: 'string' },
        description: 'שאלות פתוחות או נושאים שנשארו ללא הכרעה ודורשים בירור.',
      },
      nextMeeting: { type: 'string', description: 'אם נקבעה פגישת המשך, מתי ובאיזה נושא. אחרת ריק.' },
    },
    required: ['title', 'overview', 'keyPoints', 'decisions', 'tasks', 'openQuestions'],
  },
};

function buildSystemPrompt(extra: string, lawyerName: string): string {
  return [
    `אתה עוזר משפטי של ${lawyerName || 'עורך דין'} בישראל, המתמחה בהוצאה לפועל, חדלות פירעון, ליטיגציה ומשפט מסחרי.`,
    'תפקידך לסכם תמלול של פגישה בצורה מדויקת, מקצועית ושימושית.',
    'כללים:',
    '- כתוב בעברית תקנית ורהוטה, בגוף שלישי, ללא סימני מקף ארוך (—).',
    '- היה נאמן לתמלול. אל תמציא עובדות, סכומים, תאריכים או התחייבויות שלא נאמרו.',
    '- התמלול הוא אוטומטי ועלול להכיל שגיאות. השתמש בהקשר כדי להבין את הכוונה, אך אל תנחש כשהדבר מהותי.',
    '- כאשר מוזכרים סכומים, תאריכים, מספרי תיקים, שמות או מועדים, ציין אותם במדויק.',
    '- במשימות, הפרד בין משימות של עורך הדין לבין משימות של הלקוח או צד אחר.',
    '- אם התמלול קצר או דל, סכם בהתאם, בלי לנפח.',
    extra ? `הנחיות נוספות מהמשתמש:\n${extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function transcriptToText(t: Transcript, names?: Record<string, string>): string {
  return t.segments
    .map((s) => `[${speakerLabel(s.speaker, names)}] ${s.text}`)
    .join('\n');
}

export async function summarizeMeeting(
  meeting: Meeting,
  apiKey: string,
  model: string,
  extraInstructions: string,
  lawyerName: string,
): Promise<Summary> {
  if (!apiKey) throw new Error('חסר מפתח Anthropic. הוסף אותו במסך ההגדרות.');
  if (!meeting.transcript) throw new Error('אין תמלול לסיכום');

  const meta: string[] = [];
  if (meeting.title) meta.push(`כותרת שנתן המשתמש: ${meeting.title}`);
  if (meeting.client) meta.push(`לקוח / תיק: ${meeting.client}`);
  if (meeting.participants) meta.push(`משתתפים: ${meeting.participants}`);
  if (meeting.notes) meta.push(`הערות שרשם המשתמש במהלך הפגישה: ${meeting.notes}`);
  meta.push(`תאריך הפגישה: ${new Date(meeting.createdAt).toLocaleDateString('he-IL')}`);

  const userContent = [
    'להלן תמלול הפגישה. סכם אותו באמצעות הכלי save_meeting_summary.',
    '',
    meta.join('\n'),
    '',
    '--- תמלול ---',
    transcriptToText(meeting.transcript, meeting.speakerNames),
    '--- סוף תמלול ---',
  ].join('\n');

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: buildSystemPrompt(extraInstructions, lawyerName),
      tools: [SUMMARY_TOOL],
      tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || '';
    } catch {
      /* ignore */
    }
    if (res.status === 401) throw new Error('מפתח Anthropic לא תקין.');
    if (res.status === 400 && /credit|balance/i.test(detail)) throw new Error('נגמרה היתרה בחשבון Anthropic.');
    if (res.status === 404) throw new Error(`המודל ${model} לא זמין. בחר מודל אחר בהגדרות.`);
    if (res.status === 429) throw new Error('יותר מדי בקשות ל-Anthropic. נסה שוב בעוד רגע.');
    throw new Error(`שגיאת סיכום (${res.status}): ${detail || 'ללא פירוט'}`);
  }

  const data = await res.json();
  const toolUse = (data.content as Array<{ type: string; input?: unknown }>).find((c) => c.type === 'tool_use');
  if (!toolUse?.input) throw new Error('Claude לא החזיר סיכום מובנה');
  return normalizeSummary(toolUse.input as Partial<Summary>);
}

function normalizeSummary(raw: Partial<Summary>): Summary {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
  return {
    title: (raw.title || '').toString().trim() || undefined,
    overview: (raw.overview || '').toString().trim(),
    keyPoints: arr(raw.keyPoints),
    decisions: arr(raw.decisions),
    tasks: Array.isArray(raw.tasks)
      ? raw.tasks
          .map((t) => ({
            title: String((t as { title?: string }).title || '').trim(),
            owner: String((t as { owner?: string }).owner || '').trim() || undefined,
            due: String((t as { due?: string }).due || '').trim() || undefined,
            done: false,
          }))
          .filter((t) => t.title)
      : [],
    openQuestions: arr(raw.openQuestions),
    nextMeeting: (raw.nextMeeting || '').toString().trim() || undefined,
  };
}

export async function validateAnthropicKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (res.status === 401) return { ok: false, message: 'המפתח לא תקין' };
    if (!res.ok) return { ok: false, message: `שגיאה ${res.status}` };
    return { ok: true, message: 'המפתח תקין' };
  } catch {
    return { ok: false, message: 'לא ניתן להתחבר ל-Anthropic' };
  }
}
