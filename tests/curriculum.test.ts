import { describe, expect, it } from 'vitest';
import raw from '../src/data/curriculum.json';
import { parseCurriculum } from '../src/lib/curriculum-schema';
import {
  buildCurriculum,
  curriculum,
  expectedPaths,
  lessonPath,
  neighbors,
} from '../src/lib/curriculum';

const minimal = {
  chapters: [
    {
      id: 'a',
      title: 'A',
      summary: 'a',
      tier: 'kern',
      lessons: [
        { id: 'one', title: 'One' },
        { id: 'two', title: 'Two' },
      ],
    },
    {
      id: 'b',
      title: 'B',
      summary: 'b',
      tier: 'vertiefung',
      lessons: [{ id: 'three', title: '3' }],
    },
  ],
};

describe('curriculum data', () => {
  it('is valid', () => {
    expect(() => parseCurriculum(raw)).not.toThrow();
  });

  it('has globally unique lesson ids', () => {
    const ids = curriculum.lessons.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseCurriculum', () => {
  it('rejects duplicate lesson ids across chapters', () => {
    const data = structuredClone(minimal);
    data.chapters[1]!.lessons[0]!.id = 'one';
    expect(() => parseCurriculum(data)).toThrow(/Duplicate lesson id "one"/);
  });

  it('rejects duplicate chapter ids', () => {
    const data = structuredClone(minimal);
    data.chapters[1]!.id = 'a';
    expect(() => parseCurriculum(data)).toThrow(/Duplicate chapter id "a"/);
  });

  it('rejects ids that are not kebab-case ASCII', () => {
    const data = structuredClone(minimal);
    data.chapters[0]!.lessons[0]!.id = 'Größe';
    expect(() => parseCurriculum(data)).toThrow(/kebab-case/);
  });

  it('rejects unknown tiers', () => {
    expect(() =>
      parseCurriculum({ chapters: [{ ...minimal.chapters[0], tier: 'basis' }] }),
    ).toThrow();
  });
});

describe('navigation', () => {
  const c = buildCurriculum(parseCurriculum(minimal));

  it('numbers chapters and orders lessons across chapters', () => {
    expect(c.chapters.map((ch) => ch.number)).toEqual([1, 2]);
    expect(c.lessons.map((l) => [l.id, l.index])).toEqual([
      ['one', 0],
      ['two', 1],
      ['three', 2],
    ]);
  });

  it('links prev/next across chapter boundaries', () => {
    const [one, two, three] = c.lessons;
    expect(neighbors(one!, c.lessons)).toEqual({ prev: undefined, next: two });
    expect(neighbors(two!, c.lessons).next?.id).toBe('three');
    expect(neighbors(three!, c.lessons)).toEqual({ prev: two, next: undefined });
  });

  it('chains every lesson of the real curriculum exactly once', () => {
    const visited: string[] = [];
    let lesson: (typeof curriculum.lessons)[number] | undefined = curriculum.lessons[0];
    while (lesson) {
      visited.push(lesson.id);
      lesson = neighbors(lesson).next;
    }
    expect(visited).toEqual(curriculum.lessons.map((l) => l.id));
  });

  it('produces unique paths for home, chapters and lessons', () => {
    const paths = expectedPaths();
    expect(paths).toHaveLength(1 + curriculum.chapters.length + curriculum.lessons.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain(lessonPath('gc', 'generationen'));
    for (const p of paths) expect(p).not.toMatch(/^\//);
  });
});
