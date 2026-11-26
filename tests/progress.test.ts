import { afterEach, describe, expect, it, vi } from 'vitest';
import { doneIds, loadProgress, parseProgress, PROGRESS_KEY, setDone } from '../src/lib/progress';

describe('parseProgress', () => {
  it.each([null, '', 'not json', '42', 'null', '{"lessons": 5}'])(
    'returns empty progress for %j',
    (input) => {
      expect(parseProgress(input)).toEqual({ lessons: {} });
    },
  );

  it('keeps valid entries and drops invalid ones', () => {
    const json = JSON.stringify({
      lessons: {
        boxing: { done: true, completedAt: '2026-11-25' },
        gc: { done: 'yes' },
        jit: null,
        span: { done: false },
      },
    });
    expect(parseProgress(json)).toEqual({
      lessons: { boxing: { done: true, completedAt: '2026-11-25' }, span: { done: false } },
    });
  });
});

describe('storage access', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores and reads done lessons', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    setDone('boxing', true, new Date('2026-11-25T10:00:00Z'));
    expect(JSON.parse(store.get(PROGRESS_KEY)!)).toEqual({
      lessons: { boxing: { done: true, completedAt: '2026-11-25' } },
    });
    expect(doneIds()).toEqual(new Set(['boxing']));
    setDone('boxing', false);
    expect(doneIds()).toEqual(new Set());
  });

  it('works when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadProgress()).toEqual({ lessons: {} });
    expect(() => setDone('boxing', true)).not.toThrow();
  });
});
