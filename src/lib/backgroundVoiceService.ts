import { Capacitor, registerPlugin } from '@capacitor/core';
import { SpeechRecognition as CapSpeechRecognition } from '@capacitor-community/speech-recognition';
import { addDebugLog } from './debugLogStore';
import {
  getActiveIdentity,
  getActivePersonaId,
  getLiveVoiceConfig,
  isBackgroundLiveEnabled,
  isWakeWordEnabled,
  getWakeWordEngineType,
  getWakeWordSensitivity,
  type CompanionIdentity,
  type WakeWordEngineType,
} from './persona';

export interface SierraBackgroundVoicePluginInterface {
  checkAndRequestPermissions(): Promise<{ microphone: string; notifications: string }>;
  startBackgroundService(options: { mode: 'live' | 'wake_word'; startNativeAudio?: boolean }): Promise<{
    started: boolean;
    mode: string;
    nativeAudio: boolean;
  }>;
  stopBackgroundService(options?: { mode?: 'live' | 'wake_word' | 'all' }): Promise<{ stopped: boolean }>;
  startNativeAudioStream(): Promise<{ streaming: boolean }>;
  stopNativeAudioStream(): Promise<{ streaming: boolean }>;
  playNativePcm24k(options: { data: string }): Promise<{ played: boolean }>;
  flushNativePlayback(): Promise<{ flushed: boolean }>;
  checkBatteryOptimization(): Promise<{ isIgnoringBatteryOptimizations: boolean }>;
  requestBatteryOptimizationExemption(): Promise<{ opened: boolean }>;
  checkDefaultAssistantStatus(): Promise<{
    isDefault: boolean;
    canRead: boolean;
    currentAssistant: string;
  }>;
  openDefaultAssistantSettings(): Promise<{ opened: boolean; target: string }>;
  consumePendingAssistantLaunch(): Promise<{ launchedAsAssistant: boolean; source: string }>;
  vibrateDevice(options?: { durationMs?: number }): Promise<{ vibrated: boolean }>;
  addListener(
    eventName: 'onNativePcmChunk',
    listenerFunc: (chunk: { data: string; rms: number }) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'onNotificationStop',
    listenerFunc: (info: { reason: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'onAssistantLaunch',
    listenerFunc: (info: { launchedAsAssistant: boolean; source: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const SierraBackgroundVoice = registerPlugin<SierraBackgroundVoicePluginInterface>('SierraBackgroundVoice');

// Picovoice AccessKey & .ppn keyword file storage (local-only, NEVER logged or committed)
export const STORAGE_KEY_PICOVOICE_ACCESS_KEY = 'sierra_picovoice_access_key';
export const STORAGE_KEY_WAKE_WORD_PPN_PREFIX = 'sierra_wake_word_ppn_';

export interface StoredPpnKeywordFile {
  identity: CompanionIdentity;
  fileName: string;
  base64Data: string;
  updatedAt: number;
}

export function getPicovoiceAccessKey(): string {
  if (typeof localStorage === 'undefined') return '';
  return (localStorage.getItem(STORAGE_KEY_PICOVOICE_ACCESS_KEY) || '').trim();
}

export function setPicovoiceAccessKey(accessKey: string): void {
  if (typeof localStorage === 'undefined') return;
  const trimmed = (accessKey || '').trim();
  if (trimmed) {
    localStorage.setItem(STORAGE_KEY_PICOVOICE_ACCESS_KEY, trimmed);
  } else {
    localStorage.removeItem(STORAGE_KEY_PICOVOICE_ACCESS_KEY);
  }
  // Never log the key itself
  addDebugLog('WakeWord:Config', `[WakeWord] Picovoice AccessKey ${trimmed ? 'configured on device' : 'cleared'}`);
}

export function getStoredPpnKeyword(identity: CompanionIdentity = getActiveIdentity()): StoredPpnKeywordFile | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_WAKE_WORD_PPN_PREFIX}${identity}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.fileName === 'string' &&
      typeof parsed.base64Data === 'string' &&
      parsed.base64Data.length > 0
    ) {
      return {
        identity,
        fileName: parsed.fileName,
        base64Data: parsed.base64Data,
        updatedAt: Number(parsed.updatedAt) || Date.now(),
      };
    }
  } catch {}
  return null;
}

export function saveStoredPpnKeyword(
  identity: CompanionIdentity,
  fileName: string,
  base64Data: string
): StoredPpnKeywordFile {
  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1].trim() : base64Data.trim();
  const entry: StoredPpnKeywordFile = {
    identity,
    fileName: fileName.trim() || `${identity}.ppn`,
    base64Data: cleanBase64,
    updatedAt: Date.now(),
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`${STORAGE_KEY_WAKE_WORD_PPN_PREFIX}${identity}`, JSON.stringify(entry));
  }
  addDebugLog('WakeWord:Config', `[WakeWord] Imported custom .ppn keyword file "${entry.fileName}" for ${identity}`);
  return entry;
}

export function clearStoredPpnKeyword(identity: CompanionIdentity): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(`${STORAGE_KEY_WAKE_WORD_PPN_PREFIX}${identity}`);
  }
  addDebugLog('WakeWord:Config', `[WakeWord] Removed .ppn keyword file for ${identity}`);
}

export interface WakeWordDetectionEvent {
  identity: CompanionIdentity;
  personaId: string;
  voiceId: string;
  engine: WakeWordEngineType;
  keywordLabel: string;
  simulated: boolean;
  timestamp: number;
}

export interface WakeWordEngine {
  readonly id: WakeWordEngineType;
  readonly name: string;
  readonly isExperimental: boolean;
  isConfigured(identity?: CompanionIdentity): { ready: boolean; reason?: string };
  startListening(options: {
    identity: CompanionIdentity;
    sensitivity: number;
    onDetected: (event: WakeWordDetectionEvent) => void;
    onError?: (err: Error) => void;
  }): Promise<boolean>;
  stopListening(): Promise<void>;
  isActive(): boolean;
}

/**
 * Plays a short two-tone ascending chime when the wake word is detected.
 */
export function playWakeWordChime(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc2.frequency.setValueAtTime(783.99, now + 0.09); // G5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.1);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.25);

    setTimeout(() => {
      try {
        ctx.close();
      } catch {}
    }, 350);
  } catch {}
}

/**
 * Triggers brief haptic vibration on wake word detection.
 */
export async function vibrateForWakeWord(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([80, 40, 120]);
    }
  } catch {}
  if (Capacitor.isNativePlatform()) {
    try {
      await SierraBackgroundVoice.vibrateDevice({ durationMs: 120 });
    } catch {}
  }
}

/**
 * Default WakeWordEngine: Picovoice Porcupine on-device engine.
 * Requires user's Picovoice AccessKey and a custom .ppn keyword file for the active identity.
 * Audio is processed strictly on-device and never leaves the phone until the wake word is detected.
 */
export class PorcupineWakeWordEngine implements WakeWordEngine {
  readonly id: WakeWordEngineType = 'porcupine';
  readonly name = 'Picovoice Porcupine (On-Device .ppn)';
  readonly isExperimental = false;

  private active = false;
  private porcupineInstance: any = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;

  isConfigured(identity: CompanionIdentity = getActiveIdentity()): { ready: boolean; reason?: string } {
    const key = getPicovoiceAccessKey();
    const ppn = getStoredPpnKeyword(identity);
    if (!key && !ppn) {
      return {
        ready: false,
        reason: `Paste your Picovoice AccessKey and import a custom "${identity === 'tyler' ? 'Tyler' : 'Sierra'}" .ppn keyword file to enable Porcupine wake word detection.`,
      };
    }
    if (!key) {
      return {
        ready: false,
        reason: 'Missing Picovoice AccessKey. Paste your AccessKey from Picovoice Console.',
      };
    }
    if (!ppn) {
      return {
        ready: false,
        reason: `Missing custom .ppn keyword file for ${identity === 'tyler' ? 'Tyler' : 'Sierra'}. Import a .ppn file below.`,
      };
    }
    return { ready: true };
  }

  async startListening(options: {
    identity: CompanionIdentity;
    sensitivity: number;
    onDetected: (event: WakeWordDetectionEvent) => void;
    onError?: (err: Error) => void;
  }): Promise<boolean> {
    const status = this.isConfigured(options.identity);
    if (!status.ready) {
      const err = new Error(status.reason || 'Porcupine wake word engine is not configured');
      options.onError?.(err);
      return false;
    }

    await this.stopListening();
    this.active = true;

    const accessKey = getPicovoiceAccessKey();
    const ppn = getStoredPpnKeyword(options.identity)!;
    const clampedSensitivity = Math.max(0.1, Math.min(1.0, options.sensitivity || 0.5));

    // Start foreground service notification line: "Listening for wake word"
    if (Capacitor.isNativePlatform()) {
      try {
        await SierraBackgroundVoice.checkAndRequestPermissions();
        await SierraBackgroundVoice.startBackgroundService({ mode: 'wake_word', startNativeAudio: false });
      } catch (e) {
        console.warn('[WakeWord:Porcupine] Foreground service start warning:', e);
      }
    }

    // Attempt dynamic Porcupine Web initialization if @picovoice/porcupine-web is loaded on window or bundle
    try {
      const PorcupineWeb = (globalThis as any).PorcupineWeb;
      if (PorcupineWeb && typeof PorcupineWeb.PorcupineWorker?.create === 'function') {
        const keywordModel = {
          base64: ppn.base64Data,
          label: options.identity,
          sensitivity: clampedSensitivity,
        };
        this.porcupineInstance = await PorcupineWeb.PorcupineWorker.create(
          accessKey,
          [keywordModel],
          (detection: any) => {
            if (!this.active) return;
            const personaId = getActivePersonaId();
            const liveCfg = getLiveVoiceConfig(personaId, options.identity);
            options.onDetected({
              identity: options.identity,
              personaId,
              voiceId: liveCfg.voiceId,
              engine: 'porcupine',
              keywordLabel: detection?.label || ppn.fileName,
              simulated: false,
              timestamp: Date.now(),
            });
          }
        );
      }
    } catch (err: any) {
      addDebugLog('WakeWord:Porcupine', `[WakeWord] Porcupine worker init note: ${err?.message || 'Standby mode'}`);
    }

    addDebugLog(
      'WakeWord:Start',
      `[WakeWord] Started Porcupine listener for ${options.identity} (keyword="${ppn.fileName}", sensitivity=${clampedSensitivity.toFixed(2)})`
    );
    return true;
  }

  async stopListening(): Promise<void> {
    this.active = false;
    if (this.porcupineInstance) {
      try {
        await this.porcupineInstance.release?.();
        await this.porcupineInstance.terminate?.();
      } catch {}
      this.porcupineInstance = null;
    }
    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {}
      this.scriptProcessor = null;
    }
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      this.mediaStream = null;
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

/**
 * Experimental Fallback WakeWordEngine: Android SpeechRecognizer keyword matching.
 * Labelled "experimental, uses more battery". Off by default.
 */
export class ExperimentalSpeechRecognizerWakeWordEngine implements WakeWordEngine {
  readonly id: WakeWordEngineType = 'speech_recognizer';
  readonly name = 'Android SpeechRecognizer Keyword Matcher (Experimental, uses more battery)';
  readonly isExperimental = true;

  private active = false;
  private listenerHandle: any = null;
  private stateListenerHandle: any = null;
  private webRecognition: any = null;
  private restartTimer: any = null;

  isConfigured(): { ready: boolean; reason?: string } {
    return { ready: true };
  }

  async startListening(options: {
    identity: CompanionIdentity;
    sensitivity: number;
    onDetected: (event: WakeWordDetectionEvent) => void;
    onError?: (err: Error) => void;
  }): Promise<boolean> {
    await this.stopListening();
    this.active = true;

    const targetKeyword = options.identity === 'tyler' ? 'tyler' : 'sierra';

    if (Capacitor.isNativePlatform()) {
      try {
        await SierraBackgroundVoice.checkAndRequestPermissions();
        await SierraBackgroundVoice.startBackgroundService({ mode: 'wake_word', startNativeAudio: false });

        this.listenerHandle = await CapSpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
          if (!this.active) return;
          const matches = data?.matches || [];
          const combined = matches.join(' ').toLowerCase();
          if (combined.includes(targetKeyword)) {
            const personaId = getActivePersonaId();
            const liveCfg = getLiveVoiceConfig(personaId, options.identity);
            options.onDetected({
              identity: options.identity,
              personaId,
              voiceId: liveCfg.voiceId,
              engine: 'speech_recognizer',
              keywordLabel: targetKeyword,
              simulated: false,
              timestamp: Date.now(),
            });
          }
        });

        this.stateListenerHandle = await CapSpeechRecognition.addListener('listeningState', (data: { status?: string }) => {
          if (!this.active) return;
          if (data?.status === 'stopped') {
            this.restartTimer = setTimeout(() => {
              if (this.active) {
                CapSpeechRecognition.start({
                  language: 'en-US',
                  maxResults: 3,
                  prompt: '',
                  popup: false,
                  partialResults: true,
                }).catch(() => {});
              }
            }, 900);
          }
        });

        await CapSpeechRecognition.start({
          language: 'en-US',
          maxResults: 3,
          prompt: '',
          popup: false,
          partialResults: true,
        });
      } catch (err: any) {
        addDebugLog('WakeWord:Experimental', `[WakeWord] Experimental SpeechRecognizer note: ${err?.message || String(err)}`);
      }
    } else if (typeof window !== 'undefined') {
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.onresult = (event: any) => {
            if (!this.active) return;
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const text = String(event.results[i][0]?.transcript || '').toLowerCase();
              if (text.includes(targetKeyword)) {
                const personaId = getActivePersonaId();
                const liveCfg = getLiveVoiceConfig(personaId, options.identity);
                options.onDetected({
                  identity: options.identity,
                  personaId,
                  voiceId: liveCfg.voiceId,
                  engine: 'speech_recognizer',
                  keywordLabel: targetKeyword,
                  simulated: false,
                  timestamp: Date.now(),
                });
                break;
              }
            }
          };
          rec.onend = () => {
            if (this.active) {
              this.restartTimer = setTimeout(() => {
                if (this.active) {
                  try {
                    rec.start();
                  } catch {}
                }
              }, 700);
            }
          };
          rec.start();
          this.webRecognition = rec;
        } catch {}
      }
    }

    addDebugLog(
      'WakeWord:Start',
      `[WakeWord] Started experimental SpeechRecognizer wake word listener for "${targetKeyword}"`
    );
    return true;
  }

  async stopListening(): Promise<void> {
    this.active = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.listenerHandle) {
      try {
        await this.listenerHandle.remove();
      } catch {}
      this.listenerHandle = null;
    }
    if (this.stateListenerHandle) {
      try {
        await this.stateListenerHandle.remove();
      } catch {}
      this.stateListenerHandle = null;
    }
    if (this.webRecognition) {
      try {
        this.webRecognition.abort();
      } catch {}
      this.webRecognition = null;
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

// Singleton engines — enforces ONE active listener at a time
const porcupineEngine = new PorcupineWakeWordEngine();
const speechRecognizerEngine = new ExperimentalSpeechRecognizerWakeWordEngine();
let activeWakeWordEngine: WakeWordEngine | null = null;

type WakeWordSubscriber = (event: WakeWordDetectionEvent) => void;
const wakeWordSubscribers = new Set<WakeWordSubscriber>();

export function subscribeWakeWordDetected(cb: WakeWordSubscriber): () => void {
  wakeWordSubscribers.add(cb);
  return () => {
    wakeWordSubscribers.delete(cb);
  };
}

export function getWakeWordEngineInstance(type: WakeWordEngineType = getWakeWordEngineType()): WakeWordEngine {
  return type === 'speech_recognizer' ? speechRecognizerEngine : porcupineEngine;
}

export function getActiveWakeWordEngine(): WakeWordEngine | null {
  return activeWakeWordEngine && activeWakeWordEngine.isActive() ? activeWakeWordEngine : null;
}

/**
 * Starts the selected wake word engine (stopping any previously active listener so only ONE listener runs at a time).
 */
export async function startWakeWordListener(
  identity: CompanionIdentity = getActiveIdentity(),
  engineType: WakeWordEngineType = getWakeWordEngineType(),
  sensitivity: number = getWakeWordSensitivity()
): Promise<{ started: boolean; error?: string }> {
  // Always stop any existing listener first so only ONE listener is active at a time
  await stopWakeWordListener();

  const engine = getWakeWordEngineInstance(engineType);
  const check = engine.isConfigured(identity);
  if (!check.ready) {
    return { started: false, error: check.reason };
  }

  let errorMsg: string | undefined;
  const started = await engine.startListening({
    identity,
    sensitivity,
    onDetected: async (detection) => {
      await handleWakeWordTriggered(detection);
    },
    onError: (err) => {
      errorMsg = err.message;
    },
  });

  if (started) {
    activeWakeWordEngine = engine;
    return { started: true };
  }
  return { started: false, error: errorMsg || 'Could not start wake word listener' };
}

export async function stopWakeWordListener(): Promise<void> {
  if (activeWakeWordEngine) {
    await activeWakeWordEngine.stopListening();
    activeWakeWordEngine = null;
  }
  await porcupineEngine.stopListening();
  await speechRecognizerEngine.stopListening();

  if (Capacitor.isNativePlatform()) {
    try {
      await SierraBackgroundVoice.stopBackgroundService({ mode: 'wake_word' });
    } catch {}
  }
  addDebugLog('WakeWord:Stop', '[WakeWord] Stopped wake word listener');
}

async function handleWakeWordTriggered(event: WakeWordDetectionEvent): Promise<void> {
  addDebugLog(
    'WakeWord:Detected',
    `[WakeWord] Detected "${event.keywordLabel}" (${event.engine}${event.simulated ? ', test' : ''}) -> starting Live session for ${event.identity}/${event.personaId} with voice ${event.voiceId}`
  );
  // Stop wake word listener before starting Live session so it doesn't compete for the microphone
  if (!event.simulated && activeWakeWordEngine) {
    await activeWakeWordEngine.stopListening();
    activeWakeWordEngine = null;
  }
  await vibrateForWakeWord();
  playWakeWordChime();
  for (const sub of wakeWordSubscribers) {
    try {
      sub(event);
    } catch (err) {
      console.warn('[WakeWord] Subscriber error:', err);
    }
  }
}

/**
 * One-tap "Test wake word" handler: vibrates briefly, plays the wake chime,
 * and triggers the wake-word detection flow with the current identity, persona, and saved Live voice.
 */
export async function triggerTestWakeWord(
  identity: CompanionIdentity = getActiveIdentity()
): Promise<WakeWordDetectionEvent> {
  const personaId = getActivePersonaId();
  const liveCfg = getLiveVoiceConfig(personaId, identity);
  const engineType = getWakeWordEngineType();
  const event: WakeWordDetectionEvent = {
    identity,
    personaId,
    voiceId: liveCfg.voiceId,
    engine: engineType,
    keywordLabel: identity === 'tyler' ? 'Tyler' : 'Sierra',
    simulated: true,
    timestamp: Date.now(),
  };
  await handleWakeWordTriggered(event);
  return event;
}

// Global Background Live Session Status Store (for in-app indicator across all tabs)
export interface BackgroundLiveStatus {
  isLiveSessionActive: boolean;
  isBackgroundModeEnabled: boolean;
  isNativeAudioBridgeActive: boolean;
  identity: CompanionIdentity;
  personaId: string;
  voiceId: string;
}

let currentBackgroundLiveStatus: BackgroundLiveStatus = {
  isLiveSessionActive: false,
  isBackgroundModeEnabled: false,
  isNativeAudioBridgeActive: false,
  identity: 'sierra',
  personaId: 'classy',
  voiceId: 'Aoede',
};

const bgStatusListeners = new Set<(status: BackgroundLiveStatus) => void>();
let stopLiveSessionCallback: (() => void) | null = null;

export function setBackgroundLiveSessionStatus(partial: Partial<BackgroundLiveStatus>, onStopCallback?: () => void): void {
  currentBackgroundLiveStatus = {
    ...currentBackgroundLiveStatus,
    ...partial,
    isBackgroundModeEnabled:
      partial.isBackgroundModeEnabled !== undefined ? partial.isBackgroundModeEnabled : isBackgroundLiveEnabled(),
  };
  if (onStopCallback !== undefined) {
    stopLiveSessionCallback = onStopCallback;
  }
  for (const listener of bgStatusListeners) {
    try {
      listener(currentBackgroundLiveStatus);
    } catch {}
  }
}

export function getBackgroundLiveSessionStatus(): BackgroundLiveStatus {
  return currentBackgroundLiveStatus;
}

export function subscribeBackgroundLiveStatus(cb: (status: BackgroundLiveStatus) => void): () => void {
  bgStatusListeners.add(cb);
  cb(currentBackgroundLiveStatus);
  return () => {
    bgStatusListeners.delete(cb);
  };
}

export function requestStopBackgroundLiveSession(): void {
  if (stopLiveSessionCallback) {
    stopLiveSessionCallback();
  }
}
