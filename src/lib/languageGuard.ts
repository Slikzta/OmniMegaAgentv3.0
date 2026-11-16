import { addDebugLog } from './debugLogStore';

export const STORAGE_KEY_SUMMARIES_DRIFT_CLEANED = 'sierra_summaries_drift_cleaned_v1';
export const STORAGE_KEY_SUMMARIES_REMOVED_BACKUP = 'sierra_conversation_summaries_removed_backup';

export interface LanguageDetectionResult {
  isMismatch: boolean;
  detectedLanguage?: string;
  reason?: string;
}

export interface GarbleOrForeignResult {
  isGarbledOrForeign: boolean;
  reason?: string;
  detectedLanguage?: string;
}

// Common distinctive Spanish indicators (inflectional/function words that rarely or never appear in English)
const SPANISH_INDICATOR_WORDS = new Set([
  'qué', 'que', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'por', 'para', 'con', 'como', 'cómo', 'pero', 'este', 'esta', 'esto',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'taladro', 'cono', 'usted', 'ustedes',
  'nosotros', 'hola', 'adiós', 'gracias', 'bueno', 'estoy', 'está', 'están',
  'hacer', 'hablar', 'entender', 'decir', 'donde', 'dónde', 'cuando', 'cuándo',
  'porqué', 'porque', 'todos', 'todas', 'bien', 'nada', 'algo', 'mucho', 'muchos',
  'más', 'del', 'al', 'es', 'son', 'fue', 'era', 'tengo', 'tiene', 'tienen',
  'saber', 'quiero', 'puedo', 'puede', 'pueden', 'amigo', 'tiempo', 'ahora'
]);

// Distinctive English stopwords that do not exist in Spanish/French/etc.
const ENGLISH_INDICATOR_WORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'what', 'where', 'when', 'which',
  'with', 'have', 'having', 'about', 'would', 'could', 'should', 'their',
  'there', 'they', 'them', 'from', 'been', 'were', 'will', 'just', 'your',
  'because', 'really', 'doing', 'going', 'think', 'thought'
]);

// French distinctive words
const FRENCH_INDICATOR_WORDS = new Set([
  'le', 'la', 'les', 'du', 'des', 'un', 'une', 'est', 'sont', 'pour',
  'avec', 'dans', 'que', 'qui', 'ce', 'cette', 'ces', 'bonjour', 'merci',
  'mais', 'nous', 'vous', 'ils', 'elles', 'faire', 'tout', 'tous'
]);

// German distinctive words
const GERMAN_INDICATOR_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer',
  'ist', 'sind', 'war', 'mit', 'für', 'nicht', 'danke', 'bitte', 'aber',
  'und', 'oder', 'wenn', 'hier', 'auch', 'sehr', 'haben', 'kann'
]);

/**
 * Normalizes a language code (e.g., 'en-US' -> 'en', 'es-ES' -> 'es')
 */
export function getBaseLanguage(langCode: string): string {
  if (!langCode) return 'en';
  return langCode.split(/[-_]/)[0].toLowerCase();
}

/**
 * Detects whether text contains characters belonging to specific non-Latin scripts.
 */
export function detectNonLatinScriptType(text: string): string | null {
  if (!text) return null;
  // Japanese Kana
  if (/[\u3040-\u309f\u30a0-\u30ff]/u.test(text)) return 'Japanese';
  // Korean Hangul
  if (/[\uac00-\ud7af\u1100-\u11ff]/u.test(text)) return 'Korean';
  // CJK Hanzi/Kanji (if not preceded by kana)
  if (/[\u4e00-\u9fa5]/u.test(text)) return 'Chinese';
  // Cyrillic (Russian, Ukrainian, etc.)
  if (/[\u0400-\u04ff]/u.test(text)) return 'Russian/Cyrillic';
  // Arabic
  if (/[\u0600-\u06ff]/u.test(text)) return 'Arabic';
  // Devanagari (Hindi)
  if (/[\u0900-\u097f]/u.test(text)) return 'Hindi/Devanagari';
  return null;
}

/**
 * Conservative language mismatch detection relative to selectedLanguageCode.
 * 
 * Guardrails:
 * - Only flags foreign text when there is clear, unambiguous evidence.
 * - Never flags short or ambiguous utterances like "So", "Hey Tyler", names, or single words.
 * - Never flags English just for being informal, colloquial, or unusual.
 * - Works relative to the selected language (e.g. Spanish text is valid if Spanish is selected).
 */
export function detectTranscriptLanguageMismatch(
  text: string,
  selectedLanguageCode: string = 'en-US'
): LanguageDetectionResult {
  if (!text || typeof text !== 'string') {
    return { isMismatch: false };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { isMismatch: false };
  }

  const selectedBase = getBaseLanguage(selectedLanguageCode);

  // 1. Script Family Verification
  const nonLatinScript = detectNonLatinScriptType(trimmed);
  if (nonLatinScript) {
    const isMatchingScript =
      (selectedBase === 'ja' && (nonLatinScript === 'Japanese' || nonLatinScript === 'Chinese')) ||
      (selectedBase === 'ko' && nonLatinScript === 'Korean') ||
      (selectedBase === 'zh' && nonLatinScript === 'Chinese');

    if (!isMatchingScript) {
      return {
        isMismatch: true,
        detectedLanguage: nonLatinScript,
        reason: `non_latin_script (${nonLatinScript} script detected for ${selectedLanguageCode})`,
      };
    }
    // If selected is non-Latin and script matches, it is valid
    return { isMismatch: false };
  }

  // If selected is Japanese, Korean, or Chinese but user input has ONLY Latin letters
  if (['ja', 'ko', 'zh'].includes(selectedBase)) {
    // Check if it's an extended Latin sentence (more than 3 words) without native script
    const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length >= 3 && !/[\u3040-\u30ff\uac00-\ud7af\u4e00-\u9fa5]/u.test(trimmed)) {
      return {
        isMismatch: true,
        detectedLanguage: 'Latin/English',
        reason: `expected ${selectedLanguageCode} native script but found Latin words`,
      };
    }
    return { isMismatch: false };
  }

  // 2. Latin-Based Script Language Verification
  // Check distinctive Spanish punctuation markers: ¿ or ¡
  if (trimmed.includes('¿') || trimmed.includes('¡')) {
    if (selectedBase !== 'es') {
      return {
        isMismatch: true,
        detectedLanguage: 'Spanish',
        reason: 'spanish_punctuation_marker (found ¿ or ¡)',
      };
    }
  }

  // Check distinctive Spanish letter: ñ or Ñ
  if (/[ñÑ]/u.test(trimmed)) {
    if (selectedBase !== 'es') {
      return {
        isMismatch: true,
        detectedLanguage: 'Spanish',
        reason: 'spanish_character_marker (found ñ)',
      };
    }
  }

  // Tokenize words (stripping punctuation except accents)
  const cleanTokens = trimmed
    .toLowerCase()
    .replace(/[¿¡!?,.:;'"()\[\]{}]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  // Guardrail: Never flag single words or short ambiguous utterances (<= 1 word)
  // unless they contained explicit punctuation/character markers like ¿, ¡, ñ already checked above.
  if (cleanTokens.length <= 1) {
    return { isMismatch: false };
  }

  // Guardrail: Never flag common short greetings or names (e.g., "Hey Tyler", "Hi Sierra", "So yeah")
  if (cleanTokens.length === 2) {
    const pair = cleanTokens.join(' ');
    if (/^(hey|hi|hello|so|well|ok|okay)\s+[a-z]+$/i.test(pair)) {
      return { isMismatch: false };
    }
  }

  // If selected language is English:
  if (selectedBase === 'en') {
    let spanishWordCount = 0;
    let englishWordCount = 0;

    for (const token of cleanTokens) {
      if (SPANISH_INDICATOR_WORDS.has(token)) {
        spanishWordCount++;
      }
      if (ENGLISH_INDICATOR_WORDS.has(token)) {
        englishWordCount++;
      }
    }

    // Clear evidence rule:
    // Either 2+ distinctive Spanish words with 0 English stopwords,
    // OR 50%+ of tokens are Spanish words with 0 English stopwords (e.g., "mi taladro es cono" -> 4 Spanish words, 0 English)
    const isMultiWordSpanish =
      (spanishWordCount >= 2 && englishWordCount === 0) ||
      (spanishWordCount >= 1 && cleanTokens.length === 2 && spanishWordCount === cleanTokens.length && englishWordCount === 0);

    if (isMultiWordSpanish) {
      return {
        isMismatch: true,
        detectedLanguage: 'Spanish',
        reason: `spanish_words_detected (${spanishWordCount}/${cleanTokens.length} Spanish words, 0 English)`,
      };
    }

    // Check French indicators
    let frenchWordCount = 0;
    for (const token of cleanTokens) {
      if (FRENCH_INDICATOR_WORDS.has(token)) frenchWordCount++;
    }
    if (frenchWordCount >= 2 && englishWordCount === 0) {
      return {
        isMismatch: true,
        detectedLanguage: 'French',
        reason: `french_words_detected (${frenchWordCount}/${cleanTokens.length} French words, 0 English)`,
      };
    }

    // Check German indicators
    let germanWordCount = 0;
    for (const token of cleanTokens) {
      if (GERMAN_INDICATOR_WORDS.has(token)) germanWordCount++;
    }
    if (germanWordCount >= 2 && englishWordCount === 0) {
      return {
        isMismatch: true,
        detectedLanguage: 'German',
        reason: `german_words_detected (${germanWordCount}/${cleanTokens.length} German words, 0 English)`,
      };
    }

    return { isMismatch: false };
  }

  // If selected language is Spanish:
  if (selectedBase === 'es') {
    let englishWordCount = 0;
    let spanishWordCount = 0;

    for (const token of cleanTokens) {
      if (ENGLISH_INDICATOR_WORDS.has(token)) englishWordCount++;
      if (SPANISH_INDICATOR_WORDS.has(token)) spanishWordCount++;
    }

    if (englishWordCount >= 2 && spanishWordCount === 0) {
      return {
        isMismatch: true,
        detectedLanguage: 'English',
        reason: `english_words_detected (${englishWordCount}/${cleanTokens.length} English words in Spanish mode)`,
      };
    }

    return { isMismatch: false };
  }

  return { isMismatch: false };
}

/**
 * Checks if a user transcript is garbled (unreadable symbols, repeated noise)
 * or in a language that differs from the selected language.
 */
export function isTranscriptGarbledOrForeign(
  text: string,
  selectedLanguageCode: string = 'en-US'
): GarbleOrForeignResult {
  if (!text || typeof text !== 'string') {
    return { isGarbledOrForeign: true, reason: 'empty text' };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { isGarbledOrForeign: true, reason: 'empty text' };
  }

  // 1. Garble / Corruption check:
  // Excessive Unicode replacement characters or unprintable controls
  if (/\uFFFD/.test(trimmed) || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(trimmed)) {
    return { isGarbledOrForeign: true, reason: 'contains unprintable or replacement characters' };
  }

  // Excessive punctuation repeat (e.g. "?????" or "....." or "!!!!")
  if (/^[\p{P}\s]{4,}$/u.test(trimmed)) {
    return { isGarbledOrForeign: true, reason: 'punctuation only' };
  }

  // Excessive single character repeat (e.g., "aaaaaaa", "zzzzzzz")
  if (/(.)\1{7,}/i.test(trimmed)) {
    return { isGarbledOrForeign: true, reason: 'repetitive character spam' };
  }

  // Consonant clusters (7+ consecutive consonants or >= 8 letters with 0 vowels)
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const letters = tok.replace(/[^a-zA-Z]/g, '');
    if (
      (letters.length >= 8 && !/[aeiouy]/i.test(letters)) ||
      /[bcdfghjklmnpqrstvwxz]{7,}/i.test(letters)
    ) {
      return { isGarbledOrForeign: true, reason: `garbled consonant sequence: "${tok}"` };
    }
  }

  // 2. Language mismatch check
  const mismatch = detectTranscriptLanguageMismatch(trimmed, selectedLanguageCode);
  if (mismatch.isMismatch) {
    return {
      isGarbledOrForeign: true,
      reason: `language mismatch (detected ${mismatch.detectedLanguage}, selected ${selectedLanguageCode})`,
      detectedLanguage: mismatch.detectedLanguage,
    };
  }

  return { isGarbledOrForeign: false };
}

/**
 * One-time cleanup for existing saved summaries in localStorage that contain
 * non-English or garbled user text (including "¿Qué" and "Mi taladro es cono").
 * 
 * Guardrail 3:
 * - Runs once, tracked by STORAGE_KEY_SUMMARIES_DRIFT_CLEANED flag in localStorage.
 * - Logs how many summaries it removed and which reason matched each.
 * - Before deleting, saves the removed entries in STORAGE_KEY_SUMMARIES_REMOVED_BACKUP.
 */
export function cleanCorruptedConversationSummaries(force: boolean = false): {
  removedCount: number;
  removedEntries: Array<{ id: string; summary: string; reason: string }>;
} {
  if (typeof localStorage === 'undefined') {
    return { removedCount: 0, removedEntries: [] };
  }

  const alreadyCleaned = localStorage.getItem(STORAGE_KEY_SUMMARIES_DRIFT_CLEANED);
  if (alreadyCleaned === 'true' && !force) {
    return { removedCount: 0, removedEntries: [] };
  }

  const raw = localStorage.getItem('sierra_conversation_summaries');
  if (!raw) {
    localStorage.setItem(STORAGE_KEY_SUMMARIES_DRIFT_CLEANED, 'true');
    return { removedCount: 0, removedEntries: [] };
  }

  let parsed: any[];
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.setItem(STORAGE_KEY_SUMMARIES_DRIFT_CLEANED, 'true');
      return { removedCount: 0, removedEntries: [] };
    }
  } catch {
    localStorage.setItem(STORAGE_KEY_SUMMARIES_DRIFT_CLEANED, 'true');
    return { removedCount: 0, removedEntries: [] };
  }

  const retained: any[] = [];
  const removedEntries: Array<{ id: string; summary: string; reason: string }> = [];

  for (const item of parsed) {
    if (!item || typeof item.summary !== 'string') {
      continue;
    }

    const summaryText = String(item.summary);
    let isCorrupted = false;
    let corruptionReason = '';

    // Direct check for the reported contaminated examples:
    if (summaryText.includes('¿Qué') || summaryText.includes('¿') || summaryText.includes('¡')) {
      isCorrupted = true;
      corruptionReason = 'Contains Spanish punctuation marker (¿ or ¡)';
    } else if (/Mi taladro es cono/i.test(summaryText)) {
      isCorrupted = true;
      corruptionReason = 'Contains known contaminated Spanish phrase "Mi taladro es cono"';
    } else {
      // Check user portion of the summary
      const userMatch = summaryText.match(/User:\s*([^|]+)/i);
      const userContent = userMatch ? userMatch[1].trim() : summaryText;
      const check = isTranscriptGarbledOrForeign(userContent, 'en-US');
      if (check.isGarbledOrForeign) {
        isCorrupted = true;
        corruptionReason = check.reason || 'Garbled or non-English user text';
      }
    }

    if (isCorrupted) {
      removedEntries.push({
        id: String(item.id || 'unknown'),
        summary: summaryText,
        reason: corruptionReason,
      });
    } else {
      retained.push(item);
    }
  }

  if (removedEntries.length > 0) {
    // Preserve removed entries in the one-time backup key before deleting
    try {
      localStorage.setItem(STORAGE_KEY_SUMMARIES_REMOVED_BACKUP, JSON.stringify(removedEntries));
      localStorage.setItem('sierra_conversation_summaries', JSON.stringify(retained));
      
      const reasonsList = removedEntries
        .map((e) => `[${e.id}] reason: ${e.reason}`)
        .join('; ');
      
      addDebugLog(
        'Memory',
        `[Memory] Cleanup removed ${removedEntries.length} corrupted summaries: ${reasonsList}`
      );
      console.log(`[Memory] Cleanup removed ${removedEntries.length} summaries:`, reasonsList);
    } catch (err) {
      console.warn('[Memory] Failed saving cleaned conversation summaries:', err);
    }
  } else {
    addDebugLog('Memory', '[Memory] Cleanup completed: 0 corrupted summaries found.');
  }

  localStorage.setItem(STORAGE_KEY_SUMMARIES_DRIFT_CLEANED, 'true');

  return {
    removedCount: removedEntries.length,
    removedEntries,
  };
}
