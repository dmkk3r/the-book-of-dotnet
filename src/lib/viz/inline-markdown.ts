const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Renders the small inline Markdown subset used in step explanations:
 * `code`, **bold**, *italic*. Everything else is escaped.
 */
export function renderInlineMarkdown(source: string): string {
  const parts = escapeHtml(source).split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      return part
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
    })
    .join('');
}
