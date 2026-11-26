import { defineStepScript, type LayoutState } from '@/components/viz';

// Field lists from dotnet/runtime: Span.cs (.NET 7+: `ref T _reference; int _length`),
// Memory.cs (`object? _object; int _index; int _length`). The portable Span of the System.Memory
// package for .NET Framework is described in Stephen Toub's „All About Span“ only as slower.
// TODO(verify): Unsafe.SizeOf<Span<int>>() == 16 and Unsafe.SizeOf<Memory<int>>() == 16 on x64.
// TODO(verify): Field list of the portable Span (Pinnable<T> _pinnable, IntPtr _byteOffset,
// int _length) and its size of 24 B on x64 in dotnet/corefx (System.Memory, Span.Portable.cs).

const span: LayoutState = {
  title: 'readonly ref struct Span<T> (.NET 7 und neuer)',
  totalSize: 16,
  parts: [
    { id: 's-ref', name: '_reference', type: 'ref T', offset: 0, size: 8, kind: 'field' },
    { id: 's-len', name: '_length', type: 'int', offset: 8, size: 4, kind: 'field' },
    { id: 's-pad', name: 'Padding', offset: 12, size: 4, kind: 'padding' },
  ],
  note: 'Kein Object Header, keine MethodTable: ein Span ist ein reiner Wert, wie zwei lokale Variablen nebeneinander.',
};

const portable: LayoutState = {
  title: 'Span<T> aus dem Paket System.Memory (.NET Framework)',
  totalSize: 24,
  parts: [
    {
      id: 'p-obj',
      name: '_pinnable',
      type: 'Pinnable<T> (Verweis)',
      offset: 0,
      size: 8,
      kind: 'field',
    },
    { id: 'p-off', name: '_byteOffset', type: 'IntPtr', offset: 8, size: 8, kind: 'field' },
    { id: 'p-len', name: '_length', type: 'int', offset: 16, size: 4, kind: 'field' },
    { id: 'p-pad', name: 'Padding', offset: 20, size: 4, kind: 'padding' },
  ],
  note: 'Ohne Unterstützung der Runtime für innere Verweise in Feldern: Objekt plus Byte-Abstand, bei jedem Zugriff wird addiert.',
};

const memory: LayoutState = {
  title: 'readonly struct Memory<T>',
  totalSize: 16,
  parts: [
    { id: 'm-obj', name: '_object', type: 'object? (Verweis)', offset: 0, size: 8, kind: 'field' },
    { id: 'm-idx', name: '_index', type: 'int', offset: 8, size: 4, kind: 'field' },
    { id: 'm-len', name: '_length', type: 'int', offset: 12, size: 4, kind: 'field' },
  ],
  note: '_object ist ein T[], ein string (nur bei ReadOnlyMemory<char>) oder ein MemoryManager<T>. Ein normaler Objektverweis, den der GC ganz gewöhnlich behandelt.',
};

export default defineStepScript({
  view: 'layout',
  title: 'Span<T> und Memory<T> im Speicher',
  code: {
    cs: `public readonly ref struct Span<T>
{
    internal readonly ref T _reference;
    private readonly int _length;
}

public readonly struct Memory<T>
{
    private readonly object? _object;
    private readonly int _index;
    private readonly int _length;
}`,
  },
  steps: [
    {
      codeLine: 3,
      state: span,
      changed: ['s-ref'],
      explanation:
        'Das erste Feld ist ein **ref-Feld**: ein verwalteter Verweis, der auf ein beliebiges Element zeigen darf, auch mitten in ein Objekt, auf den Stack oder in nativen Speicher. Auf 64-Bit ist er 8 Byte groß wie jeder Zeiger.',
    },
    {
      codeLine: 4,
      state: span,
      changed: ['s-len', 's-pad'],
      explanation:
        'Dazu kommt die Länge als `int`. Ein Span kann also höchstens `int.MaxValue` Elemente umfassen. Mit Ausrichtung ergibt das 16 Byte, die bei Übergabe als Argument kopiert werden.',
    },
    {
      codeLine: 1,
      state: portable,
      changed: ['p-obj', 'p-off'],
      explanation:
        'Zum Vergleich der Span für .NET Framework: Dort kennt die Runtime keine ref-Felder, also speichert er ein Objekt und einen Abstand getrennt. Jeder Zugriff muss beides erst addieren. Deshalb ist dieser Span langsamer als der eingebaute.',
    },
    {
      codeLine: 9,
      state: memory,
      changed: ['m-obj'],
      explanation:
        '`Memory<T>` ist kein ref struct. Statt eines inneren Verweises hält es einen **gewöhnlichen Objektverweis** auf den Anfang des Besitzers. So etwas darf in Feldern, auf dem Heap und über `await` hinweg leben.',
    },
    {
      codeLine: 10,
      state: memory,
      changed: ['m-idx', 'm-len'],
      explanation:
        'Der Ausschnitt steckt in Index und Länge. Erst `memory.Span` rechnet daraus einen echten Span aus: Typ von `_object` prüfen, Startadresse bestimmen, Grenzen prüfen. Diese Arbeit fällt bei jedem Zugriff auf `.Span` an.',
    },
  ],
});
