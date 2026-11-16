import React, { useState, useEffect, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { SpeechRecognition as CapSpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { auth, db, useSafeAuthState } from '../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { isGeminiLiveModel } from '../lib/gemini';
import {
  logQuotaOrRateLimitError,
  doesModelSupportFunctionCalling,
  recordModelFunctionCallingSupportFromApi,
  inspectApiErrorForToolSupport,
  hydratePersistentStateFromNative,
} from '../config/models';
import { executeSierraToolCall } from '../lib/toolRouter';
import { auditDevicePermissionsOnLaunch } from '../lib/deviceControl';
import { 
  Mic, MicOff, Loader2, Sparkles, AlertCircle, RefreshCw, Volume2, Headphones, MessageSquare,
  Copy, FileText, Trash2, Check, X, AlertTriangle, ChevronDown, ChevronUp, Settings,
  Camera, CameraOff, Monitor, MonitorOff, SwitchCamera, Globe, Sliders, User, ArrowDown, Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { 
  SIERRA_CORE_PERSONA, 
  CONTENT_MODES, 
  buildSierraSystemInstruction,
  buildVoiceStyleDirective,
  SIERRA_PERSONAS,
  SUPPORTED_LIVE_VOICES,
  SUPPORTED_LIVE_LANGUAGES,
  type SierraPersonaConfig,
  type LiveVoiceName,
  type LiveLanguageConfig,
  getActiveIdentity,
  setActiveIdentity,
  getActivePersonaId,
  setActivePersonaId,
  getActiveVoiceForCurrentPersona,
  getVoiceForPersona,
  getLiveVoiceConfig,
  resolveAndBuildLiveSetupPayload,
  migrateVoiceConfigs,
  UNIFIED_PERSONAS,
  IDENTITIES,
  logSessionStartSummary,
  type CompanionIdentity,
  type PersonaId,
  OPEN_VOICE_POOL,
  summarizeAndSaveConversation,
  isBackgroundLiveEnabled,
  isWakeWordEnabled,
  shouldSavePeriodicSummary,
  deriveLanguageCodeFromAccent,
  isMostlyLatinScript,
  type AudioOutputMode,
  setAudioOutputMode,
  detectConnectedHeadphones,
  type ThinkingLevel,
  getStoredGeminiThinkingLevel,
  validateThinkingLevel,
  isGeminiLiveExtendedThinkingModel,
  LIVE_VAD_SILENCE_DURATION_MS,
  isPlaceholderOrErrorTurn,
  getOpenRouterApiKey,
  getSelectedVoiceProvider,
  getChatVoiceConfig,
  OPENROUTER_TTS_DEFAULT_VOICE,
  getTtsRate,
  getTtsPitch,
} from '../lib/persona';
import {
  detectTranscriptLanguageMismatch,
  cleanCorruptedConversationSummaries
} from '../lib/languageGuard';
import {
  SierraBackgroundVoice,
  setBackgroundLiveSessionStatus,
  startWakeWordListener,
  stopWakeWordListener
} from '../lib/backgroundVoiceService';
import { PersonaVoiceModal } from './PersonaVoiceModal';
import { LocalVoiceSettingsCard } from './LocalVoiceSettingsCard';
import {
  getLocalVoiceSettings,
  saveLocalVoiceSettings,
  resolveEffectiveWhisperSize,
  getRequiredModelsForSettings,
  getActiveLlmArtifactSpec,
  LOCAL_WHISPER_MODELS,
  LOCAL_SILERO_VAD_MODEL,
  LOCAL_PIPER_VOICE_MODEL,
  LOCAL_PIPER_VOICE_CONFIG,
  LocalSentenceSplitter,
  LocalVoiceTurnStateMachine,
  LocalTtsQueueCoordinator,
  PiperLocalTtsEngine,
  AndroidSystemLocalTtsEngine,
  buildCompactLocalSystemPrompt,
  formatLocalSystemPrefix,
  buildLocalConversationPrompt,
  getSierraLocalVoicePlugin,
  ensureNativeLocalMicPermission,
  prepareNativeAudioRoute,
  type LocalVoiceStatus,
  type LocalTtsEngineId,
  type DebugUtteranceEntry,
} from '../lib/localVoiceEngine';
import {
  evaluateSttUtterance,
  logDroppedSttUtterance,
  STT_PHANTOM_BLOCKLIST,
  normalizePhantomPhrase,
} from '../lib/sttFilter';
import {
  OPENROUTER_DEFAULT_PAID_MODEL,
  fetchOpenRouterFreeModels,
  getOpenRouterModelSettings,
  resolveEffectiveOpenRouterModel,
  fallbackToOpenRouterPaidDefault,
  buildOpenRouterSystemPrompt,
  streamOpenRouterLiveTurn,
  type OpenRouterModelDescriptor,
} from '../lib/openRouterLive';
import {
  useSettings,
  updateSettings,
  getProviderApiKey,
  getProviderWsEndpoint,
  DEFAULT_LIVE_GEMINI_WS_URL,
  formatShortModelDisplayName,
  getCustomDirectives,
  getLiveLanguageSetting,
  setLiveLanguageSetting,
  getVoiceInputEngineSetting,
  STORAGE_KEY_SETTINGS_V3,
  type BargeInModeSetting,
} from '../lib/settingsStore';
import type { SettingsSectionId } from './Settings';
import {
  speakLiveSentenceWithConfiguredProvider,
  stopSpeaking as stopTtsServiceSpeaking,
  endSpeakingTurn,
  OpenRouterLiveTtsEngine,
  getEffectiveLiveVoiceLabel,
} from '../lib/ttsService';
import {
  recordSpokenSegment,
  shouldDropEchoTranscript,
  type SpokenSegment,
} from '../lib/echoFilter';
import { streamChat, getNativeStoredKeys } from '../lib/providers';
import { addDebugLog, clearDebugLogs, useDebugLogs, formatAllDebugLogsForCopy } from '../lib/debugLogStore';
import { getContentMode, useContentMode } from '../lib/contentModeStore';
import { triggerHaptic } from '../lib/haptics';
import { useActiveIdentityAccent, notifyIdentityChanged } from '../lib/themeStore';

// Tunable constants for Client-Side Adaptive Barge-In
export const SPEAKER_BARGE_IN_MULTIPLE = 2.5;
export const SPEAKER_BARGE_IN_FLOOR_RMS = 0.2; // Tuned to 0.20 to exceed phone speaker echo peaks (0.157 - 0.180)
export const SPEAKER_BARGE_IN_SUSTAINED_MS = 600;
export const SPEAKER_BARGE_IN_TURN_GRACE_MS = 400;

export const HEADPHONES_BARGE_IN_RMS = 0.01;
export const HEADPHONES_BARGE_IN_SUSTAINED_MS = 150;

/**
 * Pure evaluation function for client-side barge-in decision.
 */
export function evaluateBargeInDecision(options: {
  micRms: number;
  playbackRms: number;
  isPlaying: boolean;
  sustainedMs: number;
  timeSinceTurnStartMs: number;
  mode: AudioOutputMode;
  floorRms?: number;
  multiple?: number;
  sustainedThresholdMs?: number;
  graceMs?: number;
  bargeInMode?: BargeInModeSetting;
  hasHeadset?: boolean;
  timeSincePlaybackEndMs?: number;
  vadProb?: number;
}): {
  shouldTrigger: boolean;
  decision: 'trigger' | 'ignored';
  reason: 'within_grace' | 'below_threshold' | 'accumulating' | 'triggered' | 'not_playing';
  requiredRms: number;
  isWithinGrace: boolean;
} {
  const {
    micRms,
    playbackRms,
    isPlaying,
    sustainedMs,
    timeSinceTurnStartMs,
    mode,
    floorRms = SPEAKER_BARGE_IN_FLOOR_RMS,
    multiple = SPEAKER_BARGE_IN_MULTIPLE,
    graceMs = SPEAKER_BARGE_IN_TURN_GRACE_MS,
    bargeInMode,
    hasHeadset,
    timeSincePlaybackEndMs,
    vadProb = 1.0,
  } = options;

  if (bargeInMode !== undefined) {
    const effectiveHeadset = hasHeadset !== undefined ? hasHeadset : mode === 'headphones';
    if (bargeInMode === 'adaptive') {
      if (!isPlaying) {
        return {
          shouldTrigger: false,
          decision: 'ignored',
          reason: 'not_playing',
          requiredRms: 0,
          isWithinGrace: false,
        };
      }
      if (effectiveHeadset) {
        const headsetRequiredRms = options.floorRms !== undefined ? options.floorRms : HEADPHONES_BARGE_IN_RMS;
        const headsetSustained = options.sustainedThresholdMs !== undefined ? options.sustainedThresholdMs : 0;
        if (vadProb < 0.85 || micRms < headsetRequiredRms) {
          return {
            shouldTrigger: false,
            decision: 'ignored',
            reason: 'below_threshold',
            requiredRms: headsetRequiredRms,
            isWithinGrace: false,
          };
        }
        if (sustainedMs < headsetSustained) {
          return {
            shouldTrigger: false,
            decision: 'ignored',
            reason: 'accumulating',
            requiredRms: headsetRequiredRms,
            isWithinGrace: false,
          };
        }
        return {
          shouldTrigger: true,
          decision: 'trigger',
          reason: 'triggered',
          requiredRms: headsetRequiredRms,
          isWithinGrace: false,
        };
      }

      const requiredAdaptiveSpeakerRms = Math.max(0.2, 2 * playbackRms);
      const isAdaptiveWithinGrace = timeSinceTurnStartMs >= 0 && timeSinceTurnStartMs < graceMs;
      if (isAdaptiveWithinGrace) {
        return {
          shouldTrigger: false,
          decision: 'ignored',
          reason: 'within_grace',
          requiredRms: requiredAdaptiveSpeakerRms,
          isWithinGrace: true,
        };
      }
      if (vadProb < 0.85 || micRms <= requiredAdaptiveSpeakerRms) {
        return {
          shouldTrigger: false,
          decision: 'ignored',
          reason: 'below_threshold',
          requiredRms: requiredAdaptiveSpeakerRms,
          isWithinGrace: false,
        };
      }
      const adaptiveSpeakerSustained = options.sustainedThresholdMs !== undefined ? options.sustainedThresholdMs : 400;
      if (sustainedMs < adaptiveSpeakerSustained) {
        return {
          shouldTrigger: false,
          decision: 'ignored',
          reason: 'accumulating',
          requiredRms: requiredAdaptiveSpeakerRms,
          isWithinGrace: false,
        };
      }
      return {
        shouldTrigger: true,
        decision: 'trigger',
        reason: 'triggered',
        requiredRms: requiredAdaptiveSpeakerRms,
        isWithinGrace: false,
      };
    }

    const bargeInPermitted =
      bargeInMode === 'on' || (bargeInMode === 'headphones_only' && effectiveHeadset);
    if (!bargeInPermitted) {
      const inPostPlaybackCooldown =
        timeSincePlaybackEndMs !== undefined &&
        timeSincePlaybackEndMs >= 0 &&
        timeSincePlaybackEndMs < graceMs;
      if (isPlaying || inPostPlaybackCooldown) {
        return {
          shouldTrigger: false,
          decision: 'ignored',
          reason: 'within_grace',
          requiredRms: Math.max(floorRms, multiple * playbackRms),
          isWithinGrace: true,
        };
      }
      return {
        shouldTrigger: false,
        decision: 'ignored',
        reason: 'not_playing',
        requiredRms: 0,
        isWithinGrace: false,
      };
    }
  }

  if (!isPlaying) {
    return {
      shouldTrigger: false,
      decision: 'ignored',
      reason: 'not_playing',
      requiredRms: 0,
      isWithinGrace: false,
    };
  }

  const isSpeaker = mode === 'speaker';
  const isWithinGrace = isSpeaker && timeSinceTurnStartMs >= 0 && timeSinceTurnStartMs < graceMs;

  if (isWithinGrace) {
    return {
      shouldTrigger: false,
      decision: 'ignored',
      reason: 'within_grace',
      requiredRms: Math.max(floorRms, multiple * playbackRms),
      isWithinGrace: true,
    };
  }

  const requiredRms = isSpeaker
    ? Math.max(floorRms, multiple * playbackRms)
    : (options.floorRms !== undefined ? options.floorRms : HEADPHONES_BARGE_IN_RMS);

  const targetSustained = isSpeaker
    ? (options.sustainedThresholdMs !== undefined ? options.sustainedThresholdMs : SPEAKER_BARGE_IN_SUSTAINED_MS)
    : (options.sustainedThresholdMs !== undefined ? options.sustainedThresholdMs : HEADPHONES_BARGE_IN_SUSTAINED_MS);

  if (micRms < requiredRms) {
    return {
      shouldTrigger: false,
      decision: 'ignored',
      reason: 'below_threshold',
      requiredRms,
      isWithinGrace: false,
    };
  }

  if (sustainedMs < targetSustained) {
    return {
      shouldTrigger: false,
      decision: 'ignored',
      reason: 'accumulating',
      requiredRms,
      isWithinGrace: false,
    };
  }

  return {
    shouldTrigger: true,
    decision: 'trigger',
    reason: 'triggered',
    requiredRms,
    isWithinGrace: false,
  };
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

  // Case 3: Character-level overlap when Gemini splits mid-word or without spaces
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
  // Remove immediate repeated n-grams (from 6 words down to 1 word)
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

interface ScreenCapturePluginType {
  isSupported(): Promise<{ supported: boolean }>;
  startScreenCapture(): Promise<{ status: string }>;
  stopScreenCapture(): Promise<{ status: string }>;
  addListener(
    eventName: 'onScreenFrame',
    listenerFunc: (frame: { base64?: string; data?: string; width?: number; height?: number; timestamp?: number }) => void
  ): Promise<any>;
  addListener(
    eventName: 'onScreenCaptureStopped',
    listenerFunc: (info: { reason?: string }) => void
  ): Promise<any>;
  removeAllListeners(): Promise<void>;
}

const ScreenCapture = registerPlugin<ScreenCapturePluginType>('ScreenCapture');

interface TranscriptItem {
  id: string;
  sender: 'user' | 'sierra';
  text: string;
  rawTranscript?: string;
  timestamp: number;
  model?: string;
}

import { formatDebugLogs, type DebugLogEvent } from '../lib/debugLogs';
export { formatDebugLogs, type DebugLogEvent };

export interface LiveVoiceProps {
  autoStartTrigger?: number;
  isTabActive?: boolean;
  onOpenSettings?: (section?: SettingsSectionId, providerId?: string) => void;
}

export default function LiveVoice({ autoStartTrigger, isTabActive = true, onOpenSettings }: LiveVoiceProps = {}) {
  const { accentHex, accentRgb } = useActiveIdentityAccent();
  const [user] = useSafeAuthState();
  const [isActive, setIsActive] = useState(false);
  const [isBackgroundLiveMode, setIsBackgroundLiveMode] = useState<boolean>(() => isBackgroundLiveEnabled());
  const nativePcmListenerRef = useRef<any>(null);
  const notifStopListenerRef = useRef<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [micRms, setMicRms] = useState(0);
  const MUTE_MIC_DURING_PLAYBACK = false;
  const isThinkingRef = useRef<boolean>(false);
  const workletChunkCountRef = useRef<number>(0);
  const audioSendCountRef = useRef<number>(0);
  const chunksReceivedCountRef = useRef<number>(0);
  const chunksSentCountRef = useRef<number>(0);
  const chunksDroppedCountRef = useRef<number>(0);
  const peakRms20Ref = useRef<number>(0);
  const speechStartWhileSpeakingTimeRef = useRef<number>(0);
  const belowThresholdSinceRef = useRef<number>(0);
  const isVoiceActiveRef = useRef<boolean>(false);
  const firstTranscriptLoggedRef = useRef<boolean>(false);
  const firstSessionInputTranscriptLoggedRef = useRef<boolean>(false);
  const firstAudioLoggedRef = useRef<boolean>(false);
  const liveSessionResumptionHandleRef = useRef<string | null>(null);
  const isReconnectingFromGoAwayRef = useRef<boolean>(false);
  const liveSessionReconnectTimerRef = useRef<any>(null);
  const settings = useSettings();
  const [mode, setMode] = useState<'continuous' | 'push'>('continuous');
  const [isPushing, setIsPushing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [liveAuth401Provider, setLiveAuth401Provider] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const liveProvider = settings.models.liveProvider;
  const [localVoiceStatus, setLocalVoiceStatus] = useState<LocalVoiceStatus>('idle');
  const [showLocalDownloadModal, setShowLocalDownloadModal] = useState(false);
  const localStateMachineRef = useRef<LocalVoiceTurnStateMachine | null>(null);
  const localTtsQueueRef = useRef<LocalTtsQueueCoordinator | null>(null);
  const localListenersRef = useRef<Array<{ remove: () => Promise<void> }>>([]);
  const openRouterSettings = getOpenRouterModelSettings();
  const [openRouterFreeModels, setOpenRouterFreeModels] = useState<OpenRouterModelDescriptor[]>([]);
  const [isLoadingFreeModels, setIsLoadingFreeModels] = useState<boolean>(false);
  const [openRouterModelError, setOpenRouterModelError] = useState<string | null>(null);
  const [lastAnsweredLiveModel, setLastAnsweredLiveModel] = useState<string>('');
  const openRouterAbortControllerRef = useRef<AbortController | null>(null);
  const liveSessionIdRef = useRef<string>(`live-${Date.now()}`);
  const lastLocalVoiceChunkTimeRef = useRef<number>(0);
  const emptyServerMsgCountRef = useRef<number>(0);
  const userPauseMergeTimerRef = useRef<any>(null);
  const [debugUtterances, setDebugUtterances] = useState<DebugUtteranceEntry[]>([]);
  const [playingUtteranceId, setPlayingUtteranceId] = useState<string | null>(null);
  const debugUtteranceAudioRef = useRef<HTMLAudioElement | null>(null);
  const promptDumpSessionIdRef = useRef<string>('');

  useEffect(() => {
    migrateVoiceConfigs();
    cleanCorruptedConversationSummaries();

    const handleVoiceConfigSync = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const nextIdentity = detail?.identity || getActiveIdentity();
      const nextPersona = detail?.personaId || getActivePersonaId();
      const liveCfg = getLiveVoiceConfig(nextPersona as any, nextIdentity);
      setCompanionIdentity(nextIdentity);
      setSelectedPersona(nextPersona);
      if (SUPPORTED_LIVE_VOICES.includes(liveCfg.voiceId as LiveVoiceName)) {
        setSelectedVoice(liveCfg.voiceId as LiveVoiceName);
      }
      setLiveAccent(liveCfg.accent);
      setLiveTone(liveCfg.tone);
      const derivedLang = deriveLanguageCodeFromAccent(liveCfg.accent);
      if (derivedLang) {
        setSelectedLanguage(derivedLang);
      }
    };

    window.addEventListener('sierra-voice-config-changed', handleVoiceConfigSync as EventListener);
    return () => {
      window.removeEventListener('sierra-voice-config-changed', handleVoiceConfigSync as EventListener);
    };
  }, []);

  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    return getLiveLanguageSetting();
  });
  const selectedLanguageRef = useRef<string>(selectedLanguage);
  const modelTurnHasDriftRef = useRef<boolean>(false);
  useEffect(() => {
    selectedLanguageRef.current = selectedLanguage;
  }, [selectedLanguage]);

  const recentSpokenSegmentsRef = useRef<SpokenSegment[]>([]);
  const lastPlaybackEndedAtRef = useRef<number>(0);
  const hasHeadsetRef = useRef<boolean>(false);
  const liveExchangeIndexRef = useRef<number>(0);
  const savedTurnKeysRef = useRef<Set<string>>(new Set());
  const pendingLiveUserTurnRef = useRef<string>('');
  const spokenLiveTurnTextRef = useRef<string>('');

  const [userSpeechDetected, setUserSpeechDetected] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<string>(() => {
    return getActivePersonaId();
  });
  const [companionIdentity, setCompanionIdentity] = useState<CompanionIdentity>(() => {
    return getActiveIdentity();
  });
  const bargeInSensitivity = settings.live.bargeInSensitivity;
  const [selectedVoice, setSelectedVoice] = useState<LiveVoiceName>(() => {
    const liveCfg = getLiveVoiceConfig();
    if (SUPPORTED_LIVE_VOICES.includes(liveCfg.voiceId as LiveVoiceName)) {
      return liveCfg.voiceId as LiveVoiceName;
    }
    return getActiveIdentity() === 'tyler' ? 'Charon' : 'Aoede';
  });
  const [liveAccent, setLiveAccent] = useState<string>(() => getLiveVoiceConfig().accent);
  const [liveTone, setLiveTone] = useState<string>(() => getLiveVoiceConfig().tone);
  const [isPersonaModalOpen, setIsPersonaModalOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isScreenShareActive, setIsScreenShareActive] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');
  const [videoFpsStats, setVideoFpsStats] = useState<string>('');
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const audioOutputMode = settings.live.audioOutputMode;
  const audioOutputModeRef = useRef<AudioOutputMode>(audioOutputMode);
  useEffect(() => {
    audioOutputModeRef.current = audioOutputMode;
  }, [audioOutputMode]);

  useEffect(() => {
    detectConnectedHeadphones().then((detected) => {
      hasHeadsetRef.current = detected;
      if (detected && typeof localStorage !== 'undefined' && !localStorage.getItem(STORAGE_KEY_SETTINGS_V3)) {
        setAudioOutputMode('headphones');
        audioOutputModeRef.current = 'headphones';
      }
    });

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      const onDeviceChange = async () => {
        const detected = await detectConnectedHeadphones();
        hasHeadsetRef.current = detected;
        addDebugLog('Diag', `[Diag] Media devices changed: headphonesDetected=${detected}, activeMode=${audioOutputModeRef.current}`);
      };
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      };
    }
  }, []);

  const handleToggleAudioOutputMode = (newMode: AudioOutputMode) => {
    setAudioOutputMode(newMode);
    audioOutputModeRef.current = newMode;
    toast.success(`Audio output: ${newMode === 'headphones' ? 'Headphones' : 'Speaker'}`);
    restartLiveSessionIfActive();
  };

  // Video and screen share refs
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoFrameTimerRef = useRef<any>(null);
  const framesSentCountRef = useRef<number>(0);
  const lastFpsCheckTimeRef = useRef<number>(0);
  const isCameraActiveRef = useRef<boolean>(false);
  const isScreenShareActiveRef = useRef<boolean>(false);
  const activeVideoSourceRef = useRef<'camera' | 'screen' | null>(null);
  const screenCaptureListenerRef = useRef<any>(null);
  const screenCaptureStoppedListenerRef = useRef<any>(null);
  const videoFramesSentCountRef = useRef<number>(0);
  const hasSentFirstVideoFrameRef = useRef<boolean>(false);
  const videoFormatAttemptRef = useRef<'video' | 'mediaChunks'>('video');
  const videoFormatAcceptedRef = useRef<'video' | 'mediaChunks' | 'unknown'>('unknown');

  // Transcript buffer & turn management refs (useRef avoids stale closures)
  const userTranscriptBufferRef = useRef<string>('');
  const lastFinalizedUserTextRef = useRef<string>('');
  const assistantTranscriptBufferRef = useRef<string>('');
  const turnReceivedOutputTranscriptionRef = useRef<boolean>(false);
  const handledToolCallIdsRef = useRef<Set<string>>(new Set());
  const playbackResumePromiseRef = useRef<Promise<void> | null>(null);
  const liveWsTurnIndexRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);

  const voiceModel = settings.models.liveProvider === 'gemini'
    ? settings.models.liveModel || 'gemini-3.8-live'
    : 'gemini-3.8-live';
  const customVoiceModel = settings.models.liveProvider === 'gemini'
    ? settings.models.liveCustomModelSlug || ''
    : '';
  const thinkingLevel = settings.live.thinkingLevel;
  const thinkingLevelRef = useRef<ThinkingLevel>(thinkingLevel);
  useEffect(() => {
    thinkingLevelRef.current = thinkingLevel;
  }, [thinkingLevel]);
  const liveWsEndpoint = settings.providers.gemini.wsEndpoint || DEFAULT_LIVE_GEMINI_WS_URL;
  // Persistent In-Memory Debug Logs (survives tab switching, capped at 2000 entries)
  const debugLogs = useDebugLogs();
  const [contentMode] = useContentMode();
  const [voiceInputEngine, setVoiceInputEngine] = useState<'raw_streaming' | 'native_recognizer'>(() => {
    return getVoiceInputEngineSetting() === 'native_stt' ? 'native_recognizer' : 'raw_streaming';
  });
  const voiceInputEngineRef = useRef<'raw_streaming' | 'native_recognizer'>(voiceInputEngine);
  useEffect(() => {
    voiceInputEngineRef.current = voiceInputEngine;
  }, [voiceInputEngine]);
  const userSpeechEndTimeRef = useRef<number>(0);
  const lastAudioActivityTimeRef = useRef<number>(0);
  const hadRecentAudioActivityRef = useRef<boolean>(false);
  const liveWsTurnRestartLoggedRef = useRef<boolean>(false);

  // Raw Audio Capture (AudioWorklet + 16kHz PCM streaming)
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micScriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const isMicStreamingRef = useRef<boolean>(false);
  const liveWsUserTextAccumulatedRef = useRef<string>('');
  const liveWsCurrentUserIdRef = useRef<string | null>(null);
  const liveWsConfigFingerprintRef = useRef<string>('');

  const restartLiveSessionIfActive = () => {
    if (liveWsRef.current) {
      addDebugLog('LiveWS:ConfigChange', `Live session restarted due to configuration change.`);
      try {
        liveWsReadyRef.current = false;
        liveWsConnectPromiseRef.current = null;
        liveWsRef.current.close(1000, "Configuration changed");
      } catch (_) {}
      liveWsRef.current = null;
    }
    if (isActiveRef.current && voiceInputEngineRef.current === 'raw_streaming') {
      const effectiveModel = customVoiceModel.trim() || voiceModel || 'gemini-3.8-live';
      ensureLiveWebSocket(effectiveModel).catch((err) => {
        console.warn('[LiveWS] Reconnect after config change failed:', err);
      });
    }
  };

  // Watch content mode, persona, or identity changes and invalidate cached Live WebSocket / Local KV cache
  useEffect(() => {
    if (liveWsRef.current) {
      addDebugLog('LiveWS:ContentMode', `ContentMode changed to "${contentMode}". Invalidate cached Live WebSocket session.`);
      try {
        liveWsReadyRef.current = false;
        liveWsConnectPromiseRef.current = null;
        liveWsRef.current.close(1000, `ContentMode changed to ${contentMode}`);
      } catch (_) {}
      liveWsRef.current = null;
      if (isActiveRef.current && voiceInputEngineRef.current === 'raw_streaming' && liveProvider === 'gemini') {
        const effectiveModel = customVoiceModel.trim() || voiceModel || 'gemini-3.8-live';
        ensureLiveWebSocket(effectiveModel).catch((err) => {
          console.warn('[LiveWS] Reconnect after contentMode change failed:', err);
        });
      }
    }
    if (liveProvider === 'local') {
      getSierraLocalVoicePlugin().invalidateKvCache().catch(() => {});
      addDebugLog(
        'LocalLLM:KvCacheInvalidated',
        `Invalidated local KV cache due to persona/identity/contentMode change (${companionIdentity}/${selectedPersona}/${contentMode})`,
      );
    }
  }, [contentMode, companionIdentity, selectedPersona]);

  const refreshOpenRouterFreeModels = async () => {
    setIsLoadingFreeModels(true);
    try {
      const res = await fetchOpenRouterFreeModels();
      if (res.ok) {
        setOpenRouterFreeModels(res.models);
      }
    } finally {
      setIsLoadingFreeModels(false);
    }
  };

  useEffect(() => {
    if (liveProvider === 'openrouter' && openRouterFreeModels.length === 0 && !isLoadingFreeModels) {
      void refreshOpenRouterFreeModels();
    }
  }, [liveProvider]);
  const [isDebugLogOpen, setIsDebugLogOpen] = useState(false);
  const [isLiveDrawerOpen, setIsLiveDrawerOpen] = useState(false);
  const drawerTouchStartYRef = useRef<number | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isFallbackModalOpen, setIsFallbackModalOpen] = useState(false);
  const [fallbackLogText, setFallbackLogText] = useState('');
  const fallbackTextareaRef = useRef<HTMLTextAreaElement>(null);
  const debugScrollRef = useRef<HTMLDivElement>(null);
  const logTimestampsRef = useRef<Map<string, number>>(new Map());

  const withNativeTimeout = async <T,>(
    promise: Promise<T>,
    ms: number = 2000,
    fallbackValue?: T,
    opName: string = 'Native operation'
  ): Promise<T | undefined> => {
    if (voiceInputEngineRef.current !== 'native_recognizer') {
      return fallbackValue;
    }
    let timeoutId: any = null;
    let didTimeout = false;
    const timeoutPromise = new Promise<T | undefined>((resolve) => {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        console.warn(`[Native STT] ${opName} timed out after ${ms}ms, continuing`);
        addDebugLog('STT:Timeout', `${opName} timed out after ${ms}ms`);
        resolve(fallbackValue);
      }, ms);
    });

    try {
      const result = await Promise.race([
        promise.then((res) => {
          if (!didTimeout) {
            console.log(`[Native STT] ${opName} completed normally`);
          }
          return res;
        }),
        timeoutPromise
      ]);
      return result;
    } catch (err: any) {
      console.warn(`[Native STT] ${opName} threw error:`, err);
      addDebugLog('STT:Error', `${opName} error: ${err?.message || String(err)}`);
      return fallbackValue;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  useEffect(() => {
    debugScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugLogs]);

  useEffect(() => {
    if (isFallbackModalOpen && fallbackTextareaRef.current) {
      fallbackTextareaRef.current.focus();
      fallbackTextareaRef.current.select();
    }
  }, [isFallbackModalOpen]);

  const copyDebugLogs = async (count?: number) => {
    if (debugLogs.length === 0) {
      toast.info("No debug events logged yet. Speak or tap the orb first.");
      return;
    }

    const textToCopy = formatDebugLogs(debugLogs, count);
    let copied = false;

    // 1. Native Capacitor Clipboard
    if (Capacitor.isNativePlatform()) {
      try {
        await Clipboard.write({ string: textToCopy });
        copied = true;
      } catch (nativeErr: any) {
        console.warn("[Clipboard] Capacitor Clipboard.write failed, falling back:", nativeErr);
      }
    }

    // 2. Browser Navigator Clipboard API
    if (!copied && typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      } catch (webErr: any) {
        console.warn("[Clipboard] navigator.clipboard.writeText failed:", webErr);
      }
    }

    // 3. Fallback: execCommand('copy') with off-screen textarea
    if (!copied && typeof document !== 'undefined') {
      try {
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = textToCopy;
        tempTextArea.style.position = 'fixed';
        tempTextArea.style.left = '-9999px';
        tempTextArea.style.top = '0';
        tempTextArea.setAttribute('readonly', '');
        document.body.appendChild(tempTextArea);
        tempTextArea.focus();
        tempTextArea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(tempTextArea);
      } catch (execErr: any) {
        console.warn("[Clipboard] document.execCommand('copy') failed:", execErr);
      }
    }

    if (copied) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      toast.success("Debug log copied. Paste it into ChatGPT.");
    } else {
      toast.error("Could not write to clipboard automatically. Select and copy from the box below.");
      setFallbackLogText(textToCopy);
      setIsFallbackModalOpen(true);
    }
  };

  const handleClearConfirm = () => {
    clearDebugLogs();
    setShowClearConfirm(false);
    toast.info("Debug log cleared.");
  };

  const sessionRef = useRef<any>(null);
  const liveWsRef = useRef<any>(null);
  const liveWsReadyRef = useRef<boolean>(false);
  const liveWsConnectPromiseRef = useRef<Promise<any> | null>(null);
  const liveWsAudioReceivedRef = useRef<boolean>(false);
  const liveWsTextAccumulatedRef = useRef<string>('');
  const liveWsCurrentSierraIdRef = useRef<string | null>(null);
  const liveWsTurnCompleteRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const modelTurnAudioStartTimeRef = useRef<number>(0);
  const clientTriggeredBargeInRef = useRef<boolean>(false);
  const lastBargeInIgnoredLogTimeRef = useRef<number>(0);
  const nextPlayTimeRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const speechRecognitionRef = useRef<any>(null);
  const nativeListenerRef = useRef<any>(null);
  const nativeStateListenerRef = useRef<any>(null);
  const nativeListenersAttachedRef = useRef<boolean>(false);
  const isSettingUpListenersRef = useRef<boolean>(false);
  const sessionIdRef = useRef<number>(0);
  const currentCycleIdRef = useRef<number>(0);
  const cycleHandledRef = useRef<number>(0);
  const isStartingRef = useRef<boolean>(false);
  const isStartInFlightRef = useRef<boolean>(false);
  const isStoppingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);
  const isNativeListeningRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const isRespondingRef = useRef<boolean>(false);
  const isActiveRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const hasLoggedPausedRef = useRef<boolean>(false);
  const clientErrorRecoveryCountRef = useRef<number>(0);
  const isRecoveringFromClientErrorRef = useRef<boolean>(false);
  const startupFailuresRef = useRef<number>(0);
  const emptyCycleCountRef = useRef<number>(0);
  const sessionRealStartTimeRef = useRef<number>(0);
  const sessionStartedTimeRef = useRef<number>(0);
  const sessionReadyTimeRef = useRef<number>(0);
  const hasReachedStartedRef = useRef<boolean>(false);
  const resumeGracePeriodUntilRef = useRef<number>(0);
  const recoveryStartedResolverRef = useRef<((value: boolean) => void) | null>(null);
  const startedConfirmationTimerRef = useRef<any>(null);
  const staleEventLoggedSessionRef = useRef<number>(-1);
  const transcriptsRef = useRef<TranscriptItem[]>([]);
  const currentTranscriptRef = useRef<string>('');
  const lastCommittedTextRef = useRef<string>('');
  const silenceTimerRef = useRef<any>(null);
  const pendingCommitTimerRef = useRef<any>(null);
  const cooldownTimerRef = useRef<any>(null);
  const retryTimerRef = useRef<any>(null);
  const recognitionTimeoutRef = useRef<any>(null);
  const consecutiveFailuresRef = useRef<number>(0);
  const committedSessionRef = useRef<number>(-1);
  const terminalHandledSessionRef = useRef<number>(-1);
  const utteranceCommitTimeRef = useRef<number>(0);
  const turnSentTimeRef = useRef<number>(0);
  const firstAudioReceivedTimeRef = useRef<number>(0);
  const lastCommitTimeRef = useRef<number>(0);
  const lastEndOfSpeechTimeRef = useRef<number>(0);
  const lastStopTimeRef = useRef<number>(0);
  const MAX_RECOGNITION_RETRIES = 3;
  const RECOGNITION_TIMEOUT_MS = 12000;
  const PLAYBACK_COOLDOWN_MS = 1200;

  // Keep refs synchronized with state
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  // Auto-scroll transcript container
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const handleTranscriptScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom <= 80;
    isNearBottomRef.current = near;
    setShowJumpToBottom(!near);
  };

  const scrollToBottom = (smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  };

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom(true);
    }
  }, [transcripts]);

  const saveCompletedLiveExchange = (params: {
    turnKey: string;
    userText: string;
    replyText: string;
    wasInterrupted?: boolean;
    spokenPrefix?: string;
    sttDropped?: boolean;
  }) => {
    if (params.sttDropped || savedTurnKeysRef.current.has(params.turnKey)) return;
    const cleanUser = (params.userText || '').trim();
    const cleanReply = (params.wasInterrupted ? params.spokenPrefix || '' : params.replyText || '').trim();
    if (!cleanUser || isPlaceholderOrErrorTurn(cleanUser) || STT_PHANTOM_BLOCKLIST.has(normalizePhantomPhrase(cleanUser))) return;
    if (params.wasInterrupted && !cleanReply) {
      return;
    }
    if (!cleanReply || isPlaceholderOrErrorTurn(cleanReply)) return;

    liveExchangeIndexRef.current += 1;
    savedTurnKeysRef.current.add(params.turnKey);
    summarizeAndSaveConversation(
      `${liveSessionIdRef.current}-ex-${liveExchangeIndexRef.current}`,
      [
        { role: 'user', content: cleanUser },
        { role: 'model', content: cleanReply },
      ],
      'Live Voice Conversation',
      'live',
      selectedLanguageRef.current,
      {
        identity: companionIdentity,
        spokenReplyOverride: params.wasInterrupted ? cleanReply : undefined,
        wasInterrupted: params.wasInterrupted,
      }
    );
  };

  const flushAndSaveLiveMemorySummary = (reason: string) => {
    // 1. Save any pending in-progress turn ONLY if user spoke and assistant spoke at least part of the reply
    const pendingUser = pendingLiveUserTurnRef.current.trim() || userTranscriptBufferRef.current.trim();
    const spokenPartial = spokenLiveTurnTextRef.current.trim();
    if (pendingUser && spokenPartial && !isPlaceholderOrErrorTurn(pendingUser) && !isPlaceholderOrErrorTurn(spokenPartial)) {
      const endKey = `flush-${reason}-${liveSessionIdRef.current}-${pendingUser.slice(0, 32)}`;
      saveCompletedLiveExchange({
        turnKey: endKey,
        userText: pendingUser,
        replyText: spokenPartial,
        wasInterrupted: true,
        spokenPrefix: spokenPartial,
      });
      pendingLiveUserTurnRef.current = '';
      spokenLiveTurnTextRef.current = '';
      return;
    }

    // 2. Otherwise save trailing completed pair from transcript if not already saved
    const validItems = transcriptsRef.current.filter(
      (t) => t.text && t.text.trim().length > 0 && !isPlaceholderOrErrorTurn(t.text)
    );
    const lastIdx = validItems.length - 1;
    if (lastIdx >= 1 && validItems[lastIdx].sender !== 'user' && validItems[lastIdx - 1].sender === 'user') {
      const turnKey = `trailing-${validItems[lastIdx - 1].id}-${validItems[lastIdx].id}`;
      saveCompletedLiveExchange({
        turnKey,
        userText: validItems[lastIdx - 1].text,
        replyText: validItems[lastIdx].text,
      });
    }
  };

  // Clean up Web Audio, video streaming, media streams, and save memory summary on unmount or backgrounding
  useEffect(() => {
    const handleVisibilityChange = () => {
      const bgEnabled = isBackgroundLiveEnabled();
      setIsBackgroundLiveMode(bgEnabled);
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushAndSaveLiveMemorySummary('app_background');
        if (isActiveRef.current) {
          if (bgEnabled) {
            addDebugLog(
              'BackgroundLive',
              '[BackgroundLive] App backgrounded with background mode ON — keeping Live session alive via foreground service & native PCM audio bridge'
            );
            if (Capacitor.isNativePlatform()) {
              SierraBackgroundVoice.startNativeAudioStream().catch(() => {});
            }
          } else {
            addDebugLog(
              'BackgroundLive',
              '[BackgroundLive] App backgrounded with background mode OFF — ending Live session'
            );
            stopSession('user');
          }
        } else {
          void prepareNativeAudioRoute('media', 'app_idle_background');
        }
      } else if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (isActiveRef.current && bgEnabled) {
          addDebugLog('BackgroundLive', '[BackgroundLive] App returned to foreground while Live session remained active');
        } else if (!isActiveRef.current) {
          void prepareNativeAudioRoute('media', 'app_idle_foreground');
        }
      }
    };
    const handlePageHide = () => {
      flushAndSaveLiveMemorySummary('pagehide');
      if (isActiveRef.current && !isBackgroundLiveEnabled()) {
        stopSession('user');
      } else if (!isActiveRef.current) {
        void prepareNativeAudioRoute('media', 'app_idle_pagehide');
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', handlePageHide);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', handlePageHide);
      }
      flushAndSaveLiveMemorySummary('unmount');
      isNativeListeningRef.current = false;
      stopVideoStreaming();
      stopSession();
    };
  }, []);

  // Cancel TTS playback, clear queue, and abort in-flight prefetch requests when user switches away from Live tab (unless Background Live is enabled)
  useEffect(() => {
    if (!isTabActive && !isBackgroundLiveEnabled()) {
      if (openRouterAbortControllerRef.current) {
        openRouterAbortControllerRef.current.abort();
        openRouterAbortControllerRef.current = null;
      }
      void stopTtsServiceSpeaking('tab_switch');
      if (localTtsQueueRef.current) {
        localTtsQueueRef.current.cancelAndClear().catch(() => {});
      }
      if (isActiveRef.current) {
        stopSession('user');
      } else {
        void prepareNativeAudioRoute('media', 'live_tab_inactive');
      }
    }
  }, [isTabActive]);

  // Auto-start Live session when triggered by Wake Word or Android Assistant gesture
  const lastHandledAutoStartRef = useRef<number>(0);
  useEffect(() => {
    if (autoStartTrigger && autoStartTrigger > 0 && autoStartTrigger !== lastHandledAutoStartRef.current) {
      lastHandledAutoStartRef.current = autoStartTrigger;
      const latestIdentity = getActiveIdentity();
      const latestPersona = getActivePersonaId();
      const latestLiveCfg = getLiveVoiceConfig(latestPersona, latestIdentity);
      setCompanionIdentity(latestIdentity);
      setSelectedPersona(latestPersona);
      setSelectedVoice(latestLiveCfg.voiceId);
      setLiveAccent(latestLiveCfg.accent);
      setLiveTone(latestLiveCfg.tone);
      addDebugLog(
        'Session:AutoStart',
        `[Session:AutoStart] Triggered Live session with identity=${latestIdentity}, persona=${latestPersona}, voice=${latestLiveCfg.voiceId}`
      );
      if (!isActiveRef.current) {
        startSession();
      }
    }
  }, [autoStartTrigger]);

  const sendVisualContextNotification = (isSharing: boolean, type: 'camera' | 'screen') => {
    const ws = liveWsRef.current;
    if (!ws || ws.readyState !== 1 || !liveWsReadyRef.current) {
      addDebugLog('Diag:VisualNoteSkipped', `Visual note deferred (readyState=${ws?.readyState}, ready=${liveWsReadyRef.current})`);
      return;
    }

    const noteText = isSharing
      ? `[System Event: The user started sharing their ${type}. You can see live visual frames streamed at ~1 fps. Describe what you see and respond to anything shown.]`
      : `[System Event: The user stopped sharing their ${type}.]`;

    try {
      ws.send(JSON.stringify({
        realtimeInput: {
          text: noteText
        }
      }));
      addDebugLog('LiveWS:VisualNote', `Sent visual note: "${noteText}"`);
      console.log('[LiveWS:VisualNote]', noteText);
    } catch (err: any) {
      addDebugLog('LiveWS:VisualNoteError', `Failed to send visual note: ${err?.message || String(err)}`);
      console.warn('[LiveWS:VisualNote] Error:', err);
    }
  };

  const sendVideoFrame = (base64Raw: string, source: 'camera' | 'screen' = 'camera') => {
    const ws = liveWsRef.current;
    if (!ws) {
      if (videoFramesSentCountRef.current % 10 === 0) {
        addDebugLog('Diag:VideoSkipped', `[Video Frame Skipped] WebSocket is null (source=${source})`);
      }
      return;
    }

    if (ws.readyState !== 1) {
      addDebugLog('Diag:VideoSkipped', `[Video Frame Skipped] ws.readyState=${ws.readyState} (not 1 OPEN, source=${source})`);
      return;
    }

    if (!liveWsReadyRef.current) {
      addDebugLog('Diag:VideoSkipped', `[Video Frame Skipped] setupComplete not yet received (source=${source})`);
      return;
    }

    let cleanBase64 = base64Raw;
    const commaIdx = cleanBase64.indexOf(',');
    if (commaIdx >= 0) {
      cleanBase64 = cleanBase64.slice(commaIdx + 1);
    }
    cleanBase64 = cleanBase64.trim();
    if (!cleanBase64) {
      addDebugLog('Diag:VideoSkipped', `[Video Frame Skipped] Frame base64 data is empty (source=${source})`);
      return;
    }

    const frameNum = videoFramesSentCountRef.current + 1;
    const currentFormat = videoFormatAttemptRef.current; // 'video' or 'mediaChunks'

    let payload: any;
    if (currentFormat === 'video') {
      payload = {
        realtimeInput: {
          video: {
            mimeType: 'image/jpeg',
            data: cleanBase64
          }
        }
      };
    } else {
      payload = {
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: 'image/jpeg',
              data: cleanBase64
            }
          ]
        }
      };
    }

    try {
      ws.send(JSON.stringify(payload));
      videoFramesSentCountRef.current = frameNum;
      hasSentFirstVideoFrameRef.current = true;

      // Log every 5th frame or frame #1
      if (frameNum === 1 || frameNum % 5 === 0) {
        const diagMsg = `[Diag:VideoFrame #${frameNum}] readyState=${ws.readyState}, base64Len=${cleanBase64.length}, shape=realtimeInput.${currentFormat}, source=${source}`;
        addDebugLog('Diag:Video', diagMsg);
        console.log(diagMsg);
      }

      framesSentCountRef.current++;
      const now = Date.now();
      const elapsed = (now - lastFpsCheckTimeRef.current) / 1000;
      if (elapsed >= 5) {
        const fps = (framesSentCountRef.current / elapsed).toFixed(1);
        const payloadBytes = Math.round((cleanBase64.length * 3) / 4);
        const payloadSizeKb = (payloadBytes / 1024).toFixed(1);
        const statsMsg = `Video (${source}): ${fps} fps, ~${payloadSizeKb} KB/frame [${currentFormat}]`;
        setVideoFpsStats(statsMsg);
        addDebugLog('LiveWS:VideoStats', statsMsg);
        framesSentCountRef.current = 0;
        lastFpsCheckTimeRef.current = now;
      }
    } catch (err: any) {
      addDebugLog('Diag:VideoError', `Failed to send video frame #${frameNum}: ${err?.message || String(err)}`);
      console.warn('[LiveWS:Video] Frame send error:', err);
    }
  };

  const stopVideoStreaming = async () => {
    const prevSource = activeVideoSourceRef.current;
    const wasSharing = isCameraActiveRef.current || isScreenShareActiveRef.current;

    if (videoFrameTimerRef.current) {
      clearInterval(videoFrameTimerRef.current);
      videoFrameTimerRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      videoStreamRef.current = null;
    }
    if (videoElementRef.current) {
      try {
        videoElementRef.current.pause();
        videoElementRef.current.srcObject = null;
      } catch (_) {}
    }

    // Stop native ScreenCapture plugin if native
    if (Capacitor.isNativePlatform()) {
      try {
        if (screenCaptureListenerRef.current) {
          if (typeof screenCaptureListenerRef.current.remove === 'function') {
            await screenCaptureListenerRef.current.remove();
          }
          screenCaptureListenerRef.current = null;
        }
        if (screenCaptureStoppedListenerRef.current) {
          if (typeof screenCaptureStoppedListenerRef.current.remove === 'function') {
            await screenCaptureStoppedListenerRef.current.remove();
          }
          screenCaptureStoppedListenerRef.current = null;
        }
        await ScreenCapture.stopScreenCapture();
        await ScreenCapture.removeAllListeners();
      } catch (e) {
        console.warn('[ScreenCapture] Error stopping native plugin:', e);
      }
    }

    setIsCameraActive(false);
    isCameraActiveRef.current = false;
    setIsScreenShareActive(false);
    isScreenShareActiveRef.current = false;
    activeVideoSourceRef.current = null;
    setVideoFpsStats('');

    if (wasSharing && prevSource) {
      sendVisualContextNotification(false, prevSource);
    }
  };

  const startFrameCaptureLoop = (source: 'camera' | 'screen' = 'camera') => {
    if (videoFrameTimerRef.current) {
      clearInterval(videoFrameTimerRef.current);
    }
    framesSentCountRef.current = 0;
    lastFpsCheckTimeRef.current = Date.now();

    videoFrameTimerRef.current = setInterval(() => {
      // Pause frame capture when document/tab is backgrounded
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      const ws = liveWsRef.current;
      if (!ws || ws.readyState !== 1 || !liveWsReadyRef.current) {
        return;
      }
      const video = videoElementRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        return;
      }

      if (!videoCanvasRef.current) {
        videoCanvasRef.current = document.createElement('canvas');
      }
      const canvas = videoCanvasRef.current;
      let w = video.videoWidth;
      let h = video.videoHeight;
      const maxLongEdge = 768;
      if (w > maxLongEdge || h > maxLongEdge) {
        if (w >= h) {
          h = Math.round(h * (maxLongEdge / w));
          w = maxLongEdge;
        } else {
          w = Math.round(w * (maxLongEdge / h));
          h = maxLongEdge;
        }
      }
      // Ensure even dimensions
      if (w % 2 !== 0) w += 1;
      if (h % 2 !== 0) h += 1;

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);

      const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.6);
      sendVideoFrame(jpegDataUrl, source);
    }, 1000); // ~1 fps
  };

  const toggleCamera = async () => {
    if (isCameraActive) {
      await stopVideoStreaming();
      toast.info("Camera disabled");
      return;
    }
    if (isScreenShareActive) {
      await stopVideoStreaming();
    }

    try {
      if (Capacitor.isNativePlatform() && (navigator as any).permissions?.query) {
        try {
          await (navigator as any).permissions.query({ name: 'camera' });
        } catch (_) {}
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      videoStreamRef.current = stream;
      if (videoElementRef.current) {
        videoElementRef.current.srcObject = stream;
        await videoElementRef.current.play();
      }
      setIsCameraActive(true);
      isCameraActiveRef.current = true;
      activeVideoSourceRef.current = 'camera';
      startFrameCaptureLoop('camera');
      sendVisualContextNotification(true, 'camera');
      toast.success("Camera streaming active (~1 fps to Sierra)");
    } catch (err: any) {
      console.error("Camera access error:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        toast.error("Camera permission denied. Please grant camera access in app settings.");
      } else {
        toast.error(`Unable to start camera: ${err.message || 'Device error'}`);
      }
      await stopVideoStreaming();
    }
  };

  const flipCamera = async () => {
    if (!isCameraActive) return;
    const newMode = cameraFacingMode === 'user' ? 'environment' : 'user';
    setCameraFacingMode(newMode);
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch (_) {}
      });
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: newMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      videoStreamRef.current = stream;
      if (videoElementRef.current) {
        videoElementRef.current.srcObject = stream;
        await videoElementRef.current.play();
      }
      toast.info(`Switched to ${newMode === 'user' ? 'front' : 'rear'} camera`);
    } catch (err: any) {
      toast.error("Failed to flip camera: " + (err.message || String(err)));
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenShareActive) {
      await stopVideoStreaming();
      toast.info("Screen sharing stopped");
      return;
    }
    if (isCameraActive) {
      await stopVideoStreaming();
    }

    // Native Android Screen Capture via Capacitor plugin
    if (Capacitor.isNativePlatform()) {
      try {
        addDebugLog('ScreenShare', 'Starting native ScreenCapture plugin via MediaProjection...');

        try {
          await ScreenCapture.removeAllListeners();
        } catch (_) {}

        screenCaptureListenerRef.current = await ScreenCapture.addListener('onScreenFrame', (frameData: any) => {
          const base64 = frameData?.base64 || frameData?.data;
          if (base64) {
            sendVideoFrame(base64, 'screen');
          }
        });

        screenCaptureStoppedListenerRef.current = await ScreenCapture.addListener('onScreenCaptureStopped', (info: any) => {
          addDebugLog('ScreenShare', `Native screen capture ended by system: ${info?.reason || 'stopped'}`);
          stopVideoStreaming();
          toast.info("Screen sharing ended");
        });

        const startRes = await ScreenCapture.startScreenCapture();
        addDebugLog('ScreenShare', `ScreenCapture plugin started: ${JSON.stringify(startRes)}`);

        setIsScreenShareActive(true);
        isScreenShareActiveRef.current = true;
        activeVideoSourceRef.current = 'screen';
        sendVisualContextNotification(true, 'screen');
        toast.success("Native screen sharing active (~1 fps to Sierra)");
        return;
      } catch (err: any) {
        console.error("Native screen capture error:", err);
        const errMsg = err?.message || String(err);
        const errCode = err?.code || '';

        let userMsg = `Screen share failed: ${errMsg}`;
        if (errCode === 'PERMISSION_DENIED' || errMsg.includes('denied') || errMsg.includes('cancelled')) {
          userMsg = "Screen sharing cancelled or permission denied by user.";
          addDebugLog('ScreenShare:Denied', userMsg);
          toast.info(userMsg);
        } else if (errCode === 'SECURITY_ERROR' || errMsg.includes('SecurityException') || errMsg.includes('foreground')) {
          userMsg = "Foreground service failed to start for screen capture.";
          addDebugLog('ScreenShare:SecurityError', userMsg);
          toast.error(userMsg);
        } else if (errCode === 'SERVICE_FAILED' || errMsg.includes('MediaProjection')) {
          userMsg = "MediaProjection service failed to start on this device.";
          addDebugLog('ScreenShare:ServiceFailed', userMsg);
          toast.error(userMsg);
        } else {
          addDebugLog('ScreenShare:Error', userMsg);
          toast.error(userMsg);
        }

        await stopVideoStreaming();
        return;
      }
    }

    // Web Browser fallback
    if (!navigator.mediaDevices || typeof (navigator.mediaDevices as any).getDisplayMedia !== 'function') {
      toast.error("Screen share is not supported in this environment.");
      return;
    }

    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      videoStreamRef.current = stream;
      if (videoElementRef.current) {
        videoElementRef.current.srcObject = stream;
        await videoElementRef.current.play();
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopVideoStreaming();
          toast.info("Screen share ended");
        };
      }
      setIsScreenShareActive(true);
      isScreenShareActiveRef.current = true;
      activeVideoSourceRef.current = 'screen';
      startFrameCaptureLoop('screen');
      sendVisualContextNotification(true, 'screen');
      toast.success("Screen sharing active (~1 fps to Sierra)");
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        toast.info("Screen sharing cancelled");
      } else {
        toast.error(`Screen share error: ${err.message || 'Permission denied'}`);
      }
      await stopVideoStreaming();
    }
  };

  const handleSelectPersona = (personaId: string) => {
    const persona = SIERRA_PERSONAS.find(p => p.id === personaId);
    if (!persona) return;
    setSelectedPersona(personaId);
    setActivePersonaId(personaId);
    const liveCfg = getLiveVoiceConfig(personaId as PersonaId, companionIdentity);
    setSelectedVoice(liveCfg.voiceId);
    setLiveAccent(liveCfg.accent);
    setLiveTone(liveCfg.tone);
    setIsPersonaModalOpen(false);
    toast.success(`Switched persona to ${persona.name}`);
    restartLiveSessionIfActive();
  };

  const handleSelectLanguage = (langCode: string) => {
    const savedLang = setLiveLanguageSetting(langCode);
    setSelectedLanguage(savedLang);
    setIsLanguageModalOpen(false);
    toast.success(`Language locked to ${savedLang}`);
    restartLiveSessionIfActive();
  };

  // Note: voiceModel, customVoiceModel, liveWsEndpoint & thinkingLevel come directly from useUnifiedSettings()

  // On launch: hydrate non-secret persistent state from Android SharedPreferences and audit all Android permissions
  useEffect(() => {
    void hydratePersistentStateFromNative();
    void auditDevicePermissionsOnLaunch();
  }, []);

  const persistVoiceMessage = async (sender: 'user' | 'sierra', text: string) => {
    if (!text.trim() || !user || !db) return;
    const effectiveModel = customVoiceModel.trim() || voiceModel || 'gemini-3.8-live';
    try {
      await addDoc(collection(db, `users/${user.uid}/sessions/live-voice-session/messages`), {
        role: sender === 'user' ? 'user' : 'model',
        content: text,
        timestamp: Date.now(),
        isVoice: true,
        modelName: `Sierra Live (${effectiveModel})`,
      });
    } catch (err) {
      console.warn("Could not save live voice transcript to Firestore:", err);
    }
  };

  const getBackoffDelay = (attempt: number): number => {
    // Exponential backoff for consecutive failures (500 ms, 1 s, 2 s, 4 s)
    if (attempt <= 1) return 500;
    if (attempt === 2) return 1000;
    if (attempt === 3) return 2000;
    return 4000;
  };

  const cancelAllTimers = () => {
    if (pendingCommitTimerRef.current) {
      clearTimeout(pendingCommitTimerRef.current);
      pendingCommitTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (recognitionTimeoutRef.current) {
      clearTimeout(recognitionTimeoutRef.current);
      recognitionTimeoutRef.current = null;
    }
    if (startedConfirmationTimerRef.current) {
      clearTimeout(startedConfirmationTimerRef.current);
      startedConfirmationTimerRef.current = null;
    }
    if (recoveryStartedResolverRef.current) {
      recoveryStartedResolverRef.current(false);
      recoveryStartedResolverRef.current = null;
    }
  };

  const pauseListening = (reason: string) => {
    isPausedRef.current = true;
    setIsPaused(true);
    isListeningRef.current = false;
    isNativeListeningRef.current = false;
    isStartingRef.current = false;
    isStartInFlightRef.current = false;
    isRecoveringFromClientErrorRef.current = false;
    cancelAllTimers();
    if (Capacitor.isNativePlatform()) {
      isStoppingRef.current = true;
      withNativeTimeout(CapSpeechRecognition.stop(), 1500, undefined, 'CapSpeechRecognition.stop()')
        .catch(() => {})
        .finally(() => {
          isStoppingRef.current = false;
          lastStopTimeRef.current = Date.now();
        });
    }
    void prepareNativeAudioRoute('media', 'live_paused');
    if (!hasLoggedPausedRef.current) {
      hasLoggedPausedRef.current = true;
      addDebugLog('STT:Paused', reason);
      console.log("[STT:Paused]", reason);
    }
  };

  const scheduleListeningRestart = (delayMs: number = PLAYBACK_COOLDOWN_MS) => {
    // Native recognizer engine only
    if (voiceInputEngineRef.current !== 'native_recognizer') {
      return;
    }
    // The paused state must be checked before restarting. Once paused, nothing may call start again until the user taps the mic.
    if (!isActiveRef.current || isPausedRef.current || mode !== 'continuous') {
      return;
    }
    if (isSpeakingRef.current || activeSourcesRef.current.length > 0) {
      addDebugLog('STT:WaitingForAudio', 'Restart deferred: audio playback is active or queued');
      console.log("[Native STT] scheduleListeningRestart deferred because audio is playing or queued");
      return;
    }
    const safeDelay = Math.max(delayMs, 300);
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    cooldownTimerRef.current = setTimeout(async () => {
      cooldownTimerRef.current = null;
      if (voiceInputEngineRef.current !== 'native_recognizer') {
        return;
      }
      if (!isActiveRef.current || isPausedRef.current || isSpeakingRef.current || isRespondingRef.current || mode !== 'continuous' || activeSourcesRef.current.length > 0) {
        if (isSpeakingRef.current || activeSourcesRef.current.length > 0) {
          addDebugLog('STT:WaitingForAudio', 'Restart deferred: audio playback is active or queued');
        }
        return;
      }
      // After any stop or teardown, await CapSpeechRecognition.stop() with a timeout, then wait at least 800 ms before calling start() again.
      if (Capacitor.isNativePlatform()) {
        isStoppingRef.current = true;
        try {
          await withNativeTimeout(CapSpeechRecognition.stop(), 1500, undefined, 'CapSpeechRecognition.stop()');
        } catch (_) {}
        isStoppingRef.current = false;
        lastStopTimeRef.current = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (!isActiveRef.current || isPausedRef.current || isSpeakingRef.current || isRespondingRef.current || isStoppingRef.current || mode !== 'continuous' || activeSourcesRef.current.length > 0) {
        if (isSpeakingRef.current || activeSourcesRef.current.length > 0) {
          addDebugLog('STT:WaitingForAudio', 'Restart deferred: audio playback is active or queued');
        }
        return;
      }
      startSpeechToText();
    }, safeDelay);
  };

  const checkAndRestartListeningAfterTurn = () => {
    // Native recognizer engine only
    if (voiceInputEngineRef.current !== 'native_recognizer') {
      return;
    }
    // 1. Must be active, continuous mode, and NOT paused (respects errorCode 5 and manual pause)
    if (!isActiveRef.current || isPausedRef.current || mode !== 'continuous') {
      return;
    }
    // Prevent duplicate restart triggers within the same completed turn
    if (liveWsTurnRestartLoggedRef.current) {
      return;
    }
    // 2. Only proceed if model turn is complete, not generating response, not currently speaking, and no active audio sources playing
    if (liveWsTurnCompleteRef.current && !isRespondingRef.current && !isSpeakingRef.current && activeSourcesRef.current.length === 0) {
      liveWsTurnRestartLoggedRef.current = true;
      // 3. Ensure only one restart is ever pending: clear any existing restart cooldown timer
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }

      // 4. Reset native listening ref and state before restarting (do NOT set isPausedRef.current = false)
      isNativeListeningRef.current = false;
      isStartingRef.current = false;
      isStartInFlightRef.current = false;
      setUserSpeechDetected(false);

      // 5. Add debug log line once per completed turn
      addDebugLog('STT:AutoRestart', 'Model turn complete and audio playback finished. Auto-restarting continuous listening...');
      console.log('[LiveVoice] Model turn complete and audio playback finished. Scheduling listening restart with 800ms cooldown.');

      // 6. Schedule listening restart with 800ms cooldown delay
      scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
    }
  };

  const playTextToSpeech = async (text: string) => {
    if (!text.trim()) return;

    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }

    // Cancel any active 24kHz WebAudio or prior TTS before starting new speech
    stopPlayback();

    // Properly stop and fully release native speech recognition plugin before TTS playback begins
    await withNativeTimeout(stopSpeechToText(), 2000, undefined, 'stopSpeechToText()');

    // Clean markdown symbols for natural TTS speech
    const cleanText = text.replace(/[*#_`~>]/g, '').trim();
    if (!cleanText) return;

    // 1. Native Capacitor Text-to-Speech on Android / iOS
    if (Capacitor.isNativePlatform()) {
      try {
        await TextToSpeech.stop();
      } catch (_) {}
      setIsSpeaking(true);
      isSpeakingRef.current = true;
      addDebugLog('TTS:Start', `Starting native TextToSpeech.speak() (${cleanText.length} chars)`);
      console.log("[Native TTS:Start] Starting speak:", cleanText);

      let didTimeout = false;
      let timer: any = null;
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          didTimeout = true;
          addDebugLog('TTS:Timeout', 'Native TextToSpeech.speak() timed out after 15000ms');
          console.warn("[Native TTS:Timeout] speak() timed out after 15000ms");
          resolve('timeout');
        }, 15000);
      });

      try {
        const result = await Promise.race([
          TextToSpeech.speak({
            text: cleanText,
            lang: 'en-US',
            rate: 1.0,
          }).then(() => 'finished' as const),
          timeoutPromise
        ]);

        if (result === 'finished' && !didTimeout) {
          addDebugLog('TTS:Finished', 'Native TextToSpeech.speak() completed successfully');
          console.log("[Native TTS:Finished] speak() completed successfully");
        }
      } catch (err: any) {
        addDebugLog('TTS:Error', `Native TextToSpeech error: ${err?.message || String(err)}`);
        console.error("[Native TTS:Error] Native TextToSpeech speak error:", err);
      } finally {
        if (timer) clearTimeout(timer);
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        if (isActiveRef.current && mode === 'continuous') {
          isPausedRef.current = false;
          setIsPaused(false);
        }
        scheduleListeningRestart();
      }
      return;
    }

    // 2. Web browser fallback with SpeechSynthesis
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      if (isActiveRef.current && mode === 'continuous') {
        isPausedRef.current = false;
        setIsPaused(false);
        scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
      }
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      // Pick natural voice if available
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const preferred = voices.find(v => 
          v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Female'))
        ) || voices.find(v => v.lang.startsWith('en'));
        if (preferred) {
          utterance.voice = preferred;
        }
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        addDebugLog('TTS:Start', `Web SpeechSynthesis started (${cleanText.length} chars)`);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        addDebugLog('TTS:Finished', 'Web SpeechSynthesis completed');
        // Resume continuous listening ONLY after playback fully completes, with a short cooldown buffer
        // to avoid catching playback tail audio from the device speaker
        if (isActiveRef.current && mode === 'continuous') {
          isPausedRef.current = false;
          setIsPaused(false);
          scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
        }
      };

      utterance.onerror = (e) => {
        console.warn("TTS playback error:", e);
        addDebugLog('TTS:Error', `Web SpeechSynthesis error: ${e.error || 'unknown'}`);
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        if (isActiveRef.current && mode === 'continuous') {
          isPausedRef.current = false;
          setIsPaused(false);
          scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (ttsErr: any) {
      console.warn("TTS execution error:", ttsErr);
      addDebugLog('TTS:Error', `Web SpeechSynthesis exception: ${ttsErr?.message || String(ttsErr)}`);
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (isActiveRef.current && mode === 'continuous') {
        scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
      }
    }
  };

  const commitCurrentUtterance = async (cycleId?: number) => {
    const currentId = cycleId ?? currentCycleIdRef.current;
    if (committedSessionRef.current === currentId && currentId > 0) {
      return;
    }
    if (cycleHandledRef.current === currentId && currentId > 0) {
      return;
    }
    cycleHandledRef.current = currentId;

    if (pendingCommitTimerRef.current) {
      clearTimeout(pendingCommitTimerRef.current);
      pendingCommitTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionTimeoutRef.current) {
      clearTimeout(recognitionTimeoutRef.current);
      recognitionTimeoutRef.current = null;
    }

    const textToCommit = currentTranscriptRef.current.trim();
    currentTranscriptRef.current = '';
    setUserSpeechDetected(false);

    addDebugLog('commitCurrentUtterance', `[Cycle #${currentId}] captured: "${textToCommit}" (isSpeaking=${isSpeakingRef.current}, isResponding=${isRespondingRef.current})`);

    if (!textToCommit) {
      addDebugLog('STT:UtteranceDropped', `[Cycle #${currentId}] Utterance dropped: buffer was empty`);
      console.log(`[Native STT:Commit:Cycle#${currentId}] Buffer empty, no speech to commit.`);
      handleSilenceOrEmpty(currentId);
      return;
    }

    if (isSpeakingRef.current || isRespondingRef.current || activeSourcesRef.current.length > 0) {
      addDebugLog('STT:UtteranceIgnored', `[Cycle #${currentId}] Utterance ignored: Sierra audio is currently playing or queued`);
      console.log(`[Native STT:Commit:Cycle#${currentId}] Ignored: Sierra audio is currently playing or queued.`);
      return;
    }

    if (textToCommit === lastCommittedTextRef.current) {
      addDebugLog('STT:UtteranceIgnored', `[Cycle #${currentId}] Utterance ignored: Duplicate of already-sent utterance "${textToCommit}"`);
      console.log(`[Native STT:Commit:Cycle#${currentId}] Ignored: Duplicate of already-sent utterance "${textToCommit}".`);
      return;
    }

    committedSessionRef.current = currentId;
    lastCommittedTextRef.current = textToCommit;
    utteranceCommitTimeRef.current = Date.now();

    addDebugLog('STT:UtteranceCommitted', `[Cycle #${currentId}] Utterance committed: "${textToCommit}"`);
    console.log(`[Native STT:FinalResult:Cycle#${currentId}] Complete user utterance captured:`, textToCommit);
    console.log(`[Native STT:Handoff:Cycle#${currentId}] Dispatching utterance to handleUserUtterance...`);
    lastCommitTimeRef.current = Date.now();
    consecutiveFailuresRef.current = 0;
    clientErrorRecoveryCountRef.current = 0;
    emptyCycleCountRef.current = 0;
    startupFailuresRef.current = 0;
    isPausedRef.current = false;
    setIsPaused(false);
    await stopSpeechToText();
    await handleUserUtterance(textToCommit);
  };

  const handleClientErrorRecovery = async (targetSessionId: number) => {
    if (!isActiveRef.current || isPausedRef.current) return;
    if (isRecoveringFromClientErrorRef.current) {
      console.log("[Native STT:ClientRecovery] Recovery already in progress, ignoring duplicate call");
      return;
    }

    isRecoveringFromClientErrorRef.current = true;
    isStartingRef.current = false;
    isListeningRef.current = false;
    isNativeListeningRef.current = false;
    cancelAllTimers();

    // Each recovery attempt awaits teardown, 750ms wait, start, confirmation of started event (or 2s timeout) before counting
    if (clientErrorRecoveryCountRef.current < 2) {
      const attempt = clientErrorRecoveryCountRef.current + 1;
      addDebugLog('STT:ClientRecovery', `[Session #${targetSessionId}] Recovering from client error (attempt ${attempt}/2)...`);
      console.warn(`[Native STT:ClientRecovery:Session#${targetSessionId}] Recovering from client error (${attempt}/2)...`);

      // 1. Await teardown
      isStoppingRef.current = true;
      try {
        await withNativeTimeout(CapSpeechRecognition.stop(), 1500, undefined, 'CapSpeechRecognition.stop()');
      } catch (_) {}
      await teardownNativeListeners();
      isStoppingRef.current = false;
      lastStopTimeRef.current = Date.now();
      addDebugLog('STT:ClientRecovery', `[Session #${targetSessionId}] Teardown complete`);
      console.log("[Native STT:ClientRecovery] Teardown complete");

      // 2. Waiting 1000ms
      addDebugLog('STT:ClientRecovery', `[Session #${targetSessionId}] Waiting 1000ms before restarting...`);
      console.log("[Native STT:ClientRecovery] Waiting 1000ms before restarting...");
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (!isActiveRef.current || isPausedRef.current || isSpeakingRef.current || isRespondingRef.current || mode !== 'continuous' || activeSourcesRef.current.length > 0) {
        isRecoveringFromClientErrorRef.current = false;
        return;
      }

      // 3. Start recognizer
      await setupNativeListeners();
      const startedPromise = new Promise<boolean>((resolve) => {
        recoveryStartedResolverRef.current = resolve;
      });

      if (startedConfirmationTimerRef.current) {
        clearTimeout(startedConfirmationTimerRef.current);
        startedConfirmationTimerRef.current = null;
      }
      const timeoutPromise = new Promise<boolean>((resolve) => {
        startedConfirmationTimerRef.current = setTimeout(() => {
          startedConfirmationTimerRef.current = null;
          resolve(false);
        }, 4000);
      });

      startSpeechToText();

      // 4. Confirmation of "started" event (or 4s timeout)
      const confirmed = await Promise.race([startedPromise, timeoutPromise]);
      if (startedConfirmationTimerRef.current) {
        clearTimeout(startedConfirmationTimerRef.current);
        startedConfirmationTimerRef.current = null;
      }
      recoveryStartedResolverRef.current = null;

      if (confirmed) {
        addDebugLog('STT:ClientRecovery', `[Session #${targetSessionId}] Started confirmed for recovery attempt ${attempt}/2`);
        console.log(`[Native STT:ClientRecovery] Started confirmed for recovery attempt ${attempt}/2`);
        clientErrorRecoveryCountRef.current = 0;
      } else {
        addDebugLog('STT:ClientRecovery', `[Session #${targetSessionId}] Started confirmation timed out after 4s for recovery attempt ${attempt}/2`);
        console.warn(`[Native STT:ClientRecovery] Started confirmation timed out after 4s for recovery attempt ${attempt}/2`);
        clientErrorRecoveryCountRef.current = attempt;
      }

      isRecoveringFromClientErrorRef.current = false;
    } else {
      isRecoveringFromClientErrorRef.current = false;
      addDebugLog('STT:Error', `Speech recognizer unavailable after 2 recovery attempts`);
      setConnectionError("Speech recognizer unavailable, tap mic to retry");
      toast.error("Speech recognizer unavailable, tap mic to retry");
      try {
        await withNativeTimeout(CapSpeechRecognition.stop(), 1500, undefined, 'CapSpeechRecognition.stop()');
      } catch (_) {}
      await teardownNativeListeners();
      stopSession('recovery_failed');
      pauseListening("Speech recognizer unavailable, tap mic to retry");
    }
  };

  const handleSilenceOrEmpty = (targetSessionId?: number) => {
    if (!isActiveRef.current || isPausedRef.current) {
      return;
    }
    const currentId = targetSessionId ?? sessionIdRef.current;
    if (cycleHandledRef.current === currentId && currentId > 0) {
      return;
    }
    cycleHandledRef.current = currentId;

    isListeningRef.current = false;
    isNativeListeningRef.current = false;
    isStartingRef.current = false;
    setUserSpeechDetected(false);

    if (isSpeakingRef.current || isRespondingRef.current || mode !== 'continuous') {
      return;
    }

    const reachedStarted = hasReachedStartedRef.current;
    const sessionDuration = reachedStarted && sessionStartedTimeRef.current > 0
      ? Date.now() - sessionStartedTimeRef.current
      : 0;

    // Only count a cycle toward the "3 empty cycles" pause if it reached "started" and ran at least 3 seconds without speech
    if (reachedStarted && sessionDuration >= 3000) {
      consecutiveFailuresRef.current++;
      addDebugLog('STT:SilenceOrEmpty', `[Session #${currentId}] Round completed without speech after ${Math.round(sessionDuration / 1000)}s (failures: ${consecutiveFailuresRef.current}/${MAX_RECOGNITION_RETRIES})`);
      console.log(`[Native STT:Session#${currentId}] Consecutive silence/empty count: ${consecutiveFailuresRef.current}/${MAX_RECOGNITION_RETRIES}`);

      if (consecutiveFailuresRef.current >= MAX_RECOGNITION_RETRIES) {
        console.warn(`[Native STT:Session#${currentId}] Continuous listening paused after maximum inactivity.`);
        pauseListening(`Continuous listening paused after ${MAX_RECOGNITION_RETRIES} empty cycles. Tap mic to resume.`);
        toast.info("Listening paused. Tap microphone to resume.");
        return;
      }
      const backoff = getBackoffDelay(consecutiveFailuresRef.current);
      addDebugLog('STT:Retry', `[Session #${currentId}] Scheduling listening retry with ${backoff}ms backoff (attempt ${consecutiveFailuresRef.current}/${MAX_RECOGNITION_RETRIES})`);
      scheduleListeningRestart(backoff);
    } else {
      addDebugLog('STT:SilenceOrEmpty', `[Session #${currentId}] Cycle did not run >= 3s with started status (${sessionDuration}ms), not counting as empty cycle`);
      scheduleListeningRestart(500);
    }
  };

  const getLiveVoiceConfigFingerprint = (targetModel: string, endpoint: string): string => {
    const activeMode = getContentMode();
    const identity = getActiveIdentity();
    const activePersona = getActivePersonaId() || 'classy';
    const liveCfg = getLiveVoiceConfig(activePersona, identity);
    const customDirectives = getCustomDirectives();
    const lang = getLiveLanguageSetting();
    const derivedLocale = deriveLanguageCodeFromAccent(liveCfg.accent, lang);
    const thinkingPart = isGeminiLiveExtendedThinkingModel(targetModel)
      ? (getStoredGeminiThinkingLevel() ?? thinkingLevelRef.current)
      : 'none';
    return `${targetModel}:${thinkingPart}:${activeMode}:${identity}:${activePersona}:${liveCfg.voiceId}:${liveCfg.accent}:${liveCfg.tone}:${derivedLocale}:${customDirectives}:${endpoint}`;
  };

  const ensureLiveWebSocket = async (model: string): Promise<any> => {
    const targetModel = (model || '').trim();
    if (!targetModel) {
      throw new Error('Live model identifier must be specified before connecting.');
    }
    const baseEndpoint = getProviderWsEndpoint('gemini');
    const currentFingerprint = getLiveVoiceConfigFingerprint(targetModel, baseEndpoint);

    // If configuration changed (e.g. content mode, thinking level, or persona was switched), close cached connection
    if (liveWsRef.current && liveWsConfigFingerprintRef.current && liveWsConfigFingerprintRef.current !== currentFingerprint) {
      addDebugLog('LiveWS:ConfigChange', `Live session configuration changed (${liveWsConfigFingerprintRef.current} -> ${currentFingerprint}). Resetting cached WebSocket.`);
      try {
        liveWsReadyRef.current = false;
        liveWsConnectPromiseRef.current = null;
        liveWsRef.current.close(1000, "Configuration changed");
      } catch (_) {}
      liveWsRef.current = null;
    }

    // Reuse single open WebSocket connection across utterances
    if (liveWsRef.current && (liveWsRef.current.readyState === 1 || liveWsRef.current.readyState === (WebSocket as any)?.OPEN)) {
      if (liveWsReadyRef.current) {
        return liveWsRef.current;
      }
      if (liveWsConnectPromiseRef.current) {
        return await liveWsConnectPromiseRef.current;
      }
    }

    if (liveWsConnectPromiseRef.current) {
      return await liveWsConnectPromiseRef.current;
    }

    const connectPromise = new Promise<any>((resolve, reject) => {
      try {
        const apiKey = getProviderApiKey('gemini');
        if (!apiKey) {
          setLiveAuth401Provider('gemini');
          throw new Error("Invalid or unrecognized API key for Google Gemini. Please configure your Gemini key in Settings.");
        }

        const formattedModel = targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`;
        const isExtendedThinking = isGeminiLiveExtendedThinkingModel(formattedModel);

        // Validate model and (for Extended Thinking) thinking level BEFORE opening WebSocket
        const activeMode = getContentMode();
        const identity = getActiveIdentity();
        const activePersonaId = getActivePersonaId();
        const activeLanguage = getLiveLanguageSetting();
        const customDirectives = getCustomDirectives() || undefined;
        const effectiveThinkingLevel = isExtendedThinking
          ? validateThinkingLevel(getStoredGeminiThinkingLevel() ?? thinkingLevelRef.current)
          : undefined;

        const preValidatedSetup = resolveAndBuildLiveSetupPayload({
          model: formattedModel,
          identity,
          personaId: activePersonaId,
          contentMode: activeMode,
          languageCode: activeLanguage,
          customDirectives,
          audioOutputMode: audioOutputModeRef.current,
          sessionResumptionHandle: liveSessionResumptionHandleRef.current,
          ...(isExtendedThinking ? { thinkingLevel: effectiveThinkingLevel } : {}),
        });

        let wsUrl = baseEndpoint;
        if (!wsUrl.includes('key=')) {
          const sep = wsUrl.includes('?') ? '&' : '?';
          wsUrl = `${wsUrl}${sep}key=${encodeURIComponent(apiKey)}`;
        }

        const WebSocketClass = typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
        if (!WebSocketClass) {
          throw new Error("WebSocket API is not supported in this environment");
        }

        addDebugLog('LiveWS:Connect', `Connecting to Gemini Live WebSocket: ${baseEndpoint} (model: ${formattedModel}${isExtendedThinking ? `, thinkingLevel: ${effectiveThinkingLevel}` : ''})`);
        console.log(`[LiveWS:Connect] Connecting to ${baseEndpoint} with model ${formattedModel}`);

        const ws = new WebSocketClass(wsUrl);
        liveWsRef.current = ws;
        liveWsReadyRef.current = false;

        let setupResolved = false;

        ws.onopen = () => {
          addDebugLog('LiveWS:Open', 'WebSocket connection established. Sending setup with responseModalities: ["AUDIO"] and inputAudioTranscription');
          console.log("[LiveWS:Open] WebSocket connected, sending setup with responseModalities: ['AUDIO'] and inputAudioTranscription");

          liveWsConfigFingerprintRef.current = currentFingerprint;

          const {
            setupMessage: resolvedSetup,
            savedConfigVoice,
            sentVoiceName: activeVoice,
            resolvedLanguageCode,
            selectedGender,
            resolvedVoiceGender,
            liveConfig: liveCfg,
          } = preValidatedSetup;

          const setupMessage = {
            setup: {
              ...resolvedSetup.setup,
              generationConfig: {
                ...resolvedSetup.setup.generationConfig,
                responseModalities: ["AUDIO"],
                ...(resolvedSetup.setup.generationConfig.thinkingConfig
                  ? { thinkingConfig: resolvedSetup.setup.generationConfig.thinkingConfig }
                  : {}),
              },
              sessionResumption: resolvedSetup.setup.sessionResumption,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          };

          setSelectedVoice(activeVoice);
          setSelectedLanguage(resolvedLanguageCode);

          logSessionStartSummary('Live', identity, activePersonaId, activeMode, activeVoice);
          addDebugLog('Diag', `[Diag] AudioMode: ${audioOutputModeRef.current}`);
          addDebugLog(
            'Diag',
            `[Diag] SelectedLanguage: ${resolvedLanguageCode} (appliedToTranscription: ${preValidatedSetup.appliedToTranscription} [via ${preValidatedSetup.transcriptionLanguageMethod}; inputAudioTranscription has no language field])`
          );
          if (liveSessionResumptionHandleRef.current) {
            addDebugLog(
              'LiveWS:SessionResumption',
              `[LiveWS:SessionResumption] Sending setup with resumption handle (${liveSessionResumptionHandleRef.current.slice(0, 16)}...)`
            );
          }
          addDebugLog(
            'LiveWS:VoiceConfig',
            `[LiveVoiceConfig] savedConfigVoice="${savedConfigVoice}" | sentVoiceName="${activeVoice}" | selectedGender="${selectedGender}" | resolvedVoiceGender="${resolvedVoiceGender}" | identity=${identity}, persona=${activePersonaId}, accent="${liveCfg.accent || 'default'}", tone="${liveCfg.tone || 'natural'}", languageCode="${resolvedLanguageCode}", audioMode="${audioOutputModeRef.current}"`
          );

          const voiceStyleDirective = buildVoiceStyleDirective(liveCfg.accent, liveCfg.tone, resolvedLanguageCode);
          addDebugLog('VoiceStyle', `[VoiceStyle] ${voiceStyleDirective.replace(/\n+/g, ' ')}`);
          console.log(`[VoiceStyle] ${voiceStyleDirective.replace(/\n+/g, ' ')}`);

          const systemInstructionText = setupMessage.setup.systemInstruction.parts[0]?.text || '';
          addDebugLog(
            'LiveWS:SpeechConfig',
            `[LiveWS:SpeechConfig] speechConfig=${JSON.stringify({
              voiceName: activeVoice,
              languageCode: resolvedLanguageCode,
            })} | systemInstruction[0..300]=${JSON.stringify(systemInstructionText.slice(0, 300))}`
          );
          if (promptDumpSessionIdRef.current !== liveSessionIdRef.current) {
            promptDumpSessionIdRef.current = liveSessionIdRef.current;
            addDebugLog(
              'PromptDump',
              `[GeminiLive:PromptDump] model=${formattedModel}, identity=${identity}, persona=${activePersonaId}, mode=${activeMode}, chars=${systemInstructionText.length}\n${systemInstructionText}`,
            );
          }
          addDebugLog('Diag', `[Diag] LiveWS setup payload: ${JSON.stringify(setupMessage)}`);
          try {
            ws.send(JSON.stringify(setupMessage));
          } catch (sendErr: any) {
            addDebugLog('LiveWS:SetupError', `Failed to send setup message: ${sendErr?.message || String(sendErr)}`);
            console.error("[LiveWS:Setup] Failed to send setup:", sendErr);
            if (!setupResolved) {
              setupResolved = true;
              liveWsConnectPromiseRef.current = null;
              reject(sendErr);
            }
          }
        };

        const finalizePendingUserBubble = (reason: string) => {
          if (userPauseMergeTimerRef.current) {
            clearTimeout(userPauseMergeTimerRef.current);
            userPauseMergeTimerRef.current = null;
          }
          const userText = userTranscriptBufferRef.current.trim();
          if (userText && userText !== lastFinalizedUserTextRef.current) {
            lastFinalizedUserTextRef.current = userText;
            setTranscripts(prev => [...prev, {
              id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sender: 'user',
              text: userText,
              timestamp: Date.now()
            }]);
            persistVoiceMessage('user', userText);
            addDebugLog('LiveWS:UserFinalized', `Finalized user bubble (${reason}): "${userText}"`);
          }
          userTranscriptBufferRef.current = '';
        };

        ws.onmessage = async (event: any) => {
          let dataStr = '';
          try {
            if (typeof event.data === 'string') {
              dataStr = event.data;
            } else if (event.data instanceof Blob) {
              dataStr = await event.data.text();
            } else if (event.data instanceof ArrayBuffer) {
              dataStr = new TextDecoder().decode(event.data);
            } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(event.data)) {
              dataStr = event.data.toString('utf-8');
            } else if (event.data && typeof event.data.toString === 'function') {
              dataStr = event.data.toString();
            }

            const parsed = JSON.parse(dataStr);

            // [Diag] Quiet empty server messages ({} or { serverContent: {} }) - count and log summary every 50
            const topKeys = Object.keys(parsed);
            const isEmptyServerContentOnly =
              topKeys.length === 1 &&
              topKeys[0] === 'serverContent' &&
              parsed.serverContent &&
              typeof parsed.serverContent === 'object' &&
              Object.keys(parsed.serverContent).length === 0;
            if (topKeys.length === 0 || isEmptyServerContentOnly) {
              emptyServerMsgCountRef.current += 1;
              if (emptyServerMsgCountRef.current % 50 === 0) {
                addDebugLog('Diag', `[Diag] Empty server messages ({}) count: ${emptyServerMsgCountRef.current}`);
              }
              return;
            }

            let serverSubKeys = '';
            if (parsed.serverContent) {
              serverSubKeys = ` (serverContent: [${Object.keys(parsed.serverContent).join(', ')}])`;
            }
            addDebugLog('Diag', `[Diag] Server message keys: [${topKeys.join(', ')}]${serverSubKeys}`);

            // Diagnostic logging of all server messages received after the first video frame is sent
            if (hasSentFirstVideoFrameRef.current) {
              const postVideoSummary = `[Post-Video Server Msg] keys: [${topKeys.join(', ')}]${serverSubKeys}`;
              addDebugLog('Diag:PostVideo', postVideoSummary);
              console.log(postVideoSummary);

              if (parsed.error) {
                const errJson = JSON.stringify(parsed.error);
                addDebugLog('LiveWS:ServerError', `[Post-Video Server Error]: ${errJson}`);
                console.error("[Post-Video Server Error]", parsed.error);
                const errLower = errJson.toLowerCase();
                if (errLower.includes('video') || errLower.includes('unknown name') || errLower.includes('invalid') || errLower.includes('payload')) {
                  if (videoFormatAttemptRef.current !== 'mediaChunks') {
                    videoFormatAttemptRef.current = 'mediaChunks';
                    addDebugLog('LiveWS:VideoFallback', `Server rejected realtimeInput.video shape, automatically falling back to legacy realtimeInput.mediaChunks`);
                  }
                }
              }

              if (parsed.goAway) {
                addDebugLog('LiveWS:GoAway', `[Post-Video GoAway]: ${JSON.stringify(parsed.goAway)}`);
              }

              const nonContentKeys = topKeys.filter(k => k !== 'serverContent');
              if (nonContentKeys.length > 0) {
                const nonContentPayload = JSON.stringify(nonContentKeys.map(k => ({ [k]: parsed[k] })));
                addDebugLog('Diag:PostVideoNonContent', `[Post-Video Non-Content]: ${nonContentPayload}`);
              }

              if (parsed.serverContent && !parsed.error && videoFormatAcceptedRef.current === 'unknown') {
                videoFormatAcceptedRef.current = videoFormatAttemptRef.current;
                addDebugLog('LiveWS:VideoAccepted', `Server accepted video format shape: realtimeInput.${videoFormatAcceptedRef.current}`);
              }
            }

            // Log full JSON (truncated to 300 chars) of every non-audio server message
            const hasAudioPart = Boolean(parsed.serverContent?.modelTurn?.parts?.some((p: any) => p?.inlineData?.data));
            if (!hasAudioPart) {
              const truncatedJson = dataStr.length > 300 ? dataStr.slice(0, 300) + '...' : dataStr;
              addDebugLog('Diag', `[Diag] Non-audio server message: ${truncatedJson}`);
            }

            // Handle voiceActivity start/end for the UI "hearing" state & user bubble pause merging
            const va = parsed.voiceActivity || parsed.serverContent?.voiceActivity;
            if (va) {
              const actType = String(va.activityType || va.voiceActivityType || va.type || (va.startOfSpeech ? 'START' : (va.endOfSpeech ? 'END' : '')));
              addDebugLog('Diag', `[Diag] voiceActivity event: ${JSON.stringify(va)}`);
              if (actType.includes('START') || va.startOfSpeech === true || va.active === true) {
                if (userPauseMergeTimerRef.current) {
                  clearTimeout(userPauseMergeTimerRef.current);
                  userPauseMergeTimerRef.current = null;
                }
                setUserSpeechDetected(true);
                setIsThinking(false);
                isThinkingRef.current = false;
              } else if (actType.includes('END') || va.endOfSpeech === true || va.active === false) {
                setUserSpeechDetected(false);
                userSpeechEndTimeRef.current = Date.now();
                addDebugLog(
                  'LiveWS:VADSilenceEnd',
                  `[LiveWS:VADSilenceEnd] Server VAD ended user turn after silenceDurationMs=${LIVE_VAD_SILENCE_DURATION_MS}ms`
                );
                // Do not finalize immediately on ACTIVITY_END; wait 1.5s so short pauses merge into one bubble
                if (userPauseMergeTimerRef.current) {
                  clearTimeout(userPauseMergeTimerRef.current);
                }
                userPauseMergeTimerRef.current = setTimeout(() => {
                  finalizePendingUserBubble('pause_timeout');
                }, 1500);
              }
            }

            // Handle sessionResumptionUpdate
            if (parsed.sessionResumptionUpdate) {
              const updateObj = parsed.sessionResumptionUpdate;
              const newHandle = typeof updateObj.newHandle === 'string' && updateObj.newHandle.trim()
                ? updateObj.newHandle.trim()
                : null;
              const resumable = Boolean(updateObj.resumable);
              if (newHandle) {
                liveSessionResumptionHandleRef.current = newHandle;
              }
              addDebugLog(
                'LiveWS:SessionResumptionUpdate',
                `[LiveWS:SessionResumptionUpdate] resumable=${resumable}, hasNewHandle=${Boolean(newHandle)}`
              );
              addDebugLog('Diag', `[Diag] sessionResumptionUpdate: ${JSON.stringify(updateObj)}`);
            }

            if (parsed.goAway) {
              const timeLeft = parsed.goAway?.timeLeft || 'unknown';
              addDebugLog(
                'LiveWS:GoAway',
                `[LiveWS:GoAway] Server sent goAway (timeLeft=${timeLeft}, hasResumptionHandle=${Boolean(liveSessionResumptionHandleRef.current)}). Reconnecting seamlessly without flushing playback.`
              );
              addDebugLog('Diag', `[Diag] Server sent goAway: ${JSON.stringify(parsed.goAway)}`);
              if (isActiveRef.current && !isReconnectingFromGoAwayRef.current) {
                isReconnectingFromGoAwayRef.current = true;
                if (liveSessionReconnectTimerRef.current) {
                  clearTimeout(liveSessionReconnectTimerRef.current);
                }
                liveSessionReconnectTimerRef.current = setTimeout(() => {
                  liveSessionReconnectTimerRef.current = null;
                  if (!isActiveRef.current) {
                    isReconnectingFromGoAwayRef.current = false;
                    return;
                  }
                  const effectiveModel = customVoiceModel.trim() || voiceModel || 'gemini-3.8-live';
                  try {
                    if (liveWsRef.current === ws) {
                      liveWsReadyRef.current = false;
                      liveWsConnectPromiseRef.current = null;
                      ws.onclose = null;
                      ws.close(1000, 'Reconnecting after goAway with sessionResumption');
                      liveWsRef.current = null;
                    }
                  } catch (_) {}
                  ensureLiveWebSocket(effectiveModel)
                    .catch((err) => {
                      addDebugLog('LiveWS:ReconnectError', `Seamless goAway reconnect failed: ${err?.message || String(err)}`);
                    })
                    .finally(() => {
                      isReconnectingFromGoAwayRef.current = false;
                    });
                }, 150);
              }
            }

            if (parsed.setupComplete !== undefined) {
              isReconnectingFromGoAwayRef.current = false;
              if (doesModelSupportFunctionCalling(formattedModel)) {
                recordModelFunctionCallingSupportFromApi(formattedModel, true, 'bidi.setup');
              }
              addDebugLog('LiveWS:SetupComplete', `Gemini Live session ready for turns (${formattedModel})`);
              addDebugLog('Diag', `[Diag] setupComplete received for model: ${formattedModel}`);
              console.log("[LiveWS] setupComplete received");
              liveWsReadyRef.current = true;
              if (!setupResolved) {
                setupResolved = true;
                liveWsConnectPromiseRef.current = null;
                resolve(ws);
              }
              // Re-send visual context note if camera or screen sharing is already active
              if (isCameraActiveRef.current) {
                sendVisualContextNotification(true, 'camera');
              } else if (isScreenShareActiveRef.current) {
                sendVisualContextNotification(true, 'screen');
              }
              return;
            }

            const executeLiveFunctionCalls = async (functionCalls: any[], sourceLabel: 'toolCall' | 'modelTurn.part' = 'toolCall') => {
              if (!Array.isArray(functionCalls) || functionCalls.length === 0) return;

              const uniqueCalls: any[] = [];
              for (const fc of functionCalls) {
                if (!fc || !fc.name) continue;
                const callName = String(fc.name);
                const callArgs = fc.args && typeof fc.args === 'object' ? fc.args : {};
                const dedupeKey = fc.id
                  ? `id:${String(fc.id)}`
                  : `sig:${callName}:${JSON.stringify(callArgs)}`;
                if (handledToolCallIdsRef.current.has(dedupeKey)) {
                  addDebugLog(
                    'LiveWS:ToolCallDedupe',
                    `[LiveWS:ToolCallDedupe] Skipping duplicate functionCall (${sourceLabel}) key=${dedupeKey}`
                  );
                  continue;
                }
                handledToolCallIdsRef.current.add(dedupeKey);
                uniqueCalls.push(fc);
              }

              if (uniqueCalls.length === 0) return;

              addDebugLog(
                'LiveWS:ToolCall',
                `[LiveWS:ToolCall] Received ${uniqueCalls.length} tool call(s) (${sourceLabel}) on ${formattedModel}: ${uniqueCalls.map((f: any) => f?.name).join(', ')}`
              );
              const functionResponses: any[] = [];
              let shouldReconnectForVoice = false;
              for (const fc of uniqueCalls) {
                const callName = String(fc?.name || '');
                const callArgs = fc?.args && typeof fc.args === 'object' ? fc.args : {};
                const execRes = await executeSierraToolCall(callName, callArgs);
                if (execRes.requiresLiveReconnect) {
                  shouldReconnectForVoice = true;
                }
                functionResponses.push({
                  ...(fc?.id ? { id: fc.id } : {}),
                  name: callName,
                  response: execRes.response,
                });
              }
              if (ws.readyState === 1 && functionResponses.length > 0) {
                const toolRespPayload = {
                  toolResponse: {
                    functionResponses,
                  },
                };
                ws.send(JSON.stringify(toolRespPayload));
                addDebugLog(
                  'LiveWS:ToolResponse',
                  `[LiveWS:ToolResponse] Sent ${functionResponses.length} tool response(s)`
                );
              }
              if (shouldReconnectForVoice) {
                addDebugLog(
                  'LiveWS:VoiceChangeReconnect',
                  `[LiveWS] Reconnecting Live session cleanly to apply new voice without dropping session or memory summaries.`
                );
                setTimeout(() => {
                  flushAndSaveLiveMemorySummary('voice_change_reconnect');
                  restartLiveSessionIfActive();
                }, 350);
              }
            };

            if (parsed.toolCall) {
              const functionCalls = Array.isArray(parsed.toolCall.functionCalls)
                ? parsed.toolCall.functionCalls
                : [];
              await executeLiveFunctionCalls(functionCalls, 'toolCall');
              return;
            }

            if (parsed.serverContent) {
              // Interruption - stop and immediately flush playback queue and assistant buffer
              if (parsed.serverContent.interrupted) {
                const now = Date.now();
                const timeSinceTurnStart = modelTurnAudioStartTimeRef.current > 0 ? (now - modelTurnAudioStartTimeRef.current) : 9999;
                const wasClientBargeIn = clientTriggeredBargeInRef.current;

                if (audioOutputModeRef.current === 'speaker' && !wasClientBargeIn && timeSinceTurnStart < SPEAKER_BARGE_IN_TURN_GRACE_MS) {
                  addDebugLog(
                    'Diag',
                    `[Diag] UnexpectedInterrupt: serverContent.interrupted ignored (speaker echo protection, elapsed=${timeSinceTurnStart}ms < ${SPEAKER_BARGE_IN_TURN_GRACE_MS}ms, clientBargeIn=false)`
                  );
                  return;
                }

                addDebugLog('LiveWS:Interrupted', 'Sierra audio interrupted by user speech');
                addDebugLog('Diag', `[Diag] serverContent.interrupted received - stopping and flushing audio playback queue (elapsed=${timeSinceTurnStart}ms, clientBargeIn=${wasClientBargeIn})`);
                console.log("[LiveWS] Interrupted by user");
                stopPlayback();
                setIsSpeaking(false);
                isSpeakingRef.current = false;
                setIsThinking(false);
                isThinkingRef.current = false;
                assistantTranscriptBufferRef.current = '';
                liveWsTextAccumulatedRef.current = '';
                userSpeechEndTimeRef.current = 0;
                lastAudioActivityTimeRef.current = 0;
                hadRecentAudioActivityRef.current = false;
                liveWsAudioReceivedRef.current = false;
                liveWsTurnRestartLoggedRef.current = false;
                clientTriggeredBargeInRef.current = false;
                return;
              }

              // Server Safety Filter Refusal / Block check
              if (parsed.serverContent.finishReason === 'SAFETY' || parsed.serverContent.blockReason) {
                const blockInfo = parsed.serverContent.finishReason || parsed.serverContent.blockReason;
                addDebugLog('LiveWS:SafetyBlock', `Turn ended by Gemini API Safety Filter (${blockInfo}). Refusal is from the Gemini API safety filter, not our prompt.`);
                toast.warning(`Gemini API safety filter triggered (${blockInfo})`);
              }

              // Record start of server response (user speech completed)
              if ((parsed.serverContent.outputTranscription?.text || parsed.serverContent.modelTurn || parsed.serverContent.inputAudioTranscription) && userSpeechEndTimeRef.current === 0) {
                userSpeechEndTimeRef.current = lastAudioActivityTimeRef.current > 0
                  ? lastAudioActivityTimeRef.current
                  : Date.now();
                liveWsTurnRestartLoggedRef.current = false;
              }

              // Input Audio Transcription (User spoken words transcribed by Gemini Live server)
              const userTranscriptText = parsed.serverContent.inputAudioTranscription?.text ||
                parsed.serverContent.inputTranscription?.text ||
                (parsed.serverContent.userTurn?.parts ? parsed.serverContent.userTurn.parts.map((p: any) => p.text || '').join('') : '');

              if (userTranscriptText) {
                // Client-side filter: drop user transcript chunks that are mostly non-Latin script
                if (!isMostlyLatinScript(userTranscriptText)) {
                  addDebugLog(
                    'LiveWS:UserTranscriptionDropped',
                    `Dropped mostly non-Latin user transcript chunk: "${userTranscriptText}"`
                  );
                } else {
                  // Real latency: mic-end to first transcript
                  if (!firstTranscriptLoggedRef.current && userSpeechEndTimeRef.current > 0) {
                    const elapsedLatency = Date.now() - userSpeechEndTimeRef.current;
                    addDebugLog('Diag', `[Diag] Real latency mic-end to first transcript: ${elapsedLatency}ms`);
                    firstTranscriptLoggedRef.current = true;
                  }
                  if (!firstSessionInputTranscriptLoggedRef.current) {
                    firstSessionInputTranscriptLoggedRef.current = true;
                    addDebugLog(
                      'LiveWS:FirstInputTranscript',
                      `[LiveWS:FirstInputTranscript] First input transcription of session (${selectedLanguageRef.current}): "${userTranscriptText}"`
                    );
                    addDebugLog('Diag', `[Diag] First input transcription of session: "${userTranscriptText}"`);
                  }
                  // Transition state to "thinking"
                  setIsThinking(true);
                  isThinkingRef.current = true;
                  setUserSpeechDetected(false);

                  // Merge & deduplicate per user turn across short pauses
                  userTranscriptBufferRef.current = mergeAndDeduplicateTranscript(
                    userTranscriptBufferRef.current,
                    userTranscriptText
                  );
                  liveWsUserTextAccumulatedRef.current = userTranscriptBufferRef.current;
                  addDebugLog('LiveWS:UserTranscription', `User transcribed chunk: "${userTranscriptText}" (merged: "${userTranscriptBufferRef.current}")`);

                  // Reset 1.5s pause merge timer while user chunks are still arriving before model turn
                  if (userPauseMergeTimerRef.current) {
                    clearTimeout(userPauseMergeTimerRef.current);
                    userPauseMergeTimerRef.current = setTimeout(() => {
                      finalizePendingUserBubble('pause_timeout');
                    }, 1500);
                  }
                }
              }

              // Finalize the user bubble when the model's reply starts
              if (parsed.serverContent.modelTurn || parsed.serverContent.outputTranscription?.text) {
                finalizePendingUserBubble('model_reply_started');
              }

              // Output Audio Transcription (Accumulate chunks per turn)
              if (parsed.serverContent.outputTranscription?.text) {
                const outText = parsed.serverContent.outputTranscription.text;
                turnReceivedOutputTranscriptionRef.current = true;
                addDebugLog('LiveWS:OutputTranscription', `"${outText}"`);
                addDebugLog('Diag', `[Diag] Output transcription chunk: "${outText}"`);
                assistantTranscriptBufferRef.current += outText;
                liveWsTextAccumulatedRef.current += outText;
              }

              // Model Turn Parts (text, functionCall, thought, and PCM16 24kHz audio)
              const parts = parsed.serverContent.modelTurn?.parts;
              if (Array.isArray(parts)) {
                const inlineFunctionCalls: any[] = [];
                for (const part of parts) {
                  if (part?.functionCall) {
                    inlineFunctionCalls.push(part.functionCall);
                    continue;
                  }
                  if (part?.thought === true) {
                    addDebugLog('LiveWS:ThoughtPart', `[ExtendedThinking] Reasoning part (${(part.text || '').length} chars)`);
                    continue;
                  }
                  if (part?.text) {
                    addDebugLog('LiveWS:ModelText', `"${part.text}"`);
                    addDebugLog('Diag', `[Diag] Model text chunk: "${part.text}"`);
                    if (!turnReceivedOutputTranscriptionRef.current) {
                      assistantTranscriptBufferRef.current += part.text;
                      liveWsTextAccumulatedRef.current += part.text;
                    }
                  }
                  if (part?.inlineData?.data) {
                    if (!liveWsAudioReceivedRef.current) {
                      liveWsAudioReceivedRef.current = true;
                      firstAudioReceivedTimeRef.current = Date.now();
                      // Measure from the last local mic chunk above the voice threshold to the first model audio chunk
                      const localMicBaseline = lastLocalVoiceChunkTimeRef.current > 0
                        ? lastLocalVoiceChunkTimeRef.current
                        : (userSpeechEndTimeRef.current > 0 ? userSpeechEndTimeRef.current : turnSentTimeRef.current);
                      const elapsedLatency = localMicBaseline > 0
                        ? Math.max(0, firstAudioReceivedTimeRef.current - localMicBaseline)
                        : 0;
                      addDebugLog('LiveWS:FirstAudio', `First audio chunk received (latency: ${elapsedLatency}ms)`);
                      if (!firstAudioLoggedRef.current && localMicBaseline > 0) {
                        addDebugLog('Diag', `[Diag] Real latency mic-end to first model audio: ${elapsedLatency}ms`);
                        firstAudioLoggedRef.current = true;
                      }
                      console.log(`[LiveWS:FirstAudio] Latency: ${elapsedLatency}ms`);
                    }
                    // Transition state to "speaking"
                    setIsSpeaking(true);
                    isSpeakingRef.current = true;
                    setIsThinking(false);
                    isThinkingRef.current = false;
                    // Play gaplessly via Web Audio AudioContext + AudioBufferSource scheduling
                    playAudio(part.inlineData.data);
                  }
                }
                if (inlineFunctionCalls.length > 0) {
                  await executeLiveFunctionCalls(inlineFunctionCalls, 'modelTurn.part');
                }
              }

              // Turn complete - finalize any remaining user bubble, finalize ONE assistant message, and reset buffer to ""
              if (parsed.serverContent.turnComplete) {
                finalizePendingUserBubble('turn_complete');
                liveWsTurnCompleteRef.current = true;
                liveWsTurnIndexRef.current++;
                const turnIndex = liveWsTurnIndexRef.current;
                const turnCompleteTime = Date.now();
                const totalDuration = userSpeechEndTimeRef.current > 0
                  ? (turnCompleteTime - userSpeechEndTimeRef.current)
                  : (turnSentTimeRef.current > 0 ? (turnCompleteTime - turnSentTimeRef.current) : 0);

                // Log promptTokenCount per turn
                const promptTokens = parsed.usageMetadata?.promptTokenCount || parsed.serverContent?.modelTurn?.usageMetadata?.promptTokenCount;
                if (promptTokens !== undefined) {
                  addDebugLog('Diag', `[Diag] turnComplete promptTokenCount: ${promptTokens}`);
                  console.log(`[LiveWS:Usage] promptTokenCount: ${promptTokens}`);
                }

                const bufferLengthBefore = assistantTranscriptBufferRef.current.length;
                const assistantText = assistantTranscriptBufferRef.current.trim();
                let hasDriftThisTurn = false;
                if (assistantText) {
                  const driftResult = detectTranscriptLanguageMismatch(assistantText, selectedLanguageRef.current);
                  if (driftResult.isMismatch) {
                    addDebugLog('Diag', `[Diag] LanguageDrift: model replied in ${driftResult.detectedLanguage || 'foreign language'}`);
                    hasDriftThisTurn = true;
                    modelTurnHasDriftRef.current = true;
                  } else {
                    modelTurnHasDriftRef.current = false;
                  }

                  setTranscripts(prev => [...prev, {
                    id: `sierra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    sender: 'sierra',
                    text: assistantText,
                    timestamp: Date.now()
                  }]);
                  persistVoiceMessage('sierra', assistantText);
                  addDebugLog('LiveWS:SierraFinalized', `Finalized Sierra turn #${turnIndex}: "${assistantText}"`);
                  if (!hasDriftThisTurn && lastFinalizedUserTextRef.current) {
                    saveCompletedLiveExchange({
                      turnKey: `ws-turn-${turnIndex}-${liveSessionIdRef.current}`,
                      userText: lastFinalizedUserTextRef.current,
                      replyText: assistantText,
                    });
                  }
                }

                // Reset buffer to ""
                assistantTranscriptBufferRef.current = '';
                turnReceivedOutputTranscriptionRef.current = false;
                handledToolCallIdsRef.current.clear();
                const bufferLengthAfter = assistantTranscriptBufferRef.current.length;

                // Periodic summary saving when Background Live mode is enabled (every few turns)
                if (!hasDriftThisTurn && shouldSavePeriodicSummary(turnIndex, isBackgroundLiveEnabled())) {
                  flushAndSaveLiveMemorySummary(`periodic_turn_${turnIndex}`);
                  addDebugLog('Memory', `[Memory] Periodic background summary saved at turn #${turnIndex}`);
                }

                // Diagnostic log: buffer length before reset, turn index, and buffer length after reset (must be 0)
                addDebugLog('Diag', `[Diag] turnComplete: turnIndex=${turnIndex}, bufferLengthBefore=${bufferLengthBefore}, bufferLengthAfter=${bufferLengthAfter}`);
                console.log(`[LiveWS:TurnComplete] turnIndex=${turnIndex}, bufBefore=${bufferLengthBefore}, bufAfter=${bufferLengthAfter} (must be 0)`);

                isRespondingRef.current = false;
                setIsThinking(false);
                isThinkingRef.current = false;
                setUserSpeechDetected(false);

                // Reset user and sierra tracking IDs
                liveWsCurrentUserIdRef.current = null;
                liveWsUserTextAccumulatedRef.current = '';
                liveWsCurrentSierraIdRef.current = null;
                liveWsAudioReceivedRef.current = false;
                userSpeechEndTimeRef.current = 0;
                lastLocalVoiceChunkTimeRef.current = 0;
                modelTurnAudioStartTimeRef.current = 0;
                clientTriggeredBargeInRef.current = false;
                firstAudioLoggedRef.current = false;
                firstTranscriptLoggedRef.current = false;
                lastAudioActivityTimeRef.current = 0;
                hadRecentAudioActivityRef.current = false;

                // Do NOT call playTextToSpeech(assistantText) on Gemini Live WebSocket turns:
                // Live sessions use responseModalities: ["AUDIO"] and stream 24kHz PCM via playAudio().
                // Calling Native TTS on pre-tool turns with hadAudio=false causes overlapping dual voices.
                if (voiceInputEngineRef.current === 'native_recognizer') {
                  checkAndRestartListeningAfterTurn();
                }
              }
              return;
            }

            if (parsed.error) {
              const errMsg = parsed.error.message || JSON.stringify(parsed.error);
              inspectApiErrorForToolSupport(formattedModel, errMsg);
              logQuotaOrRateLimitError('LiveWS', formattedModel, errMsg);
              addDebugLog('LiveWS:APIError', `Server API error (${formattedModel}): ${errMsg}`);
              addDebugLog('Diag', `[Diag] LiveWS:APIError (${formattedModel}): ${errMsg}`);
              console.error("[LiveWS] Server error:", errMsg);
              liveWsReadyRef.current = false;
              isRespondingRef.current = false;
              if (/api_key_invalid|api key|401|unauthenticated|permission_denied/i.test(errMsg)) {
                setLiveAuth401Provider('gemini');
              }
              toast.error(`Gemini Live: ${errMsg}`);
              setConnectionError(`Gemini Live: ${errMsg}`);
              if (!setupResolved) {
                setupResolved = true;
                liveWsConnectPromiseRef.current = null;
                try {
                  ws.close();
                } catch (_) {}
                liveWsRef.current = null;
                reject(new Error(`Gemini Live: ${errMsg}`));
              }
            }
          } catch (parseErr: any) {
            console.warn("[LiveWS] Message parse exception:", parseErr);
          }
        };

        ws.onerror = (err: any) => {
          const errMsg = err?.message || 'WebSocket network error';
          addDebugLog('LiveWS:Error', errMsg);
          addDebugLog('Diag', `[Diag] ws.onerror: ${errMsg}`);
          console.error("[LiveWS] WebSocket error:", err);
          isRespondingRef.current = false;
          if (!setupResolved) {
            setupResolved = true;
            liveWsConnectPromiseRef.current = null;
            reject(new Error(errMsg));
          }
        };

        ws.onclose = (event: any) => {
          const code = event.code;
          const reason = event.reason || '';
          addDebugLog('LiveWS:Close', `WebSocket closed (code: ${code}, reason: "${reason}")`);
          addDebugLog('Diag', `[Diag] ws.onclose: code=${code}, reason="${reason}", wasClean=${event.wasClean}`);
          console.warn(`[LiveWS:Close] Code ${code}: ${reason}`);
          liveWsRef.current = null;
          liveWsReadyRef.current = false;
          liveWsConnectPromiseRef.current = null;
          liveWsTurnCompleteRef.current = false;
          isRespondingRef.current = false; // Never leave isResponding stuck true

          // If the session is still active and we have a sessionResumption handle (and this wasn't a config rejection),
          // reconnect seamlessly without flushing the 24kHz playback queue so speech doesn't cut off mid-sentence.
          const isConfigRejection = code === 1007 || code >= 4000;
          if (
            isActiveRef.current &&
            setupResolved &&
            !isConfigRejection &&
            liveSessionResumptionHandleRef.current &&
            !isReconnectingFromGoAwayRef.current
          ) {
            isReconnectingFromGoAwayRef.current = true;
            addDebugLog(
              'LiveWS:SessionResumption',
              `[LiveWS:SessionResumption] Socket closed mid-session (code ${code}); reconnecting seamlessly with resumption handle without stopping playback.`
            );
            const effectiveModel = customVoiceModel.trim() || voiceModel || 'gemini-3.8-live';
            setTimeout(() => {
              if (!isActiveRef.current) {
                isReconnectingFromGoAwayRef.current = false;
                return;
              }
              ensureLiveWebSocket(effectiveModel)
                .catch((err) => {
                  addDebugLog('LiveWS:ReconnectError', `Auto-resumption reconnect failed: ${err?.message || String(err)}`);
                })
                .finally(() => {
                  isReconnectingFromGoAwayRef.current = false;
                });
            }, 250);
            return;
          }

          let userMsg = `Gemini Live connection closed (code ${code}${reason ? `: ${reason}` : ''})`;
          logQuotaOrRateLimitError('LiveWS', formattedModel, `${code} ${reason}`);
          if (code === 1007) {
            userMsg = `Gemini Live rejected configuration (code 1007${reason ? `: ${reason}` : ''}). Live models require AUDIO response modalities.`;
            addDebugLog('LiveWS:SetupRejected', userMsg);
          } else if (code >= 4000) {
            addDebugLog('LiveWS:SetupRejected', `Gemini Live server rejected connection (code ${code}: "${reason}")`);
          }
          setConnectionError(userMsg);
          toast.error(userMsg);

          const currentSierraId = liveWsCurrentSierraIdRef.current;
          if (currentSierraId && !liveWsTextAccumulatedRef.current.trim() && !liveWsAudioReceivedRef.current) {
            setTranscripts(prev => prev.map(item => item.id === currentSierraId ? {
              ...item,
              text: `[${userMsg}]`
            } : item));
          }

          if (!setupResolved) {
            setupResolved = true;
            reject(new Error(userMsg));
          }

          // Resume listening if active in continuous mode so recognition is never stranded
          if (isActiveRef.current && mode === 'continuous') {
            isPausedRef.current = false;
            setIsPaused(false);
            scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
          }
        };
      } catch (err: any) {
        liveWsConnectPromiseRef.current = null;
        reject(err);
      }
    });

    liveWsConnectPromiseRef.current = connectPromise;
    return await connectPromise;
  };

  const handleUserUtterance = async (userText: string) => {
    addDebugLog('handleUserUtterance', `captured: "${userText}" (isResponding=${isRespondingRef.current})`);
    console.log("[Voice:Handoff] handleUserUtterance triggered with text:", userText);
    if (!userText.trim() || isRespondingRef.current) {
      if (isRespondingRef.current) {
        addDebugLog('LiveWS:TurnDropped', `Turn dropped: already responding to previous utterance`);
      }
      addDebugLog('handleUserUtterance', `Ignored: empty or already responding`);
      console.log("[Voice:Handoff] Utterance discarded: empty or isRespondingRef is true");
      return;
    }
    isRespondingRef.current = true;

    // 1. Render user speech in transcript UI
    const userItem: TranscriptItem = {
      id: 'user-' + Date.now(),
      sender: 'user',
      text: userText,
      timestamp: Date.now(),
    };
    setTranscripts(prev => [...prev.slice(-20), userItem]);
    persistVoiceMessage('user', userText);

    // 2. Render Sierra placeholder in transcript UI
    const sierraId = 'sierra-' + (Date.now() + 1);
    setTranscripts(prev => [...prev, {
      id: sierraId,
      sender: 'sierra',
      text: '',
      timestamp: Date.now(),
    }]);

    let accumulatedText = '';

    // Stop and fully release STT while model is thinking/speaking to avoid picking up speaker output
    console.log("[Voice:handleUserUtterance] Stopping and releasing STT before sending response");
    await stopSpeechToText();

    const effectiveModel = customVoiceModel.trim() || voiceModel || 'gemini-3.8-live';

    // Live WebSocket branch: Reuses one WebSocket session across utterances with responseModalities: ["AUDIO"]
    if (isGeminiLiveModel(effectiveModel)) {
      liveWsCurrentSierraIdRef.current = sierraId;
      liveWsTextAccumulatedRef.current = '';
      liveWsAudioReceivedRef.current = false;
      liveWsTurnCompleteRef.current = false;

      try {
        const ws = await ensureLiveWebSocket(effectiveModel);
        turnSentTimeRef.current = Date.now();
        const latencyFromCommit = utteranceCommitTimeRef.current > 0 ? (turnSentTimeRef.current - utteranceCommitTimeRef.current) : 0;
        addDebugLog('LiveWS:TurnSent', `Sending user utterance to WebSocket: "${userText}" (latency from commit: ${latencyFromCommit}ms)`);
        console.log(`[LiveWS:TurnSent] Sent user turn at ${turnSentTimeRef.current} (${latencyFromCommit}ms from commit):`, userText);

        const clientContentMessage = {
          clientContent: {
            turns: [
              {
                role: "user",
                parts: [{ text: userText }],
              },
            ],
            turnComplete: true,
          },
        };
        ws.send(JSON.stringify(clientContentMessage));
      } catch (wsErr: any) {
        addDebugLog('LiveWS:SendError', wsErr.message || String(wsErr));
        console.error("[LiveWS] Failed to send turn:", wsErr);
        isRespondingRef.current = false;
        const errMsg = wsErr.message || "Failed to connect to Gemini Live";
        toast.error(errMsg);
        setConnectionError(errMsg);
        setTranscripts(prev => prev.map(item => item.id === sierraId ? {
          ...item,
          text: `[Error: ${errMsg}]`
        } : item));
        if (isActiveRef.current && mode === 'continuous') {
          isPausedRef.current = false;
          setIsPaused(false);
          scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
        }
      }
      return;
    }

    // Standard Non-Live branch (REST streamChat fallback)
    try {
      const history = transcriptsRef.current.slice(-6).map(t => ({
        role: t.sender === 'user' ? 'user' : 'model',
        content: t.text,
      }));

      addDebugLog('streamChat', `called with model: "${effectiveModel}", prompt: "${userText}"`);
      console.log(`[Voice:streamChat] Initiating direct streamChat call with model ${effectiveModel}, prompt:`, userText);
      await streamChat({
        model: effectiveModel,
        messages: [
          ...history,
          { role: 'user', content: userText }
        ],
        systemInstruction: (() => {
          const activeMode = getContentMode();
          const activePersonaId = getActivePersonaId();
          const customDirectives = getCustomDirectives() || undefined;
          const baseInstruction = buildSierraSystemInstruction(activePersonaId, activeMode, customDirectives);
          return `${baseInstruction}\n\n---\nContinuous Voice Guidelines:\nYou are Sierra in Continuous Voice Chat. Talk like a real person: usually short and conversational, longer only when the question needs it. React first then answer. Vary your reactions naturally and never reuse the same one twice in a row. No scripted openers or stock phrases, no repeating the question back, and match the user's energy. Do not use markdown, bullet points, asterisks, or formatting because your response is being spoken aloud through Text-to-Speech.`;
        })(),
      }, {
        onChunk: (chunk: string) => {
          accumulatedText += chunk;
          if (accumulatedText.length === chunk.length) {
            addDebugLog('streamChat:Chunk', `First chunk received (${chunk.length} chars)`);
          }
          console.log("[Voice:streamChat:Chunk] Chunk received length:", chunk.length);
          setTranscripts(prev => prev.map(item => item.id === sierraId ? { ...item, text: accumulatedText } : item));
        },
        onDone: async () => {
          addDebugLog('streamChat:Done', `Completed (${accumulatedText.length} chars)`);
          console.log("[Voice:streamChat:Done] Stream finished successfully. Full text:", accumulatedText.trim());
          isRespondingRef.current = false;
          if (accumulatedText.trim()) {
            persistVoiceMessage('sierra', accumulatedText.trim());
            console.log("[Voice:playTextToSpeech] Triggering TTS for model response");
            await playTextToSpeech(accumulatedText.trim());
          } else {
            console.log("[Voice:streamChat:Done] Response text was empty, resuming listening");
            setTranscripts(prev => prev.map(item => item.id === sierraId ? {
              ...item,
              text: item.text.trim() || "[No response received]"
            } : item));
            if (isActiveRef.current && mode === 'continuous') {
              isPausedRef.current = false;
              setIsPaused(false);
              scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
            }
          }
        },
        onError: (err: Error) => {
          addDebugLog('streamChat:Error', `${err.message}`);
          isRespondingRef.current = false;
          console.error("[Voice:streamChat:Error] Stream chat error occurred:", err);
          toast.error(`Voice error: ${err.message}`);
          const displayErr = `[Error: ${err.message}]`;
          setTranscripts(prev => prev.map(item => item.id === sierraId ? {
            ...item,
            text: item.text.trim() ? `${item.text}\n\n${displayErr}` : displayErr
          } : item));
          if (isActiveRef.current && mode === 'continuous') {
            isPausedRef.current = false;
            setIsPaused(false);
            scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
          }
        }
      });
    } catch (err: any) {
      addDebugLog('streamChat:Catch', `${err.message}`);
      isRespondingRef.current = false;
      console.error("[Voice:streamChat:Catch] Failed to generate voice response:", err);
      toast.error(`Failed to generate voice response: ${err.message}`);
      const displayErr = `[Error: ${err.message}]`;
      setTranscripts(prev => prev.map(item => item.id === sierraId ? {
        ...item,
        text: item.text.trim() ? `${item.text}\n\n${displayErr}` : displayErr
      } : item));
      if (isActiveRef.current && mode === 'continuous') {
        isPausedRef.current = false;
        setIsPaused(false);
        scheduleListeningRestart(PLAYBACK_COOLDOWN_MS);
      }
    }
  };

  const startSession = async () => {
    triggerHaptic('medium');
    const sessionStartTime = new Date().toISOString();
    firstSessionInputTranscriptLoggedRef.current = false;
    addDebugLog('Session', `Starting voice session... [${sessionStartTime}]`);
    addDebugLog('Diag', `[Diag] AudioMode: ${audioOutputModeRef.current}`);
    addDebugLog(
      'Diag',
      `[Diag] SelectedLanguage: ${selectedLanguageRef.current} (appliedToTranscription: true [via systemInstruction+speechConfig; inputAudioTranscription has no language field])`
    );
    console.log(`[Session] Starting voice session... [${sessionStartTime}]`);
    chunksReceivedCountRef.current = 0;
    chunksSentCountRef.current = 0;
    chunksDroppedCountRef.current = 0;
    peakRms20Ref.current = 0;
    setIsConnecting(true);
    setConnectionError(null);
    setLiveAuth401Provider(null);

    try {
      if (liveProvider === 'openrouter') {
        const apiKey = getProviderApiKey('openrouter') || getOpenRouterApiKey();
        if (!apiKey) {
          const msg = 'Invalid or unrecognized API key for OpenRouter. Add your OpenRouter key in Settings -> Providers.';
          addDebugLog('OpenRouterLive:Error', msg);
          setLiveAuth401Provider('openrouter');
          setConnectionError(msg);
          setIsConnecting(false);
          toast.error(msg);
          return;
        }

        let localCfg = getLocalVoiceSettings();
        const plugin = getSierraLocalVoicePlugin();
        const sysInfo = await plugin.getStorageAndNetworkStatus().catch(() => null);
        if (sysInfo?.ok && typeof sysInfo.totalRamMb === 'number' && sysInfo.totalRamMb > 0 && !localCfg.whisperSizeUserSelected) {
          const recWhisper = resolveEffectiveWhisperSize(localCfg, sysInfo.cpuCores, sysInfo.totalRamMb);
          if (recWhisper !== localCfg.whisperSize) {
            localCfg = saveLocalVoiceSettings({
              whisperSize: recWhisper,
              whisperSizeUserSelected: false,
            });
          }
        }
        let whisperSpec = LOCAL_WHISPER_MODELS[localCfg.whisperSize] || LOCAL_WHISPER_MODELS['base.en'];
        const tinySpec = LOCAL_WHISPER_MODELS['tiny.en'];
        const sttRequiredSpecs = [whisperSpec, LOCAL_SILERO_VAD_MODEL];
        const statusQuerySpecs =
          whisperSpec.id === tinySpec.id ? sttRequiredSpecs : [...sttRequiredSpecs, tinySpec];

        if (Capacitor.isNativePlatform()) {
          try {
            await withNativeTimeout(CapSpeechRecognition.stop(), 1000, undefined, 'CapSpeechRecognition.stop()');
          } catch (_) {}
        }
        await teardownNativeListeners();

        const modStatus = await plugin.getModelsStatus({
          models: statusQuerySpecs.map((s) => ({
            id: s.id,
            filename: s.filename,
            sizeBytes: s.sizeBytes,
            sha256: s.sha256,
          })),
        });

        const missingSttSpecs = sttRequiredSpecs.filter((s) => !modStatus?.models?.[s.id]?.downloaded);
        if (Capacitor.isNativePlatform() && missingSttSpecs.length > 0) {
          setLocalVoiceStatus('downloading');
          setShowLocalDownloadModal(true);
          setIsConnecting(false);
          addDebugLog(
            'OpenRouterLive:SttModelsMissing',
            `Missing on-device STT model(s) (${missingSttSpecs.map((m) => m.filename).join(', ')}) — prompting download`,
          );
          toast.info('Please download Whisper and Silero VAD for on-device speech-to-text.');
          return;
        }

        for (const l of localListenersRef.current) {
          await l.remove().catch(() => {});
        }
        localListenersRef.current = [];

        const diagListener = await plugin.addListener('localDiagnostic', (evt) => {
          const cat = String(evt?.category || 'LocalSTT:Diag');
          const det = String(evt?.detail || '');
          if (det) {
            addDebugLog(cat, det);
          }
        });
        localListenersRef.current.push(diagListener);

        setLocalVoiceStatus('loading_model');
        addDebugLog(
          'OpenRouterLive:Stage',
          `Loading Whisper="${whisperSpec.filename}" + SileroVAD="${LOCAL_SILERO_VAD_MODEL.filename}" (sttOnly=true)...`,
        );
        let loadRes = await plugin.loadModels({
          sttOnly: true,
          llmFilename: '',
          whisperFilename: whisperSpec.filename,
          vadFilename: LOCAL_SILERO_VAD_MODEL.filename,
          piperFilename: LOCAL_PIPER_VOICE_MODEL.filename,
          piperConfigFilename: LOCAL_PIPER_VOICE_CONFIG.filename,
          ttsEngine: 'android_tts',
          chatTemplate: 'llama3',
        });

        if (
          !loadRes.ok &&
          Capacitor.isNativePlatform() &&
          whisperSpec.id !== tinySpec.id &&
          modStatus?.models?.[tinySpec.id]?.downloaded
        ) {
          addDebugLog(
            'STT:Fallback',
            `Failed to load ${whisperSpec.filename} (${loadRes.reason || 'unknown'}); falling back to tiny.en (${tinySpec.filename}).`,
          );
          whisperSpec = tinySpec;
          loadRes = await plugin.loadModels({
            sttOnly: true,
            llmFilename: '',
            whisperFilename: whisperSpec.filename,
            vadFilename: LOCAL_SILERO_VAD_MODEL.filename,
            piperFilename: LOCAL_PIPER_VOICE_MODEL.filename,
            piperConfigFilename: LOCAL_PIPER_VOICE_CONFIG.filename,
            ttsEngine: 'android_tts',
            chatTemplate: 'llama3',
          });
        }

        if (!loadRes.ok && Capacitor.isNativePlatform()) {
          setLocalVoiceStatus('error');
          const errReason = loadRes.reason || loadRes.lastNativeError || 'Failed to load Whisper STT model.';
          addDebugLog('OpenRouterLive:LoadError', errReason);
          setConnectionError(errReason);
          setIsConnecting(false);
          toast.error(errReason);
          return;
        }
        addDebugLog('OpenRouterLive:Stage', 'Whisper STT + Silero VAD models loaded; initializing pipeline...');

        const unifiedThreshold = Math.min(0.95, Math.max(0.2, localCfg.bargeInThreshold || 0.85));
        const unifiedBargeInMode = localCfg.bargeInMode || 'headphones_only';
        const unifiedSustainedMs =
          unifiedBargeInMode === 'adaptive' ? 400 : Math.max(800, localCfg.bargeInSustainedMs || 800);
        const webHeadset = await detectConnectedHeadphones().catch(() => false);
        const nativeHeadsetRes = await plugin.isHeadsetConnected?.().catch(() => ({ connected: false }));
        const detectedHeadset = Boolean(nativeHeadsetRes?.connected ?? webHeadset);
        hasHeadsetRef.current = detectedHeadset;

        const unifiedLocalCfg = {
          ...localCfg,
          bargeInThreshold: unifiedThreshold,
          bargeInSpeakerBoost: 0,
          bargeInSustainedMs: unifiedSustainedMs,
          bargeInMode: unifiedBargeInMode,
          hasHeadset: detectedHeadset,
        };

        const stateMachine = new LocalVoiceTurnStateMachine(unifiedLocalCfg, {
          onStatusChange: (st, reason) => {
            setLocalVoiceStatus(st);
            setIsThinking(st === 'thinking');
            isThinkingRef.current = st === 'thinking';
            setIsSpeaking(st === 'speaking');
            isSpeakingRef.current = st === 'speaking';
            addDebugLog('OpenRouterLive:Status', `Status -> ${st}${reason ? ` (${reason})` : ''}`);
          },
          stopAndFlushAudioPlayback: () => {
            lastPlaybackEndedAtRef.current = Date.now();
            if (openRouterAbortControllerRef.current) {
              openRouterAbortControllerRef.current.abort();
              openRouterAbortControllerRef.current = null;
            }
            void stopTtsServiceSpeaking('barge_in');
            stopPlayback();
            void plugin.setSpeakingState({ speaking: false, thinking: false, turnId: 0 }).catch(() => {});
            void plugin.interruptTurn().catch(() => {});
          },
          cancelLlmGeneration: () => {
            if (openRouterAbortControllerRef.current) {
              openRouterAbortControllerRef.current.abort();
              openRouterAbortControllerRef.current = null;
            }
            void plugin.interruptTurn().catch(() => {});
          },
          cancelTtsAndEmptyQueue: () => {
            void stopTtsServiceSpeaking('barge_in');
            void localTtsQueueRef.current?.cancelAndClear();
          },
          onBargeInTriggered: ({ spokenText, interruptedTurnId, sustainedSpeechMs, effectiveThreshold }) => {
            if (pendingLiveUserTurnRef.current && spokenText.trim()) {
              saveCompletedLiveExchange({
                turnKey: `or-turn-${interruptedTurnId}`,
                userText: pendingLiveUserTurnRef.current,
                replyText: spokenText,
                wasInterrupted: true,
                spokenPrefix: spokenText,
              });
              pendingLiveUserTurnRef.current = '';
            }
            addDebugLog(
              'OpenRouterLive:BargeIn',
              `Barge-in interrupted turn #${interruptedTurnId} after ${sustainedSpeechMs}ms speech (threshold=${effectiveThreshold.toFixed(2)}). Partial spoken reply preserved: "${spokenText}"`,
            );
          },
          onBargeInEvaluated: (info) => {
            if (info.accepted) {
              addDebugLog(
                'BargeIn:Accepted',
                `reason=${info.reason} vad=${info.vadProb.toFixed(3)} micRms=${info.micRms.toFixed(4)} playbackRms=${info.playbackRms.toFixed(4)} sustainedMs=${info.sustainedMs} mode=${info.mode} headset=${info.hasHeadset}`,
              );
            } else {
              const now = Date.now();
              if (now - lastBargeInIgnoredLogTimeRef.current >= 500 || info.reason === 'short_burst_reset') {
                lastBargeInIgnoredLogTimeRef.current = now;
                addDebugLog(
                  'BargeIn:Ignored',
                  `reason=${info.reason} vad=${info.vadProb.toFixed(3)} micRms=${info.micRms.toFixed(4)} playbackRms=${info.playbackRms.toFixed(4)} sustainedMs=${info.sustainedMs} mode=${info.mode} headset=${info.hasHeadset}`,
                );
              }
            }
          },
        });
        localStateMachineRef.current = stateMachine;

        const openRouterTtsEngine = new OpenRouterLiveTtsEngine({
          getVoiceOptions: () => {
            const liveVoiceCfg = getLiveVoiceConfig(selectedPersona as PersonaId, companionIdentity);
            const chatVoiceCfg = getChatVoiceConfig(selectedPersona as PersonaId, companionIdentity);
            const effectiveVoice =
              getSelectedVoiceProvider() === 'openrouter'
                ? liveVoiceCfg.heygenVoiceId || chatVoiceCfg.heygenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE
                : selectedVoice || liveVoiceCfg.voiceId;
            return {
              voiceId: effectiveVoice,
              accent: liveAccent || liveVoiceCfg.accent,
              tone: liveTone || liveVoiceCfg.tone,
            };
          },
        });
        const fallbackTts = new AndroidSystemLocalTtsEngine();
        const ttsQueue = new LocalTtsQueueCoordinator({
          primaryEngine: openRouterTtsEngine,
          fallbackEngine: fallbackTts,
          maxInFlightSynthesis: 2,
          minBatchChars: 25,
          waitForFlushTurn: true,
          playChunkFn: async (chunk, turnId) => {
            if (stateMachine.isTurnCancelled(turnId) || localTtsQueueRef.current?.isTurnCancelled(turnId)) {
              return;
            }
            const sentenceText = (chunk.sentence || '').replace(/[*#_`~>]/g, '').trim();
            if (!sentenceText) return;
            const liveVoiceCfg = getLiveVoiceConfig(selectedPersona as PersonaId, companionIdentity);
            const chatVoiceCfg = getChatVoiceConfig(selectedPersona as PersonaId, companionIdentity);
            const effectiveVoice =
              getSelectedVoiceProvider() === 'openrouter'
                ? liveVoiceCfg.heygenVoiceId || chatVoiceCfg.heygenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE
                : selectedVoice || liveVoiceCfg.voiceId;
            const ttsRes = await speakLiveSentenceWithConfiguredProvider({
              sentence: sentenceText,
              identity: companionIdentity,
              personaId: selectedPersona as PersonaId,
              voiceId: effectiveVoice,
              accent: liveAccent || liveVoiceCfg.accent,
              tone: liveTone || liveVoiceCfg.tone,
              speed: getTtsRate(),
              pitch: getTtsPitch(),
              turnId,
              preserveQueue: true,
              prefetchedOpenRouterAudio: chunk.payload,
              signal: localTtsQueueRef.current?.getTurnSignal(turnId),
            });
            if (ttsRes?.interrupted) {
              lastPlaybackEndedAtRef.current = Date.now();
              return;
            }
          },
          onSentenceStarted: (sentence, idx, turnId) => {
            if (stateMachine.isTurnCancelled(turnId)) return;
            if (idx === 1) {
              void plugin.setSpeakingState({ speaking: true, turnId }).catch(() => {});
            }
            stateMachine.markSentencePlaybackStarted(sentence, turnId);
            recentSpokenSegmentsRef.current = recordSpokenSegment(
              recentSpokenSegmentsRef.current,
              sentence,
              Date.now(),
            );
            spokenLiveTurnTextRef.current = spokenLiveTurnTextRef.current
              ? `${spokenLiveTurnTextRef.current} ${sentence}`
              : sentence;
            addDebugLog(
              'OpenRouterLive:SentenceStart',
              `[Turn #${turnId} Sentence #${idx} voiceProvider=${getSelectedVoiceProvider()}] "${sentence}"`,
            );
          },
          onSentenceFinished: (sentence, idx, turnId) => {
            lastPlaybackEndedAtRef.current = Date.now();
            if (stateMachine.isTurnCancelled(turnId)) return;
            stateMachine.markSentencePlaybackCompleted(sentence, turnId);
            addDebugLog('OpenRouterLive:SentenceDone', `[Turn #${turnId} Sentence #${idx}] finished`);
          },
          onQueueDrained: (turnId) => {
            lastPlaybackEndedAtRef.current = Date.now();
            endSpeakingTurn();
            void plugin.setSpeakingState({ speaking: false, thinking: false, turnId }).catch(() => {});
            stateMachine.completeAssistantTurn(turnId);
          },
        });
        localTtsQueueRef.current = ttsQueue;

        const statusListener = await plugin.addListener('localVoiceStatus', (evt) => {
          if (evt?.status) {
            const st = evt.status as LocalVoiceStatus;
            addDebugLog(
              'OpenRouterLive:NativeStatus',
              `Native status="${st}"${evt.stage ? ` stage="${evt.stage}"` : ''} detail="${evt.detail || ''}"`,
            );
            if (st === 'interrupted') {
              lastPlaybackEndedAtRef.current = Date.now();
              stateMachine.handleNativeBargeIn(evt.interruptedTurnId, evt.sustainedMs, evt.threshold);
              return;
            }
            if (st === 'error') {
              const errMsg = evt.detail || evt.lastNativeError || 'Audio capture error';
              setConnectionError(errMsg);
            }
            setLocalVoiceStatus(st);
            setIsThinking(st === 'thinking');
            isThinkingRef.current = st === 'thinking';
            setIsSpeaking(st === 'speaking');
            isSpeakingRef.current = st === 'speaking';
          }
        });

        const vadListener = await plugin.addListener('localVadEvent', (evt) => {
          addDebugLog(
            'OpenRouterLive:VAD',
            `phase=${evt?.phase || 'unknown'} prob=${Number(evt?.probability || 0).toFixed(3)} isSpeech=${Boolean(evt?.isSpeech)}`,
          );
        });

        const transcriptListener = await plugin.addListener('localTranscriptCommitted', async (evt) => {
          const text = String(evt?.transcript || '').trim();
          if (!text || isPlaceholderOrErrorTurn(text)) return;

          const rawTranscript = String(evt?.rawTranscript || text).trim();
          const audioMs = Number(evt?.audioMs ?? evt?.utteranceDurationMs ?? 0);
          const whisperMs = Number(evt?.whisperMs ?? 0);
          const rms = typeof evt?.rms === 'number' ? evt.rms : undefined;

          const sttCheck = evaluateSttUtterance({
            transcript: text,
            rms,
            durationMs: audioMs,
            whisperMs,
            languageCode: selectedLanguageRef.current || 'en-US',
          });
          if (!sttCheck.accept) {
            logDroppedSttUtterance(sttCheck, {
              transcript: text,
              rms,
              durationMs: audioMs,
              whisperMs,
              languageCode: selectedLanguageRef.current || 'en-US',
            });
            void plugin.setSpeakingState({ speaking: false, thinking: false, turnId: 0 }).catch(() => {});
            setLocalVoiceStatus('listening');
            setIsThinking(false);
            isThinkingRef.current = false;
            return;
          }

          const echoCheck = shouldDropEchoTranscript({
            transcript: text,
            recentSegments: recentSpokenSegmentsRef.current,
            nowMs: Date.now(),
            isSpeaking: isSpeakingRef.current || stateMachine.getState() === 'speaking',
            lastPlaybackEndedAtMs: lastPlaybackEndedAtRef.current,
          });
          if (echoCheck.drop) {
            addDebugLog(
              'Echo:Dropped',
              `[Echo:Dropped] (${echoCheck.reason}, overlap=${Math.round(echoCheck.overlapRatio * 100)}%) "${text}"`,
            );
            void plugin.setSpeakingState({ speaking: false, thinking: false, turnId: 0 }).catch(() => {});
            setLocalVoiceStatus('listening');
            setIsThinking(false);
            isThinkingRef.current = false;
            return;
          }

          if (evt?.fromBargeIn) {
            stateMachine.handleNativeBargeIn(stateMachine.getActiveTurnId());
          }
          const sttMs = audioMs;
          addDebugLog(
            'OpenRouterLive:Transcript',
            `Committed utterance (audioMs=${audioMs}ms, whisperMs=${whisperMs}ms, rms=${rms !== undefined ? rms.toFixed(4) : 'n/a'}, bargeIn=${Boolean(evt?.fromBargeIn)}): "${text}"`,
          );
          setTranscripts((prev) => [
            ...prev,
            {
              id: `user-or-${Date.now()}`,
              sender: 'user',
              text,
              rawTranscript,
              timestamp: Date.now(),
            },
          ]);

          const priorHistory = stateMachine.getChatHistory();
          stateMachine.recordUserUtteranceInHistory(text);
          const turnId = stateMachine.beginAssistantThinking();
          pendingLiveUserTurnRef.current = text;
          spokenLiveTurnTextRef.current = '';
          void plugin.setSpeakingState({ speaking: false, turnId }).catch(() => {});
          ttsQueue.beginTurn(turnId);

          if (openRouterAbortControllerRef.current) {
            openRouterAbortControllerRef.current.abort();
          }
          const abortCtrl = new AbortController();
          openRouterAbortControllerRef.current = abortCtrl;
          setOpenRouterModelError(null);
          setConnectionError(null);

          const customDirectives = getCustomDirectives();
          let firstAudioTimeMs = 0;
          const turnStartTime = Date.now();
          let queuedAnySentence = false;

          const turnRes = await streamOpenRouterLiveTurn({
            turnId,
            userUtterance: text,
            history: priorHistory,
            identity: companionIdentity,
            personaId: selectedPersona as PersonaId,
            contentMode,
            languageCode: selectedLanguageRef.current || 'en-US',
            accent: liveAccent,
            tone: liveTone,
            customDirectives,
            injectMemory: true,
            sttMs,
            audioMs,
            whisperMs,
            freeModelsPool: openRouterFreeModels,
            signal: abortCtrl.signal,
            onSentenceReady: (sentence, idx) => {
              if (stateMachine.isTurnCancelled(turnId) || ttsQueue.isTurnCancelled(turnId)) {
                return;
              }
              queuedAnySentence = true;
              if (idx === 0 && firstAudioTimeMs === 0) {
                firstAudioTimeMs = Date.now() - turnStartTime;
              }
              ttsQueue.enqueueSentence(sentence, turnId);
            },
          });

          if (openRouterAbortControllerRef.current === abortCtrl) {
            openRouterAbortControllerRef.current = null;
          }

          if (!turnRes.ok) {
            const realErr = turnRes.errorText || 'OpenRouter request failed';
            addDebugLog('OpenRouterLive:TurnError', `[Turn #${turnId}] ${realErr}`);
            pendingLiveUserTurnRef.current = '';
            void plugin.setSpeakingState({ speaking: false, thinking: false, turnId }).catch(() => {});
            stateMachine.completeAssistantTurn(turnId);
            if (
              turnRes.status === 401 ||
              turnRes.auth401Provider ||
              realErr.includes('(401)') ||
              realErr.toLowerCase().includes('invalid or unrecognized api key')
            ) {
              setLiveAuth401Provider(turnRes.auth401Provider || 'openrouter');
            }
            setOpenRouterModelError(realErr);
            setConnectionError(realErr);
            setLocalVoiceStatus('error');
            setIsThinking(false);
            isThinkingRef.current = false;
            toast.error(realErr);
            return;
          }

          const actualAnsweredModel = turnRes.answeredModel || turnRes.model;
          if (actualAnsweredModel) {
            setLastAnsweredLiveModel(actualAnsweredModel);
          }

          if (!turnRes.interrupted && !stateMachine.isTurnCancelled(turnId) && !ttsQueue.isTurnCancelled(turnId)) {
            void ttsQueue.flushTurn(turnId);
          }

          if (!queuedAnySentence || !turnRes.replyText?.trim()) {
            addDebugLog('OpenRouterLive:EmptyReply', `[Turn #${turnId}] Model returned no spoken sentences; resuming listening.`);
            pendingLiveUserTurnRef.current = '';
            endSpeakingTurn();
            void plugin.setSpeakingState({ speaking: false, thinking: false, turnId }).catch(() => {});
            stateMachine.completeAssistantTurn(turnId);
          }

          if (turnRes.replyText && !turnRes.interrupted && !stateMachine.isTurnCancelled(turnId)) {
            setTranscripts((prev) => [
              ...prev,
              {
                id: `sierra-or-${Date.now()}`,
                sender: 'sierra',
                text: turnRes.replyText,
                timestamp: Date.now(),
                model: actualAnsweredModel,
              },
            ]);
            saveCompletedLiveExchange({
              turnKey: `or-turn-${turnId}`,
              userText: text,
              replyText: turnRes.replyText,
            });
            pendingLiveUserTurnRef.current = '';
          } else if (turnRes.interrupted || stateMachine.isTurnCancelled(turnId)) {
            const partialSpoken = spokenLiveTurnTextRef.current.trim();
            if (partialSpoken) {
              saveCompletedLiveExchange({
                turnKey: `or-turn-${turnId}`,
                userText: text,
                replyText: partialSpoken,
                wasInterrupted: true,
                spokenPrefix: partialSpoken,
              });
            }
            pendingLiveUserTurnRef.current = '';
          }
        });

        localListenersRef.current.push(statusListener, vadListener, transcriptListener);

        const micPerm = await ensureNativeLocalMicPermission(plugin, Capacitor.isNativePlatform());
        addDebugLog(
          'OpenRouterLive:MicPermission',
          `Microphone permission check: granted=${micPerm.granted}${micPerm.reason ? ` (${micPerm.reason})` : ''}`,
        );
        if (!micPerm.granted) {
          setLocalVoiceStatus('error');
          const permMsg =
            micPerm.reason || 'Microphone permission is required for OpenRouter Live voice. Allow mic access and try again.';
          setConnectionError(permMsg);
          setIsConnecting(false);
          toast.error(permMsg);
          return;
        }

        addDebugLog('OpenRouterLive:Stage', 'Starting native 16kHz AudioRecord + SileroVAD + Whisper session...');
        const startRes = await plugin.startLocalSession({
          silenceTimeoutMs: unifiedLocalCfg.silenceTimeoutMs,
          minUtteranceMs: unifiedLocalCfg.minUtteranceMs,
          preRollMs: unifiedLocalCfg.preRollMs,
          bargeInSustainedMs: unifiedLocalCfg.bargeInSustainedMs,
          bargeInThreshold: unifiedLocalCfg.bargeInThreshold,
          bargeInSpeakerBoost: 0,
          bargeInMode: unifiedLocalCfg.bargeInMode,
          micSource: unifiedLocalCfg.micSource || 'auto',
          saveLast10Utterances: Boolean(unifiedLocalCfg.saveLast10Utterances),
          ttsEngine: 'android_tts',
          chatTemplate: 'llama3',
          systemPrompt: '',
        });

        if (!startRes.ok && Capacitor.isNativePlatform()) {
          setLocalVoiceStatus('error');
          const msg = startRes.reason || 'Failed to start microphone capture for OpenRouter Live.';
          addDebugLog('OpenRouterLive:StartError', msg);
          setConnectionError(msg);
          setIsConnecting(false);
          toast.error(msg);
          return;
        }

        if (typeof startRes.hasHeadset === 'boolean') {
          hasHeadsetRef.current = startRes.hasHeadset;
          stateMachine.setHasHeadset(startRes.hasHeadset);
        }

        stateMachine.startListening();
        setLocalVoiceStatus('listening');
        setIsActive(true);
        isActiveRef.current = true;
        setIsConnecting(false);
        setConnectionError(null);
        const activeOrModel = resolveEffectiveOpenRouterModel(getOpenRouterModelSettings(), openRouterFreeModels, contentMode);
        const orCustomDir = getCustomDirectives();
        const sessionOrPrompt = buildOpenRouterSystemPrompt({
          personaId: selectedPersona as PersonaId,
          contentMode,
          companionIdentity,
          customDirectives: orCustomDir,
          languageCode: selectedLanguageRef.current || 'en-US',
          accent: liveAccent,
          tone: liveTone,
          injectMemory: unifiedLocalCfg.injectMemory ?? true,
          isLiveSpoken: true,
        });
        addDebugLog(
          'PromptDump',
          `[OpenRouterLive:PromptDump] model=${activeOrModel}, identity=${companionIdentity}, persona=${selectedPersona}, mode=${contentMode}, chars=${sessionOrPrompt.length}\n${sessionOrPrompt}`,
        );
        addDebugLog(
          'OpenRouterLive:SessionActive',
          `OpenRouter Live session active: model=${activeOrModel}, STT=Whisper(${whisperSpec.filename})+SileroVAD, TTS=${getSelectedVoiceProvider()}, bargeInMode=${unifiedLocalCfg.bargeInMode}, headset=${hasHeadsetRef.current}, threshold=${unifiedLocalCfg.bargeInThreshold.toFixed(2)}`,
        );
        toast.success(`OpenRouter Live active (${activeOrModel.split('/').pop()})!`);
        return;
      }

      if (liveProvider === 'local') {
        let localCfg = getLocalVoiceSettings();
        const plugin = getSierraLocalVoicePlugin();
        const sysInfo = await plugin.getStorageAndNetworkStatus().catch(() => null);
        if (sysInfo?.ok && typeof sysInfo.totalRamMb === 'number' && sysInfo.totalRamMb > 0 && !localCfg.whisperSizeUserSelected) {
          const recWhisper = resolveEffectiveWhisperSize(localCfg, sysInfo.cpuCores, sysInfo.totalRamMb);
          if (recWhisper !== localCfg.whisperSize) {
            localCfg = saveLocalVoiceSettings({
              whisperSize: recWhisper,
              whisperSizeUserSelected: false,
            });
          }
        }
        const requiredSpecs = getRequiredModelsForSettings(localCfg);
        const tinySpec = LOCAL_WHISPER_MODELS['tiny.en'];
        const querySpecs = requiredSpecs.some((s) => s.id === tinySpec.id)
          ? requiredSpecs
          : [...requiredSpecs, tinySpec];

        // Do NOT use native SpeechRecognizer plugin for Local provider (prevents errorCode 5 loops)
        if (Capacitor.isNativePlatform()) {
          try {
            await withNativeTimeout(CapSpeechRecognition.stop(), 1000, undefined, 'CapSpeechRecognition.stop()');
          } catch (_) {}
        }
        await teardownNativeListeners();

        const modStatus = await plugin.getModelsStatus({
          models: querySpecs.map((s) => ({
            id: s.id,
            filename: s.filename,
            sizeBytes: s.sizeBytes,
            sha256: s.sha256,
          })),
        });

        const missingSpecs = requiredSpecs.filter((s) => !modStatus?.models?.[s.id]?.downloaded);
        if (missingSpecs.length > 0) {
          setLocalVoiceStatus('downloading');
          setShowLocalDownloadModal(true);
          setIsConnecting(false);
          addDebugLog(
            'LocalVoice:FirstUseDownload',
            `Missing ${missingSpecs.length} local model(s) (${missingSpecs.map((m) => m.filename).join(', ')}) — prompting user to download`,
          );
          toast.info('Please download the selected Local Voice models first.');
          return;
        }

        // Clean up any prior listeners and attach diagnostic listener before loadModels
        for (const l of localListenersRef.current) {
          await l.remove().catch(() => {});
        }
        localListenersRef.current = [];

        const diagListener = await plugin.addListener('localDiagnostic', (evt) => {
          const cat = String(evt?.category || 'LocalLLM:Diag');
          const det = String(evt?.detail || '');
          if (det) {
            addDebugLog(cat, det);
          }
        });
        localListenersRef.current.push(diagListener);

        setLocalVoiceStatus('loading_model');
        const llmSpec = getActiveLlmArtifactSpec(localCfg);
        let whisperSpec = LOCAL_WHISPER_MODELS[localCfg.whisperSize] || LOCAL_WHISPER_MODELS['base.en'];
        addDebugLog(
          'LocalVoice:LoadModel',
          `Loading LLM="${llmSpec.filename}" + Whisper="${whisperSpec.filename}" + SileroVAD="${LOCAL_SILERO_VAD_MODEL.filename}"...`,
        );

        let loadRes = await plugin.loadModels({
          llmFilename: llmSpec.filename,
          whisperFilename: whisperSpec.filename,
          vadFilename: LOCAL_SILERO_VAD_MODEL.filename,
          piperFilename: LOCAL_PIPER_VOICE_MODEL.filename,
          piperConfigFilename: LOCAL_PIPER_VOICE_CONFIG.filename,
          ttsEngine: localCfg.ttsEngine,
          chatTemplate: llmSpec.chatTemplate || 'llama3',
        });

        if (
          !loadRes.ok &&
          whisperSpec.id !== tinySpec.id &&
          modStatus?.models?.[tinySpec.id]?.downloaded
        ) {
          addDebugLog(
            'STT:Fallback',
            `Failed to load Whisper ${whisperSpec.filename} (${loadRes.reason || 'unknown'}); falling back to tiny.en (${tinySpec.filename}).`,
          );
          whisperSpec = tinySpec;
          loadRes = await plugin.loadModels({
            llmFilename: llmSpec.filename,
            whisperFilename: whisperSpec.filename,
            vadFilename: LOCAL_SILERO_VAD_MODEL.filename,
            piperFilename: LOCAL_PIPER_VOICE_MODEL.filename,
            piperConfigFilename: LOCAL_PIPER_VOICE_CONFIG.filename,
            ttsEngine: localCfg.ttsEngine,
            chatTemplate: llmSpec.chatTemplate || 'llama3',
          });
        }

        if (!loadRes.ok) {
          setLocalVoiceStatus('error');
          const errReason =
            loadRes.reason ||
            loadRes.lastNativeError ||
            (loadRes.oom
              ? 'Out of memory loading model. Switch to the Small (1.5B Q4) model in Settings.'
              : 'Failed to load local models.');
          addDebugLog('LocalVoice:LoadError', errReason);
          setConnectionError(errReason);
          setIsConnecting(false);
          toast.error(errReason);
          return;
        }

        const actualTtsEngine: LocalTtsEngineId = loadRes.activeTtsEngine || 'android_tts';
        if (loadRes.selfTestText !== undefined) {
          addDebugLog(
            'LocalVoice:SelfTest',
            `Startup 3-token llama.cpp self-test OK: generated="${loadRes.selfTestText}" speed=${loadRes.selfTestTokensPerSec ?? 0} tok/s elapsed=${loadRes.selfTestElapsedMs ?? 0}ms (threads=${loadRes.inferenceThreads ?? 6})`,
          );
        }
        if (localCfg.ttsEngine === 'piper' && actualTtsEngine === 'android_tts') {
          addDebugLog(
            'LocalVoice:TTSNotice',
            'Native Piper ONNX phonemizer is not bundled; using Android System TextToSpeech (android_tts) for speech output.',
          );
        }

        const primaryTts =
          actualTtsEngine === 'piper' ? new PiperLocalTtsEngine() : new AndroidSystemLocalTtsEngine();
        const fallbackTts = new AndroidSystemLocalTtsEngine();

        const unifiedThreshold = Math.min(0.95, Math.max(0.2, localCfg.bargeInThreshold || 0.85));
        const unifiedBargeInMode = localCfg.bargeInMode || 'headphones_only';
        const unifiedSustainedMs =
          unifiedBargeInMode === 'adaptive' ? 400 : Math.max(800, localCfg.bargeInSustainedMs || 800);
        const webHeadset = await detectConnectedHeadphones().catch(() => false);
        const nativeHeadsetRes = await plugin.isHeadsetConnected?.().catch(() => ({ connected: false }));
        const detectedHeadset = Boolean(nativeHeadsetRes?.connected ?? webHeadset);
        hasHeadsetRef.current = detectedHeadset;

        const unifiedLocalCfg = {
          ...localCfg,
          bargeInThreshold: unifiedThreshold,
          bargeInSpeakerBoost: 0,
          bargeInSustainedMs: unifiedSustainedMs,
          bargeInMode: unifiedBargeInMode,
          hasHeadset: detectedHeadset,
        };

        const stateMachine = new LocalVoiceTurnStateMachine(unifiedLocalCfg, {
          onStatusChange: (st, reason) => {
            setLocalVoiceStatus(st);
            setIsThinking(st === 'thinking');
            isThinkingRef.current = st === 'thinking';
            setIsSpeaking(st === 'speaking');
            isSpeakingRef.current = st === 'speaking';
            addDebugLog('LocalVoice:Status', `Status -> ${st}${reason ? ` (${reason})` : ''}`);
          },
          stopAndFlushAudioPlayback: () => {
            lastPlaybackEndedAtRef.current = Date.now();
            stopPlayback();
            if (Capacitor.isNativePlatform()) {
              void TextToSpeech.stop().catch(() => {});
            } else if (typeof window !== 'undefined' && window.speechSynthesis) {
              try {
                window.speechSynthesis.cancel();
              } catch (_) {}
            }
            void plugin.setSpeakingState({ speaking: false, turnId: 0 }).catch(() => {});
            void plugin.interruptTurn().catch(() => {});
          },
          cancelLlmGeneration: () => {
            void plugin.interruptTurn().catch(() => {});
          },
          cancelTtsAndEmptyQueue: () => {
            void localTtsQueueRef.current?.cancelAndClear();
          },
          onBargeInTriggered: ({ spokenText, interruptedTurnId, sustainedSpeechMs, effectiveThreshold }) => {
            if (pendingLiveUserTurnRef.current && spokenText.trim()) {
              saveCompletedLiveExchange({
                turnKey: `local-turn-${interruptedTurnId}`,
                userText: pendingLiveUserTurnRef.current,
                replyText: spokenText,
                wasInterrupted: true,
                spokenPrefix: spokenText,
              });
              pendingLiveUserTurnRef.current = '';
            }
            addDebugLog(
              'LocalVoice:BargeIn',
              `Barge-in interrupted turn #${interruptedTurnId} after ${sustainedSpeechMs}ms speech (threshold=${effectiveThreshold.toFixed(2)}). Spoken prefix recorded: "${spokenText}"`,
            );
          },
          onBargeInEvaluated: (info) => {
            if (info.accepted) {
              addDebugLog(
                'BargeIn:Accepted',
                `reason=${info.reason} vad=${info.vadProb.toFixed(3)} micRms=${info.micRms.toFixed(4)} playbackRms=${info.playbackRms.toFixed(4)} sustainedMs=${info.sustainedMs} mode=${info.mode} headset=${info.hasHeadset}`,
              );
            } else {
              const now = Date.now();
              if (now - lastBargeInIgnoredLogTimeRef.current >= 500 || info.reason === 'short_burst_reset') {
                lastBargeInIgnoredLogTimeRef.current = now;
                addDebugLog(
                  'BargeIn:Ignored',
                  `reason=${info.reason} vad=${info.vadProb.toFixed(3)} micRms=${info.micRms.toFixed(4)} playbackRms=${info.playbackRms.toFixed(4)} sustainedMs=${info.sustainedMs} mode=${info.mode} headset=${info.hasHeadset}`,
                );
              }
            }
          },
        });
        localStateMachineRef.current = stateMachine;

        const playLocalSentenceTts = async (sentence: string, turnId: number) => {
          if (stateMachine.isTurnCancelled(turnId) || localTtsQueueRef.current?.isTurnCancelled(turnId)) {
            return;
          }
          const cleanText = sentence.replace(/[*#_`~>]/g, '').trim();
          if (!cleanText) return;

          if (Capacitor.isNativePlatform()) {
            await plugin.setSpeakingState({ speaking: true, turnId }).catch(() => {});
            addDebugLog(
              'LocalTTS:Speak',
              `[Turn #${turnId}] Speaking via ${actualTtsEngine} (${cleanText.length} chars): "${cleanText}"`,
            );
            try {
              await TextToSpeech.speak({
                text: cleanText,
                lang: 'en-US',
                rate: getTtsRate(),
                pitch: getTtsPitch(),
              });
            } catch (err: any) {
              if (!stateMachine.isTurnCancelled(turnId)) {
                addDebugLog('LocalTTS:Error', `Native TextToSpeech error: ${err?.message || String(err)}`);
              }
            }
            return;
          }

          if (typeof window !== 'undefined' && window.speechSynthesis) {
            await plugin.setSpeakingState({ speaking: true, turnId }).catch(() => {});
            await new Promise<void>((resolve) => {
              const utterance = new SpeechSynthesisUtterance(cleanText);
              utterance.lang = 'en-US';
              utterance.onend = () => resolve();
              utterance.onerror = () => resolve();
              window.speechSynthesis.speak(utterance);
            });
          }
        };

        const ttsQueue = new LocalTtsQueueCoordinator({
          primaryEngine: primaryTts,
          fallbackEngine: fallbackTts,
          maxInFlightSynthesis: 2,
          minBatchChars: 25,
          waitForFlushTurn: true,
          playChunkFn: async (chunk, turnId) => {
            if (stateMachine.isTurnCancelled(turnId) || localTtsQueueRef.current?.isTurnCancelled(turnId)) {
              return;
            }
            if (chunk.pcmBase64) {
              await playAudio(chunk.pcmBase64);
            } else {
              await playLocalSentenceTts(chunk.sentence || '', turnId);
            }
          },
          onSentenceStarted: (sentence, idx, turnId) => {
            if (stateMachine.isTurnCancelled(turnId)) return;
            if (idx === 1) {
              void plugin.setSpeakingState({ speaking: true, turnId }).catch(() => {});
            }
            stateMachine.markSentencePlaybackStarted(sentence, turnId);
            recentSpokenSegmentsRef.current = recordSpokenSegment(
              recentSpokenSegmentsRef.current,
              sentence,
              Date.now(),
            );
            spokenLiveTurnTextRef.current = spokenLiveTurnTextRef.current
              ? `${spokenLiveTurnTextRef.current} ${sentence}`
              : sentence;
            addDebugLog(
              'LocalTTS:SentenceStart',
              `[Turn #${turnId} Sentence #${idx} engine=${actualTtsEngine}] "${sentence}"`,
            );
          },
          onSentenceFinished: (sentence, idx, turnId) => {
            lastPlaybackEndedAtRef.current = Date.now();
            if (stateMachine.isTurnCancelled(turnId)) return;
            stateMachine.markSentencePlaybackCompleted(sentence, turnId);
            addDebugLog('LocalTTS:SentenceDone', `[Turn #${turnId} Sentence #${idx}] finished`);
          },
          onQueueDrained: (turnId) => {
            lastPlaybackEndedAtRef.current = Date.now();
            endSpeakingTurn();
            void plugin.setSpeakingState({ speaking: false, turnId }).catch(() => {});
            stateMachine.completeAssistantTurn(turnId);
          },
        });
        localTtsQueueRef.current = ttsQueue;

        const statusListener = await plugin.addListener('localVoiceStatus', (evt) => {
          if (evt?.status) {
            const st = evt.status as LocalVoiceStatus;
            addDebugLog('LocalVoice:NativeStatus', `Native status="${st}" detail="${evt.detail || ''}"`);
            if (st === 'interrupted') {
              lastPlaybackEndedAtRef.current = Date.now();
              stateMachine.handleNativeBargeIn(evt.interruptedTurnId, evt.sustainedMs, evt.threshold);
              return;
            }
            if (st === 'error') {
              // Do not overwrite status with error while an auto-retry is in progress
              if (isThinkingRef.current) {
                return;
              }
              const errMsg = evt.detail || evt.lastNativeError || 'Local voice engine error';
              setConnectionError(errMsg);
            }
            setLocalVoiceStatus(st);
            setIsThinking(st === 'thinking');
            isThinkingRef.current = st === 'thinking';
            setIsSpeaking(st === 'speaking');
            isSpeakingRef.current = st === 'speaking';
          }
        });
        const transcriptListener = await plugin.addListener('localTranscriptCommitted', async (evt) => {
          const text = String(evt?.transcript || '').trim();
          if (!text || isPlaceholderOrErrorTurn(text)) {
            if (text) {
              addDebugLog('LocalWhisper:Skipped', `Ignored non-speech/placeholder transcript: "${text}"`);
            }
            return;
          }

          const rawTranscript = String(evt?.rawTranscript || text).trim();
          const audioMs = Number(evt?.audioMs ?? evt?.utteranceDurationMs ?? 0);
          const whisperMs = Number(evt?.whisperMs ?? 0);
          const rms = typeof evt?.rms === 'number' ? evt.rms : undefined;

          const sttCheck = evaluateSttUtterance({
            transcript: text,
            rms,
            durationMs: audioMs,
            whisperMs,
            languageCode: selectedLanguageRef.current || 'en-US',
          });
          if (!sttCheck.accept) {
            logDroppedSttUtterance(sttCheck, {
              transcript: text,
              rms,
              durationMs: audioMs,
              whisperMs,
              languageCode: selectedLanguageRef.current || 'en-US',
            });
            void plugin.setSpeakingState({ speaking: false, thinking: false, turnId: 0 }).catch(() => {});
            setLocalVoiceStatus('listening');
            setIsThinking(false);
            isThinkingRef.current = false;
            return;
          }

          const echoCheck = shouldDropEchoTranscript({
            transcript: text,
            recentSegments: recentSpokenSegmentsRef.current,
            nowMs: Date.now(),
            isSpeaking: isSpeakingRef.current || stateMachine.getState() === 'speaking',
            lastPlaybackEndedAtMs: lastPlaybackEndedAtRef.current,
          });
          if (echoCheck.drop) {
            addDebugLog(
              'Echo:Dropped',
              `[Echo:Dropped] (${echoCheck.reason}, overlap=${Math.round(echoCheck.overlapRatio * 100)}%) "${text}"`,
            );
            void plugin.setSpeakingState({ speaking: false, thinking: false, turnId: 0 }).catch(() => {});
            setLocalVoiceStatus('listening');
            setIsThinking(false);
            isThinkingRef.current = false;
            return;
          }

          if (evt?.fromBargeIn) {
            stateMachine.handleNativeBargeIn(stateMachine.getActiveTurnId());
          }
          const speechEndMs = Date.now();
          addDebugLog(
            'LocalWhisper:Transcript',
            `Committed utterance (audioMs=${audioMs}ms, whisperMs=${whisperMs}ms, rms=${rms !== undefined ? rms.toFixed(4) : 'n/a'}, bargeIn=${Boolean(evt?.fromBargeIn)}): "${text}"`,
          );
          setTranscripts((prev) => [
            ...prev,
            {
              id: `user-local-${Date.now()}`,
              sender: 'user',
              text,
              rawTranscript,
              timestamp: Date.now(),
            },
          ]);

          const priorHistory = stateMachine.getChatHistory();
          stateMachine.recordUserUtteranceInHistory(text);
          const turnId = stateMachine.beginAssistantThinking();
          pendingLiveUserTurnRef.current = text;
          spokenLiveTurnTextRef.current = '';
          setConnectionError(null);
          void plugin.setSpeakingState({ speaking: false, turnId }).catch(() => {});
          ttsQueue.beginTurn(turnId);
          const splitter = new LocalSentenceSplitter(25);
          let firstAudioLogged = false;

          const tokListener = await plugin.addListener('localTokenStream', (tokEvt) => {
            if (
              tokEvt?.turnId !== turnId ||
              stateMachine.isTurnCancelled(turnId) ||
              ttsQueue.isTurnCancelled(turnId)
            ) {
              return;
            }
            const readySentences = splitter.pushToken(String(tokEvt.token || ''));
            for (const s of readySentences) {
              if (stateMachine.isTurnCancelled(turnId) || ttsQueue.isTurnCancelled(turnId)) {
                return;
              }
              if (!firstAudioLogged) {
                firstAudioLogged = true;
                const ttfaMs = Date.now() - speechEndMs;
                addDebugLog('LocalVoice:TTFA', `[Turn #${turnId}] End-of-speech to first sentence ready: ${ttfaMs}ms`);
              }
              ttsQueue.enqueueSentence(s, turnId);
            }
          });

          try {
            const latestCfg = getLocalVoiceSettings();
            const customDirectives = getCustomDirectives();
            const fullPrompt = buildLocalConversationPrompt({
              history: priorHistory,
              userUtterance: text,
              chatTemplate: llmSpec.chatTemplate || 'llama3',
              personaId: selectedPersona as PersonaId,
              identity: companionIdentity,
              contentMode,
              customDirectives,
              injectMemory: latestCfg.injectMemory ?? true,
              omitHistory: false,
            });

            let genRes = await plugin.generateLocalReply({
              turnId,
              prompt: fullPrompt,
              userUtterance: text,
              chatTemplate: llmSpec.chatTemplate || 'llama3',
              ttsEngine: actualTtsEngine,
            });

            // Part B(6): Auto-retry once with compact prompt and NO history if the turn stalls
            const failureText = genRes?.reason || genRes?.lastNativeError || '';
            const isStallFailure =
              (!genRes || !genRes.ok) &&
              !stateMachine.isTurnCancelled(turnId) &&
              /stall|timeout/i.test(failureText);

            if (isStallFailure) {
              setLocalVoiceStatus('thinking');
              setIsThinking(true);
              isThinkingRef.current = true;
              setConnectionError(null);
              addDebugLog(
                'LocalLLM:StallRetry',
                `[Turn #${turnId}] Turn stalled (${failureText}). Auto-retrying once with compact prompt and no history...`,
              );
              const compactRetryPrompt = buildLocalConversationPrompt({
                history: [],
                userUtterance: text,
                chatTemplate: llmSpec.chatTemplate || 'llama3',
                personaId: selectedPersona as PersonaId,
                identity: companionIdentity,
                contentMode,
                customDirectives,
                injectMemory: false,
                omitHistory: true,
              });
              genRes = await plugin.generateLocalReply({
                turnId,
                prompt: compactRetryPrompt,
                userUtterance: text,
                chatTemplate: llmSpec.chatTemplate || 'llama3',
                ttsEngine: actualTtsEngine,
              });
            }

            if (!genRes || !genRes.ok) {
              const rawReason =
                genRes?.reason || genRes?.lastNativeError || 'Local LLM generation returned an error';
              const cleanErrReason = rawReason.replace(/^\[LocalLLM:Stall\]\s*/i, '');
              pendingLiveUserTurnRef.current = '';
              setLocalVoiceStatus('error');
              setIsThinking(false);
              isThinkingRef.current = false;
              addDebugLog('LocalLLM:Error', `[Turn #${turnId}] ${cleanErrReason}`);
              setConnectionError(cleanErrReason);
              toast.error(cleanErrReason);
              return;
            }

            const turnCancelled =
              Boolean(genRes.interrupted) ||
              stateMachine.isTurnCancelled(turnId) ||
              ttsQueue.isTurnCancelled(turnId);

            if (!turnCancelled) {
              const tailSentence = splitter.flush();
              if (tailSentence) {
                if (!firstAudioLogged) {
                  firstAudioLogged = true;
                  const ttfaMs = Date.now() - speechEndMs;
                  addDebugLog('LocalVoice:TTFA', `[Turn #${turnId}] End-of-speech to first sentence ready: ${ttfaMs}ms`);
                }
                ttsQueue.enqueueSentence(tailSentence, turnId);
              }
              void ttsQueue.flushTurn(turnId);
            }

            if (genRes.replyText) {
              addDebugLog(
                'LocalLLM:ReplyComplete',
                `[Turn #${turnId}] stopReason=${genRes.stopReason || 'done'}, promptTokens=${genRes.promptTokens ?? 0}, cachedTokensReused=${genRes.cachedTokensReused ?? 0}, promptEvalMs=${genRes.promptEvalMs ?? 0}, promptTokPerSec=${genRes.promptTokPerSec ?? 0}, firstTokenMs=${genRes.timeToFirstAudioMs ?? 0}, genTokPerSec=${genRes.tokensPerSec ?? 0}, tokens=${genRes.generatedTokens ?? 0}, totalLatency=${genRes.totalLatencyMs}ms, interrupted=${turnCancelled} | reply="${genRes.replyText}"`,
              );
              if (!turnCancelled && !isPlaceholderOrErrorTurn(genRes.replyText)) {
                setTranscripts((prev) => [
                  ...prev,
                  {
                    id: `sierra-local-${Date.now()}`,
                    sender: 'sierra',
                    text: genRes.replyText,
                    timestamp: Date.now(),
                  },
                ]);
                saveCompletedLiveExchange({
                  turnKey: `local-turn-${turnId}`,
                  userText: text,
                  replyText: genRes.replyText,
                });
                pendingLiveUserTurnRef.current = '';
              } else if (turnCancelled) {
                const partialSpoken = spokenLiveTurnTextRef.current.trim();
                if (partialSpoken) {
                  saveCompletedLiveExchange({
                    turnKey: `local-turn-${turnId}`,
                    userText: text,
                    replyText: partialSpoken,
                    wasInterrupted: true,
                    spokenPrefix: partialSpoken,
                  });
                }
                pendingLiveUserTurnRef.current = '';
              }
            } else if (turnCancelled) {
              const partialSpoken = spokenLiveTurnTextRef.current.trim();
              if (partialSpoken) {
                saveCompletedLiveExchange({
                  turnKey: `local-turn-${turnId}`,
                  userText: text,
                  replyText: partialSpoken,
                  wasInterrupted: true,
                  spokenPrefix: partialSpoken,
                });
              }
              pendingLiveUserTurnRef.current = '';
              addDebugLog(
                'LocalLLM:Cancelled',
                `[Turn #${turnId}] Generation cancelled before producing reply text (stopReason=${genRes.stopReason || 'cancelled'})`,
              );
            } else {
              pendingLiveUserTurnRef.current = '';
              const emptyErr = `[Turn #${turnId}] LLM returned empty replyText without cancellation (stopReason=${genRes.stopReason || 'unknown'})`;
              setLocalVoiceStatus('error');
              setIsThinking(false);
              isThinkingRef.current = false;
              addDebugLog('LocalLLM:Error', emptyErr);
              setConnectionError(emptyErr);
              toast.error(emptyErr);
            }
          } catch (genErr: any) {
            pendingLiveUserTurnRef.current = '';
            const rawErrMsg = genErr?.message || String(genErr) || 'Exception in generateLocalReply';
            const cleanErrMsg = rawErrMsg.replace(/^\[LocalLLM:Stall\]\s*/i, '');
            setLocalVoiceStatus('error');
            setIsThinking(false);
            isThinkingRef.current = false;
            addDebugLog('LocalLLM:Error', `[Turn #${turnId}] Exception: ${cleanErrMsg}`);
            setConnectionError(cleanErrMsg);
            toast.error(cleanErrMsg);
          } finally {
            await tokListener.remove().catch(() => {});
          }
        });

        const localVadListener = await plugin.addListener('localVadEvent', (evt) => {
          addDebugLog(
            'LocalVoice:VAD',
            `phase=${evt?.phase || 'unknown'} prob=${Number(evt?.probability || 0).toFixed(3)} isSpeech=${Boolean(evt?.isSpeech)}`,
          );
        });
        localListenersRef.current.push(statusListener, localVadListener, transcriptListener);

        const customDirectives = getCustomDirectives();
        const compactSys = buildCompactLocalSystemPrompt({
          identity: companionIdentity,
          personaId: selectedPersona as PersonaId,
          contentMode,
          customDirectives,
          injectMemory: unifiedLocalCfg.injectMemory ?? true,
        });
        const formattedPrefix = formatLocalSystemPrefix(
          compactSys.systemPrompt,
          llmSpec.chatTemplate || 'llama3',
        );

        const micPerm = await ensureNativeLocalMicPermission(plugin, Capacitor.isNativePlatform());
        addDebugLog(
          'LocalVoice:MicPermission',
          `Microphone permission check: granted=${micPerm.granted}${micPerm.reason ? ` (${micPerm.reason})` : ''}`,
        );
        if (!micPerm.granted) {
          setLocalVoiceStatus('error');
          const permMsg =
            micPerm.reason || 'Microphone permission is required for Local Voice. Allow mic access and try again.';
          setConnectionError(permMsg);
          setIsConnecting(false);
          toast.error(permMsg);
          return;
        }

        const startRes = await plugin.startLocalSession({
          silenceTimeoutMs: unifiedLocalCfg.silenceTimeoutMs,
          minUtteranceMs: unifiedLocalCfg.minUtteranceMs,
          preRollMs: unifiedLocalCfg.preRollMs,
          bargeInSustainedMs: unifiedLocalCfg.bargeInSustainedMs,
          bargeInThreshold: unifiedLocalCfg.bargeInThreshold,
          bargeInSpeakerBoost: 0,
          bargeInMode: unifiedLocalCfg.bargeInMode,
          micSource: unifiedLocalCfg.micSource || 'auto',
          saveLast10Utterances: Boolean(unifiedLocalCfg.saveLast10Utterances),
          ttsEngine: actualTtsEngine,
          chatTemplate: llmSpec.chatTemplate || 'llama3',
          systemPrompt: compactSys.systemPrompt,
          systemPrefix: formattedPrefix,
          cacheKey: compactSys.cacheKey,
        });

        if (!startRes.ok) {
          setLocalVoiceStatus('error');
          const msg = startRes.reason || 'Failed to start local voice audio pipeline.';
          addDebugLog('LocalVoice:StartError', msg);
          setConnectionError(msg);
          setIsConnecting(false);
          toast.error(msg);
          return;
        }

        if (typeof startRes.hasHeadset === 'boolean') {
          hasHeadsetRef.current = startRes.hasHeadset;
          stateMachine.setHasHeadset(startRes.hasHeadset);
        }

        const sessionTtsEngine: LocalTtsEngineId = startRes.activeTtsEngine || actualTtsEngine;
        stateMachine.startListening();
        setLocalVoiceStatus('listening');
        setIsActive(true);
        isActiveRef.current = true;
        setIsConnecting(false);
        setConnectionError(null);
        addDebugLog(
          'PromptDump',
          `[LocalVoice:PromptDump] model=${llmSpec.filename}, identity=${companionIdentity}, persona=${selectedPersona}, mode=${contentMode}, tokens~=${compactSys.estimatedTokens}, summaries=${compactSys.summaryCount}, chars=${compactSys.systemPrompt.length}\n${compactSys.systemPrompt}`,
        );
        addDebugLog(
          'LocalVoice:SessionActive',
          `Local (on-phone) session active: LLM=${llmSpec.filename}, Whisper=${whisperSpec.filename}, TTS=${sessionTtsEngine}, threads=${startRes.inferenceThreads ?? loadRes.inferenceThreads ?? 6}, bargeInMode=${unifiedLocalCfg.bargeInMode}, headset=${hasHeadsetRef.current}`,
        );
        toast.success('Local (on-phone) Voice active — 100% offline!');
        return;
      }

      if (voiceInputEngine === 'raw_streaming') {
        // When raw-mic Live mode is active, do NOT start or auto-restart the old native recognizer (CapSpeechRecognition).
        // It competes with getUserMedia for the Android mic and can leave the worklet receiving silence.
        // Stop it before opening the mic and keep it off until the session ends.
        if (Capacitor.isNativePlatform()) {
          try {
            await withNativeTimeout(CapSpeechRecognition.stop(), 1500, undefined, 'CapSpeechRecognition.stop()');
          } catch (_) {}
        }
        await teardownNativeListeners();

        const effectiveModel = customVoiceModel.trim() || voiceModel || 'gemini-3.8-live';
        addDebugLog('Session', `Connecting to Gemini Live (${effectiveModel}) with direct mic streaming...`);
        await ensureLiveWebSocket(effectiveModel);
        await startAudioCapture();

        const bgEnabled = isBackgroundLiveEnabled();
        setIsBackgroundLiveMode(bgEnabled);
        setBackgroundLiveSessionStatus(
          {
            isLiveSessionActive: true,
            isBackgroundModeEnabled: bgEnabled,
            isNativeAudioBridgeActive: bgEnabled && Capacitor.isNativePlatform(),
            identity: companionIdentity,
            personaId: selectedPersona,
            voiceId: selectedVoice,
          },
          () => stopSession('user')
        );

        if (bgEnabled && Capacitor.isNativePlatform()) {
          try {
            await SierraBackgroundVoice.checkAndRequestPermissions();
            await SierraBackgroundVoice.startBackgroundService({
              mode: 'live',
              startNativeAudio: true,
            });
            if (nativePcmListenerRef.current) {
              try {
                await nativePcmListenerRef.current.remove();
              } catch {}
            }
            nativePcmListenerRef.current = await SierraBackgroundVoice.addListener('onNativePcmChunk', (chunk) => {
              // When the app is in the background (document.hidden) or WebView AudioWorklet is throttled,
              // forward native 16kHz PCM chunks from SierraVoiceForegroundService directly to Gemini Live WebSocket
              if (!isActiveRef.current) return;
              if (typeof document !== 'undefined' && document.hidden && chunk?.data) {
                const ws = liveWsRef.current;
                if (ws && ws.readyState === WebSocket.OPEN && liveWsReadyRef.current) {
                  try {
                    ws.send(
                      JSON.stringify({
                        realtimeInput: {
                          audio: {
                            mimeType: 'audio/pcm;rate=16000',
                            data: chunk.data,
                          },
                        },
                      })
                    );
                    chunksSentCountRef.current++;
                    if (typeof chunk.rms === 'number' && chunk.rms >= 0.015) {
                      lastLocalVoiceChunkTimeRef.current = Date.now();
                      userSpeechEndTimeRef.current = Date.now();
                    }
                  } catch {}
                }
              }
            });

            if (notifStopListenerRef.current) {
              try {
                await notifStopListenerRef.current.remove();
              } catch {}
            }
            notifStopListenerRef.current = await SierraBackgroundVoice.addListener('onNotificationStop', () => {
              addDebugLog('BackgroundLive:NotificationStop', '[BackgroundLive] User tapped Stop in ongoing notification');
              stopSession('user');
              toast.info('Sierra Live stopped from notification');
            });

            addDebugLog(
              'BackgroundLive:Start',
              '[BackgroundLive] Started Android foreground service (microphone) + WakeLock + native 16kHz/24kHz PCM audio bridge'
            );
          } catch (bgErr: any) {
            addDebugLog('BackgroundLive:Warn', `[BackgroundLive] Foreground service warning: ${bgErr?.message || String(bgErr)}`);
          }
        }

        setIsActive(true);
        isActiveRef.current = true;
        setIsConnecting(false);
        setConnectionError(null);
        isPausedRef.current = false;
        setIsPaused(false);
        hasLoggedPausedRef.current = false;
        setUserSpeechDetected(false);
        setIsThinking(false);
        isThinkingRef.current = false;
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        setMicRms(0);
        addDebugLog('Session', 'Session active with raw 16kHz PCM audio streaming & Gemini Live VAD');
        toast.success("Sierra is listening with live audio streaming!");
        return;
      }

      if (!Capacitor.isNativePlatform()) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 16000,
            },
          });
          mediaStreamRef.current = stream;
          await startAudioCapture();
        } catch (micErr: any) {
          if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
            throw new Error("Microphone access denied. Please allow microphone permissions in your browser or device settings.");
          }
          throw new Error("Unable to access microphone: " + (micErr.message || "Device error"));
        }
      } else {
        // Native Android: CapSpeechRecognition manages microphone hardware directly.
        // Stop any active Web Audio capture so Android SpeechRecognizer has exclusive mic access.
        stopAudioCapture();
      }

      setIsActive(true);
      isActiveRef.current = true;
      setBackgroundLiveSessionStatus(
        {
          isLiveSessionActive: true,
          isBackgroundModeEnabled: isBackgroundLiveEnabled(),
          identity: companionIdentity,
          personaId: selectedPersona,
          voiceId: selectedVoice,
        },
        () => stopSession('user')
      );
      setIsConnecting(false);
      setConnectionError(null);
      isPausedRef.current = false;
      setIsPaused(false);
      hasLoggedPausedRef.current = false;
      consecutiveFailuresRef.current = 0;
      emptyCycleCountRef.current = 0;
      clientErrorRecoveryCountRef.current = 0;
      addDebugLog('Session', 'Session active, starting speech-to-text');
      if (isSpeakingRef.current || activeSourcesRef.current.length > 0) {
        addDebugLog('STT:WaitingForAudio', 'Session active, but recognizer start deferred: audio playback is active or queued');
        console.log("[Native STT] startSession deferred recognizer start because audio is playing or queued");
      } else {
        startSpeechToText();
      }
      toast.success("Sierra is listening!");
    } catch (error: any) {
      addDebugLog('Session:Error', error.message || 'Failed to start session');
      console.error("Failed to start voice session:", error);
      setIsConnecting(false);
      setConnectionError(error.message || "Failed to establish voice connection.");
      toast.error(error.message || "Failed to start live voice session");
      stopAudioCapture();
      void prepareNativeAudioRoute('media', 'live_start_error');
    }
  };

  const stopSession = (reason: 'user' | 'recovery_failed' | 'error' = 'user') => {
    flushAndSaveLiveMemorySummary(`stop_${reason}`);
    if (userPauseMergeTimerRef.current) {
      clearTimeout(userPauseMergeTimerRef.current);
      userPauseMergeTimerRef.current = null;
    }
    if (liveSessionReconnectTimerRef.current) {
      clearTimeout(liveSessionReconnectTimerRef.current);
      liveSessionReconnectTimerRef.current = null;
    }
    isReconnectingFromGoAwayRef.current = false;
    liveSessionResumptionHandleRef.current = null;
    firstSessionInputTranscriptLoggedRef.current = false;
    if (reason === 'user') {
      addDebugLog('Session', '[Session] Stopped by user');
    } else if (reason === 'recovery_failed') {
      addDebugLog('Session', '[Session] Stopped after recovery failed');
    } else {
      addDebugLog('Session', `[Session] Stopped: ${reason}`);
    }
    setIsActive(false);
    isActiveRef.current = false;
    setBackgroundLiveSessionStatus({
      isLiveSessionActive: false,
      isNativeAudioBridgeActive: false,
    });
    isRespondingRef.current = false;
    setIsConnecting(false);
    setIsSpeaking(false);
    isSpeakingRef.current = false;
    setUserSpeechDetected(false);
    isPausedRef.current = false;
    setIsPaused(false);
    hasLoggedPausedRef.current = false;
    consecutiveFailuresRef.current = 0;
    emptyCycleCountRef.current = 0;
    clientErrorRecoveryCountRef.current = 0;
    isStartingRef.current = false;
    isStartInFlightRef.current = false;
    isNativeListeningRef.current = false;
    liveWsTurnCompleteRef.current = false;
    currentTranscriptRef.current = '';

    cancelAllTimers();
    committedSessionRef.current = -1;
    terminalHandledSessionRef.current = -1;

    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (e) {
        // ignore
      }
      sessionRef.current = null;
    }

    if (liveWsRef.current) {
      try {
        liveWsRef.current.onopen = null;
        liveWsRef.current.onmessage = null;
        liveWsRef.current.onerror = null;
        liveWsRef.current.onclose = null;
        liveWsRef.current.close(1000, "Session stopped by user");
      } catch (e) {
        // ignore
      }
      liveWsRef.current = null;
      liveWsReadyRef.current = false;
      liveWsConnectPromiseRef.current = null;
    }

    if (nativePcmListenerRef.current) {
      try {
        nativePcmListenerRef.current.remove();
      } catch {}
      nativePcmListenerRef.current = null;
    }
    if (notifStopListenerRef.current) {
      try {
        notifStopListenerRef.current.remove();
      } catch {}
      notifStopListenerRef.current = null;
    }
    if (Capacitor.isNativePlatform()) {
      SierraBackgroundVoice.stopNativeAudioStream().catch(() => {});
      SierraBackgroundVoice.stopBackgroundService({ mode: 'live' }).catch(() => {});
    }

    stopVideoStreaming();
    stopAudioCapture();
    stopSpeechToText();
    teardownNativeListeners();
    stopPlayback();
    void prepareNativeAudioRoute('media', `live_stop_${reason}`);

    if (openRouterAbortControllerRef.current) {
      openRouterAbortControllerRef.current.abort();
      openRouterAbortControllerRef.current = null;
    }
    void stopTtsServiceSpeaking('session_stopped');
    if (localTtsQueueRef.current) {
      localTtsQueueRef.current.cancelAndClear().catch(() => {});
      localTtsQueueRef.current = null;
    }
    if (localListenersRef.current.length > 0) {
      for (const l of localListenersRef.current) {
        l.remove().catch(() => {});
      }
      localListenersRef.current = [];
    }
    if (liveProvider === 'local' || liveProvider === 'openrouter') {
      const plugin = getSierraLocalVoicePlugin();
      plugin.stopLocalSession().catch(() => {});
      if (liveProvider === 'local') {
        plugin.unloadModels().catch(() => {});
      }
      setLocalVoiceStatus('idle');
    }

    // If Wake Word is enabled in Settings, resume the on-device wake word listener once the Live session ends
    if (isWakeWordEnabled()) {
      startWakeWordListener().catch(() => {});
    }
  };

  const handleMicTap = async () => {
    if (mode !== 'continuous') return;
    if (isActive) {
      if (voiceInputEngine === 'raw_streaming') {
        if (isPausedRef.current) {
          isPausedRef.current = false;
          setIsPaused(false);
          addDebugLog('MicStream:Resume', 'User resumed live mic streaming');
          await startAudioCapture();
          toast.success("Sierra is listening!");
        } else {
          stopSession('user');
        }
        return;
      }
      if (isPausedRef.current) {
        addDebugLog('STT:Resume', 'User tapped mic to resume listening from paused state');
        console.log("[Native STT:Resume] User tapped mic to resume from paused");

        // 1. Fully tear down any existing recognizer (await stop with timeout)
        isStoppingRef.current = true;
        if (Capacitor.isNativePlatform()) {
          try {
            await withNativeTimeout(CapSpeechRecognition.stop(), 1500, undefined, 'CapSpeechRecognition.stop()');
          } catch (_) {}
        }
        await teardownNativeListeners();
        isStoppingRef.current = false;
        lastStopTimeRef.current = Date.now();

        // 2. Ignore errorCode 5 and 7 for 1.5 seconds after that teardown
        resumeGracePeriodUntilRef.current = Date.now() + 1500;

        // 3. Reset all counters and flags (consecutiveFailures, clientErrorRecoveryCount, startupFailures, isPaused)
        consecutiveFailuresRef.current = 0;
        clientErrorRecoveryCountRef.current = 0;
        startupFailuresRef.current = 0;
        isPausedRef.current = false;
        setIsPaused(false);
        hasLoggedPausedRef.current = false;
        setConnectionError(null);

        // 4. Wait at least 750 ms
        await new Promise((resolve) => setTimeout(resolve, 750));

        if (!isActiveRef.current || isPausedRef.current) {
          return;
        }

        // 5. Start
        toast.success("Sierra is listening!");
        await setupNativeListeners();
        startSpeechToText();
      } else {
        stopSession();
      }
    } else {
      // Direct user gesture: resume AudioContext synchronously before network connection
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!micAudioContextRef.current || micAudioContextRef.current.state === 'closed') {
          micAudioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
          addDebugLog('Diag', `[Diag] AudioContext created (tap handler capture): state=${micAudioContextRef.current.state}, sampleRate=${micAudioContextRef.current.sampleRate}`);
        }
        if (micAudioContextRef.current.state === 'suspended') {
          await micAudioContextRef.current.resume();
          addDebugLog('Diag', `[Diag] AudioContext resumed (tap handler capture): state=${micAudioContextRef.current.state}`);
        }
        if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
          playbackContextRef.current = new AudioContextClass({ sampleRate: 24000 });
          addDebugLog('Diag', `[Diag] AudioContext created (tap handler playback): state=${playbackContextRef.current.state}, sampleRate=${playbackContextRef.current.sampleRate}`);
        }
        if (playbackContextRef.current.state === 'suspended') {
          await playbackContextRef.current.resume();
          addDebugLog('Diag', `[Diag] AudioContext resumed (tap handler playback): state=${playbackContextRef.current.state}`);
        }
      } catch (tapCtxErr: any) {
        console.warn("[TapHandler] AudioContext resume error:", tapCtxErr);
      }
      startSession();
    }
  };

  const setupNativeListeners = async () => {
    if (voiceInputEngineRef.current !== 'native_recognizer') {
      return;
    }
    // Confirm listeners are registered once (no duplicate listeners from re-renders or repeated start calls)
    if (nativeListenersAttachedRef.current || isSettingUpListenersRef.current) {
      return;
    }
    isSettingUpListenersRef.current = true;

    addDebugLog('STT:Listeners', 'Setting up native partialResults and listeningState listeners...');
    console.log("[Native STT:Listeners] Setting up native partialResults and listeningState listeners...");

    try {
      // 1. partialResults listener
      nativeListenerRef.current = await withNativeTimeout(
        CapSpeechRecognition.addListener('partialResults', (data: { matches: string[]; sessionId?: number }) => {
          if (!isActiveRef.current || isPausedRef.current) return;
          const eventSessionId = (data as any)?.sessionId;
          if (eventSessionId !== undefined && eventSessionId !== sessionIdRef.current) {
            if (staleEventLoggedSessionRef.current !== eventSessionId) {
              staleEventLoggedSessionRef.current = eventSessionId;
              addDebugLog('STT:StaleEvent', `[Session #${eventSessionId} vs current #${sessionIdRef.current}] Ignored stale partialResults event`);
              console.warn(`[Native STT:StaleEvent] Ignored stale partialResults from session #${eventSessionId} (current is #${sessionIdRef.current})`);
            }
            return;
          }

          const currentSession = sessionIdRef.current;
          // Late partials for an already-committed session are ignored silently, not logged as 'Sierra speaking'
          if (committedSessionRef.current === currentSession) {
            return;
          }

          if (isSpeakingRef.current || isRespondingRef.current) {
            addDebugLog('partialResults', `[Session #${currentSession}] Ignored: Sierra currently speaking/responding`);
            return;
          }

          addDebugLog('partialResults', `[Session #${currentSession}] matches: ${JSON.stringify(data?.matches)}`);
          console.log(`[Native STT:partialResults:Session#${currentSession}] Matches:`, data?.matches);

          if (data?.matches && Array.isArray(data.matches) && data.matches.length > 0) {
            const topMatch = data.matches[0].trim();
            if (topMatch) {
              currentTranscriptRef.current = topMatch;
              setUserSpeechDetected(true);
              consecutiveFailuresRef.current = 0;
              clientErrorRecoveryCountRef.current = 0;
              startupFailuresRef.current = 0;
              addDebugLog('partialResults:Buffer', `[Session #${currentSession}] Buffer updated: "${topMatch}"`);
              console.log(`[Native STT:Buffer:Session#${currentSession}] "${topMatch}"`);

              // If a stopped event was waiting in the 400ms window, use this final match immediately!
              if (pendingCommitTimerRef.current) {
                clearTimeout(pendingCommitTimerRef.current);
                pendingCommitTimerRef.current = null;
                addDebugLog('STT:FinalMatchArrived', `[Session #${currentSession}] Final match arrived in 400ms window: "${topMatch}". Committing immediately.`);
                emptyCycleCountRef.current = 0;
                commitCurrentUtterance(currentSession);
                return;
              }

              if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
              }
              silenceTimerRef.current = setTimeout(() => {
                addDebugLog('STT:SilenceDebounce', `[Session #${currentSession}] Silence debounce fired (1200ms), committing: "${topMatch}"`);
                console.log(`[Native STT:SilenceDebounce:Session#${currentSession}] Committing utterance...`);
                commitCurrentUtterance(currentSession);
              }, 1200);
            }
          }
        }),
        2000,
        null,
        'CapSpeechRecognition.addListener("partialResults")'
      );

      // 2. listeningState listener
      nativeStateListenerRef.current = await withNativeTimeout(
        CapSpeechRecognition.addListener('listeningState', async (data: { status: 'started' | 'stopped' | 'ready' | 'endOfSpeech'; matches?: string[]; error?: string; errorCode?: number; sessionId?: number }) => {
          if (!isActiveRef.current || isPausedRef.current) {
            return;
          }
          const eventSessionId = (data as any)?.sessionId;
          if (eventSessionId !== undefined && eventSessionId !== sessionIdRef.current) {
            if (staleEventLoggedSessionRef.current !== eventSessionId) {
              staleEventLoggedSessionRef.current = eventSessionId;
              addDebugLog('STT:StaleEvent', `[Session #${eventSessionId} vs current #${sessionIdRef.current}] Ignored stale listeningState (${data?.status}) event`);
              console.warn(`[Native STT:StaleEvent] Ignored stale listeningState (${data?.status}) from session #${eventSessionId} (current is #${sessionIdRef.current})`);
            }
            return;
          }

          // Cancel started-confirmation timer on any listeningState event (Point 7)
          if (startedConfirmationTimerRef.current) {
            clearTimeout(startedConfirmationTimerRef.current);
            startedConfirmationTimerRef.current = null;
          }

          const currentSession = sessionIdRef.current;
          addDebugLog('listeningState', `[Session #${currentSession}] status: "${data?.status}", payload: ${JSON.stringify(data)}, buffer: "${currentTranscriptRef.current}"`);
          console.log(`[Native STT:listeningState:Session#${currentSession}] status=${data?.status}`, data);

          if (data?.status === 'ready') {
            sessionReadyTimeRef.current = Date.now();
            isNativeListeningRef.current = true;
            isStartingRef.current = false;
            isStartInFlightRef.current = false;
          } else if (data?.status === 'started') {
            sessionStartedTimeRef.current = Date.now();
            hasReachedStartedRef.current = true;
            isNativeListeningRef.current = true;
            isStartingRef.current = false;
            isStartInFlightRef.current = false;
            clientErrorRecoveryCountRef.current = 0; // Point 9: reset recovery counter
            emptyCycleCountRef.current = 0; // reset empty cycle backoff
            const now = Date.now();
            const elapsedFromStart = sessionRealStartTimeRef.current > 0 ? (now - sessionRealStartTimeRef.current) : 0;
            addDebugLog('STT:Started', `[Session #${currentSession}] Recognizer started (elapsed from session start: ${elapsedFromStart}ms)`);
            console.log(`[Native STT:Session#${currentSession}] Recognizer started (elapsed: ${elapsedFromStart}ms)`);
            if (recoveryStartedResolverRef.current) {
              recoveryStartedResolverRef.current(true);
              recoveryStartedResolverRef.current = null;
            }
          } else if (data?.status === 'endOfSpeech') {
            lastEndOfSpeechTimeRef.current = Date.now();
            addDebugLog('STT:EndOfSpeech', `[Session #${currentSession}] Speech pause detected, waiting for recognizer results...`);
          } else if (data?.status === 'stopped') {
            isNativeListeningRef.current = false;
            isStartingRef.current = false;
            isStartInFlightRef.current = false;

            // Process only the first terminal (stopped) event per session ID
            if (terminalHandledSessionRef.current === currentSession) {
              console.log(`[Native STT:listeningState:Session#${currentSession}] Duplicate stopped event ignored`);
              return;
            }
            terminalHandledSessionRef.current = currentSession;

            if (data?.matches && Array.isArray(data.matches) && data.matches.length > 0 && data.matches[0].trim()) {
              currentTranscriptRef.current = data.matches[0].trim();
              consecutiveFailuresRef.current = 0;
              clientErrorRecoveryCountRef.current = 0;
              emptyCycleCountRef.current = 0;
              startupFailuresRef.current = 0;
            }

            const errorCode = data?.errorCode;
            const isClientError = errorCode === 5 || (typeof data?.error === 'string' && data.error.toLowerCase().includes('client'));
            const isCode7Or11 = errorCode === 7 || errorCode === 11 || (typeof data?.error === 'string' && (data.error.toLowerCase().includes('no match') || data.error.toLowerCase().includes("didn't understand")));
            const now = Date.now();
            const elapsedFromStart = sessionRealStartTimeRef.current > 0 ? (now - sessionRealStartTimeRef.current) : 0;

            if (data?.error) {
              addDebugLog('STT:NativeError', `[Session #${currentSession}] Native recognizer reported: "${data.error}" (code: ${errorCode})`);
              console.warn(`[Native STT:NativeError:Session#${currentSession}]`, data.error, errorCode);
            }

            // Instant failure after playback: if session ends with code 11 in under 150ms, log STT:InstantFail, do not count toward emptyCycleCountRef, and retry after 1000ms
            if (errorCode === 11 && elapsedFromStart < 150 && !currentTranscriptRef.current.trim()) {
              addDebugLog('STT:InstantFail', `[Session #${currentSession}] Session ended with code 11 in ${elapsedFromStart}ms (<150ms). Retrying in 1000ms...`);
              console.warn(`[Native STT:InstantFail:Session#${currentSession}] Code 11 at ${elapsedFromStart}ms, retrying in 1000ms`);
              scheduleListeningRestart(1000);
              return;
            }

            // Resume tap grace period: ignore errorCode 5, 7, and 11 for 1.5s after teardown
            const inResumeGracePeriod = Date.now() < resumeGracePeriodUntilRef.current;
            if (inResumeGracePeriod && (errorCode === 5 || errorCode === 7 || errorCode === 11)) {
              addDebugLog('STT:IgnoreError', `[Session #${currentSession}] Ignored benign errorCode ${errorCode} during resume grace period`);
              console.log(`[Native STT:Session#${currentSession}] Ignored benign errorCode ${errorCode} during resume grace period`);
              return;
            }

            const isRecentCommit = (now - lastCommitTimeRef.current) < 3500;
            const isRecentEndOfSpeech = (now - lastEndOfSpeechTimeRef.current) < 3500;
            const isRecentStop = (now - lastStopTimeRef.current) < 3500;
            const isSpeakingOrResponding = isSpeakingRef.current || isRespondingRef.current || activeSourcesRef.current.length > 0;
            const isBenignClientError = isClientError && (isRecentCommit || isRecentEndOfSpeech || isRecentStop || isSpeakingOrResponding);

            if (isBenignClientError) {
              addDebugLog('STT:IgnoreClientError', `[Session #${currentSession}] Ignored benign errorCode 5 following utterance commit, stop, or reply playback`);
              console.log(`[Native STT:Session#${currentSession}] Ignored benign errorCode 5 following utterance commit/stop/playback`);
              return;
            }

            // Truncated endings: when listeningState reports "stopped" with a non-empty buffer,
            // wait ~400ms for a final partialResults/result event. If one arrives, use its top match;
            // otherwise commit the buffer. Commit exactly once per session.
            if (currentTranscriptRef.current.trim()) {
              const bufferedText = currentTranscriptRef.current.trim();
              addDebugLog('STT:StoppedWithBuffer', `[Session #${currentSession}] Stopped with buffer: "${bufferedText}". Waiting 400ms for final partialResults...`);
              if (pendingCommitTimerRef.current) {
                clearTimeout(pendingCommitTimerRef.current);
              }
              pendingCommitTimerRef.current = setTimeout(() => {
                pendingCommitTimerRef.current = null;
                if (!isActiveRef.current || isPausedRef.current) return;
                addDebugLog('STT:BufferCommitTimeout', `[Session #${currentSession}] 400ms window elapsed, committing buffered utterance: "${bufferedText}"`);
                emptyCycleCountRef.current = 0;
                startupFailuresRef.current = 0;
                consecutiveFailuresRef.current = 0;
                clientErrorRecoveryCountRef.current = 0;
                commitCurrentUtterance(currentSession);
              }, 400);
              return;
            }

            // Point 6: Treat errorCode 7 and 11 during recovery as benign
            if (isRecoveringFromClientErrorRef.current && isCode7Or11) {
              addDebugLog('STT:RecoveryBenign', `[Session #${currentSession}] Ignored benign errorCode ${errorCode} during client error recovery`);
              console.log(`[Native STT:Session#${currentSession}] Ignored benign errorCode ${errorCode} during recovery`);
              if (startedConfirmationTimerRef.current) {
                clearTimeout(startedConfirmationTimerRef.current);
                startedConfirmationTimerRef.current = null;
              }
              emptyCycleCountRef.current++;
              const backoffDelay = emptyCycleCountRef.current <= 1 ? 800 : 1200;
              scheduleListeningRestart(backoffDelay);
              return;
            }

            // Point 3 & Condition 3: Do not restart immediately on errorCode 7 or 11. Growing backoff 800ms, then 1200ms.
            if (isCode7Or11) {
              const timeSinceReady = sessionReadyTimeRef.current > 0 ? (now - sessionReadyTimeRef.current) : 999999;
              const isStartupFailure = (errorCode === 7) && (timeSinceReady <= 1200);

              if (isStartupFailure) {
                startupFailuresRef.current++;
                addDebugLog('STT:StartupFailure', `[Session #${currentSession}] Startup failure detected (${startupFailuresRef.current}/3, timeSinceReady: ${timeSinceReady}ms)`);
                if (startupFailuresRef.current >= 3) {
                  pauseListening("Speech recognizer failed to start after 3 attempts. Tap mic to retry.");
                  toast.error("Speech recognizer failed to start after 3 attempts.");
                  return;
                }
              }

              emptyCycleCountRef.current++;
              const backoffDelay = emptyCycleCountRef.current <= 1 ? 800 : 1200;
              addDebugLog('STT:EmptyCycle', `[Session #${currentSession}] Empty session (code: ${errorCode}, cycle #${emptyCycleCountRef.current}, elapsed: ${elapsedFromStart}ms). Restarting in ${backoffDelay}ms...`);
              console.log(`[Native STT:Session#${currentSession}] Empty session (code: ${errorCode}), restart in ${backoffDelay}ms`);
              scheduleListeningRestart(backoffDelay);
              return;
            }

            if (isClientError && !currentTranscriptRef.current.trim()) {
              await handleClientErrorRecovery(currentSession);
              return;
            }

            handleSilenceOrEmpty(currentSession);
          }
        }),
        2000,
        null,
        'CapSpeechRecognition.addListener("listeningState")'
      );

      nativeListenersAttachedRef.current = true;
      addDebugLog('STT:Listeners', 'Native listeners active and ready');
      console.log("[Native STT:Listeners] Native listeners active and ready");
    } catch (err: any) {
      nativeListenersAttachedRef.current = false;
      addDebugLog('STT:Listeners:Error', `Listener registration error: ${err?.message || String(err)}`);
      console.error("[Native STT:Listeners:Error] Registration error:", err);
    } finally {
      isSettingUpListenersRef.current = false;
    }
  };

  const startSpeechToText = async () => {
    // Native recognizer engine only
    if (voiceInputEngineRef.current !== 'native_recognizer') {
      return;
    }
    // Audio playback check: Do not start while audio is playing or queued
    if (isSpeakingRef.current || activeSourcesRef.current.length > 0) {
      addDebugLog('STT:WaitingForAudio', 'Start deferred: audio playback is active or queued');
      console.log("[Native STT] startSpeechToText deferred because audio is playing or queued");
      return;
    }

    // In-flight guard: prevent concurrent start invocations
    if (
      isStartInFlightRef.current ||
      !isActiveRef.current ||
      isPausedRef.current ||
      isStartingRef.current ||
      isStoppingRef.current ||
      isNativeListeningRef.current ||
      isSpeakingRef.current ||
      isRespondingRef.current
    ) {
      console.log("[Native STT] startSpeechToText ignored: inFlight=", isStartInFlightRef.current, "active=", isActiveRef.current, "paused=", isPausedRef.current, "starting=", isStartingRef.current, "stopping=", isStoppingRef.current, "listening=", isNativeListeningRef.current, "speaking=", isSpeakingRef.current, "responding=", isRespondingRef.current);
      return;
    }

    isStartInFlightRef.current = true;

    try {
      // Wait at least 800 ms after any stop or teardown before calling start()
      const elapsedSinceStop = Date.now() - lastStopTimeRef.current;
      if (elapsedSinceStop < 800) {
        const waitTime = 800 - elapsedSinceStop;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        if (!isActiveRef.current || isPausedRef.current || isStoppingRef.current || isSpeakingRef.current || activeSourcesRef.current.length > 0) {
          if (isSpeakingRef.current || activeSourcesRef.current.length > 0) {
            addDebugLog('STT:WaitingForAudio', 'Start aborted during gap wait: audio started playing');
          }
          return;
        }
      }

      // 1. Native Capacitor Speech Recognition on Android / iOS
      if (Capacitor.isNativePlatform()) {
        isStartingRef.current = true;

        // Monotonically increasing session ID stored in a ref
        const sessionId = ++sessionIdRef.current;
        sessionRealStartTimeRef.current = Date.now();
        currentCycleIdRef.current = sessionId;
        currentTranscriptRef.current = '';
        hasReachedStartedRef.current = false;
        sessionReadyTimeRef.current = 0;
        sessionStartedTimeRef.current = 0;

        // Cancellation check helper: abort if paused, stopped, or superseded
        const isStartCancelled = () => {
          return !isActiveRef.current || isPausedRef.current || isStoppingRef.current || sessionIdRef.current !== sessionId;
      };

      try {
        addDebugLog('STT:Start', `[Session #${sessionId}] Checking availability and permissions...`);
        console.log(`[Native STT:Start:Session#${sessionId}] Checking speech recognition availability...`);

        const available = await withNativeTimeout(
          CapSpeechRecognition.available(),
          2000,
          { available: false },
          'CapSpeechRecognition.available()'
        );

        // Checkpoint 1: after availability check
        if (isStartCancelled()) {
          addDebugLog('STT:Start:Aborted', `[Session #${sessionId}] Aborted after availability check (paused/stopped/superseded)`);
          isStartingRef.current = false;
          return;
        }

        addDebugLog('STT:Start', `available: ${available?.available}`);
        if (!available?.available) {
          addDebugLog('STT:Start', `[Session #${sessionId}] Native speech recognition unavailable`);
          console.warn(`[Native STT:Start:Session#${sessionId}] Native speech recognition unavailable on device`);
          toast.error("Device speech recognition engine not available");
          isStartingRef.current = false;
          pauseListening("Speech recognition engine not available on device");
          return;
        }

        // Check and request RECORD_AUDIO permission before starting
        const permStatus = await withNativeTimeout(
          CapSpeechRecognition.checkPermissions(),
          2000,
          { speechRecognition: 'prompt' as const },
          'CapSpeechRecognition.checkPermissions()'
        );

        // Checkpoint 2: after checkPermissions
        if (isStartCancelled()) {
          addDebugLog('STT:Start:Aborted', `[Session #${sessionId}] Aborted after checkPermissions (paused/stopped/superseded)`);
          isStartingRef.current = false;
          return;
        }

        addDebugLog('STT:Start', `permStatus: ${JSON.stringify(permStatus)}`);
        if (permStatus?.speechRecognition !== 'granted') {
          addDebugLog('STT:Start', `[Session #${sessionId}] Requesting speech recognition permissions...`);
          console.log(`[Native STT:Start:Session#${sessionId}] Requesting speech recognition permissions...`);
          const reqStatus = await withNativeTimeout(
            CapSpeechRecognition.requestPermissions(),
            15000,
            { speechRecognition: 'denied' as const },
            'CapSpeechRecognition.requestPermissions()'
          );

          // Checkpoint 3: after requestPermissions
          if (isStartCancelled()) {
            addDebugLog('STT:Start:Aborted', `[Session #${sessionId}] Aborted after requestPermissions (paused/stopped/superseded)`);
            isStartingRef.current = false;
            return;
          }

          addDebugLog('STT:Start', `reqStatus: ${JSON.stringify(reqStatus)}`);
          if (reqStatus?.speechRecognition !== 'granted') {
            addDebugLog('STT:Start', `[Session #${sessionId}] Microphone permission denied by user`);
            console.warn(`[Native STT:Start:Session#${sessionId}] Microphone permission denied by user`);
            toast.error("Microphone permission required for speech recognition");
            isStartingRef.current = false;
            pauseListening("Microphone permission denied by user");
            return;
          }
        }

        // Checkpoint 4: before setupNativeListeners
        if (isStartCancelled()) {
          addDebugLog('STT:Start:Aborted', `[Session #${sessionId}] Aborted before setupNativeListeners (paused/stopped/superseded)`);
          isStartingRef.current = false;
          return;
        }

        // Setup persistent listeners (registered once)
        await setupNativeListeners();

        // Checkpoint 5: immediately before calling CapSpeechRecognition.start
        if (isStartCancelled()) {
          addDebugLog('STT:Start:Aborted', `[Session #${sessionId}] Aborted immediately before CapSpeechRecognition.start (paused/stopped/superseded)`);
          isStartingRef.current = false;
          return;
        }

        // Recognition cycle timeout (12 seconds)
        if (recognitionTimeoutRef.current) {
          clearTimeout(recognitionTimeoutRef.current);
        }
        recognitionTimeoutRef.current = setTimeout(async () => {
          recognitionTimeoutRef.current = null;
          if (sessionIdRef.current !== sessionId) return;
          addDebugLog('STT:Timeout', `[Session #${sessionId}] 12s cycle timeout reached (buffer: "${currentTranscriptRef.current}")`);
          console.warn(`[Native STT:Timeout:Session#${sessionId}] 12s recognition cycle timeout reached`);
          if (currentTranscriptRef.current.trim()) {
            commitCurrentUtterance(sessionId);
          } else {
            if (isNativeListeningRef.current) {
              try {
                await withNativeTimeout(
                  CapSpeechRecognition.stop(),
                  1500,
                  undefined,
                  'CapSpeechRecognition.stop()'
                );
              } catch (_) {}
            }
            handleSilenceOrEmpty(sessionId);
          }
        }, RECOGNITION_TIMEOUT_MS);

        const startTime = Date.now();
        addDebugLog('STT:Start', `[Session #${sessionId}] Invoking CapSpeechRecognition.start({ sessionId: ${sessionId} })...`);
        console.log(`[Native STT:Start:Session#${sessionId}] Invoking start...`);

        let result: any = null;
        try {
          result = await CapSpeechRecognition.start({
            language: 'en-US',
            maxResults: 5,
            prompt: '',
            popup: false,
            partialResults: true,
            sessionId: sessionId,
          } as any);
          const elapsed = Date.now() - startTime;
          addDebugLog('STT:Start', `[Session #${sessionId}] CapSpeechRecognition.start resolved in ${elapsed}ms with: ${JSON.stringify(result)}`);
          console.log(`[Native STT:Start:Session#${sessionId}] Resolved in ${elapsed}ms:`, result);
        } catch (startErr: any) {
          const elapsed = Date.now() - startTime;
          addDebugLog('STT:Start', `[Session #${sessionId}] CapSpeechRecognition.start rejected in ${elapsed}ms: ${startErr?.message || JSON.stringify(startErr)}`);
          console.error(`[Native STT:Start:Session#${sessionId}] Rejected in ${elapsed}ms:`, startErr);
          throw startErr;
        }

        isNativeListeningRef.current = true;
        isStartingRef.current = false;

        // If the platform returns matches directly in the start resolution
        if (result?.matches && Array.isArray(result.matches) && result.matches.length > 0 && result.matches[0].trim()) {
          addDebugLog('STT:Start', `[Session #${sessionId}] Direct matches returned on resolve: "${result.matches[0]}"`);
          console.log(`[Native STT:Start:Session#${sessionId}] Direct matches:`, result.matches[0]);
          currentTranscriptRef.current = result.matches[0].trim();
          consecutiveFailuresRef.current = 0;
          clientErrorRecoveryCountRef.current = 0;
          emptyCycleCountRef.current = 0;
          startupFailuresRef.current = 0;
        }

        return;
      } catch (nativeErr: any) {
        isStartingRef.current = false;
        if (startedConfirmationTimerRef.current) {
          clearTimeout(startedConfirmationTimerRef.current);
          startedConfirmationTimerRef.current = null;
        }
        if (recognitionTimeoutRef.current) {
          clearTimeout(recognitionTimeoutRef.current);
          recognitionTimeoutRef.current = null;
        }
        isNativeListeningRef.current = false;
        setUserSpeechDetected(false);
        addDebugLog('STT:Error', `Exception: ${nativeErr?.message || JSON.stringify(nativeErr)}`);
        console.error("[Native STT:Error] CapSpeechRecognition.start caught exception:", nativeErr);

        if (currentTranscriptRef.current.trim()) {
          console.log("[Native STT:Error] Rescuing buffered transcript after error:", currentTranscriptRef.current);
          commitCurrentUtterance(sessionId);
          return;
        }

        const errMsg = String(nativeErr?.message || '');
        const isClientErr = errMsg.includes('5') || errMsg.toLowerCase().includes('client');

        const now = Date.now();
        const isRecentCommit = (now - lastCommitTimeRef.current) < 3500;
        const isRecentEndOfSpeech = (now - lastEndOfSpeechTimeRef.current) < 3500;
        const isRecentStop = (now - lastStopTimeRef.current) < 3500;
        const isSpeakingOrResponding = isSpeakingRef.current || isRespondingRef.current || activeSourcesRef.current.length > 0;
        const isBenignClientErr = isClientErr && (isRecentCommit || isRecentEndOfSpeech || isRecentStop || isSpeakingOrResponding);

        if (isBenignClientErr) {
          addDebugLog('STT:IgnoreClientError', `Ignored benign client error on start following recent commit/stop/playback`);
          return;
        }

        if (isClientErr) {
          await handleClientErrorRecovery(sessionId);
          return;
        }

        if (isActiveRef.current && !isPausedRef.current && !isSpeakingRef.current && !isRespondingRef.current && mode === 'continuous' && activeSourcesRef.current.length === 0) {
          consecutiveFailuresRef.current++;
          console.log(`[Native STT:Error] Retry counter: ${consecutiveFailuresRef.current}/${MAX_RECOGNITION_RETRIES}`);
          if (consecutiveFailuresRef.current >= MAX_RECOGNITION_RETRIES) {
            console.warn("[Native STT:Error] Continuous recognition halted: max error retries reached.");
            pauseListening(`Continuous listening paused after ${MAX_RECOGNITION_RETRIES} empty cycles. Tap mic to resume.`);
            toast.error("Speech recognition paused due to repeated device errors.");
            return;
          }
          const backoff = getBackoffDelay(consecutiveFailuresRef.current);
          scheduleListeningRestart(backoff);
        }
        return;
      }
    }

    // 2. Web browser fallback for development environment
    console.log("[Web STT:Start] Initializing browser SpeechRecognition fallback");
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[Web STT:Start] Speech recognition is not supported in this environment");
      return;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort();
      } catch (_) {}
      speechRecognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        if (isSpeakingRef.current || isRespondingRef.current || activeSourcesRef.current.length > 0) return;

        let interimText = '';
        let finalPhrase = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalPhrase += text;
          } else {
            interimText += text;
          }
        }

        if (interimText.trim()) {
          setUserSpeechDetected(true);
        }

        if (finalPhrase.trim()) {
          const userText = finalPhrase.trim();
          addDebugLog('WebSTT:Result', `Captured final phrase: "${userText}"`);
          console.log("[Web STT:Result] Captured final phrase:", userText);
          setUserSpeechDetected(false);
          consecutiveFailuresRef.current = 0;
          emptyCycleCountRef.current = 0;
          console.log("[Web STT:Handoff] Passing to handleUserUtterance:", userText);
          handleUserUtterance(userText);
        }
      };

      recognition.onerror = (event: any) => {
        addDebugLog('WebSTT:Error', `error: ${event.error}`);
        if (event.error === 'no-speech' || event.error === 'audio-capture') {
          return;
        }
        console.warn("[Web STT:Error] Browser speech recognition error:", event.error);
      };

      recognition.onend = () => {
        console.log("[Web STT:End] Browser speech recognition ended");
        if (isActiveRef.current && !isSpeakingRef.current && !isRespondingRef.current && mode === 'continuous' && activeSourcesRef.current.length === 0) {
          scheduleListeningRestart(400);
        }
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
    } catch (e) {
      console.warn("[Web STT:Error] Web Speech recognition STT init error:", e);
    }
  } finally {
    isStartInFlightRef.current = false;
  }
};

  const teardownNativeListeners = async () => {
    isStoppingRef.current = true;
    if (nativeListenerRef.current) {
      try {
        await withNativeTimeout(nativeListenerRef.current.remove(), 1000, undefined, 'nativeListener.remove()');
      } catch (_) {}
      nativeListenerRef.current = null;
    }
    if (nativeStateListenerRef.current) {
      try {
        await withNativeTimeout(nativeStateListenerRef.current.remove(), 1000, undefined, 'nativeStateListener.remove()');
      } catch (_) {}
      nativeStateListenerRef.current = null;
    }
    nativeListenersAttachedRef.current = false;
    isNativeListeningRef.current = false;
    isStoppingRef.current = false;
    lastStopTimeRef.current = Date.now();
  };

  const stopSpeechToText = async () => {
    lastStopTimeRef.current = Date.now();
    console.log("[Native STT:Stop] stopSpeechToText called");
    if (pendingCommitTimerRef.current) {
      clearTimeout(pendingCommitTimerRef.current);
      pendingCommitTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (recognitionTimeoutRef.current) {
      clearTimeout(recognitionTimeoutRef.current);
      recognitionTimeoutRef.current = null;
    }

    if (voiceInputEngineRef.current !== 'native_recognizer') {
      return;
    }

    if (Capacitor.isNativePlatform()) {
      isStoppingRef.current = true;
      isNativeListeningRef.current = false;
      isStartingRef.current = false;
      setUserSpeechDetected(false);
      try {
        await withNativeTimeout(CapSpeechRecognition.stop(), 1500, undefined, 'CapSpeechRecognition.stop()');
      } catch (_) {}
      isStoppingRef.current = false;
      lastStopTimeRef.current = Date.now();
      console.log("[Native STT:Stop] Native recognizer stopped");
      return;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort();
      } catch (e) {
        // ignore
      }
      speechRecognitionRef.current = null;
    }
  };

  const computeRms = (pcm16: Int16Array): number => {
    let sum = 0;
    for (let i = 0; i < pcm16.length; i++) {
      const val = pcm16[i] / 32768.0;
      sum += val * val;
    }
    return Math.sqrt(sum / pcm16.length);
  };

  const sendRawAudioChunk = (pcmBuffer: ArrayBuffer) => {
    if (mode === 'push' && !isPushing) {
      chunksDroppedCountRef.current++;
      return;
    }
    const ws = liveWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !liveWsReadyRef.current) {
      chunksDroppedCountRef.current++;
      return;
    }

    let binary = '';
    const bytes = new Uint8Array(pcmBuffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Data = btoa(binary);

    try {
      // Send audio only as realtimeInput.audio (do NOT use deprecated mediaChunks)
      ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: base64Data
          }
        }
      }));

      chunksSentCountRef.current++;
      audioSendCountRef.current++;
      const sendCount = chunksSentCountRef.current;
      if (sendCount === 1) {
        addDebugLog('Diag', `[Diag] ws.send 1st audio chunk: shape=realtimeInput.audio, readyState=${ws.readyState}, base64Len=${base64Data.length}`);
      } else if (sendCount % 20 === 0) {
        addDebugLog('Diag', `[Diag] ws.send audio chunk #${sendCount}: shape=realtimeInput.audio, readyState=${ws.readyState}, base64Len=${base64Data.length}`);
      }
    } catch (sendErr: any) {
      chunksDroppedCountRef.current++;
      console.warn("[LiveWS:MicStream] Failed sending audio chunk:", sendErr);
      addDebugLog('Diag', `[Diag] ws.send error: ${sendErr?.message || String(sendErr)}`);
    }
  };

  const getPlaybackRms = (): number => {
    const analyser = playbackAnalyserRef.current;
    if (!analyser) return 0;
    try {
      const timeData = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        sumSq += timeData[i] * timeData[i];
      }
      return Math.sqrt(sumSq / timeData.length);
    } catch {
      return 0;
    }
  };

  const handleIncomingPcmChunk = (pcmBuffer: ArrayBuffer) => {
    chunksReceivedCountRef.current++;
    workletChunkCountRef.current++;
    const chunkIdx = chunksReceivedCountRef.current;
    const pcm16 = new Int16Array(pcmBuffer);
    const rms = computeRms(pcm16);

    // Track peak RMS over each 20-chunk window
    if (rms > peakRms20Ref.current) {
      peakRms20Ref.current = rms;
    }

    // [Diag] First worklet chunk, then every 20th with PEAK RMS over the 20-chunk window + stats
    if (chunkIdx === 1) {
      addDebugLog('Diag', `[Diag] Worklet 1st chunk received: ${pcmBuffer.byteLength} bytes, RMS=${rms.toFixed(4)}`);
    } else if (chunkIdx % 20 === 0) {
      addDebugLog(
        'Diag',
        `[Diag] Audio stats (chunk #${chunkIdx}): peakRMS_last20=${peakRms20Ref.current.toFixed(4)}, received=${chunkIdx}, sent=${chunksSentCountRef.current}, dropped=${chunksDroppedCountRef.current}`
      );
      peakRms20Ref.current = 0;
    }

    // Bind live chunk RMS to state for mic pulse animation
    setMicRms(rms);

    const now = Date.now();
    const isPlaying = isSpeakingRef.current || activeSourcesRef.current.length > 0;
    const playbackRms = isPlaying ? getPlaybackRms() : 0;
    const timeSinceTurnStartMs = isPlaying && modelTurnAudioStartTimeRef.current > 0
      ? (now - modelTurnAudioStartTimeRef.current)
      : -1;

    // Track sustained speech while model is speaking
    if (isPlaying) {
      if (speechStartWhileSpeakingTimeRef.current === 0) {
        speechStartWhileSpeakingTimeRef.current = now;
      }
    } else {
      speechStartWhileSpeakingTimeRef.current = 0;
    }
    const sustainedMs = speechStartWhileSpeakingTimeRef.current > 0
      ? (now - speechStartWhileSpeakingTimeRef.current)
      : 0;

    // ACOUSTIC ECHO CANCELLATION (AEC) & BARGE-IN REJECTION:
    // When playing over phone speaker without headphones, the microphone picks up Tyler/Sierra's own voice
    // (observed echo peaks of 0.157 - 0.180 RMS). Two separate AudioContexts (capture at 16kHz, playback at 24kHz)
    // frequently bypass hardware AEC in mobile WebViews. To prevent false interruptions while streaming
    // audio continuously, evaluateBargeInDecision applies an adaptive floor (0.20 RMS in speaker mode, 2.5x
    // measured playback RMS, 600ms sustained window, and 400ms turn grace period). The mic is NOT muted.
    const bargeInResult = evaluateBargeInDecision({
      micRms: rms,
      playbackRms,
      isPlaying,
      sustainedMs,
      timeSinceTurnStartMs,
      mode: audioOutputModeRef.current,
      bargeInMode: settings.live.local.bargeInMode || 'headphones_only',
      hasHeadset: hasHeadsetRef.current,
      timeSincePlaybackEndMs: lastPlaybackEndedAtRef.current > 0 ? now - lastPlaybackEndedAtRef.current : -1,
    });

    // Requirement: [Diag] BargeIn lines MUST be logged on every evaluation during model playback
    if (isPlaying) {
      addDebugLog(
        'Diag',
        `[Diag] BargeIn: micRMS=${rms.toFixed(4)}, playbackRMS=${playbackRms.toFixed(4)}, sustainedMs=${sustainedMs}ms, decision=${bargeInResult.decision} (${bargeInResult.reason}), reqRMS=${bargeInResult.requiredRms.toFixed(4)}, mode=${audioOutputModeRef.current}, bargeInMode=${settings.live.local.bargeInMode || 'headphones_only'}`
      );
    }

    if (bargeInResult.shouldTrigger) {
      addDebugLog(
        'BargeIn:Accepted',
        `reason=${bargeInResult.reason} vad=n/a(webAudio) micRms=${rms.toFixed(4)} playbackRms=${playbackRms.toFixed(4)} sustainedMs=${sustainedMs} reqRms=${bargeInResult.requiredRms.toFixed(4)} mode=${settings.live.local.bargeInMode || 'headphones_only'} headset=${hasHeadsetRef.current}`
      );
      addDebugLog(
        'Diag',
        `[Diag] Sustained user speech detected during playback (${sustainedMs}ms). Triggering barge-in flush via evaluateBargeInDecision.`
      );
      clientTriggeredBargeInRef.current = true;
      stopPlayback();
      speechStartWhileSpeakingTimeRef.current = 0;
    } else {
      if (
        isPlaying &&
        (rms >= 0.04 || bargeInResult.reason === 'accumulating') &&
        now - lastBargeInIgnoredLogTimeRef.current >= 500
      ) {
        lastBargeInIgnoredLogTimeRef.current = now;
        addDebugLog(
          'BargeIn:Ignored',
          `reason=${bargeInResult.reason} vad=n/a(webAudio) micRms=${rms.toFixed(4)} playbackRms=${playbackRms.toFixed(4)} sustainedMs=${sustainedMs} reqRms=${bargeInResult.requiredRms.toFixed(4)} mode=${settings.live.local.bargeInMode || 'headphones_only'} headset=${hasHeadsetRef.current}`
        );
      }
      if (bargeInResult.reason === 'below_threshold') {
        speechStartWhileSpeakingTimeRef.current = 0;
      }
    }

    // Fallback UI hearing state based on client RMS if server voiceActivity is not yet emitted
    const isUserSpeechForUi = !isPlaying ? (rms >= 0.015) : (rms >= bargeInResult.requiredRms);
    if (isUserSpeechForUi) {
      belowThresholdSinceRef.current = 0;
      if (!isVoiceActiveRef.current) {
        isVoiceActiveRef.current = true;
        setUserSpeechDetected(true);
      }
      lastLocalVoiceChunkTimeRef.current = now;
      userSpeechEndTimeRef.current = now;
    } else {
      if (belowThresholdSinceRef.current === 0) {
        belowThresholdSinceRef.current = now;
      }
      if (isVoiceActiveRef.current && (now - belowThresholdSinceRef.current >= 700)) {
        isVoiceActiveRef.current = false;
        setUserSpeechDetected(false);
      }
    }

    // Drop mic chunks during playback only if MUTE_MIC_DURING_PLAYBACK is true (default false)
    if (MUTE_MIC_DURING_PLAYBACK && (isSpeakingRef.current || activeSourcesRef.current.length > 0)) {
      chunksDroppedCountRef.current++;
      return;
    }

    // STREAM CONTINUOUSLY: send EVERY worklet chunk to Gemini Live after setupComplete, silence included
    sendRawAudioChunk(pcmBuffer);
  };

  const startAudioCapture = async () => {
    try {
      addDebugLog('MicStream:Init', 'Starting 16kHz PCM audio capture pipeline...');
      void prepareNativeAudioRoute('communication', 'live_capture_start');
      const stream = mediaStreamRef.current || await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      mediaStreamRef.current = stream;

      // [Diag] Log getUserMedia track getSettings(), muted, enabled, and readyState on session start
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings ? JSON.stringify(audioTrack.getSettings()) : '{}';
        addDebugLog('Diag', `[Diag] getUserMedia track: getSettings()=${settings}, muted=${audioTrack.muted}, enabled=${audioTrack.enabled}, readyState=${audioTrack.readyState}`);
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!micAudioContextRef.current || micAudioContextRef.current.state === 'closed') {
        micAudioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
        addDebugLog('Diag', `[Diag] AudioContext created (capture): state=${micAudioContextRef.current.state}, sampleRate=${micAudioContextRef.current.sampleRate}`);
      }
      const audioCtx = micAudioContextRef.current;
      audioContextRef.current = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
        addDebugLog('Diag', `[Diag] AudioContext resumed (capture): state=${audioCtx.state}`);
      }

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // AudioWorklet for ~100ms chunks (1600 samples at 16000Hz mono PCM16) with hardware sample-rate downsampling
      const workletCode = `
        class PCM16StreamingProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.buffer = new Float32Array(4800);
            this.bufferCount = 0;
            this.targetChunkSize = 1600; // ~100ms at 16000 Hz
            this.phase = 0;
          }
          process(inputs) {
            const input = inputs[0];
            if (!input || !input[0]) return true;
            const channel = input[0];
            const inLen = channel.length;
            const ratio = sampleRate / 16000;

            let inIdx = this.phase;
            while (inIdx < inLen) {
              const idx = Math.floor(inIdx);
              const frac = inIdx - idx;
              const nextIdx = idx + 1 < inLen ? idx + 1 : idx;
              const sample = channel[idx] + frac * (channel[nextIdx] - channel[idx]);

              this.buffer[this.bufferCount++] = sample;
              if (this.bufferCount >= this.targetChunkSize) {
                this.flush();
              }
              inIdx += ratio;
            }
            this.phase = inIdx - inLen;
            return true;
          }
          flush() {
            const pcm16 = new Int16Array(this.targetChunkSize);
            for (let j = 0; j < this.targetChunkSize; j++) {
              const s = Math.max(-1, Math.min(1, this.buffer[j]));
              pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
            const leftover = this.bufferCount - this.targetChunkSize;
            if (leftover > 0) {
              this.buffer.copyWithin(0, this.targetChunkSize, this.bufferCount);
            }
            this.bufferCount = leftover;
          }
        }
        registerProcessor('pcm16-live-processor', PCM16StreamingProcessor);
      `;

      let workletActive = false;
      try {
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        await audioCtx.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        const workletNode = new AudioWorkletNode(audioCtx, 'pcm16-live-processor');
        micWorkletNodeRef.current = workletNode;

        workletNode.port.onmessage = (e: MessageEvent) => {
          handleIncomingPcmChunk(e.data);
        };

        source.connect(workletNode);
        const muteNode = audioCtx.createGain();
        muteNode.gain.setValueAtTime(0, audioCtx.currentTime);
        workletNode.connect(muteNode);
        muteNode.connect(audioCtx.destination);
        workletActive = true;
        addDebugLog('MicStream:WorkletActive', 'AudioWorklet active emitting ~100ms 16kHz PCM chunks');
      } catch (workletErr) {
        console.warn("[MicStream] AudioWorklet init failed, falling back to ScriptProcessor:", workletErr);
        addDebugLog('MicStream:WorkletFallback', 'Falling back to ScriptProcessorNode');
      }

      if (!workletActive) {
        // Fallback ScriptProcessorNode
        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;
        const accumulator: number[] = [];
        const targetChunk = 1600;
        let scriptPhase = 0;

        processor.onaudioprocess = (e) => {
          if (mode === 'push' && !isPushing) {
            setUserSpeechDetected(false);
            return;
          }
          const inputData = e.inputBuffer.getChannelData(0);
          const ratio = audioCtx.sampleRate / 16000;
          let inIdx = scriptPhase;
          while (inIdx < inputData.length) {
            const idx = Math.floor(inIdx);
            const frac = inIdx - idx;
            const nextIdx = idx + 1 < inputData.length ? idx + 1 : idx;
            const sample = inputData[idx] + frac * (inputData[nextIdx] - inputData[idx]);
            accumulator.push(sample);
            if (accumulator.length >= targetChunk) {
              flushScript();
            }
            inIdx += ratio;
          }
          scriptPhase = inIdx - inputData.length;
        };

        const flushScript = () => {
          const pcm16 = new Int16Array(targetChunk);
          for (let j = 0; j < targetChunk; j++) {
            const s = Math.max(-1, Math.min(1, accumulator[j]));
            pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          accumulator.splice(0, targetChunk);
          handleIncomingPcmChunk(pcm16.buffer);
        };

        const muteNode = audioCtx.createGain();
        muteNode.gain.setValueAtTime(0, audioCtx.currentTime);
        source.connect(processor);
        processor.connect(muteNode);
        muteNode.connect(audioCtx.destination);
        addDebugLog('MicStream:ScriptNodeActive', 'ScriptProcessor active emitting ~100ms 16kHz PCM chunks');
      }

      isMicStreamingRef.current = true;
      // Start session in "listening", never "hearing"
      setUserSpeechDetected(false);
      setIsThinking(false);
      isThinkingRef.current = false;
      addDebugLog('Diag', '[Diag] Audio capture active. UI state initialized to listening.');
    } catch (error: any) {
      console.error("Audio capture initialization error:", error);
      addDebugLog('MicStream:Error', error.message || String(error));
      setConnectionError("Microphone hardware error: " + (error.message || "Failed to initialize audio."));
      void prepareNativeAudioRoute('media', 'live_capture_error');
    }
  };

  const stopAudioCapture = () => {
    isMicStreamingRef.current = false;
    void prepareNativeAudioRoute('media', 'live_capture_stop');
    if (micWorkletNodeRef.current) {
      try {
        micWorkletNodeRef.current.disconnect();
      } catch (_) {}
      micWorkletNodeRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {
        // ignore
      }
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setUserSpeechDetected(false);
  };

  // 24kHz PCM Audio Playback through ordered non-overlapping queue
  const playAudio = async (base64Data: string) => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }

    // Ensure no Native TTS or Web SpeechSynthesis is playing concurrently with 24kHz WebAudio
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }

    setIsSpeaking(true);
    isSpeakingRef.current = true;

    // When app is backgrounded on Android and Background Live mode is active, play 24kHz PCM via native AudioTrack
    // so playback continues without WebView AudioContext suspension
    if (
      Capacitor.isNativePlatform() &&
      isBackgroundLiveEnabled() &&
      typeof document !== 'undefined' &&
      document.hidden
    ) {
      try {
        await SierraBackgroundVoice.playNativePcm24k({ data: base64Data });
        return;
      } catch {}
    }

    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 0x7FFF;
      }

      // Re-use single persistent playback AudioContext
      if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
        playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        playbackAnalyserRef.current = null;
        playbackResumePromiseRef.current = null;
        addDebugLog('Diag', `[Diag] AudioContext created (playback): state=${playbackContextRef.current.state}, sampleRate=${playbackContextRef.current.sampleRate}`);
      }

      const audioCtx = playbackContextRef.current;
      if (audioCtx.state === 'suspended') {
        if (!playbackResumePromiseRef.current) {
          playbackResumePromiseRef.current = audioCtx.resume().then(() => {
            addDebugLog('Diag', `[Diag] AudioContext resumed (playback): state=${audioCtx.state}`);
          }).finally(() => {
            playbackResumePromiseRef.current = null;
          });
        }
        await playbackResumePromiseRef.current;
      }

      if (!playbackAnalyserRef.current) {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.connect(audioCtx.destination);
        playbackAnalyserRef.current = analyser;
      }

      if (modelTurnAudioStartTimeRef.current === 0) {
        modelTurnAudioStartTimeRef.current = Date.now();
      }

      const buffer = audioCtx.createBuffer(1, floatData.length, 24000);
      buffer.getChannelData(0).set(floatData);

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(playbackAnalyserRef.current);

      activeSourcesRef.current.push(source);

      // Schedule continuously on timeline for gap-free playback
      const startTime = Math.max(audioCtx.currentTime, nextPlayTimeRef.current);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + buffer.duration;

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        if (activeSourcesRef.current.length === 0) {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          modelTurnAudioStartTimeRef.current = 0;
          if (voiceInputEngineRef.current === 'native_recognizer') {
            checkAndRestartListeningAfterTurn();
          }
        }
      };
    } catch (playbackErr) {
      console.error("Audio playback error:", playbackErr);
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      modelTurnAudioStartTimeRef.current = 0;
      if (voiceInputEngineRef.current === 'native_recognizer') {
        checkAndRestartListeningAfterTurn();
      }
    }
  };

  const stopPlayback = () => {
    lastPlaybackEndedAtRef.current = Date.now();
    modelTurnAudioStartTimeRef.current = 0;
    if (Capacitor.isNativePlatform()) {
      TextToSpeech.stop().catch(() => {});
      if (isBackgroundLiveEnabled()) {
        SierraBackgroundVoice.flushNativePlayback().catch(() => {});
      }
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // ignore
      }
    });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
    setIsSpeaking(false);
    isSpeakingRef.current = false;
  };

  const currentPersonaObj = UNIFIED_PERSONAS[selectedPersona as PersonaId] || UNIFIED_PERSONAS.classy;
  const currentIdentityObj = IDENTITIES[companionIdentity] || IDENTITIES.sierra;
  const currentLangObj = SUPPORTED_LIVE_LANGUAGES.find(l => l.code === selectedLanguage) || SUPPORTED_LIVE_LANGUAGES[0];
  const showActiveTranscript =
    isActive &&
    (isSpeaking ||
      userSpeechDetected ||
      isThinking ||
      isPushing ||
      localVoiceStatus === 'listening' ||
      localVoiceStatus === 'thinking' ||
      localVoiceStatus === 'speaking' ||
      transcripts.length > 0);

  return (
    <div
      className="flex-1 flex flex-col h-full max-h-full w-full bg-[#0A0E14] text-slate-100 relative overflow-hidden font-sans select-none"
      style={{
        paddingTop: 'max(16px, env(safe-area-inset-top))',
        paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
      }}
    >
      {/* Dynamic Assistant Accent Ambient Glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className={cn(
            'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full blur-[140px] transition-all duration-1000',
            isActive ? (isSpeaking ? 'scale-110 opacity-35' : 'scale-100 opacity-25') : 'scale-90 opacity-15'
          )}
          style={{
            background: `radial-gradient(circle, rgba(${accentRgb}, 0.55) 0%, rgba(${accentRgb}, 0.08) 60%, transparent 100%)`,
          }}
        />
      </div>

      {/* Hidden Video Element for Frame Processing */}
      <video ref={videoElementRef} playsInline muted autoPlay className="hidden" />

      {/* Floating Picture-in-Picture Video Preview when Camera or Screen Share is Active */}
      {(isCameraActive || isScreenShareActive) && (
        <div
          className="absolute top-14 right-3 z-30 w-32 sm:w-40 sci-card rounded-xl overflow-hidden shadow-2xl backdrop-blur-md flex flex-col animate-in fade-in zoom-in-95"
          style={{ borderColor: `rgba(${accentRgb}, 0.45)` }}
        >
          <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
            <video
              ref={(el) => {
                if (el && videoStreamRef.current && el.srcObject !== videoStreamRef.current) {
                  el.srcObject = videoStreamRef.current;
                  el.play().catch(() => {});
                }
              }}
              playsInline
              muted
              autoPlay
              className={cn('w-full h-full object-cover', cameraFacingMode === 'user' && isCameraActive && 'scale-x-[-1]')}
            />
            <div
              className="absolute top-1 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/70 text-[9px] font-mono"
              style={{ color: accentHex }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: accentHex }} />
              {isCameraActive ? 'CAM' : 'SCREEN'}
            </div>
          </div>
          <div className="p-1.5 flex items-center justify-between gap-1 bg-[#0A0E14]/90">
            {isCameraActive && (
              <button
                type="button"
                onClick={flipCamera}
                className="min-h-[36px] px-2 rounded-md bg-white/5 text-[#C8CDD3] hover:text-white text-[10px] flex items-center gap-1"
                title="Flip Camera (Front/Rear)"
              >
                <SwitchCamera className="w-3.5 h-3.5" />
                <span className="text-[9px]">{cameraFacingMode === 'user' ? 'Rear' : 'Front'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={stopVideoStreaming}
              className="min-h-[36px] min-w-[36px] p-1 rounded-md bg-red-950/60 text-red-300 hover:text-red-200 text-[10px] ml-auto flex items-center justify-center"
              title="Stop Video Stream"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {videoFpsStats && (
            <div className="px-1.5 py-0.5 bg-black/90 text-[8px] font-mono text-[#C8CDD3]/70 truncate">
              {videoFpsStats}
            </div>
          )}
        </div>
      )}

      {/* Optional Transient Banners Only (Background Live active / Error Banner) */}
      {(isActive && isBackgroundLiveMode) || connectionError || openRouterModelError ? (
        <div className="w-full max-w-lg mx-auto relative z-20 shrink-0 px-3 pt-1 space-y-2">
          {isActive && isBackgroundLiveMode && (
            <div
              data-testid="background-mic-live-indicator"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-950/80 border border-emerald-500/45 text-emerald-200 text-xs shadow-md"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                <span className="font-semibold truncate">Background Mic Live • Active</span>
              </div>
              <button
                type="button"
                onClick={() => stopSession('user')}
                className="min-h-[36px] px-3 rounded-lg bg-red-600/80 hover:bg-red-500 text-white font-bold text-[10px] uppercase tracking-wider shrink-0"
              >
                Stop
              </button>
            </div>
          )}

          {(connectionError || openRouterModelError || liveAuth401Provider) && (
            <div className="p-3 bg-red-950/75 border border-red-500/45 rounded-2xl text-red-200 text-xs flex flex-wrap items-center gap-2 shadow-lg">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <p className="flex-1 text-xs leading-snug text-left">
                {liveAuth401Provider
                  ? `Invalid or unrecognized API key for ${
                      liveAuth401Provider === 'openrouter' ? 'OpenRouter' : 'Google Gemini'
                    }`
                  : openRouterModelError || connectionError}
              </p>
              {liveAuth401Provider && onOpenSettings && (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="live-auth-401-settings-btn"
                  onClick={() => onOpenSettings('providers', liveAuth401Provider)}
                  className="min-h-[40px] px-3 text-[11px] border-red-400/60 bg-red-500/20 text-red-100 hover:bg-red-500/35"
                >
                  Fix Key in Settings
                </Button>
              )}
              {liveProvider === 'openrouter' && !liveAuth401Provider && (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="openrouter-fallback-paid-default-btn"
                  onClick={() => {
                    fallbackToOpenRouterPaidDefault();
                    setOpenRouterModelError(null);
                    setConnectionError(null);
                    setLiveAuth401Provider(null);
                    toast.success(`Switched to paid default: ${OPENROUTER_DEFAULT_PAID_MODEL}`);
                  }}
                  className="min-h-[40px] px-3 text-[11px] border-amber-500/50 text-amber-200 hover:bg-amber-950/50"
                >
                  Use Paid Default (Dolphin 24B)
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={startSession}
                className="min-h-[40px] px-3 text-xs text-red-100 hover:bg-red-900/50"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {/* CENTRAL FLEX CONTAINER: Large Centered Mic Orb + Conditional Independent Scrollable Transcript */}
      <div className="flex-1 min-h-0 w-full max-w-lg mx-auto flex flex-col items-center justify-center px-4 py-2 gap-4 relative z-10 overflow-hidden">
        {/* Minimal Identity Subtitle + Read-Only Active Engine Chip */}
        <div className="shrink-0 text-center space-y-1.5 flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#101620]/80 border border-[#C8CDD3]/20 text-[11px] font-medium text-[#C8CDD3]">
            <span>{currentIdentityObj.avatar}</span>
            <span className="font-display font-semibold text-white">{currentIdentityObj.name}</span>
            <span className="text-[#C8CDD3]/50">•</span>
            <span style={{ color: accentHex }}>{currentPersonaObj.name}</span>
          </div>

          <button
            type="button"
            data-testid="live-active-model-chip"
            onClick={() => onOpenSettings?.('models')}
            title="Active Live Voice engine & model — Change in Settings"
            className="min-h-[34px] max-w-[320px] px-3 py-1 rounded-full bg-[#101620]/90 border border-[#C8CDD3]/20 hover:border-cyan-400/50 text-[11px] font-medium text-[#C8CDD3] hover:text-white inline-flex items-center gap-1.5 transition-colors"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: accentHex }}
            />
            <span className="truncate">
              {liveProvider === 'openrouter'
                ? `OpenRouter · ${formatShortModelDisplayName(
                    lastAnsweredLiveModel ||
                      resolveEffectiveOpenRouterModel(openRouterSettings, openRouterFreeModels, contentMode)
                  )}`
                : liveProvider === 'local'
                  ? `On-Phone Local · ${settings.live.local.llmPreset.toUpperCase()}`
                  : `Gemini Live · ${formatShortModelDisplayName(customVoiceModel.trim() || voiceModel)}`}
            </span>
            <span className="text-[10px] shrink-0 underline ml-0.5" style={{ color: accentHex }}>
              Change in Settings
            </span>
          </button>

          {(() => {
            const ttsProvider = getSelectedVoiceProvider();
            const liveVoiceCfg = getLiveVoiceConfig(selectedPersona as PersonaId, companionIdentity);
            const chatVoiceCfg = getChatVoiceConfig(selectedPersona as PersonaId, companionIdentity);
            const requestedVoiceForLabel =
              liveProvider !== 'gemini' && ttsProvider === 'openrouter'
                ? liveVoiceCfg.heygenVoiceId || chatVoiceCfg.heygenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE
                : selectedVoice;
            const voiceLabelInfo = getEffectiveLiveVoiceLabel({
              liveProvider,
              ttsProvider,
              requestedVoice: requestedVoiceForLabel,
              accent: liveAccent,
              tone: liveTone,
            });
            return (
              <div
                data-testid="live-effective-voice-label"
                className="text-[10.5px] text-[#C8CDD3]/75 font-mono max-w-[340px] truncate px-2"
                title={voiceLabelInfo.note || voiceLabelInfo.label}
              >
                Voice: {voiceLabelInfo.label}
                {voiceLabelInfo.note ? ` · ${voiceLabelInfo.note}` : ''}
              </div>
            );
          })()}
        </div>

        {/* Interactive Mic Orb — Always centered and never pushed off-screen */}
        <div className="relative flex flex-col items-center justify-center shrink-0 py-2">
          <AnimatePresence mode="wait">
            {isActive && (mode === 'continuous' || isPushing) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      scale: isSpeaking ? [1, 1.55, 1] : userSpeechDetected ? [1, 1.32, 1] : [1, 1.18, 1],
                      opacity: isSpeaking ? [0.45, 0, 0.45] : [0.25, 0, 0.25],
                    }}
                    transition={{
                      duration: isSpeaking ? 1.3 : 2.0,
                      repeat: Infinity,
                      delay: i * 0.35,
                    }}
                    className={cn(
                      'absolute rounded-full border',
                      showActiveTranscript ? 'w-28 h-28 sm:w-32 sm:h-32' : 'w-36 h-36 sm:w-44 sm:h-44'
                    )}
                    style={{
                      borderColor: `rgba(${accentRgb}, ${isSpeaking ? 0.65 : 0.4})`,
                      backgroundColor: isSpeaking ? `rgba(${accentRgb}, 0.06)` : 'transparent',
                    }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            data-testid="live-mic-orb-button"
            onMouseDown={() => mode === 'push' && setIsPushing(true)}
            onMouseUp={() => mode === 'push' && setIsPushing(false)}
            onMouseLeave={() => mode === 'push' && setIsPushing(false)}
            onTouchStart={() => mode === 'push' && setIsPushing(true)}
            onTouchEnd={() => mode === 'push' && setIsPushing(false)}
            onClick={handleMicTap}
            disabled={isConnecting}
            aria-label={isActive ? (isPaused ? 'Resume voice session' : 'End voice session') : 'Start voice session'}
            style={{
              borderColor: isActive
                ? isPaused || isThinking
                  ? '#F59E0B'
                  : accentHex
                : `rgba(${accentRgb}, 0.45)`,
              boxShadow:
                isActive && !isPaused
                  ? `0 0 ${Math.min(44, Math.max(22, Math.round(micRms * 160) + 20))}px rgba(${accentRgb}, ${isSpeaking ? 0.55 : 0.38})`
                  : `0 0 28px rgba(${accentRgb}, 0.2)`,
              transform:
                isActive && !isSpeaking && !isPaused && micRms > 0.01
                  ? `scale(${(1 + Math.min(0.16, micRms * 1.3)).toFixed(3)})`
                  : undefined,
            }}
            className={cn(
              'rounded-full flex flex-col items-center justify-center transition-all duration-300 relative z-20 border-2 bg-[#101620] focus:outline-none touch-manipulation min-h-[48px] min-w-[48px]',
              showActiveTranscript ? 'w-28 h-28 sm:w-32 sm:h-32' : 'w-36 h-36 sm:w-44 sm:h-44',
              !isActive && 'animate-sci-orb-idle hover:scale-[1.03]',
              isActive && !isSpeaking && !isPaused && !isThinking && 'animate-sci-mic-listen'
            )}
          >
            {isConnecting ? (
              <Loader2 className="w-10 h-10 animate-spin" style={{ color: accentHex }} />
            ) : isActive ? (
              isSpeaking ? (
                <div className="flex flex-col items-center gap-2" aria-label="Speaking waveform">
                  <div className="flex items-center justify-center gap-1 h-9">
                    {[0, 0.14, 0.28, 0.1, 0.22].map((delay, idx) => (
                      <span
                        key={idx}
                        className="w-1.5 h-8 rounded-full animate-sci-wave-bar"
                        style={{
                          backgroundColor: accentHex,
                          animationDelay: `${delay}s`,
                          boxShadow: `0 0 10px rgba(${accentRgb}, 0.7)`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accentHex }}>
                    Speaking
                  </span>
                </div>
              ) : isPaused ? (
                <>
                  <MicOff className="w-9 h-9 text-amber-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest mt-1.5 text-amber-300">
                    Paused
                  </span>
                </>
              ) : isThinking ? (
                <>
                  <Loader2 className="w-9 h-9 animate-spin text-amber-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest mt-1.5 text-amber-300">
                    Thinking
                  </span>
                </>
              ) : (
                <>
                  <Mic
                    className="w-10 h-10 transition-transform duration-150"
                    style={{ color: userSpeechDetected ? accentHex : '#F1F5F9' }}
                  />
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest mt-1.5"
                    style={{ color: userSpeechDetected ? accentHex : '#C8CDD3' }}
                  >
                    {userSpeechDetected ? 'Hearing You' : 'Listening'}
                  </span>
                </>
              )
            ) : (
              <>
                <Mic className="w-11 h-11 mb-1.5" style={{ color: accentHex }} />
                <span className="text-[11px] font-display font-bold uppercase tracking-widest text-white">
                  Tap to Start
                </span>
              </>
            )}
          </button>
        </div>

        {/* Continuous / Push-to-Talk Mode Switcher */}
        <div className="shrink-0 flex flex-col items-center gap-1.5">
          <div className="bg-[#101620] p-1 rounded-2xl border border-[#C8CDD3]/20 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMode('continuous')}
              className={cn(
                'min-h-[48px] px-4 rounded-xl font-bold uppercase tracking-wider transition-all text-[10px]',
                mode === 'continuous'
                  ? 'bg-white/10 text-white border border-white/15 shadow-inner'
                  : 'text-[#C8CDD3]/65 hover:text-white border border-transparent'
              )}
              style={mode === 'continuous' ? { borderColor: `rgba(${accentRgb}, 0.45)`, color: accentHex } : undefined}
            >
              Continuous
            </button>
            <button
              type="button"
              onClick={() => setMode('push')}
              className={cn(
                'min-h-[48px] px-4 rounded-xl font-bold uppercase tracking-wider transition-all text-[10px]',
                mode === 'push'
                  ? 'bg-white/10 text-white border border-white/15 shadow-inner'
                  : 'text-[#C8CDD3]/65 hover:text-white border border-transparent'
              )}
              style={mode === 'push' ? { borderColor: `rgba(${accentRgb}, 0.45)`, color: accentHex } : undefined}
            >
              Push-to-Talk
            </button>
          </div>
          <p className="text-[11px] text-[#C8CDD3]/70 text-center">
            {mode === 'push'
              ? isPushing
                ? 'Listening while held...'
                : 'Hold mic orb to speak'
              : isActive
                ? isSpeaking
                  ? `${currentIdentityObj.name} speaking...`
                  : userSpeechDetected
                    ? 'Hearing you...'
                    : 'Listening continuously'
                : 'Swipe up below for models, voice & debug logs'}
          </p>
        </div>

        {/* Active-Only Independent Scrollable Transcript Box (never pushes mic orb off-screen) */}
        {showActiveTranscript && (
          <div
            data-testid="live-active-transcript-panel"
            className="flex-1 min-h-0 max-h-[34dvh] w-full sci-card rounded-2xl shadow-xl flex flex-col overflow-hidden relative"
          >
            <div className="flex items-center justify-between text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-widest px-3.5 py-2 border-b border-[#C8CDD3]/15 shrink-0">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" style={{ color: accentHex }} />
                <span>Live Transcript</span>
              </div>
              <span className="flex items-center gap-1.5 text-emerald-400 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                Active
              </span>
            </div>

            <div
              ref={scrollContainerRef}
              onScroll={handleTranscriptScroll}
              className="flex-1 min-h-0 overflow-y-auto space-y-2.5 p-3 pr-2 overscroll-contain"
              style={{
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
              }}
            >
              {transcripts.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center p-3">
                  <p className="text-xs text-[#C8CDD3]/65">
                    Listening... spoken phrases will stream here.
                  </p>
                </div>
              ) : (
                transcripts.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      'flex flex-col max-w-[85%] transition-all',
                      t.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
                    )}
                  >
                    <div className="flex items-center gap-1.5 px-1 mb-0.5 text-[9px] font-bold uppercase tracking-wider text-[#C8CDD3]/70">
                      <span>{t.sender === 'user' ? 'You' : `${currentIdentityObj.avatar} ${currentIdentityObj.name}`}</span>
                      {t.sender !== 'user' && t.model && (
                        <span
                          data-testid="live-bubble-answered-model"
                          className="text-[8.5px] font-mono normal-case font-normal px-1.5 py-0.5 rounded bg-[#0A0E14]/90 border border-[#C8CDD3]/20 text-[#C8CDD3]/80"
                        >
                          {t.model.split('/').pop()}
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        'p-3 rounded-2xl text-xs leading-relaxed shadow-sm border',
                        t.sender === 'user'
                          ? 'text-slate-100 rounded-tr-sm'
                          : 'bg-[#0A0E14]/85 text-slate-100 border-[#C8CDD3]/20 rounded-tl-sm'
                      )}
                      style={
                        t.sender === 'user'
                          ? {
                              backgroundColor: `rgba(${accentRgb}, 0.14)`,
                              borderColor: `rgba(${accentRgb}, 0.4)`,
                            }
                          : undefined
                      }
                    >
                      <p className="whitespace-pre-wrap">{t.text}</p>
                      {t.sender === 'user' && (
                        <p
                          data-testid="live-bubble-heard"
                          className="mt-1 text-[10px] font-mono text-[#C8CDD3]/70 break-words"
                        >
                          Heard: {t.rawTranscript || t.text}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>

            {showJumpToBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom(true)}
                className="min-h-[40px] absolute bottom-2.5 right-2.5 z-30 px-3 py-1.5 rounded-full text-[#0A0E14] text-[11px] font-bold shadow-lg flex items-center gap-1 transition-all active:scale-95"
                style={{ backgroundColor: accentHex }}
              >
                <ArrowDown className="w-3.5 h-3.5" />
                <span>Latest</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* SLIDE-UP DRAWER HANDLE BAR (Always reachable via tap or swipe-up) */}
      <div
        data-testid="live-drawer-handle"
        onClick={() => setIsLiveDrawerOpen(true)}
        onTouchStart={(e) => {
          drawerTouchStartYRef.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(e) => {
          const startY = drawerTouchStartYRef.current;
          const endY = e.changedTouches[0]?.clientY ?? null;
          drawerTouchStartYRef.current = null;
          if (startY !== null && endY !== null && startY - endY > 24) {
            setIsLiveDrawerOpen(true);
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsLiveDrawerOpen(true);
          }
        }}
        aria-label="Open Live controls, model picker, and debug log drawer"
        className="w-full max-w-lg mx-auto shrink-0 min-h-[48px] px-4 py-2 border-t border-[#C8CDD3]/20 bg-[#101620]/95 backdrop-blur-md flex items-center justify-between gap-2 cursor-pointer touch-manipulation rounded-t-2xl"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronUp className="w-4 h-4 shrink-0" style={{ color: accentHex }} />
          <span className="text-xs font-display font-semibold text-white truncate">
            Controls, Model &amp; Logs
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {debugLogs.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/35 text-[10px] font-mono text-amber-300">
              {debugLogs.length} logs
            </span>
          )}
          <span className="text-[10px] font-mono text-[#C8CDD3]/70 uppercase">
            {liveProvider}
          </span>
        </div>
      </div>

      {/* SLIDE-UP BOTTOM DRAWER: Debug Log, Model Picker, Persona/Voice Switcher, Media & Settings */}
      <AnimatePresence>
        {isLiveDrawerOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Live Voice Controls Drawer"
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 backdrop-blur-sm"
          >
            <div className="absolute inset-0" onClick={() => setIsLiveDrawerOpen(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="relative z-10 w-full max-w-lg max-h-[82dvh] bg-[#0A0E14] border-t border-x border-[#C8CDD3]/25 rounded-t-3xl flex flex-col overflow-hidden shadow-2xl"
              style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
            >
              {/* Drawer Drag Handle & Header */}
              <div
                onTouchStart={(e) => {
                  drawerTouchStartYRef.current = e.touches[0]?.clientY ?? null;
                }}
                onTouchEnd={(e) => {
                  const startY = drawerTouchStartYRef.current;
                  const endY = e.changedTouches[0]?.clientY ?? null;
                  drawerTouchStartYRef.current = null;
                  if (startY !== null && endY !== null && endY - startY > 36) {
                    setIsLiveDrawerOpen(false);
                  }
                }}
                className="px-4 pt-3 pb-3 border-b border-[#C8CDD3]/15 flex items-center justify-between shrink-0"
              >
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4" style={{ color: accentHex }} />
                  <h3 className="text-sm font-display font-bold text-white">
                    Live Controls, Models &amp; Debug
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsLiveDrawerOpen(false)}
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl text-[#C8CDD3] hover:text-white hover:bg-white/5"
                  aria-label="Close Live drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Scrollable Body */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {/* Quick Actions Row: Debug Log, Persona, Voice, Language, Audio Mode, Cam, Screen */}
                <div
                  data-testid="live-top-controls-row"
                  className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                >
                  <button
                    type="button"
                    data-testid="live-control-debuglog"
                    onClick={() => {
                      setIsLiveDrawerOpen(false);
                      setIsDebugLogOpen(true);
                    }}
                    className="min-h-[48px] px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/35 text-xs font-semibold text-amber-300 flex items-center justify-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span>Debug Log ({debugLogs.length})</span>
                  </button>

                  <button
                    type="button"
                    data-testid="live-control-persona"
                    onClick={() => setIsPersonaModalOpen(true)}
                    className="min-h-[48px] px-3 py-2 rounded-xl sci-card-interactive text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                  >
                    <span>{currentIdentityObj.avatar}</span>
                    <span className="truncate">
                      {currentIdentityObj.name} ({currentPersonaObj.name})
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="live-control-voice"
                    onClick={() => setIsVoiceModalOpen(true)}
                    className="min-h-[48px] px-3 py-2 rounded-xl sci-card-interactive text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                  >
                    <Volume2 className="w-4 h-4 shrink-0" style={{ color: accentHex }} />
                    <span className="truncate">
                      {liveProvider !== 'gemini' && getSelectedVoiceProvider() === 'openrouter'
                        ? getLiveVoiceConfig(selectedPersona as PersonaId, companionIdentity).heygenVoiceId ||
                          getChatVoiceConfig(selectedPersona as PersonaId, companionIdentity).heygenVoiceId ||
                          OPENROUTER_TTS_DEFAULT_VOICE
                        : selectedVoice}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="live-control-language"
                    onClick={() => setIsLanguageModalOpen(true)}
                    className="min-h-[48px] px-3 py-2 rounded-xl sci-card-interactive text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                  >
                    <span>{currentLangObj.flag}</span>
                    <span className="font-mono">{currentLangObj.code}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="live-control-audiomode"
                    onClick={() =>
                      handleToggleAudioOutputMode(audioOutputMode === 'headphones' ? 'speaker' : 'headphones')
                    }
                    className={cn(
                      'min-h-[48px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all',
                      audioOutputMode === 'headphones'
                        ? 'bg-emerald-600/20 border-emerald-500/45 text-emerald-300'
                        : 'bg-[#101620] border-[#C8CDD3]/20 text-[#C8CDD3]'
                    )}
                  >
                    {audioOutputMode === 'headphones' ? (
                      <Headphones className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                    <span className="capitalize">{audioOutputMode}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="live-control-camera"
                    onClick={toggleCamera}
                    className={cn(
                      'min-h-[48px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all',
                      isCameraActive
                        ? 'bg-white/15 text-white animate-pulse'
                        : 'bg-[#101620] border-[#C8CDD3]/20 text-[#C8CDD3]'
                    )}
                    style={isCameraActive ? { borderColor: accentHex, color: accentHex } : undefined}
                  >
                    {isCameraActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                    <span>Camera</span>
                  </button>

                  <button
                    type="button"
                    data-testid="live-control-screenshare"
                    onClick={toggleScreenShare}
                    className={cn(
                      'min-h-[48px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all',
                      isScreenShareActive
                        ? 'bg-white/15 text-white animate-pulse'
                        : 'bg-[#101620] border-[#C8CDD3]/20 text-[#C8CDD3]'
                    )}
                    style={isScreenShareActive ? { borderColor: accentHex, color: accentHex } : undefined}
                  >
                    {isScreenShareActive ? <Monitor className="w-4 h-4" /> : <MonitorOff className="w-4 h-4" />}
                    <span>Screen Share</span>
                  </button>
                </div>

                {/* Model & Engine Card */}
                <div className="sci-card rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-wider text-white">
                      <Sparkles className="w-3.5 h-3.5" style={{ color: accentHex }} />
                      <span>Voice Model &amp; Engine</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(liveProvider === 'local' || liveProvider === 'openrouter') && (
                        <span
                          data-testid="local-voice-status-badge"
                          className={cn(
                            'text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border',
                            localVoiceStatus === 'error'
                              ? 'bg-red-500/20 border-red-500/40 text-red-300'
                              : localVoiceStatus === 'interrupted'
                                ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                                : localVoiceStatus === 'speaking'
                                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                                  : localVoiceStatus === 'thinking' ||
                                      localVoiceStatus === 'loading_model' ||
                                      localVoiceStatus === 'downloading'
                                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          )}
                        >
                          {localVoiceStatus === 'downloading'
                            ? 'Downloading'
                            : localVoiceStatus === 'loading_model'
                              ? 'Loading model'
                              : localVoiceStatus === 'listening'
                                ? 'Listening'
                                : localVoiceStatus === 'thinking'
                                  ? 'Thinking...'
                                  : localVoiceStatus === 'speaking'
                                    ? 'Speaking'
                                    : localVoiceStatus === 'interrupted'
                                      ? 'Interrupted'
                                      : localVoiceStatus === 'error'
                                        ? 'Error'
                                        : liveProvider === 'openrouter'
                                          ? 'OpenRouter Ready'
                                          : 'Offline Ready'}
                        </span>
                      )}
                      <span
                        className={cn(
                          'text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border',
                          contentMode === 'mature'
                            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        )}
                      >
                        {contentMode === 'mature' ? '18+ Mature' : 'SFW'}
                      </span>
                    </div>
                  </div>

                  {/* Read-Only Active Live Engine Summary (Editable only in Settings) */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsLiveDrawerOpen(false);
                      onOpenSettings?.('models');
                    }}
                    className="w-full min-h-[48px] px-3 py-2 rounded-xl bg-[#0A0E14] border border-[#C8CDD3]/20 hover:border-cyan-400/40 text-left flex items-center justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#C8CDD3]/65">
                        Active Live Engine
                      </div>
                      <div className="text-xs font-semibold text-white truncate">
                        {liveProvider === 'openrouter'
                          ? 'OpenRouter Live'
                          : liveProvider === 'local'
                            ? 'On-Phone Local Voice'
                            : 'Gemini Live'}{' '}
                        ·{' '}
                        <span className="font-mono" style={{ color: accentHex }}>
                          {liveProvider === 'openrouter'
                            ? formatShortModelDisplayName(
                                resolveEffectiveOpenRouterModel(openRouterSettings, openRouterFreeModels, contentMode)
                              )
                            : liveProvider === 'local'
                              ? `Local (${settings.live.local.llmPreset.toUpperCase()})`
                              : formatShortModelDisplayName(customVoiceModel.trim() || voiceModel)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold shrink-0 underline" style={{ color: accentHex }}>
                      Change in Settings
                    </span>
                  </button>

                  {lastAnsweredLiveModel && (
                    <div
                      data-testid="live-answered-model-label"
                      className="text-[10px] font-mono px-2.5 py-1 rounded-lg bg-[#0A0E14] border border-[#C8CDD3]/20 text-[#C8CDD3]"
                    >
                      Answered by: <span style={{ color: accentHex }}>{lastAnsweredLiveModel}</span>
                    </div>
                  )}

                  {liveProvider === 'local' && (
                    <Button
                      variant="outline"
                      data-testid="open-local-models-modal-btn"
                      onClick={() => setShowLocalDownloadModal(true)}
                      className="w-full min-h-[48px] border-[#C8CDD3]/25 text-white hover:bg-white/5 text-xs rounded-xl"
                    >
                      Manage Local Models &amp; Offline Settings
                    </Button>
                  )}

                  {liveProvider === 'openrouter' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-testid="openrouter-manage-stt-btn"
                        onClick={() => setShowLocalDownloadModal(true)}
                        className="min-h-[44px] text-xs underline"
                        style={{ color: accentHex }}
                      >
                        Whisper STT Models
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] font-semibold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                      Barge-In Sensitivity (Mic RMS Gate)
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['low', 'medium', 'high'] as const).map((sens) => (
                        <button
                          key={sens}
                          type="button"
                          onClick={() => {
                            updateSettings((draft) => {
                              draft.live.bargeInSensitivity = sens;
                              return draft;
                            });
                          }}
                          className={cn(
                            'min-h-[48px] rounded-xl text-[11px] font-semibold uppercase tracking-wider border transition-all',
                            bargeInSensitivity === sens
                              ? 'bg-white/10 text-white'
                              : 'bg-[#0A0E14] border-[#C8CDD3]/20 text-[#C8CDD3]/75 hover:text-white'
                          )}
                          style={bargeInSensitivity === sens ? { borderColor: accentHex, color: accentHex } : undefined}
                        >
                          {sens === 'low' ? 'Low (0.025)' : sens === 'medium' ? 'Med (0.015)' : 'High (0.008)'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {onOpenSettings && (
                  <button
                    type="button"
                    data-testid="live-open-full-settings"
                    onClick={() => {
                      setIsLiveDrawerOpen(false);
                      onOpenSettings('models');
                    }}
                    className="w-full min-h-[48px] rounded-xl border border-[#C8CDD3]/20 bg-[#101620] hover:bg-white/5 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                    style={{ color: accentHex }}
                  >
                    <Settings className="w-4 h-4" />
                    <span>Open full settings</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PERSONA MODAL (Identity, Persona, Content Mode, Custom Directives) */}
      <PersonaVoiceModal
        isOpen={isPersonaModalOpen}
        onClose={() => setIsPersonaModalOpen(false)}
        mode="persona"
        onChanged={(newId, newPId) => {
          setCompanionIdentity(newId);
          setSelectedPersona(newPId);
          notifyIdentityChanged(newId);
          const updatedLiveCfg = getLiveVoiceConfig(newPId, newId);
          setSelectedVoice(updatedLiveCfg.voiceId);
          setLiveAccent(updatedLiveCfg.accent);
          setLiveTone(updatedLiveCfg.tone);
          const nextLocale = deriveLanguageCodeFromAccent(updatedLiveCfg.accent, selectedLanguage);
          setSelectedLanguage(nextLocale);
          toast.success(`Switched to ${IDENTITIES[newId].name} (${UNIFIED_PERSONAS[newPId]?.name})`);
          restartLiveSessionIfActive();
        }}
      />

      {/* LIVE VOICE MODAL (Independent Live Voice, Accent, Tone) */}
      <PersonaVoiceModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        mode="live-voice"
        onChanged={(newId, newPId, newVId) => {
          notifyIdentityChanged(newId);
          const updatedLiveCfg = getLiveVoiceConfig(newPId, newId);
          if (SUPPORTED_LIVE_VOICES.includes(newVId as LiveVoiceName)) {
            setSelectedVoice(newVId as LiveVoiceName);
          } else {
            setSelectedVoice(updatedLiveCfg.voiceId);
          }
          setLiveAccent(updatedLiveCfg.accent);
          setLiveTone(updatedLiveCfg.tone);
          const nextLocale = deriveLanguageCodeFromAccent(updatedLiveCfg.accent, selectedLanguage);
          setSelectedLanguage(nextLocale);
          if (isActiveRef.current) {
            toast.info(
              `Restarting Live session with ${updatedLiveCfg.voiceId} (${updatedLiveCfg.accent || 'Default accent'} • ${nextLocale} • ${updatedLiveCfg.tone || 'Natural tone'})`
            );
          } else {
            toast.success(
              `Live voice updated: ${updatedLiveCfg.voiceId} (${updatedLiveCfg.accent || 'Default accent'} • ${nextLocale} • ${updatedLiveCfg.tone || 'Natural tone'}) — applies when session starts`
            );
          }
          restartLiveSessionIfActive();
        }}
      />

      {/* LANGUAGE SELECTOR MODAL */}
      {isLanguageModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3"
        >
          <div className="bg-[#0A0E14] border border-[#C8CDD3]/25 rounded-2xl w-full max-w-sm max-h-[85vh] flex flex-col p-4 shadow-2xl space-y-3 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-[#C8CDD3]/15">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" style={{ color: accentHex }} />
                <h3 className="text-sm font-display font-bold text-white">Spoken Language Lock</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLanguageModalOpen(false)}
                className="min-h-[48px] min-w-[48px] flex items-center justify-center text-[#C8CDD3] hover:text-white rounded-xl"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-[#C8CDD3]/75">
              Select the language {currentIdentityObj.name} must strictly adhere to. Automatic language switching is disabled to prevent drift.
            </p>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {SUPPORTED_LIVE_LANGUAGES.map((lang) => {
                const isSelected = selectedLanguage.toLowerCase() === lang.code.toLowerCase();
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => handleSelectLanguage(lang.code)}
                    className={cn(
                      'w-full min-h-[48px] p-3 rounded-xl border text-left transition-all flex items-center justify-between text-xs',
                      isSelected
                        ? 'bg-white/10 text-white'
                        : 'bg-[#101620] border-[#C8CDD3]/15 text-[#C8CDD3] hover:border-[#C8CDD3]/35'
                    )}
                    style={isSelected ? { borderColor: accentHex } : undefined}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">{lang.flag}</span>
                      <div>
                        <div className="font-semibold text-white">{lang.name}</div>
                        <div className="text-[10px] text-[#C8CDD3]/65">{lang.nativeName}</div>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-[#C8CDD3]/75">{lang.code}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* On-Demand Diagnostic Pipeline Debug Log Modal / Bottom Sheet */}
      {isDebugLogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
        >
          <div className="absolute inset-0" onClick={() => setIsDebugLogOpen(false)} />

          <div className="relative z-10 bg-[#0A0E14] border border-amber-500/40 rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-4 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-6 sm:zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-[#C8CDD3]/15">
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-xs font-display font-bold uppercase tracking-wider">Pipeline Stage Debug Output</span>
                <span className="text-[#C8CDD3]/65 font-mono text-[10px]">({debugLogs.length} events)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFallbackLogText(formatDebugLogs(debugLogs));
                    setIsFallbackModalOpen(true);
                  }}
                  disabled={debugLogs.length === 0}
                  className="min-h-[40px] px-2 text-[11px] text-[#C8CDD3] hover:text-white underline font-sans flex items-center gap-1 disabled:opacity-30 disabled:no-underline"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>View Text</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={debugLogs.length === 0}
                  className="min-h-[40px] px-2 text-[11px] text-[#C8CDD3] hover:text-red-300 underline font-sans disabled:opacity-30 disabled:no-underline"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setIsDebugLogOpen(false)}
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center text-[#C8CDD3] hover:text-white rounded-xl active:bg-white/10"
                  aria-label="Close debug logs"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="font-mono text-[10.5px] leading-relaxed flex-1 min-h-[160px] max-h-64 sm:max-h-80 overflow-y-auto space-y-1 pr-1 bg-black/60 p-2.5 rounded-xl border border-[#C8CDD3]/15">
              {debugLogs.length === 0 ? (
                <p className="text-[#C8CDD3]/60 italic py-4 text-center font-sans text-xs">
                  No pipeline events logged yet. Tap the orb to trigger speech recognition.
                </p>
              ) : (
                debugLogs.map((log) => (
                  <div key={log.id} className="border-b border-white/5 pb-0.5">
                    <span className="text-[#C8CDD3]/55">[{log.time}]</span>{' '}
                    <span
                      className={cn(
                        'font-bold',
                        log.stage.includes('Error') || log.stage.includes('Catch')
                          ? 'text-red-400'
                          : log.stage.includes('partialResults')
                            ? 'text-cyan-300'
                            : log.stage.includes('listeningState')
                              ? 'text-yellow-300'
                              : log.stage.includes('commit')
                                ? 'text-emerald-400'
                                : log.stage.includes('streamChat')
                                  ? 'text-cyan-200'
                                  : 'text-amber-300'
                      )}
                    >
                      [{log.stage}]
                    </span>{' '}
                    <span className="text-slate-200 break-all">{log.detail}</span>
                  </div>
                ))
              )}
              <div ref={debugScrollRef} />
            </div>

            {/* Saved STT Utterance Clips (last 10) */}
            <div className="rounded-xl bg-[#0F1520]/80 border border-[#C8CDD3]/15 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-200">
                  Saved STT Clips ({debugUtterances.length}/10)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="live-load-debug-utterances-btn"
                    onClick={async () => {
                      const res = await getSierraLocalVoicePlugin().listDebugUtterances?.();
                      if (res?.ok && Array.isArray(res.utterances)) {
                        setDebugUtterances(res.utterances);
                      }
                    }}
                    className="px-2 py-1 rounded bg-[#101620] border border-[#C8CDD3]/20 text-[10px] text-[#C8CDD3] hover:text-white"
                  >
                    Load Clips
                  </button>
                  {debugUtterances.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        await getSierraLocalVoicePlugin().clearDebugUtterances?.();
                        setDebugUtterances([]);
                      }}
                      className="px-2 py-1 rounded bg-[#101620] border border-red-500/30 text-[10px] text-red-300"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              {debugUtterances.length > 0 && (
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {debugUtterances.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-2 text-[10px] bg-black/40 p-1.5 rounded border border-white/10">
                      <div className="min-w-0 flex-1 truncate text-slate-200">
                        &ldquo;{u.transcript || u.rawTranscript || '(empty)'}&rdquo;{' '}
                        <span className="text-[#C8CDD3]/55 font-mono">
                          (rms={Number(u.rms || 0).toFixed(3)}, {u.durationMs}ms{u.droppedReason ? `, ${u.droppedReason}` : ''})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (debugUtteranceAudioRef.current) {
                            debugUtteranceAudioRef.current.pause();
                            debugUtteranceAudioRef.current = null;
                          }
                          if (playingUtteranceId === u.id) {
                            setPlayingUtteranceId(null);
                            return;
                          }
                          const res = await getSierraLocalVoicePlugin().getDebugUtteranceAudio?.({ id: u.id });
                          if (!res?.ok || !res.wavBase64) return;
                          const audio = new Audio(`data:audio/wav;base64,${res.wavBase64}`);
                          debugUtteranceAudioRef.current = audio;
                          setPlayingUtteranceId(u.id);
                          audio.onended = () => setPlayingUtteranceId(null);
                          await audio.play().catch(() => setPlayingUtteranceId(null));
                        }}
                        className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 shrink-0 flex items-center gap-1"
                      >
                        <Play className="w-2.5 h-2.5" />
                        {playingUtteranceId === u.id ? 'Stop' : 'Play'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showClearConfirm && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-red-950/70 border border-red-500/50 rounded-xl text-xs">
                <div className="flex items-center gap-1.5 text-red-200 font-medium">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>Clear all {debugLogs.length} events?</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClearConfirm}
                    className="min-h-[48px] px-3.5 py-1.5 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white rounded-lg font-semibold text-xs flex items-center justify-center transition-all active:scale-95 shadow-sm"
                  >
                    Yes, Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(false)}
                    className="min-h-[48px] px-3.5 py-1.5 bg-[#101620] hover:bg-white/10 text-[#C8CDD3] rounded-lg text-xs flex items-center justify-center transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={() => copyDebugLogs()}
                disabled={debugLogs.length === 0}
                className={cn(
                  'min-h-[48px] px-3 py-2 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm',
                  debugLogs.length === 0
                    ? 'bg-[#101620]/50 border border-[#C8CDD3]/10 text-[#C8CDD3]/40 cursor-not-allowed'
                    : 'bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300'
                )}
              >
                {isCopied ? (
                  <>
                    <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span className="text-emerald-300">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>Copy All</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => copyDebugLogs(20)}
                disabled={debugLogs.length === 0}
                className={cn(
                  'min-h-[48px] px-3 py-2 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all active:scale-95',
                  debugLogs.length === 0
                    ? 'bg-[#101620]/50 border border-[#C8CDD3]/10 text-[#C8CDD3]/40 cursor-not-allowed'
                    : 'bg-[#101620] hover:bg-white/10 border border-[#C8CDD3]/20 text-slate-200'
                )}
              >
                <FileText className="w-4 h-4 shrink-0 text-[#C8CDD3]" />
                <span>Copy Last 20</span>
              </button>

              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                disabled={debugLogs.length === 0}
                className={cn(
                  'min-h-[48px] px-3 py-2 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all active:scale-95',
                  debugLogs.length === 0
                    ? 'bg-[#101620]/50 border border-[#C8CDD3]/10 text-[#C8CDD3]/40 cursor-not-allowed'
                    : 'bg-[#101620] hover:bg-red-950/40 border border-[#C8CDD3]/20 hover:border-red-500/40 text-[#C8CDD3] hover:text-red-300'
                )}
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Clear Log</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selectable-Text Fallback Modal Dialog */}
      {isFallbackModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
        >
          <div className="bg-[#0A0E14] border border-[#C8CDD3]/25 rounded-2xl w-full max-w-lg p-4 shadow-2xl flex flex-col max-h-[85vh] space-y-3 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-[#C8CDD3]/15">
              <div>
                <h3 className="text-sm font-display font-semibold text-slate-100 flex items-center gap-2">
                  <Copy className="w-4 h-4 text-amber-400" />
                  Diagnostic Debug Log
                </h3>
                <p className="text-[11px] text-[#C8CDD3]/70">Select all and copy:</p>
              </div>
              <button
                type="button"
                onClick={() => setIsFallbackModalOpen(false)}
                className="min-h-[48px] min-w-[48px] p-2 flex items-center justify-center text-[#C8CDD3] hover:text-white rounded-lg active:bg-white/10"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              ref={fallbackTextareaRef}
              readOnly
              value={fallbackLogText}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="flex-1 w-full min-h-[220px] font-mono text-[11px] leading-relaxed bg-black/90 text-slate-200 p-3 rounded-xl border border-[#C8CDD3]/20 focus:outline-none select-all resize-none"
            />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (fallbackTextareaRef.current) {
                    fallbackTextareaRef.current.focus();
                    fallbackTextareaRef.current.select();
                    try {
                      document.execCommand('copy');
                      toast.success('Debug log copied.');
                    } catch (_) {
                      toast.info("Text selected! Use your device's copy option.");
                    }
                  }
                }}
                className="min-h-[48px] px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs rounded-xl flex items-center gap-2 active:scale-95 transition-all shadow-sm"
              >
                <Copy className="w-4 h-4" />
                Select &amp; Copy All
              </button>
              <button
                type="button"
                onClick={() => setIsFallbackModalOpen(false)}
                className="min-h-[48px] px-4 py-2 bg-[#101620] hover:bg-white/10 text-slate-200 text-xs font-medium rounded-xl active:scale-95 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* First-Use Local (on-phone) Model Download & Configuration Modal */}
      {showLocalDownloadModal && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="local-voice-download-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 overflow-y-auto"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <LocalVoiceSettingsCard
              isModal
              onCloseModal={() => setShowLocalDownloadModal(false)}
              onAllRequiredReady={() => {
                setShowLocalDownloadModal(false);
                setLocalVoiceStatus('idle');
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
