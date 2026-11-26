// Client UI translations: typed keys, {name} placeholders, Intl plurals and numbers, and data-i18n markup.
import { en } from './en.js';
import { es } from './es.js';
import { fr } from './fr.js';
import { ha } from './ha.js';
import { hi } from './hi.js';
import { sw } from './sw.js';
import { zu } from './zu.js';
import type { MessageKey, Messages, Param, ParamArgs, PluralForms, PluralKey, TextKey } from './types.js';

export type { MessageKey, Messages, Param, PlainKey, PluralForms, PluralKey, TextKey } from './types.js';

/** Languages the client can show, English first as the default. */
export const LOCALES = ['en', 'es', 'fr', 'sw', 'ha', 'zu', 'hi'] as const;

/** A language the client can show. */
export type Locale = (typeof LOCALES)[number];

/** Every catalog by language. */
export const CATALOGS: Readonly<Record<Locale, Messages>> = { en, es, fr, sw, ha, zu, hi };

/** The localStorage key holding a language the player picked by hand. */
export const LOCALE_STORAGE_KEY = 'bc.locale';

const INTL_TAG: Readonly<Record<Locale, string>> = { en: 'en', es: 'es-419', fr: 'fr', sw: 'sw', ha: 'ha', zu: 'zu', hi: 'hi' };

/** Attributes data-i18n-* can translate, by dataset name. */
export const I18N_ATTRIBUTES = { i18nAriaLabel: 'aria-label', i18nTitle: 'title', i18nPlaceholder: 'placeholder' } as const;

const I18N_SELECTOR = ['[data-i18n]', '[data-i18n-aria-label]', '[data-i18n-title]', '[data-i18n-placeholder]'].join(', ');

let current: Locale = 'en';
const listeners = new Set<() => void>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

/** True for a supported language code. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** True for a key whose English message is a single string. */
export function isTextKey(key: string): key is TextKey {
  return Object.hasOwn(en, key) && typeof en[key as MessageKey] === 'string';
}

/** The language to show: a stored pick first, then the browser's languages in order, then English. */
export function detectLocale(stored: string | null, languages: readonly string[]): Locale {
  if (isLocale(stored)) return stored;
  for (const tag of languages) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

/** The language showing now. */
export function getLocale(): Locale {
  return current;
}

/** The BCP 47 tag for Intl and `<html lang>`; Spanish is written for Latin America, so it is es-419. */
export function intlTag(locale: Locale = current): string {
  return INTL_TAG[locale];
}

/** Formats a number the way the language writes it. */
export function formatNumber(value: number, locale: Locale = current): string {
  const tag = intlTag(locale);
  let format = numberFormats.get(tag);
  if (format === undefined) {
    format = new Intl.NumberFormat(tag);
    numberFormats.set(tag, format);
  }
  return format.format(value);
}

/** Fills `{name}` placeholders; numbers are formatted, unknown placeholders stay as written. */
export function interpolate(template: string, params: Readonly<Record<string, Param>> | undefined, locale: Locale = current): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!Object.hasOwn(params, name)) return whole;
    const value = params[name];
    return typeof value === 'number' ? formatNumber(value, locale) : String(value);
  });
}

/** Picks the plural form for a count in a language. */
export function pluralForm(forms: PluralForms, count: number, locale: Locale = current): string {
  const tag = intlTag(locale);
  let rules = pluralRules.get(tag);
  if (rules === undefined) {
    rules = new Intl.PluralRules(tag);
    pluralRules.set(tag, rules);
  }
  return forms[rules.select(count)] ?? forms.other;
}

/** A message in a given language, without touching the current one. */
export function translate(locale: Locale, key: TextKey, params?: Readonly<Record<string, Param>>): string {
  const text = CATALOGS[locale][key] as string | undefined;
  return interpolate(text ?? en[key], params, locale);
}

/** A plural message in a given language; `{count}` is filled with the formatted count. */
export function translatePlural(locale: Locale, key: PluralKey, count: number, params?: Readonly<Record<string, Param>>): string {
  const forms = (CATALOGS[locale][key] as PluralForms | undefined) ?? en[key];
  return interpolate(pluralForm(forms, count, locale), { ...params, count }, locale);
}

/** A message in the current language. */
export function t<K extends TextKey>(key: K, ...args: ParamArgs<K>): string {
  return translate(current, key, args[0]);
}

/** A plural message in the current language for `count`. */
export function tn<K extends PluralKey>(key: K, count: number, ...args: ParamArgs<K, 'count'>): string {
  return translatePlural(current, key, count, args[0]);
}

// Replaces an element's own text but keeps child elements, so "Punch<small>F</small>" keeps its <small>.
function setOwnText(node: Element, text: string): void {
  if (node.childElementCount === 0) {
    node.textContent = text;
    return;
  }
  for (const child of node.childNodes) {
    const value = child.nodeType === 3 ? (child.nodeValue ?? '') : '';
    if (value.trim() === '') continue;
    const lead = /^\s*/.exec(value)?.[0] ?? '';
    const trail = /\s*$/.exec(value)?.[0] ?? '';
    child.nodeValue = `${lead}${text}${trail}`;
    return;
  }
  node.prepend(text);
}

/** Translates every data-i18n element under root, as text only: data-i18n sets the text, data-i18n-aria-label and friends set attributes. */
export function applyTranslations(root: ParentNode, locale: Locale = current): void {
  for (const node of root.querySelectorAll<HTMLElement>(I18N_SELECTOR)) {
    const key = node.dataset['i18n'];
    if (key !== undefined && isTextKey(key)) setOwnText(node, translate(locale, key));
    for (const [prop, attribute] of Object.entries(I18N_ATTRIBUTES)) {
      const attrKey = node.dataset[prop];
      if (attrKey !== undefined && isTextKey(attrKey)) node.setAttribute(attribute, translate(locale, attrKey));
    }
  }
}

/** Calls `listener` after every language change; returns an unsubscribe function. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The language the player picked by hand, if storage allows reading it. */
export function storedLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage blocked: the pick lasts for this visit.
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages.length > 0) return navigator.languages;
  return navigator.language === '' ? [] : [navigator.language];
}

/** Switches language: sets `<html lang>`, retranslates the page and tells listeners. `persist` remembers a hand pick. */
export function setLocale(locale: Locale, options: { readonly persist?: boolean } = {}): void {
  const changed = locale !== current;
  current = locale;
  if (options.persist === true) storeLocale(locale);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = intlTag(locale);
    if (changed) applyTranslations(document);
  }
  if (changed) for (const listener of [...listeners]) listener();
}

/** Picks the starting language from storage and the browser, and applies it to the page. */
export function initLocale(): Locale {
  const locale = detectLocale(storedLocale(), browserLanguages());
  setLocale(locale);
  return locale;
}

/** Wires a `<select>` of language codes to the current language. */
export function bindLanguagePicker(select: HTMLSelectElement): void {
  select.value = current;
  select.addEventListener('change', () => {
    if (isLocale(select.value)) setLocale(select.value, { persist: true });
  });
  onLocaleChange(() => {
    select.value = current;
  });
}
