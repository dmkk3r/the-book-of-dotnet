// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { site, base } from './deploy.config.mjs';
import devPages from './integrations/dev-pages.mjs';
import { satteri } from '@astrojs/markdown-satteri';
import { createCssVariablesTheme } from 'shiki';
import { glossaryPlugin } from './integrations/glossary-linker.mjs';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [mdx(), react(), devPages()],
  markdown: {
    // Code fences in lessons use the same CSS-variable theme as our own code blocks.
    shikiConfig: {
      theme: createCssVariablesTheme({
        name: 'book-of-dotnet',
        variablePrefix: '--shiki-',
        variableDefaults: {},
        fontStyle: true,
      }),
    },
    // Default processor plus automatic glossary links; MDX lessons inherit it.
    processor: satteri({ hastPlugins: [glossaryPlugin({ base })] }),
  },
});
