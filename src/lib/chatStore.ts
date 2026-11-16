import { ChatMessage } from '../types';
import {
  getAllConversationSummaries,
  getConversationSummaries,
  summarizeAndSaveConversation,
  getActiveIdentity,
  STORAGE_KEY_CONVERSATION_SUMMARIES,
  MAX_CONVERSATION_SUMMARIES,
  MAX_SUMMARY_TEXT_CHARS,
  ConversationSummary,
  isValidThinkingLevel,
  setGeminiThinkingLevel,
} from './persona';
import {
  LEGACY_SETTINGS_STORAGE_KEYS,
  SettingsV3,
  getSettings,
  updateSettings,
  stripSecretsFromSettingsV3,
} from './settingsStore';
import { addDebugLog } from './debugLogStore';

export interface ChatSessionMeta {
  id: string;
  title: string;
  timestamp: number;
}

const STORAGE_KEY_SESSIONS = 'sierra_chat_sessions';
const STORAGE_KEY_ACTIVE_SESSION = 'sierra_active_session_id';
const STORAGE_KEY_PREFIX_MSGS = 'sierra_msgs_';

type StoreListener = () => void;
const listeners = new Set<StoreListener>();

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.warn('chatStore listener error:', e);
    }
  }
}

/**
 * Derives a clean ~40-character chat session title from the first user message.
 */
export function deriveChatTitleFromMessage(text: string, maxLen: number = 40): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New Chat';
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).trim() + '...';
}

/**
 * Loads all stored chat sessions metadata from localStorage.
 */
export function getStoredChatSessions(): ChatSessionMeta[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (!raw) {
      // Default initial session
      const defaultSession: ChatSessionMeta = {
        id: 'global-session',
        title: 'New Chat',
        timestamp: Date.now(),
      };
      return [defaultSession];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : [{ id: 'global-session', title: 'New Chat', timestamp: Date.now() }];
  } catch {
    return [{ id: 'global-session', title: 'New Chat', timestamp: Date.now() }];
  }
}

/**
 * Saves sessions list metadata.
 */
export function saveStoredChatSessions(sessions: ChatSessionMeta[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
    notifyListeners();
  } catch (err) {
    console.warn('Failed to save chat sessions metadata:', err);
  }
}

/**
 * Gets currently active session ID.
 */
export function getActiveSessionId(): string {
  if (typeof localStorage === 'undefined') return 'global-session';
  const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_SESSION);
  return saved || 'global-session';
}

/**
 * Sets active session ID.
 */
export function setActiveSessionId(sessionId: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_ACTIVE_SESSION, sessionId);
  notifyListeners();
}

/**
 * Loads messages for a given session from local storage.
 */
export function getStoredMessages(sessionId: string): ChatMessage[] {
  if (typeof localStorage === 'undefined' || !sessionId) return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX_MSGS}${sessionId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persists messages for a given session to local storage.
 */
export function saveStoredMessages(sessionId: string, messages: ChatMessage[]) {
  if (typeof localStorage === 'undefined' || !sessionId) return;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX_MSGS}${sessionId}`, JSON.stringify(messages));
    
    const firstUserMsg = messages.find((m) => m.role === 'user' && m.content?.trim());
    const autoDerivedTitle = firstUserMsg ? deriveChatTitleFromMessage(firstUserMsg.content, 40) : null;

    // Ensure this session exists in sessions list metadata
    const sessions = getStoredChatSessions();
    const existingIdx = sessions.findIndex((s) => s.id === sessionId);
    let sessionTitle = 'New Chat';
    if (existingIdx >= 0) {
      sessions[existingIdx].timestamp = Date.now();
      const currentTitle = sessions[existingIdx].title || 'New Chat';
      if ((currentTitle === 'New Chat' || currentTitle === 'Neural Chat') && autoDerivedTitle) {
        sessions[existingIdx].title = autoDerivedTitle;
      }
      sessionTitle = sessions[existingIdx].title;
      saveStoredChatSessions(sessions);
    } else {
      sessionTitle = autoDerivedTitle || 'New Chat';
      sessions.unshift({
        id: sessionId,
        title: sessionTitle,
        timestamp: Date.now(),
      });
      saveStoredChatSessions(sessions);
    }

    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    if (
      lastMessage &&
      (lastMessage.role === 'model' || (lastMessage as any).role === 'assistant') &&
      lastMessage.content &&
      lastMessage.content.trim().length > 0
    ) {
      summarizeAndSaveConversation(
        sessionId,
        messages.map((m) => ({ role: m.role, content: m.content })),
        sessionTitle,
        'chat',
        undefined,
        { identity: getActiveIdentity() },
      );
    }

    notifyListeners();
  } catch (err) {
    console.warn('Failed to persist messages to localStorage:', err);
  }
}

/**
 * Creates a new local chat session.
 */
export function createStoredSession(title: string = 'New Chat'): ChatSessionMeta {
  const newSession: ChatSessionMeta = {
    id: `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    title,
    timestamp: Date.now(),
  };
  const sessions = getStoredChatSessions();
  sessions.unshift(newSession);
  saveStoredChatSessions(sessions);
  setActiveSessionId(newSession.id);
  saveStoredMessages(newSession.id, []);
  return newSession;
}

/**
 * Renames a local chat session.
 */
export function renameStoredSession(sessionId: string, newTitle: string) {
  const sessions = getStoredChatSessions();
  const target = sessions.find((s) => s.id === sessionId);
  if (target) {
    target.title = newTitle.trim() || 'Untitled Chat';
    target.timestamp = Date.now();
    saveStoredChatSessions(sessions);
  }
}

/**
 * Deletes a local chat session and its persisted messages.
 */
export function deleteStoredSession(sessionId: string): string {
  let sessions = getStoredChatSessions().filter((s) => s.id !== sessionId);
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX_MSGS}${sessionId}`);
  }
  if (sessions.length === 0) {
    const fallback: ChatSessionMeta = {
      id: 'global-session',
      title: 'New Chat',
      timestamp: Date.now(),
    };
    sessions = [fallback];
    saveStoredMessages(fallback.id, []);
  }
  saveStoredChatSessions(sessions);

  const activeId = getActiveSessionId();
  if (activeId === sessionId) {
    const nextActive = sessions[0].id;
    setActiveSessionId(nextActive);
    return nextActive;
  }
  return activeId;
}

/**
 * Clears messages for a session.
 */
export function clearStoredMessages(sessionId: string) {
  if (typeof localStorage === 'undefined' || !sessionId) return;
  localStorage.removeItem(`${STORAGE_KEY_PREFIX_MSGS}${sessionId}`);
  notifyListeners();
}

/**
 * React hook subscription for chat store.
 */
export function subscribeChatStore(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface LocalBackupPayload {
  version: number;
  exportedAt: string;
  summaries: ConversationSummary[];
  sessions: ChatSessionMeta[];
  messagesBySession: Record<string, ChatMessage[]>;
  liveVoiceConfigs?: Record<string, any>;
  chatVoiceConfigs?: Record<string, any>;
  audioOutputMode?: string;
  preferences?: {
    companionIdentity?: string | null;
    selectedPersona?: string | null;
    contentMode?: string | null;
    customDirectives?: string | null;
    liveVoiceModel?: string | null;
    liveVoiceCustomModel?: string | null;
    geminiThinkingLevel?: string | null;
    liveLanguage?: string | null;
    voiceProvider?: string | null;
    liveVoiceProvider?: string | null;
    activeChatProvider?: string | null;
    openRouterModelSettings?: string | null;
    bargeInSensitivity?: string | null;
    [key: string]: any;
  };
  removedSummariesBackup?: any[];
  summariesDriftCleaned?: boolean;
}

/**
 * Exports all local on-device conversation summaries, chat history, voice configs, and non-secret preferences as a JSON string.
 */
export function exportLocalBackupData(): string {
  const summaries = getAllConversationSummaries();
  const sessions = getStoredChatSessions();
  const messagesBySession: Record<string, ChatMessage[]> = {};
  for (const s of sessions) {
    messagesBySession[s.id] = getStoredMessages(s.id);
  }

  const liveVoiceConfigs: Record<string, any> = {};
  const chatVoiceConfigs: Record<string, any> = {};
  let audioOutputMode = 'speaker';

  const settings = getSettings();
  const safeSettings = stripSecretsFromSettingsV3(settings);

  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      // Strictly omit any API keys, credentials, or secrets
      if (
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('token')
      ) {
        continue;
      }
      if (key.startsWith('sierra_live_voice_config_')) {
        try {
          liveVoiceConfigs[key] = JSON.parse(localStorage.getItem(key) || '{}');
        } catch {
          liveVoiceConfigs[key] = localStorage.getItem(key);
        }
      } else if (key.startsWith('sierra_chat_voice_config_')) {
        try {
          chatVoiceConfigs[key] = JSON.parse(localStorage.getItem(key) || '{}');
        } catch {
          chatVoiceConfigs[key] = localStorage.getItem(key);
        }
      }
    }
    audioOutputMode = safeSettings.live.audioOutputMode || 'speaker';
  }

  let removedSummariesBackup: any[] | undefined = undefined;
  let summariesDriftCleaned = false;
  if (typeof localStorage !== 'undefined') {
    const rawBackup = localStorage.getItem('sierra_conversation_summaries_removed_backup');
    if (rawBackup) {
      try {
        removedSummariesBackup = JSON.parse(rawBackup);
      } catch {
        removedSummariesBackup = undefined;
      }
    }
    summariesDriftCleaned = localStorage.getItem('sierra_summaries_drift_cleaned_v1') === 'true';
  }

  const payload: LocalBackupPayload & { settingsV3?: SettingsV3 } = {
    version: 3,
    exportedAt: new Date().toISOString(),
    summaries,
    sessions,
    messagesBySession,
    liveVoiceConfigs,
    chatVoiceConfigs,
    audioOutputMode,
    removedSummariesBackup,
    summariesDriftCleaned,
    settingsV3: safeSettings,
    preferences: typeof localStorage !== 'undefined' ? {
      companionIdentity: safeSettings.activeIdentity,
      selectedPersona: safeSettings.selectedPersona || null,
      contentMode: safeSettings.contentMode,
      customDirectives: safeSettings.customDirectives || null,
      liveVoiceModel: safeSettings.models.liveModel,
      liveVoiceCustomModel: safeSettings.models.liveCustomModelSlug,
      textModel: safeSettings.models.chatText,
      textCustomModel: safeSettings.chatProviders.gemini?.customModel || '',
      deviceCapabilities: localStorage.getItem('sierra_device_capabilities_v1'),
      blockedNumbers: localStorage.getItem('sierra_blocked_numbers_v1'),
      geminiThinkingLevel: safeSettings.live.thinkingLevel,
      liveLanguage: safeSettings.live.language || null,
      voiceProvider: safeSettings.models.ttsProvider,
      liveVoiceProvider: safeSettings.models.liveProvider,
      activeChatProvider: safeSettings.models.chatProvider,
      openRouterModelSettings: JSON.stringify({
        selectedModel: safeSettings.live.openRouterModel,
        customSlug: safeSettings.live.openRouterCustomSlug,
        customModelSlug: safeSettings.live.openRouterCustomSlug,
        tryFreeFirst: safeSettings.live.openRouterTryFreeFirst,
      }),
      bargeInSensitivity: safeSettings.live.bargeInSensitivity,
    } : undefined,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Imports and restores local on-device conversation summaries, chat history, voice configs, and preferences from a JSON backup string.
 */
export function importLocalBackupData(jsonText: string): {
  summariesCount: number;
  sessionsCount: number;
  configsCount: number;
  settingsCount: number;
  chatsCount: number;
} {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Selected file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid backup JSON format.');
  }

  const hasRecognizedBackupData =
    Array.isArray(parsed.summaries) ||
    Array.isArray(parsed.sessions) ||
    (parsed.messagesBySession && typeof parsed.messagesBySession === 'object' && !Array.isArray(parsed.messagesBySession)) ||
    (parsed.settingsV3 && typeof parsed.settingsV3 === 'object' && !Array.isArray(parsed.settingsV3)) ||
    (parsed.unifiedSettings && typeof parsed.unifiedSettings === 'object' && !Array.isArray(parsed.unifiedSettings)) ||
    (parsed.preferences && typeof parsed.preferences === 'object' && !Array.isArray(parsed.preferences)) ||
    (parsed.liveVoiceConfigs && typeof parsed.liveVoiceConfigs === 'object' && !Array.isArray(parsed.liveVoiceConfigs)) ||
    (parsed.chatVoiceConfigs && typeof parsed.chatVoiceConfigs === 'object' && !Array.isArray(parsed.chatVoiceConfigs)) ||
    (typeof parsed.version === 'number' && typeof parsed.exportedAt === 'string');

  if (!hasRecognizedBackupData) {
    throw new Error('This file is not a valid Omni backup (missing backup data fields).');
  }

  let summariesCount = 0;
  let sessionsCount = 0;
  let configsCount = 0;
  let restoredMessageSessionCount = 0;

  if (typeof localStorage !== 'undefined') {
    if (Array.isArray(parsed.summaries)) {
      const validSummaries: ConversationSummary[] = parsed.summaries
        .filter((item: any) => item && typeof item.id === 'string' && typeof item.summary === 'string' && item.summary.trim().length > 0)
        .map((item: any) => ({
          id: String(item.id),
          seqId: typeof item.seqId === 'number' ? item.seqId : undefined,
          identity: item.identity === 'tyler' ? 'tyler' : 'sierra',
          source: item.source === 'live' ? 'live' : 'chat',
          title: item.title ? String(item.title) : undefined,
          summary: String(item.summary).slice(0, MAX_SUMMARY_TEXT_CHARS),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        }));

      localStorage.setItem(STORAGE_KEY_CONVERSATION_SUMMARIES, JSON.stringify(validSummaries));
      summariesCount = getConversationSummaries().length || validSummaries.length;
    }

    if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
      const validSessions: ChatSessionMeta[] = parsed.sessions
        .filter((s: any) => s && typeof s.id === 'string')
        .map((s: any) => ({
          id: String(s.id),
          title: s.title ? String(s.title) : 'Neural Chat',
          timestamp: typeof s.timestamp === 'number' ? s.timestamp : Date.now(),
        }));

      if (validSessions.length > 0) {
        saveStoredChatSessions(validSessions);
        sessionsCount = validSessions.length;
      }
    }

    if (parsed.messagesBySession && typeof parsed.messagesBySession === 'object') {
      for (const [sid, msgs] of Object.entries(parsed.messagesBySession)) {
        if (Array.isArray(msgs)) {
          localStorage.setItem(`${STORAGE_KEY_PREFIX_MSGS}${sid}`, JSON.stringify(msgs));
          restoredMessageSessionCount++;
        }
      }
    }

    // Restore Live & Chat voice configs (Version 2)
    if (parsed.liveVoiceConfigs && typeof parsed.liveVoiceConfigs === 'object') {
      for (const [k, v] of Object.entries(parsed.liveVoiceConfigs)) {
        if (k.startsWith('sierra_live_voice_config_') && !k.toLowerCase().includes('key') && !k.toLowerCase().includes('token')) {
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          configsCount++;
        }
      }
    }

    if (parsed.chatVoiceConfigs && typeof parsed.chatVoiceConfigs === 'object') {
      for (const [k, v] of Object.entries(parsed.chatVoiceConfigs)) {
        if (k.startsWith('sierra_chat_voice_config_') && !k.toLowerCase().includes('key') && !k.toLowerCase().includes('token')) {
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          configsCount++;
        }
      }
    }

    if (typeof parsed.audioOutputMode === 'string' && (parsed.audioOutputMode === 'speaker' || parsed.audioOutputMode === 'headphones')) {
      updateSettings((draft) => {
        draft.live.audioOutputMode = parsed.audioOutputMode;
        return draft;
      });
      configsCount++;
    }

    if (parsed.settingsV3 && typeof parsed.settingsV3 === 'object') {
      const imported = parsed.settingsV3;
      updateSettings((draft) => {
        if (imported.contentMode === 'mature' || imported.contentMode === 'sfw') {
          draft.contentMode = imported.contentMode;
        }
        if (imported.activeIdentity === 'sierra' || imported.activeIdentity === 'tyler') {
          draft.activeIdentity = imported.activeIdentity;
        }
        if (imported.responseSpeed === 'low' || imported.responseSpeed === 'medium' || imported.responseSpeed === 'high') {
          draft.responseSpeed = imported.responseSpeed;
        }
        if (imported.providers && typeof imported.providers === 'object') {
          for (const [pid, pCfg] of Object.entries(imported.providers)) {
            const key = pid as keyof typeof draft.providers;
            if (draft.providers[key] && pCfg && typeof pCfg === 'object') {
              const c = pCfg as any;
              if (typeof c.httpEndpoint === 'string' && c.httpEndpoint.trim()) {
                draft.providers[key].httpEndpoint = c.httpEndpoint.trim();
              }
              if (typeof c.wsEndpoint === 'string') {
                draft.providers[key].wsEndpoint = c.wsEndpoint.trim();
              }
              if (typeof c.enabled === 'boolean') {
                draft.providers[key].enabled = c.enabled;
              }
            }
          }
        }
        if (imported.models && typeof imported.models === 'object') {
          draft.models = { ...draft.models, ...imported.models };
        }
        if (imported.chatProviders && typeof imported.chatProviders === 'object') {
          draft.chatProviders = { ...draft.chatProviders, ...imported.chatProviders };
        }
        if (imported.live && typeof imported.live === 'object') {
          draft.live = { ...draft.live, ...imported.live };
        }
        return draft;
      });
      configsCount++;
    } else if (parsed.unifiedSettings && typeof parsed.unifiedSettings === 'object') {
      const imported = parsed.unifiedSettings;
      updateSettings((draft) => {
        if (imported.contentMode === 'mature' || imported.contentMode === 'sfw') {
          draft.contentMode = imported.contentMode;
        }
        if (imported.responseSpeed === 'low' || imported.responseSpeed === 'medium' || imported.responseSpeed === 'high') {
          draft.responseSpeed = imported.responseSpeed;
        }
        if (imported.chat && typeof imported.chat === 'object') {
          if (typeof imported.chat.activeProvider === 'string') {
            draft.models.chatProvider = imported.chat.activeProvider as any;
          }
          if (imported.chat.providers && typeof imported.chat.providers === 'object') {
            for (const [pid, entry] of Object.entries(imported.chat.providers)) {
              const key = pid as keyof typeof draft.chatProviders;
              if (draft.chatProviders[key] && entry && typeof entry === 'object') {
                draft.chatProviders[key] = { ...draft.chatProviders[key], ...(entry as any) };
              }
              if (draft.providers[key] && typeof (entry as any)?.baseUrl === 'string' && (entry as any).baseUrl.trim()) {
                draft.providers[key].httpEndpoint = (entry as any).baseUrl.trim();
              }
            }
          }
        }
        if (imported.live && typeof imported.live === 'object') {
          if (imported.live.provider) draft.models.liveProvider = imported.live.provider;
          if (imported.live.geminiModel) draft.models.liveModel = imported.live.geminiModel;
          if (typeof imported.live.geminiCustomModel === 'string') {
            draft.models.liveCustomModelSlug = imported.live.geminiCustomModel;
          }
          if (typeof imported.live.geminiWsUrl === 'string' && imported.live.geminiWsUrl.trim()) {
            draft.providers.gemini.wsEndpoint = imported.live.geminiWsUrl.trim();
          }
          draft.live = { ...draft.live, ...imported.live };
        }
        return draft;
      });
      configsCount++;
    }

    if (parsed.preferences && typeof parsed.preferences === 'object') {
      const prefs = parsed.preferences;
      if (typeof prefs.deviceCapabilities === 'string') {
        localStorage.setItem('sierra_device_capabilities_v1', prefs.deviceCapabilities);
        configsCount++;
      }
      if (typeof prefs.blockedNumbers === 'string') {
        localStorage.setItem('sierra_blocked_numbers_v1', prefs.blockedNumbers);
        configsCount++;
      }

      updateSettings((draft) => {
        if (typeof prefs.selectedPersona === 'string' && prefs.selectedPersona.trim()) {
          draft.selectedPersona = prefs.selectedPersona.trim();
          configsCount++;
        }
        if (typeof prefs.customDirectives === 'string') {
          draft.customDirectives = prefs.customDirectives;
          configsCount++;
        }
        if (typeof prefs.liveLanguage === 'string' && prefs.liveLanguage.trim()) {
          draft.live.language = prefs.liveLanguage.trim();
          configsCount++;
        }
        if (prefs.companionIdentity === 'sierra' || prefs.companionIdentity === 'tyler') {
          draft.activeIdentity = prefs.companionIdentity;
          configsCount++;
        }
        if (prefs.voiceProvider === 'openrouter' || prefs.voiceProvider === 'native') {
          draft.models.ttsProvider = prefs.voiceProvider;
          configsCount++;
        }
        if (prefs.contentMode === 'sfw' || prefs.contentMode === 'mature') {
          draft.contentMode = prefs.contentMode;
          configsCount++;
        }
        if (typeof prefs.liveVoiceModel === 'string') {
          draft.models.liveModel = prefs.liveVoiceModel;
          configsCount++;
        }
        if (typeof prefs.liveVoiceCustomModel === 'string') {
          draft.models.liveCustomModelSlug = prefs.liveVoiceCustomModel.trim();
          configsCount++;
        }
        if (typeof prefs.textModel === 'string' && prefs.textModel.trim()) {
          draft.chatProviders.gemini.selectedModel = prefs.textModel.trim();
          draft.models.chatText = prefs.textModel.trim();
          configsCount++;
        }
        if (typeof prefs.textCustomModel === 'string') {
          draft.chatProviders.gemini.customModel = prefs.textCustomModel.trim();
          configsCount++;
        }
        if (typeof prefs.geminiThinkingLevel === 'string' && isValidThinkingLevel(prefs.geminiThinkingLevel)) {
          draft.live.thinkingLevel = prefs.geminiThinkingLevel.trim().toUpperCase() as any;
          draft.chatProviders.gemini.thinkingLevel = draft.live.thinkingLevel;
          configsCount++;
        }
        if (prefs.liveVoiceProvider === 'gemini' || prefs.liveVoiceProvider === 'local' || prefs.liveVoiceProvider === 'openrouter') {
          draft.models.liveProvider = prefs.liveVoiceProvider;
          configsCount++;
        }
        if (typeof prefs.activeChatProvider === 'string' && prefs.activeChatProvider.trim()) {
          draft.models.chatProvider = prefs.activeChatProvider.trim() as any;
          configsCount++;
        }
        if (typeof prefs.openRouterModelSettings === 'string') {
          try {
            const orParsed = JSON.parse(prefs.openRouterModelSettings);
            if (orParsed.selectedModel) draft.live.openRouterModel = orParsed.selectedModel;
            if (typeof orParsed.customSlug === 'string') draft.live.openRouterCustomSlug = orParsed.customSlug;
            if (typeof orParsed.tryFreeFirst === 'boolean') draft.live.openRouterTryFreeFirst = orParsed.tryFreeFirst;
            configsCount++;
          } catch {}
        }
        if (prefs.bargeInSensitivity === 'low' || prefs.bargeInSensitivity === 'medium' || prefs.bargeInSensitivity === 'high') {
          draft.live.bargeInSensitivity = prefs.bargeInSensitivity;
          configsCount++;
        }
        return draft;
      });
    }

    // Note: Do NOT delete existing legacy keys on user devices during import.

    if (Array.isArray(parsed.removedSummariesBackup)) {
      localStorage.setItem(
        'sierra_conversation_summaries_removed_backup',
        JSON.stringify(parsed.removedSummariesBackup)
      );
      configsCount++;
    }
    if (typeof parsed.summariesDriftCleaned === 'boolean') {
      localStorage.setItem(
        'sierra_summaries_drift_cleaned_v1',
        parsed.summariesDriftCleaned ? 'true' : 'false'
      );
    }
  }

  const settingsCount = configsCount;
  const chatsCount = sessionsCount || restoredMessageSessionCount;
  addDebugLog(
    'Import:Result',
    `[Import:Result] settings=${settingsCount} summaries=${summariesCount} chats=${chatsCount}`,
  );
  notifyListeners();
  return { summariesCount, sessionsCount, configsCount, settingsCount, chatsCount };
}
