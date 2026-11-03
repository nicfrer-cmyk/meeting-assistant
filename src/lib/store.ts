import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { DEFAULT_SETTINGS, type Meeting, type MeetingIndexEntry, type Settings } from '../types';
import { isNative } from './platform';

const INDEX_KEY = 'meetings.index.v1';
const SETTINGS_KEY = 'settings.v1';
const DIR = Directory.Data;

// ---------- Settings ----------

export async function getSettings(): Promise<Settings> {
  const { value } = await Preferences.get({ key: SETTINGS_KEY });
  if (!value) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(value) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(s) });
}

// ---------- Index ----------

export async function listMeetings(): Promise<MeetingIndexEntry[]> {
  const { value } = await Preferences.get({ key: INDEX_KEY });
  if (!value) return [];
  try {
    const arr = JSON.parse(value) as MeetingIndexEntry[];
    return arr.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

async function writeIndex(entries: MeetingIndexEntry[]): Promise<void> {
  await Preferences.set({ key: INDEX_KEY, value: JSON.stringify(entries) });
}

function toIndexEntry(m: Meeting): MeetingIndexEntry {
  return {
    id: m.id,
    title: m.title,
    client: m.client,
    createdAt: m.createdAt,
    durationMs: m.durationMs,
    status: m.status,
    taskCount: m.summary?.tasks?.length ?? 0,
  };
}

// ---------- Meetings ----------

async function ensureDir(path: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path, directory: DIR, recursive: true });
  } catch {
    /* exists */
  }
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  try {
    const res = await Filesystem.readFile({ path: `meetings/${id}.json`, directory: DIR, encoding: Encoding.UTF8 });
    const data = typeof res.data === 'string' ? res.data : await (res.data as Blob).text();
    return JSON.parse(data) as Meeting;
  } catch {
    return null;
  }
}

export async function saveMeeting(m: Meeting): Promise<Meeting> {
  m.updatedAt = Date.now();
  await ensureDir('meetings');
  await Filesystem.writeFile({
    path: `meetings/${m.id}.json`,
    directory: DIR,
    data: JSON.stringify(m),
    encoding: Encoding.UTF8,
    recursive: true,
  });
  const index = await listMeetings();
  const i = index.findIndex((e) => e.id === m.id);
  const entry = toIndexEntry(m);
  if (i >= 0) index[i] = entry;
  else index.unshift(entry);
  await writeIndex(index);
  return m;
}

export async function deleteMeeting(id: string): Promise<void> {
  const m = await getMeeting(id);
  if (m) {
    if (m.audioPath) await deleteFile(m.audioPath);
    if (m.docxPath) await deleteFile(m.docxPath);
  }
  await deleteFile(`meetings/${id}.json`);
  const index = await listMeetings();
  await writeIndex(index.filter((e) => e.id !== id));
}

// ---------- Files ----------

export async function deleteFile(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: DIR });
  } catch {
    /* ignore */
  }
}

export async function writeBase64(path: string, base64: string): Promise<void> {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  if (dir) await ensureDir(dir);
  await Filesystem.writeFile({ path, directory: DIR, data: base64, recursive: true });
}

export async function readBase64(path: string): Promise<string> {
  const res = await Filesystem.readFile({ path, directory: DIR });
  if (typeof res.data === 'string') return res.data;
  // web returns Blob in some versions
  return blobToBase64(res.data as Blob);
}

export async function readBlob(path: string, mime: string): Promise<Blob> {
  const res = await Filesystem.readFile({ path, directory: DIR });
  if (typeof res.data !== 'string') return res.data as Blob;
  return base64ToBlob(res.data, mime);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: DIR });
    return true;
  } catch {
    return false;
  }
}

/** Absolute file URI (file:///...) on native; a blob: URL on web. */
export async function getFileUri(path: string, mime = 'application/octet-stream'): Promise<string> {
  if (isNative) {
    const { uri } = await Filesystem.getUri({ path, directory: DIR });
    return uri;
  }
  const blob = await readBlob(path, mime);
  return URL.createObjectURL(blob);
}

/** Absolute filesystem path (without file://) on native. */
export async function getAbsolutePath(path: string): Promise<string> {
  const { uri } = await Filesystem.getUri({ path, directory: DIR });
  return uri.replace(/^file:\/\//, '');
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Copy a file to the public Documents folder (Android) so the user can find it in the file manager. */
export async function exportToDocuments(path: string, fileName: string): Promise<string> {
  const base64 = await readBase64(path);
  try {
    const perm = await Filesystem.checkPermissions();
    if (perm.publicStorage !== 'granted') await Filesystem.requestPermissions();
  } catch {
    /* not needed on newer Android */
  }
  try {
    await Filesystem.mkdir({ path: 'פגישות', directory: Directory.Documents, recursive: true });
  } catch {
    /* exists */
  }
  const res = await Filesystem.writeFile({
    path: `פגישות/${fileName}`,
    directory: Directory.Documents,
    data: base64,
    recursive: true,
  });
  return res.uri;
}
