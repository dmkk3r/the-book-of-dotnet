// Deployment target, shared by astro.config.mjs and scripts/check-links.ts.
// GitHub Pages serves project sites under /<repo>/. Override via environment:
//   SITE=https://<user>.github.io BASE_PATH=/<repo>   (CI sets both from actions/configure-pages)
//   BASE_PATH=/                                       (custom domain or user site)

const DEFAULT_SITE = 'https://example.github.io';
const DEFAULT_BASE = '/the-book-of-dotnet';

/** Normalizes a base path to "/" or "/segment" (leading slash, no trailing slash). */
export function normalizeBase(value) {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : `/${trimmed}`;
}

export const site = process.env.SITE || DEFAULT_SITE;
// An explicitly empty BASE_PATH means root (configure-pages returns "" for user sites).
export const base = normalizeBase(process.env.BASE_PATH ?? DEFAULT_BASE);
