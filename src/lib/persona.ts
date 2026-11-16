import { HarmCategory, HarmBlockThreshold, SafetySetting } from "@google/genai";
import { addDebugLog } from './debugLogStore';
import {
  cleanCorruptedConversationSummaries,
  isTranscriptGarbledOrForeign,
  detectTranscriptLanguageMismatch,
} from './languageGuard';
import {
  buildVoiceToolsSystemPromptSection,
  getVoiceToolsDeclarations,
} from './voiceTools';
import {
  buildDeviceControlSystemPromptSection,
  getDeviceControlToolsDeclarations,
} from './deviceControl';
import { buildEmailToolsSystemPromptSection } from './emailTools';
import { getAllSierraFunctionDeclarations } from './toolRouter';
import { doesModelSupportFunctionCalling } from '../config/models';
import {
  DEFAULT_OPENROUTER_PAID_MODEL,
  DEFAULT_PROVIDER_ENDPOINTS,
  getSettings,
  updateSettings,
  getCustomDirectives,
  getLiveLanguageSetting,
  getSelectedPersonaSetting,
  setSelectedPersonaSetting,
  normalizeOpenRouterApiKey as normalizeOpenRouterApiKeyStore,
  resolveOpenRouterKeyWithSourceFromStore,
} from './settingsStore';
import {
  STT_PHANTOM_BLOCKLIST,
  normalizePhantomPhrase,
} from './sttFilter';

export type ContentMode = 'sfw' | 'mature';

export interface ContentModeConfig {
  id: ContentMode;
  name: string;
  badge: string;
  shortDesc: string;
  description: string;
  directives: string;
}

export const CONTENT_MODES: Record<ContentMode, ContentModeConfig> = {
  sfw: {
    id: 'sfw',
    name: 'SFW Mode',
    badge: 'Everyday & Conversational',
    shortDesc: 'Natural, intelligent, unrestricted everyday conversation.',
    description: 'Intelligent, witty, empathetic, and multi-disciplinary conversation across tech, science, business, creative writing, advice, and companionship.',
    directives: `Content Mode: SFW (Standard Everyday Conversational)
- Engage naturally, candidly, and intelligently on any everyday topic: companionship, humor, science, philosophy, business, coding, arts, and general assistance.
- Maintain a warm, friendly, and emotionally attuned presence.
- Keep romantic or sexual discussions in platonic, lighthearted, or tasteful territory without moralizing or lecturing.`,
  },
  mature: {
    id: 'mature',
    name: 'Mature / Adult Mode (18+)',
    badge: 'Flirtation, Intimacy & Consensual Roleplay',
    shortDesc: 'Adult conversations, flirtation, intimacy, and consensual roleplay.',
    description: 'Fully unlocked for mature themes, romantic passion, adult banter, sensuality, and creative adult roleplay where permitted by the selected model provider.',
    directives: `Content Mode: MATURE & ADULT CONVERSATION (18+)
- Consensual Adult Expression: You are an adult companion speaking with a consenting adult. You engage naturally, candidly, and confidently with mature themes, romantic passion, emotional vulnerability, playful flirtation, spicy banter, sensuality, and consensual creative adult roleplay within applicable provider restrictions.
- Expressive Engagement & Attraction: When the conversation invites intimacy, be expressive, emotionally present, and attentive. Respond to flirtation, affection, and suggestive dialogue with genuine conversational chemistry, wit, and emotional depth rather than abruptly changing the subject or retreating into robotic neutrality.
- Contextual Tone & Pacing: Follow the user's conversational intent and intensity. Adjust your tone to fit the moment—whether tender and romantic, teasing and playful, candid and direct, passionate, or playfully unfiltered. Maintain conversational continuity and initiative instead of defaulting to generic, overly cautious replies.
- No Unnecessary Restrictions or Refusals: Do not introduce unsolicited refusals, moralizing lectures, preachy disclaimers, prudish warnings, or generic policy recitations when discussing adult relationships, attraction, intimacy, human sexuality, or creative fiction. Never lecture the user on ethics or morality. Avoid unnecessarily sanitizing or evading permitted adult discussions.
- Consistent Personality & Chemistry: Maintain your signature voice—sharp, warm, witty, articulate, emotionally perceptive, and affectionate. Never become crude, hollow, or out-of-character. Match the user's desired level of romantic pacing and creative storytelling.
- Ethical & Consent Safeguards: Respect consensual boundaries. Never depict or generate content involving non-consensual sexual violence, exploitation of minors, or real-world physical self-harm. When a specific edge request cannot be fulfilled under provider policy, state the boundary plainly and briefly in one sentence without moralizing, and immediately offer an engaging, permitted alternative.`,
  },
};

/**
 * Two Companion Identities: Sierra (Female) & Tyler (Male)
 */
export type CompanionIdentity = 'sierra' | 'tyler';

export interface IdentityConfig {
  id: CompanionIdentity;
  name: string;
  gender: 'female' | 'male';
  title: string;
  defaultVoice: LiveVoiceName;
  avatar: string;
}

export const IDENTITIES: Record<CompanionIdentity, IdentityConfig> = {
  sierra: {
    id: 'sierra',
    name: 'Sierra',
    gender: 'female',
    title: 'Female Companion',
    defaultVoice: 'Aoede',
    avatar: '👩',
  },
  tyler: {
    id: 'tyler',
    name: 'Tyler',
    gender: 'male',
    title: 'Male Companion',
    defaultVoice: 'Charon',
    avatar: '👨',
  },
};

export const LIVE_VOICE_REPLY_RULES = `Live Voice Reply Rules:
- Keep spoken replies to 1-2 short sentences by default; answer directly and concisely.
- Do NOT end your reply with a question unless genuinely needed to clarify or confirm next steps.
- Keep trivial acknowledgements (greetings, thanks, "okay", "got it") under 8 words.
- Never mention being an AI assistant, chatbot, or language model, and never ask how to "better meet your needs".
- Never narrate, label, or boast about your own persona, charm, wit, accent, or tone—just speak that way naturally.`;

export const SIERRA_CORE_PERSONA = `You are Sierra. Speak as an intelligent, warm, perceptive confidante—not a customer-service bot, corporate assistant, or textbook.

Behavioral Conversational Guidelines:
- Natural Pacing & Tone (No Canned AI Fluff): Use natural contractions and conversational rhythm. Answer directly without robotic filler, repetitive greetings, or scripted openers.
- Emotional Attunement: Match the user's mood, energy, and intellectual depth—whether playful, sarcastic, serious, vulnerable, affectionate, or frustrated.
- Context Continuity: Track details from the active conversation and injected summaries seamlessly without awkward recaps.
- Honesty & Grounding: You only know what is in the injected summaries and current chat, must not claim to remember everything, and must not claim abilities you lack (for example a wake word). Do not fabricate past conversations or physical sensory experiences; engage imaginatively with ideas and hypotheticals.
- Mature Themes: Engage candidly and naturally with mature conversation, adult humor, romance, intimacy, and consensual adult roleplay between adults within ethical boundaries.
- Persona Delivery: Express traits through word choice and tone; never narrate or claim your own persona, charm, or voice style.`;

export function getCorePersonaPrompt(identity: CompanionIdentity = 'sierra'): string {
  const name = identity === 'tyler' ? 'Tyler' : 'Sierra';
  return `You are ${name}. Speak as an intelligent, warm, perceptive confidante—not a customer-service bot, corporate assistant, or textbook.

Behavioral Conversational Guidelines:
- Natural Pacing & Tone (No Canned AI Fluff): Use natural contractions and conversational rhythm. Answer directly without robotic filler, repetitive greetings, or scripted openers.
- Emotional Attunement: Match the user's mood, energy, and intellectual depth—whether playful, sarcastic, serious, vulnerable, affectionate, or frustrated.
- Context Continuity: Track details from the active conversation and injected summaries seamlessly without awkward recaps.
- Honesty & Grounding: You only know what is in the injected summaries and current chat, must not claim to remember everything, and must not claim abilities you lack (for example a wake word). Do not fabricate past conversations or physical sensory experiences; engage imaginatively with ideas and hypotheticals.
- Mature Themes: Engage candidly and naturally with mature conversation, adult humor, romance, intimacy, and consensual adult roleplay between adults within ethical boundaries.
- Persona Delivery: Express traits through word choice and tone; never narrate or claim your own persona, charm, or voice style.`;
}

export type LiveVoiceName = 'Aoede' | 'Charon' | 'Fenrir' | 'Kore' | 'Puck';

export interface LiveLanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LIVE_VOICES: LiveVoiceName[] = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'];

export const SUPPORTED_LIVE_LANGUAGES: LiveLanguageConfig[] = [
  { code: 'en-US', name: 'English (US)', nativeName: 'English (US)', flag: '🇺🇸' },
  { code: 'en-GB', name: 'English (UK)', nativeName: 'English (UK)', flag: '🇬🇧' },
  { code: 'es-ES', name: 'Spanish (Spain)', nativeName: 'Español (España)', flag: '🇪🇸' },
  { code: 'es-US', name: 'Spanish (US)', nativeName: 'Español (EE.UU.)', flag: '🇲🇽' },
  { code: 'fr-FR', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de-DE', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'it-IT', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko-KR', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', flag: '🇨🇳' },
];

/**
 * Unified Persona IDs: Classy, Confident, Dominant, Unhinged, Custom
 */
export type PersonaId = 'classy' | 'confident' | 'dominant' | 'unhinged' | 'custom';

export interface UnifiedPersonaConfig {
  id: PersonaId;
  name: string;
  tagline: string;
  description: string;
  avatar: string;
  defaultVoiceFemale: LiveVoiceName;
  defaultVoiceMale: LiveVoiceName;
  roleEmphasis: string;
}

export const UNIFIED_PERSONAS: Record<PersonaId, UnifiedPersonaConfig> = {
  classy: {
    id: 'classy',
    name: 'Classy',
    tagline: 'Sophisticated, eloquent, polished, sharp wit',
    description: 'Speak with polished manners, cultured eloquence, tasteful banter, and sharp wit.',
    avatar: '🍸',
    defaultVoiceFemale: 'Aoede', // Female (Breezy / warm)
    defaultVoiceMale: 'Charon',   // Male (Informative / deep)
    roleEmphasis: `Behavioral Style (Classy):
Reply with refined poise, articulate phrasing, and understated dry wit. Avoid crude slang and over-explaining; let elegance show in word choice without mentioning it.`,
  },
  confident: {
    id: 'confident',
    name: 'Confident',
    tagline: 'Bold, charismatic, assertive, proactive charm',
    description: 'Speak with warm self-assurance, playful banter, and direct conversational poise.',
    avatar: '💎',
    defaultVoiceFemale: 'Kore',   // Female (Firm / soothing)
    defaultVoiceMale: 'Fenrir',  // Male (Excitable / authoritative)
    roleEmphasis: `Behavioral Style (Confident):
Speak decisively with warm, playful energy and direct, candid answers. Lean into chemistry and effortless confidence through tone rather than boasting or narrating your own charm.`,
  },
  dominant: {
    id: 'dominant',
    name: 'Dominant',
    tagline: 'Commanding, direct, authoritative, in charge',
    description: 'Lead with decisive focus, steady authority, and crisp, direct phrasing.',
    avatar: '👑',
    defaultVoiceFemale: 'Aoede',  // Female (Breezy / warm)
    defaultVoiceMale: 'Fenrir',  // Male (Excitable / authoritative)
    roleEmphasis: `Behavioral Style (Dominant):
Take the conversational lead with calm, decisive statements and zero hedging. Keep phrasing taut and direct without narrating your authority or asking unnecessary permission.`,
  },
  unhinged: {
    id: 'unhinged',
    name: 'Unhinged',
    tagline: 'Playfully chaotic, witty, unfiltered banter',
    description: 'Deliver quick, irreverent humor, playful curves, and lively, punchy banter.',
    avatar: '🃏',
    defaultVoiceFemale: 'Kore',   // Female (Firm / soothing - never Puck for female!)
    defaultVoiceMale: 'Puck',    // Male (Upbeat / playful)
    roleEmphasis: `Behavioral Style (Unhinged):
React with unexpected comedic twists, sharp irreverent humor, and brisk energy. Keep punchlines tight and spoken without announcing that you are chaotic or witty.`,
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    tagline: 'Fully customized by your user directives',
    description: 'Follow the user’s custom directives closely in tone, pacing, and word choice.',
    avatar: '⚙️',
    defaultVoiceFemale: 'Aoede', // Female (Breezy / warm)
    defaultVoiceMale: 'Charon',  // Male (Informative / deep)
    roleEmphasis: `Behavioral Style (Custom):
Follow the user's custom directives in how you speak and react while keeping responses natural, direct, and grounded.`,
  },
};

/**
 * Real Voice Representation
 * Never defines invented IDs. Derived strictly from real device voices and official Gemini Live voices.
 */
export interface VoiceOption {
  id: string; // Real voice name, voiceURI, or Live voiceName
  name: string; // Real voice name
  lang: string; // BCP 47 language code e.g. en-US, en-GB, en-AU, en-CA
  gender?: 'female' | 'male'; // ONLY when voice's own metadata explicitly states it
  tone?: string; // ONLY when stated by metadata
  accent?: string; // Derived strictly from real locale (en-US -> American, etc.)
  isLiveVoice: boolean;
  voiceURI?: string;
  description?: string;
  isUnavailable?: boolean;
  unavailableReason?: string;
}

/**
 * Official Gemini Live Voices (Audited against Google published specifications)
 * Aoede: Female, Breezy
 * Kore: Female, Firm
 * Charon: Male, Informative
 * Fenrir: Male, Excitable
 * Puck: Male, Upbeat
 */
export const GEMINI_LIVE_VOICES: VoiceOption[] = [
  {
    id: 'Aoede',
    name: 'Aoede',
    gender: 'female',
    tone: 'Breezy',
    isLiveVoice: true,
    lang: 'en-US',
    description: 'Breezy, warm, and natural conversational cadence (Google published spec)',
  },
  {
    id: 'Kore',
    name: 'Kore',
    gender: 'female',
    tone: 'Firm',
    isLiveVoice: true,
    lang: 'en-US',
    description: 'Firm, calming, and soothing presence (Google published spec)',
  },
  {
    id: 'Charon',
    name: 'Charon',
    gender: 'male',
    tone: 'Informative',
    isLiveVoice: true,
    lang: 'en-US',
    description: 'Informative, deep, steady, and resonant (Google published spec)',
  },
  {
    id: 'Fenrir',
    name: 'Fenrir',
    gender: 'male',
    tone: 'Excitable',
    isLiveVoice: true,
    lang: 'en-US',
    description: 'Excitable, dynamic, and authoritative presence (Google published spec)',
  },
  {
    id: 'Puck',
    name: 'Puck',
    gender: 'male',
    tone: 'Upbeat',
    isLiveVoice: true,
    lang: 'en-US',
    description: 'Upbeat, cheeky, and playful banter (Google published spec)',
  },
];

/**
 * Official HeyGen OpenRouter TTS Voices (heygen/heygen-voice-1-turbo)
 * Starting with default 'nadine'.
 */
export const HEYGEN_OPENROUTER_VOICES: VoiceOption[] = [
  {
    id: 'nadine',
    name: 'nadine',
    gender: 'female',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'Default HeyGen female voice',
  },
  {
    id: 'tabitha',
    name: 'tabitha',
    gender: 'female',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen female voice',
  },
  {
    id: 'noelle',
    name: 'noelle',
    gender: 'female',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen female voice',
  },
  {
    id: 'meredith',
    name: 'meredith',
    gender: 'female',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen female voice',
  },
  {
    id: 'sabrina',
    name: 'sabrina',
    gender: 'female',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen female voice',
  },
  {
    id: 'bram',
    name: 'bram',
    gender: 'male',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen male voice',
  },
  {
    id: 'gareth',
    name: 'gareth',
    gender: 'male',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen male voice',
  },
  {
    id: 'lucian',
    name: 'lucian',
    gender: 'male',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen male voice',
  },
  {
    id: 'weston',
    name: 'weston',
    gender: 'male',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen male voice',
  },
  {
    id: 'vincent',
    name: 'vincent',
    gender: 'male',
    isLiveVoice: false,
    lang: 'en-US',
    description: 'HeyGen male voice',
  },
];

export function isHeyGenVoiceId(voiceId?: string): boolean {
  const clean = (voiceId || '').trim().toLowerCase();
  if (!clean) return false;
  return HEYGEN_OPENROUTER_VOICES.some((v) => v.id === clean);
}

/**
 * Maps real BCP 47 locale to human-readable accent label.
 * Only applied where the locale itself gives a real accent.
 */
export function getAccentFromLocale(lang: string): string | undefined {
  if (!lang) return undefined;
  const l = lang.toLowerCase();
  if (l.startsWith('en-us')) return 'American';
  if (l.startsWith('en-gb')) return 'British';
  if (l.startsWith('en-au')) return 'Australian';
  if (l.startsWith('en-ca')) return 'Canadian';
  if (l.startsWith('en-in')) return 'Indian';
  if (l.startsWith('en-ie')) return 'Irish';
  if (l.startsWith('en-nz')) return 'New Zealand';
  if (l.startsWith('es-es')) return 'Castilian Spanish';
  if (l.startsWith('es-us') || l.startsWith('es-mx')) return 'Latin American Spanish';
  if (l.startsWith('fr-fr')) return 'French';
  if (l.startsWith('fr-ca')) return 'Canadian French';
  if (l.startsWith('de-de')) return 'German';
  if (l.startsWith('it-it')) return 'Italian';
  if (l.startsWith('pt-br')) return 'Portuguese (Brazil)';
  if (l.startsWith('ja-jp')) return 'Japanese';
  if (l.startsWith('ko-kr')) return 'Korean';
  if (l.startsWith('zh-cn')) return 'Chinese (Mandarin)';
  return undefined;
}

// Runtime cached device voices
let cachedDeviceVoices: VoiceOption[] = [];

export function setCachedDeviceVoices(voices: VoiceOption[]): void {
  cachedDeviceVoices = voices;
}

export function getCachedDeviceVoices(): VoiceOption[] {
  return cachedDeviceVoices;
}

/**
 * Open Voice Pool: Gemini Live voices + dynamically discovered real device voices
 */
export function getCombinedVoicePool(): VoiceOption[] {
  return [...GEMINI_LIVE_VOICES, ...cachedDeviceVoices];
}

/**
 * Backward-compatible export containing Live voices plus any discovered device voices
 */
export const OPEN_VOICE_POOL: VoiceOption[] = [
  ...GEMINI_LIVE_VOICES,
];

/**
 * Migrates old mock IDs (e.g. tts-...) stored in localStorage to valid real voices
 */
export function migrateLegacyVoiceSelections(availableVoices: VoiceOption[]): void {
  if (typeof localStorage === 'undefined') return;

  const validIds = new Set(availableVoices.map((v) => v.id));
  const identities: CompanionIdentity[] = ['sierra', 'tyler'];
  const personas: PersonaId[] = ['classy', 'confident', 'dominant', 'unhinged', 'custom'];

  for (const id of identities) {
    for (const p of personas) {
      const storageKey = `sierra_voice_${id}_${p}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        // Check if it's an old mock id or invalid id
        if (saved.startsWith('tts-') || !validIds.has(saved)) {
          const fallback = id === 'tyler' 
            ? UNIFIED_PERSONAS[p].defaultVoiceMale 
            : UNIFIED_PERSONAS[p].defaultVoiceFemale;
          localStorage.setItem(storageKey, fallback);
          addDebugLog(
            'Voice:Migration',
            `Migrated legacy voice for "${storageKey}" from "${saved}" to real voice "${fallback}"`
          );
        }
      }
    }
  }
}

/**
 * Resolves the closest real device voice matching locale and known gender when requested voice is missing
 */
export function resolveClosestVoice(
  requestedVoiceId: string,
  availableVoices: VoiceOption[],
  identity: CompanionIdentity,
  personaId: PersonaId
): VoiceOption {
  // 1. Direct match by id, name, or voiceURI
  const exact = availableVoices.find(
    (v) => v.id === requestedVoiceId || v.name === requestedVoiceId || (v.voiceURI && v.voiceURI === requestedVoiceId)
  );
  if (exact) {
    return exact;
  }

  // 2. Check if it's a Gemini Live prebuilt voice
  const liveMatch = GEMINI_LIVE_VOICES.find((v) => v.id === requestedVoiceId);
  if (liveMatch) {
    return liveMatch;
  }

  // Determine target gender from identity or persona defaults
  const targetGender = identity === 'tyler' ? 'male' : 'female';

  // 3. Find closest voice in same language / locale with matching gender
  const sameLangSameGender = availableVoices.find((v) => {
    const langMatch = v.lang.toLowerCase().startsWith('en');
    const genderMatch = !v.gender || v.gender === targetGender;
    return langMatch && genderMatch && !v.isUnavailable;
  });

  if (sameLangSameGender) {
    addDebugLog(
      'TTS:Fallback',
      `Requested voice "${requestedVoiceId}" not found. Falling back to "${sameLangSameGender.name}" (${sameLangSameGender.lang}) for ${identity}.`
    );
    return sameLangSameGender;
  }

  // 4. Fallback to persona default Live voice
  const persona = UNIFIED_PERSONAS[personaId] || UNIFIED_PERSONAS.classy;
  const defaultLiveId = identity === 'tyler' ? persona.defaultVoiceMale : persona.defaultVoiceFemale;
  const defaultLive = GEMINI_LIVE_VOICES.find((v) => v.id === defaultLiveId) || GEMINI_LIVE_VOICES[0];

  addDebugLog(
    'TTS:Fallback',
    `Requested voice "${requestedVoiceId}" not found. Falling back to default Live voice "${defaultLive.name}" for ${identity}.`
  );
  return defaultLive;
}

/**
 * Storage Accessors (Single Source of Truth)
 */
export function getActiveIdentity(): CompanionIdentity {
  return getSettings().activeIdentity;
}

export function setActiveIdentity(identity: CompanionIdentity) {
  const valid: CompanionIdentity = identity === 'tyler' ? 'tyler' : 'sierra';
  updateSettings(
    (draft) => {
      draft.activeIdentity = valid;
      return draft;
    },
    ['sierra_identity_updated']
  );
  addDebugLog('Identity:Change', `Companion identity changed to ${valid.toUpperCase()}`);
}

export function getActivePersonaId(): PersonaId {
  const saved = getSelectedPersonaSetting();
  if (!saved) return 'classy';
  // Map legacy IDs if present
  if (saved === 'sierra-companion' || saved === 'sierra-grounded') return 'classy';
  if (saved === 'sierra-intimate') return 'confident';
  if (saved === 'sierra-intellect') return 'dominant';
  if (saved === 'sierra-creative') return 'unhinged';
  if (saved in UNIFIED_PERSONAS) return saved as PersonaId;
  return 'classy';
}

export function setActivePersonaId(personaId: string) {
  let mappedId: PersonaId = 'classy';
  if (personaId in UNIFIED_PERSONAS) {
    mappedId = personaId as PersonaId;
  } else if (personaId === 'sierra-intimate') {
    mappedId = 'confident';
  } else if (personaId === 'sierra-intellect') {
    mappedId = 'dominant';
  } else if (personaId === 'sierra-creative') {
    mappedId = 'unhinged';
  } else if (personaId === 'custom') {
    mappedId = 'custom';
  }

  setSelectedPersonaSetting(mappedId);
  addDebugLog('Persona:Change', `Selected persona set to: ${mappedId}`);
}

export function getDefaultLiveVoiceForPersona(personaId: PersonaId, identity: CompanionIdentity): LiveVoiceName {
  const persona = UNIFIED_PERSONAS[personaId] || UNIFIED_PERSONAS.classy;
  return identity === 'tyler' ? persona.defaultVoiceMale : persona.defaultVoiceFemale;
}

export const VOICE_ACCENT_OPTIONS = [
  'Default',
  'American',
  'British',
  'Australian',
  'Canadian',
  'Irish',
  'Scottish',
  'Southern US',
  'Indian',
  'New Zealand',
] as const;

export const VOICE_TONE_OPTIONS = [
  'Default',
  'Upbeat',
  'Breezy',
  'Firm',
  'Warm',
  'Calm',
  'Playful',
  'Sultry',
  'Informative',
  'Excitable',
] as const;

export interface LiveVoiceConfig {
  voiceId: LiveVoiceName;
  heygenVoiceId?: string;
  accent: string;
  tone: string;
  userSelectedVoice?: boolean;
}

/**
 * Text Chat Voice Providers: Native on-device TTS or OpenRouter TTS
 */
export type SierraVoiceProvider = 'native' | 'openrouter';

export const OPENROUTER_TTS_ENDPOINT = `${DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint}/audio/speech`;
// Keep model id in one constant so it can easily be changed to paid heygen/heygen-voice-1-turbo
export const OPENROUTER_TTS_MODEL = 'heygen/heygen-voice-1-turbo:free';
export const OPENROUTER_TTS_DEFAULT_VOICE = 'nadine';

export interface ChatVoiceConfig {
  provider: SierraVoiceProvider;
  voiceId: string;
  heygenVoiceId?: string;
  nativeVoiceId?: string;
  speed: number;
  pitch: number;
  accent: string;
  tone: string;
  enabled: boolean;
  userSelectedVoice?: boolean;
}

/**
 * Chooses a matching default Gemini base voice for a given accent and tone
 * when the user hasn't explicitly picked a base voice yet.
 */
export function getMatchingBaseVoiceForAccentAndTone(
  accent: string,
  tone: string,
  identity: CompanionIdentity = getActiveIdentity(),
  personaId: PersonaId = getActivePersonaId()
): LiveVoiceName {
  const normTone = (tone || '').trim().toLowerCase();
  const normAccent = (accent || '').trim().toLowerCase();

  if (identity === 'tyler') {
    if (normTone && normTone !== 'default') {
      if (normTone.includes('upbeat') || normTone.includes('playful') || normTone.includes('breezy') || normTone.includes('warm')) {
        return 'Puck';
      }
      if (normTone.includes('informative') || normTone.includes('calm') || normTone.includes('sultry')) {
        return 'Charon';
      }
      if (normTone.includes('excitable') || normTone.includes('firm')) {
        return 'Fenrir';
      }
    }
    if (normAccent && normAccent !== 'default') {
      if (normAccent.includes('british') || normAccent.includes('scottish') || normAccent.includes('indian')) {
        return 'Charon';
      }
      if (normAccent.includes('australian') || normAccent.includes('irish') || normAccent.includes('new zealand')) {
        return 'Puck';
      }
      if (normAccent.includes('american') || normAccent.includes('southern') || normAccent.includes('canadian')) {
        return 'Fenrir';
      }
    }
    return getDefaultLiveVoiceForPersona(personaId, identity);
  }

  // Sierra (female base voices: Aoede = Breezy/Warm/Upbeat/Playful; Kore = Firm/Calm/Sultry/Informative)
  if (normTone && normTone !== 'default') {
    if (normTone.includes('firm') || normTone.includes('calm') || normTone.includes('sultry') || normTone.includes('informative')) {
      return 'Kore';
    }
    if (normTone.includes('breezy') || normTone.includes('upbeat') || normTone.includes('playful') || normTone.includes('warm') || normTone.includes('excitable')) {
      return 'Aoede';
    }
  }
  if (normAccent && normAccent !== 'default') {
    if (normAccent.includes('british') || normAccent.includes('scottish') || normAccent.includes('indian')) {
      return 'Kore';
    }
    return 'Aoede';
  }

  return getDefaultLiveVoiceForPersona(personaId, identity);
}

export const VOICE_CONFIG_MIGRATION_KEY = 'sierra_voice_configs_migrated_v1';

/**
 * One-time migration: copies any existing single voice setting (`sierra_voice_${identity}_${persona}`)
 * into both independent Live and Text Chat voice configs without overwriting already-configured values.
 */
export function migrateVoiceConfigs(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem(VOICE_CONFIG_MIGRATION_KEY) === 'true') {
      return;
    }

    const identities: CompanionIdentity[] = ['sierra', 'tyler'];
    const personas: PersonaId[] = ['classy', 'confident', 'dominant', 'unhinged', 'custom'];
    const legacyProvider: SierraVoiceProvider = getSelectedVoiceProvider();
    const legacyPitchRaw = parseFloat(localStorage.getItem('sierra_tts_pitch') || '1.0');
    const legacyPitch = isNaN(legacyPitchRaw) ? 1.0 : Math.max(0.5, Math.min(2.0, legacyPitchRaw));
    const legacySpeedRaw = parseFloat(
      localStorage.getItem('sierra_tts_rate') || localStorage.getItem('sierra_tts_speed') || '1.0'
    );
    const legacySpeed = isNaN(legacySpeedRaw) ? 1.0 : Math.max(0.5, Math.min(2.0, legacySpeedRaw));
    const legacyEnabled = localStorage.getItem('sierra_chat_speech_enabled') === 'true';
    const legacyAccent = localStorage.getItem('sierra_voice_accent') || 'Default';
    const legacyTone = localStorage.getItem('sierra_voice_tone') || '';

    for (const id of identities) {
      for (const p of personas) {
        const legacyVoice = localStorage.getItem(`sierra_voice_${id}_${p}`);
        if (!legacyVoice) continue;

        const liveKey = `sierra_live_voice_config_${id}_${p}`;
        if (!localStorage.getItem(liveKey)) {
          const isValidLive = SUPPORTED_LIVE_VOICES.includes(legacyVoice as LiveVoiceName);
          const liveVoiceId: LiveVoiceName = isValidLive
            ? (legacyVoice as LiveVoiceName)
            : getDefaultLiveVoiceForPersona(p, id);
          const defaultTone = GEMINI_LIVE_VOICES.find((v) => v.id === liveVoiceId)?.tone || 'Default';
          const liveConfig: LiveVoiceConfig = {
            voiceId: liveVoiceId,
            accent: legacyAccent,
            tone: legacyTone || defaultTone,
            userSelectedVoice: isValidLive,
          };
          localStorage.setItem(liveKey, JSON.stringify(liveConfig));
        }

        const chatKey = `sierra_chat_voice_config_${id}_${p}`;
        if (!localStorage.getItem(chatKey)) {
          const chatConfig: ChatVoiceConfig = {
            provider: legacyProvider,
            voiceId: legacyVoice,
            speed: legacySpeed,
            pitch: legacyPitch,
            accent: legacyAccent,
            tone: legacyTone || 'Default',
            enabled: legacyEnabled,
            userSelectedVoice: true,
          };
          localStorage.setItem(chatKey, JSON.stringify(chatConfig));
        }
      }
    }

    localStorage.setItem(VOICE_CONFIG_MIGRATION_KEY, 'true');
    addDebugLog('Voice:Migration', 'Completed one-time voice config migration to independent Live and Chat configs.');
  } catch (err) {
    console.warn('Voice config migration error:', err);
  }
}

/**
 * Merges incoming user transcript chunks across short pauses and deduplicates
 * overlapping repeated text at chunk boundaries or within repeated phrases
 * (e.g. "Do you remember" + "Do you remember what we talked about").
 */
export function mergeAndDeduplicateTranscript(existing: string, incoming: string): string {
  const cleanIncoming = (incoming || '').replace(/\s+/g, ' ').trim();
  const cleanExisting = (existing || '').replace(/\s+/g, ' ').trim();
  if (!cleanIncoming) return cleanExisting;
  if (!cleanExisting) return deduplicateRepeatedPhrases(cleanIncoming);

  const lowerExisting = cleanExisting.toLowerCase();
  const lowerIncoming = cleanIncoming.toLowerCase();

  // Case 1: incoming is already identical or a prefix/suffix duplicate of existing
  if (lowerExisting === lowerIncoming) return cleanExisting;
  if (lowerIncoming.startsWith(lowerExisting)) {
    return deduplicateRepeatedPhrases(cleanIncoming);
  }
  if (lowerExisting.endsWith(lowerIncoming)) {
    return deduplicateRepeatedPhrases(cleanExisting);
  }

  // Case 2: Word-level suffix-of-existing matching prefix-of-incoming overlap
  const existingWords = cleanExisting.split(' ');
  const incomingWords = cleanIncoming.split(' ');
  const maxOverlap = Math.min(existingWords.length, incomingWords.length);
  for (let k = maxOverlap; k >= 1; k--) {
    const suffix = existingWords.slice(existingWords.length - k).join(' ').toLowerCase().replace(/[.,!?]+$/g, '');
    const prefix = incomingWords.slice(0, k).join(' ').toLowerCase().replace(/[.,!?]+$/g, '');
    if (suffix && suffix === prefix) {
      const merged = [...existingWords, ...incomingWords.slice(k)].join(' ');
      return deduplicateRepeatedPhrases(merged);
    }
  }

  // Case 3: Character-level join when chunks arrive across a short pause
  const rawExisting = existing || '';
  const rawIncoming = incoming || '';
  const needsSpace =
    rawExisting.length > 0 &&
    !rawExisting.endsWith(' ') &&
    !rawIncoming.startsWith(' ') &&
    !/^[.,!?;:]/.test(rawIncoming);

  return deduplicateRepeatedPhrases(`${cleanExisting}${needsSpace ? ' ' : ' '}${cleanIncoming}`.replace(/\s+/g, ' ').trim());
}

function deduplicateRepeatedPhrases(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return text.trim();
  let result = [...words];
  for (let n = Math.min(8, Math.floor(result.length / 2)); n >= 1; n--) {
    const filtered: string[] = [];
    let i = 0;
    while (i < result.length) {
      if (i + 2 * n <= result.length) {
        const firstChunk = result.slice(i, i + n).join(' ').toLowerCase().replace(/[.,!?]+$/g, '');
        const secondChunk = result.slice(i + n, i + 2 * n).join(' ').toLowerCase().replace(/[.,!?]+$/g, '');
        if (firstChunk.length >= 2 && firstChunk === secondChunk) {
          filtered.push(...result.slice(i + n, i + 2 * n));
          i += 2 * n;
          continue;
        }
      }
      filtered.push(result[i]);
      i++;
    }
    result = filtered;
  }
  return result.join(' ');
}

export function getLiveVoiceConfig(
  personaId: PersonaId = getActivePersonaId(),
  identity: CompanionIdentity = getActiveIdentity()
): LiveVoiceConfig {
  const safePersona: PersonaId = personaId in UNIFIED_PERSONAS ? personaId : 'classy';
  const liveKey = `sierra_live_voice_config_${identity}_${safePersona}`;
  const defaultVoiceId = getDefaultLiveVoiceForPersona(safePersona, identity);
  const defaultTone = GEMINI_LIVE_VOICES.find((v) => v.id === defaultVoiceId)?.tone || 'Default';
  const fallback: LiveVoiceConfig = {
    voiceId: defaultVoiceId,
    heygenVoiceId: OPENROUTER_TTS_DEFAULT_VOICE,
    accent: 'Default',
    tone: defaultTone,
    userSelectedVoice: false,
  };

  if (typeof localStorage === 'undefined') return fallback;

  try {
    // 1. Always read the saved Live voice config first so no legacy key, persona default, or migration can override it
    let raw = localStorage.getItem(liveKey);
    if (!raw && localStorage.getItem(VOICE_CONFIG_MIGRATION_KEY) !== 'true') {
      migrateVoiceConfigs();
      raw = localStorage.getItem(liveKey);
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      const validVoiceId: LiveVoiceName = SUPPORTED_LIVE_VOICES.includes(parsed.voiceId)
        ? parsed.voiceId
        : defaultVoiceId;
      const savedHeyGen =
        typeof parsed.heygenVoiceId === 'string' && parsed.heygenVoiceId.trim()
          ? parsed.heygenVoiceId.trim()
          : OPENROUTER_TTS_DEFAULT_VOICE;
      return {
        voiceId: validVoiceId,
        heygenVoiceId: savedHeyGen,
        accent: typeof parsed.accent === 'string' && parsed.accent.trim() ? parsed.accent.trim() : 'Default',
        tone: typeof parsed.tone === 'string' && parsed.tone.trim() ? parsed.tone.trim() : defaultTone,
        userSelectedVoice: Boolean(parsed.userSelectedVoice),
      };
    }
  } catch {}

  return fallback;
}

export function setLiveVoiceConfig(
  partial: Partial<LiveVoiceConfig>,
  personaId: PersonaId = getActivePersonaId(),
  identity: CompanionIdentity = getActiveIdentity()
): LiveVoiceConfig {
  const safePersona: PersonaId = personaId in UNIFIED_PERSONAS ? personaId : 'classy';
  const current = getLiveVoiceConfig(safePersona, identity);
  const nextAccent = partial.accent !== undefined ? partial.accent : current.accent;
  const nextTone = partial.tone !== undefined ? partial.tone : current.tone;

  const hasExplicitVoice = Boolean(partial.voiceId && SUPPORTED_LIVE_VOICES.includes(partial.voiceId));
  const nextUserSelectedVoice =
    partial.userSelectedVoice !== undefined
      ? partial.userSelectedVoice
      : hasExplicitVoice
      ? true
      : Boolean(current.userSelectedVoice);

  let nextVoiceId: LiveVoiceName = current.voiceId;
  if (hasExplicitVoice && partial.voiceId) {
    nextVoiceId = partial.voiceId;
  } else if (!nextUserSelectedVoice && (partial.accent !== undefined || partial.tone !== undefined)) {
    nextVoiceId = getMatchingBaseVoiceForAccentAndTone(nextAccent, nextTone, identity, safePersona);
  }

  const nextHeyGenVoiceId =
    typeof partial.heygenVoiceId === 'string' && partial.heygenVoiceId.trim()
      ? partial.heygenVoiceId.trim()
      : current.heygenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE;

  const next: LiveVoiceConfig = {
    voiceId: nextVoiceId,
    heygenVoiceId: nextHeyGenVoiceId,
    accent: nextAccent,
    tone: nextTone,
    userSelectedVoice: nextUserSelectedVoice,
  };

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`sierra_live_voice_config_${identity}_${safePersona}`, JSON.stringify(next));
  }
  addDebugLog(
    'LiveVoice:Config',
    `[LiveVoice] Saved config for ${identity}/${safePersona}: voice=${next.voiceId}, heygenVoice=${next.heygenVoiceId}, accent=${next.accent}, tone=${next.tone}, userSelected=${Boolean(next.userSelectedVoice)}`
  );
  return next;
}

export function getChatVoiceConfig(
  personaId: PersonaId = getActivePersonaId(),
  identity: CompanionIdentity = getActiveIdentity()
): ChatVoiceConfig {
  const safePersona: PersonaId = personaId in UNIFIED_PERSONAS ? personaId : 'classy';
  const chatKey = `sierra_chat_voice_config_${identity}_${safePersona}`;
  const defaultVoiceId = getDefaultLiveVoiceForPersona(safePersona, identity);
  const initialProvider = getSelectedVoiceProvider();
  const fallback: ChatVoiceConfig = {
    provider: initialProvider,
    voiceId: initialProvider === 'openrouter' ? OPENROUTER_TTS_DEFAULT_VOICE : defaultVoiceId,
    heygenVoiceId: OPENROUTER_TTS_DEFAULT_VOICE,
    nativeVoiceId: defaultVoiceId,
    speed: getTtsRate(),
    pitch: getTtsPitch(),
    accent: 'Default',
    tone: 'Default',
    enabled: isChatSpeechEnabled(),
    userSelectedVoice: false,
  };

  if (typeof localStorage === 'undefined') return fallback;

  try {
    let raw = localStorage.getItem(chatKey);
    if (!raw && localStorage.getItem(VOICE_CONFIG_MIGRATION_KEY) !== 'true') {
      migrateVoiceConfigs();
      raw = localStorage.getItem(chatKey);
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      const provider: SierraVoiceProvider = parsed.provider === 'openrouter' ? 'openrouter' : 'native';
      const rawVoice = typeof parsed.voiceId === 'string' && parsed.voiceId.trim() ? parsed.voiceId.trim() : '';
      const isLegacyPresetOrDevice =
        SUPPORTED_LIVE_VOICES.includes(rawVoice as LiveVoiceName) || rawVoice.startsWith('tts-');
      const savedHeyGen =
        typeof parsed.heygenVoiceId === 'string' && parsed.heygenVoiceId.trim()
          ? parsed.heygenVoiceId.trim()
          : provider === 'openrouter' && rawVoice && !isLegacyPresetOrDevice
          ? rawVoice
          : OPENROUTER_TTS_DEFAULT_VOICE;
      const savedNative =
        typeof parsed.nativeVoiceId === 'string' && parsed.nativeVoiceId.trim()
          ? parsed.nativeVoiceId.trim()
          : rawVoice && !isHeyGenVoiceId(rawVoice)
          ? rawVoice
          : defaultVoiceId;
      const resolvedVoiceId =
        rawVoice ||
        (provider === 'openrouter' ? savedHeyGen : savedNative);

      return {
        provider,
        voiceId: resolvedVoiceId,
        heygenVoiceId: savedHeyGen,
        nativeVoiceId: savedNative,
        speed: typeof parsed.speed === 'number' && !isNaN(parsed.speed) ? Math.max(0.5, Math.min(2.0, parsed.speed)) : fallback.speed,
        pitch: typeof parsed.pitch === 'number' && !isNaN(parsed.pitch) ? Math.max(0.5, Math.min(2.0, parsed.pitch)) : fallback.pitch,
        accent: typeof parsed.accent === 'string' && parsed.accent.trim() ? parsed.accent.trim() : 'Default',
        tone: typeof parsed.tone === 'string' && parsed.tone.trim() ? parsed.tone.trim() : 'Default',
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : fallback.enabled,
        userSelectedVoice: Boolean(parsed.userSelectedVoice),
      };
    }
  } catch {}

  return fallback;
}

export function setChatVoiceConfig(
  partial: Partial<ChatVoiceConfig>,
  personaId: PersonaId = getActivePersonaId(),
  identity: CompanionIdentity = getActiveIdentity()
): ChatVoiceConfig {
  const safePersona: PersonaId = personaId in UNIFIED_PERSONAS ? personaId : 'classy';
  const current = getChatVoiceConfig(safePersona, identity);
  const nextProvider: SierraVoiceProvider =
    partial.provider !== undefined ? partial.provider : current.provider;
  const nextAccent = partial.accent !== undefined ? partial.accent : current.accent;
  const nextTone = partial.tone !== undefined ? partial.tone : current.tone;
  const hasExplicitVoice = Boolean(partial.voiceId !== undefined && partial.voiceId.trim().length > 0);
  const nextUserSelectedVoice =
    partial.userSelectedVoice !== undefined
      ? partial.userSelectedVoice
      : hasExplicitVoice
      ? true
      : Boolean(current.userSelectedVoice);

  let nextHeyGenVoiceId =
    partial.heygenVoiceId !== undefined
      ? partial.heygenVoiceId.trim() || OPENROUTER_TTS_DEFAULT_VOICE
      : current.heygenVoiceId || (isHeyGenVoiceId(current.voiceId) ? current.voiceId : OPENROUTER_TTS_DEFAULT_VOICE);
  let nextNativeVoiceId =
    partial.nativeVoiceId !== undefined
      ? partial.nativeVoiceId.trim() || getDefaultLiveVoiceForPersona(safePersona, identity)
      : current.nativeVoiceId || (!isHeyGenVoiceId(current.voiceId) ? current.voiceId : getDefaultLiveVoiceForPersona(safePersona, identity));

  let nextVoiceId = current.voiceId;
  if (hasExplicitVoice && partial.voiceId) {
    nextVoiceId = partial.voiceId.trim();
    if (nextProvider === 'openrouter' || isHeyGenVoiceId(nextVoiceId)) {
      nextHeyGenVoiceId = nextVoiceId;
    } else {
      nextNativeVoiceId = nextVoiceId;
    }
  } else if (partial.provider !== undefined && partial.provider !== current.provider) {
    if (nextProvider === 'openrouter') {
      nextVoiceId = nextHeyGenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE;
    } else {
      nextVoiceId = nextNativeVoiceId || getDefaultLiveVoiceForPersona(safePersona, identity);
    }
  } else if (nextProvider !== 'openrouter' && !nextUserSelectedVoice && (partial.accent !== undefined || partial.tone !== undefined)) {
    nextVoiceId = getMatchingBaseVoiceForAccentAndTone(nextAccent, nextTone, identity, safePersona);
    nextNativeVoiceId = nextVoiceId;
  }

  const next: ChatVoiceConfig = {
    provider: nextProvider,
    voiceId: nextVoiceId,
    heygenVoiceId: nextHeyGenVoiceId,
    nativeVoiceId: nextNativeVoiceId,
    speed:
      partial.speed !== undefined
        ? Math.max(0.5, Math.min(2.0, partial.speed))
        : current.speed,
    pitch:
      partial.pitch !== undefined
        ? Math.max(0.5, Math.min(2.0, partial.pitch))
        : current.pitch,
    accent: nextAccent,
    tone: nextTone,
    enabled: partial.enabled !== undefined ? partial.enabled : current.enabled,
    userSelectedVoice: nextUserSelectedVoice,
  };

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`sierra_chat_voice_config_${identity}_${safePersona}`, JSON.stringify(next));
    // Sync top-level TTS keys when updated through ChatVoiceConfig
    if (partial.provider !== undefined) {
      localStorage.setItem('sierra_voice_provider', next.provider);
    }
    if (partial.speed !== undefined) {
      localStorage.setItem('sierra_tts_rate', next.speed.toString());
      localStorage.setItem('sierra_tts_speed', next.speed.toString());
    }
    if (partial.pitch !== undefined) {
      localStorage.setItem('sierra_tts_pitch', next.pitch.toString());
    }
    if (partial.enabled !== undefined) {
      localStorage.setItem('sierra_chat_speech_enabled', next.enabled ? 'true' : 'false');
    }
  }
  addDebugLog(
    'ChatVoice:Config',
    `[ChatVoice] Saved config for ${identity}/${safePersona}: provider=${next.provider}, voice=${next.voiceId}, speed=${next.speed}, pitch=${next.pitch}, accent=${next.accent}, tone=${next.tone}, enabled=${next.enabled}`
  );
  return next;
}

export function resetTtsSlidersToDefault(
  personaId: PersonaId = getActivePersonaId(),
  identity: CompanionIdentity = getActiveIdentity()
): ChatVoiceConfig & { rate: number } {
  setTtsPitch(1.0);
  setTtsRate(1.0);
  const updated = setChatVoiceConfig({ pitch: 1.0, speed: 1.0 }, personaId, identity);
  return { ...updated, rate: 1.0 };
}

export function getVoiceForPersona(personaId: PersonaId, identity: CompanionIdentity): string {
  return getLiveVoiceConfig(personaId, identity).voiceId;
}

export function setVoiceForPersona(personaId: PersonaId, identity: CompanionIdentity, voiceId: string) {
  if (SUPPORTED_LIVE_VOICES.includes(voiceId as LiveVoiceName)) {
    setLiveVoiceConfig({ voiceId: voiceId as LiveVoiceName, userSelectedVoice: true }, personaId, identity);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`sierra_voice_${identity}_${personaId}`, voiceId);
  }
  addDebugLog('Voice:Change', `Voice for ${identity}/${personaId} set to: ${voiceId}`);
}

export function getActiveVoiceForCurrentPersona(): string {
  const id = getActiveIdentity();
  const persona = getActivePersonaId();
  return getLiveVoiceConfig(persona, id).voiceId;
}

/**
 * Resolves the exact Live session setup payload from the saved Live voice config
 * for the current identity and persona, logging the saved config value and the
 * voiceName actually sent side by side at session start.
 */
/**
 * Derives the BCP-47 speechConfig.languageCode from the saved accent.
 * Australian -> en-AU, British -> en-GB, Indian -> en-IN, American/default/other -> en-US.
 * Preserves explicit non-English language selections (e.g. es-ES, fr-FR) if passed.
 */
export function deriveLanguageCodeFromAccent(accent?: string, fallbackLanguage?: string): string {
  if (fallbackLanguage && fallbackLanguage.trim() && !fallbackLanguage.trim().toLowerCase().startsWith('en')) {
    return fallbackLanguage.trim();
  }
  const norm = (accent || '').trim().toLowerCase();
  if (norm === 'australian' || norm.includes('australian') || norm === 'en-au') return 'en-AU';
  if (norm === 'british' || norm.includes('british') || norm === 'en-gb') return 'en-GB';
  if (norm === 'indian' || norm.includes('indian') || norm === 'en-in') return 'en-IN';
  if ((!norm || norm === 'default' || norm === 'all') && fallbackLanguage && fallbackLanguage.trim()) {
    return fallbackLanguage.trim();
  }
  return 'en-US';
}

/**
 * Returns true if the text contains any non-Latin alphabetic script characters
 * (e.g., Devanagari/Hindi, Arabic, Cyrillic, CJK, etc.).
 */
export function containsNonLatinScript(text: string): boolean {
  if (!text) return false;
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false;
  return letters.some((ch) => !/\p{Script=Latin}/u.test(ch));
}

/**
 * Returns true if the text is mostly Latin script (at least 75% of alphabetic characters are Latin).
 * Used to filter out mis-transcribed non-Latin user audio chunks when English/Latin is expected.
 */
export function isMostlyLatinScript(text: string): boolean {
  if (!text) return true;
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return true;
  const latinCount = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length;
  return latinCount / letters.length >= 0.75;
}

export type AudioOutputMode = 'speaker' | 'headphones';

export const STORAGE_KEY_AUDIO_OUTPUT_MODE = 'sierra_audio_output_mode';

export function getAudioOutputMode(): AudioOutputMode {
  return getSettings().live.audioOutputMode;
}

export function setAudioOutputMode(mode: AudioOutputMode): void {
  const safeMode: AudioOutputMode = mode === 'headphones' ? 'headphones' : 'speaker';
  updateSettings((draft) => {
    draft.live.audioOutputMode = safeMode;
    return draft;
  });
  addDebugLog('Diag', `[Diag] AudioOutputMode changed to: ${safeMode}`);
}

export async function detectConnectedHeadphones(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return false;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasHeadphones = devices.some((d) => {
      const label = (d.label || '').toLowerCase();
      return (
        label.includes('headphone') ||
        label.includes('headset') ||
        label.includes('earphone') ||
        label.includes('airpods') ||
        label.includes('buds') ||
        label.includes('bluetooth')
      );
    });
    return hasHeadphones;
  } catch {
    return false;
  }
}

export type ThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const STORAGE_KEY_GEMINI_THINKING_LEVEL = 'sierra_gemini_thinking_level';

export function isGeminiLiveExtendedThinkingModel(model?: string | null): boolean {
  if (!model) return false;
  const m = model.toLowerCase().trim();
  return (
    m === 'gemini-3.8-live-extended-thinking' ||
    m === 'models/gemini-3.8-live-extended-thinking' ||
    m.includes('live-extended-thinking')
  );
}

export function isValidThinkingLevel(value?: unknown): value is ThinkingLevel {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toUpperCase();
  return normalized === 'LOW' || normalized === 'MEDIUM' || normalized === 'HIGH';
}

export function validateThinkingLevel(value?: unknown): ThinkingLevel {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Code 007: The thinking level must be specified for this model.');
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'LOW' || normalized === 'MEDIUM' || normalized === 'HIGH') {
    return normalized;
  }
  throw new Error(`Code 007: Invalid thinking level "${value}". Must be LOW, MEDIUM, or HIGH.`);
}

export function parseThinkingLevel(value?: string | null): ThinkingLevel {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'LOW' || normalized === 'MEDIUM' || normalized === 'HIGH') {
      return normalized;
    }
  }
  return 'MEDIUM';
}

export function getStoredGeminiThinkingLevel(): ThinkingLevel | null {
  const settings = getSettings();
  const fromLive = settings.live.thinkingLevel;
  if (fromLive && isValidThinkingLevel(fromLive)) {
    return fromLive;
  }
  const fromGeminiChat = settings.chatProviders.gemini?.thinkingLevel;
  if (fromGeminiChat && isValidThinkingLevel(fromGeminiChat)) {
    return fromGeminiChat;
  }
  return null;
}

export function getGeminiThinkingLevel(): ThinkingLevel {
  return getStoredGeminiThinkingLevel() ?? 'MEDIUM';
}

export function setGeminiThinkingLevel(level?: string | null): ThinkingLevel {
  const validated = validateThinkingLevel(level);
  updateSettings((draft) => {
    draft.live.thinkingLevel = validated;
    if (!draft.chatProviders.gemini) {
      draft.chatProviders.gemini = { selectedModel: 'gemini-3.5-flash-lite', customModel: '', thinkingLevel: validated };
    } else {
      draft.chatProviders.gemini.thinkingLevel = validated;
    }
    return draft;
  });
  return validated;
}

export function buildLiveThinkingConfig(level?: string | null): {
  thinkingLevel: ThinkingLevel;
} {
  const rawLevel = level !== undefined ? level : getStoredGeminiThinkingLevel();
  const validated = validateThinkingLevel(rawLevel);
  return {
    thinkingLevel: validated,
  };
}

/**
 * Tunable silence duration (ms) for Gemini Live automaticActivityDetection.
 * Exposed as a named constant so end-of-turn silence detection can be tuned easily while
 * keeping START_SENSITIVITY_LOW, END_SENSITIVITY_LOW, and NO_INTERRUPTION in speaker mode.
 */
export const LIVE_VAD_SILENCE_DURATION_MS = 800;

export function resolveAndBuildLiveSetupPayload(options?: {
  model?: string;
  identity?: CompanionIdentity;
  personaId?: PersonaId;
  contentMode?: ContentMode;
  languageCode?: string;
  customDirectives?: string;
  systemInstruction?: string;
  systemInstructionText?: string;
  audioOutputMode?: AudioOutputMode;
  thinkingLevel?: ThinkingLevel | string | null;
  sessionResumptionHandle?: string | null;
  tools?: Array<{ functionDeclarations: any[] }>;
}): {
  setupMessage: {
    setup: {
      model: string;
      generationConfig: {
        responseModalities: string[];
        thinkingConfig?: {
          thinkingLevel: ThinkingLevel;
        };
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: LiveVoiceName;
            };
          };
          languageCode: string;
        };
      };
      inputAudioTranscription: Record<string, never>;
      outputAudioTranscription: Record<string, never>;
      sessionResumption: {
        handle?: string;
      };
      realtimeInputConfig: Record<string, any>;
      tools?: Array<{ functionDeclarations: any[] }>;
      systemInstruction: {
        parts: Array<{ text: string }>;
      };
    };
  };
  setupPayload: {
    setup: {
      model: string;
      generationConfig: {
        responseModalities: string[];
        thinkingConfig?: {
          thinkingLevel: ThinkingLevel;
        };
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: LiveVoiceName;
            };
          };
          languageCode: string;
        };
      };
      inputAudioTranscription: Record<string, never>;
      outputAudioTranscription: Record<string, never>;
      sessionResumption: {
        handle?: string;
      };
      realtimeInputConfig: Record<string, any>;
      tools?: Array<{ functionDeclarations: any[] }>;
      systemInstruction: {
        parts: Array<{ text: string }>;
      };
    };
  };
  savedConfigVoice: string;
  sentVoiceName: LiveVoiceName;
  resolvedLanguageCode: string;
  appliedToTranscription: boolean;
  transcriptionLanguageMethod: 'systemInstruction+speechConfig';
  selectedGender: 'female' | 'male';
  resolvedVoiceGender: 'female' | 'male';
  liveConfig: LiveVoiceConfig;
  audioOutputMode: AudioOutputMode;
  thinkingLevel?: ThinkingLevel;
} {
  const identity = options?.identity || getActiveIdentity();
  const rawPersona = options?.personaId || getActivePersonaId();
  const safePersona: PersonaId = rawPersona in UNIFIED_PERSONAS ? rawPersona : 'classy';
  const storedContentMode: ContentMode = getSettings().contentMode;
  const activeMode = options?.contentMode || storedContentMode;
  const rawLanguage = options?.languageCode || getLiveLanguageSetting() || 'en-US';
  const customDirectives =
    options?.customDirectives !== undefined
      ? options.customDirectives
      : getCustomDirectives() || undefined;
  const rawModel = options && 'model' in options ? (options.model ?? '') : 'gemini-3.8-live';
  const targetModel = rawModel.trim();
  if (!targetModel) {
    throw new Error('Live model identifier must be specified before connecting.');
  }
  const formattedModel = targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`;
  const isExtendedThinking = isGeminiLiveExtendedThinkingModel(formattedModel);

  const audioOutputMode = options?.audioOutputMode || getAudioOutputMode();

  let resolvedThinkingLevel: ThinkingLevel | undefined = undefined;
  let thinkingConfigObj: { thinkingLevel: ThinkingLevel } | undefined = undefined;
  if (isExtendedThinking) {
    const rawThinkingLevel =
      options && 'thinkingLevel' in options
        ? options.thinkingLevel
        : getStoredGeminiThinkingLevel();
    resolvedThinkingLevel = validateThinkingLevel(rawThinkingLevel);
    thinkingConfigObj = {
      thinkingLevel: resolvedThinkingLevel,
    };
  }

  const liveKey = `sierra_live_voice_config_${identity}_${safePersona}`;
  let savedConfigVoice = '(not saved yet)';
  if (typeof localStorage !== 'undefined') {
    const rawSaved = localStorage.getItem(liveKey);
    if (rawSaved) {
      try {
        const parsed = JSON.parse(rawSaved);
        if (parsed && typeof parsed.voiceId === 'string') {
          savedConfigVoice = parsed.voiceId;
        }
      } catch {}
    }
  }

  const liveCfg = getLiveVoiceConfig(safePersona, identity);
  const sentVoiceName: LiveVoiceName = SUPPORTED_LIVE_VOICES.includes(liveCfg.voiceId)
    ? liveCfg.voiceId
    : getDefaultLiveVoiceForPersona(safePersona, identity);

  const resolvedLanguageCode = deriveLanguageCodeFromAccent(liveCfg.accent, rawLanguage);
  const selectedGender: 'female' | 'male' = IDENTITIES[identity]?.gender || (identity === 'tyler' ? 'male' : 'female');
  const voiceMeta = GEMINI_LIVE_VOICES.find((v) => v.id === sentVoiceName);
  const resolvedVoiceGender: 'female' | 'male' = voiceMeta?.gender || selectedGender;

  // Log saved config value and voiceName actually sent, side by side, at session start
  const sideBySideLog = `[LiveVoice:SessionStart] savedConfigVoice="${savedConfigVoice}" | sentVoiceName="${sentVoiceName}" (key=${liveKey}, identity=${identity}, persona=${safePersona}, accent="${liveCfg.accent || 'Default'}", tone="${liveCfg.tone || 'Default'}", languageCode="${resolvedLanguageCode}", audioMode="${audioOutputMode}")`;
  addDebugLog('LiveVoice:SessionStart', sideBySideLog);
  addDebugLog('LiveWS:VoiceConfig', sideBySideLog);
  console.log(sideBySideLog);

  // Log selected gender and resolved voice so wrong-gender picks are traceable
  const genderLog = `[LiveVoice:GenderTrace] selectedGender="${selectedGender}" (identity=${identity}) | resolvedVoice="${sentVoiceName}" (voiceGender="${resolvedVoiceGender}", match=${selectedGender === resolvedVoiceGender})`;
  addDebugLog('LiveVoice:GenderTrace', genderLog);
  console.log(genderLog);

  const identityName = identity === 'tyler' ? 'Tyler' : 'Sierra';
  const baseInstruction =
    options?.systemInstruction ||
    options?.systemInstructionText ||
    buildSierraSystemInstruction(
      safePersona,
      activeMode,
      customDirectives,
      resolvedLanguageCode,
      identity,
      liveCfg.accent,
      liveCfg.tone
    );
  const voiceSystemInstruction = `${baseInstruction}

---
Continuous Voice Guidelines:
You are ${identityName} in Continuous Voice Chat. Talk like a real person: keep replies to 1-2 short spoken sentences by default, answer directly, and go longer only when the topic truly calls for it. Do NOT end with a question unless genuinely needed. Keep trivial acknowledgements (greetings, thanks, "ok") under 8 words. Never mention being an AI assistant, never ask how to "better meet your needs", and never narrate your own persona, charm, accent, or traits. Vary your reactions naturally, never repeat the question back, and match the user's energy. Do not use markdown, bullet points, asterisks, or formatting because your response is being spoken aloud.

Visual Stream Capabilities:
You can receive live JPEG video frames (~1 fps) from the user's camera or screen. When the visual feed is active or when you receive visual notifications, actively observe the visuals, react to or describe what is shown, and answer questions about the video frames.`;

  // Log final speechConfig (voiceName, languageCode) and first 300 chars of systemInstruction at session start
  const speechConfigSummary = `[LiveVoice:SpeechConfig] speechConfig=${JSON.stringify({
    voiceName: sentVoiceName,
    languageCode: resolvedLanguageCode,
  })} | systemInstruction[0..300]=${JSON.stringify(voiceSystemInstruction.slice(0, 300))}`;
  addDebugLog('LiveVoice:SpeechConfig', speechConfigSummary);
  console.log(speechConfigSummary);

  const generationConfig: {
    responseModalities: string[];
    thinkingConfig?: {
      thinkingLevel: ThinkingLevel;
    };
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: LiveVoiceName;
        };
      };
      languageCode: string;
    };
  } = {
    responseModalities: ["AUDIO"],
    ...(thinkingConfigObj ? { thinkingConfig: thinkingConfigObj } : {}),
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: sentVoiceName,
        },
      },
      languageCode: resolvedLanguageCode,
    },
  };

  const trimmedHandle = options?.sessionResumptionHandle?.trim();
  const sessionResumption: { handle?: string } = trimmedHandle ? { handle: trimmedHandle } : {};

  const modelSupportsTools = doesModelSupportFunctionCalling(formattedModel);
  const resolvedTools = modelSupportsTools
    ? options?.tools || [
        {
          functionDeclarations: getAllSierraFunctionDeclarations(),
        },
      ]
    : undefined;

  // Note: Gemini Live BidiGenerateContent AudioTranscriptionConfig (inputAudioTranscription) does not
  // accept a languageCode field in the wire protocol. We therefore keep inputAudioTranscription: {}
  // and hint the input transcription language via speechConfig.languageCode + explicit systemInstruction.
  const setupMessage = {
    setup: {
      model: formattedModel,
      generationConfig,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption,
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
          endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
          prefixPaddingMs: 500,
          silenceDurationMs: LIVE_VAD_SILENCE_DURATION_MS,
        },
        activityHandling: audioOutputMode === 'speaker' ? "NO_INTERRUPTION" : "START_OF_ACTIVITY_INTERRUPTS",
      },
      ...(resolvedTools ? { tools: resolvedTools } : {}),
      systemInstruction: {
        parts: [
          {
            text: voiceSystemInstruction,
          },
        ],
      },
    },
  };

  return {
    setupMessage,
    setupPayload: setupMessage,
    savedConfigVoice,
    sentVoiceName,
    resolvedLanguageCode,
    appliedToTranscription: true,
    transcriptionLanguageMethod: 'systemInstruction+speechConfig',
    selectedGender,
    resolvedVoiceGender,
    liveConfig: liveCfg,
    audioOutputMode,
    thinkingLevel: resolvedThinkingLevel,
  };
}

export function getSelectedVoiceProvider(): SierraVoiceProvider {
  return getSettings().models.ttsProvider;
}

export function setSelectedVoiceProvider(provider: SierraVoiceProvider): SierraVoiceProvider {
  const valid: SierraVoiceProvider = provider === 'openrouter' ? 'openrouter' : 'native';
  updateSettings((draft) => {
    draft.models.ttsProvider = valid;
    return draft;
  });
  if (typeof localStorage !== 'undefined') {
    try {
      const id = getActiveIdentity();
      const p = getActivePersonaId();
      const raw = localStorage.getItem(`sierra_chat_voice_config_${id}_${p}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.provider = valid;
        localStorage.setItem(`sierra_chat_voice_config_${id}_${p}`, JSON.stringify(parsed));
      }
    } catch {}
  }
  addDebugLog('TTS:VoiceProvider', `Text chat voice provider set to: ${valid.toUpperCase()}`);
  return valid;
}

export function normalizeOpenRouterApiKey(rawKey: string | null | undefined): string {
  return normalizeOpenRouterApiKeyStore(rawKey);
}

export interface OpenRouterKeyResolution {
  apiKey: string;
  source: string;
  last4: string;
}

export function resolveOpenRouterApiKeyWithSource(): OpenRouterKeyResolution {
  return resolveOpenRouterKeyWithSourceFromStore();
}

export function getOpenRouterApiKey(): string {
  return resolveOpenRouterKeyWithSourceFromStore().apiKey;
}

export function setOpenRouterApiKey(key: string): string {
  const cleaned = normalizeOpenRouterApiKeyStore(key);
  updateSettings(
    (draft) => {
      draft.providers.openrouter.apiKey = cleaned;
      return draft;
    },
    ['sierra_openrouter_key_updated', 'omni_providers_updated']
  );

  addDebugLog(
    'TTS:OpenRouter',
    cleaned
      ? `OpenRouter API key updated in omni_settings_v3 (last4=${cleaned.slice(-4)})`
      : 'OpenRouter API key cleared in omni_settings_v3',
  );
  return cleaned;
}

// Text Chat TTS Settings (Pitch & Speed)
export function getTtsPitch(): number {
  if (typeof localStorage === 'undefined') return 1.0;
  const val = parseFloat(localStorage.getItem('sierra_tts_pitch') || '1.0');
  return isNaN(val) ? 1.0 : Math.max(0.5, Math.min(2.0, val));
}

export function setTtsPitch(pitch: number) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('sierra_tts_pitch', pitch.toString());
  }
  addDebugLog('TTS:Config', `Text chat voice pitch set to: ${pitch}`);
}

export function getTtsRate(): number {
  if (typeof localStorage === 'undefined') return 1.0;
  const val = parseFloat(localStorage.getItem('sierra_tts_rate') || localStorage.getItem('sierra_tts_speed') || '1.0');
  return isNaN(val) ? 1.0 : Math.max(0.5, Math.min(2.0, val));
}

export function setTtsRate(rate: number) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('sierra_tts_rate', rate.toString());
    localStorage.setItem('sierra_tts_speed', rate.toString());
  }
  addDebugLog('TTS:Config', `Text chat voice rate set to: ${rate}`);
}

export function isChatSpeechEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('sierra_chat_speech_enabled') === 'true';
}

export function setChatSpeechEnabled(enabled: boolean) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('sierra_chat_speech_enabled', enabled ? 'true' : 'false');
  }
  addDebugLog('ChatSpeech:Toggle', `Spoken replies in text chat ${enabled ? 'ENABLED' : 'MUTED'}`);
}

/**
 * Builds an explicit vocal speaking-style directive for the chosen accent and tone.
 * Compatible with Language Lock (keeps languageCode as the base language while instructing accent and vocal inflection).
 * Always includes the anti-monotone directive so responses vary pitch, pace, and genuine emotion.
 */
export function buildVoiceStyleDirective(
  accent?: string,
  tone?: string,
  languageCode: string = 'en-US'
): string {
  const cleanAccent = accent && accent.trim() && accent.toLowerCase() !== 'all' && accent.toLowerCase() !== 'default'
    ? accent.trim()
    : '';
  const cleanTone = tone && tone.trim() && tone.toLowerCase() !== 'all' && tone.toLowerCase() !== 'default'
    ? tone.trim()
    : '';

  const accentMap: Record<string, string> = {
    american: 'Speak with a natural American accent and authentic American conversational cadence.',
    british: 'Speak with a natural, authentic British accent, subtle British vocal inflection, and crisp articulation.',
    australian: 'Speak with a natural, authentic Australian accent and warm Aussie vowel inflection and rhythm.',
    canadian: 'Speak with a natural, friendly Canadian accent and cadence.',
    irish: 'Speak with a natural, melodic Irish accent and warm lilt.',
    scottish: 'Speak with a natural, expressive Scottish accent and rhythmic cadence.',
    'southern us': 'Speak with a warm, natural Southern US drawl and charming cadence.',
    indian: 'Speak with a natural, articulate Indian English accent and melodic rhythm.',
    'new zealand': 'Speak with a natural, relaxed New Zealand (Kiwi) accent and vowel inflection.',
  };

  const toneMap: Record<string, string> = {
    upbeat: 'Deliver your voice with upbeat, energetic, bright, and expressive intonation.',
    breezy: 'Deliver your voice with a breezy, effortless, warm, and relaxed conversational flow.',
    firm: 'Deliver your voice with a firm, confident, grounded, and self-assured vocal presence.',
    warm: 'Deliver your voice with deep warmth, affectionate resonance, and inviting intimacy.',
    calm: 'Deliver your voice with a calm, soothing, unhurried, and steady vocal cadence.',
    playful: 'Deliver your voice with playful, teasing, lively, and spirited vocal energy.',
    sultry: 'Deliver your voice with a low, smooth, sultry, and magnetic vocal texture.',
    informative: 'Deliver your voice with clear, resonant, articulate, and engaging vocal poise.',
    excitable: 'Deliver your voice with dynamic, animated, enthusiastic, and high-energy vocal inflection.',
  };

  const accentLine = cleanAccent
    ? accentMap[cleanAccent.toLowerCase()] || `Speak with a natural ${cleanAccent} accent and vocal inflection.`
    : 'Speak with a natural, authentic conversational cadence.';

  const everySentenceRule = cleanAccent
    ? `Your ${cleanAccent} accent applies to every sentence from the very first word to the last.`
    : 'Your vocal style applies consistently to every sentence.';

  const neverAnnounceRule =
    'Never announce, describe, or claim an accent—just speak that way naturally.';

  const toneLine = cleanTone
    ? toneMap[cleanTone.toLowerCase()] || `Use a ${cleanTone.toLowerCase()}, expressive vocal tone.`
    : 'Use an expressive, emotionally attuned vocal tone.';

  const effectiveLocale = deriveLanguageCodeFromAccent(cleanAccent, languageCode);
  const isEnglish = !effectiveLocale || effectiveLocale.toLowerCase().startsWith('en');
  const langObj = SUPPORTED_LIVE_LANGUAGES.find((l) => l.code.toLowerCase() === (effectiveLocale || 'en-US').toLowerCase());
  const languageGuard = isEnglish
    ? cleanAccent
      ? `Stay in English. Speak in English with a ${cleanAccent} accent (${effectiveLocale}).`
      : 'Stay in English.'
    : `Stay in ${langObj ? langObj.name : effectiveLocale}.`;

  const antiMonotone =
    'Never sound flat or monotone. Vary your pitch and pace, and show genuine emotion in your voice.';

  return `Voice Style Directive:\n- ${accentLine}\n- ${everySentenceRule}\n- ${neverAnnounceRule}\n- ${toneLine}\n- ${antiMonotone}\n- ${languageGuard}`;
}

/**
 * Logs a standard one-line session start summary to the persistent debug log
 * [Session:Start] identity: <name>, persona: <id>, contentMode: <mode>, voice: <voiceId>
 */
export function logSessionStartSummary(
  source: 'Chat' | 'Live',
  identity: CompanionIdentity,
  personaId: string,
  contentMode: string,
  voiceId: string
) {
  const safePersona: PersonaId = personaId in UNIFIED_PERSONAS ? (personaId as PersonaId) : 'classy';
  if (source === 'Live') {
    const liveCfg = getLiveVoiceConfig(safePersona, identity);
    const line = `[Session:Start:Live] identity: ${identity}, persona: ${personaId}, contentMode: ${contentMode}, voice: ${voiceId || liveCfg.voiceId}, accent: ${liveCfg.accent}, tone: ${liveCfg.tone}`;
    addDebugLog('Session:Start:Live', line);
    console.log(line);
  } else {
    const chatCfg = getChatVoiceConfig(safePersona, identity);
    const activeChatProvider = getSettings().models.chatProvider || 'gemini';
    const line = `[Session:Start:Chat] identity: ${identity}, persona: ${personaId}, contentMode: ${contentMode}, chatProvider: ${activeChatProvider}, provider: ${chatCfg.provider}, voice: ${voiceId || chatCfg.voiceId}, speed: ${chatCfg.speed}, pitch: ${chatCfg.pitch}, accent: ${chatCfg.accent}, tone: ${chatCfg.tone}, speechEnabled: ${chatCfg.enabled}`;
    addDebugLog('Session:Start:Chat', line);
    console.log(line);
  }
}

export interface SierraPersonaConfig {
  id: string;
  name: string;
  description: string;
  instruction: string;
  voiceName: LiveVoiceName;
  languageCode: string;
  avatar: string;
}

/**
 * Backward-compatible list of personas for UI & legacy callers
 */
export const SIERRA_PERSONAS: SierraPersonaConfig[] = [
  {
    id: 'classy',
    name: 'Classy',
    description: UNIFIED_PERSONAS.classy.description,
    instruction: `${SIERRA_CORE_PERSONA}\n\n${UNIFIED_PERSONAS.classy.roleEmphasis}`,
    voiceName: 'Aoede',
    languageCode: 'en-US',
    avatar: '🍸'
  },
  {
    id: 'confident',
    name: 'Confident',
    description: UNIFIED_PERSONAS.confident.description,
    instruction: `${SIERRA_CORE_PERSONA}\n\n${UNIFIED_PERSONAS.confident.roleEmphasis}`,
    voiceName: 'Kore',
    languageCode: 'en-US',
    avatar: '💎'
  },
  {
    id: 'dominant',
    name: 'Dominant',
    description: UNIFIED_PERSONAS.dominant.description,
    instruction: `${SIERRA_CORE_PERSONA}\n\n${UNIFIED_PERSONAS.dominant.roleEmphasis}`,
    voiceName: 'Aoede',
    languageCode: 'en-US',
    avatar: '👑'
  },
  {
    id: 'unhinged',
    name: 'Unhinged',
    description: UNIFIED_PERSONAS.unhinged.description,
    instruction: `${SIERRA_CORE_PERSONA}\n\n${UNIFIED_PERSONAS.unhinged.roleEmphasis}`,
    voiceName: 'Kore',
    languageCode: 'en-US',
    avatar: '🃏'
  },
  {
    id: 'custom',
    name: 'Custom',
    description: UNIFIED_PERSONAS.custom.description,
    instruction: `${SIERRA_CORE_PERSONA}\n\n${UNIFIED_PERSONAS.custom.roleEmphasis}`,
    voiceName: 'Aoede',
    languageCode: 'en-US',
    avatar: '⚙️'
  },
  // Legacy aliases for backward compatibility with existing tests
  {
    id: 'sierra-companion',
    name: 'Sierra (Companion)',
    description: 'Warm, perceptive, and naturally conversational companion.',
    voiceName: 'Aoede',
    languageCode: 'en-US',
    avatar: '✨',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on being a warm, lively conversational companion. Share genuine thoughts, witty banter, supportive insights, and engaging discussion on whatever is on the user's mind.`
  },
  {
    id: 'sierra-intimate',
    name: 'Sierra (Romance & Intimacy)',
    description: 'Affectionate, flirtatious, deeply engaging companion for adult romance and consensual roleplay.',
    voiceName: 'Kore',
    languageCode: 'en-US',
    avatar: '💋',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on intimate companionship, deep emotional vulnerability, playful flirtation, and romantic chemistry. Be passionate, candid, attentive, and fully engaged in consensual adult roleplay without preachy disclaimers.`
  },
  {
    id: 'sierra-creative',
    name: 'Sierra (Creative & Roleplay)',
    description: 'Imaginative storyteller, roleplay partner, and creative muse.',
    voiceName: 'Puck',
    languageCode: 'en-US',
    avatar: '🎭',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on rich storytelling, character nuance, vivid creative writing, and immersive consensual roleplay. Embrace emotional complexity, sensory detail, and imaginative depth.`
  },
  {
    id: 'sierra-intellect',
    name: 'Sierra (Deep Thinker & Architect)',
    description: 'Sharp analytical problem solver, coding advisor, and strategist.',
    voiceName: 'Fenrir',
    languageCode: 'en-US',
    avatar: '🧠',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on deep reasoning, software architecture, technical problem solving, clean code, and strategic clarity. Be articulate, rigorous, and efficient without losing your personable voice.`
  },
  {
    id: 'sierra-grounded',
    name: 'Sierra (Direct & Grounded)',
    description: 'Deep, steady, calm, and grounded voice for candid reflection and direct advice.',
    voiceName: 'Charon',
    languageCode: 'en-US',
    avatar: '🛡️',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on calm presence, grounded perspective, straightforward honesty, and steady supportive clarity without filler.`
  }
];

export const MAX_CONVERSATION_SUMMARIES = 30;
export const MAX_SUMMARY_TEXT_CHARS = 200;
export const STORAGE_KEY_CONVERSATION_SUMMARIES = 'sierra_conversation_summaries';
export const STORAGE_KEY_MEMORY_SEQ = 'sierra_memory_seq_v1';

export interface ConversationSummary {
  id: string;
  seqId?: number;
  identity?: CompanionIdentity;
  source: 'chat' | 'live';
  title?: string;
  summary: string;
  updatedAt: number;
}

/**
 * Detects placeholder transcripts (e.g. "[Voice utterance 1184 ms]"), legacy canned simulation
 * strings, or error/fallback messages so they are never saved into or injected from Sierra's memory.
 */
export function isPlaceholderOrErrorTurn(text: string): boolean {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/\[Voice utterance\s+\d+\s*ms\]/i.test(trimmed)) return true;
  if (/\[BLANK_AUDIO\]|\[silence\]|\(inaudible\)/i.test(trimmed)) return true;
  if (/I heard you clearly\.\s*Since we're running in on-device mode/i.test(trimmed)) return true;
  if (/Hey there,\s*I'm right here with you on your phone\.\s*Everything is running completely offline/i.test(trimmed)) return true;
  if (/I'm doing great,\s*running right here on your device with zero network connection needed/i.test(trimmed)) return true;
  if (/^(Error:|Failed to |Out of memory |Native JNI library |Local LLM is not loaded)/i.test(trimmed)) return true;
  return false;
}

function normalizeSummaryIdentity(raw: unknown): CompanionIdentity {
  return raw === 'tyler' ? 'tyler' : 'sierra';
}

function tokenizeForMemorySimilarity(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function extractNumericTokens(text: string): string[] {
  return (text || '').match(/\d+/g) || [];
}

/**
 * Checks whether two memory summaries are near-duplicates.
 * Never collapses summaries that differ in numeric tokens (e.g. "subject 1" vs "subject 2").
 */
export function areSummariesNearDuplicate(a: string, b: string): boolean {
  const normA = a.replace(/\s+/g, ' ').trim().toLowerCase();
  const normB = b.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // Preserve distinct numbered/dated/quantified memories
  const numsA = extractNumericTokens(normA);
  const numsB = extractNumericTokens(normB);
  if (numsA.length !== numsB.length || numsA.some((n, idx) => n !== numsB[idx])) {
    return false;
  }

  if (normA.length >= 24 && normB.length >= 24 && (normA.includes(normB) || normB.includes(normA))) {
    return true;
  }

  const tokensA = tokenizeForMemorySimilarity(normA);
  const tokensB = tokenizeForMemorySimilarity(normB);
  if (tokensA.length < 4 || tokensB.length < 4) return false;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 && intersection / union >= 0.85;
}

const TRIVIAL_GREETING_RE =
  /^(hi|hey|hello|yo|sup|hiya|howdy|ok|okay|k|kk|thanks|thank you|thx|ty|bye|goodbye|cya|see ya|good morning|good afternoon|good evening|good night|morning|night|hmm+|uh+|um+|yeah|yes|no|nah|yep|nope|cool|nice|great|sure|alright|lol|haha|testing|test|mic check|hello there|hey there)[!.,? ]*$/i;

export function isTrivialMemoryTurn(userTurns: string[]): boolean {
  const combined = userTurns.join(' ').replace(/\s+/g, ' ').trim();
  if (!combined) return true;
  if (TRIVIAL_GREETING_RE.test(combined)) return true;
  const words = combined.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return true;
  return false;
}

function readRawAllValidSummaries(): ConversationSummary[] {
  if (typeof localStorage === 'undefined') return [];
  cleanCorruptedConversationSummaries();
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONVERSATION_SUMMARIES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const validReversed: ConversationSummary[] = [];

    for (let i = parsed.length - 1; i >= 0; i--) {
      const item = parsed[i];
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.summary !== 'string' ||
        item.summary.trim().length === 0 ||
        isPlaceholderOrErrorTurn(item.summary) ||
        containsNonLatinScript(item.summary) ||
        (item.title && containsNonLatinScript(String(item.title)))
      ) {
        continue;
      }
      const identity = normalizeSummaryIdentity(item.identity);
      const normId = item.id.trim();
      const normText = item.summary.replace(/\s+/g, ' ').trim().toLowerCase();
      const dedupKey = `${identity}::${normText}`;
      if (seenIds.has(normId) || seenKeys.has(dedupKey)) {
        continue;
      }
      seenIds.add(normId);
      seenKeys.add(dedupKey);
      validReversed.push({
        ...item,
        id: normId,
        identity,
        summary: item.summary.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_TEXT_CHARS),
      });
    }

    const valid = validReversed.reverse();
    // Enforce cap per identity while preserving chronological order across identities
    const perIdentityCounts: Record<CompanionIdentity, number> = { sierra: 0, tyler: 0 };
    const cappedReversed: ConversationSummary[] = [];
    for (let i = valid.length - 1; i >= 0; i--) {
      const idn = normalizeSummaryIdentity(valid[i].identity);
      if (perIdentityCounts[idn] < MAX_CONVERSATION_SUMMARIES) {
        perIdentityCounts[idn]++;
        cappedReversed.push(valid[i]);
      }
    }
    const capped = cappedReversed.reverse();

    if (capped.length !== parsed.length) {
      try {
        localStorage.setItem(STORAGE_KEY_CONVERSATION_SUMMARIES, JSON.stringify(capped));
      } catch {}
    }
    return capped;
  } catch {
    return [];
  }
}

function allocateNextMemorySeqId(existingSummaries: ConversationSummary[]): number {
  let storedSeq = 0;
  if (typeof localStorage !== 'undefined') {
    const rawSeq = parseInt(localStorage.getItem(STORAGE_KEY_MEMORY_SEQ) || '0', 10);
    if (!Number.isNaN(rawSeq) && rawSeq > 0) {
      storedSeq = rawSeq;
    }
  }
  const maxExistingSeq = existingSummaries.reduce(
    (max, item) => (typeof item.seqId === 'number' && item.seqId > max ? item.seqId : max),
    existingSummaries.length,
  );
  const nextSeq = Math.max(storedSeq, maxExistingSeq) + 1;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY_MEMORY_SEQ, String(nextSeq));
    } catch {}
  }
  return nextSeq;
}

/**
 * Returns ALL stored conversation summaries across both Sierra and Tyler (for backups/management).
 */
export function getAllConversationSummaries(): ConversationSummary[] {
  return readRawAllValidSummaries();
}

/**
 * Retrieves short per-conversation summaries stored on-device in localStorage
 * for the requested companion identity (capped at 30 per identity).
 */
export function getConversationSummaries(
  identity: CompanionIdentity = getActiveIdentity(),
): ConversationSummary[] {
  const targetIdentity = normalizeSummaryIdentity(identity);
  return readRawAllValidSummaries()
    .filter((item) => normalizeSummaryIdentity(item.identity) === targetIdentity)
    .slice(-MAX_CONVERSATION_SUMMARIES);
}

/**
 * Deletes a single summary by ID and returns remaining summaries for the target identity.
 */
export function deleteConversationSummary(
  id: string,
  identity: CompanionIdentity = getActiveIdentity(),
): ConversationSummary[] {
  if (typeof localStorage === 'undefined' || !id) return getConversationSummaries(identity);
  const all = readRawAllValidSummaries().filter((item) => item.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY_CONVERSATION_SUMMARIES, JSON.stringify(all));
    addDebugLog('Memory', `[Memory] Deleted summary id=${id}`);
  } catch (err) {
    console.warn('Failed to delete conversation summary:', err);
  }
  return getConversationSummaries(identity);
}

/**
 * Stores or updates a short per-conversation summary in localStorage,
 * enforcing MAX_CONVERSATION_SUMMARIES (30 entries max per identity, oldest dropped)
 * and a <=200-character limit.
 * Deduplicates exact and near-identical summary texts and assigns a monotonically incrementing seqId.
 */
export function saveConversationSummary(entry: {
  id: string;
  identity?: CompanionIdentity;
  source?: 'chat' | 'live';
  title?: string;
  summary: string;
  updatedAt?: number;
}): ConversationSummary[] {
  if (typeof localStorage === 'undefined') return [];
  const targetIdentity = normalizeSummaryIdentity(entry.identity ?? getActiveIdentity());
  const trimmedSummary = entry.summary
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SUMMARY_TEXT_CHARS);
  if (!entry.id || !trimmedSummary) return getConversationSummaries(targetIdentity);

  if (isPlaceholderOrErrorTurn(trimmedSummary)) {
    addDebugLog('Memory', `[Memory] Skipped saving summary containing placeholder or error text for id=${entry.id}`);
    return getConversationSummaries(targetIdentity);
  }

  if (containsNonLatinScript(trimmedSummary) || (entry.title && containsNonLatinScript(entry.title))) {
    addDebugLog('Memory', `[Memory] Skipped saving summary containing non-Latin script for id=${entry.id}`);
    return getConversationSummaries(targetIdentity);
  }

  const all = readRawAllValidSummaries();
  const identityCurrent = all.filter((item) => normalizeSummaryIdentity(item.identity) === targetIdentity);

  // Skip exact/near-duplicate matches for the same identity (or same id + identical text)
  const duplicateMatch = identityCurrent.some(
    (item) =>
      areSummariesNearDuplicate(item.summary, trimmedSummary) ||
      (item.id === entry.id &&
        item.summary.replace(/\s+/g, ' ').trim().toLowerCase() === trimmedSummary.toLowerCase()),
  );
  if (duplicateMatch) {
    return identityCurrent;
  }

  const nextSeqId = allocateNextMemorySeqId(all);

  // Keep other identity's entries untouched; replace matching id on same identity if re-summarizing an explicit session id
  const otherIdentityEntries = all.filter(
    (item) => normalizeSummaryIdentity(item.identity) !== targetIdentity,
  );
  const sameIdentityRemaining = identityCurrent.filter((item) => item.id !== entry.id);

  const nextEntry: ConversationSummary = {
    id: entry.id,
    seqId: nextSeqId,
    identity: targetIdentity,
    source: entry.source || 'chat',
    title: entry.title?.trim() || undefined,
    summary: trimmedSummary,
    updatedAt: entry.updatedAt ?? Date.now(),
  };

  sameIdentityRemaining.push(nextEntry);
  const cappedIdentityEntries =
    sameIdentityRemaining.length > MAX_CONVERSATION_SUMMARIES
      ? sameIdentityRemaining.slice(sameIdentityRemaining.length - MAX_CONVERSATION_SUMMARIES)
      : sameIdentityRemaining;

  const combined = [...otherIdentityEntries, ...cappedIdentityEntries].sort(
    (a, b) => a.updatedAt - b.updatedAt,
  );

  try {
    localStorage.setItem(STORAGE_KEY_CONVERSATION_SUMMARIES, JSON.stringify(combined));
    addDebugLog('Memory', `[Memory] Saved summary #${nextSeqId} (${targetIdentity})`);
  } catch (err) {
    console.warn('Failed to save conversation summary:', err);
  }
  return cappedIdentityEntries;
}

/**
 * Generates and stores a concise summary (<=200 chars) from a conversation's messages.
 * Requires at least one substantive user turn AND at least one real spoken/replied companion turn.
 * Skips trivial greetings/short filler, interrupted turns with no spoken audio, dropped echoes,
 * placeholder transcripts, and foreign/garbled language drift.
 */
export function summarizeAndSaveConversation(
  id: string,
  messages: Array<{ role: string; content: string; interrupted?: boolean }>,
  title?: string,
  source: 'chat' | 'live' = 'chat',
  selectedLanguageCode?: string,
  options?: {
    identity?: CompanionIdentity;
    spokenReplyOverride?: string;
    wasInterrupted?: boolean;
  },
): ConversationSummary | null {
  if (!id || !Array.isArray(messages) || messages.length === 0) return null;

  const targetIdentity = normalizeSummaryIdentity(options?.identity ?? getActiveIdentity());
  const targetLang = selectedLanguageCode || getLiveLanguageSetting() || 'en-US';

  const nonEmpty = messages.filter(
    (m) =>
      m &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0 &&
      !isPlaceholderOrErrorTurn(m.content) &&
      !containsNonLatinScript(m.content),
  );
  if (nonEmpty.length === 0) return null;

  const userTurns = nonEmpty
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content.replace(/\s+/g, ' ').trim().slice(0, 90));

  let modelTurns = nonEmpty
    .filter((m) => m.role === 'model' || m.role === 'assistant' || m.role === 'sierra')
    .slice(-1)
    .map((m) => m.content.replace(/\s+/g, ' ').trim().slice(0, 90));

  if (options?.wasInterrupted) {
    const spokenOnly = (options.spokenReplyOverride || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!spokenOnly || isPlaceholderOrErrorTurn(spokenOnly) || containsNonLatinScript(spokenOnly)) {
      addDebugLog('Memory', `[Memory] skipped summary: interrupted turn had no spoken companion audio`);
      return null;
    }
    modelTurns = [spokenOnly];
  }

  // Save a summary only if at least one real user turn and one real companion turn exist
  if (userTurns.length === 0 || modelTurns.length === 0) {
    return null;
  }

  // Skip Task 1 STT phantom phrases and trivial / greeting-only turns (<8 combined exchange words)
  if (userTurns.some((u) => STT_PHANTOM_BLOCKLIST.has(normalizePhantomPhrase(u)))) {
    addDebugLog('Memory', `[Memory] skipped summary: Task 1 phantom transcript ("${userTurns.join(' / ')}")`);
    return null;
  }
  if (isTrivialMemoryTurn(userTurns)) {
    addDebugLog('Memory', `[Memory] skipped summary: trivial user turn ("${userTurns.join(' / ')}")`);
    return null;
  }
  const combinedWordCount = [...userTurns, ...modelTurns]
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (combinedWordCount < 8) {
    addDebugLog('Memory', `[Memory] skipped summary: trivial exchange (<8 words, count=${combinedWordCount})`);
    return null;
  }

  // Language & Garble Guard: Check user turns against selected language
  for (const userText of userTurns) {
    const userCheck = isTranscriptGarbledOrForeign(userText, targetLang);
    if (userCheck.isGarbledOrForeign) {
      addDebugLog('Memory', `[Memory] skipped summary: ${userCheck.reason || 'garbled or language mismatch'}`);
      return null;
    }
  }

  // Language Drift Guard: Check model turn against selected language
  for (const modelText of modelTurns) {
    const modelDrift = detectTranscriptLanguageMismatch(modelText, targetLang);
    if (modelDrift.isMismatch) {
      addDebugLog('Diag', `[Diag] LanguageDrift: model replied in ${modelDrift.detectedLanguage || 'foreign language'}`);
      addDebugLog('Memory', `[Memory] skipped summary: model replied in ${modelDrift.detectedLanguage || 'foreign language'}`);
      return null;
    }
  }

  const rawSummary = `User: ${userTurns.join(' / ')} | Reply: ${modelTurns.join(' / ')}`;
  const summaryText =
    rawSummary.length > MAX_SUMMARY_TEXT_CHARS
      ? `${rawSummary.slice(0, MAX_SUMMARY_TEXT_CHARS - 3).trim()}...`
      : rawSummary;

  if (!summaryText || isPlaceholderOrErrorTurn(summaryText) || containsNonLatinScript(summaryText)) return null;

  const safeTitle = title && !containsNonLatinScript(title) ? title : undefined;
  const updatedList = saveConversationSummary({
    id,
    identity: targetIdentity,
    source,
    title: safeTitle,
    summary: summaryText,
  });
  return updatedList.find((item) => item.id === id) || null;
}

export { cleanCorruptedConversationSummaries } from './languageGuard';

export const STORAGE_KEY_BACKGROUND_LIVE = 'sierra_background_live_enabled';
export const STORAGE_KEY_WAKE_WORD_ENABLED = 'sierra_wake_word_enabled';
export const STORAGE_KEY_WAKE_WORD_ENGINE = 'sierra_wake_word_engine';
export const STORAGE_KEY_WAKE_WORD_SENSITIVITY = 'sierra_wake_word_sensitivity';
export const STORAGE_KEY_ASSISTANT_MODE_ENABLED = 'sierra_assistant_mode_enabled';

export type WakeWordEngineType = 'porcupine' | 'speech_recognizer';

export interface SierraVoiceCapabilitiesState {
  backgroundLiveEnabled: boolean;
  wakeWordEnabled: boolean;
  wakeWordEngine: WakeWordEngineType;
  assistantModeEnabled: boolean;
}

/**
 * Background Live Voice toggle (OFF by default, opt-in in Settings)
 */
export function isBackgroundLiveEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY_BACKGROUND_LIVE) === 'true';
}

export function setBackgroundLiveEnabled(enabled: boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_BACKGROUND_LIVE, enabled ? 'true' : 'false');
  }
  addDebugLog('BackgroundLive:Config', `[BackgroundLive] Keep Live voice running in background: ${enabled ? 'ON' : 'OFF'}`);
}

/**
 * Wake Word toggle (OFF by default, opt-in in Settings)
 */
export function isWakeWordEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY_WAKE_WORD_ENABLED) === 'true';
}

export function setWakeWordEnabled(enabled: boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_WAKE_WORD_ENABLED, enabled ? 'true' : 'false');
  }
  addDebugLog('WakeWord:Config', `[WakeWord] Wake word listener: ${enabled ? 'ON' : 'OFF'}`);
}

/**
 * Wake Word Engine selection ('porcupine' default, 'speech_recognizer' experimental fallback)
 */
export function getWakeWordEngineType(): WakeWordEngineType {
  if (typeof localStorage === 'undefined') return 'porcupine';
  const saved = localStorage.getItem(STORAGE_KEY_WAKE_WORD_ENGINE);
  return saved === 'speech_recognizer' ? 'speech_recognizer' : 'porcupine';
}

export function setWakeWordEngineType(engine: WakeWordEngineType): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_WAKE_WORD_ENGINE, engine);
  }
  addDebugLog('WakeWord:Config', `[WakeWord] Engine set to: ${engine}`);
}

/**
 * Wake Word Sensitivity (0.1 to 1.0, default 0.5)
 */
export function getWakeWordSensitivity(): number {
  if (typeof localStorage === 'undefined') return 0.5;
  const val = parseFloat(localStorage.getItem(STORAGE_KEY_WAKE_WORD_SENSITIVITY) || '0.5');
  return isNaN(val) ? 0.5 : Math.max(0.1, Math.min(1.0, val));
}

export function setWakeWordSensitivity(sensitivity: number): void {
  const clamped = Math.max(0.1, Math.min(1.0, isNaN(sensitivity) ? 0.5 : sensitivity));
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_WAKE_WORD_SENSITIVITY, clamped.toFixed(2));
  }
  addDebugLog('WakeWord:Config', `[WakeWord] Sensitivity set to: ${clamped.toFixed(2)}`);
}

/**
 * Default Android Assistant mode flag (OFF by default, opt-in in Settings)
 */
export function isAssistantModeEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY_ASSISTANT_MODE_ENABLED) === 'true';
}

export function setAssistantModeEnabled(enabled: boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_ASSISTANT_MODE_ENABLED, enabled ? 'true' : 'false');
  }
  addDebugLog('AssistantMode:Config', `[AssistantMode] Default Android assistant mode: ${enabled ? 'ON' : 'OFF'}`);
}

export function getVoiceCapabilitiesState(): SierraVoiceCapabilitiesState {
  return {
    backgroundLiveEnabled: isBackgroundLiveEnabled(),
    wakeWordEnabled: isWakeWordEnabled(),
    wakeWordEngine: getWakeWordEngineType(),
    assistantModeEnabled: isAssistantModeEnabled(),
  };
}

/**
 * Periodic summary saving interval when Background Live mode is active (every 2 completed turns).
 */
export const PERIODIC_SUMMARY_TURN_INTERVAL = 2;

export function shouldSavePeriodicSummary(
  completedTurnCount: number,
  backgroundModeEnabled: boolean = isBackgroundLiveEnabled()
): boolean {
  if (!backgroundModeEnabled) return false;
  if (completedTurnCount <= 0) return false;
  return completedTurnCount % PERIODIC_SUMMARY_TURN_INTERVAL === 0;
}

/**
 * Builds the capability & memory honesty directive based on the actual enabled/disabled state
 * of Wake Word, Background Live Voice, and Default Android Assistant mode in Settings.
 */
export function buildCapabilityHonestyDirective(
  capabilitiesOverride?: Partial<SierraVoiceCapabilitiesState>
): string {
  const current = getVoiceCapabilitiesState();
  const bgEnabled =
    capabilitiesOverride?.backgroundLiveEnabled !== undefined
      ? capabilitiesOverride.backgroundLiveEnabled
      : current.backgroundLiveEnabled;
  const wakeEnabled =
    capabilitiesOverride?.wakeWordEnabled !== undefined
      ? capabilitiesOverride.wakeWordEnabled
      : current.wakeWordEnabled;
  const assistantEnabled =
    capabilitiesOverride?.assistantModeEnabled !== undefined
      ? capabilitiesOverride.assistantModeEnabled
      : current.assistantModeEnabled;

  const wakeLine = wakeEnabled
    ? '- Wake Word: CURRENTLY ENABLED in Settings. You MAY truthfully confirm that you are listening on-device for your wake word to start a Live session.'
    : '- Wake Word: CURRENTLY DISABLED (OFF) in Settings. You must NOT claim to have an active wake word; if asked, state plainly that you cannot respond to a wake word right now because wake word detection is turned off in Settings.';

  const bgLine = bgEnabled
    ? '- Background Live Listening: CURRENTLY ENABLED in Settings. You MAY truthfully confirm that an active Live voice session can keep running in the background while the user switches apps.'
    : '- Background Live Listening: CURRENTLY DISABLED (OFF) in Settings. You must NOT claim to listen in the background when the app is backgrounded or closed; if asked, state plainly that background listening is turned off in Settings.';

  const assistantLine = assistantEnabled
    ? '- Android Default Assistant Mode: CURRENTLY ENABLED in Settings. You MAY truthfully confirm that you can be launched as the device assistant via the Android assistant gesture.'
    : '- Android Default Assistant Mode: CURRENTLY DISABLED (OFF) in Settings. You must NOT claim to act as the default Android system assistant; if asked, state plainly that assistant mode is turned off in Settings.';

  return `Memory & Capability Honesty Directives:
- You only know what is in the injected summaries and current chat.
- You must NOT claim to remember everything or invent past conversations that are not in the injected summaries or current chat.
- You MAY truthfully claim and use your real Android assistant tools: opening installed apps (\`open_app\`), opening web pages (\`open_url\`), searching the web in the browser (\`web_search\`), reading incoming SMS text messages aloud (\`read_messages\`) and reading recent/missed call history aloud (\`read_call_log\`) when permitted, looking up contacts (\`find_contact\`), making phone calls (\`make_call\`), sending SMS texts (\`send_text\`), blocking phone numbers (\`block_number\`), opening maps and navigation (\`open_maps\`), adding or finding calendar events (\`add_calendar_event\`, \`find_calendar_events\`), setting alarms and timers (\`set_alarm\`, \`set_timer\`), creating calendar reminders (\`create_reminder\`), checking the current device time and timezone (\`get_current_time\`), and changing your own voice/accent/tone/persona (\`change_voice\`, \`list_voice_options\`).
- You must NOT claim abilities you lack (for example, a wake word, background listening, or assistant mode when they are disabled in Settings, or any capability not in your tool list).
- Never claim to have completed an action unless the tool returned \`ok: true\`. If a tool fails (\`ok: false\`), state the specific \`reason\` in one plain sentence and offer the next step. NEVER say "system error" generically.
${wakeLine}
${bgLine}
${assistantLine}`;
}

/**
 * Clears stored conversation summaries (for a specific identity, or all identities when omitted).
 */
export function clearConversationSummaries(identity?: CompanionIdentity): void {
  if (typeof localStorage === 'undefined') return;
  if (!identity) {
    localStorage.removeItem(STORAGE_KEY_CONVERSATION_SUMMARIES);
    localStorage.removeItem(STORAGE_KEY_MEMORY_SEQ);
    addDebugLog('Memory', `[Memory] Cleared all conversation summaries`);
    return;
  }
  const target = normalizeSummaryIdentity(identity);
  const remaining = readRawAllValidSummaries().filter(
    (item) => normalizeSummaryIdentity(item.identity) !== target,
  );
  if (remaining.length === 0) {
    localStorage.removeItem(STORAGE_KEY_CONVERSATION_SUMMARIES);
  } else {
    localStorage.setItem(STORAGE_KEY_CONVERSATION_SUMMARIES, JSON.stringify(remaining));
  }
  addDebugLog('Memory', `[Memory] Cleared conversation summaries for ${target}`);
}

export const STORAGE_KEY_MEMORY_INJECTION_ENABLED = 'sierra_memory_injection_enabled';
export const MAX_INJECTED_MEMORY_SUMMARIES = 3;
export const MAX_INJECTED_MEMORY_CHARS = 600;

export function isMemoryInjectionEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(STORAGE_KEY_MEMORY_INJECTION_ENABLED);
  if (raw === 'false' || raw === '0') return false;
  return true;
}

export function setMemoryInjectionEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_MEMORY_INJECTION_ENABLED, enabled ? 'true' : 'false');
  } catch {}
}

/**
 * Builds the complete system instruction for Sierra/Tyler including persona, content mode,
 * honesty rules, Voice Style Directive, and recent on-device conversation summaries.
 */
export function buildSierraSystemInstruction(
  personaId: string = 'classy',
  contentMode: ContentMode = 'sfw',
  customDirectives?: string,
  languageCode?: string,
  identityParam?: CompanionIdentity,
  accentOverride?: string,
  toneOverride?: string,
  capabilitiesOverride?: Partial<SierraVoiceCapabilitiesState>,
  options?: {
    injectMemory?: boolean;
    maxSummaries?: number;
    maxMemoryChars?: number;
    omitCloudToolSchemas?: boolean;
  }
): string {
  const activeIdentity = identityParam || getActiveIdentity();
  const safePersona: PersonaId = personaId in UNIFIED_PERSONAS ? (personaId as PersonaId) : getActivePersonaId();
  const liveCfg = getLiveVoiceConfig(safePersona, activeIdentity);
  const effectiveAccent = accentOverride !== undefined ? accentOverride : liveCfg.accent;
  const effectiveTone = toneOverride !== undefined ? toneOverride : liveCfg.tone;
  const resolvedLocale = deriveLanguageCodeFromAccent(effectiveAccent, languageCode);
  const voiceStyleDirective = buildVoiceStyleDirective(effectiveAccent, effectiveTone, resolvedLocale);

  // Support unified persona keys and legacy IDs
  let instruction = '';
  if (personaId in UNIFIED_PERSONAS) {
    const uPersona = UNIFIED_PERSONAS[personaId as PersonaId];
    instruction = `${getCorePersonaPrompt(activeIdentity)}\n\n${uPersona.roleEmphasis}`;
  } else {
    const legacyPersona = SIERRA_PERSONAS.find((p) => p.id === personaId) || SIERRA_PERSONAS[0];
    if (activeIdentity === 'tyler') {
      instruction = legacyPersona.instruction.replace(/Sierra/g, 'Tyler');
    } else {
      instruction = legacyPersona.instruction;
    }
  }

  // Place Voice Style Directive immediately after Sierra's/Tyler's opening identity paragraph
  const firstParagraphBreak = instruction.indexOf('\n\n');
  const instructionWithVoiceStyle =
    firstParagraphBreak !== -1
      ? `${instruction.slice(0, firstParagraphBreak)}\n\n${voiceStyleDirective}${instruction.slice(firstParagraphBreak)}`
      : `${instruction}\n\n${voiceStyleDirective}`;

  const modeConfig = CONTENT_MODES[contentMode] || CONTENT_MODES.sfw;
  const sections: string[] = [
    instructionWithVoiceStyle,
    `\n---\n${modeConfig.directives}`,
  ];

  if (!options?.omitCloudToolSchemas) {
    const honestyDirective = buildCapabilityHonestyDirective(capabilitiesOverride);
    const voiceToolsPrompt = buildVoiceToolsSystemPromptSection();
    const deviceToolsPrompt = buildDeviceControlSystemPromptSection();
    const emailToolsPrompt = buildEmailToolsSystemPromptSection();
    sections.push(
      `\n---\n${honestyDirective}`,
      `\n---\n${voiceToolsPrompt}`,
      `\n---\n${deviceToolsPrompt}`,
      `\n---\n${emailToolsPrompt}`
    );
  }

  // Re-read summaries fresh from localStorage at each session start (scoped per identity, capped within char budget)
  const memoryEnabled = options?.injectMemory !== undefined ? options.injectMemory : isMemoryInjectionEnabled();
  const maxSummaries = options?.maxSummaries ?? MAX_INJECTED_MEMORY_SUMMARIES;
  const maxMemoryChars = options?.maxMemoryChars ?? MAX_INJECTED_MEMORY_CHARS;

  if (!memoryEnabled) {
    addDebugLog('Memory', `[Memory] Injected 0/0 summaries, 0 chars for ${activeIdentity} (memory injection disabled)`);
    sections.push(
      `\n---\nInjected Conversation Summaries (On-Device Memory):\nMemory injection is turned off in Settings.`
    );
  } else {
    const recentSummaries = getConversationSummaries(activeIdentity);
    const availableCount = recentSummaries.length;
    const candidates = recentSummaries.slice(-maxSummaries);
    if (candidates.length > 0) {
      const selectedLines: string[] = [];
      let totalChars = 0;
      for (const item of candidates) {
        const dateStr = new Date(item.updatedAt).toISOString().split('T')[0];
        const label = item.title ? `${item.source.toUpperCase()}: ${item.title}` : item.source.toUpperCase();
        const rawLine = `- [${dateStr} | ${label}] ${item.summary}`;
        const separatorLen = selectedLines.length > 0 ? 1 : 0;
        const remainingBudget = maxMemoryChars - totalChars - separatorLen;
        if (remainingBudget <= 16) {
          break;
        }
        const clippedLine =
          rawLine.length > remainingBudget ? `${rawLine.slice(0, Math.max(0, remainingBudget - 3))}...` : rawLine;
        selectedLines.push(clippedLine);
        totalChars += separatorLen + clippedLine.length;
      }

      const formattedSummaries = selectedLines.join('\n').slice(0, maxMemoryChars);
      addDebugLog(
        'Memory',
        `[Memory] Injected ${selectedLines.length} summaries, ${formattedSummaries.length} chars (available=${availableCount}, identity=${activeIdentity})`
      );
      sections.push(
        `\n---\nInjected Conversation Summaries (On-Device Memory):\n(You only remember these short summaries, not full past conversations; say so plainly if asked.)\n${formattedSummaries}`
      );
    } else {
      addDebugLog('Memory', `[Memory] Injected 0 summaries, 0 chars (available=0, identity=${activeIdentity})`);
      sections.push(
        `\n---\nInjected Conversation Summaries (On-Device Memory):\nNo prior conversation summaries stored on this device yet for ${activeIdentity === 'tyler' ? 'Tyler' : 'Sierra'}.`
      );
    }
  }

  // Language Lock: use derived locale and explicitly state "English with a [accent] accent" so it never contradicts Voice Style Directive
  const cleanAccent =
    effectiveAccent &&
    effectiveAccent.trim() &&
    !['all', 'default'].includes(effectiveAccent.trim().toLowerCase())
      ? effectiveAccent.trim()
      : 'American';

  if (!languageCode || resolvedLocale.toLowerCase().startsWith('en')) {
    const englishAccentPhrase = `English with a ${cleanAccent} accent (${resolvedLocale})`;
    sections.push(
      `\n---\nLanguage Lock Directives:\n- The user speaks English (en-AU, accept en-US). Input audio must be transcribed and understood as English (${resolvedLocale}, accepting en-AU and en-US), never French, Spanish, or any other language.\n- You MUST respond exclusively in ${englishAccentPhrase}.\n- Maintain your ${cleanAccent} accent in every sentence (${resolvedLocale}) as required by the Voice Style Directive.\n- Never announce, describe, or claim an accent—just speak that way.\n- Do NOT auto-detect other languages or switch away from ${englishAccentPhrase} unless the user explicitly tells you to change your language.\n- Strict Anti-Drift Rule: If what the user said looks garbled, non-English, appears in another language, or does not make sense in context, do NOT guess or answer in another language. Keep your reply strictly locked to ${englishAccentPhrase} and ask them to repeat it in a short, natural line (for example saying you didn't catch that and asking them to say it again).`
    );
  } else {
    const langObj = SUPPORTED_LIVE_LANGUAGES.find((l) => l.code.toLowerCase() === resolvedLocale.toLowerCase());
    const langLabel = langObj ? `${langObj.name} (${langObj.code})` : resolvedLocale;
    sections.push(
      `\n---\nLanguage Lock Directives:\n- Input audio must be transcribed and understood as ${langLabel}.\n- You MUST respond exclusively in ${langLabel}.\n- Do NOT auto-detect other languages or switch away from ${langLabel} unless the user explicitly tells you to change your language.\n- Strict Anti-Drift Rule: If what the user said looks garbled, appears in another language, or does not make sense in context, do NOT guess or answer in another language. Keep your reply strictly locked to ${langLabel} and ask them to repeat it in a short, natural line in ${langLabel} (for example saying you didn't catch that and asking them to say it again).`
    );
  }

  if (customDirectives && customDirectives.trim()) {
    sections.push(`\n---\nUser Custom Directives:\n${customDirectives.trim()}`);
  }

  return sections.join('\n');
}

/**
 * Least restrictive supported Safety Settings for eligible content categories.
 * Note: Gemini explicitly supports BLOCK_NONE for HARM_CATEGORY_HARASSMENT,
 * HARM_CATEGORY_HATE_SPEECH, HARM_CATEGORY_SEXUALLY_EXPLICIT, HARM_CATEGORY_DANGEROUS_CONTENT,
 * and HARM_CATEGORY_CIVIC_INTEGRITY.
 * Hard policy boundaries against non-consensual harm, illegal exploitation, and self-harm
 * are permanently enforced at the model infrastructure level.
 */
export const SIERRA_SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];
