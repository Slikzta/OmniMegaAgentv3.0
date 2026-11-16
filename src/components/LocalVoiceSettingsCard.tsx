import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card } from './ui/card';
import {
  Cpu,
  Download,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Check,
  WifiOff,
  HardDrive,
  Flame,
  Gauge,
  Volume2,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { addDebugLog } from '../lib/debugLogStore';
import {
  LOCAL_LLM_MODELS,
  LOCAL_WHISPER_MODELS,
  LOCAL_SILERO_VAD_MODEL,
  LOCAL_PIPER_VOICE_MODEL,
  getLocalVoiceSettings,
  saveLocalVoiceSettings,
  getRequiredModelsForSettings,
  formatBytesHuman,
  evaluateDownloadPreflight,
  getSierraLocalVoicePlugin,
  type LocalVoiceSettings,
  type LocalLlmPresetId,
  type LocalWhisperSizeId,
  type LocalTtsEngineId,
  type LocalChatTemplateId,
  type LocalModelArtifactSpec,
  type LocalModelDownloadItemState,
  type LocalVoiceMemoryAndSpeedStats,
  type BargeInModeSetting,
  type MicSourceSetting,
} from '../lib/localVoiceEngine';
import { getRecommendedWhisperModel } from '../lib/sttFilter';

interface ModelRuntimeRowState {
  spec: LocalModelArtifactSpec;
  state: LocalModelDownloadItemState;
  downloadedBytes: number;
  totalBytes: number;
  sha256Verified: boolean;
  error?: string;
}

interface LocalVoiceSettingsCardProps {
  isModal?: boolean;
  onAllRequiredReady?: () => void;
  onCloseModal?: () => void;
}

export function LocalVoiceSettingsCard({
  isModal = false,
  onAllRequiredReady,
  onCloseModal,
}: LocalVoiceSettingsCardProps) {
  const [settings, setSettings] = useState<LocalVoiceSettings>(() => getLocalVoiceSettings());
  const [modelsState, setModelsState] = useState<Record<string, ModelRuntimeRowState>>({});
  const [isWifi, setIsWifi] = useState<boolean>(true);
  const [freeStorageBytes, setFreeStorageBytes] = useState<number>(32 * 1024 * 1024 * 1024);
  const [stats, setStats] = useState<LocalVoiceMemoryAndSpeedStats>({
    usedRamMb: 0,
    availableRamMb: 0,
    totalRamMb: 12288,
    tokensPerSec: 0,
    timeToFirstAudioMs: 0,
    lastTurnLatencyMs: 0,
    thermalStatus: 'none',
    modelLoaded: false,
  });
  const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
  const [recommendedWhisper, setRecommendedWhisper] = useState<LocalWhisperSizeId>('base.en');

  const requiredSpecs = getRequiredModelsForSettings(settings);

  const refreshStatus = useCallback(async (cfg: LocalVoiceSettings = settings) => {
    let effectiveCfg = cfg;
    const plugin = getSierraLocalVoicePlugin();
    try {
      const sysRes = await plugin.getStorageAndNetworkStatus();
      if (sysRes?.ok) {
        setIsWifi(Boolean(sysRes.isWifi));
        setFreeStorageBytes(Number(sysRes.freeStorageBytes || 0));
        const rec = getRecommendedWhisperModel(sysRes.cpuCores, sysRes.totalRamMb);
        setRecommendedWhisper(rec);
        if (
          !cfg.whisperSizeUserSelected &&
          typeof sysRes.totalRamMb === 'number' &&
          sysRes.totalRamMb > 0 &&
          rec !== cfg.whisperSize
        ) {
          effectiveCfg = saveLocalVoiceSettings({
            whisperSize: rec,
            whisperSizeUserSelected: false,
          });
          setSettings(effectiveCfg);
        }
      }
      const specs = getRequiredModelsForSettings(effectiveCfg);
      const [modRes, memRes] = await Promise.all([
        plugin.getModelsStatus({
          models: specs.map((s) => ({
            id: s.id,
            filename: s.filename,
            sizeBytes: s.sizeBytes,
            sha256: s.sha256,
          })),
        }),
        plugin.getMemoryAndSpeedStats(),
      ]);

      if (memRes) {
        setStats(memRes);
      }

      setModelsState((prev) => {
        const next: Record<string, ModelRuntimeRowState> = {};
        for (const spec of specs) {
          const nativeInfo = modRes?.models?.[spec.id];
          const prevItem = prev[spec.id];
          const isDownloaded = Boolean(nativeInfo?.downloaded);
          const partialBytes = Number(nativeInfo?.partialBytes || 0);
          next[spec.id] = {
            spec,
            state: isDownloaded
              ? 'downloaded'
              : prevItem?.state === 'downloading'
                ? 'downloading'
                : partialBytes > 0
                  ? 'paused'
                  : 'not_downloaded',
            downloadedBytes: isDownloaded ? spec.sizeBytes : partialBytes,
            totalBytes: spec.sizeBytes,
            sha256Verified: isDownloaded,
            error: prevItem?.error,
          };
        }
        return next;
      });
    } catch (err: any) {
      addDebugLog('LocalVoice:StatusError', err?.message || String(err));
    }
  }, [settings]);

  useEffect(() => {
    void refreshStatus(settings);
    const plugin = getSierraLocalVoicePlugin();
    let progressSub: { remove: () => Promise<void> } | null = null;
    let metricsSub: { remove: () => Promise<void> } | null = null;
    let thermalSub: { remove: () => Promise<void> } | null = null;

    plugin
      .addListener('localDownloadProgress', (evt) => {
        if (!evt?.modelId) return;
        setModelsState((prev) => {
          const existing = prev[evt.modelId];
          if (!existing) return prev;
          return {
            ...prev,
            [evt.modelId]: {
              ...existing,
              state: evt.state || 'downloading',
              downloadedBytes: Number(evt.downloadedBytes || 0),
              totalBytes: Number(evt.totalBytes || existing.totalBytes),
            },
          };
        });
      })
      .then((h) => {
        progressSub = h;
      })
      .catch(() => {});

    plugin
      .addListener('localTurnMetrics', () => {
        plugin
          .getMemoryAndSpeedStats()
          .then((s) => setStats(s))
          .catch(() => {});
      })
      .then((h) => {
        metricsSub = h;
      })
      .catch(() => {});

    plugin
      .addListener('localThermalWarning', (evt) => {
        if (evt?.message) {
          addDebugLog('LocalVoice:Thermal', evt.message);
          toast.warning(evt.message);
        }
        plugin
          .getMemoryAndSpeedStats()
          .then((s) => setStats(s))
          .catch(() => {});
      })
      .then((h) => {
        thermalSub = h;
      })
      .catch(() => {});

    return () => {
      progressSub?.remove().catch(() => {});
      metricsSub?.remove().catch(() => {});
      thermalSub?.remove().catch(() => {});
    };
  }, [refreshStatus, settings]);

  const handleUpdateSettings = (patch: Partial<LocalVoiceSettings>) => {
    const updated = saveLocalVoiceSettings(patch);
    setSettings(updated);
    void refreshStatus(updated);
  };

  const totalRequiredBytes = requiredSpecs.reduce((acc, s) => acc + s.sizeBytes, 0);
  const alreadyDownloadedBytes = requiredSpecs.reduce((acc, s) => {
    const st = modelsState[s.id];
    return acc + (st ? st.downloadedBytes : 0);
  }, 0);

  const preflight = evaluateDownloadPreflight({
    requiredBytes: totalRequiredBytes,
    alreadyDownloadedBytes,
    freeStorageBytes,
    isWifi,
  });

  const allRequiredDownloaded = requiredSpecs.every((s) => modelsState[s.id]?.state === 'downloaded');

  const downloadSingleSpec = async (spec: LocalModelArtifactSpec): Promise<boolean> => {
    const plugin = getSierraLocalVoicePlugin();
    setModelsState((prev) => ({
      ...prev,
      [spec.id]: {
        spec,
        state: 'downloading',
        downloadedBytes: prev[spec.id]?.downloadedBytes || 0,
        totalBytes: spec.sizeBytes,
        sha256Verified: false,
        error: undefined,
      },
    }));
    addDebugLog(
      'LocalDownload:Start',
      `Downloading ${spec.filename} (${formatBytesHuman(spec.sizeBytes)}) from ${spec.downloadUrl}`,
    );

    const res = await plugin.downloadModel({
      modelId: spec.id,
      filename: spec.filename,
      downloadUrl: spec.downloadUrl,
      expectedSizeBytes: spec.sizeBytes,
      expectedSha256: spec.sha256,
    });

    if (res.ok && res.state === 'downloaded') {
      const isUnverified = Boolean(res.checksumUnverified || !spec.sha256);
      if (isUnverified) {
        addDebugLog(
          'LocalDownload:ChecksumUnverified',
          `checksum unverified for ${spec.filename} (verified by exact byte size: ${res.downloadedBytes || spec.sizeBytes} bytes)`,
        );
      } else {
        addDebugLog(
          'LocalDownload:Verified',
          `Completed & SHA-256 verified ${spec.filename} (${formatBytesHuman(res.downloadedBytes)} | sha256=${spec.sha256})`,
        );
      }
      setModelsState((prev) => ({
        ...prev,
        [spec.id]: {
          spec,
          state: 'downloaded',
          downloadedBytes: res.downloadedBytes || spec.sizeBytes,
          totalBytes: spec.sizeBytes,
          sha256Verified: !isUnverified,
          error: undefined,
        },
      }));
      return true;
    }

    if (res.state === 'paused') {
      addDebugLog('LocalDownload:Paused', `Paused ${spec.filename} at ${formatBytesHuman(res.downloadedBytes)}`);
      setModelsState((prev) => ({
        ...prev,
        [spec.id]: {
          spec,
          state: 'paused',
          downloadedBytes: res.downloadedBytes,
          totalBytes: spec.sizeBytes,
          sha256Verified: false,
        },
      }));
      return false;
    }

    const errMsg =
      res.expectedSha256 && res.actualSha256
        ? `SHA-256 mismatch for ${spec.filename}: expected ${res.expectedSha256}, got ${res.actualSha256}${res.badFilePath ? ` (kept as ${res.badFilePath})` : ''}`
        : res.reason || 'Download failed';
    addDebugLog('LocalDownload:Error', `${spec.filename} failed: ${errMsg}`);
    setModelsState((prev) => ({
      ...prev,
      [spec.id]: {
        spec,
        state: 'error',
        downloadedBytes: res.downloadedBytes || 0,
        totalBytes: spec.sizeBytes,
        sha256Verified: false,
        error: errMsg,
      },
    }));
    toast.error(`${spec.filename}: ${errMsg}`);
    return false;
  };

  const handleDownloadAllRequired = async () => {
    if (!preflight.hasEnoughStorage) {
      toast.error(preflight.storageWarning || 'Not enough free storage space to download models.');
      addDebugLog('LocalDownload:LowStorage', preflight.storageWarning || 'Blocked due to low storage');
      return;
    }
    setIsDownloadingBatch(true);
    try {
      let allSucceeded = true;
      for (const spec of requiredSpecs) {
        const cur = modelsState[spec.id];
        if (cur?.state === 'downloaded') continue;
        const ok = await downloadSingleSpec(spec);
        if (!ok) {
          allSucceeded = false;
          // Continue with the remaining items even when one fails
        }
      }
      if (allSucceeded) {
        toast.success('All required Local Voice models downloaded and verified! Works in Airplane Mode.');
        onAllRequiredReady?.();
      }
    } finally {
      setIsDownloadingBatch(false);
    }
  };

  const handlePauseModel = async (modelId: string) => {
    await getSierraLocalVoicePlugin().pauseDownload({ modelId });
  };

  const handleDeleteAllModels = async () => {
    const res = await getSierraLocalVoicePlugin().deleteModels();
    if (res.ok) {
      addDebugLog(
        'LocalDownload:DeleteAll',
        `Deleted ${res.deletedCount} model files (${formatBytesHuman(res.freedBytes)} freed)`,
      );
      toast.info(`Deleted local models (${formatBytesHuman(res.freedBytes)} freed).`);
      await refreshStatus(settings);
    }
  };

  return (
    <Card
      data-testid="local-voice-settings-card"
      className={cn(
        'sci-card bg-[#0F1520]/90 border-[#C8CDD3]/15 rounded-2xl p-5 space-y-4 text-zinc-100',
        isModal && 'border-cyan-400/50 bg-[#0A0E14]',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/35 flex items-center justify-center shrink-0 text-cyan-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-display font-bold text-white">Local (on-phone) Offline Voice</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-400/35">
                100% On-Device • Airplane Mode Ready
              </span>
            </div>
            <p className="text-xs text-[#C8CDD3]/70 mt-1">
              Runs Silero VAD, Whisper.cpp STT, quantized GGUF LLMs, and Piper ONNX / Android TTS directly on your phone with zero cloud calls or API keys.
            </p>
          </div>
        </div>
        {isModal && onCloseModal && (
          <Button size="sm" variant="outline" onClick={onCloseModal} className="border-zinc-700 text-zinc-300 text-xs h-8">
            Close
          </Button>
        )}
      </div>

      {/* Wi-Fi & Storage Preflight Warnings */}
      {(!isWifi || !preflight.hasEnoughStorage) && !allRequiredDownloaded && (
        <div className="space-y-2">
          {!isWifi && preflight.wifiWarning && (
            <div
              data-testid="local-voice-wifi-warning"
              className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-200 text-xs"
            >
              <WifiOff className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{preflight.wifiWarning}</span>
            </div>
          )}
          {!preflight.hasEnoughStorage && preflight.storageWarning && (
            <div
              data-testid="local-voice-storage-warning"
              className="flex items-center gap-2 p-2.5 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-xs"
            >
              <HardDrive className="w-4 h-4 shrink-0 text-red-400" />
              <span>{preflight.storageWarning}</span>
            </div>
          )}
        </div>
      )}

      {/* Thermal Throttling Notice */}
      {(stats.thermalStatus === 'severe' || stats.thermalStatus === 'critical' || stats.thermalStatus === 'moderate') && (
        <div
          data-testid="local-voice-thermal-warning"
          className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-orange-950/70 border border-orange-500/50 text-orange-200 text-xs"
        >
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-400 shrink-0" />
            <span>
              Thermal throttling detected (<strong>{stats.thermalStatus}</strong>). Switch to the Small (1.5B) model to reduce heat and speed up responses.
            </span>
          </div>
          {settings.llmPreset !== 'small' && (
            <Button
              size="sm"
              onClick={() => handleUpdateSettings({ llmPreset: 'small' })}
              className="bg-orange-600 hover:bg-orange-500 text-white text-xs h-7 px-2.5 rounded-lg"
            >
              Switch to Small (1.5B)
            </Button>
          )}
        </div>
      )}

      {/* Live Memory & Speed Readout */}
      <div
        data-testid="local-voice-telemetry-readout"
        className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-[#0A0E14]/90 border border-[#C8CDD3]/15"
      >
        <div>
          <div className="text-[10px] text-[#C8CDD3]/60 uppercase font-semibold">RAM Usage / Free</div>
          <div className="text-xs font-mono font-bold text-slate-200">
            {stats.usedRamMb} MB / {stats.availableRamMb} MB free
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#C8CDD3]/60 uppercase font-semibold">LLM Speed</div>
          <div className="text-xs font-mono font-bold text-cyan-300">
            {stats.tokensPerSec > 0 ? `${stats.tokensPerSec.toFixed(1)} tok/s` : '— tok/s'}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#C8CDD3]/60 uppercase font-semibold">Time to First Audio</div>
          <div className="text-xs font-mono font-bold text-cyan-300">
            {stats.timeToFirstAudioMs > 0 ? `${stats.timeToFirstAudioMs} ms` : '— ms'}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#C8CDD3]/60 uppercase font-semibold">Free Storage</div>
          <div className="text-xs font-mono font-bold text-slate-200">{formatBytesHuman(freeStorageBytes)}</div>
        </div>
      </div>

      {/* Last Native Error & Memory Injection Toggle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15">
        <div data-testid="local-voice-last-native-error">
          <div className="text-[10px] text-[#C8CDD3]/60 uppercase font-semibold mb-0.5">
            Last Native Error {stats.inferenceThreads ? `(Threads: ${stats.inferenceThreads})` : ''}
          </div>
          <div
            className={cn(
              'text-xs font-mono break-all whitespace-pre-wrap',
              stats.lastNativeError ? 'text-red-400 font-semibold' : 'text-[#C8CDD3]/70',
            )}
          >
            {stats.lastNativeError && stats.lastNativeError.trim().length > 0
              ? stats.lastNativeError
              : 'None'}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 sm:border-l sm:border-[#C8CDD3]/15 sm:pl-3">
          <div>
            <div className="text-xs font-semibold text-slate-200">
              Inject Memory Summaries
            </div>
            <div className="text-[10px] text-[#C8CDD3]/65">
              Capped at 3 recent summaries &amp; 600 chars max for fast prompt eval
            </div>
          </div>
          <input
            type="checkbox"
            data-testid="local-voice-inject-memory-toggle"
            checked={settings.injectMemory !== false}
            onChange={(e) => handleUpdateSettings({ injectMemory: e.target.checked })}
            className="w-5 h-5 accent-cyan-400 rounded cursor-pointer shrink-0"
          />
        </div>
      </div>

      {/* Model & Pipeline Settings */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-zinc-400 uppercase font-semibold block mb-1">
            LLM Model (Uncensored GGUF Q4)
          </label>
          <select
            data-testid="local-llm-preset-select"
            value={settings.llmPreset}
            onChange={(e) => handleUpdateSettings({ llmPreset: e.target.value as LocalLlmPresetId })}
            className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg h-9 px-2.5 text-xs"
          >
            <option value="small">Small — Qwen2.5 1.5B Abliterated (940 MB)</option>
            <option value="default">Default — Llama 3.2 3B Uncensored (2.24 GB)</option>
            <option value="large">Large — Dolphin 3.0 Llama 3.1 8B (4.92 GB)</option>
            <option value="custom">Custom GGUF URL...</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-zinc-400 uppercase font-semibold block mb-1">
            Whisper STT Model
          </label>
          <select
            data-testid="local-whisper-size-select"
            value={settings.whisperSize}
            onChange={(e) =>
              handleUpdateSettings({
                whisperSize: e.target.value as LocalWhisperSizeId,
                whisperSizeUserSelected: true,
              })
            }
            className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg h-9 px-2.5 text-xs"
          >
            <option value="small.en">
              small.en Q5_1 ({recommendedWhisper === 'small.en' ? 'Recommended for this device — ' : ''}181 MB)
            </option>
            <option value="base.en">
              base.en ({recommendedWhisper === 'base.en' ? 'Recommended — ' : ''}141.1 MB)
            </option>
            <option value="tiny.en">tiny.en (Fast fallback — 74.1 MB)</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-zinc-400 uppercase font-semibold block mb-1">
            Offline TTS Voice Engine
          </label>
          <select
            data-testid="local-tts-engine-select"
            value={settings.ttsEngine}
            onChange={(e) => handleUpdateSettings({ ttsEngine: e.target.value as LocalTtsEngineId })}
            className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg h-9 px-2.5 text-xs"
          >
            <option value="android_tts">Android System Offline TextToSpeech (Active)</option>
            <option value="piper">Piper Voice Assets + Android System TTS Playback</option>
          </select>
        </div>
      </div>

      {/* Large 8B Speed & Heat Warning */}
      {settings.llmPreset === 'large' && LOCAL_LLM_MODELS.large.warning && (
        <div
          data-testid="local-large-model-warning"
          className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-200 text-xs"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <span>{LOCAL_LLM_MODELS.large.warning}</span>
        </div>
      )}

      {/* Custom GGUF URL Input */}
      {settings.llmPreset === 'custom' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
          <div className="sm:col-span-2">
            <label className="text-[10px] text-zinc-400 uppercase font-semibold block mb-1">
              Custom Direct GGUF Download URL
            </label>
            <Input
              data-testid="local-custom-gguf-url-input"
              placeholder="https://huggingface.co/.../resolve/main/model-Q4_K_M.gguf"
              value={settings.customGgufUrl}
              onChange={(e) => handleUpdateSettings({ customGgufUrl: e.target.value })}
              className="bg-zinc-900 border-zinc-800 text-white h-9 text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-400 uppercase font-semibold block mb-1">
              Chat Template
            </label>
            <select
              value={settings.customChatTemplate}
              onChange={(e) => handleUpdateSettings({ customChatTemplate: e.target.value as LocalChatTemplateId })}
              className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-lg h-9 px-2.5 text-xs"
            >
              <option value="chatml">ChatML (&lt;|im_start|&gt;)</option>
              <option value="llama3">Llama 3 (&lt;|start_header_id|&gt;)</option>
            </select>
          </div>
        </div>
      )}

      {/* Silence Timeout & Barge-In Threshold Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15">
        <div>
          <div className="flex items-center justify-between text-[10px] text-[#C8CDD3]/70 uppercase font-semibold mb-1">
            <span>Silence Timeout</span>
            <span className="font-mono text-cyan-300">{settings.silenceTimeoutMs} ms</span>
          </div>
          <input
            type="range"
            min={300}
            max={1500}
            step={50}
            value={settings.silenceTimeoutMs}
            onChange={(e) => handleUpdateSettings({ silenceTimeoutMs: Number(e.target.value) })}
            className="w-full accent-cyan-400"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[10px] text-[#C8CDD3]/70 uppercase font-semibold mb-1">
            <span>Barge-In Threshold</span>
            <span className="font-mono text-cyan-300">{settings.bargeInThreshold.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.3}
            max={0.95}
            step={0.05}
            value={settings.bargeInThreshold}
            onChange={(e) => handleUpdateSettings({ bargeInThreshold: Number(e.target.value) })}
            className="w-full accent-cyan-400"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[10px] text-[#C8CDD3]/70 uppercase font-semibold mb-1">
            <span>Barge-In Sustained Speech</span>
            <span className="font-mono text-cyan-300">{settings.bargeInSustainedMs} ms</span>
          </div>
          <input
            type="range"
            min={400}
            max={1500}
            step={50}
            value={Math.max(400, settings.bargeInSustainedMs)}
            onChange={(e) => handleUpdateSettings({ bargeInSustainedMs: Number(e.target.value) })}
            className="w-full accent-cyan-400"
          />
        </div>
      </div>

      {/* Barge-in Mode Gating */}
      <div className="p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#C8CDD3]/70 uppercase font-semibold">
            Barge-in
          </span>
          <span className="text-[10px] text-[#C8CDD3]/55">
            Adaptive: headset instant; speaker ≥400ms + VAD ≥ 0.85 + RMS &gt; 2×playback
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'adaptive', label: 'Adaptive' },
              { id: 'headphones_only', label: 'Headphones only' },
              { id: 'off', label: 'Off' },
            ] as Array<{ id: BargeInModeSetting; label: string }>
          ).map((opt) => {
            const curMode = settings.bargeInMode || 'headphones_only';
            const active = curMode === opt.id || (opt.id === 'adaptive' && curMode === 'on');
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`barge-in-mode-${opt.id}`}
                onClick={() => handleUpdateSettings({ bargeInMode: opt.id })}
                className={cn(
                  'min-h-[40px] rounded-xl text-xs font-semibold border transition-all px-2',
                  active
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-[#0F1520] border-[#C8CDD3]/20 text-[#C8CDD3]/75 hover:text-white'
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mic Source & Debug Utterance Capture */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-[#0A0E14]/80 border border-[#C8CDD3]/15">
        <div>
          <label className="text-[10px] text-[#C8CDD3]/70 uppercase font-semibold block mb-1">
            Mic Source (AEC Kept On)
          </label>
          <select
            data-testid="local-mic-source-select"
            value={settings.micSource || 'auto'}
            onChange={(e) => handleUpdateSettings({ micSource: e.target.value as MicSourceSetting })}
            className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg h-9 px-2.5 text-xs"
          >
            <option value="auto">Auto (Recognition on speaker / Communication on headset)</option>
            <option value="communication">Communication (VOICE_COMMUNICATION = 7)</option>
            <option value="recognition">Recognition (VOICE_RECOGNITION = 6)</option>
          </select>
        </div>
        <div className="flex items-center justify-between gap-2 sm:border-l sm:border-[#C8CDD3]/15 sm:pl-3">
          <div>
            <div className="text-xs font-semibold text-slate-200">
              Save last 10 utterances
            </div>
            <div className="text-[10px] text-[#C8CDD3]/65">
              Keep 16 kHz PCM clips on device for STT playback &amp; debugging
            </div>
          </div>
          <input
            type="checkbox"
            data-testid="local-save-utterances-toggle"
            checked={Boolean(settings.saveLast10Utterances)}
            onChange={(e) => handleUpdateSettings({ saveLast10Utterances: e.target.checked })}
            className="w-5 h-5 accent-cyan-400 rounded cursor-pointer shrink-0"
          />
        </div>
      </div>

      {/* Required Models Download Manager List */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
            Required On-Device Models ({formatBytesHuman(totalRequiredBytes)} total)
          </div>
          <div className="flex items-center gap-2">
            {!allRequiredDownloaded && (
              <Button
                size="sm"
                data-testid="local-download-selected-models-btn"
                disabled={isDownloadingBatch || !preflight.hasEnoughStorage}
                onClick={handleDownloadAllRequired}
                className="min-h-[48px] bg-cyan-500 hover:bg-cyan-400 text-[#071018] text-xs font-bold px-4 rounded-xl"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {isDownloadingBatch ? 'Downloading...' : 'Download Selected Models'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              data-testid="local-delete-models-btn"
              onClick={handleDeleteAllModels}
              className="min-h-[48px] border-red-800/60 text-red-300 hover:bg-red-950/50 text-xs px-3.5 rounded-xl"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete Models
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {requiredSpecs.map((spec) => {
            const row: ModelRuntimeRowState = modelsState[spec.id] || {
              spec,
              state: 'not_downloaded',
              downloadedBytes: 0,
              totalBytes: spec.sizeBytes,
              sha256Verified: false,
            };
            const pct =
              row.totalBytes > 0 ? Math.min(100, Math.round((row.downloadedBytes / row.totalBytes) * 100)) : 0;

            return (
              <div
                key={spec.id}
                className="p-3 rounded-xl bg-zinc-950/75 border border-zinc-800 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">{spec.label}</span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        ({formatBytesHuman(spec.sizeBytes)})
                      </span>
                      {row.state === 'downloaded' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                          <Check className="w-3 h-3" /> Verified
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500 truncate max-w-md">{spec.filename}</div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {row.state === 'downloading' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handlePauseModel(spec.id)}
                        className="border-amber-500/40 text-amber-200 text-[11px] h-7 px-2.5 rounded-lg"
                      >
                        <Pause className="w-3 h-3 mr-1" /> Pause
                      </Button>
                    )}
                    {(row.state === 'paused' || row.state === 'not_downloaded') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadSingleSpec(spec)}
                        className="border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/10 text-[11px] h-9 px-3 rounded-lg"
                      >
                        <Play className="w-3 h-3 mr-1" />
                        {row.state === 'paused' ? 'Resume' : 'Download'}
                      </Button>
                    )}
                    {row.state === 'error' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadSingleSpec(spec)}
                        className="border-red-500/50 text-red-200 text-[11px] h-9 px-3 rounded-lg"
                      >
                        <RefreshCw className="w-3 h-3 mr-1" /> Retry
                      </Button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                {(row.state === 'downloading' || row.state === 'paused' || row.downloadedBytes > 0) && (
                  <div className="space-y-1">
                    <div className="w-full h-1.5 bg-[#0A0E14] rounded-full overflow-hidden border border-[#C8CDD3]/15">
                      <div
                        className={cn(
                          'h-full transition-all duration-200',
                          row.state === 'downloaded'
                            ? 'bg-emerald-500'
                            : row.state === 'error'
                              ? 'bg-red-500'
                              : 'bg-cyan-400',
                        )}
                        style={{ width: `${row.state === 'downloaded' ? 100 : pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                      <span>
                        {formatBytesHuman(row.downloadedBytes)} / {formatBytesHuman(row.totalBytes)} ({pct}%)
                      </span>
                      <span className="uppercase">{row.state}</span>
                    </div>
                  </div>
                )}

                {row.error && (
                  <div
                    data-testid={`local-model-error-${spec.id}`}
                    className="text-[11px] text-red-400 font-mono break-all whitespace-pre-wrap"
                  >
                    {row.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
