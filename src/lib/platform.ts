import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

export interface MeetingRecorderPlugin {
  start(options: { fileName: string }): Promise<{ path: string }>;
  stop(): Promise<{ path: string; durationMs: number; size: number; warning?: string }>;
  getStatus(): Promise<{ recording: boolean; elapsedMs: number; path: string | null }>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  transcribeWithElevenLabs(options: {
    path: string;
    apiKey: string;
    languageCode?: string;
    modelId?: string;
    numSpeakers?: number;
  }): Promise<{ status: number; body: string }>;
  deleteFile(options: { path: string }): Promise<{ deleted: boolean }>;
}

export const MeetingRecorder = registerPlugin<MeetingRecorderPlugin>('MeetingRecorder');

export function uid(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}${r}`;
}
