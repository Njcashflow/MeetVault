import { TranscriptUtterance } from '../types';

/**
 * Computes case-insensitive prefix similarity ratio between two strings.
 */
export function computePrefixOverlapRatio(prev: string, next: string): number {
  if (!prev || !next) return 0;
  const minLen = Math.min(prev.length, next.length);
  let matched = 0;
  while (matched < minLen && prev[matched].toLowerCase() === next[matched].toLowerCase()) {
    matched++;
  }
  return matched / prev.length;
}

/**
 * Merges streaming incoming caption chunks using a sliding window algorithm.
 * Prevents duplicates when Google Meet updates partial sentences in-place.
 */
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
    // If incoming text extends previous text or shares >= 30% prefix overlap
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
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `utt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
