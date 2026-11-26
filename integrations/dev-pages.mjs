// @ts-check
/**
 * Injects pages that exist only in `astro dev` (author overview, later component demos).
 * They are never part of the static build.
 * @returns {import('astro').AstroIntegration}
 */
export default function devPages() {
  return {
    name: 'book-of-dotnet:dev-pages',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/autor', entrypoint: './src/dev/autor.astro' });
        injectRoute({ pattern: '/demo', entrypoint: './src/dev/demo/index.astro' });
        injectRoute({ pattern: '/demo/[view]', entrypoint: './src/dev/demo/view.astro' });
      },
    },
  };
}
