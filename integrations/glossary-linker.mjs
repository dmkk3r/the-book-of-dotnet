// @ts-check
/**
 * Links the first occurrence of every glossary term in a lesson to its entry on /glossar/.
 * The core (createGlossaryLinker) is processor-independent and unit-tested; glossaryPlugin
 * adapts it to Astro's default Markdown/MDX processor (Sätteri).
 */
import glossaryData from '../src/data/glossary.json' with { type: 'json' };

/** Elements and components whose text must never be linked. */
export const SKIP = new Set([
  'a',
  'code',
  'pre',
  'kbd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'script',
  'style',
  'svg',
  'Quiz',
  'StepPlayer',
  'VerifyCard',
  'CodeBlock',
  'Legend',
]);

const escapeRegExp = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @typedef {{ id: string, term: string, aliases: string[], definition: string }} Term
 * @param {{ base?: string, terms?: Term[] }} [options]
 */
export function createGlossaryLinker(options = {}) {
  const base = (options.base ?? '/').replace(/\/+$/, '');
  const terms = options.terms ?? glossaryData.terms;
  /** @type {Map<string, Term>} */
  const bySpelling = new Map();
  for (const entry of terms)
    for (const s of [entry.term, ...entry.aliases]) bySpelling.set(s, entry);
  // Longest spellings first ("Card Tables" before "Card Table"); whole words only.
  const alternatives = [...bySpelling.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_-])(${alternatives.join('|')})(?![\\p{L}\\p{N}_-])`,
    'gu',
  );
  /** @type {Set<string>} */
  const linked = new Set();

  return {
    /**
     * Returns replacement nodes for a text value, or undefined if nothing was linked.
     * @param {string} value
     */
    link(value) {
      /** @type {any[]} */
      const parts = [];
      let last = 0;
      for (const match of value.matchAll(pattern)) {
        const spelling = /** @type {string} */ (match[1]);
        const entry = bySpelling.get(spelling);
        if (!entry || linked.has(entry.id)) continue;
        linked.add(entry.id);
        const index = /** @type {number} */ (match.index);
        if (index > last) parts.push({ type: 'text', value: value.slice(last, index) });
        parts.push({
          type: 'element',
          tagName: 'a',
          properties: {
            href: `${base}/glossar/#${entry.id}`,
            className: ['term'],
            title: entry.definition,
          },
          children: [{ type: 'text', value: spelling }],
        });
        last = index + spelling.length;
      }
      if (parts.length === 0) return undefined;
      if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
      return parts;
    },
  };
}

/** True if a node with this tag or component name blocks linking inside it. */
export const blocksLinking = (/** @type {any} */ node) =>
  Boolean(node && (SKIP.has(node.tagName) || SKIP.has(node.name)));

/**
 * Sätteri hast plugin factory (one linker per document).
 * @param {{ base?: string }} options
 */
export function glossaryPlugin(options) {
  return () => {
    const linker = createGlossaryLinker(options);
    return {
      name: 'glossary-links',
      /** @param {any} node @param {any} ctx */
      text(node, ctx) {
        for (let p = ctx.parent(node); p; p = ctx.parent(p)) if (blocksLinking(p)) return;
        const parts = linker.link(node.value);
        if (parts) ctx.replaceNode(node, parts);
      },
    };
  };
}
