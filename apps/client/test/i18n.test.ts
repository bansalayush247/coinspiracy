// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import page from '../index.html?raw';
import {
  CATALOGS,
  LOCALES,
  LOCALE_STORAGE_KEY,
  applyTranslations,
  bindLanguagePicker,
  detectLocale,
  formatNumber,
  getLocale,
  initLocale,
  interpolate,
  isTextKey,
  onLocaleChange,
  setLocale,
  storedLocale,
  t,
  tn,
  translate,
  translatePlural,
  type MessageKey,
  type PluralForms,
} from '../src/i18n/index.js';
import { en } from '../src/i18n/en.js';
import { es } from '../src/i18n/es.js';

function loadPage(): void {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

function placeholders(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1] ?? ''))].sort();
}

function forms(value: string | PluralForms): string[] {
  return typeof value === 'string' ? [value] : Object.values(value).filter((v): v is string => typeof v === 'string');
}

const KEYS = Object.keys(en) as MessageKey[];

beforeEach(() => {
  localStorage.clear();
  setLocale('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  setLocale('en');
  localStorage.clear();
});

describe('catalog completeness', () => {
  it('gives every language exactly the English keys', () => {
    for (const locale of LOCALES) expect(Object.keys(CATALOGS[locale]).sort()).toEqual([...KEYS].sort());
  });

  it('keeps plural keys plural and text keys text in every language', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        const source = en[key];
        const target = CATALOGS[locale][key];
        expect(typeof target, `${locale} ${key}`).toBe(typeof source);
        if (typeof target !== 'string') {
          expect(target.one, `${locale} ${key}`).toBeTruthy();
          expect(target.other, `${locale} ${key}`).toBeTruthy();
        }
      }
    }
  });

  it('uses the same placeholders as English in every form', () => {
    for (const locale of LOCALES) for (const key of KEYS) expect(placeholders(forms(CATALOGS[locale][key]).join(' ')), `${locale} ${key}`).toEqual(placeholders(forms(en[key]).join(' ')));
  });

  it('has no empty or markup-bearing messages', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        for (const form of forms(CATALOGS[locale][key])) {
          expect(form.trim(), `${locale} ${key}`).not.toBe('');
          expect(form, `${locale} ${key}`).not.toMatch(/<[a-z/!]/i);
        }
      }
    }
  });
});

describe('placeholders', () => {
  it('fills named placeholders from params', () => {
    expect(translate('en', 'hud.waitHost', { name: 'Mara' })).toBe('Waiting for Mara to start the match.');
    expect(translate('es', 'hud.waitHost', { name: 'Mara' })).toBe('Esperando a que Mara empiece la partida.');
    expect(translate('en', 'proposal.livenessTitle', { strikes: '1', limit: '3' })).toBe('1 of 3 real withdrawals have failed. At 3, users lose access and the Byzantines win.');
  });

  it('formats number params for the language and leaves string params alone', () => {
    expect(translate('en', 'beach.wallet', { sats: 12345 })).toBe('12,345 play sats');
    expect(translate('es', 'beach.wallet', { sats: 12345 })).toBe(`${new Intl.NumberFormat('es-419').format(12345)} sats de juego`);
    expect(translate('en', 'beach.wallet', { sats: '12345' })).toBe('12345 play sats');
    expect(formatNumber(2016, 'en')).toBe('2,016');
  });

  it('keeps unknown placeholders and inserts values as plain text', () => {
    expect(interpolate('Hi {name}, {missing}', { name: '<b>x</b>' })).toBe('Hi <b>x</b>, {missing}');
    expect(interpolate('No params {here}', undefined)).toBe('No params {here}');
  });

  it('reads the current language through t', () => {
    expect(t('menu.quick')).toBe('Quick match');
    setLocale('es');
    expect(t('menu.quick')).toBe('Partida rápida');
    expect(t('hud.joined', { name: 'Ivy' })).toBe('Ivy entró');
  });
});

describe('plurals', () => {
  it('picks English forms with Intl.PluralRules', () => {
    expect(translatePlural('en', 'match.blocksLeft', 1)).toBe('1 block left');
    expect(translatePlural('en', 'match.blocksLeft', 0)).toBe('0 blocks left');
    expect(translatePlural('en', 'match.blocksLeft', 12)).toBe('12 blocks left');
    expect(translatePlural('en', 'role.hiding', 1)).toBe('1 Byzantine guardian is hiding among you.');
    expect(translatePlural('en', 'role.hiding', 2)).toBe('2 Byzantine guardians are hiding among you.');
  });

  it('picks Spanish forms and falls back to other for categories it does not list', () => {
    expect(translatePlural('es', 'match.blocksLeft', 1)).toBe('Queda 1 bloque');
    expect(translatePlural('es', 'match.blocksLeft', 3)).toBe('Quedan 3 bloques');
    expect(new Intl.PluralRules('es-419').select(1_000_000)).toBe('many');
    expect(translatePlural('es', 'common.sats', 1_000_000)).toBe(`${new Intl.NumberFormat('es-419').format(1_000_000)} sats`);
  });

  it('fills extra params next to the count', () => {
    setLocale('es');
    expect(tn('academy.result', 2, { time: '40s', par: '30s' })).toBe('40s (par 30s) · 2 errores');
    expect(tn('academy.result', 1, { time: '40s', par: '30s' })).toBe('40s (par 30s) · 1 error');
  });
});

describe('language detection', () => {
  it('prefers a stored pick, then browser languages in order, then English', () => {
    expect(detectLocale('es', ['en-US'])).toBe('es');
    expect(detectLocale('en', ['es-SV'])).toBe('en');
    expect(detectLocale(null, ['es-SV', 'en'])).toBe('es');
    expect(detectLocale(null, ['fr-FR', 'ES_mx', 'en'])).toBe('es');
    expect(detectLocale(null, ['en-GB', 'es'])).toBe('en');
    expect(detectLocale('klingon', ['de-DE', 'ja'])).toBe('en');
    expect(detectLocale(null, [])).toBe('en');
  });

  it('starts from the browser languages and sets <html lang>', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es-MX', 'en-US']);
    expect(initLocale()).toBe('es');
    expect(document.documentElement.lang).toBe('es-419');
    setLocale('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('lets a stored pick override the browser', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es-MX']);
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(initLocale()).toBe('en');
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es']);
    expect(storedLocale()).toBeNull();
    expect(initLocale()).toBe('es');
    expect(() => {
      setLocale('en', { persist: true });
    }).not.toThrow();
    expect(getLocale()).toBe('en');
  });

  it('remembers a pick from the settings picker and tells listeners', () => {
    loadPage();
    const select = document.getElementById('language');
    if (!(select instanceof HTMLSelectElement)) throw new Error('picker missing');
    bindLanguagePicker(select);
    const heard = vi.fn();
    const off = onLocaleChange(heard);
    select.value = 'es';
    select.dispatchEvent(new Event('change'));
    expect(getLocale()).toBe('es');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es');
    expect(heard).toHaveBeenCalledTimes(1);
    setLocale('en');
    expect(select.value).toBe('en');
    off();
    setLocale('es');
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('data-i18n markup', () => {
  it('names only real text keys, and the markup already shows their English', () => {
    loadPage();
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-i18n]')];
    expect(nodes.length).toBeGreaterThan(90);
    for (const node of nodes) {
      const key = node.dataset['i18n'] ?? '';
      expect(isTextKey(key), key).toBe(true);
      if (!isTextKey(key)) continue;
      const own = node.childElementCount === 0 ? node.textContent : [...node.childNodes].find((c) => c.nodeType === 3 && (c.nodeValue ?? '').trim() !== '')?.nodeValue ?? '';
      expect(own.trim(), key).toBe(en[key]);
    }
    for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
      const key = node.dataset['i18nAriaLabel'] ?? '';
      expect(isTextKey(key), key).toBe(true);
      if (isTextKey(key)) expect(node.getAttribute('aria-label'), key).toBe(en[key]);
    }
  });

  it('translates as text only, keeps child elements, and round-trips back to the original page', () => {
    loadPage();
    const before = document.body.innerHTML;
    const innerHtml = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    const punch = document.getElementById('city-punch');
    const tagline = document.querySelector('.tagline');
    applyTranslations(document, 'es');
    expect(innerHtml).not.toHaveBeenCalled();
    expect(punch?.firstChild?.nodeValue).toBe(es['city.punch']);
    expect(punch?.querySelector('small')?.textContent).toBe('F');
    expect(tagline?.textContent).toBe(es['menu.tagline']);
    expect(document.querySelector('.corner-settings summary')?.getAttribute('aria-label')).toBe(es['settings.title']);
    applyTranslations(document, 'en');
    expect(innerHtml).not.toHaveBeenCalled();
    document.createElement('div').innerHTML = '<b></b>';
    expect(innerHtml).toHaveBeenCalledTimes(1);
    innerHtml.mockRestore();
    expect(document.body.innerHTML).toBe(before);
  });

  it('writes markup-like text literally instead of parsing it', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p data-i18n="menu.quick"></p>';
    const p = host.querySelector('p');
    if (p === null) throw new Error('p missing');
    applyTranslations(host, 'en');
    expect(p.textContent).toBe('Quick match');
    p.textContent = translate('en', 'hud.joined', { name: '<img src=x>' });
    expect(p.childElementCount).toBe(0);
    expect(p.textContent).toBe('<img src=x> joined');
  });

  it('retranslates the live page when the language changes', () => {
    loadPage();
    setLocale('es');
    expect(document.querySelector('[data-action="quick"]')?.textContent).toBe('Partida rápida');
    expect(document.documentElement.lang).toBe('es-419');
    setLocale('en');
    expect(document.querySelector('[data-action="quick"]')?.textContent).toBe('Quick match');
  });
});
