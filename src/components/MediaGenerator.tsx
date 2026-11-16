import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { MODELS, ASPECT_RATIOS, IMAGE_SIZES, VIDEO_RESOLUTIONS, VIDEO_MODELS, VIDEO_FPS } from '../lib/gemini';
import { generateMediaImage, generateMediaVideo } from '../lib/providers';
import { Card, CardContent, CardHeader } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Loader2, Download, Sparkles, Wand2, Film, Image as ImageIcon, Camera, Palette } from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { useActiveIdentityAccent } from '../lib/themeStore';
import { triggerHaptic } from '../lib/haptics';

const STYLE_PERSONAS = [
  { id: 'none', name: 'Raw Prompt', icon: Wand2, suffix: '' },
  {
    id: 'photorealistic',
    name: 'Photorealistic',
    icon: Camera,
    suffix: ', hyperrealistic, 8k resolution, cinematic lighting, highly detailed, professional photography, masterpiece, sharp focus, realistic textures',
  },
  {
    id: 'artistic',
    name: 'Artistic',
    icon: Palette,
    suffix: ', digital art, vibrant colors, stylized, creative composition, trending on artstation, sharp details',
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    icon: Film,
    suffix: ', cinematic shot, movie still, dramatic lighting, anamorphic lens, high contrast, atmospheric',
  },
];

interface MediaGeneratorProps {
  initialMode?: 'image' | 'video';
}

export default function MediaGenerator({ initialMode = 'image' }: MediaGeneratorProps) {
  const { accentHex, accentRgb } = useActiveIdentityAccent();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [type, setType] = useState<'image' | 'video'>(initialMode);

  useEffect(() => {
    setType(initialMode);
  }, [initialMode]);

  // Settings
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [imageSize, setImageSize] = useState<string>('1K');
  const [personGeneration, setPersonGeneration] = useState<string>('ALLOW_ADULT');
  const [resolution, setResolution] = useState<string>('1080p');
  const [fps, setFps] = useState<number>(30);
  const [videoModel, setVideoModel] = useState<string>(MODELS.VIDEO_PRO);
  const [selectedStyleId, setSelectedStyleId] = useState<string>('none');

  const generateImage = async () => {
    if (!prompt.trim() || isGenerating) return;
    triggerHaptic('light');
    setIsGenerating(true);
    setResultUrl(null);

    try {
      const style = STYLE_PERSONAS.find((s) => s.id === selectedStyleId);
      const finalPrompt = prompt + (style?.suffix || '');

      const imageUrl = await generateMediaImage({
        prompt: finalPrompt,
        aspectRatio,
        imageSize,
        personGeneration,
        model: MODELS.IMAGE_PRO,
      });

      setResultUrl(imageUrl);
      toast.success('Image generated successfully!');
    } catch (error: any) {
      console.error('Image generation error:', error);
      toast.error(error.message || 'Failed to generate image.');
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  const generateVideo = async () => {
    if (!prompt.trim() || isGenerating) return;
    triggerHaptic('light');

    setIsGenerating(true);
    setProgress(20);
    setStatusMessage('Synthesizing video on server (this may take up to 60-90 seconds)...');
    setResultUrl(null);

    try {
      const style = STYLE_PERSONAS.find((s) => s.id === selectedStyleId);
      const finalPrompt = prompt + (style?.suffix || '');

      const finalResolution = videoModel === MODELS.VIDEO && resolution === '4k' ? '1080p' : resolution;
      if (videoModel === MODELS.VIDEO && resolution === '4k') {
        toast.info('Veo Fast supports up to 1080p. Adjusting resolution...');
      }

      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev === null) return 20;
          if (prev < 90) return prev + 10;
          return prev;
        });
      }, 8000);

      const videoUrl = await generateMediaVideo({
        prompt: finalPrompt,
        aspectRatio,
        resolution: finalResolution,
        fps,
        model: videoModel,
      });

      clearInterval(progressInterval);
      setProgress(100);
      setResultUrl(videoUrl);
      toast.success('Video generated successfully!');
    } catch (error: any) {
      console.error('Video generation error:', error);
      toast.error(error.message || 'Failed to generate video.');
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  return (
    <div
      data-testid="create-view"
      className="flex-1 min-h-0 overflow-y-auto bg-[#0A0E14] p-4 sm:p-6 relative"
    >
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: `radial-gradient(circle at 80% 10%, rgba(${accentRgb}, 0.08) 0%, transparent 45%)`,
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto space-y-6 pb-8">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="sci-heading text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Create Studio
            </h1>
            <p className="text-xs sm:text-sm text-[#C8CDD3]/75">
              Unified image &amp; video generation powered by Pro Image &amp; Veo 3.1.
            </p>
          </div>

          {/* Segmented Toggle between Image and Video */}
          <div
            role="tablist"
            aria-label="Creation Mode"
            data-testid="create-mode-segmented-control"
            className="sci-card p-1.5 rounded-2xl grid grid-cols-2 gap-1.5 w-full sm:w-64 shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={type === 'image'}
              data-testid="create-mode-image-btn"
              onClick={() => {
                triggerHaptic('light');
                setType('image');
                setResultUrl(null);
              }}
              className={cn(
                'min-h-[48px] rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer touch-manipulation',
                type === 'image' ? 'text-[#071018]' : 'text-[#C8CDD3] hover:text-white'
              )}
              style={
                type === 'image'
                  ? {
                      backgroundColor: accentHex,
                      boxShadow: `0 0 18px rgba(${accentRgb}, 0.4)`,
                    }
                  : undefined
              }
            >
              <ImageIcon className="w-4 h-4" />
              <span>Image</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={type === 'video'}
              data-testid="create-mode-video-btn"
              onClick={() => {
                triggerHaptic('light');
                setType('video');
                setResultUrl(null);
              }}
              className={cn(
                'min-h-[48px] rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer touch-manipulation',
                type === 'video' ? 'text-[#071018]' : 'text-[#C8CDD3] hover:text-white'
              )}
              style={
                type === 'video'
                  ? {
                      backgroundColor: accentHex,
                      boxShadow: `0 0 18px rgba(${accentRgb}, 0.4)`,
                    }
                  : undefined
              }
            >
              <Film className="w-4 h-4" />
              <span>Video</span>
            </button>
          </div>
        </header>

        <Card className="sci-card rounded-2xl overflow-hidden border-[#C8CDD3]/15">
          <CardHeader className="border-b border-[#C8CDD3]/10 bg-[#0D131C]/80 py-4 px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {type === 'image' ? (
                  <ImageIcon className="w-4 h-4" style={{ color: accentHex }} />
                ) : (
                  <Film className="w-4 h-4" style={{ color: accentHex }} />
                )}
                <span className="sci-heading text-sm font-bold text-white uppercase tracking-wider">
                  {type === 'image' ? 'Neural Image Synthesis' : 'Temporal Video Synthesis'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color: accentHex }}>
                <Sparkles className="w-3.5 h-3.5" />
                <span>{type === 'image' ? 'Pro Image' : 'Veo 3.1'}</span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 sm:p-6 space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#C8CDD3]/80 uppercase tracking-widest block">
                  Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    type === 'image'
                      ? 'A futuristic neon city in the style of cyberpunk...'
                      : 'A cinematic drone shot of a misty mountain range at sunrise...'
                  }
                  className="w-full bg-[#0A0E14] border border-[#C8CDD3]/20 text-white rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/50 transition-all min-h-[120px] resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#C8CDD3]/75 uppercase tracking-widest block">
                    Aspect Ratio
                  </label>
                  <Select value={aspectRatio} onValueChange={setAspectRatio}>
                    <SelectTrigger className="min-h-[48px] bg-[#0A0E14] border-[#C8CDD3]/20 text-white rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#101620] border-[#C8CDD3]/20 text-white">
                      {ASPECT_RATIOS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#C8CDD3]/75 uppercase tracking-widest block">
                    Style Persona
                  </label>
                  <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                    <SelectTrigger className="min-h-[48px] bg-[#0A0E14] border-[#C8CDD3]/20 text-white rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#101620] border-[#C8CDD3]/20 text-white">
                      {STYLE_PERSONAS.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <div className="flex items-center gap-2">
                            <s.icon className="w-3.5 h-3.5" />
                            <span>{s.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {type === 'image' ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[#C8CDD3]/75 uppercase tracking-widest block">
                        Quality
                      </label>
                      <Select value={imageSize} onValueChange={setImageSize}>
                        <SelectTrigger className="min-h-[48px] bg-[#0A0E14] border-[#C8CDD3]/20 text-white rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#101620] border-[#C8CDD3]/20 text-white">
                          {IMAGE_SIZES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[#C8CDD3]/75 uppercase tracking-widest block">
                        People
                      </label>
                      <Select value={personGeneration} onValueChange={setPersonGeneration}>
                        <SelectTrigger className="min-h-[48px] bg-[#0A0E14] border-[#C8CDD3]/20 text-white rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#101620] border-[#C8CDD3]/20 text-white">
                          <SelectItem value="ALLOW_ADULT">Allow Adults</SelectItem>
                          <SelectItem value="DONT_ALLOW">Don't Allow</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="hidden lg:block" />
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[#C8CDD3]/75 uppercase tracking-widest block">
                        Model
                      </label>
                      <Select value={videoModel} onValueChange={setVideoModel}>
                        <SelectTrigger className="min-h-[48px] bg-[#0A0E14] border-[#C8CDD3]/20 text-white rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#101620] border-[#C8CDD3]/20 text-white">
                          {VIDEO_MODELS.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[#C8CDD3]/75 uppercase tracking-widest block">
                        Resolution
                      </label>
                      <Select value={resolution} onValueChange={setResolution}>
                        <SelectTrigger className="min-h-[48px] bg-[#0A0E14] border-[#C8CDD3]/20 text-white rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#101620] border-[#C8CDD3]/20 text-white">
                          {VIDEO_RESOLUTIONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[#C8CDD3]/75 uppercase tracking-widest block">
                        FPS
                      </label>
                      <Select value={fps.toString()} onValueChange={(v) => setFps(parseInt(v, 10))}>
                        <SelectTrigger className="min-h-[48px] bg-[#0A0E14] border-[#C8CDD3]/20 text-white rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#101620] border-[#C8CDD3]/20 text-white">
                          {VIDEO_FPS.map((f) => (
                            <SelectItem key={f} value={f.toString()}>
                              {f} FPS
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <div className="flex items-end">
                  <Button
                    onClick={type === 'image' ? generateImage : generateVideo}
                    disabled={!prompt.trim() || isGenerating}
                    className="w-full min-h-[48px] rounded-xl gap-2 font-bold text-[#071018] transition-all active:scale-95 cursor-pointer"
                    style={{
                      backgroundColor: accentHex,
                      boxShadow: `0 0 22px rgba(${accentRgb}, 0.35)`,
                    }}
                  >
                    {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {isGenerating ? 'Synthesizing...' : 'Generate'}
                  </Button>
                </div>
              </div>
            </div>

            {isGenerating && type === 'video' && progress !== null && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between text-[10px] font-bold text-[#C8CDD3]/70 uppercase tracking-widest">
                  <span>{statusMessage || 'Synthesizing Video Frames'}</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full bg-[#0A0E14] rounded-full overflow-hidden border border-[#C8CDD3]/15">
                  <div
                    className="h-full transition-all duration-1000 ease-out"
                    style={{
                      width: `${progress}%`,
                      backgroundColor: accentHex,
                      boxShadow: `0 0 12px rgba(${accentRgb}, 0.65)`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-[#C8CDD3]/60 italic">
                  Veo 3.1 is processing your cinematic request. This typically takes 1-2 minutes.
                </p>
              </div>
            )}

            {resultUrl && (
              <div className="mt-6 space-y-4 animate-in fade-in zoom-in duration-500">
                <div className="relative group rounded-2xl overflow-hidden border border-[#C8CDD3]/20 shadow-2xl bg-black">
                  {type === 'image' ? (
                    <img src={resultUrl} alt="Generated" className="w-full h-auto" />
                  ) : (
                    <video src={resultUrl} controls className="w-full h-auto" />
                  )}
                  <div className="p-3 bg-[#0D131C]/90 border-t border-[#C8CDD3]/15 flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-[48px] px-4 gap-2 bg-[#151E2B] hover:bg-[#1C2738] text-white border border-[#C8CDD3]/25"
                      onClick={() => window.open(resultUrl, '_blank')}
                    >
                      <Download className="w-4 h-4" /> Download
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
