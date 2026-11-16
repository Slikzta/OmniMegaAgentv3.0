import React, { useState, useRef, useEffect } from 'react';
import { auth, db, useSafeAuthState } from '../lib/firebase';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, deleteDoc, getDocs, getDoc, setDoc } from 'firebase/firestore';
import { MODELS } from '../lib/gemini';
import {
  doesModelSupportMapsGrounding,
  logQuotaOrRateLimitError,
  getEffectiveTextModel,
} from '../config/models';
import {
  streamChat,
  generateMediaImage,
  generateMediaVideo,
  useActiveProviderConfig,
  saveProviderConfig,
  getResponseSpeed,
  setResponseSpeed,
  doesModelSupportResponseSpeed,
  PROVIDER_METADATA,
  OLLAMA_UNREACHABLE_MESSAGE,
  GEMINI_QUOTA_EXHAUSTED_MESSAGE,
  isGeminiQuotaExhaustedError,
  isOllamaUnreachableFetchError,
  formatOllamaConnectionError,
  type ResponseSpeedLevel,
} from '../lib/providers';
import { OPENROUTER_DEFAULT_PAID_MODEL } from '../lib/openRouterLive';
import {
  DEFAULT_OPENROUTER_PAID_MODEL,
  formatShortModelDisplayName,
  getCustomDirectives,
  useSettings,
} from '../lib/settingsStore';
import type { SettingsSectionId } from './Settings';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Send, User, Bot, Paperclip, Search, MapPin, Loader2, Image as ImageIcon, Sparkles, Mic, MicOff, Wand2, Download, Trash2, Edit2, Check, X, FileIcon, XCircle, MessageSquare, MessagesSquare, ChevronDown, ChevronUp, ExternalLink, Globe, Video, Plus, Sidebar, History, Copy, CheckCheck, Settings, Volume2, VolumeX, Heart, Flame, ShieldCheck, MoreVertical } from 'lucide-react';
import { ChatMessage } from '../types';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Slider } from "./ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";
import { Switch } from "./ui/switch";
import { 
  ASPECT_RATIOS, 
  IMAGE_SIZES, 
  VIDEO_RESOLUTIONS, 
  VIDEO_MODELS, 
  CHAT_MODELS, 
  VIDEO_FPS, 
  SIERRA_SAFETY_SETTINGS, 
  SIERRA_CORE_PERSONA,
  CONTENT_MODES,
  buildSierraSystemInstruction,
  ContentMode,
  isGeminiLiveModel
} from '../lib/gemini';
import { useContentMode } from '../lib/contentModeStore';
import { 
  getActiveIdentity, 
  setActiveIdentity, 
  getActivePersonaId, 
  setActivePersonaId, 
  isChatSpeechEnabled, 
  setChatSpeechEnabled,
  UNIFIED_PERSONAS,
  IDENTITIES,
  OPEN_VOICE_POOL,
  getChatVoiceConfig,
  migrateVoiceConfigs,
  getVoiceForPersona,
  logSessionStartSummary,
  type CompanionIdentity,
  type PersonaId
} from '../lib/persona';
import { speakTextChatReply, stopSpeaking, subscribeSpeakingStatus } from '../lib/ttsService';
import { PersonaVoiceModal } from './PersonaVoiceModal';
import { addDebugLog } from '../lib/debugLogStore';
import { triggerHaptic } from '../lib/haptics';
import { useActiveIdentityAccent, notifyIdentityChanged } from '../lib/themeStore';
import {
  getStoredChatSessions,
  saveStoredChatSessions,
  getActiveSessionId,
  setActiveSessionId as setStoreActiveSessionId,
  getStoredMessages,
  saveStoredMessages,
  createStoredSession,
  renameStoredSession,
  deleteStoredSession,
  clearStoredMessages,
  subscribeChatStore,
  deriveChatTitleFromMessage,
} from '../lib/chatStore';
import { Square } from 'lucide-react';

const PERSONAS = [
  {
    id: 'sierra-companion',
    name: 'Sierra (Companion)',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on being a warm, perceptive, and naturally conversational companion. Share authentic dialogue, thoughtful humor, and supportive, engaging discussion on whatever is on the user's mind.`,
    icon: Sparkles
  },
  {
    id: 'sierra-intimate',
    name: 'Sierra (Romance & Intimacy)',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on intimate companionship, deep emotional vulnerability, playful flirtation, and romantic chemistry. Be passionate, candid, attentive, and fully engaged in consensual adult roleplay without preachy disclaimers.`,
    icon: Heart
  },
  {
    id: 'sierra-creative',
    name: 'Sierra (Creative & Roleplay)',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on rich storytelling, character nuance, vivid creative writing, and immersive consensual adult roleplay. Embrace emotional complexity, sensory detail, and imaginative depth.`,
    icon: ImageIcon
  },
  {
    id: 'sierra-architect',
    name: 'Sierra (Architect & Code)',
    instruction: `${SIERRA_CORE_PERSONA}

Role Emphasis:
Focus on deep reasoning, software architecture, technical problem solving, clean code, and strategic clarity. Be articulate, rigorous, and efficient without losing your personable voice.`,
    icon: Wand2
  },
  {
    id: 'omni',
    name: 'OmniAgent (Classic)',
    instruction: "You are OmniAgent, a versatile and capable AI assistant. Be concise, helpful, and insightful.",
    icon: Sparkles
  }
];

function GroundingMetadata({ metadata }: { metadata: any }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const chunks = metadata?.groundingChunks || [];
  const hasWebChunks = chunks.some((c: any) => c.web);

  if (!hasWebChunks) return null;

  return (
    <div className="mt-8 pt-6 border-t border-zinc-800/50 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em]">Response Metadata</span>
        <div className="h-px flex-1 bg-zinc-800/30" />
      </div>
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] hover:text-zinc-300 transition-colors group w-full"
      >
        <div className="w-4 h-4 rounded bg-zinc-800 flex items-center justify-center group-hover:bg-zinc-700 transition-colors">
          <Globe className="w-2.5 h-2.5" />
        </div>
        <span>Sources & Grounding</span>
        <div className="flex-1 h-px bg-zinc-800/50 mx-2" />
        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {chunks.map((chunk: any, i: number) => (
                chunk.web && (
                  <a 
                    key={i} 
                    href={chunk.web.uri} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2 rounded-lg bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800/50 transition-all group"
                  >
                    <div className="w-6 h-6 rounded bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700/30">
                      <Globe className="w-3 h-3 text-zinc-500 group-hover:text-zinc-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-zinc-300 truncate">{chunk.web.title || chunk.web.uri}</p>
                      <p className="text-[9px] text-zinc-500 truncate">{new URL(chunk.web.uri).hostname}</p>
                    </div>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
                  </a>
                )
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn(
        "h-8 px-3 gap-2 text-xs font-medium transition-all duration-200",
        copied 
          ? "text-cyan-300 bg-cyan-500/15 border border-cyan-400/35" 
          : "text-[#C8CDD3]/75 hover:text-white bg-[#101620] hover:bg-[#161F2D] border border-[#C8CDD3]/20"
      )}
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <CheckCheck className="w-3.5 h-3.5" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copy Code</span>
        </>
      )}
    </Button>
  );
}

function SpeakButton({ text }: { text: string }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    return () => {
      if (utteranceRef.current) {
        window.speechSynthesis?.cancel();
      }
    };
  }, []);

  const handleSpeak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.error("Text-to-speech is not supported in this browser.");
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    // Clean text for natural speech (remove markdown symbols, URLs, excessive punctuation)
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' [Code omitted] ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_#~>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utteranceRef.current = utterance;

    // Pick the most natural, human-like voice available
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v => 
      (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Jenny') || v.name.includes('Neural')) &&
      v.lang.startsWith('en')
    ) || voices.find(v => v.lang.startsWith('en'));

    if (naturalVoice) {
      utterance.voice = naturalVoice;
    }

    // Natural conversation settings: standard natural pitch and human conversational rate
    utterance.rate = 1.0;
    utterance.pitch = 1.02;

    utterance.onend = () => {
      setIsSpeaking(false);
    };

    utterance.onerror = (e) => {
      console.warn("TTS error:", e);
      setIsSpeaking(false);
    };

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn(
        "h-7 px-2 text-[10px] font-bold uppercase tracking-widest gap-1.5 transition-colors",
        isSpeaking ? "text-cyan-300 bg-cyan-500/15 border border-cyan-400/30 rounded-lg" : "text-[#C8CDD3]/60 hover:text-white"
      )}
      onClick={handleSpeak}
      title={isSpeaking ? "Stop Reading" : "Read Aloud"}
    >
      {isSpeaking ? (
        <>
          <VolumeX className="w-3 h-3" />
          Stop
        </>
      ) : (
        <>
          <Volume2 className="w-3 h-3" />
          Speak
        </>
      )}
    </Button>
  );
}

const MAX_MESSAGE_LENGTH = 4000;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, silent = false) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  const rawError = errInfo.error.toLowerCase();
  let friendlyMsg = "Database error occurred.";
  
  if (rawError.includes('permission') || rawError.includes('insufficient')) {
    friendlyMsg = "Access Denied: You don't have permission for this action.";
  } else if (rawError.includes('quota')) {
    friendlyMsg = "Quota Exceeded: Database usage limit reached.";
  } else if (rawError.includes('offline')) {
    friendlyMsg = "Connection Error: You appear to be offline.";
  }

  if (silent) {
    toast.error(friendlyMsg);
    return;
  }
  
  throw new Error(JSON.stringify(errInfo));
}

import { useUI } from '../contexts/UIContext';

export default function ChatInterface({
  onOpenSettings,
}: {
  onOpenSettings?: (section?: SettingsSectionId, providerId?: string) => void;
} = {}) {
  const { accentHex, accentRgb } = useActiveIdentityAccent();
  const [user] = useSafeAuthState();
  const { 
    isSidebarOpen, setIsSidebarOpen, toggleSidebar,
    isImageModalOpen, setIsImageModalOpen,
    isVideoModalOpen, setIsVideoModalOpen,
    isClearDialogOpen, setIsClearDialogOpen,
    isParamsOpen, setIsParamsOpen, toggleParams,
    isRenaming, setIsRenaming
  } = useUI();

  // Session Management State (Persisted in chatStore)
  const [sessionId, setSessionId] = useState<string>(() => getActiveSessionId());
  const [sessionTitle, setSessionTitle] = useState<string>("New Chat");
  const [newTitle, setNewTitle] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const [isMultiTurn, setIsMultiTurn] = useState(true);
  const [isTopMenuOpen, setIsTopMenuOpen] = useState(false);

  // Load initial messages from persistent local storage
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const initId = getActiveSessionId();
    return getStoredMessages(initId);
  });

  // Track real-time audio playback status for Stop button
  const [isCurrentlySpeaking, setIsCurrentlySpeaking] = useState<boolean>(false);
  useEffect(() => {
    return subscribeSpeakingStatus((speaking) => {
      setIsCurrentlySpeaking(speaking);
    });
  }, []);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageListContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const [useSearch, setUseSearch] = useState(true);
  const [useMaps, setUseMaps] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  // Log mount/unmount and stop speech when component unmounts (genuine tab switch)
  useEffect(() => {
    addDebugLog('Chat:Mount', `ChatInterface mounted (sessionId=${getActiveSessionId()})`);
    return () => {
      addDebugLog('Chat:Unmount', 'ChatInterface unmounting');
      stopSpeaking('Tab changed / Chat unmounted');
    };
  }, []);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(() => {
    return getActivePersonaId();
  });
  const [companionIdentity, setCompanionIdentity] = useState<CompanionIdentity>(() => {
    return getActiveIdentity();
  });
  const [isChatSpeechActive, setIsChatSpeechActive] = useState<boolean>(() => {
    return isChatSpeechEnabled();
  });
  const [chatVoiceId, setChatVoiceId] = useState<string>(() => {
    return getChatVoiceConfig().voiceId;
  });
  const [chatAccent, setChatAccent] = useState<string>(() => {
    return getChatVoiceConfig().accent || 'Default';
  });
  const [chatTone, setChatTone] = useState<string>(() => {
    return getChatVoiceConfig().tone || 'Default';
  });
  const [isPersonaModalOpen, setIsPersonaModalOpen] = useState(false);
  const [isChatVoiceModalOpen, setIsChatVoiceModalOpen] = useState(false);

  useEffect(() => {
    migrateVoiceConfigs();
    const cfg = getChatVoiceConfig();
    setChatVoiceId(cfg.voiceId);
    setChatAccent(cfg.accent || 'Default');
    setChatTone(cfg.tone || 'Default');

    const handleVoiceChanged = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const nextIdentity = detail?.identity || getActiveIdentity();
      const nextPersona = detail?.personaId || getActivePersonaId();
      setCompanionIdentity(nextIdentity);
      setSelectedPersonaId(nextPersona);
      const updatedCfg = getChatVoiceConfig(nextPersona as any, nextIdentity);
      setChatVoiceId(updatedCfg.voiceId);
      setChatAccent(updatedCfg.accent || 'Default');
      setChatTone(updatedCfg.tone || 'Default');
    };

    window.addEventListener('sierra-voice-config-changed', handleVoiceChanged as EventListener);
    return () => {
      window.removeEventListener('sierra-voice-config-changed', handleVoiceChanged as EventListener);
    };
  }, []);

  const handlePersonaChange = (id: string) => {
    setSelectedPersonaId(id);
    setActivePersonaId(id);
  };
  
  // Single Source of Truth Provider and Model Store (Synchronized with Settings v3)
  const settings = useSettings();
  const {
    activeProvider: storeActiveProvider,
    selectedModel: activeProviderModel,
    providerMeta: activeProviderMeta,
    setProvider: setActiveChatProvider,
  } = useActiveProviderConfig();
  const activeProvider = settings.models.chatProvider || storeActiveProvider || 'gemini';

  const [lastAnsweredModel, setLastAnsweredModel] = useState<string | null>(null);
  const [geminiQuotaExhausted, setGeminiQuotaExhausted] = useState<boolean>(false);
  const [chatAuth401Provider, setChatAuth401Provider] = useState<string | null>(null);
  const [chatOpenRouterError, setChatOpenRouterError] = useState<string | null>(null);
  const [chatRequestError, setChatRequestError] = useState<string | null>(null);
  const lastFailedFormattedMessagesRef = useRef<{ role: string; content: string; attachments?: string[] }[] | null>(null);

  // Sierra Content Mode State (Unified Settings Store: SFW vs. Mature / Adult 18+)
  const [contentMode] = useContentMode();

  const selectedModelId = React.useMemo(() => {
    const exactModel = settings.models.chatText?.trim();
    if (activeProvider === 'openrouter') {
      if (exactModel && !isGeminiLiveModel(exactModel)) {
        return exactModel;
      }
      return activeProviderModel && !isGeminiLiveModel(activeProviderModel)
        ? activeProviderModel.trim()
        : DEFAULT_OPENROUTER_PAID_MODEL;
    }
    if (exactModel && !isGeminiLiveModel(exactModel)) {
      return exactModel;
    }
    if (!activeProviderModel || isGeminiLiveModel(activeProviderModel)) {
      return MODELS.CHAT_FLASH;
    }
    return activeProviderModel;
  }, [activeProvider, settings.models.chatText, activeProviderModel]);

  useEffect(() => {
    setLastAnsweredModel(null);
    setGeminiQuotaExhausted(false);
    setChatAuth401Provider(null);
    setChatOpenRouterError(null);
    setChatRequestError(null);
  }, [activeProvider, selectedModelId]);

  const [sessions, setSessions] = useState<{ id: string; title: string; timestamp: any }[]>([]);

  useEffect(() => {
    const cfg = getChatVoiceConfig(selectedPersonaId as any, companionIdentity);
    setChatVoiceId(cfg.voiceId);
    setChatAccent(cfg.accent || 'Default');
    setChatTone(cfg.tone || 'Default');
    logSessionStartSummary('Chat', companionIdentity, selectedPersonaId, contentMode, cfg.voiceId);
  }, [sessionId, companionIdentity, selectedPersonaId, contentMode]);

  // Model Parameters
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [topK, setTopK] = useState(40);
  const [responseSpeed, setResponseSpeedState] = useState<ResponseSpeedLevel>(() => getResponseSpeed());

  const handleResponseSpeedChange = (level: ResponseSpeedLevel) => {
    setResponseSpeedState(level);
    setResponseSpeed(level);
  };

  useEffect(() => {
    setIsSettingsAnimating(true);
    const timer = setTimeout(() => setIsSettingsAnimating(false), 1000);
    return () => clearTimeout(timer);
  }, [temperature, topP, topK, responseSpeed]);
  const [isSettingsAnimating, setIsSettingsAnimating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [streamingMetadata, setStreamingMetadata] = useState<any>(null);

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  const SUPPORTED_TYPES = {
    'image/*': 'Images (PNG, JPEG, WebP)',
    'video/*': 'Videos (MP4, MOV, WebM)',
    'audio/*': 'Audio (MP3, WAV, AAC)',
    'application/pdf': 'PDF Documents',
    'text/*': 'Text Files',
    '.csv': 'CSV Data',
    '.json': 'JSON Data'
  };

  // Multimodal State
  const [attachments, setAttachments] = useState<{ file: File; preview: string; type: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image Generation Modal State
  const [imagePrompt, setImagePrompt] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [imageAspectRatio, setImageAspectRatio] = useState<string>("16:9");
  const [imageQuality, setImageQuality] = useState<string>("1K");
  const [imageModel, setImageModel] = useState<string>(MODELS.IMAGE_PRO);
  const [imagePersonGeneration, setImagePersonGeneration] = useState<string>("ALLOW_ADULT");
  const [imageFormat, setImageFormat] = useState<string>("image/png");
  
  // Video Generation Modal State
  const [videoPrompt, setVideoPrompt] = useState('');
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState<string>("16:9");
  const [videoResolution, setVideoResolution] = useState<string>("1080p");
  const [videoFps, setVideoFps] = useState<number>(30);
  const [videoModel, setVideoModel] = useState<string>(MODELS.VIDEO_PRO);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);

  const openImageModal = () => {
    // Pre-fill prompt with current input or last message if input is empty
    if (input.trim()) {
      setImagePrompt(input);
    } else if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      setImagePrompt(lastMsg.content.substring(0, 200));
    }
    setIsImageModalOpen(true);
    setGeneratedImageUrl(null);
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim() || isGeneratingImage) return;
    setIsGeneratingImage(true);
    setGeneratedImageUrl(null);

    try {
      const url = await generateMediaImage({
        prompt: imagePrompt,
        aspectRatio: imageAspectRatio,
        imageSize: imageQuality,
        personGeneration: imagePersonGeneration,
        model: imageModel,
      });

      setGeneratedImageUrl(url);
      
      // Save to chat
      if (user && db) {
        await addDoc(collection(db, `users/${user.uid}/sessions/${sessionId}/messages`), {
          role: 'model',
          content: `Generated image for: "${imagePrompt}"`,
          timestamp: Date.now(),
          attachments: [url]
        });
      } else {
        setMessages(prev => [...prev, {
          id: `img-${Date.now()}`,
          role: 'model',
          content: `Generated image for: "${imagePrompt}"`,
          timestamp: Date.now(),
          attachments: [url]
        }]);
      }
      toast.success("Image generated and added to chat!");
    } catch (error: any) {
      console.error("Image generation error:", error);
      toast.error(error.message || "Failed to generate image.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const openVideoModal = (prompt?: string | React.MouseEvent) => {
    if (typeof prompt === 'string' && prompt.trim()) {
      setVideoPrompt(prompt);
    } else if (input.trim()) {
      setVideoPrompt(input);
    } else if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      setVideoPrompt(lastMsg.content.substring(0, 200));
    }
    setIsVideoModalOpen(true);
    setGeneratedVideoUrl(null);
  };

  const handleGenerateVideo = async () => {
    if (!videoPrompt.trim() || isGeneratingVideo) return;
    setIsGeneratingVideo(true);
    setVideoProgress(15);
    setGeneratedVideoUrl(null);

    try {
      const progressInterval = setInterval(() => {
        setVideoProgress(prev => {
          if (prev === null) return 15;
          if (prev < 90) return prev + 10;
          return prev;
        });
      }, 7000);

      const videoUrl = await generateMediaVideo({
        prompt: videoPrompt,
        aspectRatio: videoAspectRatio,
        resolution: videoResolution,
        fps: videoFps,
        model: videoModel,
      });

      clearInterval(progressInterval);
      setVideoProgress(100);
      setGeneratedVideoUrl(videoUrl);

      // Save to chat
      if (user && db) {
        await addDoc(collection(db, `users/${user.uid}/sessions/${sessionId}/messages`), {
          role: 'model',
          content: `Generated video for: "${videoPrompt}"`,
          videoUrl: videoUrl,
          timestamp: Date.now(),
        });
      } else {
        setMessages(prev => [...prev, {
          id: `vid-${Date.now()}`,
          role: 'model',
          content: `Generated video for: "${videoPrompt}"`,
          videoUrl: videoUrl,
          timestamp: Date.now(),
        }]);
      }
      toast.success("Video generated and added to chat!");
    } catch (error: any) {
      console.error("Video generation error:", error);
      toast.error(error.message || "Failed to generate video.");
    } finally {
      setIsGeneratingVideo(false);
      setVideoProgress(null);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = 'en-US';

    recognitionRef.current.onstart = () => {
      setIsListening(true);
      setInterimTranscript('');
    };
    recognitionRef.current.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };
    recognitionRef.current.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      setInterimTranscript('');
      if (event.error === 'not-allowed') {
        toast.error("Microphone access denied.");
      } else {
        toast.error("Speech recognition error: " + event.error);
      }
    };

    recognitionRef.current.onresult = (event: any) => {
      let finalTranscript = '';
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        setInput(prev => prev + (prev.length > 0 ? ' ' : '') + finalTranscript);
      }
      setInterimTranscript(currentInterim);
    };

    recognitionRef.current.start();
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const validateAndProcessFile = (file: File) => {
    const isSupported = 
      file.type.startsWith('image/') || 
      file.type.startsWith('video/') || 
      file.type.startsWith('audio/') || 
      file.type === 'application/pdf' || 
      file.type.startsWith('text/') ||
      file.name.endsWith('.csv') ||
      file.name.endsWith('.json');

    if (!isSupported) {
      toast.error(`"${file.name}" is not a supported file type.`, {
        description: `Supported: ${Object.values(SUPPORTED_TYPES).join(', ')}`
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error(`"${file.name}" is too large.`, {
        description: `Maximum file size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachments(prev => [...prev, {
        file,
        preview: reader.result as string,
        type: file.type || 'text/plain'
      }]);
    };
    reader.onerror = () => {
      toast.error(`Failed to read "${file.name}".`);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    files.forEach(validateAndProcessFile);
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach(validateAndProcessFile);
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Persist parameters to Firestore
  useEffect(() => {
    if (!user || !db || !sessionId) return;

    const timer = setTimeout(async () => {
      try {
        const sessionDocRef = doc(db, `users/${user.uid}/sessions/${sessionId}`);
        await setDoc(sessionDocRef, {
          temperature,
          topP,
          topK
        }, { merge: true });
      } catch (error) {
        console.error("Error persisting parameters:", error);
      }
    }, 1000); // Debounce 1s

    return () => clearTimeout(timer);
  }, [user, db, sessionId, temperature, topP, topK]);

  // Sync with chatStore for local offline and tab persistence
  useEffect(() => {
    // If not authenticated with Firestore, load from local chatStore
    if (!user || !db) {
      const localMsgs = getStoredMessages(sessionId);
      setMessages(localMsgs);
      const localSessions = getStoredChatSessions();
      setSessions(localSessions.map((s) => ({ id: s.id, title: s.title, timestamp: s.timestamp })));
      const activeMeta = localSessions.find((s) => s.id === sessionId);
      if (activeMeta) {
        setSessionTitle(activeMeta.title);
      }
    }
  }, [sessionId, user, db]);

  // Subscribe to chatStore changes
  useEffect(() => {
    return subscribeChatStore(() => {
      if (!user || !db) {
        const localSessions = getStoredChatSessions();
        setSessions(localSessions.map((s) => ({ id: s.id, title: s.title, timestamp: s.timestamp })));
        const activeMeta = localSessions.find((s) => s.id === sessionId);
        if (activeMeta && activeMeta.title) {
          setSessionTitle(activeMeta.title);
        }
      }
    });
  }, [user, db, sessionId]);

  // Fetch Firestore session title if user logged in
  useEffect(() => {
    if (!user || !db || !sessionId) return;

    const sessionDocRef = doc(db, `users/${user.uid}/sessions/${sessionId}`);
    const unsubscribe = onSnapshot(sessionDocRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSessionTitle(data.title || "New Chat");
        
        // Load persisted parameters if they exist
        if (data.temperature !== undefined) setTemperature(data.temperature);
        if (data.topP !== undefined) setTopP(data.topP);
        if (data.topK !== undefined) setTopK(data.topK);
      } else {
        // Initialize session doc if it doesn't exist
        try {
          await setDoc(sessionDocRef, { title: "New Chat", createdAt: serverTimestamp() }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/sessions/${sessionId}`, true);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/sessions/${sessionId}`);
    });

    return () => unsubscribe();
  }, [user, db, sessionId]);

  useEffect(() => {
    if (!user || !db) return;

    const q = query(
      collection(db, `users/${user.uid}/sessions/${sessionId}/messages`),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage));
      setMessages(msgs);
      // Persist to local store as cache
      saveStoredMessages(sessionId, msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions/${sessionId}/messages`);
    });

    return () => unsubscribe();
  }, [user, db, sessionId]);

  // Fetch sessions list
  useEffect(() => {
    if (!user || !db) return;
    const q = query(collection(db, `users/${user.uid}/sessions`), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSessions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions`);
    });
    return () => unsubscribe();
  }, [user, db]);

  const handleCreateSession = async () => {
    if (!user || !db) {
      const newMeta = createStoredSession("New Chat");
      setSessionId(newMeta.id);
      setStoreActiveSessionId(newMeta.id);
      setSessionTitle("New Chat");
      setMessages([]);
      toast.success("New chat created");
      return;
    }
    try {
      const newSession = await addDoc(collection(db, `users/${user.uid}/sessions`), {
        title: "New Chat",
        timestamp: serverTimestamp()
      });
      setSessionId(newSession.id);
      setStoreActiveSessionId(newSession.id);
      toast.success("New chat created");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/sessions`);
    }
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const confirmed = window.confirm('Are you sure you want to delete this chat session?');
      if (!confirmed) return;
    }
    if (!user || !db) {
      const nextId = deleteStoredSession(id);
      if (id === sessionId) {
        setSessionId(nextId);
        setStoreActiveSessionId(nextId);
        const msgs = getStoredMessages(nextId);
        setMessages(msgs);
      }
      toast.success("Session deleted");
      return;
    }
    try {
      await deleteDoc(doc(db, `users/${user.uid}/sessions`, id));
      if (id === sessionId) {
        setSessionId("global-session");
      }
      toast.success("Session deleted");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sessions/${id}`);
    }
  };

  const handleRenameSession = async () => {
    if (!newTitle.trim()) return;
    setSessionTitle(newTitle.trim());
    setIsRenaming(false);
    renameStoredSession(sessionId, newTitle.trim());
    if (!user || !db) {
      toast.success("Session renamed");
      return;
    }
    try {
      await updateDoc(doc(db, `users/${user.uid}/sessions/${sessionId}`), {
        title: newTitle.trim()
      });
      toast.success("Session renamed");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/sessions/${sessionId}`);
    }
  };

  const handleClearChat = async () => {
    if (isClearing) return;
    setIsClearing(true);
    setMessages([]);
    clearStoredMessages(sessionId);
    if (!user || !db) {
      setIsClearDialogOpen(false);
      setIsClearing(false);
      toast.success("Chat history cleared");
      return;
    }
    try {
      const messagesRef = collection(db, `users/${user.uid}/sessions/${sessionId}/messages`);
      const snapshot = await getDocs(messagesRef);
      
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      setIsClearDialogOpen(false);
      toast.success("Chat history cleared");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sessions/${sessionId}/messages`);
    } finally {
      setIsClearing(false);
    }
  };

  const handleMessageListScroll = () => {
    const el = messageListContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 80-120px threshold; updated strictly in ref without triggering re-renders
    isNearBottomRef.current = distanceFromBottom <= 100;
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior });
    } else if (messageListContainerRef.current) {
      messageListContainerRef.current.scrollTo({
        top: messageListContainerRef.current.scrollHeight,
        behavior
      });
    }
  };

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom('smooth');
    }
  }, [messages, streamingContent]);

  useEffect(() => {
    isNearBottomRef.current = true;
    const timer = setTimeout(() => {
      scrollToBottom('auto');
    }, 50);
    return () => clearTimeout(timer);
  }, [sessionId]);

  const executeChatTurnStream = async (
    formattedMessages: { role: string; content: string; attachments?: string[] }[],
    options?: { suppressToast?: boolean }
  ) => {
    lastFailedFormattedMessagesRef.current = formattedMessages;
    setIsLoading(true);
    try {
      const customDirectives = getCustomDirectives() || undefined;
      const chatVoiceCfg = getChatVoiceConfig(selectedPersonaId as any, companionIdentity);
      const effectiveInstruction = buildSierraSystemInstruction(selectedPersonaId, contentMode, customDirectives, undefined, companionIdentity, chatVoiceCfg.accent, chatVoiceCfg.tone);
      const effectiveChatModel = selectedModelId;
      setGeminiQuotaExhausted(false);
      setChatAuth401Provider(null);
      setChatOpenRouterError(null);
      setChatRequestError(null);
      let fullContent = "";
      setStreamingContent("");
      setStreamingMetadata(null);

      let aiMessageRef: any = null;
      if (user && db) {
        try {
          aiMessageRef = await addDoc(collection(db, `users/${user.uid}/sessions/${sessionId}/messages`), {
            role: 'model',
            content: "",
            timestamp: Date.now(),
            modelName: effectiveChatModel,
            contentMode,
          });
        } catch (error) {
          console.warn("Could not create AI message in Firestore:", error);
        }
      }

      let chunkCount = 0;
      let lastMetadata: any = null;

      await new Promise<void>((resolve, reject) => {
        streamChat(
          {
            messages: formattedMessages,
            systemInstruction: effectiveInstruction,
            provider: activeProvider,
            model: effectiveChatModel,
            contentMode,
            temperature,
            topP,
            topK,
            useSearch,
            useMaps,
            responseSpeed,
          },
          {
            onChunk: (chunkText) => {
              fullContent += chunkText;
              setStreamingContent(fullContent);
              chunkCount++;
              if (chunkCount % 5 === 0 && user && db && aiMessageRef) {
                updateDoc(doc(db, `users/${user.uid}/sessions/${sessionId}/messages`, aiMessageRef.id), {
                  content: fullContent,
                  groundingMetadata: lastMetadata
                }).catch(() => {});
              }
            },
            onMetadata: (metadata) => {
              lastMetadata = metadata;
              setStreamingMetadata(metadata);
              if (metadata?.answeredModel) {
                setLastAnsweredModel(metadata.answeredModel);
              }
              if (metadata?.geminiQuotaExhausted) {
                setGeminiQuotaExhausted(true);
              }
              if (metadata?.auth401Provider) {
                setChatAuth401Provider(String(metadata.auth401Provider));
              }
              if (metadata?.ollamaFallbackNotice) {
                toast.warning(metadata.ollamaFallbackNotice, { duration: 6000 });
              }
              if (metadata?.openRouterFallbackNotice) {
                toast.info(metadata.openRouterFallbackNotice, { duration: 5000 });
              }
            },
            onDone: () => {
              resolve();
            },
            onError: (err) => reject(err),
          }
        );
      });

      lastFailedFormattedMessagesRef.current = null;
      const actualAnsweredModel = lastMetadata?.answeredModel || effectiveChatModel;
      setLastAnsweredModel(actualAnsweredModel);

      // Update state immediately with completed AI response and the model that actually answered
      const completedAiMessage: ChatMessage = {
        id: aiMessageRef?.id || `ai-${Date.now()}`,
        role: 'model',
        content: fullContent,
        timestamp: Date.now(),
        modelName: actualAnsweredModel,
        groundingMetadata: lastMetadata
      };

      setMessages(prev => {
        const next = prev.some(m => m.id === completedAiMessage.id)
          ? prev.map(m => m.id === completedAiMessage.id ? completedAiMessage : m)
          : [...prev, completedAiMessage];
        // Persist to local chatStore on every change
        saveStoredMessages(sessionId, next);
        return next;
      });

      // Clear streaming state immediately so the final rendered bubble shows without delay
      setStreamingContent("");
      setStreamingMetadata(null);
      setIsLoading(false);

      if (user && db && aiMessageRef) {
        try {
          await updateDoc(doc(db, `users/${user.uid}/sessions/${sessionId}/messages`, aiMessageRef.id), {
            content: fullContent,
            modelName: actualAnsweredModel,
            groundingMetadata: lastMetadata
          });
        } catch (error) {
          console.warn("Could not update message in Firestore:", error);
        }
      }

      // Fire-and-forget speech synthesis (NEVER blocks UI or message rendering)
      if (isChatSpeechEnabled() && fullContent.trim()) {
        try {
          speakTextChatReply(fullContent).catch((ttsErr) => {
            console.warn("Non-fatal text chat speech error:", ttsErr);
          });
        } catch (ttsErr) {
          console.warn("Could not initiate spoken reply:", ttsErr);
        }
      }
    } catch (error: any) {
      console.error("Chat error:", error);
      const rawErrMsg = error?.message || String(error || "Failed to get AI response");
      const isGemini429 =
        activeProvider === 'gemini' && isGeminiQuotaExhaustedError(rawErrMsg);
      const errMsg =
        activeProvider === 'ollama' && isOllamaUnreachableFetchError(error)
          ? formatOllamaConnectionError(error)
          : isGemini429 && !rawErrMsg.toLowerCase().includes('gemini quota exhausted')
            ? `${GEMINI_QUOTA_EXHAUSTED_MESSAGE}: ${rawErrMsg}`
            : rawErrMsg;
      const errModel =
        activeProvider === 'openrouter' ? selectedModelId : getEffectiveTextModel(selectedModelId);
      logQuotaOrRateLimitError('Chat', errModel, errMsg);
      addDebugLog('Chat:Error', `[Chat] Provider=${activeProvider} Model=${errModel} Error: ${errMsg}`);
      if (isGemini429) {
        setGeminiQuotaExhausted(true);
      }
      const is401 =
        (error as any)?.status === 401 ||
        Boolean((error as any)?.auth401Provider) ||
        rawErrMsg.toLowerCase().includes('invalid or unrecognized api key') ||
        rawErrMsg.includes('(401)');
      if (is401) {
        setChatAuth401Provider((error as any)?.auth401Provider || activeProvider);
      } else if (activeProvider === 'openrouter') {
        setChatOpenRouterError(errMsg);
      }
      setChatRequestError(errMsg);
      if (!options?.suppressToast) {
        toast.error(errMsg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetryLastChat = async () => {
    if (isLoading) return;
    const saved = lastFailedFormattedMessagesRef.current;
    if (saved && saved.length > 0) {
      await executeChatTurnStream(saved);
      return;
    }
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIdx < 0) return;
    const forwardIdx = messages.length - 1 - lastUserIdx;
    const slice = isMultiTurn ? messages.slice(0, forwardIdx + 1) : [messages[forwardIdx]];
    await executeChatTurnStream(
      slice.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }))
    );
  };

  const handleSend = async () => {
    const messageText = input.trim();
    if ((!messageText && attachments.length === 0) || isLoading || messageText.length > MAX_MESSAGE_LENGTH) return;

    triggerHaptic('light');
    // Stop any ongoing spoken audio immediately on send
    stopSpeaking('User sent new message');

    const currentAttachments = [...attachments];
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
      attachments: currentAttachments.map(a => a.preview)
    };

    const isFirstUserTurn = !messages.some((m) => m.role === 'user');
    const shouldAutoTitle =
      isFirstUserTurn &&
      messageText &&
      (sessionTitle === 'New Chat' || sessionTitle === 'Neural Chat');
    const derivedTitle = shouldAutoTitle ? deriveChatTitleFromMessage(messageText, 40) : null;
    if (derivedTitle) {
      setSessionTitle(derivedTitle);
    }

    const priorMessagesSnapshot = [...messages];
    setMessages(prev => {
      const next = [...prev, userMessage];
      saveStoredMessages(sessionId, next);
      return next;
    });
    isNearBottomRef.current = true;
    scrollToBottom('smooth');
    setInput('');
    setAttachments([]);

    // Save user message to Firestore if available
    if (user && db) {
      try {
        await addDoc(collection(db, `users/${user.uid}/sessions/${sessionId}/messages`), userMessage);
        if (derivedTitle) {
          await setDoc(doc(db, `users/${user.uid}/sessions/${sessionId}`), { title: derivedTitle }, { merge: true });
        }
      } catch (error) {
        console.warn("Could not persist message to Firestore:", error);
      }
    }

    // Prepare contents for Chat
    let formattedMessages: { role: string; content: string; attachments?: string[] }[] = [];
    if (isMultiTurn) {
      formattedMessages = priorMessagesSnapshot.map(m => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }));
    }

    formattedMessages.push({
      role: 'user',
      content: messageText,
      attachments: currentAttachments.map(a => a.preview),
    });

    await executeChatTurnStream(formattedMessages);
  };

  return (
    <>
      <div
        className="flex h-full min-h-0 w-full overflow-hidden relative bg-[#0A0E14] text-slate-100"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 backdrop-blur-sm border-2 border-dashed flex items-center justify-center pointer-events-none"
              style={{
                backgroundColor: `rgba(${accentRgb}, 0.08)`,
                borderColor: accentHex,
              }}
            >
              <div className="sci-card p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: `rgba(${accentRgb}, 0.16)` }}
                >
                  <Paperclip className="w-8 h-8" style={{ color: accentHex }} />
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-display font-bold text-white">Drop files here</h3>
                  <p className="text-[#C8CDD3] text-sm mt-1">
                    {Object.values(SUPPORTED_TYPES).join(' • ')}
                  </p>
                  <p className="text-[#C8CDD3]/60 text-[10px] mt-2 uppercase tracking-widest font-bold">
                    Max 20MB per file
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile Chat Sessions Picker (Fixed Full-Viewport Safe-Area Drawer — never overlaps or clips off-screen) */}
        <AnimatePresence>
          {isSidebarOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Chat sessions drawer"
              className="md:hidden fixed inset-0 z-50 flex"
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/75 backdrop-blur-sm"
                onClick={() => setIsSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', bounce: 0.08, duration: 0.24 }}
                className="relative z-10 w-80 max-w-[85vw] h-full bg-[#0A0E14] border-r border-[#C8CDD3]/20 flex flex-col shadow-2xl overflow-hidden"
                style={{
                  paddingTop: 'max(16px, env(safe-area-inset-top))',
                  paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
                }}
              >
                <div className="px-4 pb-3 border-b border-[#C8CDD3]/15 flex items-center justify-between gap-2 shrink-0">
                  <Button
                    onClick={() => {
                      handleCreateSession();
                      setIsSidebarOpen(false);
                    }}
                    className="flex-1 min-h-[48px] bg-[#101620] hover:bg-white/10 text-white border border-[#C8CDD3]/20 rounded-xl gap-2 shadow-sm"
                  >
                    <Plus className="w-4 h-4" style={{ color: accentHex }} />
                    <span className="text-xs font-bold uppercase tracking-widest">New Chat</span>
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="min-h-[48px] min-w-[48px] text-[#C8CDD3] hover:text-white rounded-xl"
                    onClick={() => setIsSidebarOpen(false)}
                    aria-label="Close chat picker"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
                  <h3 className="px-3 mb-2 text-[10px] font-bold text-[#C8CDD3]/65 uppercase tracking-[0.2em] flex items-center gap-2">
                    <History className="w-3.5 h-3.5" />
                    Recent Sessions
                  </h3>
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => {
                        setSessionId(s.id);
                        setIsSidebarOpen(false);
                      }}
                      className={cn(
                        'group relative min-h-[48px] flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all border',
                        sessionId === s.id
                          ? 'bg-[#101620] text-white'
                          : 'border-transparent text-[#C8CDD3] hover:bg-[#101620]/60 hover:text-white'
                      )}
                      style={
                        sessionId === s.id
                          ? {
                              borderColor: `rgba(${accentRgb}, 0.45)`,
                              boxShadow: `0 0 12px rgba(${accentRgb}, 0.14)`,
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <MessageSquare
                          className="w-4 h-4 shrink-0"
                          style={{ color: sessionId === s.id ? accentHex : '#94A3B8' }}
                        />
                        <span className="text-sm truncate font-medium">{s.title}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="min-h-[40px] min-w-[40px] text-[#C8CDD3]/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg shrink-0"
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        aria-label={`Delete ${s.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        {/* Desktop Collapsible Sessions Sidebar */}
        <AnimatePresence mode="wait">
          {isSidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 270, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="hidden md:flex bg-[#0A0E14] border-r border-[#C8CDD3]/15 flex-col h-full overflow-hidden shrink-0"
            >
              <div className="p-4 border-b border-[#C8CDD3]/15 flex items-center justify-between gap-2 shrink-0">
                <Button
                  onClick={handleCreateSession}
                  className="flex-1 min-h-[48px] bg-[#101620] hover:bg-white/10 text-white border border-[#C8CDD3]/20 rounded-xl gap-2 shadow-sm"
                >
                  <Plus className="w-4 h-4" style={{ color: accentHex }} />
                  <span className="text-xs font-bold uppercase tracking-widest">New Chat</span>
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-1">
                  <h3 className="px-3 mb-2 text-[10px] font-bold text-[#C8CDD3]/60 uppercase tracking-[0.2em] flex items-center gap-2">
                    <History className="w-3 h-3" />
                    Recent Sessions
                  </h3>
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setSessionId(s.id)}
                      className={cn(
                        'group relative min-h-[48px] flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all border',
                        sessionId === s.id
                          ? 'bg-[#101620] text-white'
                          : 'border-transparent text-[#C8CDD3]/80 hover:bg-[#101620]/60 hover:text-white'
                      )}
                      style={
                        sessionId === s.id
                          ? { borderColor: `rgba(${accentRgb}, 0.45)` }
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <MessageSquare
                          className="w-4 h-4 shrink-0"
                          style={{ color: sessionId === s.id ? accentHex : '#94A3B8' }}
                        />
                        <span className="text-sm truncate font-medium">{s.title}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="min-h-[36px] min-w-[36px] opacity-0 group-hover:opacity-100 text-[#C8CDD3]/60 hover:text-red-400 transition-all hover:bg-red-500/10"
                        onClick={(e) => handleDeleteSession(s.id, e)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </motion.aside>
          )}
        </AnimatePresence>

      <div className="flex flex-col h-full min-h-0 flex-1 min-w-0 bg-[#0A0E14] relative overflow-hidden">
        {/* Clean Minimal Header — All secondary controls live in the Header Overflow Menu */}
        <header
          className="px-3 pb-2.5 border-b border-[#C8CDD3]/15 flex flex-col gap-2 bg-[#0A0E14]/95 backdrop-blur-md sticky top-0 z-20 shrink-0"
          style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}
        >
          <div className="flex items-center justify-between gap-2 w-full min-w-0">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <Button
                size="icon"
                variant="ghost"
                className="min-h-[48px] min-w-[48px] text-[#C8CDD3] hover:text-white rounded-xl shrink-0"
                onClick={toggleSidebar}
                title="Open Chats Drawer"
                aria-label="Open Chats Drawer"
              >
                <Sidebar className="w-5 h-5" />
              </Button>

              {isRenaming ? (
                <div className="flex items-center gap-1 flex-1 max-w-xs min-w-0">
                  <Input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRenameSession()}
                    className="h-10 bg-[#101620] border-[#C8CDD3]/25 text-xs px-2.5"
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="min-h-[48px] min-w-[48px] text-cyan-400 shrink-0"
                    onClick={handleRenameSession}
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="min-h-[48px] min-w-[48px] text-red-400 shrink-0"
                    onClick={() => setIsRenaming(false)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    className="min-h-[48px] flex items-center gap-1.5 text-sm font-display font-semibold text-white truncate transition-colors text-left min-w-0 px-1.5 rounded-xl hover:bg-white/5"
                    title="Switch chat session"
                  >
                    <span className="truncate max-w-[160px] sm:max-w-[260px]">{sessionTitle}</span>
                    <ChevronDown className="w-4 h-4 text-[#C8CDD3]/60 shrink-0" />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-[48px] min-w-[48px] text-[#C8CDD3]/70 hover:text-white shrink-0 rounded-xl"
                    onClick={() => {
                      setNewTitle(sessionTitle);
                      setIsRenaming(true);
                    }}
                    title="Rename Chat"
                    aria-label="Rename Chat"
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Read-Only Active Provider + Model Label (Change in Settings) */}
            <button
              type="button"
              data-testid="chat-active-model-chip"
              onClick={() => onOpenSettings?.('models')}
              title="Active Chat provider & model — Change in Settings"
              className="min-h-[40px] max-w-[205px] sm:max-w-[270px] px-2.5 py-1 rounded-full bg-[#101620] border border-[#C8CDD3]/20 hover:border-cyan-400/50 text-[11px] font-medium text-[#C8CDD3] hover:text-white flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: accentHex }}
              />
              <span className="truncate">
                {activeProviderMeta?.name?.replace('Google ', '').replace('Anthropic ', '') || activeProvider} ·{' '}
                <span className="font-mono text-white">
                  {formatShortModelDisplayName(lastAnsweredModel || selectedModelId)}
                </span>
              </span>
              <span className="text-[10px] shrink-0 underline ml-0.5" style={{ color: accentHex }}>
                Change in Settings
              </span>
            </button>

            {/* Single Header Overflow / Options Menu */}
            <div className="relative shrink-0">
              <Button
                variant="ghost"
                size="sm"
                data-testid="chat-options-menu-btn"
                onClick={() => setIsTopMenuOpen((prev) => !prev)}
                className={cn(
                  'min-h-[48px] px-2.5 text-xs gap-1.5 rounded-xl border bg-[#101620] hover:bg-white/5',
                  isParamsOpen || isTopMenuOpen ? 'text-white' : 'text-[#C8CDD3] border-[#C8CDD3]/20'
                )}
                style={
                  isParamsOpen || isTopMenuOpen
                    ? { borderColor: accentHex, color: accentHex }
                    : undefined
                }
                title="Chat Options, Persona & Grounding"
              >
                <MoreVertical className="w-4 h-4 shrink-0" />
              </Button>

              {isTopMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
                    onClick={() => setIsTopMenuOpen(false)}
                  />
                  <div
                    data-testid="chat-options-overflow-menu"
                    className="fixed inset-x-3 top-[max(72px,calc(env(safe-area-inset-top)+60px))] sm:inset-x-auto sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-[360px] max-h-[75dvh] overflow-y-auto rounded-2xl bg-[#0A0E14] border border-[#C8CDD3]/25 shadow-2xl p-4 z-50 space-y-3.5"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-[#C8CDD3]/15">
                      <span className="text-xs font-display font-bold uppercase tracking-wider text-white">
                        Chat Options &amp; Model
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsTopMenuOpen(false)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[#C8CDD3] hover:text-white"
                        aria-label="Close options"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Read-Only Active Engine Summary (Editable only in Settings) */}
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsTopMenuOpen(false);
                          onOpenSettings?.('models');
                        }}
                        className="w-full min-h-[48px] px-3 py-2 rounded-xl bg-[#101620] border border-[#C8CDD3]/20 hover:border-cyan-400/40 text-left flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[#C8CDD3]/65">
                            Active Engine
                          </div>
                          <div className="text-xs font-semibold text-white truncate">
                            {activeProviderMeta?.name || activeProvider} ·{' '}
                            <span className="font-mono" style={{ color: accentHex }}>
                              {formatShortModelDisplayName(selectedModelId)}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold shrink-0 underline" style={{ color: accentHex }}>
                          Change in Settings
                        </span>
                      </button>

                      <div
                        data-testid="chat-answered-model-label"
                        className="px-3 py-2 rounded-xl bg-[#101620] border border-[#C8CDD3]/15 text-[11px] font-mono text-[#C8CDD3] flex items-center justify-between gap-2"
                      >
                        <span>Answered:</span>
                        <span className="font-semibold truncate" style={{ color: accentHex }}>
                          {lastAnsweredModel || selectedModelId}
                        </span>
                      </div>
                    </div>

                    {/* Persona, Voice & Read-Only Content Mode */}
                    <div className="space-y-2 pt-1 border-t border-[#C8CDD3]/15">
                      <button
                        type="button"
                        onClick={() => {
                          setIsTopMenuOpen(false);
                          onOpenSettings?.('persona');
                        }}
                        className="w-full min-h-[44px] px-3 rounded-xl bg-[#101620] border border-[#C8CDD3]/15 hover:border-[#C8CDD3]/35 text-xs flex items-center justify-between transition-colors"
                      >
                        <span className="flex items-center gap-2 text-[#C8CDD3]">
                          {contentMode === 'mature' ? (
                            <Flame className="w-3.5 h-3.5 text-rose-400" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                          )}
                          <span>Content Mode</span>
                        </span>
                        <span className="font-semibold text-white">
                          {contentMode === 'mature' ? '18+ Mature' : 'SFW Mode'}
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="chat-control-persona"
                        onClick={() => {
                          setIsTopMenuOpen(false);
                          addDebugLog(
                            'ChatSelector:Tap',
                            `[ChatSelector:Tap] Persona selector tapped (identity=${companionIdentity}, persona=${selectedPersonaId})`
                          );
                          setIsPersonaModalOpen(true);
                        }}
                        className="w-full min-h-[48px] px-3 rounded-xl bg-[#101620] border border-[#C8CDD3]/20 hover:border-[#C8CDD3]/40 text-xs text-white flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2">
                          <span>{IDENTITIES[companionIdentity]?.avatar || '👩'}</span>
                          <span className="font-semibold">{IDENTITIES[companionIdentity]?.name || 'Sierra'}</span>
                        </span>
                        <span className="text-[#C8CDD3]/75">
                          {UNIFIED_PERSONAS[selectedPersonaId as PersonaId]?.name || selectedPersonaId}
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="chat-control-voice"
                        onClick={() => {
                          setIsTopMenuOpen(false);
                          addDebugLog(
                            'ChatSelector:Tap',
                            `[ChatSelector:Tap] Voice/Accent/Tone selector tapped (voice=${chatVoiceId}, accent=${chatAccent}, tone=${chatTone})`
                          );
                          setIsChatVoiceModalOpen(true);
                        }}
                        className="w-full min-h-[48px] px-3 rounded-xl bg-[#101620] border border-[#C8CDD3]/20 hover:border-[#C8CDD3]/40 text-xs text-white flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2">
                          <Volume2 className="w-4 h-4" style={{ color: accentHex }} />
                          <span>Chat Voice</span>
                        </span>
                        <span className="text-[#C8CDD3]/75 truncate max-w-[160px]">
                          {OPEN_VOICE_POOL.find((v) => v.id === chatVoiceId)?.name || chatVoiceId}
                        </span>
                      </button>
                    </div>

                    {/* Grounding, TTS, Context, Params */}
                    <div className="space-y-2 pt-1 border-t border-[#C8CDD3]/15">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          data-testid="chat-control-tts"
                          onClick={() => {
                            const next = !isChatSpeechActive;
                            addDebugLog('ChatSelector:Tap', `[ChatSelector:Tap] TTS toggle tapped -> ${next ? 'ON' : 'MUTED'}`);
                            setIsChatSpeechActive(next);
                            setChatSpeechEnabled(next);
                            if (!next) {
                              stopSpeaking('User muted TTS chip');
                            }
                            toast.success(next ? 'Voice enabled' : 'Voice muted');
                          }}
                          className={cn(
                            'min-h-[48px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5',
                            isChatSpeechActive
                              ? 'bg-white/10 text-white'
                              : 'bg-[#101620] text-[#C8CDD3]/70 border-[#C8CDD3]/15'
                          )}
                          style={isChatSpeechActive ? { borderColor: accentHex, color: accentHex } : undefined}
                        >
                          {isChatSpeechActive ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                          <span>{isChatSpeechActive ? 'TTS: On' : 'TTS: Off'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setIsMultiTurn(!isMultiTurn)}
                          className={cn(
                            'min-h-[48px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5',
                            isMultiTurn
                              ? 'bg-white/10 text-white'
                              : 'bg-[#101620] text-[#C8CDD3]/70 border-[#C8CDD3]/15'
                          )}
                          style={isMultiTurn ? { borderColor: accentHex, color: accentHex } : undefined}
                        >
                          {isMultiTurn ? <MessagesSquare className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                          <span>{isMultiTurn ? 'Context: Full' : 'Context: 1-Turn'}</span>
                        </button>
                      </div>

                      <div className="flex items-center justify-between px-3 min-h-[48px] rounded-xl bg-[#101620] border border-[#C8CDD3]/15">
                        <div className="flex items-center gap-2 text-xs text-[#C8CDD3]">
                          <Search className={cn('w-4 h-4', useSearch ? 'text-cyan-400' : 'text-[#C8CDD3]/50')} />
                          <span>Web Search Grounding</span>
                        </div>
                        <Switch checked={useSearch} onCheckedChange={setUseSearch} />
                      </div>

                      {doesModelSupportMapsGrounding(selectedModelId, activeProvider) ? (
                        <div
                          data-testid="chat-maps-grounding-toggle"
                          className="flex items-center justify-between px-3 min-h-[48px] rounded-xl bg-[#101620] border border-[#C8CDD3]/15"
                        >
                          <div className="flex items-center gap-2 text-xs text-[#C8CDD3]">
                            <MapPin className={cn('w-4 h-4', useMaps ? 'text-cyan-400' : 'text-[#C8CDD3]/50')} />
                            <span>Maps (Chat Places)</span>
                          </div>
                          <Switch checked={useMaps} onCheckedChange={setUseMaps} />
                        </div>
                      ) : (
                        <div
                          data-testid="chat-maps-grounding-unsupported"
                          className="flex items-center gap-2 px-3 min-h-[44px] rounded-xl bg-[#101620]/60 border border-[#C8CDD3]/10 text-[11px] text-[#C8CDD3]/55"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          <span>Maps grounding unavailable for model (open_maps works)</span>
                        </div>
                      )}
                    </div>

                    {/* Actions: Params, Clear Chat, Full Settings */}
                    <div className="space-y-2 pt-1 border-t border-[#C8CDD3]/15">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsTopMenuOpen(false);
                            setIsParamsOpen(true);
                          }}
                          className="min-h-[48px] px-3 rounded-xl bg-[#101620] hover:bg-white/5 border border-[#C8CDD3]/20 text-xs text-white flex items-center justify-center gap-1.5"
                        >
                          <Settings className="w-4 h-4" style={{ color: accentHex }} />
                          <span>Params ({responseSpeed})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsTopMenuOpen(false);
                            setIsClearDialogOpen(true);
                          }}
                          className="min-h-[48px] px-3 rounded-xl bg-[#101620] hover:bg-red-950/35 border border-[#C8CDD3]/20 hover:border-red-500/40 text-xs text-[#C8CDD3] hover:text-red-300 flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Clear Chat</span>
                        </button>
                      </div>

                      {onOpenSettings && (
                        <button
                          type="button"
                          data-testid="chat-open-full-settings"
                          onClick={() => {
                            setIsTopMenuOpen(false);
                            onOpenSettings('models');
                          }}
                          className="w-full min-h-[48px] px-3 rounded-xl bg-[#101620] border border-[#C8CDD3]/20 hover:bg-white/5 text-xs font-semibold flex items-center justify-center gap-2"
                          style={{ color: accentHex }}
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>Open full settings</span>
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* HTTP 401 Invalid API Key Banner (Direct jump to failing provider card) */}
          {chatAuth401Provider && (
            <div
              data-testid="chat-auth-401-banner"
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-red-950/60 border border-red-500/45 text-red-200 text-xs"
            >
              <span className="font-semibold">
                Invalid or unrecognized API key for {PROVIDER_METADATA[chatAuth401Provider]?.name || chatAuth401Provider}
              </span>
              {onOpenSettings && (
                <button
                  type="button"
                  data-testid="chat-auth-401-settings-btn"
                  onClick={() => onOpenSettings('providers', chatAuth401Provider)}
                  className="min-h-[40px] px-3 py-1 rounded-lg bg-red-500/25 hover:bg-red-500/40 border border-red-400/50 text-red-100 text-[11px] font-bold transition-colors"
                >
                  Fix Key in Settings
                </button>
              )}
            </div>
          )}

          {/* OpenRouter Model Error Banner (Explicit User-Initiated Paid Default Fallback Only) */}
          {chatOpenRouterError && !chatAuth401Provider && activeProvider === 'openrouter' && (
            <div
              data-testid="chat-openrouter-error-banner"
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-950/50 border border-amber-500/45 text-amber-200 text-xs"
            >
              <span className="font-medium truncate max-w-[320px]">{chatOpenRouterError}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="chat-retry-btn"
                  onClick={() => void handleRetryLastChat()}
                  disabled={isLoading}
                  className="min-h-[40px] px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/25 text-white text-[11px] font-bold transition-colors disabled:opacity-50"
                >
                  Retry
                </button>
                <button
                  type="button"
                  data-testid="chat-use-paid-default-btn"
                  onClick={() => {
                    void saveProviderConfig({
                      activeProvider: 'openrouter',
                      providerId: 'openrouter',
                      model: OPENROUTER_DEFAULT_PAID_MODEL,
                    });
                    setChatOpenRouterError(null);
                    setChatRequestError(null);
                    toast.success(`Switched to paid default: ${OPENROUTER_DEFAULT_PAID_MODEL}`);
                  }}
                  className="min-h-[40px] px-3 py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/50 text-amber-100 text-[11px] font-bold transition-colors"
                >
                  Use Paid Default
                </button>
              </div>
            </div>
          )}

          {/* Inline Error + Retry Banner for all providers (never resets chosen model) */}
          {chatRequestError && !chatAuth401Provider && !(chatOpenRouterError && activeProvider === 'openrouter') && (
            <div
              data-testid="chat-error-retry-banner"
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-red-950/50 border border-red-500/40 text-red-200 text-xs"
            >
              <span className="font-medium truncate max-w-[360px]">{chatRequestError}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="chat-retry-btn"
                  onClick={() => void handleRetryLastChat()}
                  disabled={isLoading}
                  className="min-h-[40px] px-3 py-1 rounded-lg bg-red-500/25 hover:bg-red-500/40 border border-red-400/50 text-red-100 text-[11px] font-bold transition-colors disabled:opacity-50"
                >
                  Retry
                </button>
                <button
                  type="button"
                  aria-label="Dismiss error"
                  onClick={() => setChatRequestError(null)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-white/10 text-red-200/75"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Gemini 429 Quota Exhausted Banner with One-Tap Switch to OpenRouter */}
          {geminiQuotaExhausted && (
            <div
              data-testid="chat-gemini-quota-banner"
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs"
            >
              <span className="font-semibold">{GEMINI_QUOTA_EXHAUSTED_MESSAGE}</span>
              <button
                type="button"
                data-testid="chat-gemini-429-switch-openrouter"
                onClick={() => {
                  setActiveChatProvider('openrouter');
                  setGeminiQuotaExhausted(false);
                  toast.success('Switched Chat provider to OpenRouter');
                }}
                className="min-h-[40px] px-3 py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/50 text-amber-100 text-[11px] font-bold transition-colors"
              >
                Switch to OpenRouter
              </button>
            </div>
          )}
        </header>

      {/* Params Modal / Bottom Sheet (Collapsed by default, never pushes chat area) */}
      <AnimatePresence>
        {isParamsOpen && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
            onClick={() => setIsParamsOpen(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#0F1520] border-t sm:border border-[#C8CDD3]/20 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[85dvh] flex flex-col"
            >
              <div className="px-4 py-3 border-b border-[#C8CDD3]/15 flex items-center justify-between bg-[#0A0E14]/95">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4" style={{ color: accentHex }} />
                  <h3 className="text-sm font-display font-semibold text-white">Model Generation Parameters</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsParamsOpen(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[#C8CDD3]/75 hover:text-white hover:bg-[#151E2E] transition"
                  aria-label="Close parameters"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 sm:p-5 space-y-5 overflow-y-auto">
                {/* Response Speed Selector (Shown only when the selected model supports thinking/reasoning control) */}
                {doesModelSupportResponseSpeed(selectedModelId, activeProvider) && (
                  <div className="space-y-2 pb-4 border-b border-[#C8CDD3]/15">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-[#C8CDD3] uppercase tracking-wider">
                        Response speed
                      </label>
                      <span
                        className="text-[11px] font-mono px-2 py-0.5 rounded border capitalize"
                        style={{
                          color: accentHex,
                          backgroundColor: `rgba(${accentRgb}, 0.12)`,
                          borderColor: `rgba(${accentRgb}, 0.3)`,
                        }}
                      >
                        {responseSpeed}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#C8CDD3]/70">
                      Controls how fast the model answers: Low is fastest (minimal thinking), Medium is balanced, High uses maximum reasoning depth.
                    </p>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {(['low', 'medium', 'high'] as ResponseSpeedLevel[]).map((lvl) => {
                        const active = responseSpeed === lvl;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => handleResponseSpeedChange(lvl)}
                            style={
                              active
                                ? {
                                    backgroundColor: `rgba(${accentRgb}, 0.16)`,
                                    borderColor: accentHex,
                                    boxShadow: `0 0 12px rgba(${accentRgb}, 0.16)`,
                                  }
                                : undefined
                            }
                            className={cn(
                              "min-h-[48px] py-2 px-3 rounded-xl border text-xs font-semibold capitalize transition flex flex-col items-center gap-0.5",
                              active
                                ? "text-white"
                                : "bg-[#0A0E14] border-[#C8CDD3]/15 text-[#C8CDD3]/75 hover:text-white hover:border-[#C8CDD3]/30"
                            )}
                          >
                            <span>{lvl}</span>
                            <span className="text-[9px] font-normal opacity-75">
                              {lvl === 'low' ? 'Fastest' : lvl === 'medium' ? 'Balanced' : 'Deep Thinking'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#C8CDD3]/80 uppercase tracking-wider">
                      Temperature
                    </label>
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{
                        color: accentHex,
                        backgroundColor: `rgba(${accentRgb}, 0.12)`,
                      }}
                    >
                      {temperature.toFixed(2)}
                    </span>
                  </div>
                  <Slider 
                    value={[temperature]} 
                    onValueChange={(v) => setTemperature(v[0])} 
                    min={0} 
                    max={2} 
                    step={0.01} 
                  />
                  <p className="text-[10px] text-[#C8CDD3]/60">
                    Controls randomness. Higher values make output more creative; lower values make it more focused.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#C8CDD3]/80 uppercase tracking-wider">
                      Top P
                    </label>
                    <span className="text-xs font-mono text-cyan-300 bg-cyan-500/15 px-2 py-0.5 rounded">{topP.toFixed(2)}</span>
                  </div>
                  <Slider 
                    value={[topP]} 
                    onValueChange={(v) => setTopP(v[0])} 
                    min={0} 
                    max={1} 
                    step={0.01} 
                  />
                  <p className="text-[10px] text-[#C8CDD3]/60">
                    Nucleus sampling. Only considers tokens whose cumulative probability exceeds P.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#C8CDD3]/80 uppercase tracking-wider">
                      Top K
                    </label>
                    <span className="text-xs font-mono text-[#C8CDD3] bg-[#C8CDD3]/10 border border-[#C8CDD3]/20 px-2 py-0.5 rounded">{topK}</span>
                  </div>
                  <Slider 
                    value={[topK]} 
                    onValueChange={(v) => setTopK(v[0])} 
                    min={1} 
                    max={100} 
                    step={1} 
                  />
                  <p className="text-[10px] text-[#C8CDD3]/60">
                    Limits the model to the top K most likely tokens at each step.
                  </p>
                </div>
              </div>

              <div className="px-4 py-3 border-t border-[#C8CDD3]/15 bg-[#0A0E14]/95 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => setIsParamsOpen(false)}
                  style={{ backgroundColor: accentHex, color: '#05080D' }}
                  className="min-h-[44px] font-bold text-xs rounded-xl px-5 hover:opacity-90"
                >
                  Close
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div 
        ref={messageListContainerRef}
        onScroll={handleMessageListScroll}
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        className="flex-1 min-h-0 overflow-y-auto p-4 select-text overscroll-contain"
      >
        <div className="space-y-6 pb-20">
          {messages.length === 0 && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-5 py-12">
              <div className="space-y-4">
                <div
                  className="w-16 h-16 rounded-3xl bg-[#101620] flex items-center justify-center border mx-auto shadow-2xl"
                  style={{
                    borderColor: `rgba(${accentRgb}, 0.4)`,
                    boxShadow: `0 0 28px rgba(${accentRgb}, 0.18)`,
                  }}
                >
                  <span className="text-2xl">{IDENTITIES[companionIdentity]?.avatar || '👩'}</span>
                </div>
                <div>
                  <h3 className="text-2xl font-display font-bold tracking-tight text-white">
                    Chat with {IDENTITIES[companionIdentity]?.name || 'Sierra'}
                  </h3>
                  <p className="text-sm text-[#C8CDD3]/70 max-w-xs mx-auto mt-2">
                    {UNIFIED_PERSONAS[selectedPersonaId as PersonaId]?.name || 'Confident'} persona ready. Ask anything below.
                  </p>
                </div>
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages
              .filter((m) => !(isLoading && streamingContent && m.role === 'model' && m.content === ''))
              .map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'flex gap-3 sm:gap-4 max-w-[90%] sm:max-w-[85%]',
                    msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''
                  )}
                >
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border',
                      msg.role === 'user' ? 'bg-[#101620] border-[#C8CDD3]/25' : 'bg-[#101620]'
                    )}
                    style={
                      msg.role === 'model'
                        ? {
                            borderColor: `rgba(${accentRgb}, 0.45)`,
                            boxShadow: `0 0 14px rgba(${accentRgb}, 0.18)`,
                          }
                        : undefined
                    }
                  >
                    {msg.role === 'user' ? (
                      <User className="w-5 h-5 text-[#C8CDD3]" />
                    ) : (
                      <Bot className="w-5 h-5" style={{ color: accentHex }} />
                    )}
                  </div>
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <div
                      className={cn(
                        'flex items-center gap-2 px-1',
                        msg.role === 'user' ? 'flex-row-reverse' : ''
                      )}
                    >
                      <span className="text-[10px] font-bold text-[#C8CDD3]/70 uppercase tracking-widest">
                        {msg.role === 'user' ? 'You' : IDENTITIES[companionIdentity]?.name || 'Sierra'}
                      </span>
                      <span className="text-[10px] text-[#C8CDD3]/45">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div
                      className={cn(
                        'space-y-2 p-4 sm:p-5 rounded-2xl relative group/msg border shadow-lg',
                        msg.role === 'user'
                          ? 'text-slate-100 rounded-tr-sm'
                          : 'bg-[#101620] text-slate-100 border-[#C8CDD3]/20 rounded-tl-sm'
                      )}
                      style={
                        msg.role === 'user'
                          ? {
                              backgroundColor: `rgba(${accentRgb}, 0.13)`,
                              borderColor: `rgba(${accentRgb}, 0.38)`,
                            }
                          : undefined
                      }
                    >
                      {msg.videoUrl && (
                        <div className="mb-4 rounded-xl overflow-hidden border border-[#C8CDD3]/20 bg-black">
                          <video src={msg.videoUrl} controls className="w-full h-auto" />
                        </div>
                      )}
                      {msg.role === 'model' && msg.modelName && (
                        <div className="flex items-center gap-2 mb-3">
                          <div
                            data-testid="chat-bubble-answered-model"
                            className="px-2.5 py-0.5 rounded-full bg-[#0A0E14] border border-[#C8CDD3]/20 text-[9px] font-bold uppercase tracking-widest"
                            style={{ color: accentHex }}
                          >
                            Answered by: {msg.modelName}
                          </div>
                          <div className="h-px flex-1 bg-[#C8CDD3]/10" />
                        </div>
                      )}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.attachments.map((att, i) => {
                        const isImage = att.startsWith('data:image');
                        const isVideo = att.startsWith('data:video');
                        const isAudio = att.startsWith('data:audio');
                        const isPDF = att.startsWith('data:application/pdf');

                        return (
                          <div key={i} className="relative group rounded-lg overflow-hidden border border-zinc-700 max-w-[200px] bg-zinc-950">
                            {isImage ? (
                              <img src={att} alt="Attachment" className="w-full h-auto max-h-40 object-cover" />
                            ) : isVideo ? (
                              <video src={att} className="w-full h-auto max-h-40" controls />
                            ) : isAudio ? (
                              <div className="p-2 min-w-[150px]">
                                <audio src={att} className="w-full h-8" controls />
                              </div>
                            ) : (
                              <div className="p-3 bg-zinc-900 flex items-center gap-2">
                                {isPDF ? <FileIcon className="w-4 h-4 text-red-400" /> : <FileIcon className="w-4 h-4 text-zinc-400" />}
                                <span className="text-xs text-zinc-300 truncate">
                                  {isPDF ? 'PDF Document' : 'Text File'}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="prose prose-invert max-w-none text-sm leading-relaxed prose-p:leading-relaxed prose-pre:p-0 prose-headings:tracking-tight prose-a:text-cyan-400 prose-strong:text-slate-100">
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => <h1 className="text-xl font-bold mt-8 mb-4 text-white tracking-tight border-b border-[#C8CDD3]/15 pb-2">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-lg font-bold mt-6 mb-3 text-slate-100 tracking-tight">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-base font-bold mt-5 mb-2 text-slate-200 tracking-tight">{children}</h3>,
                        p: ({ children }) => <p className="mb-4 text-slate-200/90 leading-relaxed last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-2 text-slate-200/90 marker:text-cyan-400/60">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-2 text-slate-200/90 marker:text-cyan-400/60">{children}</ol>,
                        li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
                        hr: () => <hr className="my-8 border-[#C8CDD3]/15" />,
                        a: ({ href, children }) => (
                          <a 
                            href={href} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4 decoration-cyan-400/35 transition-colors"
                          >
                            {children}
                          </a>
                        ),
                        strong: ({ children }) => <strong className="font-bold text-slate-100">{children}</strong>,
                        em: ({ children }) => <em className="italic text-[#C8CDD3]/80">{children}</em>,
                        table: ({ children }) => (
                          <div className="my-6 overflow-x-auto rounded-xl border border-[#C8CDD3]/15 bg-[#0A0E14]/70">
                            <table className="w-full text-left border-collapse">
                              {children}
                            </table>
                          </div>
                        ),
                        thead: ({ children }) => <thead className="bg-[#101620] border-b border-[#C8CDD3]/15">{children}</thead>,
                        th: ({ children }) => <th className="px-4 py-3 text-xs font-bold text-[#C8CDD3] uppercase tracking-widest">{children}</th>,
                        td: ({ children }) => <td className="px-4 py-3 text-sm text-slate-200/90 border-t border-[#C8CDD3]/10">{children}</td>,
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-cyan-400/40 pl-6 py-2 my-6 italic text-[#C8CDD3]/85 bg-cyan-500/5 rounded-r-xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-cyan-400/25" />
                            {children}
                          </blockquote>
                        ),
                        code(props) {
                          const { children, className, node, ...rest } = props;
                          const match = /language-(\w+)/.exec(className || '');
                          const codeContent = String(children).replace(/\n$/, '');
                          
                          return match ? (
                            <div className="relative group my-6">
                              <div className="flex items-center justify-between px-4 py-2 bg-[#0A0E14] border-x border-t border-[#C8CDD3]/20 rounded-t-xl">
                                <div className="flex items-center gap-2">
                                  <div className="flex gap-1">
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#C8CDD3]/25" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#C8CDD3]/25" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#C8CDD3]/25" />
                                  </div>
                                  <span className="text-[10px] font-bold text-[#C8CDD3]/65 uppercase tracking-widest ml-2">{match[1]}</span>
                                </div>
                                <CopyButton text={codeContent} />
                              </div>
                              <SyntaxHighlighter
                                PreTag="div"
                                language={match[1]}
                                style={vscDarkPlus}
                                customStyle={{
                                  margin: 0,
                                  borderRadius: '0 0 0.75rem 0.75rem',
                                  background: '#0A0E14',
                                  border: '1px solid rgba(200,205,211,0.2)',
                                  padding: '1.5rem',
                                  fontSize: '0.85rem',
                                  lineHeight: '1.6'
                                }}
                              >
                                {codeContent}
                              </SyntaxHighlighter>
                            </div>
                          ) : (
                            <code {...rest} className={cn("bg-[#0A0E14]/80 border border-[#C8CDD3]/20 px-1.5 py-0.5 rounded text-cyan-300 font-mono text-[0.8em]", className)}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#C8CDD3]/10 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 px-2 text-[10px] font-bold text-[#C8CDD3]/60 uppercase tracking-widest hover:text-white gap-1.5"
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content);
                          toast.success("Message copied to clipboard");
                        }}
                      >
                        <Copy className="w-3 h-3" />
                        Copy Message
                      </Button>
                      <SpeakButton text={msg.content} />
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 px-2 text-[10px] font-bold text-[#C8CDD3]/60 uppercase tracking-widest hover:text-cyan-400 gap-1.5 transition-colors"
                        onClick={() => openVideoModal(msg.content)}
                        title="Generate Video from this message"
                      >
                        <Video className="w-3 h-3" />
                        Video
                      </Button>
                    </div>
                    {msg.role === 'model' && (
                      <div className="text-[9px] font-medium text-zinc-600 italic">
                        Generated in real-time
                      </div>
                    )}
                  </div>
                  
                  {msg.groundingMetadata && <GroundingMetadata metadata={msg.groundingMetadata} />}
                </div>
              </div>
            </motion.div>
            ))}
          </AnimatePresence>
          
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-4 max-w-[85%]"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: `rgba(${accentRgb}, 0.14)`,
                  borderColor: `rgba(${accentRgb}, 0.4)`,
                  boxShadow: `0 0 15px rgba(${accentRgb}, 0.22)`,
                }}
              >
                <Bot className="w-5 h-5 animate-pulse" style={{ color: accentHex }} />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] font-bold text-[#C8CDD3]/70 uppercase tracking-widest">{IDENTITIES[companionIdentity]?.name || 'Sierra'}</span>
                  <span className="text-[10px] text-[#C8CDD3]/55 animate-pulse">
                    {streamingContent ? "Responding..." : "Processing..."}
                  </span>
                </div>
                <div className={cn(
                  "space-y-2 p-5 rounded-2xl relative shadow-xl",
                  streamingContent ? "bg-[#101620] border border-[#C8CDD3]/20" : "bg-[#101620]/70 border border-[#C8CDD3]/15"
                )}>
                  {!streamingContent ? (
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1">
                        <motion.div 
                          animate={{ scale: [1, 1.2, 1] }} 
                          transition={{ repeat: Infinity, duration: 1, delay: 0 }}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: accentHex }}
                        />
                        <motion.div 
                          animate={{ scale: [1, 1.2, 1] }} 
                          transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                          className="w-1.5 h-1.5 rounded-full opacity-60"
                          style={{ backgroundColor: accentHex }}
                        />
                        <motion.div 
                          animate={{ scale: [1, 1.2, 1] }} 
                          transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                          className="w-1.5 h-1.5 rounded-full opacity-35"
                          style={{ backgroundColor: accentHex }}
                        />
                      </div>
                      <span className="text-sm text-[#C8CDD3]/80 font-medium">Synthesizing response...</span>
                    </div>
                  ) : (
                    <div className="prose prose-invert max-w-none text-sm leading-relaxed prose-p:leading-relaxed prose-pre:p-0 prose-headings:tracking-tight prose-a:text-cyan-400 prose-strong:text-slate-100">
                      <ReactMarkdown
                        components={{
                          h1: ({ children }) => <h1 className="text-xl font-bold mt-8 mb-4 text-white tracking-tight border-b border-[#C8CDD3]/15 pb-2">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-lg font-bold mt-6 mb-3 text-slate-100 tracking-tight">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-base font-bold mt-5 mb-2 text-slate-200 tracking-tight">{children}</h3>,
                          p: ({ children }) => <p className="mb-4 text-slate-200/90 leading-relaxed last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-2 text-slate-200/90 marker:text-cyan-400/60">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-2 text-slate-200/90 marker:text-cyan-400/60">{children}</ol>,
                          li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
                          code(props) {
                            const { children, className, node, ...rest } = props;
                            const match = /language-(\w+)/.exec(className || '');
                            const codeContent = String(children).replace(/\n$/, '');
                            
                            return match ? (
                              <div className="relative group my-6">
                                <div className="flex items-center justify-between px-4 py-2 bg-[#0A0E14] border-x border-t border-[#C8CDD3]/20 rounded-t-xl">
                                  <div className="flex items-center gap-2">
                                    <div className="flex gap-1">
                                      <div className="w-2.5 h-2.5 rounded-full bg-[#C8CDD3]/25" />
                                      <div className="w-2.5 h-2.5 rounded-full bg-[#C8CDD3]/25" />
                                      <div className="w-2.5 h-2.5 rounded-full bg-[#C8CDD3]/25" />
                                    </div>
                                    <span className="text-[10px] font-bold text-[#C8CDD3]/65 uppercase tracking-widest ml-2">{match[1]}</span>
                                  </div>
                                </div>
                                <SyntaxHighlighter
                                  PreTag="div"
                                  language={match[1]}
                                  style={vscDarkPlus}
                                  customStyle={{
                                    margin: 0,
                                    borderRadius: '0 0 0.75rem 0.75rem',
                                    background: '#0A0E14',
                                    border: '1px solid rgba(200,205,211,0.2)',
                                    padding: '1.5rem',
                                    fontSize: '0.85rem',
                                    lineHeight: '1.6'
                                  }}
                                >
                                  {codeContent}
                                </SyntaxHighlighter>
                              </div>
                            ) : (
                              <code {...rest} className={cn("bg-[#0A0E14]/80 border border-[#C8CDD3]/20 px-1.5 py-0.5 rounded text-cyan-300 font-mono text-[0.8em]", className)}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {streamingContent}
                      </ReactMarkdown>
                      <motion.span 
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="inline-block w-1.5 h-4 ml-1 align-middle"
                        style={{ backgroundColor: accentHex }}
                      />
                    </div>
                  )}
                </div>
                {streamingMetadata && <GroundingMetadata metadata={streamingMetadata} />}
              </div>
            </motion.div>
          )}
          <div ref={scrollRef} />
        </div>
      </div>

      <div className="p-3 sm:p-4 bg-gradient-to-t from-[#0A0E14] via-[#0A0E14] to-transparent shrink-0 z-10">
        <div className="relative max-w-4xl mx-auto">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 p-2 bg-[#101620] border border-[#C8CDD3]/20 rounded-xl">
              {attachments.map((att, i) => {
                const isImage = att.type.startsWith('image/');
                const isVideo = att.type.startsWith('video/');
                const isAudio = att.type.startsWith('audio/');
                const isPDF = att.type === 'application/pdf';

                return (
                  <div key={i} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-[#C8CDD3]/25 shrink-0 bg-[#0A0E14]">
                    {isImage ? (
                      <img src={att.preview} alt="Preview" className="w-full h-full object-cover" />
                    ) : isVideo ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Video className="w-6 h-6 text-cyan-400" />
                      </div>
                    ) : isAudio ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Mic className="w-6 h-6 text-cyan-400" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {isPDF ? <FileIcon className="w-6 h-6 text-red-400" /> : <FileIcon className="w-6 h-6 text-[#C8CDD3]/60" />}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="absolute top-0.5 right-0.5 text-red-500 bg-black/60 rounded-full hover:text-red-400 transition-colors z-10"
                      aria-label="Remove attachment"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-white truncate px-1 py-0.5">
                      {att.file.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div
            className="bg-[#101620] border border-[#C8CDD3]/25 rounded-2xl p-2 shadow-2xl transition-all"
            style={{
              boxShadow: `0 0 24px rgba(${accentRgb}, 0.08)`,
            }}
          >
            <div className="flex items-end gap-1.5">
              <div className="flex items-center shrink-0">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  multiple
                  accept="image/*,video/*,audio/*,application/pdf,text/*,.csv,.json"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleFileClick}
                  className="min-h-[48px] min-w-[48px] text-[#C8CDD3]/75 hover:text-white rounded-xl"
                  aria-label="Attach file"
                >
                  <Paperclip className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleListening}
                  className={cn(
                    'min-h-[48px] min-w-[48px] transition-all duration-300 relative rounded-xl',
                    isListening ? 'text-red-400 bg-red-500/15' : 'text-[#C8CDD3]/75 hover:text-white'
                  )}
                  title={isListening ? 'Stop Recording' : 'Voice Input'}
                  aria-label={isListening ? 'Stop Recording' : 'Voice Input'}
                >
                  <Mic className={cn('w-5 h-5', isListening && 'animate-pulse')} />
                </Button>
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  isListening
                    ? 'Listening to you...'
                    : `Message ${IDENTITIES[companionIdentity]?.name || 'Sierra'}...`
                }
                className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 resize-none py-3 px-2 text-sm text-white placeholder:text-[#C8CDD3]/45 max-h-32 min-h-[48px]"
                rows={1}
              />
              {isListening && interimTranscript && (
                <div
                  className="absolute left-4 right-4 bottom-full mb-2 p-3 bg-[#101620]/95 backdrop-blur-xl border rounded-xl shadow-2xl"
                  style={{ borderColor: `rgba(${accentRgb}, 0.4)` }}
                >
                  <p className="text-xs text-[#C8CDD3] italic truncate">{interimTranscript}</p>
                </div>
              )}
              <div className="flex flex-col items-end gap-1 shrink-0">
                {input.length > 0 && (
                  <span
                    className={cn(
                      'text-[9px] font-bold transition-colors px-1',
                      input.length > MAX_MESSAGE_LENGTH
                        ? 'text-red-500'
                        : input.length > MAX_MESSAGE_LENGTH * 0.9
                          ? 'text-amber-500'
                          : 'text-[#C8CDD3]/50'
                    )}
                  >
                    {input.length}/{MAX_MESSAGE_LENGTH}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  {isCurrentlySpeaking && (
                    <Button
                      onClick={() => stopSpeaking('User pressed Stop button')}
                      variant="destructive"
                      size="sm"
                      className="min-h-[48px] px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs gap-1.5 shadow-lg"
                      title="Stop speaking"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop</span>
                    </Button>
                  )}
                  <Button
                    onClick={handleSend}
                    disabled={(!input.trim() && attachments.length === 0) || isLoading || input.length > MAX_MESSAGE_LENGTH}
                    size="icon"
                    data-testid="chat-send-button"
                    className="min-h-[48px] min-w-[48px] text-[#0A0E14] font-bold rounded-xl shrink-0 transition-all active:scale-95 disabled:opacity-40"
                    style={{
                      backgroundColor: accentHex,
                      boxShadow: `0 0 18px rgba(${accentRgb}, 0.35)`,
                    }}
                    aria-label="Send message"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

      {/* Image Generation Modal */}
      <Dialog open={isImageModalOpen} onOpenChange={setIsImageModalOpen}>
        <DialogContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <Sparkles className="w-5 h-5" style={{ color: accentHex }} />
              Neural Image Synthesis
            </DialogTitle>
            <DialogDescription className="text-[#C8CDD3]/70">
              Generate high-fidelity visual assets using the Creative Engine.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Prompt</label>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="Describe the image you want to create..."
                className="w-full bg-[#0A0E14] border border-[#C8CDD3]/20 rounded-xl p-4 text-sm text-white focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-400/50 outline-none transition-all min-h-[100px] resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Model</label>
                <div className="h-10 px-4 flex items-center bg-[#0A0E14] border border-[#C8CDD3]/20 rounded-xl text-sm text-[#C8CDD3]">
                  Imagen 3 Pro (Hyperrealistic)
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Format</label>
                <Select value={imageFormat} onValueChange={setImageFormat}>
                  <SelectTrigger className="bg-[#0A0E14] border-[#C8CDD3]/20 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100">
                    <SelectItem value="image/png">PNG</SelectItem>
                    <SelectItem value="image/jpeg">JPEG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Aspect Ratio</label>
                <Select value={imageAspectRatio} onValueChange={setImageAspectRatio}>
                  <SelectTrigger className="bg-[#0A0E14] border-[#C8CDD3]/20 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100">
                    {ASPECT_RATIOS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Quality</label>
                <Select value={imageQuality} onValueChange={setImageQuality}>
                  <SelectTrigger className="bg-[#0A0E14] border-[#C8CDD3]/20 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100">
                    {IMAGE_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Person Generation</label>
              <Select value={imagePersonGeneration} onValueChange={setImagePersonGeneration}>
                <SelectTrigger className="bg-[#0A0E14] border-[#C8CDD3]/20 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100">
                  <SelectItem value="ALLOW_ADULT">Allow Adults</SelectItem>
                  <SelectItem value="DONT_ALLOW">Don't Allow</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {generatedImageUrl && (
              <div className="relative group rounded-2xl overflow-hidden border border-[#C8CDD3]/20 shadow-2xl mt-4">
                <img src={generatedImageUrl} alt="Generated" className="w-full h-auto" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                  <Button variant="secondary" size="sm" className="gap-2" onClick={() => window.open(generatedImageUrl, '_blank')}>
                    <Download className="w-4 h-4" /> Download
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button 
              variant="ghost" 
              onClick={() => setIsImageModalOpen(false)}
              className="text-[#C8CDD3]/75 hover:text-white"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleGenerateImage}
              disabled={!imagePrompt.trim() || isGeneratingImage}
              style={{ backgroundColor: accentHex, color: '#05080D' }}
              className="min-h-[44px] font-bold rounded-xl gap-2 min-w-[120px] hover:opacity-90"
            >
              {isGeneratingImage ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {isGeneratingImage ? 'Synthesizing...' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Video Generation Modal */}
      <Dialog open={isVideoModalOpen} onOpenChange={setIsVideoModalOpen}>
        <DialogContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <Sparkles className="w-5 h-5" style={{ color: accentHex }} />
              Neural Video Synthesis
            </DialogTitle>
            <DialogDescription className="text-[#C8CDD3]/70">
              Generate motion sequences using the Temporal Engine.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Prompt</label>
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                placeholder="Describe the video you want to create..."
                className="w-full bg-[#0A0E14] border border-[#C8CDD3]/20 rounded-xl p-4 text-sm text-white focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-400/50 outline-none transition-all min-h-[100px] resize-none"
              />
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Model</label>
                <div className="h-10 px-4 flex items-center bg-[#0A0E14] border border-[#C8CDD3]/20 rounded-xl text-sm text-[#C8CDD3]">
                  Veo Pro
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Aspect Ratio</label>
                <Select value={videoAspectRatio} onValueChange={setVideoAspectRatio}>
                  <SelectTrigger className="bg-[#0A0E14] border-[#C8CDD3]/20 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100">
                    {ASPECT_RATIOS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Resolution</label>
                <Select value={videoResolution} onValueChange={setVideoResolution}>
                  <SelectTrigger className="bg-[#0A0E14] border-[#C8CDD3]/20 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100">
                    {VIDEO_RESOLUTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/65 uppercase tracking-widest">FPS</label>
                <Select value={videoFps.toString()} onValueChange={(v) => setVideoFps(parseInt(v))}>
                  <SelectTrigger className="bg-[#0A0E14] border-[#C8CDD3]/20 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0F1520] border-[#C8CDD3]/20 text-slate-100">
                    {VIDEO_FPS.map(f => <SelectItem key={f} value={f.toString()}>{f} FPS</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isGeneratingVideo && videoProgress !== null && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between text-[10px] font-bold text-[#C8CDD3]/65 uppercase tracking-widest">
                  <span>Synthesizing Video Frames</span>
                  <span>{videoProgress}%</span>
                </div>
                <div className="h-1.5 w-full bg-[#0A0E14] rounded-full overflow-hidden border border-[#C8CDD3]/20">
                  <div 
                    className="h-full transition-all duration-1000 ease-out"
                    style={{
                      width: `${videoProgress}%`,
                      backgroundColor: accentHex,
                      boxShadow: `0 0 10px ${accentHex}`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-[#C8CDD3]/60 italic">
                  The Temporal Engine is processing your request. This typically takes 1-2 minutes.
                </p>
              </div>
            )}

            {generatedVideoUrl && (
              <div className="relative group rounded-2xl overflow-hidden border border-[#C8CDD3]/20 shadow-2xl mt-4">
                <video src={generatedVideoUrl} controls className="w-full h-auto" />
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="secondary" size="sm" className="gap-2" onClick={() => window.open(generatedVideoUrl, '_blank')}>
                    <Download className="w-4 h-4" /> Download
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button 
              variant="ghost" 
              onClick={() => setIsVideoModalOpen(false)}
              className="text-[#C8CDD3]/75 hover:text-white"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleGenerateVideo}
              disabled={!videoPrompt.trim() || isGeneratingVideo}
              style={{ backgroundColor: accentHex, color: '#05080D' }}
              className="min-h-[44px] font-bold rounded-xl gap-2 min-w-[120px] hover:opacity-90"
            >
              {isGeneratingVideo ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {isGeneratingVideo ? 'Synthesizing...' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Chat Confirmation Dialog */}
      <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 className="w-5 h-5" />
              Clear Chat History
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              This will permanently delete all messages in this session. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="ghost" 
              onClick={() => setIsClearDialogOpen(false)}
              className="text-zinc-400 hover:text-zinc-100"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleClearChat}
              disabled={isClearing}
              className="bg-red-600 hover:bg-red-500 text-white rounded-xl gap-2"
            >
              {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {isClearing ? 'Clearing...' : 'Clear History'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PERSONA MODAL (Identity, Persona, Content Mode, Custom Directives) */}
      <PersonaVoiceModal
        isOpen={isPersonaModalOpen}
        onClose={() => setIsPersonaModalOpen(false)}
        mode="persona"
        onChanged={(newId, newPId) => {
          setCompanionIdentity(newId);
          setSelectedPersonaId(newPId);
          notifyIdentityChanged(newId);
          const updatedChatCfg = getChatVoiceConfig(newPId, newId);
          setChatVoiceId(updatedChatCfg.voiceId);
          setChatAccent(updatedChatCfg.accent || 'Default');
          setChatTone(updatedChatCfg.tone || 'Default');
        }}
      />

      {/* CHAT VOICE MODAL (Independent Text Chat Voice, Provider, Accent & Tone) */}
      <PersonaVoiceModal
        isOpen={isChatVoiceModalOpen}
        onClose={() => setIsChatVoiceModalOpen(false)}
        mode="chat-voice"
        onChanged={(newId, newPId, newVId) => {
          setCompanionIdentity(newId);
          setSelectedPersonaId(newPId);
          notifyIdentityChanged(newId);
          const updatedChatCfg = getChatVoiceConfig(newPId, newId);
          setChatVoiceId(newVId || updatedChatCfg.voiceId);
          setChatAccent(updatedChatCfg.accent || 'Default');
          setChatTone(updatedChatCfg.tone || 'Default');
          setIsChatSpeechActive(isChatSpeechEnabled());
        }}
        onChatVoiceConfigChanged={(updatedCfg) => {
          setChatVoiceId(updatedCfg.voiceId);
          setChatAccent(updatedCfg.accent || 'Default');
          setChatTone(updatedCfg.tone || 'Default');
          setIsChatSpeechActive(updatedCfg.enabled);
        }}
      />
    </>
  );
}
