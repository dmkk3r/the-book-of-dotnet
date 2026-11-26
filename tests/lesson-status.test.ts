import { describe, expect, it } from 'vitest';
import { authorHints, buildProblems, countTodos, countVerifyTodos } from '../src/lib/lesson-status';

const lesson = (patch: Partial<Parameters<typeof buildProblems>[0]> = {}) => ({
  id: 'boxing',
  status: 'verified' as const,
  sources: [{}, {}],
  verifiedWith: ['SharpLab'],
  texts: ['Alles geprüft.'],
  ...patch,
});

describe('TODO counting', () => {
  it('separates TODO(verify) from other TODOs', () => {
    const text = '// TODO(verify): 24 B\n{/* TODO(verify) */}\nTODO: Text schreiben';
    expect(countVerifyTodos(text)).toBe(2);
    expect(countTodos(text)).toBe(1);
  });
});

describe('buildProblems', () => {
  it('accepts a clean verified lesson', () => {
    expect(buildProblems(lesson())).toEqual([]);
  });

  it('fails a verified lesson with TODO(verify) in MDX or steps', () => {
    const [problem] = buildProblems(lesson({ texts: ['ok', '// TODO(verify): IL prüfen'] }));
    expect(problem).toMatch(/1 open TODO\(verify\)/);
  });

  it('requires verifiedWith for verified lessons', () => {
    expect(buildProblems(lesson({ verifiedWith: [] }))[0]).toMatch(/verifiedWith/);
  });

  it('ignores drafts and reviewed lessons', () => {
    expect(buildProblems(lesson({ status: 'draft', texts: ['TODO(verify)'] }))).toEqual([]);
    expect(buildProblems(lesson({ status: 'reviewed', texts: ['TODO(verify)'] }))).toEqual([]);
  });
});

describe('authorHints', () => {
  it('reports missing sources and open TODOs', () => {
    expect(
      authorHints(lesson({ status: 'draft', sources: [], texts: ['TODO: a', 'TODO: b'] })),
    ).toEqual(['keine Quellen', '2 offene TODO']);
    expect(authorHints(lesson({ status: 'reviewed', sources: [{}] }))).toEqual([
      'weniger als zwei Quellen',
    ]);
  });
});
