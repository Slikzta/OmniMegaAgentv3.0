import {
  getVoiceToolsDeclarations,
  executeVoiceToolCall,
  VoiceToolExecutionResult,
} from './voiceTools';
import {
  getDeviceControlToolsDeclarations,
  isDeviceControlToolName,
  executeDeviceControlToolCall,
  DeviceToolExecutionResult,
  sanitizeToolArgsForLog,
} from './deviceControl';
import {
  getEmailToolsDeclarations,
  isEmailToolName,
  executeEmailToolCall,
} from './emailTools';
import { addDebugLog } from './debugLogStore';

export function getAllSierraFunctionDeclarations(): any[] {
  return [
    ...getVoiceToolsDeclarations(),
    ...getDeviceControlToolsDeclarations(),
    ...getEmailToolsDeclarations(),
  ];
}

export const getAllSierraDeclarations = getAllSierraFunctionDeclarations;

export function isSierraToolName(name?: string | null): boolean {
  if (!name) return false;
  if (name === 'change_voice' || name === 'list_voice_options') return true;
  if (isEmailToolName(name)) return true;
  return isDeviceControlToolName(name);
}

export interface UnifiedToolExecutionOutcome {
  ok: boolean;
  status?: string;
  toolName: string;
  success: boolean;
  message: string;
  reason?: string;
  error?: string;
  data?: any;
  requiresLiveReconnect?: boolean;
  appliedVoice?: VoiceToolExecutionResult['applied'];
  responsePayload: Record<string, any>;
  response: Record<string, any>;
}

export async function executeSierraToolCall(
  toolName: string,
  args: Record<string, any> = {},
): Promise<UnifiedToolExecutionOutcome> {
  const safeLogArgs = sanitizeToolArgsForLog(args || {});
  addDebugLog('ToolRouter:Dispatch', `Dispatching tool="${toolName}" args=${JSON.stringify(safeLogArgs)}`);

  try {
    if (toolName === 'change_voice' || toolName === 'list_voice_options') {
      const res: VoiceToolExecutionResult = executeVoiceToolCall(toolName, args);
      const ok = Boolean(res.ok ?? res.success);
      const reason = !ok ? (res.reason || res.error || res.message) : undefined;
      const payload = {
        ok,
        success: res.success,
        message: res.message,
        ...(res.data ? { data: res.data } : {}),
        ...(res.applied ? { applied: res.applied } : {}),
        ...(reason ? { reason } : {}),
        ...(res.error ? { error: res.error } : {}),
        ...(res.errors ? { errors: res.errors } : {}),
        ...(res.closestMatches ? { closestMatches: res.closestMatches } : {}),
        ...(res.availableOptions ? { availableOptions: res.availableOptions } : {}),
      };
      addDebugLog(
        'ToolRouter:Result',
        `Completed tool="${toolName}" ok=${ok} ${reason ? `reason="${reason}"` : `message="${res.message}"`}`
      );
      return {
        ok,
        toolName,
        success: res.success,
        message: res.message,
        reason,
        error: res.error,
        data: res.data,
        requiresLiveReconnect: Boolean(res.requiresLiveReconnect),
        appliedVoice: res.applied,
        responsePayload: payload,
        response: payload,
      };
    }

    if (isEmailToolName(toolName)) {
      const res = await executeEmailToolCall(toolName, args);
      const ok = Boolean(res.ok);
      const reason = !ok ? (res.reason || res.error || `Email tool ${toolName} failed.`) : undefined;
      const msg = ok
        ? `Executed ${toolName} on ${res.provider || 'email'} (${res.account || 'connected account'}).`
        : reason || `Email tool ${toolName} failed.`;
      const payload = {
        ...res,
        ok,
        success: ok,
        summaryMessage: msg,
        ...(res.message === undefined ? { message: msg } : {}),
        ...(reason ? { reason, error: reason } : {}),
      };
      addDebugLog(
        'ToolRouter:Result',
        `Completed tool="${toolName}" ok=${ok} status="${res.status || ''}" ${reason ? `reason="${reason}"` : ''}`,
      );
      return {
        ok,
        status: res.status,
        toolName,
        success: ok,
        message: msg,
        reason,
        error: reason,
        data: res,
        responsePayload: payload,
        response: payload,
      };
    }

    if (isDeviceControlToolName(toolName)) {
      const res: DeviceToolExecutionResult = await executeDeviceControlToolCall(toolName, args);
      const ok = Boolean(res.ok ?? res.success);
      const reason = !ok ? (res.reason || res.error || res.message) : undefined;
      const payload = {
        ...(res.data || {}),
        ok,
        success: res.success,
        ...(res.status ? { status: res.status } : {}),
        message: res.message,
        ...(res.requiresConfirmation
          ? { requiresConfirmation: true, confirmationPrompt: res.confirmationPrompt }
          : {}),
        ...(res.capabilityDisabled ? { capabilityDisabled: true } : {}),
        ...(res.permissionDenied ? { permissionDenied: true } : {}),
        ...(res.data ? { data: res.data } : {}),
        ...(reason ? { reason } : {}),
        ...(res.error ? { error: res.error } : {}),
      };
      addDebugLog(
        'ToolRouter:Result',
        `Completed tool="${toolName}" ok=${ok} ${reason ? `reason="${reason}"` : `message="${res.message}"`}`
      );
      return {
        ok,
        status: res.status,
        toolName,
        success: res.success,
        message: res.message,
        reason,
        error: res.error,
        data: res.data,
        responsePayload: payload,
        response: payload,
      };
    }

    const unknownMsg = `Unknown tool "${toolName}". This capability is not in Sierra's supported tool list.`;
    addDebugLog('ToolRouter:Error', unknownMsg);
    const errPayload = {
      ok: false,
      success: false,
      reason: unknownMsg,
      error: unknownMsg,
      message: unknownMsg,
    };
    return {
      ok: false,
      toolName,
      success: false,
      message: unknownMsg,
      reason: unknownMsg,
      error: unknownMsg,
      responsePayload: errPayload,
      response: errPayload,
    };
  } catch (err: any) {
    const reason = err?.message || String(err) || `Unexpected failure in tool "${toolName}"`;
    addDebugLog('ToolRouter:Exception', `Tool "${toolName}" threw exception: ${reason}`);
    const errPayload = {
      ok: false,
      success: false,
      reason,
      error: reason,
      message: reason,
    };
    return {
      ok: false,
      toolName,
      success: false,
      message: reason,
      reason,
      error: reason,
      responsePayload: errPayload,
      response: errPayload,
    };
  }
}
