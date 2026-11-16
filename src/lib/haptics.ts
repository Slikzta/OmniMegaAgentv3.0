/**
 * Lightweight haptic feedback utility for key interactions:
 * starting Live voice, sending a chat message, switching between Sierra and Tyler.
 */
export type HapticStyle = 'light' | 'medium' | 'switch';

export function triggerHaptic(style: HapticStyle = 'light'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    switch (style) {
      case 'switch':
        navigator.vibrate([14, 22, 18]);
        break;
      case 'medium':
        navigator.vibrate(22);
        break;
      case 'light':
      default:
        navigator.vibrate(12);
        break;
    }
  } catch {
    // Ignore unsupported platform/permission errors
  }
}
