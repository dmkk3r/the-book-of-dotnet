import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { ID_PATTERN } from '@/lib/curriculum-schema';

const lessons = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/lessons' }),
  schema: z.object({
    id: z.string().regex(ID_PATTERN),
    title: z.string().min(1),
    summary: z.string().min(1),
    status: z.enum(['draft', 'reviewed', 'verified']),
    dotnetVersion: z.string().optional(),
    sources: z.array(z.object({ title: z.string().min(1), url: z.url() })),
    verifiedWith: z.array(z.string()).optional(),
    updated: z.coerce.date(),
  }),
});

export const collections = { lessons };
