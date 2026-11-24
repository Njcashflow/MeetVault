# MeetVault

> **Zero-Paywall, Privacy-First, Offline Meeting Transcriber for Google Meet**

MeetVault is a lightweight, 100% client-side Chrome extension (Manifest V3) that captures live Google Meet captions, cleans and organizes them in real time, and exports comprehensive transcripts into Word (.docx), PDF, Markdown, Plain Text, Subtitles (.srt, .vtt), CSV, and JSON — without external cloud dependencies, subscription fees, or paywalls.

---

## Key Highlights

- **100% Offline & Private**: Zero cloud backend, zero third-party APIs. Meeting audio and speech data never leave your browser.
- **Bypass Feature Paywalls**: Free transcription and export directly from Google Meet's native live closed-caption feed.
- **GPU-Accelerated Floating HUD**: Sleek dark UI with live speaker indication, draggable window, and real-time caption preview.
- **Multi-Format Local Export**:
  - Microsoft Word (`.docx`)
  - PDF Document (`.pdf`)
  - Markdown (`.md`)
  - SubRip Subtitles (`.srt`)
  - WebVTT Subtitles (`.vtt`)
  - Tabular Spreadsheet (`.csv`)
  - Raw JSON (`.json`)
  - Plain Text (`.txt`)
- **Fast Startup & Calibration**: Automatically enables closed captions upon entering the call room and aligns timestamps accurately.
- **Intelligent DOM Filtering**: Discards Google Meet UI controls, Material icon labels (`circle`, `arrow_downward`), and settings menus from the captured transcript.

---

## Installation (Unpacked Extension)

1. Clone or download this repository to your local computer:
   ```bash
   git clone https://github.com/your-username/MeetVault.git
   cd MeetVault
   ```
2. Install project dependencies and compile the extension bundles:
   ```bash
   npm install
   npm run build
   ```
3. Open Google Chrome and navigate to:
   ```
   chrome://extensions
   ```
4. Enable **Developer mode** via the toggle switch in the top right corner.
5. Click **Load unpacked** in the top left and select the root directory of this project (`MeetVault`).
6. Navigate to [meet.google.com](https://meet.google.com) and start or join any call. The MeetVault HUD will automatically appear.

---

## Project Structure

```
MeetVault/
├── dist/                 # Production IIFE bundles (content.js, background.js)
├── icons/                # Extension icon assets (16x16, 32x32, 48x48, 128x128)
├── src/
│   ├── content/          # Content script, DOM observer & floating HUD
│   │   ├── dom-observer.ts  # Precision Meet caption scraping & filtering
│   │   ├── overlay.ts       # HUD UI and styles
│   │   └── index.ts         # Main content orchestrator
│   ├── domain/           # Caption deduplication, merger & normalizer
│   ├── exporters/        # Word, PDF, Markdown, SRT, VTT, CSV exporters
│   ├── storage/          # Local storage repository for sessions & rules
│   └── types/            # TypeScript interfaces
├── manifest.json         # Chrome Manifest V3 configuration
├── popup.html            # Extension action popup
├── popup.js              # Popup script
├── vite.config.ts        # Vite multi-entry build configuration
└── package.json
```

---

## Development & Building

- **Run Dev Build**:
  ```bash
  npm run build
  ```
- **Build Content Script Only**:
  ```bash
  npm run build:content
  ```
- **Build Background Worker Only**:
  ```bash
  npm run build:background
  ```
- **Type Checking & Tests**:
  ```bash
  npm run test
  ```

---

## How It Works

1. **DOM Observer (`dom-observer.ts`)**:
   Monitors Google Meet's caption container using `MutationObserver` throttled via `requestAnimationFrame`. When speakers talk, the raw text turns are extracted.
2. **Utterance Merging (`merger.ts`)**:
   Detects whether an incoming caption chunk belongs to the current speaker (streaming continuation) or a new speaker turn, stitching sentence fragments without duplication.
3. **Dictionary Normalization (`normalizer.ts`)**:
   Runs custom word replacement rules on the fly before saving utterances to IndexedDB/Chrome storage.
4. **Client-Side Export Engine (`export-engine.ts`)**:
   Builds self-contained binary documents (.docx via `docx`, .pdf via `jspdf`, .md, .srt) directly in-memory and triggers a local download.

---

## License & Terms of Use

MeetVault is free and open-source software provided strictly for **personal, educational, and non-commercial use**. 

- You are welcome to view, modify, and run this extension for your own private meetings.
- Commercial redistribution, resale, paid subscription services, or incorporation into closed-source commercial products is strictly prohibited.
- See the [LICENSE](LICENSE) file for full non-commercial terms.
