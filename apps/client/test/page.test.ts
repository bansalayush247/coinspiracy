// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import page from '../index.html?raw';

describe('the page markup', () => {
  it('uses every id once, so no lookup ever finds the wrong element', () => {
    const doc = new DOMParser().parseFromString(page, 'text/html');
    const ids = [...doc.querySelectorAll('[id]')].map((n) => n.id);
    const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(repeated).toEqual([]);
    expect(ids.length).toBeGreaterThan(100);
  });
});
