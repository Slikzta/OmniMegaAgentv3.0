/**
 * Echo transcript filter for Live voice sessions.
 *
 * Keeps a rolling ~15-second window of what Sierra/Tyler recently spoke so
 * residual TTS speaker audio picked up by the microphone and transcribed by
 * Whisper is dropped before being committed as a user turn or stored in memory.
 */

export interface SpokenSegment {
  text: string;
  normalizedText: string;
  tokens: string[];
  spokenAtMs: number;
}

export const ECHO_WINDOW_MS = 15_000;
export const ECHO_OVERLAP_THRESHOLD = 0.6;
export const ECHO_SHORT_UTTERANCE_MAX_WORDS = 3;
export const ECHO_POST_PLAYBACK_WINDOW_MS = 2_500;

/**
 * Normalizes text for resilient substring and token comparison across
 * punctuation / capitalization variations produced by Whisper vs TTS chunks.
 */
export function normalizeEchoText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeEchoText(text: string): string[] {
  const norm = normalizeEchoText(text);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

/**
 * Prunes spoken segments older than `windowMs` relative to `nowMs`.
 */
export function pruneSpokenSegments(
  segments: SpokenSegment[],
  nowMs: number = Date.now(),
  windowMs: number = ECHO_WINDOW_MS,
): SpokenSegment[] {
  return segments.filter((seg) => nowMs - seg.spokenAtMs <= windowMs && seg.normalizedText.length > 0);
}

/**
 * Appends a newly spoken TTS sentence/chunk to the rolling buffer and prunes expired segments.
 */
export function recordSpokenSegment(
  segments: SpokenSegment[],
  text: string,
  nowMs: number = Date.now(),
  windowMs: number = ECHO_WINDOW_MS,
): SpokenSegment[] {
  const normalizedText = normalizeEchoText(text);
  const pruned = pruneSpokenSegments(segments, nowMs, windowMs);
  if (!normalizedText) return pruned;
  const tokens = normalizedText.split(' ').filter(Boolean);
  return [
    ...pruned,
    {
      text: text.trim(),
      normalizedText,
      tokens,
      spokenAtMs: nowMs,
    },
  ];
}

/**
 * Computes what fraction of the transcript's tokens appear in the recently spoken
 * TTS token pool (with light multiset support so repeated filler words don't skew).
 */
export function computeTokenOverlapRatio(transcriptTokens: string[], spokenTokens: string[]): number {
  if (transcriptTokens.length === 0 || spokenTokens.length === 0) return 0;
  const spokenSet = new Set(spokenTokens);
  let matched = 0;
  for (const tok of transcriptTokens) {
    if (spokenSet.has(tok)) {
      matched++;
    }
  }
  return matched / transcriptTokens.length;
}

export interface EchoCheckInput {
  transcript: string;
  recentSegments: SpokenSegment[];
  isSpeaking: boolean;
  lastPlaybackEndedAtMs: number;
  nowMs?: number;
  windowMs?: number;
  postPlaybackWindowMs?: number;
  overlapThreshold?: number;
}

export interface EchoCheckResult {
  drop: boolean;
  reason: 'none' | 'substring' | 'token_overlap' | 'short_post_speech';
  overlapRatio: number;
  wordCount: number;
  normalizedTranscript: string;
}

/**
 * Evaluates whether a committed Whisper transcript is likely an acoustic echo
 * of Sierra's/Tyler's own recent TTS output.
 */
export function shouldDropEchoTranscript(input: EchoCheckInput): EchoCheckResult {
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = input.windowMs ?? ECHO_WINDOW_MS;
  const postPlaybackWindowMs = input.postPlaybackWindowMs ?? ECHO_POST_PLAYBACK_WINDOW_MS;
  const overlapThreshold = input.overlapThreshold ?? ECHO_OVERLAP_THRESHOLD;

  const normalizedTranscript = normalizeEchoText(input.transcript);
  const transcriptTokens = normalizedTranscript ? normalizedTranscript.split(' ').filter(Boolean) : [];
  const wordCount = transcriptTokens.length;

  if (!normalizedTranscript || wordCount === 0) {
    return {
      drop: false,
      reason: 'none',
      overlapRatio: 0,
      wordCount: 0,
      normalizedTranscript: '',
    };
  }

  const activeSegments = pruneSpokenSegments(input.recentSegments, nowMs, windowMs);
  const combinedSpokenText = activeSegments.map((s) => s.normalizedText).join(' ').trim();
  const combinedSpokenTokens = activeSegments.flatMap((s) => s.tokens);

  // Rule 1: Substring of Sierra's spoken text in the last ~15 seconds.
  // Require at least 2 chars so single-letter noise isn't matched accidentally against spaces.
  if (combinedSpokenText.length > 0 && normalizedTranscript.length >= 2) {
    const paddedSpoken = ` ${combinedSpokenText} `;
    const paddedTranscript = ` ${normalizedTranscript} `;
    if (
      paddedSpoken.includes(paddedTranscript) ||
      (normalizedTranscript.length >= 4 && combinedSpokenText.includes(normalizedTranscript))
    ) {
      return {
        drop: true,
        reason: 'substring',
        overlapRatio: 1,
        wordCount,
        normalizedTranscript,
      };
    }
  }

  // Rule 2: >= 60% token overlap with Sierra's spoken text in the last ~15 seconds.
  const overlapRatio = computeTokenOverlapRatio(transcriptTokens, combinedSpokenTokens);
  if (combinedSpokenTokens.length > 0 && overlapRatio >= overlapThreshold) {
    return {
      drop: true,
      reason: 'token_overlap',
      overlapRatio,
      wordCount,
      normalizedTranscript,
    };
  }

  // Rule 3: <= 3 words captured while or just after Sierra spoke.
  const sincePlaybackEndMs =
    input.lastPlaybackEndedAtMs > 0 ? Math.max(0, nowMs - input.lastPlaybackEndedAtMs) : Number.POSITIVE_INFINITY;
  const capturedDuringOrRightAfterSpeech =
    input.isSpeaking || (sincePlaybackEndMs <= postPlaybackWindowMs && activeSegments.length > 0);

  if (capturedDuringOrRightAfterSpeech && wordCount <= ECHO_SHORT_UTTERANCE_MAX_WORDS && activeSegments.length > 0) {
    return {
      drop: true,
      reason: 'short_post_speech',
      overlapRatio,
      wordCount,
      normalizedTranscript,
    };
  }

  return {
    drop: false,
    reason: 'none',
    overlapRatio,
    wordCount,
    normalizedTranscript,
  };
}
