import type { en } from './en.js';

/** Plural variants of one message, picked with `Intl.PluralRules`; `other` is the fallback for any missing category. */
export interface PluralForms {
  readonly zero?: string;
  readonly one: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

/** The English catalog's exact type: the source of truth for keys and placeholders. */
export type English = typeof en;

/** Every message key the client may ask for. */
export type MessageKey = keyof English;

/** A full catalog: every key, plain text where English has text and plural forms where English has them. */
export type Messages = { readonly [K in MessageKey]: English[K] extends string ? string : PluralForms };

/** Keys whose message is a single string. */
export type TextKey = { [K in MessageKey]: English[K] extends string ? K : never }[MessageKey];

/** Keys whose message has plural forms. */
export type PluralKey = Exclude<MessageKey, TextKey>;

type Placeholders<S> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never;

type SourceText<V> = V extends string ? V : V extends PluralForms ? V['one'] | V['other'] : never;

/** Text keys with no placeholders, for lookup tables such as server reason codes. */
export type PlainKey = { [K in TextKey]: [Placeholders<English[K]>] extends [never] ? K : never }[TextKey];

/** A value for a `{name}` placeholder; numbers are formatted for the current language. */
export type Param = string | number;

/** The params argument a key needs: none, or an object naming each placeholder of its English text. */
export type ParamArgs<K extends MessageKey, Skip extends string = never> = [Exclude<Placeholders<SourceText<English[K]>>, Skip>] extends [never]
  ? []
  : [params: Readonly<Record<Exclude<Placeholders<SourceText<English[K]>>, Skip>, Param>>];
