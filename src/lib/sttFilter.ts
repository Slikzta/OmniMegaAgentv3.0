import { addDebugLog } from './debugLogStore';
import { isTranscriptGarbledOrForeign } from './languageGuard';

export const STT_MIN_RMS_ENERGY = 0.015;
export const STT_MIN_DURATION_MS = 400;
export const STT_PHANTOM_MAX_RMS = 0.03;
export const STT_PHANTOM_MAX_DURATION_MS = 1200;

export const STT_PHANTOM_BLOCKLIST = new Set<string>([
  'thank you',
  'thanks for watching',
  'you',
  'bye',
  'okay',
  'here',
]);

export type MicSourceSetting = 'auto' | 'communication' | 'recognition';
export type WhisperModelId = 'small.en' | 'base.en' | 'tiny.en';

export interface DebugUtteranceEntry {
  id: string;
  timestamp: number;
  transcript: string;
  rawTranscript?: string;
  rms: number;
  durationMs: number;
  whisperMs?: number;
  gainApplied?: number;
  droppedReason?: string;
}

export interface SttFilterInput {
  transcript: string;
  rms?: number;
  durationMs?: number;
  whisperMs?: number;
  languageCode?: string;
}

export interface SttFilterResult {
  accept: boolean;
  reason?: string;
  logStage?: 'STT:DroppedLowEnergy' | 'STT:DroppedPhantom' | 'STT:DroppedShort' | 'STT:DroppedLanguageGuard';
  normalizedPhrase?: string;
}

export function normalizePhantomPhrase(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function evaluateSttUtterance(input: SttFilterInput): SttFilterResult {
  const transcript = (input.transcript || '').trim();
  const durationMs = typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) ? input.durationMs : undefined;
  const rms = typeof input.rms === 'number' && Number.isFinite(input.rms) ? input.rms : undefined;

  if (!transcript) {
    return {
      accept: false,
      reason: 'empty_transcript',
      logStage: 'STT:DroppedShort',
    };
  }

  // Drop utterances under 400ms
  if (durationMs !== undefined && durationMs > 0 && durationMs < STT_MIN_DURATION_MS) {
    return {
      accept: false,
      reason: `duration ${durationMs}ms < ${STT_MIN_DURATION_MS}ms`,
      logStage: 'STT:DroppedShort',
    };
  }

  // a) Minimum-energy gate: drop utterances with RMS < 0.015 before LLM call
  if (rms !== undefined && rms < STT_MIN_RMS_ENERGY) {
    return {
      accept: false,
      reason: `rms ${rms.toFixed(4)} < ${STT_MIN_RMS_ENERGY}`,
      logStage: 'STT:DroppedLowEnergy',
    };
  }

  // b) Phantom blocklist (case-insensitive, punctuation-stripped):
  // Drop ONLY if it matches AND (rms < 0.03 OR duration < 1.2s)
  const normalized = normalizePhantomPhrase(transcript);
  if (STT_PHANTOM_BLOCKLIST.has(normalized)) {
    const lowEnergy = rms !== undefined && rms < STT_PHANTOM_MAX_RMS;
    const shortDuration = durationMs !== undefined && durationMs > 0 && durationMs < STT_PHANTOM_MAX_DURATION_MS;
    if (lowEnergy || shortDuration) {
      return {
        accept: false,
        reason: `phantom phrase "${normalized}" (rms=${rms !== undefined ? rms.toFixed(4) : 'n/a'}, duration=${durationMs ?? 'n/a'}ms)`,
        logStage: 'STT:DroppedPhantom',
        normalizedPhrase: normalized,
      };
    }
  }

  // Run languageGuard after low-energy, duration, and phantom filters
  const langResult = isTranscriptGarbledOrForeign(transcript, input.languageCode || 'en-US');
  if (langResult.isGarbledOrForeign) {
    return {
      accept: false,
      reason: langResult.reason || 'garbled_or_foreign',
      logStage: 'STT:DroppedLanguageGuard',
    };
  }

  return { accept: true };
}

export function logDroppedSttUtterance(res: SttFilterResult, input: SttFilterInput): void {
  if (res.accept || !res.logStage) return;
  const rmsStr = typeof input.rms === 'number' && Number.isFinite(input.rms) ? input.rms.toFixed(4) : 'n/a';
  const durStr = typeof input.durationMs === 'number' ? `${input.durationMs}ms` : 'n/a';
  const whisperStr = typeof input.whisperMs === 'number' ? `${input.whisperMs}ms` : 'n/a';
  addDebugLog(
    res.logStage,
    `Dropped transcript (${res.reason || res.logStage}) | rms=${rmsStr}, audioMs=${durStr}, whisperMs=${whisperStr}, text="${input.transcript}"`,
  );
}

/**
 * Recommends Whisper model based on device capabilities:
 * - small.en Q5_1 (~181 MB) on devices with >= 8 CPU cores and >= 12 GB RAM
 * - base.en on smaller devices
 */
export function getRecommendedWhisperModel(cpuCores?: number, totalRamMb?: number): WhisperModelId {
  const cores = typeof cpuCores === 'number' && cpuCores > 0
    ? cpuCores
    : (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0);
  const ramMb = typeof totalRamMb === 'number' && totalRamMb > 0 ? totalRamMb : 0;
  // 12 GB physical RAM typically reports ~11,400–12,288 MB via Android ActivityManager.MemoryInfo
  if (cores >= 8 && ramMb >= 11264) {
    return 'small.en';
  }
  return 'base.en';
}
