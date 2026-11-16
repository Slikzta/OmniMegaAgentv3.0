import { useSyncExternalStore } from 'react';
import { addDebugLog } from './debugLogStore';
import { loadNonSecretStateFromNative, syncNonSecretStateToNative } from './emailTools';

export const STORAGE_KEY_SETTINGS_V3 = 'omni_settings_v3';
export const STORAGE_KEY_MIGRATION_BACKUP = 'omni_settings_migration_backup_v1';
export const STORAGE_KEY_UNIFIED_SETTINGS = 'omni_unified_settings_v1';

export type ProviderId =
  | 'gemini'
  | 'openrouter'
  | 'openai'
  | 'ollama'
  | 'local'
  | 'anthropic'
  | 'custom';

export const PRIMARY_PROVIDER_IDS: ProviderId[] = [
  'gemini',
  'openrouter',
  'openai',
  'ollama',
  'local',
];

export const ALL_PROVIDER_IDS: ProviderId[] = [
  'gemini',
  'openrouter',
  'openai',
  'ollama',
  'local',
  'anthropic',
  'custom',
];

export interface ProviderEndpointDefaults {
  httpEndpoint: string;
  wsEndpoint: string;
  supportsWs: boolean;
  requiresApiKey: boolean;
}

/**
 * ONLY location in the codebase permitted to hold default AI provider URLs.
 */
export const DEFAULT_PROVIDER_ENDPOINTS: Record<ProviderId, ProviderEndpointDefaults> = {
  gemini: {
    httpEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    wsEndpoint:
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
    supportsWs: true,
    requiresApiKey: true,
  },
  openrouter: {
    httpEndpoint: 'https://openrouter.ai/api/v1',
    wsEndpoint: '',
    supportsWs: false,
    requiresApiKey: true,
  },
  openai: {
    httpEndpoint: 'https://api.openai.com/v1',
    wsEndpoint: 'wss://api.openai.com/v1/realtime',
    supportsWs: true,
    requiresApiKey: true,
  },
  ollama: {
    httpEndpoint: 'http://localhost:11434',
    wsEndpoint: '',
    supportsWs: false,
    requiresApiKey: false,
  },
  local: {
    httpEndpoint: '',
    wsEndpoint: '',
    supportsWs: false,
    requiresApiKey: false,
  },
  anthropic: {
    httpEndpoint: 'https://api.anthropic.com',
    wsEndpoint: '',
    supportsWs: false,
    requiresApiKey: true,
  },
  custom: {
    httpEndpoint: 'https://api.groq.com/openai/v1',
    wsEndpoint: '',
    supportsWs: false,
    requiresApiKey: true,
  },
};

export const DEFAULT_OPENROUTER_PAID_MODEL =
  'cognitivecomputations/dolphin-mistral-24b-venice-edition';
export const DEFAULT_LIVE_GEMINI_MODEL = 'gemini-3.8-live';
export const DEFAULT_LIVE_GEMINI_WS_URL = DEFAULT_PROVIDER_ENDPOINTS.gemini.wsEndpoint;

export const LEGACY_SETTINGS_STORAGE_KEYS = [
  'omni_unified_settings_v1',
  'omni_active_provider',
  'sierra_explicit_chat_provider_v1',
  'omni_providers_config',
  'omni_provider_keys',
  'sierra_openrouter_api_key',
  'sierra_openrouter_model_settings_v1',
  'sierra_text_model',
  'sierra_text_custom_model',
  'sierra_model_gemini',
  'sierra_live_voice_provider',
  'sierra_live_voice_model',
  'sierra_live_voice_custom_model',
  'sierra_live_voice_endpoint',
  'sierra_gemini_thinking_level',
  'sierra_content_mode',
  'sierra_audio_output_mode',
  'sierra_bargein_sensitivity',
  'sierra_local_voice_settings_v1',
  'sierra_response_speed',
  'sierra_identity',
  'sierra_companion_identity',
  'sierra_voice_provider',
] as const;

export type ContentModeSetting = 'sfw' | 'mature';
export type CompanionIdentitySetting = 'sierra' | 'tyler';
export type ThinkingLevelSetting = 'LOW' | 'MEDIUM' | 'HIGH';
export type ResponseSpeedSetting = 'low' | 'medium' | 'high';
export type LiveVoiceProviderSetting = 'gemini' | 'local' | 'openrouter';
export type TtsProviderSetting = 'native' | 'openrouter';
export type AudioOutputModeSetting = 'speaker' | 'headphones';
export type BargeInSensitivitySetting = 'low' | 'medium' | 'high';
export type BargeInModeSetting = 'off' | 'headphones_only' | 'adaptive' | 'on';
export type LocalLlmPresetSetting = 'small' | 'default' | 'large' | 'custom';
export type WhisperModelPresetSetting = 'small.en' | 'base.en' | 'tiny.en';
export type MicSourceSetting = 'auto' | 'communication' | 'recognition';

export interface ProviderConfigV3 {
  apiKey: string;
  httpEndpoint: string;
  wsEndpoint: string;
  enabled: boolean;
}

export interface ModelsSettingsV3 {
  chatText: string;
  chatProvider: ProviderId;
  liveProvider: LiveVoiceProviderSetting;
  liveModel: string;
  liveCustomModelSlug: string;
  ttsProvider: TtsProviderSetting;
}

export interface UnifiedLocalVoiceSettings {
  llmPreset: LocalLlmPresetSetting;
  llmTier?: 'small' | 'default' | 'large' | 'custom';
  customGgufUrl: string;
  customGgufFilename?: string;
  customChatTemplate: 'llama3' | 'chatml';
  whisperSize: WhisperModelPresetSetting;
  whisperSizeUserSelected?: boolean;
  micSource?: MicSourceSetting;
  saveLast10Utterances?: boolean;
  ttsEngine: 'piper' | 'android_tts';
  silenceTimeoutMs: number;
  minUtteranceMs: number;
  preRollMs: number;
  bargeInSustainedMs: number;
  bargeInThreshold: number;
  bargeInSpeakerBoost: number;
  bargeInMode: BargeInModeSetting;
  injectMemory: boolean;
}

export interface ProviderChatModelEntry {
  selectedModel: string;
  customModel: string;
  thinkingLevel?: ThinkingLevelSetting | null;
}

export interface SettingsV3 {
  version: 3;
  providers: Record<ProviderId, ProviderConfigV3>;
  models: ModelsSettingsV3;
  contentMode: ContentModeSetting;
  activeIdentity: CompanionIdentitySetting;
  responseSpeed: ResponseSpeedSetting;
  customDirectives?: string;
  selectedPersona?: string;
  chatProviders: Record<ProviderId, ProviderChatModelEntry>;
  explicitChatProvider: ProviderId | null;
  live: {
    thinkingLevel: ThinkingLevelSetting | null;
    audioOutputMode: AudioOutputModeSetting;
    bargeInSensitivity: BargeInSensitivitySetting;
    language?: string;
    voiceInputEngine?: 'raw_streaming' | 'native_stt';
    openRouterModel: string;
    openRouterCustomSlug: string;
    openRouterTryFreeFirst: boolean;
    openRouterLastErrorText: string;
    openRouterLastErrorModel: string;
    local: UnifiedLocalVoiceSettings;
  };
}

export const DEFAULT_LOCAL_VOICE_SETTINGS: UnifiedLocalVoiceSettings = {
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

export const DEFAULT_CHAT_MODELS_BY_PROVIDER: Record<ProviderId, ProviderChatModelEntry> = {
  gemini: {
    selectedModel: 'gemini-3.5-flash-lite',
    customModel: '',
  },
  openrouter: {
    selectedModel: DEFAULT_OPENROUTER_PAID_MODEL,
    customModel: '',
  },
  openai: {
    selectedModel: 'gpt-4o',
    customModel: '',
  },
  ollama: {
    selectedModel: 'llama3.2',
    customModel: '',
  },
  local: {
    selectedModel: 'llama3.2',
    customModel: '',
  },
  anthropic: {
    selectedModel: 'claude-3-7-sonnet-latest',
    customModel: '',
  },
  custom: {
    selectedModel: 'llama-3.3-70b-versatile',
    customModel: '',
  },
};

export function createDefaultSettingsV3(): SettingsV3 {
  const providers = {} as Record<ProviderId, ProviderConfigV3>;
  const chatProviders = {} as Record<ProviderId, ProviderChatModelEntry>;

  for (const pid of ALL_PROVIDER_IDS) {
    const defEp = DEFAULT_PROVIDER_ENDPOINTS[pid];
    providers[pid] = {
      apiKey: '',
      httpEndpoint: defEp.httpEndpoint,
      wsEndpoint: defEp.wsEndpoint,
      enabled: pid === 'gemini' || pid === 'openrouter' || pid === 'openai' || pid === 'ollama' || pid === 'local',
    };
    chatProviders[pid] = { ...DEFAULT_CHAT_MODELS_BY_PROVIDER[pid] };
  }

  return {
    version: 3,
    providers,
    models: {
      chatText: DEFAULT_CHAT_MODELS_BY_PROVIDER.gemini.selectedModel,
      chatProvider: 'gemini',
      liveProvider: 'gemini',
      liveModel: DEFAULT_LIVE_GEMINI_MODEL,
      liveCustomModelSlug: '',
      ttsProvider: 'native',
    },
    contentMode: 'sfw',
    activeIdentity: 'sierra',
    responseSpeed: 'medium',
    customDirectives: '',
    selectedPersona: 'classy',
    chatProviders,
    explicitChatProvider: null,
    live: {
      thinkingLevel: null,
      audioOutputMode: 'speaker',
      bargeInSensitivity: 'medium',
      language: 'en-US',
      voiceInputEngine: 'raw_streaming',
      openRouterModel: DEFAULT_OPENROUTER_PAID_MODEL,
      openRouterCustomSlug: '',
      openRouterTryFreeFirst: false,
      openRouterLastErrorText: '',
      openRouterLastErrorModel: '',
      local: { ...DEFAULT_LOCAL_VOICE_SETTINGS },
    },
  };
}

const DEFAULT_EMPTY_V3_SNAPSHOT: SettingsV3 = createDefaultSettingsV3();

/**
 * Strips whitespace, newlines, zero-width characters, surrounding quotes, and optional Bearer prefix.
 * Invoked on BOTH save and read for every provider key.
 */
export function trimAndNormalizeApiKey(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();

  for (let i = 0; i < 3; i++) {
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2)
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    if (/^bearer\s+/i.test(cleaned)) {
      cleaned = cleaned.replace(/^bearer\s+/i, '').trim();
    }
  }

  return cleaned.replace(/[\r\n\t]+/g, '').trim();
}

export function normalizeOpenRouterApiKey(raw: string | null | undefined): string {
  return trimAndNormalizeApiKey(raw);
}

export function normalizeProviderId(id: string | null | undefined): ProviderId {
  if (!id || typeof id !== 'string') return 'gemini';
  const trimmed = id.trim().toLowerCase();
  if (trimmed === 'google') return 'gemini';
  if ((ALL_PROVIDER_IDS as string[]).includes(trimmed)) {
    return trimmed as ProviderId;
  }
  return 'gemini';
}

export interface EndpointValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

export function validateHttpEndpoint(raw: string | null | undefined, allowEmpty = false): EndpointValidationResult {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return allowEmpty
      ? { valid: true, normalized: '' }
      : { valid: false, normalized: '', error: 'HTTP Endpoint URL cannot be empty.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        normalized: trimmed,
        error: 'HTTP Endpoint must start with http:// or https://',
      };
    }
    return { valid: true, normalized: trimmed };
  } catch {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Enter a valid HTTP URL (e.g. https://api.openai.com/v1).',
    };
  }
}

export function validateWsEndpoint(raw: string | null | undefined, allowEmpty = true): EndpointValidationResult {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return allowEmpty
      ? { valid: true, normalized: '' }
      : { valid: false, normalized: '', error: 'WebSocket URL cannot be empty.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return {
        valid: false,
        normalized: trimmed,
        error: 'WebSocket URL must start with ws:// or wss://',
      };
    }
    return { valid: true, normalized: trimmed };
  } catch {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Enter a valid WebSocket URL (e.g. wss://...).',
    };
  }
}

function normalizeThinkingLevelOrNull(raw: unknown): ThinkingLevelSetting | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH') {
    return upper;
  }
  return null;
}

function normalizeContentMode(raw: unknown): ContentModeSetting {
  return raw === 'mature' ? 'mature' : 'sfw';
}

function normalizeIdentity(raw: unknown): CompanionIdentitySetting {
  return raw === 'tyler' ? 'tyler' : 'sierra';
}

function normalizeResponseSpeed(raw: unknown): ResponseSpeedSetting {
  return raw === 'low' || raw === 'high' ? raw : 'medium';
}

function normalizeLiveProvider(raw: unknown): LiveVoiceProviderSetting {
  if (raw === 'local' || raw === 'openrouter' || raw === 'gemini') return raw;
  return 'gemini';
}

function normalizeTtsProvider(raw: unknown): TtsProviderSetting {
  return raw === 'openrouter' ? 'openrouter' : 'native';
}

function normalizeAudioOutputMode(raw: unknown): AudioOutputModeSetting {
  return raw === 'headphones' ? 'headphones' : 'speaker';
}

function normalizeBargeInSensitivity(raw: unknown): BargeInSensitivitySetting {
  if (raw === 'low' || raw === 'high') return raw;
  return 'medium';
}

function normalizeBargeInMode(raw: unknown): BargeInModeSetting {
  if (raw === 'off' || raw === 'on' || raw === 'headphones_only' || raw === 'adaptive') return raw;
  return 'headphones_only';
}

function safeParseJson<T = Record<string, any>>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function isLocalhostOllamaUrl(url?: string): boolean {
  const u = (url || '').trim().toLowerCase();
  if (!u) return true;
  return (
    u.includes('localhost:11434') ||
    u.includes('127.0.0.1:11434') ||
    u.includes('10.0.2.2:11434')
  );
}

function normalizeSettingsV3(raw: Partial<SettingsV3> | null | undefined): SettingsV3 {
  const base = createDefaultSettingsV3();
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  base.contentMode = normalizeContentMode(raw.contentMode);
  base.activeIdentity = normalizeIdentity(raw.activeIdentity);
  base.responseSpeed = normalizeResponseSpeed(raw.responseSpeed);
  base.customDirectives = typeof raw.customDirectives === 'string' ? raw.customDirectives : '';
  base.selectedPersona =
    typeof raw.selectedPersona === 'string' && raw.selectedPersona.trim() ? raw.selectedPersona.trim() : 'classy';
  base.explicitChatProvider =
    typeof raw.explicitChatProvider === 'string' && raw.explicitChatProvider.trim()
      ? normalizeProviderId(raw.explicitChatProvider)
      : null;

  const rawProviders = raw.providers && typeof raw.providers === 'object' ? raw.providers : ({} as any);
  for (const pid of ALL_PROVIDER_IDS) {
    const defEp = DEFAULT_PROVIDER_ENDPOINTS[pid];
    const rp = rawProviders[pid] && typeof rawProviders[pid] === 'object' ? rawProviders[pid] : {};
    const cleanedHttp = typeof rp.httpEndpoint === 'string' ? rp.httpEndpoint.trim().replace(/\/+$/, '') : '';
    const cleanedWs = typeof rp.wsEndpoint === 'string' ? rp.wsEndpoint.trim() : '';

    base.providers[pid] = {
      apiKey: trimAndNormalizeApiKey(rp.apiKey),
      httpEndpoint: cleanedHttp || defEp.httpEndpoint,
      wsEndpoint: defEp.supportsWs ? cleanedWs || defEp.wsEndpoint : '',
      enabled: typeof rp.enabled === 'boolean' ? rp.enabled : base.providers[pid].enabled,
    };
  }

  const rawChatProviders =
    raw.chatProviders && typeof raw.chatProviders === 'object' ? raw.chatProviders : ({} as any);
  for (const pid of ALL_PROVIDER_IDS) {
    const defEntry = DEFAULT_CHAT_MODELS_BY_PROVIDER[pid];
    const rc = rawChatProviders[pid] && typeof rawChatProviders[pid] === 'object' ? rawChatProviders[pid] : {};
    const entry: ProviderChatModelEntry = {
      selectedModel:
        typeof rc.selectedModel === 'string' && rc.selectedModel.trim()
          ? rc.selectedModel.trim()
          : defEntry.selectedModel,
      customModel: typeof rc.customModel === 'string' ? rc.customModel.trim() : '',
    };
    const tl = normalizeThinkingLevelOrNull(rc.thinkingLevel);
    if (tl) {
      entry.thinkingLevel = tl;
    }
    base.chatProviders[pid] = entry;
  }

  const rawModels = raw.models && typeof raw.models === 'object' ? raw.models : ({} as any);
  const chatProvider = normalizeProviderId(rawModels.chatProvider);
  const fallbackChatText =
    base.chatProviders[chatProvider]?.customModel?.trim() ||
    base.chatProviders[chatProvider]?.selectedModel ||
    DEFAULT_CHAT_MODELS_BY_PROVIDER[chatProvider].selectedModel;

  const chatText =
    typeof rawModels.chatText === 'string' && rawModels.chatText.trim()
      ? rawModels.chatText.trim()
      : fallbackChatText;

  const liveProvider = normalizeLiveProvider(rawModels.liveProvider);
  const rawLive = raw.live && typeof raw.live === 'object' ? raw.live : ({} as any);
  const resolvedLiveModel =
    typeof rawModels.liveModel === 'string' && rawModels.liveModel.trim()
      ? rawModels.liveModel.trim()
      : liveProvider === 'openrouter'
        ? (typeof rawLive.openRouterModel === 'string' && rawLive.openRouterModel.trim()) ||
          DEFAULT_OPENROUTER_PAID_MODEL
        : DEFAULT_LIVE_GEMINI_MODEL;
  const resolvedLiveSlug =
    typeof rawModels.liveCustomModelSlug === 'string' ? rawModels.liveCustomModelSlug.trim() : '';

  base.models = {
    chatProvider,
    chatText,
    liveProvider,
    liveModel: resolvedLiveModel,
    liveCustomModelSlug: resolvedLiveSlug,
    ttsProvider: normalizeTtsProvider(rawModels.ttsProvider),
  };

  base.live = {
    thinkingLevel: normalizeThinkingLevelOrNull(rawLive.thinkingLevel),
    audioOutputMode: normalizeAudioOutputMode(rawLive.audioOutputMode),
    bargeInSensitivity: normalizeBargeInSensitivity(rawLive.bargeInSensitivity),
    language:
      typeof rawLive.language === 'string' && rawLive.language.trim() ? rawLive.language.trim() : 'en-US',
    voiceInputEngine: rawLive.voiceInputEngine === 'native_stt' ? 'native_stt' : 'raw_streaming',
    openRouterModel:
      liveProvider === 'openrouter'
        ? resolvedLiveModel
        : (typeof rawLive.openRouterModel === 'string' && rawLive.openRouterModel.trim()) ||
          DEFAULT_OPENROUTER_PAID_MODEL,
    openRouterCustomSlug:
      liveProvider === 'openrouter'
        ? resolvedLiveSlug
        : typeof rawLive.openRouterCustomSlug === 'string'
          ? rawLive.openRouterCustomSlug.trim()
          : '',
    openRouterTryFreeFirst: Boolean(rawLive.openRouterTryFreeFirst),
    openRouterLastErrorText:
      typeof rawLive.openRouterLastErrorText === 'string' ? rawLive.openRouterLastErrorText : '',
    openRouterLastErrorModel:
      typeof rawLive.openRouterLastErrorModel === 'string' ? rawLive.openRouterLastErrorModel : '',
    local: {
      ...DEFAULT_LOCAL_VOICE_SETTINGS,
      ...(rawLive.local && typeof rawLive.local === 'object' ? rawLive.local : {}),
      whisperSize:
        rawLive.local?.whisperSize === 'small.en' ||
        rawLive.local?.whisperSize === 'base.en' ||
        rawLive.local?.whisperSize === 'tiny.en'
          ? rawLive.local.whisperSize
          : DEFAULT_LOCAL_VOICE_SETTINGS.whisperSize,
      whisperSizeUserSelected: Boolean(rawLive.local?.whisperSizeUserSelected),
      micSource:
        rawLive.local?.micSource === 'communication' || rawLive.local?.micSource === 'recognition'
          ? rawLive.local.micSource
          : 'auto',
      saveLast10Utterances: Boolean(rawLive.local?.saveLast10Utterances),
      bargeInMode: normalizeBargeInMode(rawLive.local?.bargeInMode),
      bargeInThreshold:
        typeof rawLive.local?.bargeInThreshold === 'number' && !Number.isNaN(rawLive.local.bargeInThreshold)
          ? Math.max(0.2, Math.min(0.95, rawLive.local.bargeInThreshold))
          : DEFAULT_LOCAL_VOICE_SETTINGS.bargeInThreshold,
      bargeInSpeakerBoost: 0,
      bargeInSustainedMs:
        typeof rawLive.local?.bargeInSustainedMs === 'number' && !Number.isNaN(rawLive.local.bargeInSustainedMs)
          ? Math.max(400, Math.min(2000, rawLive.local.bargeInSustainedMs))
          : DEFAULT_LOCAL_VOICE_SETTINGS.bargeInSustainedMs,
      injectMemory:
        typeof rawLive.local?.injectMemory === 'boolean'
          ? rawLive.local.injectMemory
          : DEFAULT_LOCAL_VOICE_SETTINGS.injectMemory,
    },
  };

  return base;
}

function hasAnyPreV3KeyInStorage(): boolean {
  if (typeof localStorage === 'undefined') return false;
  for (const key of LEGACY_SETTINGS_STORAGE_KEYS) {
    if (localStorage.getItem(key) !== null) {
      return true;
    }
  }
  return false;
}

const subscribers = new Set<() => void>();
let lastRawSerialized: string | null = null;
let cachedSnapshot: SettingsV3 = DEFAULT_EMPTY_V3_SNAPSHOT;

function notifyAllSubscribers(extraEvents: string[] = []): void {
  for (const listener of subscribers) {
    try {
      listener();
    } catch {
      // Ignore individual subscriber errors
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('omni_settings_v3_updated'));
    window.dispatchEvent(new CustomEvent('omni_unified_settings_updated'));
    for (const evtName of extraEvents) {
      window.dispatchEvent(new CustomEvent(evtName));
    }
  }
}

export function stripSecretsFromSettingsV3(settings: SettingsV3): SettingsV3 {
  const sanitizedProviders = {} as Record<ProviderId, ProviderConfigV3>;
  for (const pid of ALL_PROVIDER_IDS) {
    sanitizedProviders[pid] = {
      ...settings.providers[pid],
      apiKey: '',
    };
  }
  return {
    ...settings,
    providers: sanitizedProviders,
  };
}

function persistSettingsV3(next: SettingsV3, extraEvents: string[] = []): SettingsV3 {
  const normalized = normalizeSettingsV3(next);
  const serialized = JSON.stringify(normalized);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_SETTINGS_V3, serialized);
  }
  lastRawSerialized = serialized;
  cachedSnapshot = normalized;

  const nonSecretSerialized = JSON.stringify(stripSecretsFromSettingsV3(normalized));
  void syncNonSecretStateToNative(STORAGE_KEY_SETTINGS_V3, nonSecretSerialized);

  notifyAllSubscribers(extraEvents);
  return normalized;
}

/**
 * One-time migration from legacy keys and omni_unified_settings_v1 into omni_settings_v3.
 * Saves a backup of migrated pre-v3 raw values in omni_settings_migration_backup_v1
 * and leaves per-persona voice configs (`sierra_live_voice_config_*` / `sierra_chat_voice_config_*`) untouched.
 */
export function migrateOnceToV3(): SettingsV3 {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_EMPTY_V3_SNAPSHOT;
  }

  const existingV3Raw = localStorage.getItem(STORAGE_KEY_SETTINGS_V3);
  const existingBackupRaw = localStorage.getItem(STORAGE_KEY_MIGRATION_BACKUP);
  const anyLegacy = hasAnyPreV3KeyInStorage();

  if (existingV3Raw && (existingBackupRaw || !anyLegacy)) {
    const parsed = normalizeSettingsV3(safeParseJson<SettingsV3>(existingV3Raw));
    if (existingV3Raw !== lastRawSerialized) {
      lastRawSerialized = existingV3Raw;
      cachedSnapshot = parsed;
    }
    return cachedSnapshot;
  }

  if (!anyLegacy && !existingV3Raw) {
    lastRawSerialized = null;
    cachedSnapshot = DEFAULT_EMPTY_V3_SNAPSHOT;
    return DEFAULT_EMPTY_V3_SNAPSHOT;
  }

  const base = existingV3Raw
    ? normalizeSettingsV3(safeParseJson<SettingsV3>(existingV3Raw))
    : createDefaultSettingsV3();

  // Save raw backup of any pre-v3 keys found (leaving original keys intact)
  const rawBackupEntries: Record<string, string> = {};
  for (const key of LEGACY_SETTINGS_STORAGE_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) {
      rawBackupEntries[key] = val;
    }
  }
  if (Object.keys(rawBackupEntries).length > 0) {
    const existingBackup = safeParseJson<Record<string, any>>(
      localStorage.getItem(STORAGE_KEY_MIGRATION_BACKUP)
    );
    const mergedBackup = {
      migratedAt: new Date().toISOString(),
      rawKeys: {
        ...(existingBackup?.rawKeys && typeof existingBackup.rawKeys === 'object'
          ? existingBackup.rawKeys
          : {}),
        ...rawBackupEntries,
      },
    };
    localStorage.setItem(STORAGE_KEY_MIGRATION_BACKUP, JSON.stringify(mergedBackup));
  }

  // 1. Fold omni_unified_settings_v1 (v1 unified store) if present
  const unifiedV1 = safeParseJson<Record<string, any>>(localStorage.getItem(STORAGE_KEY_UNIFIED_SETTINGS));
  if (unifiedV1) {
    if (unifiedV1.contentMode) {
      base.contentMode = normalizeContentMode(unifiedV1.contentMode);
    }
    if (unifiedV1.responseSpeed) {
      base.responseSpeed = normalizeResponseSpeed(unifiedV1.responseSpeed);
    }
    if (unifiedV1.keys && typeof unifiedV1.keys === 'object') {
      for (const pid of ALL_PROVIDER_IDS) {
        const cleaned = trimAndNormalizeApiKey(unifiedV1.keys[pid]);
        if (cleaned) {
          base.providers[pid].apiKey = cleaned;
        }
      }
    }
    if (unifiedV1.chat && typeof unifiedV1.chat === 'object') {
      if (unifiedV1.chat.explicitProvider) {
        base.explicitChatProvider = normalizeProviderId(unifiedV1.chat.explicitProvider);
      }
      if (unifiedV1.chat.activeProvider) {
        base.models.chatProvider = normalizeProviderId(unifiedV1.chat.activeProvider);
      }
      const v1Providers =
        unifiedV1.chat.providers && typeof unifiedV1.chat.providers === 'object'
          ? unifiedV1.chat.providers
          : {};
      for (const [rawPid, entry] of Object.entries(v1Providers)) {
        const pid = normalizeProviderId(rawPid);
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, any>;
        if (typeof e.baseUrl === 'string' && e.baseUrl.trim()) {
          base.providers[pid].httpEndpoint = e.baseUrl.trim().replace(/\/+$/, '');
        }
        if (typeof e.selectedModel === 'string' && e.selectedModel.trim()) {
          base.chatProviders[pid].selectedModel = e.selectedModel.trim();
        }
        if (typeof e.customModel === 'string') {
          base.chatProviders[pid].customModel = e.customModel.trim();
        }
        const tl = normalizeThinkingLevelOrNull(e.thinkingLevel);
        if (tl) {
          base.chatProviders[pid].thinkingLevel = tl;
        }
      }
      const cp = base.models.chatProvider;
      base.models.chatText =
        base.chatProviders[cp]?.customModel?.trim() ||
        base.chatProviders[cp]?.selectedModel ||
        DEFAULT_CHAT_MODELS_BY_PROVIDER[cp].selectedModel;
    }
    if (unifiedV1.live && typeof unifiedV1.live === 'object') {
      const l = unifiedV1.live;
      base.models.liveProvider = normalizeLiveProvider(l.provider);
      if (base.models.liveProvider === 'openrouter') {
        base.models.liveModel =
          (typeof l.openRouterModel === 'string' && l.openRouterModel.trim()) ||
          DEFAULT_OPENROUTER_PAID_MODEL;
        base.models.liveCustomModelSlug =
          typeof l.openRouterCustomSlug === 'string' ? l.openRouterCustomSlug.trim() : '';
      } else {
        base.models.liveModel =
          (typeof l.geminiModel === 'string' && l.geminiModel.trim()) || DEFAULT_LIVE_GEMINI_MODEL;
        base.models.liveCustomModelSlug =
          typeof l.geminiCustomModel === 'string' ? l.geminiCustomModel.trim() : '';
      }
      if (typeof l.geminiWsUrl === 'string' && l.geminiWsUrl.trim()) {
        base.providers.gemini.wsEndpoint = l.geminiWsUrl.trim();
      }
      base.live.thinkingLevel = normalizeThinkingLevelOrNull(l.thinkingLevel);
      base.live.audioOutputMode = normalizeAudioOutputMode(l.audioOutputMode);
      base.live.bargeInSensitivity = normalizeBargeInSensitivity(l.bargeInSensitivity);
      if (typeof l.openRouterModel === 'string' && l.openRouterModel.trim()) {
        base.live.openRouterModel = l.openRouterModel.trim();
      }
      if (typeof l.openRouterCustomSlug === 'string') {
        base.live.openRouterCustomSlug = l.openRouterCustomSlug.trim();
      }
      base.live.openRouterTryFreeFirst = Boolean(l.openRouterTryFreeFirst);
      base.live.openRouterLastErrorText =
        typeof l.openRouterLastErrorText === 'string' ? l.openRouterLastErrorText : '';
      base.live.openRouterLastErrorModel =
        typeof l.openRouterLastErrorModel === 'string' ? l.openRouterLastErrorModel : '';
      if (l.local && typeof l.local === 'object') {
        base.live.local = {
          ...base.live.local,
          ...l.local,
        };
      }
    }
  }

  // 2. Fold raw pre-v1 legacy keys if present
  const legacyActiveProviderRaw = localStorage.getItem('omni_active_provider');
  const legacyExplicitProviderRaw = localStorage.getItem('sierra_explicit_chat_provider_v1');
  const legacyConfig = safeParseJson<Record<string, any>>(localStorage.getItem('omni_providers_config'));
  const legacyKeysMap = safeParseJson<Record<string, string>>(localStorage.getItem('omni_provider_keys'));
  const legacyOpenRouterKeyRaw = localStorage.getItem('sierra_openrouter_api_key');
  const legacyOrModelSettings = safeParseJson<Record<string, any>>(
    localStorage.getItem('sierra_openrouter_model_settings_v1')
  );
  const legacyTextModel = localStorage.getItem('sierra_text_model');
  const legacyTextCustomModel = localStorage.getItem('sierra_text_custom_model');
  const legacyGeminiModel = localStorage.getItem('sierra_model_gemini');
  const legacyLiveProvider = localStorage.getItem('sierra_live_voice_provider');
  const legacyLiveModel = localStorage.getItem('sierra_live_voice_model');
  const legacyLiveCustomModel = localStorage.getItem('sierra_live_voice_custom_model');
  const legacyLiveEndpoint = localStorage.getItem('sierra_live_voice_endpoint');
  const legacyThinkingLevel = localStorage.getItem('sierra_gemini_thinking_level');
  const legacyContentMode = localStorage.getItem('sierra_content_mode');
  const legacyAudioOutputMode = localStorage.getItem('sierra_audio_output_mode');
  const legacyBargeInSensitivity = localStorage.getItem('sierra_bargein_sensitivity');
  const legacyLocalVoice = safeParseJson<Record<string, any>>(
    localStorage.getItem('sierra_local_voice_settings_v1')
  );
  const legacyResponseSpeed = localStorage.getItem('sierra_response_speed');
  const legacyIdentity =
    localStorage.getItem('sierra_identity') || localStorage.getItem('sierra_companion_identity');
  const legacyVoiceProvider = localStorage.getItem('sierra_voice_provider');

  if (legacyKeysMap) {
    for (const k of ALL_PROVIDER_IDS) {
      if (k === 'openrouter') continue;
      const val = trimAndNormalizeApiKey(legacyKeysMap[k]);
      if (val && !base.providers[k].apiKey) {
        base.providers[k].apiKey = val;
      }
    }
  }
  if (legacyConfig) {
    for (const [rawPid, entry] of Object.entries(legacyConfig)) {
      const pid = normalizeProviderId(rawPid);
      if (!entry || typeof entry !== 'object') continue;
      const val = trimAndNormalizeApiKey(entry.apiKey);
      if (val && pid !== 'openrouter' && !base.providers[pid].apiKey) {
        base.providers[pid].apiKey = val;
      }
      if (typeof entry.baseUrl === 'string' && entry.baseUrl.trim()) {
        base.providers[pid].httpEndpoint = entry.baseUrl.trim().replace(/\/+$/, '');
      }
      if (typeof entry.wsEndpoint === 'string' && entry.wsEndpoint.trim() && DEFAULT_PROVIDER_ENDPOINTS[pid].supportsWs) {
        base.providers[pid].wsEndpoint = entry.wsEndpoint.trim();
      }
      if (typeof entry.enabled === 'boolean') {
        base.providers[pid].enabled = entry.enabled;
      }
      if (typeof entry.selectedModel === 'string' && entry.selectedModel.trim()) {
        base.chatProviders[pid].selectedModel = entry.selectedModel.trim();
      }
      if (typeof entry.customModel === 'string') {
        base.chatProviders[pid].customModel = entry.customModel.trim();
      }
      const tl = normalizeThinkingLevelOrNull(entry.thinkingLevel);
      if (tl) {
        base.chatProviders[pid].thinkingLevel = tl;
        if (pid === 'gemini') base.live.thinkingLevel = tl;
      }
    }
  }

  // OpenRouter key precedence: existing v3/v1 > sierra_openrouter_api_key > omni_provider_keys > omni_providers_config > custom
  const orKeyDirect = trimAndNormalizeApiKey(legacyOpenRouterKeyRaw);
  const orKeyConfig = trimAndNormalizeApiKey(legacyConfig?.openrouter?.apiKey);
  const orKeyMap = trimAndNormalizeApiKey(legacyKeysMap?.openrouter);
  const customIsOr =
    typeof legacyConfig?.custom?.baseUrl === 'string' &&
    legacyConfig.custom.baseUrl.toLowerCase().includes('openrouter.ai');
  const customKeyNorm = trimAndNormalizeApiKey(legacyConfig?.custom?.apiKey);
  const orKeyCustom = customIsOr || customKeyNorm.startsWith('sk-or-') ? customKeyNorm : '';
  const mergedOrKey = base.providers.openrouter.apiKey || orKeyDirect || orKeyMap || orKeyConfig || orKeyCustom;
  if (mergedOrKey) {
    base.providers.openrouter.apiKey = mergedOrKey;
  }

  if (legacyTextModel && legacyTextModel.trim()) {
    base.chatProviders.gemini.selectedModel = legacyTextModel.trim();
  } else if (legacyGeminiModel && legacyGeminiModel.trim()) {
    base.chatProviders.gemini.selectedModel = legacyGeminiModel.trim();
  }
  if (legacyTextCustomModel !== null) {
    base.chatProviders.gemini.customModel = legacyTextCustomModel.trim();
  }

  if (legacyExplicitProviderRaw && legacyExplicitProviderRaw.trim()) {
    base.explicitChatProvider = normalizeProviderId(legacyExplicitProviderRaw);
  }
  if (legacyActiveProviderRaw && legacyActiveProviderRaw.trim()) {
    base.models.chatProvider = normalizeProviderId(legacyActiveProviderRaw);
  }

  // Stale localhost Ollama safeguard
  if (
    base.models.chatProvider === 'ollama' &&
    !base.explicitChatProvider &&
    isLocalhostOllamaUrl(base.providers.ollama.httpEndpoint)
  ) {
    const fallbackProv: ProviderId = base.providers.openrouter.apiKey ? 'openrouter' : 'gemini';
    base.models.chatProvider = fallbackProv;
    addDebugLog(
      'Settings:Migration',
      `Detected stale unconfigured default Ollama provider; migrated active chatProvider to "${fallbackProv}".`
    );
  }

  // Sync chatText cleanly if any legacy chat config or text model updated it
  if (
    legacyActiveProviderRaw ||
    legacyTextModel ||
    legacyGeminiModel ||
    legacyTextCustomModel !== null ||
    legacyConfig
  ) {
    const cp = base.models.chatProvider;
    base.models.chatText =
      base.chatProviders[cp]?.customModel?.trim() ||
      base.chatProviders[cp]?.selectedModel ||
      DEFAULT_CHAT_MODELS_BY_PROVIDER[cp].selectedModel;
  }

  if (legacyLiveProvider) {
    base.models.liveProvider = normalizeLiveProvider(legacyLiveProvider);
  }
  if (legacyOrModelSettings) {
    if (typeof legacyOrModelSettings.selectedModel === 'string' && legacyOrModelSettings.selectedModel.trim()) {
      if (base.models.liveProvider === 'openrouter') {
        base.models.liveModel = legacyOrModelSettings.selectedModel.trim();
      }
      if (!legacyConfig?.openrouter?.selectedModel) {
        base.chatProviders.openrouter.selectedModel = legacyOrModelSettings.selectedModel.trim();
      }
    }
    const slug =
      (typeof legacyOrModelSettings.customModelSlug === 'string' && legacyOrModelSettings.customModelSlug.trim()) ||
      (typeof legacyOrModelSettings.customSlug === 'string' && legacyOrModelSettings.customSlug.trim()) ||
      '';
    if (slug && base.models.liveProvider === 'openrouter') {
      base.models.liveCustomModelSlug = slug;
    }
    if (typeof legacyOrModelSettings.lastErrorText === 'string') {
      base.live.openRouterLastErrorText = legacyOrModelSettings.lastErrorText;
    }
    if (typeof legacyOrModelSettings.lastErrorModel === 'string') {
      base.live.openRouterLastErrorModel = legacyOrModelSettings.lastErrorModel;
    }
  }
  if (legacyLiveModel && legacyLiveModel.trim() && base.models.liveProvider !== 'openrouter') {
    base.models.liveModel = legacyLiveModel.trim();
  }
  if (legacyLiveCustomModel !== null && base.models.liveProvider !== 'openrouter') {
    base.models.liveCustomModelSlug = legacyLiveCustomModel.trim();
  }
  if (legacyLiveEndpoint && legacyLiveEndpoint.trim()) {
    base.providers.gemini.wsEndpoint = legacyLiveEndpoint.trim();
  }
  if (legacyThinkingLevel !== null) {
    const parsedTl = normalizeThinkingLevelOrNull(legacyThinkingLevel);
    if (parsedTl) base.live.thinkingLevel = parsedTl;
  }
  if (legacyContentMode) base.contentMode = normalizeContentMode(legacyContentMode);
  if (legacyAudioOutputMode) base.live.audioOutputMode = normalizeAudioOutputMode(legacyAudioOutputMode);
  if (legacyBargeInSensitivity) base.live.bargeInSensitivity = normalizeBargeInSensitivity(legacyBargeInSensitivity);
  if (legacyResponseSpeed) base.responseSpeed = normalizeResponseSpeed(legacyResponseSpeed);
  if (legacyIdentity) base.activeIdentity = normalizeIdentity(legacyIdentity);
  if (legacyVoiceProvider) base.models.ttsProvider = normalizeTtsProvider(legacyVoiceProvider);
  if (legacyLocalVoice) {
    base.live.local = {
      ...base.live.local,
      ...legacyLocalVoice,
    };
  }

  const legacyCustomDirectives = localStorage.getItem('sierra_custom_directives');
  const legacySelectedPersona = localStorage.getItem('sierra_selected_persona');
  const legacyLiveLanguage = localStorage.getItem('sierra_live_language');
  const legacyVoiceInputEngine = localStorage.getItem('sierra_voice_input_engine');
  if (legacyCustomDirectives !== null && !base.customDirectives) {
    base.customDirectives = legacyCustomDirectives;
  }
  if (legacySelectedPersona && legacySelectedPersona.trim()) {
    base.selectedPersona = legacySelectedPersona.trim();
  }
  if (legacyLiveLanguage && legacyLiveLanguage.trim()) {
    base.live.language = legacyLiveLanguage.trim();
  }
  if (legacyVoiceInputEngine === 'native_stt' || legacyVoiceInputEngine === 'native_recognizer') {
    base.live.voiceInputEngine = 'native_stt';
  } else if (legacyVoiceInputEngine === 'raw_streaming') {
    base.live.voiceInputEngine = 'raw_streaming';
  }

  const normalized = normalizeSettingsV3(base);
  const serialized = JSON.stringify(normalized);
  localStorage.setItem(STORAGE_KEY_SETTINGS_V3, serialized);
  if (!localStorage.getItem(STORAGE_KEY_MIGRATION_BACKUP)) {
    localStorage.setItem(
      STORAGE_KEY_MIGRATION_BACKUP,
      JSON.stringify({ migratedAt: new Date().toISOString(), rawKeys: {} })
    );
  }
  lastRawSerialized = serialized;
  cachedSnapshot = normalized;

  const nonSecretSerialized = JSON.stringify(stripSecretsFromSettingsV3(normalized));
  void syncNonSecretStateToNative(STORAGE_KEY_SETTINGS_V3, nonSecretSerialized);

  addDebugLog(
    'Settings:Migrated',
    `Migrated legacy settings into ${STORAGE_KEY_SETTINGS_V3} (old keys preserved; backup saved to ${STORAGE_KEY_MIGRATION_BACKUP}).`
  );
  return normalized;
}

/**
 * Authoritative reader for omni_settings_v3.
 * Performs one-time migration from pre-v3 keys automatically when needed.
 */
export function getSettings(): SettingsV3 {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_EMPTY_V3_SNAPSHOT;
  }
  const existingV3Raw = localStorage.getItem(STORAGE_KEY_SETTINGS_V3);
  const existingBackupRaw = localStorage.getItem(STORAGE_KEY_MIGRATION_BACKUP);
  if ((!existingV3Raw || !existingBackupRaw) && hasAnyPreV3KeyInStorage()) {
    return migrateOnceToV3();
  }
  const raw = existingV3Raw;
  if (!raw) {
    lastRawSerialized = null;
    cachedSnapshot = DEFAULT_EMPTY_V3_SNAPSHOT;
    return DEFAULT_EMPTY_V3_SNAPSHOT;
  }
  if (raw === lastRawSerialized && cachedSnapshot) {
    return cachedSnapshot;
  }
  const parsed = normalizeSettingsV3(safeParseJson<SettingsV3>(raw));
  lastRawSerialized = raw;
  cachedSnapshot = parsed;
  return parsed;
}

/**
 * Atomically mutates omni_settings_v3, persists to localStorage + Android SharedPreferences
 * (with API keys stripped), and notifies all React subscribers.
 */
export function updateSettings(
  updater: (current: SettingsV3) => SettingsV3,
  extraEvents: string[] = []
): SettingsV3 {
  const current = getSettings();
  const draft: SettingsV3 = normalizeSettingsV3(JSON.parse(JSON.stringify(current)));
  const updated = updater(draft);
  return persistSettingsV3(updated, extraEvents);
}

/**
 * Hydrates non-secret settings from Android SharedPreferences backup while
 * keeping local API keys intact.
 */
export async function hydrateSettingsFromNative(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  try {
    const existingRaw = localStorage.getItem(STORAGE_KEY_SETTINGS_V3);
    if (!existingRaw && !hasAnyPreV3KeyInStorage()) {
      const nativeRaw =
        (await loadNonSecretStateFromNative(STORAGE_KEY_SETTINGS_V3)) ||
        (await loadNonSecretStateFromNative(STORAGE_KEY_UNIFIED_SETTINGS));
      if (nativeRaw) {
        const current = getSettings();
        const parsed = normalizeSettingsV3(safeParseJson<SettingsV3>(nativeRaw));
        for (const pid of ALL_PROVIDER_IDS) {
          parsed.providers[pid].apiKey = current.providers[pid]?.apiKey || '';
        }
        const serialized = JSON.stringify(parsed);
        localStorage.setItem(STORAGE_KEY_SETTINGS_V3, serialized);
        lastRawSerialized = serialized;
        cachedSnapshot = parsed;
        notifyAllSubscribers(['omni_providers_updated', 'sierra_live_model_updated']);
      }
    }
  } catch {
    // Non-fatal on web or when plugin is unavailable
  }
}

export function subscribeSettings(listener: () => void): () => void {
  subscribers.add(listener);
  if (typeof window === 'undefined') {
    return () => {
      subscribers.delete(listener);
    };
  }
  const handleStorage = (e: StorageEvent) => {
    if (!e.key || e.key === STORAGE_KEY_SETTINGS_V3) {
      listener();
    }
  };
  window.addEventListener('storage', handleStorage);
  return () => {
    subscribers.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function useSettings(): SettingsV3 {
  return useSyncExternalStore(
    subscribeSettings,
    getSettings,
    () => DEFAULT_EMPTY_V3_SNAPSHOT
  );
}

export function getProviderConfig(providerId: string): ProviderConfigV3 {
  const pid = normalizeProviderId(providerId);
  const settings = getSettings();
  const entry = settings.providers[pid];
  const def = DEFAULT_PROVIDER_ENDPOINTS[pid];
  return {
    apiKey: trimAndNormalizeApiKey(entry?.apiKey),
    httpEndpoint: (entry?.httpEndpoint || def.httpEndpoint || '').trim().replace(/\/+$/, ''),
    wsEndpoint: def.supportsWs ? (entry?.wsEndpoint || def.wsEndpoint || '').trim() : '',
    enabled: entry?.enabled ?? true,
  };
}

export function getProviderHttpEndpoint(providerId: string): string {
  return getProviderConfig(providerId).httpEndpoint;
}

export function getProviderWsEndpoint(providerId: string): string {
  return getProviderConfig(providerId).wsEndpoint;
}

export function getProviderApiKey(providerId: string): string {
  const pid = normalizeProviderId(providerId);
  const raw = getSettings().providers[pid]?.apiKey;
  return trimAndNormalizeApiKey(raw);
}

export interface KeyResolutionResult {
  apiKey: string;
  source: string;
  last4: string;
}

/**
 * Strictly reads API key from settingsStore (omni_settings_v3) with trim-on-read.
 * Never returns any key outside the settings store.
 */
export function resolveProviderKeyWithSource(providerId: string): KeyResolutionResult {
  const pid = normalizeProviderId(providerId);
  const storedKey = getProviderApiKey(pid);
  if (storedKey) {
    return {
      apiKey: storedKey,
      source: `${STORAGE_KEY_SETTINGS_V3}:providers.${pid}.apiKey`,
      last4: storedKey.slice(-4) || 'none',
    };
  }
  return {
    apiKey: '',
    source: 'none',
    last4: 'none',
  };
}

export function resolveOpenRouterKeyWithSourceFromStore(): KeyResolutionResult {
  return resolveProviderKeyWithSource('openrouter');
}

export function formatShortModelDisplayName(modelId: string): string {
  const trimmed = (modelId || '').trim();
  if (!trimmed) return 'Default';
  if (trimmed === DEFAULT_OPENROUTER_PAID_MODEL) {
    return 'Dolphin 24B';
  }
  const tail = trimmed.split('/').pop() || trimmed;
  return tail.length > 34 ? `${tail.slice(0, 31)}...` : tail;
}

export function getCustomDirectives(): string {
  const fromStore = getSettings().customDirectives;
  if (typeof fromStore === 'string' && fromStore.length > 0) return fromStore;
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('sierra_custom_directives') || '';
  }
  return '';
}

export function setCustomDirectives(val: string): string {
  const cleaned = typeof val === 'string' ? val : '';
  updateSettings((draft) => {
    draft.customDirectives = cleaned;
    return draft;
  });
  return cleaned;
}

export function getLiveLanguageSetting(): string {
  const fromStore = getSettings().live?.language;
  if (fromStore && fromStore.trim()) return fromStore.trim();
  if (typeof localStorage !== 'undefined') {
    const legacy = localStorage.getItem('sierra_live_language');
    if (legacy && legacy.trim()) return legacy.trim();
  }
  return 'en-US';
}

export function setLiveLanguageSetting(lang: string): string {
  const cleaned = (lang || 'en-US').trim() || 'en-US';
  updateSettings((draft) => {
    draft.live.language = cleaned;
    return draft;
  });
  return cleaned;
}

export function getVoiceInputEngineSetting(): 'raw_streaming' | 'native_stt' {
  const fromStore = getSettings().live?.voiceInputEngine;
  if (fromStore === 'native_stt' || fromStore === 'raw_streaming') return fromStore;
  if (typeof localStorage !== 'undefined') {
    const legacy = localStorage.getItem('sierra_voice_input_engine');
    if (legacy === 'native_stt' || legacy === 'native_recognizer') return 'native_stt';
  }
  return 'raw_streaming';
}

export function setVoiceInputEngineSetting(engine: 'raw_streaming' | 'native_stt'): 'raw_streaming' | 'native_stt' {
  const valid = engine === 'native_stt' ? 'native_stt' : 'raw_streaming';
  updateSettings((draft) => {
    draft.live.voiceInputEngine = valid;
    return draft;
  });
  return valid;
}

export function getSelectedPersonaSetting(): string {
  const fromStore = getSettings().selectedPersona;
  if (fromStore && fromStore.trim()) return fromStore.trim();
  if (typeof localStorage !== 'undefined') {
    const legacy = localStorage.getItem('sierra_selected_persona');
    if (legacy && legacy.trim()) return legacy.trim();
  }
  return 'classy';
}

export function setSelectedPersonaSetting(personaId: string): string {
  const cleaned = (personaId || 'classy').trim() || 'classy';
  updateSettings((draft) => {
    draft.selectedPersona = cleaned;
    return draft;
  });
  return cleaned;
}

// --- Backward-compatibility wrappers so existing imports/tests stay compatible ---
export const migrateLegacySettingsIntoUnifiedStore = migrateOnceToV3;
export const getUnifiedSettings = getSettings;
export const updateUnifiedSettings = updateSettings;
export const subscribeUnifiedSettings = subscribeSettings;
export const useUnifiedSettings = useSettings;
export const hydrateUnifiedSettingsFromNative = hydrateSettingsFromNative;
export const stripSecretsForBackup = stripSecretsFromSettingsV3;
export const createDefaultUnifiedSettings = createDefaultSettingsV3;
export type UnifiedSettings = SettingsV3;
