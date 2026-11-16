import React, { useEffect, useRef, useState } from 'react';
import { logout, useSafeAuthState } from '../lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Home, Mic, MessageSquare, Sparkles, Settings, LogOut, Radio } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  subscribeBackgroundLiveStatus,
  getBackgroundLiveSessionStatus,
  getActiveWakeWordEngine,
} from '../lib/backgroundVoiceService';
import { IDENTITIES } from '../lib/persona';
import { useActiveIdentityAccent } from '../lib/themeStore';
import { triggerHaptic } from '../lib/haptics';
import { addDebugLog } from '../lib/debugLogStore';

export const VALID_APP_TABS = new Set(['home', 'live', 'chat', 'create', 'settings']);

export function resolvePopStateTabTarget(currentTab: string, eventState: unknown): string | null {
  if (eventState && typeof eventState === 'object') {
    const candidate = (eventState as { omniTab?: unknown }).omniTab;
    if (typeof candidate === 'string' && VALID_APP_TABS.has(candidate) && candidate !== currentTab) {
      return candidate;
    }
  }
  return null;
}

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onPopStateTab?: (tab: string) => void;
}

export default function Layout({ children, activeTab, setActiveTab, onPopStateTab }: LayoutProps) {
  const [user] = useSafeAuthState();
  const [bgStatus, setBgStatus] = useState(() => getBackgroundLiveSessionStatus());
  const { identity, accentHex, accentRgb } = useActiveIdentityAccent();

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const setActiveTabRef = useRef(setActiveTab);
  setActiveTabRef.current = setActiveTab;
  const onPopStateTabRef = useRef(onPopStateTab);
  onPopStateTabRef.current = onPopStateTab;

  useEffect(() => {
    return subscribeBackgroundLiveStatus(setBgStatus);
  }, []);

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'live', icon: Mic, label: 'Live' },
    { id: 'chat', icon: MessageSquare, label: 'Chat' },
    { id: 'create', icon: Sparkles, label: 'Create' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  // Handle hardware / browser back navigation without clobbering active tabs on spurious popstate events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.history.state?.omniTab) {
      try {
        window.history.replaceState(
          { ...(window.history.state || {}), omniTab: activeTabRef.current },
          '',
          `#${activeTabRef.current}`,
        );
      } catch (_) {}
    }

    const handlePopState = (event: PopStateEvent) => {
      const target = resolvePopStateTabTarget(activeTabRef.current, event.state);
      addDebugLog(
        'Nav:PopState',
        `popstate current=${activeTabRef.current}, state=${JSON.stringify(event.state || null)}, hash=${window.location.hash || '""'}, target=${target || 'ignored'}`,
      );
      if (target) {
        if (onPopStateTabRef.current) {
          onPopStateTabRef.current(target);
        } else {
          setActiveTabRef.current(target);
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleTabChange = (tabId: string) => {
    if (tabId !== activeTab) {
      triggerHaptic('light');
      if (!onPopStateTab && typeof window !== 'undefined' && window.history?.state?.omniTab !== tabId) {
        try {
          window.history.pushState({ ...(window.history.state || {}), omniTab: tabId }, '', `#${tabId}`);
        } catch (_) {}
      }
      setActiveTab(tabId);
    }
  };

  const currentTabItem = navItems.find((n) => n.id === activeTab);
  const identityObj = IDENTITIES[identity] || IDENTITIES.sierra;

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] min-h-0 w-screen bg-[#0A0E14] text-slate-100 overflow-hidden font-sans select-none">
      {/* Mobile Top Sci-Fi Header */}
      <header
        className="md:hidden flex items-center justify-between px-4 pb-2.5 bg-[#0D121A]/95 border-b border-[#C8CDD3]/15 backdrop-blur-xl z-30 shrink-0"
        style={{ paddingTop: 'max(20px, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center border transition-all duration-500 shrink-0"
            style={{
              backgroundColor: `rgba(${accentRgb}, 0.14)`,
              borderColor: `rgba(${accentRgb}, 0.48)`,
              boxShadow: `0 0 16px rgba(${accentRgb}, 0.25)`,
              color: accentHex,
            }}
          >
            <span className="text-sm">{identityObj.avatar}</span>
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="sci-heading font-bold text-base tracking-tight text-white">
              OmniAgent
            </span>
            <span
              className="text-[10px] font-bold uppercase tracking-[0.18em] truncate transition-colors duration-500"
              style={{ color: accentHex }}
            >
              {currentTabItem ? currentTabItem.label : identityObj.name}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {user && (
            <div className="flex items-center gap-1.5">
              <Avatar className="w-8 h-8 border border-[#C8CDD3]/25">
                <AvatarImage src={user.photoURL || ''} />
                <AvatarFallback className="text-xs bg-[#151E2B] text-[#C8CDD3]">
                  {user.displayName?.[0] || 'U'}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={logout}
                className="min-h-[48px] min-w-[48px] flex items-center justify-center text-[#C8CDD3]/75 hover:text-white active:bg-white/10 rounded-xl touch-manipulation"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Desktop / Tablet Navigation Rail */}
      <aside className="hidden md:flex w-64 border-r border-[#C8CDD3]/15 flex-col bg-[#0D121A]/95 backdrop-blur-xl shrink-0">
        <div
          className="px-6 pb-6 flex items-center gap-3"
          style={{ paddingTop: 'max(24px, env(safe-area-inset-top))' }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-500"
            style={{
              backgroundColor: `rgba(${accentRgb}, 0.15)`,
              borderColor: `rgba(${accentRgb}, 0.5)`,
              boxShadow: `0 0 22px rgba(${accentRgb}, 0.3)`,
              color: accentHex,
            }}
          >
            <span className="text-lg">{identityObj.avatar}</span>
          </div>
          <div>
            <span className="sci-heading font-bold text-xl tracking-tight block text-white">
              OmniAgent
            </span>
            <span
              className="text-[10px] font-bold block -mt-0.5 tracking-[0.2em] uppercase transition-colors duration-500"
              style={{ color: accentHex }}
            >
              {identityObj.name} Core
            </span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-2" aria-label="Main Navigation">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-tab-${item.id}`}
                onClick={() => handleTabChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-200 group text-left min-h-[48px] border cursor-pointer',
                  isActive
                    ? 'text-white font-semibold'
                    : 'text-[#C8CDD3]/75 hover:bg-white/5 hover:text-white border-transparent font-medium'
                )}
                style={
                  isActive
                    ? {
                        backgroundColor: `rgba(${accentRgb}, 0.12)`,
                        borderColor: `rgba(${accentRgb}, 0.42)`,
                        boxShadow: `0 0 20px -6px rgba(${accentRgb}, 0.45)`,
                      }
                    : undefined
                }
              >
                <item.icon
                  className="w-5 h-5 transition-transform duration-200 group-hover:scale-110 shrink-0"
                  style={isActive ? { color: accentHex } : undefined}
                />
                <span className="text-sm">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {user && (
          <div className="p-4 border-t border-[#C8CDD3]/15">
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[#101620] border border-[#C8CDD3]/15">
              <Avatar className="w-9 h-9 border border-[#C8CDD3]/25">
                <AvatarImage src={user.photoURL || ''} />
                <AvatarFallback>{user.displayName?.[0] || 'U'}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-white">{user.displayName || 'User'}</p>
                <button
                  type="button"
                  onClick={logout}
                  className="text-xs text-[#C8CDD3]/70 hover:text-white flex items-center gap-1 mt-0.5 min-h-[32px]"
                >
                  <LogOut className="w-3 h-3" /> Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-[#0A0E14] min-w-0 min-h-0">
        {bgStatus.isLiveSessionActive && activeTab !== 'live' && (
          <div
            data-testid="global-background-live-indicator"
            className="w-full px-3 py-1.5 bg-emerald-950/90 border-b border-emerald-500/40 flex items-center justify-between gap-2 text-xs text-emerald-200 z-20 shrink-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
              <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-semibold truncate">
                {identityObj.name} Live is active in background (Mic On)
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleTabChange('live')}
              className="px-3 py-1 min-h-[36px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] shrink-0"
            >
              Return to Live
            </button>
          </div>
        )}
        {!bgStatus.isLiveSessionActive && Boolean(getActiveWakeWordEngine()) && (
          <div
            data-testid="global-wake-word-indicator"
            className="w-full px-3 py-1 bg-[#101620] border-b border-[#C8CDD3]/15 flex items-center justify-between gap-2 text-[11px] text-[#C8CDD3] z-20 shrink-0"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                style={{ backgroundColor: accentHex }}
              />
              <span className="truncate">
                On-device wake word active ({bgStatus.identity === 'tyler' ? 'Tyler' : 'Sierra'}) — audio stays on phone until wake word
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleTabChange('settings')}
              className="text-[11px] underline hover:text-white shrink-0"
              style={{ color: accentHex }}
            >
              Settings
            </button>
          </div>
        )}
        {children}
      </main>

      {/* Mobile Persistent 5-Tab Bottom Navigation Bar */}
      <nav
        className="md:hidden flex items-center justify-around bg-[#0D121A]/95 border-t border-[#C8CDD3]/15 backdrop-blur-xl px-1 pt-1 z-30 shrink-0 select-none touch-manipulation pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        role="navigation"
        aria-label="Main Navigation"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-tab-${item.id}`}
              onClick={() => handleTabChange(item.id)}
              className={cn(
                'flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition-all duration-200 min-h-[52px] min-w-[48px] cursor-pointer',
                isActive ? 'text-white' : 'text-[#C8CDD3]/65 active:text-white'
              )}
            >
              <div
                className="w-12 h-7 rounded-full flex items-center justify-center transition-all duration-300 mb-0.5 border"
                style={
                  isActive
                    ? {
                        backgroundColor: `rgba(${accentRgb}, 0.16)`,
                        borderColor: `rgba(${accentRgb}, 0.45)`,
                        color: accentHex,
                        boxShadow: `0 0 14px rgba(${accentRgb}, 0.35)`,
                      }
                    : {
                        backgroundColor: 'transparent',
                        borderColor: 'transparent',
                      }
                }
              >
                <item.icon className="w-4 h-4" />
              </div>
              <span
                className={cn(
                  'text-[10.5px] tracking-tight truncate max-w-[60px]',
                  isActive ? 'font-bold text-white' : 'font-medium text-[#C8CDD3]/70'
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
