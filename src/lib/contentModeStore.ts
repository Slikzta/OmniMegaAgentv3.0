import { useSyncExternalStore } from 'react';
import { ContentMode } from './persona';
import {
  getUnifiedSettings,
  updateUnifiedSettings,
  subscribeUnifiedSettings,
} from './settingsStore';

/**
 * Gets the current active content mode ('sfw' | 'mature') from the unified settings store.
 */
export function getContentMode(): ContentMode {
  return getUnifiedSettings().contentMode;
}

/**
 * Updates the shared content mode inside the single unified settings store.
 */
export function setContentMode(mode: ContentMode) {
  const current = getUnifiedSettings().contentMode;
  if (current === mode) return;
  updateUnifiedSettings((draft) => {
    draft.contentMode = mode === 'mature' ? 'mature' : 'sfw';
    return draft;
  });
}

/**
 * Subscribes to content mode updates via the unified settings store.
 */
export function subscribeContentMode(listener: () => void): () => void {
  return subscribeUnifiedSettings(listener);
}

/**
 * React hook for shared, synchronized content mode across all screens.
 */
export function useContentMode(): [ContentMode, (mode: ContentMode) => void] {
  const mode: ContentMode = useSyncExternalStore(
    subscribeUnifiedSettings,
    getContentMode,
    () => 'sfw' as ContentMode
  );
  return [mode, setContentMode];
}
