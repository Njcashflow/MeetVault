import { MeetingSession, CorrectionRule, ExportFormat } from '../types';
import { mergeIncomingCaption } from '../domain/merger';
import { buildNormalizer } from '../domain/normalizer';
import { SessionRepository } from '../storage/session-repository';
import { ExportOrchestrator, formatMs } from '../exporters/export-engine';
import { MeetDomAdapter } from './dom-observer';
import { FloatingHud } from './overlay';

class MeetVaultApp {
  private session: MeetingSession;
  private repository: SessionRepository;
  private exporter: ExportOrchestrator;
  private hud: FloatingHud;
  private adapter: MeetDomAdapter;
  private normalizer: (text: string) => string = (t) => t;
  private rules: CorrectionRule[] = [];
  private saveDebounceTimer: number | null = null;
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
    const meetCode = this.extractMeetCode();

    this.session = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `meet-${Date.now()}`,
      meetCode,
      title: document.title || `Google Meet Session (${meetCode})`,
      startedAt: new Date(this.startTime).toISOString(),
      engineMode: 'ECO_DOM',
      participants: [],
      utterances: [],
      version: 0
    };

    this.repository = new SessionRepository();
    this.exporter = new ExportOrchestrator();

    this.hud = new FloatingHud({
      onExportClick: (format: ExportFormat) => this.handleExport(format),
      onAddCorrection: (pattern: string, replacement: string) => this.handleAddCorrection(pattern, replacement),
      onToggleCaptions: () => this.adapter.toggleCaptions()
    });

    this.adapter = new MeetDomAdapter(
      (speaker, text) => {
        this.handleIncomingCaption(speaker, text);
      },
      (captionsEnabled: boolean) => {
        this.hud.setCaptionStatus(captionsEnabled);
      }
    );

    this.init();
  }

  private async init(): Promise<void> {
    try {
      this.rules = await this.repository.getAllRules();
      this.normalizer = buildNormalizer(this.rules);
    } catch (err) {
      console.warn('[MeetVault] Failed to load dictionary rules from storage:', err);
    }

    // Start listening to Meet's DOM caption events
    this.adapter.start();
    console.log('[MeetVault] Engine activated successfully for meet:', this.session.meetCode);

    // Initial CC detection after delay (Meet needs time to load call UI)
    window.setTimeout(() => {
      const enabled = this.adapter.ensureCaptionsEnabled();
      this.hud.setCaptionStatus(enabled);
    }, 2000);
  }

  private extractMeetCode(): string {
    const match = window.location.pathname.match(/\/([a-z0-9]{3,4}-[a-z0-9]{3,4}-[a-z0-9]{3,4})/i);
    return match ? match[1] : 'google-meet-session';
  }

  private handleIncomingCaption(speaker: string, rawText: string): void {
    let elapsedMs = Date.now() - this.startTime;

    // Calibrate start time if user waited in pre-join green room before entering the meeting
    if (this.session.utterances.length === 0 && elapsedMs > 25000) {
      this.startTime = Date.now() - 2000;
      elapsedMs = 2000;
      this.session.startedAt = new Date(this.startTime).toISOString();
    }

    // Track participants
    if (speaker && !this.session.participants.includes(speaker)) {
      this.session.participants.push(speaker);
    }

    const { updatedList, activeUtterance } = mergeIncomingCaption(
      this.session.utterances,
      speaker,
      rawText,
      elapsedMs,
      this.normalizer
    );

    this.session.utterances = updatedList;

    // Update Floating HUD
    this.hud.upsertUtterance(
      activeUtterance.id,
      activeUtterance.speaker,
      formatMs(activeUtterance.startTimeMs),
      activeUtterance.cleanText
    );

    this.scheduleSave();
  }

  private async handleAddCorrection(pattern: string, replacement: string): Promise<void> {
    const newRule: CorrectionRule = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rule-${Date.now()}`,
      pattern,
      replacement,
      isRegex: false,
      caseSensitive: false,
      createdAt: new Date().toISOString()
    };

    this.rules.push(newRule);
    this.normalizer = buildNormalizer(this.rules);

    try {
      await this.repository.saveRule(newRule);
    } catch (err) {
      console.error('[MeetVault] Failed to save correction rule:', err);
    }

    // Retroactively update cleanText for existing utterances
    this.session.utterances = this.session.utterances.map((u) => ({
      ...u,
      cleanText: this.normalizer(u.rawText)
    }));

    // Refresh active utterances in HUD
    this.session.utterances.forEach((u) => {
      this.hud.upsertUtterance(u.id, u.speaker, formatMs(u.startTimeMs), u.cleanText);
    });

    this.scheduleSave();
  }

  private async handleExport(format: ExportFormat): Promise<void> {
    try {
      this.session.endedAt = new Date().toISOString();
      await this.exporter.download(this.session, format);
    } catch (err) {
      console.error('[MeetVault] Export error:', err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private scheduleSave(): void {
    if (this.saveDebounceTimer) {
      window.clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = window.setTimeout(async () => {
      try {
        await this.repository.saveSession(this.session);
      } catch (err) {
        console.warn('[MeetVault] Auto-save skipped:', err);
      }
    }, 2000);
  }
}

// Bootstrap content script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new MeetVaultApp());
} else {
  new MeetVaultApp();
}
