import { useSyncExternalStore } from 'react';
import { addDebugLog } from './debugLogStore';

export type AppConfirmableToolName =
  | 'make_call'
  | 'send_text'
  | 'email_send'
  | 'email_delete';

export const APP_CONFIRMATION_REQUIRED_TOOLS: readonly AppConfirmableToolName[] = [
  'make_call',
  'send_text',
  'email_send',
  'email_delete',
] as const;

export function requiresAppOwnedConfirmDialog(toolName: string): toolName is AppConfirmableToolName {
  return (APP_CONFIRMATION_REQUIRED_TOOLS as readonly string[]).includes(toolName);
}

export interface ActionConfirmationField {
  label: string;
  value: string;
}

export interface ActionConfirmationRequest {
  id: string;
  toolName: AppConfirmableToolName;
  title: string;
  summary: string;
  fields: ActionConfirmationField[];
  details?: Record<string, string>;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  createdAt: number;
}

export interface ActionConfirmationRequestInput {
  toolName: AppConfirmableToolName;
  title: string;
  summary: string;
  fields?: ActionConfirmationField[];
  details?: Record<string, string>;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
}

export interface ActionConfirmationDecision {
  approved: boolean;
  /**
   * Unforgeable symbol generated exclusively by the app-owned confirmation store
   * when the user approves via the confirm dialog. The LLM can never construct or pass this symbol.
   */
  userApprovalToken?: symbol;
  reason?: string;
}

const validApprovalTokens = new Set<symbol>();

export function isValidUserApprovalToken(token: unknown): token is symbol {
  return typeof token === 'symbol' && validApprovalTokens.has(token);
}

export function consumeUserApprovalToken(token: unknown): boolean {
  if (typeof token === 'symbol' && validApprovalTokens.has(token)) {
    validApprovalTokens.delete(token);
    return true;
  }
  return false;
}

interface PendingConfirmEntry {
  request: ActionConfirmationRequest;
  resolve: (decision: ActionConfirmationDecision) => void;
}

let activeEntry: PendingConfirmEntry | null = null;
const queue: PendingConfirmEntry[] = [];
const listeners = new Set<() => void>();

// Optional test hook for automated Robolectric / node:test suites to simulate user clicking Confirm or Cancel in the app dialog
let testDialogHandler:
  | ((request: ActionConfirmationRequest) => boolean | Promise<boolean>)
  | null = null;
let lastConfirmationRequestForTests: ActionConfirmationRequest | null = null;

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

export function subscribeActionConfirmation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingActionConfirmation(): ActionConfirmationRequest | null {
  return activeEntry ? activeEntry.request : null;
}

export function usePendingActionConfirmation(): ActionConfirmationRequest | null {
  return useSyncExternalStore(
    subscribeActionConfirmation,
    getPendingActionConfirmation,
    getPendingActionConfirmation,
  );
}

function advanceQueue() {
  if (activeEntry || queue.length === 0) {
    notifyListeners();
    return;
  }
  activeEntry = queue.shift() || null;
  notifyListeners();
}

/**
 * Called ONLY by the app-owned confirmation modal UI when the user taps Confirm or Cancel.
 */
export function resolvePendingActionConfirmation(approved: boolean): void {
  if (!activeEntry) return;
  const current = activeEntry;
  activeEntry = null;

  if (approved) {
    const token = Symbol(`user_approved_${current.request.toolName}_${current.request.id}`);
    validApprovalTokens.add(token);
    addDebugLog(
      'ConfirmDialog:Approved',
      `User approved ${current.request.toolName} in app confirm dialog (${current.request.summary})`,
    );
    current.resolve({
      approved: true,
      userApprovalToken: token,
    });
  } else {
    addDebugLog(
      'ConfirmDialog:Cancelled',
      `User cancelled ${current.request.toolName} in app confirm dialog (${current.request.summary})`,
    );
    current.resolve({
      approved: false,
      reason: `User declined "${current.request.title}" in the confirmation dialog.`,
    });
  }

  advanceQueue();
}

/**
 * Requests user confirmation through the app-owned confirmation dialog.
 * The model cannot bypass this by passing confirmed:true in tool arguments.
 */
export async function requestAppUserConfirmation(
  params: ActionConfirmationRequestInput,
): Promise<ActionConfirmationDecision> {
  const normalizedFields: ActionConfirmationField[] =
    params.fields && params.fields.length > 0
      ? params.fields
      : params.details
        ? Object.entries(params.details).map(([label, value]) => ({
            label,
            value: String(value ?? ''),
          }))
        : [];
  const request: ActionConfirmationRequest = {
    ...params,
    fields: normalizedFields,
    id: `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  lastConfirmationRequestForTests = request;

  addDebugLog(
    'ConfirmDialog:Prompt',
    `Prompting user confirmation dialog for ${request.toolName}: ${request.summary}`,
  );

  // If a test handler is installed, invoke it to simulate the user's button press in the app dialog
  if (testDialogHandler) {
    try {
      const approved = await testDialogHandler(request);
      if (approved) {
        const token = Symbol(`user_approved_${request.toolName}_${request.id}`);
        validApprovalTokens.add(token);
        addDebugLog(
          'ConfirmDialog:Approved',
          `[TestDialog] User approved ${request.toolName} (${request.summary})`,
        );
        return {
          approved: true,
          userApprovalToken: token,
        };
      }
      addDebugLog(
        'ConfirmDialog:Cancelled',
        `[TestDialog] User declined ${request.toolName} (${request.summary})`,
      );
      return {
        approved: false,
        reason: `User declined "${request.title}" in the confirmation dialog.`,
      };
    } catch (err: any) {
      return {
        approved: false,
        reason: err?.message || `Confirmation dialog error for "${request.title}".`,
      };
    }
  }

  // If no UI subscriber is mounted (e.g. headless call with no dialog handler), fail closed immediately
  if (listeners.size === 0) {
    addDebugLog(
      'ConfirmDialog:NoUiMounted',
      `Refusing ${request.toolName}: app confirmation dialog is required and no UI dialog listener is active.`,
    );
    return {
      approved: false,
      reason: `Confirmation required in the app dialog: ${request.summary}. The model cannot confirm this action itself.`,
    };
  }

  return new Promise<ActionConfirmationDecision>((resolve) => {
    queue.push({ request, resolve });
    advanceQueue();
  });
}

export function setAppConfirmationDialogHandlerForTests(
  handler: ((request: ActionConfirmationRequest) => boolean | Promise<boolean>) | null,
): void {
  testDialogHandler = handler;
}

export function getLastConfirmationRequestForTests(): ActionConfirmationRequest | null {
  return lastConfirmationRequestForTests;
}
