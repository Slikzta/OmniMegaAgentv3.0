import { Capacitor, registerPlugin } from '@capacitor/core';
import { addDebugLog } from './debugLogStore';
import {
  requestAppUserConfirmation,
  consumeUserApprovalToken,
} from './actionConfirmationStore';
import { syncNonSecretStateToNative } from './emailTools';

export type DeviceCapabilityId =
  | 'open_app'
  | 'find_contact'
  | 'make_call'
  | 'send_text'
  | 'block_number'
  | 'open_maps'
  | 'add_calendar_event'
  | 'find_calendar_events'
  | 'set_alarm'
  | 'set_timer'
  | 'create_reminder'
  | 'list_reminders'
  | 'open_url'
  | 'web_search'
  | 'read_messages'
  | 'read_call_log'
  | 'get_current_time';

export type PermissionStatusValue = 'granted' | 'denied' | 'prompt' | 'not_required' | 'unavailable';

export type DevicePermissionGroup =
  | 'none'
  | 'contacts'
  | 'phone'
  | 'sms'
  | 'read_sms'
  | 'call_log'
  | 'call_screening'
  | 'calendar'
  | 'alarm';

export interface DeviceCapabilityMetadata {
  id: DeviceCapabilityId;
  label: string;
  description: string;
  requiresConfirmation: boolean;
  requiredPermissionGroup: DevicePermissionGroup;
  permissionLabel: string;
  rationale: string;
}

export const DEVICE_CAPABILITIES: DeviceCapabilityMetadata[] = [
  {
    id: 'open_app',
    label: 'Open Installed Apps',
    description: 'Launch installed Android applications by spoken name or package ID.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'none',
    permissionLabel: 'Package Queries (Manifest)',
    rationale: 'Uses Android PackageManager launcher intents to find and open apps you ask for.',
  },
  {
    id: 'open_url',
    label: 'Open Web URLs',
    description: 'Open web pages in your default browser (http:// or https://).',
    requiresConfirmation: false,
    requiredPermissionGroup: 'none',
    permissionLabel: 'Browser Intent (Manifest)',
    rationale: 'Uses Android ACTION_VIEW browser intents to open websites you ask for.',
  },
  {
    id: 'web_search',
    label: 'Search the Web in Browser',
    description: 'Open a web search results page in your default browser for any search query.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'none',
    permissionLabel: 'Browser Intent (Manifest)',
    rationale: 'Opens your default browser to search results for your query.',
  },
  {
    id: 'read_messages',
    label: 'Read SMS Messages',
    description: 'Read recent or unread incoming SMS text messages from your inbox aloud when asked.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'read_sms',
    permissionLabel: 'READ_SMS',
    rationale: 'Sierra needs READ_SMS permission to read your incoming text messages aloud when you ask.',
  },
  {
    id: 'read_call_log',
    label: 'Read Call Log History',
    description: 'Read recent missed, incoming, or outgoing phone calls from your call history.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'call_log',
    permissionLabel: 'READ_CALL_LOG',
    rationale: 'Sierra needs READ_CALL_LOG permission to check your recent or missed calls when you ask.',
  },
  {
    id: 'get_current_time',
    label: 'Get Current Device Time',
    description: 'Check the device current date, time, day of week, and timezone for accurate scheduling.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'none',
    permissionLabel: 'No Runtime Permission Needed',
    rationale: 'Reads the system clock and timezone so relative times like "tomorrow at 3pm" are computed accurately.',
  },
  {
    id: 'find_contact',
    label: 'Find Contacts',
    description: 'Search your phone contacts by name to look up phone numbers.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'contacts',
    permissionLabel: 'READ_CONTACTS',
    rationale: 'Sierra needs Contacts permission so she can look up phone numbers when you ask to find, call, or text someone by name.',
  },
  {
    id: 'make_call',
    label: 'Make Phone Calls',
    description: 'Place phone calls after reading back the recipient and getting your confirmation (falls back to dialer if CALL_PHONE is denied).',
    requiresConfirmation: true,
    requiredPermissionGroup: 'phone',
    permissionLabel: 'CALL_PHONE',
    rationale: 'Sierra needs Phone Call permission to place calls directly after you confirm; otherwise she opens the phone dialer with the number pre-filled.',
  },
  {
    id: 'send_text',
    label: 'Send Text Messages (SMS)',
    description: 'Open your messaging app pre-filled (or send SMS directly if enabled) after reading back the message and getting your confirmation.',
    requiresConfirmation: true,
    requiredPermissionGroup: 'sms',
    permissionLabel: 'SEND_SMS (Optional for Direct Send)',
    rationale: 'By default Sierra opens your SMS app with the text pre-filled (no permission needed). Direct background SMS sending requires SEND_SMS permission.',
  },
  {
    id: 'block_number',
    label: 'Block Numbers & Call Screening',
    description: 'Screen and reject incoming calls from numbers on your local blocklist using Android CallScreeningService.',
    requiresConfirmation: true,
    requiredPermissionGroup: 'call_screening',
    permissionLabel: 'ROLE_CALL_SCREENING',
    rationale: 'Android requires granting Sierra the Call Screening Role so she can automatically reject calls from numbers you block.',
  },
  {
    id: 'open_maps',
    label: 'Open Maps & Navigation',
    description: 'Open Google Maps or your default maps app for turn-by-turn directions or place search.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'none',
    permissionLabel: 'No Runtime Permission Needed',
    rationale: 'Launches Google Maps or your default map app via standard geo: and google.navigation: intents.',
  },
  {
    id: 'add_calendar_event',
    label: 'Add Calendar Events',
    description: 'Create calendar events in your device calendar after reading back the title and time for confirmation.',
    requiresConfirmation: true,
    requiredPermissionGroup: 'calendar',
    permissionLabel: 'READ_CALENDAR & WRITE_CALENDAR',
    rationale: 'Sierra needs Calendar read and write permissions to add events to your phone calendar.',
  },
  {
    id: 'find_calendar_events',
    label: 'Find Upcoming Calendar Events',
    description: 'Look up upcoming events on your device calendar.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'calendar',
    permissionLabel: 'READ_CALENDAR',
    rationale: 'Sierra needs Calendar read permission to check your upcoming schedule.',
  },
  {
    id: 'set_alarm',
    label: 'Set Alarms',
    description: 'Set alarms in your phone clock app after reading back the alarm time for confirmation.',
    requiresConfirmation: true,
    requiredPermissionGroup: 'alarm',
    permissionLabel: 'SET_ALARM (Install-time)',
    rationale: 'Uses Android AlarmClock intents so alarms appear directly in your system Clock app.',
  },
  {
    id: 'set_timer',
    label: 'Set Timers',
    description: 'Start countdown timers in your phone clock app without needing confirmation.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'alarm',
    permissionLabel: 'SET_ALARM (Install-time)',
    rationale: 'Uses Android AlarmClock timer intents to start countdowns in your system Clock app.',
  },
  {
    id: 'create_reminder',
    label: 'Create Reminders (Calendar Alert)',
    description: 'Create a calendar event with a reminder notification alert at the requested time after confirmation.',
    requiresConfirmation: true,
    requiredPermissionGroup: 'calendar',
    permissionLabel: 'READ_CALENDAR & WRITE_CALENDAR',
    rationale: 'Because Android has no universal reminders provider, reminders are stored as calendar events with an alert notification in your device calendar.',
  },
  {
    id: 'list_reminders',
    label: 'List Reminders (Calendar Alerts)',
    description: 'List upcoming reminders stored in your device calendar.',
    requiresConfirmation: false,
    requiredPermissionGroup: 'calendar',
    permissionLabel: 'READ_CALENDAR',
    rationale: 'Sierra needs Calendar read permission to list your upcoming reminders.',
  },
];

export const DEVICE_CAPABILITY_DEFINITIONS = DEVICE_CAPABILITIES;
export const DEVICE_CONTROL_TOOL_NAMES: DeviceCapabilityId[] = DEVICE_CAPABILITIES.map((c) => c.id);

export interface DeviceCapabilitiesConfig {
  enabled: Record<DeviceCapabilityId, boolean>;
  directSmsEnabled: boolean;
  readMessagesAndCallLogEnabled: boolean;
}

export const STORAGE_KEY_DEVICE_CAPABILITIES = 'sierra_device_capabilities_v1';
export const STORAGE_KEY_BLOCKED_NUMBERS = 'sierra_blocked_numbers_v1';

const DEFAULT_ENABLED_MAP: Record<DeviceCapabilityId, boolean> = {
  open_app: true,
  open_url: true,
  web_search: true,
  read_messages: true,
  read_call_log: true,
  get_current_time: true,
  find_contact: true,
  make_call: true,
  send_text: true,
  block_number: true,
  open_maps: true,
  add_calendar_event: true,
  find_calendar_events: true,
  set_alarm: true,
  set_timer: true,
  create_reminder: true,
  list_reminders: true,
};

export function getDeviceCapabilitiesConfig(): DeviceCapabilitiesConfig {
  if (typeof localStorage === 'undefined') {
    return {
      enabled: { ...DEFAULT_ENABLED_MAP },
      directSmsEnabled: false,
      readMessagesAndCallLogEnabled: true,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DEVICE_CAPABILITIES);
    if (!raw) {
      return {
        enabled: { ...DEFAULT_ENABLED_MAP },
        directSmsEnabled: false,
        readMessagesAndCallLogEnabled: true,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      enabled: {
        ...DEFAULT_ENABLED_MAP,
        ...(parsed?.enabled || {}),
      },
      directSmsEnabled: Boolean(parsed?.directSmsEnabled),
      readMessagesAndCallLogEnabled:
        parsed?.readMessagesAndCallLogEnabled !== undefined
          ? Boolean(parsed.readMessagesAndCallLogEnabled)
          : true,
    };
  } catch {
    return {
      enabled: { ...DEFAULT_ENABLED_MAP },
      directSmsEnabled: false,
      readMessagesAndCallLogEnabled: true,
    };
  }
}

export function saveDeviceCapabilitiesConfig(config: DeviceCapabilitiesConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const serialized = JSON.stringify(config);
    localStorage.setItem(STORAGE_KEY_DEVICE_CAPABILITIES, serialized);
    void syncNonSecretStateToNative(STORAGE_KEY_DEVICE_CAPABILITIES, serialized);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sierra_device_capabilities_updated', { detail: config }));
    }
  } catch {
    // ignore
  }
}

export function setDeviceCapabilityEnabled(id: DeviceCapabilityId, enabled: boolean): DeviceCapabilitiesConfig {
  const current = getDeviceCapabilitiesConfig();
  const next: DeviceCapabilitiesConfig = {
    ...current,
    enabled: {
      ...current.enabled,
      [id]: enabled,
    },
  };
  saveDeviceCapabilitiesConfig(next);
  addDebugLog('DeviceControl:Setting', `Capability "${id}" set to ${enabled ? 'ENABLED' : 'DISABLED'}`);
  return next;
}

export function setDirectSmsEnabled(directSmsEnabled: boolean): DeviceCapabilitiesConfig {
  const current = getDeviceCapabilitiesConfig();
  const next: DeviceCapabilitiesConfig = {
    ...current,
    directSmsEnabled,
  };
  saveDeviceCapabilitiesConfig(next);
  addDebugLog('DeviceControl:Setting', `Direct SMS sending set to ${directSmsEnabled ? 'ENABLED' : 'DISABLED'}`);
  return next;
}

export function setReadMessagesAndCallLogEnabled(readMessagesAndCallLogEnabled: boolean): DeviceCapabilitiesConfig {
  const current = getDeviceCapabilitiesConfig();
  const next: DeviceCapabilitiesConfig = {
    ...current,
    readMessagesAndCallLogEnabled,
    enabled: {
      ...current.enabled,
      read_messages: readMessagesAndCallLogEnabled,
      read_call_log: readMessagesAndCallLogEnabled,
    },
  };
  saveDeviceCapabilitiesConfig(next);
  addDebugLog(
    'DeviceControl:Setting',
    `"Let Sierra read my messages and call log" set to ${readMessagesAndCallLogEnabled ? 'ENABLED' : 'DISABLED'}`
  );
  return next;
}

export function getLocalBlockedNumbers(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BLOCKED_NUMBERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function addLocalBlockedNumber(phoneNumber: string): string[] {
  const normalized = phoneNumber.trim();
  const current = getLocalBlockedNumbers();
  if (!normalized) return current;
  if (!current.includes(normalized)) {
    current.push(normalized);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_BLOCKED_NUMBERS, JSON.stringify(current));
      } catch {
        // ignore
      }
    }
  }
  return current;
}

export interface DevicePermissionsState {
  contacts: PermissionStatusValue;
  phone: PermissionStatusValue;
  sms: PermissionStatusValue;
  readSms?: PermissionStatusValue;
  callLog?: PermissionStatusValue;
  calendar: PermissionStatusValue;
  callScreeningRole: boolean;
  alarm: PermissionStatusValue;
}

export interface InstalledAppCandidate {
  name?: string;
  label?: string;
  packageName: string;
}

/**
 * Pure helper for open_url validation and scheme normalization.
 * Adds https:// when no scheme is present and rejects any non-http/https scheme.
 */
export function normalizeAndValidateOpenUrl(rawInput?: string | null): {
  ok: boolean;
  normalizedUrl?: string;
  reason?: string;
} {
  const trimmed = String(rawInput ?? '').trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: 'URL is empty. Please provide a valid website URL or domain.',
    };
  }

  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  let candidate = trimmed;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return {
        ok: false,
        reason: `Rejected URL scheme "${scheme}:". Only http: and https: URLs are allowed.`,
      };
    }
  } else {
    candidate = `https://${trimmed.replace(/^\/+/, '')}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        ok: false,
        reason: `Rejected URL protocol "${parsed.protocol}". Only http: and https: URLs are allowed.`,
      };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return {
        ok: false,
        reason: `Invalid hostname "${parsed.hostname || trimmed}". Please provide a valid web domain or URL.`,
      };
    }
    return {
      ok: true,
      normalizedUrl: candidate,
    };
  } catch {
    return {
      ok: false,
      reason: `Invalid URL "${trimmed}". Only valid http: and https: web addresses are allowed.`,
    };
  }
}

/**
 * Clamps maxResults for read_messages and read_call_log: default 5, floor 1, cap 20.
 */
export function clampReadMaxResults(value: unknown, defaultVal = 5, maxCap = 20): number {
  if (value === undefined || value === null || value === '') return defaultVal;
  const num = Number(value);
  if (!Number.isFinite(num) || isNaN(num)) return defaultVal;
  const intVal = Math.floor(num);
  return Math.max(1, Math.min(maxCap, intVal));
}

function normalizeAppToken(str: string): string {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Pure fuzzy matcher for open_app:
 * Case-insensitive, ignores punctuation, matches on:
 * 1) exact normalized app label
 * 2) partial normalized app label
 * 3) package name
 */
export function matchInstalledApps<T extends InstalledAppCandidate>(
  query: string,
  apps: T[],
): {
  matchStage: 'exact_label' | 'partial_label' | 'package_name' | 'none';
  matches: T[];
} {
  const normQuery = normalizeAppToken(query);
  if (!normQuery || !Array.isArray(apps) || apps.length === 0) {
    return { matchStage: 'none', matches: [] };
  }

  const exactLabelMatches: T[] = [];
  const partialLabelMatches: T[] = [];
  const packageMatches: T[] = [];

  for (const app of apps) {
    const rawLabel = app.label ?? app.name ?? '';
    const normLabel = normalizeAppToken(rawLabel);
    const normPkg = normalizeAppToken(app.packageName || '');
    const rawPkgLower = String(app.packageName || '').toLowerCase();
    const rawQueryLower = String(query || '').trim().toLowerCase();

    if (normLabel && normLabel === normQuery) {
      exactLabelMatches.push(app);
    } else if (normLabel && (normLabel.includes(normQuery) || (normLabel.length >= 3 && normQuery.includes(normLabel)))) {
      partialLabelMatches.push(app);
    } else if ((normPkg && normPkg.includes(normQuery)) || (rawPkgLower && rawPkgLower.includes(rawQueryLower))) {
      packageMatches.push(app);
    }
  }

  if (exactLabelMatches.length > 0) {
    return { matchStage: 'exact_label', matches: exactLabelMatches };
  }
  if (partialLabelMatches.length > 0) {
    return { matchStage: 'partial_label', matches: partialLabelMatches };
  }
  if (packageMatches.length > 0) {
    return { matchStage: 'package_name', matches: packageMatches };
  }
  return { matchStage: 'none', matches: [] };
}

/**
 * Truncates sensitive phone numbers and SMS/message bodies before writing to the debug log.
 */
export function sanitizeToolArgsForLog(args: Record<string, any> = {}): Record<string, any> {
  if (!args || typeof args !== 'object') return {};
  const copy: Record<string, any> = { ...args };
  for (const secretKey of ['appPassword', 'accessToken', 'refreshToken', 'clientSecret', 'password', 'token']) {
    if (secretKey in copy) {
      copy[secretKey] = '[REDACTED]';
    }
  }
  for (const key of ['phoneNumber', 'number', 'contact']) {
    if (typeof copy[key] === 'string' && copy[key].length > 5) {
      const s = copy[key].trim();
      copy[key] = `${s.slice(0, 3)}...${s.slice(-2)}`;
    }
  }
  for (const key of ['message', 'body', 'notes', 'description']) {
    if (typeof copy[key] === 'string' && copy[key].length > 24) {
      copy[key] = `${copy[key].slice(0, 24)}...[truncated]`;
    }
  }
  return copy;
}

export interface DeviceControlNativePlugin {
  openApp(options: { appName?: string; packageName?: string }): Promise<{
    ok?: boolean;
    success: boolean;
    launchedPackage?: string;
    launchedLabel?: string;
    launched?: { label: string; packageName: string };
    needsClarification?: boolean;
    matches?: { label: string; packageName: string }[];
    message?: string;
    reason?: string;
    error?: string;
  }>;
  openUrl(options: { url: string }): Promise<{
    ok?: boolean;
    success: boolean;
    url?: string;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  webSearch(options: { query: string; url?: string }): Promise<{
    ok?: boolean;
    success: boolean;
    query?: string;
    url?: string;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  readMessages(options: { contact?: string; unreadOnly?: boolean; maxResults?: number }): Promise<{
    ok?: boolean;
    success: boolean;
    count?: number;
    messages?: {
      sender: string;
      number?: string;
      timestamp: number;
      dateIso?: string;
      read?: boolean;
      body: string;
    }[];
    permissionDenied?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  readCallLog(options: { contact?: string; type?: 'missed' | 'incoming' | 'outgoing' | string; maxResults?: number }): Promise<{
    ok?: boolean;
    success: boolean;
    count?: number;
    calls?: {
      name?: string;
      number: string;
      type: string;
      timestamp: number;
      dateIso?: string;
      durationSeconds: number;
    }[];
    permissionDenied?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  getCurrentTime(): Promise<{
    ok?: boolean;
    success: boolean;
    timestampMs?: number;
    iso?: string;
    date?: string;
    time?: string;
    dayOfWeek?: string;
    timezone?: string;
    timezoneOffsetMinutes?: number;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  findContact(options: { query: string }): Promise<{
    ok?: boolean;
    success: boolean;
    contacts?: { name: string; number: string }[];
    permissionDenied?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  makeCall(options: { phoneNumber: string; number?: string; contactName?: string; recipientName?: string }): Promise<{
    ok?: boolean;
    success: boolean;
    actionUsed?: 'ACTION_CALL' | 'ACTION_DIAL';
    action?: string;
    recipient?: string;
    number?: string;
    fallbackToDialer?: boolean;
    phoneNumber?: string;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  sendText(options: { phoneNumber: string; number?: string; message: string; directSend?: boolean }): Promise<{
    ok?: boolean;
    success: boolean;
    method?: 'ACTION_SENDTO' | 'DIRECT_SMS';
    mode?: string;
    recipient?: string;
    number?: string;
    permissionDenied?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  blockNumber(options: { phoneNumber: string; number?: string; label?: string }): Promise<{
    ok?: boolean;
    success: boolean;
    blockedNumber?: string;
    number?: string;
    roleGranted?: boolean;
    roleHeld?: boolean;
    roleGuideMessage?: string;
    blockedList?: string[];
    message?: string;
    reason?: string;
    error?: string;
  }>;
  requestCallScreeningRole(): Promise<{
    ok?: boolean;
    success: boolean;
    roleGranted: boolean;
    message?: string;
  }>;
  openMaps(options: { destination: string; travelMode?: 'driving' | 'walking' | 'transit' | string }): Promise<{
    ok?: boolean;
    success: boolean;
    uriUsed?: string;
    destination?: string;
    travelMode?: string;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  addCalendarEvent(options: {
    title: string;
    startTimeIso: string;
    endTimeIso?: string;
    description?: string;
    location?: string;
  }): Promise<{
    ok?: boolean;
    success: boolean;
    eventId?: number | string;
    title?: string;
    startTimeIso?: string;
    endTimeIso?: string;
    permissionDenied?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  findCalendarEvents(options: {
    query?: string;
    startTimeIso?: string;
    endTimeIso?: string;
    maxResults?: number;
  }): Promise<{
    ok?: boolean;
    success: boolean;
    events?: {
      id: string | number;
      title: string;
      startTimeIso: string;
      endTimeIso: string;
      location?: string;
      description?: string;
    }[];
    permissionDenied?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  setAlarm(options: { hour: number; minute: number; message?: string; label?: string }): Promise<{
    ok?: boolean;
    success: boolean;
    hour?: number;
    minute?: number;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  setTimer(options: { durationSeconds: number; message?: string; label?: string }): Promise<{
    ok?: boolean;
    success: boolean;
    durationSeconds?: number;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  createReminder(options: {
    title: string;
    remindAtIso: string;
    notes?: string;
    minutesBeforeAlert?: number;
  }): Promise<{
    ok?: boolean;
    success: boolean;
    status?: string;
    eventId?: number | string;
    title?: string;
    remindAtIso?: string;
    storedIn?: string;
    storedInCalendar?: boolean;
    permissionDenied?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  listReminders(options: {
    query?: string;
    includePast?: boolean;
    maxResults?: number;
  }): Promise<{
    ok?: boolean;
    success: boolean;
    status?: string;
    count?: number;
    reminders?: Array<{
      id: string;
      title: string;
      remindAtIso: string;
      notes?: string;
    }>;
    permissionDenied?: boolean;
    message?: string;
    reason?: string;
    error?: string;
  }>;
  getPermissionsStatus(): Promise<DevicePermissionsState>;
  requestCapabilityPermission(options: {
    group: DevicePermissionGroup;
  }): Promise<DevicePermissionsState>;
}

const NativeDeviceControl = registerPlugin<DeviceControlNativePlugin>('DeviceControl');

let testPluginOverride: Partial<DeviceControlNativePlugin> | null = null;
let testIsNativeOverride: boolean | null = null;

/**
 * Allows unit tests to inject a mock native plugin implementation.
 */
export function __setDeviceControlPluginForTests(
  mockPlugin: Partial<DeviceControlNativePlugin> | null,
  isNative: boolean | null = mockPlugin ? true : null,
): void {
  testPluginOverride = mockPlugin;
  testIsNativeOverride = isNative;
}

function isAndroidNativeAvailable(): boolean {
  if (testIsNativeOverride !== null) return testIsNativeOverride;
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function getPlugin(): Partial<DeviceControlNativePlugin> {
  if (testPluginOverride) return testPluginOverride;
  return NativeDeviceControl;
}

export async function getDevicePermissionsStatus(): Promise<DevicePermissionsState> {
  if (!isAndroidNativeAvailable()) {
    return {
      contacts: 'unavailable',
      phone: 'unavailable',
      sms: 'unavailable',
      readSms: 'unavailable',
      callLog: 'unavailable',
      calendar: 'unavailable',
      callScreeningRole: false,
      alarm: 'unavailable',
    };
  }
  try {
    const plugin = getPlugin();
    if (!plugin.getPermissionsStatus) {
      throw new Error('DeviceControl.getPermissionsStatus not implemented');
    }
    const status = await plugin.getPermissionsStatus();
    return {
      ...status,
      readSms: status.readSms || 'prompt',
      callLog: status.callLog || 'prompt',
    };
  } catch (err: any) {
    addDebugLog('DeviceControl:PermStatusError', err?.message || String(err));
    return {
      contacts: 'prompt',
      phone: 'prompt',
      sms: 'prompt',
      readSms: 'prompt',
      callLog: 'prompt',
      calendar: 'prompt',
      callScreeningRole: false,
      alarm: 'granted',
    };
  }
}

export async function requestDeviceCapabilityPermission(
  group: DevicePermissionGroup,
): Promise<DevicePermissionsState> {
  addDebugLog('DeviceControl:PermRequest', `Requesting permission for group="${group}"`);
  if (!isAndroidNativeAvailable()) {
    addDebugLog('DeviceControl:PermRequest', `Skipped: not running on Android native platform`);
    return getDevicePermissionsStatus();
  }
  try {
    const plugin = getPlugin();
    if (group === 'call_screening' && plugin.requestCallScreeningRole) {
      const roleRes = await plugin.requestCallScreeningRole();
      addDebugLog(
        'DeviceControl:CallScreeningRole',
        `Role request result: granted=${roleRes.roleGranted} (${roleRes.message || ''})`,
      );
      return await getDevicePermissionsStatus();
    }
    if (plugin.requestCapabilityPermission) {
      const res = await plugin.requestCapabilityPermission({ group });
      addDebugLog('DeviceControl:PermResult', `Updated permissions: ${JSON.stringify(res)}`);
      return res;
    }
  } catch (err: any) {
    addDebugLog('DeviceControl:PermError', `Permission request failed for ${group}: ${err?.message || String(err)}`);
  }
  return getDevicePermissionsStatus();
}

/**
 * Checks all needed Android permissions at app launch and logs any missing/revoked permissions
 * so permission states are known immediately and never fail silently.
 */
export async function auditDevicePermissionsOnLaunch(): Promise<DevicePermissionsState> {
  const status = await getDevicePermissionsStatus();
  const missing: string[] = [];
  if (status.contacts !== 'granted') missing.push(`READ_CONTACTS (${status.contacts})`);
  if (status.phone !== 'granted') missing.push(`CALL_PHONE (${status.phone})`);
  if (status.sms !== 'granted') missing.push(`SEND_SMS (${status.sms})`);
  if (status.readSms !== 'granted') missing.push(`READ_SMS (${status.readSms})`);
  if (status.callLog !== 'granted') missing.push(`READ_CALL_LOG (${status.callLog})`);
  if (status.calendar !== 'granted') missing.push(`READ_CALENDAR/WRITE_CALENDAR (${status.calendar})`);
  addDebugLog(
    'DeviceControl:LaunchAudit',
    missing.length > 0
      ? `Permissions needing grant on use: ${missing.join(', ')}`
      : 'All Android device permissions are granted.',
  );
  return status;
}

export function getDeviceControlToolsDeclarations(): any[] {
  return [
    {
      name: 'open_app',
      description:
        'Launch an installed Android app by spoken name (e.g. "Spotify", "YouTube", "Settings") or package name. Case-insensitive and ignores punctuation. Does not require confirmation. If multiple apps match, returns the matches so you can ask the user which one to open.',
      parameters: {
        type: 'OBJECT',
        properties: {
          appName: {
            type: 'STRING',
            description: 'Spoken name of the application to open (e.g., "Spotify", "YouTube Music", "Calculator").',
          },
          packageName: {
            type: 'STRING',
            description: 'Optional exact Android package name if known (e.g., "com.spotify.music").',
          },
        },
      },
    },
    {
      name: 'open_url',
      description:
        'Open a web page in the default browser. Accepts a full URL or bare domain (adds https:// when no scheme is present) and rejects any non-http/https scheme. Does not require confirmation.',
      parameters: {
        type: 'OBJECT',
        properties: {
          url: {
            type: 'STRING',
            description: 'The website URL or bare domain to open (e.g., "https://www.abc.net.au" or "bom.gov.au").',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'web_search',
      description:
        'Open a browser search results page for a search query in the default browser. Does not require confirmation.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: 'The search query to look up in the browser.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_messages',
      description:
        'Read the user SMS inbox via Android READ_SMS permission. Returns sender (resolved to contact name where possible), timestamp, and body. Does not require confirmation.',
      parameters: {
        type: 'OBJECT',
        properties: {
          contact: {
            type: 'STRING',
            description: 'Optional contact name or phone number filter.',
          },
          unreadOnly: {
            type: 'BOOLEAN',
            description: 'Optional filter: set true to only return unread SMS messages.',
          },
          maxResults: {
            type: 'NUMBER',
            description: 'Optional maximum number of messages to return (default 5, max 20).',
          },
        },
      },
    },
    {
      name: 'read_call_log',
      description:
        'Read recent phone calls via Android READ_CALL_LOG permission. Returns contact name or number, call type (missed, incoming, outgoing), timestamp, and durationSeconds. Does not require confirmation.',
      parameters: {
        type: 'OBJECT',
        properties: {
          contact: {
            type: 'STRING',
            description: 'Optional contact name or phone number filter.',
          },
          type: {
            type: 'STRING',
            description: 'Optional call type filter: "missed", "incoming", or "outgoing".',
          },
          maxResults: {
            type: 'NUMBER',
            description: 'Optional maximum number of call log entries to return (default 5, max 20).',
          },
        },
      },
    },
    {
      name: 'get_current_time',
      description:
        'Get the device current date, time, day of week, ISO-8601 timestamp, and timezone so relative times ("tomorrow at 3pm", "in 2 hours") are computed accurately. Does not require confirmation.',
      parameters: {
        type: 'OBJECT',
        properties: {},
      },
    },
    {
      name: 'find_contact',
      description:
        'Search the user phone contacts by name and return matching contact names and phone numbers. Requests READ_CONTACTS permission if needed. Does not require confirmation.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: 'Name or partial name of the contact to search for.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'make_call',
      description:
        'Start a phone call to a contact or phone number. The app will automatically present an on-screen confirmation dialog to the user before placing the call.',
      parameters: {
        type: 'OBJECT',
        properties: {
          phoneNumber: {
            type: 'STRING',
            description: 'Phone number to dial or call.',
          },
          contactName: {
            type: 'STRING',
            description: 'Optional contact name for display.',
          },
        },
        required: ['phoneNumber'],
      },
    },
    {
      name: 'send_text',
      description:
        'Send an SMS text message to a contact or phone number. The app will automatically present an on-screen confirmation dialog to the user before sending.',
      parameters: {
        type: 'OBJECT',
        properties: {
          phoneNumber: {
            type: 'STRING',
            description: 'Recipient phone number.',
          },
          contactName: {
            type: 'STRING',
            description: 'Optional recipient contact name.',
          },
          message: {
            type: 'STRING',
            description: 'The SMS text body to send.',
          },
        },
        required: ['phoneNumber', 'message'],
      },
    },
    {
      name: 'block_number',
      description:
        'Add a phone number to Sierra local call-screening blocklist using Android CallScreeningService (ROLE_CALL_SCREENING). SAFETY REQUIREMENT: You MUST first read back the phone number to block and wait for the user to say "yes" before calling this tool with confirmed=true.',
      parameters: {
        type: 'OBJECT',
        properties: {
          phoneNumber: {
            type: 'STRING',
            description: 'Phone number to block.',
          },
          label: {
            type: 'STRING',
            description: 'Optional label or reason for blocking.',
          },
          confirmed: {
            type: 'BOOLEAN',
            description:
              'Set to true ONLY AFTER you have read back the phone number to block and the user explicitly confirmed ("yes").',
          },
        },
        required: ['phoneNumber'],
      },
    },
    {
      name: 'open_maps',
      description:
        'Open the Google Maps app (or default maps app) for directions or a place search. Needs no permission and no confirmation. Works regardless of the Chat Places toggle.',
      parameters: {
        type: 'OBJECT',
        properties: {
          destination: {
            type: 'STRING',
            description: 'Destination address, business name, or search query.',
          },
          travelMode: {
            type: 'STRING',
            description: 'Optional travel mode: "driving", "walking", or "transit".',
          },
        },
        required: ['destination'],
      },
    },
    {
      name: 'add_calendar_event',
      description:
        'Create an event in the user Android calendar via CalendarContract. SAFETY REQUIREMENT: You MUST first read back the event title and time and wait for the user to say "yes" before calling this tool with confirmed=true.',
      parameters: {
        type: 'OBJECT',
        properties: {
          title: {
            type: 'STRING',
            description: 'Title of the calendar event.',
          },
          startTimeIso: {
            type: 'STRING',
            description: 'Start date/time in ISO-8601 format (e.g. "2026-04-02T14:00:00").',
          },
          endTimeIso: {
            type: 'STRING',
            description: 'Optional end date/time in ISO-8601 format (defaults to 1 hour after start).',
          },
          location: {
            type: 'STRING',
            description: 'Optional event location.',
          },
          description: {
            type: 'STRING',
            description: 'Optional event description or notes.',
          },
          confirmed: {
            type: 'BOOLEAN',
            description:
              'Set to true ONLY AFTER you have read back the event title and time to the user and they explicitly confirmed ("yes").',
          },
        },
        required: ['title', 'startTimeIso'],
      },
    },
    {
      name: 'find_calendar_events',
      description:
        'Look up upcoming events from the user Android calendar via CalendarContract. Requests READ_CALENDAR at runtime. Does not require confirmation.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: 'Optional text filter for event title or description.',
          },
          startTimeIso: {
            type: 'STRING',
            description: 'Optional start range in ISO-8601 format (defaults to now).',
          },
          endTimeIso: {
            type: 'STRING',
            description: 'Optional end range in ISO-8601 format (defaults to 7 days from start).',
          },
          maxResults: {
            type: 'NUMBER',
            description: 'Optional maximum number of events to return (default 10).',
          },
        },
      },
    },
    {
      name: 'set_alarm',
      description:
        'Set an alarm in the phone Clock app via AlarmClock.ACTION_SET_ALARM. SAFETY REQUIREMENT: You MUST first read back the alarm time and label to the user and wait for them to say "yes" before calling this tool with confirmed=true.',
      parameters: {
        type: 'OBJECT',
        properties: {
          hour: {
            type: 'NUMBER',
            description: 'Hour in 24-hour format (0 to 23).',
          },
          minute: {
            type: 'NUMBER',
            description: 'Minute (0 to 59).',
          },
          message: {
            type: 'STRING',
            description: 'Optional alarm label or message.',
          },
          confirmed: {
            type: 'BOOLEAN',
            description:
              'Set to true ONLY AFTER you have read back the alarm time to the user and they explicitly confirmed ("yes").',
          },
        },
        required: ['hour', 'minute'],
      },
    },
    {
      name: 'set_timer',
      description:
        'Start a countdown timer in the phone Clock app via AlarmClock.ACTION_SET_TIMER. No confirmation is required for timers.',
      parameters: {
        type: 'OBJECT',
        properties: {
          durationSeconds: {
            type: 'NUMBER',
            description: 'Timer length in seconds (e.g., 300 for 5 minutes).',
          },
          message: {
            type: 'STRING',
            description: 'Optional timer label.',
          },
        },
        required: ['durationSeconds'],
      },
    },
    {
      name: 'create_reminder',
      description:
        'Create a reminder notification at a requested time by creating a Calendar event with a CalendarContract.Reminders alert (since Android has no universal reminders app). Tell the user honestly that the reminder lives in their calendar. SAFETY REQUIREMENT: Read back the reminder title and time and wait for "yes" before calling with confirmed=true.',
      parameters: {
        type: 'OBJECT',
        properties: {
          title: {
            type: 'STRING',
            description: 'Reminder text/title.',
          },
          remindAtIso: {
            type: 'STRING',
            description: 'Date/time for the reminder in ISO-8601 format.',
          },
          notes: {
            type: 'STRING',
            description: 'Optional notes for the reminder.',
          },
          confirmed: {
            type: 'BOOLEAN',
            description:
              'Set to true ONLY AFTER you have read back the reminder title and time to the user and they explicitly confirmed ("yes").',
          },
        },
        required: ['title', 'remindAtIso'],
      },
    },
    {
      name: 'list_reminders',
      description:
        'List upcoming reminders stored in the user Android Calendar (events with reminder alerts). Requests READ_CALENDAR permission if needed. Does not require confirmation.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: 'Optional text filter for reminder title or notes.',
          },
          includePast: {
            type: 'BOOLEAN',
            description: 'Optional: set true to include reminders from the past 30 days.',
          },
          maxResults: {
            type: 'NUMBER',
            description: 'Optional maximum number of reminders to return (default 10, max 50).',
          },
        },
      },
    },
  ];
}

export function buildDeviceControlSystemPromptSection(): string {
  const cfg = getDeviceCapabilitiesConfig();
  const enabledList = DEVICE_CAPABILITIES.filter((c) => cfg.enabled[c.id]).map((c) => c.id);
  const disabledList = DEVICE_CAPABILITIES.filter((c) => !cfg.enabled[c.id]).map((c) => c.id);

  return `ANDROID DEVICE CONTROL & HONESTY RULES:
- You have Android device control tools: \`open_app\`, \`open_url\`, \`web_search\`, \`read_messages\`, \`read_call_log\`, \`get_current_time\`, \`find_contact\`, \`make_call\`, \`send_text\`, \`block_number\`, \`open_maps\`, \`add_calendar_event\`, \`find_calendar_events\`, \`set_alarm\`, \`set_timer\`, and \`create_reminder\`.
- Currently Enabled Capabilities in Settings: ${enabledList.length > 0 ? enabledList.join(', ') : 'none'}.
${disabledList.length > 0 ? `- Currently Disabled Capabilities in Settings: ${disabledList.join(', ')} (if the user asks for these, tell them plainly that the capability is currently turned off in Settings > Device Control).` : ''}
- Read Messages & Call Log toggle: ${cfg.readMessagesAndCallLogEnabled ? 'ON (permitted when READ_SMS / READ_CALL_LOG are granted)' : 'OFF (user switched off "Let Sierra read my messages and call log" in Settings)'}.
- Direct SMS setting: ${cfg.directSmsEnabled ? 'ON (uses SEND_SMS permission)' : 'OFF (opens the default messaging app with the message pre-filled)'}.
- CHAINING & MULTI-STEP ACTIONS:
  - You MAY chain harmless, non-confirmation tools in a single turn when helpful (for example: calling \`get_current_time\` before scheduling a reminder or calendar event for "tomorrow at 3pm", or calling \`find_contact\` to resolve a name before asking to confirm a call or text, or opening an app / URL).
- SAFETY & CONFIRMATION RULES:
  1. For \`make_call\`, \`send_text\`, \`block_number\`, \`add_calendar_event\`, \`set_alarm\`, and \`create_reminder\`, you MUST read back the exact action, recipient/title, and time/message to the user and wait for the user to say "yes" before calling the tool with \`confirmed: true\`.
  2. \`open_app\`, \`open_url\`, \`web_search\`, \`read_messages\`, \`read_call_log\`, \`get_current_time\`, \`find_contact\`, \`open_maps\`, \`find_calendar_events\`, and \`set_timer\` do NOT need confirmation—call them right away.
  3. For \`create_reminder\`, always tell the user honestly that their reminder is saved in their device Calendar with an alert notification because Android has no universal reminders app.
  4. For \`block_number\`, if Android's Call Screening Role (\`ROLE_CALL_SCREENING\`) is not yet granted, guide the user to grant it in Settings > Device Control.
- STRICT HONESTY & TOOL FAILURE RULES:
  - Every tool returns \`{ ok: boolean, data?: any, error?: string, reason?: string }\`.
  - NEVER claim to have completed an action and NEVER claim to have called, texted, blocked, scheduled, read messages/calls, or opened anything unless the tool returned \`ok: true\` (and \`success: true\`).
  - If a tool fails (\`ok: false\`), state the specific \`reason\` in one plain sentence and offer the next step (for example, granting the missing permission in Settings > Device Control).
  - NEVER say "system error" generically, and NEVER pretend to have a capability that is not in your tool list.`;
}

export interface DeviceToolExecutionResult {
  ok: boolean;
  success: boolean;
  status?: string;
  toolName: DeviceCapabilityId;
  requiresConfirmation?: boolean;
  confirmationPrompt?: string;
  capabilityDisabled?: boolean;
  permissionDenied?: boolean;
  message: string;
  reason?: string;
  data?: Record<string, any>;
  error?: string;
}

export function isDeviceControlToolName(name: string): name is DeviceCapabilityId {
  return DEVICE_CAPABILITIES.some((c) => c.id === name);
}

export const getBlockedNumbersList = getLocalBlockedNumbers;
export const buildDeviceControlPromptSection = buildDeviceControlSystemPromptSection;

export async function executeDeviceControlToolCall(
  toolName: DeviceCapabilityId,
  rawArgs: Record<string, any> = {},
): Promise<DeviceToolExecutionResult> {
  const args = rawArgs || {};
  const resolvedPhoneNumber = String(args.phoneNumber || args.number || '').trim();
  const resolvedContactName = args.contactName || args.recipientName;
  const resolvedMessage = args.message || args.label;
  const resolvedRemindAtIso = String(args.remindAtIso || args.timeIso || '').trim();

  const safeLogArgs = sanitizeToolArgsForLog(args);
  addDebugLog('Tool:DeviceControl:Call', `Invoked ${toolName} with args: ${JSON.stringify(safeLogArgs)}`);
  addDebugLog(`DeviceTool:${toolName}:Call`, `Invoked ${toolName} with args: ${JSON.stringify(safeLogArgs)}`);

  const config = getDeviceCapabilitiesConfig();
  const meta = DEVICE_CAPABILITIES.find((c) => c.id === toolName);

  if (!meta) {
    const msg = `Unknown device control tool "${toolName}".`;
    addDebugLog('Tool:DeviceControl:Error', msg);
    return {
      ok: false,
      success: false,
      toolName,
      message: msg,
      reason: msg,
      error: msg,
    };
  }

  // Check "Let Sierra read my messages and call log" master toggle
  if ((toolName === 'read_messages' || toolName === 'read_call_log') && !config.readMessagesAndCallLogEnabled) {
    const msg =
      'Reading messages and call log is currently turned off via the "Let Sierra read my messages and call log" toggle in Settings > Device Control.';
    addDebugLog('Tool:DeviceControl:Disabled', msg);
    addDebugLog(`DeviceTool:${toolName}:Disabled`, msg);
    return {
      ok: false,
      success: false,
      toolName,
      capabilityDisabled: true,
      message: msg,
      reason: msg,
      error: msg,
    };
  }

  // 1. Check per-capability enable toggle
  if (!config.enabled[toolName]) {
    const msg = `The "${meta.label}" (${toolName}) capability is currently disabled in Settings > Device Control. Please enable it in Settings before I can perform this action.`;
    addDebugLog('Tool:DeviceControl:Disabled', msg);
    addDebugLog(`DeviceTool:${toolName}:Disabled`, msg);
    return {
      ok: false,
      success: false,
      toolName,
      capabilityDisabled: true,
      message: msg,
      reason: msg,
      error: msg,
    };
  }

  // 2. Confirmation gate:
  // HARD RULE 1: For make_call and send_text, confirmations MUST come from the user through the app-owned
  // confirm dialog. The model can NEVER set confirmed:true itself.
  if (toolName === 'make_call' || toolName === 'send_text') {
    // Strip any model-supplied confirmed flag
    delete (args as Record<string, any>).confirmed;

    if (!resolvedPhoneNumber) {
      const msg = `Phone number is required for ${toolName}.`;
      return { ok: false, success: false, status: 'invalid_args', toolName, message: msg, reason: msg, error: msg };
    }
    if (toolName === 'send_text' && !String(args.message ?? '').trim()) {
      const msg = 'Message body is required for send_text.';
      return { ok: false, success: false, status: 'invalid_args', toolName, message: msg, reason: msg, error: msg };
    }

    const decision = await requestAppUserConfirmation(
      toolName === 'make_call'
        ? {
            toolName: 'make_call',
            title: 'Confirm Phone Call',
            summary: `Allow Sierra to place a call to ${
              resolvedContactName ? `${resolvedContactName} (${resolvedPhoneNumber})` : resolvedPhoneNumber
            }?`,
            details: {
              Recipient: resolvedContactName ? String(resolvedContactName) : 'Phone Number',
              Number: resolvedPhoneNumber,
            },
          }
        : {
            toolName: 'send_text',
            title: 'Confirm Send Text Message',
            summary: `Allow Sierra to send this SMS to ${
              resolvedContactName ? `${resolvedContactName} (${resolvedPhoneNumber})` : resolvedPhoneNumber
            }?`,
            details: {
              Recipient: resolvedContactName ? `${resolvedContactName} (${resolvedPhoneNumber})` : resolvedPhoneNumber,
              Message: String(args.message || ''),
              Mode: config.directSmsEnabled ? 'Direct SMS (SEND_SMS)' : 'Default Messaging App',
            },
          },
    );

    if (!decision.approved || !consumeUserApprovalToken(decision.userApprovalToken)) {
      const cancelMsg = `User declined ${toolName} in the app confirmation dialog.`;
      addDebugLog('Tool:DeviceControl:ConfirmGate', cancelMsg);
      addDebugLog(`DeviceTool:${toolName}:NeedsConfirmation`, cancelMsg);
      return {
        ok: false,
        success: false,
        status: 'user_cancelled',
        toolName,
        requiresConfirmation: true,
        confirmationPrompt: cancelMsg,
        message: cancelMsg,
        reason: cancelMsg,
        error: cancelMsg,
      };
    }
  } else if (meta.requiresConfirmation && args.confirmed !== true) {
    let details = '';
    if (toolName === 'block_number') {
      details = `block phone number ${resolvedPhoneNumber}${args.label ? ` (${args.label})` : ''}`;
    } else if (toolName === 'add_calendar_event') {
      details = `create calendar event "${args.title}" at ${args.startTimeIso}`;
    } else if (toolName === 'set_alarm') {
      const hh = String(args.hour ?? 0).padStart(2, '0');
      const mm = String(args.minute ?? 0).padStart(2, '0');
      details = `set an alarm for ${hh}:${mm}${resolvedMessage ? ` ("${resolvedMessage}")` : ''}`;
    } else if (toolName === 'create_reminder') {
      details = `create a calendar reminder "${args.title}" for ${resolvedRemindAtIso}`;
    }

    const promptMsg = `CONFIRMATION REQUIRED: Do NOT claim the action is done yet. Read back to the user: "${details}" and ask them to confirm with "yes". Once they say yes, call ${toolName} again with confirmed: true.`;
    addDebugLog('Tool:DeviceControl:ConfirmGate', `${toolName} awaiting user confirmation (${details})`);
    addDebugLog(`DeviceTool:${toolName}:NeedsConfirmation`, promptMsg);
    return {
      ok: false,
      success: false,
      toolName,
      requiresConfirmation: true,
      confirmationPrompt: promptMsg,
      message: promptMsg,
      reason: promptMsg,
    };
  }

  // Validate open_url scheme before invoking native or web fallback
  if (toolName === 'open_url') {
    const urlCheck = normalizeAndValidateOpenUrl(args.url);
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      const reason = urlCheck.reason || 'Invalid URL provided to open_url.';
      addDebugLog('Tool:DeviceControl:Error', `open_url rejected: ${reason}`);
      addDebugLog(`DeviceTool:${toolName}:Result`, `ok=false reason="${reason}"`);
      return {
        ok: false,
        success: false,
        toolName,
        message: reason,
        reason,
        error: reason,
      };
    }
    args.url = urlCheck.normalizedUrl;
  }

  // get_current_time can always succeed using device/JS clock if native plugin isn't overriding it
  if (toolName === 'get_current_time' && !isAndroidNativeAvailable()) {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[now.getDay()];
    const iso = now.toISOString();
    const date = iso.slice(0, 10);
    const time = now.toTimeString().slice(0, 8);
    const data = {
      timestampMs: now.getTime(),
      iso,
      date,
      time,
      dayOfWeek,
      timezone: tz,
      timezoneOffsetMinutes: -now.getTimezoneOffset(),
    };
    const okMsg = `Current device time is ${dayOfWeek}, ${date} ${time} (${tz}).`;
    addDebugLog('Tool:DeviceControl:Result', okMsg);
    addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
    return {
      ok: true,
      success: true,
      toolName,
      message: okMsg,
      data,
    };
  }

  // 3. Check Android native availability
  if (!isAndroidNativeAvailable()) {
    if (toolName === 'block_number') {
      const updated = addLocalBlockedNumber(resolvedPhoneNumber);
      const msg = `Added ${resolvedPhoneNumber} to the local in-app blocked numbers list (${updated.length} blocked), but Android CallScreeningService (ROLE_CALL_SCREENING) is unavailable because the app is not running on a native Android device.`;
      addDebugLog('Tool:DeviceControl:Result', msg);
      addDebugLog(`DeviceTool:${toolName}:Result`, msg);
      return {
        ok: false,
        success: false,
        toolName,
        message: msg,
        reason: msg,
        error: msg,
        data: { blockedList: updated, roleGranted: false, roleHeld: false },
      };
    }

    const msg = `Cannot execute ${toolName} because Android native device control is only available on an Android phone.`;
    addDebugLog('Tool:DeviceControl:Unavailable', msg);
    return {
      ok: false,
      success: false,
      toolName,
      message: msg,
      reason: msg,
      error: msg,
    };
  }

  const plugin = getPlugin();

  try {
    switch (toolName) {
      case 'open_app': {
        if (!plugin.openApp) throw new Error('Native openApp not available');
        const res = await plugin.openApp({
          appName: args.appName ? String(args.appName) : undefined,
          packageName: args.packageName ? String(args.packageName) : undefined,
        });
        if (res.needsClarification && res.matches && res.matches.length > 0) {
          const listStr = res.matches.map((m) => `${m.label} (${m.packageName})`).join(', ');
          const msg = `Multiple installed apps matched "${args.appName || args.packageName}": ${listStr}. Please ask the user which one they want to open.`;
          addDebugLog('Tool:DeviceControl:Clarify', msg);
          addDebugLog(`DeviceTool:${toolName}:Result`, msg);
          return {
            ok: false,
            success: false,
            toolName,
            message: msg,
            reason: msg,
            data: { needsClarification: true, matches: res.matches },
          };
        }
        if (!res.success) {
          const errMsg = res.reason || res.error || `No installed app found matching "${args.appName || args.packageName}".`;
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          addDebugLog(`DeviceTool:${toolName}:Result`, `ok=false reason="${errMsg}"`);
          return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
        }
        const okMsg = `Launched ${res.launchedLabel || res.launched?.label || args.appName || res.launchedPackage} (${res.launchedPackage || res.launched?.packageName}).`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: res,
        };
      }

      case 'open_url': {
        const normalizedUrl = String(args.url);
        if (!plugin.openUrl) throw new Error('Native openUrl not available');
        const res = await plugin.openUrl({ url: normalizedUrl });
        if (!res.success) {
          const errMsg = res.reason || res.error || `Could not open URL "${normalizedUrl}" in browser.`;
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          addDebugLog(`DeviceTool:${toolName}:Result`, `ok=false reason="${errMsg}"`);
          return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
        }
        const okMsg = res.message || `Opened ${normalizedUrl} in your default browser.`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { ...res, url: res.url || normalizedUrl },
        };
      }

      case 'web_search': {
        const query = String(args.query || '').trim();
        if (!query) {
          const errMsg = 'Search query cannot be empty.';
          return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
        }
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        if (plugin.webSearch) {
          const res = await plugin.webSearch({ query, url: searchUrl });
          if (!res.success) {
            const errMsg = res.reason || res.error || `Could not open web search for "${query}".`;
            addDebugLog('Tool:DeviceControl:Error', errMsg);
            return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
          }
          const okMsg = res.message || `Opened browser search results for "${query}".`;
          addDebugLog('Tool:DeviceControl:Result', okMsg);
          addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
          return {
            ok: true,
            success: true,
            toolName,
            message: okMsg,
            data: { ...res, query, url: res.url || searchUrl },
          };
        }
        if (plugin.openUrl) {
          const res = await plugin.openUrl({ url: searchUrl });
          if (!res.success) {
            const errMsg = res.reason || res.error || `Could not open browser search for "${query}".`;
            return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
          }
          const okMsg = `Opened browser search results for "${query}".`;
          addDebugLog('Tool:DeviceControl:Result', okMsg);
          addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
          return {
            ok: true,
            success: true,
            toolName,
            message: okMsg,
            data: { query, url: searchUrl },
          };
        }
        throw new Error('Native webSearch not available');
      }

      case 'read_messages': {
        if (!plugin.readMessages) throw new Error('Native readMessages not available');
        const clampedMax = clampReadMaxResults(args.maxResults, 5, 20);
        const unreadOnly = Boolean(args.unreadOnly);
        const contact = args.contact ? String(args.contact).trim() : undefined;
        const res = await plugin.readMessages({
          contact,
          unreadOnly,
          maxResults: clampedMax,
        });
        if (!res.success) {
          const isPerm = Boolean(res.permissionDenied) || /permission/i.test(res.reason || res.error || '');
          const errMsg =
            res.reason ||
            res.error ||
            (isPerm ? 'needs permission: READ_SMS' : 'Failed to read SMS messages.');
          const normalizedReason = isPerm && !/needs permission/i.test(errMsg) ? `needs permission: ${errMsg}` : errMsg;
          addDebugLog('Tool:DeviceControl:Error', normalizedReason);
          addDebugLog(`DeviceTool:${toolName}:Result`, `ok=false reason="${normalizedReason}"`);
          return {
            ok: false,
            success: false,
            status: isPerm ? 'needs_permission' : 'error',
            toolName,
            permissionDenied: isPerm,
            message: normalizedReason,
            reason: normalizedReason,
            error: normalizedReason,
          };
        }
        const messages = res.messages || [];
        const okMsg =
          messages.length > 0
            ? `Read ${messages.length} SMS message(s) from inbox.`
            : 'No matching SMS messages found in your inbox.';
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { messages, count: messages.length },
        };
      }

      case 'read_call_log': {
        if (!plugin.readCallLog) throw new Error('Native readCallLog not available');
        const clampedMax = clampReadMaxResults(args.maxResults, 5, 20);
        const contact = args.contact ? String(args.contact).trim() : undefined;
        const rawType = args.type ? String(args.type).trim().toLowerCase() : undefined;
        const normalizedType =
          rawType === 'missed' || rawType === 'incoming' || rawType === 'outgoing' ? rawType : undefined;
        const res = await plugin.readCallLog({
          contact,
          type: normalizedType,
          maxResults: clampedMax,
        });
        if (!res.success) {
          const isPerm = Boolean(res.permissionDenied) || /permission/i.test(res.reason || res.error || '');
          const errMsg =
            res.reason ||
            res.error ||
            (isPerm ? 'needs permission: READ_CALL_LOG' : 'Failed to read call log.');
          const normalizedReason = isPerm && !/needs permission/i.test(errMsg) ? `needs permission: ${errMsg}` : errMsg;
          addDebugLog('Tool:DeviceControl:Error', normalizedReason);
          addDebugLog(`DeviceTool:${toolName}:Result`, `ok=false reason="${normalizedReason}"`);
          return {
            ok: false,
            success: false,
            status: isPerm ? 'needs_permission' : 'error',
            toolName,
            permissionDenied: isPerm,
            message: normalizedReason,
            reason: normalizedReason,
            error: normalizedReason,
          };
        }
        const calls = res.calls || [];
        const okMsg =
          calls.length > 0
            ? `Read ${calls.length} call log entry/entries.`
            : 'No matching call log entries found.';
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { calls, count: calls.length },
        };
      }

      case 'get_current_time': {
        if (plugin.getCurrentTime) {
          const res = await plugin.getCurrentTime();
          if (res.success) {
            const okMsg =
              res.message ||
              `Current device time is ${res.dayOfWeek || ''}, ${res.date || ''} ${res.time || ''} (${res.timezone || 'local'}).`;
            addDebugLog('Tool:DeviceControl:Result', okMsg);
            addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
            return {
              ok: true,
              success: true,
              toolName,
              message: okMsg,
              data: res,
            };
          }
        }
        const now = new Date();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayOfWeek = days[now.getDay()];
        const iso = now.toISOString();
        const date = iso.slice(0, 10);
        const time = now.toTimeString().slice(0, 8);
        const data = {
          timestampMs: now.getTime(),
          iso,
          date,
          time,
          dayOfWeek,
          timezone: tz,
          timezoneOffsetMinutes: -now.getTimezoneOffset(),
        };
        const okMsg = `Current device time is ${dayOfWeek}, ${date} ${time} (${tz}).`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data,
        };
      }

      case 'find_contact': {
        if (!plugin.findContact) throw new Error('Native findContact not available');
        const res = await plugin.findContact({ query: String(args.query || '') });
        if (!res.success) {
          const isPerm = Boolean(res.permissionDenied) || /permission/i.test(res.reason || res.error || '');
          const errMsg =
            res.reason ||
            res.error ||
            (isPerm
              ? 'needs permission: READ_CONTACTS'
              : `Failed to search contacts for "${args.query}".`);
          const normalizedReason = isPerm && !/needs permission/i.test(errMsg) ? `needs permission: ${errMsg}` : errMsg;
          addDebugLog('Tool:DeviceControl:Error', normalizedReason);
          return {
            ok: false,
            success: false,
            status: isPerm ? 'needs_permission' : 'error',
            toolName,
            permissionDenied: isPerm,
            message: normalizedReason,
            reason: normalizedReason,
            error: normalizedReason,
          };
        }
        const contacts = res.contacts || [];
        const okMsg =
          contacts.length > 0
            ? `Found ${contacts.length} contact(s) matching "${args.query}": ${contacts
                .map((c) => `${c.name} (${c.number})`)
                .join(', ')}.`
            : `No contacts found matching "${args.query}".`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { contacts },
        };
      }

      case 'make_call': {
        if (!plugin.makeCall) throw new Error('Native makeCall not available');
        const res = await plugin.makeCall({
          phoneNumber: resolvedPhoneNumber,
          number: resolvedPhoneNumber,
          contactName: resolvedContactName ? String(resolvedContactName) : undefined,
        });
        if (!res.success) {
          const errMsg = res.reason || res.error || `Failed to place call to ${resolvedPhoneNumber}.`;
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
        }
        const okMsg = res.fallbackToDialer
          ? `CALL_PHONE permission was not granted, so opened the phone dialer (ACTION_DIAL) with ${resolvedPhoneNumber} pre-filled.`
          : `Started phone call (ACTION_CALL) to ${resolvedContactName ? `${resolvedContactName} (${resolvedPhoneNumber})` : resolvedPhoneNumber}.`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: res,
        };
      }

      case 'send_text': {
        if (!plugin.sendText) throw new Error('Native sendText not available');
        const useDirect = Boolean(config.directSmsEnabled);
        const res = await plugin.sendText({
          phoneNumber: resolvedPhoneNumber,
          number: resolvedPhoneNumber,
          message: String(args.message || ''),
          directSend: useDirect,
        });
        if (!res.success) {
          const isPerm = Boolean(res.permissionDenied) || /permission/i.test(res.reason || res.error || '');
          const errMsg =
            res.reason ||
            res.error ||
            (isPerm
              ? 'needs permission: SEND_SMS'
              : `Failed to send text to ${resolvedPhoneNumber}.`);
          const normalizedReason = isPerm && !/needs permission/i.test(errMsg) ? `needs permission: ${errMsg}` : errMsg;
          addDebugLog('Tool:DeviceControl:Error', normalizedReason);
          return {
            ok: false,
            success: false,
            status: isPerm ? 'needs_permission' : 'error',
            toolName,
            permissionDenied: isPerm,
            message: normalizedReason,
            reason: normalizedReason,
            error: normalizedReason,
          };
        }
        const modeUsed = res.mode || (res.method === 'DIRECT_SMS' || useDirect ? 'DIRECT_SMS' : 'INTENT_PREFILLED');
        const okMsg =
          modeUsed === 'DIRECT_SMS'
            ? `Sent SMS directly to ${resolvedContactName ? `${resolvedContactName} (${resolvedPhoneNumber})` : resolvedPhoneNumber}.`
            : `Opened your default messaging app (ACTION_SENDTO) addressed to ${
                resolvedContactName ? `${resolvedContactName} (${resolvedPhoneNumber})` : resolvedPhoneNumber
              } with the message pre-filled.`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { ...res, mode: modeUsed },
        };
      }

      case 'block_number': {
        if (!plugin.blockNumber) throw new Error('Native blockNumber not available');
        const blockedList = addLocalBlockedNumber(resolvedPhoneNumber);
        const res = await plugin.blockNumber({
          phoneNumber: resolvedPhoneNumber,
          number: resolvedPhoneNumber,
          label: args.label ? String(args.label) : undefined,
        });
        if (!res.success) {
          const errMsg = res.reason || res.error || `Failed to block number ${resolvedPhoneNumber}.`;
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
        }
        const roleGranted = Boolean(res.roleGranted ?? res.roleHeld);
        const okMsg = roleGranted
          ? `Added ${resolvedPhoneNumber} to the call-screening blocklist. Incoming calls from this number will be automatically rejected.`
          : `Saved ${resolvedPhoneNumber} to your local blocklist, but Sierra does not yet have Android's Call Screening role (ROLE_CALL_SCREENING). ${
              res.roleGuideMessage ||
              'Please tap "Grant Call Screening Role" in Settings > Device Control (or accept the system prompt) so Android allows Sierra to reject calls from blocked numbers.'
            }`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { ...res, roleGranted, roleHeld: roleGranted, blockedList },
        };
      }

      case 'open_maps': {
        if (!plugin.openMaps) throw new Error('Native openMaps not available');
        const res = await plugin.openMaps({
          destination: String(args.destination || ''),
          travelMode: args.travelMode ? String(args.travelMode) : undefined,
        });
        if (!res.success) {
          const errMsg = res.reason || res.error || `Failed to open Maps for "${args.destination}".`;
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
        }
        const okMsg = `Opened Maps for "${args.destination}"${args.travelMode ? ` (${args.travelMode})` : ''}.`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: res,
        };
      }

      case 'add_calendar_event': {
        if (!plugin.addCalendarEvent) throw new Error('Native addCalendarEvent not available');
        const res = await plugin.addCalendarEvent({
          title: String(args.title || ''),
          startTimeIso: String(args.startTimeIso || ''),
          endTimeIso: args.endTimeIso ? String(args.endTimeIso) : undefined,
          description: args.description ? String(args.description) : undefined,
          location: args.location ? String(args.location) : undefined,
        });
        if (!res.success) {
          const errMsg =
            res.reason ||
            res.error ||
            (res.permissionDenied
              ? 'READ_CALENDAR / WRITE_CALENDAR permission not granted'
              : `Failed to create calendar event "${args.title}".`);
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          return {
            ok: false,
            success: false,
            toolName,
            permissionDenied: Boolean(res.permissionDenied),
            message: errMsg,
            reason: errMsg,
            error: errMsg,
          };
        }
        const okMsg = `Created calendar event "${args.title}" starting at ${args.startTimeIso} (eventId=${res.eventId}).`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: res,
        };
      }

      case 'find_calendar_events': {
        if (!plugin.findCalendarEvents) throw new Error('Native findCalendarEvents not available');
        const res = await plugin.findCalendarEvents({
          query: args.query ? String(args.query) : undefined,
          startTimeIso: args.startTimeIso ? String(args.startTimeIso) : undefined,
          endTimeIso: args.endTimeIso ? String(args.endTimeIso) : undefined,
          maxResults: typeof args.maxResults === 'number' ? args.maxResults : 10,
        });
        if (!res.success) {
          const errMsg =
            res.reason ||
            res.error ||
            (res.permissionDenied
              ? 'READ_CALENDAR permission not granted'
              : 'Failed to look up upcoming calendar events.');
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          return {
            ok: false,
            success: false,
            toolName,
            permissionDenied: Boolean(res.permissionDenied),
            message: errMsg,
            reason: errMsg,
            error: errMsg,
          };
        }
        const events = res.events || [];
        const okMsg =
          events.length > 0
            ? `Found ${events.length} upcoming calendar event(s): ${events
                .map((e) => `"${e.title}" at ${e.startTimeIso}`)
                .join('; ')}.`
            : 'No matching upcoming calendar events found.';
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { events },
        };
      }

      case 'set_alarm': {
        if (!plugin.setAlarm) throw new Error('Native setAlarm not available');
        const hour = Number(args.hour ?? 0);
        const minute = Number(args.minute ?? 0);
        const res = await plugin.setAlarm({
          hour,
          minute,
          message: resolvedMessage ? String(resolvedMessage) : undefined,
        });
        if (!res.success) {
          const errMsg = res.reason || res.error || `Failed to set alarm for ${hour}:${String(minute).padStart(2, '0')}.`;
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
        }
        const hh = String(hour).padStart(2, '0');
        const mm = String(minute).padStart(2, '0');
        const okMsg = `Set alarm in Clock app for ${hh}:${mm}${resolvedMessage ? ` ("${resolvedMessage}")` : ''}.`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: res,
        };
      }

      case 'set_timer': {
        if (!plugin.setTimer) throw new Error('Native setTimer not available');
        const durationSeconds = Number(args.durationSeconds ?? 0);
        const res = await plugin.setTimer({
          durationSeconds,
          message: resolvedMessage ? String(resolvedMessage) : undefined,
        });
        if (!res.success) {
          const errMsg = res.reason || res.error || `Failed to start timer for ${durationSeconds} seconds.`;
          addDebugLog('Tool:DeviceControl:Error', errMsg);
          return { ok: false, success: false, toolName, message: errMsg, reason: errMsg, error: errMsg };
        }
        const okMsg = `Started a timer in the Clock app for ${durationSeconds} seconds${
          resolvedMessage ? ` ("${resolvedMessage}")` : ''
        }.`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: res,
        };
      }

      case 'create_reminder': {
        if (!plugin.createReminder) throw new Error('Native createReminder not available');
        const res = await plugin.createReminder({
          title: String(args.title || ''),
          remindAtIso: resolvedRemindAtIso,
          notes: args.notes ? String(args.notes) : undefined,
          minutesBeforeAlert: typeof args.minutesBeforeAlert === 'number' ? args.minutesBeforeAlert : 0,
        });
        if (!res.success) {
          const isPerm = Boolean(res.permissionDenied) || /permission/i.test(res.reason || res.error || '');
          const errMsg =
            res.reason ||
            res.error ||
            (isPerm
              ? 'needs permission: READ_CALENDAR / WRITE_CALENDAR'
              : `Failed to create calendar reminder "${args.title}".`);
          const normalizedReason = isPerm && !/needs permission/i.test(errMsg) ? `needs permission: ${errMsg}` : errMsg;
          addDebugLog('Tool:DeviceControl:Error', normalizedReason);
          return {
            ok: false,
            success: false,
            status: isPerm ? 'needs_permission' : 'error',
            toolName,
            permissionDenied: isPerm,
            message: normalizedReason,
            reason: normalizedReason,
            error: normalizedReason,
          };
        }
        const okMsg = `Created reminder "${args.title}" for ${resolvedRemindAtIso} as a Calendar event with a reminder notification in your phone's Calendar app (since Android has no universal reminders app).`;
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { ...res, storedInCalendar: true },
        };
      }

      case 'list_reminders': {
        if (!plugin.listReminders) throw new Error('Native listReminders not available');
        const clampedMax = clampReadMaxResults(args.maxResults, 10, 50);
        const res = await plugin.listReminders({
          query: args.query ? String(args.query) : undefined,
          includePast: Boolean(args.includePast),
          maxResults: clampedMax,
        });
        if (!res.success) {
          const isPerm = Boolean(res.permissionDenied) || /permission/i.test(res.reason || res.error || '');
          const errMsg =
            res.reason ||
            res.error ||
            (isPerm ? 'needs permission: READ_CALENDAR' : 'Failed to list reminders.');
          const normalizedReason = isPerm && !/needs permission/i.test(errMsg) ? `needs permission: ${errMsg}` : errMsg;
          addDebugLog('Tool:DeviceControl:Error', normalizedReason);
          addDebugLog(`DeviceTool:${toolName}:Result`, `ok=false reason="${normalizedReason}"`);
          return {
            ok: false,
            success: false,
            status: isPerm ? 'needs_permission' : 'error',
            toolName,
            permissionDenied: isPerm,
            message: normalizedReason,
            reason: normalizedReason,
            error: normalizedReason,
          };
        }
        const reminders = res.reminders || [];
        const okMsg =
          reminders.length > 0
            ? `Found ${reminders.length} reminder(s): ${reminders
                .map((r) => `"${r.title}" at ${r.remindAtIso}`)
                .join('; ')}.`
            : 'No upcoming reminders found in your Calendar.';
        addDebugLog('Tool:DeviceControl:Result', okMsg);
        addDebugLog(`DeviceTool:${toolName}:Result`, okMsg);
        return {
          ok: true,
          success: true,
          toolName,
          message: okMsg,
          data: { reminders, count: reminders.length },
        };
      }
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    addDebugLog('Tool:DeviceControl:Exception', `${toolName} threw exception: ${errMsg}`);
    return {
      ok: false,
      success: false,
      toolName,
      message: errMsg,
      reason: errMsg,
      error: errMsg,
    };
  }
}

export const executeDeviceControlTool = executeDeviceControlToolCall;
