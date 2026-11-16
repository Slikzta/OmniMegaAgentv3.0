import { Type, FunctionDeclaration } from '@google/genai';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  requestAppUserConfirmation,
  consumeUserApprovalToken,
} from './actionConfirmationStore';

export type EmailProviderType = 'gmail' | 'outlook' | 'yahoo';

export type EmailActionName =
  | 'email_list'
  | 'email_search'
  | 'email_read'
  | 'email_draft'
  | 'email_send'
  | 'email_delete';

export const EMAIL_TOOL_NAMES: readonly EmailActionName[] = [
  'email_list',
  'email_search',
  'email_read',
  'email_draft',
  'email_send',
  'email_delete',
] as const;

/**
 * Non-secret metadata for a connected email account.
 * OAuth access/refresh tokens and Yahoo app passwords are NEVER stored in this object
 * or in localStorage; they live exclusively in Android Keystore-backed encrypted storage.
 */
export interface EmailAccountMetadata {
  id: string;
  provider: EmailProviderType;
  email: string;
  displayName: string;
  oauthClientId?: string;
  redirectUri?: string;
  connectedAt: number;
  enabled: boolean;
}

/**
 * Secret credentials passed ONLY directly to the Android Keystore plugin (`SierraEmail`).
 * Never persisted in localStorage, never logged.
 */
export interface EmailAccountSecretInput {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  appPassword?: string;
  clientId?: string;
}

export interface SierraEmailNativePlugin {
  saveAccountCredentials(options: {
    accountId: string;
    provider: EmailProviderType;
    email: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    appPassword?: string;
    clientId?: string;
  }): Promise<{ ok: boolean; status: string; accountId: string; keystoreBacked: boolean }>;

  removeAccountCredentials(options: {
    accountId: string;
  }): Promise<{ ok: boolean; status: string; accountId: string }>;

  hasAccountCredentials(options: {
    accountId: string;
  }): Promise<{ ok: boolean; hasCredentials: boolean; provider?: string; email?: string; keystoreBacked?: boolean }>;

  exchangeOAuthCode(options: {
    accountId: string;
    provider: 'gmail' | 'outlook';
    email?: string;
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<{ ok: boolean; status?: string; reason?: string; accountId?: string; email?: string; keystoreBacked?: boolean }>;

  startOAuthSignIn?(options: {
    provider: 'gmail' | 'outlook';
    clientId: string;
    redirectUri?: string;
    emailHint?: string;
    displayName?: string;
    scopes?: string[];
  }): Promise<{
    ok: boolean;
    status?: string;
    reason?: string;
    authUrl?: string;
    redirectUri?: string;
    accountId?: string;
    email?: string;
  }>;

  addListener?(
    eventName: 'oauthSignInComplete',
    listenerFunc: (event: {
      ok: boolean;
      provider: EmailProviderType;
      accountId?: string;
      email?: string;
      displayName?: string;
      clientId?: string;
      redirectUri?: string;
      storedInKeystore?: boolean;
      reason?: string;
    }) => void
  ): Promise<{ remove: () => Promise<void> }>;

  executeEmailAction(options: {
    accountId: string;
    action: 'list' | 'search' | 'read' | 'draft' | 'send' | 'delete';
    maxResults?: number;
    query?: string;
    messageId?: string;
    to?: string;
    cc?: string;
    subject?: string;
    body?: string;
    permanent?: boolean;
  }): Promise<{
    ok: boolean;
    status: string;
    reason?: string;
    provider?: EmailProviderType;
    account?: string;
    action?: string;
    count?: number;
    messages?: Array<{
      id: string;
      threadId?: string;
      subject: string;
      from: string;
      to?: string;
      date: string;
      snippet: string;
    }>;
    message?: {
      id: string;
      threadId?: string;
      subject: string;
      from: string;
      to?: string;
      date: string;
      body: string;
      snippet?: string;
    };
    draftId?: string;
    messageId?: string;
    movedToTrash?: boolean;
    permanent?: boolean;
  }>;

  savePersistentState(options: {
    key: string;
    value: string;
  }): Promise<{ ok: boolean; key: string }>;

  loadPersistentState(options: {
    key: string;
  }): Promise<{ ok: boolean; key: string; value: string | null }>;
}

const NativeSierraEmail = registerPlugin<SierraEmailNativePlugin>('SierraEmail');

let testEmailPluginOverride: SierraEmailNativePlugin | null = null;

export function __setEmailPluginForTests(plugin: SierraEmailNativePlugin | null): void {
  testEmailPluginOverride = plugin;
}

export function getSierraEmailPlugin(): SierraEmailNativePlugin {
  return testEmailPluginOverride || NativeSierraEmail;
}

export const EMAIL_ACCOUNTS_META_STORAGE_KEY = 'sierra_email_accounts_meta';
export const EMAIL_TOOLS_ENABLED_STORAGE_KEY = 'sierra_email_tools_enabled';

const DEFAULT_EMAIL_TOOLS_ENABLED: Record<EmailActionName, boolean> = {
  email_list: true,
  email_search: true,
  email_read: true,
  email_draft: true,
  email_send: true,
  email_delete: true,
};

/**
 * Syncs a non-secret JSON string to Android SharedPreferences so state survives
 * both normal close and Android Force Stop even if WebView localStorage is cleared.
 */
export async function syncNonSecretStateToNative(key: string, value: string): Promise<void> {
  try {
    const isNative = Boolean(testEmailPluginOverride) || Capacitor.getPlatform() === 'android';
    if (!isNative) return;
    await getSierraEmailPlugin().savePersistentState({ key, value });
  } catch {
    // Best-effort native mirror
  }
}

export async function loadNonSecretStateFromNative(key: string): Promise<string | null> {
  try {
    const isNative = Boolean(testEmailPluginOverride) || Capacitor.getPlatform() === 'android';
    if (!isNative) return null;
    const res = await getSierraEmailPlugin().loadPersistentState({ key });
    return res?.ok ? res.value : null;
  } catch {
    return null;
  }
}

/**
 * Sanitizes an account metadata object to guarantee no secret fields can ever be written to localStorage.
 */
function sanitizeAccountMetadata(raw: any): EmailAccountMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const email = typeof raw.email === 'string' ? raw.email.trim() : '';
  const provider = raw.provider as EmailProviderType;
  if (!id || !email || (provider !== 'gmail' && provider !== 'outlook' && provider !== 'yahoo')) {
    return null;
  }
  return {
    id,
    provider,
    email,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : email,
    ...(typeof raw.oauthClientId === 'string' && raw.oauthClientId.trim()
      ? { oauthClientId: raw.oauthClientId.trim() }
      : {}),
    ...(typeof raw.redirectUri === 'string' && raw.redirectUri.trim()
      ? { redirectUri: raw.redirectUri.trim() }
      : {}),
    connectedAt: typeof raw.connectedAt === 'number' ? raw.connectedAt : Date.now(),
    enabled: raw.enabled !== false,
  };
}

function getStorage(): Storage | null {
  if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

function dispatchEmailEvent(eventName: string): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent(eventName));
    }
  } catch {
    // Ignore in headless test environment
  }
}

export function getConnectedEmailAccounts(): EmailAccountMetadata[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(EMAIL_ACCOUNTS_META_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeAccountMetadata)
      .filter((item): item is EmailAccountMetadata => item !== null);
  } catch {
    return [];
  }
}

export function saveConnectedEmailAccountsMetadata(accounts: EmailAccountMetadata[]): void {
  const storage = getStorage();
  if (!storage) return;
  const clean = accounts
    .map(sanitizeAccountMetadata)
    .filter((item): item is EmailAccountMetadata => item !== null);
  const serialized = JSON.stringify(clean);
  storage.setItem(EMAIL_ACCOUNTS_META_STORAGE_KEY, serialized);
  void syncNonSecretStateToNative(EMAIL_ACCOUNTS_META_STORAGE_KEY, serialized);
  dispatchEmailEvent('sierra-email-accounts-changed');
}

/**
 * Connects or updates an email account:
 * - Saves non-secret metadata in localStorage + native SharedPreferences
 * - Saves OAuth tokens or Yahoo app password strictly inside Android Keystore via SierraEmail plugin
 */
export async function connectEmailAccountWithKeystore(
  metadata: Omit<EmailAccountMetadata, 'connectedAt'> & { connectedAt?: number },
  secrets: EmailAccountSecretInput
): Promise<{ ok: boolean; status: string; reason?: string; account?: EmailAccountMetadata }> {
  const cleanMeta = sanitizeAccountMetadata({
    ...metadata,
    connectedAt: metadata.connectedAt || Date.now(),
  });
  if (!cleanMeta) {
    return { ok: false, status: 'invalid_metadata', reason: 'Invalid account metadata.' };
  }

  const isNativeOrTest = Boolean(testEmailPluginOverride) || Capacitor.getPlatform() === 'android';
  if (!isNativeOrTest) {
    return {
      ok: false,
      status: 'unsupported_platform',
      reason: 'Keystore-backed email credentials require the Android runtime.',
    };
  }

  const res = await getSierraEmailPlugin().saveAccountCredentials({
    accountId: cleanMeta.id,
    provider: cleanMeta.provider,
    email: cleanMeta.email,
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    expiresAt: secrets.expiresAt,
    appPassword: secrets.appPassword,
    clientId: secrets.clientId || cleanMeta.oauthClientId,
  });

  if (!res.ok) {
    return { ok: false, status: res.status || 'keystore_error', reason: 'Failed to store credentials in Android Keystore.' };
  }

  const existing = getConnectedEmailAccounts().filter(
    (a) => a.id !== cleanMeta.id && !(a.provider === cleanMeta.provider && a.email.toLowerCase() === cleanMeta.email.toLowerCase())
  );
  saveConnectedEmailAccountsMetadata([...existing, cleanMeta]);
  return { ok: true, status: 'connected', account: cleanMeta };
}

export async function disconnectEmailAccount(accountId: string): Promise<void> {
  const remaining = getConnectedEmailAccounts().filter((a) => a.id !== accountId);
  saveConnectedEmailAccountsMetadata(remaining);
  try {
    const isNativeOrTest = Boolean(testEmailPluginOverride) || Capacitor.getPlatform() === 'android';
    if (isNativeOrTest) {
      await getSierraEmailPlugin().removeAccountCredentials({ accountId });
    }
  } catch {
    // Ignore cleanup errors
  }
}

export function getEmailToolsEnabledConfig(): Record<EmailActionName, boolean> {
  const storage = getStorage();
  if (!storage) {
    return { ...DEFAULT_EMAIL_TOOLS_ENABLED };
  }
  try {
    const raw = storage.getItem(EMAIL_TOOLS_ENABLED_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EMAIL_TOOLS_ENABLED };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_EMAIL_TOOLS_ENABLED, ...parsed };
  } catch {
    return { ...DEFAULT_EMAIL_TOOLS_ENABLED };
  }
}

export function setEmailToolEnabled(action: EmailActionName, enabled: boolean): void {
  const storage = getStorage();
  if (!storage) return;
  const current = getEmailToolsEnabledConfig();
  current[action] = enabled;
  const serialized = JSON.stringify(current);
  storage.setItem(EMAIL_TOOLS_ENABLED_STORAGE_KEY, serialized);
  void syncNonSecretStateToNative(EMAIL_TOOLS_ENABLED_STORAGE_KEY, serialized);
  dispatchEmailEvent('sierra-email-tools-changed');
}

/**
 * Resolves an account argument (which may be an account ID, email address, or provider name like "gmail", "outlook", "yahoo")
 * to a connected EmailAccountMetadata record.
 */
export function resolveConnectedEmailAccount(accountQuery?: string): EmailAccountMetadata | null {
  const accounts = getConnectedEmailAccounts().filter((a) => a.enabled);
  if (accounts.length === 0) return null;
  if (!accountQuery || !accountQuery.trim()) {
    return accounts[0];
  }
  const q = accountQuery.trim().toLowerCase();
  return (
    accounts.find((a) => a.id.toLowerCase() === q) ||
    accounts.find((a) => a.email.toLowerCase() === q) ||
    accounts.find((a) => a.provider.toLowerCase() === q) ||
    accounts.find((a) => a.displayName.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)) ||
    null
  );
}

export function isEmailToolName(name: string): name is EmailActionName {
  return (EMAIL_TOOL_NAMES as readonly string[]).includes(name);
}

export function getEmailToolsDeclarations(): FunctionDeclaration[] {
  const accountParam = {
    type: Type.STRING,
    description:
      'Target email account identifier: provider name ("gmail", "outlook", "yahoo"), email address, or account ID. If omitted, uses the primary connected account.',
  };

  return [
    {
      name: 'email_list',
      description:
        'List recent inbox emails from a connected Gmail, Outlook, or Yahoo account. Does not require confirmation.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          account: accountParam,
          maxResults: {
            type: Type.NUMBER,
            description: 'Maximum number of messages to return (1-25, default 10).',
          },
        },
      },
    },
    {
      name: 'email_search',
      description:
        'Search emails by sender, subject, or keyword in a connected Gmail, Outlook, or Yahoo account. Does not require confirmation.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          account: accountParam,
          query: {
            type: Type.STRING,
            description: 'Search query (sender, subject, or keywords).',
          },
          maxResults: {
            type: Type.NUMBER,
            description: 'Maximum number of messages to return (1-25, default 10).',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'email_read',
      description:
        'Read the full content of a specific email message by its messageId in a connected Gmail, Outlook, or Yahoo account. Does not require confirmation.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          account: accountParam,
          messageId: {
            type: Type.STRING,
            description: 'The message ID returned by email_list or email_search.',
          },
        },
        required: ['messageId'],
      },
    },
    {
      name: 'email_draft',
      description:
        'Create and save an email draft in a connected Gmail, Outlook, or Yahoo account without sending it. Does not require confirmation.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          account: accountParam,
          to: {
            type: Type.STRING,
            description: 'Recipient email address.',
          },
          cc: {
            type: Type.STRING,
            description: 'Optional CC email address(es).',
          },
          subject: {
            type: Type.STRING,
            description: 'Email subject line.',
          },
          body: {
            type: Type.STRING,
            description: 'Plain-text body of the draft email.',
          },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    {
      name: 'email_send',
      description:
        'Send an email from a connected Gmail, Outlook, or Yahoo account. The app will automatically display a user confirmation dialog on screen before sending.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          account: accountParam,
          to: {
            type: Type.STRING,
            description: 'Recipient email address.',
          },
          cc: {
            type: Type.STRING,
            description: 'Optional CC email address(es).',
          },
          subject: {
            type: Type.STRING,
            description: 'Email subject line.',
          },
          body: {
            type: Type.STRING,
            description: 'Plain-text body of the email to send.',
          },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    {
      name: 'email_delete',
      description:
        'Move an email message to Trash (default) or permanently delete it in a connected Gmail, Outlook, or Yahoo account. The app will automatically display a user confirmation dialog on screen before deleting.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          account: accountParam,
          messageId: {
            type: Type.STRING,
            description: 'The ID of the email message to move to Trash / delete.',
          },
          permanent: {
            type: Type.BOOLEAN,
            description:
              'Optional. Defaults to false (moves message to Trash). Set to true only if the user explicitly asked for permanent deletion.',
          },
        },
        required: ['messageId'],
      },
    },
  ];
}

export function buildEmailToolsSystemPromptSection(): string {
  const accounts = getConnectedEmailAccounts().filter((a) => a.enabled);
  const accountSummary =
    accounts.length > 0
      ? accounts.map((a) => `${a.provider}:${a.email} (id=${a.id})`).join(', ')
      : 'None connected yet (user can connect Gmail, Outlook, or Yahoo in Settings > Email Accounts)';

  return [
    '\n\n[UNIFIED EMAIL TOOLS (GMAIL, OUTLOOK, YAHOO)]',
    `Connected Email Accounts: ${accountSummary}`,
    '- Available email tools: email_list, email_search, email_read, email_draft, email_send, email_delete.',
    '- Every email tool accepts an "account" parameter (provider name "gmail"/"outlook"/"yahoo", email address, or account id) and routes to the matching provider.',
    '- Reading, listing, searching, and drafting emails (email_list, email_search, email_read, email_draft) execute immediately without confirmation.',
    '- Sending (email_send) and deleting (email_delete) ALWAYS trigger an app-owned confirmation dialog on the user\'s screen. You cannot bypass confirmation.',
    '- Prefer moving emails to Trash (permanent: false) over permanent deletion unless the user explicitly demands permanent deletion.',
  ].join('\n');
}

/**
 * Executes a unified email tool call on-device via the Android Keystore-backed SierraEmail plugin.
 * Never uses a server proxy and never trusts model-supplied `confirmed` flags.
 */
export async function executeEmailToolCall(
  toolName: string,
  rawArgs: Record<string, any>
): Promise<Record<string, any>> {
  const safeArgs = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  // HARD RULE 1: Strip any model-supplied `confirmed` field so the model can NEVER self-approve.
  delete safeArgs.confirmed;

  if (!isEmailToolName(toolName)) {
    return {
      ok: false,
      status: 'unsupported',
      reason: `Unsupported email tool: ${toolName}`,
    };
  }

  const enabledMap = getEmailToolsEnabledConfig();
  if (!enabledMap[toolName]) {
    return {
      ok: false,
      status: 'disabled_in_settings',
      reason: `Email tool "${toolName}" is currently disabled in Settings.`,
    };
  }

  const account = resolveConnectedEmailAccount(safeArgs.account);
  if (!account) {
    const requested = safeArgs.account ? ` matching "${safeArgs.account}"` : '';
    return {
      ok: false,
      status: 'account_not_connected',
      reason: `No connected email account${requested}. Please connect Gmail, Outlook, or Yahoo in Settings > Email Accounts.`,
    };
  }

  const isNativeOrTest = Boolean(testEmailPluginOverride) || Capacitor.getPlatform() === 'android';
  if (!isNativeOrTest) {
    return {
      ok: false,
      status: 'unsupported_platform',
      reason: 'On-device email access requires the Android app with Keystore credentials.',
    };
  }

  // HARD RULE 1: App-owned user confirmation dialog for email_send and email_delete
  if (toolName === 'email_send') {
    const to = String(safeArgs.to || '').trim();
    const subject = String(safeArgs.subject || '').trim();
    const body = String(safeArgs.body || '').trim();
    if (!to) {
      return { ok: false, status: 'invalid_args', reason: 'Missing recipient ("to") for email_send.' };
    }
    const decision = await requestAppUserConfirmation({
      toolName: 'email_send',
      title: `Confirm Send Email (${account.provider.toUpperCase()})`,
      summary: `Allow Sierra to send this email from ${account.email}?`,
      details: {
        Account: `${account.displayName} <${account.email}> (${account.provider})`,
        To: to,
        ...(safeArgs.cc ? { CC: String(safeArgs.cc) } : {}),
        Subject: subject || '(No subject)',
        Body: body.length > 240 ? `${body.slice(0, 240)}...` : body,
      },
    });
    if (!decision.approved || !consumeUserApprovalToken(decision.userApprovalToken)) {
      return {
        ok: false,
        status: 'user_cancelled',
        reason: 'User declined to send the email in the confirmation dialog.',
      };
    }
  } else if (toolName === 'email_delete') {
    const messageId = String(safeArgs.messageId || '').trim();
    if (!messageId) {
      return { ok: false, status: 'invalid_args', reason: 'Missing messageId for email_delete.' };
    }
    // Prefer moving to Trash over permanent delete
    const permanent = safeArgs.permanent === true;
    const decision = await requestAppUserConfirmation({
      toolName: 'email_delete',
      title: permanent
        ? `Confirm Permanent Email Delete (${account.provider.toUpperCase()})`
        : `Confirm Move Email to Trash (${account.provider.toUpperCase()})`,
      summary: permanent
        ? `Permanently delete message ${messageId} from ${account.email}?`
        : `Move message ${messageId} to Trash in ${account.email}?`,
      details: {
        Account: `${account.displayName} <${account.email}> (${account.provider})`,
        'Message ID': messageId,
        Mode: permanent ? 'Permanent Delete' : 'Move to Trash (recoverable)',
      },
    });
    if (!decision.approved || !consumeUserApprovalToken(decision.userApprovalToken)) {
      return {
        ok: false,
        status: 'user_cancelled',
        reason: 'User declined to delete the email in the confirmation dialog.',
      };
    }
  }

  const shortActionMap: Record<EmailActionName, 'list' | 'search' | 'read' | 'draft' | 'send' | 'delete'> = {
    email_list: 'list',
    email_search: 'search',
    email_read: 'read',
    email_draft: 'draft',
    email_send: 'send',
    email_delete: 'delete',
  };

  try {
    const plugin = getSierraEmailPlugin();
    const result = await plugin.executeEmailAction({
      accountId: account.id,
      action: shortActionMap[toolName],
      maxResults: typeof safeArgs.maxResults === 'number' ? safeArgs.maxResults : 10,
      query: safeArgs.query ? String(safeArgs.query) : undefined,
      messageId: safeArgs.messageId ? String(safeArgs.messageId) : undefined,
      to: safeArgs.to ? String(safeArgs.to) : undefined,
      cc: safeArgs.cc ? String(safeArgs.cc) : undefined,
      subject: safeArgs.subject ? String(safeArgs.subject) : undefined,
      body: safeArgs.body ? String(safeArgs.body) : undefined,
      // Prefer moving emails to Trash (permanent = false by default)
      permanent: safeArgs.permanent === true,
    });
    return {
      ...result,
      provider: account.provider,
      account: account.email,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 'error',
      provider: account.provider,
      account: account.email,
      reason: err?.message || 'On-device email execution failed.',
    };
  }
}

export const DEFAULT_GMAIL_OAUTH_CLIENT_ID =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GOOGLE_GMAIL_CLIENT_ID) ||
  '1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl.apps.googleusercontent.com';

/**
 * Derives the standard Google Android OAuth 2.0 reverse-client-ID redirect URI:
 * `<PREFIX>.apps.googleusercontent.com` -> `com.googleusercontent.apps.<PREFIX>:/oauth2redirect`
 */
export function deriveGoogleAndroidRedirectUri(clientId?: string): string {
  const clean = (clientId || DEFAULT_GMAIL_OAUTH_CLIENT_ID).trim();
  const suffix = '.apps.googleusercontent.com';
  if (clean.toLowerCase().endsWith(suffix)) {
    const prefix = clean.slice(0, clean.length - suffix.length);
    if (prefix) {
      return `com.googleusercontent.apps.${prefix}:/oauth2redirect`;
    }
  }
  return 'com.sierra.omniagent:/oauth2redirect';
}

export const DEFAULT_GMAIL_REDIRECT_URI = deriveGoogleAndroidRedirectUri(DEFAULT_GMAIL_OAUTH_CLIENT_ID);

/**
 * Parses a downloaded Google Cloud OAuth credentials JSON file (`installed` or `web`)
 * and returns the clientId and appropriate Android redirectUri.
 */
export function parseGoogleCredentialsJson(rawJson: string): {
  ok: boolean;
  clientId?: string;
  redirectUri?: string;
  projectId?: string;
  reason?: string;
} {
  try {
    const parsed = JSON.parse(rawJson);
    const block = parsed?.installed || parsed?.web || parsed;
    const clientId = typeof block?.client_id === 'string' ? block.client_id.trim() : '';
    if (!clientId) {
      return {
        ok: false,
        reason: 'Could not find "client_id" in the Google credentials JSON file.',
      };
    }
    const redirectUri = deriveGoogleAndroidRedirectUri(clientId);
    const projectId = typeof block?.project_id === 'string' ? block.project_id.trim() : undefined;
    return {
      ok: true,
      clientId,
      redirectUri,
      projectId,
    };
  } catch (err: any) {
    return {
      ok: false,
      reason: `Invalid JSON file: ${err?.message || 'parse error'}`,
    };
  }
}

/**
 * Exact personal-account OAuth & App Password setup guides for Gmail, Outlook, and Yahoo.
 */
export const EMAIL_PROVIDER_SETUP_GUIDES = {
  gmail: {
    title: 'Gmail (Google Cloud OAuth 2.0 — Testing Mode)',
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    defaultClientId: DEFAULT_GMAIL_OAUTH_CLIENT_ID,
    redirectUri: DEFAULT_GMAIL_REDIRECT_URI,
    steps: [
      '1. Android OAuth Client ID is pre-configured: 1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl.apps.googleusercontent.com (package: com.sierra.omniagent).',
      '2. Scopes used: gmail.modify (read, search, draft, trash) and gmail.send (send emails).',
      '3. Ensure your Gmail address is added under "Test users" in Google Cloud Console -> OAuth consent screen (External / Testing mode).',
      '4. Tap "Sign in with Google (Gmail)" below to launch the on-device PKCE flow. Google redirects back to the app and stores your OAuth tokens directly in Android Keystore.',
    ],
  },
  outlook: {
    title: 'Outlook / Microsoft 365 (Microsoft Entra ID — Personal Account)',
    scopes: ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'],
    redirectUri: 'msauth://com.sierra.omniagent/oauth2redirect',
    steps: [
      '1. Open Microsoft Entra Admin Center (https://entra.microsoft.com/) -> Applications -> App registrations -> New registration.',
      '2. Name it "Sierra Personal Agent" and select "Accounts in any organizational directory and personal Microsoft accounts".',
      '3. Set Redirect URI to "Public client/native (mobile & desktop)" with URI: msauth://com.sierra.omniagent/oauth2redirect (or http://localhost:3000/oauth/callback).',
      '4. Go to API permissions -> Add a permission -> Microsoft Graph -> Delegated permissions, and add: Mail.ReadWrite, Mail.Send, User.Read, offline_access.',
      '5. Copy the Application (client) ID from the Overview page and complete sign-in below. Tokens are stored strictly in Android Keystore.',
    ],
  },
  yahoo: {
    title: 'Yahoo Mail (On-Device IMAP/SMTP with App Password)',
    imapHost: 'imap.mail.yahoo.com:993 (SSL/TLS)',
    smtpHost: 'smtp.mail.yahoo.com:465 (SSL/TLS)',
    steps: [
      '1. Sign in to your Yahoo Account Security page (https://login.yahoo.com/account/security).',
      '2. Enable 2-Step Verification if not already enabled.',
      '3. Click "Generate app password" (or "Manage app passwords"), enter "Sierra Android", and copy the 16-character App Password.',
      '4. Enter your Yahoo email address and the 16-character App Password below. The App Password goes directly into Android Keystore and is used by on-device SSL sockets (imap.mail.yahoo.com:993 & smtp.mail.yahoo.com:465) with zero server proxy.',
    ],
  },
} as const;

export function buildOAuthAuthorizeUrl(params: {
  provider: 'gmail' | 'outlook';
  clientId: string;
  redirectUri: string;
  loginHint?: string;
  codeChallenge?: string;
}): string {
  const rawClientId = params.clientId.trim() || (params.provider === 'gmail' ? DEFAULT_GMAIL_OAUTH_CLIENT_ID : '');
  const rawRedirectUri =
    params.redirectUri.trim() ||
    (params.provider === 'gmail'
      ? deriveGoogleAndroidRedirectUri(rawClientId)
      : EMAIL_PROVIDER_SETUP_GUIDES.outlook.redirectUri);

  const clientId = encodeURIComponent(rawClientId);
  const redirectUri = encodeURIComponent(rawRedirectUri);
  const hint = params.loginHint ? `&login_hint=${encodeURIComponent(params.loginHint.trim())}` : '';
  const pkce = params.codeChallenge
    ? `&code_challenge=${encodeURIComponent(params.codeChallenge)}&code_challenge_method=S256`
    : '';

  if (params.provider === 'gmail') {
    const scope = encodeURIComponent(EMAIL_PROVIDER_SETUP_GUIDES.gmail.scopes.join(' '));
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&access_type=offline&prompt=consent&scope=${scope}${hint}${pkce}`;
  }

  const scope = encodeURIComponent(EMAIL_PROVIDER_SETUP_GUIDES.outlook.scopes.join(' '));
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&response_mode=query&scope=${scope}${hint}${pkce}`;
}

/**
 * Initiates the native on-device PKCE OAuth 2.0 flow via SierraEmail plugin.
 * On Android, generates code_verifier/code_challenge in Java, launches the system browser,
 * intercepts the custom-scheme redirect in MainActivity -> EmailPlugin.handleOnNewIntent,
 * exchanges the authorization code at https://oauth2.googleapis.com/token, stores tokens in
 * Android Keystore, and emits `oauthSignInComplete`.
 */
export async function startNativeGmailOAuthSignIn(options?: {
  clientId?: string;
  redirectUri?: string;
  emailHint?: string;
  email?: string;
  displayName?: string;
}): Promise<{ ok: boolean; status?: string; reason?: string; authUrl?: string; redirectUri?: string }> {
  const clientId = (options?.clientId || DEFAULT_GMAIL_OAUTH_CLIENT_ID).trim();
  const redirectUri = (options?.redirectUri || deriveGoogleAndroidRedirectUri(clientId)).trim();
  const hint = (options?.emailHint || options?.email || '').trim() || undefined;
  const plugin = getSierraEmailPlugin();

  if (typeof plugin.startOAuthSignIn === 'function' && (Boolean(testEmailPluginOverride) || Capacitor.getPlatform() === 'android')) {
    return await plugin.startOAuthSignIn({
      provider: 'gmail',
      clientId,
      redirectUri,
      emailHint: hint,
      displayName: options?.displayName?.trim() || undefined,
      scopes: [...EMAIL_PROVIDER_SETUP_GUIDES.gmail.scopes],
    });
  }

  const authUrl = buildOAuthAuthorizeUrl({
    provider: 'gmail',
    clientId,
    redirectUri,
    loginHint: hint,
  });
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(authUrl, '_blank', 'noopener,noreferrer');
  }
  return { ok: true, status: 'browser_opened', authUrl, redirectUri };
}
