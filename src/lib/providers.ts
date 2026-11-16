import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { isGeminiLiveModel, isGeminiLiveExtendedThinkingModel, testGeminiLiveWebSocket, streamGeminiLiveWebSocket } from './gemini';
import {
  ContentMode,
  SIERRA_SAFETY_SETTINGS,
  ThinkingLevel,
  getStoredGeminiThinkingLevel,
  validateThinkingLevel,
  getOpenRouterApiKey,
  normalizeOpenRouterApiKey,
  resolveOpenRouterApiKeyWithSource,
} from './persona';
import { addDebugLog } from './debugLogStore';
import {
  parseOpenRouterErrorResponse,
  formatOpenRouterFreeModelLabel,
} from './openRouterLive';
import { getContentMode } from './contentModeStore';
import {
  ALL_GEMINI_MODELS,
  DEFAULT_TEXT_MODEL,
  getStoredTextCustomModel,
  setStoredTextCustomModel,
  setStoredTextModel,
  resolveFallbackApiModelId,
  logQuotaOrRateLimitError,
  isQuotaOrRateLimitError,
  doesModelSupportMapsGrounding,
} from '../config/models';
import { getAllSierraFunctionDeclarations, executeSierraToolCall } from './toolRouter';
import {
  DEFAULT_CHAT_MODELS_BY_PROVIDER,
  DEFAULT_OPENROUTER_PAID_MODEL,
  DEFAULT_OPENROUTER_PAID_MODEL as OPENROUTER_DEFAULT_PAID_MODEL,
  DEFAULT_PROVIDER_ENDPOINTS,
  getProviderApiKey,
  getProviderHttpEndpoint,
  getProviderWsEndpoint,
  getSettings,
  migrateOnceToV3,
  normalizeProviderId,
  resolveProviderKeyWithSource,
  subscribeSettings,
  trimAndNormalizeApiKey,
  updateSettings,
  validateHttpEndpoint,
  validateWsEndpoint,
  type ProviderId as StoreProviderId,
} from './settingsStore';

function formatProvider401Error(providerId: string, rawDetail?: string): string {
  const name = PROVIDER_METADATA[providerId]?.name || providerId;
  const suffix = rawDetail ? ` (${rawDetail.slice(0, 140)})` : '';
  return `Invalid or unrecognized API key for ${name}${suffix}`;
}

function createProviderHttpError(
  message: string,
  status: number,
  auth401Provider?: string
): Error & { status: number; auth401Provider?: string } {
  const err = new Error(message) as Error & { status: number; auth401Provider?: string };
  err.status = status;
  if (auth401Provider) {
    err.auth401Provider = auth401Provider;
  }
  return err;
}

export type ProviderId = 'gemini' | 'openrouter' | 'openai' | 'anthropic' | 'custom' | 'ollama';

export const OLLAMA_UNREACHABLE_MESSAGE =
  'Ollama server not reachable from this phone. Switch provider or set an endpoint URL';

export const GEMINI_QUOTA_EXHAUSTED_MESSAGE = 'Gemini quota exhausted';

export function isGeminiQuotaExhaustedError(errOrMessage: unknown, statusCode?: number): boolean {
  if (statusCode === 429) return true;
  const msg =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : (errOrMessage as any)?.message || String(errOrMessage || '');
  return (
    msg.toLowerCase().includes('gemini quota exhausted') ||
    isQuotaOrRateLimitError(msg, statusCode)
  );
}

export function isOllamaUnreachableFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /failed to fetch|networkerror|load failed|econnrefused|err_connection_refused/i.test(msg);
}

export function formatOllamaConnectionError(err: unknown): string {
  if (isOllamaUnreachableFetchError(err)) {
    return OLLAMA_UNREACHABLE_MESSAGE;
  }
  return err instanceof Error ? err.message : String(err || OLLAMA_UNREACHABLE_MESSAGE);
}

/**
 * Ollama-unreachable fallback order:
 * 1. OpenRouter (if a key exists)
 * 2. Gemini
 */
export function resolveFallbackDefaultChatProvider(
  overrideKeys?: Record<string, string>,
): { provider: string; model: string } {
  const keys = overrideKeys || getNativeStoredKeys();
  const orKey = (
    overrideKeys
      ? overrideKeys.openrouter || ''
      : getOpenRouterApiKey() || keys.openrouter || ''
  ).trim();
  if (orKey) {
    return {
      provider: 'openrouter',
      model: getSelectedModelForProvider('openrouter') || OPENROUTER_DEFAULT_PAID_MODEL,
    };
  }
  return { provider: 'gemini', model: DEFAULT_TEXT_MODEL };
}

export type ResponseSpeedLevel = 'low' | 'medium' | 'high';
export const STORAGE_KEY_RESPONSE_SPEED = 'sierra_response_speed';

export function getResponseSpeed(): ResponseSpeedLevel {
  return getSettings().responseSpeed;
}

export function setResponseSpeed(level: ResponseSpeedLevel): ResponseSpeedLevel {
  const safeLevel: ResponseSpeedLevel =
    level === 'low' || level === 'medium' || level === 'high' ? level : 'medium';
  updateSettings((draft) => {
    draft.responseSpeed = safeLevel;
    return draft;
  });
  return safeLevel;
}

/**
 * Checks whether the selected model and provider support response speed / thinking budget controls.
 */
export function doesModelSupportResponseSpeed(modelId?: string, providerId?: string): boolean {
  const prov = (providerId || getActiveProviderId() || 'gemini').toLowerCase();
  const m = (modelId || '').toLowerCase();
  if (prov === 'gemini') {
    if (isGeminiLiveModel(m)) return false;
    return m.includes('gemini-2.5') || m.includes('gemini-3') || m.includes('flash') || m.includes('pro');
  }
  if (prov === 'openai' || prov === 'custom') {
    return m.startsWith('o1') || m.startsWith('o3') || m.includes('deepseek-r1') || m.includes('reason');
  }
  if (prov === 'anthropic') {
    return m.includes('claude-3-7') || m.includes('claude-4');
  }
  return false;
}

/**
 * Maps ResponseSpeedLevel ('low' = fastest/minimal thinking, 'medium' = balanced, 'high' = max thinking)
 * to the provider-specific thinking/reasoning parameter.
 */
export function buildModelThinkingConfig(
  modelId?: string,
  providerId?: string,
  level?: ResponseSpeedLevel
): {
  geminiThinkingConfig?: { thinkingBudget: number };
  openaiReasoningEffort?: 'low' | 'medium' | 'high';
  anthropicThinking?: { type: 'enabled'; budget_tokens: number } | undefined;
} {
  const effectiveLevel = level || getResponseSpeed();
  if (!doesModelSupportResponseSpeed(modelId, providerId)) {
    return {};
  }
  const prov = (providerId || getActiveProviderId() || 'gemini').toLowerCase();
  if (prov === 'gemini') {
    const budget = effectiveLevel === 'low' ? 0 : effectiveLevel === 'high' ? 8192 : 1024;
    return { geminiThinkingConfig: { thinkingBudget: budget } };
  }
  if (prov === 'openai' || prov === 'custom') {
    return { openaiReasoningEffort: effectiveLevel };
  }
  if (prov === 'anthropic') {
    if (effectiveLevel === 'low') return {};
    return {
      anthropicThinking: {
        type: 'enabled',
        budget_tokens: effectiveLevel === 'high' ? 4096 : 1024,
      },
    };
  }
  return {};
}

export interface ProviderContentCapability {
  matureSupport: 'full' | 'permissive' | 'moderate' | 'filtered';
  matureBadge: string;
  notes: string;
  recommendedForMature: boolean;
  recommendedModels: string[];
}

export const PROVIDER_CONTENT_CAPABILITIES: Record<string, ProviderContentCapability> = {
  openrouter: {
    matureSupport: 'full',
    matureBadge: 'Uncensored / Full Adult 18+ Support',
    notes: 'Reuses your OpenRouter key for uncensored cloud models (Dolphin Mistral 24B Venice Edition default, custom slugs, and runtime free models).',
    recommendedForMature: true,
    recommendedModels: [OPENROUTER_DEFAULT_PAID_MODEL, 'nousresearch/hermes-3-llama-3.1-70b'],
  },
  custom: {
    matureSupport: 'full',
    matureBadge: 'Unrestricted / Full Adult Support',
    notes: 'Optimal for uncensored adult conversations, intimate flirtation, and consensual roleplay (e.g. via OpenRouter, Groq, or DeepSeek).',
    recommendedForMature: true,
    recommendedModels: ['llama-3.3-70b-versatile', 'deepseek-chat', 'mistralai/mistral-large'],
  },
  ollama: {
    matureSupport: 'full',
    matureBadge: '100% Private & Uncensored (Local)',
    notes: 'Runs locally on your device with complete privacy, zero external monitoring, and no content filters.',
    recommendedForMature: true,
    recommendedModels: ['llama3.2', 'mistral', 'qwen2.5'],
  },
  anthropic: {
    matureSupport: 'permissive',
    matureBadge: 'Deep Romance & Emotional Intimacy',
    notes: 'Exceptional at emotional attunement, consensual romantic relationships, adult humor, and complex creative writing.',
    recommendedForMature: true,
    recommendedModels: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest'],
  },
  gemini: {
    matureSupport: 'moderate',
    matureBadge: 'BLOCK_NONE Permissive Thresholds',
    notes: 'Configured with BLOCK_NONE thresholds. Supports adult humor, flirtatious banter, and mature creative discussions.',
    recommendedForMature: false,
    recommendedModels: ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview'],
  },
  openai: {
    matureSupport: 'filtered',
    matureBadge: 'Strictly Filtered (SFW-Preferred)',
    notes: 'Supports everyday conversations, wit, and mild romance, but automated moderation blocks sexually explicit content.',
    recommendedForMature: false,
    recommendedModels: ['gpt-4o', 'gpt-4o-mini'],
  },
};

export interface ModelOption {
  id: string;
  name: string;
}

export interface ProviderMeta {
  name: string;
  badge: string;
  description: string;
  models: ModelOption[];
  defaultUrl?: string;
  urlPlaceholder?: string;
  needsKey: boolean;
}

export const PROVIDER_METADATA: Record<string, ProviderMeta> = {
  gemini: {
    name: 'Google Gemini',
    badge: 'Native • Multimodal • Live Voice',
    description: 'High-speed reasoning, 2M+ context window, Google Search and Maps grounding, and Gemini Live Voice.',
    models: ALL_GEMINI_MODELS.map((m) => ({
      id: m.id,
      name: m.badge ? `${m.label} (${m.badge})` : m.label,
    })),
    defaultUrl: DEFAULT_PROVIDER_ENDPOINTS.gemini.httpEndpoint,
    urlPlaceholder: DEFAULT_PROVIDER_ENDPOINTS.gemini.httpEndpoint,
    needsKey: true,
  },
  openrouter: {
    name: 'OpenRouter',
    badge: 'Uncensored • Dolphin 24B • Free & Paid',
    description: 'Fast cloud uncensored models using your existing OpenRouter key, with runtime free model discovery and custom model slugs.',
    models: [
      {
        id: OPENROUTER_DEFAULT_PAID_MODEL,
        name: 'Dolphin Mistral 24B Venice Edition (Paid Default ~$0.20/$0.90/M)',
      },
    ],
    defaultUrl: DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint,
    urlPlaceholder: DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint,
    needsKey: true,
  },
  openai: {
    name: 'OpenAI',
    badge: 'GPT-4o • Reasoning',
    description: 'Industry-standard flagship models with multimodal vision and conversational reasoning.',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (Omni Multimodal)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Cost-effective)' },
      { id: 'o1', name: 'o1 (Deep STEM Reasoning)' },
      { id: 'o3-mini', name: 'o3-mini (Next-Gen Reasoning)' },
    ],
    defaultUrl: DEFAULT_PROVIDER_ENDPOINTS.openai.httpEndpoint,
    urlPlaceholder: DEFAULT_PROVIDER_ENDPOINTS.openai.httpEndpoint,
    needsKey: true,
  },
  ollama: {
    name: 'Ollama (Local / Remote)',
    badge: 'Private • Offline • Self-Hosted',
    description: 'Run private local open-source models on your local machine or reachable local network host.',
    models: [
      { id: 'llama3.2', name: 'Llama 3.2 (Default)' },
      { id: 'mistral', name: 'Mistral 7B' },
      { id: 'qwen2.5', name: 'Qwen 2.5' },
      { id: 'custom-ollama', name: 'Custom Ollama Model' },
    ],
    defaultUrl: DEFAULT_PROVIDER_ENDPOINTS.ollama.httpEndpoint,
    urlPlaceholder: DEFAULT_PROVIDER_ENDPOINTS.ollama.httpEndpoint,
    needsKey: false,
  },
  local: {
    name: 'On-Device Local',
    badge: 'Offline • GGUF + Whisper',
    description: 'Run local quantized GGUF models with Whisper STT and Piper/Android TTS completely offline.',
    models: [
      { id: 'llama3.2', name: 'Local GGUF (Default)' },
    ],
    defaultUrl: DEFAULT_PROVIDER_ENDPOINTS.local.httpEndpoint,
    urlPlaceholder: '',
    needsKey: false,
  },
  anthropic: {
    name: 'Anthropic Claude',
    badge: 'Claude 3.7 • Extended Thinking',
    description: 'Nuanced conversational prose, human-like empathy, creative roleplay, and deep technical comprehension.',
    models: [
      { id: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)' },
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet (Nuanced & Sharp)' },
      { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku (Instant Pacing)' },
    ],
    defaultUrl: DEFAULT_PROVIDER_ENDPOINTS.anthropic.httpEndpoint,
    urlPlaceholder: DEFAULT_PROVIDER_ENDPOINTS.anthropic.httpEndpoint,
    needsKey: true,
  },
  custom: {
    name: 'Custom OpenAI-Compatible',
    badge: 'Groq • Together • DeepSeek • LocalAI',
    description: 'Any OpenAI API compatible endpoint including Groq, Together AI, DeepSeek, vLLM, or OpenRouter.',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'custom-model', name: 'Custom Model ID (Type below)' },
    ],
    defaultUrl: DEFAULT_PROVIDER_ENDPOINTS.custom.httpEndpoint,
    urlPlaceholder: DEFAULT_PROVIDER_ENDPOINTS.custom.httpEndpoint,
    needsKey: false,
  },
};

export interface ProviderInfo {
  id: string;
  name: string;
  selectedModel: string;
  customModel?: string;
  baseUrl?: string;
  thinkingLevel?: ThinkingLevel;
  hasKey: boolean;
  isEnvKey?: boolean;
  contentCapability?: ProviderContentCapability;
  capabilities: {
    text: boolean;
    streaming: boolean;
    multimodal: boolean;
    grounding: boolean;
    imageGen: boolean;
    videoGen: boolean;
    liveVoice: boolean;
  };
}

export interface ProvidersConfigResponse {
  activeProvider: string;
  providers: Record<string, ProviderInfo>;
}

export const STORAGE_KEY_CONFIG = 'omni_providers_config';
export const STORAGE_KEY_ACTIVE = 'omni_active_provider';
export const STORAGE_KEY_KEYS = 'omni_provider_keys';
export const STORAGE_KEY_EXPLICIT_CHAT_PROVIDER = 'sierra_explicit_chat_provider_v1';

/**
 * Unifies and migrates all legacy localStorage settings keys into the single
 * `omni_unified_settings_v1` JSON store without losing API keys or choices.
 */
export function migrateSettingsStorageSingleSourceOfTruth(): void {
  migrateOnceToV3();
}

export function getNativeStoredKeys(): Record<string, string> {
  const settings = getSettings();
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings.providers)) {
    const cleaned = trimAndNormalizeApiKey(v?.apiKey);
    if (cleaned) {
      result[k] = cleaned;
    }
  }
  return result;
}

function getDefaultProvidersMap(): Record<string, ProviderInfo> {
  const settings = getSettings();
  const chatProviders = settings.chatProviders;
  const provs = settings.providers;
  const isActive = (pid: StoreProviderId) => settings.models.chatProvider === pid;

  return {
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      selectedModel: isActive('gemini')
        ? settings.models.chatText
        : chatProviders.gemini?.selectedModel || DEFAULT_CHAT_MODELS_BY_PROVIDER.gemini.selectedModel,
      customModel: chatProviders.gemini?.customModel || undefined,
      baseUrl: provs.gemini.httpEndpoint || DEFAULT_PROVIDER_ENDPOINTS.gemini.httpEndpoint,
      thinkingLevel: settings.live.thinkingLevel || chatProviders.gemini?.thinkingLevel || undefined,
      hasKey: Boolean(trimAndNormalizeApiKey(provs.gemini.apiKey)),
      contentCapability: PROVIDER_CONTENT_CAPABILITIES.gemini,
      capabilities: {
        text: true,
        streaming: true,
        multimodal: true,
        grounding: true,
        imageGen: true,
        videoGen: true,
        liveVoice: true,
      },
    },
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      selectedModel: isActive('openrouter')
        ? settings.models.chatText
        : chatProviders.openrouter?.customModel?.trim() ||
          chatProviders.openrouter?.selectedModel ||
          OPENROUTER_DEFAULT_PAID_MODEL,
      customModel: chatProviders.openrouter?.customModel || undefined,
      baseUrl: provs.openrouter.httpEndpoint || DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint,
      hasKey: Boolean(trimAndNormalizeApiKey(provs.openrouter.apiKey)),
      contentCapability: PROVIDER_CONTENT_CAPABILITIES.openrouter,
      capabilities: {
        text: true,
        streaming: true,
        multimodal: false,
        grounding: false,
        imageGen: false,
        videoGen: false,
        liveVoice: true,
      },
    },
    openai: {
      id: 'openai',
      name: 'OpenAI',
      selectedModel: isActive('openai')
        ? settings.models.chatText
        : chatProviders.openai?.selectedModel || DEFAULT_CHAT_MODELS_BY_PROVIDER.openai.selectedModel,
      customModel: chatProviders.openai?.customModel || undefined,
      baseUrl: provs.openai.httpEndpoint || DEFAULT_PROVIDER_ENDPOINTS.openai.httpEndpoint,
      hasKey: Boolean(trimAndNormalizeApiKey(provs.openai.apiKey)),
      contentCapability: PROVIDER_CONTENT_CAPABILITIES.openai,
      capabilities: {
        text: true,
        streaming: true,
        multimodal: true,
        grounding: false,
        imageGen: false,
        videoGen: false,
        liveVoice: false,
      },
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic Claude',
      selectedModel: isActive('anthropic')
        ? settings.models.chatText
        : chatProviders.anthropic?.selectedModel || DEFAULT_CHAT_MODELS_BY_PROVIDER.anthropic.selectedModel,
      customModel: chatProviders.anthropic?.customModel || undefined,
      baseUrl: provs.anthropic.httpEndpoint || DEFAULT_PROVIDER_ENDPOINTS.anthropic.httpEndpoint,
      hasKey: Boolean(trimAndNormalizeApiKey(provs.anthropic.apiKey)),
      contentCapability: PROVIDER_CONTENT_CAPABILITIES.anthropic,
      capabilities: {
        text: true,
        streaming: true,
        multimodal: true,
        grounding: false,
        imageGen: false,
        videoGen: false,
        liveVoice: false,
      },
    },
    custom: {
      id: 'custom',
      name: 'Custom OpenAI-Compatible',
      selectedModel: isActive('custom')
        ? settings.models.chatText
        : chatProviders.custom?.selectedModel || DEFAULT_CHAT_MODELS_BY_PROVIDER.custom.selectedModel,
      customModel: chatProviders.custom?.customModel || undefined,
      baseUrl: provs.custom.httpEndpoint || DEFAULT_PROVIDER_ENDPOINTS.custom.httpEndpoint,
      hasKey: Boolean(trimAndNormalizeApiKey(provs.custom.apiKey)),
      contentCapability: PROVIDER_CONTENT_CAPABILITIES.custom,
      capabilities: {
        text: true,
        streaming: true,
        multimodal: true,
        grounding: false,
        imageGen: false,
        videoGen: false,
        liveVoice: false,
      },
    },
    ollama: {
      id: 'ollama',
      name: 'Ollama (Local/Host)',
      selectedModel: isActive('ollama')
        ? settings.models.chatText
        : chatProviders.ollama?.selectedModel || DEFAULT_CHAT_MODELS_BY_PROVIDER.ollama.selectedModel,
      customModel: chatProviders.ollama?.customModel || undefined,
      baseUrl: provs.ollama.httpEndpoint || DEFAULT_PROVIDER_ENDPOINTS.ollama.httpEndpoint,
      hasKey: true,
      contentCapability: PROVIDER_CONTENT_CAPABILITIES.ollama,
      capabilities: {
        text: true,
        streaming: true,
        multimodal: false,
        grounding: false,
        imageGen: false,
        videoGen: false,
        liveVoice: false,
      },
    },
    local: {
      id: 'local',
      name: 'On-Device Local',
      selectedModel: isActive('local')
        ? settings.models.chatText
        : chatProviders.local?.selectedModel || DEFAULT_CHAT_MODELS_BY_PROVIDER.local.selectedModel,
      customModel: chatProviders.local?.customModel || undefined,
      baseUrl: provs.local.httpEndpoint || '',
      hasKey: true,
      contentCapability: PROVIDER_CONTENT_CAPABILITIES.ollama,
      capabilities: {
        text: true,
        streaming: true,
        multimodal: false,
        grounding: false,
        imageGen: false,
        videoGen: false,
        liveVoice: true,
      },
    },
  };
}

// Reactive Store for Cross-Component Synchronization (Settings, Home, Live & Chat)
const providerListeners = new Set<() => void>();

export function subscribeProviders(listener: () => void): () => void {
  providerListeners.add(listener);
  const unsubSettings = subscribeSettings(listener);
  return () => {
    providerListeners.delete(listener);
    unsubSettings();
  };
}

export function getActiveProviderId(): string {
  const active = getSettings().models.chatProvider;
  if (active && PROVIDER_METADATA[active]) return active;
  return 'gemini';
}

export function getSelectedModelForProvider(providerId: string): string {
  const pid = normalizeProviderId(providerId);
  const settings = getSettings();
  if (pid === settings.models.chatProvider && settings.models.chatText?.trim()) {
    return settings.models.chatText.trim();
  }
  const entry = settings.chatProviders[pid];
  if (entry) {
    const custom = (entry.customModel || '').trim();
    if (custom) return custom;
    const saved = (entry.selectedModel || '').trim();
    if (saved && saved !== 'custom-model' && saved !== 'custom-ollama') {
      return saved;
    }
  }
  return PROVIDER_METADATA[pid]?.models[0]?.id || DEFAULT_TEXT_MODEL;
}

export function getModelsForProvider(providerId: string): ModelOption[] {
  const pid = normalizeProviderId(providerId);
  const meta = PROVIDER_METADATA[pid];
  const list = meta?.models ? [...meta.models] : [];

  const entry = getSettings().chatProviders[pid];
  const custom = (entry?.customModel || '').trim();
  if (custom && !list.some((m) => m.id === custom)) {
    list.push({ id: custom, name: `${custom} (Custom)` });
  }

  const currentSelected = getSelectedModelForProvider(pid);
  if (
    currentSelected &&
    currentSelected !== 'custom-model' &&
    currentSelected !== 'custom-ollama' &&
    !list.some((m) => m.id === currentSelected)
  ) {
    const label =
      pid === 'openrouter' && currentSelected.endsWith(':free')
        ? formatOpenRouterFreeModelLabel(currentSelected)
        : currentSelected;
    list.push({ id: currentSelected, name: label });
  }
  return list;
}

interface ActiveProviderSnapshot {
  activeProvider: string;
  selectedModel: string;
  version: number;
}

let providerStoreVersion = 0;
let cachedSnapshot: ActiveProviderSnapshot = {
  activeProvider: 'gemini',
  selectedModel: 'gemini-3.5-flash-lite',
  version: 0,
};

function getActiveProviderSnapshot(): ActiveProviderSnapshot {
  const active = getActiveProviderId();
  const model = getSelectedModelForProvider(active);
  if (cachedSnapshot.activeProvider !== active || cachedSnapshot.selectedModel !== model) {
    providerStoreVersion++;
    cachedSnapshot = {
      activeProvider: active,
      selectedModel: model,
      version: providerStoreVersion,
    };
  }
  return cachedSnapshot;
}

export function emitProviderChange() {
  providerStoreVersion++;
  const active = getActiveProviderId();
  cachedSnapshot = {
    activeProvider: active,
    selectedModel: getSelectedModelForProvider(active),
    version: providerStoreVersion,
  };
  for (const listener of providerListeners) {
    try {
      listener();
    } catch (e) {
      console.error('[ProviderStore] Listener error:', e);
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('omni_providers_updated'));
    } catch {}
  }
}

export function useActiveProviderConfig() {
  const snapshot = useSyncExternalStore(
    subscribeProviders,
    getActiveProviderSnapshot,
    () => ({
      activeProvider: 'gemini',
      selectedModel: 'gemini-3.5-flash-lite',
      version: 0,
    })
  );

  const activeProvider = snapshot.activeProvider;
  const selectedModel = snapshot.selectedModel;
  const providerMeta = PROVIDER_METADATA[activeProvider] || PROVIDER_METADATA.gemini;
  const models = getModelsForProvider(activeProvider);

  const setModel = async (newModel: string) => {
    await saveProviderConfig({ providerId: activeProvider, model: newModel });
  };

  const setProvider = async (newProvider: string) => {
    await saveProviderConfig({ activeProvider: newProvider });
  };

  return {
    activeProvider,
    selectedModel,
    providerMeta,
    models,
    setModel,
    setProvider,
  };
}

export async function getProvidersConfig(): Promise<ProvidersConfigResponse> {
  const settings = getSettings();
  const providers = getDefaultProvidersMap();
  const active = settings.models.chatProvider || 'gemini';

  if (Capacitor.isNativePlatform() || (typeof window === 'undefined' && typeof process !== 'undefined')) {
    return { activeProvider: active, providers };
  }

  try {
    const res = await fetch('/api/providers/config', {
      headers: {
        Accept: 'application/json',
      },
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const json = await res.json();
      if (json?.providers) {
        for (const [id, serverProv] of Object.entries(json.providers as Record<string, ProviderInfo>)) {
          if (providers[id] && serverProv?.hasKey) {
            providers[id] = {
              ...providers[id],
              hasKey: true,
            };
          }
        }
      }
    }
  } catch {
    // Non-fatal: v3 client store remains authoritative
  }

  return {
    activeProvider: active,
    providers,
  };
}

export async function saveProviderConfig(data: {
  activeProvider?: string;
  providerId?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  model?: string;
  customModel?: string;
  baseUrl?: string;
  httpEndpoint?: string;
  wsEndpoint?: string;
  enabled?: boolean;
  thinkingLevel?: ThinkingLevel | string;
}): Promise<{ success: boolean; activeProvider: string; error?: string }> {
  // Validate HTTP / WS URLs before persisting if provided
  const rawHttp = data.httpEndpoint !== undefined ? data.httpEndpoint : data.baseUrl;
  if (rawHttp !== undefined && data.providerId !== 'local') {
    const allowEmpty = data.providerId === 'local';
    if (rawHttp.trim() !== '') {
      const v = validateHttpEndpoint(rawHttp, allowEmpty);
      if (!v.valid) {
        return { success: false, activeProvider: getActiveProviderId(), error: v.error };
      }
    }
  }
  if (data.wsEndpoint !== undefined && data.wsEndpoint.trim() !== '') {
    const v = validateWsEndpoint(data.wsEndpoint, true);
    if (!v.valid) {
      return { success: false, activeProvider: getActiveProviderId(), error: v.error };
    }
  }

  let resultingActive = 'gemini';
  let didChangeOpenRouterKey = false;
  let didChangeLiveModel = false;

  const nextSettings = updateSettings(
    (draft) => {
      if (data.activeProvider) {
        const nextActive = normalizeProviderId(data.activeProvider);
        draft.models.chatProvider = nextActive;
        draft.explicitChatProvider = nextActive;
        // Sync chatText to the selected provider's configured model unless a model was also supplied
        if (!data.providerId || data.providerId !== nextActive || (data.model === undefined && data.customModel === undefined)) {
          const provEntry = draft.chatProviders[nextActive];
          draft.models.chatText =
            provEntry?.customModel?.trim() ||
            provEntry?.selectedModel ||
            DEFAULT_CHAT_MODELS_BY_PROVIDER[nextActive].selectedModel;
        }
      }

      if (data.providerId) {
        const pid = normalizeProviderId(data.providerId);
        const defChat = DEFAULT_CHAT_MODELS_BY_PROVIDER[pid];
        const defEp = DEFAULT_PROVIDER_ENDPOINTS[pid];
        const currentEntry = draft.chatProviders[pid] || { ...defChat };

        if (data.model !== undefined) {
          const cleanModel = data.model.trim();
          currentEntry.selectedModel = cleanModel || defChat.selectedModel;
          if (
            data.customModel === undefined &&
            cleanModel &&
            cleanModel !== 'custom-model' &&
            cleanModel !== 'custom-ollama' &&
            cleanModel !== currentEntry.customModel
          ) {
            currentEntry.customModel = '';
          }
          if (pid === 'gemini' && cleanModel && isGeminiLiveModel(cleanModel)) {
            draft.models.liveModel = cleanModel;
            didChangeLiveModel = true;
          }
          if (draft.models.chatProvider === pid) {
            draft.models.chatText = currentEntry.customModel?.trim() || currentEntry.selectedModel;
          }
        }
        if (data.customModel !== undefined) {
          currentEntry.customModel = data.customModel.trim();
          if (draft.models.chatProvider === pid) {
            draft.models.chatText = currentEntry.customModel || currentEntry.selectedModel;
          }
        }
        if (rawHttp !== undefined) {
          const trimmedHttp = rawHttp.trim().replace(/\/+$/, '');
          draft.providers[pid].httpEndpoint = trimmedHttp || defEp.httpEndpoint;
        }
        if (data.wsEndpoint !== undefined && defEp.supportsWs) {
          const trimmedWs = data.wsEndpoint.trim();
          draft.providers[pid].wsEndpoint = trimmedWs || defEp.wsEndpoint;
        }
        if (data.enabled !== undefined) {
          draft.providers[pid].enabled = Boolean(data.enabled);
        }
        if (data.thinkingLevel !== undefined) {
          const validatedLevel = validateThinkingLevel(data.thinkingLevel);
          currentEntry.thinkingLevel = validatedLevel;
          if (pid === 'gemini') {
            draft.live.thinkingLevel = validatedLevel;
          }
        }
        if (data.clearApiKey) {
          draft.providers[pid].apiKey = '';
          if (pid === 'openrouter') didChangeOpenRouterKey = true;
        } else if (data.apiKey !== undefined) {
          const cleanKey = trimAndNormalizeApiKey(data.apiKey);
          if (cleanKey) {
            draft.providers[pid].apiKey = cleanKey;
            if (pid === 'openrouter') {
              didChangeOpenRouterKey = true;
            }
          }
        }
        draft.chatProviders[pid] = currentEntry;
      }

      resultingActive = draft.models.chatProvider;
      return draft;
    },
    [
      'omni_providers_updated',
      ...(didChangeOpenRouterKey ? ['sierra_openrouter_key_updated'] : []),
      ...(didChangeLiveModel ? ['sierra_live_model_updated'] : []),
    ]
  );

  resultingActive = nextSettings.models.chatProvider;
  emitProviderChange();

  if (Capacitor.isNativePlatform() || (typeof window === 'undefined' && typeof process !== 'undefined')) {
    return { success: true, activeProvider: resultingActive };
  }

  try {
    const res = await fetch('/api/providers/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        await res.json();
      }
    }
  } catch {
    // Client v3 store is already persisted cleanly
  }

  return { success: true, activeProvider: resultingActive };
}

export interface TestConnectionResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
  error?: string;
}

export async function testProviderConnection(data: {
  providerId: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  httpEndpoint?: string;
  liveWsUrl?: string;
  wsEndpoint?: string;
  thinkingLevel?: ThinkingLevel | string | null;
  fetchImpl?: typeof fetch;
}): Promise<TestConnectionResult> {
  const startTime = Date.now();
  const pid = normalizeProviderId(data.providerId);
  const fetchFn = data.fetchImpl || fetch;
  const effectiveKey =
    data.apiKey !== undefined
      ? trimAndNormalizeApiKey(data.apiKey)
      : getProviderApiKey(pid);
  const baseHttp = (
    data.httpEndpoint ||
    data.baseUrl ||
    getProviderHttpEndpoint(pid) ||
    DEFAULT_PROVIDER_ENDPOINTS[pid].httpEndpoint
  )
    .trim()
    .replace(/\/+$/, '');
  const baseWs = (data.wsEndpoint || data.liveWsUrl || getProviderWsEndpoint(pid)).trim();

  if (pid === 'local') {
    return {
      success: true,
      status: 200,
      latencyMs: Date.now() - startTime,
      message: 'HTTP 200: On-device local runtime ready.',
    };
  }

  // Gemini Live WebSocket handshake check when testing a Live voice model explicitly
  if (pid === 'gemini' && data.model && isGeminiLiveModel(data.model)) {
    if (!effectiveKey) {
      return {
        success: false,
        status: 401,
        error: 'Gemini API key is required. Paste your key in Settings -> Providers.',
      };
    }
    const hasExplicitLevel = 'thinkingLevel' in data;
    return await testGeminiLiveWebSocket({
      apiKey: effectiveKey,
      model: data.model,
      liveWsUrl: baseWs || undefined,
      ...(hasExplicitLevel ? { thinkingLevel: data.thinkingLevel } : {}),
    });
  }

  const httpCheck = validateHttpEndpoint(baseHttp, false);
  if (!httpCheck.valid) {
    return {
      success: false,
      latencyMs: 0,
      error: httpCheck.error || 'Invalid HTTP endpoint URL.',
    };
  }

  try {
    if (pid === 'openrouter') {
      if (!effectiveKey) {
        return {
          success: false,
          status: 401,
          latencyMs: Date.now() - startTime,
          error: 'OpenRouter API key is required before testing connection.',
        };
      }
      const url = `${httpCheck.normalized}/auth/key`;
      addDebugLog('ProviderTest:OpenRouter', `GET ${url} (keyLast4=${effectiveKey.slice(-4)})`);
      const res = await fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${effectiveKey}`,
          Accept: 'application/json',
        },
      });
      const latencyMs = Date.now() - startTime;
      const bodyText = await res.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = bodyText ? JSON.parse(bodyText) : null;
      } catch {}

      if (!res.ok) {
        const msg = parsed?.error?.message || bodyText.slice(0, 140) || `HTTP ${res.status}`;
        return {
          success: false,
          status: res.status,
          latencyMs,
          error:
            res.status === 401
              ? `HTTP 401: Invalid or unrecognized API key for OpenRouter (${msg})`
              : `HTTP ${res.status}: ${msg}`,
        };
      }
      const label = parsed?.data?.label ? ` (${parsed.data.label})` : '';
      return {
        success: true,
        status: res.status,
        latencyMs,
        message: `HTTP ${res.status}: OpenRouter key verified${label}.`,
      };
    }

    if (pid === 'gemini') {
      if (!effectiveKey) {
        return {
          success: false,
          status: 401,
          latencyMs: Date.now() - startTime,
          error: 'Gemini API key is required before testing connection.',
        };
      }
      const url = `${httpCheck.normalized}/models?key=${encodeURIComponent(effectiveKey)}`;
      addDebugLog('ProviderTest:Gemini', `GET ${httpCheck.normalized}/models (keyLast4=${effectiveKey.slice(-4)})`);
      const res = await fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const latencyMs = Date.now() - startTime;
      const bodyText = await res.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = bodyText ? JSON.parse(bodyText) : null;
      } catch {}
      if (!res.ok) {
        const msg = parsed?.error?.message || bodyText.slice(0, 140) || `HTTP ${res.status}`;
        return {
          success: false,
          status: res.status,
          latencyMs,
          error:
            res.status === 401
              ? `HTTP 401: Invalid or unrecognized API key for Google Gemini (${msg})`
              : `HTTP ${res.status}: ${msg}`,
        };
      }
      const count = Array.isArray(parsed?.models) ? parsed.models.length : 0;
      return {
        success: true,
        status: res.status,
        latencyMs,
        message: `HTTP ${res.status}: Google Gemini connected${count ? ` (${count} models)` : ''}.`,
      };
    }

    if (pid === 'openai' || pid === 'custom' || pid === 'anthropic') {
      if (pid !== 'custom' && !effectiveKey) {
        return {
          success: false,
          status: 401,
          latencyMs: Date.now() - startTime,
          error: `${PROVIDER_METADATA[pid]?.name || pid} API key is required before testing connection.`,
        };
      }
      const url =
        pid === 'anthropic'
          ? httpCheck.normalized.endsWith('/v1')
            ? `${httpCheck.normalized}/models`
            : `${httpCheck.normalized}/v1/models`
          : `${httpCheck.normalized}/models`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (pid === 'anthropic') {
        headers['x-api-key'] = effectiveKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (effectiveKey) {
        headers['Authorization'] = `Bearer ${effectiveKey}`;
      }
      addDebugLog(`ProviderTest:${pid}`, `GET ${url}`);
      const res = await fetchFn(url, { method: 'GET', headers });
      const latencyMs = Date.now() - startTime;
      const bodyText = await res.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = bodyText ? JSON.parse(bodyText) : null;
      } catch {}
      if (!res.ok) {
        const msg = parsed?.error?.message || bodyText.slice(0, 140) || `HTTP ${res.status}`;
        return {
          success: false,
          status: res.status,
          latencyMs,
          error:
            res.status === 401
              ? `HTTP 401: Invalid or unrecognized API key for ${PROVIDER_METADATA[pid]?.name || pid} (${msg})`
              : `HTTP ${res.status}: ${msg}`,
        };
      }
      const count = Array.isArray(parsed?.data) ? parsed.data.length : 0;
      return {
        success: true,
        status: res.status,
        latencyMs,
        message: `HTTP ${res.status}: ${PROVIDER_METADATA[pid]?.name || pid} connected${count ? ` (${count} models)` : ''}.`,
      };
    }

    if (pid === 'ollama') {
      const url = `${httpCheck.normalized}/api/tags`;
      addDebugLog('ProviderTest:Ollama', `GET ${url}`);
      const res = await fetchFn(url, { method: 'GET', headers: { Accept: 'application/json' } });
      const latencyMs = Date.now() - startTime;
      const bodyText = await res.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = bodyText ? JSON.parse(bodyText) : null;
      } catch {}
      if (!res.ok) {
        const msg = parsed?.error || bodyText.slice(0, 140) || `HTTP ${res.status}`;
        return {
          success: false,
          status: res.status,
          latencyMs,
          error: `HTTP ${res.status}: ${msg}`,
        };
      }
      const count = Array.isArray(parsed?.models) ? parsed.models.length : 0;
      return {
        success: true,
        status: res.status,
        latencyMs,
        message: `HTTP ${res.status}: Ollama reachable (${count} local models).`,
      };
    }

    return {
      success: false,
      status: 400,
      latencyMs: Date.now() - startTime,
      error: `Unsupported provider: ${pid}`,
    };
  } catch (err: any) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: err?.message || 'Network connection error',
    };
  }
}

export interface StreamChatParams {
  messages: {
    role: string;
    content: string;
    attachments?: string[];
  }[];
  systemInstruction?: string;
  provider?: string;
  model?: string;
  contentMode?: ContentMode;
  temperature?: number;
  topP?: number;
  topK?: number;
  useSearch?: boolean;
  useMaps?: boolean;
  responseSpeed?: ResponseSpeedLevel;
}

export async function streamChat(
  params: StreamChatParams,
  callbacks: {
    onChunk: (text: string) => void;
    onMetadata?: (meta: any) => void;
    onDone: () => void;
    onError: (err: Error) => void;
  }
): Promise<() => void> {
  const controller = new AbortController();

  const currentSettings = getSettings();
  const requestedModel =
    params.model ||
    (params.provider && params.provider !== currentSettings.models.chatProvider
      ? getSelectedModelForProvider(params.provider)
      : currentSettings.models.chatText) ||
    DEFAULT_TEXT_MODEL;

  // FIX 2: Models whose name contains "live" (e.g. gemini-3.8-live) must never be sent through
  // the REST generateContent/streamChat path. Route them through the existing Live API WebSocket
  // (bidiGenerateContent) pipeline that the Test Connection feature already uses.
  if (isGeminiLiveModel(requestedModel)) {
    const provKey = params.provider || 'gemini';
    const effectiveKey = getProviderApiKey(provKey) || getProviderApiKey('gemini');
    const customWsUrl = getProviderWsEndpoint('gemini') || undefined;

    if (effectiveKey) {
      let cancelLiveWs: (() => void) | null = null;
      const isExtThinking = isGeminiLiveExtendedThinkingModel(requestedModel);
      streamGeminiLiveWebSocket({
        apiKey: effectiveKey,
        model: requestedModel,
        messages: params.messages.map(m => ({ role: m.role, content: m.content || '' })),
        systemInstruction: params.systemInstruction,
        liveWsUrl: customWsUrl,
        ...(isExtThinking ? { thinkingLevel: getStoredGeminiThinkingLevel() } : {}),
        callbacks: {
          onChunk: callbacks.onChunk,
          onMetadata: callbacks.onMetadata,
          onDone: callbacks.onDone,
          onError: (err) => {
            callbacks.onError(err);
          },
        },
      }).then(cancel => {
        cancelLiveWs = cancel;
      }).catch(err => {
        callbacks.onError(err);
      });

      return () => {
        if (cancelLiveWs) cancelLiveWs();
        controller.abort();
      };
    } else {
      console.warn(`[streamChat] Gemini Live model "${requestedModel}" requested without direct API key. Using standard text model gemini-2.5-flash for REST stream.`);
      params = {
        ...params,
        model: "gemini-2.5-flash",
      };
    }
  }

  // Resolve effective provider and model strictly from v3 settingsStore
  const effectiveProvider = params.provider || currentSettings.models.chatProvider || getActiveProviderId();
  const effectiveModel =
    params.model ||
    (effectiveProvider === currentSettings.models.chatProvider && currentSettings.models.chatText
      ? currentSettings.models.chatText
      : getSelectedModelForProvider(effectiveProvider));
  const effectiveResponseSpeed = params.responseSpeed || getResponseSpeed();
  const supportedSpeed = doesModelSupportResponseSpeed(effectiveModel, effectiveProvider);
  const thinkingParams = buildModelThinkingConfig(effectiveModel, effectiveProvider, effectiveResponseSpeed);

  const reqLogMsg = `provider=${effectiveProvider}, model=${effectiveModel}, responseSpeed=${effectiveResponseSpeed} (supported=${supportedSpeed}), useSearch=${Boolean(params.useSearch)}, useMaps=${Boolean(params.useMaps)}`;
  addDebugLog('Chat:Request', reqLogMsg);
  console.log(`[Chat:Request] ${reqLogMsg}`);

  params = {
    ...params,
    provider: effectiveProvider,
    model: effectiveModel,
    responseSpeed: effectiveResponseSpeed,
  };

  // Direct client-side OpenRouter text chat (works on both native Android and web, reusing the existing OpenRouter key)
  if (effectiveProvider === 'openrouter') {
    const resolvedOrKey = resolveOpenRouterApiKeyWithSource();
    const orKey = resolvedOrKey.apiKey;
    const keySource = resolvedOrKey.source;
    const keyLast4 = resolvedOrKey.last4 || 'none';
    if (!orKey) {
      const keyErr = createProviderHttpError(
        'OpenRouter API key is missing. Paste your OpenRouter key in Settings.',
        401,
        'openrouter'
      );
      addDebugLog('Chat:APIError', `[OpenRouter] ${keyErr.message}`);
      callbacks.onMetadata?.({ status: 401, auth401Provider: 'openrouter', failedProvider: 'openrouter' });
      callbacks.onError(keyErr);
      return () => controller.abort();
    }

    const effectiveMode = params.contentMode || getContentMode();
    const targetModel =
      params.model && !isGeminiLiveModel(params.model)
        ? params.model.trim()
        : getSelectedModelForProvider('openrouter');
    const baseHttp = getProviderHttpEndpoint('openrouter') || DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint;
    const completionsUrl = `${baseHttp.replace(/\/+$/, '')}/chat/completions`;

    addDebugLog(
      'Chat:OpenRouterKey',
      `url=${completionsUrl}, model=${targetModel}, keySource=${keySource}, keyLast4=${keyLast4}`,
    );

    const formattedMsgs: Array<{ role: string; content: string }> = [];
    if (params.systemInstruction) {
      let sysContent = params.systemInstruction;
      if (effectiveMode === 'mature') {
        sysContent +=
          '\n\n[Adult 18+ Content Scope: Adult content, explicit romance, and consensual roleplay apply strictly to consenting adult characters (18+) only.]';
      }
      formattedMsgs.push({ role: 'system', content: sysContent });
    }
    for (const m of params.messages) {
      const role = m.role === 'model' ? 'assistant' : m.role;
      formattedMsgs.push({ role, content: m.content || '' });
    }

    (async () => {
      const executeOpenRouterFetch = async (modelSlug: string) => {
        return await fetch(completionsUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${orKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'Sierra OmniAgent',
          },
          body: JSON.stringify({
            model: modelSlug,
            messages: formattedMsgs,
            temperature: params.temperature ?? 0.85,
            top_p: params.topP ?? 0.9,
            stream: true,
          }),
          signal: controller.signal,
        });
      };

      try {
        const res = await executeOpenRouterFetch(targetModel);
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          const parsedErr = parseOpenRouterErrorResponse(res.status, errBody, targetModel);
          addDebugLog('Chat:OpenRouterError', parsedErr);
          addDebugLog('Chat:APIError', parsedErr);
          callbacks.onMetadata?.({
            status: res.status,
            auth401Provider: res.status === 401 ? 'openrouter' : undefined,
            failedProvider: 'openrouter',
            failedModel: targetModel,
          });
          // NEVER silently replace the user's selected model with Dolphin 24B.
          // Surface the error so the user can choose to tap "Use Paid Default" explicitly.
          callbacks.onError(
            createProviderHttpError(
              parsedErr,
              res.status,
              res.status === 401 ? 'openrouter' : undefined
            )
          );
          return;
        }

        callbacks.onMetadata?.({
          answeredModel: targetModel,
          provider: 'openrouter',
          usedFallbackModel: false,
        });

        const reader = res.body?.getReader();
        if (!reader) {
          callbacks.onError(new Error('OpenRouter response stream unavailable.'));
          return;
        }
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const rawLine of lines) {
            const trimmed = rawLine.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed?.error) {
                const errText = parseOpenRouterErrorResponse(res.status, JSON.stringify(parsed), targetModel);
                throw new Error(errText);
              }
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) {
                callbacks.onChunk(delta);
              }
            } catch (innerErr: any) {
              if (innerErr?.message?.startsWith('OpenRouter')) {
                throw innerErr;
              }
            }
          }
        }
        callbacks.onDone();
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          addDebugLog('Chat:APIError', `[OpenRouter: ${targetModel}] ${err?.message || String(err)}`);
          callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();

    return () => controller.abort();
  }

  // On native Capacitor, call provider APIs directly from client with saved keys and endpoints
  if (Capacitor.isNativePlatform()) {
    const keys = getNativeStoredKeys();

    // 1. Google Gemini Provider
    if (effectiveProvider === 'gemini') {
      const geminiKeyInfo = resolveProviderKeyWithSource('gemini');
      const effectiveKey = geminiKeyInfo.apiKey || keys[effectiveProvider];
      if (!effectiveKey) {
        const keyErr = new Error("Gemini API key is required. Please set your key in Settings.");
        addDebugLog('Chat:APIError', `[Model: ${effectiveModel}] ${keyErr.message}`);
        callbacks.onMetadata?.({ status: 401, auth401Provider: 'gemini', failedProvider: 'gemini' });
        callbacks.onError(keyErr);
        return () => controller.abort();
      }

      const model = (params.model && !isGeminiLiveModel(params.model)) ? params.model : DEFAULT_TEXT_MODEL;

      const contents = params.messages.map((m) => {
        const parts: any[] = [{ text: m.content || "" }];
        if (Array.isArray(m.attachments)) {
          m.attachments.forEach((att: string) => {
            if (att.startsWith("data:")) {
              const [header, b64] = att.split(";base64,");
              const mimeType = header.replace("data:", "");
              parts.push({
                inlineData: { mimeType, data: b64 }
              });
            }
          });
        }
        return {
          role: m.role === "assistant" || m.role === "model" ? "model" : "user",
          parts
        };
      });

      const lastUserText = [...params.messages]
        .reverse()
        .find((m) => m.role === 'user')?.content || '';
      const isActionOrToolPrompt = /\b(change\s+voice|switch\s+(?:to|your)\s+|voice|accent|tone|persona|tyler|sierra|what\s+voices|open\s+app|launch|find\s+contact|contact|call|dial|send\s+(?:a\s+)?text|text\s+|sms|block\s+number|block\s+|open\s+maps|directions\s+to|navigate\s+to|calendar|schedule|appointment|meeting|set\s+(?:an\s+)?alarm|wake\s+me|set\s+(?:a\s+)?timer|timer\s+for|remind\s+me|reminder|yes|yeah|confirm|go\s+ahead|do\s+it)\b/i.test(
        lastUserText,
      );

      const tools: any[] = [];
      if (params.useSearch) tools.push({ googleSearch: {} });
      if (params.useMaps && !doesModelSupportMapsGrounding(model, 'gemini')) {
        params.useMaps = false;
      }
      if (params.useMaps) tools.push({ googleMaps: {} });

      const activeTools: any[] = isActionOrToolPrompt || tools.length === 0
        ? [{ functionDeclarations: getAllSierraFunctionDeclarations() }]
        : tools;

      const generationConfig: Record<string, any> = {
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
      };
      if (thinkingParams.geminiThinkingConfig && !model.toLowerCase().includes('lite')) {
        generationConfig.thinkingConfig = thinkingParams.geminiThinkingConfig;
      }

      const buildRequestBody = (overrideContents: any[], overrideGenConfig: Record<string, any>, overrideTools: any[]) => {
        const body: any = {
          contents: overrideContents,
          generationConfig: overrideGenConfig,
          safetySettings: SIERRA_SAFETY_SETTINGS,
        };
        if (params.systemInstruction) {
          body.systemInstruction = {
            parts: [{ text: params.systemInstruction }]
          };
        }
        if (overrideTools.length > 0) {
          body.tools = overrideTools;
        }
        return body;
      };

      (async () => {
        try {
          let activeModel = model;
          let activeGenConfig = { ...generationConfig };
          let reqBody = buildRequestBody(contents, activeGenConfig, activeTools);

          const geminiBaseHttp = getProviderHttpEndpoint('gemini') || DEFAULT_PROVIDER_ENDPOINTS.gemini.httpEndpoint;
          const executeStreamFetch = async (targetModel: string, bodyObj: any) => {
            const cleanPath = `${geminiBaseHttp.replace(/\/+$/, '')}/models/${targetModel}:streamGenerateContent?alt=sse`;
            addDebugLog('Chat:GeminiRequest', `url=${cleanPath}, keySource=${geminiKeyInfo.source}, keyLast4=${geminiKeyInfo.last4}`);
            const url = `${cleanPath}&key=${encodeURIComponent(effectiveKey)}`;
            return await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bodyObj),
              signal: controller.signal,
            });
          };

          let res = await executeStreamFetch(activeModel, reqBody);

          if (!res.ok) {
            let errText = await res.text();
            logQuotaOrRateLimitError('Chat', activeModel, errText, res.status);
            addDebugLog('Chat:APIError', `[Model: ${activeModel}] HTTP ${res.status}: ${errText.slice(0, 240)}`);

            // Retry fallback if preview/lite alias is not found (404) or thinkingConfig/tools rejected (400)
            if (res.status === 404 || res.status === 400) {
              const fallbackModel = resolveFallbackApiModelId(activeModel) || 'gemini-2.5-flash';
              const strippedGenConfig = { ...activeGenConfig };
              delete strippedGenConfig.thinkingConfig;

              const retryModel = res.status === 404 ? fallbackModel : activeModel;
              addDebugLog(
                'Chat:ModelFallback',
                `Retrying streamGenerateContent with model="${retryModel}" (stripped thinkingConfig) after HTTP ${res.status} on "${activeModel}"`,
              );
              activeModel = retryModel;
              activeGenConfig = strippedGenConfig;
              reqBody = buildRequestBody(contents, activeGenConfig, activeTools);
              res = await executeStreamFetch(activeModel, reqBody);

              if (!res.ok && activeModel !== fallbackModel) {
                activeModel = fallbackModel;
                reqBody = buildRequestBody(contents, activeGenConfig, tools);
                res = await executeStreamFetch(activeModel, reqBody);
              }
            }

            if (!res.ok) {
              const finalErrText = await res.text().catch(() => errText);
              const isQuota429 = logQuotaOrRateLimitError('Chat', activeModel, finalErrText, res.status);
              addDebugLog('Chat:APIError', `[Model: ${activeModel}] Final HTTP ${res.status}: ${finalErrText.slice(0, 240)}`);
              if (isQuota429) {
                callbacks.onMetadata?.({
                  geminiQuotaExhausted: true,
                  failedModel: activeModel,
                });
                callbacks.onError(
                  new Error(
                    `${GEMINI_QUOTA_EXHAUSTED_MESSAGE} (${res.status}) [${activeModel}]: ${finalErrText.slice(0, 200)}`,
                  ),
                );
                return;
              }
              if (res.status === 401) {
                callbacks.onMetadata?.({ status: 401, auth401Provider: 'gemini', failedProvider: 'gemini', failedModel: activeModel });
                callbacks.onError(new Error(formatProvider401Error('gemini', finalErrText)));
                return;
              }
              callbacks.onError(new Error(`Gemini API error (${res.status}) [${activeModel}]: ${finalErrText.slice(0, 200)}`));
              return;
            }
          }

          callbacks.onMetadata?.({
            answeredModel: activeModel,
            provider: 'gemini',
          });

          const consumeGeminiStream = async (response: Response) => {
            const reader = response.body?.getReader();
            if (!reader) {
              throw new Error('No response stream available.');
            }
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let emittedChars = 0;
            const functionCalls: Array<{ name: string; args: Record<string, any> }> = [];

            const processDataPayload = (dataStr: string) => {
              const trimmedPayload = dataStr.trim();
              if (!trimmedPayload || trimmedPayload === '[DONE]') return;
              try {
                const data = JSON.parse(trimmedPayload);
                if (data.error) {
                  const errMsg = data.error.message || JSON.stringify(data.error);
                  logQuotaOrRateLimitError('Chat', activeModel, errMsg, data.error.code);
                  addDebugLog('Chat:APIError', `[Model: ${activeModel}] Stream error payload: ${errMsg}`);
                  throw new Error(`Gemini API error [${activeModel}]: ${errMsg}`);
                }
                const parts: any[] = data.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                  if (part?.functionCall && part.functionCall.name) {
                    functionCalls.push({
                      name: part.functionCall.name,
                      args: part.functionCall.args || {},
                    });
                  }
                }
                const nonThoughtText = parts
                  .filter((p: any) => !p?.thought && typeof p?.text === 'string')
                  .map((p: any) => p.text)
                  .join('');
                const textChunk = nonThoughtText || (!parts[0]?.thought ? data.candidates?.[0]?.content?.parts?.[0]?.text : '');
                if (textChunk) {
                  emittedChars += textChunk.length;
                  callbacks.onChunk(textChunk);
                }
                const grounding = data.candidates?.[0]?.groundingMetadata;
                if (grounding && callbacks.onMetadata) {
                  callbacks.onMetadata(grounding);
                }
              } catch (parseErr: any) {
                if (parseErr?.message?.startsWith('Gemini API error')) {
                  throw parseErr;
                }
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;
                processDataPayload(trimmed.slice(5));
              }
            }
            if (buffer.trim().startsWith('data:')) {
              processDataPayload(buffer.trim().slice(5));
            }
            return { emittedChars, functionCalls };
          };

          let { emittedChars, functionCalls } = await consumeGeminiStream(res);

          // Handle any function calls (change_voice, list_voice_options, or Android device control tools)
          if (functionCalls.length > 0) {
            const modelParts: any[] = [];
            const responseParts: any[] = [];
            const fallbackMessages: string[] = [];

            for (const fc of functionCalls) {
              const outcome = await executeSierraToolCall(fc.name, fc.args);
              fallbackMessages.push(outcome.message);
              modelParts.push({ functionCall: { name: fc.name, args: fc.args } });
              responseParts.push({
                functionResponse: {
                  name: fc.name,
                  response: outcome.responsePayload,
                },
              });
            }

            const followUpContents = [
              ...contents,
              { role: 'model', parts: modelParts },
              { role: 'user', parts: responseParts },
            ];
            const followUpBody = buildRequestBody(followUpContents, activeGenConfig, activeTools);
            const followRes = await executeStreamFetch(activeModel, followUpBody);
            if (followRes.ok) {
              const followResult = await consumeGeminiStream(followRes);
              emittedChars += followResult.emittedChars;
            }
            if (emittedChars === 0 && fallbackMessages.length > 0) {
              callbacks.onChunk(fallbackMessages.join('\n\n'));
              emittedChars += fallbackMessages.join('\n\n').length;
            }
          }

          // If a short message like "Hey" or "Hi" produced 0 text chunks, retry once without thinkingConfig on fallback model
          if (emittedChars === 0 && functionCalls.length === 0) {
            const fallbackModel = resolveFallbackApiModelId(activeModel) || 'gemini-2.5-flash';
            addDebugLog('Chat:EmptyStreamRetry', `[Model: ${activeModel}] Stream returned 0 text chars; retrying with ${fallbackModel} (no thinkingConfig)`);
            const noThinkConfig = { ...activeGenConfig };
            delete noThinkConfig.thinkingConfig;
            const retryBody = buildRequestBody(contents, noThinkConfig, []);
            const retryRes = await executeStreamFetch(fallbackModel, retryBody);
            if (retryRes.ok) {
              await consumeGeminiStream(retryRes);
            }
          }

          callbacks.onDone();
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            logQuotaOrRateLimitError('Chat', model, err);
            addDebugLog('Chat:APIError', `[Model: ${model}] Exception: ${err?.message || String(err)}`);
            callbacks.onError(err);
          }
        }
      })();

      return () => controller.abort();
    }

    // 2. OpenAI & Custom OpenAI-compatible Provider
    if (effectiveProvider === 'openai' || effectiveProvider === 'custom') {
      const keyInfo = resolveProviderKeyWithSource(effectiveProvider);
      const effectiveKey = keyInfo.apiKey;
      if (effectiveProvider === 'openai' && !effectiveKey) {
        callbacks.onMetadata?.({ status: 401, auth401Provider: 'openai', failedProvider: 'openai' });
        callbacks.onError(
          createProviderHttpError("OpenAI API key is required. Please set your key in Settings.", 401, 'openai')
        );
        return () => controller.abort();
      }

      const baseUrl = (getProviderHttpEndpoint(effectiveProvider) || DEFAULT_PROVIDER_ENDPOINTS[effectiveProvider].httpEndpoint).replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;
      const model = effectiveModel || (effectiveProvider === 'openai' ? 'gpt-4o' : 'llama-3.3-70b-versatile');
      addDebugLog('Chat:OpenAIRequest', `url=${url}, model=${model}, keySource=${keyInfo.source}, keyLast4=${keyInfo.last4}`);

      const formattedMsgs: any[] = [];
      if (params.systemInstruction) {
        formattedMsgs.push({ role: 'system', content: params.systemInstruction });
      }
      for (const m of params.messages) {
        const role = m.role === 'model' ? 'assistant' : m.role;
        formattedMsgs.push({ role, content: m.content || '' });
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (effectiveKey) headers['Authorization'] = `Bearer ${effectiveKey}`;

      (async () => {
        try {
          const openaiBody: Record<string, any> = {
            model,
            messages: formattedMsgs,
            temperature: params.temperature,
            top_p: params.topP,
            stream: true,
          };
          if (thinkingParams.openaiReasoningEffort) {
            openaiBody.reasoning_effort = thinkingParams.openaiReasoningEffort;
          }
          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(openaiBody),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errText = await res.text();
            logQuotaOrRateLimitError('Chat', model, errText, res.status);
            addDebugLog('Chat:APIError', `[Model: ${model}] ${effectiveProvider.toUpperCase()} HTTP ${res.status}: ${errText.slice(0, 200)}`);
            if (res.status === 401) {
              callbacks.onMetadata?.({ status: 401, auth401Provider: effectiveProvider, failedProvider: effectiveProvider, failedModel: model });
              callbacks.onError(createProviderHttpError(formatProvider401Error(effectiveProvider, errText), 401, effectiveProvider));
              return;
            }
            callbacks.onError(new Error(`${effectiveProvider.toUpperCase()} API error (${res.status}): ${errText.slice(0, 200)}`));
            return;
          }

          callbacks.onMetadata?.({
            answeredModel: model,
            provider: effectiveProvider,
          });

          const reader = res.body?.getReader();
          if (!reader) {
            callbacks.onError(new Error('No response stream available.'));
            return;
          }

          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') continue;
              try {
                const data = JSON.parse(dataStr);
                const deltaText = data.choices?.[0]?.delta?.content;
                if (deltaText) {
                  callbacks.onChunk(deltaText);
                }
              } catch (_) {}
            }
          }
          callbacks.onDone();
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            logQuotaOrRateLimitError('Chat', model, err);
            addDebugLog('Chat:APIError', `[Model: ${model}] ${err?.message || String(err)}`);
            callbacks.onError(err);
          }
        }
      })();

      return () => controller.abort();
    }

    // 3. Anthropic Claude Provider
    if (effectiveProvider === 'anthropic') {
      const keyInfo = resolveProviderKeyWithSource('anthropic');
      const effectiveKey = keyInfo.apiKey;
      if (!effectiveKey) {
        callbacks.onMetadata?.({ status: 401, auth401Provider: 'anthropic', failedProvider: 'anthropic' });
        callbacks.onError(
          createProviderHttpError("Anthropic API key is required. Please set your key in Settings.", 401, 'anthropic')
        );
        return () => controller.abort();
      }

      const baseUrl = (getProviderHttpEndpoint('anthropic') || DEFAULT_PROVIDER_ENDPOINTS.anthropic.httpEndpoint).replace(/\/+$/, '');
      const url = baseUrl.endsWith('/v1') ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
      const model = effectiveModel || 'claude-3-7-sonnet-latest';
      addDebugLog('Chat:AnthropicRequest', `url=${url}, model=${model}, keySource=${keyInfo.source}, keyLast4=${keyInfo.last4}`);

      const formattedMsgs: any[] = [];
      for (const m of params.messages) {
        const role = m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user';
        formattedMsgs.push({ role, content: m.content || '' });
      }

      (async () => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': effectiveKey,
              'anthropic-version': '2023-06-01',
              'dangerously-allow-browser': 'true',
            },
            body: JSON.stringify({
              model,
              messages: formattedMsgs,
              system: params.systemInstruction || undefined,
              max_tokens: 4096,
              temperature: params.temperature,
              stream: true,
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errText = await res.text();
            logQuotaOrRateLimitError('Chat', model, errText, res.status);
            addDebugLog('Chat:APIError', `[Model: ${model}] Anthropic HTTP ${res.status}: ${errText.slice(0, 200)}`);
            if (res.status === 401) {
              callbacks.onMetadata?.({ status: 401, auth401Provider: 'anthropic', failedProvider: 'anthropic', failedModel: model });
              callbacks.onError(createProviderHttpError(formatProvider401Error('anthropic', errText), 401, 'anthropic'));
              return;
            }
            callbacks.onError(new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 200)}`));
            return;
          }

          callbacks.onMetadata?.({
            answeredModel: model,
            provider: 'anthropic',
          });

          const reader = res.body?.getReader();
          if (!reader) {
            callbacks.onError(new Error('No response stream available.'));
            return;
          }

          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const dataStr = trimmed.slice(6);
              try {
                const data = JSON.parse(dataStr);
                if (data.type === 'content_block_delta' && data.delta?.text) {
                  callbacks.onChunk(data.delta.text);
                }
              } catch (_) {}
            }
          }
          callbacks.onDone();
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            logQuotaOrRateLimitError('Chat', model, err);
            addDebugLog('Chat:APIError', `[Model: ${model}] ${err?.message || String(err)}`);
            callbacks.onError(err);
          }
        }
      })();

      return () => controller.abort();
    }

    // 4. Ollama (Local / Host) Provider
    if (effectiveProvider === 'ollama') {
      const baseUrl = (getProviderHttpEndpoint('ollama') || DEFAULT_PROVIDER_ENDPOINTS.ollama.httpEndpoint).replace(/\/+$/, '');
      const url = `${baseUrl}/api/chat`;
      const model = effectiveModel || 'llama3.2';
      addDebugLog('Chat:OllamaRequest', `url=${url}, model=${model}`);

      const formattedMsgs: any[] = [];
      if (params.systemInstruction) {
        formattedMsgs.push({ role: 'system', content: params.systemInstruction });
      }
      for (const m of params.messages) {
        const role = m.role === 'model' ? 'assistant' : m.role;
        formattedMsgs.push({ role, content: m.content || '' });
      }

      (async () => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: formattedMsgs,
              stream: true,
              options: {
                temperature: params.temperature,
                top_p: params.topP,
              },
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errText = await res.text();
            logQuotaOrRateLimitError('Chat', model, errText, res.status);
            addDebugLog('Chat:APIError', `[Model: ${model}] Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`);
            callbacks.onError(new Error(`Ollama API error (${res.status}): ${errText.slice(0, 200)}`));
            return;
          }

          callbacks.onMetadata?.({
            answeredModel: model,
            provider: 'ollama',
          });

          const reader = res.body?.getReader();
          if (!reader) {
            callbacks.onError(new Error('No response stream available.'));
            return;
          }

          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const data = JSON.parse(trimmed);
                if (data.message?.content) {
                  callbacks.onChunk(data.message.content);
                }
              } catch (_) {}
            }
          }
          callbacks.onDone();
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            if (isOllamaUnreachableFetchError(err)) {
              const fallback = resolveFallbackDefaultChatProvider();
              addDebugLog(
                'Chat:OllamaFallback',
                `${OLLAMA_UNREACHABLE_MESSAGE} — falling back for this turn to "${fallback.provider}" (${fallback.model}) without changing stored provider`,
              );
              if (callbacks.onMetadata) {
                callbacks.onMetadata({
                  ollamaFallbackNotice: OLLAMA_UNREACHABLE_MESSAGE,
                  fallbackProvider: fallback.provider,
                });
              }
              // Check if fallback provider has a key configured; if so, transparently execute the turn on fallback provider
              const hasFallbackKey =
                fallback.provider === 'openrouter'
                  ? Boolean(getOpenRouterApiKey() || keys.openrouter)
                  : Boolean(keys[fallback.provider]);
              if (hasFallbackKey) {
                await streamChat(
                  {
                    ...params,
                    provider: fallback.provider,
                    model: fallback.model,
                  },
                  {
                    ...callbacks,
                    onMetadata: callbacks.onMetadata
                      ? (meta) =>
                          callbacks.onMetadata!({
                            ollamaFallbackNotice: OLLAMA_UNREACHABLE_MESSAGE,
                            fallbackProvider: fallback.provider,
                            ...meta,
                          })
                      : undefined,
                  },
                );
                return;
              }
              callbacks.onError(new Error(OLLAMA_UNREACHABLE_MESSAGE));
              return;
            }
            addDebugLog('Chat:APIError', `[Model: ${model}] ${err?.message || String(err)}`);
            callbacks.onError(err);
          }
        }
      })();

      return () => controller.abort();
    }
  }

  // Web / Server proxy behavior
  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        functionDeclarations: getAllSierraFunctionDeclarations(),
      }),
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') && !contentType.includes('application/json')) {
      const text = await res.text();
      logQuotaOrRateLimitError('Chat', effectiveModel, text, res.status);
      addDebugLog('Chat:APIError', `[Model: ${effectiveModel}] Non-stream response (${res.status}): ${text.slice(0, 160)}`);
      callbacks.onError(new Error(`Server returned non-stream response (${res.status}): ${text.slice(0, 120)}`));
      return () => controller.abort();
    }

    if (!res.ok) {
      const errText = await res.text();
      const isQuota429 = logQuotaOrRateLimitError('Chat', effectiveModel, errText, res.status);
      addDebugLog('Chat:APIError', `[Model: ${effectiveModel}] HTTP ${res.status}: ${errText.slice(0, 240)}`);
      if (res.status === 401) {
        callbacks.onMetadata?.({ status: 401, auth401Provider: effectiveProvider, failedProvider: effectiveProvider, failedModel: effectiveModel });
        callbacks.onError(createProviderHttpError(formatProvider401Error(effectiveProvider, errText), 401, effectiveProvider));
        return () => controller.abort();
      }
      if (effectiveProvider === 'gemini' && isQuota429) {
        callbacks.onMetadata?.({
          geminiQuotaExhausted: true,
          failedModel: effectiveModel,
        });
        callbacks.onError(
          new Error(`${GEMINI_QUOTA_EXHAUSTED_MESSAGE} (${res.status}) [${effectiveModel}]: ${errText}`),
        );
        return () => controller.abort();
      }
      callbacks.onError(new Error(`Chat request failed (${res.status}) [${effectiveModel}]: ${errText}`));
      return () => controller.abort();
    }

    callbacks.onMetadata?.({
      answeredModel: effectiveModel,
      provider: effectiveProvider,
    });

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error('No response stream available.'));
      return () => controller.abort();
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.error) {
                const isQuota429 = logQuotaOrRateLimitError('Chat', effectiveModel, data.error);
                addDebugLog('Chat:APIError', `[Model: ${effectiveModel}] ${data.error}`);
                if (effectiveProvider === 'gemini' && isQuota429) {
                  callbacks.onMetadata?.({
                    geminiQuotaExhausted: true,
                    failedModel: effectiveModel,
                  });
                  callbacks.onError(
                    new Error(`${GEMINI_QUOTA_EXHAUSTED_MESSAGE} [${effectiveModel}]: ${data.error}`),
                  );
                  return;
                }
                callbacks.onError(new Error(data.error));
                return;
              }
              if (data.toolCall && data.toolCall.name) {
                const outcome = await executeSierraToolCall(data.toolCall.name, data.toolCall.args || {});
                if (!data.suppressToolFallbackText) {
                  callbacks.onChunk(outcome.message);
                }
              }
              if (data.chunk) {
                callbacks.onChunk(data.chunk);
              }
              if (data.metadata && callbacks.onMetadata) {
                callbacks.onMetadata(data.metadata);
              }
              if (data.done) {
                callbacks.onDone();
                return;
              }
            } catch (_) {}
          }
        }
        callbacks.onDone();
      } catch (streamErr: any) {
        if (streamErr.name !== 'AbortError') {
          logQuotaOrRateLimitError('Chat', effectiveModel, streamErr);
          addDebugLog('Chat:APIError', `[Model: ${effectiveModel}] Stream error: ${streamErr?.message || String(streamErr)}`);
          callbacks.onError(streamErr);
        }
      }
    })();
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      if (effectiveProvider === 'ollama' && isOllamaUnreachableFetchError(err)) {
        const fallback = resolveFallbackDefaultChatProvider();
        addDebugLog(
          'Chat:OllamaFallback',
          `${OLLAMA_UNREACHABLE_MESSAGE} — falling back for this turn to "${fallback.provider}" (${fallback.model}) without changing stored provider`,
        );
        if (callbacks.onMetadata) {
          callbacks.onMetadata({
            ollamaFallbackNotice: OLLAMA_UNREACHABLE_MESSAGE,
            fallbackProvider: fallback.provider,
          });
        }
        if (fallback.provider && fallback.provider !== 'ollama') {
          streamChat(
            {
              ...params,
              provider: fallback.provider,
              model: fallback.model,
            },
            {
              ...callbacks,
              onMetadata: callbacks.onMetadata
                ? (meta) =>
                    callbacks.onMetadata!({
                      ollamaFallbackNotice: OLLAMA_UNREACHABLE_MESSAGE,
                      fallbackProvider: fallback.provider,
                      ...meta,
                    })
                : undefined,
            },
          );
          return () => controller.abort();
        }
        callbacks.onError(new Error(OLLAMA_UNREACHABLE_MESSAGE));
        return () => controller.abort();
      }
      logQuotaOrRateLimitError('Chat', effectiveModel, err);
      addDebugLog('Chat:APIError', `[Model: ${effectiveModel}] Fetch error: ${err?.message || String(err)}`);
      callbacks.onError(err);
    }
  }

  return () => controller.abort();
}

export async function generateMediaImage(params: {
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  personGeneration?: string;
  model?: string;
}): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const keys = getNativeStoredKeys();
    const effectiveKey = keys.gemini;
    if (!effectiveKey) {
      throw new Error("Gemini API key is required for image generation. Please set your key in Settings.");
    }
    const baseHttp = (getProviderHttpEndpoint('gemini') || DEFAULT_PROVIDER_ENDPOINTS.gemini.httpEndpoint).replace(/\/+$/, '');
    const url = `${baseHttp}/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(effectiveKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: params.prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: params.aspectRatio || "1:1",
        }
      })
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 120)}`);
    }
    const data = await res.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (b64) {
      return `data:image/jpeg;base64,${b64}`;
    }
    throw new Error(data.error?.message || "Failed to generate image on device");
  }

  const res = await fetch('/api/media/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  if (!res.ok || !data.imageUrl) {
    throw new Error(data.error || 'Failed to generate image');
  }
  return data.imageUrl;
}

export async function generateMediaVideo(params: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  fps?: number;
  model?: string;
}): Promise<string> {
  const res = await fetch('/api/media/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  if (!res.ok || !data.videoUrl) {
    throw new Error(data.error || 'Failed to generate video');
  }
  return data.videoUrl;
}

export async function fetchLiveVoiceToken(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const keys = getNativeStoredKeys();
    const key = keys.gemini;
    if (!key) {
      throw new Error('Gemini API key is required for Continuous Voice Chat. Please enter your API key in Settings.');
    }
    return key;
  }

  const res = await fetch('/api/live/token', { method: 'POST' });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error(data.error || 'Failed to obtain live voice ephemeral token');
  }
  return data.token;
}
