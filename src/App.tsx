import React, { useCallback, useEffect, useRef, useState } from 'react';
import Layout from './components/Layout';
import HomeView from './components/HomeView';
import ChatInterface from './components/ChatInterface';
import MediaGenerator from './components/MediaGenerator';
import LiveVoice from './components/LiveVoice';
import SettingsView, { type SettingsSectionId } from './components/Settings';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { toast } from 'sonner';

import ErrorBoundary from './components/ErrorBoundary';
import { UIProvider } from './contexts/UIContext';
import { ActionConfirmDialog } from './components/ActionConfirmDialog';
import { hydratePersistentStateFromNative } from './config/models';
import { auditDevicePermissionsOnLaunch } from './lib/deviceControl';
import { applyThemeAccentCssVars } from './lib/themeStore';
import { addDebugLog } from './lib/debugLogStore';
import { stopSpeaking } from './lib/ttsService';
import { prepareNativeAudioRoute } from './lib/localVoiceEngine';
import {
  isBackgroundLiveEnabled,
  isWakeWordEnabled,
  getActiveIdentity,
} from './lib/persona';
import {
  SierraBackgroundVoice,
  subscribeWakeWordDetected,
  subscribeBackgroundLiveStatus,
  getBackgroundLiveSessionStatus,
  startWakeWordListener,
} from './lib/backgroundVoiceService';

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [createInitialMode, setCreateInitialMode] = useState<'image' | 'video'>('image');
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('providers');
  const [settingsFocusProvider, setSettingsFocusProvider] = useState<string | undefined>(undefined);
  const [liveAutoStartTrigger, setLiveAutoStartTrigger] = useState(0);
  const [bgLiveStatus, setBgLiveStatus] = useState(() => getBackgroundLiveSessionStatus());

  const commitTabChange = useCallback((nextTab: string, source: string, fromPopState = false) => {
    const prevTab = activeTabRef.current;
    if (prevTab === nextTab) return;
    addDebugLog('Nav:TabChange', `${prevTab} -> ${nextTab} (source=${source})`);
    if (prevTab === 'chat' || (prevTab === 'live' && !isBackgroundLiveEnabled())) {
      void stopSpeaking('tab_switch');
    }
    if (
      prevTab === 'live' &&
      (!isBackgroundLiveEnabled() || !getBackgroundLiveSessionStatus().isLiveSessionActive || nextTab === 'chat')
    ) {
      void prepareNativeAudioRoute('media', 'tab_change');
    }
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);
    if (!fromPopState && typeof window !== 'undefined' && window.history?.pushState) {
      if (window.history.state?.omniTab !== nextTab) {
        try {
          window.history.pushState({ ...(window.history.state || {}), omniTab: nextTab }, '', `#${nextTab}`);
        } catch (_) {}
      }
    }
  }, []);

  const handleOpenSettings = useCallback((section?: SettingsSectionId, providerId?: string) => {
    if (section) {
      setSettingsSection(section);
    }
    setSettingsFocusProvider(providerId);
    commitTabChange('settings', `open_settings:${section || 'default'}${providerId ? `:${providerId}` : ''}`);
  }, [commitTabChange]);

  const handleNavigateTab = useCallback((tab: string) => {
    if (tab === 'image') {
      setCreateInitialMode('image');
      commitTabChange('create', 'navigate:image');
      return;
    }
    if (tab === 'video') {
      setCreateInitialMode('video');
      commitTabChange('create', 'navigate:video');
      return;
    }
    if (tab === 'integrations') {
      setSettingsSection('backup');
      setSettingsFocusProvider(undefined);
      commitTabChange('settings', 'navigate:integrations');
      return;
    }
    commitTabChange(tab, 'navigate');
  }, [commitTabChange]);

  const handlePopStateTab = useCallback((tab: string) => {
    commitTabChange(tab, 'popstate', true);
  }, [commitTabChange]);

  const handleNavigateToChat = useCallback(() => {
    commitTabChange('chat', 'settings_to_chat');
  }, [commitTabChange]);

  useEffect(() => {
    applyThemeAccentCssVars();
    void hydratePersistentStateFromNative();
    void auditDevicePermissionsOnLaunch();
    return subscribeBackgroundLiveStatus(setBgLiveStatus);
  }, []);

  // Start wake word listener on startup if user explicitly enabled it in Settings
  useEffect(() => {
    if (isWakeWordEnabled()) {
      startWakeWordListener(getActiveIdentity()).catch(() => {});
    }
  }, []);

  // Listen for Wake Word detections -> switch to Live tab and auto-start session
  useEffect(() => {
    return subscribeWakeWordDetected((event) => {
      const name = event.identity === 'tyler' ? 'Tyler' : 'Sierra';
      toast.success(`Wake word "${event.keywordLabel}" detected — starting ${name} Live!`);
      commitTabChange('live', 'wake_word');
      setLiveAutoStartTrigger((prev) => prev + 1);
    });
  }, [commitTabChange]);

  // Listen for Android Default Assistant gesture (both cold-start and already-running)
  useEffect(() => {
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    let mounted = true;

    const triggerAssistantSession = () => {
      if (!mounted) return;
      const id = getActiveIdentity();
      const name = id === 'tyler' ? 'Tyler' : 'Sierra';
      toast.info(`Launched via Android Assistant — starting ${name} Live...`);
      commitTabChange('live', 'assistant_launch');
      setLiveAutoStartTrigger((prev) => prev + 1);
    };

    // 1. Check cold-start intent
    SierraBackgroundVoice.consumePendingAssistantLaunch()
      .then((res) => {
        if (res?.launchedAsAssistant) {
          triggerAssistantSession();
        }
      })
      .catch(() => {});

    // 2. Listen for warm/already-running onNewIntent assistant launches
    SierraBackgroundVoice.addListener('onAssistantLaunch', (ev) => {
      if (ev?.launchedAsAssistant) {
        triggerAssistantSession();
      }
    })
      .then((h) => {
        listenerHandle = h;
      })
      .catch(() => {});

    return () => {
      mounted = false;
      if (listenerHandle) {
        listenerHandle.remove().catch(() => {});
      }
    };
  }, [commitTabChange]);

  const keepLiveMounted =
    activeTab === 'live' ||
    isBackgroundLiveEnabled() ||
    bgLiveStatus.isLiveSessionActive ||
    liveAutoStartTrigger > 0;

  const renderNonLiveContent = () => {
    switch (activeTab) {
      case 'home':
        return <HomeView onNavigateTab={handleNavigateTab} />;
      case 'chat':
        return (
          <ChatInterface
            onOpenSettings={(sec, provId) => handleOpenSettings(sec || 'models', provId)}
          />
        );
      case 'create':
      case 'image':
      case 'video':
        return <MediaGenerator initialMode={createInitialMode} />;
      case 'integrations':
        return (
          <SettingsView
            initialSection="backup"
            onNavigateToChat={handleNavigateToChat}
          />
        );
      case 'settings':
        return (
          <SettingsView
            initialSection={settingsSection}
            initialProviderId={settingsFocusProvider}
            onNavigateToChat={handleNavigateToChat}
          />
        );
      default:
        return <HomeView onNavigateTab={handleNavigateTab} />;
    }
  };

  return (
    <ErrorBoundary>
      <UIProvider>
        <TooltipProvider>
          <Layout activeTab={activeTab} setActiveTab={handleNavigateTab} onPopStateTab={handlePopStateTab}>
            {keepLiveMounted && (
              <div
                className={
                  activeTab === 'live'
                    ? 'flex-1 flex flex-col h-full min-h-0 overflow-hidden'
                    : 'hidden'
                }
              >
                <LiveVoice
                  autoStartTrigger={liveAutoStartTrigger}
                  isTabActive={activeTab === 'live'}
                  onOpenSettings={(sec, provId) => handleOpenSettings(sec || 'models', provId)}
                />
              </div>
            )}
            {activeTab !== 'live' && renderNonLiveContent()}
          </Layout>
          <ActionConfirmDialog />
          <Toaster position="top-right" theme="dark" />
          <SpeedInsights />
        </TooltipProvider>
      </UIProvider>
    </ErrorBoundary>
  );
}
