/**
 * Joins a site-relative path onto a base path.
 * Pure function so it can be tested independently of the build configuration.
 */
export function joinBase(base: string, path = ''): string {
  const cleanBase = base.replace(/\/+$/, '');
  const cleanPath = path.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

/**
 * Prefixes an internal path with the configured base path (GitHub Pages runs under /<repo>/).
 * Always use this for internal links and assets, never a hard-coded leading "/".
 *
 * @example withBase('kapitel/gc/') -> '/the-book-of-dotnet/kapitel/gc/'
 */
export function withBase(path = ''): string {
  return joinBase(import.meta.env.BASE_URL, path);
}
