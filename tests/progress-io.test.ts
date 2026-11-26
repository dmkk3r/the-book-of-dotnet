import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, mergeProgress, parseImport, serializeExport } from '../src/lib/progress';

const known = new Set(['boxing', 'generationen', 'tiered']);

describe('serializeExport', () => {
  it('writes format, version, date and only completed lessons', () => {
    const json = serializeExport(
      { lessons: { boxing: { done: true, completedAt: '2026-11-25' }, tiered: { done: false } } },
      new Date('2026-11-25T12:00:00Z'),
    );
    expect(JSON.parse(json)).toEqual({
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: '2026-11-25T12:00:00.000Z',
      lessons: { boxing: { done: true, completedAt: '2026-11-25' } },
    });
  });
});

describe('parseImport', () => {
  it('round-trips an export', () => {
    const json = serializeExport({
      lessons: { boxing: { done: true, completedAt: '2026-11-25' } },
    });
    expect(parseImport(json, known)).toEqual({
      ok: true,
      progress: { lessons: { boxing: { done: true, completedAt: '2026-11-25' } } },
      unknown: [],
    });
  });

  it('accepts the raw storage format and drops unknown lessons', () => {
    const result = parseImport(
      '{"lessons":{"boxing":{"done":true},"gibts-nicht":{"done":true}}}',
      known,
    );
    expect(result).toEqual({
      ok: true,
      progress: { lessons: { boxing: { done: true } } },
      unknown: ['gibts-nicht'],
    });
  });

  it.each([
    ['not json', /kein gültiges JSON/],
    ['{"foo":1}', /keinen Lernfortschritt/],
    ['{"format":"other","lessons":{}}', /nicht von dieser Lernplattform/],
    [`{"format":"${EXPORT_FORMAT}","version":2,"lessons":{}}`, /Version 2/],
  ])('rejects %s', (text, error) => {
    const result = parseImport(text, known);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  });
});

describe('mergeProgress', () => {
  it('keeps lessons done if either side says so', () => {
    const merged = mergeProgress(
      { lessons: { boxing: { done: true, completedAt: '2026-11-20' }, tiered: { done: false } } },
      {
        lessons: {
          boxing: { done: false },
          tiered: { done: true, completedAt: '2026-11-25' },
          generationen: { done: true },
        },
      },
    );
    expect(merged.lessons).toEqual({
      boxing: { done: true, completedAt: '2026-11-20' },
      tiered: { done: true, completedAt: '2026-11-25' },
      generationen: { done: true },
    });
  });
});
