import { MeetingRecorder, isNative } from './platform';
import { getProgress } from './pipeline';
import { fileExists, getMeeting, listMeetings, saveMeeting } from './store';

/**
 * Called once on launch. Fixes meetings whose processing or recording was
 * interrupted because the app was closed, so nothing stays stuck "in progress".
 */
export async function recoverOnLaunch(): Promise<void> {
  const index = await listMeetings();
  let nativeRecording: { recording: boolean; elapsedMs: number; path: string | null } | null = null;
  if (isNative) {
    try {
      nativeRecording = await MeetingRecorder.getStatus();
    } catch {
      nativeRecording = null;
    }
  }

  for (const entry of index) {
    if (entry.status === 'recording') {
      const m = await getMeeting(entry.id);
      if (!m) continue;
      const expectedPath = `recordings/${m.id}.m4a`;
      if (nativeRecording?.recording && nativeRecording.path?.endsWith(`${m.id}.m4a`)) {
        // The service kept recording while the UI was gone. Stop and keep the audio.
        try {
          const res = await MeetingRecorder.stop();
          m.audioPath = expectedPath;
          m.audioMime = 'audio/mp4';
          m.durationMs = res.durationMs || nativeRecording.elapsedMs;
          m.status = 'recorded';
          m.error = undefined;
        } catch {
          m.status = 'error';
          m.error = 'ההקלטה נקטעה ולא ניתן היה לשמור אותה.';
        }
      } else if (await fileExists(expectedPath)) {
        m.audioPath = expectedPath;
        m.audioMime = 'audio/mp4';
        m.status = 'recorded';
        m.error = undefined;
      } else {
        m.status = 'error';
        m.error = 'ההקלטה נקטעה לפני שנשמרה.';
      }
      await saveMeeting(m);
      continue;
    }

    if (['transcribing', 'summarizing', 'generating'].includes(entry.status) && !getProgress(entry.id)) {
      const m = await getMeeting(entry.id);
      if (!m) continue;
      m.status = 'error';
      m.error = 'העיבוד נקטע כשהאפליקציה נסגרה. לחץ "נסה שוב" כדי להמשיך מהשלב שבו עצר.';
      await saveMeeting(m);
    }
  }
}
