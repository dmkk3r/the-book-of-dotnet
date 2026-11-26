/**
 * Build-time syntax highlighting with Shiki. Colors are CSS variables (see tokens.css),
 * so code follows the design tokens and the light/dark theme without re-rendering.
 */
import {
  createCssVariablesTheme,
  createHighlighter,
  type BundledLanguage,
  type LanguageRegistration,
  type ThemedToken,
} from 'shiki';
import type { CodeTab } from './types.ts';

const theme = createCssVariablesTheme({
  name: 'book-of-dotnet',
  variablePrefix: '--shiki-',
  variableDefaults: {},
  fontStyle: true,
});

/** Minimal CIL grammar: opcodes, labels, numbers, strings, assembly references, comments. */
const ilLanguage: LanguageRegistration = {
  name: 'il',
  scopeName: 'source.il',
  repository: {},
  patterns: [
    { match: '//.*$', name: 'comment.line.il' },
    { match: '"(?:[^"\\\\]|\\\\.)*"', name: 'string.quoted.double.il' },
    {
      match: '^(\\s*)(IL_[0-9a-fA-F]+:)?(\\s*)([a-z][a-z0-9]*(?:\\.[a-z0-9]+)*)\\b',
      captures: { 2: { name: 'comment.label.il' }, 4: { name: 'keyword.opcode.il' } },
    },
    { match: '\\[[^\\]]+\\]', name: 'comment.assembly.il' },
    { match: '\\b(?:0x[0-9a-fA-F]+|\\d+)\\b', name: 'constant.numeric.il' },
  ],
};

// 'il' is registered above as a custom language; Shiki's types only know bundled names.
const LANG_NAMES: Record<CodeTab, string> = {
  cs: 'csharp',
  lowered: 'csharp',
  il: 'il',
  asm: 'asm',
};
const LANGS = LANG_NAMES as Record<CodeTab, BundledLanguage>;

const createSiteHighlighter = () =>
  createHighlighter({ themes: [theme], langs: ['csharp', 'asm', ilLanguage] });

let highlighter: ReturnType<typeof createSiteHighlighter> | undefined;
function getHighlighter() {
  highlighter ??= createSiteHighlighter();
  return highlighter;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const KEYWORD = 'var(--shiki-token-keyword)';
const OPERATOR_ONLY = /^[\s=+\-*/%<>!&|^~?:.,;()[\]{}]+$/;

function tokenToHtml(token: ThemedToken): string {
  const styles: string[] = [];
  // The css-variables theme colors operators like keywords; keep them in the text color.
  const color =
    token.color === KEYWORD && OPERATOR_ONLY.test(token.content) ? undefined : token.color;
  if (color) styles.push(`color:${color}`);
  if (token.fontStyle && token.fontStyle & 1) styles.push('font-style:italic');
  const text = escapeHtml(token.content);
  return styles.length ? `<span style="${styles.join(';')}">${text}</span>` : text;
}

/** Highlights code and returns one HTML string per line. */
export async function highlightLines(code: string, tab: CodeTab): Promise<string[]> {
  const h = await getHighlighter();
  const { tokens } = h.codeToTokens(code.replace(/\n$/, ''), {
    lang: LANGS[tab],
    theme: 'book-of-dotnet',
  });
  return tokens.map((line) => line.map(tokenToHtml).join(''));
}
