// Relative imports with extensions so Node scripts can load this module too.
import { z } from 'astro/zod';
import raw from '../data/glossary.json' with { type: 'json' };
import { ID_PATTERN } from './curriculum-schema.ts';

export const glossarySchema = z.object({
  terms: z
    .array(
      z.object({
        id: z.string().regex(ID_PATTERN),
        term: z.string().min(1),
        aliases: z.array(z.string().min(1)),
        definition: z.string().min(20),
        /** Lesson id from the curriculum with more detail. */
        lesson: z.string().regex(ID_PATTERN).optional(),
      }),
    )
    .min(1),
});

export type GlossaryEntry = z.infer<typeof glossarySchema>['terms'][number];

export const glossary: GlossaryEntry[] = glossarySchema
  .parse(raw)
  .terms.slice()
  .sort((a, b) => a.term.localeCompare(b.term, 'de'));

/** All spellings that link to an entry (term first, then aliases). */
export const spellings = (e: GlossaryEntry) => [e.term, ...e.aliases];

/** Site-relative path of an entry, combine with withBase(). */
export const glossaryPath = (id: string) => `glossar/#${id}`;

/** First letter for grouping (A to Z). */
export const letterOf = (e: GlossaryEntry) => e.term[0]!.toLocaleUpperCase('de');
