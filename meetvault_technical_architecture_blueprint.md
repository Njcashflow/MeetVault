# MeetVault: Technical Architecture & Implementation Blueprint

**Version:** 1.0.0  
**Architecture Style:** Offline-First, Zero-Backend, Layered Manifest V3 Extension  
**Distribution Model:** Open-Source (GitHub Releases / Unpacked Extension)

---

## 1. Architectural Strategy & Layered Design

To guarantee zero server costs, zero external API keys, and responsive performance on resource-constrained hardware, **MeetVault** bypasses the traditional cloud client-server model and operates as a strictly **offline-first, stateful in-browser application**. Following a **Layered Architecture** isolates Google Meet DOM scraping and floating UI rendering from core domain logic and local persistence:

* **Presentation Layer (Shadow DOM Floating HUD):** Injects an isolated, draggable floating widget directly onto `meet.google.com` using Web Components (`attachShadow({ mode: 'closed' })`). Using Shadow DOM prevents Google Meet's aggressive CSS rules from bleeding into the widget and insulates the extension from page layout shifts.
* **Ingestion & Adapter Layer (Anticorruption Layer):** Acts as a translation boundary between external, unstable sources (Google Meet's live caption DOM or raw WebAudio streams) and the internal Domain Model. If Google Meet changes its DOM structure, only the lightweight DOM Adapter changes—the core domain, storage, and exporters remain untouched.
* **Domain Layer (Transcript Aggregate & Correction Engine):** Manages the live session state in memory as an append-only event stream, applies user-defined regex/dictionary normalization rules (side-effect-free functions), and orchestrates document export transformations.
* **Data Source Layer (Repository & IndexedDB):** Encapsulates `IndexedDB` behind a clean **Repository Pattern**, providing high data locality by storing each meeting session as a self-contained JSON document alongside a persistent custom word-replacement dictionary.

---

## 2. System Architecture & Dataflow Diagram

```text
+-----------------------------------------------------------------------------------+
|                        GOOGLE MEET TAB (meet.google.com)                          |
|                                                                                   |
|  +-------------------------------------+    +----------------------------------+  |
|  |      INGESTION ADAPTERS (ACL)       |    |    PRESENTATION LAYER (HUD)      |  |
|  |                                     |    |                                  |  |
|  |  [Mode A: Eco DOM Observer]         |    |  Shadow DOM Floating Window      |  |
|  |   - MutationObserver on Caption Box |    |   - Draggable Header & Timer     |  |
|  |   - CSS-hides native Meet bar       |    |   - Live Auto-Scrolling Feed     |  |
|  |                                     |    |   - Inline Word-Fix Editor (✎)   |  |
|  |  [Mode B: Offline Whisper WASM]     |    |   - Multi-Format Export Menu     |  |
|  |   - chrome.tabCapture + Mic Audio   |    +----------------^-----------------+  |
|  +------------------+------------------+                     |                    |
+---------------------|----------------------------------------|--------------------+
                      | RawUtteranceEvent                      | State Updates
                      v                                        |
+-----------------------------------------------------------------------------------+
|                      EXTENSION SERVICE WORKER / DOMAIN LAYER                      |
|                                                                                   |
|  1. Utterance Deduplication & Sliding-Window Merger Algorithm                     |
|  2. Side-Effect-Free Dictionary Normalizer (Applies Custom Find/Replace Rules)    |
|  3. MeetingSession Aggregate (In-Memory Read-Optimized View)                      |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                     OFFLINE EXPORT ENGINE (Strategy Pattern)                |  |
|  |  [.docx Builder]   [.pdf Builder]   [.md / .txt]   [.srt / .vtt]   [.json]  |  |
|  +--------------------------------------+--------------------------------------+  |
+-----------------------------------------|-----------------------------------------+
                                          | Persist / Query
                                          v
+-----------------------------------------------------------------------------------+
|                        DATA SOURCE LAYER (IndexedDB + Blob)                       |
|                                                                                   |
|  [Store: sessions] (JSON Document Locality)   [Store: dictionary] (Key-Value)     |
|  [chrome.downloads API] -> Triggers local browser download from generated Blob     |
+-----------------------------------------------------------------------------------+
```

---

## 3. Project Folder Structure

```text
meetvault/
├── manifest.json                 # Manifest V3 permissions & entrypoints
├── package.json                  # Dependencies (docx, jspdf, idb, vite)
├── tsconfig.json                 # Strict TypeScript compiler configuration
├── vite.config.ts                # Single-bundle MV3 build config
└── src/
    ├── types.ts                  # Domain entities, DTOs, & Exporter interfaces
    ├── background.ts             # Service worker handling downloads & offscreen lifecycle
    ├── content/
    │   ├── index.ts              # Content script orchestrator & state reducer
    │   ├── dom-observer.ts       # Eco Mode: ARIA-anchored caption observer
    │   └── overlay.ts            # Draggable Shadow DOM floating HUD
    ├── domain/
    │   ├── merger.ts             # Sliding-window LCP caption deduplication
    │   └── normalizer.ts         # Side-effect-free dictionary auto-correction engine
    ├── exporters/
    │   └── export-engine.ts      # Strategy implementations (.docx, .pdf, .md, .srt, .vtt, .csv, .json, .txt)
    └── storage/
        └── session-repository.ts # IndexedDB persistence with optimistic locking
```

---

## 4. Database Schema & Domain Entities (`src/types.ts`)

Because a meeting transcript is created, edited, and exported as a single cohesive unit, a **Document-Oriented Data Model** stored in `IndexedDB` provides superior storage locality—allowing an entire meeting to be retrieved or exported in a single read without multi-table joins.

```typescript
// ==========================================
// 1. CORE DOMAIN ENTITIES (Aggregate Root)
// ==========================================

export type CaptureEngineMode = 'ECO_DOM' | 'LOCAL_WHISPER';

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

export interface TranscriptUtterance {
  id: string;                      // Deterministic hash or UUID
  speaker: string;                 // e.g., "Njavwa", "Guest 1", or "You"
  rawText: string;                 // Original unedited text from engine
  cleanText: string;               // Text after dictionary & manual corrections
  startTimeMs: number;             // Offset in ms from session.startedAt
  endTimeMs: number;               // Offset in ms when speaker finished segment
  isFinal: boolean;                // True once speaker pauses or changes
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
// 3. EXPORT STRATEGY INTERFACE
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
```

---

## 5. Core Algorithms

### 5.1 Live Caption Stream Deduplication & Sliding-Window Merger (`src/domain/merger.ts`)
Google Meet's live caption DOM mutates rapidly—updating the *same* active caption block word-by-word as a person speaks before finalizing it. Naive `MutationObserver` scripts record dozens of duplicate partial sentences.

* **Approach:** Maintain an active buffer keyed by `speaker`. Compare incoming text against the active unfinalized utterance using a **Longest Common Prefix (LCP)** similarity threshold:
  1. If `incoming.speaker !== activeUtterance.speaker`, mark `activeUtterance.isFinal = true`, flush it to the `MeetingSession`, and open a new utterance.
  2. If `incoming.speaker === activeUtterance.speaker`:
     * If `incoming.text` extends `activeUtterance.rawText` or shares $\ge 30\%$ prefix overlap (normal incremental speech refinement), overwrite `activeUtterance.rawText` in place and update `endTimeMs`.
     * If `incoming.text` shares $< 30\%$ prefix overlap (Google Meet cleared the caption box for a brand-new sentence by the same speaker), finalize the old utterance and push a new one.

```typescript
import { TranscriptUtterance } from '../types';

export function computePrefixOverlapRatio(prev: string, next: string): number {
  if (!prev || !next) return 0;
  const minLen = Math.min(prev.length, next.length);
  let matched = 0;
  while (matched < minLen && prev[matched].toLowerCase() === next[matched].toLowerCase()) {
    matched++;
  }
  return matched / prev.length;
}

export function mergeIncomingCaption(
  utterances: TranscriptUtterance[],
  speaker: string,
  incomingText: string,
  elapsedMs: number,
  normalizeFn: (text: string) => string
): { updatedList: TranscriptUtterance[]; activeUtterance: TranscriptUtterance } {
  const list = [...utterances];
  const last = list[list.length - 1];

  if (last && !last.isFinal && last.speaker === speaker) {
    const overlap = computePrefixOverlapRatio(last.rawText, incomingText);
    if (overlap >= 0.3 || incomingText.toLowerCase().startsWith(last.rawText.toLowerCase())) {
      const updated: TranscriptUtterance = {
        ...last,
        rawText: incomingText,
        cleanText: normalizeFn(incomingText),
        endTimeMs: elapsedMs
      };
      list[list.length - 1] = updated;
      return { updatedList: list, activeUtterance: updated };
    }
    // Speaker started a fresh caption block; finalize previous
    list[list.length - 1] = { ...last, isFinal: true };
  } else if (last && !last.isFinal) {
    // Speaker changed; finalize previous speaker's utterance
    list[list.length - 1] = { ...last, isFinal: true };
  }

  const created: TranscriptUtterance = {
    id: crypto.randomUUID(),
    speaker,
    rawText: incomingText,
    cleanText: normalizeFn(incomingText),
    startTimeMs: elapsedMs,
    endTimeMs: elapsedMs,
    isFinal: false
  };
  list.push(created);
  return { updatedList: list, activeUtterance: created };
}
```

### 5.2 Side-Effect-Free Dictionary Normalizer (`src/domain/normalizer.ts`)
Compiles user-defined `CorrectionRule[]` into cached `RegExp` instances and applies them purely without mutating input strings.

```typescript
import { CorrectionRule } from '../types';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildNormalizer(rules: CorrectionRule[]): (text: string) => string {
  const compiled = rules.map((rule) => {
    const source = rule.isRegex ? rule.pattern : `\\b${escapeRegExp(rule.pattern)}\\b`;
    const flags = rule.caseSensitive ? 'g' : 'gi';
    return { regex: new RegExp(source, flags), replacement: rule.replacement };
  });

  return (text: string): string => {
    return compiled.reduce((acc, { regex, replacement }) => acc.replace(regex, replacement), text);
  };
}
```

---

## 6. Production Implementation Code

### 6.1 Manifest V3 Configuration (`manifest.json`)
```json
{
  "manifest_version": 3,
  "name": "MeetVault — Zero-Paywall Local Meeting Transcriber",
  "version": "1.0.0",
  "description": "100% offline, zero-API Google Meet transcriber with floating HUD and Word/PDF/Markdown exports.",
  "permissions": [
    "storage",
    "downloads",
    "offscreen",
    "tabCapture"
  ],
  "host_permissions": [
    "https://meet.google.com/*"
  ],
  "background": {
    "service_worker": "dist/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["dist/content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["dist/wasm/*"],
      "matches": ["https://meet.google.com/*"]
    }
  ]
}
```

### 6.2 Eco-Mode Ingestion Adapter (`src/content/dom-observer.ts`)
Uses structural ARIA attributes (`[aria-label*="Captions"]`, `img`) rather than brittle obfuscated CSS class names to extract speaker names and live captions resiliently.

```typescript
export class MeetDomAdapter {
  private observer: MutationObserver | null = null;
  private onCaptionEvent: (speaker: string, text: string) => void;

  constructor(onCaptionEvent: (speaker: string, text: string) => void) {
    this.onCaptionEvent = onCaptionEvent;
  }

  public start(): void {
    this.ensureCaptionsEnabled();
    this.injectCaptionHiderStyle();

    this.observer = new MutationObserver(() => {
      this.scanCaptionRegion();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  public stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private ensureCaptionsEnabled(): void {
    // Locate Meet's CC toggle button via stable ARIA labels rather than CSS classes
    const ccButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="captions" i][aria-pressed="false"]'
    );
    if (ccButton) ccButton.click();
  }

  private injectCaptionHiderStyle(): void {
    if (document.getElementById('meetvault-hide-native-cc')) return;
    const style = document.createElement('style');
    style.id = 'meetvault-hide-native-cc';
    // Visually hides Meet's bottom caption bar off-screen while keeping DOM active
    style.textContent = `
      div[aria-label*="Captions" i], [data-is-persistent="true"] {
        opacity: 0 !important;
        pointer-events: none !important;
        position: fixed !important;
        bottom: -9999px !important;
      }
    `;
    document.head.appendChild(style);
  }

  private scanCaptionRegion(): void {
    const region = document.querySelector('[aria-label*="Captions" i]');
    if (!region) return;

    const blocks = region.querySelectorAll(':scope > div');
    blocks.forEach((block) => {
      const speakerEl = block.querySelector('img')?.parentElement?.nextElementSibling
                     || block.firstElementChild;
      const speaker = speakerEl?.textContent?.trim() || 'Participant';
      const fullText = block.textContent?.replace(speaker, '').trim() || '';

      if (fullText.length > 0) {
        this.onCaptionEvent(speaker, fullText);
      }
    });
  }
}
```

### 6.3 Isolated Shadow DOM Floating HUD (`src/content/overlay.ts`)
```typescript
import { ExportFormat } from '../types';

export class FloatingHud {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private feedEl!: HTMLDivElement;

  constructor(private onExportClick: (format: ExportFormat) => void) {
    this.host = document.createElement('div');
    this.host.id = 'meetvault-hud-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.render();
    document.body.appendChild(this.host);
  }

  private render(): void {
    this.shadow.innerHTML = `
      <style>
        .hud {
          position: fixed; bottom: 80px; right: 20px; z-index: 999999;
          width: 340px; height: 420px; background: #18181b; color: #f4f4f5;
          border: 1px solid #3f3f46; border-radius: 12px;
          font-family: system-ui, -apple-system, sans-serif;
          display: flex; flex-direction: column; box-shadow: 0 12px 32px rgba(0,0,0,0.45);
          transition: height 0.2s ease;
        }
        .hud.minimized { height: 42px; overflow: hidden; }
        .header {
          padding: 10px 14px; background: #27272a; border-bottom: 1px solid #3f3f46;
          border-radius: 12px 12px 0 0; cursor: move; display: flex;
          justify-content: space-between; align-items: center; font-size: 13px; font-weight: 600;
        }
        .dot { height: 8px; width: 8px; background: #22c55e; border-radius: 50%; display: inline-block; margin-right: 6px; }
        .feed { flex: 1; overflow-y: auto; padding: 12px; font-size: 13px; line-height: 1.45; }
        .utterance { margin-bottom: 10px; }
        .meta { font-size: 11px; color: #a1a1aa; font-weight: 600; }
        .footer {
          padding: 10px; border-top: 1px solid #3f3f46; display: flex; gap: 8px;
        }
        select, button {
          background: #27272a; color: #f4f4f5; border: 1px solid #52525b;
          border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer;
        }
        button.primary { background: #2563eb; border-color: #2563eb; font-weight: 600; flex: 1; }
      </style>
      <div class="hud" id="hud-box">
        <div class="header" id="drag-handle">
          <span><span class="dot"></span>MeetVault Live</span>
          <button id="min-btn" title="Minimize/Expand">—</button>
        </div>
        <div class="feed" id="feed"></div>
        <div class="footer">
          <select id="format-select">
            <option value="docx">Word (.docx)</option>
            <option value="pdf">PDF (.pdf)</option>
            <option value="md">Markdown (.md)</option>
            <option value="txt">Plain Text (.txt)</option>
            <option value="srt">Subtitles (.srt)</option>
            <option value="vtt">WebVTT (.vtt)</option>
            <option value="csv">CSV (.csv)</option>
            <option value="json">JSON (.json)</option>
          </select>
          <button class="primary" id="export-btn">Export Offline</button>
        </div>
      </div>
    `;

    this.feedEl = this.shadow.getElementById('feed') as HTMLDivElement;
    this.setupDrag();

    this.shadow.getElementById('min-btn')?.addEventListener('click', () => {
      this.shadow.getElementById('hud-box')?.classList.toggle('minimized');
    });

    this.shadow.getElementById('export-btn')?.addEventListener('click', () => {
      const select = this.shadow.getElementById('format-select') as HTMLSelectElement;
      this.onExportClick(select.value as ExportFormat);
    });
  }

  public upsertUtterance(id: string, speaker: string, timeLabel: string, text: string): void {
    let el = this.shadow.getElementById(`utt-${id}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `utt-${id}`;
      el.className = 'utterance';
      this.feedEl.appendChild(el);
    }
    el.innerHTML = `<div class="meta">[${timeLabel}] ${speaker}</div><div>${text}</div>`;
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }

  private setupDrag(): void {
    const box = this.shadow.getElementById('hud-box') as HTMLDivElement;
    const handle = this.shadow.getElementById('drag-handle') as HTMLDivElement;
    let dragging = false, offsetX = 0, offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).id === 'min-btn') return;
      dragging = true;
      offsetX = e.clientX - box.getBoundingClientRect().left;
      offsetY = e.clientY - box.getBoundingClientRect().top;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      box.style.left = `${e.clientX - offsetX}px`;
      box.style.top = `${e.clientY - offsetY}px`;
      box.style.right = 'auto';
      box.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }
}
```

### 6.4 Multi-Format Offline Export Engine (`src/exporters/export-engine.ts`)
Uses the **Strategy Pattern** so adding any new export format requires zero changes to the UI or domain model.

```typescript
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { jsPDF } from 'jspdf';
import { MeetingSession, ExportArtifact, TranscriptExporter, ExportFormat } from '../types';

export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function formatSrtTime(ms: number): string {
  const hrs = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mins = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const secs = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const millis = String(ms % 1000).padStart(3, '0');
  return `${hrs}:${mins}:${secs},${millis}`;
}

// 1. MICROSOFT WORD (.docx) EXPORTER
export class DocxExporter implements TranscriptExporter {
  readonly format: ExportFormat = 'docx';

  async export(session: MeetingSession): Promise<ExportArtifact> {
    const children: Paragraph[] = [
      new Paragraph({ text: session.title, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new TextRun({ text: `Date: ${new Date(session.startedAt).toLocaleString()} | `, italics: true }),
          new TextRun({ text: `Participants: ${session.participants.join(', ')}`, italics: true })
        ],
        spacing: { after: 300 }
      })
    ];

    for (const u of session.utterances) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${formatMs(u.startTimeMs)}] ${u.speaker}: `, bold: true }),
            new TextRun({ text: u.cleanText })
          ],
          spacing: { after: 140 }
        })
      );
    }

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    return {
      filename: `${session.meetCode}-transcript.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      blob
    };
  }
}

// 2. PDF DOCUMENT (.pdf) EXPORTER
export class PdfExporter implements TranscriptExporter {
  readonly format: ExportFormat = 'pdf';

  async export(session: MeetingSession): Promise<ExportArtifact> {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const maxWidth = pdf.internal.pageSize.getWidth() - margin * 2;
    let y = 50;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(session.title, margin, y);
    y += 24;

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Date: ${new Date(session.startedAt).toLocaleString()}`, margin, y);
    y += 24;

    for (const u of session.utterances) {
      const header = `[${formatMs(u.startTimeMs)}] ${u.speaker}`;
      const lines = pdf.splitTextToSize(u.cleanText, maxWidth);

      if (y + (lines.length + 2) * 14 > pdf.internal.pageSize.getHeight() - margin) {
        pdf.addPage();
        y = 50;
      }

      pdf.setFont('helvetica', 'bold');
      pdf.text(header, margin, y);
      y += 14;

      pdf.setFont('helvetica', 'normal');
      pdf.text(lines, margin, y);
      y += lines.length * 14 + 10;
    }

    return {
      filename: `${session.meetCode}-transcript.pdf`,
      mimeType: 'application/pdf',
      blob: pdf.output('blob')
    };
  }
}

// 3. MARKDOWN, SUBTITLES (.srt/.vtt), CSV & JSON EXPORTERS
export class TextFormatExporter implements TranscriptExporter {
  constructor(readonly format: ExportFormat) {}

  async export(session: MeetingSession): Promise<ExportArtifact> {
    let content = '';
    let mimeType = 'text/plain;charset=utf-8';

    switch (this.format) {
      case 'md':
        content = `---\ntitle: "${session.title}"\ndate: ${session.startedAt}\nparticipants: [${session.participants.join(', ')}]\n---\n\n` +
          session.utterances.map(u => `**${u.speaker}** (${formatMs(u.startTimeMs)}): ${u.cleanText}`).join('\n\n');
        mimeType = 'text/markdown;charset=utf-8';
        break;

      case 'srt':
        content = session.utterances.map((u, idx) =>
          `${idx + 1}\n${formatSrtTime(u.startTimeMs)} --> ${formatSrtTime(u.endTimeMs || u.startTimeMs + 3000)}\n[${u.speaker}] ${u.cleanText}`
        ).join('\n\n');
        break;

      case 'vtt':
        content = 'WEBVTT\n\n' + session.utterances.map(u =>
          `${formatSrtTime(u.startTimeMs).replace(',', '.')} --> ${formatSrtTime(u.endTimeMs || u.startTimeMs + 3000).replace(',', '.')}\n<v ${u.speaker}>${u.cleanText}`
        ).join('\n\n');
        mimeType = 'text/vtt;charset=utf-8';
        break;

      case 'csv':
        content = 'start_ms,end_ms,speaker,text\n' + session.utterances.map(u =>
          `${u.startTimeMs},${u.endTimeMs},"${u.speaker.replace(/"/g, '""')}","${u.cleanText.replace(/"/g, '""')}"`
        ).join('\n');
        mimeType = 'text/csv;charset=utf-8';
        break;

      case 'json':
        content = JSON.stringify(session, null, 2);
        mimeType = 'application/json;charset=utf-8';
        break;

      default: // .txt
        content = session.utterances.map(u => `[${formatMs(u.startTimeMs)}] ${u.speaker}: ${u.cleanText}`).join('\n');
    }

    return {
      filename: `${session.meetCode}-transcript.${this.format}`,
      mimeType,
      blob: new Blob([content], { type: mimeType })
    };
  }
}

export class ExportOrchestrator {
  private strategies: Record<ExportFormat, TranscriptExporter> = {
    docx: new DocxExporter(),
    pdf: new PdfExporter(),
    md: new TextFormatExporter('md'),
    txt: new TextFormatExporter('txt'),
    srt: new TextFormatExporter('srt'),
    vtt: new TextFormatExporter('vtt'),
    csv: new TextFormatExporter('csv'),
    json: new TextFormatExporter('json')
  };

  async download(session: MeetingSession, format: ExportFormat): Promise<void> {
    const artifact = await this.strategies[format].export(session);
    const url = URL.createObjectURL(artifact.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
```

### 6.5 Local Storage Repository (`src/storage/session-repository.ts`)
Encapsulates `IndexedDB` persistence with version checking to prevent concurrent tab corruption.

```typescript
import { openDB, IDBPDatabase } from 'idb';
import { MeetingSession, CorrectionRule } from '../types';

export class SessionRepository {
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB('MeetVaultDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('dictionary')) {
          db.createObjectStore('dictionary', { keyPath: 'id' });
        }
      }
    });
  }

  async saveSession(session: MeetingSession): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('sessions', 'readwrite');
    const existing = await tx.store.get(session.id);

    if (existing && existing.version !== session.version) {
      throw new Error('OptimisticLockError: Session modified in another context.');
    }

    session.version += 1;
    await tx.store.put(session);
    await tx.done;
  }

  async getSession(id: string): Promise<MeetingSession | undefined> {
    const db = await this.dbPromise;
    return db.get('sessions', id);
  }

  async getAllRules(): Promise<CorrectionRule[]> {
    const db = await this.dbPromise;
    return db.getAll('dictionary');
  }

  async saveRule(rule: CorrectionRule): Promise<void> {
    const db = await this.dbPromise;
    await db.put('dictionary', rule);
  }
}
```

---

## 7. Build & Zero-Babysitting GitHub Packaging Pipeline

### 7.1 Initialize Dependencies
```bash
mkdir meetvault && cd meetvault
npm init -y
npm install docx jspdf idb
npm install -D typescript vite @types/chrome
```

### 7.2 Vite Single-Bundle Configuration (`vite.config.ts`)
Chrome Manifest V3 restricts remote CDN code execution and requires content scripts to be bundled without unresolvable dynamic chunk imports.

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content/index.ts')
      },
      output: {
        entryFileNames: '[name].js',
        inlineDynamicImports: true
      }
    }
  }
});
```

### 7.3 Packaging for GitHub Releases
1. Run `npm run build` to compile TypeScript and bundle `docx`, `jspdf`, and `idb` into `dist/content.js`.
2. Package `manifest.json` and the `dist/` folder into `meetvault-v1.0.0.zip`.
3. Upload `meetvault-v1.0.0.zip` to **GitHub Releases** so users can download, unzip, enable **Developer Mode** in `chrome://extensions`, and click **Load Unpacked** with zero build steps or server dependencies.