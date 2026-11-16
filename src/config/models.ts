import { addDebugLog } from '../lib/debugLogStore';
import {
  syncNonSecretStateToNative,
  loadNonSecretStateFromNative,
  EMAIL_ACCOUNTS_META_STORAGE_KEY,
  EMAIL_TOOLS_ENABLED_STORAGE_KEY,
} from '../lib/emailTools';
import { STORAGE_KEY_DEVICE_CAPABILITIES } from '../lib/deviceControl';
import {
  DEFAULT_OPENROUTER_PAID_MODEL,
  getProviderHttpEndpoint,
  getSettings,
  updateSettings,
  hydrateSettingsFromNative,
} from '../lib/settingsStore';

export { syncNonSecretStateToNative };

export interface ModelCapabilityFlags {
  isLive: boolean;
  supportsSearchGrounding: boolean;
  supportsMapsGrounding: boolean;
  supportsExtendedThinking: boolean;
  supportsResponseSpeed: boolean;
  supportsFunctionCalling: boolean;
}

export interface ModelDefinition extends ModelCapabilityFlags {
  id: string;
  label: string;
  name: string;
  badge?: string;
  /**
   * Optional upstream fallback model ID if the primary preview/next-gen alias
   * returns 404 Not Found from the Generative Language endpoint.
   */
  fallbackApiModelId?: string;
}

export const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';

export const STORAGE_KEY_TEXT_MODEL = 'sierra_text_model';
export const STORAGE_KEY_TEXT_CUSTOM_MODEL = 'sierra_text_custom_model';
export const STORAGE_KEY_LIVE_MODEL = 'sierra_live_voice_model';
export const STORAGE_KEY_LIVE_CUSTOM_MODEL = 'sierra_live_voice_custom_model';

export const TEXT_MODELS: ModelDefinition[] = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    name: 'Gemini 3.5 Flash Lite',
    badge: 'Fast Default',
    isLive: false,
    supportsSearchGrounding: true,
    supportsMapsGrounding: false,
    supportsExtendedThinking: false,
    supportsResponseSpeed: false,
    supportsFunctionCalling: true,
    fallbackApiModelId: 'gemini-2.5-flash',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    name: 'Gemini 3.8 Flash',
    badge: 'Next-Gen',
    isLive: false,
    supportsSearchGrounding: true,
    supportsMapsGrounding: true,
    supportsExtendedThinking: false,
    supportsResponseSpeed: true,
    supportsFunctionCalling: true,
    fallbackApiModelId: 'gemini-2.5-flash',
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    name: 'Gemini 3.6 Flash',
    badge: 'Balanced',
    isLive: false,
    supportsSearchGrounding: true,
    supportsMapsGrounding: true,
    supportsExtendedThinking: false,
    supportsResponseSpeed: true,
    supportsFunctionCalling: true,
    fallbackApiModelId: 'gemini-2.5-flash',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    name: 'Gemini 3.1 Pro Preview',
    badge: 'Reasoning',
    isLive: false,
    supportsSearchGrounding: true,
    supportsMapsGrounding: true,
    supportsExtendedThinking: false,
    supportsResponseSpeed: false,
    supportsFunctionCalling: true,
    fallbackApiModelId: 'gemini-2.5-pro',
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    name: 'Gemini 3 Flash Preview',
    badge: 'Fast & Smart',
    isLive: false,
    supportsSearchGrounding: true,
    supportsMapsGrounding: true,
    supportsExtendedThinking: false,
    supportsResponseSpeed: true,
    supportsFunctionCalling: true,
    fallbackApiModelId: 'gemini-2.5-flash',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    name: 'Gemini 2.5 Flash',
    badge: 'Stable',
    isLive: false,
    supportsSearchGrounding: true,
    supportsMapsGrounding: true,
    supportsExtendedThinking: false,
    supportsResponseSpeed: true,
    supportsFunctionCalling: true,
  },
];

export const LIVE_MODELS: ModelDefinition[] = [
  {
    id: 'gemini-3.8-live',
    label: 'Gemini 3.8 Live (Ultra-Fast Native Audio)',
    name: 'Gemini 3.8 Live (Ultra-Fast Native Audio)',
    badge: 'Default Live',
    isLive: true,
    supportsSearchGrounding: true,
    supportsMapsGrounding: false,
    supportsExtendedThinking: false,
    supportsResponseSpeed: false,
    supportsFunctionCalling: true,
  },
  {
    id: 'gemini-3.8-live-extended-thinking',
    label: 'Gemini 3.8 Live (Extended Thinking)',
    name: 'Gemini 3.8 Live (Extended Thinking)',
    badge: 'Deep Live',
    isLive: true,
    supportsSearchGrounding: true,
    supportsMapsGrounding: false,
    supportsExtendedThinking: true,
    supportsResponseSpeed: false,
    supportsFunctionCalling: true,
  },
  {
    id: 'gemini-3.1-flash-live-preview',
    label: 'Gemini 3.1 Flash Live (Low-Latency Audio)',
    name: 'Gemini 3.1 Flash Live (Low-Latency Audio)',
    badge: 'Preview',
    isLive: true,
    supportsSearchGrounding: true,
    supportsMapsGrounding: false,
    supportsExtendedThinking: false,
    supportsResponseSpeed: false,
    supportsFunctionCalling: true,
  },
  {
    id: 'gemini-2.5-flash-live',
    label: 'Gemini 2.5 Flash Live (Real-Time Voice)',
    name: 'Gemini 2.5 Flash Live (Real-Time Voice)',
    badge: 'Stable Live',
    isLive: true,
    supportsSearchGrounding: true,
    supportsMapsGrounding: false,
    supportsExtendedThinking: false,
    supportsResponseSpeed: false,
    supportsFunctionCalling: true,
  },
  {
    id: 'gemini-2.0-flash-live',
    label: 'Gemini 2.0 Flash Live (Legacy)',
    name: 'Gemini 2.0 Flash Live (Legacy)',
    badge: 'Legacy',
    isLive: true,
    supportsSearchGrounding: true,
    supportsMapsGrounding: false,
    supportsExtendedThinking: false,
    supportsResponseSpeed: false,
    supportsFunctionCalling: true,
  },
];

export const ALL_GEMINI_MODELS: ModelDefinition[] = [...TEXT_MODELS, ...LIVE_MODELS];

export function stripModelsPrefix(model?: string | null): string {
  return String(model || '').trim().replace(/^models\//i, '');
}

export function isLiveModelId(model?: string | null): boolean {
  const clean = stripModelsPrefix(model).toLowerCase();
  if (!clean) return false;
  if (LIVE_MODELS.some((m) => m.id.toLowerCase() === clean)) return true;
  return (
    clean.includes('-live') ||
    clean.endsWith('live') ||
    clean.includes('native-audio')
  );
}

export function isExtendedThinkingLiveModelId(model?: string | null): boolean {
  const clean = stripModelsPrefix(model).toLowerCase();
  return clean === 'gemini-3.8-live-extended-thinking';
}

export function getModelDefinition(model?: string | null): ModelDefinition | undefined {
  const clean = stripModelsPrefix(model).toLowerCase();
  if (!clean) return undefined;
  return ALL_GEMINI_MODELS.find((m) => m.id.toLowerCase() === clean);
}

export function doesModelSupportMapsGrounding(
  model?: string | null,
  provider: string = 'gemini',
): boolean {
  if (provider !== 'gemini') return false;
  const clean = stripModelsPrefix(model).toLowerCase();
  if (!clean) return true;
  if (isLiveModelId(clean)) return false;
  const def = getModelDefinition(clean);
  if (def) return def.supportsMapsGrounding;
  // Custom Gemini 2.0 / 2.5 / 3.x text models support Maps grounding
  return clean.startsWith('gemini-');
}

export function doesModelSupportSearchGrounding(
  model?: string | null,
  provider: string = 'gemini',
): boolean {
  if (provider !== 'gemini') return false;
  const clean = stripModelsPrefix(model).toLowerCase();
  if (!clean) return true;
  const def = getModelDefinition(clean);
  if (def) return def.supportsSearchGrounding;
  return clean.startsWith('gemini-');
}

export function doesModelSupportResponseSpeedConfig(
  model?: string | null,
  provider: string = 'gemini',
): boolean {
  if (provider !== 'gemini') return false;
  const clean = stripModelsPrefix(model).toLowerCase();
  if (!clean) return false;
  // Lite models and preview aliases like gemini-3.5-flash-lite should not have thinkingBudget forced
  if (clean.includes('lite')) return false;
  const def = getModelDefinition(clean);
  if (def) return def.supportsResponseSpeed;
  return clean.includes('gemini-2.5-flash') || clean.includes('gemini-3-flash');
}

export const STORAGE_KEY_API_MODEL_CAPABILITIES = 'sierra_api_model_capabilities';

export interface ApiReportedModelCapability {
  modelId: string;
  supportsFunctionCalling: boolean;
  supportedGenerationMethods?: string[];
  source: 'models.get' | 'models.list' | 'bidi.setup' | 'generateContent';
  reason?: string;
  updatedAt: number;
}

const inMemoryApiCapabilities: Record<string, ApiReportedModelCapability> = {};

function loadApiCapabilitiesMap(): Record<string, ApiReportedModelCapability> {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_API_MODEL_CAPABILITIES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return { ...parsed, ...inMemoryApiCapabilities };
        }
      }
    } catch {
      // ignore
    }
  }
  return { ...inMemoryApiCapabilities };
}

function saveApiCapabilitiesMap(map: Record<string, ApiReportedModelCapability>): void {
  Object.assign(inMemoryApiCapabilities, map);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY_API_MODEL_CAPABILITIES, JSON.stringify(map));
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sierra_model_capabilities_updated', { detail: map }));
  }
}

export function clearApiReportedModelCapabilitiesForTests(): void {
  for (const k of Object.keys(inMemoryApiCapabilities)) {
    delete inMemoryApiCapabilities[k];
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY_API_MODEL_CAPABILITIES);
  }
}

/**
 * Records what the Gemini API reported about a model's function-calling / tool support
 * (from `models.get`, `models.list`, `BidiGenerateContent` setup/error, or `generateContent`).
 */
export function recordModelFunctionCallingSupportFromApi(
  modelId: string,
  supportsFunctionCalling: boolean,
  source: ApiReportedModelCapability['source'] = 'models.get',
  supportedGenerationMethods?: string[],
  reason?: string,
): ApiReportedModelCapability {
  const clean = stripModelsPrefix(modelId).toLowerCase();
  const map = loadApiCapabilitiesMap();
  const entry: ApiReportedModelCapability = {
    modelId: clean,
    supportsFunctionCalling,
    ...(supportedGenerationMethods ? { supportedGenerationMethods } : {}),
    source,
    ...(reason ? { reason } : {}),
    updatedAt: Date.now(),
  };
  map[clean] = entry;
  saveApiCapabilitiesMap(map);
  addDebugLog(
    'Models:ApiCapability',
    `API reported model="${clean}" supportsFunctionCalling=${supportsFunctionCalling} (source=${source}${reason ? `, reason=${reason}` : ''})`,
  );
  return entry;
}

/**
 * Evaluates raw model metadata returned by the Gemini API (`models.get` or `models.list`)
 * and records whether the API reports function-calling support for that model.
 */
export function ingestApiModelMetadata(apiModel: {
  name?: string;
  id?: string;
  supportedGenerationMethods?: string[];
  supportsFunctionCalling?: boolean;
  capabilities?: { functionCalling?: boolean; tools?: boolean };
  description?: string;
}): ApiReportedModelCapability | null {
  const rawName = apiModel?.name || apiModel?.id || '';
  const clean = stripModelsPrefix(rawName).toLowerCase();
  if (!clean) return null;

  let supported = true;
  let reason = '';

  if (typeof apiModel.supportsFunctionCalling === 'boolean') {
    supported = apiModel.supportsFunctionCalling;
    reason = `apiModel.supportsFunctionCalling=${supported}`;
  } else if (typeof apiModel.capabilities?.functionCalling === 'boolean') {
    supported = apiModel.capabilities.functionCalling;
    reason = `apiModel.capabilities.functionCalling=${supported}`;
  } else if (typeof apiModel.capabilities?.tools === 'boolean') {
    supported = apiModel.capabilities.tools;
    reason = `apiModel.capabilities.tools=${supported}`;
  } else if (Array.isArray(apiModel.supportedGenerationMethods)) {
    const methods = apiModel.supportedGenerationMethods;
    const canGenerateOrBidi =
      methods.includes('generateContent') ||
      methods.includes('bidiGenerateContent') ||
      methods.includes('streamGenerateContent');
    if (!canGenerateOrBidi) {
      supported = false;
      reason = `supportedGenerationMethods=[${methods.join(',')}] lacks generateContent/bidiGenerateContent`;
    } else if (
      typeof apiModel.description === 'string' &&
      /does not support (function calling|tools)|no tool support/i.test(apiModel.description)
    ) {
      supported = false;
      reason = 'API description states no function calling support';
    } else {
      supported = true;
      reason = `supportedGenerationMethods=[${methods.join(',')}]`;
    }
  }

  return recordModelFunctionCallingSupportFromApi(
    clean,
    supported,
    'models.get',
    apiModel.supportedGenerationMethods,
    reason,
  );
}

/**
 * Inspects an API error message (from BidiGenerateContent or generateContent) to detect
 * if the API rejected the request specifically because the model does not support tools/function calling.
 */
export function inspectApiErrorForToolSupport(modelId: string, errorOrMessage: unknown): boolean {
  const msg =
    typeof errorOrMessage === 'string'
      ? errorOrMessage
      : (errorOrMessage as any)?.message || String(errorOrMessage || '');
  if (
    /function calling is not (enabled|supported)|tools are not supported|does not support (tools|function calling)|tool use is not supported/i.test(
      msg,
    )
  ) {
    recordModelFunctionCallingSupportFromApi(modelId, false, 'bidi.setup', undefined, msg.slice(0, 160));
    return false;
  }
  return true;
}

/**
 * Queries the Gemini REST API (`GET /v1beta/models/{model}`) to check what the API reports
 * for a model's capabilities and updates the API capability store.
 */
export async function probeModelFunctionCallingFromApi(
  apiKey: string,
  modelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const clean = stripModelsPrefix(modelId);
  if (!clean || !apiKey) return doesModelSupportFunctionCalling(clean);

  try {
    const baseHttp = getProviderHttpEndpoint('gemini').replace(/\/+$/, '');
    const url = `${baseHttp}/models/${encodeURIComponent(clean)}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url);
    if (res.ok) {
      const data = await res.json();
      const recorded = ingestApiModelMetadata({ ...data, name: clean });
      if (recorded) return recorded.supportsFunctionCalling;
    }
  } catch {
    // Network offline or unreachable; preserve last known API state
  }
  return doesModelSupportFunctionCalling(clean);
}

export function getApiReportedModelCapabilities(): Record<string, ApiReportedModelCapability> {
  return loadApiCapabilitiesMap();
}

/**
 * Returns whether `model` supports Gemini function calling / tool declarations.
 * Reads from the API-reported capability registry (`sierra_api_model_capabilities`) populated by
 * `ingestApiModelMetadata`, `probeModelFunctionCallingFromApi`, and `recordModelFunctionCallingSupportFromApi`.
 */
export function doesModelSupportFunctionCalling(
  model?: string | null,
  provider: string = 'gemini',
): boolean {
  if (provider !== 'gemini') return false;
  const clean = stripModelsPrefix(model).toLowerCase();
  if (!clean) return false;

  const apiMap = loadApiCapabilitiesMap();
  if (clean in apiMap) {
    return apiMap[clean].supportsFunctionCalling;
  }

  const def = getModelDefinition(clean);
  if (def) return def.supportsFunctionCalling;
  return clean.startsWith('gemini-');
}

export function getModelToolSupportLabel(model?: string | null): string | null {
  return doesModelSupportFunctionCalling(model) ? null : 'no tool support';
}

export function resolveFallbackApiModelId(model?: string | null): string | null {
  const clean = stripModelsPrefix(model);
  const def = getModelDefinition(clean);
  if (def?.fallbackApiModelId) return def.fallbackApiModelId;
  const lower = clean.toLowerCase();
  if (lower.startsWith('gemini-3.5-flash') || lower.startsWith('gemini-3.6-flash') || lower.startsWith('gemini-3.8-flash')) {
    return 'gemini-2.5-flash';
  }
  return null;
}

function canUseStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

export function getStoredTextModel(): string {
  const settings = getSettings();
  const saved =
    settings.models.chatProvider === 'gemini'
      ? stripModelsPrefix(settings.models.chatText)
      : stripModelsPrefix(settings.chatProviders.gemini?.selectedModel);
  if (saved && !isLiveModelId(saved)) {
    return saved;
  }
  return DEFAULT_TEXT_MODEL;
}

export function setStoredTextModel(model: string): void {
  const clean = stripModelsPrefix(model) || DEFAULT_TEXT_MODEL;
  updateSettings((draft) => {
    draft.chatProviders.gemini.selectedModel = clean;
    if (draft.models.chatProvider === 'gemini') {
      draft.models.chatText = draft.chatProviders.gemini.customModel?.trim() || clean;
    }
    return draft;
  });
}

export function getStoredTextCustomModel(): string {
  return stripModelsPrefix(getSettings().chatProviders.gemini?.customModel);
}

export function setStoredTextCustomModel(customModel: string): void {
  const clean = stripModelsPrefix(customModel);
  updateSettings((draft) => {
    draft.chatProviders.gemini.customModel = clean;
    if (draft.models.chatProvider === 'gemini') {
      draft.models.chatText = clean || draft.chatProviders.gemini.selectedModel || DEFAULT_TEXT_MODEL;
    }
    return draft;
  });
}

export function getEffectiveTextModel(selectedDropdownModel?: string | null, customOverride?: string | null): string {
  const custom = customOverride !== undefined && customOverride !== null
    ? stripModelsPrefix(customOverride)
    : getStoredTextCustomModel();
  if (custom && !isLiveModelId(custom)) {
    return custom;
  }
  const candidate = stripModelsPrefix(selectedDropdownModel) || getStoredTextModel();
  if (candidate && !isLiveModelId(candidate)) {
    return candidate;
  }
  return DEFAULT_TEXT_MODEL;
}

export function getStoredLiveModel(): string {
  const settings = getSettings();
  const saved = stripModelsPrefix(settings.models.liveModel);
  if (saved && isLiveModelId(saved)) {
    return saved;
  }
  return DEFAULT_LIVE_MODEL;
}

export function setStoredLiveModel(model: string): void {
  const clean = stripModelsPrefix(model);
  const next = clean && isLiveModelId(clean) ? clean : DEFAULT_LIVE_MODEL;
  updateSettings((draft) => {
    draft.models.liveModel = next;
    return draft;
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sierra_live_model_updated', { detail: { model: next } }));
  }
}

export function getStoredLiveCustomModel(): string {
  const settings = getSettings();
  if (settings.models.liveProvider === 'openrouter') return '';
  return stripModelsPrefix(settings.models.liveCustomModelSlug);
}

export function setStoredLiveCustomModel(customModel: string): void {
  const clean = stripModelsPrefix(customModel);
  updateSettings((draft) => {
    draft.models.liveCustomModelSlug = clean;
    return draft;
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sierra_live_model_updated', {
        detail: { customModel: clean, effectiveModel: getEffectiveLiveModel(undefined, clean) },
      }),
    );
  }
}

export function getEffectiveLiveModel(selectedDropdownModel?: string | null, customOverride?: string | null): string {
  const custom = customOverride !== undefined && customOverride !== null
    ? stripModelsPrefix(customOverride)
    : getStoredLiveCustomModel();
  if (custom) {
    return custom;
  }
  const candidate = stripModelsPrefix(selectedDropdownModel) || getStoredLiveModel();
  if (candidate && isLiveModelId(candidate)) {
    return candidate;
  }
  return DEFAULT_LIVE_MODEL;
}

/**
 * Hydrates non-secret persistent state (v3 settings, connected email account metadata,
 * tool enabled states) from Android SharedPreferences on launch so state survives
 * app close and Android Force Stop.
 */
export async function hydratePersistentStateFromNative(): Promise<void> {
  if (!canUseStorage()) return;
  await hydrateSettingsFromNative();
  const keys = [
    STORAGE_KEY_DEVICE_CAPABILITIES,
    EMAIL_ACCOUNTS_META_STORAGE_KEY,
    EMAIL_TOOLS_ENABLED_STORAGE_KEY,
  ];
  for (const key of keys) {
    try {
      const current = localStorage.getItem(key);
      const nativeVal = await loadNonSecretStateFromNative(key);
      if (!current && nativeVal) {
        localStorage.setItem(key, nativeVal);
      } else if (current && !nativeVal) {
        await syncNonSecretStateToNative(key, current);
      }
    } catch {
      // ignore
    }
  }
}

export function isQuotaOrRateLimitError(errorOrMessage: unknown, statusCode?: number): boolean {
  if (statusCode === 429) return true;
  const msg = typeof errorOrMessage === 'string'
    ? errorOrMessage
    : (errorOrMessage as any)?.message || String(errorOrMessage || '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  );
}

/**
 * Surfaces quota / 429 errors in the persistent debug log with the model name included.
 */
export function logQuotaOrRateLimitError(
  stage: string,
  model: string,
  errorOrMessage: unknown,
  statusCode?: number,
): boolean {
  const msg = typeof errorOrMessage === 'string'
    ? errorOrMessage
    : (errorOrMessage as any)?.message || String(errorOrMessage || '');
  const cleanModel = stripModelsPrefix(model) || 'unknown-model';
  if (isQuotaOrRateLimitError(msg, statusCode)) {
    addDebugLog(
      `${stage}:Quota429`,
      `[Model: ${cleanModel}] Quota/429 error${statusCode ? ` (HTTP ${statusCode})` : ''}: ${msg.slice(0, 320)}`,
    );
    return true;
  }
  return false;
}
