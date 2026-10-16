import type { MessageKey, Messages } from './en';
import { en } from './en';

export type MessageParams = Readonly<Record<string, string | number>>;

export interface Translator {
  /** The template for `key` with {placeholders} filled in. */
  t(key: MessageKey, params?: MessageParams): string;
}

export function createTranslator(messages: Messages = en): Translator {
  return {
    t: (key, params = {}) =>
      messages[key].replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      ),
  };
}

/** Capitalize the first letter (for short titles, which get no period). */
export function capitalize(text: string): string {
  const trimmed = text.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Capitalize the first letter and end with a period unless it ends with punctuation/emoji. */
export function finishSentence(text: string): string {
  const trimmed = text.trim();
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[\p{L}\p{N})]$/u.test(capitalized) ? `${capitalized}.` : capitalized;
}
