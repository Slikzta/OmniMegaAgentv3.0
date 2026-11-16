import { TextToSpeech, SpeechSynthesisVoice as CapVoice } from '@capacitor-community/text-to-speech';
import { Capacitor } from '@capacitor/core';
import { addDebugLog } from './debugLogStore';
import {
  CompanionIdentity,
  PersonaId,
  getActiveIdentity,
  getActivePersonaId,
  getVoiceForPersona,
  getChatVoiceConfig,
  getTtsPitch,
  getTtsRate,
  isChatSpeechEnabled,
  GEMINI_LIVE_VOICES,
  SUPPORTED_LIVE_VOICES,
  SierraVoiceProvider,
  VoiceOption,
  getAccentFromLocale,
  setCachedDeviceVoices,
  getCachedDeviceVoices,
  resolveClosestVoice,
  migrateLegacyVoiceSelections,
  getSelectedVoiceProvider,
  getOpenRouterApiKey,
  OPENROUTER_TTS_MODEL,
  OPENROUTER_TTS_DEFAULT_VOICE,
} from './persona';
import { getProviderHttpEndpoint } from './settingsStore';
import {
  getSierraLocalVoicePlugin,
  type LocalTtsEngine,
  type LocalTtsEngineId,
  type SynthesizedAudioChunk,
} from './localVoiceEngine';

let isSpeakingActive = false;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentAudioElement: HTMLAudioElement | null = null;
let activeAbortController: AbortController | null = null;
const activePrefetchControllers = new Set<AbortController>();
let playbackGenerationToken = 0;

export const OPENROUTER_HEYGEN_VOICE_MAP: Record<string, string> = {
  Aoede: OPENROUTER_TTS_DEFAULT_VOICE,
  Kore: OPENROUTER_TTS_DEFAULT_VOICE,
  Charon: OPENROUTER_TTS_DEFAULT_VOICE,
  Fenrir: OPENROUTER_TTS_DEFAULT_VOICE,
  Puck: OPENROUTER_TTS_DEFAULT_VOICE,
};

export interface EffectiveOpenRouterVoiceResolution {
  requestedVoice: string;
  effectiveVoice: string;
  accent: string;
  tone: string;
  presetRemapped: boolean;
  ignoredAccentOrTone: boolean;
  statusLabel: string;
}

/**
 * Resolves which voice OpenRouter HeyGen TTS actually uses and flags when a preset
 * voice/accent/tone is remapped or ignored by the remote endpoint.
 */
export function resolveOpenRouterTtsVoice(options: {
  requestedVoice?: string;
  accent?: string;
  tone?: string;
}): EffectiveOpenRouterVoiceResolution {
  const requested = (options.requestedVoice || '').trim() || OPENROUTER_TTS_DEFAULT_VOICE;
  const accent = (options.accent || 'Default').trim() || 'Default';
  const tone = (options.tone || 'Default').trim() || 'Default';

  const isGeminiPreset = SUPPORTED_LIVE_VOICES.includes(requested as any);
  const isDeviceTtsId = requested.startsWith('tts-');
  const effectiveVoice =
    isGeminiPreset || isDeviceTtsId
      ? OPENROUTER_HEYGEN_VOICE_MAP[requested] || OPENROUTER_TTS_DEFAULT_VOICE
      : requested;

  const presetRemapped = effectiveVoice.toLowerCase() !== requested.toLowerCase();
  const ignoredAccentOrTone =
    (accent.toLowerCase() !== 'default' && accent.toLowerCase() !== 'all') ||
    (tone.toLowerCase() !== 'default' && tone.toLowerCase() !== 'all');

  const statusLabel = presetRemapped
    ? `${effectiveVoice} (HeyGen default; ${requested} preset unused)`
    : effectiveVoice;

  return {
    requestedVoice: requested,
    effectiveVoice,
    accent,
    tone,
    presetRemapped,
    ignoredAccentOrTone,
    statusLabel,
  };
}

/**
 * Returns the concise human-readable effective voice label shown in the Live Voice status bar.
 */
export function getEffectiveLiveVoiceLabel(options: {
  liveProvider: 'gemini' | 'openrouter' | 'local';
  ttsProvider: 'native' | 'openrouter';
  requestedVoice: string;
  accent?: string;
  tone?: string;
}): { effectiveVoice: string; label: string; note?: string } {
  if (options.liveProvider === 'gemini') {
    const clean = options.requestedVoice || 'Aoede';
    return { effectiveVoice: clean, label: `Gemini · ${clean}` };
  }
  if (options.ttsProvider === 'openrouter') {
    const mapped = resolveOpenRouterTtsVoice({
      requestedVoice: options.requestedVoice,
      accent: options.accent,
      tone: options.tone,
    });
    return {
      effectiveVoice: mapped.effectiveVoice,
      label: `OpenRouter HeyGen · ${mapped.effectiveVoice}`,
      note: mapped.presetRemapped ? `${mapped.requestedVoice} preset unused by HeyGen` : undefined,
    };
  }
  const clean = options.requestedVoice || 'Default';
  return { effectiveVoice: clean, label: `Android TTS (${clean})` };
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

type SpeakingStatusListener = (isSpeaking: boolean) => void;
const speakingStatusListeners = new Set<SpeakingStatusListener>();

export function setSpeakingActiveState(active: boolean): void {
  isSpeakingActive = active;
  for (const listener of speakingStatusListeners) {
    try {
      listener(isSpeakingActive);
    } catch {
      // Ignore listener errors
    }
  }
}

export function subscribeSpeakingStatus(cb: SpeakingStatusListener): () => void {
  speakingStatusListeners.add(cb);
  try {
    cb(isSpeakingActive);
  } catch {
    // Ignore
  }
  return () => {
    speakingStatusListeners.delete(cb);
  };
}

// Raw device voice reference map for native index lookup
let rawNativeVoices: CapVoice[] = [];
let rawWebVoices: SpeechSynthesisVoice[] = [];

// Lazy probe cache: voiceId -> { ok, error, testedAt }
interface ProbeResult {
  ok: boolean;
  error?: string;
  testedAt: number;
}
const probeCache = new Map<string, ProbeResult>();

/**
 * Strips markdown and code blocks for clean, natural speech pronunciation.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return '';
  return text
    // Remove multi-line code blocks
    .replace(/```[\s\S]*?```/g, ' [code block omitted] ')
    // Remove inline code ticks
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images ![alt](url) -> ""
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // Remove markdown headings
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold and italic markers
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove bullet characters
    .replace(/^[-*+]\s+/gm, '')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts gender and tone ONLY when explicitly stated in voice metadata.
 * Never guesses from human names.
 */
function extractMetadataGenderAndTone(voice: any): { gender?: 'female' | 'male'; tone?: string } {
  let gender: 'female' | 'male' | undefined = undefined;
  let tone: string | undefined = undefined;

  // 1. Direct object property
  if (voice.gender === 'female' || voice.gender === 'male') {
    gender = voice.gender;
  }

  // 2. Explicit tokens in voiceURI or name (e.g. #female, gender=female, etc.)
  const rawMetadata = `${voice.voiceURI || ''} ${voice.name || ''}`.toLowerCase();
  if (rawMetadata.includes('gender=female') || rawMetadata.includes('gender:female') || rawMetadata.includes('#female')) {
    gender = 'female';
  } else if (rawMetadata.includes('gender=male') || rawMetadata.includes('gender:male') || rawMetadata.includes('#male')) {
    gender = 'male';
  }

  if (rawMetadata.includes('tone=warm') || rawMetadata.includes('tone:warm')) {
    tone = 'warm';
  } else if (rawMetadata.includes('tone=calm') || rawMetadata.includes('tone:calm')) {
    tone = 'calm';
  }

  return { gender, tone };
}

/**
 * Discovers real voices that actually exist on the device at runtime.
 * Calls TextToSpeech.getSupportedVoices() on native, window.speechSynthesis.getVoices() on web.
 */
export async function fetchAvailableDeviceVoices(): Promise<VoiceOption[]> {
  const discovered: VoiceOption[] = [];

  // 1. Check Native Capacitor TTS on Android / iOS
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await TextToSpeech.getSupportedVoices();
      if (res && Array.isArray(res.voices) && res.voices.length > 0) {
        rawNativeVoices = res.voices;
        res.voices.forEach((v, index) => {
          const { gender, tone } = extractMetadataGenderAndTone(v);
          const accent = getAccentFromLocale(v.lang);
          discovered.push({
            id: v.name || `native-voice-${index}`,
            name: v.name || `Device Voice ${index + 1}`,
            lang: v.lang,
            voiceURI: v.voiceURI,
            accent,
            gender,
            tone,
            isLiveVoice: false,
            description: accent ? `${accent} English` : v.lang,
          });
        });
        addDebugLog('TTS:VoiceDiscovery', `Discovered ${discovered.length} real native device voices.`);
      }
    } catch (err: any) {
      addDebugLog('TTS:VoiceDiscoveryError', `Failed to query native getSupportedVoices: ${err?.message || err}`);
    }
  }

  // 2. Web Speech API fallback or web desktop mode
  if (discovered.length === 0 && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      let webVoices = window.speechSynthesis.getVoices();
      if (webVoices.length === 0) {
        // Wait briefly for onvoiceschanged
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => resolve(), 300);
          window.speechSynthesis.onvoiceschanged = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        webVoices = window.speechSynthesis.getVoices();
      }

      rawWebVoices = webVoices;
      webVoices.forEach((v, index) => {
        const { gender, tone } = extractMetadataGenderAndTone(v);
        const accent = getAccentFromLocale(v.lang);
        discovered.push({
          id: v.voiceURI || v.name || `web-voice-${index}`,
          name: v.name || `System Voice ${index + 1}`,
          lang: v.lang,
          voiceURI: v.voiceURI,
          accent,
          gender,
          tone,
          isLiveVoice: false,
          description: accent ? `${accent} (${v.lang})` : v.lang,
        });
      });
      addDebugLog('TTS:VoiceDiscovery', `Discovered ${discovered.length} real Web Speech voices.`);
    } catch (err: any) {
      addDebugLog('TTS:VoiceDiscoveryError', `WebSpeech getVoices error: ${err?.message || err}`);
    }
  }

  // Update cached device voices
  setCachedDeviceVoices(discovered);

  // Migrate any old localStorage keys referencing mock IDs
  migrateLegacyVoiceSelections([...GEMINI_LIVE_VOICES, ...discovered]);

  return [...GEMINI_LIVE_VOICES, ...discovered];
}

/**
 * Lazy voice probe: tests voice only when selected or on Test Voice.
 * Cached to prevent repeated probes.
 */
export async function probeVoice(voice: VoiceOption): Promise<ProbeResult> {
  // If it's a Gemini Live prebuilt voice, it does not use on-device TTS synthesizer
  if (voice.isLiveVoice) {
    return { ok: true, testedAt: Date.now() };
  }

  // Check cache
  const cached = probeCache.get(voice.id);
  if (cached && Date.now() - cached.testedAt < 300000) { // 5-minute cache
    return cached;
  }

  const timeoutMs = 3500;
  let probeTimer: any;

  try {
    const probePromise = (async () => {
      if (Capacitor.isNativePlatform()) {
        const nativeIndex = rawNativeVoices.findIndex(
          (v) => v.name === voice.name || v.voiceURI === voice.voiceURI
        );
        await TextToSpeech.speak({
          text: 'Voice ready',
          lang: voice.lang,
          rate: 1.0,
          pitch: 1.0,
          volume: 0.05,
          voice: nativeIndex >= 0 ? nativeIndex : undefined,
          category: 'ambient',
        });
      } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        await new Promise<void>((resolve, reject) => {
          const u = new SpeechSynthesisUtterance('Voice ready');
          u.volume = 0.05;
          u.lang = voice.lang;
          const match = rawWebVoices.find(
            (wv) => wv.name === voice.name || wv.voiceURI === voice.voiceURI
          );
          if (match) u.voice = match;
          u.onend = () => resolve();
          u.onerror = (e) => reject(new Error(e.error || 'WebSpeech probe failed'));
          window.speechSynthesis.speak(u);
        });
      }
    })();

    const timeoutPromise = new Promise((_, reject) => {
      probeTimer = setTimeout(() => reject(new Error('Voice probe timed out')), timeoutMs);
    });

    await Promise.race([probePromise, timeoutPromise]);
    clearTimeout(probeTimer);
    await stopSpeaking();

    const result: ProbeResult = { ok: true, testedAt: Date.now() };
    probeCache.set(voice.id, result);
    voice.isUnavailable = false;
    voice.unavailableReason = undefined;
    addDebugLog('TTS:VoiceProbe', `Voice probe SUCCESS: "${voice.name}" (${voice.lang})`);
    return result;
  } catch (err: any) {
    clearTimeout(probeTimer);
    await stopSpeaking();
    const errMsg = err?.message || 'Playback failed';
    const result: ProbeResult = { ok: false, error: errMsg, testedAt: Date.now() };
    probeCache.set(voice.id, result);
    voice.isUnavailable = true;
    voice.unavailableReason = errMsg;
    addDebugLog('TTS:VoiceProbe', `Voice probe FAILED: "${voice.name}" (${voice.lang}) - ${errMsg}`);
    return result;
  }
}

/**
 * Stops any ongoing text-to-speech output (native AudioTrack, TextToSpeech, web speech, or OpenRouter audio),
 * aborts pending OpenRouter requests, clears the chunk queue, and increments playbackGenerationToken
 * so in-flight chunks never fall back to native TTS after an intentional stop or barge-in.
 */
export async function stopSpeaking(reason: string = 'Stopped'): Promise<void> {
  playbackGenerationToken += 1;
  const wasSpeaking =
    isSpeakingActive ||
    activeAbortController !== null ||
    activePrefetchControllers.size > 0 ||
    currentAudioElement !== null;
  setSpeakingActiveState(false);

  if (activeAbortController) {
    try {
      activeAbortController.abort();
    } catch {
      // Ignore abort errors
    }
    activeAbortController = null;
  }

  if (activePrefetchControllers.size > 0) {
    for (const ctrl of activePrefetchControllers) {
      try {
        ctrl.abort();
      } catch {
        // Ignore abort errors
      }
    }
    activePrefetchControllers.clear();
  }

  if (wasSpeaking || reason) {
    addDebugLog('TTS:Stop', `Stopped speech (reason: ${reason})`);
  }

  // Stop any active OpenRouter HTMLAudioElement
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
      currentAudioElement.src = '';
    } catch {}
    currentAudioElement = null;
  }

  // Web Speech API cancellation
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      currentUtterance = null;
    } catch {
      // Ignore
    }
  }

  // Capacitor Native AudioTrack + TextToSpeech stop
  if (Capacitor.isNativePlatform()) {
    try {
      const plugin = getSierraLocalVoicePlugin();
      await plugin.stopAudioPlayback?.().catch(() => {});
    } catch {}
    try {
      await TextToSpeech.stop();
    } catch (err: any) {
      addDebugLog('TTS:StopError', `Native TTS stop error: ${err?.message || err}`);
    }
  }
}

/**
 * Cleanly marks the end of a multi-sentence queued TTS turn without clearing audio playback early.
 */
export function endSpeakingTurn(): void {
  if (isSpeakingActive) {
    setSpeakingActiveState(false);
  }
}

/**
 * Splits long text into chunks of at most maxChars (default 250)
 * splitting cleanly at sentence boundaries (. ! ? \n), and merges tiny
 * chunks (< 25 chars) into adjacent chunks when they fit within maxChars.
 */
export function splitTextIntoSentenceChunks(
  text: string,
  maxChars: number = 250,
  minChunkChars: number = 25,
): string[] {
  if (!text || text.length <= maxChars) {
    return text ? [text] : [];
  }

  const rawChunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      rawChunks.push(remaining);
      break;
    }

    // Look for sentence boundary before maxChars
    const slice = remaining.slice(0, maxChars);
    let splitIdx = -1;

    // Look for sentence terminators followed by whitespace
    const sentenceDelims = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '\n\n', '\n'];
    for (const delim of sentenceDelims) {
      const idx = slice.lastIndexOf(delim);
      if (idx > splitIdx && idx > 20) {
        splitIdx = idx + delim.length;
      }
    }

    // Fall back to space boundary if no sentence terminator found
    if (splitIdx === -1) {
      splitIdx = slice.lastIndexOf(' ');
    }

    // Hard fallback if no whitespace found at all
    if (splitIdx <= 0) {
      splitIdx = maxChars;
    }

    rawChunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  const chunks = rawChunks.filter((c) => c.length > 0);
  if (chunks.length <= 1 || minChunkChars <= 0) {
    return chunks;
  }

  const merged: string[] = [];
  let i = 0;
  while (i < chunks.length) {
    const curr = chunks[i];
    if (curr.length < minChunkChars) {
      if (i + 1 < chunks.length && curr.length + 1 + chunks[i + 1].length <= maxChars) {
        chunks[i + 1] = `${curr} ${chunks[i + 1]}`;
        i += 1;
        continue;
      }
      if (merged.length > 0 && merged[merged.length - 1].length + 1 + curr.length <= maxChars) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${curr}`;
        i += 1;
        continue;
      }
    }
    merged.push(curr);
    i += 1;
  }

  return merged;
}

/**
 * Wraps raw 16-bit little-endian PCM audio bytes in a standard 44-byte RIFF/WAV header.
 * Defaults to 44.1 kHz mono 16-bit PCM (HeyGen Voice standard).
 * Trims any trailing odd byte to guarantee valid 16-bit sample boundaries.
 */
export function createWavFromPcm(
  pcmBytes: Uint8Array,
  sampleRate: number = 44100,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Blob {
  // If chunk has an odd byte count, trim the last byte
  const validPcmLength = pcmBytes.length % 2 === 0 ? pcmBytes.length : pcmBytes.length - 1;
  const pcmData = validPcmLength === pcmBytes.length ? pcmBytes : pcmBytes.subarray(0, validPcmLength);

  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // RIFF Chunk Descriptor
  // "RIFF"
  view.setUint8(0, 0x52);
  view.setUint8(1, 0x49);
  view.setUint8(2, 0x46);
  view.setUint8(3, 0x46);
  // ChunkSize: 36 + SubChunk2Size
  view.setUint32(4, 36 + validPcmLength, true);
  // "WAVE"
  view.setUint8(8, 0x57);
  view.setUint8(9, 0x41);
  view.setUint8(10, 0x56);
  view.setUint8(11, 0x45);

  // "fmt " sub-chunk
  view.setUint8(12, 0x66);
  view.setUint8(13, 0x6d);
  view.setUint8(14, 0x74);
  view.setUint8(15, 0x20);
  // Subchunk1Size: 16 for PCM
  view.setUint32(16, 16, true);
  // AudioFormat: 1 for PCM (uncompressed)
  view.setUint16(20, 1, true);
  // NumChannels: 1 (mono)
  view.setUint16(22, numChannels, true);
  // SampleRate: 44100
  view.setUint32(24, sampleRate, true);
  // ByteRate
  view.setUint32(28, byteRate, true);
  // BlockAlign
  view.setUint16(32, blockAlign, true);
  // BitsPerSample: 16
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  view.setUint8(36, 0x64);
  view.setUint8(37, 0x61);
  view.setUint8(38, 0x74);
  view.setUint8(39, 0x61);
  // Subchunk2Size: number of bytes in data
  view.setUint32(40, validPcmLength, true);

  return new Blob([wavHeader, pcmData], { type: 'audio/wav' });
}

/**
 * Helper to fetch a single audio chunk from OpenRouter as a WAV Blob.
 * Note: HeyGen Voice rejects the `speed` parameter with HTTP 400
 * ("speed is not supported by HeyGen Voice; omit it"), so `speed` is strictly omitted.
 */
async function fetchOpenRouterChunkWav(
  chunkText: string,
  apiKey: string,
  voice: string,
  signal: AbortSignal,
): Promise<{
  ok: boolean;
  wavBlob?: Blob;
  pcmBytes?: Uint8Array;
  aborted?: boolean;
  error?: string;
  latencyMs: number;
  bytes: number;
}> {
  const startTime = Date.now();
  const baseHttp = getProviderHttpEndpoint('openrouter').replace(/\/+$/, '');
  const resolvedEndpoint = `${baseHttp}/audio/speech`;
  addDebugLog('TTS:OpenRouter', `POST ${resolvedEndpoint} (model=${OPENROUTER_TTS_MODEL})`);
  try {
    const res = await fetch(resolvedEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Sierra',
      },
      body: JSON.stringify({
        model: OPENROUTER_TTS_MODEL,
        input: chunkText,
        voice,
        response_format: 'pcm',
      }),
      signal,
    });

    const latencyMs = Date.now() - startTime;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const statusMsg = res.status === 401
        ? `Invalid or unrecognized API key for OpenRouter (HTTP 401)`
        : `HTTP ${res.status}: ${errText.slice(0, 100)}`;
      return {
        ok: false,
        error: statusMsg,
        latencyMs,
        bytes: 0,
      };
    }

    const contentType = res.headers.get('content-type') || '';
    const arrayBuffer = await res.arrayBuffer();
    const rawBytes = arrayBuffer.byteLength;

    if (rawBytes === 0 || (contentType.includes('application/json') && !contentType.includes('audio') && !contentType.includes('octet-stream'))) {
      return {
        ok: false,
        error: `Non-audio response (${contentType})`,
        latencyMs,
        bytes: rawBytes,
      };
    }

    const pcmUint8 = new Uint8Array(arrayBuffer);
    const wavBlob = createWavFromPcm(pcmUint8, 44100, 1, 16);
    return {
      ok: true,
      wavBlob,
      pcmBytes: pcmUint8,
      latencyMs,
      bytes: rawBytes,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const isAborted = err?.name === 'AbortError' || signal.aborted;
    return {
      ok: false,
      aborted: isAborted,
      error: isAborted ? 'Request aborted/timeout' : (err?.message || 'Network error'),
      latencyMs,
      bytes: 0,
    };
  }
}

/**
 * Maps an accent chip label to a regional BCP-47 locale tag for Native TTS.
 */
export function mapAccentToLocale(accent?: string, fallbackLang = 'en-US'): string {
  const norm = (accent || '').trim().toLowerCase();
  if (!norm || norm === 'default') return fallbackLang;
  if (norm.includes('british') || norm.includes('scottish')) return 'en-GB';
  if (norm.includes('australian')) return 'en-AU';
  if (norm.includes('canadian')) return 'en-CA';
  if (norm.includes('irish')) return 'en-IE';
  if (norm.includes('indian')) return 'en-IN';
  if (norm.includes('new zealand')) return 'en-NZ';
  if (norm.includes('american') || norm.includes('southern')) return 'en-US';
  return fallbackLang;
}

/**
 * Computes effective rate, pitch, target locale, and distinct device voice match
 * so every selected voice, speed, pitch, accent, and tone in Chat Voice produces a distinct output.
 */
export function computeNativeVoiceParameters(options: {
  voiceId: string;
  identity: CompanionIdentity;
  personaId: PersonaId;
  pitch: number;
  rate: number;
  accent?: string;
  tone?: string;
  pool?: VoiceOption[];
}): {
  resolved: VoiceOption;
  targetLang: string;
  effectivePitch: number;
  effectiveRate: number;
  presetVariantIndex: number;
} {
  const {
    voiceId,
    identity,
    personaId,
    pitch,
    rate,
    accent = 'Default',
    tone = 'Default',
    pool = [],
  } = options;

  const allAvailable = [...GEMINI_LIVE_VOICES, ...pool];
  let resolved = resolveClosestVoice(voiceId, allAvailable, identity, personaId);

  // Signature pitch/rate shaping for the 5 preset voice archetypes when synthesized on Native TTS
  let pitchMultiplier = 1.0;
  let rateMultiplier = 1.0;
  let presetVariantIndex = 0;

  if (voiceId === 'Aoede') {
    pitchMultiplier = 1.08;
    rateMultiplier = 1.03;
    presetVariantIndex = 0;
  } else if (voiceId === 'Kore') {
    pitchMultiplier = 0.94;
    rateMultiplier = 0.97;
    presetVariantIndex = 1;
  } else if (voiceId === 'Charon') {
    pitchMultiplier = 0.85;
    rateMultiplier = 0.95;
    presetVariantIndex = 0;
  } else if (voiceId === 'Fenrir') {
    pitchMultiplier = 0.92;
    rateMultiplier = 1.08;
    presetVariantIndex = 1;
  } else if (voiceId === 'Puck') {
    pitchMultiplier = 1.05;
    rateMultiplier = 1.06;
    presetVariantIndex = 2;
  }

  // Apply optional tone modulation if a non-default tone is passed
  const normTone = (tone || '').trim().toLowerCase();
  if (normTone && normTone !== 'default') {
    if (normTone.includes('upbeat') || normTone.includes('playful')) {
      rateMultiplier *= 1.06;
      pitchMultiplier *= 1.05;
    } else if (normTone.includes('excitable')) {
      rateMultiplier *= 1.1;
      pitchMultiplier *= 1.08;
    } else if (normTone.includes('calm') || normTone.includes('informative')) {
      rateMultiplier *= 0.94;
      pitchMultiplier *= 0.96;
    } else if (normTone.includes('firm')) {
      rateMultiplier *= 0.98;
      pitchMultiplier *= 0.93;
    } else if (normTone.includes('sultry')) {
      rateMultiplier *= 0.91;
      pitchMultiplier *= 0.9;
    } else if (normTone.includes('breezy') || normTone.includes('warm')) {
      rateMultiplier *= 1.02;
      pitchMultiplier *= 1.03;
    }
  }

  const baseLang = resolved.lang || 'en-US';
  const targetLang = baseLang.toLowerCase().startsWith('en')
    ? mapAccentToLocale(accent, baseLang)
    : baseLang;

  // If the user picked one of the 5 preset names or an accent, try to match a real device voice from pool
  if (pool.length > 0 && !resolved.voiceURI) {
    const desiredGender = resolved.gender || (identity === 'tyler' ? 'male' : 'female');
    const localeCandidates = pool.filter(
      (v) => v.lang.toLowerCase() === targetLang.toLowerCase() && v.gender === desiredGender
    );
    const broadLocaleCandidates =
      localeCandidates.length > 0
        ? localeCandidates
        : pool.filter((v) => v.lang.toLowerCase() === targetLang.toLowerCase());
    if (broadLocaleCandidates.length > 0) {
      resolved = broadLocaleCandidates[presetVariantIndex % broadLocaleCandidates.length];
    }
  }

  const effectivePitch = Number(Math.max(0.5, Math.min(2.0, pitch * pitchMultiplier)).toFixed(2));
  const effectiveRate = Number(Math.max(0.5, Math.min(2.0, rate * rateMultiplier)).toFixed(2));

  return {
    resolved,
    targetLang,
    effectivePitch,
    effectiveRate,
    presetVariantIndex,
  };
}

/**
 * Plays an individual audio chunk: uses native Android AudioTrack (USAGE_VOICE_COMMUNICATION)
 * when running in Capacitor native so hardware AEC has a clean reference signal, and HTMLAudioElement on web.
 * Returns { interrupted: true } if stopped/barge-in aborted playback cleanly.
 */
async function playAudioChunkWithAecRouting(options: {
  wavBlob: Blob;
  pcmBytes?: Uint8Array;
  token: number;
  signal: AbortSignal;
  turnId?: number;
}): Promise<{ interrupted: boolean }> {
  const { wavBlob, pcmBytes, token, signal, turnId } = options;
  if (!isSpeakingActive || signal.aborted || token !== playbackGenerationToken) {
    return { interrupted: true };
  }

  // Prefer native AudioTrack with USAGE_VOICE_COMMUNICATION on Android
  if (Capacitor.isNativePlatform() && pcmBytes && pcmBytes.length > 0) {
    const plugin = getSierraLocalVoicePlugin();
    if (typeof plugin.playPcmAudio === 'function') {
      const validLength = pcmBytes.length % 2 === 0 ? pcmBytes.length : pcmBytes.length - 1;
      const sliced = validLength === pcmBytes.length ? pcmBytes : pcmBytes.subarray(0, validLength);
      const pcmBase64 = uint8ArrayToBase64(sliced);
      const res = await plugin.playPcmAudio({
        pcmBase64,
        sampleRate: 44100,
        turnId,
      });
      if (res?.interrupted || signal.aborted || token !== playbackGenerationToken) {
        return { interrupted: true };
      }
      if (!res?.ok) {
        throw new Error(res?.reason || 'Native AudioTrack playback failed');
      }
      return { interrupted: false };
    }
  }

  const audioUrl = URL.createObjectURL(wavBlob);
  try {
    await new Promise<void>((resolve, reject) => {
      if (!isSpeakingActive || signal.aborted || token !== playbackGenerationToken) {
        URL.revokeObjectURL(audioUrl);
        resolve();
        return;
      }
      const audio = new Audio(audioUrl);
      currentAudioElement = audio;

      const onAbort = () => {
        try {
          audio.pause();
          audio.src = '';
        } catch {}
        URL.revokeObjectURL(audioUrl);
        if (currentAudioElement === audio) currentAudioElement = null;
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });

      audio.onended = () => {
        signal.removeEventListener('abort', onAbort);
        URL.revokeObjectURL(audioUrl);
        if (currentAudioElement === audio) currentAudioElement = null;
        resolve();
      };

      audio.onerror = () => {
        signal.removeEventListener('abort', onAbort);
        URL.revokeObjectURL(audioUrl);
        if (currentAudioElement === audio) currentAudioElement = null;
        if (signal.aborted || token !== playbackGenerationToken || !isSpeakingActive) {
          resolve();
        } else {
          reject(new Error('Audio element playback failed'));
        }
      };

      audio.play().catch((playErr) => {
        signal.removeEventListener('abort', onAbort);
        URL.revokeObjectURL(audioUrl);
        if (currentAudioElement === audio) currentAudioElement = null;
        if (signal.aborted || token !== playbackGenerationToken || !isSpeakingActive) {
          resolve();
        } else {
          reject(playErr);
        }
      });
    });
  } catch (e) {
    URL.revokeObjectURL(audioUrl);
    currentAudioElement = null;
    if (signal.aborted || token !== playbackGenerationToken || !isSpeakingActive) {
      return { interrupted: true };
    }
    throw e;
  }

  if (signal.aborted || token !== playbackGenerationToken) {
    return { interrupted: true };
  }
  return { interrupted: false };
}

/**
 * Synthesizes and plays audio via OpenRouter Text-to-Speech API with chunked pipelined playback.
 * 1. Splits reply into 200-300 char sentence chunks.
 * 2. Fetches chunk 0 immediately (omitting `speed` so HeyGen Voice succeeds with 200 OK) and begins playback as soon as it arrives.
 * 3. Prefetches chunk N+1 in the background while chunk N is playing.
 * 4. Routes Android playback through native AudioTrack (`USAGE_VOICE_COMMUNICATION`) for hardware AEC reference.
 * 5. Never falls back to native TTS when interrupted via stopSpeaking / barge-in / abort.
 */
export interface OpenRouterTtsFetchedChunk {
  text: string;
  ok: boolean;
  wavBlob?: Blob;
  pcmBytes?: Uint8Array;
  aborted?: boolean;
  error?: string;
  latencyMs: number;
  bytes: number;
}

export interface OpenRouterPrefetchedAudio {
  chunks: OpenRouterTtsFetchedChunk[];
  voiceInfo: EffectiveOpenRouterVoiceResolution;
}

function createLinkedAbortController(externalSignal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  activePrefetchControllers.add(controller);

  const onExternalAbort = () => {
    try {
      controller.abort();
    } catch {}
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const cleanup = () => {
    activePrefetchControllers.delete(controller);
    if (externalSignal) {
      try {
        externalSignal.removeEventListener('abort', onExternalAbort);
      } catch {}
    }
  };

  return { controller, cleanup };
}

/**
 * Prefetches synthesized OpenRouter HeyGen WAV/PCM chunks without initiating playback.
 * Registered in activePrefetchControllers so stopSpeaking()/barge-in/tab-switch aborts immediately.
 */
export async function synthesizeOpenRouterTtsAudio(options: {
  text: string;
  voice?: string;
  accent?: string;
  tone?: string;
  signal?: AbortSignal;
}): Promise<OpenRouterPrefetchedAudio & { ok: boolean; aborted?: boolean; error?: string }> {
  const voiceInfo = resolveOpenRouterTtsVoice({
    requestedVoice: options.voice,
    accent: options.accent,
    tone: options.tone,
  });

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: 'OpenRouter API key missing',
      chunks: [],
      voiceInfo,
    };
  }

  const clean = cleanTextForSpeech(options.text);
  const textChunks = splitTextIntoSentenceChunks(clean, 250, 25);
  if (textChunks.length === 0) {
    return { ok: true, chunks: [], voiceInfo };
  }

  const { controller, cleanup } = createLinkedAbortController(options.signal);
  try {
    const results: OpenRouterTtsFetchedChunk[] = [];
    for (const chunkText of textChunks) {
      if (controller.signal.aborted) {
        return { ok: false, aborted: true, error: 'Request aborted', chunks: results, voiceInfo };
      }
      const res = await fetchOpenRouterChunkWav(
        chunkText,
        apiKey,
        voiceInfo.effectiveVoice,
        controller.signal,
      );
      results.push({ text: chunkText, ...res });
      if (res.aborted || controller.signal.aborted) {
        return { ok: false, aborted: true, error: 'Request aborted', chunks: results, voiceInfo };
      }
    }
    return {
      ok: results.some((r) => r.ok),
      chunks: results,
      voiceInfo,
    };
  } finally {
    cleanup();
  }
}

/**
 * Synthesizes and plays audio via OpenRouter Text-to-Speech API with chunked pipelined playback.
 * 1. Splits reply into 200-300 char sentence chunks.
 * 2. Fetches chunk 0 immediately (or uses prefetchedAudio) and begins playback as soon as it arrives.
 * 3. Prefetches chunk N+1 in the background while chunk N is playing.
 * 4. Routes Android playback through native AudioTrack (`USAGE_VOICE_COMMUNICATION`) for hardware AEC reference.
 * 5. Never falls back to native TTS when interrupted via stopSpeaking / barge-in / abort.
 */
export async function playOpenRouterTts(options: {
  text: string;
  voice?: string;
  accent?: string;
  tone?: string;
  speed?: number;
  turnId?: number;
  source: 'chat' | 'test';
  replyReceivedTime?: number;
  preserveQueue?: boolean;
  prefetchedAudio?: OpenRouterPrefetchedAudio;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; interrupted?: boolean; error?: string }> {
  const replyReceived = options.replyReceivedTime || Date.now();
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    addDebugLog('TTS:OpenRouter', `status: failed, bytes: 0, latency: 0ms, error: "OpenRouter API key missing"`);
    return { ok: false, error: 'OpenRouter API key missing' };
  }

  const clean = cleanTextForSpeech(options.text);
  if (!clean) return { ok: true };

  const prefetchedChunks =
    options.prefetchedAudio && options.prefetchedAudio.chunks.length > 0
      ? options.prefetchedAudio.chunks
      : undefined;
  const chunks = prefetchedChunks
    ? prefetchedChunks.map((c) => c.text)
    : splitTextIntoSentenceChunks(clean, 250, 25);
  if (chunks.length === 0) return { ok: true };

  const voiceInfo =
    options.prefetchedAudio?.voiceInfo ||
    resolveOpenRouterTtsVoice({
      requestedVoice: options.voice,
      accent: options.accent,
      tone: options.tone,
    });
  const voice = voiceInfo.effectiveVoice;

  if (!options.preserveQueue) {
    await stopSpeaking('New playback started');
  }
  const myToken = playbackGenerationToken;
  if (!isSpeakingActive) {
    setSpeakingActiveState(true);
  }

  const { controller, cleanup } = createLinkedAbortController(options.signal);
  activeAbortController = controller;

  let firstAudioStarted = false;
  let wasInterrupted = false;

  if (!options.preserveQueue) {
    addDebugLog(
      'TTS:OpenRouter',
      `[Config] model=${OPENROUTER_TTS_MODEL}, voice=${voice} (selected=${voiceInfo.requestedVoice}) (speed omitted for HeyGen TTS; applied only on native fallback)`,
    );
    if (voiceInfo.presetRemapped || voiceInfo.ignoredAccentOrTone) {
      addDebugLog(
        'TTS:VoiceMap',
        `[VoiceMap] OpenRouter HeyGen remapped requested="${voiceInfo.requestedVoice}" -> "${voice}" (accent="${voiceInfo.accent}" & tone="${voiceInfo.tone}" ignored by HeyGen TTS endpoint)`,
      );
    }
  }

  try {
    let nextChunkPromise: Promise<OpenRouterTtsFetchedChunk | { ok: boolean; wavBlob?: Blob; pcmBytes?: Uint8Array; aborted?: boolean; error?: string; latencyMs: number; bytes: number }> =
      prefetchedChunks?.[0]
        ? Promise.resolve(prefetchedChunks[0])
        : fetchOpenRouterChunkWav(chunks[0], apiKey, voice, controller.signal);

    for (let i = 0; i < chunks.length; i++) {
      if (!isSpeakingActive || controller.signal.aborted || myToken !== playbackGenerationToken) {
        wasInterrupted = true;
        break;
      }

      const currentResult = await nextChunkPromise;

      if (
        i + 1 < chunks.length &&
        isSpeakingActive &&
        !controller.signal.aborted &&
        myToken === playbackGenerationToken
      ) {
        nextChunkPromise = prefetchedChunks?.[i + 1]
          ? Promise.resolve(prefetchedChunks[i + 1])
          : fetchOpenRouterChunkWav(chunks[i + 1], apiKey, voice, controller.signal);
      }

      if (
        currentResult.aborted ||
        !isSpeakingActive ||
        controller.signal.aborted ||
        myToken !== playbackGenerationToken
      ) {
        wasInterrupted = true;
        break;
      }

      if (currentResult.ok && currentResult.wavBlob) {
        const timeToFirstAudio = !firstAudioStarted ? Date.now() - replyReceived : undefined;
        if (!firstAudioStarted) {
          firstAudioStarted = true;
          addDebugLog(
            'TTS:OpenRouter',
            `[Timing] reply-received to first-audio-start: ${timeToFirstAudio}ms | totalChunks: ${chunks.length}${prefetchedChunks ? ' (prefetched)' : ''}`,
          );
        }

        addDebugLog(
          'TTS:OpenRouter',
          `status: chunk_ok, chunk: ${i + 1}/${chunks.length}, reqLatency: ${currentResult.latencyMs}ms, bytes: ${currentResult.bytes}, playback: START`,
        );

        try {
          const playOutcome = await playAudioChunkWithAecRouting({
            wavBlob: currentResult.wavBlob,
            pcmBytes: currentResult.pcmBytes,
            token: myToken,
            signal: controller.signal,
            turnId: options.turnId,
          });
          if (playOutcome.interrupted || myToken !== playbackGenerationToken || controller.signal.aborted) {
            wasInterrupted = true;
            addDebugLog('TTS:OpenRouter', `status: interrupted, chunk: ${i + 1}/${chunks.length} (skipping fallback)`);
            break;
          }
          addDebugLog(
            'TTS:OpenRouter',
            `status: chunk_done, chunk: ${i + 1}/${chunks.length}, playback: END`,
          );
        } catch (playErr: any) {
          if (myToken !== playbackGenerationToken || controller.signal.aborted || !isSpeakingActive) {
            wasInterrupted = true;
            break;
          }
          addDebugLog(
            'TTS:OpenRouter',
            `status: playback_error, chunk: ${i + 1}/${chunks.length}, error: "${playErr?.message || playErr}", falling back to native TTS for chunk`,
          );
          const chatCfg = getChatVoiceConfig();
          await executeSpeechCore({
            text: chunks[i],
            voiceId: chatCfg.voiceId,
            identity: getActiveIdentity(),
            personaId: getActivePersonaId(),
            pitch: chatCfg.pitch,
            rate: options.speed ?? chatCfg.speed,
            accent: chatCfg.accent,
            tone: chatCfg.tone,
            source: options.source,
            preserveQueue: true,
          });
        }
      } else {
        if (
          currentResult.aborted ||
          myToken !== playbackGenerationToken ||
          controller.signal.aborted ||
          !isSpeakingActive
        ) {
          wasInterrupted = true;
          break;
        }
        addDebugLog(
          'TTS:OpenRouter',
          `status: chunk_error, chunk: ${i + 1}/${chunks.length}, reqLatency: ${currentResult.latencyMs}ms, error: "${currentResult.error}", falling back to native TTS for chunk`,
        );

        if (!firstAudioStarted) {
          firstAudioStarted = true;
          addDebugLog(
            'TTS:OpenRouter',
            `[Timing] reply-received to first-audio-start (fallback): ${Date.now() - replyReceived}ms`,
          );
        }

        const chatCfg = getChatVoiceConfig();
        await executeSpeechCore({
          text: chunks[i],
          voiceId: chatCfg.voiceId,
          identity: getActiveIdentity(),
          personaId: getActivePersonaId(),
          pitch: chatCfg.pitch,
          rate: options.speed ?? chatCfg.speed,
          accent: chatCfg.accent,
          tone: chatCfg.tone,
          source: options.source,
          preserveQueue: true,
        });
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || controller.signal.aborted || myToken !== playbackGenerationToken) {
      wasInterrupted = true;
    } else {
      addDebugLog('TTS:OpenRouter', `status: fatal_error, error: "${err?.message || err}"`);
    }
  } finally {
    cleanup();
    if (activeAbortController === controller) {
      activeAbortController = null;
    }
    if (!options.preserveQueue && myToken === playbackGenerationToken) {
      setSpeakingActiveState(false);
    }
  }

  return { ok: true, interrupted: wasInterrupted };
}

/**
 * Core unified speech execution function.
 * Both real replies and Test Voice preview MUST call this exact pipeline
 * to guarantee identical voice resolution, language code, pitch, and rate.
 */
async function executeSpeechCore(options: {
  text: string;
  voiceId: string;
  identity: CompanionIdentity;
  personaId: PersonaId;
  pitch: number;
  rate: number;
  accent?: string;
  tone?: string;
  source: 'chat' | 'test';
  preserveQueue?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const { text, voiceId, identity, personaId, pitch, rate, accent, tone, source } = options;

  const clean = cleanTextForSpeech(text);
  if (!clean || clean.length === 0) {
    return { ok: true };
  }

  // Ensure fresh voice catalog
  let pool = getCachedDeviceVoices();
  if (pool.length === 0) {
    pool = await fetchAvailableDeviceVoices();
  }

  // 1. Resolve requested voice, accent locale, and effective rate/pitch
  const { resolved, targetLang, effectivePitch, effectiveRate, presetVariantIndex } =
    computeNativeVoiceParameters({
      voiceId,
      identity,
      personaId,
      pitch,
      rate,
      accent,
      tone,
      pool,
    });

  addDebugLog(
    'TTS:Speak',
    `[${source.toUpperCase()}] Requested: "${voiceId}", Resolved: "${resolved.name}" (lang=${targetLang}, URI: ${resolved.voiceURI || 'none'}), Rate: ${effectiveRate} (base ${rate}), Pitch: ${effectivePitch} (base ${pitch}), Accent: ${accent || 'Default'}, Tone: ${tone || 'Default'}, Identity: ${identity}`
  );

  // Stop prior playback unless running as a per-chunk fallback inside an active queue
  if (!options.preserveQueue) {
    await stopSpeaking('Starting native TTS');
    setSpeakingActiveState(true);
  }

  // 2. Play via Native Capacitor TTS if on mobile
  if (Capacitor.isNativePlatform()) {
    try {
      // Find exact native voice index or locale match
      let nativeIndex: number | undefined = undefined;
      const exactIdx = rawNativeVoices.findIndex(
        (nv) => nv.name === resolved.name || (nv.voiceURI && nv.voiceURI === resolved.voiceURI)
      );
      if (exactIdx >= 0) {
        nativeIndex = exactIdx;
      } else if (rawNativeVoices.length > 0) {
        const langMatches = rawNativeVoices
          .map((nv, idx) => ({ nv, idx }))
          .filter(({ nv }) => String(nv.lang || '').toLowerCase() === targetLang.toLowerCase());
        if (langMatches.length > 0) {
          nativeIndex = langMatches[presetVariantIndex % langMatches.length].idx;
        }
      }

      await TextToSpeech.speak({
        text: clean,
        lang: targetLang,
        rate: effectiveRate,
        pitch: effectivePitch,
        volume: 1.0,
        voice: nativeIndex,
        category: 'ambient',
      });

      if (!options.preserveQueue) {
        setSpeakingActiveState(false);
      }
      addDebugLog('TTS:PlaybackResult', `Playback OK for "${resolved.name}" (${targetLang}) via Capacitor TTS`);
      return { ok: true };
    } catch (nativeErr: any) {
      const errMsg = nativeErr?.message || String(nativeErr);
      addDebugLog('TTS:PlaybackResult', `Capacitor TTS error: ${errMsg}. Attempting WebSpeech fallback.`);
      // Proceed to web fallback
    }
  }

  // 3. Web Speech API execution
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = effectiveRate;
      utterance.pitch = effectivePitch;
      utterance.lang = targetLang;

      // Match voice in window.speechSynthesis
      const webVoices = rawWebVoices.length > 0 ? rawWebVoices : window.speechSynthesis.getVoices();
      let matched = webVoices.find(
        (wv) => wv.name === resolved.name || (wv.voiceURI && wv.voiceURI === resolved.voiceURI)
      );
      if (!matched && webVoices.length > 0) {
        const localeVoices = webVoices.filter(
          (wv) => (wv.lang || '').toLowerCase() === targetLang.toLowerCase()
        );
        if (localeVoices.length > 0) {
          matched = localeVoices[presetVariantIndex % localeVoices.length];
        } else {
          const langPrefix = targetLang.split('-')[0].toLowerCase();
          const prefixVoices = webVoices.filter((wv) =>
            (wv.lang || '').toLowerCase().startsWith(langPrefix)
          );
          if (prefixVoices.length > 0) {
            matched = prefixVoices[presetVariantIndex % prefixVoices.length];
          }
        }
      }

      if (matched) {
        utterance.voice = matched;
      }

      await new Promise<void>((resolve, reject) => {
        utterance.onend = () => {
          if (!options.preserveQueue) {
            setSpeakingActiveState(false);
          }
          currentUtterance = null;
          addDebugLog('TTS:PlaybackResult', `Playback OK for "${resolved.name}" (${targetLang}) via WebSpeech`);
          resolve();
        };

        utterance.onerror = (e) => {
          if (!options.preserveQueue) {
            setSpeakingActiveState(false);
          }
          currentUtterance = null;
          if (e.error === 'interrupted' || e.error === 'canceled') {
            resolve();
          } else {
            addDebugLog('TTS:PlaybackResult', `WebSpeech ERROR for "${resolved.name}": ${e.error}`);
            reject(new Error(e.error));
          }
        };

        currentUtterance = utterance;
        window.speechSynthesis.speak(utterance);
      });

      return { ok: true };
    } catch (err: any) {
      if (!options.preserveQueue) {
        setSpeakingActiveState(false);
      }
      const errMsg = err?.message || 'Speech failed';
      addDebugLog('TTS:PlaybackResult', `Playback ERROR: ${errMsg}`);
      return { ok: false, error: errMsg };
    }
  }

  if (!options.preserveQueue) {
    setSpeakingActiveState(false);
  }
  addDebugLog('TTS:PlaybackResult', 'No TTS engine available on this environment');
  return { ok: false, error: 'No TTS engine available' };
}

/**
 * Speaks an assistant reply in text chat if speech is enabled.
 */
export async function speakTextChatReply(text: string): Promise<void> {
  const identity = getActiveIdentity();
  const personaId = getActivePersonaId();
  const chatCfg = getChatVoiceConfig(personaId, identity);

  if (!chatCfg.enabled && !isChatSpeechEnabled()) {
    return;
  }

  const voiceId = chatCfg.voiceId || getVoiceForPersona(personaId, identity);
  const pitch = chatCfg.pitch;
  const rate = chatCfg.speed;
  const provider = chatCfg.provider;

  // Log active voice config on each spoken chat reply (no API keys)
  addDebugLog(
    'TTS:Config',
    `[ChatVoice] identity=${identity}, persona=${personaId}, provider=${provider}, voice=${voiceId}, speed=${rate}, pitch=${pitch}, accent=${chatCfg.accent}, tone=${chatCfg.tone}`
  );

  // Route to OpenRouter Voice if chosen
  if (provider === 'openrouter') {
    const res = await playOpenRouterTts({
      text,
      voice: voiceId || OPENROUTER_TTS_DEFAULT_VOICE,
      accent: chatCfg.accent,
      tone: chatCfg.tone,
      speed: rate,
      source: 'chat',
      replyReceivedTime: Date.now(),
    });
    if (res.ok || res.interrupted) {
      return;
    }
    // Fall back to native on actual remote/playback failure (never on intentional stop)
    addDebugLog('TTS:OpenRouter', `Falling back to native TTS due to OpenRouter failure (${res.error})`);
  }

  await executeSpeechCore({
    text,
    voiceId,
    identity,
    personaId,
    pitch,
    rate,
    accent: chatCfg.accent,
    tone: chatCfg.tone,
    source: 'chat',
  });
}

/**
 * Speaks a single streamed sentence in Live mode (used by OpenRouter Live and Local Live)
 * using the currently selected voice provider (OpenRouter HeyGen if selected and keyed,
 * otherwise Android/Web TTS) while preserving the Live voice config (voice, accent, tone, speed, pitch).
 */
export async function speakLiveSentenceWithConfiguredProvider(options: {
  sentence: string;
  identity?: CompanionIdentity;
  personaId?: PersonaId;
  voiceId?: string;
  accent?: string;
  tone?: string;
  speed?: number;
  pitch?: number;
  turnId?: number;
  forceNativeTts?: boolean;
  preserveQueue?: boolean;
  prefetchedOpenRouterAudio?: OpenRouterPrefetchedAudio;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; interrupted?: boolean; providerUsed: 'openrouter' | 'native'; error?: string }> {
  const identity = options.identity || getActiveIdentity();
  const personaId = options.personaId || getActivePersonaId();
  const chatCfg = getChatVoiceConfig(personaId, identity);
  const voiceId = options.voiceId || chatCfg.voiceId || getVoiceForPersona(personaId, identity);
  const speed = options.speed ?? chatCfg.speed ?? getTtsRate();
  const pitch = options.pitch ?? chatCfg.pitch ?? getTtsPitch();
  const accent = options.accent || chatCfg.accent || 'Default';
  const tone = options.tone || chatCfg.tone || 'Default';

  const selectedProvider = getSelectedVoiceProvider();
  const apiKey = getOpenRouterApiKey();
  const useOpenRouterHeyGen =
    !options.forceNativeTts && selectedProvider === 'openrouter' && Boolean(apiKey);

  if (useOpenRouterHeyGen) {
    const res = await playOpenRouterTts({
      text: options.sentence,
      voice: voiceId || OPENROUTER_TTS_DEFAULT_VOICE,
      accent,
      tone,
      speed,
      turnId: options.turnId,
      source: 'chat',
      replyReceivedTime: Date.now(),
      preserveQueue: options.preserveQueue,
      prefetchedAudio: options.prefetchedOpenRouterAudio,
      signal: options.signal,
    });
    if (res.interrupted) {
      return { ok: true, interrupted: true, providerUsed: 'openrouter' };
    }
    if (res.ok) {
      return { ok: true, providerUsed: 'openrouter' };
    }
    addDebugLog(
      'TTS:OpenRouter',
      `Live sentence OpenRouter HeyGen TTS failed (${res.error}); falling back to Android TTS`,
    );
  }

  const startToken = playbackGenerationToken;
  if (!isSpeakingActive) {
    setSpeakingActiveState(true);
  }
  const nativeRes = await executeSpeechCore({
    text: options.sentence,
    voiceId,
    identity,
    personaId,
    pitch,
    rate: speed,
    accent,
    tone,
    source: 'chat',
    preserveQueue: true,
  });
  if (!options.preserveQueue && startToken === playbackGenerationToken) {
    setSpeakingActiveState(false);
  }
  return {
    ok: nativeRes.ok,
    interrupted: startToken !== playbackGenerationToken || Boolean(options.signal?.aborted),
    providerUsed: 'native',
    error: nativeRes.error,
  };
}

/**
 * Prefetching LocalTtsEngine implementation for OpenRouter HeyGen Live TTS.
 * Used with LocalTtsQueueCoordinator (max 2 in flight) so sentence N+1 fetches
 * while sentence N plays, eliminating multi-second gaps between sentences.
 */
export class OpenRouterLiveTtsEngine implements LocalTtsEngine {
  public readonly id: LocalTtsEngineId = 'android_tts';
  private readonly getVoiceOptions: () => {
    voiceId?: string;
    accent?: string;
    tone?: string;
  };

  constructor(options?: {
    getVoiceOptions?: () => { voiceId?: string; accent?: string; tone?: string };
  }) {
    this.getVoiceOptions =
      options?.getVoiceOptions ||
      (() => {
        const cfg = getChatVoiceConfig();
        return { voiceId: cfg.voiceId, accent: cfg.accent, tone: cfg.tone };
      });
  }

  public async isAvailable(): Promise<boolean> {
    return getSelectedVoiceProvider() === 'openrouter' && Boolean(getOpenRouterApiKey());
  }

  public async synthesizeSentence(sentence: string, signal?: AbortSignal): Promise<SynthesizedAudioChunk> {
    if (signal?.aborted) {
      return { sentence, sampleRate: 22050 };
    }
    if (getSelectedVoiceProvider() !== 'openrouter' || !getOpenRouterApiKey()) {
      return { sentence, sampleRate: 22050 };
    }
    const vOpts = this.getVoiceOptions();
    const prefetched = await synthesizeOpenRouterTtsAudio({
      text: sentence,
      voice: vOpts.voiceId,
      accent: vOpts.accent,
      tone: vOpts.tone,
      signal,
    });
    return {
      sentence,
      sampleRate: 44100,
      payload: {
        chunks: prefetched.chunks,
        voiceInfo: prefetched.voiceInfo,
      } satisfies OpenRouterPrefetchedAudio,
    };
  }

  public async stop(): Promise<void> {
    await stopSpeaking('queue_stop');
  }
}

export interface TestVoicePlaybackOptions {
  provider?: SierraVoiceProvider;
  speed?: number;
  pitch?: number;
  accent?: string;
  tone?: string;
}

let lastTestVoiceInvocation: {
  voiceId: string;
  provider: SierraVoiceProvider;
  speed: number;
  pitch: number;
  accent: string;
  tone: string;
  targetLang: string;
  effectivePitch: number;
  effectiveRate: number;
} | null = null;

export function getLastTestVoiceInvocation() {
  return lastTestVoiceInvocation;
}

/**
 * Test Voice preview: uses the selected provider, voice, speed, pitch, accent, and tone.
 */
export async function testVoicePlayback(
  voiceId: string,
  text: string,
  identity: CompanionIdentity = getActiveIdentity(),
  personaId: PersonaId = getActivePersonaId(),
  providerOrOptions?: 'native' | 'openrouter' | TestVoicePlaybackOptions
): Promise<{ ok: boolean; error?: string }> {
  const chatCfg = getChatVoiceConfig(personaId, identity);
  const opts: TestVoicePlaybackOptions =
    typeof providerOrOptions === 'string'
      ? { provider: providerOrOptions }
      : providerOrOptions || {};

  const provider: SierraVoiceProvider = opts.provider || chatCfg.provider;
  const rate = opts.speed !== undefined ? opts.speed : chatCfg.speed;
  const pitch = opts.pitch !== undefined ? opts.pitch : chatCfg.pitch;
  const accent = opts.accent !== undefined ? opts.accent : chatCfg.accent;
  const tone = opts.tone !== undefined ? opts.tone : chatCfg.tone;

  const computed = computeNativeVoiceParameters({
    voiceId,
    identity,
    personaId,
    pitch,
    rate,
    accent,
    tone,
    pool: getCachedDeviceVoices(),
  });

  lastTestVoiceInvocation = {
    voiceId,
    provider,
    speed: rate,
    pitch,
    accent,
    tone,
    targetLang: computed.targetLang,
    effectivePitch: computed.effectivePitch,
    effectiveRate: computed.effectiveRate,
  };

  addDebugLog(
    'TTS:TestVoice',
    `[TestVoice] provider=${provider}, voiceId=${voiceId}, speed=${rate}, pitch=${pitch}, accent=${accent}, tone=${tone}, targetLang=${computed.targetLang}, effectivePitch=${computed.effectivePitch}, effectiveRate=${computed.effectiveRate}`
  );

  if (provider === 'openrouter') {
    const res = await playOpenRouterTts({
      text,
      voice: voiceId || OPENROUTER_TTS_DEFAULT_VOICE,
      accent,
      tone,
      speed: rate,
      source: 'test',
    });
    if (res.ok || res.interrupted) {
      return { ok: true };
    }
    addDebugLog('TTS:OpenRouter', `OpenRouter test failed (${res.error}), falling back to native TTS`);
  }

  return await executeSpeechCore({
    text,
    voiceId,
    identity,
    personaId,
    pitch,
    rate,
    accent,
    tone,
    source: 'test',
  });
}

export function isSpeaking(): boolean {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return isSpeakingActive || window.speechSynthesis.speaking;
  }
  return isSpeakingActive;
}
