import { z } from 'astro/zod';

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const id = z.string().regex(ID_PATTERN, 'IDs must be kebab-case ASCII');

export const tierSchema = z.enum(['kern', 'fortgeschritten', 'vertiefung']);

export const curriculumSchema = z
  .object({
    chapters: z
      .array(
        z.object({
          id,
          title: z.string().min(1),
          summary: z.string().min(1),
          tier: tierSchema,
          lessons: z.array(z.object({ id, title: z.string().min(1) })).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((value, ctx) => {
    const report = (kind: string, ids: string[]) => {
      const seen = new Set<string>();
      for (const item of ids) {
        if (seen.has(item))
          ctx.addIssue({ code: 'custom', message: `Duplicate ${kind} id "${item}"` });
        seen.add(item);
      }
    };
    report(
      'chapter',
      value.chapters.map((c) => c.id),
    );
    report(
      'lesson',
      value.chapters.flatMap((c) => c.lessons.map((l) => l.id)),
    );
  });

export type Tier = z.infer<typeof tierSchema>;
export type CurriculumData = z.infer<typeof curriculumSchema>;
export type ChapterData = CurriculumData['chapters'][number];

export const TIER_LABELS: Record<Tier, string> = {
  kern: 'Kern',
  fortgeschritten: 'Fortgeschritten',
  vertiefung: 'Vertiefung',
};

/** Parses curriculum data and throws a readable error listing every problem. */
export function parseCurriculum(data: unknown): CurriculumData {
  const result = curriculumSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid curriculum:\n${issues}`);
  }
  return result.data;
}
