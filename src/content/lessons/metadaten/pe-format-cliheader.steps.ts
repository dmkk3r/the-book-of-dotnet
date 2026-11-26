import { defineStepScript, type LayoutState } from '@/components/viz';

// Layout of the CLI header after ECMA-335 Partition II, 25.3.3 (72 bytes, all fields
// little-endian, every directory is a pair of 4-byte RVA and 4-byte size).
// TODO(verify): Field order and sizes against ECMA-335 II.25.3.3 and IMAGE_COR20_HEADER in
// src/coreclr/inc/corhdr.h; runtime version 2.5 as written by Roslyn; the CorHeader property
// names used in the C# tab (System.Reflection.PortableExecutable.CorHeader). The entry point
// token 0x06000001 is an example (Main as first MethodDef row), not a measured value.

const header = (labels: Partial<Record<string, string>> = {}): LayoutState => ({
  title: 'CLI-Header (IMAGE_COR20_HEADER)',
  totalSize: 72,
  parts: [
    {
      id: 'cb',
      name: labels.cb ?? 'cb (Größe)',
      type: 'uint32',
      offset: 0,
      size: 4,
      kind: 'field',
    },
    {
      id: 'major',
      name: labels.major ?? 'MajorRuntimeVersion',
      type: 'uint16',
      offset: 4,
      size: 2,
      kind: 'field',
    },
    {
      id: 'minor',
      name: labels.minor ?? 'MinorRuntimeVersion',
      type: 'uint16',
      offset: 6,
      size: 2,
      kind: 'field',
    },
    {
      id: 'md',
      name: labels.md ?? 'MetaData',
      type: 'RVA + Größe',
      offset: 8,
      size: 8,
      kind: 'field',
    },
    {
      id: 'flags',
      name: labels.flags ?? 'Flags',
      type: 'uint32',
      offset: 16,
      size: 4,
      kind: 'field',
    },
    {
      id: 'entry',
      name: labels.entry ?? 'EntryPointToken',
      type: 'uint32',
      offset: 20,
      size: 4,
      kind: 'field',
    },
    {
      id: 'res',
      name: labels.res ?? 'Resources',
      type: 'RVA + Größe',
      offset: 24,
      size: 8,
      kind: 'field',
    },
    {
      id: 'sn',
      name: labels.sn ?? 'StrongNameSignature',
      type: 'RVA + Größe',
      offset: 32,
      size: 8,
      kind: 'field',
    },
    {
      id: 'cm',
      name: labels.cm ?? 'CodeManagerTable',
      type: 'RVA + Größe',
      offset: 40,
      size: 8,
      kind: 'field',
    },
    {
      id: 'vt',
      name: labels.vt ?? 'VTableFixups',
      type: 'RVA + Größe',
      offset: 48,
      size: 8,
      kind: 'field',
    },
    {
      id: 'eat',
      name: labels.eat ?? 'ExportAddressTableJumps',
      type: 'RVA + Größe',
      offset: 56,
      size: 8,
      kind: 'field',
    },
    {
      id: 'mnh',
      name: labels.mnh ?? 'ManagedNativeHeader',
      type: 'RVA + Größe',
      offset: 64,
      size: 8,
      kind: 'field',
    },
  ],
  note: 'Alle Verzeichnisse bestehen aus einer RVA (4 Byte) und einer Größe (4 Byte).',
});

export default defineStepScript({
  view: 'layout',
  layout: 'stacked',
  title: 'Der CLI-Header Feld für Feld',
  code: {
    cs: `var cor = pe.PEHeaders.CorHeader!;
Console.WriteLine($"{cor.MajorRuntimeVersion}.{cor.MinorRuntimeVersion}");
Console.WriteLine(cor.MetadataDirectory.Size);
Console.WriteLine(cor.Flags);
Console.WriteLine(cor.EntryPointTokenOrRelativeVirtualAddress);
Console.WriteLine(cor.ResourcesDirectory.Size);
Console.WriteLine(cor.StrongNameSignatureDirectory.Size);
Console.WriteLine(cor.VtableFixupsDirectory.Size);
Console.WriteLine(cor.ManagedNativeHeaderDirectory.Size);`,
  },
  steps: [
    {
      codeLine: 2,
      state: header({ cb: 'cb = 72', major: 'Major = 2', minor: 'Minor = 5' }),
      changed: ['cb', 'major', 'minor'],
      explanation:
        'Der Header beginnt mit seiner eigenen Größe und einer Laufzeitversion. Die Version 2.5 beschreibt das Format des Headers, nicht die .NET-Version, für die das Programm gebaut wurde.',
    },
    {
      codeLine: 3,
      state: header({ cb: 'cb = 72', major: 'Major = 2', minor: 'Minor = 5' }),
      changed: ['md'],
      explanation:
        'Das wichtigste Feld: **MetaData** zeigt auf den Metadatenstamm. Ohne dieses Verzeichnis wüsste die Runtime nicht, welche Typen und Methoden die Datei enthält.',
    },
    {
      codeLine: 4,
      state: header({ flags: 'Flags = ILONLY' }),
      changed: ['flags'],
      explanation:
        '`ILONLY` heißt: Die Datei enthält nur IL und Metadaten, keinen nativen Code. Weitere Bits markieren etwa eine starke Signatur oder legen fest, dass die Assembly nur in 32-Bit-Prozessen laufen darf.',
    },
    {
      codeLine: 5,
      state: header({ flags: 'Flags = ILONLY', entry: 'EntryPointToken = 0x06000001' }),
      changed: ['entry'],
      explanation:
        'Bei einer ausführbaren Assembly steht hier ein **Metadaten-Token**, das auf die `Main`-Methode in der Tabelle MethodDef zeigt (0x06 ist MethodDef). Bei einer Bibliothek ist das Feld 0. Was Tokens genau sind, klärt „Metadatentabellen und Tokens“.',
    },
    {
      codeLine: 6,
      state: header({ flags: 'Flags = ILONLY' }),
      changed: ['res', 'sn'],
      explanation:
        '**Resources** zeigt auf eingebettete verwaltete Ressourcen, die ebenfalls im Abschnitt `.text` liegen. **StrongNameSignature** reserviert Platz für die Signatur einer stark benannten Assembly und ist sonst leer.',
    },
    {
      codeLine: 8,
      state: header({
        flags: 'Flags = ILONLY',
        cm: 'CodeManagerTable = 0',
        eat: 'ExportAddressTableJumps = 0',
      }),
      changed: ['cm', 'vt', 'eat'],
      explanation:
        'Diese drei Felder sind in normalen C#-Assemblies leer. **VTableFixups** braucht vor allem C++/CLI, um verwaltete Methoden für nativen Code aufrufbar zu machen. Die beiden anderen sind laut ECMA-335 reserviert und immer 0.',
    },
    {
      codeLine: 9,
      state: header({ flags: 'Flags = ILONLY', mnh: 'ManagedNativeHeader = ReadyToRun-Header' }),
      changed: ['mnh'],
      explanation:
        'Das letzte Feld ist in einer gewöhnlichen Assembly leer. In einem **ReadyToRun**-Image zeigt es auf den ReadyToRun-Header, über den die Runtime vorkompilierten Maschinencode findet. IL und Metadaten bleiben trotzdem vollständig erhalten.',
    },
  ],
});
