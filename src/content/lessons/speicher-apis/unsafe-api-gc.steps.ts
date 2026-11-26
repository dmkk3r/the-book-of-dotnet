import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent. A reference points at the MethodTable pointer, the
// first field follows 8 bytes later on x64. The GC is not obliged to move m or to place the next
// object at the old address; the script shows one possible run to illustrate why
// Unsafe.AsPointer on an unpinned object is dangerous (see the remarks in the Unsafe.AsPointer docs).
// TODO(verify): Size 24 B for class Messung { int Wert; } on x64.

const OLD = 0x7f3a3000;
const NEW = 0x7f4b0010;
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

type Slot = MemoryState['frames'][number]['slots'][number];
type Obj = MemoryState['heap'][number];

const messung = (id: 'm' | 'other', address: number, gen: 0 | 1, wert: string): Obj => ({
  id,
  type: 'Messung',
  address: hex(address),
  generation: gen,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ Messung' },
    { name: 'Wert', value: wert },
  ],
  sizeBytes: 24,
});

interface S {
  moved: boolean;
  withRef: boolean;
  withPtr: boolean;
  other?: string;
  mWert?: string;
  output?: string;
}

function state(s: S): MemoryState {
  const mAddr = s.moved ? NEW : OLD;
  const slots: Slot[] = [
    { id: 'mRef', name: 'm', type: 'Messung (Verweis)', value: hex(mAddr), ref: 'm' },
  ];
  if (s.withRef) {
    slots.push({
      id: 'r',
      name: 'r',
      type: 'ref int (vom GC verfolgt)',
      value: `${hex(mAddr + 8)} (→ m.Wert)`,
      ref: 'm',
    });
  }
  if (s.withPtr) {
    slots.push({
      id: 'p',
      name: 'p',
      type: 'int* (für den GC nur eine Zahl)',
      value: hex(OLD + 8),
    });
  }
  if (s.other !== undefined) {
    slots.push({
      id: 'otherRef',
      name: 'other',
      type: 'Messung (Verweis)',
      value: hex(OLD),
      ref: 'other',
    });
  }
  return {
    frames: [{ id: 'main', method: 'Main()', slots }],
    heap: [
      ...(s.other !== undefined ? [messung('other', OLD, 0, s.other)] : []),
      messung('m', mAddr, s.moved ? 1 : 0, s.mWert ?? '0'),
    ],
    ...(s.output !== undefined ? { output: s.output } : {}),
  };
}

export default defineStepScript({
  view: 'memory',
  title: 'Verwalteter Verweis und Zeiger, wenn der GC kompaktiert',
  code: {
    cs: `var m = new Messung();
ref int r = ref m.Wert;
int* p = (int*)Unsafe.AsPointer(ref m.Wert); // nicht fixiert
GC.Collect();                                // m wird verschoben
var other = new Messung();                   // landet an der alten Stelle
r = 1;
*p = 2;
Console.WriteLine($"{m.Wert} {other.Wert}");

class Messung { public int Wert; }`,
  },
  steps: [
    {
      codeLine: 1,
      state: state({ moved: false, withRef: false, withPtr: false }),
      changed: ['mRef', 'm'],
      explanation:
        'Ein kleines Objekt in Gen0. Das Feld `Wert` liegt 8 Byte hinter der Adresse, auf die der Verweis `m` zeigt.',
    },
    {
      codeLine: 2,
      state: state({ moved: false, withRef: true, withPtr: false }),
      changed: ['r'],
      explanation:
        '`r` ist ein **verwalteter Verweis** mitten in das Objekt, ein innerer Zeiger. Der JIT meldet ihn dem GC als solchen. Der Pfeil im Bild steht dafür, dass der GC ihn kennt.',
    },
    {
      codeLine: 3,
      state: state({ moved: false, withRef: true, withPtr: true }),
      changed: ['p'],
      explanation:
        '`Unsafe.AsPointer` macht aus demselben Verweis einen **Zeiger**. Die Adresse ist gleich, aber für den GC ist `p` eine gewöhnliche Zahl ohne Pfeil. Ohne `fixed` oder ein Pinning-Handle hält nichts das Objekt an seinem Platz.',
    },
    {
      codeLine: 4,
      state: state({ moved: true, withRef: true, withPtr: true }),
      changed: ['m', 'mRef', 'r'],
      explanation:
        'Angenommen, der GC kompaktiert und verschiebt `m` nach Gen1 an eine neue Adresse. Er passt jeden Verweis an, den er kennt: `m` und auch den inneren Verweis `r`. Von `p` weiß er nichts, `p` zeigt weiter auf die alte Stelle.',
    },
    {
      codeLine: 5,
      state: state({ moved: true, withRef: true, withPtr: true, other: '0' }),
      changed: ['otherRef', 'other'],
      explanation:
        'Der freie Platz in Gen0 wird wiederverwendet. In diesem Lauf landet das nächste Objekt genau dort, wo `m` vorher lag. Ob das passiert, ist Zufall, und genau das macht solche Fehler so schwer zu finden.',
    },
    {
      codeLine: 6,
      state: state({ moved: true, withRef: true, withPtr: true, other: '0', mWert: '1' }),
      changed: ['m.Wert'],
      explanation:
        'Der Schreibzugriff über `r` folgt dem Objekt an seine neue Adresse. Genau dafür gibt es verwaltete Verweise: Sie bleiben gültig, ohne dass jemand fixieren muss.',
    },
    {
      codeLine: 7,
      state: state({
        moved: true,
        withRef: true,
        withPtr: true,
        other: '2',
        mWert: '1',
        output: '1 2',
      }),
      changed: ['other.Wert'],
      explanation:
        'Der Schreibzugriff über `p` trifft ein **fremdes Objekt**. Hätte an dieser Stelle ein Objektverweis oder ein Header gelegen, wäre der Heap beschädigt, und der Prozess würde viel später an einer unbeteiligten Stelle abstürzen.',
    },
  ],
});
