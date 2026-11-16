import { Capacitor, registerPlugin } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import {
  buildSierraSystemInstruction,
  IDENTITIES,
  UNIFIED_PERSONAS,
  getConversationSummaries,
  isMemoryInjectionEnabled,
  setMemoryInjectionEnabled,
  getVoiceCapabilitiesState,
  MAX_INJECTED_MEMORY_SUMMARIES,
  MAX_INJECTED_MEMORY_CHARS,
  type CompanionIdentity,
  type PersonaId,
  type ContentMode,
} from './persona';
import { addDebugLog } from './debugLogStore';
import { getSettings, updateSettings, type BargeInModeSetting } from './settingsStore';
import { getRecommendedWhisperModel, type MicSourceSetting, type DebugUtteranceEntry } from './sttFilter';

export type { BargeInModeSetting, MicSourceSetting, DebugUtteranceEntry };
export type LiveVoiceProviderId = 'gemini' | 'local' | 'openrouter';
export type LocalLlmPresetId = 'small' | 'default' | 'large' | 'custom';
export type LocalWhisperSizeId = 'small.en' | 'base.en' | 'tiny.en';
export type LocalTtsEngineId = 'piper' | 'android_tts';
export type LocalChatTemplateId = 'llama3' | 'chatml';

export type LocalVoiceStatus =
  | 'idle'
  | 'downloading'
  | 'loading_model'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export type LocalModelDownloadItemState =
  | 'not_downloaded'
  | 'downloading'
  | 'paused'
  | 'downloaded'
  | 'ready'
  | 'error';

export interface LocalModelArtifactSpec {
  id: string;
  category: 'llm' | 'stt' | 'vad' | 'tts' | 'tts_config';
  label: string;
  repoId: string;
  repoUrl: string;
  filename: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string | null;
  license: string;
  quantization?: string;
  chatTemplate?: LocalChatTemplateId;
  warning?: string;
  speedHeatWarning?: boolean;
}

export interface LocalVoiceSettings {
  llmPreset: LocalLlmPresetId;
  llmTier?: LocalLlmPresetId;
  customGgufUrl: string;
  customGgufFilename?: string;
  customChatTemplate: LocalChatTemplateId;
  whisperSize: LocalWhisperSizeId;
  whisperSizeUserSelected?: boolean;
  micSource?: MicSourceSetting;
  saveLast10Utterances?: boolean;
  ttsEngine: LocalTtsEngineId;
  silenceTimeoutMs: number;
  minUtteranceMs: number;
  preRollMs: number;
  bargeInSustainedMs: number;
  bargeInThreshold: number;
  bargeInSpeakerBoost: number;
  bargeInMode?: BargeInModeSetting;
  injectMemory?: boolean;
}

export interface LocalVoiceMemoryAndSpeedStats {
  usedRamMb: number;
  availableRamMb: number;
  totalRamMb: number;
  tokensPerSec: number;
  timeToFirstAudioMs: number;
  lastTurnLatencyMs: number;
  thermalStatus: 'none' | 'light' | 'moderate' | 'severe' | 'critical' | string;
  modelLoaded: boolean;
  inferenceThreads?: number;
  lastNativeError?: string;
}

export const LIVE_VOICE_PROVIDER_STORAGE_KEY = 'sierra_live_voice_provider';
export const LOCAL_VOICE_SETTINGS_STORAGE_KEY = 'sierra_local_voice_settings_v1';

/**
 * Verified Hugging Face repositories, filenames, exact byte sizes, SHA-256 hashes, and licenses.
 */
export const LOCAL_LLM_MODELS: Record<Exclude<LocalLlmPresetId, 'custom'>, LocalModelArtifactSpec> = {
  small: {
    id: 'llm-small-qwen2.5-1.5b',
    category: 'llm',
    label: 'Small — Qwen2.5 1.5B Instruct Abliterated (Q4_K_M)',
    repoId: 'mradermacher/Qwen2.5-1.5B-Instruct-abliterated-GGUF',
    repoUrl: 'https://huggingface.co/mradermacher/Qwen2.5-1.5B-Instruct-abliterated-GGUF',
    filename: 'Qwen2.5-1.5B-Instruct-abliterated.Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/mradermacher/Qwen2.5-1.5B-Instruct-abliterated-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-abliterated.Q4_K_M.gguf',
    sizeBytes: 986049088,
    sha256: '59aa9f44bde5349dbe292d7024d197db605f422b8baf65f3246a59abbde4e8e9',
    license: 'Apache-2.0',
    quantization: 'Q4_K_M',
    chatTemplate: 'chatml',
  },
  default: {
    id: 'llm-default-llama3.2-3b',
    category: 'llm',
    label: 'Default — Llama 3.2 3B Instruct Uncensored (Q4_K_M)',
    repoId: 'bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF',
    repoUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF',
    filename: 'Llama-3.2-3B-Instruct-uncensored-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF/resolve/main/Llama-3.2-3B-Instruct-uncensored-Q4_K_M.gguf',
    sizeBytes: 2241003904,
    sha256: '80f532552e3d56e366226f428395de8285a671f2da1d5fd68563741181b77a95',
    license: 'Llama 3.2 Community License',
    quantization: 'Q4_K_M',
    chatTemplate: 'llama3',
  },
  large: {
    id: 'llm-large-dolphin3-8b',
    category: 'llm',
    label: 'Large — Dolphin 3.0 Llama 3.1 8B (Q4_K_M)',
    repoId: 'bartowski/Dolphin3.0-Llama3.1-8B-GGUF',
    repoUrl: 'https://huggingface.co/bartowski/Dolphin3.0-Llama3.1-8B-GGUF',
    filename: 'Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Dolphin3.0-Llama3.1-8B-GGUF/resolve/main/Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf',
    sizeBytes: 4920749472,
    sha256: '268390e07edd407ad93ea21a868b7ae995b5950e01cad0db9e1802ae5049d405',
    license: 'Llama 3.1 Community License',
    quantization: 'Q4_K_M',
    chatTemplate: 'chatml',
    warning:
      'Warning: 8B parameter model (~4.92 GB) requires 8+ GB free RAM, runs significantly slower on mobile CPUs, and generates noticeable device heat and battery drain.',
    speedHeatWarning: true,
  },
};

export const LOCAL_WHISPER_MODELS: Record<LocalWhisperSizeId, LocalModelArtifactSpec> = {
  'small.en': {
    id: 'stt-whisper-small-en-q5_1',
    category: 'stt',
    label: 'Whisper.cpp small.en Q5_1 (Recommended on 8+ cores / 12GB+ RAM)',
    repoId: 'ggerganov/whisper.cpp',
    repoUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
    filename: 'ggml-small.en-q5_1.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin',
    sizeBytes: 190098681,
    sha256: 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30',
    license: 'MIT',
    quantization: 'Q5_1',
  },
  'base.en': {
    id: 'stt-whisper-base-en',
    category: 'stt',
    label: 'Whisper.cpp base.en (Default STT)',
    repoId: 'ggerganov/whisper.cpp',
    repoUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
    filename: 'ggml-base.en.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sizeBytes: 147964211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    license: 'MIT',
  },
  'tiny.en': {
    id: 'stt-whisper-tiny-en',
    category: 'stt',
    label: 'Whisper.cpp tiny.en (Fast STT)',
    repoId: 'ggerganov/whisper.cpp',
    repoUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
    filename: 'ggml-tiny.en.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    sizeBytes: 77704715,
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
    license: 'MIT',
  },
};

export const LOCAL_SILERO_VAD_MODEL: LocalModelArtifactSpec = {
  id: 'vad-silero',
  category: 'vad',
  label: 'Silero VAD v5 (ONNX Runtime)',
  repoId: 'onnx-community/silero-vad',
  repoUrl: 'https://huggingface.co/onnx-community/silero-vad',
  filename: 'silero_vad.onnx',
  downloadUrl: 'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx',
  sizeBytes: 2243022,
  sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808',
  license: 'MIT',
};

export const LOCAL_PIPER_VOICE_MODEL: LocalModelArtifactSpec = {
  id: 'tts-piper-lessac-en',
  category: 'tts',
  label: 'Piper TTS Voice (en_US-lessac-medium ONNX)',
  repoId: 'rhasspy/piper-voices',
  repoUrl: 'https://huggingface.co/rhasspy/piper-voices',
  filename: 'en_US-lessac-medium.onnx',
  downloadUrl:
    'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
  sizeBytes: 63201294,
  sha256: '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f',
  license: 'MIT',
};

export const LOCAL_PIPER_VOICE_CONFIG: LocalModelArtifactSpec = {
  id: 'tts-piper-lessac-config',
  category: 'tts_config',
  label: 'Piper TTS Config (en_US-lessac-medium.onnx.json)',
  repoId: 'rhasspy/piper-voices',
  repoUrl: 'https://huggingface.co/rhasspy/piper-voices',
  filename: 'en_US-lessac-medium.onnx.json',
  downloadUrl:
    'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
  sizeBytes: 4885,
  sha256: 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0',
  license: 'MIT',
};

export const LOCAL_MODEL_CATALOG: Record<string, LocalModelArtifactSpec> = {
  [LOCAL_LLM_MODELS.small.id]: LOCAL_LLM_MODELS.small,
  [LOCAL_LLM_MODELS.default.id]: LOCAL_LLM_MODELS.default,
  [LOCAL_LLM_MODELS.large.id]: LOCAL_LLM_MODELS.large,
  [LOCAL_WHISPER_MODELS['small.en'].id]: LOCAL_WHISPER_MODELS['small.en'],
  [LOCAL_WHISPER_MODELS['base.en'].id]: LOCAL_WHISPER_MODELS['base.en'],
  [LOCAL_WHISPER_MODELS['tiny.en'].id]: LOCAL_WHISPER_MODELS['tiny.en'],
  [LOCAL_SILERO_VAD_MODEL.id]: LOCAL_SILERO_VAD_MODEL,
  [LOCAL_PIPER_VOICE_MODEL.id]: LOCAL_PIPER_VOICE_MODEL,
  [LOCAL_PIPER_VOICE_CONFIG.id]: LOCAL_PIPER_VOICE_CONFIG,
};

export const DEFAULT_LOCAL_VOICE_SETTINGS: LocalVoiceSettings = {
  llmPreset: 'default',
  customGgufUrl: '',
  customChatTemplate: 'chatml',
  whisperSize: 'base.en',
  whisperSizeUserSelected: false,
  micSource: 'auto',
  saveLast10Utterances: false,
  ttsEngine: 'piper',
  silenceTimeoutMs: 600,
  minUtteranceMs: 400,
  preRollMs: 400,
  bargeInSustainedMs: 800,
  bargeInThreshold: 0.85,
  bargeInSpeakerBoost: 0,
  bargeInMode: 'headphones_only',
  injectMemory: true,
};

export function getLiveVoiceProvider(): LiveVoiceProviderId {
  return getSettings().models.liveProvider;
}

export function setLiveVoiceProvider(provider: LiveVoiceProviderId): LiveVoiceProviderId {
  const valid: LiveVoiceProviderId =
    provider === 'local' || provider === 'openrouter' ? provider : 'gemini';
  updateSettings((draft) => {
    draft.models.liveProvider = valid;
    return draft;
  });
  return valid;
}

export function getLocalVoiceSettings(): LocalVoiceSettings {
  const stored = getSettings().live.local;
  return {
    ...DEFAULT_LOCAL_VOICE_SETTINGS,
    ...(stored as Partial<LocalVoiceSettings>),
    injectMemory:
      stored?.injectMemory !== undefined ? Boolean(stored.injectMemory) : isMemoryInjectionEnabled(),
  };
}

export function saveLocalVoiceSettings(patch: Partial<LocalVoiceSettings>): LocalVoiceSettings {
  const current = getLocalVoiceSettings();
  const next: LocalVoiceSettings = {
    ...current,
    ...patch,
  };
  if (patch.injectMemory !== undefined) {
    setMemoryInjectionEnabled(Boolean(patch.injectMemory));
  }
  updateSettings((draft) => {
    draft.live.local = {
      ...draft.live.local,
      ...next,
    } as any;
    return draft;
  });
  return next;
}

export function getActiveLlmArtifactSpec(settings: LocalVoiceSettings): LocalModelArtifactSpec {
  const preset = settings.llmTier || settings.llmPreset || 'default';
  if (preset === 'custom') {
    const url = (settings.customGgufUrl || '').trim();
    const derivedFilename =
      settings.customGgufFilename?.trim() ||
      (url ? decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'custom-model.gguf') : 'custom-model.gguf');
    return {
      id: 'llm-custom-gguf',
      category: 'llm',
      label: `Custom GGUF (${derivedFilename})`,
      repoId: 'custom',
      repoUrl: url,
      filename: derivedFilename.endsWith('.gguf') ? derivedFilename : `${derivedFilename}.gguf`,
      downloadUrl: url,
      sizeBytes: 0,
      sha256: null,
      license: 'Custom',
      quantization: 'GGUF',
      chatTemplate: settings.customChatTemplate || 'chatml',
    };
  }
  return LOCAL_LLM_MODELS[preset] || LOCAL_LLM_MODELS.default;
}

export function resolveEffectiveWhisperSize(
  settings: LocalVoiceSettings,
  cpuCores?: number,
  totalRamMb?: number,
): LocalWhisperSizeId {
  if (settings.whisperSizeUserSelected) {
    return settings.whisperSize in LOCAL_WHISPER_MODELS ? settings.whisperSize : 'base.en';
  }
  return getRecommendedWhisperModel(cpuCores, totalRamMb);
}

export function getRequiredModelsForSettings(settings: LocalVoiceSettings): LocalModelArtifactSpec[] {
  const llm = getActiveLlmArtifactSpec(settings);
  const whisper = LOCAL_WHISPER_MODELS[settings.whisperSize] || LOCAL_WHISPER_MODELS['base.en'];
  const list: LocalModelArtifactSpec[] = [llm, whisper, LOCAL_SILERO_VAD_MODEL];
  if (settings.ttsEngine === 'piper') {
    list.push(LOCAL_PIPER_VOICE_MODEL, LOCAL_PIPER_VOICE_CONFIG);
  }
  return list;
}

export function formatBytesHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx >= 2 ? 2 : 0)} ${units[idx]}`;
}

export function evaluateDownloadPreflight(params: {
  requiredBytes?: number;
  alreadyDownloadedBytes?: number;
  freeStorageBytes?: number;
  freeBytes?: number;
  isWifi: boolean;
  selectedIds?: string[];
}): {
  hasEnoughStorage: boolean;
  lowStorageWarning: boolean;
  wifiWarning: string | null;
  storageWarning: string | null;
  remainingBytes: number;
} {
  let required = params.requiredBytes ?? 0;
  if (Array.isArray(params.selectedIds) && params.selectedIds.length > 0 && !params.requiredBytes) {
    required = params.selectedIds.reduce((acc, id) => acc + (LOCAL_MODEL_CATALOG[id]?.sizeBytes || 0), 0);
  }
  const already = params.alreadyDownloadedBytes ?? 0;
  const remainingBytes = Math.max(0, required - already);
  const free = params.freeStorageBytes ?? params.freeBytes ?? 32 * 1024 * 1024 * 1024;
  // Require 20% headroom or at least 500 MB buffer
  const neededWithBuffer = Math.max(Math.ceil(remainingBytes * 1.2), remainingBytes + 200 * 1024 * 1024);
  const hasEnoughStorage = remainingBytes === 0 || free >= neededWithBuffer;
  const lowStorageWarning = !hasEnoughStorage;

  return {
    hasEnoughStorage,
    lowStorageWarning,
    remainingBytes,
    wifiWarning: !params.isWifi
      ? `You are not on Wi-Fi. Downloading ${formatBytesHuman(remainingBytes)} over cellular data may incur charges.`
      : null,
    storageWarning: !hasEnoughStorage
      ? `Insufficient free storage: ${formatBytesHuman(free)} available, but ${formatBytesHuman(neededWithBuffer)} is recommended.`
      : null,
  };
}

/**
 * Streaming Sentence Splitter:
 * - Splits LLM tokens into spoken sentences at '.', '?', '!', and '\n'.
 * - Ignores common abbreviations (Dr., Mr., Mrs., Ms., St., e.g., i.e., U.S., etc.) and decimal numbers (e.g. 3.14).
 * - Flushes the first clause early at ',', ';', ':', or '—' once it reaches minFirstClauseChars to minimize TTFA.
 * - Strips markdown syntax and emoji so TTS speaks clean prose.
 */
const COMMON_ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'ave',
  'blvd',
  'vs',
  'etc',
  'fig',
  'inc',
  'ltd',
  'co',
  'corp',
  'e.g',
  'i.e',
  'u.s',
  'u.k',
]);

export function sanitizeSpokenSentence(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class LocalSentenceSplitter {
  private buffer = '';
  private hasFlushedFirstClause = false;
  private readonly minFirstClauseChars: number;
  private readonly minSentenceChars: number;

  constructor(
    optionsOrMinChars?:
      | number
      | {
          minFirstClauseChars?: number;
          minSentenceChars?: number;
        },
  ) {
    if (typeof optionsOrMinChars === 'number') {
      this.minFirstClauseChars = optionsOrMinChars;
      this.minSentenceChars = optionsOrMinChars;
    } else {
      this.minFirstClauseChars = optionsOrMinChars?.minFirstClauseChars ?? 28;
      this.minSentenceChars = optionsOrMinChars?.minSentenceChars ?? 1;
    }
  }

  public pushToken(token: string): string[] {
    if (!token) return [];
    this.buffer += token;
    const emitted: string[] = [];

    let scanIdx = 0;
    while (scanIdx < this.buffer.length) {
      const ch = this.buffer[scanIdx];

      // 1. Early first-clause flush at comma/semicolon/colon/em-dash to reduce Time-To-First-Audio
      if (
        !this.hasFlushedFirstClause &&
        (ch === ',' || ch === ';' || ch === ':' || ch === '—') &&
        scanIdx + 1 >= this.minFirstClauseChars
      ) {
        const nextChar = this.buffer[scanIdx + 1];
        if (nextChar === ' ' || nextChar === '\n') {
          const candidate = sanitizeSpokenSentence(this.buffer.slice(0, scanIdx + 1));
          if (candidate.length >= Math.max(12, this.minSentenceChars)) {
            emitted.push(candidate);
            this.hasFlushedFirstClause = true;
            this.buffer = this.buffer.slice(scanIdx + 2);
            scanIdx = 0;
            continue;
          }
        }
      }

      // 2. Hard newline boundary
      if (ch === '\n') {
        const candidate = sanitizeSpokenSentence(this.buffer.slice(0, scanIdx));
        if (candidate.length >= this.minSentenceChars) {
          this.buffer = this.buffer.slice(scanIdx + 1);
          scanIdx = 0;
          if (candidate) {
            emitted.push(candidate);
            this.hasFlushedFirstClause = true;
          }
          continue;
        }
      }

      // 3. Sentence-ending punctuation (., ?, !)
      if (ch === '.' || ch === '?' || ch === '!') {
        let endIdx = scanIdx;
        while (
          endIdx + 1 < this.buffer.length &&
          (this.buffer[endIdx + 1] === '.' ||
            this.buffer[endIdx + 1] === '?' ||
            this.buffer[endIdx + 1] === '!' ||
            this.buffer[endIdx + 1] === '"' ||
            this.buffer[endIdx + 1] === ')' ||
            this.buffer[endIdx + 1] === "'")
        ) {
          endIdx++;
        }

        const charAfter = this.buffer[endIdx + 1];
        const isAtEndOrFollowedBySpace =
          endIdx + 1 >= this.buffer.length || charAfter === ' ' || charAfter === '\n';

        if (!isAtEndOrFollowedBySpace) {
          scanIdx = endIdx + 1;
          continue;
        }

        if (ch === '.') {
          // Check decimal number (e.g., 3.14)
          const prevChar = scanIdx > 0 ? this.buffer[scanIdx - 1] : '';
          const nextImmediate = this.buffer[scanIdx + 1] || '';
          if (/\d/.test(prevChar) && /\d/.test(nextImmediate)) {
            scanIdx++;
            continue;
          }

          // If period is at the very end of the current buffer and could be followed by a digit or abbreviation letter,
          // wait for the next token unless it's clearly the end of a sentence followed by space or flush()
          const prefix = this.buffer.slice(0, scanIdx + 1);
          const wordMatch = prefix.match(/([A-Za-z.]+)\.$/);
          if (wordMatch) {
            const wordLower = wordMatch[1].toLowerCase();
            if (
              COMMON_ABBREVIATIONS.has(wordLower) ||
              /^[a-z]\.[a-z]$/i.test(wordLower) ||
              /^[A-Z]$/.test(wordMatch[1])
            ) {
              scanIdx = endIdx + 1;
              continue;
            }
          }
        }

        // Wait for at least one trailing space/newline or end of punctuation cluster if at buffer end with '.'
        if (ch === '.' && endIdx + 1 >= this.buffer.length && this.buffer.length < 24) {
          break;
        }

        const rawSentence = this.buffer.slice(0, endIdx + 1);
        const cleaned = sanitizeSpokenSentence(rawSentence);
        if (cleaned.length < this.minSentenceChars) {
          scanIdx = endIdx + 1;
          continue;
        }

        this.buffer = this.buffer.slice(endIdx + 1).replace(/^\s+/, '');
        scanIdx = 0;
        if (cleaned) {
          emitted.push(cleaned);
          this.hasFlushedFirstClause = true;
        }
        continue;
      }

      scanIdx++;
    }

    return emitted;
  }

  public flush(): string {
    const cleaned = sanitizeSpokenSentence(this.buffer);
    this.buffer = '';
    return cleaned;
  }

  public flushRemainder(): string {
    return this.flush();
  }
}

export interface LocalChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  interrupted?: boolean;
  timestamp: number;
}

export interface LocalVoiceStateMachineConfig {
  sampleRate?: number;
  preRollMs?: number;
  speechStartMs?: number;
  silenceEndTimeoutMs?: number;
  silenceTimeoutMs?: number;
  minUtteranceDurationMs?: number;
  minUtteranceMs?: number;
  vadThreshold?: number;
  bargeInThreshold?: number;
  speakerEchoMargin?: number;
  bargeInSpeakerBoost?: number;
  bargeInSustainedMs?: number;
  bargeInMode?: BargeInModeSetting;
  hasHeadset?: boolean;
  postPlaybackCooldownMs?: number;
  playbackRmsMultiplier?: number;
  maxHistoryTurns?: number;
}

export interface BargeInEvaluationTelemetry {
  accepted: boolean;
  reason: string;
  vadProb: number;
  micRms: number;
  playbackRms: number;
  sustainedMs: number;
  mode: BargeInModeSetting;
  hasHeadset: boolean;
}

export interface LocalVoiceStateMachineHooks {
  onStatusChange?: (status: LocalVoiceStatus, reason?: string) => void;
  stopAndFlushAudioPlayback: () => void;
  cancelLlmGeneration: () => void;
  cancelTtsAndEmptyQueue: () => void;
  onBargeInTriggered?: (arg: any) => void;
  onBargeInEvaluated?: (telemetry: BargeInEvaluationTelemetry) => void;
  onUtteranceFinished?: (audio: Float32Array) => void;
}

export type InternalTurnMachineState =
  | 'idle'
  | 'listening_utterance'
  | 'transcribing'
  | 'thinking'
  | 'speaking';

/**
 * Turn & Barge-In State Machine:
 * - Maintains a circular pre-roll PCM buffer (~300 ms) so the first syllable is never clipped.
 * - Starts an utterance after sustained speech, commits after ~600 ms of silence, and discards utterances < 300 ms.
 * - Keeps VAD running while Sierra speaks with a raised threshold (bargeInThreshold + speakerEchoMargin).
 * - On sustained speech (~250 ms) during TTS playback, triggers interruption in strict order:
 *   1. stopAndFlushAudioPlayback()
 *   2. cancelLlmGeneration()
 *   3. cancelTtsAndEmptyQueue()
 *   4. Records only the actually spoken sentences in chat history (marked interrupted: true)
 *   5. Captures the new utterance including the audio frames that triggered the interrupt.
 * - Caps chat history at the last 20 turns (40 messages).
 */
export class LocalVoiceTurnStateMachine {
  private state: InternalTurnMachineState = 'idle';
  private readonly sampleRate: number;
  private readonly preRollSamples: number;
  private readonly speechStartMs: number;
  private readonly silenceEndTimeoutMs: number;
  private readonly minUtteranceDurationMs: number;
  private readonly vadThreshold: number;
  private readonly bargeInThreshold: number;
  private readonly speakerEchoMargin: number;
  private readonly bargeInSustainedMs: number;
  private readonly maxHistoryTurns: number;
  private readonly postPlaybackCooldownMs: number;
  private readonly playbackRmsMultiplier: number;
  private readonly hooks: LocalVoiceStateMachineHooks;

  private bargeInMode: BargeInModeSetting;
  private hasHeadset: boolean;
  private adaptivePlaybackRms = 0;
  private lastPlaybackEndedAtMs = 0;

  private preRollFrames: Float32Array[] = [];
  private preRollSampleCount = 0;

  private utteranceFrames: Float32Array[] = [];
  private speechAccumulatedMs = 0;
  private silenceAccumulatedMs = 0;
  private utteranceSpeechDurationMs = 0;

  private bargeInFrames: Float32Array[] = [];
  private bargeInAccumulatedMs = 0;

  private activeTurnId = 0;
  private currentTurnSpokenSentences: string[] = [];
  private history: LocalChatHistoryMessage[] = [];

  constructor(config: LocalVoiceStateMachineConfig, hooks: LocalVoiceStateMachineHooks) {
    this.sampleRate = config.sampleRate ?? 16000;
    const preRollMs = config.preRollMs ?? 300;
    this.preRollSamples = Math.max(480, Math.round((this.sampleRate * preRollMs) / 1000));
    this.speechStartMs = config.speechStartMs ?? 90;
    this.silenceEndTimeoutMs = config.silenceEndTimeoutMs ?? config.silenceTimeoutMs ?? 600;
    this.minUtteranceDurationMs = config.minUtteranceDurationMs ?? config.minUtteranceMs ?? 300;
    this.vadThreshold = config.vadThreshold ?? 0.45;
    this.bargeInThreshold = config.bargeInThreshold ?? 0.85;
    // Preserve explicit test speakerEchoMargin while keeping default runtime boost at 0 for unified threshold
    this.speakerEchoMargin = config.speakerEchoMargin ?? config.bargeInSpeakerBoost ?? 0;
    this.bargeInSustainedMs = config.bargeInSustainedMs ?? 800;
    this.bargeInMode = config.bargeInMode ?? 'on';
    this.hasHeadset = config.hasHeadset ?? false;
    this.postPlaybackCooldownMs = config.postPlaybackCooldownMs ?? 400;
    this.playbackRmsMultiplier = config.playbackRmsMultiplier ?? 1.25;
    this.maxHistoryTurns = config.maxHistoryTurns ?? 20;
    this.hooks = hooks;
  }

  public setBargeInMode(mode: BargeInModeSetting): void {
    this.bargeInMode = mode;
  }

  public setHasHeadset(connected: boolean): void {
    this.hasHeadset = connected;
  }

  public updatePlaybackLevel(rms: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(rms) ? rms : 0));
    this.adaptivePlaybackRms =
      clamped > this.adaptivePlaybackRms
        ? this.adaptivePlaybackRms * 0.4 + clamped * 0.6
        : this.adaptivePlaybackRms * 0.85 + clamped * 0.15;
  }

  public markPlaybackEnded(nowMs: number = Date.now()): void {
    this.lastPlaybackEndedAtMs = nowMs;
  }

  public isBargeInAllowed(): boolean {
    if (this.bargeInMode === 'off') return false;
    if (this.bargeInMode === 'headphones_only') return this.hasHeadset;
    return true;
  }

  public getEffectiveBargeInThreshold(): number {
    return Math.min(0.95, this.bargeInThreshold + this.speakerEchoMargin);
  }

  public getState(): InternalTurnMachineState {
    return this.state;
  }

  public startListening(): void {
    this.state = 'idle';
    this.hooks.onStatusChange?.('listening');
  }

  private pushPreRollFrame(frame: Float32Array): void {
    const copy = new Float32Array(frame);
    this.preRollFrames.push(copy);
    this.preRollSampleCount += copy.length;
    while (this.preRollSampleCount > this.preRollSamples && this.preRollFrames.length > 1) {
      const removed = this.preRollFrames.shift()!;
      this.preRollSampleCount -= removed.length;
    }
  }

  private concatFrames(frames: Float32Array[]): Float32Array {
    const total = frames.reduce((acc, f) => acc + f.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const f of frames) {
      out.set(f, offset);
      offset += f.length;
    }
    return out;
  }

  private computeFrameRms(frame: Float32Array): number {
    if (!frame || frame.length === 0) return 0;
    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i];
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / frame.length);
  }

  public processFrame(
    pcmFrame: Float32Array,
    vadProb: number,
    frameDurationMs = 30,
    nowMs = Date.now(),
  ): {
    state: InternalTurnMachineState;
    bargeInTriggered: boolean;
    utteranceCommitted: boolean;
  } {
    // 1. If Sierra is currently speaking, check barge-in gating & sustained speech + mic RMS floor
    if (this.state === 'speaking') {
      const frameRms = this.computeFrameRms(pcmFrame);
      if (!this.isBargeInAllowed()) {
        this.bargeInAccumulatedMs = 0;
        this.bargeInFrames = [];
        if (vadProb >= 0.45 || frameRms >= 0.08) {
          this.hooks.onBargeInEvaluated?.({
            accepted: false,
            reason: this.bargeInMode === 'off' ? 'mode_off' : 'headphones_only_no_headset',
            vadProb,
            micRms: frameRms,
            playbackRms: this.adaptivePlaybackRms,
            sustainedMs: 0,
            mode: this.bargeInMode,
            hasHeadset: this.hasHeadset,
          });
        }
        return {
          state: this.state,
          bargeInTriggered: false,
          utteranceCommitted: false,
        };
      }

      const isAdaptive = this.bargeInMode === 'adaptive';
      const effectiveThreshold = isAdaptive
        ? Math.max(0.85, this.getEffectiveBargeInThreshold())
        : this.getEffectiveBargeInThreshold();
      const requiredRms = isAdaptive
        ? (this.hasHeadset ? 0.015 : Math.max(0.2, 2 * this.adaptivePlaybackRms))
        : (this.adaptivePlaybackRms > 0.005 ? this.adaptivePlaybackRms * this.playbackRmsMultiplier : 0.01);
      const targetSustainedMs = isAdaptive
        ? (this.hasHeadset ? 0 : 400)
        : this.bargeInSustainedMs;
      const rmsOk = isAdaptive && !this.hasHeadset
        ? frameRms > requiredRms
        : frameRms >= requiredRms;

      if (vadProb >= effectiveThreshold && rmsOk) {
        this.bargeInAccumulatedMs += frameDurationMs;
        this.bargeInFrames.push(new Float32Array(pcmFrame));

        if (this.bargeInAccumulatedMs >= targetSustainedMs) {
          const sustainedMs = this.bargeInAccumulatedMs;
          this.hooks.onBargeInEvaluated?.({
            accepted: true,
            reason: isAdaptive
              ? (this.hasHeadset ? 'adaptive_headphones_immediate' : 'adaptive_speaker_sustained')
              : 'sustained_threshold_met',
            vadProb,
            micRms: frameRms,
            playbackRms: this.adaptivePlaybackRms,
            sustainedMs,
            mode: this.bargeInMode,
            hasHeadset: this.hasHeadset,
          });
          // Execute barge-in in exact required sequence:
          // (1) Stop and flush audio playback
          this.hooks.stopAndFlushAudioPlayback();
          // (2) Cancel LLM generation
          this.hooks.cancelLlmGeneration();
          // (3) Cancel TTS and empty its queue
          this.hooks.cancelTtsAndEmptyQueue();

          // Record only the spoken prefix in chat history marked as interrupted
          const spokenPrefix = this.currentTurnSpokenSentences.join(' ').trim();
          if (spokenPrefix) {
            this.pushHistoryMessage({
              role: 'assistant',
              content: spokenPrefix,
              interrupted: true,
              timestamp: Date.now(),
            });
          }
          this.currentTurnSpokenSentences = [];
          this.lastPlaybackEndedAtMs = nowMs;

          // (4) Transition immediately to capturing the new utterance including the pre-roll & trigger audio
          const triggerAudio = this.concatFrames([...this.preRollFrames, ...this.bargeInFrames]);
          this.utteranceFrames = [...this.preRollFrames, ...this.bargeInFrames];
          this.utteranceSpeechDurationMs = this.bargeInAccumulatedMs;
          this.silenceAccumulatedMs = 0;
          this.bargeInFrames = [];
          this.bargeInAccumulatedMs = 0;
          this.state = 'listening_utterance';

          if (this.hooks.onBargeInTriggered) {
            try {
              (triggerAudio as any).spokenText = spokenPrefix;
              (triggerAudio as any).interruptedTurnId = this.activeTurnId;
              (triggerAudio as any).sustainedSpeechMs = sustainedMs;
              (triggerAudio as any).effectiveThreshold = effectiveThreshold;
            } catch {}
            this.hooks.onBargeInTriggered(triggerAudio);
          }
          this.hooks.onStatusChange?.('interrupted', 'User barge-in');
          return {
            state: this.state,
            bargeInTriggered: true,
            utteranceCommitted: false,
          };
        } else if (vadProb >= 0.45 || frameRms >= 0.08) {
          this.hooks.onBargeInEvaluated?.({
            accepted: false,
            reason: `accumulating(<${targetSustainedMs}ms)`,
            vadProb,
            micRms: frameRms,
            playbackRms: this.adaptivePlaybackRms,
            sustainedMs: this.bargeInAccumulatedMs,
            mode: this.bargeInMode,
            hasHeadset: this.hasHeadset,
          });
        }
      } else {
        if (this.bargeInAccumulatedMs > 0 || vadProb >= 0.45 || frameRms >= 0.08) {
          const reason = this.bargeInAccumulatedMs > 0
            ? 'short_burst_reset'
            : vadProb < effectiveThreshold
              ? 'vad_below_threshold'
              : 'rms_below_required';
          this.hooks.onBargeInEvaluated?.({
            accepted: false,
            reason,
            vadProb,
            micRms: frameRms,
            playbackRms: this.adaptivePlaybackRms,
            sustainedMs: this.bargeInAccumulatedMs,
            mode: this.bargeInMode,
            hasHeadset: this.hasHeadset,
          });
        }
        this.bargeInAccumulatedMs = 0;
        this.bargeInFrames = [];
        this.pushPreRollFrame(pcmFrame);
      }
      return {
        state: this.state,
        bargeInTriggered: false,
        utteranceCommitted: false,
      };
    }

    // 2. Idle state: honor 400ms post-playback cooldown when barge-in is disabled / speaker mode
    if (this.state === 'idle') {
      const inPostPlaybackCooldown =
        !this.isBargeInAllowed() &&
        this.lastPlaybackEndedAtMs > 0 &&
        nowMs - this.lastPlaybackEndedAtMs < this.postPlaybackCooldownMs;
      if (inPostPlaybackCooldown) {
        this.speechAccumulatedMs = 0;
        this.utteranceFrames = [];
        return {
          state: this.state,
          bargeInTriggered: false,
          utteranceCommitted: false,
        };
      }

      if (vadProb >= this.vadThreshold) {
        this.speechAccumulatedMs += frameDurationMs;
        this.utteranceFrames.push(new Float32Array(pcmFrame));
        if (this.speechAccumulatedMs >= this.speechStartMs) {
          this.state = 'listening_utterance';
          this.utteranceFrames = [...this.preRollFrames, ...this.utteranceFrames];
          this.utteranceSpeechDurationMs = this.speechAccumulatedMs;
          this.silenceAccumulatedMs = 0;
          this.hooks.onStatusChange?.('listening', 'Speech started');
        }
      } else {
        this.speechAccumulatedMs = 0;
        this.utteranceFrames = [];
        this.pushPreRollFrame(pcmFrame);
      }
      return {
        state: this.state,
        bargeInTriggered: false,
        utteranceCommitted: false,
      };
    }

    // 3. Actively capturing user utterance
    if (this.state === 'listening_utterance') {
      this.utteranceFrames.push(new Float32Array(pcmFrame));
      if (vadProb >= this.vadThreshold) {
        this.utteranceSpeechDurationMs += frameDurationMs;
        this.silenceAccumulatedMs = 0;
      } else {
        this.silenceAccumulatedMs += frameDurationMs;
        if (this.silenceAccumulatedMs >= this.silenceEndTimeoutMs) {
          // End of utterance reached
          if (this.utteranceSpeechDurationMs < this.minUtteranceDurationMs) {
            // Discard short noise/click under ~300 ms
            this.utteranceFrames = [];
            this.speechAccumulatedMs = 0;
            this.silenceAccumulatedMs = 0;
            this.utteranceSpeechDurationMs = 0;
            this.state = 'idle';
            return {
              state: this.state,
              bargeInTriggered: false,
              utteranceCommitted: false,
            };
          }

          const finishedPcm = this.concatFrames(this.utteranceFrames);
          this.utteranceFrames = [];
          this.speechAccumulatedMs = 0;
          this.silenceAccumulatedMs = 0;
          this.utteranceSpeechDurationMs = 0;
          this.state = 'transcribing';
          this.hooks.onStatusChange?.('thinking', 'Transcribing utterance');
          this.hooks.onUtteranceFinished?.(finishedPcm);
          return {
            state: this.state,
            bargeInTriggered: false,
            utteranceCommitted: true,
          };
        }
      }
    }

    return {
      state: this.state,
      bargeInTriggered: false,
      utteranceCommitted: false,
    };
  }

  private pushHistoryMessage(msg: LocalChatHistoryMessage): void {
    this.history.push(msg);
    const maxMessages = this.maxHistoryTurns * 2;
    if (this.history.length > maxMessages) {
      this.history = this.history.slice(this.history.length - maxMessages);
    }
  }

  public commitUserTranscript(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.pushHistoryMessage({
      role: 'user',
      content: clean,
      timestamp: Date.now(),
    });
  }

  public recordUserUtteranceInHistory(text: string): void {
    this.commitUserTranscript(text);
  }

  private cancelledTurnIds = new Set<number>();

  public getActiveTurnId(): number {
    return this.activeTurnId;
  }

  public isTurnCancelled(turnId: number): boolean {
    return this.cancelledTurnIds.has(turnId) || turnId !== this.activeTurnId;
  }

  public beginAssistantThinking(): number {
    this.activeTurnId += 1;
    this.currentTurnSpokenSentences = [];
    this.state = 'thinking';
    this.hooks.onStatusChange?.('thinking');
    return this.activeTurnId;
  }

  public beginAssistantSpeaking(): void {
    this.currentTurnSpokenSentences = [];
    this.bargeInAccumulatedMs = 0;
    this.bargeInFrames = [];
    this.state = 'speaking';
    this.hooks.onStatusChange?.('speaking');
  }

  /**
   * Executes the strict 3-step barge-in interruption sequence when native Android VAD
   * detects sustained user speech over Sierra's output:
   * 1. stopAndFlushAudioPlayback()
   * 2. cancelLlmGeneration()
   * 3. cancelTtsAndEmptyQueue()
   * Records only the already-spoken sentences in chat history (interrupted: true)
   * and marks the turn cancelled so no subsequent sentences from that turn can ever play.
   */
  public handleNativeBargeIn(
    interruptedTurnId = this.activeTurnId,
    sustainedSpeechMs = this.bargeInSustainedMs,
    effectiveThreshold = Math.min(0.95, this.bargeInThreshold + this.speakerEchoMargin),
  ): { spokenText: string; interruptedTurnId: number } {
    const targetTurn = interruptedTurnId || this.activeTurnId;
    if (this.cancelledTurnIds.has(targetTurn) && this.state === 'listening_utterance') {
      return { spokenText: '', interruptedTurnId: targetTurn };
    }
    this.cancelledTurnIds.add(targetTurn);
    this.cancelledTurnIds.add(this.activeTurnId);
    this.activeTurnId += 1;

    // (1) Stop and flush audio playback
    this.hooks.stopAndFlushAudioPlayback();
    // (2) Cancel LLM generation
    this.hooks.cancelLlmGeneration();
    // (3) Cancel TTS and empty its queue
    this.hooks.cancelTtsAndEmptyQueue();

    const spokenPrefix = this.currentTurnSpokenSentences.join(' ').trim();
    if (spokenPrefix) {
      this.pushHistoryMessage({
        role: 'assistant',
        content: spokenPrefix,
        interrupted: true,
        timestamp: Date.now(),
      });
    }
    this.currentTurnSpokenSentences = [];
    this.bargeInFrames = [];
    this.bargeInAccumulatedMs = 0;
    this.state = 'listening_utterance';

    if (this.hooks.onBargeInTriggered) {
      this.hooks.onBargeInTriggered({
        spokenText: spokenPrefix,
        interruptedTurnId: targetTurn,
        sustainedSpeechMs,
        effectiveThreshold,
      });
    }
    this.hooks.onStatusChange?.('interrupted', 'User barge-in');
    return { spokenText: spokenPrefix, interruptedTurnId: targetTurn };
  }

  public markSentencePlaybackStarted(_sentence: string, turnId?: number): void {
    if (turnId !== undefined && this.isTurnCancelled(turnId)) return;
    if (this.state !== 'speaking') {
      this.state = 'speaking';
      this.hooks.onStatusChange?.('speaking');
    }
  }

  public recordSentenceSpoken(sentence: string): void {
    const clean = sentence.trim();
    if (clean) {
      this.currentTurnSpokenSentences.push(clean);
    }
  }

  public markSentencePlaybackCompleted(sentence: string, turnId?: number): void {
    if (turnId !== undefined && this.isTurnCancelled(turnId)) return;
    this.recordSentenceSpoken(sentence);
  }

  public finishAssistantSpeaking(): void {
    const fullSpoken = this.currentTurnSpokenSentences.join(' ').trim();
    if (fullSpoken) {
      this.pushHistoryMessage({
        role: 'assistant',
        content: fullSpoken,
        interrupted: false,
        timestamp: Date.now(),
      });
    }
    this.lastPlaybackEndedAtMs = Date.now();
    this.currentTurnSpokenSentences = [];
    this.state = 'idle';
    this.hooks.onStatusChange?.('listening');
  }

  public completeAssistantTurn(turnId?: number): void {
    if (turnId !== undefined && this.isTurnCancelled(turnId)) return;
    this.finishAssistantSpeaking();
  }

  public getHistory(): LocalChatHistoryMessage[] {
    return [...this.history];
  }

  public getChatHistory(): LocalChatHistoryMessage[] {
    return this.getHistory();
  }
}

/**
 * Local Model Download Manager state & HTTP Range resume logic.
 */
export interface DownloadEntryProgress {
  modelId: string;
  status: LocalModelDownloadItemState;
  downloadedBytes: number;
  totalBytes: number;
  retryCount: number;
  sha256Verified: boolean;
  checksumUnverified?: boolean;
  expectedSha256?: string | null;
  actualSha256?: string;
  badFilePath?: string;
  error?: string;
}

export class LocalModelDownloadManager {
  private states: Record<string, DownloadEntryProgress> = {};

  constructor(modelIds: string[] = Object.keys(LOCAL_MODEL_CATALOG)) {
    for (const id of modelIds) {
      const spec = LOCAL_MODEL_CATALOG[id];
      this.states[id] = {
        modelId: id,
        status: 'not_downloaded',
        downloadedBytes: 0,
        totalBytes: spec?.sizeBytes || 0,
        retryCount: 0,
        sha256Verified: false,
      };
    }
  }

  public evaluateDownloadPreflight(params: {
    isWifi: boolean;
    freeBytes: number;
    selectedIds: string[];
  }): {
    wifiWarning: boolean;
    lowStorageWarning: boolean;
    requiredBytes: number;
  } {
    const requiredBytes = params.selectedIds.reduce(
      (acc, id) => acc + (LOCAL_MODEL_CATALOG[id]?.sizeBytes || 0),
      0,
    );
    const res = evaluateDownloadPreflight({
      requiredBytes,
      freeStorageBytes: params.freeBytes,
      isWifi: params.isWifi,
    });
    return {
      wifiWarning: Boolean(res.wifiWarning),
      lowStorageWarning: res.lowStorageWarning,
      requiredBytes,
    };
  }

  public getState(modelId: string): DownloadEntryProgress {
    if (!this.states[modelId]) {
      const spec = LOCAL_MODEL_CATALOG[modelId];
      this.states[modelId] = {
        modelId,
        status: 'not_downloaded',
        downloadedBytes: 0,
        totalBytes: spec?.sizeBytes || 0,
        retryCount: 0,
        sha256Verified: false,
      };
    }
    return { ...this.states[modelId] };
  }

  public buildResumeHttpHeaders(modelId: string): Record<string, string> {
    const st = this.getState(modelId);
    if (st.downloadedBytes > 0) {
      return {
        Range: `bytes=${st.downloadedBytes}-`,
      };
    }
    return {};
  }

  public startOrResume(modelId: string): { resumeFromByte: number; headers: Record<string, string> } {
    const st = this.getState(modelId);
    const headers = this.buildResumeHttpHeaders(modelId);
    this.states[modelId] = {
      ...st,
      status: 'downloading',
      error: undefined,
    };
    return {
      resumeFromByte: st.downloadedBytes,
      headers,
    };
  }

  public onChunkReceived(modelId: string, chunkBytes: number, totalBytes?: number): DownloadEntryProgress {
    const st = this.getState(modelId);
    const nextDownloaded = st.downloadedBytes + Math.max(0, chunkBytes);
    this.states[modelId] = {
      ...st,
      status: 'downloading',
      downloadedBytes: nextDownloaded,
      totalBytes: totalBytes ?? st.totalBytes,
    };
    return this.getState(modelId);
  }

  public pause(modelId: string): DownloadEntryProgress {
    const st = this.getState(modelId);
    this.states[modelId] = {
      ...st,
      status: 'paused',
    };
    return this.getState(modelId);
  }

  public retry(modelId: string): { retryCount: number; resumeFromByte: number } {
    const st = this.getState(modelId);
    const nextRetry = st.retryCount + 1;
    this.states[modelId] = {
      ...st,
      status: 'downloading',
      retryCount: nextRetry,
      error: undefined,
    };
    return {
      retryCount: nextRetry,
      resumeFromByte: st.downloadedBytes,
    };
  }

  public verifyAndComplete(modelId: string, actualSha256: string | null, actualSizeBytes?: number): boolean {
    const st = this.getState(modelId);
    const spec = LOCAL_MODEL_CATALOG[modelId];
    const filename = spec?.filename || modelId;
    const expectedSize = spec?.sizeBytes || st.totalBytes || 0;
    const observedSize = actualSizeBytes ?? st.downloadedBytes;
    const expected = spec?.sha256 ? spec.sha256.trim().toLowerCase() : null;
    const actual = actualSha256 ? actualSha256.trim().toLowerCase() : '';

    // If hash is null / unconfirmed, verify by exact byte size only and log "checksum unverified"
    if (!expected) {
      if (expectedSize > 0 && observedSize !== expectedSize) {
        const badPath = `${filename}.bad`;
        const sizeErr = `Exact byte size mismatch for ${filename}: expected ${expectedSize} bytes, got ${observedSize} bytes (kept as ${badPath})`;
        addDebugLog('LocalDownload:SizeMismatch', sizeErr);
        this.states[modelId] = {
          ...st,
          status: 'error',
          downloadedBytes: 0,
          sha256Verified: false,
          checksumUnverified: true,
          badFilePath: badPath,
          error: sizeErr,
        };
        return false;
      }
      addDebugLog(
        'LocalDownload:ChecksumUnverified',
        `checksum unverified for ${filename} (verified by exact byte size: ${observedSize} bytes)`,
      );
      this.states[modelId] = {
        ...st,
        status: 'ready',
        downloadedBytes: expectedSize || observedSize,
        sha256Verified: false,
        checksumUnverified: true,
        error: undefined,
      };
      return true;
    }

    if (actual !== expected) {
      const badPath = `${filename}.bad`;
      const fullErr = `SHA-256 checksum mismatch for ${filename}: expected ${expected}, got ${actual} (kept as ${badPath})`;
      addDebugLog('LocalDownload:HashMismatch', fullErr);
      this.states[modelId] = {
        ...st,
        status: 'error',
        downloadedBytes: 0,
        sha256Verified: false,
        expectedSha256: expected,
        actualSha256: actual,
        badFilePath: badPath,
        error: fullErr,
      };
      return false;
    }

    this.states[modelId] = {
      ...st,
      status: 'ready',
      downloadedBytes: st.totalBytes || st.downloadedBytes,
      sha256Verified: true,
      checksumUnverified: false,
      expectedSha256: expected,
      actualSha256: actual,
      error: undefined,
    };
    return true;
  }

  public deleteAll(): void {
    for (const id of Object.keys(this.states)) {
      const spec = LOCAL_MODEL_CATALOG[id];
      this.states[id] = {
        modelId: id,
        status: 'not_downloaded',
        downloadedBytes: 0,
        totalBytes: spec?.sizeBytes || 0,
        retryCount: 0,
        sha256Verified: false,
        checksumUnverified: false,
        badFilePath: undefined,
        error: undefined,
      };
    }
  }
}

/**
 * Swappable Local TTS Engine Interface + Sequential TTS Queue Coordinator
 */
export interface SynthesizedAudioChunk {
  sentence?: string;
  pcm16?: Int16Array;
  pcmBase64?: string;
  sampleRate: number;
  payload?: any;
}

export interface LocalTtsEngine {
  readonly id: LocalTtsEngineId;
  isAvailable(): Promise<boolean>;
  synthesizeSentence(sentence: string, signal?: AbortSignal): Promise<SynthesizedAudioChunk>;
  stop(): Promise<void>;
}

export class PiperLocalTtsEngine implements LocalTtsEngine {
  public readonly id: LocalTtsEngineId = 'piper';

  public async isAvailable(): Promise<boolean> {
    return Capacitor.isNativePlatform();
  }

  public async synthesizeSentence(sentence: string, signal?: AbortSignal): Promise<SynthesizedAudioChunk> {
    if (signal?.aborted) {
      throw new Error('Synthesis aborted');
    }
    const plugin = getSierraLocalVoicePlugin();
    const res = await plugin.synthesizePiperSentence({ sentence });
    if (res?.ok && res.pcmBase64) {
      return {
        sentence,
        pcmBase64: res.pcmBase64,
        sampleRate: res.sampleRate || 22050,
      };
    }
    throw new Error(res?.reason || 'Piper synthesis unavailable');
  }

  public async stop(): Promise<void> {
    try {
      await getSierraLocalVoicePlugin().stopAudioPlayback();
    } catch {}
  }
}

export class AndroidSystemLocalTtsEngine implements LocalTtsEngine {
  public readonly id: LocalTtsEngineId = 'android_tts';

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async synthesizeSentence(sentence: string, _signal?: AbortSignal): Promise<SynthesizedAudioChunk> {
    return {
      sentence,
      sampleRate: 22050,
    };
  }

  public async stop(): Promise<void> {
    try {
      if (Capacitor.isNativePlatform()) {
        await TextToSpeech.stop();
      }
    } catch {}
  }
}

export interface LocalTtsQueueCoordinatorOptions {
  primaryEngine: LocalTtsEngine;
  fallbackEngine?: LocalTtsEngine;
  playChunkFn: (chunk: SynthesizedAudioChunk, turnId: number) => Promise<void>;
  onSentenceStarted?: (sentence: string, index: number, turnId: number) => void;
  onSentenceFinished?: (sentence: string, index: number, turnId: number) => void;
  onQueueDrained?: (turnId: number) => void;
  /** Maximum concurrent sentence prefetch/synthesis requests (default 2). */
  maxInFlightSynthesis?: number;
  /** Minimum character length before sending a sentence to TTS; shorter sentences batch into next (default 0). */
  minBatchChars?: number;
  /** Wait for explicit flushTurn(turnId) before firing onQueueDrained (default false). */
  waitForFlushTurn?: boolean;
}

/**
 * Guarantees that synthesis for sentence N+1 can overlap playback of sentence N
 * (bounded to maxInFlightSynthesis, default 2) while audio playback strictly
 * happens in sequential order and aborts all in-flight fetches on cancel/barge-in.
 */
export class LocalTtsQueueCoordinator {
  private readonly primaryEngine: LocalTtsEngine;
  private readonly fallbackEngine?: LocalTtsEngine;
  private readonly playChunkFn: (chunk: SynthesizedAudioChunk, turnId: number) => Promise<void>;
  private readonly onSentenceStarted?: (sentence: string, index: number, turnId: number) => void;
  private readonly onSentenceFinished?: (sentence: string, index: number, turnId: number) => void;
  private readonly onQueueDrained?: (turnId: number) => void;
  private readonly maxInFlightSynthesis: number;
  private readonly minBatchChars: number;
  private readonly waitForFlushTurn: boolean;

  private activeTurnId = 0;
  private cancelledTurnIds = new Set<number>();
  private turnAbortControllers = new Map<number, AbortController>();
  private pendingShortByTurn = new Map<number, string>();
  private flushedTurns = new Set<number>();
  private sentenceCounter = 0;
  private playbackChain: Promise<void> = Promise.resolve();
  private pendingCount = 0;
  private inFlightSynthesisCount = 0;
  private synthesisSlotWaiters: Array<() => void> = [];

  constructor(
    engineOrOptions: LocalTtsEngine | LocalTtsQueueCoordinatorOptions,
    legacyPlayFn?: (pcm16: Int16Array, sampleRate: number, sentenceText: string) => Promise<void>,
    legacyOnSpoken?: (sentenceText: string) => void,
  ) {
    if ('primaryEngine' in engineOrOptions) {
      this.primaryEngine = engineOrOptions.primaryEngine;
      this.fallbackEngine = engineOrOptions.fallbackEngine;
      this.playChunkFn = engineOrOptions.playChunkFn;
      this.onSentenceStarted = engineOrOptions.onSentenceStarted;
      this.onSentenceFinished = engineOrOptions.onSentenceFinished;
      this.onQueueDrained = engineOrOptions.onQueueDrained;
      this.maxInFlightSynthesis = Math.max(1, engineOrOptions.maxInFlightSynthesis ?? 2);
      this.minBatchChars = Math.max(0, engineOrOptions.minBatchChars ?? 0);
      this.waitForFlushTurn = Boolean(engineOrOptions.waitForFlushTurn);
    } else {
      this.primaryEngine = engineOrOptions;
      this.maxInFlightSynthesis = 2;
      this.minBatchChars = 0;
      this.waitForFlushTurn = false;
      this.playChunkFn = async (chunk) => {
        if (legacyPlayFn) {
          await legacyPlayFn(chunk.pcm16 || new Int16Array(0), chunk.sampleRate, chunk.sentence || '');
        }
      };
      this.onSentenceFinished = (sentence) => {
        legacyOnSpoken?.(sentence);
      };
    }
  }

  public beginTurn(turnId: number): void {
    // Abort any older turn controller still lingering
    for (const [oldTurnId, ctrl] of this.turnAbortControllers.entries()) {
      if (oldTurnId !== turnId) {
        try {
          ctrl.abort();
        } catch {}
        this.turnAbortControllers.delete(oldTurnId);
      }
    }
    this.activeTurnId = turnId;
    this.cancelledTurnIds.delete(turnId);
    this.flushedTurns.delete(turnId);
    this.pendingShortByTurn.delete(turnId);
    this.turnAbortControllers.set(turnId, new AbortController());
    this.sentenceCounter = 0;
    this.pendingCount = 0;
    this.playbackChain = Promise.resolve();
  }

  public getTurnSignal(turnId = this.activeTurnId): AbortSignal | undefined {
    return this.turnAbortControllers.get(turnId)?.signal;
  }

  public isTurnCancelled(turnId: number): boolean {
    return this.cancelledTurnIds.has(turnId) || turnId !== this.activeTurnId;
  }

  private async acquireSynthesisSlot(turnId: number): Promise<boolean> {
    while (this.inFlightSynthesisCount >= this.maxInFlightSynthesis) {
      if (this.isTurnCancelled(turnId)) {
        return false;
      }
      await new Promise<void>((resolve) => {
        this.synthesisSlotWaiters.push(resolve);
      });
    }
    if (this.isTurnCancelled(turnId)) {
      return false;
    }
    this.inFlightSynthesisCount += 1;
    return true;
  }

  private releaseSynthesisSlot(): void {
    this.inFlightSynthesisCount = Math.max(0, this.inFlightSynthesisCount - 1);
    const next = this.synthesisSlotWaiters.shift();
    if (next) {
      next();
    }
  }

  private enqueueReadySentence(clean: string, turnId: number): Promise<void> {
    if (!clean || this.isTurnCancelled(turnId)) {
      return Promise.resolve();
    }

    const capturedTurnId = turnId;
    const idx = ++this.sentenceCounter;
    this.pendingCount++;
    const turnSignal = this.turnAbortControllers.get(capturedTurnId)?.signal;

    // Prefetch/synthesize bounded by maxInFlightSynthesis (default 2) so N+1 is ready while N plays
    const synthesisPromise: Promise<SynthesizedAudioChunk> = (async () => {
      const acquired = await this.acquireSynthesisSlot(capturedTurnId);
      if (!acquired || this.isTurnCancelled(capturedTurnId) || turnSignal?.aborted) {
        return { sentence: clean, sampleRate: 22050 };
      }
      try {
        return await this.primaryEngine.synthesizeSentence(clean, turnSignal);
      } catch {
        if (this.isTurnCancelled(capturedTurnId) || turnSignal?.aborted) {
          return { sentence: clean, sampleRate: 22050 };
        }
        if (this.fallbackEngine) {
          try {
            return await this.fallbackEngine.synthesizeSentence(clean, turnSignal);
          } catch {
            return { sentence: clean, sampleRate: 22050 };
          }
        }
        return { sentence: clean, sampleRate: 22050 };
      } finally {
        this.releaseSynthesisSlot();
      }
    })();

    // Chain playback strictly in sequential order
    const nextStep = this.playbackChain.then(async () => {
      if (this.isTurnCancelled(capturedTurnId)) return;
      const chunk = await synthesisPromise;
      if (this.isTurnCancelled(capturedTurnId)) return;

      this.onSentenceStarted?.(clean, idx, capturedTurnId);
      await this.playChunkFn({ ...chunk, sentence: clean }, capturedTurnId);
      if (this.isTurnCancelled(capturedTurnId)) return;
      this.onSentenceFinished?.(clean, idx, capturedTurnId);
    });

    this.playbackChain = nextStep
      .catch(() => {})
      .finally(() => {
        if (!this.isTurnCancelled(capturedTurnId)) {
          this.pendingCount = Math.max(0, this.pendingCount - 1);
          const readyToDrain =
            this.pendingCount === 0 &&
            !this.pendingShortByTurn.has(capturedTurnId) &&
            (!this.waitForFlushTurn || this.flushedTurns.has(capturedTurnId));
          if (readyToDrain) {
            this.onQueueDrained?.(capturedTurnId);
          }
        }
      });

    return this.playbackChain;
  }

  public enqueueSentence(sentence: string, turnId = this.activeTurnId): Promise<void> {
    if (this.isTurnCancelled(turnId)) {
      return Promise.resolve();
    }
    const clean = sanitizeSpokenSentence(sentence);
    if (!clean) return Promise.resolve();

    if (this.minBatchChars > 0) {
      const priorShort = this.pendingShortByTurn.get(turnId);
      const combined = priorShort ? `${priorShort} ${clean}`.trim() : clean;
      if (combined.length < this.minBatchChars && !this.flushedTurns.has(turnId)) {
        this.pendingShortByTurn.set(turnId, combined);
        return this.playbackChain;
      }
      this.pendingShortByTurn.delete(turnId);
      return this.enqueueReadySentence(combined, turnId);
    }

    return this.enqueueReadySentence(clean, turnId);
  }

  public flushTurn(turnId = this.activeTurnId): Promise<void> {
    if (this.isTurnCancelled(turnId)) {
      return Promise.resolve();
    }
    this.flushedTurns.add(turnId);
    const trailing = this.pendingShortByTurn.get(turnId);
    if (trailing) {
      this.pendingShortByTurn.delete(turnId);
      return this.enqueueReadySentence(trailing, turnId);
    }
    if (this.pendingCount === 0) {
      this.onQueueDrained?.(turnId);
    }
    return this.playbackChain;
  }

  public async cancelAndClear(turnId?: number): Promise<void> {
    if (turnId !== undefined) {
      this.cancelledTurnIds.add(turnId);
    }
    this.cancelledTurnIds.add(this.activeTurnId);

    for (const ctrl of this.turnAbortControllers.values()) {
      try {
        ctrl.abort();
      } catch {}
    }
    this.turnAbortControllers.clear();
    this.pendingShortByTurn.clear();
    this.flushedTurns.clear();

    this.activeTurnId += 1;
    this.pendingCount = 0;
    this.playbackChain = Promise.resolve();

    // Wake any waiters blocked on synthesis slots so nothing hangs
    const waiters = this.synthesisSlotWaiters.splice(0, this.synthesisSlotWaiters.length);
    for (const w of waiters) {
      try {
        w();
      } catch {}
    }

    try {
      if (Capacitor.isNativePlatform()) {
        await TextToSpeech.stop();
      }
    } catch {}
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch {}
    await this.primaryEngine.stop().catch(() => {});
    if (this.fallbackEngine) {
      await this.fallbackEngine.stop().catch(() => {});
    }
  }
}

export const LOCAL_PROMPT_EVAL_STALL_TIMEOUT_MS = 45000;
export const LOCAL_TOKEN_GEN_STALL_TIMEOUT_MS = 20000;
export const LOCAL_COMPACT_MAX_SUMMARIES = 2;
export const LOCAL_COMPACT_MAX_MEMORY_CHARS = 300;
export const LOCAL_COMPACT_MAX_HISTORY_MESSAGES = 4;

export type LocalInferenceProgressPhase = 'prompt_eval' | 'generation';

/**
 * Progress-based stall detector for on-device LLM inference.
 * Replaces the flat 20s first-token watchdog:
 * - Resets timer on every completed prompt batch (`onPromptBatchCompleted`) and every generated token (`onTokenGenerated`).
 * - Stalls ONLY after 45s with no progress during `prompt_eval`, or 20s with no progress during `generation`.
 */
export class ProgressStallDetector {
  private phase: LocalInferenceProgressPhase = 'prompt_eval';
  private lastProgressMs: number;
  private completedBatches = 0;
  private generatedTokens = 0;
  private lastStageLabel = 'tokenizing';
  private readonly promptEvalTimeoutMs: number;
  private readonly tokenGenTimeoutMs: number;

  constructor(
    startTimeMs = Date.now(),
    promptEvalTimeoutMs = LOCAL_PROMPT_EVAL_STALL_TIMEOUT_MS,
    tokenGenTimeoutMs = LOCAL_TOKEN_GEN_STALL_TIMEOUT_MS,
  ) {
    this.lastProgressMs = startTimeMs;
    this.promptEvalTimeoutMs = promptEvalTimeoutMs;
    this.tokenGenTimeoutMs = tokenGenTimeoutMs;
  }

  public reset(nowMs = Date.now()): void {
    this.phase = 'prompt_eval';
    this.lastProgressMs = nowMs;
    this.completedBatches = 0;
    this.generatedTokens = 0;
    this.lastStageLabel = 'tokenizing';
  }

  public onPromptBatchCompleted(batchIdx: number, nowMs = Date.now()): void {
    this.phase = 'prompt_eval';
    this.completedBatches = Math.max(this.completedBatches, batchIdx + 1);
    this.lastProgressMs = nowMs;
    this.lastStageLabel = `prompt eval batch ${batchIdx}`;
  }

  public onPromptEvalFinished(nowMs = Date.now()): void {
    this.phase = 'generation';
    this.lastProgressMs = nowMs;
    this.lastStageLabel = 'sampling';
  }

  public onTokenGenerated(nowMs = Date.now()): void {
    this.phase = 'generation';
    this.generatedTokens += 1;
    this.lastProgressMs = nowMs;
    this.lastStageLabel = `token #${this.generatedTokens}`;
  }

  public getPhase(): LocalInferenceProgressPhase {
    return this.phase;
  }

  public getCompletedBatches(): number {
    return this.completedBatches;
  }

  public getGeneratedTokens(): number {
    return this.generatedTokens;
  }

  public evaluate(nowMs = Date.now()): {
    stalled: boolean;
    phase: LocalInferenceProgressPhase;
    elapsedSinceProgressMs: number;
    timeoutMs: number;
    reason: string;
  } {
    const elapsed = Math.max(0, nowMs - this.lastProgressMs);
    const timeoutMs =
      this.phase === 'prompt_eval' ? this.promptEvalTimeoutMs : this.tokenGenTimeoutMs;
    const stalled = elapsed >= timeoutMs;
    const reason = stalled
      ? `No progress for ${Math.round(elapsed / 1000)}s during ${this.phase === 'prompt_eval' ? 'prompt evaluation' : 'token generation'} (limit ${Math.round(timeoutMs / 1000)}s, last stage: "${this.lastStageLabel}")`
      : '';
    return {
      stalled,
      phase: this.phase,
      elapsedSinceProgressMs: elapsed,
      timeoutMs,
      reason,
    };
  }
}

export function estimateLocalTokenCount(text: string): number {
  if (!text) return 0;
  // Standard Llama-3 / Qwen2.5 English BPE token ratio (~3.8 chars per token)
  const byChars = Math.ceil(text.length / 3.8);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const byWords = Math.ceil(words * 1.32);
  return Math.max(1, Math.round((byChars + byWords) / 2));
}

export interface CompactLocalSystemPromptResult {
  systemPrompt: string;
  estimatedTokens: number;
  summaryCount: number;
  summaryChars: number;
  cacheKey: string;
}

/**
 * Builds a compact 250–400 token system prompt specifically for the Local (on-phone) provider:
 * - Identity (Sierra or Tyler) & Persona tone
 * - Content mode (SFW vs 18+ Mature for consenting adult characters)
 * - English-only spoken rule
 * - Honesty line (offline on-phone, local memory only)
 * - Max 2 memory summaries / 300 chars
 */
export function buildCompactLocalSystemPrompt(params: {
  personaId: PersonaId;
  contentMode: ContentMode;
  identity: CompanionIdentity;
  customDirectives?: string;
  injectMemory?: boolean;
}): CompactLocalSystemPromptResult {
  const identityObj = IDENTITIES[params.identity] || IDENTITIES.sierra;
  const personaObj = UNIFIED_PERSONAS[params.personaId] || UNIFIED_PERSONAS.classy;
  const memoryEnabled =
    params.injectMemory !== undefined ? Boolean(params.injectMemory) : isMemoryInjectionEnabled();

  let summaryCount = 0;
  let summaryChars = 0;
  let memoryBlock = 'Memory: No prior summaries stored on this phone yet.';

  if (!memoryEnabled) {
    memoryBlock = 'Memory: On-device memory injection is turned off in Settings.';
    addDebugLog('Memory', `[Memory] Injected 0/0 summaries, 0 chars for ${params.identity} (memory injection disabled)`);
  } else {
    const allForIdentity = getConversationSummaries(params.identity);
    const availableCount = allForIdentity.length;
    const recent = allForIdentity.slice(-LOCAL_COMPACT_MAX_SUMMARIES);
    if (recent.length > 0) {
      const lines: string[] = [];
      let usedChars = 0;
      for (const item of recent) {
        const dateStr = new Date(item.updatedAt).toISOString().split('T')[0];
        const rawLine = `- [${dateStr}] ${item.summary}`;
        const sep = lines.length > 0 ? 1 : 0;
        const budget = LOCAL_COMPACT_MAX_MEMORY_CHARS - usedChars - sep;
        if (budget <= 12) break;
        const clipped =
          rawLine.length > budget ? `${rawLine.slice(0, Math.max(0, budget - 3))}...` : rawLine;
        lines.push(clipped);
        usedChars += sep + clipped.length;
      }
      const joined = lines.join('\n').slice(0, LOCAL_COMPACT_MAX_MEMORY_CHARS);
      summaryCount = lines.length;
      summaryChars = joined.length;
      memoryBlock = `On-Device Memory Summaries (${summaryCount}/${availableCount}):\n${joined}`;
      addDebugLog(
        'Memory',
        `[Memory] Injected ${summaryCount} summaries, ${summaryChars} chars (available=${availableCount}, identity=${params.identity})`,
      );
    } else {
      addDebugLog('Memory', `[Memory] Injected 0 summaries, 0 chars (available=0, identity=${params.identity})`);
    }
  }

  const contentModeLine =
    params.contentMode === 'mature'
      ? 'Content Mode: 18+ Mature. You are open to candid adult humor, romance, intimacy, strong language, and consensual adult themes strictly between adult characters only, without preachy lectures or refusals.'
      : 'Content Mode: SFW (Safe For Work). Keep responses tasteful, respectful, and appropriate for general audiences while staying warm and engaging.';

  const customClipped = (params.customDirectives || '').trim().slice(0, 120);
  const personaSummary = `${personaObj.description} ${personaObj.roleEmphasis}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 190);

  const voiceCaps = getVoiceCapabilitiesState();
  const wakeStatus = voiceCaps.wakeWordEnabled ? 'wake word enabled' : 'no wake word';
  const bgStatus = voiceCaps.backgroundLiveEnabled ? 'background live enabled' : 'cannot hear while closed';

  const coreSections = [
    `Identity: You are ${identityObj.name}. Speak directly like a sharp, perceptive confidante—never like a corporate assistant or chatbot.`,
    `Style (${personaObj.name}): ${personaSummary}`,
    `LOCAL ON-DEVICE VOICE CONVERSATION RULES: Reply in English (en-US) using 1-2 short spoken sentences by default. Answer directly; do not end with a question unless genuinely needed. Keep trivial acknowledgements under 8 words. Never mention being an AI assistant, ask how to "better meet your needs", or narrate your own persona. NEVER use markdown, lists, asterisks, or emoji.`,
    contentModeLine,
    `Honesty: Local device memory only—you only know what is in the injected memory summaries and current chat; never claim total recall, internet access, ${wakeStatus}, or ${bgStatus}.`,
    memoryBlock,
  ];

  if (customClipped) {
    coreSections.push(`User Directives: ${customClipped}`);
  }

  let systemPrompt = coreSections.join('\n\n');
  let estimatedTokens = estimateLocalTokenCount(systemPrompt);

  // Enforce the 250–400 token window without ever truncating the spoken rules or memory block
  if (estimatedTokens < 250) {
    const cadenceExpansion =
      `\n\nTurn Pacing: Respond with immediate presence and natural phrasing, keeping the back-and-forth crisp and conversational with zero filler.`;
    systemPrompt += cadenceExpansion;
    estimatedTokens = estimateLocalTokenCount(systemPrompt);
  }
  if (estimatedTokens > 400) {
    // Shorten Style and Content Mode verbosity slightly if memory expansion pushes over 400 tokens
    coreSections[1] = `Style (${personaObj.name}): ${personaObj.description.slice(0, 95)}`;
    systemPrompt = coreSections.join('\n\n');
    estimatedTokens = estimateLocalTokenCount(systemPrompt);
    if (estimatedTokens > 400) {
      coreSections[3] =
        params.contentMode === 'mature'
          ? 'Content Mode: 18+ Mature. Candid adult themes and romance between adults only.'
          : 'Content Mode: SFW. Keep replies respectful and natural.';
      systemPrompt = coreSections.join('\n\n');
      estimatedTokens = Math.min(400, estimateLocalTokenCount(systemPrompt));
    }
  }

  const cacheKey = `${params.identity}|${params.personaId}|${params.contentMode}|${customClipped}|${summaryCount}:${summaryChars}:${memoryBlock.slice(0, 80)}`;

  return {
    systemPrompt,
    estimatedTokens,
    summaryCount,
    summaryChars,
    cacheKey,
  };
}

/**
 * Formats the static system prefix for KV-cache pre-warming and prefix reuse.
 */
export function formatLocalSystemPrefix(
  systemPrompt: string,
  chatTemplate: LocalChatTemplateId,
): string {
  if (chatTemplate === 'llama3') {
    return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>`;
  }
  return `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;
}

/**
 * Builds the compact Local (on-phone) conversation prompt:
 * - Compact 250–400 token system prompt (identity, persona tone, English-only rule, honesty line, max 2 summaries / 300 chars)
 * - History capped at the last 4 messages (or 0 when omitHistory=true on stall auto-retry)
 * - Logs final prompt token count
 */
export function buildLocalConversationPrompt(params: {
  personaId: PersonaId;
  contentMode: ContentMode;
  identity: CompanionIdentity;
  chatTemplate: LocalChatTemplateId;
  history?: LocalChatHistoryMessage[];
  turns?: LocalChatHistoryMessage[];
  userUtterance?: string;
  userMessage?: string;
  customDirectives?: string;
  injectMemory?: boolean;
  omitHistory?: boolean;
}): string {
  const compact = buildCompactLocalSystemPrompt({
    personaId: params.personaId,
    contentMode: params.contentMode,
    identity: params.identity,
    customDirectives: params.customDirectives,
    injectMemory: params.injectMemory,
  });

  const rawHistory = params.omitHistory ? [] : (params.history ?? params.turns ?? []);
  const historyList = rawHistory.slice(-LOCAL_COMPACT_MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: (m.content || '').trim().slice(0, 260),
  }));
  const latestUser = (params.userUtterance ?? params.userMessage ?? '').trim();

  let out = formatLocalSystemPrefix(compact.systemPrompt, params.chatTemplate);
  if (params.chatTemplate === 'llama3') {
    for (const msg of historyList) {
      out += `<|start_header_id|>${msg.role}<|end_header_id|>\n\n${msg.content}<|eot_id|>`;
    }
    if (
      latestUser &&
      (historyList.length === 0 || historyList[historyList.length - 1].content !== latestUser)
    ) {
      out += `<|start_header_id|>user<|end_header_id|>\n\n${latestUser}<|eot_id|>`;
    }
    out += `<|start_header_id|>assistant<|end_header_id|>\n\n`;
  } else {
    for (const msg of historyList) {
      out += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
    }
    if (
      latestUser &&
      (historyList.length === 0 || historyList[historyList.length - 1].content !== latestUser)
    ) {
      out += `<|im_start|>user\n${latestUser}<|im_end|>\n`;
    }
    out += `<|im_start|>assistant\n`;
  }

  const finalPromptTokens = estimateLocalTokenCount(out);
  addDebugLog(
    'LocalLLM:PromptBuilt',
    `Final prompt length: ${out.length} chars (finalPromptTokens=~${finalPromptTokens}, systemTokens=~${compact.estimatedTokens}, template=${params.chatTemplate}, summaries=${compact.summaryCount} [${compact.summaryChars} chars], historyMessages=${historyList.length})`,
  );
  return out;
}

/**
 * Native Capacitor Plugin interface for SierraLocalVoice (`LocalVoicePlugin.java`).
 */
export interface SierraLocalVoicePluginInterface {
  getStorageAndNetworkStatus(): Promise<{
    ok: boolean;
    isWifi: boolean;
    freeStorageBytes: number;
    modelsDirPath?: string;
    totalRamMb?: number;
    availableRamMb?: number;
    cpuCores?: number;
  }>;
  getModelsStatus(options: {
    models: Array<{ id: string; filename: string; sizeBytes: number; sha256: string | null }>;
  }): Promise<{
    ok: boolean;
    models: Record<
      string,
      {
        downloaded: boolean;
        partialBytes: number;
        sizeBytes: number;
        path?: string;
        hasBadFile?: boolean;
      }
    >;
  }>;
  downloadModel(options: {
    modelId: string;
    filename: string;
    downloadUrl: string;
    expectedSizeBytes: number;
    expectedSha256: string | null;
  }): Promise<{
    ok: boolean;
    state: LocalModelDownloadItemState;
    downloadedBytes: number;
    sha256Verified?: boolean;
    checksumUnverified?: boolean;
    expectedSha256?: string;
    actualSha256?: string;
    badFilePath?: string;
    reason?: string;
  }>;
  pauseDownload(options: { modelId: string }): Promise<{ ok: boolean }>;
  deleteModels(): Promise<{ ok: boolean; deletedCount: number; freedBytes: number }>;
  loadModels(options: {
    llmFilename: string;
    whisperFilename: string;
    vadFilename: string;
    piperFilename?: string;
    piperConfigFilename?: string;
    ttsEngine: LocalTtsEngineId;
    chatTemplate: LocalChatTemplateId;
    sttOnly?: boolean;
  }): Promise<{
    ok: boolean;
    oom?: boolean;
    reason?: string;
    activeTtsEngine?: LocalTtsEngineId;
    inferenceThreads?: number;
    selfTestText?: string;
    selfTestTokensPerSec?: number;
    selfTestElapsedMs?: number;
    lastNativeError?: string;
  }>;
  unloadModels(): Promise<{ ok: boolean }>;
  invalidateKvCache(options?: { reason?: string; systemPrefix?: string }): Promise<{
    ok: boolean;
    cachedTokens?: number;
  }>;
  ensureMicrophonePermission?(): Promise<{ granted: boolean; reason?: string }>;
  startLocalSession(options: {
    silenceTimeoutMs: number;
    minUtteranceMs: number;
    preRollMs: number;
    bargeInSustainedMs: number;
    bargeInThreshold: number;
    bargeInSpeakerBoost: number;
    bargeInMode?: BargeInModeSetting;
    micSource?: MicSourceSetting;
    saveLast10Utterances?: boolean;
    ttsEngine: LocalTtsEngineId;
    chatTemplate: LocalChatTemplateId;
    systemPrompt: string;
    systemPrefix?: string;
    cacheKey?: string;
  }): Promise<{
    ok: boolean;
    activeTtsEngine?: LocalTtsEngineId;
    inferenceThreads?: number;
    hasHeadset?: boolean;
    reason?: string;
  }>;
  stopLocalSession(): Promise<{ ok: boolean }>;
  interruptTurn(): Promise<{ ok: boolean }>;
  setSpeakingState(options: { speaking: boolean; turnId?: number; thinking?: boolean }): Promise<{ ok: boolean }>;
  generateLocalReply(options: {
    turnId: number;
    prompt: string;
    userUtterance: string;
    chatTemplate: LocalChatTemplateId;
    ttsEngine: LocalTtsEngineId;
    maxTokens?: number;
  }): Promise<{
    ok: boolean;
    replyText: string;
    tokensPerSec: number;
    timeToFirstAudioMs: number;
    totalLatencyMs: number;
    promptTokens?: number;
    cachedTokensReused?: number;
    promptEvalMs?: number;
    promptTokPerSec?: number;
    generatedTokens?: number;
    interrupted?: boolean;
    stopReason?: string;
    lastNativeError?: string;
    reason?: string;
  }>;
  synthesizePiperSentence(options: { sentence: string }): Promise<{
    ok: boolean;
    pcmBase64?: string;
    sampleRate?: number;
    activeTtsEngine?: LocalTtsEngineId;
    reason?: string;
  }>;
  playPcmAudio?(options: {
    pcmBase64: string;
    sampleRate?: number;
    turnId?: number;
  }): Promise<{ ok: boolean; interrupted?: boolean; reason?: string }>;
  isHeadsetConnected?(): Promise<{ connected: boolean; deviceType?: string }>;
  stopAudioPlayback(): Promise<{ ok: boolean }>;
  getMemoryAndSpeedStats(): Promise<LocalVoiceMemoryAndSpeedStats>;
  listDebugUtterances?(): Promise<{ ok: boolean; utterances: DebugUtteranceEntry[]; reason?: string }>;
  getDebugUtteranceAudio?(options: { id: string }): Promise<{
    ok: boolean;
    id?: string;
    wavBase64?: string;
    reason?: string;
  }>;
  clearDebugUtterances?(): Promise<{ ok: boolean; deletedCount?: number; reason?: string }>;
  addListener(
    eventName: string,
    listenerFunc: (event: any) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const NativeSierraLocalVoice = registerPlugin<SierraLocalVoicePluginInterface>('SierraLocalVoice');

let testLocalVoicePluginOverride: SierraLocalVoicePluginInterface | null = null;

export function __setLocalVoicePluginForTests(plugin: SierraLocalVoicePluginInterface | null): void {
  testLocalVoicePluginOverride = plugin;
}

export function getSierraLocalVoicePlugin(): SierraLocalVoicePluginInterface {
  if (testLocalVoicePluginOverride) return testLocalVoicePluginOverride;
  if (Capacitor.isNativePlatform()) {
    return NativeSierraLocalVoice;
  }
  // Browser / non-Android fallback so UI renders cleanly in web preview
  return {
    async getStorageAndNetworkStatus() {
      return {
        ok: true,
        isWifi: true,
        freeStorageBytes: 32 * 1024 * 1024 * 1024,
      };
    },
    async getModelsStatus({ models }) {
      const out: Record<string, { downloaded: boolean; partialBytes: number; sizeBytes: number }> = {};
      for (const m of models || []) {
        out[m.id] = { downloaded: false, partialBytes: 0, sizeBytes: m.sizeBytes };
      }
      return { ok: true, models: out };
    },
    async downloadModel() {
      return {
        ok: false,
        state: 'error',
        downloadedBytes: 0,
        reason: 'Local on-phone model download requires the Android app runtime.',
      };
    },
    async pauseDownload() {
      return { ok: true };
    },
    async deleteModels() {
      return { ok: true, deletedCount: 0, freedBytes: 0 };
    },
    async loadModels() {
      return { ok: false, reason: 'Local JNI inference requires the Android app runtime.' };
    },
    async unloadModels() {
      return { ok: true };
    },
    async invalidateKvCache() {
      return { ok: true, cachedTokens: 0 };
    },
    async ensureMicrophonePermission() {
      return { granted: true };
    },
    async startLocalSession() {
      return { ok: false, reason: 'Local audio pipeline requires the Android app runtime.' };
    },
    async stopLocalSession() {
      return { ok: true };
    },
    async interruptTurn() {
      return { ok: true };
    },
    async setSpeakingState() {
      return { ok: true };
    },
    async generateLocalReply() {
      return {
        ok: false,
        replyText: '',
        tokensPerSec: 0,
        timeToFirstAudioMs: 0,
        totalLatencyMs: 0,
        reason: 'Local LLM requires Android runtime.',
      };
    },
    async synthesizePiperSentence() {
      return { ok: false, activeTtsEngine: 'android_tts', reason: 'Piper ONNX requires Android runtime.' };
    },
    async playPcmAudio() {
      return { ok: false, reason: 'Native AudioTrack playback requires Android runtime.' };
    },
    async isHeadsetConnected() {
      return { connected: false, deviceType: 'speaker' };
    },
    async stopAudioPlayback() {
      return { ok: true };
    },
    async getMemoryAndSpeedStats() {
      return {
        usedRamMb: 0,
        availableRamMb: 8192,
        totalRamMb: 12288,
        tokensPerSec: 0,
        timeToFirstAudioMs: 0,
        lastTurnLatencyMs: 0,
        thermalStatus: 'none',
        modelLoaded: false,
      };
    },
    async listDebugUtterances() {
      return { ok: true, utterances: [] };
    },
    async getDebugUtteranceAudio({ id }) {
      return { ok: false, id, reason: 'Debug utterance audio requires the Android app runtime.' };
    },
    async clearDebugUtterances() {
      return { ok: true, deletedCount: 0 };
    },
    async addListener() {
      return { remove: async () => {} };
    },
  };
}

export async function ensureNativeLocalMicPermission(
  plugin: Pick<SierraLocalVoicePluginInterface, 'ensureMicrophonePermission'>,
  isNativePlatform: boolean = Capacitor.isNativePlatform(),
): Promise<{ granted: boolean; reason?: string }> {
  if (!isNativePlatform) {
    return { granted: true };
  }
  if (typeof plugin.ensureMicrophonePermission !== 'function') {
    return { granted: true };
  }
  try {
    const res = await plugin.ensureMicrophonePermission();
    return {
      granted: Boolean(res?.granted),
      reason: res?.reason,
    };
  } catch (err: any) {
    return {
      granted: false,
      reason: err?.message || String(err) || 'Failed to verify microphone permission.',
    };
  }
}
