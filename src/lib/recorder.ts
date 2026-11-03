import { MeetingRecorder, isNative } from './platform';
import { blobToBase64, writeBase64 } from './store';

export interface RecordingResult {
  path: string; // relative to Directory.Data
  mime: string;
  durationMs: number;
}

export interface RecorderHandle {
  stop(): Promise<RecordingResult>;
  /** 0..1 input level, only available on web */
  level(): number;
  startedAt: number;
}

let active: RecorderHandle | null = null;

export function getActiveRecorder(): RecorderHandle | null {
  return active;
}

export async function startRecording(id: string): Promise<RecorderHandle> {
  if (active) throw new Error('ALREADY_RECORDING');
  const handle = isNative ? await startNative(id) : await startWeb(id);
  active = handle;
  return handle;
}

async function startNative(id: string): Promise<RecorderHandle> {
  try {
    await MeetingRecorder.requestNotificationPermission();
  } catch {
    /* optional */
  }
  const fileName = `${id}.m4a`;
  await MeetingRecorder.start({ fileName });
  const startedAt = Date.now();
  return {
    startedAt,
    level: () => 0,
    stop: async () => {
      const res = await MeetingRecorder.stop();
      active = null;
      return {
        path: `recordings/${fileName}`,
        mime: 'audio/mp4',
        durationMs: res.durationMs || Date.now() - startedAt,
      };
    },
  };
}

async function startWeb(id: string): Promise<RecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('הדפדפן לא תומך בהקלטה');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.start(1000);
  const startedAt = Date.now();

  // level meter
  let analyser: AnalyserNode | null = null;
  let ctx: AudioContext | null = null;
  let data: Uint8Array<ArrayBuffer> | null = null;
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    data = new Uint8Array(analyser.frequencyBinCount);
  } catch {
    /* no meter */
  }

  return {
    startedAt,
    level: () => {
      if (!analyser || !data) return 0;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 3);
    },
    stop: () =>
      new Promise<RecordingResult>((resolve, reject) => {
        rec.onstop = async () => {
          try {
            stream.getTracks().forEach((t) => t.stop());
            if (ctx) await ctx.close().catch(() => undefined);
            const type = rec.mimeType || mime || 'audio/webm';
            const blob = new Blob(chunks, { type });
            const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
            const path = `recordings/${id}.${ext}`;
            await writeBase64(path, await blobToBase64(blob));
            active = null;
            resolve({ path, mime: type, durationMs: Date.now() - startedAt });
          } catch (e) {
            active = null;
            reject(e);
          }
        };
        try {
          rec.stop();
        } catch (e) {
          reject(e);
        }
      }),
  };
}

function pickMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return undefined;
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}
