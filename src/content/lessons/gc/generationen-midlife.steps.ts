import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual scenario, no sizes on purpose. Which generation a collection condemns is decided
// by the GC from its budgets; the sequence Gen0, Gen1, ..., Gen2 here is illustrative.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  { id: 'g2', kind: 'gen2' },
];

const config = (status?: Status): Obj => ({
  id: 'config',
  region: 'g2',
  label: 'Config',
  status,
});
const active = (refs: string[], status?: Status): Obj => ({
  id: 'active',
  region: 'g2',
  label: 'List<Session>',
  refs,
  status,
});
const session = (i: number, region: string, status?: Status): Obj => ({
  id: `s${i}`,
  region,
  label: `Session ${i}`,
  status,
});
const temp = (i: number, status?: Status): Obj => ({
  id: `t${i}`,
  region: 'g0',
  label: 'Puffer',
  status,
});

const roots = [
  { id: 'r-config', label: 's_config', refs: ['config'] },
  { id: 'r-active', label: 's_active', refs: ['active'] },
];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Midlife Crisis Schritt für Schritt',
  code: {
    cs: `static readonly Config s_config = LoadConfig();   // lebt ewig
static readonly List<Session> s_active = new();

void OnRequest()
{
    var s = new Session();     // lebt etwa 30 Sekunden
    s_active.Add(s);
    // ... viele kurzlebige Puffer pro Anfrage
}

void OnTimeout(Session s) => s_active.Remove(s);`,
  },
  steps: [
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          config(),
          active(['s1', 's2']),
          session(1, 'g0'),
          temp(1),
          session(2, 'g0'),
          temp(2),
        ],
        roots,
        phase: 'alloc',
      },
      changed: ['s1', 's2', 't1', 't2'],
      explanation:
        'Zwei Anfragen legen je eine `Session` und kurzlebige Puffer an. `Config` und die Liste `s_active` leben seit dem Start und liegen in Gen2. Die Sessions sind über die Liste erreichbar.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          config(),
          active(['s1', 's2']),
          session(1, 'g1', 'live'),
          session(2, 'g1', 'live'),
        ],
        roots,
        phase: 'done',
      },
      changed: ['s1', 's2'],
      explanation:
        'Eine Gen0-Collection: Die Puffer sind tot und kosten nichts. Die Sessions sind noch aktiv, überleben und werden nach **Gen1** promotet. Bis hierher arbeitet die Hypothese für dich.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [
          config(),
          active(['s1', 's2', 's3']),
          session(1, 'g1'),
          session(2, 'g1'),
          session(3, 'g0'),
          temp(3),
        ],
        roots,
        phase: 'alloc',
      },
      changed: ['s3', 't3'],
      explanation:
        'Weitere Anfragen kommen herein. Die ersten beiden Sessions sind immer noch aktiv, ihre 30 Sekunden sind nicht um.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [
          config(),
          active(['s1', 's2', 's3']),
          session(1, 'g2', 'live'),
          session(2, 'g2', 'live'),
          session(3, 'g1', 'live'),
        ],
        roots,
        phase: 'done',
      },
      changed: ['s1', 's2', 's3'],
      explanation:
        'Irgendwann ist eine Collection fällig, die Gen1 einschließt. `Session 1` und `Session 2` leben noch und werden nach **Gen2** promotet. Damit gelten sie für den GC als langlebig, obwohl sie gleich sterben.',
    },
    {
      codeLine: 11,
      state: {
        regions,
        objects: [
          config(),
          active(['s3']),
          session(1, 'g2', 'dead'),
          session(2, 'g2', 'dead'),
          session(3, 'g1'),
        ],
        roots,
        phase: 'alloc',
      },
      changed: ['s1', 's2', 'active'],
      explanation:
        'Der Timeout entfernt die beiden Sessions aus der Liste. Jetzt sind sie Müll, aber **in Gen2**. Das ist die Midlife Crisis: Objekte, die gerade lange genug leben, um alt zu werden, und dann sterben.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [
          config(),
          active(['s4', 's5']),
          session(1, 'g2', 'dead'),
          session(2, 'g2', 'dead'),
          session(3, 'g2', 'dead'),
          session(4, 'g1'),
          session(5, 'g0'),
        ],
        roots,
        phase: 'alloc',
      },
      changed: ['s3', 's4', 's5', 'active'],
      explanation:
        'Viele Gen0- und Gen1-Collections später ist auch `Session 3` in Gen2 gelandet und dort abgelaufen. Keine dieser Collections schaut in Gen2, der Speicher der toten Sessions bleibt belegt. Mit jeder Welle von Anfragen wächst Gen2 weiter, bis sein Budget erschöpft ist.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [
          config('marked'),
          active(['s4', 's5'], 'marked'),
          session(1, 'g2', 'unknown'),
          session(2, 'g2', 'unknown'),
          session(3, 'g2', 'unknown'),
          session(4, 'g1', 'marked'),
          session(5, 'g0', 'marked'),
        ],
        roots,
        phase: 'mark',
      },
      changed: ['config', 'active', 's4', 's5'],
      explanation:
        'Nun ist eine **Gen2-Collection** fällig, eine volle Collection über alle Generationen. Sie muss alles Lebende im ganzen Heap markieren, auch `Config` und alle anderen langlebigen Objekte, die mit dem Problem nichts zu tun haben.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [
          config('live'),
          active(['s4', 's5'], 'live'),
          session(4, 'g2', 'live'),
          session(5, 'g1', 'live'),
        ],
        roots,
        phase: 'done',
      },
      changed: ['s4', 's5'],
      explanation:
        'Erst jetzt wird der Platz der toten Sessions frei. Teuer bezahlt: eine volle Collection für Objekte, die nur 30 Sekunden gebraucht wurden. Und die nächsten Sessions sind schon auf dem Weg nach Gen2.',
    },
  ],
});
