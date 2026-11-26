import { describe, expect, it } from 'vitest';
import type { MemoryState, StepScript } from '../src/lib/viz/types';
import { validateStepScript } from '../src/lib/viz/validate';
import { renderInlineMarkdown } from '../src/lib/viz/inline-markdown';

const scripts = import.meta.glob<{ default: StepScript }>('../src/content/lessons/**/*.steps.ts', {
  eager: true,
});

describe('lesson step scripts', () => {
  it('exist (at least the reference lesson)', () => {
    expect(Object.keys(scripts).length).toBeGreaterThan(0);
  });

  for (const [path, module] of Object.entries(scripts)) {
    it(`${path.replace('../src/content/lessons/', '')} is consistent`, () => {
      expect(validateStepScript(module.default)).toEqual([]);
    });
  }
});

const state = (patch: Partial<MemoryState> = {}): MemoryState => ({
  frames: [
    {
      id: 'f',
      method: 'M()',
      slots: [{ id: 'a', name: 'a', type: 'object', value: 'x', ref: 'obj' }],
    },
  ],
  heap: [{ id: 'obj', type: 'Foo', address: '0x1', fields: [{ name: 'next', value: 'null' }] }],
  ...patch,
});

const script = (steps: StepScript<'memory'>['steps'], code = { cs: 'a\nb', il: 'x' }): StepScript =>
  ({ view: 'memory', title: 't', code, steps }) as StepScript;

describe('validateStepScript', () => {
  it('accepts a valid script', () => {
    expect(
      validateStepScript(
        script([
          {
            codeLine: 2,
            highlight: { il: [1] },
            state: state(),
            changed: ['a', 'obj.next'],
            explanation: 'ok',
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('rejects code lines outside the code', () => {
    const problems = validateStepScript(
      script([{ codeLine: 3, highlight: { il: [2] }, state: state(), explanation: 'x' }]),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/codeLine 3/);
    expect(problems[1]).toMatch(/il line 2/);
  });

  it('rejects highlights in tabs without code', () => {
    expect(
      validateStepScript(
        script([{ highlight: { asm: [1] }, state: state(), explanation: 'x' }]),
      )[0],
    ).toMatch(/no code/);
  });

  it('rejects references to missing heap objects (from slots and fields)', () => {
    const broken = state({
      heap: [
        {
          id: 'other',
          type: 'Foo',
          address: '0x1',
          fields: [{ name: 'next', value: '0x2', ref: 'gone' }],
        },
      ],
    });
    const problems = validateStepScript(script([{ state: broken, explanation: 'x' }]));
    expect(problems.some((p) => p.includes('"a" refers to missing heap object "obj"'))).toBe(true);
    expect(
      problems.some((p) => p.includes('"other.next" refers to missing heap object "gone"')),
    ).toBe(true);
  });

  it('rejects unknown changed ids and duplicate heap ids', () => {
    const dup = state({ heap: [...state().heap, ...state().heap] });
    const problems = validateStepScript(
      script([{ state: dup, changed: ['nope'], explanation: 'x' }]),
    );
    expect(problems.some((p) => p.includes('duplicate heap object id'))).toBe(true);
    expect(problems.some((p) => p.includes('changed id "nope"'))).toBe(true);
  });

  it('rejects empty scripts and explanations', () => {
    expect(validateStepScript(script([]))).toEqual(['script has no steps']);
    expect(validateStepScript(script([{ state: state(), explanation: ' ' }]))[0]).toMatch(
      /empty explanation/,
    );
  });
});

describe('renderInlineMarkdown', () => {
  it.each([
    ['**x = 42** schreibt', '<strong>x = 42</strong> schreibt'],
    ['der Slot *ist* der Wert', 'der Slot <em>ist</em> der Wert'],
    ['`List<int>` und **fett**', '<code>List&lt;int&gt;</code> und <strong>fett</strong>'],
    ['`a * b * c` bleibt', '<code>a * b * c</code> bleibt'],
    ['<script>', '&lt;script&gt;'],
  ])('%s', (input, expected) => {
    expect(renderInlineMarkdown(input)).toBe(expected);
  });
});
