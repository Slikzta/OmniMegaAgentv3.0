import {
  CompanionIdentity,
  IDENTITIES,
  UNIFIED_PERSONAS,
  GEMINI_LIVE_VOICES,
  SUPPORTED_LIVE_VOICES,
  LiveVoiceName,
  VOICE_ACCENT_OPTIONS,
  VOICE_TONE_OPTIONS,
  getActiveIdentity,
  setActiveIdentity,
  getActivePersonaId,
  setActivePersonaId,
  getLiveVoiceConfig,
  setLiveVoiceConfig,
  getChatVoiceConfig,
  setChatVoiceConfig,
  getCombinedVoicePool,
  deriveLanguageCodeFromAccent,
} from './persona';
import { addDebugLog } from './debugLogStore';

export interface VoiceToolAllowedOptions {
  identities: { id: CompanionIdentity; name: string }[];
  personas: { id: string; name: string; defaultIdentity?: CompanionIdentity }[];
  liveVoices: { id: LiveVoiceName; name: string; gender: 'female' | 'male'; tone: string }[];
  chatVoices: { id: string; name: string; gender: 'female' | 'male'; lang: string; engine?: string }[];
  accents: string[];
  stylesAndTones: string[];
  tones: string[];
}

export function getAllowedVoiceToolOptions(): VoiceToolAllowedOptions {
  const chatPool = getCombinedVoicePool();
  const stylesAndTones = VOICE_TONE_OPTIONS.map(String).filter((t) => t.length > 0);

  return {
    identities: Object.values(IDENTITIES).map((ident) => ({
      id: ident.id,
      name: ident.name,
    })),
    personas: Object.values(UNIFIED_PERSONAS).map((p: any) => ({
      id: p.id,
      name: p.name,
      defaultIdentity: p.defaultIdentity || 'sierra',
    })),
    liveVoices: GEMINI_LIVE_VOICES.map((v) => ({
      id: v.id as LiveVoiceName,
      name: v.name,
      gender: v.gender,
      tone: v.tone,
    })),
    chatVoices: chatPool.map((v: any) => ({
      id: v.id,
      name: v.name,
      gender: v.gender,
      lang: v.lang,
      engine: v.engine || v.provider || 'native',
    })),
    accents: VOICE_ACCENT_OPTIONS.map(String).filter((a) => a.length > 0),
    stylesAndTones,
    tones: stylesAndTones,
  };
}

export const buildAllowedVoiceOptionsCatalog = getAllowedVoiceToolOptions;

/**
 * Simple similarity score for finding closest real options when a user requests an unknown voice/accent/tone/persona.
 */
function similarityScore(query: string, candidate: string): number {
  const q = query.trim().toLowerCase();
  const c = candidate.trim().toLowerCase();
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q) || q.startsWith(c)) return 85;
  if (c.includes(q) || q.includes(c)) return 70;

  // Token overlap
  const qWords = q.split(/[\s\-_()]+/).filter(Boolean);
  const cWords = c.split(/[\s\-_()]+/).filter(Boolean);
  let overlap = 0;
  for (const qw of qWords) {
    if (cWords.some((cw) => cw === qw || cw.startsWith(qw) || qw.startsWith(cw))) {
      overlap += 1;
    }
  }
  if (overlap > 0) {
    return 45 + overlap * 15;
  }

  // Character bigram Dice coefficient
  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) {
      out.push(s.slice(i, i + 2));
    }
    return out;
  };
  const qb = bigrams(q);
  const cb = bigrams(c);
  if (qb.length === 0 || cb.length === 0) return 0;
  let matches = 0;
  const used = new Array(cb.length).fill(false);
  for (const b of qb) {
    const idx = cb.findIndex((x, i) => !used[i] && x === b);
    if (idx !== -1) {
      used[idx] = true;
      matches++;
    }
  }
  return Math.round((2 * matches * 40) / (qb.length + cb.length));
}

export function findClosestMatches(query: string, candidates: string[], maxResults = 3): string[] {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: similarityScore(query, candidate),
    }))
    .sort((a, b) => b.score - a.score);

  const positive = scored.filter((s) => s.score > 0).slice(0, maxResults).map((s) => s.candidate);
  if (positive.length > 0) return positive;
  return candidates.slice(0, maxResults);
}

const ACCENT_SYNONYMS: Record<string, string> = {
  us: 'American',
  usa: 'American',
  american: 'American',
  states: 'American',
  uk: 'British',
  british: 'British',
  english: 'British',
  rp: 'British',
  london: 'British',
  aussie: 'Australian',
  australian: 'Australian',
  australia: 'Australian',
  canadian: 'Canadian',
  canada: 'Canadian',
  irish: 'Irish',
  ireland: 'Irish',
  scottish: 'Scottish',
  scotland: 'Scottish',
  southern: 'Southern US',
  texas: 'Southern US',
  country: 'Southern US',
  indian: 'Indian',
  india: 'Indian',
  nz: 'New Zealand',
  kiwi: 'New Zealand',
  'new zealand': 'New Zealand',
  default: 'Default',
  none: 'Default',
  normal: 'Default',
  natural: 'Default',
};

const TONE_SYNONYMS: Record<string, string> = {
  warm: 'Warm',
  friendly: 'Warm',
  calm: 'Calm',
  soothing: 'Calm',
  relaxed: 'Calm',
  upbeat: 'Upbeat',
  energetic: 'Upbeat',
  cheerful: 'Upbeat',
  happy: 'Upbeat',
  breezy: 'Breezy',
  casual: 'Breezy',
  firm: 'Firm',
  confident: 'Firm',
  assertive: 'Firm',
  playful: 'Playful',
  teasing: 'Playful',
  witty: 'Playful',
  sultry: 'Sultry',
  flirty: 'Sultry',
  intimate: 'Sultry',
  informative: 'Informative',
  clear: 'Informative',
  excitable: 'Excitable',
  excited: 'Excitable',
  enthusiastic: 'Excitable',
  default: 'Default',
  none: 'Default',
  normal: 'Default',
  natural: 'Default',
};

export function resolveAccentOption(input?: string): { matched: boolean; value: string; suggestions: string[] } {
  if (input === undefined || input === null) {
    return { matched: true, value: '', suggestions: [] };
  }
  const trimmed = input.trim();
  if (!trimmed) return { matched: true, value: '', suggestions: [] };

  const lower = trimmed.toLowerCase().replace(/\s+accent$/i, '').trim();
  if (lower in ACCENT_SYNONYMS) {
    return { matched: true, value: ACCENT_SYNONYMS[lower], suggestions: [] };
  }

  const allowedAccents = VOICE_ACCENT_OPTIONS.map(String).filter((a) => a.length > 0);
  const exact = allowedAccents.find((a) => a.toLowerCase() === lower || a.toLowerCase() === trimmed.toLowerCase());
  if (exact) {
    return { matched: true, value: exact, suggestions: [] };
  }

  return {
    matched: false,
    value: trimmed,
    suggestions: findClosestMatches(trimmed, allowedAccents, 4),
  };
}

export function resolveToneOption(input?: string): { matched: boolean; value: string; suggestions: string[] } {
  if (input === undefined || input === null) {
    return { matched: true, value: '', suggestions: [] };
  }
  const trimmed = input.trim();
  if (!trimmed) return { matched: true, value: '', suggestions: [] };

  const lower = trimmed.toLowerCase().replace(/\s+(tone|style|voice)$/i, '').trim();
  if (lower in TONE_SYNONYMS) {
    return { matched: true, value: TONE_SYNONYMS[lower], suggestions: [] };
  }

  const allowedTones = VOICE_TONE_OPTIONS.map(String).filter((t) => t.length > 0);
  const exact = allowedTones.find((t) => t.toLowerCase() === lower || t.toLowerCase() === trimmed.toLowerCase());
  if (exact) {
    return { matched: true, value: exact, suggestions: [] };
  }

  return {
    matched: false,
    value: trimmed,
    suggestions: findClosestMatches(trimmed, allowedTones, 4),
  };
}

export function resolveIdentityOption(input?: string): { matched: boolean; value: CompanionIdentity; suggestions: string[] } {
  const current = getActiveIdentity();
  if (!input || !input.trim()) {
    return { matched: true, value: current, suggestions: [] };
  }
  const lower = input.trim().toLowerCase();
  if (lower === 'sierra') return { matched: true, value: 'sierra', suggestions: [] };
  if (lower === 'tyler') return { matched: true, value: 'tyler', suggestions: [] };

  return {
    matched: false,
    value: current,
    suggestions: ['Sierra', 'Tyler'],
  };
}

export function resolvePersonaOption(input?: string): { matched: boolean; value: string; suggestions: string[] } {
  const current = getActivePersonaId();
  if (!input || !input.trim()) {
    return { matched: true, value: current, suggestions: [] };
  }
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  for (const p of Object.values(UNIFIED_PERSONAS)) {
    const cleanName = p.name.toLowerCase();
    const shortName = cleanName.replace(/^(sierra|tyler)\s*-\s*/i, '').trim();
    if (
      p.id.toLowerCase() === lower ||
      cleanName === lower ||
      shortName === lower ||
      p.id.toLowerCase() === `sierra-${lower}`
    ) {
      return { matched: true, value: p.id, suggestions: [] };
    }
  }

  const allCandidates = Object.values(UNIFIED_PERSONAS).map((p) => `${p.id} (${p.name})`);
  return {
    matched: false,
    value: current,
    suggestions: findClosestMatches(trimmed, allCandidates, 4),
  };
}

export function resolveVoiceNameOption(
  input?: string,
  targetIdentity?: CompanionIdentity,
): {
  matched: boolean;
  liveVoiceId?: LiveVoiceName;
  chatVoiceId?: string;
  suggestions: string[];
} {
  if (!input || !input.trim()) {
    return { matched: true, suggestions: [] };
  }
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // 1. Check Gemini Live prebuilt voices
  const liveMatch = GEMINI_LIVE_VOICES.find(
    (v) =>
      v.id.toLowerCase() === lower ||
      v.name.toLowerCase() === lower ||
      v.name.toLowerCase().startsWith(`${lower} (`),
  );

  // 2. Check combined Chat TTS voices
  const chatPool = getCombinedVoicePool();
  const chatMatch = chatPool.find(
    (v) =>
      v.id.toLowerCase() === lower ||
      v.name.toLowerCase() === lower ||
      v.id.toLowerCase() === `gemini-tts-${lower}` ||
      v.name.toLowerCase().startsWith(`${lower} (`),
  );

  if (liveMatch || chatMatch) {
    return {
      matched: true,
      liveVoiceId: liveMatch ? (liveMatch.id as LiveVoiceName) : undefined,
      chatVoiceId: chatMatch?.id || (liveMatch ? `gemini-tts-${liveMatch.id}` : undefined),
      suggestions: [],
    };
  }

  const candidateNames = [
    ...GEMINI_LIVE_VOICES.map((v) => `${v.id} (${v.gender}, ${v.tone})`),
    ...chatPool
      .filter((v) => !v.id.startsWith('gemini-tts-'))
      .map((v) => `${v.name} [${v.id}]`),
  ];

  const filteredCandidates = targetIdentity
    ? GEMINI_LIVE_VOICES.filter((v) =>
        targetIdentity === 'tyler' ? v.gender === 'male' : v.gender === 'female',
      ).map((v) => `${v.id} (${v.tone})`)
    : candidateNames;

  return {
    matched: false,
    suggestions: findClosestMatches(
      trimmed,
      filteredCandidates.length > 0 ? filteredCandidates : candidateNames,
      4,
    ),
  };
}

export interface ChangeVoiceToolArgs {
  voice?: string;
  accent?: string;
  style?: string;
  tone?: string;
  persona?: string;
  identity?: string;
}

export interface VoiceToolExecutionResult {
  ok: boolean;
  success: boolean;
  toolName: 'change_voice' | 'list_voice_options';
  message: string;
  reason?: string;
  data?: Record<string, any>;
  applied?: {
    identity: CompanionIdentity;
    identityName: string;
    personaId: string;
    personaName: string;
    liveVoiceId: LiveVoiceName;
    chatVoiceId: string;
    accent: string;
    tone: string;
    languageCode: string;
  };
  requiresLiveReconnect?: boolean;
  error?: string;
  errors?: string[];
  closestMatches?: Record<string, string[]>;
  availableOptions?: VoiceToolAllowedOptions;
  liveVoices?: VoiceToolAllowedOptions['liveVoices'];
  accents?: string[];
  tones?: string[];
}

export function getVoiceToolsDeclarations(): any[] {
  const opts = getAllowedVoiceToolOptions();
  const liveVoiceList = opts.liveVoices.map((v) => v.id).join(', ');
  const accentList = opts.accents.join(', ');
  const toneList = opts.stylesAndTones.join(', ');
  const personaList = opts.personas.map((p) => `${p.id} (${p.name})`).join(', ');

  return [
    {
      name: 'change_voice',
      description:
        'Change Sierra or Tyler voice, accent, speaking style/tone, persona, or active companion identity when the user asks out loud or in chat (e.g., "switch to an Australian accent, upbeat", "change your voice to Fenrir", "switch to Tyler"). Always pick from the real allowed options.',
      parameters: {
        type: 'OBJECT',
        properties: {
          voice: {
            type: 'STRING',
            description: `Optional voice name or ID. Allowed Live/Gemini voices: ${liveVoiceList}. Also supports system TTS voice names/IDs.`,
          },
          accent: {
            type: 'STRING',
            description: `Optional regional accent. Allowed accents: ${accentList}, or "default" to clear.`,
          },
          style: {
            type: 'STRING',
            description: `Optional speaking style or tone. Allowed styles/tones: ${toneList}, or "default" to clear.`,
          },
          tone: {
            type: 'STRING',
            description: `Optional alias for style/tone. Allowed styles/tones: ${toneList}, or "default" to clear.`,
          },
          persona: {
            type: 'STRING',
            description: `Optional persona ID or name. Allowed personas: ${personaList}.`,
          },
          identity: {
            type: 'STRING',
            description: 'Optional companion identity: "Sierra" or "Tyler". Defaults to the currently active identity.',
          },
        },
      },
    },
    {
      name: 'list_voice_options',
      description:
        'List all real voice names, accents, speaking styles/tones, personas, and identities supported by the app so you can accurately answer "what voices do you have?" or "what accents can you do?".',
      parameters: {
        type: 'OBJECT',
        properties: {},
      },
    },
  ];
}

export function buildVoiceToolsSystemPromptSection(): string {
  const opts = getAllowedVoiceToolOptions();
  const femaleVoices = opts.liveVoices.filter((v) => v.gender === 'female').map((v) => `${v.id} (${v.tone})`).join(', ');
  const maleVoices = opts.liveVoices.filter((v) => v.gender === 'male').map((v) => `${v.id} (${v.tone})`).join(', ');
  const accents = opts.accents.join(', ');
  const tones = opts.stylesAndTones.join(', ');
  const personas = opts.personas.map((p) => `${p.id} ("${p.name}")`).join(', ');

  return `VOICE & PERSONA SELF-CONTROL TOOLS (change_voice, list_voice_options):
- You can change your own voice, accent, speaking style/tone, persona, or companion identity (Sierra / Tyler) whenever the user asks in Live voice or text chat by calling \`change_voice\`.
- Allowed Identities: Sierra, Tyler.
- Allowed Female Voices (Sierra): ${femaleVoices}.
- Allowed Male Voices (Tyler): ${maleVoices}.
- Allowed Accents: ${accents} (or "default" / "none").
- Allowed Styles / Tones: ${tones} (or "default" / "none").
- Allowed Personas: ${personas}.
- If the user asks "what voices do you have?" or asks what accents/styles/personas are available, call \`list_voice_options\` and read back the real options.
- If the user asks for a voice, accent, style, or persona that does NOT exist, \`change_voice\` will return an error with the closest real options. Tell the user honestly what is available and offer the nearest match—never pretend an unsupported option was applied.`;
}

export function executeVoiceToolCall(
  toolName: string,
  rawArgs: Record<string, any> = {},
): VoiceToolExecutionResult {
  const args = rawArgs || {};
  addDebugLog('Tool:Voice:Call', `Invoked ${toolName} with args: ${JSON.stringify(args)}`);

  if (toolName === 'list_voice_options') {
    const availableOptions = getAllowedVoiceToolOptions();
    const summary = `Available identities: Sierra, Tyler. Female voices: ${availableOptions.liveVoices
      .filter((v) => v.gender === 'female')
      .map((v) => `${v.id} (${v.tone})`)
      .join(', ')}. Male voices: ${availableOptions.liveVoices
      .filter((v) => v.gender === 'male')
      .map((v) => `${v.id} (${v.tone})`)
      .join(', ')}. Accents: ${availableOptions.accents.join(', ')}. Styles/Tones: ${availableOptions.stylesAndTones.join(
      ', ',
    )}. Personas: ${availableOptions.personas.map((p) => p.name).join(', ')}.`;

    const result: VoiceToolExecutionResult = {
      ok: true,
      success: true,
      toolName: 'list_voice_options',
      message: summary,
      data: { availableOptions },
      availableOptions,
      liveVoices: availableOptions.liveVoices,
      accents: availableOptions.accents,
      tones: availableOptions.stylesAndTones,
    };
    addDebugLog('Tool:list_voice_options:Call', `Invoked list_voice_options`);
    addDebugLog('Tool:Voice:Result', `list_voice_options succeeded (${availableOptions.liveVoices.length} live voices, ${availableOptions.accents.length} accents, ${availableOptions.stylesAndTones.length} styles)`);
    return result;
  }

  addDebugLog('Tool:change_voice:Call', `Invoked change_voice with args: ${JSON.stringify(args)}`);

  // Handle change_voice
  const cArgs: ChangeVoiceToolArgs = {
    voice: typeof args.voice === 'string' ? args.voice : undefined,
    accent: typeof args.accent === 'string' ? args.accent : undefined,
    style: typeof args.style === 'string' ? args.style : undefined,
    tone: typeof args.tone === 'string' ? args.tone : undefined,
    persona: typeof args.persona === 'string' ? args.persona : undefined,
    identity: typeof args.identity === 'string' ? args.identity : undefined,
  };

  const requestedStyleOrTone = cArgs.style !== undefined ? cArgs.style : cArgs.tone;

  const hasAnyParam =
    Boolean(cArgs.voice?.trim()) ||
    cArgs.accent !== undefined ||
    requestedStyleOrTone !== undefined ||
    Boolean(cArgs.persona?.trim()) ||
    Boolean(cArgs.identity?.trim());

  if (!hasAnyParam) {
    const availableOptions = getAllowedVoiceToolOptions();
    const errMsg =
      'No voice, accent, style/tone, persona, or identity parameter was provided to change_voice.';
    addDebugLog('Tool:Voice:Error', errMsg);
    return {
      ok: false,
      success: false,
      toolName: 'change_voice',
      message: errMsg,
      reason: errMsg,
      error: errMsg,
      availableOptions,
    };
  }

  const errors: string[] = [];
  const closestMatches: Record<string, string[]> = {};

  // 1. Validate identity
  const identityResolution = resolveIdentityOption(cArgs.identity);
  if (!identityResolution.matched) {
    errors.push(`Identity "${cArgs.identity}" is not supported.`);
    closestMatches.identity = identityResolution.suggestions;
  }

  // 2. Validate persona
  const personaResolution = resolvePersonaOption(cArgs.persona);
  if (!personaResolution.matched) {
    errors.push(`Persona "${cArgs.persona}" is not supported.`);
    closestMatches.persona = personaResolution.suggestions;
  }

  // Determine target identity & persona before checking voice
  let targetIdentity: CompanionIdentity = identityResolution.value;
  const targetPersonaId: string = personaResolution.value;

  // If persona was explicitly changed and identity wasn't explicitly specified, adopt the persona's defaultIdentity if appropriate
  if (cArgs.persona?.trim() && !cArgs.identity?.trim() && personaResolution.matched) {
    const personaDef = (UNIFIED_PERSONAS as Record<string, any>)[targetPersonaId];
    if (personaDef?.defaultIdentity) {
      targetIdentity = personaDef.defaultIdentity;
    }
  }

  // 3. Validate voice
  const voiceResolution = resolveVoiceNameOption(cArgs.voice, targetIdentity);
  if (!voiceResolution.matched) {
    errors.push(`Voice "${cArgs.voice}" does not exist in supported voices.`);
    closestMatches.voice = voiceResolution.suggestions;
  }

  // 4. Validate accent
  const accentResolution = resolveAccentOption(cArgs.accent);
  if (!accentResolution.matched) {
    errors.push(`Accent "${cArgs.accent}" is not in the supported accent list.`);
    closestMatches.accent = accentResolution.suggestions;
  }

  // 5. Validate style / tone
  const toneResolution = resolveToneOption(requestedStyleOrTone);
  if (!toneResolution.matched) {
    errors.push(`Style/tone "${requestedStyleOrTone}" is not in the supported style/tone list.`);
    closestMatches.style = toneResolution.suggestions;
  }

  if (errors.length > 0) {
    const availableOptions = getAllowedVoiceToolOptions();
    const suggestionSummary = Object.entries(closestMatches)
      .map(([field, list]) => `Closest ${field} options: ${list.join(', ')}`)
      .join('. ');
    const fullError = `${errors.join(' ')} ${suggestionSummary}`.trim();
    addDebugLog('Tool:Voice:InvalidOption', fullError);
    addDebugLog('Tool:change_voice:InvalidOption', fullError);
    return {
      ok: false,
      success: false,
      toolName: 'change_voice',
      message: fullError,
      reason: fullError,
      error: fullError,
      errors,
      closestMatches,
      availableOptions,
    };
  }

  // Apply through the exact same persistence functions used by PersonaVoiceModal
  const prevIdentity = getActiveIdentity();
  const prevPersonaId = getActivePersonaId();
  const prevLiveCfg = getLiveVoiceConfig(prevPersonaId as any, prevIdentity);

  if (targetIdentity !== prevIdentity || cArgs.identity?.trim()) {
    setActiveIdentity(targetIdentity);
  }
  if (targetPersonaId !== prevPersonaId || cArgs.persona?.trim()) {
    setActivePersonaId(targetPersonaId as any);
  }

  const currentLiveCfg = getLiveVoiceConfig(targetPersonaId as any, targetIdentity);
  const currentChatCfg = getChatVoiceConfig(targetPersonaId as any, targetIdentity);

  const defaultVoiceForIdentity: LiveVoiceName =
    (IDENTITIES[targetIdentity]?.defaultVoice as LiveVoiceName) ||
    (targetIdentity === 'tyler' ? 'Charon' : 'Aoede');

  const nextLiveVoiceId: LiveVoiceName =
    voiceResolution.liveVoiceId ||
    (SUPPORTED_LIVE_VOICES.includes(currentLiveCfg.voiceId as LiveVoiceName)
      ? (currentLiveCfg.voiceId as LiveVoiceName)
      : defaultVoiceForIdentity);

  const nextChatVoiceId: string =
    voiceResolution.chatVoiceId ||
    currentChatCfg.voiceId ||
    defaultVoiceForIdentity;

  const nextAccent =
    cArgs.accent !== undefined ? accentResolution.value : currentLiveCfg.accent;
  const nextTone =
    requestedStyleOrTone !== undefined ? toneResolution.value : currentLiveCfg.tone;

  setLiveVoiceConfig(
    {
      voiceId: nextLiveVoiceId,
      accent: nextAccent,
      tone: nextTone,
    },
    targetPersonaId as any,
    targetIdentity,
  );

  setChatVoiceConfig(
    {
      voiceId: nextChatVoiceId,
      accent: nextAccent,
      tone: nextTone,
    },
    targetPersonaId as any,
    targetIdentity,
  );

  const currentLang =
    (typeof localStorage !== 'undefined' && localStorage.getItem('sierra_live_language')) || 'en-US';
  const nextLanguageCode = deriveLanguageCodeFromAccent(nextAccent, currentLang);

  const requiresLiveReconnect =
    prevIdentity !== targetIdentity ||
    prevPersonaId !== targetPersonaId ||
    prevLiveCfg.voiceId !== nextLiveVoiceId ||
    prevLiveCfg.accent !== nextAccent ||
    prevLiveCfg.tone !== nextTone;

  const applied = {
    identity: targetIdentity,
    identityName: IDENTITIES[targetIdentity]?.name || 'Sierra',
    personaId: targetPersonaId,
    personaName: (UNIFIED_PERSONAS as Record<string, any>)[targetPersonaId]?.name || targetPersonaId,
    liveVoiceId: nextLiveVoiceId,
    chatVoiceId: nextChatVoiceId,
    accent: nextAccent,
    tone: nextTone,
    languageCode: nextLanguageCode,
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sierra-voice-config-changed', {
        detail: {
          ...applied,
          requiresLiveReconnect,
        },
      }),
    );
  }

  const msg = `Voice configuration updated: identity=${applied.identityName}, persona="${applied.personaName}", liveVoice=${applied.liveVoiceId}, chatVoice=${applied.chatVoiceId}, accent="${applied.accent || 'Default'}", style="${applied.tone || 'Natural'}", locale=${applied.languageCode}.`;
  addDebugLog('Tool:Voice:Applied', msg);
  addDebugLog('Tool:change_voice:Success', msg);

  return {
    ok: true,
    success: true,
    toolName: 'change_voice',
    message: msg,
    data: { applied },
    applied,
    requiresLiveReconnect,
  };
}

export function executeChangeVoiceTool(args: ChangeVoiceToolArgs = {}): VoiceToolExecutionResult {
  return executeVoiceToolCall('change_voice', args as Record<string, any>);
}

export function executeListVoiceOptionsTool(args: Record<string, any> = {}): VoiceToolExecutionResult {
  return executeVoiceToolCall('list_voice_options', args);
}
