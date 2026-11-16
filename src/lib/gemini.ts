import { GoogleGenAI, Modality, Type } from "@google/genai";
import {
  ThinkingLevel,
  isGeminiLiveExtendedThinkingModel,
  validateThinkingLevel,
  getStoredGeminiThinkingLevel,
} from './persona';
import {
  TEXT_MODELS,
  LIVE_MODELS,
  DEFAULT_TEXT_MODEL,
  DEFAULT_LIVE_MODEL,
  isLiveModelId,
  logQuotaOrRateLimitError,
  doesModelSupportFunctionCalling,
  recordModelFunctionCallingSupportFromApi,
  inspectApiErrorForToolSupport,
} from '../config/models';
import {
  getAllSierraFunctionDeclarations,
  executeSierraToolCall,
} from './toolRouter';
import { addDebugLog } from './debugLogStore';
import {
  DEFAULT_LIVE_GEMINI_WS_URL,
  getProviderApiKey,
  getProviderWsEndpoint,
} from './settingsStore';

export { isGeminiLiveExtendedThinkingModel };

export const getGeminiApiKey = (): string => {
  return getProviderApiKey('gemini');
};

export const getGeminiAI = () => {
  const key = getGeminiApiKey();
  if (!key) throw new Error("GEMINI_API_KEY is missing");
  return new GoogleGenAI({ apiKey: key });
};

export const MODELS = {
  CHAT_PRO: 'gemini-3.1-pro-preview',
  CHAT_FLASH: 'gemini-3-flash-preview',
  CHAT_LITE: DEFAULT_TEXT_MODEL,
  IMAGE_FLASH: 'gemini-3.1-flash-image-preview',
  IMAGE_PRO: 'gemini-3-pro-image-preview',
  VIDEO: 'veo-3.1-lite-generate-preview',
  VIDEO_PRO: 'veo-3.1-generate-preview',
  LIVE: DEFAULT_LIVE_MODEL,
  LIVE_EXTENDED_THINKING: 'gemini-3.8-live-extended-thinking',
  LIVE_FLASH: 'gemini-3.1-flash-live-preview',
};

export const LIVE_VOICE_MODELS = LIVE_MODELS.map((m) => ({
  id: m.id,
  name: m.label,
  label: m.label,
  badge: m.badge,
}));

export const DEFAULT_LIVE_WEBSOCKET_URL = DEFAULT_LIVE_GEMINI_WS_URL;

export function isGeminiLiveModel(model?: string): boolean {
  return isLiveModelId(model);
}

export async function testGeminiLiveWebSocket(params: {
  apiKey: string;
  model: string;
  thinkingLevel?: ThinkingLevel | string | null;
  liveWsUrl?: string;
  timeoutMs?: number;
}): Promise<{ success: boolean; latencyMs: number; message?: string; error?: string }> {
  const startTime = Date.now();
  const timeoutMs = params.timeoutMs ?? 10000;
  const rawModel = (params.model ?? '').trim();
  if (!rawModel) {
    return {
      success: false,
      latencyMs: 0,
      error: 'Live model identifier must be specified before connecting.',
    };
  }
  const targetModel = rawModel;
  const formattedModel = targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`;
  const isExtendedThinking = isGeminiLiveExtendedThinkingModel(formattedModel);

  let validatedThinkingLevel: ThinkingLevel | undefined = undefined;
  if (isExtendedThinking) {
    const rawLevel =
      'thinkingLevel' in params
        ? params.thinkingLevel
        : getStoredGeminiThinkingLevel();
    try {
      validatedThinkingLevel = validateThinkingLevel(rawLevel);
    } catch (err: any) {
      return {
        success: false,
        latencyMs: 0,
        error: err?.message || 'Code 007: The thinking level must be specified for this model.',
      };
    }
  }

  const baseEndpoint = (params.liveWsUrl && params.liveWsUrl.trim())
    ? params.liveWsUrl.trim()
    : getProviderWsEndpoint('gemini');

  addDebugLog('GeminiLive:Connect', `Connecting WebSocket endpoint: ${baseEndpoint.split('?')[0]}`);

  let wsUrl = baseEndpoint;
  if (!wsUrl.includes('key=')) {
    const separator = wsUrl.includes('?') ? '&' : '?';
    wsUrl = `${wsUrl}${separator}key=${encodeURIComponent(params.apiKey)}`;
  }

  return new Promise((resolve) => {
    let settled = false;
    let ws: any = null;

    const cleanup = () => {
      clearTimeout(timer);
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          if (ws.readyState === (ws.OPEN || 1) || ws.readyState === (ws.CONNECTING || 0)) {
            ws.close();
          }
        } catch (_) {}
      }
    };

    const finish = (result: { success: boolean; latencyMs: number; message?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        success: false,
        latencyMs: Date.now() - startTime,
        error: `WebSocket connection timed out after ${timeoutMs}ms while connecting to live endpoint.`,
      });
    }, timeoutMs);

    try {
      const WebSocketClass = typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
      if (!WebSocketClass) {
        finish({
          success: false,
          latencyMs: Date.now() - startTime,
          error: 'WebSocket API is not supported in this runtime environment.',
        });
        return;
      }

      ws = new WebSocketClass(wsUrl);

      ws.onopen = () => {
        const generationConfig: {
          responseModalities: string[];
          thinkingConfig?: {
            thinkingLevel: ThinkingLevel;
          };
        } = {
          responseModalities: ["AUDIO"],
          ...(isExtendedThinking && validatedThinkingLevel
            ? {
                thinkingConfig: {
                  thinkingLevel: validatedThinkingLevel,
                },
              }
            : {}),
        };

        const setupMessage = {
          setup: {
            model: formattedModel,
            generationConfig,
            outputAudioTranscription: {},
          },
        };
        try {
          ws.send(JSON.stringify(setupMessage));
        } catch (sendErr: any) {
          finish({
            success: false,
            latencyMs: Date.now() - startTime,
            error: `Failed to send setup message over WebSocket: ${sendErr?.message || sendErr}`,
          });
        }
      };

      ws.onmessage = async (event: any) => {
        const latencyMs = Date.now() - startTime;
        let dataStr = '';
        try {
          if (typeof event.data === 'string') {
            dataStr = event.data;
          } else if (event.data instanceof Blob) {
            dataStr = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            dataStr = new TextDecoder().decode(event.data);
          } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(event.data)) {
            dataStr = event.data.toString('utf-8');
          } else if (event.data && typeof event.data.toString === 'function') {
            dataStr = event.data.toString();
          }

          const parsed = JSON.parse(dataStr);
          if (!parsed || typeof parsed !== 'object') {
            finish({
              success: false,
              latencyMs,
              error: 'Received invalid server response payload from Gemini Live WebSocket.',
            });
            return;
          }

          if (parsed.error) {
            const errMsg = parsed.error.message || JSON.stringify(parsed.error);
            finish({
              success: false,
              latencyMs,
              error: `Gemini Live error: ${errMsg}`,
            });
            return;
          }

          if (parsed.setupComplete !== undefined || parsed.serverContent !== undefined || parsed.toolCall !== undefined) {
            finish({
              success: true,
              latencyMs,
              message: `Successfully connected to Gemini Live (${targetModel}) via WebSocket (setup acknowledged in ${latencyMs}ms).`,
            });
            return;
          }

          finish({
            success: false,
            latencyMs,
            error: `Unrecognized Gemini Live handshake response (missing setupComplete): ${dataStr.slice(0, 160)}`,
          });
        } catch (parseErr: any) {
          finish({
            success: false,
            latencyMs,
            error: `Invalid JSON response from Gemini Live WebSocket: ${parseErr?.message || String(parseErr)}`,
          });
        }
      };

      ws.onerror = (err: any) => {
        const latencyMs = Date.now() - startTime;
        const msg = err?.message || (err?.error ? String(err.error) : 'WebSocket network error');
        finish({
          success: false,
          latencyMs,
          error: `WebSocket error connecting to ${baseEndpoint}: ${msg}`,
        });
      };

      ws.onclose = (event: any) => {
        const latencyMs = Date.now() - startTime;
        if (!settled) {
          const reason = event?.reason ? ` Reason: ${event.reason}` : '';
          const code = event?.code !== undefined ? ` (code ${event.code})` : '';
          finish({
            success: false,
            latencyMs,
            error: `WebSocket closed before setup completed${code}.${reason}`,
          });
        }
      };
    } catch (initErr: any) {
      finish({
        success: false,
        latencyMs: Date.now() - startTime,
        error: `Could not initiate WebSocket connection: ${initErr?.message || initErr}`,
      });
    }
  });
}

export async function streamGeminiLiveWebSocket(params: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  systemInstruction?: string;
  liveWsUrl?: string;
  thinkingLevel?: string | null;
  callbacks: {
    onChunk: (text: string) => void;
    onAudio?: (base64Audio: string) => void;
    onInterrupted?: () => void;
    onMetadata?: (meta: any) => void;
    onDone: () => void;
    onError: (err: Error) => void;
  };
}): Promise<() => void> {
  const rawModel = (params.model ?? '').trim();
  if (!rawModel) {
    params.callbacks.onError(new Error('Live model identifier must be specified before connecting.'));
    return () => {};
  }
  const targetModel = rawModel;
  const formattedModel = targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`;
  const isExtendedThinking = isGeminiLiveExtendedThinkingModel(formattedModel);

  let validatedThinkingLevel: ThinkingLevel | undefined = undefined;
  if (isExtendedThinking) {
    const rawLevel =
      'thinkingLevel' in params
        ? params.thinkingLevel
        : getStoredGeminiThinkingLevel();
    try {
      validatedThinkingLevel = validateThinkingLevel(rawLevel);
    } catch (err: any) {
      params.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      return () => {};
    }
  }

  const baseEndpoint = (params.liveWsUrl && params.liveWsUrl.trim())
    ? params.liveWsUrl.trim()
    : DEFAULT_LIVE_WEBSOCKET_URL;

  let wsUrl = baseEndpoint;
  if (!wsUrl.includes('key=')) {
    const separator = wsUrl.includes('?') ? '&' : '?';
    wsUrl = `${wsUrl}${separator}key=${encodeURIComponent(params.apiKey)}`;
  }

  const WebSocketClass = typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
  if (!WebSocketClass) {
    params.callbacks.onError(new Error('WebSocket API is not supported in this runtime environment.'));
    return () => {};
  }

  let ws: any = null;
  let isDone = false;
  let setupCompleteReceived = false;
  let receivedAnyText = false;

  const closeWs = () => {
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === (ws.OPEN || 1) || ws.readyState === (ws.CONNECTING || 0)) {
          ws.close();
        }
      } catch (_) {}
    }
  };

  try {
    ws = new WebSocketClass(wsUrl);

    const modelSupportsTools = doesModelSupportFunctionCalling(formattedModel);

    ws.onopen = () => {
      const generationConfig: Record<string, any> = {
        responseModalities: ["AUDIO"],
        ...(isExtendedThinking && validatedThinkingLevel
          ? {
              thinkingConfig: {
                thinkingLevel: validatedThinkingLevel,
              },
            }
          : {}),
      };
      const setupMessage: any = {
        setup: {
          model: formattedModel,
          generationConfig,
          outputAudioTranscription: {},
          ...(modelSupportsTools
            ? {
                tools: [
                  {
                    functionDeclarations: getAllSierraFunctionDeclarations(),
                  },
                ],
              }
            : {}),
        },
      };
      if (params.systemInstruction) {
        setupMessage.setup.systemInstruction = {
          parts: [{ text: params.systemInstruction }],
        };
      }
      try {
        ws.send(JSON.stringify(setupMessage));
      } catch (sendErr: any) {
        if (!isDone) {
          isDone = true;
          params.callbacks.onError(new Error(`Failed to send setup message: ${sendErr?.message || sendErr}`));
          closeWs();
        }
      }
    };

    const handledFunctionCallKeys = new Set<string>();
    let receivedOutputTranscription = false;

    const handleLiveFunctionCalls = async (functionCalls: any[]) => {
      if (!Array.isArray(functionCalls) || functionCalls.length === 0) return;
      const functionResponses: any[] = [];
      for (const call of functionCalls) {
        const fnName = call?.name || '';
        if (!fnName) continue;
        const fnId = call?.id;
        const fnArgs = (call?.args && typeof call.args === 'object' ? call.args : {}) as Record<string, any>;
        const dedupeKey = fnId ? `id:${String(fnId)}` : `sig:${fnName}:${JSON.stringify(fnArgs)}`;
        if (handledFunctionCallKeys.has(dedupeKey)) {
          continue;
        }
        handledFunctionCallKeys.add(dedupeKey);
        const outcome = await executeSierraToolCall(fnName, fnArgs);
        functionResponses.push({
          ...(fnId ? { id: fnId } : {}),
          name: fnName,
          response: outcome.responsePayload,
        });
      }
      if (ws && ws.readyState === (ws.OPEN || 1) && functionResponses.length > 0) {
        ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
      }
    };

    ws.onmessage = async (event: any) => {
      let dataStr = '';
      try {
        if (typeof event.data === 'string') {
          dataStr = event.data;
        } else if (event.data instanceof Blob) {
          dataStr = await event.data.text();
        } else if (event.data instanceof ArrayBuffer) {
          dataStr = new TextDecoder().decode(event.data);
        } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(event.data)) {
          dataStr = event.data.toString('utf-8');
        } else if (event.data && typeof event.data.toString === 'function') {
          dataStr = event.data.toString();
        }

        const parsed = JSON.parse(dataStr);

        if (parsed.error) {
          const errMsg = parsed.error.message || JSON.stringify(parsed.error);
          inspectApiErrorForToolSupport(formattedModel, errMsg);
          if (!isDone) {
            isDone = true;
            params.callbacks.onError(new Error(`Gemini Live WebSocket error: ${errMsg}`));
            closeWs();
          }
          return;
        }

        if (parsed.setupComplete !== undefined) {
          setupCompleteReceived = true;
          if (modelSupportsTools) {
            recordModelFunctionCallingSupportFromApi(formattedModel, true, 'bidi.setup');
          }
          const turns = params.messages.map((m) => ({
            role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
            parts: [{ text: m.content || '' }],
          }));
          const clientContentMessage = {
            clientContent: {
              turns: turns.length > 0 ? turns : [{ role: 'user', parts: [{ text: 'Hello' }] }],
              turnComplete: true,
            },
          };
          ws.send(JSON.stringify(clientContentMessage));
          return;
        }

        // Top-level toolCall (regular Live & Extended Thinking)
        if (parsed.toolCall && Array.isArray(parsed.toolCall.functionCalls)) {
          await handleLiveFunctionCalls(parsed.toolCall.functionCalls);
          return;
        }

        if (parsed.serverContent) {
          if (parsed.serverContent.interrupted && params.callbacks.onInterrupted) {
            params.callbacks.onInterrupted();
          }

          if (parsed.serverContent.outputTranscription?.text) {
            receivedAnyText = true;
            receivedOutputTranscription = true;
            params.callbacks.onChunk(parsed.serverContent.outputTranscription.text);
          }

          const parts = parsed.serverContent.modelTurn?.parts;
          if (Array.isArray(parts)) {
            const inlineFunctionCalls: any[] = [];
            for (const part of parts) {
              if (part?.functionCall) {
                inlineFunctionCalls.push(part.functionCall);
                continue;
              }
              if (part?.thought === true) {
                continue;
              }
              if (part?.text && !receivedOutputTranscription) {
                receivedAnyText = true;
                params.callbacks.onChunk(part.text);
              }
              if (part?.inlineData?.data && params.callbacks.onAudio) {
                params.callbacks.onAudio(part.inlineData.data);
              }
            }
            if (inlineFunctionCalls.length > 0) {
              await handleLiveFunctionCalls(inlineFunctionCalls);
              return;
            }
          }

          if (parsed.serverContent.turnComplete) {
            if (!isDone) {
              isDone = true;
              params.callbacks.onDone();
              closeWs();
            }
            return;
          }
        }
      } catch (parseErr: any) {
        console.warn("[GeminiLiveWS] Message parse exception:", parseErr);
      }
    };

    ws.onerror = (err: any) => {
      if (!isDone) {
        isDone = true;
        const msg = err?.message || 'WebSocket connection error';
        params.callbacks.onError(new Error(`Gemini Live WebSocket error: ${msg}`));
        closeWs();
      }
    };

    ws.onclose = (event: any) => {
      console.warn(`[streamGeminiLiveWebSocket] Closed (code ${event.code}: ${event.reason || 'connection closed'})`);
      if (!isDone) {
        isDone = true;
        if (!setupCompleteReceived) {
          let errorMsg = `Gemini Live WebSocket closed before setupComplete (code ${event.code}: ${event.reason || 'connection closed'}).`;
          if (event.code === 1007) {
            errorMsg = `Gemini Live rejected configuration (code 1007: ${event.reason || 'invalid setup payload'}).`;
          }
          params.callbacks.onError(new Error(errorMsg));
        } else if (receivedAnyText) {
          params.callbacks.onDone();
        } else if (event.code !== 1000) {
          let errorMsg = `Gemini Live WebSocket closed (code ${event.code}: ${event.reason || 'connection closed'}).`;
          if (event.code === 1007) {
            errorMsg = `Gemini Live rejected configuration (code 1007: ${event.reason || 'unsupported modality'}). Live models require AUDIO response modalities.`;
          }
          params.callbacks.onError(new Error(errorMsg));
        } else {
          params.callbacks.onDone();
        }
      }
    };
  } catch (initErr: any) {
    if (!isDone) {
      isDone = true;
      params.callbacks.onError(initErr instanceof Error ? initErr : new Error(String(initErr)));
    }
  }

  return () => {
    isDone = true;
    closeWs();
  };
}


export const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "1:4", "1:8", "4:1", "8:1"] as const;
export const IMAGE_SIZES = ["512px", "1K", "2K", "4K"] as const;
export const VIDEO_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
export const VIDEO_FPS = [24, 30, 60] as const;
export const VIDEO_MODELS = [
  { id: MODELS.VIDEO, name: "Veo Fast (Preview)" },
  { id: MODELS.VIDEO_PRO, name: "Veo Pro (Preview)" },
] as const;

export { 
  SIERRA_SAFETY_SETTINGS, 
  SIERRA_CORE_PERSONA, 
  SIERRA_PERSONAS,
  CONTENT_MODES,
  buildSierraSystemInstruction,
} from './persona';
export type { ContentMode, ContentModeConfig } from './persona';

export const CHAT_MODELS = TEXT_MODELS.map((m) => ({
  id: m.id,
  name: m.label,
  label: m.label,
  badge: m.badge || 'Gemini',
}));
