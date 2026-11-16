import React, { useState, useEffect } from 'react';
import {
  getProvidersConfig,
  saveProviderConfig,
  testProviderConnection,
  getResponseSpeed,
  setResponseSpeed,
  PROVIDER_METADATA,
  PROVIDER_CONTENT_CAPABILITIES,
  type ProvidersConfigResponse,
  type ResponseSpeedLevel,
} from '../lib/providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import {
  Sparkles,
  Settings as SettingsIcon,
  Check,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Zap,
  Cpu,
  Smartphone,
  ShieldCheck,
  Radio,
  ArrowRight,
  RefreshCw,
  Volume2,
  Flame,
  Lock,
  MessageCircle,
  Key,
  Download,
  Upload,
  Palette,
  Plug,
  Bug,
  Copy,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Sliders,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import Integrations from './Integrations';
import {
  useActiveIdentityAccent,
  ASSISTANT_ACCENT_PRESETS,
  setAccentColorForIdentity,
  resetAssistantAccents,
  notifyIdentityChanged,
} from '../lib/themeStore';
import { useDebugLogs, clearDebugLogs } from '../lib/debugLogStore';
import { formatDebugLogs } from '../lib/debugLogs';
import {
  CONTENT_MODES,
  ContentMode,
  getTtsPitch,
  setTtsPitch,
  getTtsRate,
  setTtsRate,
  getActiveIdentity,
  setActiveIdentity,
  getActivePersonaId,
  UNIFIED_PERSONAS,
  IDENTITIES,
  OPEN_VOICE_POOL,
  getLiveVoiceConfig,
  getChatVoiceConfig,
  isChatSpeechEnabled,
  setChatSpeechEnabled,
  migrateVoiceConfigs,
  getConversationSummaries,
  deleteConversationSummary,
  clearConversationSummaries,
  MAX_CONVERSATION_SUMMARIES,
  type ConversationSummary,
  isBackgroundLiveEnabled,
  setBackgroundLiveEnabled,
  isWakeWordEnabled,
  setWakeWordEnabled,
  getWakeWordEngineType,
  setWakeWordEngineType,
  getWakeWordSensitivity,
  setWakeWordSensitivity,
  isAssistantModeEnabled,
  setAssistantModeEnabled,
  WakeWordEngineType,
  CompanionIdentity,
  AudioOutputMode,
  setAudioOutputMode,
  setGeminiThinkingLevel,
  validateThinkingLevel,
  isGeminiLiveExtendedThinkingModel,
  getSelectedVoiceProvider,
  setSelectedVoiceProvider,
} from '../lib/persona';
import {
  SierraBackgroundVoice,
  getPicovoiceAccessKey,
  setPicovoiceAccessKey,
  getStoredPpnKeyword,
  saveStoredPpnKeyword,
  startWakeWordListener,
  stopWakeWordListener,
  triggerTestWakeWord,
} from '../lib/backgroundVoiceService';
import { exportLocalBackupData, importLocalBackupData } from '../lib/chatStore';
import { stopSpeaking } from '../lib/ttsService';
import { PersonaVoiceModal } from './PersonaVoiceModal';
import { LocalVoiceSettingsCard } from './LocalVoiceSettingsCard';
import { useContentMode } from '../lib/contentModeStore';
import { isGeminiLiveModel } from '../lib/gemini';
import {
  LIVE_MODELS,
  DEFAULT_TEXT_MODEL,
  DEFAULT_LIVE_MODEL,
  setStoredLiveModel,
  setStoredLiveCustomModel,
  doesModelSupportFunctionCalling,
} from '../config/models';
import {
  DEVICE_CAPABILITIES,
  getDeviceCapabilitiesConfig,
  setDeviceCapabilityEnabled,
  setDirectSmsEnabled,
  setReadMessagesAndCallLogEnabled,
  getDevicePermissionsStatus,
  requestDeviceCapabilityPermission,
  type DevicePermissionsState,
  type DeviceCapabilityId,
} from '../lib/deviceControl';
import {
  EMAIL_TOOL_NAMES,
  EMAIL_PROVIDER_SETUP_GUIDES,
  DEFAULT_GMAIL_OAUTH_CLIENT_ID,
  DEFAULT_GMAIL_REDIRECT_URI,
  deriveGoogleAndroidRedirectUri,
  parseGoogleCredentialsJson,
  startNativeGmailOAuthSignIn,
  getConnectedEmailAccounts,
  saveConnectedEmailAccountsMetadata,
  connectEmailAccountWithKeystore,
  disconnectEmailAccount,
  getEmailToolsEnabledConfig,
  setEmailToolEnabled,
  buildOAuthAuthorizeUrl,
  getSierraEmailPlugin,
  type EmailProviderType,
  type EmailActionName,
} from '../lib/emailTools';
import {
  setLiveVoiceProvider,
  getSierraLocalVoicePlugin,
  type LiveVoiceProviderId,
  type MicSourceSetting,
  type DebugUtteranceEntry,
} from '../lib/localVoiceEngine';
import {
  OPENROUTER_DEFAULT_PAID_MODEL,
  fetchOpenRouterFreeModels,
  saveOpenRouterModelSettings,
  formatOpenRouterFreeModelLabel,
  type OpenRouterModelDescriptor,
} from '../lib/openRouterLive';
import {
  ALL_PROVIDER_IDS,
  DEFAULT_OPENROUTER_PAID_MODEL,
  DEFAULT_PROVIDER_ENDPOINTS,
  formatShortModelDisplayName,
  getCustomDirectives,
  setCustomDirectives as persistCustomDirectives,
  trimAndNormalizeApiKey,
  updateSettings,
  useSettings,
  validateHttpEndpoint,
  validateWsEndpoint,
  type BargeInModeSetting,
  type ProviderId,
} from '../lib/settingsStore';

export { PROVIDER_METADATA };

export type SettingsSectionId = 'providers' | 'models' | 'persona' | 'backup';

interface SettingsProps {
  onNavigateToChat?: () => void;
  initialSection?: SettingsSectionId;
  initialProviderId?: string;
}

interface ProviderDraftState {
  apiKey: string;
  httpEndpoint: string;
  wsEndpoint: string;
  showKey: boolean;
  httpError?: string;
  wsError?: string;
  isTesting?: boolean;
  testResult?: {
    success: boolean;
    status?: number;
    latencyMs?: number;
    message?: string;
    error?: string;
  } | null;
}

export default function SettingsView({
  onNavigateToChat,
  initialSection = 'providers',
  initialProviderId,
}: SettingsProps) {
  const { accentHex, accentRgb, accents } = useActiveIdentityAccent();
  const settings = useSettings();
  const debugLogs = useDebugLogs();
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [config, setConfig] = useState<ProvidersConfigResponse | null>(null);
  const [openRouterFreeModels, setOpenRouterFreeModels] = useState<OpenRouterModelDescriptor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Top-level collapsible card expansion state (all 4 cards in exact order)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [expandedCards, setExpandedCards] = useState<Record<SettingsSectionId, boolean>>({
    providers: initialSection === 'providers',
    models: initialSection === 'models',
    persona: initialSection === 'persona',
    backup: initialSection === 'backup',
  });

  // Expandable provider card inside Providers
  const [expandedProviderId, setExpandedProviderId] = useState<ProviderId>(() => {
    if (initialProviderId && ALL_PROVIDER_IDS.includes(initialProviderId as ProviderId)) {
      return initialProviderId as ProviderId;
    }
    return settings.models.chatProvider || 'openrouter';
  });

  // Per-provider draft inputs + validation + connection test state
  const [providerDrafts, setProviderDrafts] = useState<Record<ProviderId, ProviderDraftState>>(() => {
    const init = {} as Record<ProviderId, ProviderDraftState>;
    for (const pid of ALL_PROVIDER_IDS) {
      const stored = settings.providers[pid];
      const defEp = DEFAULT_PROVIDER_ENDPOINTS[pid];
      init[pid] = {
        apiKey: stored?.apiKey || '',
        httpEndpoint: stored?.httpEndpoint || defEp.httpEndpoint,
        wsEndpoint: stored?.wsEndpoint || defEp.wsEndpoint,
        showKey: false,
      };
    }
    return init;
  });

  // Keep draft HTTP/WS/key synced cleanly when store hydrates/updates externally unless actively edited
  useEffect(() => {
    setProviderDrafts((prev) => {
      const next = { ...prev };
      for (const pid of ALL_PROVIDER_IDS) {
        const stored = settings.providers[pid];
        const defEp = DEFAULT_PROVIDER_ENDPOINTS[pid];
        next[pid] = {
          ...prev[pid],
          apiKey: prev[pid]?.apiKey || stored?.apiKey || '',
          httpEndpoint: stored?.httpEndpoint || defEp.httpEndpoint,
          wsEndpoint: defEp.supportsWs ? (stored?.wsEndpoint || defEp.wsEndpoint) : '',
        };
      }
      return next;
    });
  }, [settings.providers]);

  const activeChatProvider = settings.models.chatProvider || 'gemini';
  const activeChatModelValue = settings.models.chatText || DEFAULT_TEXT_MODEL;
  const activeChatMeta = PROVIDER_METADATA[activeChatProvider];
  const liveProvider = settings.models.liveProvider;
  const liveVoiceModel =
    liveProvider === 'gemini' ? settings.models.liveModel || DEFAULT_LIVE_MODEL : DEFAULT_LIVE_MODEL;
  const liveVoiceCustomModel =
    liveProvider === 'gemini' ? settings.models.liveCustomModelSlug || '' : '';
  const openRouterLiveSlug =
    liveProvider === 'openrouter'
      ? settings.models.liveModel || DEFAULT_OPENROUTER_PAID_MODEL
      : settings.live.openRouterModel || DEFAULT_OPENROUTER_PAID_MODEL;
  const openRouterLiveCustomSlug =
    liveProvider === 'openrouter'
      ? settings.models.liveCustomModelSlug || ''
      : settings.live.openRouterCustomSlug || '';
  const thinkingLevel = settings.live.thinkingLevel || 'LOW';
  const bargeInSensitivity = settings.live.bargeInSensitivity;
  const bargeInMode: BargeInModeSetting = settings.live.local?.bargeInMode || 'headphones_only';
  const micSource: MicSourceSetting = settings.live.local?.micSource || 'auto';
  const saveLast10Utterances = Boolean(settings.live.local?.saveLast10Utterances);
  const audioOutputMode = settings.live.audioOutputMode;
  const responseSpeed = settings.responseSpeed;

  const [debugUtterances, setDebugUtterances] = useState<DebugUtteranceEntry[]>([]);
  const [playingUtteranceId, setPlayingUtteranceId] = useState<string | null>(null);
  const debugUtteranceAudioRef = React.useRef<HTMLAudioElement | null>(null);

  const loadDebugUtterances = async () => {
    try {
      const res = await getSierraLocalVoicePlugin().listDebugUtterances?.();
      if (res?.ok && Array.isArray(res.utterances)) {
        setDebugUtterances(res.utterances);
      }
    } catch {}
  };

  const handlePlayDebugUtterance = async (id: string) => {
    try {
      if (debugUtteranceAudioRef.current) {
        debugUtteranceAudioRef.current.pause();
        debugUtteranceAudioRef.current = null;
      }
      if (playingUtteranceId === id) {
        setPlayingUtteranceId(null);
        return;
      }
      const res = await getSierraLocalVoicePlugin().getDebugUtteranceAudio?.({ id });
      if (!res?.ok || !res.wavBase64) {
        toast.error(res?.reason || 'Audio clip unavailable');
        return;
      }
      const audio = new Audio(`data:audio/wav;base64,${res.wavBase64}`);
      debugUtteranceAudioRef.current = audio;
      setPlayingUtteranceId(id);
      audio.onended = () => setPlayingUtteranceId(null);
      audio.onerror = () => setPlayingUtteranceId(null);
      await audio.play();
    } catch (err: any) {
      setPlayingUtteranceId(null);
      toast.error(err?.message || 'Could not play audio clip');
    }
  };

  // Content Mode & Custom Directives
  const [contentMode, setContentMode] = useContentMode();
  const [customDirectives, setCustomDirectives] = useState<string>(() => getCustomDirectives());

  // Sub-panel toggles inside Content Mode & Backup
  const [showAdvancedDebug, setShowAdvancedDebug] = useState(false);
  const [showIntegrationsPanel, setShowIntegrationsPanel] = useState(false);

  // Backup & Memory Manager state (scoped per active identity)
  const [summariesList, setSummariesList] = useState<ConversationSummary[]>(() =>
    getConversationSummaries(settings.activeIdentity)
  );
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const summariesCount = summariesList.length;
  const refreshMemorySummaries = (identityOverride?: CompanionIdentity) => {
    setSummariesList(getConversationSummaries(identityOverride || settings.activeIdentity));
  };
  useEffect(() => {
    refreshMemorySummaries(settings.activeIdentity);
    setShowClearAllConfirm(false);
  }, [settings.activeIdentity]);
  const backupFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Persona & Voice modals / sliders
  const [ttsPitch, setTtsPitchState] = useState<number>(() => getTtsPitch());
  const [ttsRate, setTtsRateState] = useState<number>(() => getTtsRate());
  const [ttsProvider, setTtsProviderState] = useState<'native' | 'openrouter'>(() => getSelectedVoiceProvider());
  const [chatSpeechEnabled, setChatSpeechEnabledState] = useState<boolean>(() => isChatSpeechEnabled());
  const [activeModalMode, setActiveModalMode] = useState<'persona' | 'live-voice' | 'chat-voice' | null>(null);
  const [voiceSettingsTick, setVoiceSettingsTick] = useState<number>(0);

  // Device Control & Email Accounts
  const [deviceCaps, setDeviceCaps] = useState(() => getDeviceCapabilitiesConfig());
  const [devicePerms, setDevicePerms] = useState<DevicePermissionsState>({
    contacts: 'prompt',
    phone: 'prompt',
    sms: 'prompt',
    calendar: 'prompt',
    callScreeningRole: false,
    alarm: 'granted',
  });
  const [emailAccounts, setEmailAccounts] = useState(() => getConnectedEmailAccounts());
  const [emailToolsEnabled, setEmailToolsEnabledState] = useState(() => getEmailToolsEnabledConfig());
  const [emailFormProvider, setEmailFormProvider] = useState<EmailProviderType>('gmail');
  const [emailFormAddress, setEmailFormAddress] = useState('');
  const [emailFormDisplayName, setEmailFormDisplayName] = useState('');
  const [emailFormClientId, setEmailFormClientId] = useState(DEFAULT_GMAIL_OAUTH_CLIENT_ID);
  const [emailFormRedirectUri, setEmailFormRedirectUri] = useState(DEFAULT_GMAIL_REDIRECT_URI);
  const [emailFormAuthCode, setEmailFormAuthCode] = useState('');
  const [emailFormAccessToken, setEmailFormAccessToken] = useState('');
  const [emailFormRefreshToken, setEmailFormRefreshToken] = useState('');
  const [emailFormYahooAppPassword, setEmailFormYahooAppPassword] = useState('');
  const [showEmailSetupGuides, setShowEmailSetupGuides] = useState(false);
  const googleCredsFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Background Live Voice & Wake Word
  const [bgLiveEnabled, setBgLiveEnabledState] = useState<boolean>(() => isBackgroundLiveEnabled());
  const [ignoringBatteryOpt, setIgnoringBatteryOpt] = useState<boolean>(false);
  const [wakeWordEnabled, setWakeWordEnabledState] = useState<boolean>(() => isWakeWordEnabled());
  const [wakeWordEngine, setWakeWordEngineState] = useState<WakeWordEngineType>(() => getWakeWordEngineType());
  const [wakeWordSensitivity, setWakeWordSensitivityState] = useState<number>(() => getWakeWordSensitivity());
  const [porcupineKey, setPorcupineKeyState] = useState<string>(() => getPicovoiceAccessKey());
  const [showPorcupineKey, setShowPorcupineKey] = useState<boolean>(false);
  const [sierraPpnFile, setSierraPpnFileState] = useState<{ fileName: string; base64Data: string } | null>(() => getStoredPpnKeyword('sierra'));
  const [tylerPpnFile, setTylerPpnFileState] = useState<{ fileName: string; base64Data: string } | null>(() => getStoredPpnKeyword('tyler'));
  const [assistantModeEnabled, setAssistantModeEnabledState] = useState<boolean>(() => isAssistantModeEnabled());
  const [defaultAssistantStatus, setDefaultAssistantStatus] = useState<{
    isDefault: boolean;
    canRead: boolean;
    currentAssistant: string;
  } | null>(null);
  const sierraPpnInputRef = React.useRef<HTMLInputElement | null>(null);
  const tylerPpnInputRef = React.useRef<HTMLInputElement | null>(null);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const data = await getProvidersConfig();
      setConfig(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
      toast.error('Could not load AI provider configuration');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
    fetchOpenRouterFreeModels()
      .then((models) => setOpenRouterFreeModels(models))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
      setExpandedCards((prev) => ({ ...prev, [initialSection]: true }));
      if (typeof document !== 'undefined') {
        const el = document.getElementById(`settings-section-${initialSection}`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  }, [initialSection]);

  useEffect(() => {
    if (initialProviderId && ALL_PROVIDER_IDS.includes(initialProviderId as ProviderId)) {
      setExpandedProviderId(initialProviderId as ProviderId);
      setExpandedCards((prev) => ({ ...prev, providers: true }));
    }
  }, [initialProviderId]);

  useEffect(() => {
    migrateVoiceConfigs();
    getDevicePermissionsStatus()
      .then((res) => setDevicePerms(res))
      .catch(() => {});
    const onDeviceCapsUpdated = () => setDeviceCaps(getDeviceCapabilitiesConfig());
    const onEmailAccountsUpdated = () => setEmailAccounts(getConnectedEmailAccounts());
    window.addEventListener('sierra_device_capabilities_updated', onDeviceCapsUpdated as EventListener);
    window.addEventListener('sierra_email_accounts_updated', onEmailAccountsUpdated as EventListener);

    let oauthListenerHandle: { remove: () => Promise<void> } | null = null;
    const emailPlugin = getSierraEmailPlugin();
    if (typeof emailPlugin?.addListener === 'function') {
      emailPlugin
        .addListener('oauthSignInComplete', (evt) => {
          if (evt?.ok && evt.email && evt.accountId) {
            const existing = getConnectedEmailAccounts();
            const provider = (evt.provider === 'outlook' ? 'outlook' : 'gmail') as EmailProviderType;
            const nextMeta = [
              ...existing.filter((a) => a.id.toLowerCase() !== evt.accountId!.toLowerCase()),
              {
                id: evt.accountId,
                provider,
                email: evt.email,
                displayName: evt.displayName || evt.email,
                oauthClientId: evt.clientId || emailFormClientId || DEFAULT_GMAIL_OAUTH_CLIENT_ID,
                redirectUri: evt.redirectUri || emailFormRedirectUri || DEFAULT_GMAIL_REDIRECT_URI,
                connectedAt: Date.now(),
                enabled: true,
              },
            ];
            saveConnectedEmailAccountsMetadata(nextMeta);
            setEmailAccounts(getConnectedEmailAccounts());
            setEmailFormAddress(evt.email);
            toast.success(`Signed in with Google as ${evt.email}! Tokens vaulted in Android Keystore.`);
          } else if (evt && !evt.ok) {
            toast.error(evt.reason || 'Google OAuth sign-in did not complete.');
          }
        })
        .then((h) => {
          oauthListenerHandle = h;
        })
        .catch(() => {});
    }

    SierraBackgroundVoice.checkBatteryOptimization()
      .then((res) => setIgnoringBatteryOpt(Boolean(res?.isIgnoringBatteryOptimizations)))
      .catch(() => {});
    SierraBackgroundVoice.checkDefaultAssistantStatus()
      .then((res) => {
        if (res) {
          setDefaultAssistantStatus(res);
          if (res.isDefault && !isAssistantModeEnabled()) {
            setAssistantModeEnabled(true);
            setAssistantModeEnabledState(true);
          }
        }
      })
      .catch(() => {});

    return () => {
      window.removeEventListener('sierra_device_capabilities_updated', onDeviceCapsUpdated as EventListener);
      window.removeEventListener('sierra_email_accounts_updated', onEmailAccountsUpdated as EventListener);
      if (oauthListenerHandle) {
        oauthListenerHandle.remove().catch(() => {});
      }
    };
  }, []);

  const jumpToSection = (sec: SettingsSectionId) => {
    setActiveSection(sec);
    setExpandedCards((prev) => ({ ...prev, [sec]: true }));
    if (typeof document !== 'undefined') {
      const el = document.getElementById(`settings-section-${sec}`);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const toggleCard = (sec: SettingsSectionId) => {
    setExpandedCards((prev) => ({ ...prev, [sec]: !prev[sec] }));
    setActiveSection(sec);
  };

  const updateDraft = (pid: ProviderId, patch: Partial<ProviderDraftState>) => {
    setProviderDrafts((prev) => ({
      ...prev,
      [pid]: {
        ...prev[pid],
        ...patch,
      },
    }));
  };

  const runTestConnectionForProvider = async (
    pid: ProviderId,
    overrideApiKey?: string,
    overrideHttp?: string,
    overrideWs?: string
  ) => {
    const draft = providerDrafts[pid];
    const httpUrl = (overrideHttp ?? draft?.httpEndpoint ?? '').trim();
    const wsUrl = (overrideWs ?? draft?.wsEndpoint ?? '').trim();
    const apiKey = trimAndNormalizeApiKey(overrideApiKey ?? draft?.apiKey);

    const defEp = DEFAULT_PROVIDER_ENDPOINTS[pid];
    if (httpUrl) {
      const httpCheck = validateHttpEndpoint(httpUrl);
      if (!httpCheck.valid) {
        updateDraft(pid, {
          httpError: httpCheck.error,
          testResult: { success: false, error: httpCheck.error },
        });
        toast.error(httpCheck.error || 'Invalid HTTP endpoint URL');
        return;
      }
    }
    if (defEp.supportsWs && wsUrl) {
      const wsCheck = validateWsEndpoint(wsUrl);
      if (!wsCheck.valid) {
        updateDraft(pid, {
          wsError: wsCheck.error,
          testResult: { success: false, error: wsCheck.error },
        });
        toast.error(wsCheck.error || 'Invalid WebSocket URL');
        return;
      }
    }

    updateDraft(pid, { isTesting: true, testResult: null, httpError: undefined, wsError: undefined });
    try {
      const modelToUse =
        pid === 'gemini' && liveProvider === 'gemini'
          ? liveVoiceCustomModel.trim() || liveVoiceModel || settings.chatProviders.gemini.selectedModel
          : settings.chatProviders[pid]?.customModel?.trim() ||
            settings.chatProviders[pid]?.selectedModel ||
            PROVIDER_METADATA[pid]?.models[0]?.id ||
            '';

      const res = await testProviderConnection({
        providerId: pid,
        apiKey: apiKey || undefined,
        baseUrl: httpUrl || undefined,
        liveWsUrl: defEp.supportsWs ? wsUrl || undefined : undefined,
        model: modelToUse || undefined,
        ...(pid === 'gemini' && isGeminiLiveExtendedThinkingModel(modelToUse)
          ? { thinkingLevel }
          : {}),
      });

      updateDraft(pid, { isTesting: false, testResult: res });
      if (res.success) {
        toast.success(`${PROVIDER_METADATA[pid]?.name || pid}: ${res.message || 'Connected!'}`);
      } else {
        toast.error(`${PROVIDER_METADATA[pid]?.name || pid}: ${res.error || 'Connection failed'}`);
      }
    } catch (err: any) {
      const msg = err?.message || 'Connection test failed';
      updateDraft(pid, {
        isTesting: false,
        testResult: { success: false, error: msg },
      });
      toast.error(msg);
    }
  };

  const handleSaveProviderCard = async (pid: ProviderId) => {
    const draft = providerDrafts[pid];
    const defEp = DEFAULT_PROVIDER_ENDPOINTS[pid];
    const rawHttp = (draft?.httpEndpoint ?? '').trim();
    const rawWs = (draft?.wsEndpoint ?? '').trim();
    const cleanedKey = trimAndNormalizeApiKey(draft?.apiKey);

    if (pid !== 'local' || rawHttp) {
      const httpCheck = validateHttpEndpoint(rawHttp, pid === 'local');
      if (!httpCheck.valid) {
        updateDraft(pid, { httpError: httpCheck.error });
        toast.error(httpCheck.error || 'Invalid HTTP endpoint URL');
        return;
      }
    }
    if (defEp.supportsWs) {
      const wsCheck = validateWsEndpoint(rawWs);
      if (!wsCheck.valid) {
        updateDraft(pid, { wsError: wsCheck.error });
        toast.error(wsCheck.error || 'Invalid WebSocket URL');
        return;
      }
    }

    setIsSaving(true);
    updateDraft(pid, { httpError: undefined, wsError: undefined, apiKey: cleanedKey });
    try {
      await saveProviderConfig({
        providerId: pid,
        apiKey: cleanedKey,
        clearApiKey: cleanedKey === '',
        baseUrl: rawHttp || defEp.httpEndpoint,
        wsEndpoint: defEp.supportsWs ? rawWs || defEp.wsEndpoint : '',
      });
      await loadConfig();
      toast.success(
        cleanedKey
          ? `Saved ${PROVIDER_METADATA[pid]?.name || pid} key (…${cleanedKey.slice(-4)}) & endpoints`
          : `Saved ${PROVIDER_METADATA[pid]?.name || pid} endpoints (key cleared)`
      );

      // Automatically run Test Connection on key save for networked providers
      if (pid !== 'local' && (cleanedKey || pid === 'ollama')) {
        await runTestConnectionForProvider(pid, cleanedKey, rawHttp || defEp.httpEndpoint, rawWs || defEp.wsEndpoint);
      }
    } catch (err: any) {
      toast.error(`Failed to save ${PROVIDER_METADATA[pid]?.name || pid}: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasteProviderKey = async (pid: ProviderId) => {
    try {
      const clipText = await navigator.clipboard.readText();
      const cleaned = trimAndNormalizeApiKey(clipText);
      if (!cleaned) {
        toast.info('Clipboard is empty');
        return;
      }
      updateDraft(pid, { apiKey: cleaned });
      toast.success(`Pasted key ending in …${cleaned.slice(-4)} — tap Save & Test to apply.`);
    } catch {
      toast.error('Clipboard access denied — paste manually into the key field.');
    }
  };

  const handleChatProviderChange = async (nextProviderId: string) => {
    setIsSaving(true);
    try {
      await saveProviderConfig({ activeProvider: nextProviderId });
      await loadConfig();
      toast.success(`Chat provider set to ${PROVIDER_METADATA[nextProviderId]?.name || nextProviderId}`);
    } catch (err: any) {
      toast.error(`Failed to switch Chat provider: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChatModelChange = async (nextModelId: string) => {
    setIsSaving(true);
    try {
      await saveProviderConfig({
        activeProvider: activeChatProvider,
        providerId: activeChatProvider,
        model: nextModelId,
        customModel: '',
      });
      await loadConfig();
      toast.success(`Chat model set to ${formatShortModelDisplayName(nextModelId)}`);
    } catch (err: any) {
      toast.error(`Failed to update Chat model: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleContentModeSelect = (mode: ContentMode) => {
    setContentMode(mode);
    toast.success(`Companion content mode set to: ${CONTENT_MODES[mode].name}`);
  };

  const handleSaveCustomDirectives = () => {
    persistCustomDirectives(customDirectives);
    toast.success('Custom companion directives saved!');
  };

  const handleExportBackup = () => {
    try {
      const jsonStr = exportLocalBackupData();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `sierra-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Local backup exported as JSON (API keys excluded)!');
    } catch (err: any) {
      toast.error(`Export failed: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const result = importLocalBackupData(text);
        refreshMemorySummaries(settings.activeIdentity);
        setCustomDirectives(getCustomDirectives());
        const configsMsg = result.configsCount ? `, ${result.configsCount} voice/persona configs` : '';
        toast.success(
          `Backup restored (${result.summariesCount} memory summaries, ${result.sessionsCount} chat sessions${configsMsg})!`
        );
      } catch (err: any) {
        toast.error(`Failed to import backup JSON: ${err?.message || 'Invalid file'}`);
      } finally {
        if (backupFileInputRef.current) {
          backupFileInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  const handleToggleBackgroundLive = async () => {
    const next = !bgLiveEnabled;
    if (next) {
      try {
        await SierraBackgroundVoice.checkAndRequestPermissions();
      } catch (_) {}
    }
    setBackgroundLiveEnabled(next);
    setBgLiveEnabledState(next);
    toast.success(
      next
        ? 'Background Live voice enabled — sessions will stay active when switching apps.'
        : 'Background Live voice disabled.'
    );
  };

  const handleRequestBatteryExemption = async () => {
    try {
      await SierraBackgroundVoice.requestBatteryOptimizationExemption();
      const check = await SierraBackgroundVoice.checkBatteryOptimization();
      setIgnoringBatteryOpt(Boolean(check?.isIgnoringBatteryOptimizations));
      toast.info('Opened Android battery optimization prompt.');
    } catch (err: any) {
      toast.error(`Could not open battery settings: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleImportPpnFile = (identity: CompanionIdentity, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.ppn')) {
      toast.error('Please select a valid Picovoice Porcupine (.ppn) keyword file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        saveStoredPpnKeyword(identity, file.name, base64);
        if (identity === 'sierra') {
          setSierraPpnFileState({ fileName: file.name, base64Data: base64 });
        } else {
          setTylerPpnFileState({ fileName: file.name, base64Data: base64 });
        }
        toast.success(`Imported ${file.name} for ${identity === 'tyler' ? 'Tyler' : 'Sierra'}!`);
        if (wakeWordEnabled) {
          await startWakeWordListener(getActiveIdentity());
        }
      } catch (err: any) {
        toast.error(`Failed to import .ppn file: ${err?.message || 'Invalid file'}`);
      } finally {
        if (sierraPpnInputRef.current) sierraPpnInputRef.current.value = '';
        if (tylerPpnInputRef.current) tylerPpnInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleToggleWakeWord = async () => {
    const next = !wakeWordEnabled;
    const activeId = getActiveIdentity();
    if (next) {
      try {
        await SierraBackgroundVoice.checkAndRequestPermissions();
      } catch (_) {}
      setWakeWordEnabled(true);
      setWakeWordEnabledState(true);
      const res = await startWakeWordListener(activeId);
      if (!res.started) {
        setWakeWordEnabled(false);
        setWakeWordEnabledState(false);
        toast.error(res.error || 'Wake word could not start — check setup instructions.');
        return;
      }
      toast.success(`Wake word listener active for ${activeId === 'tyler' ? 'Tyler' : 'Sierra'}`);
    } else {
      setWakeWordEnabled(false);
      setWakeWordEnabledState(false);
      await stopWakeWordListener();
      toast.info('Wake word listener stopped.');
    }
  };

  const handleImportGoogleCredentialsJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const parsed = parseGoogleCredentialsJson(text);
        if (!parsed) {
          toast.error('Invalid Google OAuth credentials JSON — missing client_id.');
          return;
        }
        setEmailFormProvider('gmail');
        setEmailFormClientId(parsed.clientId);
        setEmailFormRedirectUri(parsed.redirectUri);
        toast.success(`Imported Google OAuth Client ID (${parsed.clientId.slice(0, 18)}...)`);
      } catch (err: any) {
        toast.error(`Failed to read Google credentials JSON: ${err?.message || 'Invalid file'}`);
      } finally {
        if (googleCredsFileInputRef.current) {
          googleCredsFileInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  const activeEngineHasSavedKey =
    activeChatProvider === 'ollama' ||
    activeChatProvider === 'local' ||
    Boolean(trimAndNormalizeApiKey(settings.providers[activeChatProvider]?.apiKey)) ||
    Boolean(config?.providers[activeChatProvider]?.hasKey);

  // Unified Chat Model Dropdown Options (Single Source of Truth)
  const chatProviderModels = activeChatMeta?.models || [];
  const activeChatCustomModel = settings.chatProviders[activeChatProvider]?.customModel || '';

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-[#0A0E14] overflow-hidden">
      {/* Stationary Top Header + 4-Card Nav Bar */}
      <div className="shrink-0 relative z-30 bg-[#0A0E14] border-b border-[#C8CDD3]/15 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
        <div
          className="px-4 sm:px-6 md:px-8 pb-4 border-b border-[#C8CDD3]/10 bg-[#0A0E14] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          style={{ paddingTop: 'max(20px, env(safe-area-inset-top))' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center border"
              style={{
                backgroundColor: `rgba(${accentRgb}, 0.14)`,
                borderColor: `rgba(${accentRgb}, 0.4)`,
                color: accentHex,
                boxShadow: `0 0 18px rgba(${accentRgb}, 0.18)`,
              }}
            >
              <SettingsIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-display font-bold tracking-tight text-white">
                System &amp; AI Settings
              </h1>
              <p className="text-xs text-[#C8CDD3]/70 mt-0.5">
                Single source of truth for providers, models, voice, persona, and backups.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 sci-card bg-[#0F1520]/90 border border-[#C8CDD3]/15 rounded-xl px-4 py-2.5">
            <div
              className="w-2.5 h-2.5 rounded-full animate-pulse"
              style={{
                backgroundColor: activeEngineHasSavedKey ? accentHex : '#f59e0b',
                boxShadow: `0 0 8px ${activeEngineHasSavedKey ? accentHex : '#f59e0b'}`,
              }}
            />
            <div className="text-left">
              <div className="text-[10px] uppercase font-bold text-[#C8CDD3]/60 tracking-wider">
                Active Chat Engine
              </div>
              <div className="text-xs font-semibold text-white">
                {activeChatMeta?.name || activeChatProvider} ·{' '}
                <span style={{ color: accentHex }}>
                  {formatShortModelDisplayName(activeChatModelValue)}
                </span>
              </div>
            </div>
            {onNavigateToChat && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onNavigateToChat}
                className="min-h-[44px] text-xs ml-2 text-[#C8CDD3] hover:text-white rounded-xl px-3"
              >
                Chat <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            )}
          </div>
        </div>

        {/* 4-Card Section Quick Jump Bar */}
        <div
          data-testid="settings-section-nav"
          className="px-4 sm:px-6 md:px-8 pt-2.5 pb-2.5 flex items-center gap-2 overflow-x-auto bg-[#0A0E14]"
        >
          {([
            { id: 'providers' as const, label: '1. Providers' },
            { id: 'models' as const, label: '2. Models' },
            { id: 'persona' as const, label: '3. Voice & Persona' },
            { id: 'backup' as const, label: '4. Content Mode & Backup' },
          ]).map((sec) => {
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                data-testid={`settings-nav-${sec.id}`}
                onClick={() => jumpToSection(sec.id)}
                style={
                  isActive
                    ? {
                        backgroundColor: `rgba(${accentRgb}, 0.16)`,
                        borderColor: `rgba(${accentRgb}, 0.45)`,
                        color: accentHex,
                        boxShadow: `0 0 14px rgba(${accentRgb}, 0.18)`,
                      }
                    : undefined
                }
                className={cn(
                  'min-h-[44px] px-4 py-2 text-xs font-display font-bold uppercase tracking-wider rounded-xl border transition-all whitespace-nowrap shrink-0',
                  isActive
                    ? ''
                    : 'text-[#C8CDD3]/75 hover:text-white hover:bg-[#131A26] border-transparent'
                )}
              >
                {sec.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Body Pane */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div
          className="p-4 sm:p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-5 pb-24"
          data-tick={voiceSettingsTick}
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-16 gap-3 text-[#C8CDD3]/65">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: accentHex }} />
              <span className="text-sm">Loading settings...</span>
            </div>
          ) : (
            <>
              {/* ===============================================================
                  CARD 1: PROVIDERS (Expandable card per provider)
                 =============================================================== */}
              <section
                id="settings-section-providers"
                data-testid="settings-section-providers"
                className="scroll-mt-4"
              >
                <Card className="sci-card bg-[#0F1520]/90 border-[#C8CDD3]/15 rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    data-testid="settings-card-toggle-providers"
                    onClick={() => toggleCard('providers')}
                    className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Key className="w-5 h-5 shrink-0" style={{ color: accentHex }} />
                      <div>
                        <div className="text-base font-display font-bold text-white uppercase tracking-wider">
                          1. Providers
                        </div>
                        <p className="text-xs text-[#C8CDD3]/70">
                          API keys, HTTP &amp; WebSocket endpoints, enable toggles, and live connection tests.
                        </p>
                      </div>
                    </div>
                    {expandedCards.providers ? (
                      <ChevronUp className="w-5 h-5 text-[#C8CDD3]/70 shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[#C8CDD3]/70 shrink-0" />
                    )}
                  </button>

                  {expandedCards.providers && (
                    <CardContent className="px-5 pb-5 pt-1 space-y-3 border-t border-[#C8CDD3]/10">
                      {ALL_PROVIDER_IDS.map((pid) => {
                        const meta = PROVIDER_METADATA[pid];
                        const defEp = DEFAULT_PROVIDER_ENDPOINTS[pid];
                        const stored = settings.providers[pid];
                        const draft = providerDrafts[pid] || {
                          apiKey: stored?.apiKey || '',
                          httpEndpoint: stored?.httpEndpoint || defEp.httpEndpoint,
                          wsEndpoint: stored?.wsEndpoint || defEp.wsEndpoint,
                          showKey: false,
                        };
                        const isOpen = expandedProviderId === pid;
                        const cleanedKey = trimAndNormalizeApiKey(stored?.apiKey);
                        const hasKey = Boolean(cleanedKey) || Boolean(config?.providers?.[pid]?.hasKey);
                        const isEnabled = stored?.enabled !== false;

                        return (
                          <div
                            key={pid}
                            data-testid={`provider-card-${pid}`}
                            className={cn(
                              'rounded-xl border transition-colors overflow-hidden',
                              isOpen
                                ? 'bg-[#0A0E14] border-cyan-400/40'
                                : 'bg-[#0A0E14]/70 border-[#C8CDD3]/15 hover:border-[#C8CDD3]/30'
                            )}
                          >
                            {/* Provider Row Header */}
                            <div className="px-4 py-3 flex items-center justify-between gap-3">
                              <button
                                type="button"
                                data-testid={`provider-expand-${pid}`}
                                onClick={() => setExpandedProviderId(pid)}
                                className="flex-1 min-w-0 flex items-center gap-3 text-left"
                              >
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{
                                    backgroundColor:
                                      !isEnabled
                                        ? '#64748b'
                                        : !defEp.requiresApiKey || hasKey
                                          ? '#34d399'
                                          : '#f59e0b',
                                  }}
                                />
                                <div className="min-w-0">
                                  <div className="text-sm font-display font-bold text-white flex items-center gap-2 flex-wrap">
                                    <span>{meta?.name || pid}</span>
                                    {activeChatProvider === pid && (
                                      <span
                                        className="text-[10px] px-2 py-0.5 rounded-full border font-semibold"
                                        style={{
                                          borderColor: `rgba(${accentRgb}, 0.5)`,
                                          backgroundColor: `rgba(${accentRgb}, 0.14)`,
                                          color: accentHex,
                                        }}
                                      >
                                        Chat Active
                                      </span>
                                    )}
                                    {liveProvider === pid && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 font-semibold">
                                        Live Active
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] font-mono text-[#C8CDD3]/65 truncate">
                                    {pid === 'local'
                                      ? 'On-device GGUF LLM + Whisper STT + Piper/Android TTS'
                                      : defEp.requiresApiKey
                                        ? hasKey
                                          ? `Key …${cleanedKey.slice(-4) || 'saved'} • ${stored?.httpEndpoint || defEp.httpEndpoint}`
                                          : `No key set • ${stored?.httpEndpoint || defEp.httpEndpoint}`
                                        : stored?.httpEndpoint || defEp.httpEndpoint}
                                  </div>
                                </div>
                              </button>

                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  data-testid={`provider-enabled-toggle-${pid}`}
                                  onClick={() => {
                                    const nextEnabled = !isEnabled;
                                    updateSettings((d) => {
                                      d.providers[pid].enabled = nextEnabled;
                                      return d;
                                    });
                                    toast.info(`${meta?.name || pid} ${nextEnabled ? 'enabled' : 'disabled'}`);
                                  }}
                                  className={cn(
                                    'min-h-[36px] px-2.5 rounded-lg border text-[11px] font-bold transition-colors',
                                    isEnabled
                                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                      : 'bg-[#0F1520] border-[#C8CDD3]/20 text-[#C8CDD3]/60'
                                  )}
                                >
                                  {isEnabled ? 'Enabled' : 'Disabled'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setExpandedProviderId(pid)}
                                  className="p-2 text-[#C8CDD3]/70 hover:text-white"
                                  aria-label={`Toggle ${meta?.name || pid}`}
                                >
                                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>

                            {/* Provider Card Body */}
                            {isOpen && (
                              <div className="px-4 pb-4 pt-3 border-t border-[#C8CDD3]/10 space-y-4">
                                {pid === 'local' ? (
                                  <div className="space-y-3">
                                    <p className="text-xs text-[#C8CDD3]/80 leading-relaxed">
                                      On-Phone Local runs Whisper STT, Silero VAD, and local GGUF models directly on Android — no API key or remote URL required.
                                    </p>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => jumpToSection('models')}
                                      className="border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/10 text-xs rounded-xl"
                                    >
                                      Configure Local Models in Section 2
                                    </Button>
                                  </div>
                                ) : (
                                  <>
                                    {/* API Key Input (shown for providers with keys) */}
                                    {(defEp.requiresApiKey || pid === 'custom') && (
                                      <div className="space-y-1.5">
                                        <div className="flex items-center justify-between gap-2">
                                          <label className="text-[11px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider">
                                            API Key {defEp.requiresApiKey ? '(Required)' : '(Optional)'}
                                          </label>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              data-testid={`provider-paste-key-${pid}`}
                                              onClick={() => void handlePasteProviderKey(pid)}
                                              className="text-[11px] text-cyan-400 hover:underline inline-flex items-center gap-1"
                                            >
                                              <ClipboardPaste className="w-3 h-3" /> Paste
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => updateDraft(pid, { apiKey: '' })}
                                              className="text-[11px] text-[#C8CDD3]/65 hover:text-white"
                                            >
                                              Reset to default
                                            </button>
                                          </div>
                                        </div>
                                        <div className="relative">
                                          <Input
                                            data-testid={`provider-api-key-input-${pid}`}
                                            type={draft.showKey ? 'text' : 'password'}
                                            value={draft.apiKey}
                                            onChange={(e) => updateDraft(pid, { apiKey: e.target.value })}
                                            placeholder={
                                              pid === 'openrouter'
                                                ? 'sk-or-v1-... (shared across Live, Chat & TTS)'
                                                : `Enter ${meta?.name || pid} API key...`
                                            }
                                            className="bg-[#0F1520] border-[#C8CDD3]/20 text-white rounded-xl h-11 pr-10 font-mono text-xs"
                                          />
                                          <button
                                            type="button"
                                            aria-label={draft.showKey ? 'Hide API key' : 'Show API key'}
                                            onClick={() => updateDraft(pid, { showKey: !draft.showKey })}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#C8CDD3]/55 hover:text-white"
                                          >
                                            {draft.showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {/* HTTP Endpoint URL */}
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <label className="text-[11px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider">
                                          HTTP Endpoint URL
                                        </label>
                                        <button
                                          type="button"
                                          data-testid={`provider-reset-http-${pid}`}
                                          onClick={() =>
                                            updateDraft(pid, {
                                              httpEndpoint: defEp.httpEndpoint,
                                              httpError: undefined,
                                            })
                                          }
                                          className="text-[11px] text-cyan-400 hover:underline"
                                        >
                                          Reset to default
                                        </button>
                                      </div>
                                      <Input
                                        data-testid={`provider-http-endpoint-input-${pid}`}
                                        value={draft.httpEndpoint}
                                        onChange={(e) =>
                                          updateDraft(pid, {
                                            httpEndpoint: e.target.value,
                                            httpError: undefined,
                                          })
                                        }
                                        placeholder={defEp.httpEndpoint}
                                        className="bg-[#0F1520] border-[#C8CDD3]/20 text-white rounded-xl h-10 font-mono text-xs"
                                      />
                                      {draft.httpError && (
                                        <p
                                          data-testid={`provider-http-error-${pid}`}
                                          className="text-xs text-red-400 font-medium"
                                        >
                                          {draft.httpError}
                                        </p>
                                      )}
                                    </div>

                                    {/* WebSocket URL (ONLY rendered when provider supports WebSockets) */}
                                    {defEp.supportsWs && (
                                      <div
                                        className="space-y-1.5"
                                        data-testid={`provider-ws-field-${pid}`}
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <label className="text-[11px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider">
                                            WebSocket URL
                                          </label>
                                          <button
                                            type="button"
                                            data-testid={`provider-reset-ws-${pid}`}
                                            onClick={() =>
                                              updateDraft(pid, {
                                                wsEndpoint: defEp.wsEndpoint,
                                                wsError: undefined,
                                              })
                                            }
                                            className="text-[11px] text-cyan-400 hover:underline"
                                          >
                                            Reset to default
                                          </button>
                                        </div>
                                        <Input
                                          data-testid={`provider-ws-endpoint-input-${pid}`}
                                          value={draft.wsEndpoint}
                                          onChange={(e) =>
                                            updateDraft(pid, {
                                              wsEndpoint: e.target.value,
                                              wsError: undefined,
                                            })
                                          }
                                          placeholder={defEp.wsEndpoint}
                                          className="bg-[#0F1520] border-[#C8CDD3]/20 text-white rounded-xl h-10 font-mono text-xs"
                                        />
                                        {draft.wsError && (
                                          <p
                                            data-testid={`provider-ws-error-${pid}`}
                                            className="text-xs text-red-400 font-medium"
                                          >
                                            {draft.wsError}
                                          </p>
                                        )}
                                      </div>
                                    )}

                                    {/* Test Connection Result Banner */}
                                    {draft.testResult && (
                                      <div
                                        data-testid={`provider-test-result-${pid}`}
                                        className={cn(
                                          'p-3 rounded-xl border text-xs flex items-start gap-2',
                                          draft.testResult.success
                                            ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300'
                                            : 'bg-red-500/10 border-red-500/35 text-red-300'
                                        )}
                                      >
                                        {draft.testResult.success ? (
                                          <Check className="w-4 h-4 shrink-0 mt-0.5" />
                                        ) : (
                                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <div className="font-semibold">
                                            {draft.testResult.success ? 'Connection Verified' : 'Connection Failed'}
                                            {typeof draft.testResult.status === 'number' && draft.testResult.status > 0
                                              ? ` (HTTP ${draft.testResult.status})`
                                              : ''}
                                            {draft.testResult.latencyMs ? ` • ${draft.testResult.latencyMs}ms` : ''}
                                          </div>
                                          <div className="text-[11px] opacity-90 break-words">
                                            {draft.testResult.message || draft.testResult.error}
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        data-testid={`test-connection-${pid}`}
                                        disabled={Boolean(draft.isTesting)}
                                        onClick={() => void runTestConnectionForProvider(pid)}
                                        className="min-h-[44px] border-[#C8CDD3]/25 hover:bg-[#151E2E] text-slate-200 px-3.5 rounded-xl gap-1.5 text-xs"
                                      >
                                        {draft.isTesting ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <Radio className="w-3.5 h-3.5 text-cyan-400" />
                                        )}
                                        Test connection
                                      </Button>
                                      <Button
                                        type="button"
                                        data-testid={`provider-save-btn-${pid}`}
                                        disabled={isSaving}
                                        onClick={() => void handleSaveProviderCard(pid)}
                                        style={{ backgroundColor: accentHex, color: '#05080D' }}
                                        className="min-h-[44px] font-bold text-xs px-4 rounded-xl hover:opacity-90"
                                      >
                                        Save Key &amp; Endpoints
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  )}
                </Card>
              </section>

              {/* ===============================================================
                  CARD 2: MODELS (Chat Provider/Model + Live Provider/Model + Local/STT)
                 =============================================================== */}
              <section
                id="settings-section-models"
                data-testid="settings-section-models"
                className="scroll-mt-4"
              >
                <Card className="sci-card bg-[#0F1520]/90 border-[#C8CDD3]/15 rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    data-testid="settings-card-toggle-models"
                    onClick={() => toggleCard('models')}
                    className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Cpu className="w-5 h-5 shrink-0" style={{ color: accentHex }} />
                      <div>
                        <div className="text-base font-display font-bold text-white uppercase tracking-wider">
                          2. Models
                        </div>
                        <p className="text-xs text-[#C8CDD3]/70">
                          Chat &amp; Live provider and model selection, audio output, barge-in gate, and TTS/STT engines.
                        </p>
                      </div>
                    </div>
                    {expandedCards.models ? (
                      <ChevronUp className="w-5 h-5 text-[#C8CDD3]/70 shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[#C8CDD3]/70 shrink-0" />
                    )}
                  </button>

                  {expandedCards.models && (
                    <CardContent className="px-5 pb-5 pt-4 border-t border-[#C8CDD3]/10 space-y-6">
                      {/* Chat Provider & Chat Text Model */}
                      <div className="space-y-3 bg-[#0A0E14]/80 p-4 rounded-xl border border-[#C8CDD3]/15">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-display font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <MessageCircle className="w-4 h-4" style={{ color: accentHex }} />
                            Text Chat Engine
                          </div>
                          <span className="text-[11px] font-mono text-cyan-300 truncate">
                            {activeChatProvider} · {activeChatModelValue}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                              Chat Provider
                            </label>
                            <select
                              data-testid="settings-chat-provider-select"
                              value={activeChatProvider}
                              onChange={(e) => void handleChatProviderChange(e.target.value)}
                              className="w-full bg-[#0F1520] border border-[#C8CDD3]/20 text-white rounded-xl h-10 px-3 text-xs"
                            >
                              {ALL_PROVIDER_IDS.map((pid) => (
                                <option key={pid} value={pid}>
                                  {PROVIDER_METADATA[pid]?.name || pid}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                              Chat Text Model
                            </label>
                            <select
                              data-testid={
                                activeChatProvider === 'openrouter'
                                  ? 'settings-openrouter-chat-model-select'
                                  : 'settings-chat-model-select'
                              }
                              value={activeChatModelValue}
                              onChange={(e) => void handleChatModelChange(e.target.value)}
                              className="w-full bg-[#0F1520] border border-[#C8CDD3]/20 text-white rounded-xl h-10 px-3 text-xs"
                            >
                              {activeChatProvider === 'openrouter' && (
                                <option value={OPENROUTER_DEFAULT_PAID_MODEL}>
                                  Dolphin Mistral 24B Venice (Paid Default)
                                </option>
                              )}
                              {chatProviderModels
                                .filter(
                                  (m) =>
                                    m.id !== OPENROUTER_DEFAULT_PAID_MODEL &&
                                    m.id !== 'custom-model' &&
                                    m.id !== 'custom-ollama' &&
                                    !isGeminiLiveModel(m.id)
                                )
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.id.endsWith(':free')
                                      ? formatOpenRouterFreeModelLabel(m.name)
                                      : m.name}
                                  </option>
                                ))}
                              {activeChatProvider === 'openrouter' &&
                                openRouterFreeModels
                                  .filter((fm) => !chatProviderModels.some((m) => m.id === fm.id))
                                  .map((fm) => (
                                    <option key={fm.id} value={fm.id}>
                                      {formatOpenRouterFreeModelLabel(fm.name)} ({fm.id}) [FREE]
                                    </option>
                                  ))}
                              {activeChatModelValue &&
                                !chatProviderModels.some((m) => m.id === activeChatModelValue) &&
                                !openRouterFreeModels.some((fm) => fm.id === activeChatModelValue) &&
                                activeChatModelValue !== OPENROUTER_DEFAULT_PAID_MODEL && (
                                  <option value={activeChatModelValue}>
                                    {activeChatModelValue} (Custom)
                                  </option>
                                )}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                          <div>
                            <label className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                              Custom Chat Model ID ({activeChatMeta?.name || activeChatProvider})
                            </label>
                            <Input
                              data-testid="settings-chat-custom-model-input"
                              placeholder="Optional custom model slug"
                              value={activeChatCustomModel}
                              onChange={(e) => {
                                void saveProviderConfig({
                                  activeProvider: activeChatProvider,
                                  providerId: activeChatProvider,
                                  customModel: e.target.value,
                                });
                              }}
                              className="bg-[#0F1520] border-[#C8CDD3]/20 text-white rounded-xl h-10 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                              Response Speed / Thinking Budget
                            </label>
                            <div className="grid grid-cols-3 gap-1.5">
                              {(['low', 'medium', 'high'] as ResponseSpeedLevel[]).map((lvl) => (
                                <button
                                  key={lvl}
                                  type="button"
                                  onClick={() => setResponseSpeed(lvl)}
                                  style={
                                    responseSpeed === lvl
                                      ? {
                                          backgroundColor: `rgba(${accentRgb}, 0.16)`,
                                          borderColor: accentHex,
                                          color: accentHex,
                                        }
                                      : undefined
                                  }
                                  className={cn(
                                    'h-10 rounded-xl text-xs font-semibold uppercase border transition-all',
                                    responseSpeed === lvl
                                      ? ''
                                      : 'bg-[#0F1520] border-[#C8CDD3]/20 text-[#C8CDD3]/75 hover:text-white'
                                  )}
                                >
                                  {lvl}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Live Provider & Live Model */}
                      <div className="space-y-4 bg-[#0A0E14]/80 p-4 rounded-xl border border-[#C8CDD3]/15">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-xs font-display font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Radio className="w-4 h-4" style={{ color: accentHex }} />
                            Live Voice Engine
                          </div>
                          {liveProvider === 'openrouter' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                fetchOpenRouterFreeModels(true)
                                  .then((models) => {
                                    setOpenRouterFreeModels(models);
                                    toast.success(`Refreshed ${models.length} OpenRouter free models`);
                                  })
                                  .catch(() => toast.error('Could not refresh OpenRouter free models'));
                              }}
                              className="h-8 px-2.5 text-[11px] border-[#C8CDD3]/20 text-[#C8CDD3]"
                            >
                              <RefreshCw className="w-3 h-3 mr-1" /> Refresh Free Models
                            </Button>
                          )}
                        </div>

                        <div
                          className="grid grid-cols-1 md:grid-cols-2 gap-4"
                          data-testid="settings-live-voice-model-section"
                        >
                          <div>
                            <label className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                              Live Provider
                            </label>
                            <select
                              data-testid="settings-live-provider-select"
                              value={liveProvider}
                              onChange={(e) => {
                                const next = setLiveVoiceProvider(e.target.value as LiveVoiceProviderId);
                                toast.success(`Live provider set to ${next}`);
                              }}
                              className="w-full bg-[#0F1520] border border-[#C8CDD3]/20 text-white rounded-xl h-10 px-3 text-xs"
                            >
                              <option value="gemini">Gemini Live (Cloud)</option>
                              <option value="openrouter">OpenRouter (Cloud Uncensored)</option>
                              <option value="local">Local (On-Phone)</option>
                            </select>
                          </div>

                          {liveProvider === 'gemini' ? (
                            <div>
                              <label className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                                Live Voice Model (Default: <code className="text-cyan-300">{DEFAULT_LIVE_MODEL}</code>)
                              </label>
                              <select
                                data-testid="settings-live-voice-model-trigger"
                                value={liveVoiceModel}
                                onChange={(e) => {
                                  setStoredLiveModel(e.target.value);
                                  toast.success(`Live voice model set to ${e.target.value}`);
                                }}
                                className="w-full bg-[#0F1520] border border-[#C8CDD3]/20 text-white rounded-xl h-10 px-3 text-xs"
                              >
                                {LIVE_MODELS.map((m) => {
                                  const supportsTools = doesModelSupportFunctionCalling(m.id);
                                  return (
                                    <option key={m.id} value={m.id}>
                                      {m.label}{!supportsTools ? ' — no tool support' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          ) : liveProvider === 'openrouter' ? (
                            <div>
                              <label className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                                OpenRouter Live Model
                              </label>
                              <select
                                data-testid="settings-openrouter-live-model-select"
                                value={openRouterLiveSlug}
                                onChange={(e) => {
                                  const nextSlug = e.target.value;
                                  saveOpenRouterModelSettings({
                                    selectedModel: nextSlug,
                                    customSlug: '',
                                    customModelSlug: '',
                                    tryFreeFirst: false,
                                  });
                                  toast.success(`OpenRouter Live model set to ${nextSlug}`);
                                }}
                                className="w-full bg-[#0F1520] border border-[#C8CDD3]/20 text-white rounded-xl h-10 px-3 text-xs"
                              >
                                <option value={OPENROUTER_DEFAULT_PAID_MODEL}>
                                  Dolphin Mistral 24B Venice (Paid Default)
                                </option>
                                {PROVIDER_METADATA.openrouter.models
                                  .filter((m) => m.id !== OPENROUTER_DEFAULT_PAID_MODEL && m.id !== 'custom-model')
                                  .map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.id.endsWith(':free') ? formatOpenRouterFreeModelLabel(m.name) : m.name}
                                    </option>
                                  ))}
                                {openRouterFreeModels
                                  .filter((fm) => !PROVIDER_METADATA.openrouter.models.some((m) => m.id === fm.id))
                                  .map((fm) => (
                                    <option key={fm.id} value={fm.id}>
                                      {formatOpenRouterFreeModelLabel(fm.name)} ({fm.id}) [FREE]
                                    </option>
                                  ))}
                              </select>
                            </div>
                          ) : (
                            <div className="flex items-end">
                              <p className="text-xs text-[#C8CDD3]/70">
                                Local on-phone GGUF &amp; Whisper STT models are managed directly below.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Live Custom Model Slug + Extended Thinking */}
                        {liveProvider !== 'local' && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1">
                                Live Custom Model Slug
                              </label>
                              <Input
                                data-testid="settings-live-voice-custom-model-input"
                                placeholder={
                                  liveProvider === 'openrouter'
                                    ? 'e.g. nousresearch/hermes-3-llama-3.1-70b'
                                    : DEFAULT_LIVE_MODEL
                                }
                                value={liveProvider === 'openrouter' ? openRouterLiveCustomSlug : liveVoiceCustomModel}
                                onChange={(e) => {
                                  if (liveProvider === 'openrouter') {
                                    saveOpenRouterModelSettings({
                                      customSlug: e.target.value,
                                      customModelSlug: e.target.value,
                                    });
                                  } else {
                                    setStoredLiveCustomModel(e.target.value);
                                  }
                                }}
                                className="bg-[#0F1520] border-[#C8CDD3]/20 text-white rounded-xl h-10 text-xs font-mono"
                              />
                            </div>

                            {liveProvider === 'gemini' &&
                              isGeminiLiveExtendedThinkingModel(liveVoiceCustomModel.trim() || liveVoiceModel) && (
                                <div>
                                  <label
                                    htmlFor="thinking-level-select"
                                    className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider block mb-1"
                                  >
                                    Thinking Level (Extended Thinking)
                                  </label>
                                  <select
                                    id="thinking-level-select"
                                    data-testid="thinking-level-select"
                                    value={thinkingLevel}
                                    onChange={(e) => setGeminiThinkingLevel(validateThinkingLevel(e.target.value))}
                                    className="w-full bg-[#0F1520] border border-[#C8CDD3]/20 text-white rounded-xl h-10 px-3 text-xs"
                                  >
                                    <option value="LOW">LOW</option>
                                    <option value="MEDIUM">MEDIUM</option>
                                    <option value="HIGH">HIGH</option>
                                  </select>
                                </div>
                              )}
                          </div>
                        )}

                        {/* Audio Output Mode & Barge-In Sensitivity */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#C8CDD3]/10">
                          <div>
                            <div className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider mb-1.5">
                              Audio Output Mode
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {(['speaker', 'headphones'] as AudioOutputMode[]).map((mode) => (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => {
                                    setAudioOutputMode(mode);
                                    toast.success(`Audio output set to ${mode}`);
                                  }}
                                  style={
                                    audioOutputMode === mode
                                      ? { backgroundColor: accentHex, color: '#05080D' }
                                      : undefined
                                  }
                                  className={cn(
                                    'min-h-[40px] rounded-xl text-xs font-bold capitalize border transition-all',
                                    audioOutputMode === mode
                                      ? 'border-transparent'
                                      : 'bg-[#0F1520] border-[#C8CDD3]/20 text-[#C8CDD3]/75 hover:text-white'
                                  )}
                                >
                                  {mode}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider mb-1.5">
                              Barge-In Sensitivity (Mic RMS Gate)
                            </div>
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
                                  style={
                                    bargeInSensitivity === sens
                                      ? {
                                          backgroundColor: `rgba(${accentRgb}, 0.16)`,
                                          borderColor: accentHex,
                                          color: accentHex,
                                        }
                                      : undefined
                                  }
                                  className={cn(
                                    'min-h-[40px] rounded-xl text-[11px] font-semibold uppercase border transition-all',
                                    bargeInSensitivity === sens
                                      ? ''
                                      : 'bg-[#0F1520] border-[#C8CDD3]/20 text-[#C8CDD3]/75 hover:text-white'
                                  )}
                                >
                                  {sens === 'low' ? 'Low' : sens === 'medium' ? 'Med' : 'High'}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-[#C8CDD3]/10 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider">
                              Barge-in Mode
                            </span>
                            <span className="text-[10px] text-[#C8CDD3]/60">
                              Adaptive: instant on headset; speaker needs VAD ≥ 0.85 &amp; RMS &gt; max(0.20, 2×playback) for ≥ 400ms
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(
                              [
                                { id: 'adaptive', label: 'Adaptive' },
                                { id: 'headphones_only', label: 'Headphones only' },
                                { id: 'off', label: 'Off' },
                              ] as Array<{ id: BargeInModeSetting; label: string }>
                            ).map((opt) => {
                              const isSelected =
                                bargeInMode === opt.id || (opt.id === 'adaptive' && bargeInMode === 'on');
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  data-testid={`settings-barge-in-mode-${opt.id}`}
                                  onClick={() => {
                                    updateSettings((draft) => {
                                      draft.live.local.bargeInMode = opt.id;
                                      return draft;
                                    });
                                    toast.success(`Barge-in set to ${opt.label}`);
                                  }}
                                  style={
                                    isSelected
                                      ? {
                                          backgroundColor: `rgba(${accentRgb}, 0.16)`,
                                          borderColor: accentHex,
                                          color: accentHex,
                                        }
                                      : undefined
                                  }
                                  className={cn(
                                    'min-h-[40px] rounded-xl text-[11px] font-semibold border transition-all px-2',
                                    isSelected
                                      ? ''
                                      : 'bg-[#0F1520] border-[#C8CDD3]/20 text-[#C8CDD3]/75 hover:text-white'
                                  )}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Mic Source & Last-10 Utterances Capture */}
                        <div className="pt-2 border-t border-[#C8CDD3]/10 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-bold text-[#C8CDD3]/75 uppercase tracking-wider">
                                Mic Source (AEC Always On)
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              {(
                                [
                                  { id: 'auto', label: 'Auto' },
                                  { id: 'communication', label: 'Communication' },
                                  { id: 'recognition', label: 'Recognition' },
                                ] as Array<{ id: MicSourceSetting; label: string }>
                              ).map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  data-testid={`settings-mic-source-${opt.id}`}
                                  onClick={() => {
                                    updateSettings((draft) => {
                                      draft.live.local.micSource = opt.id;
                                      return draft;
                                    });
                                    toast.success(`Mic source set to ${opt.label}`);
                                  }}
                                  style={
                                    micSource === opt.id
                                      ? {
                                          backgroundColor: `rgba(${accentRgb}, 0.16)`,
                                          borderColor: accentHex,
                                          color: accentHex,
                                        }
                                      : undefined
                                  }
                                  className={cn(
                                    'min-h-[40px] rounded-xl text-[11px] font-semibold border transition-all px-2',
                                    micSource === opt.id
                                      ? ''
                                      : 'bg-[#0F1520] border-[#C8CDD3]/20 text-[#C8CDD3]/75 hover:text-white'
                                  )}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            <p className="text-[10px] text-[#C8CDD3]/60 mt-1">
                              Auto uses VOICE_RECOGNITION (6) on speaker and VOICE_COMMUNICATION (7) with headset.
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-3 bg-[#0F1520]/80 p-3 rounded-xl border border-[#C8CDD3]/15">
                            <div>
                              <div className="text-xs font-semibold text-white">Save last 10 utterances</div>
                              <div className="text-[10px] text-[#C8CDD3]/65">
                                Record 16 kHz PCM clips on-device for STT inspection in Debug Logs
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              data-testid="settings-save-last-10-utterances-toggle"
                              checked={saveLast10Utterances}
                              onChange={(e) => {
                                const enabled = e.target.checked;
                                updateSettings((draft) => {
                                  draft.live.local.saveLast10Utterances = enabled;
                                  return draft;
                                });
                                toast.success(enabled ? 'Saving last 10 STT utterances' : 'STT clip saving disabled');
                              }}
                              className="w-5 h-5 accent-cyan-400 rounded cursor-pointer shrink-0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Text Chat Speech (TTS Provider) */}
                      <div className="space-y-3 bg-[#0A0E14]/80 p-4 rounded-xl border border-[#C8CDD3]/15">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-xs font-display font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Volume2 className="w-4 h-4" style={{ color: accentHex }} />
                            Text-to-Speech (TTS Provider)
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              data-testid="settings-tts-provider-select"
                              value={ttsProvider}
                              onChange={(e) => {
                                const next = setSelectedVoiceProvider(e.target.value as 'native' | 'openrouter');
                                setTtsProviderState(next);
                                toast.success(`TTS provider set to ${next}`);
                              }}
                              className="bg-[#0F1520] border border-[#C8CDD3]/20 text-white rounded-xl h-9 px-3 text-xs"
                            >
                              <option value="native">Native Device TTS</option>
                              <option value="openrouter">OpenRouter Voice (HeyGen)</option>
                            </select>
                            <Button
                              type="button"
                              size="sm"
                              variant={chatSpeechEnabled ? 'default' : 'outline'}
                              onClick={() => {
                                const next = !chatSpeechEnabled;
                                setChatSpeechEnabledState(next);
                                setChatSpeechEnabled(next);
                                if (!next) stopSpeaking('Disabled in Settings');
                              }}
                              style={
                                chatSpeechEnabled
                                  ? {
                                      backgroundColor: `rgba(${accentRgb}, 0.16)`,
                                      borderColor: accentHex,
                                      color: accentHex,
                                    }
                                  : undefined
                              }
                              className="h-9 text-xs px-3 rounded-xl border"
                            >
                              {chatSpeechEnabled ? 'Spoken Replies: ON' : 'Spoken Replies: OFF'}
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1 bg-[#0F1520]/80 p-3 rounded-xl border border-[#C8CDD3]/15">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium text-[#C8CDD3]">Pitch</span>
                              <span className="font-mono text-cyan-300">{ttsPitch.toFixed(2)}x</span>
                            </div>
                            <input
                              type="range"
                              min="0.5"
                              max="1.8"
                              step="0.05"
                              value={ttsPitch}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setTtsPitchState(val);
                                setTtsPitch(val);
                              }}
                              className="w-full accent-cyan-400 cursor-pointer"
                            />
                          </div>
                          <div className="space-y-1 bg-[#0F1520]/80 p-3 rounded-xl border border-[#C8CDD3]/15">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium text-[#C8CDD3]">Speed / Rate</span>
                              <span className="font-mono text-cyan-300">{ttsRate.toFixed(2)}x</span>
                            </div>
                            <input
                              type="range"
                              min="0.6"
                              max="1.8"
                              step="0.05"
                              value={ttsRate}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setTtsRateState(val);
                                setTtsRate(val);
                              }}
                              className="w-full accent-cyan-400 cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Local Model Manager & Whisper/Silero STT */}
                      <LocalVoiceSettingsCard />
                    </CardContent>
                  )}
                </Card>
              </section>

              {/* ===============================================================
                  CARD 3: VOICE & PERSONA (Identity Switcher, PersonaVoiceModal, Appearance)
                 =============================================================== */}
              <section
                id="settings-section-persona"
                data-testid="settings-section-persona"
                className="scroll-mt-4"
              >
                <Card className="sci-card bg-[#0F1520]/90 border-[#C8CDD3]/15 rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    data-testid="settings-card-toggle-persona"
                    onClick={() => toggleCard('persona')}
                    className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Sparkles className="w-5 h-5 shrink-0" style={{ color: accentHex }} />
                      <div>
                        <div className="text-base font-display font-bold text-white uppercase tracking-wider">
                          3. Voice &amp; Persona
                        </div>
                        <p className="text-xs text-[#C8CDD3]/70">
                          Sierra / Tyler identity switcher, persona lineup, live &amp; chat voice configurators, and accents.
                        </p>
                      </div>
                    </div>
                    {expandedCards.persona ? (
                      <ChevronUp className="w-5 h-5 text-[#C8CDD3]/70 shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[#C8CDD3]/70 shrink-0" />
                    )}
                  </button>

                  {expandedCards.persona && (
                    <CardContent className="px-5 pb-5 pt-4 border-t border-[#C8CDD3]/10 space-y-5">
                      {/* Identity Switcher + Active Persona Summary */}
                      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0A0E14]/80 p-4 rounded-xl border border-[#C8CDD3]/15">
                        <div className="space-y-2">
                          <div className="text-xs font-bold text-[#C8CDD3] uppercase tracking-wider">
                            Companion Identity
                          </div>
                          <div className="inline-flex items-center gap-2">
                            {(['sierra', 'tyler'] as CompanionIdentity[]).map((idKey) => {
                              const isSelected = settings.activeIdentity === idKey;
                              return (
                                <button
                                  key={idKey}
                                  type="button"
                                  data-testid={`settings-identity-${idKey}`}
                                  onClick={() => {
                                    setActiveIdentity(idKey);
                                    notifyIdentityChanged(idKey);
                                    toast.success(`Switched active companion to ${IDENTITIES[idKey].name}`);
                                  }}
                                  style={
                                    isSelected
                                      ? { backgroundColor: accentHex, color: '#05080D' }
                                      : undefined
                                  }
                                  className={cn(
                                    'min-h-[44px] px-4 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all',
                                    isSelected
                                      ? 'border-transparent'
                                      : 'bg-[#0F1520] border-[#C8CDD3]/20 text-[#C8CDD3] hover:text-white'
                                  )}
                                >
                                  <span>{IDENTITIES[idKey].avatar}</span>
                                  <span>{IDENTITIES[idKey].name}</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="text-xs text-[#C8CDD3]/75">
                            Active Persona:{' '}
                            <span className="font-semibold text-white">
                              {UNIFIED_PERSONAS[getActivePersonaId()]?.name}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            onClick={() => setActiveModalMode('persona')}
                            style={{ backgroundColor: accentHex, color: '#05080D' }}
                            className="min-h-[44px] font-bold text-xs px-4 rounded-xl hover:opacity-90"
                          >
                            Manage Persona
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setActiveModalMode('live-voice')}
                            className="min-h-[44px] border-[#C8CDD3]/25 text-white hover:bg-white/5 text-xs px-4 rounded-xl"
                          >
                            Live Voice ({getLiveVoiceConfig().voiceId})
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setActiveModalMode('chat-voice')}
                            className="min-h-[44px] border-[#C8CDD3]/25 text-white hover:bg-white/5 text-xs px-4 rounded-xl"
                          >
                            Chat Voice ({OPEN_VOICE_POOL.find((v) => v.id === getChatVoiceConfig().voiceId)?.name || getChatVoiceConfig().voiceId})
                          </Button>
                        </div>
                      </div>

                      {/* Assistant Accent Presets */}
                      <div className="space-y-3 bg-[#0A0E14]/80 p-4 rounded-xl border border-[#C8CDD3]/15">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-xs font-display font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Palette className="w-4 h-4" style={{ color: accentHex }} />
                            Assistant Accent Colors
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            data-testid="appearance-reset-btn"
                            onClick={() => {
                              resetAssistantAccents();
                              toast.success('Reset Sierra & Tyler accents to Electric Cyan (#00E5FF)');
                            }}
                            className="h-8 border-[#C8CDD3]/20 text-[#C8CDD3] hover:text-white rounded-lg text-xs gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Reset Both to #00E5FF
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {(['sierra', 'tyler'] as const).map((assistantId) => {
                            const idMeta = IDENTITIES[assistantId];
                            const colorVal = assistantId === 'tyler' ? accents.tyler : accents.sierra;
                            return (
                              <div
                                key={assistantId}
                                data-testid={`appearance-card-${assistantId}`}
                                className="p-3 rounded-xl bg-[#0F1520] border border-[#C8CDD3]/15 space-y-2.5"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-white">
                                    {idMeta.avatar} {idMeta.name}
                                  </span>
                                  <span className="text-[11px] font-mono" style={{ color: colorVal }}>
                                    {colorVal}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {ASSISTANT_ACCENT_PRESETS.map((preset) => {
                                    const isChosen = colorVal.toUpperCase() === preset.hex.toUpperCase();
                                    return (
                                      <button
                                        key={preset.id}
                                        type="button"
                                        aria-label={`${idMeta.name} ${preset.label}`}
                                        onClick={() => {
                                          setAccentColorForIdentity(assistantId, preset.hex);
                                          toast.success(`${idMeta.name} accent set to ${preset.label}`);
                                        }}
                                        className={cn(
                                          'min-h-[40px] min-w-[40px] rounded-xl border flex items-center justify-center transition-all',
                                          isChosen ? 'scale-105' : 'opacity-80 hover:opacity-100'
                                        )}
                                        style={{
                                          backgroundColor: '#0A0E14',
                                          borderColor: isChosen ? preset.hex : 'rgba(200, 205, 211, 0.2)',
                                        }}
                                      >
                                        <span
                                          className="w-4 h-4 rounded-full border border-white/25"
                                          style={{ backgroundColor: preset.hex }}
                                        />
                                      </button>
                                    );
                                  })}
                                  <label className="min-h-[40px] px-2.5 rounded-xl border border-[#C8CDD3]/20 bg-[#0A0E14] flex items-center gap-1.5 text-xs text-[#C8CDD3] cursor-pointer">
                                    <input
                                      type="color"
                                      aria-label={`${idMeta.name} custom color`}
                                      value={colorVal}
                                      onChange={(e) => setAccentColorForIdentity(assistantId, e.target.value)}
                                      className="w-5 h-5 bg-transparent border-0 cursor-pointer"
                                    />
                                    <span>Custom</span>
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </CardContent>
                  )}
                </Card>
              </section>

              {/* ===============================================================
                  CARD 4: CONTENT MODE & BACKUP (+ Collapsible Integrations & Logs)
                 =============================================================== */}
              <section
                id="settings-section-backup"
                data-testid="settings-section-backup"
                className="scroll-mt-4"
              >
                <Card className="sci-card bg-[#0F1520]/90 border-[#C8CDD3]/15 rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    data-testid="settings-card-toggle-backup"
                    onClick={() => toggleCard('backup')}
                    className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Flame className="w-5 h-5 text-rose-400 shrink-0" />
                      <div>
                        <div className="text-base font-display font-bold text-white uppercase tracking-wider">
                          4. Content Mode &amp; Backup
                        </div>
                        <p className="text-xs text-[#C8CDD3]/70">
                          SFW vs Mature 18+ mode, custom directives, JSON backup export/import, device permissions, and logs.
                        </p>
                      </div>
                    </div>
                    {expandedCards.backup ? (
                      <ChevronUp className="w-5 h-5 text-[#C8CDD3]/70 shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[#C8CDD3]/70 shrink-0" />
                    )}
                  </button>

                  {expandedCards.backup && (
                    <CardContent className="px-5 pb-5 pt-4 border-t border-[#C8CDD3]/10 space-y-6">
                      {/* SFW vs Mature 18+ Toggle */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div
                          data-testid="settings-content-mode-sfw"
                          onClick={() => handleContentModeSelect('sfw')}
                          className={cn(
                            'p-4 rounded-2xl border cursor-pointer transition-all space-y-2',
                            contentMode === 'sfw'
                              ? 'bg-cyan-500/12 border-cyan-400/50 shadow-lg ring-1 ring-cyan-400/20'
                              : 'bg-[#0A0E14]/70 border-[#C8CDD3]/15 hover:border-[#C8CDD3]/30'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <h4 className="font-display font-bold text-sm text-white">SFW Mode</h4>
                            {contentMode === 'sfw' && (
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/35">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#C8CDD3]/80 leading-relaxed">
                            Natural everyday conversation, coding, science, philosophy, and creative writing.
                          </p>
                        </div>

                        <div
                          data-testid="settings-content-mode-mature"
                          onClick={() => handleContentModeSelect('mature')}
                          className={cn(
                            'p-4 rounded-2xl border cursor-pointer transition-all space-y-2',
                            contentMode === 'mature'
                              ? 'bg-rose-950/25 border-rose-500/50 shadow-lg ring-1 ring-rose-500/20'
                              : 'bg-[#0A0E14]/70 border-[#C8CDD3]/15 hover:border-[#C8CDD3]/30'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <h4 className="font-display font-bold text-sm text-white">
                              Mature / Adult Mode (18+)
                            </h4>
                            {contentMode === 'mature' && (
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#C8CDD3]/80 leading-relaxed">
                            Adult discussions, flirtation, emotional intimacy, and consensual creative roleplay.
                          </p>
                        </div>
                      </div>

                      {/* Custom Directives */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-[#C8CDD3] uppercase tracking-wider flex items-center gap-1.5">
                          <MessageCircle className="w-3.5 h-3.5" style={{ color: accentHex }} />
                          Custom Companion Directives
                        </label>
                        <textarea
                          value={customDirectives}
                          onChange={(e) => setCustomDirectives(e.target.value)}
                          placeholder="Add custom preferences, nicknames, intimacy pacing, or specific topics..."
                          className="w-full bg-[#0A0E14] border border-[#C8CDD3]/20 text-white rounded-xl p-3 text-xs focus:ring-1 focus:ring-cyan-400 focus:outline-none min-h-[80px] resize-y font-sans"
                        />
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveCustomDirectives}
                            style={{ backgroundColor: accentHex, color: '#05080D' }}
                            className="min-h-[40px] font-bold text-xs px-4 rounded-xl hover:opacity-90"
                          >
                            Save Custom Directives
                          </Button>
                        </div>
                      </div>

                      {/* JSON Backup Export / Import (Settings stripped of API keys) */}
                      <div className="p-4 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-display font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5" style={{ color: accentHex }} />
                            Local Memory &amp; Settings Backup (JSON)
                          </div>
                          <p className="text-[11px] text-[#C8CDD3]/70 mt-1">
                            Exports v3 settings (with API keys stripped), {summariesCount}/{MAX_CONVERSATION_SUMMARIES} summaries, and chat history.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            ref={backupFileInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={handleImportBackup}
                            className="hidden"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleExportBackup}
                            className="min-h-[40px] border-[#C8CDD3]/25 hover:bg-[#151E2E] text-slate-200 text-xs px-3.5 rounded-xl gap-1.5"
                          >
                            <Download className="w-3.5 h-3.5 text-cyan-400" /> Export Backup
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => backupFileInputRef.current?.click()}
                            className="min-h-[40px] border-[#C8CDD3]/25 hover:bg-[#151E2E] text-slate-200 text-xs px-3.5 rounded-xl gap-1.5"
                          >
                            <Upload className="w-3.5 h-3.5 text-cyan-400" /> Import Backup
                          </Button>
                        </div>
                      </div>

                      {/* On-Device Memory Management (per active identity) */}
                      <div className="p-4 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-display font-bold text-white uppercase tracking-wider">
                              On-Device Memory ({settings.activeIdentity === 'tyler' ? 'Tyler' : 'Sierra'})
                            </span>
                            <span
                              data-testid="memory-count-badge"
                              className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#0F1520] border border-[#C8CDD3]/20 text-cyan-300"
                            >
                              {summariesCount}/{MAX_CONVERSATION_SUMMARIES}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {showClearAllConfirm ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  data-testid="memory-clear-all-confirm-btn"
                                  onClick={() => {
                                    clearConversationSummaries(settings.activeIdentity);
                                    refreshMemorySummaries(settings.activeIdentity);
                                    setShowClearAllConfirm(false);
                                    toast.success(
                                      `Cleared ${settings.activeIdentity === 'tyler' ? 'Tyler' : 'Sierra'} memory summaries.`
                                    );
                                  }}
                                  className="min-h-[36px] text-xs px-3 rounded-xl"
                                >
                                  Confirm Clear
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setShowClearAllConfirm(false)}
                                  className="min-h-[36px] border-[#C8CDD3]/25 text-slate-300 text-xs px-3 rounded-xl"
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                data-testid="memory-clear-all-btn"
                                disabled={summariesCount === 0}
                                onClick={() => setShowClearAllConfirm(true)}
                                className="min-h-[36px] border-red-800/50 text-red-300 hover:bg-red-950/40 text-xs px-3 rounded-xl gap-1.5"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Clear all
                              </Button>
                            )}
                          </div>
                        </div>

                        {summariesList.length === 0 ? (
                          <p className="text-[11px] text-[#C8CDD3]/60 py-2">
                            No saved memories yet for {settings.activeIdentity === 'tyler' ? 'Tyler' : 'Sierra'}.
                          </p>
                        ) : (
                          <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                            {[...summariesList].reverse().map((item) => (
                              <div
                                key={item.id}
                                data-testid="memory-summary-item"
                                className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-[#0F1520] border border-[#C8CDD3]/15"
                              >
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center gap-2 text-[10px] text-[#C8CDD3]/60 font-mono">
                                    <span>#{item.seqId ?? '?'}</span>
                                    <span className="uppercase">{item.source}</span>
                                    <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
                                  </div>
                                  <p className="text-xs text-slate-200 break-words leading-snug">
                                    {item.summary}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  data-testid="memory-delete-item-btn"
                                  aria-label={`Delete memory ${item.seqId ?? item.id}`}
                                  onClick={() => {
                                    deleteConversationSummary(item.id, settings.activeIdentity);
                                    refreshMemorySummaries(settings.activeIdentity);
                                    toast.success('Memory entry removed');
                                  }}
                                  className="shrink-0 p-2 rounded-lg text-[#C8CDD3]/60 hover:text-red-300 hover:bg-red-950/30 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Compatibility Matrix */}
                      <div className="space-y-2.5">
                        <div className="text-xs font-display font-bold text-[#C8CDD3] uppercase tracking-wider">
                          {'Multi-Provider & Model Compatibility Matrix'}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                          {Object.entries(PROVIDER_CONTENT_CAPABILITIES).map(([pId, cap]) => (
                            <div key={pId} className="p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-xs text-white capitalize">{pId}</span>
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-[#C8CDD3]/20 text-[#C8CDD3]">
                                  {cap.matureBadge}
                                </span>
                              </div>
                              <p className="text-[10.5px] text-[#C8CDD3]/70 leading-snug">{cap.notes}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Collapsible Integrations, Device Permissions & Email Layer */}
                      <div className="rounded-xl border border-[#C8CDD3]/15 bg-[#0A0E14]/70 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowIntegrationsPanel((p) => !p)}
                          className="w-full px-4 py-3 flex items-center justify-between text-left text-xs font-display font-bold text-white uppercase tracking-wider hover:bg-white/[0.02]"
                        >
                          <span className="flex items-center gap-2">
                            <Plug className="w-4 h-4" style={{ color: accentHex }} />
                            Integrations, Android Assistant &amp; Device Permissions
                          </span>
                          {showIntegrationsPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>

                        {showIntegrationsPanel && (
                          <div className="p-4 border-t border-[#C8CDD3]/10 space-y-5">
                            <Integrations embedded />

                            {/* Default Android Assistant */}
                            <div className="p-4 rounded-xl bg-[#0F1520] border border-[#C8CDD3]/15 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-bold text-white">Default Android Assistant</div>
                                <div className="flex items-center gap-2">
                                  {defaultAssistantStatus?.canRead && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#C8CDD3]/20 text-[#C8CDD3]">
                                      {defaultAssistantStatus.isDefault ? 'Default' : 'Not Default'}
                                    </span>
                                  )}
                                  <Button
                                    size="sm"
                                    variant={assistantModeEnabled ? 'default' : 'outline'}
                                    onClick={() => {
                                      const next = !assistantModeEnabled;
                                      setAssistantModeEnabled(next);
                                      setAssistantModeEnabledState(next);
                                    }}
                                    className="h-8 text-xs rounded-lg"
                                  >
                                    {assistantModeEnabled ? 'Assistant Mode: ON' : 'Assistant Mode: OFF'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => void SierraBackgroundVoice.openDefaultAssistantSettings()}
                                    style={{ backgroundColor: accentHex, color: '#05080D' }}
                                    className="h-8 text-xs font-bold rounded-lg"
                                  >
                                    Set as Default
                                  </Button>
                                </div>
                              </div>
                            </div>

                            {/* Android Device Control & Permissions */}
                            <div
                              data-testid="device-control-settings-card"
                              className="p-4 rounded-xl bg-[#0F1520] border border-[#C8CDD3]/15 space-y-3"
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-xs font-bold text-white flex items-center gap-2">
                                  <Smartphone className="w-4 h-4 text-cyan-400" />
                                  Android Device Control &amp; Permissions
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    const updated = await getDevicePermissionsStatus();
                                    setDevicePerms(updated);
                                  }}
                                  className="h-8 text-xs rounded-lg"
                                >
                                  <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                                </Button>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant={deviceCaps.readMessagesAndCallLogEnabled ? 'default' : 'outline'}
                                  onClick={() =>
                                    setDeviceCaps(setReadMessagesAndCallLogEnabled(!deviceCaps.readMessagesAndCallLogEnabled))
                                  }
                                  className="h-8 text-xs rounded-lg"
                                >
                                  Read SMS &amp; Call Log: {deviceCaps.readMessagesAndCallLogEnabled ? 'ON' : 'OFF'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={deviceCaps.directSmsEnabled ? 'default' : 'outline'}
                                  onClick={() => setDeviceCaps(setDirectSmsEnabled(!deviceCaps.directSmsEnabled))}
                                  className="h-8 text-xs rounded-lg"
                                >
                                  Direct SMS: {deviceCaps.directSmsEnabled ? 'ON' : 'OFF'}
                                </Button>
                              </div>

                              <div className="space-y-2">
                                {DEVICE_CAPABILITIES.map((cap) => {
                                  const isEnabled = deviceCaps.enabled[cap.id] !== false;
                                  return (
                                    <div
                                      key={cap.id}
                                      className="p-2.5 rounded-lg bg-[#0A0E14] border border-[#C8CDD3]/15 flex items-center justify-between gap-2"
                                    >
                                      <div className="min-w-0">
                                        <div className="text-xs font-bold text-white">{cap.label}</div>
                                        <div className="text-[10px] text-[#C8CDD3]/65 truncate">{cap.description}</div>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        {cap.requiredPermissionGroup !== 'none' &&
                                          cap.requiredPermissionGroup !== 'alarm' && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={async () => {
                                                const nextPerms = await requestDeviceCapabilityPermission(
                                                  cap.requiredPermissionGroup
                                                );
                                                setDevicePerms(nextPerms);
                                              }}
                                              className="h-7 text-[10px] px-2 rounded-md border-cyan-400/35 text-cyan-200"
                                            >
                                              Permission
                                            </Button>
                                          )}
                                        <Button
                                          size="sm"
                                          variant={isEnabled ? 'default' : 'outline'}
                                          onClick={() =>
                                            setDeviceCaps(setDeviceCapabilityEnabled(cap.id as DeviceCapabilityId, !isEnabled))
                                          }
                                          className="h-7 text-[10px] px-2.5 rounded-md"
                                        >
                                          {isEnabled ? 'ON' : 'OFF'}
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Unified Email Layer */}
                            <div
                              data-testid="email-accounts-settings-card"
                              className="p-4 rounded-xl bg-[#0F1520] border border-[#C8CDD3]/15 space-y-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-bold text-white flex items-center gap-2">
                                  <Lock className="w-4 h-4 text-cyan-400" />
                                  Unified Email Layer ({emailAccounts.length} connected)
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setShowEmailSetupGuides(!showEmailSetupGuides)}
                                  className="h-8 text-xs rounded-lg"
                                >
                                  {showEmailSetupGuides ? 'Hide Guide' : 'Setup Guide'}
                                </Button>
                              </div>

                              {showEmailSetupGuides && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                                  {(['gmail', 'outlook', 'yahoo'] as const).map((prov) => (
                                    <div key={prov} className="p-2.5 rounded-lg bg-[#0A0E14] border border-[#C8CDD3]/15">
                                      <div className="font-bold text-white mb-1">
                                        {EMAIL_PROVIDER_SETUP_GUIDES[prov].title}
                                      </div>
                                      <ul className="space-y-0.5 text-[#C8CDD3]/70">
                                        {EMAIL_PROVIDER_SETUP_GUIDES[prov].steps.map((s, idx) => (
                                          <li key={idx}>{s}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {emailAccounts.map((acc) => (
                                <div
                                  key={acc.id}
                                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#0A0E14] border border-[#C8CDD3]/15 text-xs"
                                >
                                  <span className="text-white truncate">
                                    {acc.provider.toUpperCase()} · {acc.email}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                      await disconnectEmailAccount(acc.id);
                                      setEmailAccounts(getConnectedEmailAccounts());
                                    }}
                                    className="h-7 text-[10px] border-red-800/60 text-red-300"
                                  >
                                    Disconnect
                                  </Button>
                                </div>
                              ))}

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <select
                                  value={emailFormProvider}
                                  onChange={(e) => {
                                    const next = e.target.value as EmailProviderType;
                                    setEmailFormProvider(next);
                                    if (next === 'gmail') {
                                      const cid = emailFormClientId.trim() || DEFAULT_GMAIL_OAUTH_CLIENT_ID;
                                      setEmailFormClientId(cid);
                                      setEmailFormRedirectUri(deriveGoogleAndroidRedirectUri(cid));
                                    } else if (next === 'outlook') {
                                      setEmailFormRedirectUri(EMAIL_PROVIDER_SETUP_GUIDES.outlook.redirectUri);
                                    }
                                  }}
                                  className="bg-[#0A0E14] border border-[#C8CDD3]/20 text-white rounded-lg h-9 px-2.5 text-xs"
                                >
                                  <option value="gmail">Gmail</option>
                                  <option value="outlook">Outlook</option>
                                  <option value="yahoo">Yahoo</option>
                                </select>
                                <Input
                                  placeholder="you@example.com"
                                  value={emailFormAddress}
                                  onChange={(e) => setEmailFormAddress(e.target.value)}
                                  className="bg-[#0A0E14] border-[#C8CDD3]/20 text-white h-9 text-xs"
                                />
                                <Input
                                  placeholder="Display label"
                                  value={emailFormDisplayName}
                                  onChange={(e) => setEmailFormDisplayName(e.target.value)}
                                  className="bg-[#0A0E14] border-[#C8CDD3]/20 text-white h-9 text-xs"
                                />
                              </div>

                              {emailFormProvider === 'yahoo' ? (
                                <Input
                                  type="password"
                                  placeholder="Yahoo 16-char App Password"
                                  value={emailFormYahooAppPassword}
                                  onChange={(e) => setEmailFormYahooAppPassword(e.target.value)}
                                  className="bg-[#0A0E14] border-[#C8CDD3]/20 text-white h-9 text-xs font-mono"
                                />
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <Input
                                    placeholder="OAuth Client ID"
                                    value={emailFormClientId}
                                    onChange={(e) => {
                                      setEmailFormClientId(e.target.value);
                                      if (emailFormProvider === 'gmail') {
                                        setEmailFormRedirectUri(deriveGoogleAndroidRedirectUri(e.target.value));
                                      }
                                    }}
                                    className="bg-[#0A0E14] border-[#C8CDD3]/20 text-white h-9 text-xs font-mono"
                                  />
                                  <Input
                                    type="password"
                                    placeholder="Access Token / Auth Code"
                                    value={emailFormAccessToken || emailFormAuthCode}
                                    onChange={(e) => {
                                      setEmailFormAccessToken(e.target.value);
                                      setEmailFormAuthCode('');
                                    }}
                                    className="bg-[#0A0E14] border-[#C8CDD3]/20 text-white h-9 text-xs font-mono"
                                  />
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  ref={googleCredsFileInputRef}
                                  type="file"
                                  accept=".json,application/json"
                                  onChange={handleImportGoogleCredentialsJson}
                                  className="hidden"
                                />
                                {emailFormProvider === 'gmail' && (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={async () => {
                                        const res = await startNativeGmailOAuthSignIn({
                                          clientId: emailFormClientId.trim() || DEFAULT_GMAIL_OAUTH_CLIENT_ID,
                                          redirectUri: emailFormRedirectUri.trim() || DEFAULT_GMAIL_REDIRECT_URI,
                                          email: emailFormAddress.trim() || undefined,
                                          displayName: emailFormDisplayName.trim() || undefined,
                                        });
                                        if (!res.ok) toast.error(res.reason || 'Could not start Google Sign-In');
                                      }}
                                      style={{ backgroundColor: accentHex, color: '#05080D' }}
                                      className="h-8 text-xs font-bold rounded-lg"
                                    >
                                      Sign in with Google
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => googleCredsFileInputRef.current?.click()}
                                      className="h-8 text-xs rounded-lg"
                                    >
                                      Import Credentials JSON
                                    </Button>
                                  </>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    const cleanEmail = emailFormAddress.trim();
                                    if (!cleanEmail) {
                                      toast.error('Enter an email address');
                                      return;
                                    }
                                    const res = await connectEmailAccountWithKeystore(
                                      {
                                        id: `${emailFormProvider}-${cleanEmail.toLowerCase()}`,
                                        provider: emailFormProvider,
                                        email: cleanEmail,
                                        displayName: emailFormDisplayName.trim() || cleanEmail,
                                        oauthClientId: emailFormClientId.trim() || undefined,
                                        redirectUri: emailFormRedirectUri.trim() || undefined,
                                        enabled: true,
                                      },
                                      {
                                        accessToken: emailFormAccessToken.trim() || undefined,
                                        refreshToken: emailFormRefreshToken.trim() || undefined,
                                        appPassword: emailFormYahooAppPassword.trim() || undefined,
                                        clientId: emailFormClientId.trim() || undefined,
                                      }
                                    );
                                    if (!res.ok) {
                                      toast.error(res.reason || 'Failed to save email account');
                                      return;
                                    }
                                    setEmailAccounts(getConnectedEmailAccounts());
                                    setEmailFormAccessToken('');
                                    setEmailFormYahooAppPassword('');
                                    toast.success(`Connected ${cleanEmail}`);
                                  }}
                                  className="h-8 text-xs rounded-lg"
                                >
                                  Save Account
                                </Button>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {EMAIL_TOOL_NAMES.map((toolName: EmailActionName) => {
                                  const enabled = emailToolsEnabled[toolName] !== false;
                                  return (
                                    <button
                                      key={toolName}
                                      type="button"
                                      onClick={() => {
                                        setEmailToolEnabled(toolName, !enabled);
                                        setEmailToolsEnabledState(getEmailToolsEnabledConfig());
                                      }}
                                      className="p-2 rounded-lg bg-[#0A0E14] border border-[#C8CDD3]/15 flex items-center justify-between text-[11px] text-white"
                                    >
                                      <span className="font-mono">{toolName}</span>
                                      <span className={enabled ? 'text-emerald-400' : 'text-[#C8CDD3]/50'}>
                                        {enabled ? 'ON' : 'OFF'}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Collapsible Background Live, Wake Word & Debug Logs */}
                      <div className="rounded-xl border border-[#C8CDD3]/15 bg-[#0A0E14]/70 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowAdvancedDebug((p) => !p)}
                          className="w-full px-4 py-3 flex items-center justify-between text-left text-xs font-display font-bold text-white uppercase tracking-wider hover:bg-white/[0.02]"
                        >
                          <span className="flex items-center gap-2">
                            <Sliders className="w-4 h-4 text-amber-400" />
                            Background Voice, Wake Word &amp; Debug Logs ({debugLogs.length})
                          </span>
                          {showAdvancedDebug ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>

                        {showAdvancedDebug && (
                          <div className="p-4 border-t border-[#C8CDD3]/10 space-y-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                data-testid="toggle-background-live-btn"
                                variant={bgLiveEnabled ? 'default' : 'outline'}
                                onClick={handleToggleBackgroundLive}
                                className="h-9 text-xs rounded-xl"
                              >
                                {bgLiveEnabled ? 'Background Live: ON' : 'Background Live: OFF'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRequestBatteryExemption}
                                className="h-9 text-xs rounded-xl"
                              >
                                {ignoringBatteryOpt ? 'Battery: Unrestricted' : 'Allow Unrestricted Battery'}
                              </Button>
                              <Button
                                size="sm"
                                data-testid="toggle-wake-word-btn"
                                variant={wakeWordEnabled ? 'default' : 'outline'}
                                onClick={handleToggleWakeWord}
                                className="h-9 text-xs rounded-xl"
                              >
                                {wakeWordEnabled ? 'Wake Word: ON' : 'Wake Word: OFF'}
                              </Button>
                              <Button
                                size="sm"
                                data-testid="test-wake-word-btn"
                                variant="outline"
                                onClick={() => void triggerTestWakeWord(getActiveIdentity())}
                                className="h-9 text-xs rounded-xl"
                              >
                                Test Wake Word
                              </Button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-2 p-3 rounded-xl bg-[#0F1520] border border-[#C8CDD3]/15">
                                <div className="text-xs font-bold text-white">Wake Word Engine &amp; AccessKey</div>
                                <select
                                  value={wakeWordEngine}
                                  onChange={async (e) => {
                                    const next = e.target.value as WakeWordEngineType;
                                    setWakeWordEngineType(next);
                                    setWakeWordEngineState(next);
                                    if (wakeWordEnabled) await startWakeWordListener(getActiveIdentity());
                                  }}
                                  className="w-full bg-[#0A0E14] border border-[#C8CDD3]/20 text-white rounded-lg h-9 px-2.5 text-xs"
                                >
                                  <option value="porcupine">Picovoice Porcupine (.ppn)</option>
                                  <option value="speech_recognizer">Android SpeechRecognizer Fallback</option>
                                </select>
                                {wakeWordEngine === 'porcupine' && (
                                  <div className="flex gap-2">
                                    <Input
                                      type={showPorcupineKey ? 'text' : 'password'}
                                      value={porcupineKey}
                                      onChange={(e) => setPorcupineKeyState(e.target.value)}
                                      placeholder="Picovoice AccessKey"
                                      className="bg-[#0A0E14] border-[#C8CDD3]/20 text-white h-9 text-xs font-mono"
                                    />
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setShowPorcupineKey((s) => !s)}
                                      className="h-9 px-2.5"
                                    >
                                      {showPorcupineKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        setPicovoiceAccessKey(porcupineKey);
                                        toast.success('Picovoice AccessKey saved');
                                      }}
                                      className="h-9 text-xs"
                                    >
                                      Save
                                    </Button>
                                  </div>
                                )}
                                <div className="flex items-center gap-2 text-[11px]">
                                  <input
                                    ref={sierraPpnInputRef}
                                    type="file"
                                    accept=".ppn"
                                    onChange={(e) => handleImportPpnFile('sierra', e)}
                                    className="hidden"
                                  />
                                  <input
                                    ref={tylerPpnInputRef}
                                    type="file"
                                    accept=".ppn"
                                    onChange={(e) => handleImportPpnFile('tyler', e)}
                                    className="hidden"
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => sierraPpnInputRef.current?.click()}
                                    className="h-8 text-[11px]"
                                  >
                                    Sierra .ppn ({sierraPpnFile ? 'Loaded' : 'None'})
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => tylerPpnInputRef.current?.click()}
                                    className="h-8 text-[11px]"
                                  >
                                    Tyler .ppn ({tylerPpnFile ? 'Loaded' : 'None'})
                                  </Button>
                                </div>
                              </div>

                              <div className="space-y-2 p-3 rounded-xl bg-[#0F1520] border border-[#C8CDD3]/15">
                                <div className="flex justify-between text-xs">
                                  <span className="font-bold text-white">Wake Word Sensitivity</span>
                                  <span className="font-mono text-amber-400">{Math.round(wakeWordSensitivity * 100)}%</span>
                                </div>
                                <input
                                  type="range"
                                  min="0.1"
                                  max="1.0"
                                  step="0.05"
                                  value={wakeWordSensitivity}
                                  onChange={async (e) => {
                                    const val = parseFloat(e.target.value);
                                    setWakeWordSensitivityState(val);
                                    setWakeWordSensitivity(val);
                                    if (wakeWordEnabled) await startWakeWordListener(getActiveIdentity());
                                  }}
                                  className="w-full accent-amber-500 cursor-pointer"
                                />
                              </div>
                            </div>

                            {/* Diagnostic Debug Logs */}
                            <div
                              data-testid="settings-debug-logs-card"
                              className="p-3 rounded-xl bg-[#0F1520] border border-[#C8CDD3]/15 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                                  <Bug className="w-4 h-4" style={{ color: accentHex }} />
                                  Diagnostic Debug Logs ({debugLogs.length})
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    data-testid="settings-copy-debug-logs-btn"
                                    onClick={async () => {
                                      try {
                                        await navigator.clipboard.writeText(formatDebugLogs(debugLogs));
                                        setCopiedLogs(true);
                                        setTimeout(() => setCopiedLogs(false), 1800);
                                        toast.success('Copied debug logs');
                                      } catch {
                                        toast.error('Clipboard unavailable');
                                      }
                                    }}
                                    className="h-8 text-xs gap-1"
                                  >
                                    <Copy className="w-3 h-3" /> {copiedLogs ? 'Copied' : 'Copy All'}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    data-testid="settings-clear-debug-logs-btn"
                                    onClick={() => {
                                      clearDebugLogs();
                                      toast.info('Cleared debug logs');
                                    }}
                                    className="h-8 text-xs border-red-500/30 text-red-300 gap-1"
                                  >
                                    <Trash2 className="w-3 h-3" /> Clear
                                  </Button>
                                </div>
                              </div>
                              <div className="max-h-56 overflow-y-auto rounded-lg bg-[#0A0E14] border border-[#C8CDD3]/15 p-2.5 font-mono text-[11px] space-y-1">
                                {debugLogs.length === 0 ? (
                                  <p className="text-[#C8CDD3]/50 py-3 text-center">No events recorded yet.</p>
                                ) : (
                                  debugLogs.slice(-150).map((entry, idx) => (
                                    <div key={entry.id || `${entry.time}-${idx}`} className="text-[#C8CDD3]/85 break-words">
                                      <span className="text-[#C8CDD3]/45">[{entry.time}]</span>{' '}
                                      <span style={{ color: accentHex }}>[{entry.stage}]</span>{' '}
                                      <span>{entry.detail}</span>
                                    </div>
                                  ))
                                )}
                              </div>

                              {/* Saved Debug Utterances (last 10) */}
                              <div className="pt-2 border-t border-[#C8CDD3]/10 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-slate-200">
                                    Saved STT Utterance Clips ({debugUtterances.length}/10)
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      data-testid="settings-refresh-debug-utterances-btn"
                                      onClick={() => void loadDebugUtterances()}
                                      className="h-7 text-[11px] gap-1"
                                    >
                                      <RefreshCw className="w-3 h-3" /> Load Clips
                                    </Button>
                                    {debugUtterances.length > 0 && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        data-testid="settings-clear-debug-utterances-btn"
                                        onClick={async () => {
                                          await getSierraLocalVoicePlugin().clearDebugUtterances?.();
                                          setDebugUtterances([]);
                                          toast.info('Cleared saved STT audio clips');
                                        }}
                                        className="h-7 text-[11px] border-red-500/30 text-red-300 gap-1"
                                      >
                                        <Trash2 className="w-3 h-3" /> Clear Clips
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                {debugUtterances.length === 0 ? (
                                  <p className="text-[10px] text-[#C8CDD3]/55">
                                    Enable &ldquo;Save last 10 utterances&rdquo; in Live Voice settings, then tap Load Clips after speaking.
                                  </p>
                                ) : (
                                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {debugUtterances.map((u) => (
                                      <div
                                        key={u.id}
                                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#0A0E14] border border-[#C8CDD3]/15 text-[11px]"
                                      >
                                        <div className="min-w-0 flex-1">
                                          <div className="text-slate-100 truncate">
                                            &ldquo;{u.transcript || u.rawTranscript || '(empty)'}&rdquo;
                                          </div>
                                          <div className="text-[10px] font-mono text-[#C8CDD3]/60">
                                            rms={Number(u.rms || 0).toFixed(4)} • {u.durationMs}ms
                                            {u.whisperMs ? ` • whisper=${u.whisperMs}ms` : ''}
                                            {u.droppedReason ? ` • dropped:${u.droppedReason}` : ''}
                                          </div>
                                        </div>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          onClick={() => void handlePlayDebugUtterance(u.id)}
                                          className="h-8 px-2.5 text-[11px] shrink-0 gap-1"
                                        >
                                          <Play className="w-3 h-3" />
                                          {playingUtteranceId === u.id ? 'Stop' : 'Play'}
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              </section>
            </>
          )}
        </div>
      </div>

      <PersonaVoiceModal
        isOpen={activeModalMode !== null}
        mode={activeModalMode || 'persona'}
        onClose={() => setActiveModalMode(null)}
        onChanged={(newIdentity) => {
          notifyIdentityChanged(newIdentity);
          setTtsPitchState(getTtsPitch());
          setTtsRateState(getTtsRate());
          setTtsProviderState(getSelectedVoiceProvider());
          setChatSpeechEnabledState(isChatSpeechEnabled());
          setVoiceSettingsTick((t) => t + 1);
          if (isWakeWordEnabled()) {
            startWakeWordListener(getActiveIdentity()).catch(() => {});
          }
        }}
      />
    </div>
  );
}
