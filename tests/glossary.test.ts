import { describe, expect, it } from 'vitest';
import { blocksLinking, createGlossaryLinker } from '../integrations/glossary-linker.mjs';
import { curriculum } from '../src/lib/curriculum';
import { glossary, spellings } from '../src/lib/glossary';

describe('glossary data', () => {
  it('has unique ids and unique spellings', () => {
    const ids = glossary.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const all = glossary.flatMap(spellings);
    expect(all.filter((s, i) => all.indexOf(s) !== i)).toEqual([]);
  });

  it('links only to lessons that exist in the curriculum', () => {
    const lessonIds = new Set(curriculum.lessons.map((l) => l.id));
    expect(glossary.filter((e) => e.lesson && !lessonIds.has(e.lesson)).map((e) => e.id)).toEqual(
      [],
    );
  });
});

const terms = [
  { id: 'heap', term: 'Heap', aliases: [], definition: 'Speicher für Objekte.' },
  {
    id: 'card-table',
    term: 'Card Table',
    aliases: ['Card Tables'],
    definition: 'Vermerkt Verweise.',
  },
  { id: 'jit', term: 'JIT', aliases: [], definition: 'Übersetzt IL.' },
];
const linker = () => createGlossaryLinker({ base: '/repo', terms });
const linkTexts = (parts: { type: string; children?: { value: string }[] }[] | undefined) =>
  (parts ?? []).filter((p) => p.type === 'element').map((p) => p.children![0]!.value);

describe('createGlossaryLinker', () => {
  it('links the first occurrence only, with base path and definition', () => {
    expect(linker().link('Der Heap ist groß. Der Heap wächst.')).toEqual([
      { type: 'text', value: 'Der ' },
      {
        type: 'element',
        tagName: 'a',
        properties: {
          href: '/repo/glossar/#heap',
          className: ['term'],
          title: 'Speicher für Objekte.',
        },
        children: [{ type: 'text', value: 'Heap' }],
      },
      { type: 'text', value: ' ist groß. Der Heap wächst.' },
    ]);
  });

  it('remembers linked terms across text nodes of one document', () => {
    const l = linker();
    expect(linkTexts(l.link('Der Heap'))).toEqual(['Heap']);
    expect(l.link('noch ein Heap')).toBeUndefined();
  });

  it('prefers the longest spelling and matches whole words only', () => {
    expect(linkTexts(linker().link('Card Tables und Heap-Objekte und JITter'))).toEqual([
      'Card Tables',
    ]);
  });

  it('returns undefined when nothing matches', () => {
    expect(linker().link('Nichts zu verlinken.')).toBeUndefined();
  });
});

describe('blocksLinking', () => {
  it.each([
    [{ type: 'element', tagName: 'code' }, true],
    [{ type: 'element', tagName: 'h2' }, true],
    [{ type: 'element', tagName: 'a' }, true],
    [{ type: 'mdxJsxFlowElement', name: 'Quiz' }, true],
    [{ type: 'element', tagName: 'p' }, false],
    [{ type: 'mdxJsxFlowElement', name: 'Callout' }, false],
  ])('%j -> %s', (node, expected) => {
    expect(blocksLinking(node)).toBe(expected);
  });
});
