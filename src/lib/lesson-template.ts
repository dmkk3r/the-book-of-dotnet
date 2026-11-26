/**
 * File templates for `npm run new:lesson`. Both files are valid right away (the build and
 * tests pass) and follow the lesson structure described in CLAUDE.md.
 */
import type { Curriculum, Lesson } from './curriculum.ts';

export interface LessonFiles {
  lesson: Lesson;
  mdxPath: string;
  stepsPath: string;
  mdx: string;
  steps: string;
}

/** Resolves and checks the arguments. Throws a readable error on mistakes. */
export function resolveLesson(
  c: Curriculum,
  chapterId: string | undefined,
  lessonId: string | undefined,
): Lesson {
  if (!chapterId || !lessonId) {
    throw new Error('Usage: npm run new:lesson -- <chapterId> <lessonId>');
  }
  const chapter = c.chapters.find((ch) => ch.id === chapterId);
  if (!chapter) {
    throw new Error(
      `Unknown chapter "${chapterId}". Known: ${c.chapters.map((ch) => ch.id).join(', ')}`,
    );
  }
  const lesson = c.lessons.find((l) => l.id === lessonId);
  if (!lesson) {
    throw new Error(
      `Unknown lesson "${lessonId}". Add it to src/data/curriculum.json first. ` +
        `Lessons in "${chapterId}": ${chapter.lessons.map((l) => l.id).join(', ')}`,
    );
  }
  if (lesson.chapter.id !== chapterId) {
    throw new Error(
      `Lesson "${lessonId}" belongs to chapter "${lesson.chapter.id}", not "${chapterId}".`,
    );
  }
  return lesson;
}

const yamlString = (s: string) => `'${s.replace(/'/g, "''")}'`;
const tsString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function lessonFiles(lesson: Lesson, today: Date): LessonFiles {
  const dir = `src/content/lessons/${lesson.chapter.id}`;
  const date = today.toISOString().slice(0, 10);

  const mdx = `---
id: ${lesson.id}
title: ${yamlString(lesson.title)}
summary: 'TODO: Ein Satz, der als Lead erscheint.'
status: draft
sources: []
updated: ${date}
---

import { Block, Callout, Legend, VerifyCard, Quiz } from '@/components/lesson';
import { StepPlayer } from '@/components/viz';
import script from './${lesson.id}.steps';

{/* Aufbau und Tiefe: siehe CLAUDE.md („Aufbau einer Lektion“) und die Referenzlektion typsystem/boxing. */}

<Block n={1} title="Das Problem">

TODO: Welches Problem löst das Thema, welcher Zielkonflikt steckt dahinter? Erst die Motivation, dann die Lösung.

</Block>

<Block n={2} title="Das mentale Modell">

TODO: Das Modell in wenigen Kernsätzen.

1. TODO
2. TODO
3. TODO

<Callout kind="fehlannahme">
  TODO: Die häufigste falsche Vorstellung und warum sie nicht stimmt.
</Callout>

<Legend />

</Block>

<Block n={3} title="Durchspielen">

TODO: Ein Satz, worauf man im folgenden Beispiel achten soll.

<StepPlayer script={script} />

</Block>

<Block n={4} title="Im Detail">

TODO: Was Runtime, JIT oder Compiler genau tun. Titel an das Thema anpassen, bei Bedarf weitere Detailabschnitte und Visualisierungen (Dateien nach dem Muster \`${lesson.id}-NAME.steps.ts\`) ergänzen.

</Block>

<Block n={5} title="Stolperfallen">

TODO: Ein bis zwei typische Fehler oder Überraschungen, gern mit eigener Visualisierung.

</Block>

<Block n={6} title="In der Praxis">

TODO: Wo das Thema im Alltag auftaucht, was es kostet, wie man es erkennt und vermeidet.

| Code | Effekt | Warum | Ausweg |
| --- | --- | --- | --- |
| TODO | TODO | TODO | TODO |

</Block>

<Block n={7} title="Was Runtime und JIT dazu tun">

TODO: Optimierungen und Versionsunterschiede. Abschnitt entfernen, wenn es nichts Relevantes gibt.

</Block>

<Block n={8} title="Selbst nachweisen">

{/* TODO(verify): Erwartete Werte selbst mit SharpLab oder BenchmarkDotNet messen. */}

<VerifyCard
  sharplab="TODO: Was in SharpLab einstellen und worauf achten?"
  code={\`// TODO: Beispielcode\`}
/>

</Block>

<Block n={9} title="Prüfen">

<Quiz
  client:visible
  lessonId="${lesson.id}"
  questions={[
    {
      q: 'TODO: Frage, die eine typische Fehlannahme aufdeckt',
      options: ['TODO: richtig', 'TODO: falsch'],
      correct: 0,
      explanation: 'TODO: Warum?',
    },
  ]}
/>

</Block>

<Block n={10} title="Das Wichtigste in Kürze">

- TODO: fünf bis sieben Merksätze

</Block>
`;

  const steps = `import { defineStepScript } from '@/components/viz';

// Addresses must be fictional but consistent across steps. Sizes refer to 64-bit.
// TODO(verify): Alle Zahlen mit SharpLab oder BenchmarkDotNet prüfen.

export default defineStepScript({
  view: 'memory',
  title: ${tsString(`${lesson.title} Schritt für Schritt`)},
  code: {
    cs: \`// TODO: kurzes Beispiel, max. ca. 10 Zeilen
int x = 42;\`,
  },
  steps: [
    {
      codeLine: 2,
      state: {
        frames: [
          { id: 'main', method: 'Main()', slots: [{ id: 'x', name: 'x', type: 'int (4 Byte)', value: '42' }] },
        ],
        heap: [],
      },
      changed: ['x'],
      explanation: 'TODO: Was ist passiert und warum? Maximal drei Sätze.',
    },
  ],
});
`;

  return {
    lesson,
    mdxPath: `${dir}/${lesson.id}.mdx`,
    stepsPath: `${dir}/${lesson.id}.steps.ts`,
    mdx,
    steps,
  };
}
