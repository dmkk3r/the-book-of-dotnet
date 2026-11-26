import { defineStepScript, type LayoutState } from '@/components/viz';

// TODO(verify): Auto layout order for classes in CoreCLR (references first, then fields by size
// descending) and the resulting size of 32 B on x64; check with ObjectLayoutInspector.

const declared: LayoutState = {
  title: 'class Mixed in Deklarationsreihenfolge (gedacht)',
  totalSize: 48,
  parts: [
    { id: 'd-hdr', name: 'Object Header', offset: 0, size: 8, kind: 'header' },
    { id: 'd-mt', name: 'MethodTable-Zeiger', offset: 8, size: 8, kind: 'methodtable' },
    { id: 'd-a', name: 'A', type: 'byte', offset: 16, size: 1, kind: 'field' },
    { id: 'd-pad1', name: 'Padding', offset: 17, size: 7, kind: 'padding' },
    { id: 'd-o', name: 'Name', type: 'string (Verweis)', offset: 24, size: 8, kind: 'field' },
    { id: 'd-b', name: 'B', type: 'int', offset: 32, size: 4, kind: 'field' },
    { id: 'd-c', name: 'C', type: 'byte', offset: 36, size: 1, kind: 'field' },
    { id: 'd-pad2', name: 'Padding', offset: 37, size: 11, kind: 'padding' },
  ],
  note: 'So sähe das Objekt aus, wenn die Runtime die Reihenfolge aus dem Quelltext übernähme.',
};

const auto: LayoutState = {
  title: 'class Mixed mit LayoutKind.Auto (tatsächlich)',
  totalSize: 32,
  parts: [
    { id: 'a-hdr', name: 'Object Header', offset: 0, size: 8, kind: 'header' },
    { id: 'a-mt', name: 'MethodTable-Zeiger', offset: 8, size: 8, kind: 'methodtable' },
    { id: 'a-o', name: 'Name', type: 'string (Verweis)', offset: 16, size: 8, kind: 'field' },
    { id: 'a-b', name: 'B', type: 'int', offset: 24, size: 4, kind: 'field' },
    { id: 'a-a', name: 'A', type: 'byte', offset: 28, size: 1, kind: 'field' },
    { id: 'a-c', name: 'C', type: 'byte', offset: 29, size: 1, kind: 'field' },
    { id: 'a-pad', name: 'Padding', offset: 30, size: 2, kind: 'padding' },
  ],
  note: 'Verweise zuerst, dann die übrigen Felder der Größe nach. Das Padding schrumpft auf 2 Byte.',
};

export default defineStepScript({
  view: 'layout',
  title: 'Layout einer Klasse Schritt für Schritt',
  code: {
    cs: `class Mixed
{
    public byte   A;
    public string Name = "";
    public int    B;
    public byte   C;
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: declared,
      changed: ['d-pad1', 'd-pad2'],
      explanation:
        'Würde die Runtime die Felder in der Reihenfolge des Quelltexts ablegen, entstünde nach `A` eine Lücke von 7 Byte, damit der Verweis `Name` auf einer durch 8 teilbaren Adresse liegt.',
    },
    {
      codeLine: 1,
      state: auto,
      changed: ['a-o', 'a-b', 'a-a', 'a-c'],
      explanation:
        'Klassen verwenden aber standardmäßig `LayoutKind.Auto`. Die Runtime darf die Felder selbst anordnen: Verweise zuerst, die übrigen Felder der Größe nach absteigend. Das Objekt wird deutlich kleiner.',
    },
    {
      codeLine: 4,
      state: auto,
      changed: ['a-o'],
      explanation:
        'Dass Verweise vorne liegen, hilft auch dem GC: Er muss nur einen zusammenhängenden Bereich nach Verweisen durchsuchen. Für dich als Entwickler heißt das: Bei Klassen musst du dich um die Feldreihenfolge nicht kümmern.',
    },
  ],
});
