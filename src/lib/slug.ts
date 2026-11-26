/** URL fragment for a heading, e.g. "Unter der Haube" -> "unter-der-haube". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Section titles of a lesson, read from `<Block n={…} title="…">` in the raw MDX. */
export function blockTitles(mdx: string): string[] {
  return [...mdx.matchAll(/<Block\s+n=\{\d+\}\s+title="([^"]+)"/g)].map((m) => m[1]!);
}
