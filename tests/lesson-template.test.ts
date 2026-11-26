import { describe, expect, it } from 'vitest';
import { curriculum } from '../src/lib/curriculum';
import { lessonFiles, resolveLesson } from '../src/lib/lesson-template';

describe('resolveLesson', () => {
  it('finds a curriculum lesson in its chapter', () => {
    expect(resolveLesson(curriculum, 'gc', 'generationen').title).toBe('Generationen');
  });

  it.each([
    [undefined, undefined, /Usage/],
    ['gibts-nicht', 'generationen', /Unknown chapter/],
    ['gc', 'gibts-nicht', /Unknown lesson/],
    ['jit', 'generationen', /belongs to chapter "gc"/],
  ])('rejects %s/%s', (chapter, lesson, error) => {
    expect(() => resolveLesson(curriculum, chapter, lesson)).toThrow(error);
  });
});

describe('lessonFiles', () => {
  const files = lessonFiles(
    resolveLesson(curriculum, 'gc', 'generationen'),
    new Date('2026-11-25T12:00:00Z'),
  );

  it('places files in the chapter folder', () => {
    expect(files.mdxPath).toBe('src/content/lessons/gc/generationen.mdx');
    expect(files.stepsPath).toBe('src/content/lessons/gc/generationen.steps.ts');
  });

  it('writes draft frontmatter with id, title and date', () => {
    expect(files.mdx).toMatch(/^---\nid: generationen\ntitle: 'Generationen'\n/);
    expect(files.mdx).toContain('status: draft');
    expect(files.mdx).toContain('updated: 2026-11-25');
    expect(files.mdx).toContain("import script from './generationen.steps';");
    expect(files.mdx).toContain('lessonId="generationen"');
  });

  it('has the in-depth structure from LESSON-TEMPLATE.md', () => {
    const titles = [...files.mdx.matchAll(/<Block n=\{(\d+)\} title="([^"]+)">/g)].map((m) => m[2]);
    expect(titles).toEqual([
      'Das Problem',
      'Das mentale Modell',
      'Durchspielen',
      'Im Detail',
      'Stolperfallen',
      'In der Praxis',
      'Was Runtime und JIT dazu tun',
      'Selbst nachweisen',
      'Prüfen',
      'Das Wichtigste in Kürze',
    ]);
  });

  it('escapes quotes in titles', () => {
    const lesson = { ...resolveLesson(curriculum, 'gc', 'generationen'), title: "Dad's 'GC'" };
    const f = lessonFiles(lesson, new Date());
    expect(f.mdx).toContain("title: 'Dad''s ''GC'''");
    expect(f.steps).toContain("title: 'Dad\\'s \\'GC\\' Schritt für Schritt'");
  });
});
