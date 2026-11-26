import { curriculum, lessonPath } from './../curriculum';
import type { StepScript, ViewName } from './types';

/** View catalogue for the dev-only demo pages (/demo/). */
export const VIEWS: { view: ViewName; name: string; purpose: string; source: string }[] = [
  {
    view: 'memory',
    name: 'MemoryView',
    purpose: 'Stack-Frames, Heap-Objekte, Verweise (Kapitel 3)',
    source: 'types.ts',
  },
  {
    view: 'timeline',
    name: 'TimelineView',
    purpose: 'Threads, Tasks und Continuations (Kapitel 10 und 11)',
    source: 'views/timeline.ts',
  },
  {
    view: 'gcheap',
    name: 'GcHeapView',
    purpose: 'Generationen, Roots, Mark und Promotion (Kapitel 4)',
    source: 'views/gcheap.ts',
  },
  {
    view: 'pipeline',
    name: 'PipelineView',
    purpose: 'JIT-Phasen und Tiering (Kapitel 7)',
    source: 'views/pipeline.ts',
  },
  {
    view: 'buckets',
    name: 'BucketView',
    purpose: 'Hash-Tabellen, Kollisionen und Suche (Kapitel 14)',
    source: 'views/buckets.ts',
  },
  {
    view: 'layout',
    name: 'LayoutView',
    purpose: 'Byte-genaues Objekt- und Struct-Layout (Kapitel 3)',
    source: 'views/layout.ts',
  },
  {
    view: 'graph',
    name: 'GraphView',
    purpose: 'Abläufe, Entscheidungen und Zustandsautomaten auf einem festen Raster',
    source: 'views/graph.ts',
  },
  {
    view: 'table',
    name: 'TableView',
    purpose: 'Tabellen mit Verweisen zwischen Zeilen, etwa Metadatentabellen (Kapitel 2)',
    source: 'views/table.ts',
  },
];

const scripts = import.meta.glob<{ default: StepScript }>('/src/content/lessons/**/*.steps.ts', {
  eager: true,
});
const sources = import.meta.glob<string>('/src/lib/viz/{types.ts,views/*.ts}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** First lesson script that uses the view, with a link to that lesson. */
export function exampleFor(view: ViewName) {
  for (const [path, mod] of Object.entries(scripts)) {
    if (mod.default.view !== view) continue;
    const [chapterId, lessonId] = path
      .replace('/src/content/lessons/', '')
      .replace('.steps.ts', '')
      .split('/');
    const lesson = curriculum.lessons.find((l) => l.id === lessonId && l.chapter.id === chapterId);
    return {
      script: mod.default,
      lesson,
      href: lesson ? lessonPath(lesson.chapter.id, lesson.id) : undefined,
    };
  }
  return undefined;
}

export const sourceOf = (file: string) => sources[`/src/lib/viz/${file}`] ?? '';
