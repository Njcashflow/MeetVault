/**
 * Precision Ingestion Adapter for Google Meet Live Captions.
 * Captures clean participant speech while filtering out UI noise, language lists, and system notifications.
 */

// Known Google Meet UI phrases to filter out
const UI_NOISE_PATTERNS = [
  /^closed_caption/i,
  /^turn (on|off) captions/i,
  /^translate speech/i,
  /^speech translation/i,
  /^jump to bottom/i,
  /^arrow_downward/i,
  /^font size/i,
  /^font color/i,
  /^caption settings/i,
  /^open caption settings/i,
  /format_size/i,
  /circleFont/i
];

function isUiNoise(text: string): boolean {
  if (!text || text.length < 2) return true;
  // If the text contains multiple language names, it's the settings language list
  if (text.includes('Afrikaans') && text.includes('Albanian')) return true;
  if (text.includes('format_size') || text.includes('circleFont') || text.includes('arrow_downward')) return true;
  // Reject single Material icon tokens
  if (/^(circle|settings|help|close|done|check|arrow_\w+|expand_\w+|closed_caption_\w+)$/i.test(text)) return true;
  return UI_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

export class MeetDomAdapter {
  private observer: MutationObserver | null = null;
  private pollInterval: number | null = null;
  private ccCheckInterval: number | null = null;
  private onCaptionEvent: (speaker: string, text: string) => void;
  private onStatusChange?: (captionsEnabled: boolean) => void;

  // WeakMap to track last seen text per caption DOM block to prevent duplicate processing
  private blockTextMap = new WeakMap<HTMLElement, string>();
  private scanScheduled = false;

  constructor(
    onCaptionEvent: (speaker: string, text: string) => void,
    onStatusChange?: (captionsEnabled: boolean) => void
  ) {
    this.onCaptionEvent = onCaptionEvent;
    this.onStatusChange = onStatusChange;
  }

  public start(): void {
    // 1. Initial check for captions
    const enabled = this.ensureCaptionsEnabled();

    // 2. High-frequency check (every 700ms) on join until captions are confirmed on, then backs off
    this.ccCheckInterval = window.setInterval(() => {
      const isNowOn = this.ensureCaptionsEnabled();
      if (isNowOn && this.ccCheckInterval) {
        // Once enabled, slow down check to once every 10 seconds
        window.clearInterval(this.ccCheckInterval);
        this.ccCheckInterval = window.setInterval(() => {
          this.ensureCaptionsEnabled();
        }, 10000);
      }
    }, 700);

    // 3. Relaxed fallback poll (every 1000ms) to ensure captions aren't missed
    this.pollInterval = window.setInterval(() => {
      this.scanForCaptions();
    }, 1000);

    // 4. MutationObserver throttled with requestAnimationFrame for smooth zero-lag capture
    this.observer = new MutationObserver(() => {
      if (!this.scanScheduled) {
        this.scanScheduled = true;
        window.requestAnimationFrame(() => {
          this.scanScheduled = false;
          this.scanForCaptions();
        });
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.pollInterval) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.ccCheckInterval) {
      window.clearInterval(this.ccCheckInterval);
      this.ccCheckInterval = null;
    }
  }

  /**
   * Checks if the user is currently inside the active call room.
   */
  public isInCallRoom(): boolean {
    return !!document.querySelector(
      'button[aria-label*="Leave call" i], button[data-tooltip*="Leave call" i], button[aria-label*="Leave meeting" i], [jsname="CQylAd"]'
    );
  }

  /**
   * Detects and enables Google Meet's native closed captions if currently disabled.
   */
  public ensureCaptionsEnabled(): boolean {
    // Check if captions are already active
    const turnOffBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="Turn off captions" i], button[aria-label*="captions" i][aria-pressed="true"], button[data-tooltip*="Turn off captions" i], button[aria-label*="Désactiver les sous-titres" i]'
    );

    if (turnOffBtn) {
      this.onStatusChange?.(true);
      return true;
    }

    // Look for explicit "Turn on captions" button
    const turnOnBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="Turn on captions" i], button[aria-label*="captions" i][aria-pressed="false"], button[data-tooltip*="Turn on captions" i], button[aria-label*="Activer les sous-titres" i], button[jsname="r8qRAd"]'
    );

    if (turnOnBtn) {
      turnOnBtn.click();
      this.onStatusChange?.(true);
      return true;
    }

    // Fallback: If inside active call room and captions are not detected, trigger shortcut 'c'
    if (this.isInCallRoom()) {
      this.toggleCaptions();
    }

    return false;
  }

  /**
   * Toggles closed captions by clicking the CC button or dispatching keyboard shortcut.
   */
  public toggleCaptions(): void {
    const ccBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="captions" i], button[data-tooltip*="captions" i]'
    );
    if (ccBtn) {
      ccBtn.click();
    } else {
      const keyEvent = new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        keyCode: 67,
        which: 67,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(keyEvent);
      window.dispatchEvent(keyEvent);
    }
  }

  /**
   * Scans Google Meet's DOM for real spoken captions, ignoring UI controls and system dialogs.
   */
  public scanForCaptions(): void {
    // ── Strategy A: Standard Google Meet Caption Speaker Blocks ───────────────
    // Matches individual speaker turn blocks: .nMcdL, .bj4p3b, [jsname="dsTEOb"]
    const captionBlocks = document.querySelectorAll<HTMLElement>(
      '.nMcdL, .bj4p3b, [jsname="dsTEOb"]'
    );

    if (captionBlocks.length > 0) {
      let foundAny = false;
      captionBlocks.forEach((block) => {
        // Skip if inside settings dialog, menus, or buttons
        if (block.closest('button, [role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')) {
          return;
        }

        // Find speaker node
        const speakerEl = block.querySelector<HTMLElement>(
          '.NWpY1d, .xoMHSc, [data-sender-name], span.zs75Ib, .poGX8, .jT287b, .adEAEc'
        );
        let speaker = speakerEl?.textContent?.trim() || '';

        // If no explicit speaker element, look for avatar neighbor
        if (!speaker) {
          const avatar = block.querySelector('img');
          const next = avatar?.parentElement?.nextElementSibling || avatar?.nextElementSibling;
          speaker = next?.textContent?.trim() || '';
        }

        // Find speech text nodes strictly (NO general span!)
        const textElements = block.querySelectorAll<HTMLElement>(
          '.VbkSUe, .ygicle, [jsname="YSxPC"], .bh44bd, .Jn28md'
        );

        let fullText = '';
        if (textElements.length > 0) {
          const parts: string[] = [];
          textElements.forEach((el) => {
            const t = el.textContent?.trim();
            if (t && t !== speaker && !parts.includes(t)) {
              parts.push(t);
            }
          });
          fullText = parts.join(' ').trim();
        }

        fullText = fullText.replace(/\s+/g, ' ').trim();

        // Reject empty or UI noise text
        if (!fullText || isUiNoise(fullText)) {
          return;
        }

        const prev = this.blockTextMap.get(block);
        if (prev !== fullText) {
          this.blockTextMap.set(block, fullText);
          foundAny = true;
          const finalSpeaker = speaker || 'Speaker';
          this.onCaptionEvent(finalSpeaker, fullText);
        }
      });

      if (foundAny) return;
    }

    // ── Strategy B: Direct Spoken Caption Nodes ──────────────────────────────
    const textSpans = document.querySelectorAll<HTMLElement>(
      '.VbkSUe, .ygicle, [jsname="YSxPC"], .bh44bd, .Jn28md'
    );

    if (textSpans.length > 0) {
      textSpans.forEach((span) => {
        // Exclude UI controls
        if (span.closest('button, [role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')) {
          return;
        }

        const text = span.textContent?.replace(/\s+/g, ' ').trim();
        if (!text || isUiNoise(text)) return;

        const parentBlock = (span.closest('.nMcdL, .bj4p3b, [jsname="dsTEOb"]') || span.parentElement) as HTMLElement | null;
        if (parentBlock) {
          const prev = this.blockTextMap.get(parentBlock);
          if (prev === text) return;
          this.blockTextMap.set(parentBlock, text);

          const speakerEl = parentBlock.querySelector<HTMLElement>(
            '.NWpY1d, .xoMHSc, [data-sender-name], span.zs75Ib, .poGX8, .jT287b'
          );
          const speaker = speakerEl?.textContent?.trim() || 'Speaker';

          this.onCaptionEvent(speaker, text);
        }
      });
    }
  }
}
