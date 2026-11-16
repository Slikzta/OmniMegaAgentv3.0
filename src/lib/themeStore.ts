import { useEffect, useState } from 'react';
import {
  getActiveIdentity,
  setActiveIdentity,
  type CompanionIdentity,
} from './persona';
import { triggerHaptic } from './haptics';

export const DEFAULT_SCI_FI_ACCENT = '#00E5FF';
export const SCI_FI_CHROME = '#C8CDD3';
export const SCI_FI_BG = '#0A0E14';

export const STORAGE_KEY_ASSISTANT_ACCENTS = 'sierra_assistant_accents_v1';

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

export const ASSISTANT_ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'cyan', label: 'Electric Cyan', hex: '#00E5FF' },
  { id: 'azure', label: 'Ion Blue', hex: '#38BDF8' },
  { id: 'violet', label: 'Hyper Violet', hex: '#A855F7' },
  { id: 'emerald', label: 'Quantum Mint', hex: '#10B981' },
  { id: 'rose', label: 'Plasma Rose', hex: '#FB7185' },
  { id: 'amber', label: 'Solar Amber', hex: '#F59E0B' },
] as const;

export interface AssistantAccentsMap {
  sierra: string;
  tyler: string;
}

const DEFAULT_ACCENTS: AssistantAccentsMap = {
  sierra: DEFAULT_SCI_FI_ACCENT,
  tyler: DEFAULT_SCI_FI_ACCENT,
};

function normalizeHexColor(value: string | undefined | null): string {
  if (!value) return DEFAULT_SCI_FI_ACCENT;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return DEFAULT_SCI_FI_ACCENT;
}

export function hexToRgbTuple(hex: string): string {
  const norm = normalizeHexColor(hex).slice(1);
  const r = parseInt(norm.slice(0, 2), 16);
  const g = parseInt(norm.slice(2, 4), 16);
  const b = parseInt(norm.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export function getAssistantAccents(): AssistantAccentsMap {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_ACCENTS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ASSISTANT_ACCENTS);
    if (!raw) return { ...DEFAULT_ACCENTS };
    const parsed = JSON.parse(raw);
    return {
      sierra: normalizeHexColor(parsed?.sierra),
      tyler: normalizeHexColor(parsed?.tyler),
    };
  } catch {
    return { ...DEFAULT_ACCENTS };
  }
}

export function getAccentColorForIdentity(identity: CompanionIdentity): string {
  const map = getAssistantAccents();
  return identity === 'tyler' ? map.tyler : map.sierra;
}

export function applyThemeAccentCssVars(identity: CompanionIdentity = getActiveIdentity()): string {
  const accent = getAccentColorForIdentity(identity);
  const rgb = hexToRgbTuple(accent);
  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    root.style.setProperty('--sci-accent', accent);
    root.style.setProperty('--sci-accent-rgb', rgb);
    root.style.setProperty('--primary', accent);
    root.style.setProperty('--ring', accent);
  }
  return accent;
}

export function setAccentColorForIdentity(identity: CompanionIdentity, hex: string): AssistantAccentsMap {
  const current = getAssistantAccents();
  const next: AssistantAccentsMap = {
    ...current,
    [identity]: normalizeHexColor(hex),
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_ASSISTANT_ACCENTS, JSON.stringify(next));
  }
  applyThemeAccentCssVars(getActiveIdentity());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sierra-theme-changed', { detail: next }));
  }
  return next;
}

export function resetAssistantAccents(): AssistantAccentsMap {
  const next: AssistantAccentsMap = { ...DEFAULT_ACCENTS };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_ASSISTANT_ACCENTS, JSON.stringify(next));
  }
  applyThemeAccentCssVars(getActiveIdentity());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sierra-theme-changed', { detail: next }));
  }
  return next;
}

export function switchActiveAssistantIdentity(identity: CompanionIdentity): void {
  const current = getActiveIdentity();
  setActiveIdentity(identity);
  if (current !== identity) {
    triggerHaptic('switch');
  }
  applyThemeAccentCssVars(identity);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sierra-identity-changed', { detail: identity }));
  }
}

export function notifyIdentityChanged(identity: CompanionIdentity = getActiveIdentity()): void {
  applyThemeAccentCssVars(identity);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sierra-identity-changed', { detail: identity }));
  }
}

export function useActiveIdentityAccent(): {
  identity: CompanionIdentity;
  accentHex: string;
  accentRgb: string;
  accents: AssistantAccentsMap;
  switchIdentity: (next: CompanionIdentity) => void;
} {
  const [identity, setIdentityState] = useState<CompanionIdentity>(() => getActiveIdentity());
  const [accents, setAccents] = useState<AssistantAccentsMap>(() => getAssistantAccents());

  useEffect(() => {
    const sync = () => {
      const nextId = getActiveIdentity();
      setIdentityState(nextId);
      setAccents(getAssistantAccents());
      applyThemeAccentCssVars(nextId);
    };

    sync();

    if (typeof window === 'undefined') return;
    window.addEventListener('sierra-identity-changed', sync);
    window.addEventListener('sierra-theme-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('sierra-identity-changed', sync);
      window.removeEventListener('sierra-theme-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const accentHex = identity === 'tyler' ? accents.tyler : accents.sierra;
  const accentRgb = hexToRgbTuple(accentHex);

  return {
    identity,
    accentHex,
    accentRgb,
    accents,
    switchIdentity: switchActiveAssistantIdentity,
  };
}
