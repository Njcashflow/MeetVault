import { ExportFormat, CorrectionRule } from '../types';

export interface FloatingHudCallbacks {
  onExportClick: (format: ExportFormat) => void;
  onAddCorrection?: (pattern: string, replacement: string) => void;
  onToggleCaptions?: () => void;
}

export class FloatingHud {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private feedEl!: HTMLDivElement;
  private capsuleEl!: HTMLDivElement;
  private labelEl!: HTMLSpanElement;
  private speakingTimer: number | null = null;

  constructor(private callbacks: FloatingHudCallbacks) {
    this.host = document.createElement('div');
    this.host.id = 'meetvault-hud-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.render();
    document.body.appendChild(this.host);
  }

  private render(): void {
    this.shadow.innerHTML = `
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .hud {
          position: fixed;
          bottom: 72px;
          right: 24px;
          z-index: 2147483647;
          width: 360px;
          height: 480px;
          background: #0f1117;
          color: #f4f4f5;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          display: flex;
          flex-direction: column;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(16px);
          overflow: hidden;
          transition: height 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .hud.minimized {
          height: 48px;
        }

        .header {
          padding: 12px 16px;
          background: #161922;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          cursor: move;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          font-weight: 600;
          user-select: none;
        }

        .header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #f4f4f5;
        }

        .dot {
          height: 8px;
          width: 8px;
          background: #10b981;
          border-radius: 50%;
          box-shadow: 0 0 8px #10b981;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .icon-btn {
          background: transparent;
          border: none;
          color: #a1a1aa;
          cursor: pointer;
          font-size: 14px;
          padding: 4px 8px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .icon-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
        }

        /* ==========================================
           GPU-Accelerated Aurora Plasma Bar (Zero-CPU)
           ========================================== */
        .aurora-capsule {
          position: relative;
          height: 32px;
          margin: 10px 12px 4px;
          border-radius: 999px;
          background: #090a0f;
          border: 1px solid rgba(255, 255, 255, 0.1);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .aurora-wave {
          position: absolute;
          inset: -40%;
          background: conic-gradient(
            from 0deg at 50% 50%,
            #10b981 0deg,
            #06b6d4 110deg,
            #8b5cf6 220deg,
            #ec4899 300deg,
            #10b981 360deg
          );
          filter: blur(12px);
          opacity: 0.75;
          animation: auroraSpin 6s linear infinite;
          transition: transform 0.25s ease, opacity 0.25s ease;
        }

        /* Pulses gently whenever a new word arrives in the caption stream */
        .aurora-capsule.speaking .aurora-wave {
          transform: scale(1.25);
          opacity: 0.95;
        }

        .aurora-label {
          position: relative;
          z-index: 2;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: #f4f4f5;
          text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 90%;
        }

        @keyframes auroraSpin {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.08); }
          100% { transform: rotate(360deg) scale(1); }
        }

        /* ==========================================
           Feed & Utterance Layout
           ========================================== */
        .feed {
          flex: 1;
          overflow-y: auto;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          scroll-behavior: smooth;
        }

        .feed::-webkit-scrollbar {
          width: 6px;
        }

        .feed::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 3px;
        }

        .utterance {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: background 0.15s ease;
        }

        .utterance:hover {
          background: rgba(255, 255, 255, 0.06);
        }

        .meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: #a1a1aa;
        }

        .speaker {
          font-weight: 600;
          color: #38bdf8;
        }

        .text {
          font-size: 13px;
          line-height: 1.45;
          color: #e4e4e7;
          word-break: break-word;
        }

        /* ==========================================
           Footer Controls
           ========================================== */
        .footer {
          padding: 12px;
          background: #141720;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          gap: 8px;
          align-items: center;
        }

        select {
          background: #1e222d;
          color: #f4f4f5;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
          cursor: pointer;
          outline: none;
          flex: 1;
        }

        select:focus {
          border-color: #06b6d4;
        }

        button.primary {
          background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
          color: #ffffff;
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s ease, transform 0.1s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        button.primary:hover {
          opacity: 0.92;
          transform: translateY(-1px);
        }

        button.primary:active {
          transform: translateY(0);
        }

        /* ==========================================
           Quick Dictionary Replacement Modal
           ========================================== */
        .modal {
          display: none;
          position: absolute;
          inset: 0;
          background: rgba(9, 10, 15, 0.88);
          backdrop-filter: blur(8px);
          z-index: 10;
          padding: 20px;
          flex-direction: column;
          justify-content: center;
          gap: 12px;
        }

        .modal.active {
          display: flex;
        }

        .modal-title {
          font-size: 14px;
          font-weight: 600;
          color: #f4f4f5;
        }

        .modal-input {
          background: #1c202a;
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #ffffff;
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 12px;
        }

        .modal-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 4px;
        }
      </style>

      <div class="hud" id="hud-box">
        <div class="header" id="drag-handle">
          <div class="header-title">
            <svg class="header-logo" width="18" height="18" viewBox="0 0 128 128" fill="none">
              <rect x="8" y="8" width="112" height="112" rx="28" fill="#1E2433" stroke="#10B981" stroke-width="6" />
              <path d="M64 26L94 38V62C94 81.5 81.2 98.4 64 104C46.8 98.4 34 81.5 34 62V38L64 26Z" stroke="#E4E4E7" stroke-width="5" stroke-linejoin="round" fill="rgba(16, 185, 129, 0.15)" />
              <rect x="49" y="54" width="6" height="20" rx="3" fill="#10B981" />
              <rect x="61" y="44" width="6" height="40" rx="3" fill="#06B6D4" />
              <rect x="73" y="52" width="6" height="24" rx="3" fill="#8B5CF6" />
            </svg>
            <span>MeetVault Live</span>
            <span class="dot"></span>
          </div>
          <div class="header-actions">
            <button class="icon-btn" id="dict-btn" title="Add Correction Rule">✎</button>
            <button class="icon-btn" id="min-btn" title="Minimize / Expand">—</button>
          </div>
        </div>

        <!-- GPU-Accelerated Aurora Plasma Bar -->
        <div class="aurora-capsule" id="aurora-capsule">
          <div class="aurora-wave"></div>
          <span class="aurora-label" id="aurora-label">● LISTENING</span>
        </div>

        <div class="feed" id="feed"></div>

        <div class="footer">
          <select id="format-select">
            <option value="docx">Word Document (.docx)</option>
            <option value="pdf">PDF Document (.pdf)</option>
            <option value="md">Markdown (.md)</option>
            <option value="txt">Plain Text (.txt)</option>
            <option value="srt">Subtitles (.srt)</option>
            <option value="vtt">WebVTT (.vtt)</option>
            <option value="csv">CSV Spreadsheet (.csv)</option>
            <option value="json">Raw Session (.json)</option>
          </select>
          <button class="primary" id="export-btn">Export Offline</button>
        </div>

        <!-- Inline Correction Rule Modal -->
        <div class="modal" id="dict-modal">
          <div class="modal-title">Add Live Word Replacement</div>
          <input class="modal-input" id="misheard-input" placeholder="Misheard phrase (e.g. kopa belt)" />
          <input class="modal-input" id="replace-input" placeholder="Replace with (e.g. Copperbelt)" />
          <div class="modal-actions">
            <button class="icon-btn" id="modal-cancel">Cancel</button>
            <button class="primary" id="modal-save">Save Rule</button>
          </div>
        </div>
      </div>
    `;

    this.feedEl = this.shadow.getElementById('feed') as HTMLDivElement;
    this.capsuleEl = this.shadow.getElementById('aurora-capsule') as HTMLDivElement;
    this.labelEl = this.shadow.getElementById('aurora-label') as HTMLSpanElement;

    this.setupDrag();
    this.setupEvents();
  }

  public setCaptionStatus(enabled: boolean): void {
    if (!enabled && !this.speakingTimer) {
      this.labelEl.textContent = '● CLICK TO ENABLE CC IN MEET';
    } else if (enabled && !this.speakingTimer) {
      this.labelEl.textContent = '● LISTENING';
    }
  }

  public setSpeaking(isSpeaking: boolean, speaker?: string): void {
    if (isSpeaking) {
      this.capsuleEl.classList.add('speaking');
      this.labelEl.textContent = speaker ? `● SPEAKING: ${speaker}` : '● TRANSCRIBING LIVE';

      if (this.speakingTimer) {
        window.clearTimeout(this.speakingTimer);
      }
      this.speakingTimer = window.setTimeout(() => {
        this.capsuleEl.classList.remove('speaking');
        this.labelEl.textContent = '● LISTENING';
        this.speakingTimer = null;
      }, 1500);
    } else {
      this.capsuleEl.classList.remove('speaking');
      this.labelEl.textContent = '● LISTENING';
    }
  }

  public upsertUtterance(id: string, speaker: string, timeLabel: string, text: string): void {
    let el = this.shadow.getElementById(`utt-${id}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `utt-${id}`;
      el.className = 'utterance';
      this.feedEl.appendChild(el);
    }
    el.innerHTML = `
      <div class="meta">
        <span class="speaker">${speaker}</span>
        <span>[${timeLabel}]</span>
      </div>
      <div class="text">${text}</div>
    `;
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
    this.setSpeaking(true, speaker);
  }

  private setupEvents(): void {
    // Capsule click toggles CC
    this.capsuleEl.style.cursor = 'pointer';
    this.capsuleEl.title = 'Click to toggle Google Meet Closed Captions';
    this.capsuleEl.addEventListener('click', () => {
      this.callbacks.onToggleCaptions?.();
    });

    // Minimize toggle
    const minBtn = this.shadow.getElementById('min-btn');
    const hudBox = this.shadow.getElementById('hud-box');
    minBtn?.addEventListener('click', () => {
      hudBox?.classList.toggle('minimized');
      if (minBtn) {
        minBtn.textContent = hudBox?.classList.contains('minimized') ? '□' : '—';
      }
    });

    // Export button
    const exportBtn = this.shadow.getElementById('export-btn');
    const select = this.shadow.getElementById('format-select') as HTMLSelectElement;
    exportBtn?.addEventListener('click', () => {
      this.callbacks.onExportClick(select.value as ExportFormat);
    });

    // Dictionary modal controls
    const dictBtn = this.shadow.getElementById('dict-btn');
    const dictModal = this.shadow.getElementById('dict-modal');
    const cancelBtn = this.shadow.getElementById('modal-cancel');
    const saveBtn = this.shadow.getElementById('modal-save');
    const misheardInp = this.shadow.getElementById('misheard-input') as HTMLInputElement;
    const replaceInp = this.shadow.getElementById('replace-input') as HTMLInputElement;

    dictBtn?.addEventListener('click', () => {
      dictModal?.classList.add('active');
      misheardInp.focus();
    });

    cancelBtn?.addEventListener('click', () => {
      dictModal?.classList.remove('active');
    });

    saveBtn?.addEventListener('click', () => {
      const pattern = misheardInp.value.trim();
      const replacement = replaceInp.value.trim();
      if (pattern && replacement && this.callbacks.onAddCorrection) {
        this.callbacks.onAddCorrection(pattern, replacement);
        misheardInp.value = '';
        replaceInp.value = '';
        dictModal?.classList.remove('active');
      }
    });
  }

  private setupDrag(): void {
    const box = this.shadow.getElementById('hud-box') as HTMLDivElement;
    const handle = this.shadow.getElementById('drag-handle') as HTMLDivElement;
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.header-actions')) return;
      dragging = true;
      offsetX = e.clientX - box.getBoundingClientRect().left;
      offsetY = e.clientY - box.getBoundingClientRect().top;
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = Math.max(10, Math.min(window.innerWidth - box.offsetWidth - 10, e.clientX - offsetX));
      const y = Math.max(10, Math.min(window.innerHeight - box.offsetHeight - 10, e.clientY - offsetY));
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.right = 'auto';
      box.style.bottom = 'auto';
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }
}
