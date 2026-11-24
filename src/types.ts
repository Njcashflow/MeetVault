// ==========================================
// 1. CORE DOMAIN ENTITIES (Aggregate Root)
// ==========================================

export type CaptureEngineMode = 'ECO_DOM' | 'LOCAL_WHISPER';

export interface TranscriptUtterance {
  id: string;                      // Deterministic hash or UUID
  speaker: string;                 // e.g., "Participant", "You"
  rawText: string;                 // Original unedited text from engine
  cleanText: string;               // Text after dictionary & manual corrections
  startTimeMs: number;             // Offset in ms from session.startedAt
  endTimeMs: number;               // Offset in ms when speaker finished segment
  isFinal: boolean;                // True once speaker pauses or changes
}

export interface MeetingSession {
  id: string;                      // UUID v4
  meetCode: string;                // e.g., "abc-defg-hij" extracted from URL
  title: string;                   // Page title or user-editable meeting name
  startedAt: string;               // ISO-8601 timestamp
  endedAt?: string;                // ISO-8601 timestamp
  engineMode: CaptureEngineMode;
  participants: string[];          // Deduplicated list of detected speakers
  utterances: TranscriptUtterance[];
  version: number;                 // Optimistic offline lock version
}

// ==========================================
// 2. DICTIONARY & NORMALIZATION SCHEMA
// ==========================================

export interface CorrectionRule {
  id: string;
  pattern: string;                 // Misheard phrase/word (e.g., "kopa belt")
  replacement: string;             // Corrected phrase (e.g., "Copperbelt")
  isRegex: boolean;
  caseSensitive: boolean;
  createdAt: string;
}

// ==========================================
// 3. EXPORT STRATEGY INTERFACES
// ==========================================

export type ExportFormat = 'docx' | 'pdf' | 'md' | 'txt' | 'srt' | 'vtt' | 'json' | 'csv';

export interface ExportArtifact {
  filename: string;
  mimeType: string;
  blob: Blob;
}

export interface TranscriptExporter {
  readonly format: ExportFormat;
  export(session: MeetingSession): Promise<ExportArtifact>;
}
