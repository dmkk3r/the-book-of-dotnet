/** Lesson status rules: draft, reviewed (read by the author, at least two sources), verified
 * (all numbers measured, `verifiedWith` set, no TODO(verify) left). */

export type LessonStatus = 'draft' | 'reviewed' | 'verified';

export const STATUS_LABELS: Record<LessonStatus, string> = {
  draft: 'Entwurf',
  reviewed: 'Gelesen',
  verified: 'Verifiziert',
};

const VERIFY_PATTERN = /TODO\(verify\)/g;
const TODO_PATTERN = /TODO(?!\(verify\))\b/g;

/** Number of open `TODO(verify)` markers. */
export const countVerifyTodos = (text: string) => text.match(VERIFY_PATTERN)?.length ?? 0;

/** Number of other `TODO` markers (unfinished content). */
export const countTodos = (text: string) => text.match(TODO_PATTERN)?.length ?? 0;

export interface LessonCheckInput {
  id: string;
  status: LessonStatus;
  sources: unknown[];
  verifiedWith?: string[];
  /** Raw MDX plus the steps file, if any. */
  texts: string[];
}

/** Problems that must fail the build. */
export function buildProblems(lesson: LessonCheckInput): string[] {
  if (lesson.status !== 'verified') return [];
  const problems: string[] = [];
  const open = lesson.texts.reduce((n, t) => n + countVerifyTodos(t), 0);
  if (open > 0) problems.push(`${lesson.id}: status "verified" but ${open} open TODO(verify)`);
  if (!lesson.verifiedWith?.length) {
    problems.push(`${lesson.id}: status "verified" requires "verifiedWith"`);
  }
  return problems;
}

/** Hints for the author page (not fatal). */
export function authorHints(lesson: LessonCheckInput): string[] {
  const hints: string[] = [];
  if (lesson.sources.length === 0) hints.push('keine Quellen');
  else if (lesson.status !== 'draft' && lesson.sources.length < 2)
    hints.push('weniger als zwei Quellen');
  const todos = lesson.texts.reduce((n, t) => n + countTodos(t), 0);
  if (todos > 0) hints.push(`${todos} offene TODO`);
  return hints;
}
