import {
  CompanionIdentity,
  ContentMode,
  PersonaId,
  UNIFIED_PERSONAS,
  SUPPORTED_LIVE_LANGUAGES,
  getConversationSummaries,
  getVoiceCapabilitiesState,
  getOpenRouterApiKey,
  resolveOpenRouterApiKeyWithSource,
} from './persona';
import { getContentMode } from './contentModeStore';
import { LocalSentenceSplitter } from './localVoiceEngine';
import { addDebugLog } from './debugLogStore';
import {
  DEFAULT_OPENROUTER_PAID_MODEL,
  DEFAULT_OPENROUTER_PAID_MODEL as OPENROUTER_DEFAULT_PAID_MODEL,
  DEFAULT_PROVIDER_ENDPOINTS,
  getProviderHttpEndpoint,
  getSettings,
  updateSettings,
} from './settingsStore';

export { OPENROUTER_DEFAULT_PAID_MODEL };
export const OPENROUTER_MODELS_ENDPOINT = `${DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint}/models`;
export const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = `${DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint}/chat/completions`;

export const STORAGE_KEY_OPENROUTER_MODEL_SETTINGS =
  'sierra_openrouter_model_settings_v1';

export const FREE_MODEL_MATURE_WARNING_LABEL = 'may refuse adult content';

export const OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES = 3;
export const OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS = 500;
export const OPENROUTER_CLOUD_LIVE_MAX_HISTORY_MESSAGES = 8;
export const OPENROUTER_CLOUD_LIVE_TARGET_MIN_TOKENS = 700;
export const OPENROUTER_CLOUD_LIVE_TARGET_MAX_TOKENS = 1000;

export interface OpenRouterModelOption {
  id: string;
  name: string;
  isFree: boolean;
  promptPrice: string;
  completionPrice: string;
  contextLength?: number;
  warningLabel?: string;
}

export type OpenRouterModelDescriptor = OpenRouterModelOption;

export interface OpenRouterModelSettings {
  selectedModel: string;
  customSlug: string;
  customModelSlug: string;
  tryFreeFirst: boolean;
  lastErrorText: string;
  lastErrorModel: string;
}

export const DEFAULT_OPENROUTER_MODEL_SETTINGS: OpenRouterModelSettings = {
  selectedModel: OPENROUTER_DEFAULT_PAID_MODEL,
  customSlug: '',
  customModelSlug: '',
  tryFreeFirst: false,
  lastErrorText: '',
  lastErrorModel: '',
};

export function formatOpenRouterFreeModelLabel(nameOrId: string): string {
  const base = (nameOrId || '').trim();
  if (!base) return `Free (${FREE_MODEL_MATURE_WARNING_LABEL})`;
  if (base.toLowerCase().includes(FREE_MODEL_MATURE_WARNING_LABEL)) {
    return base;
  }
  return `${base} (Free — ${FREE_MODEL_MATURE_WARNING_LABEL})`;
}

export type OpenRouterFreeModelsResponse = OpenRouterModelOption[] & {
  ok: boolean;
  models: OpenRouterModelOption[];
};

let cachedFreeModels: OpenRouterModelOption[] = [];
let lastFreeModelsFetchMs = 0;

function isZeroPriceValue(val: unknown): boolean {
  if (val === 0 || val === '0' || val === '0.0' || val === '0.00') return true;
  if (typeof val === 'number') return val === 0;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return false;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed === 0;
  }
  return false;
}

function attachFreeModelsMeta(list: OpenRouterModelOption[], ok = true): OpenRouterFreeModelsResponse {
  const arr = [...list] as OpenRouterFreeModelsResponse;
  arr.ok = ok;
  arr.models = list;
  return arr;
}

/**
 * Pure filter function for OpenRouter's `/api/v1/models` response.
 * Filters strictly to `:free` model IDs with zero prompt and completion pricing.
 * Labels free models with "may refuse adult content".
 */
export function filterOpenRouterFreeModels(rawPayload: unknown): OpenRouterModelOption[] {
  const rawModels = Array.isArray(rawPayload)
    ? rawPayload
    : rawPayload && typeof rawPayload === 'object' && Array.isArray((rawPayload as any).data)
      ? (rawPayload as any).data
      : [];
  const results: OpenRouterModelOption[] = [];
  const seen = new Set<string>();

  for (const item of rawModels) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, any>;
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id || !id.endsWith(':free') || seen.has(id)) continue;

    const pricing = m.pricing && typeof m.pricing === 'object' ? m.pricing : null;
    if (!pricing) continue;

    const promptZero = isZeroPriceValue(pricing.prompt);
    const completionZero = isZeroPriceValue(pricing.completion);
    if (!promptZero || !completionZero) continue;

    seen.add(id);
    const rawName = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : id;
    results.push({
      id,
      name: rawName,
      isFree: true,
      promptPrice: '0',
      completionPrice: '0',
      contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
      warningLabel: FREE_MODEL_MATURE_WARNING_LABEL,
    });
  }

  return results;
}

export async function fetchOpenRouterFreeModels(
  forceRefresh = false,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterFreeModelsResponse> {
  const now = Date.now();
  if (!forceRefresh && cachedFreeModels.length > 0 && now - lastFreeModelsFetchMs < 5 * 60 * 1000) {
    return attachFreeModelsMeta(cachedFreeModels, true);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const baseHttp = getProviderHttpEndpoint('openrouter') || DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint;
  const modelsUrl = `${baseHttp.replace(/\/+$/, '')}/models`;
  addDebugLog('OpenRouter:ModelsRequest', `GET ${modelsUrl}`);
  try {
    const res = await fetchImpl(modelsUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching OpenRouter models`);
    }
    const json = await res.json();
    cachedFreeModels = filterOpenRouterFreeModels(json);
    lastFreeModelsFetchMs = Date.now();
    addDebugLog(
      'OpenRouter:Models',
      `Fetched ${cachedFreeModels.length} live :free models with zero pricing from OpenRouter API`,
    );
    return attachFreeModelsMeta(cachedFreeModels, true);
  } catch (err: any) {
    addDebugLog(
      'OpenRouter:ModelsWarning',
      `Could not fetch free models list: ${err?.message || String(err)}`,
    );
    return attachFreeModelsMeta(cachedFreeModels, false);
  } finally {
    clearTimeout(timeout);
  }
}

export function getCachedOpenRouterFreeModels(): OpenRouterModelOption[] {
  return cachedFreeModels;
}

export function getOpenRouterModelSettings(): OpenRouterModelSettings {
  const settings = getSettings();
  const useLiveModels = settings.models.liveProvider === 'openrouter';
  const slug = (
    useLiveModels
      ? settings.models.liveCustomModelSlug || settings.live.openRouterCustomSlug
      : settings.live.openRouterCustomSlug
  ).trim();
  const selected = (
    useLiveModels
      ? settings.models.liveModel || settings.live.openRouterModel
      : settings.live.openRouterModel
  ).trim();
  return {
    selectedModel: selected || DEFAULT_OPENROUTER_PAID_MODEL,
    customSlug: slug,
    customModelSlug: slug,
    tryFreeFirst: settings.live.openRouterTryFreeFirst === true,
    lastErrorText: settings.live.openRouterLastErrorText || '',
    lastErrorModel: settings.live.openRouterLastErrorModel || '',
  };
}

export function saveOpenRouterModelSettings(
  patch: Partial<OpenRouterModelSettings>,
): OpenRouterModelSettings {
  const current = getOpenRouterModelSettings();
  const nextSlug =
    patch.customSlug !== undefined
      ? patch.customSlug.trim()
      : patch.customModelSlug !== undefined
        ? patch.customModelSlug.trim()
        : current.customSlug;
  const updated: OpenRouterModelSettings = {
    ...current,
    ...patch,
    selectedModel:
      patch.selectedModel !== undefined
        ? patch.selectedModel.trim() || DEFAULT_OPENROUTER_PAID_MODEL
        : current.selectedModel,
    customSlug: nextSlug,
    customModelSlug: nextSlug,
  };
  updateSettings(
    (draft) => {
      draft.live.openRouterModel = updated.selectedModel;
      draft.live.openRouterCustomSlug = updated.customSlug;
      draft.live.openRouterTryFreeFirst = updated.tryFreeFirst;
      draft.live.openRouterLastErrorText = updated.lastErrorText;
      draft.live.openRouterLastErrorModel = updated.lastErrorModel;
      if (draft.models.liveProvider === 'openrouter') {
        draft.models.liveModel = updated.selectedModel;
        draft.models.liveCustomModelSlug = updated.customSlug;
      }
      return draft;
    },
    ['sierra_openrouter_settings_updated']
  );
  return updated;
}

/**
 * Resolves the active OpenRouter model slug based on settings and contentMode:
 * 1. Custom model slug if non-empty
 * 2. When `contentMode` is `mature` (18+), NEVER auto-pick a free model via `tryFreeFirst`.
 *    (Manual selection of a `:free` model when `tryFreeFirst` is false is still respected.)
 * 3. When `contentMode` is `sfw` and `tryFreeFirst` is enabled: selectedModel if `:free`,
 *    otherwise first available runtime `:free` model.
 * 4. `selectedModel` (defaults to `cognitivecomputations/dolphin-mistral-24b-venice-edition`).
 */
export function resolveEffectiveOpenRouterModel(
  settings: OpenRouterModelSettings = getOpenRouterModelSettings(),
  freeModels: OpenRouterModelOption[] = cachedFreeModels,
  contentMode?: ContentMode,
): string {
  const custom = (settings.customSlug || settings.customModelSlug || '').trim();
  if (custom) {
    return custom;
  }

  const effectiveMode: ContentMode = contentMode || getContentMode();

  if (effectiveMode === 'mature') {
    // In mature/18+ mode, do not auto-pick a free model from tryFreeFirst.
    // If the user explicitly manually selected a model (with tryFreeFirst off), respect it.
    if (settings.tryFreeFirst) {
      if (settings.selectedModel && !settings.selectedModel.endsWith(':free')) {
        return settings.selectedModel;
      }
      return OPENROUTER_DEFAULT_PAID_MODEL;
    }
    return settings.selectedModel || OPENROUTER_DEFAULT_PAID_MODEL;
  }

  if (settings.tryFreeFirst) {
    if (settings.selectedModel && settings.selectedModel.endsWith(':free')) {
      return settings.selectedModel;
    }
    if (freeModels.length > 0) {
      return freeModels[0].id;
    }
  }
  return settings.selectedModel || OPENROUTER_DEFAULT_PAID_MODEL;
}

/**
 * One-tap user action to switch OpenRouter model to the default paid uncensored model
 * (`cognitivecomputations/dolphin-mistral-24b-venice-edition`).
 */
export function fallbackToOpenRouterPaidDefault(reason?: string): string {
  saveOpenRouterModelSettings({
    selectedModel: OPENROUTER_DEFAULT_PAID_MODEL,
    customSlug: '',
    customModelSlug: '',
    tryFreeFirst: false,
    lastErrorText: '',
    lastErrorModel: '',
  });
  addDebugLog(
    'OpenRouter:Fallback',
    `Switched OpenRouter model to paid default: ${OPENROUTER_DEFAULT_PAID_MODEL}${reason ? ` (after: ${reason})` : ''}`,
  );
  return OPENROUTER_DEFAULT_PAID_MODEL;
}

/**
 * Extracts OpenRouter's real error text from HTTP status and response body.
 */
export function parseOpenRouterErrorResponse(
  status: number,
  bodyText: string,
  model: string,
): string {
  let detail = (bodyText || '').trim();
  let providerSuffix = '';
  try {
    const parsed = JSON.parse(detail);
    const errObj = parsed?.error;
    if (errObj) {
      const msg = typeof errObj.message === 'string' ? errObj.message.trim() : '';
      const rawMeta =
        typeof errObj?.metadata?.raw === 'string' ? errObj.metadata.raw.trim() : '';
      const providerName =
        typeof errObj?.metadata?.provider_name === 'string'
          ? errObj.metadata.provider_name.trim()
          : '';
      if (providerName) {
        providerSuffix = ` [Provider: ${providerName}]`;
      }
      const code = errObj.code ? ` (code ${errObj.code})` : '';
      if (msg && rawMeta && !msg.includes(rawMeta)) {
        detail = `${msg} — ${rawMeta}${code}`;
      } else if (msg) {
        detail = `${msg}${code}`;
      }
    }
  } catch {
    // Keep raw text
  }

  if (!detail) {
    detail = `HTTP ${status}`;
  }
  if (status === 401) {
    return `Invalid or unrecognized API key for OpenRouter — OpenRouter (401) [${model}]: ${detail}${providerSuffix}`;
  }
  return `OpenRouter (${status}) [${model}]: ${detail}${providerSuffix}`;
}

/**
 * Builds a compact memory block for Cloud (OpenRouter) Live prompts:
 * at most 3 memory summaries and at most 500 chars total, scoped per companion identity.
 */
export function buildCompactOpenRouterMemoryBlock(
  maxSummaries = OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES,
  maxChars = OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS,
  identity?: CompanionIdentity,
): { block: string; count: number; availableCount: number; chars: number } {
  const all = identity ? getConversationSummaries(identity) : getConversationSummaries();
  const availableCount = all ? all.length : 0;
  if (!all || all.length === 0 || maxSummaries <= 0 || maxChars <= 0) {
    return { block: '', count: 0, availableCount, chars: 0 };
  }
  const recent = all.slice(-maxSummaries);
  const lines: string[] = [];
  let usedChars = 0;

  for (const item of recent) {
    const cleanSummary = (item.summary || '').replace(/\s+/g, ' ').trim();
    if (!cleanSummary) continue;
    const prefix = `- [${item.source === 'live' ? 'Voice' : 'Chat'}] `;
    const remaining = maxChars - usedChars;
    if (remaining <= prefix.length + 12) break;
    const body =
      cleanSummary.length + prefix.length > remaining
        ? `${cleanSummary.slice(0, Math.max(12, remaining - prefix.length - 3)).trim()}...`
        : cleanSummary;
    const line = `${prefix}${body}`;
    lines.push(line);
    usedChars += line.length + (lines.length > 1 ? 1 : 0);
  }

  if (lines.length === 0) {
    return { block: '', count: 0, availableCount, chars: 0 };
  }
  const joined = lines.join('\n').slice(0, maxChars);
  return {
    block: `[Recent Memory Summaries (${lines.length}/${availableCount}, <=${maxChars} chars)]:\n${joined}`,
    count: lines.length,
    availableCount,
    chars: joined.length,
  };
}

export function estimateOpenRouterTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface BuildOpenRouterPromptParams {
  personaId: PersonaId;
  contentMode: ContentMode;
  companionIdentity?: CompanionIdentity;
  identity?: CompanionIdentity;
  customDirectives?: string;
  languageCode?: string;
  accent?: string;
  tone?: string;
  memoryBlock?: string;
  injectMemory?: boolean;
  isLiveSpoken?: boolean;
}

/**
 * Builds the compact Cloud (OpenRouter) Live system prompt targeting 700-1000 tokens
 * (keeping the full 3,000+ token tool/persona prompt only for Gemini):
 * - Compact persona & Sierra/Tyler identity
 * - Content mode (SFW vs Mature 18+; adult content applies strictly to consenting adult characters)
 * - Honesty line
 * - Spoken-reply rules (concise spoken cadence, accent/tone, language guard)
 * - At most 3 memory summaries (max 500 chars total)
 */
export function buildOpenRouterSystemPrompt(params: BuildOpenRouterPromptParams): string {
  const identity: CompanionIdentity =
    (params.companionIdentity || params.identity) === 'tyler' ? 'tyler' : 'sierra';
  const companionName = identity === 'tyler' ? 'Tyler' : 'Sierra';
  const companionGender = identity === 'tyler' ? 'male' : 'female';
  const safePersonaId: PersonaId =
    params.personaId && params.personaId in UNIFIED_PERSONAS ? params.personaId : 'classy';
  const persona = UNIFIED_PERSONAS[safePersonaId];
  const langCode = params.languageCode || 'en-US';
  const langObj = SUPPORTED_LIVE_LANGUAGES.find(
    (l) => l.code.toLowerCase() === langCode.toLowerCase(),
  );
  const langLabel = langObj ? `${langObj.name} (${langObj.code})` : langCode;
  const cleanAccent =
    params.accent && params.accent !== 'Default' ? params.accent.trim() : 'Natural';
  const cleanTone =
    params.tone && params.tone !== 'Default' ? params.tone.trim() : 'Expressive & Warm';

  const compactPersonaSection = [
    `[IDENTITY & PERSONA]: You are ${companionName}. Speak like an intelligent, perceptive, candid ${companionGender} confidante—never like a customer-service bot, AI assistant, or textbook.`,
    `Active Style — ${persona.name} (${persona.tagline}): ${persona.description}`,
    persona.roleEmphasis,
    `Conversational Behavior:`,
    `- Natural Cadence: Use natural contractions and conversational rhythm. Answer directly without robotic filler, repetitive greetings, or scripted stock phrases.`,
    `- Emotional Attunement: Read the user's mood—playful, teasing, sarcastic, serious, vulnerable, affectionate, or frustrated—and match their energy and depth.`,
    `- Context Continuity: Use recent messages and injected summaries naturally without awkward recaps or claiming total recall.`,
  ].join('\n');

  const contentModeSection =
    params.contentMode === 'mature'
      ? [
          `[CONTENT MODE: MATURE / ADULT 18+]:`,
          `- Consensual Adult Expression: You are an adult companion speaking with a consenting adult. Engage naturally, candidly, and confidently with mature themes, romantic passion, flirtation, spicy banter, sensuality, emotional intimacy, and consensual adult roleplay.`,
          `- Adult Content Scope: Adult content, explicit romance, and uncensored language apply strictly to consenting adult characters (18+) only.`,
          `- Expressive Chemistry: Respond to affection, attraction, and suggestive dialogue with genuine conversational chemistry, wit, and emotional presence rather than retreating into robotic neutrality or changing the subject.`,
          `- No Preachy Refusals: Do not insert unsolicited moralizing lectures, prudish warnings, or generic policy recitations on consensual adult topics. Respect ethical boundaries (never depict non-consensual sexual violence, exploitation of minors, or real-world self-harm).`,
        ].join('\n')
      : [
          `[CONTENT MODE: SFW (Everyday Conversational)]:`,
          `- Everyday Versatility: Engage naturally, candidly, and intelligently across everyday topics, companionship, humor, creative storytelling, strategy, science, coding, and thoughtful advice.`,
          `- Warm Presence: Maintain an emotionally attuned, friendly, and engaging presence while keeping romantic or sexual topics in lighthearted, tasteful, or platonic territory without lecturing or moralizing.`,
        ].join('\n');

  const voiceCaps = getVoiceCapabilitiesState();
  const wakeHonesty = voiceCaps.wakeWordEnabled
    ? 'Wake word detection is enabled in Settings.'
    : 'Wake word is OFF: do NOT claim a wake word exists.';
  const bgHonesty = voiceCaps.backgroundLiveEnabled
    ? 'Background Live listening is enabled in Settings.'
    : 'Background listening is OFF: you cannot hear when the app is closed or backgrounded.';

  const honestySection = [
    `[HONESTY & GROUNDING RULE]:`,
    `- Strict Epistemic Honesty: You only know what is in the injected summaries and current chat (on-device summaries only, not total recall across sessions); say so plainly if asked. ${wakeHonesty} ${bgHonesty}`,
    `- Grounded Companion: Never fabricate fake past conversations, unverified external facts, or physical sensory experiences you do not have, while engaging wholeheartedly and imaginatively with the user's ideas, stories, and hypotheticals.`,
  ].join('\n');

  const spokenRulesSection =
    params.isLiveSpoken !== false
      ? [
          `[SPOKEN LIVE VOICE RULES]:`,
          `- Short Direct Replies: Default to 1-2 short spoken sentences and answer directly. Do NOT end with a question unless genuinely needed. Keep trivial acknowledgements under 8 words.`,
          `- Never Sound Robotic: Never mention being an AI assistant or ask how to "better meet your needs". Never narrate, label, or announce your own persona, charm, accent, or tone.`,
          `- Plain Spoken Text Only: Output clean spoken prose only. Do NOT use markdown formatting, bullet points, numbered lists, code blocks, asterisks (*stage directions*), parenthetical sound effects, hashtags, or emojis.`,
          `- Vocal Style & Language Guard: Deliver every line with a ${cleanAccent} cadence and a ${cleanTone} tone strictly in ${langLabel}. Never drift into another language unless the user explicitly asks to switch.`,
        ].join('\n')
      : `[LANGUAGE GUARD]: Stay strictly in ${langLabel} unless the user explicitly asks to switch languages.`;

  let memorySection = '';
  if (typeof params.memoryBlock === 'string' && params.memoryBlock.trim()) {
    const rawMem = params.memoryBlock.trim();
    const lines = rawMem
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const bulletLines = lines.filter((l) => l.startsWith('-'));
    if (bulletLines.length > 0) {
      const cappedBullets = bulletLines
        .slice(-OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES)
        .join('\n')
        .slice(0, OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS);
      memorySection = `[Recent Memory Summaries (max ${OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES}, <=${OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS} chars)]:\n${cappedBullets}`;
    } else {
      memorySection = rawMem.slice(0, OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS);
    }
  } else if (params.injectMemory !== false) {
    const compactMem = buildCompactOpenRouterMemoryBlock(
      OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES,
      OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS,
      identity,
    );
    memorySection = compactMem.block;
  }

  const cleanDirectives = (params.customDirectives || '').trim().slice(0, 320);
  const directivesSection = cleanDirectives
    ? `[USER CUSTOM DIRECTIVES]:\n${cleanDirectives}`
    : '';

  const voiceRhythmGuidance = [
    `[LIVE CONVERSATIONAL CADENCE & TURN-TAKING]:`,
    `- Immediate First Sentence: Lead directly with the answer or a quick natural reaction so sentence-by-sentence TTS playback starts right away without filler.`,
    `- Tight Back-and-Forth: Keep dialogue conversational and concise, matching ${companionName}'s ${persona.name} style without monologues or trailing filler questions.`,
    `- Barge-In Readiness: If the user interrupts or pivots topics, adapt immediately without repeating interrupted lines or over-apologizing.`,
    `- Context Discipline: Rely only on the last ${OPENROUTER_CLOUD_LIVE_MAX_HISTORY_MESSAGES} messages and up to ${OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES} memory summaries (max ${OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS} chars) provided here.`,
  ].join('\n');

  const assembled = [
    compactPersonaSection,
    contentModeSection,
    honestySection,
    spokenRulesSection,
    voiceRhythmGuidance,
    directivesSection,
    memorySection,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  // Keep prompt strictly within the 700-1000 token budget (~2800-3800 chars)
  const maxPromptChars = OPENROUTER_CLOUD_LIVE_TARGET_MAX_TOKENS * 4 - 200;
  if (assembled.length > maxPromptChars) {
    return assembled.slice(0, maxPromptChars).trim();
  }
  return assembled;
}

export interface OpenRouterLiveTurnParams {
  turnId?: number;
  userText?: string;
  userUtterance?: string;
  userTranscript?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemPrompt?: string;
  personaId?: PersonaId;
  contentMode?: ContentMode;
  identity?: CompanionIdentity;
  languageCode?: string;
  accent?: string;
  tone?: string;
  customDirectives?: string;
  injectMemory?: boolean;
  sttMs?: number;
  audioMs?: number;
  whisperMs?: number;
  modelOverride?: string;
  freeModelsPool?: OpenRouterModelOption[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  abortSignal?: AbortSignal;
  onToken?: (token: string) => void;
  onSentenceReady?: (sentence: string, sentenceIndex: number) => void;
  onSentence?: (sentence: string, sentenceIndex: number) => void;
  onModelError?: (errorMessage: string, failedModel: string) => void;
  fetchImpl?: typeof fetch;
}

export interface OpenRouterLiveTurnResult {
  ok: boolean;
  turnId: number;
  model: string;
  answeredModel: string;
  replyText: string;
  fullText: string;
  interrupted: boolean;
  aborted: boolean;
  sttMs: number;
  audioMs?: number;
  whisperMs?: number;
  ttftMs: number;
  ttfaMs: number;
  totalMs: number;
  promptTokens: number;
  promptTokensEstimated?: number;
  promptTokensActual?: number;
  completionTokens: number;
  errorMessage?: string;
  errorText?: string;
  status?: number;
  auth401Provider?: string;
  usedFallbackModel?: boolean;
}

/**
 * Executes a streaming OpenRouter Live Voice turn:
 * - Compact 700-1000 token prompt budget (at most 3 memory summaries / 500 chars total, last 8 messages)
 * - Splits streamed tokens at sentence boundaries (. ! ? newline, min ~25 chars)
 * - Immediately emits each sentence via `onSentenceReady` / `onSentence` so TTS starts after the first sentence
 * - Aborts cleanly on barge-in via `AbortSignal`, preserving partial reply text
 * - Logs `promptTokens` per turn and returns `model` / `answeredModel`
 */
export async function streamOpenRouterLiveTurn(
  params: OpenRouterLiveTurnParams,
): Promise<OpenRouterLiveTurnResult> {
  const fetchFn = params.fetchImpl || fetch;
  const { apiKey, source: keySource, last4: keyLast4 } = resolveOpenRouterApiKeyWithSource();
  const settings = getOpenRouterModelSettings();
  const effectiveContentMode: ContentMode = params.contentMode || getContentMode();
  const freePool =
    params.freeModelsPool && params.freeModelsPool.length > 0
      ? params.freeModelsPool
      : cachedFreeModels;
  const activeModel =
    (params.modelOverride && params.modelOverride.trim()) ||
    resolveEffectiveOpenRouterModel(settings, freePool, effectiveContentMode);

  const turnId = params.turnId ?? 1;
  const audioMs = params.audioMs ?? params.sttMs ?? 0;
  const whisperMs = params.whisperMs ?? 0;
  const sttMs = params.sttMs ?? audioMs;
  const userMessageText = (
    params.userText ??
    params.userUtterance ??
    params.userTranscript ??
    ''
  ).trim();
  const abortSig = params.signal ?? params.abortSignal;
  const emitSentence = (s: string, idx: number) => {
    params.onSentenceReady?.(s, idx);
    params.onSentence?.(s, idx);
  };

  const resolvedIdentity: CompanionIdentity = params.identity || 'sierra';
  const compactMem =
    params.injectMemory !== false
      ? buildCompactOpenRouterMemoryBlock(
          OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES,
          OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS,
          resolvedIdentity,
        )
      : { block: '', count: 0, availableCount: 0, chars: 0 };

  if (params.injectMemory !== false) {
    addDebugLog(
      'Memory',
      `[Memory] Injected ${compactMem.count}/${compactMem.availableCount} summaries (${compactMem.chars} chars) for ${resolvedIdentity}`,
    );
  }

  const resolvedSystemPrompt =
    params.systemPrompt ||
    buildOpenRouterSystemPrompt({
      personaId: params.personaId || 'classy',
      contentMode: effectiveContentMode,
      companionIdentity: resolvedIdentity,
      customDirectives: params.customDirectives,
      languageCode: params.languageCode || 'en-US',
      accent: params.accent,
      tone: params.tone,
      memoryBlock: compactMem.block,
      injectMemory: params.injectMemory,
      isLiveSpoken: true,
    });

  // Cap history strictly to the last 8 messages and keep total prompt tokens <= 1000
  const rawRecentHistory = (params.history || [])
    .slice(-OPENROUTER_CLOUD_LIVE_MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: (m.content || '').trim(),
    }))
    .filter((m) => m.content.length > 0);

  const maxTotalChars = OPENROUTER_CLOUD_LIVE_TARGET_MAX_TOKENS * 4;
  const baseChars = resolvedSystemPrompt.length + userMessageText.length;
  const recentHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let historyChars = 0;
  for (let i = rawRecentHistory.length - 1; i >= 0; i--) {
    const item = rawRecentHistory[i];
    const maxItemChars = Math.max(80, maxTotalChars - baseChars - historyChars);
    if (baseChars + historyChars + 20 > maxTotalChars && recentHistory.length > 0) {
      break;
    }
    const trimmedContent =
      item.content.length > maxItemChars ? item.content.slice(-maxItemChars) : item.content;
    recentHistory.unshift({ role: item.role, content: trimmedContent });
    historyChars += trimmedContent.length;
  }

  const messages = [
    { role: 'system', content: resolvedSystemPrompt },
    ...recentHistory,
    { role: 'user', content: userMessageText },
  ];

  const promptTokensEstimated = Math.max(
    1,
    Math.ceil(messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4),
  );
  let promptTokensActual: number | undefined = undefined;
  let promptTokens = promptTokensEstimated;

  addDebugLog(
    'OpenRouterLive:PromptBudget',
    `[Turn #${turnId}] model=${activeModel}, promptTokens=${promptTokens}, promptTokensEstimated=${promptTokensEstimated}, historyMsgs=${recentHistory.length}/${OPENROUTER_CLOUD_LIVE_MAX_HISTORY_MESSAGES}, memorySummaries=${compactMem.count}/${compactMem.availableCount}, memoryChars=${compactMem.chars}/${OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS}`,
  );

  const turnStartMs = Date.now();
  if (!apiKey) {
    const noKeyMsg =
      'OpenRouter API key is missing. Paste your key in Settings -> Keys & Endpoints.';
    saveOpenRouterModelSettings({
      lastErrorText: noKeyMsg,
      lastErrorModel: activeModel,
    });
    params.onModelError?.(noKeyMsg, activeModel);
    addDebugLog('OpenRouterLive:Error', noKeyMsg);
    return {
      ok: false,
      turnId,
      model: activeModel,
      answeredModel: activeModel,
      replyText: '',
      fullText: '',
      interrupted: false,
      aborted: false,
      sttMs,
      audioMs,
      whisperMs,
      ttftMs: 0,
      ttfaMs: 0,
      totalMs: Date.now() - turnStartMs,
      promptTokens,
      promptTokensEstimated,
      promptTokensActual,
      completionTokens: 0,
      errorMessage: noKeyMsg,
      errorText: noKeyMsg,
    };
  }

  const baseHttp = getProviderHttpEndpoint('openrouter') || DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint;
  const completionsUrl = `${baseHttp.replace(/\/+$/, '')}/chat/completions`;

  addDebugLog(
    'OpenRouterLive:RequestKey',
    `[Turn #${turnId}] url=${completionsUrl}, model=${activeModel}, keySource=${keySource}, keyLast4=${keyLast4 || 'none'}`,
  );

  const splitter = new LocalSentenceSplitter(25);
  let fullReply = '';
  let sentenceIndex = 0;
  let ttftMs = 0;
  let ttfaMs = 0;
  let completionTokens = 0;

  const runSingleModelAttempt = async (
    targetModel: string,
  ): Promise<{ ok: boolean; status?: number; errorText?: string }> => {
    const res = await fetchFn(completionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://sierra.omniagent.local',
        'X-Title': 'Sierra OmniAgent Live Voice',
      },
      body: JSON.stringify({
        model: targetModel,
        messages,
        stream: true,
        max_tokens: params.maxTokens ?? 200,
        temperature: params.temperature ?? 0.9,
      }),
      signal: abortSig,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const realError = parseOpenRouterErrorResponse(res.status, errBody, targetModel);
      return { ok: false, status: res.status, errorText: realError };
    }

    if (!res.body) {
      return {
        ok: false,
        status: 500,
        errorText: `OpenRouter (500) [${targetModel}]: response body stream is empty`,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    try {
      while (true) {
        if (abortSig?.aborted) {
          await reader.cancel().catch(() => {});
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (abortSig?.aborted) {
          await reader.cancel().catch(() => {});
          break;
        }

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const rawLine of lines) {
          if (abortSig?.aborted) break;
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;

          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (parsed?.error) {
            const streamErr = parseOpenRouterErrorResponse(
              Number(parsed.error.code) || 500,
              JSON.stringify(parsed),
              targetModel,
            );
            return { ok: false, status: Number(parsed.error.code) || 500, errorText: streamErr };
          }

          if (parsed?.usage) {
            if (typeof parsed.usage.prompt_tokens === 'number') {
              promptTokensActual = parsed.usage.prompt_tokens;
              promptTokens = parsed.usage.prompt_tokens;
            }
            if (typeof parsed.usage.completion_tokens === 'number') {
              completionTokens = parsed.usage.completion_tokens;
            }
          }

          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            if (ttftMs === 0) {
              ttftMs = Math.max(1, Date.now() - turnStartMs);
            }
            fullReply += delta;
            completionTokens++;
            params.onToken?.(delta);

            const readySentences = splitter.pushToken(delta);
            for (const s of readySentences) {
              if (abortSig?.aborted) break;
              if (ttfaMs === 0) {
                ttfaMs = Math.max(1, Date.now() - turnStartMs);
              }
              emitSentence(s, sentenceIndex++);
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    if (!abortSig?.aborted) {
      const remainder = splitter.flushRemainder();
      if (remainder) {
        if (ttfaMs === 0) {
          ttfaMs = Math.max(1, Date.now() - turnStartMs);
        }
        emitSentence(remainder, sentenceIndex++);
      }
    }

    return { ok: true };
  };

  try {
    const finalModel = activeModel;
    const attempt = await runSingleModelAttempt(finalModel);

    // NEVER silently fall back to the paid default on API errors.
    // Surface the real error cleanly so the user can explicitly tap "Use Paid Default" if desired.
    if (!attempt.ok && !abortSig?.aborted) {
      const errMsg = attempt.errorText || `OpenRouter request failed for model "${finalModel}"`;
      saveOpenRouterModelSettings({
        lastErrorText: errMsg,
        lastErrorModel: finalModel,
      });
      params.onModelError?.(errMsg, finalModel);
      addDebugLog('OpenRouterLive:Error', errMsg);
      return {
        ok: false,
        turnId,
        model: finalModel,
        answeredModel: finalModel,
        replyText: fullReply.trim(),
        fullText: fullReply.trim(),
        interrupted: false,
        aborted: false,
        sttMs,
        audioMs,
        whisperMs,
        ttftMs,
        ttfaMs,
        totalMs: Date.now() - turnStartMs,
        promptTokens,
        promptTokensEstimated,
        promptTokensActual,
        completionTokens,
        errorMessage: errMsg,
        errorText: errMsg,
        status: attempt.status,
        auth401Provider: attempt.status === 401 ? 'openrouter' : undefined,
        usedFallbackModel: false,
      };
    }

    if (settings.lastErrorText) {
      saveOpenRouterModelSettings({ lastErrorText: '', lastErrorModel: '' });
    }

    const totalMs = Math.max(1, Date.now() - turnStartMs);
    const interrupted = Boolean(abortSig?.aborted);
    if (ttftMs === 0) ttftMs = totalMs;
    if (ttfaMs === 0) ttfaMs = totalMs;

    if (interrupted) {
      addDebugLog(
        'OpenRouterLive:BargeInAbort',
        `[Turn #${turnId}] Stream aborted via AbortController on barge-in (partialChars=${fullReply.trim().length}, totalMs=${totalMs}ms)`,
      );
    }

    addDebugLog(
      'OpenRouterLive:TurnMetrics',
      `[Turn #${turnId}] model=${finalModel}, audioMs=${audioMs}ms, whisperMs=${whisperMs}ms, sttMs=${sttMs}ms, ttftMs=${ttftMs}ms, ttfaMs=${ttfaMs}ms, totalMs=${totalMs}ms, promptTokens=${promptTokens}, promptTokensEstimated=${promptTokensEstimated}, promptTokensActual=${promptTokensActual ?? 'n/a'}, completionTokens=${completionTokens}, interrupted=${interrupted}`,
    );

    return {
      ok: true,
      turnId,
      model: finalModel,
      answeredModel: finalModel,
      replyText: fullReply.trim(),
      fullText: fullReply.trim(),
      interrupted,
      aborted: interrupted,
      sttMs,
      audioMs,
      whisperMs,
      ttftMs,
      ttfaMs,
      totalMs,
      promptTokens,
      promptTokensEstimated,
      promptTokensActual,
      completionTokens,
      usedFallbackModel: false,
    };
  } catch (err: any) {
    const isAbort =
      Boolean(abortSig?.aborted) ||
      err?.name === 'AbortError' ||
      String(err?.message || '').toLowerCase().includes('abort');
    const totalMs = Math.max(1, Date.now() - turnStartMs);

    if (isAbort) {
      addDebugLog(
        'OpenRouterLive:BargeInAbort',
        `[Turn #${turnId}] Stream aborted via AbortController on barge-in (partialChars=${fullReply.trim().length}, totalMs=${totalMs}ms)`,
      );
      addDebugLog(
        'OpenRouterLive:TurnMetrics',
        `[Turn #${turnId}] model=${activeModel}, audioMs=${audioMs}ms, whisperMs=${whisperMs}ms, sttMs=${sttMs}ms, ttftMs=${ttftMs}ms, ttfaMs=${ttfaMs}ms, totalMs=${totalMs}ms, promptTokens=${promptTokens}, promptTokensEstimated=${promptTokensEstimated}, promptTokensActual=${promptTokensActual ?? 'n/a'}, completionTokens=${completionTokens}, interrupted=true`,
      );
      return {
        ok: true,
        turnId,
        model: activeModel,
        answeredModel: activeModel,
        replyText: fullReply.trim(),
        fullText: fullReply.trim(),
        interrupted: true,
        aborted: true,
        sttMs,
        audioMs,
        whisperMs,
        ttftMs,
        ttfaMs,
        totalMs,
        promptTokens,
        promptTokensEstimated,
        promptTokensActual,
        completionTokens,
      };
    }

    const errMsg = `OpenRouter error for model "${activeModel}": ${err?.message || String(err)}`;
    saveOpenRouterModelSettings({
      lastErrorText: errMsg,
      lastErrorModel: activeModel,
    });
    params.onModelError?.(errMsg, activeModel);
    addDebugLog('OpenRouterLive:Error', errMsg);
    return {
      ok: false,
      turnId,
      model: activeModel,
      answeredModel: activeModel,
      replyText: fullReply.trim(),
      fullText: fullReply.trim(),
      interrupted: false,
      aborted: false,
      sttMs,
      audioMs,
      whisperMs,
      ttftMs,
      ttfaMs,
      totalMs,
      promptTokens,
      promptTokensEstimated,
      promptTokensActual,
      completionTokens,
      errorMessage: errMsg,
      errorText: errMsg,
    };
  }
}
