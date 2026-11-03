import type { Meeting, ProcessingProgress, Settings } from '../types';
import { summarizeMeeting } from './claude';
import { buildMeetingDocx } from './docx';
import { transcribeAudio } from './elevenlabs';
import { isoDate, safeFileName } from './format';
import { MeetingRecorder, isNative } from './platform';
import { blobToBase64, deleteFile, getAbsolutePath, getMeeting, getSettings, saveMeeting, writeBase64 } from './store';

type Listener = (meetingId: string, progress: ProcessingProgress | null) => void;
const listeners = new Set<Listener>();
const running = new Map<string, ProcessingProgress>();

export function onProgress(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getProgress(id: string): ProcessingProgress | undefined {
  return running.get(id);
}

function emit(id: string, p: ProcessingProgress | null) {
  if (p) running.set(id, p);
  else running.delete(id);
  listeners.forEach((l) => l(id, p));
}

export function docxFileName(m: Meeting): string {
  const base = safeFileName(`${isoDate(m.createdAt)} ${m.summary?.title || m.title}${m.client ? ` - ${m.client}` : ''}`);
  return `${base}.docx`;
}

/** Runs the whole chain. Safe to re-run: skips stages already done unless `force`. */
export async function processMeeting(
  id: string,
  opts: { force?: 'transcribe' | 'summarize' | 'docx' } = {},
): Promise<Meeting> {
  if (running.has(id)) throw new Error('הפגישה כבר בעיבוד');
  let m = await getMeeting(id);
  if (!m) throw new Error('הפגישה לא נמצאה');
  const settings = await getSettings();

  try {
    // 1. Transcribe
    if (!m.transcript || opts.force === 'transcribe') {
      if (!m.audioPath || m.audioDeleted) throw new Error('קובץ ההקלטה לא קיים, לא ניתן לתמלל מחדש');
      m.status = 'transcribing';
      m.error = undefined;
      await saveMeeting(m);
      emit(id, { stage: 'transcribe', message: 'מתמלל את ההקלטה בעברית...' });
      m.transcript = await transcribeAudio(m.audioPath, m.audioMime || 'audio/mp4', settings.elevenLabsKey);
      m.summary = undefined;
      await saveMeeting(m);
    }

    // 2. Summarize
    if (!m.summary || opts.force === 'summarize' || opts.force === 'transcribe') {
      m.status = 'summarizing';
      await saveMeeting(m);
      emit(id, { stage: 'summarize', message: 'Claude מסכם ומחלץ משימות...' });
      m.summary = await summarizeMeeting(m, settings.anthropicKey, settings.model, settings.extraInstructions, settings.lawyerName);
      if (m.summary.title && (!m.title || /^פגישה \d/.test(m.title) || m.title === 'פגישה ללא שם')) {
        m.title = m.summary.title;
      }
      await saveMeeting(m);
    }

    // 3. Word
    m.status = 'generating';
    await saveMeeting(m);
    emit(id, { stage: 'docx', message: 'יוצר מסמך Word...' });
    await regenerateDocx(m, settings);

    // 4. Optional cleanup
    if (settings.deleteAudioAfter && m.audioPath && !m.audioDeleted) {
      await removeAudio(m);
    }

    m.status = 'ready';
    m.error = undefined;
    await saveMeeting(m);
    emit(id, { stage: 'done', message: 'מוכן' });
    return m;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    m = (await getMeeting(id)) || m;
    m.status = 'error';
    m.error = msg;
    await saveMeeting(m);
    throw e;
  } finally {
    emit(id, null);
  }
}

export async function regenerateDocx(m: Meeting, settings?: Settings): Promise<string> {
  const s = settings ?? (await getSettings());
  const blob = await buildMeetingDocx(m, s);
  if (m.docxPath) await deleteFile(m.docxPath);
  const path = `docs/${m.id}.docx`;
  await writeBase64(path, await blobToBase64(blob));
  m.docxPath = path;
  await saveMeeting(m);
  return path;
}

export async function removeAudio(m: Meeting): Promise<void> {
  if (!m.audioPath) return;
  if (isNative) {
    try {
      await MeetingRecorder.deleteFile({ path: await getAbsolutePath(m.audioPath) });
    } catch {
      /* fall through */
    }
  }
  await deleteFile(m.audioPath);
  m.audioDeleted = true;
  await saveMeeting(m);
}
