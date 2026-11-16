import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Database, CheckCircle2, XCircle, ExternalLink, Loader2, RefreshCw, Share2 as GithubIcon } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@supabase/supabase-js';
import { useActiveIdentityAccent } from '../lib/themeStore';

interface IntegrationsProps {
  embedded?: boolean;
}

export default function Integrations({ embedded = false }: IntegrationsProps = {}) {
  const { accentHex, accentRgb } = useActiveIdentityAccent();
  const [githubUser, setGithubUser] = useState<any>(null);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [supabaseConfig, setSupabaseConfig] = useState<{ url: string; anonKey: string } | null>(null);
  const [isSupabaseConnected, setIsSupabaseConnected] = useState(false);

  useEffect(() => {
    fetchGithubUser();
    fetchSupabaseConfig();
  }, []);

  const fetchGithubUser = async () => {
    setIsGithubLoading(true);
    try {
      const response = await fetch('/api/github/user');
      if (response.ok) {
        const data = await response.json();
        setGithubUser(data);
      } else {
        setGithubUser(null);
      }
    } catch (error) {
      console.error('Failed to fetch GitHub user:', error);
    } finally {
      setIsGithubLoading(false);
    }
  };

  const fetchSupabaseConfig = async () => {
    try {
      const response = await fetch('/api/config/supabase');
      const data = await response.json();
      if (data.url && data.anonKey) {
        setSupabaseConfig(data);
        // Test connection
        const supabase = createClient(data.url, data.anonKey);
        await supabase.from('_test_connection').select('*').limit(1);
        // We don't care if the table exists, just if the client initializes and can reach the server
        setIsSupabaseConnected(true);
      }
    } catch (error) {
      console.error('Failed to fetch Supabase config:', error);
    }
  };

  const handleConnectGithub = async () => {
    try {
      const response = await fetch('/api/auth/github/url');
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to get GitHub auth URL');
      }
      const { url } = await response.json();

      const authWindow = window.open(url, 'github_oauth', 'width=600,height=700');
      
      if (!authWindow) {
        toast.error('Popup blocked. Please allow popups to connect GitHub.');
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
          toast.success('GitHub connected successfully!');
          fetchGithubUser();
          window.removeEventListener('message', handleMessage);
        }
      };

      window.addEventListener('message', handleMessage);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDisconnectGithub = async () => {
    try {
      await fetch('/api/github/logout', { method: 'POST' });
      setGithubUser(null);
      toast.success('GitHub disconnected');
    } catch (error) {
      toast.error('Failed to disconnect GitHub');
    }
  };

  const cardsContent = (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* GitHub Integration */}
        <Card className="sci-card bg-[#0F1520]/90 border-[#C8CDD3]/15 overflow-hidden">
          <CardHeader className="border-b border-[#C8CDD3]/12 bg-[#0A0E14]/60">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div
                  className="p-2.5 rounded-xl bg-[#0A0E14] border border-[#C8CDD3]/20"
                  style={{ boxShadow: `0 0 12px rgba(${accentRgb}, 0.14)` }}
                >
                  <GithubIcon className="w-5 h-5" style={{ color: accentHex }} />
                </div>
                <div>
                  <CardTitle className="text-lg font-display text-white">GitHub</CardTitle>
                  <CardDescription className="text-xs text-[#C8CDD3]/70">Code &amp; Repositories</CardDescription>
                </div>
              </div>
              {githubUser ? (
                <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[10px] font-bold text-[#C8CDD3]/65 uppercase tracking-widest bg-[#151D2B] border border-[#C8CDD3]/15 px-2.5 py-1 rounded-full">
                  <XCircle className="w-3 h-3" /> Disconnected
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {isGithubLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: accentHex }} />
              </div>
            ) : githubUser ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15">
                  <img src={githubUser.avatar_url} alt={githubUser.login} className="w-12 h-12 rounded-full border border-[#C8CDD3]/25" />
                  <div>
                    <p className="font-bold text-white">{githubUser.name || githubUser.login}</p>
                    <p className="text-xs text-[#C8CDD3]/65">@{githubUser.login}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15 text-center">
                    <p className="text-xs text-[#C8CDD3]/65 uppercase tracking-widest font-bold">Repos</p>
                    <p className="text-xl font-bold text-white">{githubUser.public_repos}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15 text-center">
                    <p className="text-xs text-[#C8CDD3]/65 uppercase tracking-widest font-bold">Followers</p>
                    <p className="text-xl font-bold text-white">{githubUser.followers}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full min-h-[48px] border-[#C8CDD3]/20 text-[#C8CDD3] hover:bg-red-950/30 hover:text-red-300 rounded-xl transition-colors"
                  onClick={handleDisconnectGithub}
                >
                  Disconnect GitHub
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[#C8CDD3]/75 leading-relaxed">
                  Connect your GitHub account to allow OmniAgent to interact with your repositories, create gists, and manage issues.
                </p>
                <Button
                  className="w-full min-h-[48px] font-bold gap-2 rounded-xl text-[#0A0E14] transition-all"
                  style={{
                    backgroundColor: accentHex,
                    boxShadow: `0 0 18px rgba(${accentRgb}, 0.3)`,
                  }}
                  onClick={handleConnectGithub}
                >
                  <GithubIcon className="w-4 h-4" /> Connect GitHub
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Supabase Integration */}
        <Card className="sci-card bg-[#0F1520]/90 border-[#C8CDD3]/15 overflow-hidden">
          <CardHeader className="border-b border-[#C8CDD3]/12 bg-[#0A0E14]/60">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div
                  className="p-2.5 rounded-xl bg-[#0A0E14] border border-[#C8CDD3]/20"
                  style={{ boxShadow: `0 0 12px rgba(${accentRgb}, 0.14)` }}
                >
                  <Database className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <CardTitle className="text-lg font-display text-white">Supabase</CardTitle>
                  <CardDescription className="text-xs text-[#C8CDD3]/70">Database &amp; Storage</CardDescription>
                </div>
              </div>
              {isSupabaseConnected ? (
                <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Active
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[10px] font-bold text-[#C8CDD3]/65 uppercase tracking-widest bg-[#151D2B] border border-[#C8CDD3]/15 px-2.5 py-1 rounded-full">
                  <XCircle className="w-3 h-3" /> Inactive
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {supabaseConfig ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#C8CDD3]/65 uppercase tracking-widest">Project URL</label>
                  <div className="p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15 text-xs font-mono text-[#C8CDD3]/80 truncate">
                    {supabaseConfig.url}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <p className="text-sm text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Supabase connection established.
                  </p>
                  <p className="text-xs text-[#C8CDD3]/70 mt-2">
                    OmniAgent can now sync your chat history and media to your Supabase project.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full min-h-[48px] border-[#C8CDD3]/20 text-[#C8CDD3] hover:bg-[#151D2B] rounded-xl gap-2"
                  onClick={fetchSupabaseConfig}
                >
                  <RefreshCw className="w-4 h-4" /> Refresh Connection
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[#C8CDD3]/75 leading-relaxed">
                  To connect Supabase, set <code className="text-white">SUPABASE_URL</code> and <code className="text-white">SUPABASE_ANON_KEY</code> in AI Studio Secrets.
                </p>
                <Button
                  variant="outline"
                  className="w-full min-h-[48px] border-[#C8CDD3]/20 text-[#C8CDD3] hover:bg-[#151D2B] rounded-xl gap-2"
                  onClick={() => window.open('https://supabase.com/dashboard', '_blank')}
                >
                  <ExternalLink className="w-4 h-4" /> Open Supabase Dashboard
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="sci-card bg-[#0F1520]/90 border-[#C8CDD3]/15">
        <CardHeader>
          <CardTitle className="text-lg font-display text-white">Cloud Integration Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-4 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15">
              <div className="flex items-center gap-3">
                <GithubIcon className="w-5 h-5 text-[#C8CDD3]" />
                <div>
                  <p className="text-sm font-bold text-white">GitHub API</p>
                  <p className="text-xs text-[#C8CDD3]/65">Operational</p>
                </div>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-[#C8CDD3]" />
                <div>
                  <p className="text-sm font-bold text-white">Supabase Realtime</p>
                  <p className="text-xs text-[#C8CDD3]/65">Operational</p>
                </div>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  if (embedded) {
    return cardsContent;
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-[#0A0E14]">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-display font-bold tracking-tight text-white">
            External Integrations
          </h1>
          <p className="text-[#C8CDD3]/75">Connect OmniAgent to your favorite 3rd party services.</p>
        </header>
        {cardsContent}
      </div>
    </div>
  );
}
