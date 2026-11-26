import { describe, expect, it } from 'vitest';
import { highlightLines } from '../src/lib/viz/highlight';

describe('highlightLines', () => {
  it('returns one HTML string per line using CSS variables', async () => {
    const lines = await highlightLines('int x = 42;\nobject o = x;', 'cs');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('var(--shiki-token-keyword)');
    expect(lines[0]).toContain('var(--shiki-token-constant)');
  });

  it('highlights IL opcodes, also after labels', async () => {
    const [a, b] = await highlightLines('box [System.Runtime]System.Int32\nIL_0001: stloc.0', 'il');
    expect(a).toMatch(/keyword\)">box</);
    expect(a).toMatch(/comment\)">\[System.Runtime\]/);
    expect(b).toMatch(/keyword\)">stloc.0</);
  });

  it('escapes HTML', async () => {
    const [line] = await highlightLines('var l = new List<int>();', 'cs');
    expect(line).toContain('&lt;');
    expect(line).not.toContain('<int>');
  });
});
