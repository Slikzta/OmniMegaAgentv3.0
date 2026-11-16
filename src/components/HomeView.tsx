import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MessageSquare, Sparkles, WifiOff, ArrowUpRight, Radio, Cpu } from 'lucide-react';
import {
  IDENTITIES,
  UNIFIED_PERSONAS,
  getActivePersonaId,
  getLiveVoiceConfig,
  getOpenRouterApiKey,
  type CompanionIdentity,
  type PersonaId,
} from '../lib/persona';
import {
  PROVIDER_METADATA,
  getProvidersConfig,
  getSelectedModelForProvider,
} from '../lib/providers';
import {
  OPENROUTER_DEFAULT_PAID_MODEL,
  getOpenRouterModelSettings,
  resolveEffectiveOpenRouterModel,
} from '../lib/openRouterLive';
import {
  useSettings,
  trimAndNormalizeApiKey,
  formatShortModelDisplayName,
} from '../lib/settingsStore';
import { useActiveIdentityAccent } from '../lib/themeStore';
import { triggerHaptic } from '../lib/haptics';
import { cn } from '../lib/utils';

interface HomeViewProps {
  onNavigateTab: (tab: 'home' | 'live' | 'chat' | 'create' | 'settings') => void;
}

export default function HomeView({ onNavigateTab }: HomeViewProps) {
  const { identity, accentHex, accentRgb, switchIdentity } = useActiveIdentityAccent();
  const settings = useSettings();
  const contentMode = settings.contentMode;
  const [personaId, setPersonaId] = useState<PersonaId>(() => getActivePersonaId());
  const [serverKeyFlags, setServerKeyFlags] = useState<Record<string, boolean>>({});
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  const swipeStartXRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const syncStatus = () => {
      setPersonaId(getActivePersonaId());
      setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
      getProvidersConfig()
        .then((cfg) => {
          if (!active) return;
          const flags: Record<string, boolean> = {};
          for (const [pid, info] of Object.entries(cfg.providers || {})) {
            flags[pid] = Boolean(info?.hasKey);
          }
          setServerKeyFlags(flags);
        })
        .catch(() => {});
    };

    syncStatus();
    if (typeof window !== 'undefined') {
      window.addEventListener('sierra-identity-changed', syncStatus);
      window.addEventListener('online', syncStatus);
      window.addEventListener('offline', syncStatus);
      window.addEventListener('focus', syncStatus);
    }
    return () => {
      active = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('sierra-identity-changed', syncStatus);
        window.removeEventListener('online', syncStatus);
        window.removeEventListener('offline', syncStatus);
        window.removeEventListener('focus', syncStatus);
      }
    };
  }, [identity, settings]);

  const chatProv = settings.models.chatProvider || 'gemini';
  const chatModel = settings.models.chatText || getSelectedModelForProvider(chatProv);
  const chatEngineName = PROVIDER_METADATA[chatProv]?.name || chatProv;
  const liveProv = settings.models.liveProvider;

  let liveEngineShort = 'Gemini Live';
  let liveModelDisplay = settings.models.liveCustomModelSlug.trim() || settings.models.liveModel;
  if (liveProv === 'local') {
    liveEngineShort = 'On-Phone Voice';
    liveModelDisplay = `Local (${settings.live.local.llmPreset.toUpperCase()})`;
  } else if (liveProv === 'openrouter') {
    liveEngineShort = 'OpenRouter Live';
    const orSlug = resolveEffectiveOpenRouterModel(getOpenRouterModelSettings(), undefined, contentMode);
    liveModelDisplay = formatShortModelDisplayName(orSlug || OPENROUTER_DEFAULT_PAID_MODEL);
  } else {
    liveModelDisplay = formatShortModelDisplayName(liveModelDisplay);
  }

  const activeEngineLabel = `${chatEngineName} · Live: ${liveEngineShort}`;
  const activeModelLabel = `Chat: ${formatShortModelDisplayName(chatModel)} · Voice: ${liveModelDisplay}`;

  const hasChatCreds =
    chatProv === 'ollama' ||
    chatProv === 'local' ||
    Boolean(trimAndNormalizeApiKey(settings.providers[chatProv]?.apiKey)) ||
    (chatProv === 'openrouter' && Boolean(getOpenRouterApiKey())) ||
    Boolean(serverKeyFlags[chatProv]);
  const isConnected = isOnline && hasChatCreds;

  const identityObj = IDENTITIES[identity] || IDENTITIES.sierra;
  const personaObj = UNIFIED_PERSONAS[personaId] || UNIFIED_PERSONAS.classy;
  const liveVoiceCfg = getLiveVoiceConfig(personaId, identity);

  const handleToggleIdentity = (target?: CompanionIdentity) => {
    const next: CompanionIdentity = target || (identity === 'sierra' ? 'tyler' : 'sierra');
    if (next !== identity) {
      switchIdentity(next);
    }
  };

  const handleSwipeStart = (clientX: number) => {
    swipeStartXRef.current = clientX;
  };

  const handleSwipeEnd = (clientX: number) => {
    if (swipeStartXRef.current === null) return;
    const deltaX = clientX - swipeStartXRef.current;
    swipeStartXRef.current = null;
    if (Math.abs(deltaX) > 36) {
      handleToggleIdentity(deltaX < 0 ? 'tyler' : 'sierra');
    }
  };

  return (
    <div
      data-testid="home-view"
      className="flex-1 flex flex-col min-h-0 h-full overflow-y-auto bg-[#0A0E14] relative select-none"
    >
      {/* Dynamic Assistant Radial Glow Backdrop with smooth color shift */}
      <div
        className="pointer-events-none absolute inset-0 transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 50% 28%, rgba(${accentRgb}, 0.17) 0%, rgba(${accentRgb}, 0.04) 36%, rgba(10, 14, 20, 0) 68%)`,
        }}
      />

      <div className="relative z-10 flex-1 flex flex-col justify-between max-w-2xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 gap-5">
        {/* Top: Sierra / Tyler Tap + Swipe Switcher */}
        <section
          aria-label="Assistant Switcher"
          onTouchStart={(e) => handleSwipeStart(e.touches[0].clientX)}
          onTouchEnd={(e) => handleSwipeEnd(e.changedTouches[0].clientX)}
          onPointerDown={(e) => handleSwipeStart(e.clientX)}
          onPointerUp={(e) => handleSwipeEnd(e.clientX)}
          className="w-full flex flex-col items-center gap-2 shrink-0"
        >
          <div
            data-testid="home-identity-switcher"
            className="sci-card rounded-2xl p-1.5 grid grid-cols-2 gap-1.5 w-full max-w-sm relative overflow-hidden"
          >
            {(['sierra', 'tyler'] as CompanionIdentity[]).map((idKey) => {
              const item = IDENTITIES[idKey];
              const isSelected = identity === idKey;
              return (
                <button
                  key={idKey}
                  type="button"
                  data-testid={`home-switch-${idKey}`}
                  onClick={() => handleToggleIdentity(idKey)}
                  className={cn(
                    'relative z-10 min-h-[48px] px-4 py-2 rounded-xl flex items-center justify-center gap-2.5 text-sm font-semibold transition-all duration-300 cursor-pointer touch-manipulation',
                    isSelected ? 'text-[#071018]' : 'text-[#C8CDD3] hover:text-white'
                  )}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="home-identity-pill"
                      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                      className="absolute inset-0 rounded-xl -z-10"
                      style={{
                        backgroundColor: accentHex,
                        boxShadow: `0 0 24px rgba(${accentRgb}, 0.5)`,
                      }}
                    />
                  )}
                  <span className="text-base">{item.avatar}</span>
                  <span className="sci-heading tracking-wide">{item.name}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[#C8CDD3]/65 tracking-wider uppercase">
            Tap or swipe to switch companion
          </p>
        </section>

        {/* Center: Pulsing Avatar / Orb + Persona Name */}
        <section className="flex flex-col items-center justify-center text-center py-2 shrink-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={identity}
              initial={{ opacity: 0, scale: 0.92, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 1.04, filter: 'blur(4px)' }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="flex flex-col items-center"
            >
              {/* Multi-ring pulsing sci-fi orb */}
              <div className="relative flex items-center justify-center w-44 h-44 sm:w-52 sm:h-52">
                <div
                  className="absolute inset-2 rounded-full border transition-colors duration-500"
                  style={{
                    borderColor: `rgba(${accentRgb}, 0.25)`,
                    boxShadow: `0 0 48px rgba(${accentRgb}, 0.16)`,
                  }}
                />
                <div
                  className="absolute inset-5 rounded-full border border-dashed animate-[spin_26s_linear_infinite]"
                  style={{ borderColor: `rgba(${accentRgb}, 0.3)` }}
                />
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('medium');
                    onNavigateTab('live');
                  }}
                  aria-label={`Talk live with ${identityObj.name}`}
                  className="relative w-32 h-32 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center animate-sci-orb-idle cursor-pointer touch-manipulation transition-all duration-500 border-2"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, rgba(${accentRgb}, 0.28), rgba(16, 22, 32, 0.96) 72%)`,
                    borderColor: accentHex,
                  }}
                >
                  <span className="text-4xl sm:text-5xl drop-shadow-[0_0_12px_rgba(0,229,255,0.4)]">
                    {identityObj.avatar}
                  </span>
                  <span
                    className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.22em]"
                    style={{ color: accentHex }}
                  >
                    {identityObj.name}
                  </span>
                </button>
              </div>

              {/* Active Persona Title below Orb */}
              <h1
                data-testid="home-persona-heading"
                className="sci-heading text-2xl sm:text-3xl font-bold text-white mt-3 tracking-tight"
              >
                {identityObj.name} — {personaObj.name}
              </h1>
              <p className="text-xs sm:text-sm text-[#C8CDD3]/80 mt-1 max-w-md">
                {personaObj.tagline} • Voice:{' '}
                <span style={{ color: accentHex }} className="font-semibold">
                  {liveVoiceCfg.voiceId}
                </span>
              </p>
            </motion.div>
          </AnimatePresence>
        </section>

        {/* Quick-Launch Cards */}
        <section aria-label="Quick Launch Actions" className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
          <button
            type="button"
            data-testid="home-launch-live"
            onClick={() => {
              triggerHaptic('medium');
              onNavigateTab('live');
            }}
            className="sci-card sci-card-interactive min-h-[84px] rounded-2xl p-4 text-left flex sm:flex-col items-center sm:items-start justify-between gap-3 cursor-pointer touch-manipulation"
          >
            <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: `rgba(${accentRgb}, 0.14)`,
                  borderColor: `rgba(${accentRgb}, 0.45)`,
                  color: accentHex,
                }}
              >
                <Mic className="w-5 h-5" />
              </div>
              <div>
                <div className="sci-heading text-sm font-bold text-white flex items-center gap-1.5">
                  Start Live Chat
                </div>
                <div className="text-xs text-[#C8CDD3]/75 mt-0.5">
                  Real-time voice link
                </div>
              </div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-[#C8CDD3]/60 sm:self-end shrink-0" />
          </button>

          <button
            type="button"
            data-testid="home-launch-chat"
            onClick={() => {
              triggerHaptic('light');
              onNavigateTab('chat');
            }}
            className="sci-card sci-card-interactive min-h-[84px] rounded-2xl p-4 text-left flex sm:flex-col items-center sm:items-start justify-between gap-3 cursor-pointer touch-manipulation"
          >
            <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: `rgba(${accentRgb}, 0.12)`,
                  borderColor: 'rgba(200, 205, 211, 0.25)',
                  color: '#C8CDD3',
                }}
              >
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <div className="sci-heading text-sm font-bold text-white">
                  Open Chat
                </div>
                <div className="text-xs text-[#C8CDD3]/75 mt-0.5">
                  Thread &amp; multimodal tools
                </div>
              </div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-[#C8CDD3]/60 sm:self-end shrink-0" />
          </button>

          <button
            type="button"
            data-testid="home-launch-create"
            onClick={() => {
              triggerHaptic('light');
              onNavigateTab('create');
            }}
            className="sci-card sci-card-interactive min-h-[84px] rounded-2xl p-4 text-left flex sm:flex-col items-center sm:items-start justify-between gap-3 cursor-pointer touch-manipulation"
          >
            <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: `rgba(${accentRgb}, 0.12)`,
                  borderColor: 'rgba(200, 205, 211, 0.25)',
                  color: '#C8CDD3',
                }}
              >
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="sci-heading text-sm font-bold text-white">
                  Create
                </div>
                <div className="text-xs text-[#C8CDD3]/75 mt-0.5">
                  Image &amp; video synthesis
                </div>
              </div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-[#C8CDD3]/60 sm:self-end shrink-0" />
          </button>
        </section>

        {/* Bottom Status Strip: Active Model + Connection Status */}
        <section
          data-testid="home-status-strip"
          className="sci-card rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center border shrink-0"
              style={{
                backgroundColor: `rgba(${accentRgb}, 0.1)`,
                borderColor: `rgba(${accentRgb}, 0.35)`,
                color: accentHex,
              }}
            >
              <Cpu className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#C8CDD3]/60 font-semibold">
                {activeEngineLabel}
              </div>
              <div className="text-xs font-mono font-semibold text-white truncate">
                {activeModelLabel}
              </div>
            </div>
          </div>

          <div
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold shrink-0',
              isConnected
                ? 'bg-emerald-500/10 border-emerald-400/35 text-emerald-300'
                : 'bg-rose-500/10 border-rose-400/35 text-rose-300'
            )}
          >
            {isConnected ? (
              <>
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>Disconnected</span>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
