export type MeetingStatus =
  | 'recording'
  | 'recorded'
  | 'transcribing'
  | 'summarizing'
  | 'generating'
  | 'ready'
  | 'error';

export interface TranscriptSegment {
  speaker: string; // e.g. "speaker_0"
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
  languageCode?: string;
}

export interface TaskItem {
  title: string;
  owner?: string;
  due?: string;
  done?: boolean;
}

export interface Summary {
  title?: string;
  overview: string;
  keyPoints: string[];
  decisions: string[];
  tasks: TaskItem[];
  openQuestions: string[];
  nextMeeting?: string;
}

export interface Meeting {
  id: string;
  title: string;
  client?: string;
  participants?: string;
  notes?: string;
  createdAt: number; // epoch ms
  durationMs: number;
  audioPath?: string; // native absolute path OR web relative path in Directory.Data
  audioMime?: string;
  audioDeleted?: boolean;
  status: MeetingStatus;
  error?: string;
  transcript?: Transcript;
  speakerNames?: Record<string, string>;
  summary?: Summary;
  docxPath?: string; // relative path in Directory.Data
  updatedAt: number;
}

export interface MeetingIndexEntry {
  id: string;
  title: string;
  client?: string;
  createdAt: number;
  durationMs: number;
  status: MeetingStatus;
  taskCount?: number;
}

export interface Settings {
  elevenLabsKey: string;
  anthropicKey: string;
  model: string;
  deleteAudioAfter: boolean;
  extraInstructions: string;
  lawyerName: string;
  firmName: string;
}

export const DEFAULT_SETTINGS: Settings = {
  elevenLabsKey: '',
  anthropicKey: '',
  model: 'claude-sonnet-5-5',
  deleteAudioAfter: false,
  extraInstructions: '',
  lawyerName: 'עו"ד ירין אשואל',
  firmName: '',
};

export const MODEL_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'מומלץ. איכות גבוהה במחיר סביר' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'האיכותי ביותר, יקר יותר' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'הכי מהיר וזול' },
];

export type ProcessingStage = 'upload' | 'transcribe' | 'summarize' | 'docx' | 'done';

export interface ProcessingProgress {
  stage: ProcessingStage;
  message: string;
}
