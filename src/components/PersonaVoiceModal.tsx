import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Check, Volume2, Sparkles, Filter, AlertCircle, Loader2, ShieldCheck, Flame, RotateCcw } from 'lucide-react';
import {
  CompanionIdentity,
  IDENTITIES,
  PersonaId,
  UNIFIED_PERSONAS,
  VoiceOption,
  GEMINI_LIVE_VOICES,
  HEYGEN_OPENROUTER_VOICES,
  isHeyGenVoiceId,
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
  resetTtsSlidersToDefault,
  SierraVoiceProvider,
  getSelectedVoiceProvider,
  setSelectedVoiceProvider,
  setChatSpeechEnabled,
  setTtsPitch,
  setTtsRate,
  OPENROUTER_TTS_MODEL,
  OPENROUTER_TTS_DEFAULT_VOICE,
  ContentMode,
  CONTENT_MODES,
  deriveLanguageCodeFromAccent,
} from '../lib/persona';
import {
  useSettings,
  getCustomDirectives,
  setCustomDirectives as persistCustomDirectives,
} from '../lib/settingsStore';
import { useContentMode } from '../lib/contentModeStore';
import { addDebugLog } from '../lib/debugLogStore';
import {
  fetchAvailableDeviceVoices,
  probeVoice,
  testVoicePlayback,
  stopSpeaking,
} from '../lib/ttsService';
import { triggerHaptic } from '../lib/haptics';
import { notifyIdentityChanged } from '../lib/themeStore';

export type ModalSurfaceMode = 'persona' | 'live-voice' | 'chat-voice';

export interface PersonaVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: ModalSurfaceMode;
  onChanged?: (identity: CompanionIdentity, personaId: PersonaId, voiceId: string) => void;
  onLiveVoiceConfigChanged?: (config: { voiceId: LiveVoiceName; accent: string; tone: string }) => void;
  onChatVoiceConfigChanged?: (config: {
    provider: SierraVoiceProvider;
    voiceId: string;
    speed: number;
    pitch: number;
    accent: string;
    tone: string;
    enabled: boolean;
  }) => void;
}

export const PersonaModal: React.FC<Omit<PersonaVoiceModalProps, 'mode'>> = (props) => (
  <PersonaVoiceModal {...props} mode="persona" />
);

export const VoiceModal: React.FC<
  Omit<PersonaVoiceModalProps, 'mode'> & { surface: 'live' | 'chat' }
> = ({ surface, ...props }) => (
  <PersonaVoiceModal {...props} mode={surface === 'live' ? 'live-voice' : 'chat-voice'} />
);

export const PersonaVoiceModal: React.FC<PersonaVoiceModalProps> = ({
  isOpen,
  onClose,
  mode = 'persona',
  onChanged,
  onLiveVoiceConfigChanged,
  onChatVoiceConfigChanged,
}) => {
  const appSettings = useSettings();
  const [selectedIdentity, setSelectedIdentity] = useState<CompanionIdentity>(getActiveIdentity());
  const [selectedPersonaId, setSelectedPersonaId] = useState<PersonaId>(getActivePersonaId());
  const [contentMode, setContentMode] = useContentMode();
  const [customDirectives, setCustomDirectives] = useState<string>(() => getCustomDirectives());

  // Independent Live Voice State
  const initialLiveCfg = getLiveVoiceConfig(selectedPersonaId, selectedIdentity);
  const [liveVoiceId, setLiveVoiceId] = useState<LiveVoiceName>(initialLiveCfg.voiceId);
  const [liveHeyGenVoiceId, setLiveHeyGenVoiceId] = useState<string>(
    initialLiveCfg.heygenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE
  );
  const [liveAccent, setLiveAccent] = useState<string>(initialLiveCfg.accent || 'Default');
  const [liveTone, setLiveTone] = useState<string>(initialLiveCfg.tone || 'Default');

  // Independent Chat Voice State
  const initialChatCfg = getChatVoiceConfig(selectedPersonaId, selectedIdentity);
  const [chatProvider, setChatProvider] = useState<SierraVoiceProvider>(initialChatCfg.provider);
  const [chatVoiceId, setChatVoiceId] = useState<string>(initialChatCfg.voiceId);
  const [chatSpeed, setChatSpeed] = useState<number>(initialChatCfg.speed);
  const [chatPitch, setChatPitch] = useState<number>(initialChatCfg.pitch);
  const [chatAccent, setChatAccent] = useState<string>(initialChatCfg.accent || 'Default');
  const [chatTone, setChatTone] = useState<string>(initialChatCfg.tone || 'Default');
  const [chatSpeechEnabledState, setChatSpeechEnabledState] = useState<boolean>(initialChatCfg.enabled);

  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>(GEMINI_LIVE_VOICES);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [probingVoiceId, setProbingVoiceId] = useState<string | null>(null);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  // Gender filter for voice list
  const [genderFilter, setGenderFilter] = useState<'all' | 'female' | 'male'>('all');

  // Refresh state from storage whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    const id = getActiveIdentity();
    const pId = getActivePersonaId();
    setSelectedIdentity(id);
    setSelectedPersonaId(pId);
    setCustomDirectives(getCustomDirectives());

    const lCfg = getLiveVoiceConfig(pId, id);
    setLiveVoiceId(lCfg.voiceId);
    setLiveHeyGenVoiceId(lCfg.heygenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE);
    setLiveAccent(lCfg.accent || 'Default');
    setLiveTone(lCfg.tone || 'Default');

    const cCfg = getChatVoiceConfig(pId, id);
    setChatProvider(cCfg.provider);
    setChatVoiceId(cCfg.voiceId);
    setChatSpeed(cCfg.speed);
    setChatPitch(cCfg.pitch);
    setChatAccent(cCfg.accent || 'Default');
    setChatTone(cCfg.tone || 'Default');
    setChatSpeechEnabledState(cCfg.enabled);
    setVoiceNotice(null);

    if (mode === 'chat-voice') {
      let mounted = true;
      setIsLoadingVoices(true);
      fetchAvailableDeviceVoices()
        .then((voices) => {
          if (!mounted) return;
          setAvailableVoices(voices);
          setIsLoadingVoices(false);
        })
        .catch(() => {
          if (!mounted) return;
          setIsLoadingVoices(false);
        });
      return () => {
        mounted = false;
        stopSpeaking();
      };
    } else if (mode === 'live-voice') {
      setAvailableVoices(GEMINI_LIVE_VOICES);
    }

    return () => {
      stopSpeaking();
    };
  }, [isOpen, mode]);

  const handleIdentityChange = (newIdentity: CompanionIdentity) => {
    const prevIdentity = selectedIdentity;
    setSelectedIdentity(newIdentity);
    setActiveIdentity(newIdentity);
    if (prevIdentity !== newIdentity) {
      triggerHaptic('switch');
    }
    notifyIdentityChanged(newIdentity);

    const lCfg = getLiveVoiceConfig(selectedPersonaId, newIdentity);
    setLiveVoiceId(lCfg.voiceId);
    setLiveHeyGenVoiceId(lCfg.heygenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE);
    setLiveAccent(lCfg.accent || 'Default');
    setLiveTone(lCfg.tone || 'Default');

    const cCfg = getChatVoiceConfig(selectedPersonaId, newIdentity);
    setChatProvider(cCfg.provider);
    setChatVoiceId(cCfg.voiceId);
    setChatSpeed(cCfg.speed);
    setChatPitch(cCfg.pitch);
    setChatAccent(cCfg.accent || 'Default');
    setChatTone(cCfg.tone || 'Default');
    setChatSpeechEnabledState(cCfg.enabled);

    setVoiceNotice(null);
    const activeVoice = mode === 'chat-voice' ? cCfg.voiceId : lCfg.voiceId;
    const selectedGender = IDENTITIES[newIdentity]?.gender || (newIdentity === 'tyler' ? 'male' : 'female');
    const resolvedMeta = GEMINI_LIVE_VOICES.find((v) => v.id === activeVoice);
    addDebugLog(
      'Selector:Tap',
      `[Selector:Tap] Identity tapped -> ${newIdentity} (selectedGender=${selectedGender}, resolvedVoice=${activeVoice}, voiceGender=${resolvedMeta?.gender || 'unknown'})`
    );
    onChanged?.(newIdentity, selectedPersonaId, activeVoice);
  };

  const handlePersonaSelect = (personaId: PersonaId) => {
    setSelectedPersonaId(personaId);
    setActivePersonaId(personaId);

    const lCfg = getLiveVoiceConfig(personaId, selectedIdentity);
    const cCfg = getChatVoiceConfig(personaId, selectedIdentity);
    setLiveVoiceId(lCfg.voiceId);
    setLiveHeyGenVoiceId(lCfg.heygenVoiceId || OPENROUTER_TTS_DEFAULT_VOICE);
    setLiveAccent(lCfg.accent || 'Default');
    setLiveTone(lCfg.tone || 'Default');
    setChatProvider(cCfg.provider);
    setChatVoiceId(cCfg.voiceId);
    setChatSpeed(cCfg.speed);
    setChatPitch(cCfg.pitch);
    setChatAccent(cCfg.accent || 'Default');
    setChatTone(cCfg.tone || 'Default');
    setChatSpeechEnabledState(cCfg.enabled);

    const activeVoice = mode === 'chat-voice' ? cCfg.voiceId : lCfg.voiceId;
    const selectedGender = IDENTITIES[selectedIdentity]?.gender || (selectedIdentity === 'tyler' ? 'male' : 'female');
    const resolvedMeta = GEMINI_LIVE_VOICES.find((v) => v.id === activeVoice);
    addDebugLog(
      'Selector:Tap',
      `[Selector:Tap] Persona tapped -> ${personaId} (identity=${selectedIdentity}, selectedGender=${selectedGender}, resolvedVoice=${activeVoice}, voiceGender=${resolvedMeta?.gender || 'unknown'})`
    );
    onChanged?.(selectedIdentity, personaId, activeVoice);
  };

  const handleCustomDirectivesChange = (val: string) => {
    setCustomDirectives(val);
    persistCustomDirectives(val);
  };

  const liveUsesOpenRouterHeyGen =
    appSettings.models.liveProvider !== 'gemini' && getSelectedVoiceProvider() === 'openrouter';

  // Live Voice Handlers
  const handleLiveVoiceSelect = (voice: VoiceOption) => {
    if (liveUsesOpenRouterHeyGen || isHeyGenVoiceId(voice.id)) {
      const nextHeyGen = voice.id;
      setLiveHeyGenVoiceId(nextHeyGen);
      const updated = setLiveVoiceConfig({ heygenVoiceId: nextHeyGen }, selectedPersonaId, selectedIdentity);
      addDebugLog(
        'Selector:Tap',
        `[Selector:Tap] Live HeyGen voice tapped -> ${nextHeyGen} (persona=${selectedPersonaId})`
      );
      onChanged?.(selectedIdentity, selectedPersonaId, nextHeyGen);
      onLiveVoiceConfigChanged?.(updated);
      return;
    }
    const nextVoiceId = voice.id as LiveVoiceName;
    setLiveVoiceId(nextVoiceId);
    const updated = setLiveVoiceConfig({ voiceId: nextVoiceId }, selectedPersonaId, selectedIdentity);
    const selectedGender = IDENTITIES[selectedIdentity]?.gender || (selectedIdentity === 'tyler' ? 'male' : 'female');
    addDebugLog(
      'Selector:Tap',
      `[Selector:Tap] Live voice tapped -> ${updated.voiceId} (selectedGender=${selectedGender}, filterGender=${genderFilter}, resolvedVoiceGender=${voice.gender || 'unknown'})`
    );
    onChanged?.(selectedIdentity, selectedPersonaId, updated.voiceId);
    onLiveVoiceConfigChanged?.(updated);
  };

  const handleLiveAccentSelect = (accent: string) => {
    if (liveUsesOpenRouterHeyGen) return;
    setLiveAccent(accent);
    const updated = setLiveVoiceConfig({ accent }, selectedPersonaId, selectedIdentity);
    setLiveVoiceId(updated.voiceId);
    const derivedLocale = deriveLanguageCodeFromAccent(accent);
    const selectedGender = IDENTITIES[selectedIdentity]?.gender || (selectedIdentity === 'tyler' ? 'male' : 'female');
    const resolvedMeta = GEMINI_LIVE_VOICES.find((v) => v.id === updated.voiceId);
    addDebugLog(
      'Selector:Tap',
      `[Selector:Tap] Live accent tapped -> ${accent} (derivedLocale=${derivedLocale}, selectedGender=${selectedGender}, resolvedVoice=${updated.voiceId}, voiceGender=${resolvedMeta?.gender || 'unknown'})`
    );
    onChanged?.(selectedIdentity, selectedPersonaId, updated.voiceId);
    onLiveVoiceConfigChanged?.(updated);
  };

  const handleLiveToneSelect = (tone: string) => {
    if (liveUsesOpenRouterHeyGen) return;
    setLiveTone(tone);
    const updated = setLiveVoiceConfig({ tone }, selectedPersonaId, selectedIdentity);
    setLiveVoiceId(updated.voiceId);
    const selectedGender = IDENTITIES[selectedIdentity]?.gender || (selectedIdentity === 'tyler' ? 'male' : 'female');
    const resolvedMeta = GEMINI_LIVE_VOICES.find((v) => v.id === updated.voiceId);
    addDebugLog(
      'Selector:Tap',
      `[Selector:Tap] Live tone tapped -> ${tone} (selectedGender=${selectedGender}, resolvedVoice=${updated.voiceId}, voiceGender=${resolvedMeta?.gender || 'unknown'})`
    );
    onChanged?.(selectedIdentity, selectedPersonaId, updated.voiceId);
    onLiveVoiceConfigChanged?.(updated);
  };

  // Chat Voice Handlers
  const handleChatProviderChange = (provider: SierraVoiceProvider) => {
    setChatProvider(provider);
    setSelectedVoiceProvider(provider);
    const updated = setChatVoiceConfig({ provider }, selectedPersonaId, selectedIdentity);
    setChatVoiceId(updated.voiceId);
    addDebugLog('Selector:Tap', `[Selector:Tap] Chat voice provider tapped -> ${provider} (voice=${updated.voiceId})`);
    onChanged?.(selectedIdentity, selectedPersonaId, updated.voiceId);
    onChatVoiceConfigChanged?.(updated);
  };

  const handleChatSpeechToggle = (enabled: boolean) => {
    setChatSpeechEnabledState(enabled);
    setChatSpeechEnabled(enabled);
    const updated = setChatVoiceConfig({ enabled }, selectedPersonaId, selectedIdentity);
    if (!enabled) {
      stopSpeaking('Chat speech muted in Voice Modal');
    }
    onChatVoiceConfigChanged?.(updated);
  };

  const handleChatSpeedChange = (speed: number) => {
    if (chatProvider === 'openrouter') return;
    const rounded = parseFloat(speed.toFixed(2));
    setChatSpeed(rounded);
    setTtsRate(rounded);
    const updated = setChatVoiceConfig({ speed: rounded }, selectedPersonaId, selectedIdentity);
    onChatVoiceConfigChanged?.(updated);
  };

  const handleChatPitchChange = (pitch: number) => {
    if (chatProvider === 'openrouter') return;
    const rounded = parseFloat(pitch.toFixed(2));
    setChatPitch(rounded);
    setTtsPitch(rounded);
    const updated = setChatVoiceConfig({ pitch: rounded }, selectedPersonaId, selectedIdentity);
    onChatVoiceConfigChanged?.(updated);
  };

  const handleResetSliders = () => {
    if (chatProvider === 'openrouter') return;
    const updated = resetTtsSlidersToDefault(selectedPersonaId, selectedIdentity);
    setChatSpeed(1.0);
    setChatPitch(1.0);
    onChatVoiceConfigChanged?.(updated);
  };

  const handleChatAccentSelect = (accent: string) => {
    if (chatProvider === 'openrouter') return;
    setChatAccent(accent);
    const updated = setChatVoiceConfig({ accent }, selectedPersonaId, selectedIdentity);
    setChatVoiceId(updated.voiceId);
    const selectedGender = IDENTITIES[selectedIdentity]?.gender || (selectedIdentity === 'tyler' ? 'male' : 'female');
    const resolvedMeta = GEMINI_LIVE_VOICES.find((v) => v.id === updated.voiceId);
    addDebugLog(
      'Selector:Tap',
      `[Selector:Tap] Chat accent tapped -> ${accent} (selectedGender=${selectedGender}, resolvedVoice=${updated.voiceId}, voiceGender=${resolvedMeta?.gender || 'unknown'})`
    );
    onChanged?.(selectedIdentity, selectedPersonaId, updated.voiceId);
    onChatVoiceConfigChanged?.(updated);
  };

  const handleChatToneSelect = (tone: string) => {
    if (chatProvider === 'openrouter') return;
    setChatTone(tone);
    const updated = setChatVoiceConfig({ tone }, selectedPersonaId, selectedIdentity);
    setChatVoiceId(updated.voiceId);
    const selectedGender = IDENTITIES[selectedIdentity]?.gender || (selectedIdentity === 'tyler' ? 'male' : 'female');
    const resolvedMeta = GEMINI_LIVE_VOICES.find((v) => v.id === updated.voiceId);
    addDebugLog(
      'Selector:Tap',
      `[Selector:Tap] Chat tone tapped -> ${tone} (selectedGender=${selectedGender}, resolvedVoice=${updated.voiceId}, voiceGender=${resolvedMeta?.gender || 'unknown'})`
    );
    onChanged?.(selectedIdentity, selectedPersonaId, updated.voiceId);
    onChatVoiceConfigChanged?.(updated);
  };

  const handleChatVoiceSelect = useCallback(
    async (voice: VoiceOption) => {
      setChatVoiceId(voice.id);
      const updated = setChatVoiceConfig({ voiceId: voice.id }, selectedPersonaId, selectedIdentity);
      const selectedGender = IDENTITIES[selectedIdentity]?.gender || (selectedIdentity === 'tyler' ? 'male' : 'female');
      addDebugLog(
        'Selector:Tap',
        `[Selector:Tap] Chat voice tapped -> ${voice.id} (selectedGender=${selectedGender}, filterGender=${genderFilter}, resolvedVoiceGender=${voice.gender || 'unknown'})`
      );
      onChanged?.(selectedIdentity, selectedPersonaId, voice.id);
      onChatVoiceConfigChanged?.(updated);
      setVoiceNotice(null);
    },
    [selectedPersonaId, selectedIdentity, genderFilter, onChanged, onChatVoiceConfigChanged]
  );

  const handleTestVoice = async (voice: VoiceOption) => {
    if (previewingVoiceId === voice.id) {
      await stopSpeaking('Stopped voice preview');
      setPreviewingVoiceId(null);
      return;
    }

    setPreviewingVoiceId(voice.id);
    setVoiceNotice(null);

    const identityName = selectedIdentity === 'tyler' ? 'Tyler' : 'Sierra';
    const sampleText = `Hi, I'm ${identityName}, speaking in the ${voice.name} voice with ${chatAccent} accent and ${chatTone} tone.`;

    const playRes = await testVoicePlayback(
      voice.id,
      sampleText,
      selectedIdentity,
      selectedPersonaId,
      {
        provider: mode === 'live-voice' ? (liveUsesOpenRouterHeyGen ? 'openrouter' : 'native') : chatProvider,
        speed: chatSpeed,
        pitch: chatPitch,
        accent: mode === 'live-voice' ? liveAccent : chatAccent,
        tone: mode === 'live-voice' ? liveTone : chatTone,
      }
    );
    setPreviewingVoiceId(null);

    if (!playRes.ok) {
      setVoiceNotice(`Playback error on "${voice.name}": ${playRes.error || 'Synthesis error'}`);
    }
  };

  const currentVoiceId =
    mode === 'live-voice' ? (liveUsesOpenRouterHeyGen ? liveHeyGenVoiceId : liveVoiceId) : chatVoiceId;
  const voicePool =
    mode === 'live-voice'
      ? liveUsesOpenRouterHeyGen
        ? HEYGEN_OPENROUTER_VOICES
        : GEMINI_LIVE_VOICES
      : chatProvider === 'openrouter'
      ? HEYGEN_OPENROUTER_VOICES
      : availableVoices;

  const activeVoiceOption = useMemo(() => {
    return voicePool.find((v) => v.id === currentVoiceId) || voicePool[0];
  }, [voicePool, currentVoiceId]);

  const filteredVoices = useMemo(() => {
    return voicePool.filter((voice) => {
      if (genderFilter !== 'all' && voice.gender !== genderFilter) return false;
      if (mode === 'chat-voice' && chatProvider === 'native' && chatAccent !== 'Default') {
        // When filtering native device voices by accent, prefer matching accent or keep Live fallback voices visible
        if (!voice.isLiveVoice && voice.accent && voice.accent.toLowerCase() !== chatAccent.toLowerCase()) {
          return false;
        }
      }
      return true;
    });
  }, [voicePool, genderFilter, mode, chatProvider, chatAccent]);

  if (!isOpen) return null;

  const modalTitle =
    mode === 'persona'
      ? 'Manage Companion Persona'
      : mode === 'live-voice'
      ? 'Live Voice Settings (Gemini Live)'
      : 'Text Chat Voice Settings';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200"
    >
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl max-h-[92dvh] h-[92dvh] flex flex-col shadow-2xl overflow-hidden select-none"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* FIXED HEADER: Title & Shared Identity Quick Switch */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-800 bg-zinc-900/95 sticky top-0 z-10 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {mode === 'persona' ? (
                <Sparkles className="w-4 h-4 text-indigo-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-purple-400" />
              )}
              <h2 className="text-sm font-semibold text-zinc-100">{modalTitle}</h2>
            </div>
            <button
              onClick={() => {
                stopSpeaking('Closed modal');
                onClose();
              }}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Shared Companion Identity Switch (Sierra / Tyler) */}
          <div className="grid grid-cols-2 gap-2 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            {(['sierra', 'tyler'] as CompanionIdentity[]).map((idKey) => {
              const config = IDENTITIES[idKey];
              const isSelected = selectedIdentity === idKey;
              return (
                <button
                  key={idKey}
                  type="button"
                  onClick={() => handleIdentityChange(idKey)}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <span className="text-sm">{config.avatar}</span>
                  <span>{config.name}</span>
                  <span className="text-[10px] opacity-75">({config.gender})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* VERTICALLY SCROLLABLE BODY */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-4"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* ================= MODE 1: PERSONA MODAL ================= */}
          {mode === 'persona' && (
            <>
              {/* Persona Selection */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Select Persona
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {(Object.keys(UNIFIED_PERSONAS) as PersonaId[]).map((pId) => {
                    const persona = UNIFIED_PERSONAS[pId];
                    const isSelected = selectedPersonaId === pId;
                    return (
                      <div
                        key={pId}
                        onClick={() => handlePersonaSelect(pId)}
                        className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                          isSelected
                            ? 'bg-indigo-950/40 border-indigo-500/80 text-white shadow-sm'
                            : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                        }`}
                      >
                        <span className="text-xl mt-0.5">{persona.avatar}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs">{persona.name}</span>
                            {isSelected && (
                              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 rounded-full flex items-center gap-1 font-medium">
                                <Check className="w-2.5 h-2.5" /> Active
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">{persona.tagline}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Content Mode (SFW vs Mature 18+) */}
              <div className="space-y-2 pt-3 border-t border-zinc-800">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Content Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['sfw', 'mature'] as ContentMode[]).map((cm) => {
                    const cfg = CONTENT_MODES[cm];
                    const active = contentMode === cm;
                    return (
                      <button
                        key={cm}
                        type="button"
                        onClick={() => setContentMode(cm)}
                        className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                          active
                            ? cm === 'mature'
                              ? 'bg-rose-950/40 border-rose-500/70 text-white'
                              : 'bg-emerald-950/40 border-emerald-500/70 text-white'
                            : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold flex items-center gap-1.5 text-zinc-100">
                            {cm === 'mature' ? (
                              <Flame className="w-3.5 h-3.5 text-rose-400" />
                            ) : (
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            )}
                            {cm === 'mature' ? 'Mature 18+' : 'SFW Mode'}
                          </span>
                          {active && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{cfg.shortDesc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Directives */}
              <div className="space-y-2 pt-3 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Custom Directives
                  </label>
                  <span className="text-[10px] text-zinc-500">Applies to Live &amp; Text Chat</span>
                </div>
                <textarea
                  value={customDirectives}
                  onChange={(e) => handleCustomDirectivesChange(e.target.value)}
                  placeholder="Optional custom instructions, preferred nickname, boundaries, or roleplay context..."
                  rows={3}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 resize-none select-text"
                />
              </div>
            </>
          )}

          {/* ================= MODE 2: LIVE VOICE MODAL ================= */}
          {mode === 'live-voice' && (
            <>
              <div className="p-2.5 rounded-xl bg-purple-950/20 border border-purple-500/20 text-[11px] text-purple-200">
                Real-time Gemini Live voice settings for <strong>{IDENTITIES[selectedIdentity].name}</strong> ({UNIFIED_PERSONAS[selectedPersonaId]?.name}).
              </div>

              {liveUsesOpenRouterHeyGen && (
                <p
                  data-testid="live-voice-heygen-accent-tone-notice"
                  className="text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-2 rounded-lg"
                >
                  Speed, pitch, accent, and tone apply only to native voices.
                </p>
              )}

              {/* Accent Selector */}
              <div className={`space-y-1.5 ${liveUsesOpenRouterHeyGen ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Accent
                  </label>
                  <span className="text-[10px] text-indigo-300 font-medium">
                    {liveAccent} ({deriveLanguageCodeFromAccent(liveAccent)})
                  </span>
                </div>
                <p className="text-[10px] text-zinc-500">
                  Sets regional pronunciation, speechConfig locale ({deriveLanguageCodeFromAccent(liveAccent)}), and selects a matching base voice unless you pick one below.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {VOICE_ACCENT_OPTIONS.map((acc) => (
                    <button
                      key={acc}
                      type="button"
                      disabled={liveUsesOpenRouterHeyGen}
                      onClick={() => handleLiveAccentSelect(acc)}
                      className={`px-2.5 py-1 rounded-full text-[11px] transition touch-manipulation ${
                        liveUsesOpenRouterHeyGen
                          ? 'bg-zinc-900 text-zinc-500 cursor-not-allowed opacity-60'
                          : liveAccent === acc
                          ? 'bg-indigo-600 text-white font-semibold shadow-sm cursor-pointer'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer'
                      }`}
                    >
                      {acc}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tone Selector */}
              <div className={`space-y-1.5 pt-2 border-t border-zinc-800 ${liveUsesOpenRouterHeyGen ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Tone
                  </label>
                  <span className="text-[10px] text-purple-300 font-medium">{liveTone}</span>
                </div>
                <p className="text-[10px] text-zinc-500">
                  Shapes vocal warmth, pacing, and emotional expression during Live sessions.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {VOICE_TONE_OPTIONS.map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      disabled={liveUsesOpenRouterHeyGen}
                      onClick={() => handleLiveToneSelect(tone)}
                      className={`px-2.5 py-1 rounded-full text-[11px] transition touch-manipulation ${
                        liveUsesOpenRouterHeyGen
                          ? 'bg-zinc-900 text-zinc-500 cursor-not-allowed opacity-60'
                          : liveTone === tone
                          ? 'bg-purple-600 text-white font-semibold shadow-sm cursor-pointer'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer'
                      }`}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gender Filter & Gemini Live Prebuilt Voices */}
              <div className="space-y-2.5 pt-2 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Voice
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-500 mr-1 flex items-center gap-1">
                      <Filter className="w-2.5 h-2.5" /> Gender:
                    </span>
                    {(['all', 'female', 'male'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          addDebugLog(
                            'Selector:Tap',
                            `[Selector:Tap] Live gender filter tapped -> ${g} (currentVoice=${liveVoiceId})`
                          );
                          setGenderFilter(g);
                        }}
                        className={`px-2 py-0.5 rounded-full text-[10px] transition capitalize ${
                          genderFilter === g
                            ? 'bg-zinc-200 text-zinc-950 font-semibold'
                            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {filteredVoices.map((voice) => {
                    const isSelected = liveUsesOpenRouterHeyGen
                      ? liveHeyGenVoiceId === voice.id
                      : liveVoiceId === voice.id;
                    return (
                      <div
                        key={voice.id}
                        onClick={() => handleLiveVoiceSelect(voice)}
                        className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                          isSelected
                            ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-sm'
                            : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                        }`}
                      >
                        <div className="min-w-0 pr-2 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap text-xs">
                            <span className="font-semibold text-zinc-100">{voice.name}</span>
                            {voice.gender && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 capitalize">
                                {voice.gender}
                              </span>
                            )}
                            {voice.tone && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 capitalize">
                                {voice.tone}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-500 truncate mt-0.5">{voice.description}</p>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-indigo-400 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ================= MODE 3: CHAT VOICE MODAL ================= */}
          {mode === 'chat-voice' && (
            <>
              <div className="p-2.5 rounded-xl bg-indigo-950/20 border border-indigo-500/20 text-[11px] text-indigo-200">
                Spoken reply settings for the <strong>Chat</strong> tab for{' '}
                <strong>{IDENTITIES[selectedIdentity].name}</strong> ({UNIFIED_PERSONAS[selectedPersonaId]?.name}).
              </div>

              {/* Spoken Replies On/Off Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <div>
                  <span className="text-xs font-semibold text-zinc-100 block">Spoken Chat Replies</span>
                  <span className="text-[10px] text-zinc-400">Automatically speak assistant replies aloud in Text Chat</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleChatSpeechToggle(!chatSpeechEnabledState)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    chatSpeechEnabledState
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {chatSpeechEnabledState ? 'Enabled' : 'Muted'}
                </button>
              </div>

              {/* Provider Selector */}
              <div className="space-y-1.5 pt-2 border-t border-zinc-800">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Voice Provider
                </label>
                <p className="text-[10px] text-zinc-500">
                  Choose on-device speech synthesis or OpenRouter HeyGen cloud audio.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleChatProviderChange('native')}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                      chatProvider === 'native'
                        ? 'bg-indigo-950/40 border-indigo-500 text-white shadow-sm'
                        : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-100">Native TTS</span>
                      {chatProvider === 'native' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-1">Device &amp; System Voices</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleChatProviderChange('openrouter')}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                      chatProvider === 'openrouter'
                        ? 'bg-purple-950/40 border-purple-500 text-white shadow-sm'
                        : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-100">OpenRouter Voice</span>
                      {chatProvider === 'openrouter' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-1 font-mono truncate">
                      {OPENROUTER_TTS_MODEL.split('/')[1] || 'HeyGen Voice Turbo'}
                    </p>
                  </button>
                </div>
              </div>

              {chatProvider === 'openrouter' ? (
                <p
                  data-testid="chat-voice-heygen-accent-tone-notice"
                  className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl"
                >
                  Speed, pitch, accent, and tone apply only to native voices.
                </p>
              ) : (
                <>
                  {/* Speed & Pitch Sliders + Reset to Default */}
                  <div className="space-y-2.5 pt-2 border-t border-zinc-800">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Speed &amp; Pitch
                      </label>
                      <button
                        type="button"
                        onClick={handleResetSliders}
                        className="inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reset to default (1.0x)
                      </button>
                    </div>
                    <p className="text-[10px] text-zinc-500">
                      Adjust speaking rate and vocal pitch for spoken chat replies.
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-400">Speed</span>
                          <span className="font-mono text-indigo-300">{chatSpeed.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.05"
                          value={chatSpeed}
                          onChange={(e) => handleChatSpeedChange(parseFloat(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-400">Pitch</span>
                          <span className="font-mono text-indigo-300">{chatPitch.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.05"
                          value={chatPitch}
                          onChange={(e) => handleChatPitchChange(parseFloat(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Accent & Tone Chips for Chat Voice */}
                  <div className="space-y-2 pt-2 border-t border-zinc-800">
                    <p className="text-[10px] text-zinc-500">
                      Select regional accent locale ({deriveLanguageCodeFromAccent(chatAccent)}) and vocal tone; automatically chooses a matching base voice if none was manually picked.
                    </p>
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      <span className="text-zinc-500 mr-1">Accent:</span>
                      {VOICE_ACCENT_OPTIONS.map((acc) => (
                        <button
                          key={acc}
                          type="button"
                          onClick={() => handleChatAccentSelect(acc)}
                          className={`px-2 py-0.5 rounded-full text-[10px] transition touch-manipulation ${
                            chatAccent === acc
                              ? 'bg-indigo-600 text-white font-semibold cursor-pointer'
                              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer'
                          }`}
                        >
                          {acc}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      <span className="text-zinc-500 mr-1">Tone:</span>
                      {VOICE_TONE_OPTIONS.map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => handleChatToneSelect(tone)}
                          className={`px-2 py-0.5 rounded-full text-[10px] transition touch-manipulation ${
                            chatTone === tone
                              ? 'bg-purple-600 text-white font-semibold cursor-pointer'
                              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer'
                          }`}
                        >
                          {tone}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Voice Catalog for Native / Fallback */}
              <div className="space-y-2 pt-2 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Voice
                    </label>
                  </div>
                  <div className="flex items-center gap-1">
                    {isLoadingVoices && (
                      <Loader2 className="w-3 h-3 animate-spin text-indigo-400 mr-1" />
                    )}
                    <span className="text-[10px] text-zinc-500 mr-1">Gender:</span>
                    {(['all', 'female', 'male'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          addDebugLog(
                            'Selector:Tap',
                            `[Selector:Tap] Chat gender filter tapped -> ${g} (currentVoice=${chatVoiceId})`
                          );
                          setGenderFilter(g);
                        }}
                        className={`px-2 py-0.5 rounded-full text-[10px] transition capitalize ${
                          genderFilter === g
                            ? 'bg-zinc-200 text-zinc-950 font-semibold'
                            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
                  {filteredVoices.map((voice) => {
                    const isSelected = chatVoiceId === voice.id;
                    const isProbing = probingVoiceId === voice.id;
                    const isPreviewing = previewingVoiceId === voice.id;

                    return (
                      <div
                        key={voice.id}
                        onClick={() => handleChatVoiceSelect(voice)}
                        className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                          isSelected
                            ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-sm'
                            : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                        } ${voice.isUnavailable ? 'opacity-50' : ''}`}
                      >
                        <div className="min-w-0 pr-2 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap text-xs">
                            <span className="font-semibold text-zinc-100">{voice.name}</span>
                            {voice.accent && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-indigo-300">
                                {voice.accent}
                              </span>
                            )}
                            {voice.gender && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 capitalize">
                                {voice.gender}
                              </span>
                            )}
                            {voice.isUnavailable && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-900/60 text-rose-300 border border-rose-700/50 flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5" /> Unavailable
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                            {voice.description || voice.lang}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTestVoice(voice);
                            }}
                            disabled={isPreviewing || isProbing}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
                            title="Preview voice"
                          >
                            {isPreviewing ? (
                              <Volume2 className="w-4 h-4 animate-pulse text-indigo-400" />
                            ) : isProbing ? (
                              <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            ) : (
                              <Volume2 className="w-4 h-4" />
                            )}
                          </button>
                          {isSelected && <Check className="w-4 h-4 text-indigo-400" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* FIXED FOOTER */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-zinc-800 bg-zinc-900/95 flex flex-col gap-2">
          {voiceNotice && (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
              <span>{voiceNotice}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            {mode === 'live-voice' && (
              <span className="text-[11px] text-purple-300 bg-purple-950/40 border border-purple-500/30 px-2.5 py-1.5 rounded-xl font-medium">
                Applies when the session starts
              </span>
            )}

            {mode === 'chat-voice' && activeVoiceOption && (
              <button
                type="button"
                onClick={() => handleTestVoice(activeVoiceOption)}
                disabled={previewingVoiceId === activeVoiceOption.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
              >
                <Volume2
                  className={`w-3.5 h-3.5 ${
                    previewingVoiceId === activeVoiceOption.id ? 'animate-pulse text-indigo-400' : ''
                  }`}
                />
                <span>{previewingVoiceId === activeVoiceOption.id ? 'Testing...' : 'Test Voice'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (mode === 'live-voice') {
                  const saved = setLiveVoiceConfig(
                    { voiceId: liveVoiceId, accent: liveAccent, tone: liveTone },
                    selectedPersonaId,
                    selectedIdentity
                  );
                  onChanged?.(selectedIdentity, selectedPersonaId, saved.voiceId);
                  onLiveVoiceConfigChanged?.(saved);
                }
                stopSpeaking('Closed modal');
                onClose();
              }}
              className="px-5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm ml-auto"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
