import { describe, expect, it } from 'vitest';
import { checkPage, extractUrls } from '../src/lib/link-check';

const files = new Set(['/index.html', '/test/zweite-seite/index.html', '/images/a.svg']);
const exists = (p: string) => files.has(p);

describe('extractUrls', () => {
  it('finds href, src and srcset', () => {
    const html = `<a href="/a/">x</a><img src='/b.png' srcset="/c.png 1x, /d.png 2x">`;
    expect(extractUrls(html)).toEqual(['/a/', '/b.png', '/c.png', '/d.png']);
  });
});

describe('checkPage', () => {
  it('accepts links with base path that exist', () => {
    const html = `<a href="/repo/test/zweite-seite/">x</a><img src="/repo/images/a.svg"><a href="/repo/">s</a>`;
    expect(checkPage(html, '/repo/', '/repo', exists)).toEqual([]);
  });

  it('ignores external links, anchors and mailto', () => {
    const html = `<a href="https://x.dev">x</a><a href="#top">t</a><a href="mailto:a@b.c">m</a>`;
    expect(checkPage(html, '/repo/', '/repo', exists)).toEqual([]);
  });

  it('flags root-relative links without base path', () => {
    const [problem] = checkPage(`<a href="/test/zweite-seite/">x</a>`, '/repo/', '/repo', exists);
    expect(problem?.reason).toMatch(/base path/);
  });

  it('flags missing targets', () => {
    const [problem] = checkPage(`<a href="/repo/fehlt/">x</a>`, '/repo/', '/repo', exists);
    expect(problem?.reason).toMatch(/not found/);
  });

  it('resolves relative links against the page URL', () => {
    const html = `<a href="../../images/a.svg">x</a>`;
    expect(checkPage(html, '/repo/test/zweite-seite/', '/repo', exists)).toEqual([]);
  });

  it('works with root base', () => {
    expect(checkPage(`<a href="/test/zweite-seite/">x</a>`, '/', '/', exists)).toEqual([]);
  });

  it('checks #fragments against ids in the target page', () => {
    const ids = (p: string) => (p === '/index.html' ? new Set(['heap']) : new Set<string>());
    expect(checkPage(`<a href="/repo/#heap">x</a>`, '/repo/', '/repo', exists, ids)).toEqual([]);
    const [problem] = checkPage(`<a href="/repo/#gone">x</a>`, '/repo/', '/repo', exists, ids);
    expect(problem?.reason).toMatch(/anchor #gone not found/);
  });
});
