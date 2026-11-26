import { describe, expect, it } from 'vitest';
import { joinBase, withBase } from '../src/lib/paths';
import { normalizeBase } from '../deploy.config.mjs';

describe('joinBase', () => {
  it.each([
    ['/repo/', 'kapitel/gc/', '/repo/kapitel/gc/'],
    ['/repo', '/kapitel/gc/', '/repo/kapitel/gc/'],
    ['/repo/', '', '/repo/'],
    ['/', 'favicon.svg', '/favicon.svg'],
    ['/', '', '/'],
  ])('joinBase(%s, %s) = %s', (base, path, expected) => {
    expect(joinBase(base, path)).toBe(expected);
  });
});

describe('withBase', () => {
  it('uses the configured BASE_URL', () => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
    expect(withBase('kapitel/')).toBe(`${base}/kapitel/`);
  });
});

describe('normalizeBase', () => {
  it.each([
    ['', '/'],
    ['/', '/'],
    ['repo', '/repo'],
    ['/repo/', '/repo'],
    [undefined, '/'],
  ])('normalizeBase(%j) = %s', (input, expected) => {
    expect(normalizeBase(input)).toBe(expected);
  });
});
