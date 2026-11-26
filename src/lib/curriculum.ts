// Relative imports with extensions so scripts/check-links.ts can load this module in plain Node.
import raw from '../data/curriculum.json' with { type: 'json' };
import { parseCurriculum, type ChapterData, type CurriculumData } from './curriculum-schema.ts';

export { TIER_LABELS, type Tier } from './curriculum-schema.ts';

export interface Chapter extends ChapterData {
  /** 1-based position in the curriculum. */
  number: number;
}

export interface Lesson {
  id: string;
  title: string;
  chapter: Chapter;
  /** 0-based position across the whole curriculum. */
  index: number;
}

export interface Curriculum {
  chapters: Chapter[];
  lessons: Lesson[];
}

/** Builds the navigable structure (numbering, flat lesson order) from validated data. */
export function buildCurriculum(data: CurriculumData): Curriculum {
  const chapters: Chapter[] = data.chapters.map((c, i) => ({ ...c, number: i + 1 }));
  const lessons: Lesson[] = chapters.flatMap((chapter) =>
    chapter.lessons.map((l) => ({ id: l.id, title: l.title, chapter, index: 0 })),
  );
  lessons.forEach((l, i) => (l.index = i));
  return { chapters, lessons };
}

export const curriculum: Curriculum = buildCurriculum(parseCurriculum(raw));

export function getChapter(id: string): Chapter | undefined {
  return curriculum.chapters.find((c) => c.id === id);
}

export function getLesson(id: string): Lesson | undefined {
  return curriculum.lessons.find((l) => l.id === id);
}

export function lessonsOf(chapter: Chapter, all: Lesson[] = curriculum.lessons): Lesson[] {
  return all.filter((l) => l.chapter.id === chapter.id);
}

/** Previous and next lesson across chapter boundaries. */
export function neighbors(
  lesson: Lesson,
  all: Lesson[] = curriculum.lessons,
): { prev?: Lesson; next?: Lesson } {
  return { prev: all[lesson.index - 1], next: all[lesson.index + 1] };
}

/** Site-relative paths (without base). Combine with withBase() for links. */
export const chapterPath = (chapterId: string) => `kapitel/${chapterId}/`;
export const lessonPath = (chapterId: string, lessonId: string) =>
  `kapitel/${chapterId}/${lessonId}/`;

/** Every page the curriculum must produce, used by tests and the post-build check. */
export function expectedPaths(c: Curriculum = curriculum): string[] {
  return [
    '',
    ...c.chapters.map((ch) => chapterPath(ch.id)),
    ...c.lessons.map((l) => lessonPath(l.chapter.id, l.id)),
  ];
}
