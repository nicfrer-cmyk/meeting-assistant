import type { Transcript, TranscriptSegment } from '../types';
import { MeetingRecorder, isNative } from './platform';
import { getAbsolutePath, readBlob } from './store';

interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  type?: 'word' | 'spacing' | 'audio_event';
  speaker_id?: string;
}

interface ScribeResponse {
  language_code?: string;
  text: string;
  words?: ScribeWord[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function transcribeAudio(
  audioPath: string,
  mime: string,
  apiKey: string,
  opts: { numSpeakers?: number } = {},
): Promise<Transcript> {
  if (!apiKey) throw new Error('חסר מפתח ElevenLabs. הוסף אותו במסך ההגדרות.');

  let status: number;
  let body: string;

  if (isNative) {
    const abs = await getAbsolutePath(audioPath);
    const res = await MeetingRecorder.transcribeWithElevenLabs({
      path: abs,
      apiKey,
      languageCode: 'heb',
      modelId: 'scribe_v1',
      numSpeakers: opts.numSpeakers ?? 0,
    });
    status = res.status;
    body = res.body;
  } else {
    const blob = await readBlob(audioPath, mime);
    const ext = audioPath.slice(audioPath.lastIndexOf('.') + 1);
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('language_code', 'heb');
    form.append('diarize', 'true');
    form.append('tag_audio_events', 'false');
    form.append('timestamps_granularity', 'word');
    if (opts.numSpeakers) form.append('num_speakers', String(opts.numSpeakers));
    form.append('file', blob, `recording.${ext}`);
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
    status = res.status;
    body = await res.text();
  }

  if (status >= 400) {
    throw new ApiError(status, describeElevenLabsError(status, body));
  }

  let parsed: ScribeResponse;
  try {
    parsed = JSON.parse(body) as ScribeResponse;
  } catch {
    throw new Error('ElevenLabs החזיר תשובה לא תקינה');
  }
  return toTranscript(parsed);
}

function describeElevenLabsError(status: number, body: string): string {
  let detail = '';
  try {
    const j = JSON.parse(body);
    detail = j?.detail?.message || j?.detail?.status || j?.detail || j?.message || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    detail = body.slice(0, 200);
  }
  if (status === 401 && /missing_permissions|speech_to_text|permission/i.test(body))
    return 'למפתח ElevenLabs אין הרשאת Speech to Text. ערוך את המפתח ב-ElevenLabs, סמן Speech to Text: Access, ולחץ "נסה שוב".';
  if (status === 401) return `מפתח ElevenLabs נדחה (${detail || 'invalid_api_key'}). ודא שהמפתח נשמר בהגדרות ושהועתק במלואו.`;
  if (status === 402 || /quota|credits|exceeded/i.test(detail)) return 'נגמרו הקרדיטים בחשבון ElevenLabs.';
  if (status === 413) return 'קובץ ההקלטה גדול מדי עבור ElevenLabs.';
  return `שגיאת תמלול (${status}): ${detail || 'ללא פירוט'}`;
}

export function toTranscript(res: ScribeResponse): Transcript {
  const words = (res.words ?? []).filter((w) => w.type !== 'audio_event');
  const segments: TranscriptSegment[] = [];
  let cur: TranscriptSegment | null = null;
  let lastEnd = 0;

  for (const w of words) {
    const speaker = w.speaker_id || 'speaker_0';
    const start = w.start ?? lastEnd;
    const end = w.end ?? start;
    const isSpace = w.type === 'spacing' || /^\s*$/.test(w.text);
    const pause = start - lastEnd;

    if (!cur || cur.speaker !== speaker || (pause > 3 && !isSpace)) {
      if (cur) {
        cur.text = cur.text.trim();
        if (cur.text) segments.push(cur);
      }
      cur = { speaker, start, end, text: '' };
    }
    cur.text += isSpace ? ' ' : w.text;
    cur.end = Math.max(cur.end, end);
    if (!isSpace) lastEnd = end;
  }
  if (cur) {
    cur.text = cur.text.trim();
    if (cur.text) segments.push(cur);
  }

  // Normalise spacing between words that came without explicit spacing tokens.
  for (const s of segments) s.text = s.text.replace(/\s+/g, ' ').trim();

  const text = segments.length ? segments.map((s) => s.text).join('\n') : (res.text ?? '').trim();
  if (!segments.length && text) segments.push({ speaker: 'speaker_0', start: 0, end: 0, text });

  return { text, segments, languageCode: res.language_code };
}

export function speakerLabel(id: string, names?: Record<string, string>): string {
  if (names?.[id]) return names[id];
  const m = /speaker_(\d+)/.exec(id);
  if (m) return `דובר ${Number(m[1]) + 1}`;
  return id;
}

export async function validateElevenLabsKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    // Probe the speech-to-text endpoint itself with an empty request:
    // a permitted key gets a validation error (400/422), a missing permission gets 401.
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
    const body = await res.text();
    if (res.status === 401) {
      if (/missing_permissions|permission/i.test(body))
        return { ok: false, message: 'המפתח תקין אבל אין לו הרשאת Speech to Text. ערוך אותו ב-ElevenLabs וסמן Speech to Text: Access.' };
      return { ok: false, message: 'המפתח לא תקין. ודא שהעתקת את כולו (מתחיל ב-sk_).' };
    }
    if (res.status === 400 || res.status === 422 || res.ok) {
      return { ok: true, message: 'המפתח תקין ויש לו הרשאת תמלול' };
    }
    return { ok: false, message: `שגיאה ${res.status}` };
  } catch {
    return { ok: false, message: 'לא ניתן להתחבר ל-ElevenLabs. בדוק את החיבור לאינטרנט.' };
  }
}
