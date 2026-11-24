import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { jsPDF } from 'jspdf';
import { MeetingSession, ExportArtifact, TranscriptExporter, ExportFormat } from '../types';

export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

export function formatSrtTime(ms: number): string {
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
      new Paragraph({
        text: session.title || `MeetVault Transcript (${session.meetCode})`,
        heading: HeadingLevel.HEADING_1
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Date: ${new Date(session.startedAt).toLocaleString()} | `, italics: true }),
          new TextRun({ text: `Participants: ${session.participants.length > 0 ? session.participants.join(', ') : 'None detected'}`, italics: true })
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
      filename: `${session.meetCode || 'meetvault'}-transcript.docx`,
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
    pdf.text(session.title || `MeetVault Transcript (${session.meetCode})`, margin, y);
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
      filename: `${session.meetCode || 'meetvault'}-transcript.pdf`,
      mimeType: 'application/pdf',
      blob: pdf.output('blob')
    };
  }
}

// 3. TEXT-BASED EXPORTERS (MARKDOWN, SUBTITLES, CSV, JSON, TXT)
export class TextFormatExporter implements TranscriptExporter {
  constructor(readonly format: ExportFormat) {}

  async export(session: MeetingSession): Promise<ExportArtifact> {
    let content = '';
    let mimeType = 'text/plain;charset=utf-8';

    switch (this.format) {
      case 'md':
        content = `---\ntitle: "${session.title || 'MeetVault Transcript'}"\ndate: ${session.startedAt}\nmeetCode: "${session.meetCode}"\nparticipants: [${session.participants.map(p => `"${p}"`).join(', ')}]\n---\n\n` +
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
      filename: `${session.meetCode || 'meetvault'}-transcript.${this.format}`,
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
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
